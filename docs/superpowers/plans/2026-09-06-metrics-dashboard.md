# Dashboard de métricas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every attendant a "Métricas" page showing their own productivity numbers (closed conversations, average resolution time, average first-response time) over a fixed period, and give admins the same numbers broken down per attendant and per sector — all computed live from existing data, no new tables.

**Architecture:** A read-only aggregation repository (`src/metrics/metrics.repository.js`) runs three SQL queries against the existing `conversations`/`conversation_events`/`messages`/`agent_sectors`/`sectors` tables. A single route, `GET /api/metrics?period=...`, decides server-side (from the JWT role) whether to return the caller's own numbers or the full team breakdown — the frontend never decides what to hide. The frontend adds one new page (`/metrics`, reachable by any authenticated agent) with fixed-period buttons and Recharts bar charts.

**Tech Stack:** Node.js/Express, Jest + Supertest (backend), React 18 + Vitest + Testing Library (frontend), **Recharts** (new frontend dependency — this project's first charting library).

**Spec:** [docs/superpowers/specs/2026-09-06-metrics-dashboard-design.md](../specs/2026-09-06-metrics-dashboard-design.md)

## Global Constraints

- No new database tables or columns — every metric is computed live from `conversations`, `conversation_events`, `messages`, `agent_sectors`, `sectors`.
- "Atendimentos por atendente" and "atendimentos por setor" count `conversation_events` rows with `event_type = 'closed'`, grouped by `from_agent_id` (the agent who actually closed it) — never `conversations.assigned_agent_id`, which reflects only the current state and can have changed via a later transfer.
- "Tempo médio de atendimento" = average of (`conversation_events.created_at` for the `'closed'` event) minus `conversations.created_at`, in minutes.
- "Tempo médio de primeira resposta" = average of (earliest `messages.created_at` where `direction = 'outbound'` in that conversation) minus `conversations.created_at`, in minutes — a conversation with no outbound message is excluded from this specific average (but still counts toward the closed-conversation count).
- An agent who belongs to multiple sectors has every one of their closed conversations counted toward **each** sector they belong to — the sum across sectors can exceed the total closed-conversation count. This is expected, not a bug.
- Period is one of exactly three fixed values: `today` (last 24 hours), `7d` (last 7×24 hours), `30d` (last 30×24 hours) — no custom date range in this delivery. Period-to-timestamp conversion happens in the route layer; the repository functions take a plain `since` timestamp and know nothing about period names.
- `GET /api/metrics` is `requireAuth` only (no `requireRole('admin')`) — every authenticated agent can call it, but the **server** decides the response shape from `req.agent.role`, never the frontend.
- Postgres returns `COUNT`/`AVG` as strings via node-pg (no custom type parser is configured in this project) — the repository must convert every numeric field to a real JS `number` (or `null`) before returning it, never leave a numeric string in a response.

---

### Task 1: Backend — `metrics.repository.js` (three aggregation queries)

**Files:**
- Create: `src/metrics/metrics.repository.js`
- Test: `src/metrics/metrics.repository.test.js`

**Interfaces:**
- Produces: `getMetricsForAgent(agentId, since)` → `Promise<{closedCount, avgResolutionMinutes, avgFirstResponseMinutes}>` (numbers or `null` for the two averages when there's no data to average). `getMetricsForAllAgents(since)` → `Promise<[{agentId, agentName, closedCount, avgResolutionMinutes, avgFirstResponseMinutes}]>`, one entry per agent with at least one closed conversation in the period, ordered by `agentName` ascending. `getMetricsBySector(since)` → `Promise<[{sectorId, sectorName, closedCount}]>`, ordered by `sectorName` ascending. Task 2's route calls all three exactly.

- [ ] **Step 1: Write the failing test**

Create `src/metrics/metrics.repository.test.js`:

```js
const { getPool, closePool } = require('../db/pool');
const { createAgent } = require('../agents/agent.repository');
const { createSector, setAgentSectors } = require('../sectors/sector.repository');
const { getMetricsForAgent, getMetricsForAllAgents, getMetricsBySector } = require('./metrics.repository');

let contactCounter = 0;

async function seedChannel() {
  const result = await getPool().query(
    `INSERT INTO channels (type, name, phone_number, config) VALUES ('baileys', 'Canal de Teste', $1, '{}') RETURNING id`,
    [`+55119${Date.now()}${Math.floor(Math.random() * 1000)}`]
  );
  return result.rows[0].id;
}

async function seedContact() {
  contactCounter += 1;
  const result = await getPool().query('INSERT INTO contacts (phone_number) VALUES ($1) RETURNING id', [
    `5511900${String(contactCounter).padStart(6, '0')}`,
  ]);
  return result.rows[0].id;
}

async function seedClosedConversation({ channelId, contactId, agentId, startedAt, closedAt, firstResponseAt }) {
  const conv = await getPool().query(
    `INSERT INTO conversations (contact_id, channel_id, status, assigned_agent_id, created_at, updated_at)
     VALUES ($1, $2, 'closed', $3, $4, $4) RETURNING id`,
    [contactId, channelId, agentId, startedAt]
  );
  const conversationId = conv.rows[0].id;
  await getPool().query(
    `INSERT INTO conversation_events (conversation_id, event_type, from_agent_id, created_at)
     VALUES ($1, 'closed', $2, $3)`,
    [conversationId, agentId, closedAt]
  );
  if (firstResponseAt) {
    await getPool().query(
      `INSERT INTO messages (conversation_id, direction, content, created_at)
       VALUES ($1, 'outbound', 'Resposta de teste', $2)`,
      [conversationId, firstResponseAt]
    );
  }
  return conversationId;
}

describe('metrics repository', () => {
  beforeEach(async () => {
    await getPool().query(
      'TRUNCATE messages, conversation_events, conversations, contacts, channels, agent_sectors, sectors, agents CASCADE'
    );
    contactCounter = 0;
  });

  afterAll(async () => {
    await closePool();
  });

  const SINCE = new Date('2026-01-02T00:00:00Z');
  const BEFORE_SINCE = new Date('2026-01-01T09:00:00Z');

  test('getMetricsForAgent averages resolution and first-response time, ignoring conversations with no response for the first-response average', async () => {
    const agent = await createAgent({ email: 'metrics-agent1@dw.com', password: 'secret123', role: 'agent' });
    const channelId = await seedChannel();
    const contactA = await seedContact();
    const contactB = await seedContact();

    await seedClosedConversation({
      channelId,
      contactId: contactA,
      agentId: agent.id,
      startedAt: new Date('2026-01-02T10:00:00Z'),
      closedAt: new Date('2026-01-02T10:30:00Z'),
      firstResponseAt: new Date('2026-01-02T10:05:00Z'),
    });
    await seedClosedConversation({
      channelId,
      contactId: contactB,
      agentId: agent.id,
      startedAt: new Date('2026-01-02T11:00:00Z'),
      closedAt: new Date('2026-01-02T11:20:00Z'),
      firstResponseAt: null,
    });

    const metrics = await getMetricsForAgent(agent.id, SINCE);

    expect(metrics.closedCount).toBe(2);
    expect(metrics.avgResolutionMinutes).toBe(25);
    expect(metrics.avgFirstResponseMinutes).toBe(5);
  });

  test('getMetricsForAgent excludes conversations closed before the since timestamp', async () => {
    const agent = await createAgent({ email: 'metrics-agent2@dw.com', password: 'secret123', role: 'agent' });
    const channelId = await seedChannel();
    const contactId = await seedContact();

    await seedClosedConversation({
      channelId,
      contactId,
      agentId: agent.id,
      startedAt: BEFORE_SINCE,
      closedAt: new Date('2026-01-01T09:15:00Z'),
      firstResponseAt: new Date('2026-01-01T09:05:00Z'),
    });

    const metrics = await getMetricsForAgent(agent.id, SINCE);

    expect(metrics.closedCount).toBe(0);
    expect(metrics.avgResolutionMinutes).toBeNull();
    expect(metrics.avgFirstResponseMinutes).toBeNull();
  });

  test('getMetricsForAgent returns zero/null for an agent with no closed conversations', async () => {
    const agent = await createAgent({ email: 'metrics-agent3@dw.com', password: 'secret123', role: 'agent' });

    const metrics = await getMetricsForAgent(agent.id, SINCE);

    expect(metrics).toEqual({ closedCount: 0, avgResolutionMinutes: null, avgFirstResponseMinutes: null });
  });

  test('getMetricsForAllAgents returns one entry per agent with at least one closed conversation, ordered by name', async () => {
    const zeta = await createAgent({ name: 'Zeta', email: 'metrics-zeta@dw.com', password: 'secret123', role: 'agent' });
    const alpha = await createAgent({ name: 'Alpha', email: 'metrics-alpha@dw.com', password: 'secret123', role: 'agent' });
    const noConversations = await createAgent({ name: 'Semconversa', email: 'metrics-none@dw.com', password: 'secret123', role: 'agent' });
    const channelId = await seedChannel();

    await seedClosedConversation({
      channelId,
      contactId: await seedContact(),
      agentId: zeta.id,
      startedAt: new Date('2026-01-02T10:00:00Z'),
      closedAt: new Date('2026-01-02T10:30:00Z'),
      firstResponseAt: new Date('2026-01-02T10:05:00Z'),
    });
    await seedClosedConversation({
      channelId,
      contactId: await seedContact(),
      agentId: alpha.id,
      startedAt: new Date('2026-01-02T11:00:00Z'),
      closedAt: new Date('2026-01-02T11:10:00Z'),
      firstResponseAt: new Date('2026-01-02T11:02:00Z'),
    });

    const metrics = await getMetricsForAllAgents(SINCE);

    expect(metrics.map((m) => m.agentName)).toEqual(['Alpha', 'Zeta']);
    expect(metrics.find((m) => m.agentId === alpha.id).closedCount).toBe(1);
    expect(metrics.find((m) => m.agentId === zeta.id).closedCount).toBe(1);
    expect(metrics.some((m) => m.agentId === noConversations.id)).toBe(false);
  });

  test('getMetricsBySector counts a closed conversation toward every sector the closing agent belongs to', async () => {
    const agent = await createAgent({ email: 'metrics-multisector@dw.com', password: 'secret123', role: 'agent' });
    const financeiro = await createSector({ name: 'Financeiro' });
    const comercial = await createSector({ name: 'Comercial' });
    await setAgentSectors(agent.id, [financeiro.id, comercial.id]);
    const channelId = await seedChannel();

    await seedClosedConversation({
      channelId,
      contactId: await seedContact(),
      agentId: agent.id,
      startedAt: new Date('2026-01-02T10:00:00Z'),
      closedAt: new Date('2026-01-02T10:30:00Z'),
      firstResponseAt: new Date('2026-01-02T10:05:00Z'),
    });

    const metrics = await getMetricsBySector(SINCE);

    expect(metrics.map((m) => m.sectorName).sort()).toEqual(['Comercial', 'Financeiro']);
    expect(metrics.every((m) => m.closedCount === 1)).toBe(true);
  });

  test('getMetricsBySector omits an agent who belongs to no sector', async () => {
    const agent = await createAgent({ email: 'metrics-nosector@dw.com', password: 'secret123', role: 'agent' });
    const channelId = await seedChannel();

    await seedClosedConversation({
      channelId,
      contactId: await seedContact(),
      agentId: agent.id,
      startedAt: new Date('2026-01-02T10:00:00Z'),
      closedAt: new Date('2026-01-02T10:30:00Z'),
      firstResponseAt: new Date('2026-01-02T10:05:00Z'),
    });

    const metrics = await getMetricsBySector(SINCE);

    expect(metrics).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/metrics/metrics.repository.test.js`
Expected: FAIL — `Cannot find module './metrics.repository'`.

- [ ] **Step 3: Write the repository**

Create `src/metrics/metrics.repository.js`:

```js
const { getPool } = require('../db/pool');

function toNumberOrNull(value) {
  return value === null ? null : Math.round(Number(value) * 10) / 10;
}

async function getMetricsForAgent(agentId, since) {
  const result = await getPool().query(
    `WITH closed AS (
       SELECT ce.conversation_id, ce.created_at AS closed_at, c.created_at AS started_at
       FROM conversation_events ce
       JOIN conversations c ON c.id = ce.conversation_id
       WHERE ce.event_type = 'closed' AND ce.from_agent_id = $1 AND ce.created_at >= $2
     ),
     first_response AS (
       SELECT m.conversation_id, MIN(m.created_at) AS first_response_at
       FROM messages m
       WHERE m.direction = 'outbound' AND m.conversation_id IN (SELECT conversation_id FROM closed)
       GROUP BY m.conversation_id
     )
     SELECT
       COUNT(*)::int AS closed_count,
       AVG(EXTRACT(EPOCH FROM (closed.closed_at - closed.started_at)) / 60) AS avg_resolution_minutes,
       AVG(EXTRACT(EPOCH FROM (first_response.first_response_at - closed.started_at)) / 60) AS avg_first_response_minutes
     FROM closed
     LEFT JOIN first_response ON first_response.conversation_id = closed.conversation_id`,
    [agentId, since]
  );
  const row = result.rows[0];
  return {
    closedCount: Number(row.closed_count),
    avgResolutionMinutes: toNumberOrNull(row.avg_resolution_minutes),
    avgFirstResponseMinutes: toNumberOrNull(row.avg_first_response_minutes),
  };
}

async function getMetricsForAllAgents(since) {
  const result = await getPool().query(
    `WITH closed AS (
       SELECT ce.conversation_id, ce.from_agent_id AS agent_id, ce.created_at AS closed_at, c.created_at AS started_at
       FROM conversation_events ce
       JOIN conversations c ON c.id = ce.conversation_id
       WHERE ce.event_type = 'closed' AND ce.from_agent_id IS NOT NULL AND ce.created_at >= $1
     ),
     first_response AS (
       SELECT m.conversation_id, MIN(m.created_at) AS first_response_at
       FROM messages m
       WHERE m.direction = 'outbound' AND m.conversation_id IN (SELECT conversation_id FROM closed)
       GROUP BY m.conversation_id
     )
     SELECT
       closed.agent_id,
       a.name AS agent_name,
       COUNT(*)::int AS closed_count,
       AVG(EXTRACT(EPOCH FROM (closed.closed_at - closed.started_at)) / 60) AS avg_resolution_minutes,
       AVG(EXTRACT(EPOCH FROM (first_response.first_response_at - closed.started_at)) / 60) AS avg_first_response_minutes
     FROM closed
     JOIN agents a ON a.id = closed.agent_id
     LEFT JOIN first_response ON first_response.conversation_id = closed.conversation_id
     GROUP BY closed.agent_id, a.name
     ORDER BY a.name ASC`,
    [since]
  );
  return result.rows.map((row) => ({
    agentId: row.agent_id,
    agentName: row.agent_name,
    closedCount: Number(row.closed_count),
    avgResolutionMinutes: toNumberOrNull(row.avg_resolution_minutes),
    avgFirstResponseMinutes: toNumberOrNull(row.avg_first_response_minutes),
  }));
}

async function getMetricsBySector(since) {
  const result = await getPool().query(
    `WITH closed AS (
       SELECT ce.conversation_id, ce.from_agent_id AS agent_id
       FROM conversation_events ce
       WHERE ce.event_type = 'closed' AND ce.from_agent_id IS NOT NULL AND ce.created_at >= $1
     )
     SELECT s.id AS sector_id, s.name AS sector_name, COUNT(*)::int AS closed_count
     FROM closed
     JOIN agent_sectors ags ON ags.agent_id = closed.agent_id
     JOIN sectors s ON s.id = ags.sector_id
     GROUP BY s.id, s.name
     ORDER BY s.name ASC`,
    [since]
  );
  return result.rows.map((row) => ({
    sectorId: row.sector_id,
    sectorName: row.sector_name,
    closedCount: Number(row.closed_count),
  }));
}

module.exports = { getMetricsForAgent, getMetricsForAllAgents, getMetricsBySector };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/metrics/metrics.repository.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/metrics/metrics.repository.js src/metrics/metrics.repository.test.js
git commit -m "Add metrics repository with agent/sector aggregation queries"
```

---

### Task 2: Backend — `GET /api/metrics`

**Files:**
- Create: `src/api/metrics.routes.js`
- Create: `src/api/metrics.routes.test.js`
- Modify: `src/server.js`

**Interfaces:**
- Consumes: `getMetricsForAgent`, `getMetricsForAllAgents`, `getMetricsBySector` from `src/metrics/metrics.repository.js` (Task 1).
- Produces: `GET /api/metrics?period=today|7d|30d` (any authenticated agent). 400 if `period` is missing or not one of the three values. For a non-admin: `200 {period, scope: 'agent', own: {closedCount, avgResolutionMinutes, avgFirstResponseMinutes}}`. For an admin: `200 {period, scope: 'admin', byAgent: [...], bySector: [...]}`. Task 3's frontend `getMetrics(period, token)` calls this exactly and branches on `scope`.

- [ ] **Step 1: Write the failing tests**

Create `src/api/metrics.routes.test.js`:

```js
jest.mock('../metrics/metrics.repository');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const {
  getMetricsForAgent,
  getMetricsForAllAgents,
  getMetricsBySector,
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

  test('returns own metrics for a non-admin agent', async () => {
    getMetricsForAgent.mockResolvedValue({ closedCount: 3, avgResolutionMinutes: 12.5, avgFirstResponseMinutes: 4.2 });

    const res = await request(buildApp())
      .get('/api/metrics?period=today')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);

    expect(res.status).toBe(200);
    expect(getMetricsForAgent).toHaveBeenCalledWith('agent-1', expect.any(Date));
    expect(getMetricsForAllAgents).not.toHaveBeenCalled();
    expect(getMetricsBySector).not.toHaveBeenCalled();
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
    });
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/api/metrics.routes.test.js`
Expected: FAIL — `Cannot find module './metrics.routes'`.

- [ ] **Step 3: Implement the route**

Create `src/api/metrics.routes.js`:

```js
const express = require('express');
const { requireAuth } = require('../auth/auth.middleware');
const { getMetricsForAgent, getMetricsForAllAgents, getMetricsBySector } = require('../metrics/metrics.repository');

const router = express.Router();

const PERIOD_HOURS = { today: 24, '7d': 7 * 24, '30d': 30 * 24 };

function periodToSince(period) {
  const hours = PERIOD_HOURS[period];
  if (!hours) return null;
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

router.get('/', requireAuth, async (req, res) => {
  const since = periodToSince(req.query.period);
  if (!since) {
    return res.status(400).json({ error: 'period must be one of: today, 7d, 30d' });
  }

  if (req.agent.role === 'admin') {
    const [byAgent, bySector] = await Promise.all([getMetricsForAllAgents(since), getMetricsBySector(since)]);
    return res.json({ period: req.query.period, scope: 'admin', byAgent, bySector });
  }

  const own = await getMetricsForAgent(req.agent.agentId, since);
  res.json({ period: req.query.period, scope: 'agent', own });
});

module.exports = router;
```

In `src/server.js`, add the require next to the other route requires:

```js
const metricsRoutes = require('./api/metrics.routes');
```

And mount it next to its siblings:

```js
app.use('/api/metrics', metricsRoutes);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/api/metrics.routes.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/api/metrics.routes.js src/api/metrics.routes.test.js src/server.js
git commit -m "Add GET /api/metrics with role-based scope"
```

---

### Task 3: Frontend — Métricas page (Recharts, period selector, role-based view)

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json` (updated automatically by `npm install`)
- Modify: `frontend/src/services/api.js`
- Modify: `frontend/src/services/api.test.js`
- Create: `frontend/src/pages/MetricsPage.jsx`
- Create: `frontend/src/pages/MetricsPage.test.jsx`
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/App.test.jsx`
- Modify: `frontend/src/pages/DashboardPage.jsx`
- Modify: `frontend/src/pages/DashboardPage.test.jsx`

**Interfaces:**
- Consumes: `GET /api/metrics` (Task 2). `useAuth()` (already exists, returns `{token, agent}`).
- Produces: `getMetrics(period, token)` in `api.js`. `MetricsPage` — a new route at `/metrics`, reachable by any authenticated agent (not admin-gated).

- [ ] **Step 1: Install Recharts**

Run: `cd frontend && npm install recharts`

This updates `frontend/package.json` (adds `"recharts"` to `dependencies`) and `frontend/package-lock.json`. Do not hand-edit the version — let `npm install` resolve and pin whatever the current published version is.

- [ ] **Step 2: Write the failing tests**

In `frontend/src/services/api.test.js`, add `getMetrics` to the existing import list at the top of the file, and append this `describe` block at the end of the file:

```js
describe('getMetrics', () => {
  test('fetches metrics for the given period', async () => {
    global.fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('{}') });
    await getMetrics('7d', 'tok-123');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/metrics?period=7d',
      expect.objectContaining({ method: 'GET' })
    );
  });
});
```

Create `frontend/src/pages/MetricsPage.test.jsx`:

```jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import MetricsPage from './MetricsPage';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

// Recharts' ResponsiveContainer relies on real DOM layout (getBoundingClientRect),
// which jsdom doesn't provide — it renders nothing in tests. Stub the pieces this
// page uses with simple elements that expose the data as visible text, so tests can
// assert on what data reached the chart without fighting jsdom's lack of layout.
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }) => <div>{children}</div>,
  BarChart: ({ data }) => (
    <div data-testid="bar-chart">
      {data.map((item, i) => (
        <div key={i}>{JSON.stringify(item)}</div>
      ))}
    </div>
  ),
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <MetricsPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'agent-1', role: 'agent' } });
});

describe('MetricsPage', () => {
  test('shows own metrics for a non-admin agent', async () => {
    api.getMetrics.mockResolvedValue({
      period: 'today',
      scope: 'agent',
      own: { closedCount: 3, avgResolutionMinutes: 12.5, avgFirstResponseMinutes: 4.2 },
    });
    renderPage();

    expect(await screen.findByText('3')).toBeInTheDocument();
    expect(screen.getByText('12.5')).toBeInTheDocument();
    expect(screen.getByText('4.2')).toBeInTheDocument();
  });

  test('shows a dash for a metric with no data yet', async () => {
    api.getMetrics.mockResolvedValue({
      period: 'today',
      scope: 'agent',
      own: { closedCount: 0, avgResolutionMinutes: null, avgFirstResponseMinutes: null },
    });
    renderPage();

    await screen.findByText('0');
    expect(screen.getAllByText('-')).toHaveLength(2);
  });

  test('shows the per-agent and per-sector charts for an admin', async () => {
    useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'admin-1', role: 'admin' } });
    api.getMetrics.mockResolvedValue({
      period: 'today',
      scope: 'admin',
      byAgent: [{ agentId: 'a1', agentName: 'Ana', closedCount: 5, avgResolutionMinutes: 10, avgFirstResponseMinutes: 2 }],
      bySector: [{ sectorId: 's1', sectorName: 'Financeiro', closedCount: 5 }],
    });
    renderPage();

    // "Ana" appears in two chart sections (atendimentos por atendente AND tempo médio
    // por atendente both render `data.byAgent`) — the sector chart uses a different
    // array and appears exactly once.
    await screen.findByText(/"agentName":"Ana"/);
    expect(screen.getAllByText(/"agentName":"Ana"/)).toHaveLength(2);
    expect(screen.getByText(/"sectorName":"Financeiro"/)).toBeInTheDocument();
  });

  test('switching period refetches metrics with the new period', async () => {
    api.getMetrics.mockResolvedValue({
      period: 'today',
      scope: 'agent',
      own: { closedCount: 1, avgResolutionMinutes: 1, avgFirstResponseMinutes: 1 },
    });
    renderPage();
    await waitFor(() => expect(api.getMetrics).toHaveBeenCalledWith('today', 'tok-123'));

    await userEvent.click(screen.getByRole('button', { name: /últimos 7 dias/i }));

    await waitFor(() => expect(api.getMetrics).toHaveBeenCalledWith('7d', 'tok-123'));
  });

  test('shows an error message when the fetch fails', async () => {
    api.getMetrics.mockRejectedValue(new Error('network error'));
    renderPage();

    expect(await screen.findByText(/falha ao carregar métricas/i)).toBeInTheDocument();
  });
});
```

In `frontend/src/App.test.jsx`, append this test inside the existing `describe('App', ...)` block:

```jsx
  test('an authenticated non-admin can reach /metrics', async () => {
    localStorage.setItem('dw_token', 'tok-123');
    localStorage.setItem('dw_agent', JSON.stringify({ id: 'agent-1', email: 'a@dw.com', role: 'agent' }));
    window.history.pushState({}, '', '/metrics');
    api.getQueue.mockResolvedValue([]);
    api.getMyConversations.mockResolvedValue([]);
    api.listChannels.mockResolvedValue([]);
    api.getMetrics.mockResolvedValue({
      period: 'today',
      scope: 'agent',
      own: { closedCount: 0, avgResolutionMinutes: null, avgFirstResponseMinutes: null },
    });

    render(<App />);

    expect(await screen.findByRole('heading', { name: /métricas/i })).toBeInTheDocument();
  });
```

In `frontend/src/pages/DashboardPage.test.jsx`, append this test inside the existing `describe('DashboardPage', ...)` block:

```jsx
  test('shows a Métricas link for any attendant', () => {
    useQueue.mockReturnValue([]);
    useMyConversations.mockReturnValue([]);
    renderDashboard();
    expect(screen.getByRole('link', { name: /métricas/i })).toBeInTheDocument();
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/services/api.test.js src/pages/MetricsPage.test.jsx src/App.test.jsx src/pages/DashboardPage.test.jsx`
Expected: FAIL — `getMetrics` doesn't exist in `api.js` yet, `MetricsPage.jsx` doesn't exist yet, `/metrics` isn't routed yet, and `DashboardPage` has no "Métricas" link yet.

- [ ] **Step 4: Implement**

Add to the end of `frontend/src/services/api.js`:

```js
export function getMetrics(period, token) {
  return apiFetch(`/api/metrics?period=${period}`, { token });
}
```

Create `frontend/src/pages/MetricsPage.jsx`:

```jsx
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useAuth } from '../contexts/AuthContext';
import { getMetrics } from '../services/api';

const PERIODS = [
  { value: 'today', label: 'Hoje' },
  { value: '7d', label: 'Últimos 7 dias' },
  { value: '30d', label: 'Últimos 30 dias' },
];

function MetricCard({ label, value }) {
  return (
    <div className="rounded border border-gray-200 p-4 text-center">
      <p className="text-2xl font-semibold text-gray-800">{value === null || value === undefined ? '-' : value}</p>
      <p className="text-sm text-gray-500">{label}</p>
    </div>
  );
}

function MetricsPage() {
  const { token, agent } = useAuth();
  const [period, setPeriod] = useState('today');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setError(null);
    getMetrics(period, token)
      .then(setData)
      .catch(() => setError('Falha ao carregar métricas'));
  }, [period, token]);

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-800">Métricas</h1>
        <Link to="/" className="text-sm text-gray-500 hover:underline">
          Voltar
        </Link>
      </div>
      <div className="flex gap-2">
        {PERIODS.map((p) => (
          <button
            key={p.value}
            onClick={() => setPeriod(p.value)}
            className={`rounded px-3 py-1 text-sm ${
              period === p.value ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {data && data.scope === 'agent' && (
        <div className="grid grid-cols-3 gap-4">
          <MetricCard label="Atendimentos fechados" value={data.own.closedCount} />
          <MetricCard label="Tempo médio de atendimento (min)" value={data.own.avgResolutionMinutes} />
          <MetricCard label="Tempo médio de primeira resposta (min)" value={data.own.avgFirstResponseMinutes} />
        </div>
      )}
      {data && data.scope === 'admin' && (
        <div className="space-y-8">
          <div>
            <h2 className="mb-2 font-medium text-gray-700">Atendimentos por atendente</h2>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={data.byAgent}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="agentName" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="closedCount" name="Atendimentos" fill="#2563eb" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div>
            <h2 className="mb-2 font-medium text-gray-700">Tempo médio por atendente (min)</h2>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={data.byAgent}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="agentName" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="avgResolutionMinutes" name="Tempo médio de atendimento" fill="#2563eb" />
                <Bar dataKey="avgFirstResponseMinutes" name="Tempo médio de primeira resposta" fill="#f97316" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div>
            <h2 className="mb-2 font-medium text-gray-700">Atendimentos por setor</h2>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={data.bySector}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="sectorName" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="closedCount" name="Atendimentos" fill="#16a34a" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

export default MetricsPage;
```

In `frontend/src/App.jsx`, add the import right after the existing `AdminChannelsPage` import:

```jsx
import AdminChannelsPage from './pages/AdminChannelsPage';
import MetricsPage from './pages/MetricsPage';
```

Add the new route right after the existing `/admin/channels` route block, before the closing `</Routes>` (not admin-gated — any authenticated agent, unlike `/admin/channels`):

```jsx
            <Route
              path="/admin/channels"
              element={
                <ProtectedRoute requireAdmin>
                  <AdminChannelsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/metrics"
              element={
                <ProtectedRoute>
                  <MetricsPage />
                </ProtectedRoute>
              }
            />
```

In `frontend/src/pages/DashboardPage.jsx`, `Link` is already imported (`import { Link } from 'react-router-dom';` at the top) — do not add a duplicate import.

Find this exact block in the header:

```jsx
          {agent?.role === 'admin' && (
            <Link to="/admin/channels" className="text-sm text-gray-500 hover:underline">
              Administração
            </Link>
          )}
          <button onClick={() => setChangingPassword(true)} className="text-sm text-gray-500 hover:underline">
            Trocar senha
          </button>
```

Insert a new, unconditional "Métricas" link between them (visible to every agent, not just admins):

```jsx
          {agent?.role === 'admin' && (
            <Link to="/admin/channels" className="text-sm text-gray-500 hover:underline">
              Administração
            </Link>
          )}
          <Link to="/metrics" className="text-sm text-gray-500 hover:underline">
            Métricas
          </Link>
          <button onClick={() => setChangingPassword(true)} className="text-sm text-gray-500 hover:underline">
            Trocar senha
          </button>
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/services/api.test.js src/pages/MetricsPage.test.jsx src/App.test.jsx src/pages/DashboardPage.test.jsx`
Expected: PASS (all tests in all four files).

Then run the full frontend and backend suites to confirm nothing else broke:

Run: `cd frontend && npx vitest run`
Run: `npm test` (from the repo root)
Expected: PASS (aside from the pre-existing, unrelated `src/queue/outbound-queue.test.js` Bull/Redis timing flake).

- [ ] **Step 6: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/services/api.js frontend/src/services/api.test.js frontend/src/pages/MetricsPage.jsx frontend/src/pages/MetricsPage.test.jsx frontend/src/App.jsx frontend/src/App.test.jsx frontend/src/pages/DashboardPage.jsx frontend/src/pages/DashboardPage.test.jsx
git commit -m "Add Métricas page with Recharts bar charts and role-based scope"
```

---

## Manual end-to-end test (after all tasks are merged)

Per the spec's testing section: as a regular attendant, close a couple of conversations, then open "Métricas" and confirm the own-numbers cards show sensible values for "Hoje". As an admin, open "Métricas" and confirm the per-attendant and per-setor charts render with real data, and that switching between Hoje/7 dias/30 dias changes the numbers.
