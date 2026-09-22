jest.mock('../conversations/conversation.repository');
jest.mock('../conversations/contact.repository');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
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
const adminDashboardRoutes = require('./admin-dashboard.routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/dashboard', adminDashboardRoutes);
  return app;
}

function tokenFor(agentId, role) {
  return jwt.sign({ agentId, role }, process.env.JWT_SECRET);
}

describe('GET /api/admin/dashboard/conversations', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns the 3 live groups plus the closed-today count for an admin', async () => {
    listInProgressConversations.mockResolvedValue([{ id: 'conv-1', status: 'assigned' }]);
    listWaitingForAgentConversations.mockResolvedValue([{ id: 'conv-2', status: 'waiting' }]);
    listInAutomationConversations.mockResolvedValue([{ id: 'conv-3', triageState: 'pending' }]);
    countClosedSince.mockResolvedValue(5);

    const res = await request(buildApp())
      .get('/api/admin/dashboard/conversations')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      inProgress: [{ id: 'conv-1', status: 'assigned' }],
      waiting: [{ id: 'conv-2', status: 'waiting' }],
      inAutomation: [{ id: 'conv-3', triageState: 'pending' }],
      closedTodayCount: 5,
    });
  });

  test('the closed-today count stays unfiltered: filters belong to the closed-today listing only', async () => {
    listInProgressConversations.mockResolvedValue([]);
    listWaitingForAgentConversations.mockResolvedValue([]);
    listInAutomationConversations.mockResolvedValue([]);
    countClosedSince.mockResolvedValue(5);

    await request(buildApp())
      .get('/api/admin/dashboard/conversations?channelId=11111111-1111-4111-8111-111111111111')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);

    expect(countClosedSince).toHaveBeenCalledWith(expect.any(Date));
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .get('/api/admin/dashboard/conversations')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(403);
  });

  test('returns 401 without a token', async () => {
    const res = await request(buildApp()).get('/api/admin/dashboard/conversations');
    expect(res.status).toBe(401);
  });
});

const SEM_FILTRO = { channelIds: [], agentIds: [], sectorIds: [] };
const UUID_1 = '11111111-1111-4111-8111-111111111111';
const UUID_2 = '22222222-2222-4222-8222-222222222222';
const UUID_3 = '33333333-3333-4333-8333-333333333333';

describe('GET /api/admin/dashboard/conversations/closed-today', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns a page of closed conversations with hasMore true when more remain', async () => {
    listClosedSince.mockResolvedValue([{ id: 'conv-1', closedAt: '2026-09-09T10:00:00.000Z' }]);
    countClosedSince.mockResolvedValue(3);

    const res = await request(buildApp())
      .get('/api/admin/dashboard/conversations/closed-today?limit=1&offset=0')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [{ id: 'conv-1', closedAt: '2026-09-09T10:00:00.000Z' }], hasMore: true, total: 3 });
    expect(listClosedSince).toHaveBeenCalledWith(expect.any(Date), { limit: 1, offset: 0, filters: SEM_FILTRO });
  });

  test('returns hasMore false when the page reaches the end', async () => {
    listClosedSince.mockResolvedValue([{ id: 'conv-1' }]);
    countClosedSince.mockResolvedValue(1);

    const res = await request(buildApp())
      .get('/api/admin/dashboard/conversations/closed-today?limit=20&offset=0')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);

    expect(res.body.hasMore).toBe(false);
  });

  test('defaults limit to 20 and caps it at 50', async () => {
    listClosedSince.mockResolvedValue([]);
    countClosedSince.mockResolvedValue(0);

    await request(buildApp())
      .get('/api/admin/dashboard/conversations/closed-today')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);
    expect(listClosedSince).toHaveBeenCalledWith(expect.any(Date), { limit: 20, offset: 0, filters: SEM_FILTRO });

    jest.clearAllMocks();
    listClosedSince.mockResolvedValue([]);
    countClosedSince.mockResolvedValue(0);
    await request(buildApp())
      .get('/api/admin/dashboard/conversations/closed-today?limit=999')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);
    expect(listClosedSince).toHaveBeenCalledWith(expect.any(Date), { limit: 50, offset: 0, filters: SEM_FILTRO });
  });

  test('clamps negative limit to a positive minimum', async () => {
    listClosedSince.mockResolvedValue([]);
    countClosedSince.mockResolvedValue(0);

    await request(buildApp())
      .get('/api/admin/dashboard/conversations/closed-today?limit=-5')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);
    expect(listClosedSince).toHaveBeenCalledWith(expect.any(Date), { limit: 1, offset: 0, filters: SEM_FILTRO });
  });

  test('exposes the filtered total alongside the page', async () => {
    listClosedSince.mockResolvedValue([{ id: 'conv-1' }]);
    countClosedSince.mockResolvedValue(7);

    const res = await request(buildApp())
      .get('/api/admin/dashboard/conversations/closed-today?limit=1')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);

    expect(res.body.total).toBe(7);
  });

  test('passes channel, agent and sector filters to both the page and the total', async () => {
    listClosedSince.mockResolvedValue([]);
    countClosedSince.mockResolvedValue(0);

    await request(buildApp())
      .get(`/api/admin/dashboard/conversations/closed-today?channelId=${UUID_1}&agentId=${UUID_2}&sectorId=${UUID_3}`)
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);

    const esperado = { channelIds: [UUID_1], agentIds: [UUID_2], sectorIds: [UUID_3] };
    expect(listClosedSince).toHaveBeenCalledWith(expect.any(Date), { limit: 20, offset: 0, filters: esperado });
    expect(countClosedSince).toHaveBeenCalledWith(expect.any(Date), esperado);
  });

  test('the page and the total always receive the very same filter object', async () => {
    listClosedSince.mockResolvedValue([]);
    countClosedSince.mockResolvedValue(0);

    await request(buildApp())
      .get(`/api/admin/dashboard/conversations/closed-today?channelId=${UUID_1}`)
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);

    expect(listClosedSince.mock.calls[0][1].filters).toBe(countClosedSince.mock.calls[0][1]);
  });

  test('accepts several comma-separated uuids and drops duplicates', async () => {
    listClosedSince.mockResolvedValue([]);
    countClosedSince.mockResolvedValue(0);

    await request(buildApp())
      .get(`/api/admin/dashboard/conversations/closed-today?channelId=${UUID_1},${UUID_2},${UUID_1}`)
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);

    expect(countClosedSince).toHaveBeenCalledWith(expect.any(Date), {
      channelIds: [UUID_1, UUID_2],
      agentIds: [],
      sectorIds: [],
    });
  });

  test('treats an empty filter param as no filter at all', async () => {
    listClosedSince.mockResolvedValue([]);
    countClosedSince.mockResolvedValue(0);

    await request(buildApp())
      .get('/api/admin/dashboard/conversations/closed-today?channelId=&sectorId=,,')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);

    expect(countClosedSince).toHaveBeenCalledWith(expect.any(Date), SEM_FILTRO);
  });

  test('returns 400 for a filter value that is not a uuid, without touching the database', async () => {
    for (const query of ['channelId=nao-e-uuid', `agentId=${UUID_1},nao-e-uuid`, 'sectorId=123']) {
      jest.clearAllMocks();
      const res = await request(buildApp())
        .get(`/api/admin/dashboard/conversations/closed-today?${query}`)
        .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);

      expect(res.status).toBe(400);
      expect(listClosedSince).not.toHaveBeenCalled();
      expect(countClosedSince).not.toHaveBeenCalled();
    }
  });

  test('keeps paginating inside the filtered slice', async () => {
    listClosedSince.mockResolvedValue([{ id: 'conv-2' }]);
    countClosedSince.mockResolvedValue(5);

    const res = await request(buildApp())
      .get(`/api/admin/dashboard/conversations/closed-today?channelId=${UUID_1}&limit=1&offset=3`)
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);

    expect(listClosedSince).toHaveBeenCalledWith(expect.any(Date), {
      limit: 1,
      offset: 3,
      filters: { channelIds: [UUID_1], agentIds: [], sectorIds: [] },
    });
    expect(res.body).toEqual({ items: [{ id: 'conv-2' }], hasMore: true, total: 5 });
  });

  test('reports an empty filtered page honestly', async () => {
    listClosedSince.mockResolvedValue([]);
    countClosedSince.mockResolvedValue(0);

    const res = await request(buildApp())
      .get(`/api/admin/dashboard/conversations/closed-today?sectorId=${UUID_3}`)
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);

    expect(res.body).toEqual({ items: [], hasMore: false, total: 0 });
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .get('/api/admin/dashboard/conversations/closed-today')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(403);
  });
});

describe('GET /api/admin/dashboard/conversations/by-protocol/:protocolNumber', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns the conversation with that protocol number (legacy plain-integer format)', async () => {
    findConversationByProtocolNumber.mockResolvedValue({ id: 'conv-1', protocolNumber: '1042' });

    const res = await request(buildApp())
      .get('/api/admin/dashboard/conversations/by-protocol/1042')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);

    expect(res.status).toBe(200);
    expect(findConversationByProtocolNumber).toHaveBeenCalledWith('1042');
    expect(res.body).toEqual({ id: 'conv-1', protocolNumber: '1042' });
  });

  test('returns the conversation with that protocol number (new AAAAMMDD-XXXX format)', async () => {
    findConversationByProtocolNumber.mockResolvedValue({ id: 'conv-2', protocolNumber: '20260911-0001' });

    const res = await request(buildApp())
      .get('/api/admin/dashboard/conversations/by-protocol/20260911-0001')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);

    expect(res.status).toBe(200);
    expect(findConversationByProtocolNumber).toHaveBeenCalledWith('20260911-0001');
    expect(res.body).toEqual({ id: 'conv-2', protocolNumber: '20260911-0001' });
  });

  test('returns 404 when no conversation has that protocol number', async () => {
    findConversationByProtocolNumber.mockResolvedValue(null);

    const res = await request(buildApp())
      .get('/api/admin/dashboard/conversations/by-protocol/999999')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);

    expect(res.status).toBe(404);
  });

  test('returns 400 for a value matching neither protocol format', async () => {
    const res = await request(buildApp())
      .get('/api/admin/dashboard/conversations/by-protocol/not-a-number')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);

    expect(res.status).toBe(400);
    expect(findConversationByProtocolNumber).not.toHaveBeenCalled();
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .get('/api/admin/dashboard/conversations/by-protocol/1042')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(403);
  });
});

describe('GET /api/admin/dashboard/conversations/by-phone', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns the contact and every conversation they have had', async () => {
    findContactByPhoneNumber.mockResolvedValue({ id: 'contact-1', phoneNumber: '+5511999990000', displayName: 'Maria' });
    listConversationsByContact.mockResolvedValue([{ id: 'conv-1', status: 'closed' }, { id: 'conv-2', status: 'waiting' }]);

    const res = await request(buildApp())
      .get('/api/admin/dashboard/conversations/by-phone?phone=%2B5511999990000')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);

    expect(res.status).toBe(200);
    expect(findContactByPhoneNumber).toHaveBeenCalledWith('+5511999990000');
    expect(listConversationsByContact).toHaveBeenCalledWith('contact-1');
    expect(res.body).toEqual({
      contact: { id: 'contact-1', phoneNumber: '+5511999990000', displayName: 'Maria' },
      conversations: [{ id: 'conv-1', status: 'closed' }, { id: 'conv-2', status: 'waiting' }],
    });
  });

  test('returns 404 when no contact has that phone number', async () => {
    findContactByPhoneNumber.mockResolvedValue(null);

    const res = await request(buildApp())
      .get('/api/admin/dashboard/conversations/by-phone?phone=%2B5511900000000')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);

    expect(res.status).toBe(404);
    expect(listConversationsByContact).not.toHaveBeenCalled();
  });

  test('returns 400 when phone is missing', async () => {
    const res = await request(buildApp())
      .get('/api/admin/dashboard/conversations/by-phone')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);

    expect(res.status).toBe(400);
    expect(findContactByPhoneNumber).not.toHaveBeenCalled();
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .get('/api/admin/dashboard/conversations/by-phone?phone=%2B5511999990000')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(403);
  });
});
