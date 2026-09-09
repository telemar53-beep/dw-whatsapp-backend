jest.mock('../conversations/conversation.repository');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const {
  listInProgressConversations,
  listWaitingForAgentConversations,
  listInAutomationConversations,
  countClosedSince,
  listClosedSince,
} = require('../conversations/conversation.repository');
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

describe('GET /api/admin/dashboard/conversations/closed-today', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns a page of closed conversations with hasMore true when more remain', async () => {
    listClosedSince.mockResolvedValue([{ id: 'conv-1', closedAt: '2026-09-09T10:00:00.000Z' }]);
    countClosedSince.mockResolvedValue(3);

    const res = await request(buildApp())
      .get('/api/admin/dashboard/conversations/closed-today?limit=1&offset=0')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [{ id: 'conv-1', closedAt: '2026-09-09T10:00:00.000Z' }], hasMore: true });
    expect(listClosedSince).toHaveBeenCalledWith(expect.any(Date), { limit: 1, offset: 0 });
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
    expect(listClosedSince).toHaveBeenCalledWith(expect.any(Date), { limit: 20, offset: 0 });

    jest.clearAllMocks();
    listClosedSince.mockResolvedValue([]);
    countClosedSince.mockResolvedValue(0);
    await request(buildApp())
      .get('/api/admin/dashboard/conversations/closed-today?limit=999')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);
    expect(listClosedSince).toHaveBeenCalledWith(expect.any(Date), { limit: 50, offset: 0 });
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .get('/api/admin/dashboard/conversations/closed-today')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(403);
  });
});
