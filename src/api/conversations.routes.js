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
  findOpenConversation,
  createConversation,
} = require('../conversations/conversation.repository');
const { listMessagesByConversation, findMessageById } = require('../conversations/message.repository');
const { enqueueOutboundMessage } = require('../queue/outbound-queue');
const { emitToAgent, broadcast, broadcastToDashboard } = require('../realtime/socket-server');
const { saveMediaFile, extensionForMimeType, messageTypeForMimeType } = require('../media/media-storage');
const { normalizeAudioForWhatsApp } = require('../media/audio-normalizer');
const { findOrCreateContactByPhoneNumber } = require('../conversations/contact.repository');
const { findChannelById } = require('../channels/channel.repository');
const baileysManager = require('../whatsapp-adapters/baileys.manager');
const { findTemplateById } = require('../templates/template.repository');
const { substituteVariables } = require('../templates/template-validator');

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

router.post('/start', async (req, res) => {
  const { channelId, phoneNumber } = req.body || {};
  if (!channelId || !phoneNumber) {
    return res.status(400).json({ error: 'channelId and phoneNumber are required' });
  }
  if (typeof phoneNumber !== 'string') {
    return res.status(400).json({ error: 'phoneNumber must be a string' });
  }

  let channel;
  try {
    channel = await findChannelById(channelId);
  } catch (err) {
    if (err.code === '22P02') {
      return res.status(404).json({ error: 'Channel not found' });
    }
    throw err;
  }
  if (!channel) {
    return res.status(404).json({ error: 'Channel not found' });
  }
  if (channel.type !== 'baileys' && channel.type !== 'meta_cloud') {
    return res.status(400).json({ error: 'Unsupported channel type' });
  }

  const normalizedPhoneNumber = phoneNumber.replace(/\D/g, '');
  if (!normalizedPhoneNumber) {
    return res.status(400).json({ error: 'A valid phoneNumber is required' });
  }

  let canonicalPhoneNumber;
  let outboundPayload;

  if (channel.type === 'baileys') {
    const { content } = req.body || {};
    if (!content) {
      return res.status(400).json({ error: 'content is required' });
    }
    if (channel.status !== 'connected') {
      return res.status(400).json({ error: 'This channel is not connected' });
    }
    canonicalPhoneNumber = await baileysManager.resolveWhatsAppJid(channel, normalizedPhoneNumber);
    if (!canonicalPhoneNumber) {
      return res.status(400).json({ error: 'This phone number is not on WhatsApp' });
    }
    outboundPayload = { content };
  } else {
    const { templateId, templateVariables } = req.body || {};
    if (!templateId) {
      return res.status(400).json({ error: 'templateId is required' });
    }
    const template = await findTemplateById(templateId);
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }
    if (template.status !== 'APPROVED') {
      return res.status(400).json({ error: 'This template is not approved' });
    }
    if (template.wabaId !== channel.config.wabaId) {
      return res.status(400).json({ error: "This template does not belong to this channel's WABA" });
    }
    const variables = Array.isArray(templateVariables) ? templateVariables : [];
    if (variables.length !== template.variableCount) {
      return res.status(400).json({ error: `This template requires exactly ${template.variableCount} variable(s)` });
    }
    if (variables.some((v) => typeof v !== 'string' || !v.trim())) {
      return res.status(400).json({ error: 'Each template variable must be a non-empty string' });
    }
    canonicalPhoneNumber = normalizedPhoneNumber;
    outboundPayload = {
      content: substituteVariables(template.bodyText, variables),
      templateName: template.name,
      templateLanguage: template.language,
      templateVariables: variables,
    };
  }

  const contact = await findOrCreateContactByPhoneNumber(canonicalPhoneNumber, null);
  if (channel.type === 'baileys' && contact.wasCreated) {
    baileysManager.fetchContactAvatarForChannel(channel, contact.id, canonicalPhoneNumber).catch((err) => {
      console.error(`Could not fetch profile photo for contact ${contact.id}`, err);
    });
  }

  const existing = await findOpenConversation(contact.id, channel.id);
  let claimed;
  if (existing && existing.status !== 'silent') {
    return res.status(409).json({ error: 'There is already an open conversation with this contact on this channel' });
  } else if (existing) {
    // A dormant conversation the SGP integration created (never replied to) blocks nothing —
    // adopt it instead of creating a duplicate, so it becomes assignable/closable like any other.
    claimed = await claimConversation(existing.id, req.agent.agentId);
    if (!claimed) {
      return res.status(409).json({ error: 'There is already an open conversation with this contact on this channel' });
    }
  } else {
    const conversation = await createConversation(contact.id, channel.id);
    claimed = await claimConversation(conversation.id, req.agent.agentId);
    if (!claimed) {
      throw new Error('Failed to claim newly created conversation');
    }
  }
  await enqueueOutboundMessage({ conversationId: claimed.id, channelId: channel.id, ...outboundPayload });

  const conversationWithContact = await getConversationWithContact(claimed.id);
  emitToAgent(req.agent.agentId, 'conversation:assigned', { conversation: conversationWithContact });

  res.status(201).json(conversationWithContact);
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
  broadcastToDashboard('dashboard:conversation', { conversation: conversationWithContact });
  res.json(conversation);
});

router.post('/:id/messages', upload.single('file'), async (req, res) => {
  const content = (req.body && req.body.content) || null;
  const file = req.file;
  const repliedToMessageId = (req.body && req.body.repliedToMessageId) || null;
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

  let repliedTo = null;
  if (repliedToMessageId) {
    repliedTo = await findMessageById(repliedToMessageId);
    if (!repliedTo || repliedTo.conversationId !== conversation.id) {
      return res.status(400).json({ error: 'repliedToMessageId does not belong to this conversation' });
    }
    if (!repliedTo.content) {
      return res.status(400).json({ error: 'Only messages with text can be replied to' });
    }
    if (!repliedTo.whatsappMessageId) {
      return res.status(400).json({ error: 'This message has not been delivered yet; wait before replying to it' });
    }
  }

  const messagePayload = {
    conversationId: conversation.id,
    channelId: conversation.channelId,
    content,
  };
  if (repliedToMessageId) {
    messagePayload.repliedToMessageId = repliedToMessageId;
  }

  if (file) {
    const messageType = messageTypeForMimeType(file.mimetype);
    const maxSize = MAX_SIZE_BY_MESSAGE_TYPE[messageType] || MAX_SIZE_BY_MESSAGE_TYPE.document;
    if (file.size > maxSize) {
      return res.status(400).json({ error: `File exceeds the ${Math.round(maxSize / (1024 * 1024))}MB limit for ${messageType}` });
    }
    if ((messageType === 'audio' || messageType === 'sticker') && content) {
      return res.status(400).json({ error: 'Audio and sticker messages cannot include a caption; send the text as a separate message' });
    }
    let buffer = file.buffer;
    let mimeType = file.mimetype;
    let filename = file.originalname;
    if (messageType === 'audio') {
      // Browsers record in whatever container they support (WebM on Chrome and Edge),
      // and WhatsApp silently drops anything it cannot decode. Normalize here, at the
      // single point where audio enters the system, so every adapter gets a valid file.
      try {
        const normalized = await normalizeAudioForWhatsApp(file.buffer, file.mimetype);
        console.log(
          `Audio upload: received ${file.mimetype} (${file.buffer.length} bytes) -> ` +
            `${normalized.mimeType} (${normalized.buffer.length} bytes), converted=${normalized.converted}`
        );
        buffer = normalized.buffer;
        mimeType = normalized.mimeType;
        if (normalized.converted && filename) {
          filename = `${filename.replace(/\.[^.]*$/, '')}.ogg`;
        }
      } catch (err) {
        return res.status(400).json({ error: 'Could not convert this audio to a format WhatsApp accepts' });
      }
    }
    // Only the browser knows whether this came from the microphone button or from the
    // attachment picker, and that decides whether WhatsApp should treat it as a voice note.
    if (messageType === 'audio' && req.body && req.body.voiceNote === 'true') {
      messagePayload.isVoiceNote = true;
    }
    messagePayload.messageType = messageType;
    messagePayload.mediaPath = await saveMediaFile(buffer, extensionForMimeType(mimeType));
    messagePayload.mediaMimeType = mimeType;
    messagePayload.mediaFilename = filename;
  }

  const message = await enqueueOutboundMessage(messagePayload);
  const response = repliedTo
    ? { ...message, repliedToPreview: { content: repliedTo.content, direction: repliedTo.direction } }
    : message;
  res.status(201).json(response);
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
  broadcast('queue:removed', { conversationId: conversation.id });
  emitToAgent(toAgentId, 'conversation:assigned', { conversation: conversationWithContact });
  broadcastToDashboard('dashboard:conversation', { conversation: conversationWithContact });
  res.json(conversation);
});

router.post('/:id/close', async (req, res) => {
  const conversation = await closeConversation(req.params.id, req.agent.agentId);
  if (!conversation) {
    return res.status(409).json({ error: 'Conversation is not currently assigned to you, or is closed' });
  }
  if (conversation.assignedAgentId) {
    emitToAgent(conversation.assignedAgentId, 'conversation:closed', { conversationId: conversation.id });
  } else {
    broadcast('queue:removed', { conversationId: conversation.id });
  }
  const conversationWithContact = await getConversationWithContact(conversation.id);
  broadcastToDashboard('dashboard:conversation', { conversation: conversationWithContact, closedAt: new Date().toISOString() });
  res.json(conversation);
});

module.exports = router;
