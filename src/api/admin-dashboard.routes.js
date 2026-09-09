const express = require('express');
const { requireAuth, requireRole } = require('../auth/auth.middleware');
const {
  listInProgressConversations,
  listWaitingForAgentConversations,
  listInAutomationConversations,
  countClosedSince,
  listClosedSince,
} = require('../conversations/conversation.repository');

const router = express.Router();

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const SINCE_WINDOW_MS = 24 * 60 * 60 * 1000;

function sinceNow() {
  return new Date(Date.now() - SINCE_WINDOW_MS);
}

router.get('/conversations', requireAuth, requireRole('admin'), async (req, res) => {
  const [inProgress, waiting, inAutomation, closedTodayCount] = await Promise.all([
    listInProgressConversations(),
    listWaitingForAgentConversations(),
    listInAutomationConversations(),
    countClosedSince(sinceNow()),
  ]);
  res.json({ inProgress, waiting, inAutomation, closedTodayCount });
});

router.get('/conversations/closed-today', requireAuth, requireRole('admin'), async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const since = sinceNow();
  const [items, total] = await Promise.all([listClosedSince(since, { limit, offset }), countClosedSince(since)]);
  res.json({ items, hasMore: offset + items.length < total });
});

module.exports = router;
