jest.mock('../metrics/metrics.repository');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const {
  getMetricsForAgent,
  getMetricsForAllAgents,
  getMetricsBySector,
  getMetricsByReason,
} = require('../metrics/metrics.repository');
const metricsRoutes = require('./metrics.routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/metrics', metricsRoutes);
  return app;
}

function tokenFor(agentId, role) {
  return jwt.sign({ agentId, role }, process.env.JWT_SECRET);
}

describe('GET /api/metrics', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns 400 when period is missing', async () => {
    const res = await request(buildApp())
      .get('/api/metrics')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);

    expect(res.status).toBe(400);
    expect(getMetricsForAgent).not.toHaveBeenCalled();
  });

  test('returns 400 for an invalid period', async () => {
    const res = await request(buildApp())
      .get('/api/metrics?period=lastyear')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);

    expect(res.status).toBe(400);
    expect(getMetricsForAgent).not.toHaveBeenCalled();
  });

  test('returns 400 for a prototype-polluting period value', async () => {
    const res = await request(buildApp())
      .get('/api/metrics?period=constructor')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);

    expect(res.status).toBe(400);
    expect(getMetricsForAgent).not.toHaveBeenCalled();
  });

  test('returns own metrics for a non-admin agent', async () => {
    getMetricsForAgent.mockResolvedValue({ closedCount: 3, avgResolutionMinutes: 12.5, avgFirstResponseMinutes: 4.2 });

    const res = await request(buildApp())
      .get('/api/metrics?period=today')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);

    expect(res.status).toBe(200);
    expect(getMetricsForAgent).toHaveBeenCalledWith('agent-1', expect.any(Date));
    expect(getMetricsForAllAgents).not.toHaveBeenCalled();
    expect(getMetricsBySector).not.toHaveBeenCalled();
    expect(getMetricsByReason).not.toHaveBeenCalled();
    expect(res.body).toEqual({
      period: 'today',
      scope: 'agent',
      own: { closedCount: 3, avgResolutionMinutes: 12.5, avgFirstResponseMinutes: 4.2 },
    });
  });

  test('returns the full team breakdown for an admin', async () => {
    getMetricsForAllAgents.mockResolvedValue([
      { agentId: 'a1', agentName: 'Ana', closedCount: 2, avgResolutionMinutes: 10, avgFirstResponseMinutes: 3 },
    ]);
    getMetricsBySector.mockResolvedValue([{ sectorId: 's1', sectorName: 'Financeiro', closedCount: 2 }]);
    getMetricsByReason.mockResolvedValue([{ reasonId: 'r1', reasonName: 'Troca de senha', closedCount: 2 }]);

    const res = await request(buildApp())
      .get('/api/metrics?period=7d')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);

    expect(res.status).toBe(200);
    expect(getMetricsForAgent).not.toHaveBeenCalled();
    expect(getMetricsForAllAgents).toHaveBeenCalledWith(expect.any(Date));
    expect(getMetricsBySector).toHaveBeenCalledWith(expect.any(Date));
    expect(res.body).toEqual({
      period: '7d',
      scope: 'admin',
      byAgent: [{ agentId: 'a1', agentName: 'Ana', closedCount: 2, avgResolutionMinutes: 10, avgFirstResponseMinutes: 3 }],
      bySector: [{ sectorId: 's1', sectorName: 'Financeiro', closedCount: 2 }],
      byReason: [{ reasonId: 'r1', reasonName: 'Troca de senha', closedCount: 2 }],
    });
  });

  test('accepts a custom period with a valid days value', async () => {
    getMetricsForAgent.mockResolvedValue({ closedCount: 0, avgResolutionMinutes: null, avgFirstResponseMinutes: null });

    const res = await request(buildApp())
      .get('/api/metrics?period=custom&days=45')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);

    expect(res.status).toBe(200);
    expect(res.body.period).toBe('custom');
    expect(getMetricsForAgent).toHaveBeenCalledWith('agent-1', expect.any(Date));
  });

  test('returns 400 for a custom period with no days value', async () => {
    const res = await request(buildApp())
      .get('/api/metrics?period=custom')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);

    expect(res.status).toBe(400);
    expect(getMetricsForAgent).not.toHaveBeenCalled();
  });

  test('returns 400 for a custom period with a non-integer days value', async () => {
    const res = await request(buildApp())
      .get('/api/metrics?period=custom&days=abc')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);

    expect(res.status).toBe(400);
    expect(getMetricsForAgent).not.toHaveBeenCalled();
  });

  test('returns 400 for a custom period with a zero or negative days value', async () => {
    const res = await request(buildApp())
      .get('/api/metrics?period=custom&days=0')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);

    expect(res.status).toBe(400);
    expect(getMetricsForAgent).not.toHaveBeenCalled();
  });

  test('returns 400 for a custom period with a days value over the 365 cap', async () => {
    const res = await request(buildApp())
      .get('/api/metrics?period=custom&days=366')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);

    expect(res.status).toBe(400);
    expect(getMetricsForAgent).not.toHaveBeenCalled();
  });

  test('accepts the 30d period', async () => {
    getMetricsForAgent.mockResolvedValue({ closedCount: 0, avgResolutionMinutes: null, avgFirstResponseMinutes: null });

    const res = await request(buildApp())
      .get('/api/metrics?period=30d')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);

    expect(res.status).toBe(200);
    expect(res.body.period).toBe('30d');
  });

  test('returns 401 without a token', async () => {
    const res = await request(buildApp()).get('/api/metrics?period=today');
    expect(res.status).toBe(401);
    expect(getMetricsForAgent).not.toHaveBeenCalled();
  });
});
