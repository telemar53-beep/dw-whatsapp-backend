const express = require('express');
const { requireAuth } = require('../auth/auth.middleware');
const {
  listWaitingConversations,
  listConversationsByAgent,
  getConversationWithContact,
  claimConversation,
} = require('../conversations/conversation.repository');
const { listMessagesByConversation } = require('../conversations/message.repository');
const { enqueueOutboundMessage } = require('../queue/outbound-queue');

const router = express.Router();

router.use(requireAuth);

router.get('/queue', async (req, res) => {
  const conversations = await listWaitingConversations();
  res.json(conversations);
});

router.get('/mine', async (req, res) => {
  const conversations = await listConversationsByAgent(req.agent.agentId);
  res.json(conversations);
});

router.get('/:id/messages', async (req, res) => {
  const conversation = await getConversationWithContact(req.params.id);
  if (!conversation) {
    return res.sendStatus(404);
  }
  const messages = await listMessagesByConversation(req.params.id);
  res.json(messages);
});

router.post('/:id/claim', async (req, res) => {
  const conversation = await claimConversation(req.params.id, req.agent.agentId);
  if (!conversation) {
    return res.status(409).json({ error: 'Conversation already assigned or closed' });
  }
  res.json(conversation);
});

router.post('/:id/messages', async (req, res) => {
  const { content } = req.body || {};
  if (!content) {
    return res.status(400).json({ error: 'content is required' });
  }
  const conversation = await getConversationWithContact(req.params.id);
  if (!conversation) {
    return res.sendStatus(404);
  }
  if (conversation.assignedAgentId !== req.agent.agentId) {
    return res.status(403).json({ error: 'Only the assigned agent can send messages on this conversation' });
  }
  const message = await enqueueOutboundMessage({
    conversationId: conversation.id,
    channelId: conversation.channelId,
    content,
  });
  res.status(201).json(message);
});

module.exports = router;
