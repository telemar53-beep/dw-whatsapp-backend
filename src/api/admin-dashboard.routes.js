const express = require('express');
const { requireAuth, requireRole } = require('../auth/auth.middleware');
const {
  listInProgressConversations,
  listWaitingForAgentConversations,
  listInAutomationConversations,
  countClosedSince,
  listClosedSince,
  findConversationByProtocolNumber,
  listConversationsByContact,
} = require('../conversations/conversation.repository');
const { findContactByPhoneNumber } = require('../conversations/contact.repository');

const router = express.Router();

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const SINCE_WINDOW_MS = 24 * 60 * 60 * 1000;

function sinceNow() {
  return new Date(Date.now() - SINCE_WINDOW_MS);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Le um filtro opcional escrito como lista separada por virgula. Ausente ou
// vazio significa "sem filtro". Um valor que nao seja UUID e erro do cliente e
// precisa parar aqui: se descesse ate o Postgres viraria 22P02, ou seja, um 500
// para o que na verdade e um 400.
function parseUuidListParam(raw) {
  if (raw === undefined) return { ids: [] };
  const ids = String(raw)
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (ids.some((id) => !UUID_PATTERN.test(id))) return { invalid: true };
  return { ids: [...new Set(ids)] };
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
  const channel = parseUuidListParam(req.query.channelId);
  const agent = parseUuidListParam(req.query.agentId);
  const sector = parseUuidListParam(req.query.sectorId);
  if (channel.invalid || agent.invalid || sector.invalid) {
    return res.status(400).json({ error: 'channelId, agentId and sectorId must be comma-separated UUIDs' });
  }

  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const since = sinceNow();
  // O mesmo objeto vai para a pagina e para o total. E o que garante que o
  // numero devolvido descreve exatamente o recorte que foi listado.
  const filters = { channelIds: channel.ids, agentIds: agent.ids, sectorIds: sector.ids };
  const [items, total] = await Promise.all([
    listClosedSince(since, { limit, offset, filters }),
    countClosedSince(since, filters),
  ]);
  res.json({ items, hasMore: offset + items.length < total, total });
});

const PROTOCOL_NUMBER_PATTERN = /^(\d+|\d{8}-\d{4,})$/;

router.get('/conversations/by-protocol/:protocolNumber', requireAuth, requireRole('admin'), async (req, res) => {
  if (!PROTOCOL_NUMBER_PATTERN.test(req.params.protocolNumber)) {
    return res.status(400).json({ error: 'protocolNumber must be a valid protocol number' });
  }
  const conversation = await findConversationByProtocolNumber(req.params.protocolNumber);
  if (!conversation) {
    return res.status(404).json({ error: 'No conversation found with that protocol number' });
  }
  res.json(conversation);
});

router.get('/conversations/by-phone', requireAuth, requireRole('admin'), async (req, res) => {
  const phone = (req.query.phone || '').trim();
  if (!phone) {
    return res.status(400).json({ error: 'phone is required' });
  }
  const contact = await findContactByPhoneNumber(phone);
  if (!contact) {
    return res.status(404).json({ error: 'No contact found with that phone number' });
  }
  const conversations = await listConversationsByContact(contact.id);
  res.json({ contact, conversations });
});

module.exports = router;
