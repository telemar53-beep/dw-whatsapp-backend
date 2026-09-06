const express = require('express');
const multer = require('multer');
const { requireAuth } = require('../auth/auth.middleware');
const {
  listWaitingConversations,
  listConversationsByAgent,
  getConversationWithContact,
  claimConversation,
  transferConversation,
  closeConversation,
  listClosedConversationsByContact,
} = require('../conversations/conversation.repository');
const { listMessagesByConversation } = require('../conversations/message.repository');
const { enqueueOutboundMessage } = require('../queue/outbound-queue');
const { emitToAgent, broadcast } = require('../realtime/socket-server');
const { saveMediaFile, extensionForMimeType, messageTypeForMimeType } = require('../media/media-storage');

const router = express.Router();

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.use(requireAuth);

router.param('id', (req, res, next, id) => {
  if (!UUID_PATTERN.test(id)) {
    return res.status(404).json({ error: 'Conversation not found' });
  }
  next();
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });
const MAX_SIZE_BY_MESSAGE_TYPE = {
  image: 16 * 1024 * 1024,
  audio: 16 * 1024 * 1024,
  video: 16 * 1024 * 1024,
  document: 100 * 1024 * 1024,
};

router.get('/queue', async (req, res) => {
  const conversations = await listWaitingConversations();
  res.json(conversations);
});

router.get('/mine', async (req, res) => {
  const conversations = await listConversationsByAgent(req.agent.agentId);
  res.json(conversations);
});

router.get('/contacts/:contactId/history', async (req, res) => {
  const conversations = await listClosedConversationsByContact(req.params.contactId);
  res.json(conversations);
});

router.get('/:id/messages', async (req, res) => {
  const conversation = await getConversationWithContact(req.params.id);
  if (!conversation) {
    return res.status(404).json({ error: 'Conversation not found' });
  }
  const messages = await listMessagesByConversation(req.params.id);
  res.json(messages);
});

router.post('/:id/claim', async (req, res) => {
  const conversation = await claimConversation(req.params.id, req.agent.agentId);
  if (!conversation) {
    return res.status(409).json({ error: 'Conversation already assigned or closed' });
  }
  const conversationWithContact = await getConversationWithContact(conversation.id);
  broadcast('queue:removed', { conversationId: conversation.id });
  emitToAgent(conversation.assignedAgentId, 'conversation:assigned', { conversation: conversationWithContact });
  res.json(conversation);
});

router.post('/:id/messages', upload.single('file'), async (req, res) => {
  const content = (req.body && req.body.content) || null;
  const file = req.file;
  if (!content && !file) {
    return res.status(400).json({ error: 'content or file is required' });
  }
  const conversation = await getConversationWithContact(req.params.id);
  if (!conversation) {
    return res.status(404).json({ error: 'Conversation not found' });
  }
  if (conversation.status === 'closed') {
    return res.status(409).json({ error: 'Conversation is closed' });
  }
  if (conversation.assignedAgentId !== req.agent.agentId) {
    return res.status(403).json({ error: 'Only the assigned agent can send messages on this conversation' });
  }

  const messagePayload = {
    conversationId: conversation.id,
    channelId: conversation.channelId,
    content,
  };

  if (file) {
    const messageType = messageTypeForMimeType(file.mimetype);
    const maxSize = MAX_SIZE_BY_MESSAGE_TYPE[messageType] || MAX_SIZE_BY_MESSAGE_TYPE.document;
    if (file.size > maxSize) {
      return res.status(400).json({ error: `File exceeds the ${Math.round(maxSize / (1024 * 1024))}MB limit for ${messageType}` });
    }
    if ((messageType === 'audio' || messageType === 'sticker') && content) {
      return res.status(400).json({ error: 'Audio and sticker messages cannot include a caption; send the text as a separate message' });
    }
    messagePayload.messageType = messageType;
    messagePayload.mediaPath = await saveMediaFile(file.buffer, extensionForMimeType(file.mimetype));
    messagePayload.mediaMimeType = file.mimetype;
    messagePayload.mediaFilename = file.originalname;
  }

  const message = await enqueueOutboundMessage(messagePayload);
  res.status(201).json(message);
});

// eslint-disable-next-line no-unused-vars
router.use('/:id/messages', (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: 'File exceeds the 100MB upload limit' });
  }
  next(err);
});

router.post('/:id/transfer', async (req, res) => {
  const { toAgentId } = req.body || {};
  if (!toAgentId) {
    return res.status(400).json({ error: 'toAgentId is required' });
  }
  const conversation = await transferConversation(req.params.id, req.agent.agentId, toAgentId);
  if (!conversation) {
    return res.status(409).json({ error: 'Conversation is not currently assigned to you, or is closed' });
  }
  const conversationWithContact = await getConversationWithContact(conversation.id);
  emitToAgent(req.agent.agentId, 'conversation:removed', { conversationId: conversation.id });
  emitToAgent(toAgentId, 'conversation:assigned', { conversation: conversationWithContact });
  res.json(conversation);
});

router.post('/:id/close', async (req, res) => {
  const conversation = await closeConversation(req.params.id, req.agent.agentId);
  if (!conversation) {
    return res.status(404).json({ error: 'Conversation not found' });
  }
  if (conversation.assignedAgentId) {
    emitToAgent(conversation.assignedAgentId, 'conversation:closed', { conversationId: conversation.id });
  } else {
    broadcast('queue:removed', { conversationId: conversation.id });
  }
  res.json(conversation);
});

module.exports = router;
