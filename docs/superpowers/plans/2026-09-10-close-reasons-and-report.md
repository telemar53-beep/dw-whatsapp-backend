# Motivos de Contato e Relatório — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin-configurable "motivos de contato" (contact reasons); a mandatory popup
asks the closing agent to pick one when they close a conversation; the choice is
recorded and surfaced as a new chart on the page currently called "Métricas", which is
renamed to "Relatório" (display text only).

**Architecture:** A new `reasons` module (repository + two route files, mirroring the
existing `sectors` module's public/admin route split) backs an admin CRUD screen and a
required single-select popup wired into the existing close-conversation flow.
`conversation_events.reason_id` (nullable) carries the choice on the `'closed'` event
row only — never a column on `conversations` itself, so a reopened-then-reclosed
conversation gets its own, independent reason. `metrics.repository.js` gains one new
aggregate query; `MetricsPage.jsx`/`NavRail.jsx` get a text-only rename.

**Tech Stack:** Node.js/Express, PostgreSQL (node-pg-migrate), Jest + supertest
(backend), React, Vitest + Testing Library (frontend), Recharts.

**Spec:** `docs/superpowers/specs/2026-09-10-close-reasons-and-report-design.md`

## Global Constraints

- A contact reason is never physically deleted — only `active` toggles. No DELETE
  route/repository function exists for reasons.
- Exactly one reason per closed conversation (`reasonId` is a single string, never an
  array).
- Choosing a reason is **mandatory** to close a conversation — the backend route
  rejects a close request with no `reasonId` (400), independent of anything the
  frontend enforces.
- `reason_id` on `conversation_events` is nullable at the database level (no `NOT
  NULL` constraint) — this is deliberate, not an oversight: dozens of pre-existing
  tests and all historical data close conversations without a reason, and the column
  must accept `NULL` for those without any migration backfill. Mandatoriness is
  enforced at the API route layer only (`POST /:id/close` requires it in the body),
  not at the schema layer.
- The route `/metrics`, the file `frontend/src/pages/MetricsPage.jsx`, and the
  internal string `active="metrics"` (used by both `NavRail.jsx` and `MetricsPage.jsx`)
  never change — only the visible label ("Métricas" → "Relatório" in the nav link and
  the page's `<h1>`) changes.
- Closing errors are handled inline inside `CloseReasonModal` (a message rendered in
  the popup) — `window.alert` is no longer used for close failures. This replaces the
  `window.alert` branch in `ConversationView.jsx`'s old `handleClose`.
- Every migration statement uses `IF NOT EXISTS`/`IF EXISTS`.
- Every git commit ends with the trailer
  `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` — spell this out verbatim
  in every implementer dispatch; omitting it makes the subagent default to its own
  model identity in the trailer (this has happened twice already this session when the
  instruction wasn't repeated).

---

### Task 1: Migration — contact_reasons table + conversation_events.reason_id

**Files:**
- Create: `migrations/1788880000000_create-contact-reasons.js`

**Interfaces:**
- Produces: table `contact_reasons` (`id`, `name`, `active` default `true`,
  `created_at`, `updated_at`), column `conversation_events.reason_id` (UUID, nullable,
  FK → `contact_reasons(id)`, no `ON DELETE` clause — reasons are never deleted).
  Consumed by Task 2 (repository) and Task 4 (`closeConversation`).

- [ ] **Step 1: Write the migration**

```js
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS contact_reasons (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  pgm.sql(`ALTER TABLE conversation_events ADD COLUMN IF NOT EXISTS reason_id UUID REFERENCES contact_reasons(id);`);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE conversation_events DROP COLUMN IF EXISTS reason_id;`);
  pgm.sql(`DROP TABLE IF EXISTS contact_reasons;`);
};
```

- [ ] **Step 2: Run the migration against the local dev database**

Run: `npm run migrate up`

Expected: migration reports success; a DB client confirms `contact_reasons` exists and
`conversation_events` has a `reason_id` column.

- [ ] **Step 3: Commit**

```bash
git add migrations/1788880000000_create-contact-reasons.js
git commit -m "$(cat <<'EOF'
Add the contact_reasons table and conversation_events.reason_id column

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Contact reason repository

**Files:**
- Create: `src/reasons/reason.repository.js`
- Test: `src/reasons/reason.repository.test.js`

**Interfaces:**
- Consumes: `getPool` from `../db/pool`. Table from Task 1.
- Produces: `listActiveReasons()` → `Promise<{id, name, active, createdAt}[]>`
  (only `active = true`); `listAllReasons()` → same shape, all rows;
  `findReasonById(id)` → `Promise<{id, name, active, createdAt} | null>`;
  `createReason({name})` → same shape; `updateReason(id, {name, active})` → same
  shape or `null` if not found (both `name` and `active` independently optional).
  Consumed by Task 3 (routes) and Task 5 (`conversations.routes.js` validation).

This is an integration test against the real local Postgres, following the exact
pattern of `src/sectors/sector.repository.test.js` (`TRUNCATE` in `beforeEach`, real
`getPool()`/`closePool()`, no mocking).

- [ ] **Step 1: Write the failing tests**

```js
const { getPool, closePool } = require('../db/pool');
const {
  listActiveReasons,
  listAllReasons,
  findReasonById,
  createReason,
  updateReason,
} = require('./reason.repository');

describe('reason repository', () => {
  beforeEach(async () => {
    await getPool().query('TRUNCATE contact_reasons CASCADE');
  });

  afterAll(async () => {
    await closePool();
  });

  test('createReason stores and returns a reason, active by default', async () => {
    const reason = await createReason({ name: 'Troca de senha' });
    expect(reason.id).toBeDefined();
    expect(reason.name).toBe('Troca de senha');
    expect(reason.active).toBe(true);
    expect(reason.createdAt).toBeDefined();
  });

  test('listActiveReasons returns an empty array when there are none', async () => {
    expect(await listActiveReasons()).toEqual([]);
  });

  test('listActiveReasons excludes inactive reasons but listAllReasons includes them', async () => {
    const active = await createReason({ name: 'Ativo' });
    const inactive = await createReason({ name: 'Inativo' });
    await updateReason(inactive.id, { active: false });

    const activeOnly = await listActiveReasons();
    const all = await listAllReasons();

    expect(activeOnly.map((r) => r.id)).toEqual([active.id]);
    expect(all.map((r) => r.id).sort()).toEqual([active.id, inactive.id].sort());
  });

  test('listAllReasons orders by name ascending', async () => {
    await createReason({ name: 'Zebra' });
    await createReason({ name: 'Abelha' });

    const reasons = await listAllReasons();

    expect(reasons.map((r) => r.name)).toEqual(['Abelha', 'Zebra']);
  });

  test('findReasonById returns the reason', async () => {
    const created = await createReason({ name: 'Pagamento' });
    const found = await findReasonById(created.id);
    expect(found.id).toBe(created.id);
    expect(found.name).toBe('Pagamento');
  });

  test('findReasonById returns null when the id does not exist', async () => {
    expect(await findReasonById('00000000-0000-0000-0000-000000000000')).toBeNull();
  });

  test('updateReason updates only the name when active is not passed', async () => {
    const reason = await createReason({ name: 'Original' });

    const updated = await updateReason(reason.id, { name: 'Editado' });

    expect(updated.name).toBe('Editado');
    expect(updated.active).toBe(true);
  });

  test('updateReason updates only active when name is not passed', async () => {
    const reason = await createReason({ name: 'Original' });

    const updated = await updateReason(reason.id, { active: false });

    expect(updated.name).toBe('Original');
    expect(updated.active).toBe(false);
  });

  test('updateReason updates both fields when both are passed', async () => {
    const reason = await createReason({ name: 'Original' });

    const updated = await updateReason(reason.id, { name: 'Editado', active: false });

    expect(updated.name).toBe('Editado');
    expect(updated.active).toBe(false);
  });

  test('updateReason returns null when the id does not exist', async () => {
    const updated = await updateReason('00000000-0000-0000-0000-000000000000', { name: 'X' });
    expect(updated).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/reasons/reason.repository.test.js`
Expected: FAIL with "Cannot find module './reason.repository'"

- [ ] **Step 3: Implement**

```js
const { getPool } = require('../db/pool');

function toReason(row) {
  return { id: row.id, name: row.name, active: row.active, createdAt: row.created_at };
}

async function listActiveReasons() {
  const result = await getPool().query(
    'SELECT id, name, active, created_at FROM contact_reasons WHERE active = true ORDER BY name ASC'
  );
  return result.rows.map(toReason);
}

async function listAllReasons() {
  const result = await getPool().query(
    'SELECT id, name, active, created_at FROM contact_reasons ORDER BY name ASC'
  );
  return result.rows.map(toReason);
}

async function findReasonById(id) {
  const result = await getPool().query(
    'SELECT id, name, active, created_at FROM contact_reasons WHERE id = $1',
    [id]
  );
  if (result.rowCount === 0) return null;
  return toReason(result.rows[0]);
}

async function createReason({ name }) {
  const result = await getPool().query(
    'INSERT INTO contact_reasons (name) VALUES ($1) RETURNING id, name, active, created_at',
    [name]
  );
  return toReason(result.rows[0]);
}

async function updateReason(id, { name, active }) {
  const result = await getPool().query(
    `UPDATE contact_reasons SET name = COALESCE($2, name), active = COALESCE($3, active), updated_at = now()
     WHERE id = $1 RETURNING id, name, active, created_at`,
    [id, name !== undefined ? name : null, active !== undefined ? active : null]
  );
  if (result.rowCount === 0) return null;
  return toReason(result.rows[0]);
}

module.exports = { listActiveReasons, listAllReasons, findReasonById, createReason, updateReason };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/reasons/reason.repository.test.js`
Expected: PASS, all tests green

- [ ] **Step 5: Commit**

```bash
git add src/reasons/reason.repository.js src/reasons/reason.repository.test.js
git commit -m "$(cat <<'EOF'
Add the contact reason repository

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Reason routes (public + admin) and server.js mount

**Files:**
- Create: `src/api/reasons.routes.js`
- Create: `src/api/admin-reasons.routes.js`
- Test: `src/api/reasons.routes.test.js`
- Test: `src/api/admin-reasons.routes.test.js`
- Modify: `src/server.js`

**Interfaces:**
- Consumes: `listActiveReasons`, `listAllReasons`, `createReason`, `updateReason` from
  `../reasons/reason.repository` (Task 2).
- Produces: `GET /api/reasons` → active reasons array (any authenticated agent);
  `GET /api/admin/reasons` → all reasons array (admin only); `POST /api/admin/reasons`
  → creates, `201`; `PATCH /api/admin/reasons/:id` → updates, `200`, `404` if missing.
  Consumed by Task 6 (frontend `services/api.js`).

- [ ] **Step 1: Write the failing tests**

`src/api/reasons.routes.test.js`:
```js
jest.mock('../reasons/reason.repository');

const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const { listActiveReasons } = require('../reasons/reason.repository');
const reasonsRoutes = require('./reasons.routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/reasons', reasonsRoutes);
  return app;
}

function tokenFor(agentId, role) {
  return jwt.sign({ agentId, role }, process.env.JWT_SECRET);
}

describe('GET /api/reasons', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns active reasons for any authenticated agent', async () => {
    listActiveReasons.mockResolvedValue([{ id: 'r1', name: 'Troca de senha', active: true }]);

    const res = await request(buildApp())
      .get('/api/reasons')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 'r1', name: 'Troca de senha', active: true }]);
  });

  test('returns 401 without a token', async () => {
    const res = await request(buildApp()).get('/api/reasons');
    expect(res.status).toBe(401);
    expect(listActiveReasons).not.toHaveBeenCalled();
  });
});
```

`src/api/admin-reasons.routes.test.js`:
```js
jest.mock('../reasons/reason.repository');

const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const { listAllReasons, createReason, updateReason } = require('../reasons/reason.repository');
const adminReasonsRoutes = require('./admin-reasons.routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/reasons', adminReasonsRoutes);
  return app;
}

function tokenFor(agentId, role) {
  return jwt.sign({ agentId, role }, process.env.JWT_SECRET);
}

describe('GET /api/admin/reasons', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns all reasons for an admin, including inactive ones', async () => {
    listAllReasons.mockResolvedValue([
      { id: 'r1', name: 'Ativo', active: true },
      { id: 'r2', name: 'Inativo', active: false },
    ]);

    const res = await request(buildApp())
      .get('/api/admin/reasons')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .get('/api/admin/reasons')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(403);
  });
});

describe('POST /api/admin/reasons', () => {
  beforeEach(() => jest.clearAllMocks());

  test('creates a new reason', async () => {
    createReason.mockResolvedValue({ id: 'r1', name: 'Troca de senha', active: true });

    const res = await request(buildApp())
      .post('/api/admin/reasons')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ name: 'Troca de senha' });

    expect(res.status).toBe(201);
    expect(createReason).toHaveBeenCalledWith({ name: 'Troca de senha' });
  });

  test('returns 400 when name is missing', async () => {
    const res = await request(buildApp())
      .post('/api/admin/reasons')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({});
    expect(res.status).toBe(400);
    expect(createReason).not.toHaveBeenCalled();
  });

  test('returns 400 when name is only whitespace', async () => {
    const res = await request(buildApp())
      .post('/api/admin/reasons')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ name: '   ' });
    expect(res.status).toBe(400);
    expect(createReason).not.toHaveBeenCalled();
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .post('/api/admin/reasons')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ name: 'Troca de senha' });
    expect(res.status).toBe(403);
    expect(createReason).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/admin/reasons/:id', () => {
  beforeEach(() => jest.clearAllMocks());

  test('updates the name only', async () => {
    updateReason.mockResolvedValue({ id: 'r1', name: 'Editado', active: true });

    const res = await request(buildApp())
      .patch('/api/admin/reasons/r1')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ name: 'Editado' });

    expect(res.status).toBe(200);
    expect(updateReason).toHaveBeenCalledWith('r1', { name: 'Editado', active: undefined });
  });

  test('updates active only', async () => {
    updateReason.mockResolvedValue({ id: 'r1', name: 'Original', active: false });

    const res = await request(buildApp())
      .patch('/api/admin/reasons/r1')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ active: false });

    expect(res.status).toBe(200);
    expect(updateReason).toHaveBeenCalledWith('r1', { name: undefined, active: false });
  });

  test('returns 400 when neither name nor active is provided', async () => {
    const res = await request(buildApp())
      .patch('/api/admin/reasons/r1')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({});
    expect(res.status).toBe(400);
    expect(updateReason).not.toHaveBeenCalled();
  });

  test('returns 400 when active is not a boolean', async () => {
    const res = await request(buildApp())
      .patch('/api/admin/reasons/r1')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ active: 'yes' });
    expect(res.status).toBe(400);
    expect(updateReason).not.toHaveBeenCalled();
  });

  test('returns 404 when the reason does not exist', async () => {
    updateReason.mockResolvedValue(null);
    const res = await request(buildApp())
      .patch('/api/admin/reasons/does-not-exist')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ name: 'X' });
    expect(res.status).toBe(404);
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .patch('/api/admin/reasons/r1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ name: 'X' });
    expect(res.status).toBe(403);
    expect(updateReason).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/api/reasons.routes.test.js src/api/admin-reasons.routes.test.js`
Expected: FAIL — modules don't exist yet

- [ ] **Step 3: Implement**

`src/api/reasons.routes.js`:
```js
const express = require('express');
const { requireAuth } = require('../auth/auth.middleware');
const { listActiveReasons } = require('../reasons/reason.repository');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  const reasons = await listActiveReasons();
  res.json(reasons);
});

module.exports = router;
```

`src/api/admin-reasons.routes.js`:
```js
const express = require('express');
const { requireAuth, requireRole } = require('../auth/auth.middleware');
const { listAllReasons, createReason, updateReason } = require('../reasons/reason.repository');

const router = express.Router();

router.get('/', requireAuth, requireRole('admin'), async (req, res) => {
  const reasons = await listAllReasons();
  res.json(reasons);
});

router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  const { name: rawName } = req.body || {};
  const name = (rawName || '').trim();
  if (!name) {
    return res.status(400).json({ error: 'name is required' });
  }
  const reason = await createReason({ name });
  res.status(201).json(reason);
});

router.patch('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const { name: rawName, active } = req.body || {};
  if (rawName === undefined && active === undefined) {
    return res.status(400).json({ error: 'name or active is required' });
  }
  let name;
  if (rawName !== undefined) {
    name = (rawName || '').trim();
    if (!name) {
      return res.status(400).json({ error: 'name must be a non-empty string' });
    }
  }
  if (active !== undefined && typeof active !== 'boolean') {
    return res.status(400).json({ error: 'active must be a boolean' });
  }
  const reason = await updateReason(req.params.id, { name, active });
  if (!reason) {
    return res.status(404).json({ error: 'Reason not found' });
  }
  res.json(reason);
});

module.exports = router;
```

In `src/server.js`, add two require lines near the other route requires (after
`adminAssignmentMessagesRoutes`, around line 30):
```js
const reasonsRoutes = require('./api/reasons.routes');
const adminReasonsRoutes = require('./api/admin-reasons.routes');
```
And two mount lines near the other `app.use('/api/...')` lines (after
`app.use('/api/admin/assignment-message', adminAssignmentMessagesRoutes);`, around
line 88):
```js
app.use('/api/reasons', reasonsRoutes);
app.use('/api/admin/reasons', adminReasonsRoutes);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/api/reasons.routes.test.js src/api/admin-reasons.routes.test.js`
Expected: PASS, all tests green

- [ ] **Step 5: Commit**

```bash
git add src/api/reasons.routes.js src/api/admin-reasons.routes.js src/api/reasons.routes.test.js src/api/admin-reasons.routes.test.js src/server.js
git commit -m "$(cat <<'EOF'
Add public and admin routes for contact reasons

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Record the reason on closeConversation

**Files:**
- Modify: `src/conversations/conversation.repository.js`
- Test: `src/conversations/conversation.repository.test.js`

**Interfaces:**
- Produces: `closeConversation(conversationId, agentId, reasonId)` — `reasonId` is a
  new third parameter, optional/nullable at this layer (see Global Constraints — the
  database column has no `NOT NULL`, so passing `undefined` here is valid and results
  in `reason_id = NULL`). Consumed by Task 5 (`conversations.routes.js`, which is what
  actually enforces the "reasonId is required" rule before calling this function).

**Important — minimal-diff scope:** this file's `closeConversation` is called from
roughly a dozen places elsewhere in `conversation.repository.test.js` for unrelated
setup (triage tests, sector-count fixtures, ordering tests, etc.) — grep the file for
`closeConversation(` to see them. Do **not** touch any of those call sites; they'll
keep calling `closeConversation(id, agentId)` with only two arguments, and that
continues to work exactly as before (`reasonId` is `undefined` → stored as `NULL`,
which is valid). Only add the one new test below.

- [ ] **Step 1: Write the failing test**

Add this test to the existing `describe('conversation repository', ...)` block, right
after the existing test `'closeConversation marks the conversation closed and records
who closed it'` (search for that exact string to find the spot):

```js
  test('closeConversation records the reason_id when one is passed', async () => {
    const conversation = await createConversation(contactId, channelId);
    const agent = await createAgent({ email: 'agent9e@dw.com', password: 'secret123', role: 'agent' });
    await claimConversation(conversation.id, agent.id);
    const reasonResult = await getPool().query(
      `INSERT INTO contact_reasons (name) VALUES ('Troca de senha') RETURNING id`
    );
    const reasonId = reasonResult.rows[0].id;

    await closeConversation(conversation.id, agent.id, reasonId);

    const events = await getPool().query(
      `SELECT reason_id FROM conversation_events WHERE conversation_id = $1 AND event_type = 'closed'`,
      [conversation.id]
    );
    expect(events.rows[0].reason_id).toBe(reasonId);
  });

  test('closeConversation leaves reason_id null when none is passed', async () => {
    const conversation = await createConversation(contactId, channelId);
    const agent = await createAgent({ email: 'agent9f@dw.com', password: 'secret123', role: 'agent' });
    await claimConversation(conversation.id, agent.id);

    await closeConversation(conversation.id, agent.id);

    const events = await getPool().query(
      `SELECT reason_id FROM conversation_events WHERE conversation_id = $1 AND event_type = 'closed'`,
      [conversation.id]
    );
    expect(events.rows[0].reason_id).toBeNull();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/conversations/conversation.repository.test.js -t "reason_id"`
Expected: FAIL — `reason_id` is never inserted, both assertions fail (first test:
`undefined` !== the real id; second test technically already passes since the column
starts out unselected — run it anyway to lock in the behavior before and after)

- [ ] **Step 3: Implement**

In `src/conversations/conversation.repository.js`, modify `closeConversation`'s
signature and its `INSERT INTO conversation_events` call:

```js
async function closeConversation(conversationId, agentId, reasonId) {
  return withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE conversations SET status = 'closed', updated_at = now()
       WHERE id = $1 AND (assigned_agent_id = $2 OR assigned_agent_id IS NULL) AND status <> 'closed'
       RETURNING id, contact_id, channel_id, status, assigned_agent_id, sector_id, triage_state, triage_attempts, protocol_number, created_at, updated_at`,
      [conversationId, agentId]
    );
    if (result.rowCount === 0) return null;
    await client.query(
      `INSERT INTO conversation_events (conversation_id, event_type, from_agent_id, reason_id) VALUES ($1, 'closed', $2, $3)`,
      [conversationId, agentId, reasonId]
    );
    return toConversation(result.rows[0]);
  });
}
```

Do not modify any other function in this file.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/conversations/conversation.repository.test.js`
Expected: PASS, all tests green (including the dozen pre-existing `closeConversation`
call sites elsewhere in the file — they pass `reasonId` as `undefined` implicitly and
must keep passing unchanged)

- [ ] **Step 5: Commit**

```bash
git add src/conversations/conversation.repository.js src/conversations/conversation.repository.test.js
git commit -m "$(cat <<'EOF'
Record the reason_id on the closed conversation_events row

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Require and validate reasonId on POST /:id/close

**Files:**
- Modify: `src/api/conversations.routes.js`
- Test: `src/api/conversations.routes.test.js`

**Interfaces:**
- Consumes: `findReasonById` from `../reasons/reason.repository` (Task 2);
  `closeConversation(conversationId, agentId, reasonId)` (Task 4).
- Produces: `POST /:id/close` now requires `{ reasonId }` in the body: `400` if
  missing, `400` if the reason doesn't exist or is inactive, otherwise proceeds exactly
  as before. Consumed by Task 8 (frontend `ConversationView.jsx`/`CloseReasonModal`).

**Important — this task's test diff is large and unavoidable, unlike Task 4's.**
Every existing test in `describe('POST /api/conversations/:id/close', ...)` (8 tests,
none of which currently send a request body) will now hit the new 400 `reasonId is
required` guard before ever reaching `closeConversation`. Every one of them needs
`.send({ reasonId: 'reason-1' })` added, and the block needs `findReasonById` mocked
to resolve to an active reason by default.

- [ ] **Step 1: Update the test file**

At the top of `src/api/conversations.routes.test.js`, add a new mock alongside the
existing ones (near `jest.mock('../assignment-messages/assignment-message.service');`):
```js
jest.mock('../reasons/reason.repository');
```
And import it alongside the other imports:
```js
const { findReasonById } = require('../reasons/reason.repository');
```

Replace the entire `describe('POST /api/conversations/:id/close', ...)` block (search
for that exact string) with:

```js
describe('POST /api/conversations/:id/close', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    findReasonById.mockResolvedValue({ id: 'reason-1', name: 'Troca de senha', active: true });
  });

  test('closes an open conversation', async () => {
    closeConversation.mockResolvedValue({ id: 'conv-1', status: 'closed' });
    const res = await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/close`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ reasonId: 'reason-1' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('closed');
    expect(closeConversation).toHaveBeenCalledWith(CONVERSATION_ID, 'agent-1', 'reason-1');
  });

  test('returns 400 when reasonId is missing', async () => {
    const res = await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/close`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({});
    expect(res.status).toBe(400);
    expect(closeConversation).not.toHaveBeenCalled();
  });

  test('returns 400 when the reason does not exist', async () => {
    findReasonById.mockResolvedValue(null);
    const res = await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/close`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ reasonId: 'does-not-exist' });
    expect(res.status).toBe(400);
    expect(closeConversation).not.toHaveBeenCalled();
  });

  test('returns 400 when the reason is inactive', async () => {
    findReasonById.mockResolvedValue({ id: 'reason-1', name: 'Antigo', active: false });
    const res = await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/close`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ reasonId: 'reason-1' });
    expect(res.status).toBe(400);
    expect(closeConversation).not.toHaveBeenCalled();
  });

  test('returns 409 when the conversation is not assigned to the caller, does not exist, or is already closed', async () => {
    closeConversation.mockResolvedValue(null);
    const res = await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/close`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ reasonId: 'reason-1' });
    expect(res.status).toBe(409);
  });

  test('notifies the assigned agent when closing an assigned conversation', async () => {
    closeConversation.mockResolvedValue({ id: 'conv-1', status: 'closed', assignedAgentId: 'agent-1' });
    await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/close`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ reasonId: 'reason-1' });
    expect(emitToAgent).toHaveBeenCalledWith('agent-1', 'conversation:closed', { conversationId: 'conv-1' });
    expect(broadcast).not.toHaveBeenCalled();
  });

  test('broadcasts queue:removed when closing a conversation that was never assigned', async () => {
    closeConversation.mockResolvedValue({ id: 'conv-1', status: 'closed', assignedAgentId: null });
    await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/close`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ reasonId: 'reason-1' });
    expect(broadcast).toHaveBeenCalledWith('queue:removed', { conversationId: 'conv-1' });
    expect(emitToAgent).not.toHaveBeenCalled();
  });

  test('also broadcasts dashboard:conversation with a closedAt timestamp on a successful close', async () => {
    closeConversation.mockResolvedValue({ id: 'conv-1', status: 'closed', assignedAgentId: 'agent-1' });
    getConversationWithContact.mockResolvedValue({ id: 'conv-1', status: 'closed', assignedAgentId: 'agent-1' });
    await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/close`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ reasonId: 'reason-1' });
    expect(broadcastToDashboard).toHaveBeenCalledWith(
      'dashboard:conversation',
      expect.objectContaining({
        conversation: { id: 'conv-1', status: 'closed', assignedAgentId: 'agent-1' },
        closedAt: expect.any(String),
      })
    );
  });

  test('calls sendClosingMessageIfApplicable with the closed conversation and agent id', async () => {
    const closedConversation = { id: 'conv-1', status: 'closed', assignedAgentId: 'agent-1', channelId: 'channel-1', protocolNumber: 1042 };
    closeConversation.mockResolvedValue(closedConversation);
    await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/close`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ reasonId: 'reason-1' });
    expect(sendClosingMessageIfApplicable).toHaveBeenCalledWith(closedConversation, 'agent-1');
  });

  test('does not call sendClosingMessageIfApplicable when the close fails', async () => {
    closeConversation.mockResolvedValue(null);
    await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/close`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ reasonId: 'reason-1' });
    expect(sendClosingMessageIfApplicable).not.toHaveBeenCalled();
  });

  test('a failure inside sendClosingMessageIfApplicable does not break the 200 response', async () => {
    const closedConversation = { id: 'conv-1', status: 'closed', assignedAgentId: 'agent-1', channelId: 'channel-1', protocolNumber: 1042 };
    closeConversation.mockResolvedValue(closedConversation);
    sendClosingMessageIfApplicable.mockRejectedValue(new Error('boom'));
    const res = await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/close`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ reasonId: 'reason-1' });
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/api/conversations.routes.test.js -t "close"`
Expected: FAIL — the route doesn't validate/require `reasonId` yet, so the new 400
tests fail and `closeConversation` is called without a `reasonId` argument

- [ ] **Step 3: Implement**

In `src/api/conversations.routes.js`, add the import near the other repository
imports (after `sendOpeningMessageIfApplicable`/`sendClosingMessageIfApplicable`):
```js
const { findReasonById } = require('../reasons/reason.repository');
```

Replace `router.post('/:id/close', ...)`:
```js
router.post('/:id/close', async (req, res) => {
  const { reasonId } = req.body || {};
  if (!reasonId) {
    return res.status(400).json({ error: 'reasonId is required' });
  }
  const reason = await findReasonById(reasonId);
  if (!reason || !reason.active) {
    return res.status(400).json({ error: 'Invalid or inactive reasonId' });
  }
  const conversation = await closeConversation(req.params.id, req.agent.agentId, reasonId);
  if (!conversation) {
    return res.status(409).json({ error: 'Conversation is not currently assigned to you, or is closed' });
  }
  try {
    await sendClosingMessageIfApplicable(conversation, req.agent.agentId);
  } catch (err) {
    console.error(`Failed to send assignment closing message for conversation ${conversation.id}`, err);
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
```

Do not touch any other route handler in this file.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/api/conversations.routes.test.js`
Expected: PASS, all tests green (run the full file, not just the close tests — this
file is shared and Task 6 of the assignment-message feature already touched it once)

- [ ] **Step 5: Commit**

```bash
git add src/api/conversations.routes.js src/api/conversations.routes.test.js
git commit -m "$(cat <<'EOF'
Require and validate reasonId when closing a conversation

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Frontend API functions and hooks for reasons

**Files:**
- Modify: `frontend/src/services/api.js`
- Create: `frontend/src/hooks/useReasons.js`
- Create: `frontend/src/hooks/useReasonsAdmin.js`
- Test: `frontend/src/hooks/useReasons.test.jsx`
- Test: `frontend/src/hooks/useReasonsAdmin.test.jsx`

**Interfaces:**
- Produces: `closeConversation(conversationId, reasonId, token)` (signature change —
  `reasonId` inserted as the second parameter); `listReasons(token)`,
  `listReasonsAdmin(token)`, `createReason(payload, token)`,
  `updateReason(id, payload, token)` in `services/api.js`; `useReasons()` →
  `{ reasons, loading, refresh }` (active only, via `listReasons`);
  `useReasonsAdmin()` → same shape (all, via `listReasonsAdmin`). Consumed by Task 7
  (`CloseReasonModal`), Task 8 (`ConversationView.jsx`), Task 9 (`ReasonsAdminTab`).

**Important:** `closeConversation`'s existing callers must be updated at the same time
this signature changes, or the build breaks. Grep the frontend for
`closeConversation(` before finishing this task — as of this plan, the only caller is
`ConversationView.jsx`, which Task 8 updates. Do not update `ConversationView.jsx` in
this task; just be aware Task 8 depends on this exact new signature.

- [ ] **Step 1: Write the failing tests**

`frontend/src/hooks/useReasons.test.jsx`:
```jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useReasons } from './useReasons';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
});

describe('useReasons', () => {
  test('fetches active reasons on mount', async () => {
    api.listReasons.mockResolvedValue([{ id: 'r1', name: 'Troca de senha', active: true }]);

    const { result } = renderHook(() => useReasons());

    await waitFor(() => expect(result.current.reasons).toEqual([{ id: 'r1', name: 'Troca de senha', active: true }]));
    expect(api.listReasons).toHaveBeenCalledWith('tok-123');
  });

  test('refresh refetches the list', async () => {
    api.listReasons.mockResolvedValue([]);
    const { result } = renderHook(() => useReasons());
    await waitFor(() => expect(api.listReasons).toHaveBeenCalledTimes(1));

    api.listReasons.mockResolvedValue([{ id: 'r2', name: 'Pagamento', active: true }]);
    await act(() => result.current.refresh());

    expect(result.current.reasons).toEqual([{ id: 'r2', name: 'Pagamento', active: true }]);
  });
});
```

`frontend/src/hooks/useReasonsAdmin.test.jsx`:
```jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useReasonsAdmin } from './useReasonsAdmin';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
});

describe('useReasonsAdmin', () => {
  test('fetches all reasons on mount, including inactive ones', async () => {
    api.listReasonsAdmin.mockResolvedValue([
      { id: 'r1', name: 'Ativo', active: true },
      { id: 'r2', name: 'Inativo', active: false },
    ]);

    const { result } = renderHook(() => useReasonsAdmin());

    await waitFor(() => expect(result.current.reasons).toHaveLength(2));
    expect(api.listReasonsAdmin).toHaveBeenCalledWith('tok-123');
  });

  test('refresh refetches the list', async () => {
    api.listReasonsAdmin.mockResolvedValue([]);
    const { result } = renderHook(() => useReasonsAdmin());
    await waitFor(() => expect(api.listReasonsAdmin).toHaveBeenCalledTimes(1));

    api.listReasonsAdmin.mockResolvedValue([{ id: 'r3', name: 'Nova', active: true }]);
    await act(() => result.current.refresh());

    expect(result.current.reasons).toEqual([{ id: 'r3', name: 'Nova', active: true }]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/hooks/useReasons.test.jsx src/hooks/useReasonsAdmin.test.jsx`
Expected: FAIL — modules don't exist yet

- [ ] **Step 3: Implement**

In `frontend/src/services/api.js`, find the existing `closeConversation` function:
```js
export function closeConversation(conversationId, token) {
  return apiFetch(`/api/conversations/${conversationId}/close`, { method: 'POST', token });
}
```
Replace it with:
```js
export function closeConversation(conversationId, reasonId, token) {
  return apiFetch(`/api/conversations/${conversationId}/close`, { method: 'POST', body: { reasonId }, token });
}
```

Add four new functions near `listSectors`/`createSector`/`updateSector` (same file,
any convenient spot alongside those):
```js
export function listReasons(token) {
  return apiFetch('/api/reasons', { token });
}

export function listReasonsAdmin(token) {
  return apiFetch('/api/admin/reasons', { token });
}

export function createReason(payload, token) {
  return apiFetch('/api/admin/reasons', { method: 'POST', body: payload, token });
}

export function updateReason(id, payload, token) {
  return apiFetch(`/api/admin/reasons/${id}`, { method: 'PATCH', body: payload, token });
}
```

Create `frontend/src/hooks/useReasons.js`:
```js
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { listReasons } from '../services/api';

export function useReasons() {
  const { token } = useAuth();
  const [reasons, setReasons] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    if (!token) return Promise.resolve();
    setLoading(true);
    return listReasons(token)
      .then((data) => {
        setReasons(data);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, [token]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { reasons, loading, refresh };
}
```

Create `frontend/src/hooks/useReasonsAdmin.js` (identical, using `listReasonsAdmin`):
```js
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { listReasonsAdmin } from '../services/api';

export function useReasonsAdmin() {
  const { token } = useAuth();
  const [reasons, setReasons] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    if (!token) return Promise.resolve();
    setLoading(true);
    return listReasonsAdmin(token)
      .then((data) => {
        setReasons(data);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, [token]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { reasons, loading, refresh };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/hooks/useReasons.test.jsx src/hooks/useReasonsAdmin.test.jsx`
Expected: PASS, all tests green

Note: `frontend/src/services/api.test.js` and `frontend/src/components/ConversationView.test.jsx`
will now fail to compile/run cleanly against the changed `closeConversation` signature
— that's expected and out of scope for this task; `ConversationView.test.jsx` is
rewritten in Task 8. Do not fix it here.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/api.js frontend/src/hooks/useReasons.js frontend/src/hooks/useReasonsAdmin.js frontend/src/hooks/useReasons.test.jsx frontend/src/hooks/useReasonsAdmin.test.jsx
git commit -m "$(cat <<'EOF'
Add frontend API functions and hooks for contact reasons

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: CloseReasonModal

**Files:**
- Create: `frontend/src/components/CloseReasonModal.jsx`
- Test: `frontend/src/components/CloseReasonModal.test.jsx`

**Interfaces:**
- Consumes: `useReasons()` (Task 6); `WaDialog`, `waPrimaryButtonClass`,
  `waGhostButtonClass`, `waErrorClass` from `./WaDialog` (existing — this is the
  WhatsApp-styled dialog shell already used inside `ConversationView`, not the
  glass-card `WaDialog` used on admin screens, though it's the same component/file:
  `WaDialog` is styled via the WhatsApp design tokens either way).
- Produces: `<CloseReasonModal onConfirm={(reasonId) => Promise} onClose={() => void} />`.
  `onConfirm` is awaited; if it rejects, the modal shows the error inline and stays
  open. Consumed by Task 8 (`ConversationView.jsx`).

- [ ] **Step 1: Write the failing tests**

```jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CloseReasonModal from './CloseReasonModal';
import { useReasons } from '../hooks/useReasons';

vi.mock('../hooks/useReasons');

beforeEach(() => {
  vi.clearAllMocks();
  useReasons.mockReturnValue({
    reasons: [
      { id: 'r1', name: 'Troca de senha', active: true },
      { id: 'r2', name: 'Pagamento - sem conexão', active: true },
    ],
    loading: false,
    refresh: vi.fn(),
  });
});

describe('CloseReasonModal', () => {
  test('lists the active reasons as radio options', () => {
    render(<CloseReasonModal onConfirm={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByLabelText('Troca de senha')).toBeInTheDocument();
    expect(screen.getByLabelText('Pagamento - sem conexão')).toBeInTheDocument();
  });

  test('the confirm button is disabled until a reason is selected', async () => {
    render(<CloseReasonModal onConfirm={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: /confirmar encerramento/i })).toBeDisabled();

    await userEvent.click(screen.getByLabelText('Troca de senha'));

    expect(screen.getByRole('button', { name: /confirmar encerramento/i })).not.toBeDisabled();
  });

  test('clicking confirm calls onConfirm with the selected reason id', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<CloseReasonModal onConfirm={onConfirm} onClose={vi.fn()} />);

    await userEvent.click(screen.getByLabelText('Pagamento - sem conexão'));
    await userEvent.click(screen.getByRole('button', { name: /confirmar encerramento/i }));

    expect(onConfirm).toHaveBeenCalledWith('r2');
  });

  test('shows an inline error and keeps the modal open when onConfirm fails', async () => {
    const onConfirm = vi.fn().mockRejectedValue({ body: { error: 'Conversation is not currently assigned to you, or is closed' } });
    const onClose = vi.fn();
    render(<CloseReasonModal onConfirm={onConfirm} onClose={onClose} />);

    await userEvent.click(screen.getByLabelText('Troca de senha'));
    await userEvent.click(screen.getByRole('button', { name: /confirmar encerramento/i }));

    expect(await screen.findByText('Conversation is not currently assigned to you, or is closed')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  test('clicking Cancelar calls onClose', async () => {
    const onClose = vi.fn();
    render(<CloseReasonModal onConfirm={vi.fn()} onClose={onClose} />);

    await userEvent.click(screen.getByRole('button', { name: /cancelar/i }));

    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/CloseReasonModal.test.jsx`
Expected: FAIL with "Failed to resolve import './CloseReasonModal'"

- [ ] **Step 3: Implement**

```jsx
import { useState } from 'react';
import WaDialog, { waPrimaryButtonClass, waGhostButtonClass, waErrorClass } from './WaDialog';
import { useReasons } from '../hooks/useReasons';

function CloseReasonModal({ onConfirm, onClose }) {
  const { reasons } = useReasons();
  const [reasonId, setReasonId] = useState(null);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleConfirm() {
    if (!reasonId) return;
    setError(null);
    setSubmitting(true);
    try {
      await onConfirm(reasonId);
    } catch (err) {
      setError((err.body && err.body.error) || 'Não foi possível encerrar este atendimento.');
      setSubmitting(false);
    }
  }

  return (
    <WaDialog title="Motivo do contato" description="Escolha o motivo antes de encerrar o atendimento." onClose={onClose}>
      <div className="space-y-2 px-6 py-4">
        {reasons.map((reason) => (
          <label key={reason.id} className="flex items-center gap-2 text-[14.5px] text-wa-text">
            <input
              type="radio"
              name="close-reason"
              checked={reasonId === reason.id}
              onChange={() => setReasonId(reason.id)}
              className="h-4 w-4 accent-wa-green"
            />
            {reason.name}
          </label>
        ))}
        {error && <p className={waErrorClass}>{error}</p>}
      </div>
      <div className="flex shrink-0 justify-end gap-2 px-4 py-3">
        <button type="button" onClick={onClose} className={waGhostButtonClass}>
          Cancelar
        </button>
        <button type="button" onClick={handleConfirm} disabled={!reasonId || submitting} className={waPrimaryButtonClass}>
          Confirmar encerramento
        </button>
      </div>
    </WaDialog>
  );
}

export default CloseReasonModal;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/CloseReasonModal.test.jsx`
Expected: PASS, all tests green

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/CloseReasonModal.jsx frontend/src/components/CloseReasonModal.test.jsx
git commit -m "$(cat <<'EOF'
Add the mandatory close-reason popup

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Wire the popup into ConversationView

**Files:**
- Modify: `frontend/src/components/ConversationView.jsx`
- Modify: `frontend/src/components/ConversationView.test.jsx`

**Interfaces:**
- Consumes: `CloseReasonModal` (Task 7); `closeConversation(conversationId, reasonId, token)`
  (Task 6's new signature).

- [ ] **Step 1: Update the test file**

Add the import and mock near the other hook mocks at the top of
`frontend/src/components/ConversationView.test.jsx`:
```js
import { useReasons } from '../hooks/useReasons';
```
```js
vi.mock('../hooks/useReasons');
```
Add a default mock in the top-level `beforeEach`, alongside the existing
`useSgpLookup.mockReturnValue(...)`:
```js
  useReasons.mockReturnValue({
    reasons: [{ id: 'r1', name: 'Troca de senha', active: true }],
    loading: false,
    refresh: vi.fn(),
  });
```

Replace these three existing tests (search for each exact string):

`'clicking Fechar calls closeConversation'`:
```jsx
  test('clicking Fechar opens the reason popup, and confirming calls closeConversation', async () => {
    api.closeConversation.mockResolvedValue({});
    render(
      <ConversationView
        conversation={{ id: 'c1', status: 'assigned', assignedAgentId: 'agent-1' }}
        onTransferClick={vi.fn()}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: /fechar/i }));

    expect(screen.getByText('Motivo do contato')).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Troca de senha'));
    await userEvent.click(screen.getByRole('button', { name: /confirmar encerramento/i }));

    await waitFor(() => expect(api.closeConversation).toHaveBeenCalledWith('c1', 'r1', 'tok-123'));
  });
```

`'clicking Fechar on a waiting conversation calls closeConversation'`:
```jsx
  test('clicking Fechar on a waiting conversation opens the popup too', async () => {
    api.closeConversation.mockResolvedValue({});
    render(
      <ConversationView
        conversation={{ id: 'c1', status: 'waiting', assignedAgentId: null }}
        onTransferClick={vi.fn()}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: /fechar/i }));
    await userEvent.click(screen.getByLabelText('Troca de senha'));
    await userEvent.click(screen.getByRole('button', { name: /confirmar encerramento/i }));

    await waitFor(() => expect(api.closeConversation).toHaveBeenCalledWith('c1', 'r1', 'tok-123'));
  });
```

`'shows an alert with the backend error when closing fails'`:
```jsx
  test('shows the backend error inline in the popup when closing fails, without using window.alert', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    api.closeConversation.mockRejectedValue({ body: { error: 'Conversation is not currently assigned to you, or is closed' } });
    render(
      <ConversationView
        conversation={{ id: 'c1', status: 'waiting', assignedAgentId: null }}
        onTransferClick={vi.fn()}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: /fechar/i }));
    await userEvent.click(screen.getByLabelText('Troca de senha'));
    await userEvent.click(screen.getByRole('button', { name: /confirmar encerramento/i }));

    expect(await screen.findByText('Conversation is not currently assigned to you, or is closed')).toBeInTheDocument();
    expect(alertSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/ConversationView.test.jsx`
Expected: FAIL — the popup doesn't exist in the component yet, so
`screen.getByText('Motivo do contato')` and `screen.getByLabelText('Troca de senha')`
don't find anything

- [ ] **Step 3: Implement**

In `frontend/src/components/ConversationView.jsx`, add the import near the other
component imports:
```js
import CloseReasonModal from './CloseReasonModal';
```

Find the existing `handleClose` function (around line 142-148):
```js
  async function handleClose() {
    try {
      await closeConversation(conversation.id, token);
    } catch (err) {
      window.alert((err.body && err.body.error) || 'Não foi possível fechar este atendimento.');
    }
  }
```
Replace it with a state flag and a confirm handler:
```js
  const [closingReason, setClosingReason] = useState(false);

  async function handleConfirmClose(reasonId) {
    await closeConversation(conversation.id, reasonId, token);
    setClosingReason(false);
  }
```
(`useState` is already imported in this file — check the top-of-file import line and
add `closingReason`/`setClosingReason` to whatever destructuring/hook calls already
exist there; if the file imports `{ useState }` from `'react'` already, just add
another `useState` call, don't add a duplicate import.)

Find the button `<HeaderIconButton label="Fechar atendimento" onClick={handleClose}>`
(around line 200) and change its `onClick`:
```jsx
<HeaderIconButton label="Fechar atendimento" onClick={() => setClosingReason(true)}>
```

Near the end of the component's JSX, alongside the other conditionally-rendered
popups (`ConversationHistoryModal`, etc.), add:
```jsx
{closingReason && <CloseReasonModal onConfirm={handleConfirmClose} onClose={() => setClosingReason(false)} />}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/ConversationView.test.jsx`
Expected: PASS, all tests green (run the full file — it has ~20 other tests unrelated
to closing that must keep passing unchanged)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ConversationView.jsx frontend/src/components/ConversationView.test.jsx
git commit -m "$(cat <<'EOF'
Require a reason before closing a conversation in ConversationView

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Reasons admin tab

**Files:**
- Create: `frontend/src/components/ReasonsAdminTab.jsx`
- Create: `frontend/src/components/CreateReasonForm.jsx`
- Test: `frontend/src/components/ReasonsAdminTab.test.jsx`
- Modify: `frontend/src/pages/AdminChannelsPage.jsx`
- Modify: `frontend/src/pages/AdminChannelsPage.test.jsx`

**Interfaces:**
- Consumes: `useReasonsAdmin()`, `updateReason(id, payload, token)`,
  `createReason(payload, token)` (Task 6).

- [ ] **Step 1: Write the failing tests**

`frontend/src/components/ReasonsAdminTab.test.jsx`:
```jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReasonsAdminTab from './ReasonsAdminTab';
import { useReasonsAdmin } from '../hooks/useReasonsAdmin';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../hooks/useReasonsAdmin');
vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
});

describe('ReasonsAdminTab', () => {
  test('lists existing reasons', () => {
    useReasonsAdmin.mockReturnValue({
      reasons: [{ id: 'r1', name: 'Troca de senha', active: true }],
      refresh: vi.fn(),
    });
    render(<ReasonsAdminTab />);
    expect(screen.getByText('Troca de senha')).toBeInTheDocument();
  });

  test('creating a reason calls createReason and refreshes', async () => {
    const refresh = vi.fn();
    useReasonsAdmin.mockReturnValue({ reasons: [], refresh });
    api.createReason.mockResolvedValue({ id: 'r1', name: 'Pagamento', active: true });
    render(<ReasonsAdminTab />);

    await userEvent.type(screen.getByLabelText(/nome/i), 'Pagamento');
    await userEvent.click(screen.getByRole('button', { name: /cadastrar/i }));

    expect(api.createReason).toHaveBeenCalledWith({ name: 'Pagamento' }, 'tok-123');
    expect(refresh).toHaveBeenCalled();
  });

  test('toggling active calls updateReason with the flipped value and refreshes', async () => {
    const refresh = vi.fn();
    useReasonsAdmin.mockReturnValue({
      reasons: [{ id: 'r1', name: 'Troca de senha', active: true }],
      refresh,
    });
    api.updateReason.mockResolvedValue({ id: 'r1', name: 'Troca de senha', active: false });
    render(<ReasonsAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /desativar/i }));

    expect(api.updateReason).toHaveBeenCalledWith('r1', { active: false }, 'tok-123');
    expect(refresh).toHaveBeenCalled();
  });

  test('shows Ativar for an inactive reason', () => {
    useReasonsAdmin.mockReturnValue({
      reasons: [{ id: 'r1', name: 'Antigo', active: false }],
      refresh: vi.fn(),
    });
    render(<ReasonsAdminTab />);
    expect(screen.getByRole('button', { name: /ativar/i })).toBeInTheDocument();
  });

  test('editing a reason calls updateReason with the new name and refreshes', async () => {
    const refresh = vi.fn();
    useReasonsAdmin.mockReturnValue({
      reasons: [{ id: 'r1', name: 'Original', active: true }],
      refresh,
    });
    api.updateReason.mockResolvedValue({ id: 'r1', name: 'Editado', active: true });
    render(<ReasonsAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /editar/i }));
    const input = screen.getByDisplayValue('Original');
    await userEvent.clear(input);
    await userEvent.type(input, 'Editado');
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));

    expect(api.updateReason).toHaveBeenCalledWith('r1', { name: 'Editado' }, 'tok-123');
    expect(refresh).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/ReasonsAdminTab.test.jsx`
Expected: FAIL — modules don't exist yet

- [ ] **Step 3: Implement**

`frontend/src/components/CreateReasonForm.jsx` (mirror of `CreateSectorForm.jsx`):
```jsx
import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { createReason } from '../services/api';

const inputClass =
  'w-full rounded-xl border border-ink-950/15 bg-white/60 px-3.5 py-2.5 text-ink-950 placeholder-ink-950/35 outline-none transition focus:border-teal-signal/60 focus:bg-white/90 focus:ring-2 focus:ring-teal-signal/25';
const labelClass = 'mb-1.5 block text-sm font-medium text-ink-950/70';

function CreateReasonForm({ onCreated }) {
  const { token } = useAuth();
  const [name, setName] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await createReason({ name }, token);
      setName('');
      onCreated();
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao cadastrar motivo');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-3 rounded-2xl border border-white/70 bg-white/50 p-6 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)] backdrop-blur-xl"
    >
      <h3 className="font-display text-base font-semibold text-ink-950">Cadastrar novo motivo</h3>
      <div>
        <label htmlFor="reason-name" className={labelClass}>
          Nome
        </label>
        <input id="reason-name" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} required />
      </div>
      {error && <p className="rounded-lg border border-red-300 bg-red-50/80 px-3 py-2 text-sm text-red-700">{error}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="rounded-xl bg-gradient-to-r from-amber-signal to-amber-signal-dark px-4 py-2.5 font-medium text-ink-950 shadow-[0_10px_30px_-8px_rgba(242,169,60,0.5)] transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-signal/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        Cadastrar
      </button>
    </form>
  );
}

export default CreateReasonForm;
```

`frontend/src/components/ReasonsAdminTab.jsx` (mirror of `SectorsAdminTab.jsx`, with a
toggle instead of delete):
```jsx
import { useState } from 'react';
import { useReasonsAdmin } from '../hooks/useReasonsAdmin';
import { useAuth } from '../contexts/AuthContext';
import { updateReason } from '../services/api';
import CreateReasonForm from './CreateReasonForm';

const inputClass =
  'w-full rounded-xl border border-ink-950/15 bg-white/60 px-3.5 py-2.5 text-ink-950 placeholder-ink-950/35 outline-none transition focus:border-teal-signal/60 focus:bg-white/90 focus:ring-2 focus:ring-teal-signal/25';

function ReasonRow({ reason, onSaved }) {
  const { token } = useAuth();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(reason.name);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [toggling, setToggling] = useState(false);

  async function handleSave(event) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await updateReason(reason.id, { name }, token);
      setEditing(false);
      onSaved();
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao salvar');
    } finally {
      setSubmitting(false);
    }
  }

  function handleEditClick() {
    setName(reason.name);
    setError(null);
    setEditing(true);
  }

  function handleCancel() {
    setName(reason.name);
    setError(null);
    setEditing(false);
  }

  async function handleToggleActive() {
    setToggling(true);
    try {
      await updateReason(reason.id, { active: !reason.active }, token);
      onSaved();
    } finally {
      setToggling(false);
    }
  }

  if (editing) {
    return (
      <form
        onSubmit={handleSave}
        className="space-y-2 rounded-2xl border border-white/70 bg-white/50 p-4 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)] backdrop-blur-xl"
      >
        <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} required />
        {error && <p className="rounded-lg border border-red-300 bg-red-50/80 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-teal-signal px-3 py-1.5 text-sm font-medium text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Salvar
          </button>
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-lg border border-ink-950/15 bg-white/50 px-3 py-1.5 text-sm font-medium text-ink-950/70 transition hover:bg-white/80 hover:text-ink-950"
          >
            Cancelar
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="rounded-2xl border border-white/70 bg-white/50 p-4 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)] backdrop-blur-xl">
      <div className="flex items-center justify-between">
        <p className="font-medium text-ink-950">{reason.name}</p>
        <div className="flex items-center gap-3">
          <button onClick={handleEditClick} className="text-sm font-medium text-teal-signal hover:text-teal-signal/80 hover:underline">
            Editar
          </button>
          <button
            onClick={handleToggleActive}
            disabled={toggling}
            className="text-sm font-medium text-ink-950/60 hover:text-ink-950 hover:underline disabled:opacity-50"
          >
            {reason.active ? 'Desativar' : 'Ativar'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ReasonsAdminTab() {
  const { reasons, refresh } = useReasonsAdmin();

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        {reasons.map((reason) => (
          <ReasonRow key={reason.id} reason={reason} onSaved={refresh} />
        ))}
      </div>
      <CreateReasonForm onCreated={refresh} />
    </div>
  );
}

export default ReasonsAdminTab;
```

In `frontend/src/pages/AdminChannelsPage.jsx`, add the import:
```js
import ReasonsAdminTab from '../components/ReasonsAdminTab';
```
Add an entry to `TABS` (any position is fine; put it after `'sectors'` since both are
conversation-categorization concepts):
```js
  { value: 'sectors', label: 'Setores' },
  { value: 'reasons', label: 'Motivos' },
```
Add a render branch:
```jsx
        ) : activeTab === 'sectors' ? (
          <SectorsAdminTab />
        ) : activeTab === 'reasons' ? (
          <ReasonsAdminTab />
        ) : activeTab === 'cities' ? (
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/ReasonsAdminTab.test.jsx`
Expected: PASS, all tests green

Now check `frontend/src/pages/AdminChannelsPage.test.jsx` — this file renders child
admin-tab components for real (unmocked) when switching tabs, a recurring pattern
already seen several times this session. Run:
`cd frontend && npx vitest run src/pages/AdminChannelsPage.test.jsx`
If it fails because `useReasonsAdmin` is unmocked and crashes on render, add
`vi.mock('../hooks/useReasonsAdmin')` alongside this file's other hook mocks and a
default `useReasonsAdmin.mockReturnValue({ reasons: [], refresh: vi.fn() })` in its
`beforeEach`, matching the exact pattern already used there for `useTemplates`. If it
already passes with no changes, that's a valid outcome — note it and move on.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ReasonsAdminTab.jsx frontend/src/components/CreateReasonForm.jsx frontend/src/components/ReasonsAdminTab.test.jsx frontend/src/pages/AdminChannelsPage.jsx frontend/src/pages/AdminChannelsPage.test.jsx
git commit -m "$(cat <<'EOF'
Add the Motivos admin tab

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

(If Step 4's check found `AdminChannelsPage.test.jsx` needed no change, omit it from
the `git add` — only stage files you actually modified.)

---

### Task 10: Metrics by reason

**Files:**
- Modify: `src/metrics/metrics.repository.js`
- Modify: `src/api/metrics.routes.js`
- Test: `src/metrics/metrics.repository.test.js`
- Test: `src/api/metrics.routes.test.js`

**Interfaces:**
- Produces: `getMetricsByReason(since)` → `Promise<{reasonId, reasonName, closedCount}[]>`,
  ordered by `closedCount` descending. `GET /api/metrics` (admin scope) response
  gains a `byReason` array alongside `byAgent`/`bySector`. Consumed by Task 11
  (`MetricsPage.jsx`).

- [ ] **Step 1: Write the failing tests**

Add to `src/metrics/metrics.repository.test.js`: import `createReason` from
`../reasons/reason.repository` and `getMetricsByReason` from `./metrics.repository`
alongside the existing imports. Update the `TRUNCATE` in `beforeEach` to also include
`contact_reasons`:
```js
    await getPool().query(
      'TRUNCATE messages, conversation_events, conversations, contacts, channels, agent_sectors, sectors, contact_reasons, agents CASCADE'
    );
```
Extend the `seedClosedConversation` helper to accept an optional `reasonId` and pass
it into the `'closed'` event insert:
```js
async function seedClosedConversation({ channelId, contactId, agentId, startedAt, closedAt, firstResponseAt, assignedAt, reasonId }) {
  const conv = await getPool().query(
    `INSERT INTO conversations (contact_id, channel_id, status, assigned_agent_id, created_at, updated_at)
     VALUES ($1, $2, 'closed', $3, $4, $4) RETURNING id`,
    [contactId, channelId, agentId, startedAt]
  );
  const conversationId = conv.rows[0].id;
  await getPool().query(
    `INSERT INTO conversation_events (conversation_id, event_type, to_agent_id, created_at)
     VALUES ($1, 'assigned', $2, $3)`,
    [conversationId, agentId, assignedAt || startedAt]
  );
  await getPool().query(
    `INSERT INTO conversation_events (conversation_id, event_type, from_agent_id, reason_id, created_at)
     VALUES ($1, 'closed', $2, $3, $4)`,
    [conversationId, agentId, reasonId || null, closedAt]
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
```
(This is a pure addition — every existing call site that doesn't pass `reasonId`
keeps working exactly as before, since `reasonId || null` covers `undefined`.)

Add these tests inside the existing `describe('metrics repository', ...)` block, after
the `getMetricsBySector` tests:
```js
  test('getMetricsByReason counts closed conversations per reason, ordered by frequency', async () => {
    const agent = await createAgent({ email: 'metrics-reason1@dw.com', password: 'secret123', role: 'agent' });
    const channelId = await seedChannel();
    const senha = await createReason({ name: 'Troca de senha' });
    const pagamento = await createReason({ name: 'Pagamento' });

    await seedClosedConversation({
      channelId, contactId: await seedContact(), agentId: agent.id,
      startedAt: new Date('2026-01-02T10:00:00Z'), closedAt: new Date('2026-01-02T10:30:00Z'),
      reasonId: senha.id,
    });
    await seedClosedConversation({
      channelId, contactId: await seedContact(), agentId: agent.id,
      startedAt: new Date('2026-01-02T11:00:00Z'), closedAt: new Date('2026-01-02T11:30:00Z'),
      reasonId: senha.id,
    });
    await seedClosedConversation({
      channelId, contactId: await seedContact(), agentId: agent.id,
      startedAt: new Date('2026-01-02T12:00:00Z'), closedAt: new Date('2026-01-02T12:30:00Z'),
      reasonId: pagamento.id,
    });

    const metrics = await getMetricsByReason(SINCE);

    expect(metrics).toEqual([
      { reasonId: senha.id, reasonName: 'Troca de senha', closedCount: 2 },
      { reasonId: pagamento.id, reasonName: 'Pagamento', closedCount: 1 },
    ]);
  });

  test('getMetricsByReason ignores conversations closed without a reason', async () => {
    const agent = await createAgent({ email: 'metrics-reason2@dw.com', password: 'secret123', role: 'agent' });
    const channelId = await seedChannel();

    await seedClosedConversation({
      channelId, contactId: await seedContact(), agentId: agent.id,
      startedAt: new Date('2026-01-02T10:00:00Z'), closedAt: new Date('2026-01-02T10:30:00Z'),
    });

    const metrics = await getMetricsByReason(SINCE);

    expect(metrics).toEqual([]);
  });

  test('getMetricsByReason excludes conversations closed before the since timestamp', async () => {
    const agent = await createAgent({ email: 'metrics-reason3@dw.com', password: 'secret123', role: 'agent' });
    const channelId = await seedChannel();
    const reason = await createReason({ name: 'Antigo' });

    await seedClosedConversation({
      channelId, contactId: await seedContact(), agentId: agent.id,
      startedAt: BEFORE_SINCE, closedAt: new Date('2026-01-01T09:15:00Z'),
      reasonId: reason.id,
    });

    const metrics = await getMetricsByReason(SINCE);

    expect(metrics).toEqual([]);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/metrics/metrics.repository.test.js -t "getMetricsByReason"`
Expected: FAIL — `getMetricsByReason is not a function`

- [ ] **Step 3: Implement**

In `src/metrics/metrics.repository.js`, add:
```js
async function getMetricsByReason(since) {
  const result = await getPool().query(
    `WITH closed AS (
       SELECT ce.reason_id
       FROM conversation_events ce
       WHERE ce.event_type = 'closed' AND ce.reason_id IS NOT NULL AND ce.created_at >= $1
     )
     SELECT r.id AS reason_id, r.name AS reason_name, COUNT(*)::int AS closed_count
     FROM closed
     JOIN contact_reasons r ON r.id = closed.reason_id
     GROUP BY r.id, r.name
     ORDER BY closed_count DESC`,
    [since]
  );
  return result.rows.map((row) => ({
    reasonId: row.reason_id,
    reasonName: row.reason_name,
    closedCount: Number(row.closed_count),
  }));
}
```
Add `getMetricsByReason` to the file's `module.exports`.

In `src/api/metrics.routes.js`, add the import and include it in the admin
`Promise.all`:
```js
const { getMetricsForAgent, getMetricsForAllAgents, getMetricsBySector, getMetricsByReason } = require('../metrics/metrics.repository');
```
```js
  if (req.agent.role === 'admin') {
    const [byAgent, bySector, byReason] = await Promise.all([
      getMetricsForAllAgents(since),
      getMetricsBySector(since),
      getMetricsByReason(since),
    ]);
    return res.json({ period: req.query.period, scope: 'admin', byAgent, bySector, byReason });
  }
```

Update `src/api/metrics.routes.test.js`: add `getMetricsByReason` to the mocked import
and the test `'returns the full team breakdown for an admin'` needs
`getMetricsByReason.mockResolvedValue([{ reasonId: 'r1', reasonName: 'Troca de senha', closedCount: 2 }]);`
added before the request, and the expected `res.body` needs
`byReason: [{ reasonId: 'r1', reasonName: 'Troca de senha', closedCount: 2 }]` added.
The test `'returns own metrics for a non-admin agent'` needs an added assertion
`expect(getMetricsByReason).not.toHaveBeenCalled();` alongside its existing
`expect(getMetricsBySector).not.toHaveBeenCalled();`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/metrics/metrics.repository.test.js src/api/metrics.routes.test.js`
Expected: PASS, all tests green

- [ ] **Step 5: Commit**

```bash
git add src/metrics/metrics.repository.js src/api/metrics.routes.js src/metrics/metrics.repository.test.js src/api/metrics.routes.test.js
git commit -m "$(cat <<'EOF'
Add per-reason breakdown to the admin metrics endpoint

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Rename Métricas to Relatório and add the "por motivo" chart

**Files:**
- Modify: `frontend/src/pages/MetricsPage.jsx`
- Modify: `frontend/src/components/NavRail.jsx`
- Modify: `frontend/src/pages/MetricsPage.test.jsx`
- Modify: `frontend/src/components/NavRail.test.jsx`

**Interfaces:**
- Consumes: `data.byReason` from the `GET /api/metrics` response (Task 10).
- Produces: nothing new consumed elsewhere — this is the terminal task.

- [ ] **Step 1: Update the test files**

In `frontend/src/components/NavRail.test.jsx`, find the test `'always shows Conversas
and Métricas'` and change the second assertion:
```js
  test('always shows Conversas and Relatório', () => {
    renderRail();
    expect(screen.getByLabelText('Conversas')).toBeInTheDocument();
    expect(screen.getByLabelText('Relatório')).toBeInTheDocument();
  });
```
(Rename the test title too, so it stays accurate.)

In `frontend/src/pages/MetricsPage.test.jsx`:
1. Every mock response object with `scope: 'admin'` needs a `byReason` array added,
   alongside its existing `byAgent`/`bySector` keys — there are 3 such mocks in this
   file (`'shows the per-agent and per-sector charts for an admin'`, `'shows an
   empty-state message instead of charts when an admin has no data'`, `'shows charts
   for byAgent but an empty-state for bySector when only bySector is empty'`). Add
   `byReason: []` to all three (the new chart renders its own empty state when
   `byReason` is empty, and none of these three tests are specifically testing the
   reason chart's content).
2. The test `'shows an empty-state message instead of charts when an admin has no
   data'` currently asserts `toHaveLength(3)` empty-state messages (one each for
   "Atendimentos por atendente", "Atendimentos por setor", and "Tempo médio por
   atendente" — all three currently check `data.byAgent.length === 0` or
   `data.bySector.length === 0`). Adding a 4th chart that also renders an
   `<EmptyState />` when `data.byReason.length === 0` makes this `4`. Update:
   ```js
   expect(await screen.findAllByText('Nenhum atendimento fechado nesse período.')).toHaveLength(4);
   ```
3. Add a new test proving the reason chart renders real data:
   ```js
   test('shows the per-reason chart for an admin', async () => {
     useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'admin-1', role: 'admin' } });
     api.getMetrics.mockResolvedValue({
       period: 'today',
       scope: 'admin',
       byAgent: [],
       bySector: [],
       byReason: [{ reasonId: 'r1', reasonName: 'Troca de senha', closedCount: 4 }],
     });
     renderPage();

     expect(await screen.findByText(/"reasonName":"Troca de senha"/)).toBeInTheDocument();
   });
   ```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/pages/MetricsPage.test.jsx src/components/NavRail.test.jsx`
Expected: FAIL — label still says "Métricas", chart doesn't exist, empty-state count
is still 3

- [ ] **Step 3: Implement**

In `frontend/src/components/NavRail.jsx`, change the `RailLink`'s label (around line
70):
```jsx
        <RailLink to="/metrics" label="Relatório" active={active === 'metrics'}>
          <IconChart size={22} />
        </RailLink>
```
(`to` and `active` stay exactly as `"/metrics"` and `active === 'metrics'` — only the
visible `label` string changes.)

In `frontend/src/pages/MetricsPage.jsx`:

Change the `<h1>` (around line 180):
```jsx
            <h1 className="font-display text-2xl font-semibold text-ink-950">Relatório</h1>
```

Add a new icon function near the other `Icon*` functions at the top of the file (same
SVG conventions as the others — `stroke="currentColor"`, `strokeWidth="1.75"`):
```jsx
function IconTag(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M12 2l9 9-9 9-9-9V2h9z" />
      <circle cx="7.5" cy="7.5" r="1.25" fill="currentColor" stroke="none" />
    </svg>
  );
}
```

Add a new `ChartCard` inside the `data && data.scope === 'admin'` block, after the
existing "Tempo médio por atendente" `ChartCard` (which is wrapped in
`<div className="lg:col-span-2">`), as a sibling at the same grid level:
```jsx
            <ChartCard title="Atendimentos por motivo" icon={<IconTag className="h-4 w-4" />}>
              {data.byReason.length === 0 ? (
                <EmptyState />
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={data.byReason} barCategoryGap="32%">
                    <CartesianGrid vertical={false} stroke={GRID_COLOR} />
                    <XAxis dataKey="reasonName" tick={AXIS_TICK} axisLine={{ stroke: GRID_COLOR }} tickLine={false} />
                    <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} allowDecimals={false} width={32} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'rgba(217, 134, 31, 0.08)' }} />
                    <Bar dataKey="closedCount" name="Atendimentos" fill={AMBER_DARK} radius={[6, 6, 0, 0]} maxBarSize={48} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/pages/MetricsPage.test.jsx src/components/NavRail.test.jsx`
Expected: PASS, all tests green

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/MetricsPage.jsx frontend/src/components/NavRail.jsx frontend/src/pages/MetricsPage.test.jsx frontend/src/components/NavRail.test.jsx
git commit -m "$(cat <<'EOF'
Rename Métricas to Relatório and add the per-reason chart

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Final Verification (after all tasks)

Run the full backend and frontend suites clean, in the isolated worktree, before
finishing the branch:

```bash
npm test
cd frontend && npx vitest run
```

Both must be 100% green before proceeding to
`superpowers:finishing-a-development-branch`.
