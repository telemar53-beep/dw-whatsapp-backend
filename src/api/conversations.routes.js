const express = require('express');
const { requireAuth } = require('../auth/auth.middleware');
const {
  listWaitingConversations,
  listConversationsByAgent,
  getConversationWithContact,
} = require('../conversations/conversation.repository');
const { listMessagesByConversation } = require('../conversations/message.repository');

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

module.exports = router;
