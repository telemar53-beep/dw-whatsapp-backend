# Setores de atendentes (agent sectors) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin manage a shared list of sectors ("Financeiro", "Comercial", etc.) and assign any attendant to zero, one, or several of them — purely organizational metadata, no change to how the conversation queue or transfer works today.

**Architecture:** Two new tables (`sectors`, a many-to-many `agent_sectors` join). A read/write route split identical to the one already established for channels/quick-replies (open `GET`, admin-only mutations). `agent.repository.js`'s existing `listAgents()` gains a `LEFT JOIN` so every admin-facing agent listing already carries its sectors, with no new endpoint needed just to read them. Frontend: a new admin tab manages the sectors list itself (mirrors `QuickRepliesAdminTab` almost exactly), and the existing `AgentsAdminTab` gains a per-row sector display + inline checkbox editor.

**Tech Stack:** Node.js/Express, node-pg-migrate, Jest + Supertest (backend), React 18 + Vitest + Testing Library (frontend). No new dependencies.

**Spec:** [docs/superpowers/specs/2026-09-06-agent-sectors-design.md](../specs/2026-09-06-agent-sectors-design.md)

## Global Constraints

- No routing/queue changes of any kind — sectors are pure organizational metadata. `TransferModal`, `listWaitingConversations`, `listConversationsByAgent` etc. are untouched.
- An agent can belong to any number of sectors (zero, one, or many) — a many-to-many join table, not a single FK column on `agents`.
- Reading the sectors list (`GET /api/sectors`) is open to any authenticated agent; creating/editing/deleting sectors is admin-only, in a separate route file — mirrors the exact split already used for channels and quick replies.
- Assigning sectors to an agent is a full-replace operation (`setAgentSectors(agentId, sectorIds)` deletes the agent's existing memberships and inserts the given set) — never an incremental add/remove.
- Every route follows the JSON error-body convention: `res.status(<code>).json({ error: '<message>' })`, with `name`/`title`-style fields trimmed and rejected as missing when blank — matches the fix already applied to quick-replies after its final review, applied here from the start.
- Any UI component that shows a cancelable edit form must reset its local draft state both on opening and on cancel, so a discarded edit never resurfaces on the next open — the same fix quick-replies needed after its own review, applied here from the start.

---

### Task 1: Backend — `sectors` + `agent_sectors` tables + repository

**Files:**
- Create: `migrations/1788730000000_create-sectors-tables.js`
- Create: `src/sectors/sector.repository.js`
- Test: `src/sectors/sector.repository.test.js`

**Interfaces:**
- Produces: `listSectors()` → `Promise<[{id, name, createdAt}]>` ordered by `name` ascending. `createSector({name})` → `Promise<{id, name, createdAt}>`. `updateSector(id, {name})` → the updated row, or `null` if `id` doesn't exist. `deleteSector(id)` → `true`/`false`. `setAgentSectors(agentId, sectorIds)` → `Promise<void>`, replaces the agent's entire set of sector memberships. Task 2 and Task 3 consume all five of these exact signatures.

- [ ] **Step 1: Write the failing test**

Create `src/sectors/sector.repository.test.js`:

```js
const { getPool, closePool } = require('../db/pool');
const { createAgent } = require('../agents/agent.repository');
const {
  listSectors,
  createSector,
  updateSector,
  deleteSector,
  setAgentSectors,
} = require('./sector.repository');

describe('sector repository', () => {
  beforeEach(async () => {
    await getPool().query('TRUNCATE sectors, agent_sectors, agents CASCADE');
  });

  afterAll(async () => {
    await closePool();
  });

  test('createSector stores and returns a sector', async () => {
    const sector = await createSector({ name: 'Financeiro' });
    expect(sector.id).toBeDefined();
    expect(sector.name).toBe('Financeiro');
    expect(sector.createdAt).toBeDefined();
  });

  test('listSectors returns an empty array when there are none', async () => {
    const sectors = await listSectors();
    expect(sectors).toEqual([]);
  });

  test('listSectors returns all sectors ordered by name', async () => {
    await createSector({ name: 'Zebra' });
    await createSector({ name: 'Abelha' });

    const sectors = await listSectors();

    expect(sectors.map((s) => s.name)).toEqual(['Abelha', 'Zebra']);
  });

  test('updateSector updates and returns the sector with the new name', async () => {
    const sector = await createSector({ name: 'Original' });

    const updated = await updateSector(sector.id, { name: 'Editado' });

    expect(updated.id).toBe(sector.id);
    expect(updated.name).toBe('Editado');
  });

  test('updateSector returns null when the id does not exist', async () => {
    const updated = await updateSector('00000000-0000-0000-0000-000000000000', { name: 'X' });
    expect(updated).toBeNull();
  });

  test('deleteSector removes the row and returns true', async () => {
    const sector = await createSector({ name: 'Para excluir' });

    const deleted = await deleteSector(sector.id);

    expect(deleted).toBe(true);
    expect(await listSectors()).toEqual([]);
  });

  test('deleteSector returns false when the id does not exist', async () => {
    const deleted = await deleteSector('00000000-0000-0000-0000-000000000000');
    expect(deleted).toBe(false);
  });

  test('setAgentSectors assigns the given sectors to an agent', async () => {
    const agent = await createAgent({ email: 'sector-agent1@dw.com', password: 'secret123', role: 'agent' });
    const sectorA = await createSector({ name: 'Financeiro' });
    const sectorB = await createSector({ name: 'Comercial' });

    await setAgentSectors(agent.id, [sectorA.id, sectorB.id]);

    const result = await getPool().query(
      'SELECT sector_id FROM agent_sectors WHERE agent_id = $1 ORDER BY sector_id',
      [agent.id]
    );
    expect(result.rows.map((r) => r.sector_id).sort()).toEqual([sectorA.id, sectorB.id].sort());
  });

  test('setAgentSectors replaces the previous set of sectors entirely', async () => {
    const agent = await createAgent({ email: 'sector-agent2@dw.com', password: 'secret123', role: 'agent' });
    const sectorA = await createSector({ name: 'Financeiro' });
    const sectorB = await createSector({ name: 'Comercial' });
    await setAgentSectors(agent.id, [sectorA.id]);

    await setAgentSectors(agent.id, [sectorB.id]);

    const result = await getPool().query('SELECT sector_id FROM agent_sectors WHERE agent_id = $1', [agent.id]);
    expect(result.rows.map((r) => r.sector_id)).toEqual([sectorB.id]);
  });

  test('setAgentSectors with an empty array clears all sectors for the agent', async () => {
    const agent = await createAgent({ email: 'sector-agent3@dw.com', password: 'secret123', role: 'agent' });
    const sectorA = await createSector({ name: 'Financeiro' });
    await setAgentSectors(agent.id, [sectorA.id]);

    await setAgentSectors(agent.id, []);

    const result = await getPool().query('SELECT sector_id FROM agent_sectors WHERE agent_id = $1', [agent.id]);
    expect(result.rows).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/sectors/sector.repository.test.js`
Expected: FAIL — `Cannot find module './sector.repository'` (and, once that file exists but is empty, `relation "sectors" does not exist` until the migration is applied — this project's `pretest` script runs pending migrations against the test database automatically before every `npm test`).

- [ ] **Step 3: Write the migration**

Create `migrations/1788730000000_create-sectors-tables.js`:

```js
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE sectors (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE agent_sectors (
      agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      sector_id UUID NOT NULL REFERENCES sectors(id) ON DELETE CASCADE,
      PRIMARY KEY (agent_id, sector_id)
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE agent_sectors;
    DROP TABLE sectors;
  `);
};
```

- [ ] **Step 4: Write the repository**

Create `src/sectors/sector.repository.js`:

```js
const { getPool, withTransaction } = require('../db/pool');

function toSector(row) {
  return { id: row.id, name: row.name, createdAt: row.created_at };
}

async function listSectors() {
  const result = await getPool().query('SELECT id, name, created_at FROM sectors ORDER BY name ASC');
  return result.rows.map(toSector);
}

async function createSector({ name }) {
  const result = await getPool().query(
    'INSERT INTO sectors (name) VALUES ($1) RETURNING id, name, created_at',
    [name]
  );
  return toSector(result.rows[0]);
}

async function updateSector(id, { name }) {
  const result = await getPool().query(
    'UPDATE sectors SET name = $2 WHERE id = $1 RETURNING id, name, created_at',
    [id, name]
  );
  if (result.rowCount === 0) return null;
  return toSector(result.rows[0]);
}

async function deleteSector(id) {
  const result = await getPool().query('DELETE FROM sectors WHERE id = $1', [id]);
  return result.rowCount > 0;
}

async function setAgentSectors(agentId, sectorIds) {
  await withTransaction(async (client) => {
    await client.query('DELETE FROM agent_sectors WHERE agent_id = $1', [agentId]);
    for (const sectorId of sectorIds) {
      await client.query('INSERT INTO agent_sectors (agent_id, sector_id) VALUES ($1, $2)', [agentId, sectorId]);
    }
  });
}

module.exports = { listSectors, createSector, updateSector, deleteSector, setAgentSectors };
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- src/sectors/sector.repository.test.js`
Expected: PASS (10 tests).

- [ ] **Step 6: Commit**

```bash
git add migrations/1788730000000_create-sectors-tables.js src/sectors/sector.repository.js src/sectors/sector.repository.test.js
git commit -m "Add sectors and agent_sectors tables and repository"
```

---

### Task 2: Backend — `GET /api/sectors` + admin CRUD routes

**Files:**
- Create: `src/api/sectors.routes.js`
- Create: `src/api/sectors.routes.test.js`
- Create: `src/api/admin-sectors.routes.js`
- Create: `src/api/admin-sectors.routes.test.js`
- Modify: `src/server.js`

**Interfaces:**
- Consumes: `listSectors`, `createSector`, `updateSector`, `deleteSector` from `src/sectors/sector.repository.js` (Task 1).
- Produces: `GET /api/sectors` (any authenticated agent, 200 with the array). `POST /api/admin/sectors` (admin, 201 with the created sector, 400 if `name` missing/blank). `PATCH /api/admin/sectors/:id` (admin, 200 with the updated sector, 400 if `name` missing/blank, 404 if `id` doesn't exist). `DELETE /api/admin/sectors/:id` (admin, 204 empty body, 404 if `id` doesn't exist). Task 4's frontend API functions call these four exactly.

- [ ] **Step 1: Write the failing tests**

Create `src/api/sectors.routes.test.js`:

```js
jest.mock('../sectors/sector.repository');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const { listSectors } = require('../sectors/sector.repository');
const sectorsRoutes = require('./sectors.routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sectors', sectorsRoutes);
  return app;
}

function tokenFor(agentId, role) {
  return jwt.sign({ agentId, role }, process.env.JWT_SECRET);
}

describe('GET /api/sectors', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns the sector list for any authenticated agent', async () => {
    listSectors.mockResolvedValue([{ id: 'sector-1', name: 'Financeiro', createdAt: new Date() }]);

    const res = await request(buildApp())
      .get('/api/sectors')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 'sector-1', name: 'Financeiro', createdAt: expect.any(String) }]);
  });

  test('returns 401 without a token', async () => {
    const res = await request(buildApp()).get('/api/sectors');
    expect(res.status).toBe(401);
    expect(listSectors).not.toHaveBeenCalled();
  });
});
```

Create `src/api/admin-sectors.routes.test.js`:

```js
jest.mock('../sectors/sector.repository');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const { createSector, updateSector, deleteSector } = require('../sectors/sector.repository');
const adminSectorsRoutes = require('./admin-sectors.routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/sectors', adminSectorsRoutes);
  return app;
}

function tokenFor(agentId, role) {
  return jwt.sign({ agentId, role }, process.env.JWT_SECRET);
}

describe('POST /api/admin/sectors', () => {
  beforeEach(() => jest.clearAllMocks());

  test('creates a new sector', async () => {
    createSector.mockResolvedValue({ id: 'sector-1', name: 'Financeiro', createdAt: new Date() });

    const res = await request(buildApp())
      .post('/api/admin/sectors')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ name: 'Financeiro' });

    expect(res.status).toBe(201);
    expect(createSector).toHaveBeenCalledWith({ name: 'Financeiro' });
    expect(res.body.id).toBe('sector-1');
  });

  test('returns 400 when name is missing', async () => {
    const res = await request(buildApp())
      .post('/api/admin/sectors')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({});

    expect(res.status).toBe(400);
    expect(createSector).not.toHaveBeenCalled();
  });

  test('returns 400 when name is only whitespace', async () => {
    const res = await request(buildApp())
      .post('/api/admin/sectors')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ name: '   ' });

    expect(res.status).toBe(400);
    expect(createSector).not.toHaveBeenCalled();
  });

  test('trims leading and trailing whitespace before creating', async () => {
    createSector.mockResolvedValue({ id: 'sector-1', name: 'Financeiro', createdAt: new Date() });

    const res = await request(buildApp())
      .post('/api/admin/sectors')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ name: '  Financeiro  ' });

    expect(res.status).toBe(201);
    expect(createSector).toHaveBeenCalledWith({ name: 'Financeiro' });
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .post('/api/admin/sectors')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ name: 'Financeiro' });

    expect(res.status).toBe(403);
    expect(createSector).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/admin/sectors/:id', () => {
  beforeEach(() => jest.clearAllMocks());

  test('updates an existing sector', async () => {
    updateSector.mockResolvedValue({ id: 'sector-1', name: 'Editado', createdAt: new Date() });

    const res = await request(buildApp())
      .patch('/api/admin/sectors/sector-1')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ name: 'Editado' });

    expect(res.status).toBe(200);
    expect(updateSector).toHaveBeenCalledWith('sector-1', { name: 'Editado' });
    expect(res.body.name).toBe('Editado');
  });

  test('returns 400 when name is only whitespace', async () => {
    const res = await request(buildApp())
      .patch('/api/admin/sectors/sector-1')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ name: '   ' });

    expect(res.status).toBe(400);
    expect(updateSector).not.toHaveBeenCalled();
  });

  test('returns 404 when the sector does not exist', async () => {
    updateSector.mockResolvedValue(null);

    const res = await request(buildApp())
      .patch('/api/admin/sectors/does-not-exist')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ name: 'Editado' });

    expect(res.status).toBe(404);
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .patch('/api/admin/sectors/sector-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ name: 'Editado' });

    expect(res.status).toBe(403);
    expect(updateSector).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/admin/sectors/:id', () => {
  beforeEach(() => jest.clearAllMocks());

  test('deletes an existing sector', async () => {
    deleteSector.mockResolvedValue(true);

    const res = await request(buildApp())
      .delete('/api/admin/sectors/sector-1')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);

    expect(res.status).toBe(204);
    expect(deleteSector).toHaveBeenCalledWith('sector-1');
  });

  test('returns 404 when the sector does not exist', async () => {
    deleteSector.mockResolvedValue(false);

    const res = await request(buildApp())
      .delete('/api/admin/sectors/does-not-exist')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);

    expect(res.status).toBe(404);
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .delete('/api/admin/sectors/sector-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);

    expect(res.status).toBe(403);
    expect(deleteSector).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/api/sectors.routes.test.js src/api/admin-sectors.routes.test.js`
Expected: FAIL — `Cannot find module './sectors.routes'` / `'./admin-sectors.routes'`.

- [ ] **Step 3: Implement the routes**

Create `src/api/sectors.routes.js`:

```js
const express = require('express');
const { requireAuth } = require('../auth/auth.middleware');
const { listSectors } = require('../sectors/sector.repository');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  const sectors = await listSectors();
  res.json(sectors);
});

module.exports = router;
```

Create `src/api/admin-sectors.routes.js`:

```js
const express = require('express');
const { requireAuth, requireRole } = require('../auth/auth.middleware');
const { createSector, updateSector, deleteSector } = require('../sectors/sector.repository');

const router = express.Router();

router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  const { name: rawName } = req.body || {};
  const name = (rawName || '').trim();
  if (!name) {
    return res.status(400).json({ error: 'name is required' });
  }
  const sector = await createSector({ name });
  res.status(201).json(sector);
});

router.patch('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const { name: rawName } = req.body || {};
  const name = (rawName || '').trim();
  if (!name) {
    return res.status(400).json({ error: 'name is required' });
  }
  const sector = await updateSector(req.params.id, { name });
  if (!sector) {
    return res.status(404).json({ error: 'Sector not found' });
  }
  res.json(sector);
});

router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const deleted = await deleteSector(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: 'Sector not found' });
  }
  res.status(204).send();
});

module.exports = router;
```

In `src/server.js`, add the two requires next to the other route requires:

```js
const conversationsRoutes = require('./api/conversations.routes');
const agentsRoutes = require('./api/agents.routes');
const channelsRoutes = require('./api/channels.routes');
const quickRepliesRoutes = require('./api/quick-replies.routes');
const sectorsRoutes = require('./api/sectors.routes');
const adminChannelsRoutes = require('./api/admin-channels.routes');
const adminAgentsRoutes = require('./api/admin-agents.routes');
const adminQuickRepliesRoutes = require('./api/admin-quick-replies.routes');
const adminSectorsRoutes = require('./api/admin-sectors.routes');
```

And mount them next to their siblings:

```js
app.use('/api/conversations', conversationsRoutes);
app.use('/api/agents', agentsRoutes);
app.use('/api/channels', channelsRoutes);
app.use('/api/quick-replies', quickRepliesRoutes);
app.use('/api/sectors', sectorsRoutes);
app.use('/api/admin/channels', adminChannelsRoutes);
app.use('/api/admin/agents', adminAgentsRoutes);
app.use('/api/admin/quick-replies', adminQuickRepliesRoutes);
app.use('/api/admin/sectors', adminSectorsRoutes);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/api/sectors.routes.test.js src/api/admin-sectors.routes.test.js`
Expected: PASS (2 tests + 11 tests = 13 tests).

- [ ] **Step 5: Commit**

```bash
git add src/api/sectors.routes.js src/api/sectors.routes.test.js src/api/admin-sectors.routes.js src/api/admin-sectors.routes.test.js src/server.js
git commit -m "Add sectors routes (open list, admin CRUD)"
```

---

### Task 3: Backend — wire sectors into agent listing + assignment

**Files:**
- Modify: `src/agents/agent.repository.js`
- Modify: `src/agents/agent.repository.test.js`
- Modify: `src/api/admin-agents.routes.js`
- Modify: `src/api/admin-agents.routes.test.js`

**Interfaces:**
- Consumes: `setAgentSectors(agentId, sectorIds)` from `src/sectors/sector.repository.js` (Task 1). `findAgentById(id)` from `src/agents/agent.repository.js` (already exists, unchanged).
- Produces: `listAgents()` now returns `[{..., sectors: [{id, name}]}]` — Task 5's frontend consumes this shape directly from `GET /api/admin/agents`. `PUT /api/admin/agents/:id/sectors` (admin, body `{sectorIds: [...]}`, 200 `{ok: true}`, 400 if `sectorIds` isn't an array, 404 if the agent doesn't exist) — Task 5's `setAgentSectors` frontend function calls this exactly.

- [ ] **Step 1: Write the failing tests**

In `src/agents/agent.repository.test.js`, add this import right after the existing `require('./agent.repository')` block:

```js
const { createSector, setAgentSectors } = require('../sectors/sector.repository');
```

Change the existing `beforeEach`'s `TRUNCATE` line from `TRUNCATE agents CASCADE` to also clear the sectors table between tests:

```js
  beforeEach(async () => {
    await getPool().query('TRUNCATE agents, sectors CASCADE');
  });
```

Add these two tests inside the existing `describe('agent repository', ...)` block, right after the `'listAgents returns every agent ordered by email'` test:

```js
  test('listAgents includes each agent\'s assigned sectors', async () => {
    const agent = await createAgent({ name: 'Fernanda', email: 'fernanda@dw.com', password: 'secret123', role: 'agent' });
    const sector = await createSector({ name: 'Financeiro' });
    await setAgentSectors(agent.id, [sector.id]);

    const agents = await listAgents();

    const found = agents.find((a) => a.id === agent.id);
    expect(found.sectors).toEqual([{ id: sector.id, name: 'Financeiro' }]);
  });

  test('listAgents returns an empty sectors array for an agent with none', async () => {
    await createAgent({ name: 'Gustavo', email: 'gustavo@dw.com', password: 'secret123', role: 'agent' });

    const agents = await listAgents();

    expect(agents[0].sectors).toEqual([]);
  });
```

In `src/api/admin-agents.routes.test.js`, add this mock declaration right after the existing `jest.mock('../agents/agent.repository');` line:

```js
jest.mock('../sectors/sector.repository');
```

Update the existing require block to add `findAgentById` to the destructured import from `../agents/agent.repository`, and add a new require for `setAgentSectors`:

```js
const { listAgents, createAgent, setAgentActive, findAgentById } = require('../agents/agent.repository');
const { setAgentSectors } = require('../sectors/sector.repository');
```

Update the existing `'lists every agent for an admin, including inactive ones'` test's mock data and expectations to include `sectors`:

```js
  test('lists every agent for an admin, including inactive ones', async () => {
    listAgents.mockResolvedValue([
      {
        id: 'agent-1',
        name: 'Ana',
        email: 'ana@dw.com',
        role: 'agent',
        active: true,
        createdAt: new Date(),
        sectors: [{ id: 'sector-1', name: 'Financeiro' }],
      },
      { id: 'agent-2', name: 'Beto', email: 'beto@dw.com', role: 'agent', active: false, createdAt: new Date(), sectors: [] },
    ]);

    const res = await request(buildApp())
      .get('/api/admin/agents')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        id: 'agent-1',
        name: 'Ana',
        email: 'ana@dw.com',
        role: 'agent',
        active: true,
        sectors: [{ id: 'sector-1', name: 'Financeiro' }],
      },
      { id: 'agent-2', name: 'Beto', email: 'beto@dw.com', role: 'agent', active: false, sectors: [] },
    ]);
  });
```

Update the existing `'creates a new agent'` test's final assertion — since `createAgent`'s mock resolves without a `sectors` field, the response now defaults it to an empty array:

```js
    expect(res.body).toEqual({ id: 'agent-3', name: 'Carla', email: 'carla@dw.com', role: 'agent', active: true, sectors: [] });
```

Append this new `describe` block at the end of the file:

```js
describe('PUT /api/admin/agents/:id/sectors', () => {
  beforeEach(() => jest.clearAllMocks());

  test('assigns the given sectors to an agent', async () => {
    findAgentById.mockResolvedValue({ id: 'agent-4', name: 'Duda', email: 'duda@dw.com', role: 'agent', active: true });
    setAgentSectors.mockResolvedValue(undefined);

    const res = await request(buildApp())
      .put('/api/admin/agents/agent-4/sectors')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ sectorIds: ['sector-1', 'sector-2'] });

    expect(res.status).toBe(200);
    expect(setAgentSectors).toHaveBeenCalledWith('agent-4', ['sector-1', 'sector-2']);
  });

  test('returns 400 when sectorIds is not an array', async () => {
    const res = await request(buildApp())
      .put('/api/admin/agents/agent-4/sectors')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ sectorIds: 'not-an-array' });

    expect(res.status).toBe(400);
    expect(setAgentSectors).not.toHaveBeenCalled();
  });

  test('returns 404 when the agent does not exist', async () => {
    findAgentById.mockResolvedValue(null);

    const res = await request(buildApp())
      .put('/api/admin/agents/does-not-exist/sectors')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ sectorIds: [] });

    expect(res.status).toBe(404);
    expect(setAgentSectors).not.toHaveBeenCalled();
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .put('/api/admin/agents/agent-4/sectors')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ sectorIds: [] });

    expect(res.status).toBe(403);
    expect(setAgentSectors).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/agents/agent.repository.test.js src/api/admin-agents.routes.test.js`
Expected: FAIL — `listAgents` doesn't return `sectors` yet, and the `PUT /:id/sectors` route doesn't exist yet.

- [ ] **Step 3: Implement**

Replace `listAgents` in `src/agents/agent.repository.js`:

```js
async function listAgents() {
  const result = await getPool().query(`
    SELECT a.id, a.name, a.email, a.role, a.active, a.created_at,
           COALESCE(
             json_agg(json_build_object('id', s.id, 'name', s.name) ORDER BY s.name) FILTER (WHERE s.id IS NOT NULL),
             '[]'
           ) AS sectors
    FROM agents a
    LEFT JOIN agent_sectors ags ON ags.agent_id = a.id
    LEFT JOIN sectors s ON s.id = ags.sector_id
    GROUP BY a.id
    ORDER BY a.email ASC
  `);
  return result.rows.map((row) => ({ ...toPublicAgent(row), sectors: row.sectors }));
}
```

Replace the full contents of `src/api/admin-agents.routes.js`:

```js
const express = require('express');
const { requireAuth, requireRole } = require('../auth/auth.middleware');
const { listAgents, createAgent, setAgentActive, findAgentById } = require('../agents/agent.repository');
const { setAgentSectors } = require('../sectors/sector.repository');

const router = express.Router();

const UNIQUE_VIOLATION = '23505';
const VALID_ROLES = ['agent', 'admin'];

function toResponseShape(agent) {
  return {
    id: agent.id,
    name: agent.name,
    email: agent.email,
    role: agent.role,
    active: agent.active,
    sectors: agent.sectors || [],
  };
}

router.get('/', requireAuth, requireRole('admin'), async (req, res) => {
  const agents = await listAgents();
  res.json(agents.map(toResponseShape));
});

router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  const { name, email, password, role } = req.body || {};
  if (!name || !email || !password || !role) {
    return res.status(400).json({ error: 'name, email, password and role are required' });
  }
  if (!VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: 'role must be agent or admin' });
  }
  try {
    const agent = await createAgent({ name, email, password, role });
    res.status(201).json(toResponseShape(agent));
  } catch (err) {
    if (err.code === UNIQUE_VIOLATION) {
      return res.status(409).json({ error: 'An agent with this email already exists' });
    }
    throw err;
  }
});

router.patch('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const { active } = req.body || {};
  if (typeof active !== 'boolean') {
    return res.status(400).json({ error: 'active must be a boolean' });
  }
  if (req.params.id === req.agent.agentId && active === false) {
    return res.status(400).json({ error: 'You cannot deactivate your own account' });
  }
  const agent = await setAgentActive(req.params.id, active);
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  res.json(toResponseShape(agent));
});

router.put('/:id/sectors', requireAuth, requireRole('admin'), async (req, res) => {
  const { sectorIds } = req.body || {};
  if (!Array.isArray(sectorIds)) {
    return res.status(400).json({ error: 'sectorIds must be an array' });
  }
  const agent = await findAgentById(req.params.id);
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  await setAgentSectors(req.params.id, sectorIds);
  res.status(200).json({ ok: true });
});

module.exports = router;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/agents/agent.repository.test.js src/api/admin-agents.routes.test.js`
Expected: PASS (all existing tests plus the 2 new repository tests and 4 new route tests).

Then run the full backend suite once to confirm nothing else broke:

Run: `npm test`
Expected: PASS aside from the pre-existing, unrelated `src/queue/outbound-queue.test.js` Bull/Redis timing flake.

- [ ] **Step 5: Commit**

```bash
git add src/agents/agent.repository.js src/agents/agent.repository.test.js src/api/admin-agents.routes.js src/api/admin-agents.routes.test.js
git commit -m "Include agent sectors in listing and add sector assignment endpoint"
```

---

### Task 4: Frontend — admin management of the sectors list

**Files:**
- Modify: `frontend/src/services/api.js`
- Modify: `frontend/src/services/api.test.js`
- Create: `frontend/src/hooks/useSectors.js`
- Create: `frontend/src/hooks/useSectors.test.jsx`
- Create: `frontend/src/components/CreateSectorForm.jsx`
- Create: `frontend/src/components/CreateSectorForm.test.jsx`
- Create: `frontend/src/components/SectorsAdminTab.jsx`
- Create: `frontend/src/components/SectorsAdminTab.test.jsx`
- Modify: `frontend/src/pages/AdminChannelsPage.jsx`
- Modify: `frontend/src/pages/AdminChannelsPage.test.jsx`

**Interfaces:**
- Consumes: Task 2's four sector routes. `apiFetch`, `useAuth()`.
- Produces: `listSectors(token)`, `createSector(payload, token)`, `updateSector(id, payload, token)`, `deleteSector(id, token)` in `api.js`. `useSectors()` → `{sectors, loading, refresh}` — Task 5 also imports this hook. `SectorsAdminTab` — a self-contained component managing the sectors list itself; it does NOT touch agent-sector assignment (that's Task 5, inside `AgentsAdminTab`).

- [ ] **Step 1: Write the failing tests**

In `frontend/src/services/api.test.js`, add these four functions to the existing import list at the top of the file:

```js
  listSectors,
  createSector,
  updateSector,
  deleteSector,
```

Append these four `describe` blocks at the end of the file:

```js
describe('listSectors', () => {
  test('fetches the sector list for any authenticated agent', async () => {
    global.fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('[]') });
    await listSectors('tok-123');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/sectors',
      expect.objectContaining({ method: 'GET' })
    );
  });
});

describe('createSector', () => {
  test('posts the new sector payload', async () => {
    global.fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('{}') });
    await createSector({ name: 'Financeiro' }, 'tok-123');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/admin/sectors',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ name: 'Financeiro' }) })
    );
  });
});

describe('updateSector', () => {
  test('patches the sector payload', async () => {
    global.fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('{}') });
    await updateSector('sector-1', { name: 'Editado' }, 'tok-123');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/admin/sectors/sector-1',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ name: 'Editado' }) })
    );
  });
});

describe('deleteSector', () => {
  test('sends a DELETE request for the sector', async () => {
    global.fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('') });
    await deleteSector('sector-1', 'tok-123');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/admin/sectors/sector-1',
      expect.objectContaining({ method: 'DELETE' })
    );
  });
});
```

Create `frontend/src/hooks/useSectors.test.jsx`:

```jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useSectors } from './useSectors';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
});

describe('useSectors', () => {
  test('fetches sectors on mount', async () => {
    api.listSectors.mockResolvedValue([{ id: 'sector-1', name: 'Financeiro' }]);

    const { result } = renderHook(() => useSectors());

    await waitFor(() => expect(result.current.sectors).toEqual([{ id: 'sector-1', name: 'Financeiro' }]));
    expect(api.listSectors).toHaveBeenCalledWith('tok-123');
  });

  test('refresh refetches the list', async () => {
    api.listSectors.mockResolvedValue([]);
    const { result } = renderHook(() => useSectors());
    await waitFor(() => expect(api.listSectors).toHaveBeenCalledTimes(1));

    api.listSectors.mockResolvedValue([{ id: 'sector-2', name: 'Nova' }]);
    await act(() => result.current.refresh());

    expect(result.current.sectors).toEqual([{ id: 'sector-2', name: 'Nova' }]);
  });
});
```

Create `frontend/src/components/CreateSectorForm.test.jsx`:

```jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CreateSectorForm from './CreateSectorForm';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
});

describe('CreateSectorForm', () => {
  test('creates a sector and calls onCreated', async () => {
    api.createSector.mockResolvedValue({ id: 'sector-1', name: 'Financeiro' });
    const onCreated = vi.fn();
    render(<CreateSectorForm onCreated={onCreated} />);

    await userEvent.type(screen.getByLabelText(/nome/i), 'Financeiro');
    await userEvent.click(screen.getByRole('button', { name: /cadastrar/i }));

    await waitFor(() => expect(api.createSector).toHaveBeenCalledWith({ name: 'Financeiro' }, 'tok-123'));
    expect(onCreated).toHaveBeenCalled();
  });

  test('shows an error message when creation fails', async () => {
    api.createSector.mockRejectedValue({ body: { error: 'Falha ao cadastrar' } });
    render(<CreateSectorForm onCreated={vi.fn()} />);

    await userEvent.type(screen.getByLabelText(/nome/i), 'Financeiro');
    await userEvent.click(screen.getByRole('button', { name: /cadastrar/i }));

    expect(await screen.findByText('Falha ao cadastrar')).toBeInTheDocument();
  });
});
```

Create `frontend/src/components/SectorsAdminTab.test.jsx`:

```jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SectorsAdminTab from './SectorsAdminTab';
import { useSectors } from '../hooks/useSectors';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../hooks/useSectors');
vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
});

describe('SectorsAdminTab', () => {
  test('lists existing sectors', () => {
    useSectors.mockReturnValue({ sectors: [{ id: 'sector-1', name: 'Financeiro' }], refresh: vi.fn() });
    render(<SectorsAdminTab />);

    expect(screen.getByText('Financeiro')).toBeInTheDocument();
  });

  test('editing a sector calls updateSector and refreshes', async () => {
    const refresh = vi.fn();
    useSectors.mockReturnValue({ sectors: [{ id: 'sector-1', name: 'Financeiro' }], refresh });
    api.updateSector.mockResolvedValue({ id: 'sector-1', name: 'Editado' });
    render(<SectorsAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /editar/i }));
    const nameInput = screen.getByDisplayValue('Financeiro');
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Editado');
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));

    await waitFor(() => expect(api.updateSector).toHaveBeenCalledWith('sector-1', { name: 'Editado' }, 'tok-123'));
    expect(refresh).toHaveBeenCalled();
  });

  test('canceling an edit discards unsaved changes', async () => {
    useSectors.mockReturnValue({ sectors: [{ id: 'sector-1', name: 'Financeiro' }], refresh: vi.fn() });
    render(<SectorsAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /editar/i }));
    const nameInput = screen.getByDisplayValue('Financeiro');
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Rascunho abandonado');
    await userEvent.click(screen.getByRole('button', { name: /cancelar/i }));

    await userEvent.click(screen.getByRole('button', { name: /editar/i }));
    expect(screen.getByDisplayValue('Financeiro')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Rascunho abandonado')).not.toBeInTheDocument();
  });

  test('deleting a sector asks for confirmation and calls deleteSector when accepted', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const refresh = vi.fn();
    useSectors.mockReturnValue({ sectors: [{ id: 'sector-1', name: 'Financeiro' }], refresh });
    api.deleteSector.mockResolvedValue(undefined);
    render(<SectorsAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /excluir/i }));

    await waitFor(() => expect(api.deleteSector).toHaveBeenCalledWith('sector-1', 'tok-123'));
    expect(refresh).toHaveBeenCalled();
  });

  test('does not delete when the confirmation is declined', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    useSectors.mockReturnValue({ sectors: [{ id: 'sector-1', name: 'Financeiro' }], refresh: vi.fn() });
    render(<SectorsAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /excluir/i }));

    expect(api.deleteSector).not.toHaveBeenCalled();
  });

  test('shows an error message when deleting fails', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    useSectors.mockReturnValue({ sectors: [{ id: 'sector-1', name: 'Financeiro' }], refresh: vi.fn() });
    api.deleteSector.mockRejectedValue({ body: { error: 'Falha ao excluir' } });
    render(<SectorsAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /excluir/i }));

    expect(await screen.findByText('Falha ao excluir')).toBeInTheDocument();
  });

  test('renders the create-sector form', () => {
    useSectors.mockReturnValue({ sectors: [], refresh: vi.fn() });
    render(<SectorsAdminTab />);
    expect(screen.getByText(/Cadastrar novo setor/)).toBeInTheDocument();
  });
});
```

`frontend/src/pages/AdminChannelsPage.test.jsx` renders `AdminChannelsPage` directly (no render-helper function) and mocks only the hooks each tab calls (`useChannels`, `useAgentsAdmin`, `useAuth`), rendering the tab components themselves for real. Add this import and mock near the existing ones at the top of the file:

```jsx
import { useSectors } from '../hooks/useSectors';
```

```jsx
vi.mock('../hooks/useSectors');
```

Add this line inside the existing `beforeEach`, alongside `useAgentsAdmin.mockReturnValue(...)`:

```jsx
  useSectors.mockReturnValue({ sectors: [], refresh: vi.fn() });
```

Add this test inside the existing `describe('AdminChannelsPage', ...)` block, right after the `'switches to the Atendentes tab...'` test:

```jsx
  test('switches to the Setores tab and shows the sector management UI', async () => {
    useChannels.mockReturnValue({
      channels: [{ id: 'ch1', type: 'baileys', name: 'Berg', phoneNumber: '+5598985004187', status: 'connected' }],
      loading: false,
      refresh: vi.fn(),
    });
    useSectors.mockReturnValue({
      sectors: [{ id: 'sector-1', name: 'Financeiro' }],
      refresh: vi.fn(),
    });
    render(<AdminChannelsPage />);

    expect(screen.getByText('Berg')).toBeInTheDocument();
    expect(screen.queryByText('Financeiro')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /setores/i }));

    expect(screen.getByText('Financeiro')).toBeInTheDocument();
    expect(screen.queryByText('Berg')).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `frontend/`): `npx vitest run src/services/api.test.js src/hooks/useSectors.test.jsx src/components/CreateSectorForm.test.jsx src/components/SectorsAdminTab.test.jsx src/pages/AdminChannelsPage.test.jsx`
Expected: FAIL — the four new `api.js` exports don't exist yet, `useSectors.js`/`CreateSectorForm.jsx`/`SectorsAdminTab.jsx` don't exist yet, and `AdminChannelsPage` has no "Setores" tab yet.

- [ ] **Step 3: Implement**

Add to the end of `frontend/src/services/api.js`:

```js
export function listSectors(token) {
  return apiFetch('/api/sectors', { token });
}

export function createSector(payload, token) {
  return apiFetch('/api/admin/sectors', { method: 'POST', body: payload, token });
}

export function updateSector(id, payload, token) {
  return apiFetch(`/api/admin/sectors/${id}`, { method: 'PATCH', body: payload, token });
}

export function deleteSector(id, token) {
  return apiFetch(`/api/admin/sectors/${id}`, { method: 'DELETE', token });
}
```

Create `frontend/src/hooks/useSectors.js`:

```jsx
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { listSectors } from '../services/api';

export function useSectors() {
  const { token } = useAuth();
  const [sectors, setSectors] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    if (!token) return Promise.resolve();
    setLoading(true);
    return listSectors(token)
      .then((data) => {
        setSectors(data);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, [token]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { sectors, loading, refresh };
}
```

Create `frontend/src/components/CreateSectorForm.jsx`:

```jsx
import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { createSector } from '../services/api';

function CreateSectorForm({ onCreated }) {
  const { token } = useAuth();
  const [name, setName] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await createSector({ name }, token);
      setName('');
      onCreated();
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao cadastrar setor');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded border border-gray-200 p-4">
      <h3 className="font-semibold text-gray-800">Cadastrar novo setor</h3>
      <div>
        <label htmlFor="sector-name" className="mb-1 block text-sm text-gray-600">
          Nome
        </label>
        <input
          id="sector-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded border border-gray-300 px-3 py-2"
          required
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={submitting} className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50">
        Cadastrar
      </button>
    </form>
  );
}

export default CreateSectorForm;
```

Create `frontend/src/components/SectorsAdminTab.jsx`:

```jsx
import { useState } from 'react';
import { useSectors } from '../hooks/useSectors';
import { useAuth } from '../contexts/AuthContext';
import { updateSector, deleteSector } from '../services/api';
import CreateSectorForm from './CreateSectorForm';

function SectorRow({ sector, onSaved, onDeleted }) {
  const { token } = useAuth();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(sector.name);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const [deleting, setDeleting] = useState(false);

  async function handleSave(event) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await updateSector(sector.id, { name }, token);
      setEditing(false);
      onSaved();
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao salvar');
    } finally {
      setSubmitting(false);
    }
  }

  function handleEditClick() {
    setName(sector.name);
    setError(null);
    setEditing(true);
  }

  function handleCancel() {
    setName(sector.name);
    setError(null);
    setEditing(false);
  }

  async function handleDelete() {
    if (!window.confirm(`Excluir o setor "${sector.name}"?`)) {
      return;
    }
    setDeleteError(null);
    setDeleting(true);
    try {
      await deleteSector(sector.id, token);
      onDeleted();
    } catch (err) {
      setDeleteError((err.body && err.body.error) || 'Falha ao excluir');
      setDeleting(false);
    }
  }

  if (editing) {
    return (
      <form onSubmit={handleSave} className="space-y-2 rounded border border-gray-200 p-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded border border-gray-300 px-3 py-2"
          required
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={submitting}
            className="rounded bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-50"
          >
            Salvar
          </button>
          <button type="button" onClick={handleCancel} className="rounded bg-gray-200 px-3 py-1 text-sm text-gray-700">
            Cancelar
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="rounded border border-gray-200 p-3">
      <div className="flex items-center justify-between">
        <p className="font-medium text-gray-800">{sector.name}</p>
        <div className="flex items-center gap-3">
          <button onClick={handleEditClick} className="text-sm text-blue-600 underline">
            Editar
          </button>
          <button onClick={handleDelete} disabled={deleting} className="text-sm text-red-600 underline disabled:opacity-50">
            Excluir
          </button>
        </div>
      </div>
      {deleteError && <p className="mt-1 text-sm text-red-600">{deleteError}</p>}
    </div>
  );
}

function SectorsAdminTab() {
  const { sectors, refresh } = useSectors();

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        {sectors.map((sector) => (
          <SectorRow key={sector.id} sector={sector} onSaved={refresh} onDeleted={refresh} />
        ))}
      </div>
      <CreateSectorForm onCreated={refresh} />
    </div>
  );
}

export default SectorsAdminTab;
```

In `frontend/src/pages/AdminChannelsPage.jsx`, add the import:

```jsx
import SectorsAdminTab from '../components/SectorsAdminTab';
```

Add a fourth tab button next to "Respostas rápidas" (same style, `activeTab === 'sectors'`):

```jsx
        <button
          onClick={() => setActiveTab('sectors')}
          className={`px-3 py-2 text-sm ${
            activeTab === 'sectors' ? 'border-b-2 border-blue-600 font-semibold text-blue-600' : 'text-gray-500'
          }`}
        >
          Setores
        </button>
```

And extend the conditional rendering below the tab bar into a four-way check:

```jsx
      {activeTab === 'channels' ? (
        <div className="space-y-6">
          {/* ...unchanged channels content... */}
        </div>
      ) : activeTab === 'agents' ? (
        <AgentsAdminTab />
      ) : activeTab === 'quickReplies' ? (
        <QuickRepliesAdminTab />
      ) : (
        <SectorsAdminTab />
      )}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run (from `frontend/`): `npx vitest run src/services/api.test.js src/hooks/useSectors.test.jsx src/components/CreateSectorForm.test.jsx src/components/SectorsAdminTab.test.jsx src/pages/AdminChannelsPage.test.jsx`
Expected: PASS (all tests in all five files).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/api.js frontend/src/services/api.test.js frontend/src/hooks/useSectors.js frontend/src/hooks/useSectors.test.jsx frontend/src/components/CreateSectorForm.jsx frontend/src/components/CreateSectorForm.test.jsx frontend/src/components/SectorsAdminTab.jsx frontend/src/components/SectorsAdminTab.test.jsx frontend/src/pages/AdminChannelsPage.jsx frontend/src/pages/AdminChannelsPage.test.jsx
git commit -m "Add sectors admin management tab"
```

---

### Task 5: Frontend — show and edit each agent's sectors in `AgentsAdminTab`

**Files:**
- Modify: `frontend/src/services/api.js`
- Modify: `frontend/src/services/api.test.js`
- Modify: `frontend/src/components/AgentsAdminTab.jsx`
- Modify: `frontend/src/components/AgentsAdminTab.test.jsx`

**Interfaces:**
- Consumes: `useSectors()` (Task 4) for the full list of assignable sectors. `PUT /api/admin/agents/:id/sectors` (Task 3) via a new `setAgentSectors(agentId, sectorIds, token)` function in `api.js`. Each agent object from `useAgentsAdmin()` now carries `sectors: [{id, name}]` (Task 3's `listAgents()` change) — this task is the first frontend consumer of that field.

**⚠️ Important cross-file consequence, read before starting:** every existing test in `AgentsAdminTab.test.jsx` mocks its own `agents` array, and none of those mock objects currently include a `sectors` field. Once `AgentsAdminTab.jsx` reads `agentRow.sectors.length`/`.map(...)` unconditionally, every existing mock agent object needs a `sectors: []` (or a real array) added, or those tests will crash on `Cannot read properties of undefined`. The Step 1 instructions below list every existing mock object that needs this addition — apply all of them, not just the ones for new tests.

- [ ] **Step 1: Write the failing tests**

In `frontend/src/components/AgentsAdminTab.test.jsx`, add this import and mock near the existing ones at the top:

```jsx
import { useSectors } from '../hooks/useSectors';
```

```jsx
vi.mock('../hooks/useSectors');
```

Add this line inside the existing `beforeEach`:

```jsx
  useSectors.mockReturnValue({ sectors: [], refresh: vi.fn() });
```

Update every existing mock agent object in this file to add a `sectors` field — specifically:
- `'lists every agent with name, email, role and status'`: add `sectors: []` to both agent objects (`a1` and `a2`).
- `'deactivates an active agent'`: add `sectors: []` to the `a1` agent object.
- `'reactivates a deactivated agent'`: add `sectors: []` to the `a1` agent object.
- `'does not show a deactivate button for the currently logged-in admin'`: add `sectors: []` to the `admin-1` agent object.
- `'renders the create-agent form'` uses `agents: []` (an empty array of agents) — no change needed there.

Append these tests inside the existing `describe('AgentsAdminTab', ...)` block:

```jsx
  test('shows each agent\'s assigned sectors', () => {
    useAgentsAdmin.mockReturnValue({
      agents: [
        {
          id: 'a1',
          name: 'Ana',
          email: 'ana@dw.com',
          role: 'agent',
          active: true,
          sectors: [
            { id: 's1', name: 'Financeiro' },
            { id: 's2', name: 'Comercial' },
          ],
        },
      ],
      refresh: vi.fn(),
    });
    render(<AgentsAdminTab />);
    expect(screen.getByText(/Financeiro, Comercial/)).toBeInTheDocument();
  });

  test('shows "Nenhum setor" when an agent has no sectors', () => {
    useAgentsAdmin.mockReturnValue({
      agents: [{ id: 'a1', name: 'Ana', email: 'ana@dw.com', role: 'agent', active: true, sectors: [] }],
      refresh: vi.fn(),
    });
    render(<AgentsAdminTab />);
    expect(screen.getByText(/Nenhum setor/)).toBeInTheDocument();
  });

  test('editing sectors: toggling a checkbox and saving calls setAgentSectors and refreshes', async () => {
    const refresh = vi.fn();
    useAgentsAdmin.mockReturnValue({
      agents: [
        { id: 'a1', name: 'Ana', email: 'ana@dw.com', role: 'agent', active: true, sectors: [{ id: 's1', name: 'Financeiro' }] },
      ],
      refresh,
    });
    useSectors.mockReturnValue({
      sectors: [
        { id: 's1', name: 'Financeiro' },
        { id: 's2', name: 'Comercial' },
      ],
      refresh: vi.fn(),
    });
    api.setAgentSectors.mockResolvedValue({ ok: true });
    render(<AgentsAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /editar setores/i }));
    await userEvent.click(screen.getByLabelText('Comercial'));
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));

    await waitFor(() => expect(api.setAgentSectors).toHaveBeenCalledWith('a1', ['s1', 's2'], 'tok-123'));
    expect(refresh).toHaveBeenCalled();
  });

  test('canceling sector edits discards unsaved changes', async () => {
    useAgentsAdmin.mockReturnValue({
      agents: [
        { id: 'a1', name: 'Ana', email: 'ana@dw.com', role: 'agent', active: true, sectors: [{ id: 's1', name: 'Financeiro' }] },
      ],
      refresh: vi.fn(),
    });
    useSectors.mockReturnValue({
      sectors: [
        { id: 's1', name: 'Financeiro' },
        { id: 's2', name: 'Comercial' },
      ],
      refresh: vi.fn(),
    });
    render(<AgentsAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /editar setores/i }));
    await userEvent.click(screen.getByLabelText('Comercial'));
    await userEvent.click(screen.getByRole('button', { name: /cancelar/i }));

    await userEvent.click(screen.getByRole('button', { name: /editar setores/i }));
    expect(screen.getByLabelText('Financeiro')).toBeChecked();
    expect(screen.getByLabelText('Comercial')).not.toBeChecked();
  });
```

In `frontend/src/services/api.test.js`, add `setAgentSectors` to the existing import list, and append this `describe` block at the end of the file:

```js
describe('setAgentSectors', () => {
  test('puts the sector ids for an agent', async () => {
    global.fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('{}') });
    await setAgentSectors('agent-1', ['sector-1', 'sector-2'], 'tok-123');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/admin/agents/agent-1/sectors',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ sectorIds: ['sector-1', 'sector-2'] }) })
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `frontend/`): `npx vitest run src/services/api.test.js src/components/AgentsAdminTab.test.jsx`
Expected: FAIL — `setAgentSectors` isn't exported from `api.js` yet, `AgentsAdminTab` doesn't show or edit sectors yet, and the existing tests crash on the now-unconditional `agentRow.sectors` access.

- [ ] **Step 3: Implement**

Add to the end of `frontend/src/services/api.js`:

```js
export function setAgentSectors(agentId, sectorIds, token) {
  return apiFetch(`/api/admin/agents/${agentId}/sectors`, { method: 'PUT', body: { sectorIds }, token });
}
```

Replace the full contents of `frontend/src/components/AgentsAdminTab.jsx`:

```jsx
import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useAgentsAdmin } from '../hooks/useAgentsAdmin';
import { useSectors } from '../hooks/useSectors';
import { setAgentActive, setAgentSectors } from '../services/api';
import CreateAgentForm from './CreateAgentForm';

function AgentRow({ agentRow, currentAgent, sectors, onToggleActive, onSectorsSaved }) {
  const { token } = useAuth();
  const [editingSectors, setEditingSectors] = useState(false);
  const [selectedIds, setSelectedIds] = useState(agentRow.sectors.map((s) => s.id));
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  function handleEditSectorsClick() {
    setSelectedIds(agentRow.sectors.map((s) => s.id));
    setError(null);
    setEditingSectors(true);
  }

  function handleCancel() {
    setSelectedIds(agentRow.sectors.map((s) => s.id));
    setError(null);
    setEditingSectors(false);
  }

  function toggleSector(sectorId) {
    setSelectedIds((prev) => (prev.includes(sectorId) ? prev.filter((id) => id !== sectorId) : [...prev, sectorId]));
  }

  async function handleSaveSectors() {
    setError(null);
    setSubmitting(true);
    try {
      await setAgentSectors(agentRow.id, selectedIds, token);
      setEditingSectors(false);
      onSectorsSaved();
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao salvar setores');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded border border-gray-200 p-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium text-gray-800">{agentRow.name}</p>
          <p className="text-sm text-gray-500">
            {agentRow.email} — {agentRow.role === 'admin' ? 'Administrador' : 'Atendente'}
          </p>
          <p className="text-sm text-gray-500">
            Setores: {agentRow.sectors.length > 0 ? agentRow.sectors.map((s) => s.name).join(', ') : 'Nenhum setor'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-sm ${agentRow.active ? 'text-green-600' : 'text-gray-400'}`}>
            {agentRow.active ? 'Ativo' : 'Desativado'}
          </span>
          <button onClick={handleEditSectorsClick} className="text-sm text-blue-600 underline">
            Editar setores
          </button>
          {agentRow.id !== currentAgent?.id && (
            <button onClick={() => onToggleActive(agentRow)} className="text-sm text-blue-600 underline">
              {agentRow.active ? 'Desativar' : 'Reativar'}
            </button>
          )}
        </div>
      </div>
      {editingSectors && (
        <div className="mt-2 space-y-2 border-t border-gray-200 pt-2">
          {sectors.map((sector) => (
            <label key={sector.id} className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={selectedIds.includes(sector.id)} onChange={() => toggleSector(sector.id)} />
              {sector.name}
            </label>
          ))}
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSaveSectors}
              disabled={submitting}
              className="rounded bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-50"
            >
              Salvar
            </button>
            <button type="button" onClick={handleCancel} className="rounded bg-gray-200 px-3 py-1 text-sm text-gray-700">
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function AgentsAdminTab() {
  const { token, agent: currentAgent } = useAuth();
  const { agents, refresh } = useAgentsAdmin();
  const { sectors } = useSectors();

  async function handleToggleActive(agentToToggle) {
    await setAgentActive(agentToToggle.id, !agentToToggle.active, token);
    refresh();
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        {agents.map((agentRow) => (
          <AgentRow
            key={agentRow.id}
            agentRow={agentRow}
            currentAgent={currentAgent}
            sectors={sectors}
            onToggleActive={handleToggleActive}
            onSectorsSaved={refresh}
          />
        ))}
      </div>
      <CreateAgentForm onCreated={refresh} />
    </div>
  );
}

export default AgentsAdminTab;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run (from `frontend/`): `npx vitest run src/services/api.test.js src/components/AgentsAdminTab.test.jsx`
Expected: PASS (all existing tests plus the 4 new ones).

Then run the full frontend and backend suites to confirm nothing else broke:

Run: `cd frontend && npx vitest run`
Run: `npm test` (from the repo root)
Expected: PASS (aside from the pre-existing, unrelated `src/queue/outbound-queue.test.js` Bull/Redis timing flake).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/api.js frontend/src/services/api.test.js frontend/src/components/AgentsAdminTab.jsx frontend/src/components/AgentsAdminTab.test.jsx
git commit -m "Show and edit each agent's sectors in AgentsAdminTab"
```

---

## Manual end-to-end test (after all tasks are merged)

Per the spec's testing section: log in as an admin, create two or three sectors in the new "Setores" tab, go to "Atendentes", assign one or more sectors to an existing attendant via "Editar setores", confirm the list shows them correctly, then edit the set again (add one, remove one) and confirm it saved. No customer-facing or queue behavior should change at all — this is purely an admin/organizational feature.
