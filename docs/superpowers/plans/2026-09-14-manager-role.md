# Manager (Gerente) Role Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third `agents.role` value, `'manager'`, that inherits admin-level access
everywhere by default, with two explicit carve-outs: Channels/Integrations/the AI
provider key require a new per-manager `can_manage_integrations` flag, and
creating/managing another account is restricted to `role = 'agent'` targets only.

**Architecture:** `requireRole('admin')` (`src/auth/auth.middleware.js`) is changed once
so it accepts `'manager'` wherever it accepts `'admin'` — every admin route that doesn't
appear in this plan needs zero code changes to open up to managers. A new
`requireIntegrationsAccess` middleware (admin always passes; manager passes only with
the flag; agent never passes) replaces `requireRole('admin')` on the specific routes
that hold or set a secret (channel credentials, the SGP connection, the OpenAI API key).
Managing another account gets its own explicit restriction inside
`admin-agents.routes.js`, since it depends on the *target* account's role, not just the
caller's.

**Tech Stack:** Node.js/Express, PostgreSQL (node-pg-migrate), Jest + real Postgres for
repository/integration tests, React/Vite + Vitest for the frontend.

**Spec:** `docs/superpowers/specs/2026-09-14-manager-role-design.md`

## Global Constraints

- `requireRole('admin')` must keep its exact current call signature
  (`requireRole('admin')`, `requireRole('agent')`, etc.) — only its internal behavior
  changes. No route file outside this plan's explicit task list may be edited.
- `can_manage_integrations` is only ever `true` when `role = 'manager'` — the backend
  forces it to `false` for every other role, both at creation and in every response
  shape, regardless of what a request body sends.
- A manager can only create or act on accounts whose `role` is `'agent'` — never
  `'admin'` or `'manager'`, including their own account already being one of those.
- Reading a list (agents, channels, the AI config's non-key fields) is never restricted
  by `can_manage_integrations` — only creating, editing, deleting, reconnecting, or
  setting/testing a credential is.
- The permission travels inside the JWT (`req.agent.canManageIntegrations`), signed at
  login time, exactly like `role` already does — no per-request database lookup, no
  forced logout when an admin changes a manager's flag later.
- Every SQL query that already lists `role` in its column list must also list
  `can_manage_integrations` — this project enumerates columns, it never uses
  `SELECT *` ([[project_columns_enumerated_not_star]]).

---

## Task 1: Migration + `auth.middleware.js`

**Files:**
- Create: `migrations/1789070000000_add_manager_role.js`
- Modify: `src/auth/auth.middleware.js`
- Modify: `src/auth/auth.middleware.test.js`

**Interfaces:**
- Produces: `agents.role` CHECK constraint now allows `'manager'`;
  `agents.can_manage_integrations BOOLEAN NOT NULL DEFAULT false` column. Exported
  `requireRole(role)` (existing signature, `'admin'` now also matches `role: 'manager'`),
  new `requireIntegrationsAccess(req, res, next)` middleware, new
  `hasIntegrationsAccess(agent)` pure function — all three exported from
  `src/auth/auth.middleware.js`. Later tasks import these three.

- [ ] **Step 1: Write the migration**

Create `migrations/1789070000000_add_manager_role.js`:

```js
exports.up = (pgm) => {
  pgm.sql(`ALTER TABLE agents DROP CONSTRAINT IF EXISTS agents_role_check;`);
  pgm.sql(`ALTER TABLE agents ADD CONSTRAINT agents_role_check CHECK (role IN ('agent', 'admin', 'manager'));`);
  pgm.sql(`ALTER TABLE agents ADD COLUMN IF NOT EXISTS can_manage_integrations BOOLEAN NOT NULL DEFAULT false;`);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE agents DROP COLUMN IF EXISTS can_manage_integrations;`);
  pgm.sql(`ALTER TABLE agents DROP CONSTRAINT IF EXISTS agents_role_check;`);
  pgm.sql(`ALTER TABLE agents ADD CONSTRAINT agents_role_check CHECK (role IN ('agent', 'admin'));`);
};
```

The constraint name `agents_role_check` was confirmed against the dev database
(`SELECT conname FROM pg_constraint WHERE conrelid = 'agents'::regclass AND contype =
'c'`) — it is the Postgres default name for the inline `CHECK` in the original migration
(`migrations/1788610139386_create-agents-table.js:7`), so no lookup is needed before
writing this migration. `down`'s re-added constraint will fail if any row already has
`role = 'manager'` at that point — acceptable, same class of one-way migration as the
protocol-format work ([[project_daily_protocol_format]]).

- [ ] **Step 2: Write the failing tests for `requireRole` accepting `manager`**

In `src/auth/auth.middleware.test.js`, add inside the existing `describe('requireRole', ...)` block:

```js
  test('calls next when a manager is checked against the admin role', () => {
    const req = { agent: { role: 'manager' } };
    const res = mockRes();
    const next = jest.fn();

    requireRole('admin')(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  test('still only matches an exact role for a non-admin check', () => {
    const req = { agent: { role: 'manager' } };
    const res = mockRes();
    const next = jest.fn();

    requireRole('agent')(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
```

Add a new top-level `describe` block at the end of the file for the two new exports:

```js

describe('hasIntegrationsAccess', () => {
  test('returns true for an admin', () => {
    expect(hasIntegrationsAccess({ role: 'admin' })).toBe(true);
  });

  test('returns true for a manager with the flag', () => {
    expect(hasIntegrationsAccess({ role: 'manager', canManageIntegrations: true })).toBe(true);
  });

  test('returns false for a manager without the flag', () => {
    expect(hasIntegrationsAccess({ role: 'manager', canManageIntegrations: false })).toBe(false);
  });

  test('returns false for a plain agent', () => {
    expect(hasIntegrationsAccess({ role: 'agent' })).toBe(false);
  });

  test('returns false for a missing agent', () => {
    expect(hasIntegrationsAccess(undefined)).toBe(false);
  });
});

describe('requireIntegrationsAccess', () => {
  test('calls next for an admin', () => {
    const req = { agent: { role: 'admin' } };
    const res = mockRes();
    const next = jest.fn();

    requireIntegrationsAccess(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  test('calls next for a manager with the flag', () => {
    const req = { agent: { role: 'manager', canManageIntegrations: true } };
    const res = mockRes();
    const next = jest.fn();

    requireIntegrationsAccess(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  test('returns 403 for a manager without the flag', () => {
    const req = { agent: { role: 'manager', canManageIntegrations: false } };
    const res = mockRes();
    const next = jest.fn();

    requireIntegrationsAccess(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('returns 403 for a plain agent', () => {
    const req = { agent: { role: 'agent' } };
    const res = mockRes();
    const next = jest.fn();

    requireIntegrationsAccess(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
```

Update the file's top import line from:
```js
const { requireAuth, requireRole } = require('./auth.middleware');
```
to:
```js
const { requireAuth, requireRole, requireIntegrationsAccess, hasIntegrationsAccess } = require('./auth.middleware');
```

- [ ] **Step 3: Run the new tests to verify they fail**

Run: `npm test -- auth.middleware.test.js`
Expected: the two new `requireRole` tests and the whole `hasIntegrationsAccess`/
`requireIntegrationsAccess` blocks FAIL — `hasIntegrationsAccess`/`requireIntegrationsAccess`
are `undefined` (not exported yet), and `requireRole('admin')` still exact-matches so
`role: 'manager'` gets 403 instead of calling `next()`.

- [ ] **Step 4: Implement the middleware changes**

Replace the full contents of `src/auth/auth.middleware.js` with:

```js
const { verifyToken } = require('./auth.service');

const ADMIN_LEVEL_ROLES = ['admin', 'manager'];

function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization token' });
  }
  const token = header.slice('Bearer '.length);
  try {
    req.agent = verifyToken(token);
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireRole(role) {
  return (req, res, next) => {
    const allowed = role === 'admin' ? ADMIN_LEVEL_ROLES : [role];
    if (!allowed.includes(req.agent?.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

function hasIntegrationsAccess(agent) {
  return agent?.role === 'admin' || (agent?.role === 'manager' && agent?.canManageIntegrations === true);
}

function requireIntegrationsAccess(req, res, next) {
  if (!hasIntegrationsAccess(req.agent)) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }
  next();
}

module.exports = { requireAuth, requireRole, requireIntegrationsAccess, hasIntegrationsAccess };
```

- [ ] **Step 5: Run the tests again to verify they pass**

Run: `npm test -- auth.middleware.test.js`
Expected: PASS, all tests green (the original 6 plus the 9 new ones).

- [ ] **Step 6: Run the full backend suite**

Run: `npm test`
Expected: PASS. (`pretest` applies the new migration automatically against the test
database.) This proves the migration alone doesn't break anything even before any
route file changes — those are separate tasks.

- [ ] **Step 7: Commit**

```bash
git add migrations/1789070000000_add_manager_role.js src/auth/auth.middleware.js src/auth/auth.middleware.test.js
git commit -m "Add the manager role and can_manage_integrations column"
```

---

## Task 2: `agent.repository.js` — thread `canManageIntegrations` through

**Files:**
- Modify: `src/agents/agent.repository.js`
- Modify: `src/agents/agent.repository.test.js`

**Interfaces:**
- Consumes: `agents.can_manage_integrations` column from Task 1.
- Produces: `createAgent({ name, email, password, role, canManageIntegrations })` — new
  optional field, stored as-is (callers are responsible for forcing `false` outside
  `role: 'manager'`, done in Task 4). `toPublicAgent(row)` and every function that
  returns an agent object now include `canManageIntegrations: boolean`.

- [ ] **Step 1: Write the failing tests**

In `src/agents/agent.repository.test.js`, add after the existing `'createAgent stores a
hashed password...'` test:

```js
  test('createAgent stores canManageIntegrations for a manager', async () => {
    const agent = await createAgent({
      name: 'Marcia', email: 'marcia@dw.com', password: 'secret123', role: 'manager', canManageIntegrations: true,
    });
    expect(agent.role).toBe('manager');
    expect(agent.canManageIntegrations).toBe(true);
  });

  test('createAgent defaults canManageIntegrations to false when omitted', async () => {
    const agent = await createAgent({ name: 'Nilo', email: 'nilo@dw.com', password: 'secret123', role: 'agent' });
    expect(agent.canManageIntegrations).toBe(false);
  });
```

Add after `'findAgentById returns the agent without its password hash'`:

```js
  test('findAgentById includes canManageIntegrations', async () => {
    const created = await createAgent({
      name: 'Otavio', email: 'otavio@dw.com', password: 'secret123', role: 'manager', canManageIntegrations: true,
    });
    const agent = await findAgentById(created.id);
    expect(agent.canManageIntegrations).toBe(true);
  });
```

Add after `'findAgentByEmail returns the agent with its password hash and active flag'`:

```js
  test('findAgentByEmail includes canManageIntegrations', async () => {
    await createAgent({
      name: 'Paula', email: 'paula@dw.com', password: 'secret123', role: 'manager', canManageIntegrations: true,
    });
    const agent = await findAgentByEmail('paula@dw.com');
    expect(agent.canManageIntegrations).toBe(true);
  });
```

Add after `'setAgentActive deactivates and reactivates an agent'`:

```js
  test('setAgentActive preserves canManageIntegrations', async () => {
    const created = await createAgent({
      name: 'Quenia', email: 'quenia@dw.com', password: 'secret123', role: 'manager', canManageIntegrations: true,
    });
    const updated = await setAgentActive(created.id, false);
    expect(updated.canManageIntegrations).toBe(true);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- agent.repository.test.js`
Expected: FAIL — every new assertion on `.canManageIntegrations` gets `undefined`
instead of the expected boolean (the column isn't selected or inserted yet).

- [ ] **Step 3: Implement the repository changes**

In `src/agents/agent.repository.js`, replace `toPublicAgent`:

```js
function toPublicAgent(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    active: row.active,
    canManageIntegrations: row.can_manage_integrations,
    phone: row.phone,
    avatarPath: row.avatar_path,
    createdAt: row.created_at,
  };
}
```

Replace `createAgent`:

```js
async function createAgent({ name, email, password, role, canManageIntegrations = false }) {
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const result = await getPool().query(
    `INSERT INTO agents (name, email, password_hash, role, can_manage_integrations) VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, email, role, active, can_manage_integrations, phone, avatar_path, created_at`,
    [name || email.split('@')[0], email, passwordHash, role, canManageIntegrations]
  );
  return toPublicAgent(result.rows[0]);
}
```

Replace `findAgentByEmail`:

```js
async function findAgentByEmail(email) {
  const result = await getPool().query(
    'SELECT id, name, email, role, active, password_hash, can_manage_integrations, avatar_path, created_at FROM agents WHERE email = $1',
    [email]
  );
  if (result.rowCount === 0) return null;
  const row = result.rows[0];
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    active: row.active,
    passwordHash: row.password_hash,
    canManageIntegrations: row.can_manage_integrations,
    avatarPath: row.avatar_path,
    createdAt: row.created_at,
  };
}
```

Replace the `findAgentById` query string (only the SELECT list changes, body untouched):

```js
async function findAgentById(id) {
  const result = await getPool().query(
    'SELECT id, name, email, role, active, can_manage_integrations, phone, avatar_path, created_at FROM agents WHERE id = $1',
    [id]
  );
  if (result.rowCount === 0) return null;
  return toPublicAgent(result.rows[0]);
}
```

Replace the `listAgents` query string (only the SELECT list changes):

```js
async function listAgents() {
  const result = await getPool().query(`
    SELECT a.id, a.name, a.email, a.role, a.active, a.can_manage_integrations, a.phone, a.avatar_path, a.created_at,
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

Replace `setAgentActive`'s query string:

```js
async function setAgentActive(id, active) {
  const result = await getPool().query(
    'UPDATE agents SET active = $2 WHERE id = $1 RETURNING id, name, email, role, active, can_manage_integrations, created_at',
    [id, active]
  );
  if (result.rowCount === 0) return null;
  return toPublicAgent(result.rows[0]);
}
```

Replace `updateAgentProfile`'s query string:

```js
async function updateAgentProfile(id, { name, phone }) {
  const result = await getPool().query(
    `UPDATE agents SET name = $2, phone = $3 WHERE id = $1
     RETURNING id, name, email, role, active, can_manage_integrations, phone, avatar_path, created_at`,
    [id, name, phone || null]
  );
  if (result.rowCount === 0) return null;
  return toPublicAgent(result.rows[0]);
}
```

`findAgentByIdWithPasswordHash` is unchanged — it's only used to verify a password
during login/change-password, never to check a role or permission.

- [ ] **Step 4: Run the tests again to verify they pass**

Run: `npm test -- agent.repository.test.js`
Expected: PASS, all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/agents/agent.repository.js src/agents/agent.repository.test.js
git commit -m "Thread canManageIntegrations through the agent repository"
```

---

## Task 3: `auth.service.js` — embed the flag in the login token

**Files:**
- Modify: `src/auth/auth.service.js`
- Modify: `src/auth/auth.service.test.js`

**Interfaces:**
- Consumes: `findAgentByEmail` returning `canManageIntegrations` (Task 2).
- Produces: `login()`'s resolved `{ token, agent }` — the JWT payload and the `agent`
  object both gain `canManageIntegrations: boolean`. `req.agent.canManageIntegrations`
  becomes available to every route after `requireAuth` runs (same mechanism `role`
  already uses — `verifyToken` just decodes the signed payload as-is).

- [ ] **Step 1: Write the failing test**

In `src/auth/auth.service.test.js`, add after `'login returns a token when credentials
are valid'`:

```js
  test('login embeds canManageIntegrations in the token and the returned agent', async () => {
    const passwordHash = await bcrypt.hash('secret123', 10);
    findAgentByEmail.mockResolvedValue({
      id: 'agent-1', email: 'a@dw.com', role: 'manager', canManageIntegrations: true, passwordHash,
    });

    const result = await login({ email: 'a@dw.com', password: 'secret123' });

    const decoded = jwt.verify(result.token, 'test-secret');
    expect(decoded.canManageIntegrations).toBe(true);
    expect(result.agent.canManageIntegrations).toBe(true);
  });

  test('login defaults canManageIntegrations to false when the repository omits it', async () => {
    const passwordHash = await bcrypt.hash('secret123', 10);
    findAgentByEmail.mockResolvedValue({ id: 'agent-1', email: 'a@dw.com', role: 'agent', passwordHash });

    const result = await login({ email: 'a@dw.com', password: 'secret123' });

    const decoded = jwt.verify(result.token, 'test-secret');
    expect(decoded.canManageIntegrations).toBe(false);
    expect(result.agent.canManageIntegrations).toBe(false);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- auth.service.test.js`
Expected: FAIL — `decoded.canManageIntegrations` and `result.agent.canManageIntegrations`
are both `undefined`.

- [ ] **Step 3: Implement**

In `src/auth/auth.service.js`, replace the `login` function's token/return block:

```js
  const token = jwt.sign(
    { agentId: agent.id, role: agent.role, canManageIntegrations: agent.canManageIntegrations || false },
    process.env.JWT_SECRET,
    { expiresIn: TOKEN_EXPIRY }
  );
  return {
    token,
    agent: {
      id: agent.id,
      name: agent.name,
      email: agent.email,
      role: agent.role,
      canManageIntegrations: agent.canManageIntegrations || false,
      avatarPath: agent.avatarPath || null,
    },
  };
```

- [ ] **Step 4: Run the tests again to verify they pass**

Run: `npm test -- auth.service.test.js`
Expected: PASS, all tests green.

- [ ] **Step 5: Run the full backend suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/auth/auth.service.js src/auth/auth.service.test.js
git commit -m "Embed canManageIntegrations in the login token"
```

---

## Task 4: `admin-agents.routes.js` — manager account-management restrictions

**Files:**
- Modify: `src/api/admin-agents.routes.js`
- Modify: `src/api/admin-agents.routes.test.js`

**Interfaces:**
- Consumes: `createAgent({..., canManageIntegrations})` (Task 2), `findAgentById`
  returning `role`/`canManageIntegrations` (Task 2, already returned `role`).
- Produces: n/a (leaf route file).

- [ ] **Step 1: Write the failing tests**

In `src/api/admin-agents.routes.test.js`, add inside `describe('POST
/api/admin/agents', ...)`, after the `'returns 400 for an invalid role'` test:

```js
  test('creates a manager with canManageIntegrations', async () => {
    createAgent.mockResolvedValue({
      id: 'agent-5', name: 'Marcia', email: 'marcia@dw.com', role: 'manager', canManageIntegrations: true, active: true, createdAt: new Date(),
    });

    const res = await request(buildApp())
      .post('/api/admin/agents')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ name: 'Marcia', email: 'marcia@dw.com', password: 'temporaria123', role: 'manager', canManageIntegrations: true });

    expect(res.status).toBe(201);
    expect(createAgent).toHaveBeenCalledWith({
      name: 'Marcia', email: 'marcia@dw.com', password: 'temporaria123', role: 'manager', canManageIntegrations: true,
    });
    expect(res.body.canManageIntegrations).toBe(true);
  });

  test('forces canManageIntegrations to false for a role other than manager', async () => {
    createAgent.mockResolvedValue({
      id: 'agent-6', name: 'Nilo', email: 'nilo@dw.com', role: 'agent', canManageIntegrations: false, active: true, createdAt: new Date(),
    });

    await request(buildApp())
      .post('/api/admin/agents')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ name: 'Nilo', email: 'nilo@dw.com', password: 'temporaria123', role: 'agent', canManageIntegrations: true });

    expect(createAgent).toHaveBeenCalledWith({
      name: 'Nilo', email: 'nilo@dw.com', password: 'temporaria123', role: 'agent', canManageIntegrations: false,
    });
  });

  test('a manager can create an agent', async () => {
    createAgent.mockResolvedValue({
      id: 'agent-7', name: 'Otavio', email: 'otavio@dw.com', role: 'agent', canManageIntegrations: false, active: true, createdAt: new Date(),
    });

    const res = await request(buildApp())
      .post('/api/admin/agents')
      .set('Authorization', `Bearer ${tokenFor('manager-1', 'manager')}`)
      .send({ name: 'Otavio', email: 'otavio@dw.com', password: 'temporaria123', role: 'agent' });

    expect(res.status).toBe(201);
  });

  test('a manager cannot create another manager', async () => {
    const res = await request(buildApp())
      .post('/api/admin/agents')
      .set('Authorization', `Bearer ${tokenFor('manager-1', 'manager')}`)
      .send({ name: 'Paula', email: 'paula@dw.com', password: 'temporaria123', role: 'manager' });

    expect(res.status).toBe(403);
    expect(createAgent).not.toHaveBeenCalled();
  });

  test('a manager cannot create an admin', async () => {
    const res = await request(buildApp())
      .post('/api/admin/agents')
      .set('Authorization', `Bearer ${tokenFor('manager-1', 'manager')}`)
      .send({ name: 'Quenia', email: 'quenia@dw.com', password: 'temporaria123', role: 'admin' });

    expect(res.status).toBe(403);
    expect(createAgent).not.toHaveBeenCalled();
  });
```

Add inside `describe('PATCH /api/admin/agents/:id', ...)`, after `'returns 403 for a
non-admin agent'`:

```js
  test('a manager can deactivate an agent', async () => {
    findAgentById.mockResolvedValue({ id: 'agent-4', role: 'agent' });
    setAgentActive.mockResolvedValue({ id: 'agent-4', name: 'Duda', email: 'duda@dw.com', role: 'agent', active: false, createdAt: new Date() });

    const res = await request(buildApp())
      .patch('/api/admin/agents/agent-4')
      .set('Authorization', `Bearer ${tokenFor('manager-1', 'manager')}`)
      .send({ active: false });

    expect(res.status).toBe(200);
    expect(setAgentActive).toHaveBeenCalledWith('agent-4', false);
  });

  test('a manager cannot deactivate another manager', async () => {
    findAgentById.mockResolvedValue({ id: 'manager-2', role: 'manager' });

    const res = await request(buildApp())
      .patch('/api/admin/agents/manager-2')
      .set('Authorization', `Bearer ${tokenFor('manager-1', 'manager')}`)
      .send({ active: false });

    expect(res.status).toBe(403);
    expect(setAgentActive).not.toHaveBeenCalled();
  });

  test('a manager cannot act on an admin account', async () => {
    findAgentById.mockResolvedValue({ id: 'admin-2', role: 'admin' });

    const res = await request(buildApp())
      .patch('/api/admin/agents/admin-2')
      .set('Authorization', `Bearer ${tokenFor('manager-1', 'manager')}`)
      .send({ active: false });

    expect(res.status).toBe(403);
    expect(setAgentActive).not.toHaveBeenCalled();
  });
```

Add inside `describe('PUT /api/admin/agents/:id/password', ...)`, after `'returns 403
for a non-admin agent'`:

```js
  test('a manager can reset an agent\'s password', async () => {
    findAgentById.mockResolvedValue({ id: 'agent-4', role: 'agent' });
    resetAgentPassword.mockResolvedValue('Xy9kFpQr2z');

    const res = await request(buildApp())
      .put('/api/admin/agents/agent-4/password')
      .set('Authorization', `Bearer ${tokenFor('manager-1', 'manager')}`);

    expect(res.status).toBe(200);
    expect(resetAgentPassword).toHaveBeenCalledWith('agent-4');
  });

  test('a manager cannot reset an admin\'s password', async () => {
    findAgentById.mockResolvedValue({ id: 'admin-2', role: 'admin' });

    const res = await request(buildApp())
      .put('/api/admin/agents/admin-2/password')
      .set('Authorization', `Bearer ${tokenFor('manager-1', 'manager')}`);

    expect(res.status).toBe(403);
    expect(resetAgentPassword).not.toHaveBeenCalled();
  });
```

Add inside `describe('PUT /api/admin/agents/:id/sectors', ...)`, after `'returns 403 for
a non-admin agent'`:

```js
  test('a manager can set an agent\'s sectors', async () => {
    findAgentById.mockResolvedValue({ id: 'agent-4', role: 'agent' });
    setAgentSectors.mockResolvedValue(undefined);

    const res = await request(buildApp())
      .put('/api/admin/agents/agent-4/sectors')
      .set('Authorization', `Bearer ${tokenFor('manager-1', 'manager')}`)
      .send({ sectorIds: ['sector-1'] });

    expect(res.status).toBe(200);
    expect(setAgentSectors).toHaveBeenCalledWith('agent-4', ['sector-1']);
  });

  test('a manager cannot set another manager\'s sectors', async () => {
    findAgentById.mockResolvedValue({ id: 'manager-2', role: 'manager' });

    const res = await request(buildApp())
      .put('/api/admin/agents/manager-2/sectors')
      .set('Authorization', `Bearer ${tokenFor('manager-1', 'manager')}`)
      .send({ sectorIds: [] });

    expect(res.status).toBe(403);
    expect(setAgentSectors).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- admin-agents.routes.test.js`
Expected: FAIL — `'manager'` currently fails `VALID_ROLES.includes(role)` at the wrong
point (or, for the PATCH/password/sectors manager tests, there's no manager-vs-target
check yet, so a manager token is simply treated the same as admin and the calls
succeed when they should 403).

- [ ] **Step 3: Implement**

Replace `VALID_ROLES` and `toResponseShape` at the top of
`src/api/admin-agents.routes.js`:

```js
const VALID_ROLES = ['agent', 'admin', 'manager'];

function toResponseShape(agent) {
  return {
    id: agent.id,
    name: agent.name,
    email: agent.email,
    role: agent.role,
    active: agent.active,
    canManageIntegrations: agent.canManageIntegrations,
    sectors: agent.sectors || [],
  };
}
```

Replace the `POST /` handler:

```js
router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  const { name, email, password, role, canManageIntegrations } = req.body || {};
  if (!name || !email || !password || !role) {
    return res.status(400).json({ error: 'name, email, password and role are required' });
  }
  if (!VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: 'role must be agent, manager or admin' });
  }
  if (req.agent.role === 'manager' && role !== 'agent') {
    return res.status(403).json({ error: 'Managers can only create attendant accounts' });
  }
  try {
    const agent = await createAgent({
      name,
      email,
      password,
      role,
      canManageIntegrations: role === 'manager' ? Boolean(canManageIntegrations) : false,
    });
    res.status(201).json(toResponseShape(agent));
  } catch (err) {
    if (err.code === UNIQUE_VIOLATION) {
      return res.status(409).json({ error: 'An agent with this email already exists' });
    }
    throw err;
  }
});
```

Replace the `PATCH /:id` handler:

```js
router.patch('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const { active } = req.body || {};
  if (typeof active !== 'boolean') {
    return res.status(400).json({ error: 'active must be a boolean' });
  }
  if (req.params.id === req.agent.agentId && active === false) {
    return res.status(400).json({ error: 'You cannot deactivate your own account' });
  }
  if (req.agent.role === 'manager') {
    const target = await findAgentById(req.params.id);
    if (!target) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    if (target.role !== 'agent') {
      return res.status(403).json({ error: 'Managers can only manage attendant accounts' });
    }
  }
  const agent = await setAgentActive(req.params.id, active);
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  res.json(toResponseShape(agent));
});
```

Replace the `PUT /:id/password` handler:

```js
router.put('/:id/password', requireAuth, requireRole('admin'), async (req, res) => {
  if (req.params.id === req.agent.agentId) {
    return res.status(400).json({ error: 'You cannot reset your own password here' });
  }
  const agent = await findAgentById(req.params.id);
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  if (req.agent.role === 'manager' && agent.role !== 'agent') {
    return res.status(403).json({ error: 'Managers can only manage attendant accounts' });
  }
  const newPassword = await resetAgentPassword(req.params.id);
  res.json({ newPassword });
});
```

Replace the `PUT /:id/sectors` handler:

```js
router.put('/:id/sectors', requireAuth, requireRole('admin'), async (req, res) => {
  const { sectorIds } = req.body || {};
  if (!Array.isArray(sectorIds)) {
    return res.status(400).json({ error: 'sectorIds must be an array' });
  }
  const agent = await findAgentById(req.params.id);
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  if (req.agent.role === 'manager' && agent.role !== 'agent') {
    return res.status(403).json({ error: 'Managers can only manage attendant accounts' });
  }
  await setAgentSectors(req.params.id, sectorIds);
  res.status(200).json({ ok: true });
});
```

`GET /` is unchanged — a manager still sees the full list.

- [ ] **Step 4: Run the tests again to verify they pass**

Run: `npm test -- admin-agents.routes.test.js`
Expected: PASS, all tests green (the original suite plus the 11 new tests). The
pre-existing tests that call `POST`/`PATCH`/`password`/`sectors` as `tokenFor('admin-1',
'admin')` are untouched by these changes — `req.agent.role === 'manager'` is false for
them, so none of the new branches run.

- [ ] **Step 5: Run the full backend suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/api/admin-agents.routes.js src/api/admin-agents.routes.test.js
git commit -m "Restrict manager account management to agent-role targets"
```

---

## Task 5: `admin-channels.routes.js` — gate writes behind `requireIntegrationsAccess`

**Files:**
- Modify: `src/api/admin-channels.routes.js`
- Modify: `src/api/admin-channels.routes.test.js`

**Interfaces:**
- Consumes: `requireIntegrationsAccess`, `hasIntegrationsAccess` from Task 1.

- [ ] **Step 1: Write the failing tests**

In `src/api/admin-channels.routes.test.js`, six `describe` blocks need a new test each:
`GET /api/admin/channels` (line 40), `POST /api/admin/channels` (line 89),
`GET /api/admin/channels/:id/qr` (line 255), `PATCH /api/admin/channels/:id` (line
321), `POST /api/admin/channels/:id/reconnect` (line 896), and
`DELETE /api/admin/channels/:id` (line 939). Line numbers are from the file as it
stands before this task's edits — re-locate each block by its `describe(...)` text if
the file has since grown or shrunk above it.

In `describe('GET /api/admin/channels', ...)`, add right after the existing
`'returns 403 for a non-admin agent'` test (around line 76-84) — this route stays open,
so this test proves the flag is irrelevant to it:

```js
  test('returns 200 for a manager without canManageIntegrations', async () => {
    listChannels.mockResolvedValue([]);
    const res = await request(buildApp())
      .get('/api/admin/channels')
      .set('Authorization', `Bearer ${tokenFor('manager-1', 'manager')}`);
    expect(res.status).toBe(200);
  });
```

In `describe('POST /api/admin/channels', ...)`, add right after the existing
`'returns 403 for a non-admin agent'` test (line 183-189):

```js
  test('returns 403 for a manager without canManageIntegrations', async () => {
    const res = await request(buildApp())
      .post('/api/admin/channels')
      .set('Authorization', `Bearer ${tokenFor('manager-1', 'manager')}`)
      .send({ type: 'baileys', name: 'X', phoneNumber: '+5511900000000' });
    expect(res.status).toBe(403);
  });

  test('creates a channel for a manager with canManageIntegrations', async () => {
    createChannel.mockResolvedValue({
      id: 'channel-9', type: 'baileys', name: 'X', phoneNumber: '+5511900000000',
      config: {}, status: 'disconnected', triageEnabled: false, hidden: false, welcomeMessage: null,
    });
    const res = await request(buildApp())
      .post('/api/admin/channels')
      .set('Authorization', `Bearer ${tokenFor('manager-1', 'manager', true)}`)
      .send({ type: 'baileys', name: 'X', phoneNumber: '+5511900000000' });
    expect(res.status).toBe(201);
  });
```

In `describe('GET /api/admin/channels/:id/qr', ...)`, add right after the existing
`'returns 403 via query string token for a non-admin agent'` test (line 289-294):

```js
  test('returns 403 via query string token for a manager without canManageIntegrations', async () => {
    const res = await request(buildApp()).get(
      `/api/admin/channels/channel-4/qr?token=${tokenFor('manager-1', 'manager')}`
    );
    expect(res.status).toBe(403);
  });
```

In `describe('PATCH /api/admin/channels/:id', ...)`, add right after the existing
`'returns 403 for a non-admin agent'` test (line 372-378) — this one test covers the
whole route, including the `wabaId`/`hidden`/`aiEnabled`/`aiTriageEnabled`/
`aiNightModeEnabled` sub-`describe` blocks further down the file that PATCH the same
route with different body fields, since they all resolve to the same
`router.patch('/:id', ...)` declaration:

```js
  test('returns 403 for a manager without canManageIntegrations', async () => {
    const res = await request(buildApp())
      .patch('/api/admin/channels/channel-1')
      .set('Authorization', `Bearer ${tokenFor('manager-1', 'manager')}`)
      .send({ triageEnabled: true });
    expect(res.status).toBe(403);
  });
```

In `describe('POST /api/admin/channels/:id/reconnect', ...)`, add right after the
existing `'returns 403 for a non-admin agent'` test (line 930-936):

```js
  test('returns 403 for a manager without canManageIntegrations', async () => {
    const res = await request(buildApp())
      .post('/api/admin/channels/ch-1/reconnect')
      .set('Authorization', `Bearer ${tokenFor('manager-1', 'manager')}`);
    expect(res.status).toBe(403);
    expect(baileysManager.reconnectBaileysChannel).not.toHaveBeenCalled();
  });
```

In `describe('DELETE /api/admin/channels/:id', ...)`, add right after the existing
`'returns 403 for a non-admin agent'` test (line 990-996):

```js
  test('returns 403 for a manager without canManageIntegrations', async () => {
    const res = await request(buildApp())
      .delete('/api/admin/channels/ch-1')
      .set('Authorization', `Bearer ${tokenFor('manager-1', 'manager')}`);
    expect(res.status).toBe(403);
    expect(deleteChannel).not.toHaveBeenCalled();
  });
```

`tokenFor` needs a third, optional parameter so a test can mint a manager token that
carries the flag. Find `tokenFor`'s definition near the top of the file (line 36-38):

```js
function tokenFor(agentId, role) {
  return jwt.sign({ agentId, role }, process.env.JWT_SECRET);
}
```

Replace it with:

```js
function tokenFor(agentId, role, canManageIntegrations = false) {
  return jwt.sign({ agentId, role, canManageIntegrations }, process.env.JWT_SECRET);
}
```

(This is backward compatible — every existing call passes only two arguments, so
`canManageIntegrations` defaults to `false` for them, which is irrelevant since none of
them use a manager token.)

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `npm test -- admin-channels.routes.test.js`
Expected: the new 403-for-manager tests FAIL (get 200/201 instead of 403, since
`requireRole('admin')` today accepts nothing but exact `'admin'` for these routes... wait
— after Task 1, `requireRole('admin')` already accepts `manager` too, so at this exact
point in the plan these routes are unintentionally WIDE OPEN to any manager, flag or
not. Confirm this is what you see — status 200/201 instead of the expected 403 — before
proceeding to Step 3. This is expected and is exactly the gap Task 5 closes.

- [ ] **Step 3: Implement**

In `src/api/admin-channels.routes.js`, update the import line:

```js
const { requireAuth, requireRole, requireIntegrationsAccess, hasIntegrationsAccess } = require('../auth/auth.middleware');
```

Change these four route declarations — only the middleware in the argument list
changes, nothing else in each handler:

```js
router.post('/', requireAuth, requireIntegrationsAccess, async (req, res) => {
```
```js
router.patch('/:id', requireAuth, requireIntegrationsAccess, async (req, res) => {
```
```js
router.post('/:id/reconnect', requireAuth, requireIntegrationsAccess, async (req, res) => {
```
```js
router.delete('/:id', requireAuth, requireIntegrationsAccess, async (req, res) => {
```

Leave `router.get('/', requireAuth, requireRole('admin'), async (req, res) => {`
untouched — the channel list stays open to any admin-level agent.

Replace `authenticateQrRoute`'s permission check:

```js
  if (req.agent.role !== 'admin') {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }
```
with:
```js
  if (!hasIntegrationsAccess(req.agent)) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }
```

- [ ] **Step 4: Run the tests again to verify they pass**

Run: `npm test -- admin-channels.routes.test.js`
Expected: PASS, all tests green.

- [ ] **Step 5: Run the full backend suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/api/admin-channels.routes.js src/api/admin-channels.routes.test.js
git commit -m "Gate channel writes behind requireIntegrationsAccess"
```

---

## Task 6: `admin-integrations.routes.js` — gate everything behind `requireIntegrationsAccess`

**Files:**
- Modify: `src/api/admin-integrations.routes.js`
- Modify: `src/api/admin-integrations.routes.test.js`

**Interfaces:**
- Consumes: `requireIntegrationsAccess` from Task 1.

- [ ] **Step 1: Write the failing tests**

In `src/api/admin-integrations.routes.test.js`, find `tokenFor`'s definition (line
24-26) and replace it exactly as in Task 5:

```js
function tokenFor(agentId, role, canManageIntegrations = false) {
  return jwt.sign({ agentId, role, canManageIntegrations }, process.env.JWT_SECRET);
}
```

Then add one test to each of the six `describe` blocks, right after that block's
existing `'returns 403 for a non-admin agent'` test:

In `describe('GET /api/admin/integrations/sgp', ...)`, after the test at line 56-62:

```js
  test('returns 403 for a manager without canManageIntegrations', async () => {
    const res = await request(buildApp())
      .get('/api/admin/integrations/sgp')
      .set('Authorization', `Bearer ${tokenFor('manager-1', 'manager')}`);
    expect(res.status).toBe(403);
    expect(listSgpIntegrations).not.toHaveBeenCalled();
  });

  test('returns 200 for a manager with canManageIntegrations', async () => {
    listSgpIntegrations.mockResolvedValue([]);
    const res = await request(buildApp())
      .get('/api/admin/integrations/sgp')
      .set('Authorization', `Bearer ${tokenFor('manager-1', 'manager', true)}`);
    expect(res.status).toBe(200);
  });
```

In `describe('POST /api/admin/integrations/sgp', ...)`, after the test at line 152-159:

```js
  test('returns 403 for a manager without canManageIntegrations', async () => {
    const res = await request(buildApp())
      .post('/api/admin/integrations/sgp')
      .set('Authorization', `Bearer ${tokenFor('manager-1', 'manager')}`)
      .send({ description: 'Baileys', channelId: 'channel-1', enabled: true });
    expect(res.status).toBe(403);
    expect(createSgpIntegration).not.toHaveBeenCalled();
  });
```

In `describe('PUT /api/admin/integrations/sgp/:id', ...)`, after the test at line
200-207:

```js
  test('returns 403 for a manager without canManageIntegrations', async () => {
    const res = await request(buildApp())
      .put('/api/admin/integrations/sgp/int-1')
      .set('Authorization', `Bearer ${tokenFor('manager-1', 'manager')}`)
      .send({ description: 'x', channelId: 'channel-1', enabled: true });
    expect(res.status).toBe(403);
    expect(updateSgpIntegration).not.toHaveBeenCalled();
  });
```

In `describe('POST /api/admin/integrations/sgp/:id/rotate-key', ...)`, after the test
at line 236-242:

```js
  test('returns 403 for a manager without canManageIntegrations', async () => {
    const res = await request(buildApp())
      .post('/api/admin/integrations/sgp/int-1/rotate-key')
      .set('Authorization', `Bearer ${tokenFor('manager-1', 'manager')}`);
    expect(res.status).toBe(403);
    expect(rotateSgpApiKey).not.toHaveBeenCalled();
  });
```

In `describe('GET /api/admin/integrations/sgp-query-config', ...)`, after the test at
line 283-289:

```js
  test('returns 403 for a manager without canManageIntegrations', async () => {
    const res = await request(buildApp())
      .get('/api/admin/integrations/sgp-query-config')
      .set('Authorization', `Bearer ${tokenFor('manager-1', 'manager')}`);
    expect(res.status).toBe(403);
    expect(getSgpQueryConfig).not.toHaveBeenCalled();
  });
```

In `describe('PUT /api/admin/integrations/sgp-query-config', ...)`, after the test at
line 396-403:

```js
  test('returns 403 for a manager without canManageIntegrations', async () => {
    const res = await request(buildApp())
      .put('/api/admin/integrations/sgp-query-config')
      .set('Authorization', `Bearer ${tokenFor('manager-1', 'manager')}`)
      .send({ baseUrl: 'https://x.example', app: 'chatmix', token: 'tok', enabled: true });
    expect(res.status).toBe(403);
    expect(upsertSgpQueryConfig).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `npm test -- admin-integrations.routes.test.js`
Expected: the 403-for-manager tests FAIL (200/201 instead of 403 — same reasoning as
Task 5 Step 2, these routes are open to any manager until this task's Step 3 runs).

- [ ] **Step 3: Implement**

In `src/api/admin-integrations.routes.js`, update the import line:

```js
const { requireAuth, requireIntegrationsAccess } = require('../auth/auth.middleware');
```

Replace every occurrence of `requireRole('admin')` with `requireIntegrationsAccess` in
this file's six route declarations (`GET /sgp`, `POST /sgp`, `PUT /sgp/:id`, `POST
/sgp/:id/rotate-key`, `GET /sgp-query-config`, `PUT /sgp-query-config`) — each is a
one-word swap in the router call's argument list, no other line in any handler changes.

- [ ] **Step 4: Run the tests again to verify they pass**

Run: `npm test -- admin-integrations.routes.test.js`
Expected: PASS, all tests green.

- [ ] **Step 5: Run the full backend suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/api/admin-integrations.routes.js src/api/admin-integrations.routes.test.js
git commit -m "Gate the SGP/Pix integration routes behind requireIntegrationsAccess"
```

---

## Task 7: `admin-ai.routes.js` — gate only the OpenAI key routes

**Files:**
- Modify: `src/api/admin-ai.routes.js`
- Modify: `src/api/admin-ai.routes.test.js`

**Interfaces:**
- Consumes: `requireIntegrationsAccess` from Task 1.

- [ ] **Step 1: Write the failing tests**

In `src/api/admin-ai.routes.test.js`, every test lives in one flat `describe('admin ai
routes', ...)` block (not one `describe` per route). Find `tokenFor`'s definition (line
19-21, takes only `role`, hardcodes `agentId: 'a-1'`) and replace it:

```js
function tokenFor(role, canManageIntegrations = false) {
  return jwt.sign({ agentId: 'a-1', role, canManageIntegrations }, process.env.JWT_SECRET);
}
```

Add these two tests right after `'PUT /config allows saving with apiKey on first
configuration'` (line 115-126):

```js
  test('PUT /config returns 403 for a manager without canManageIntegrations', async () => {
    await request(buildApp()).put('/api/admin/ai/config')
      .set('Authorization', `Bearer ${tokenFor('manager')}`)
      .send({ apiKey: 'sk-newapikey1234', model: 'gpt-x', mode: 'assistant' })
      .expect(403);
    expect(updateAiConfig).not.toHaveBeenCalled();
  });

  test('PUT /config succeeds for a manager with canManageIntegrations', async () => {
    updateAiConfig.mockResolvedValue({ id: 1, apiKey: 'sk-newapikey1234', model: 'gpt-x', mode: 'assistant', systemPrompt: 'p', maxToolsPerInteraction: 8 });
    await request(buildApp()).put('/api/admin/ai/config')
      .set('Authorization', `Bearer ${tokenFor('manager', true)}`)
      .send({ apiKey: 'sk-newapikey1234', model: 'gpt-x', mode: 'assistant' })
      .expect(200);
  });
```

Add this test right after `'POST /test-connection reports a bad key without
throwing'` (line 135-140):

```js
  test('POST /test-connection returns 403 for a manager without canManageIntegrations', async () => {
    await request(buildApp()).post('/api/admin/ai/test-connection')
      .set('Authorization', `Bearer ${tokenFor('manager')}`).send({}).expect(403);
  });
```

Add these five tests proving the non-key routes stay open, right after each one's own
happy-path test: after `'GET /config never returns the full key'` (line 45-51):

```js
  test('GET /config returns 200 for a manager without canManageIntegrations', async () => {
    await request(buildApp()).get('/api/admin/ai/config')
      .set('Authorization', `Bearer ${tokenFor('manager')}`).expect(200);
  });
```

after `'PUT /transcription salva'` (line 204-215):

```js
  test('PUT /transcription returns 200 for a manager without canManageIntegrations', async () => {
    updateTranscriptionConfig.mockResolvedValue({
      transcriptionEnabled: true, transcriptionModel: 'm', transcriptionMaxSeconds: 60,
      transcriptionMaxBytes: 1000, transcriptionPrompt: 'PPPoE', transcriptionFeedAi: true,
    });
    await request(buildApp()).put('/api/admin/ai/transcription')
      .set('Authorization', `Bearer ${tokenFor('manager')}`)
      .send({ transcriptionEnabled: true, transcriptionModel: 'm', transcriptionMaxSeconds: 60,
              transcriptionMaxBytes: 1000, transcriptionPrompt: 'PPPoE', transcriptionFeedAi: true })
      .expect(200);
  });
```

after `'PUT /triage valida e salva'` (line 217-225):

```js
  test('PUT /triage returns 200 for a manager without canManageIntegrations', async () => {
    updateTriageConfig.mockResolvedValue({ triageConfidenceThreshold: 0.9, triageMaxQuestions: 3, triageTimeoutMinutes: 5, triageExtraInstructions: 'x' });
    await request(buildApp()).put('/api/admin/ai/triage').set('Authorization', `Bearer ${tokenFor('manager')}`)
      .send({ triageConfidenceThreshold: 0.9, triageMaxQuestions: 3, triageTimeoutMinutes: 5, triageExtraInstructions: 'x' }).expect(200);
  });
```

after `'GET /tools merges the registry with the stored permissions'` (line 142-150):

```js
  test('GET /tools returns 200 for a manager without canManageIntegrations', async () => {
    await request(buildApp()).get('/api/admin/ai/tools')
      .set('Authorization', `Bearer ${tokenFor('manager')}`).expect(200);
  });
```

after `'PUT /tools/:nome saves a known tool'` (line 158-164):

```js
  test('PUT /tools/:nome returns 200 for a manager without canManageIntegrations', async () => {
    setToolPermission.mockResolvedValue({ toolName: 'consultar_plano', enabled: false });
    await request(buildApp()).put('/api/admin/ai/tools/consultar_plano')
      .set('Authorization', `Bearer ${tokenFor('manager')}`)
      .send({ enabled: false }).expect(200);
  });
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `npm test -- admin-ai.routes.test.js`
Expected: the `PUT /config`/`POST /test-connection` manager-403 tests FAIL (get 200
instead of 403, since Task 1 already opened `requireRole('admin')` to managers and this
task hasn't gated them yet). The `PUT /config` manager-with-flag-succeeds test and the
five "stays open" tests should already PASS at this point (nothing in this file changes
their behavior yet) — if any of those fails, stop and investigate before writing any
implementation code; that would mean this task's premise about which routes are already
open is wrong.

- [ ] **Step 3: Implement**

In `src/api/admin-ai.routes.js`, update the import line:

```js
const { requireAuth, requireRole, requireIntegrationsAccess } = require('../auth/auth.middleware');
```

Change only these two route declarations:

```js
router.put('/config', requireAuth, requireIntegrationsAccess, async (req, res) => {
```
```js
router.post('/test-connection', requireAuth, requireIntegrationsAccess, async (req, res) => {
```

Leave `GET /config`, `PUT /transcription`, `PUT /triage`, `GET /tools`, and `PUT
/tools/:nome` exactly as `requireRole('admin')` — no change to those five lines.

- [ ] **Step 4: Run the tests again to verify they pass**

Run: `npm test -- admin-ai.routes.test.js`
Expected: PASS, all tests green.

- [ ] **Step 5: Run the full backend suite**

Run: `npm test`
Expected: PASS. This is the last backend task — the full suite passing here means every
backend route in the spec is now correctly gated.

- [ ] **Step 6: Commit**

```bash
git add src/api/admin-ai.routes.js src/api/admin-ai.routes.test.js
git commit -m "Gate only the OpenAI key routes behind requireIntegrationsAccess"
```

---

## Task 8: Frontend — who sees what (`ProtectedRoute`, `NavRail`, `ChannelStatusBanner`)

**Files:**
- Modify: `frontend/src/components/ProtectedRoute.jsx`
- Modify: `frontend/src/components/NavRail.jsx`
- Modify: `frontend/src/components/ChannelStatusBanner.jsx`
- Create: `frontend/src/components/ProtectedRoute.test.jsx`
- Modify: `frontend/src/components/NavRail.test.jsx`
- Modify: `frontend/src/components/ChannelStatusBanner.test.jsx`

**Interfaces:**
- Consumes: the contract established by Task 3 — `useAuth()`'s `agent` object may now
  have `role: 'manager'` and a `canManageIntegrations: boolean` field, exactly as
  returned by the backend's `/api/auth/login`.

- [ ] **Step 1: Write the failing tests for `ProtectedRoute`**

`ProtectedRoute.jsx` has no dedicated test file today — its behavior is currently only
exercised indirectly through `App.test.jsx`, which would require mounting the full
`AdminChannelsPage` (many hooks, many API calls) just to prove a routing-guard check.
Test it directly and in isolation instead. Create
`frontend/src/components/ProtectedRoute.test.jsx`:

```jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import ProtectedRoute from './ProtectedRoute';
import { useAuth } from '../contexts/AuthContext';

vi.mock('../contexts/AuthContext');

beforeEach(() => {
  vi.clearAllMocks();
});

function renderProtected({ requireAdmin = false } = {}) {
  return render(
    <MemoryRouter initialEntries={['/target']}>
      <Routes>
        <Route path="/login" element={<div>Login Page</div>} />
        <Route path="/" element={<div>Dashboard Page</div>} />
        <Route
          path="/target"
          element={
            <ProtectedRoute requireAdmin={requireAdmin}>
              <div>Protected Content</div>
            </ProtectedRoute>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

describe('ProtectedRoute', () => {
  test('redirects to /login when there is no token', () => {
    useAuth.mockReturnValue({ token: null, agent: null });
    renderProtected();
    expect(screen.getByText('Login Page')).toBeInTheDocument();
  });

  test('renders the children when a token is present and requireAdmin is false', () => {
    useAuth.mockReturnValue({ token: 'tok-123', agent: { role: 'agent' } });
    renderProtected();
    expect(screen.getByText('Protected Content')).toBeInTheDocument();
  });

  test('redirects a plain agent to / when requireAdmin is true', () => {
    useAuth.mockReturnValue({ token: 'tok-123', agent: { role: 'agent' } });
    renderProtected({ requireAdmin: true });
    expect(screen.getByText('Dashboard Page')).toBeInTheDocument();
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
  });

  test('renders the children for an admin when requireAdmin is true', () => {
    useAuth.mockReturnValue({ token: 'tok-123', agent: { role: 'admin' } });
    renderProtected({ requireAdmin: true });
    expect(screen.getByText('Protected Content')).toBeInTheDocument();
  });

  test('renders the children for a manager when requireAdmin is true', () => {
    useAuth.mockReturnValue({ token: 'tok-123', agent: { role: 'manager' } });
    renderProtected({ requireAdmin: true });
    expect(screen.getByText('Protected Content')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify the manager case fails**

Run: `cd frontend && npx vitest run src/components/ProtectedRoute.test.jsx`
Expected: 4 tests PASS (`redirects to /login...`, `renders the children when a token is
present and requireAdmin is false`, `redirects a plain agent...`, `renders the children
for an admin...` — these already work with today's code), and `'renders the children
for a manager when requireAdmin is true'` FAILS — `role: 'manager'` gets redirected to
`/` today.

- [ ] **Step 3: Implement `ProtectedRoute.jsx`**

Replace the check in `frontend/src/components/ProtectedRoute.jsx`:

```js
  if (requireAdmin && (!agent || (agent.role !== 'admin' && agent.role !== 'manager'))) {
    return <Navigate to="/" replace />;
  }
```

- [ ] **Step 4: Run the tests again to verify they all pass**

Run: `cd frontend && npx vitest run src/components/ProtectedRoute.test.jsx`
Expected: PASS, all 5 tests green.

- [ ] **Step 5: Write the failing tests for `NavRail`**

In `frontend/src/components/NavRail.test.jsx`, add:

```js
  test('shows the admin-only links for a manager', () => {
    useAuth.mockReturnValue({ agent: { id: 'manager-1', name: 'Marcia', role: 'manager' }, logout: vi.fn() });
    renderRail();
    expect(screen.getByLabelText('Dashboard de atendimento')).toBeInTheDocument();
    expect(screen.getByLabelText('Administração')).toBeInTheDocument();
  });

  test('hides Atendimentos encerrados for a manager (they use the Attendance Dashboard instead)', () => {
    useAuth.mockReturnValue({ agent: { id: 'manager-1', name: 'Marcia', role: 'manager' }, logout: vi.fn() });
    renderRail();
    expect(screen.queryByLabelText('Atendimentos encerrados')).not.toBeInTheDocument();
  });
```

(Follow the exact pattern of the existing `'shows the admin-only links for an admin
agent'` and `'hides Atendimentos encerrados for an admin agent...'` tests already in
this file — same `renderRail()` helper, same assertions, only the mocked role differs.)

- [ ] **Step 6: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/NavRail.test.jsx -t "manager"`
Expected: FAIL — both `agent?.role === 'admin'` checks in `NavRail.jsx` exact-match
`'admin'`, so a `'manager'` role gets neither the admin links nor the hidden
Atendimentos-encerrados icon.

- [ ] **Step 7: Implement `NavRail.jsx`**

In `frontend/src/components/NavRail.jsx`, replace:

```js
          {agent?.role === 'admin' && (
```
with:
```js
          {(agent?.role === 'admin' || agent?.role === 'manager') && (
```

Replace:
```js
          {agent?.role !== 'admin' && (
```
with:
```js
          {agent?.role !== 'admin' && agent?.role !== 'manager' && (
```

- [ ] **Step 8: Run the tests again to verify they pass**

Run: `cd frontend && npx vitest run src/components/NavRail.test.jsx`
Expected: PASS, all tests green.

- [ ] **Step 9: Write the failing tests for `ChannelStatusBanner`**

In `frontend/src/components/ChannelStatusBanner.test.jsx`, add two tests using the
file's existing `renderBanner()` helper (defined at the top of the file):

```js
  test('warns a manager with canManageIntegrations about a disconnected channel', () => {
    useAuth.mockReturnValue({ agent: { role: 'manager', canManageIntegrations: true } });
    useChannels.mockReturnValue({
      channels: [{ id: 'ch1', name: 'Berg', status: 'disconnected' }],
      loading: false,
    });
    renderBanner();
    expect(screen.getByText(/Berg/)).toBeInTheDocument();
    expect(screen.getByText(/desconectado/i)).toBeInTheDocument();
  });

  test('renders nothing for a manager without canManageIntegrations', () => {
    useAuth.mockReturnValue({ agent: { role: 'manager', canManageIntegrations: false } });
    useChannels.mockReturnValue({
      channels: [{ id: 'ch1', name: 'Berg', status: 'disconnected' }],
      loading: false,
    });
    const { container } = renderBanner();
    expect(container).toBeEmptyDOMElement();
  });
```

- [ ] **Step 10: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/ChannelStatusBanner.test.jsx -t "manager"`
Expected: FAIL — `isAdmin` in `ChannelStatusBanner.jsx` is `agent?.role === 'admin'`,
so a manager (with or without the flag) never fetches or shows the banner.

- [ ] **Step 11: Implement `ChannelStatusBanner.jsx`**

Replace:
```js
  const isAdmin = agent?.role === 'admin';
  const { channels } = useChannels(isAdmin);

  if (!isAdmin) return null;
```
with:
```js
  const canSeeBanner = agent?.role === 'admin' || (agent?.role === 'manager' && agent?.canManageIntegrations === true);
  const { channels } = useChannels(canSeeBanner);

  if (!canSeeBanner) return null;
```

- [ ] **Step 12: Run the tests again to verify they pass**

Run: `cd frontend && npx vitest run src/components/ChannelStatusBanner.test.jsx`
Expected: PASS, all tests green.

- [ ] **Step 13: Run the full frontend suite**

Run: `cd frontend && npx vitest run`
Expected: PASS.

- [ ] **Step 14: Commit**

```bash
git add frontend/src/components/ProtectedRoute.jsx frontend/src/components/ProtectedRoute.test.jsx frontend/src/components/NavRail.jsx frontend/src/components/ChannelStatusBanner.jsx frontend/src/components/NavRail.test.jsx frontend/src/components/ChannelStatusBanner.test.jsx
git commit -m "Let managers reach admin routes and the connectivity banner"
```

---

## Task 9: Frontend — create a manager (`CreateAgentForm`, `AgentsAdminTab`)

**Files:**
- Modify: `frontend/src/components/CreateAgentForm.jsx`
- Modify: `frontend/src/components/AgentsAdminTab.jsx`
- Modify: `frontend/src/components/CreateAgentForm.test.jsx`
- Modify: `frontend/src/components/AgentsAdminTab.test.jsx`

**Interfaces:**
- Consumes: `createAgent(payload, token)` from `frontend/src/services/api.js` — no
  signature change, `payload` just may now include `canManageIntegrations`.

- [ ] **Step 1: Write the failing tests for `CreateAgentForm`**

In `frontend/src/components/CreateAgentForm.test.jsx`, add after the existing `'creates
an admin when the admin role is selected'` test:

```js
  test('does not show the integrations checkbox for the agent or admin role', () => {
    render(<CreateAgentForm onCreated={vi.fn()} />);
    expect(screen.queryByLabelText(/pode gerenciar canais e integrações/i)).not.toBeInTheDocument();
  });

  test('shows the integrations checkbox when the manager role is selected', async () => {
    render(<CreateAgentForm onCreated={vi.fn()} />);
    await userEvent.selectOptions(screen.getByLabelText(/tipo/i), 'manager');
    expect(screen.getByLabelText(/pode gerenciar canais e integrações/i)).toBeInTheDocument();
  });

  test('creates a manager with canManageIntegrations checked', async () => {
    api.createAgent.mockResolvedValue({ id: 'a3' });
    render(<CreateAgentForm onCreated={vi.fn()} />);

    await userEvent.type(screen.getByLabelText(/nome/i), 'Marcia Reis');
    await userEvent.type(screen.getByLabelText(/email/i), 'marcia@dw.com');
    await userEvent.type(screen.getByLabelText(/senha temporária/i), 'temp11223');
    await userEvent.selectOptions(screen.getByLabelText(/tipo/i), 'manager');
    await userEvent.click(screen.getByLabelText(/pode gerenciar canais e integrações/i));
    await userEvent.click(screen.getByRole('button', { name: /cadastrar/i }));

    await waitFor(() =>
      expect(api.createAgent).toHaveBeenCalledWith(
        { name: 'Marcia Reis', email: 'marcia@dw.com', password: 'temp11223', role: 'manager', canManageIntegrations: true },
        'tok-123'
      )
    );
  });

  test('creates a manager with canManageIntegrations false when the checkbox is left unchecked', async () => {
    api.createAgent.mockResolvedValue({ id: 'a4' });
    render(<CreateAgentForm onCreated={vi.fn()} />);

    await userEvent.type(screen.getByLabelText(/nome/i), 'Nilo Reis');
    await userEvent.type(screen.getByLabelText(/email/i), 'nilo@dw.com');
    await userEvent.type(screen.getByLabelText(/senha temporária/i), 'temp44556');
    await userEvent.selectOptions(screen.getByLabelText(/tipo/i), 'manager');
    await userEvent.click(screen.getByRole('button', { name: /cadastrar/i }));

    await waitFor(() =>
      expect(api.createAgent).toHaveBeenCalledWith(
        { name: 'Nilo Reis', email: 'nilo@dw.com', password: 'temp44556', role: 'manager', canManageIntegrations: false },
        'tok-123'
      )
    );
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/CreateAgentForm.test.jsx`
Expected: the four new tests FAIL — there's no "Gerente" `<option>`, no checkbox, and
the payload never includes `canManageIntegrations`. The two pre-existing tests
('creates an agent with the default role', 'creates an admin...') still PASS unchanged.

- [ ] **Step 3: Implement**

Replace the full contents of `frontend/src/components/CreateAgentForm.jsx`:

```jsx
import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { createAgent } from '../services/api';

const inputClass =
  'w-full rounded-xl border border-wa-border bg-wa-field px-3.5 py-2.5 text-wa-text placeholder-wa-muted outline-none transition focus:border-wa-green/60 focus:bg-wa-panel focus:ring-2 focus:ring-wa-green/25';
const labelClass = 'mb-1.5 block text-sm font-medium text-wa-muted';

function CreateAgentForm({ onCreated, onCancel }) {
  const { token } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('agent');
  const [canManageIntegrations, setCanManageIntegrations] = useState(false);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const payload = { name, email, password, role };
      if (role === 'manager') {
        payload.canManageIntegrations = canManageIntegrations;
      }
      await createAgent(payload, token);
      setName('');
      setEmail('');
      setPassword('');
      setRole('agent');
      setCanManageIntegrations(false);
      onCreated();
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao cadastrar atendente');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-3 rounded-[16px] border border-wa-border bg-wa-surface p-5"
    >
      <h3 className="text-[15px] font-medium text-wa-text">Cadastrar novo atendente</h3>
      <div>
        <label htmlFor="agent-name" className={labelClass}>
          Nome
        </label>
        <input
          id="agent-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
          required
        />
      </div>
      <div>
        <label htmlFor="agent-email" className={labelClass}>
          Email
        </label>
        <input
          id="agent-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass}
          required
        />
      </div>
      <div>
        <label htmlFor="agent-password" className={labelClass}>
          Senha temporária
        </label>
        <input
          id="agent-password"
          type="text"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputClass}
          required
        />
      </div>
      <div>
        <label htmlFor="agent-role" className={labelClass}>
          Tipo
        </label>
        <select
          id="agent-role"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className={inputClass}
        >
          <option value="agent">Atendente</option>
          <option value="manager">Gerente</option>
          <option value="admin">Administrador</option>
        </select>
      </div>
      {role === 'manager' && (
        <label className="flex items-center gap-2 text-sm text-wa-muted">
          <input
            type="checkbox"
            checked={canManageIntegrations}
            onChange={(e) => setCanManageIntegrations(e.target.checked)}
            className="h-4 w-4 accent-wa-green"
          />
          Pode gerenciar Canais e Integrações
        </label>
      )}
      {error && <p className="rounded-lg border border-wa-error-text/30 bg-wa-error-bg px-3 py-2 text-sm text-wa-error-text">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-[12px] bg-wa-green px-5 py-2.5 text-[14px] font-medium text-white transition hover:bg-wa-green-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wa-green disabled:cursor-not-allowed disabled:opacity-50"
        >
          Cadastrar
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-wa-border bg-wa-surface px-3 py-1.5 text-sm font-medium text-wa-muted transition hover:bg-wa-panel hover:text-wa-text"
          >
            Cancelar
          </button>
        )}
      </div>
    </form>
  );
}

export default CreateAgentForm;
```

- [ ] **Step 4: Run the tests again to verify they pass**

Run: `cd frontend && npx vitest run src/components/CreateAgentForm.test.jsx`
Expected: PASS, all tests green (6 total: 2 pre-existing + 4 new).

- [ ] **Step 5: Write the failing test for `AgentsAdminTab`**

In `frontend/src/components/AgentsAdminTab.test.jsx`, add:

```js
  test('shows Gerente as the role label for a manager', () => {
    useAgentsAdmin.mockReturnValue({
      agents: [{ id: 'a1', name: 'Marcia', email: 'marcia@dw.com', role: 'manager', active: true, sectors: [] }],
      refresh: vi.fn(),
    });
    render(<AgentsAdminTab />);
    expect(screen.getByText(/Gerente/)).toBeInTheDocument();
  });
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/components/AgentsAdminTab.test.jsx -t "Gerente"`
Expected: FAIL — `roleLabel` only distinguishes `'admin'` from everything else, so a
`'manager'` row shows "Atendente".

- [ ] **Step 7: Implement**

In `frontend/src/components/AgentsAdminTab.jsx`, replace:

```js
  const roleLabel = agentRow.role === 'admin' ? 'Administrador' : 'Atendente';
```
with:
```js
  const roleLabel = agentRow.role === 'admin' ? 'Administrador' : agentRow.role === 'manager' ? 'Gerente' : 'Atendente';
```

- [ ] **Step 8: Run the test again to verify it passes**

Run: `cd frontend && npx vitest run src/components/AgentsAdminTab.test.jsx`
Expected: PASS, all tests green.

- [ ] **Step 9: Run the full frontend suite**

Run: `cd frontend && npx vitest run`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/components/CreateAgentForm.jsx frontend/src/components/AgentsAdminTab.jsx frontend/src/components/CreateAgentForm.test.jsx frontend/src/components/AgentsAdminTab.test.jsx
git commit -m "Add the manager role and integrations checkbox to agent creation"
```

---

## Task 10: Frontend — hide Canais/Integrações in `AdminChannelsPage`

**Files:**
- Modify: `frontend/src/pages/AdminChannelsPage.jsx`
- Modify: `frontend/src/pages/AdminChannelsPage.test.jsx`

**Interfaces:**
- Consumes: the `agent.role`/`agent.canManageIntegrations` contract from Task 3/8.

- [ ] **Step 1: Write the failing tests**

`frontend/src/pages/AdminChannelsPage.test.jsx` has no shared render helper — every
test calls `render(<MemoryRouter><AdminChannelsPage /></MemoryRouter>)` inline, and its
`beforeEach` (line 41-61) sets a default for every mocked hook except `useChannels`,
which each test sets explicitly. Add three tests following that same shape:

```js
  test('hides Canais and Integrações for a manager without canManageIntegrations', () => {
    useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'manager-1', role: 'manager', canManageIntegrations: false } });
    useChannels.mockReturnValue({ channels: [], loading: false, refresh: vi.fn() });
    render(
      <MemoryRouter>
        <AdminChannelsPage />
      </MemoryRouter>
    );
    expect(screen.queryByRole('button', { name: /^canais$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /integrações/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /triagem/i })).toBeInTheDocument();
  });

  test('shows Canais and Integrações for a manager with canManageIntegrations', () => {
    useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'manager-1', role: 'manager', canManageIntegrations: true } });
    useChannels.mockReturnValue({ channels: [], loading: false, refresh: vi.fn() });
    render(
      <MemoryRouter>
        <AdminChannelsPage />
      </MemoryRouter>
    );
    expect(screen.getByRole('button', { name: /^canais$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /integrações/i })).toBeInTheDocument();
  });

  test('defaults to the Triagem tab for a manager without canManageIntegrations, not the hidden Canais tab', () => {
    useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'manager-1', role: 'manager', canManageIntegrations: false } });
    useChannels.mockReturnValue({ channels: [], loading: false, refresh: vi.fn() });
    render(
      <MemoryRouter>
        <AdminChannelsPage />
      </MemoryRouter>
    );
    expect(screen.getByText('O menu que o cliente recebe antes de falar com um atendente.')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/pages/AdminChannelsPage.test.jsx -t "manager"`
Expected: FAIL — `SECTION_GROUPS` is a fixed constant today, so Canais and Integrações
always render regardless of role, and `activeTab` always defaults to `'channels'`.

- [ ] **Step 3: Implement**

In `frontend/src/pages/AdminChannelsPage.jsx`, replace the `useAuth()` destructure and
the `activeTab` state near the top of the `AdminChannelsPage` function:

```js
  const { token, agent } = useAuth();
  const hasIntegrationsAccess = agent?.role === 'admin' || (agent?.role === 'manager' && agent?.canManageIntegrations === true);
  const [showHidden, setShowHidden] = useState(false);
  const { channels, refresh } = useChannels(true, showHidden);
  const [activeTab, setActiveTab] = useState(hasIntegrationsAccess ? 'channels' : 'triage');
```

Add this right after the `SECTIONS` constant definition (module scope, near line 68,
stays outside the component — it's a pure function of the flag, computed inside the
component from the module-level `SECTION_GROUPS`):

Inside the `AdminChannelsPage` function body, right after the `hasIntegrationsAccess`
line above, add:

```js
  const visibleSectionGroups = hasIntegrationsAccess
    ? SECTION_GROUPS
    : SECTION_GROUPS.map((group) => ({ ...group, items: group.items.filter((item) => item.value !== 'channels') }))
        .filter((group) => group.group !== 'Integrações');
  const visibleSections = visibleSectionGroups.flatMap((group) => group.items);
```

Replace:
```js
  const section = SECTIONS.find((item) => item.value === activeTab) || SECTIONS[0];
```
with:
```js
  const section = visibleSections.find((item) => item.value === activeTab) || visibleSections[0];
```

Replace the nav rendering:
```js
            {SECTION_GROUPS.map((group) => (
```
with:
```js
            {visibleSectionGroups.map((group) => (
```

Leave everything else in the file — including the "Criar canal" button and the
`activeTab === 'channels' ? (...)` content block — untouched. A manager without the flag
never reaches `'channels'` through the nav or the default tab, so that content simply
never renders for them in normal use; the API-level `requireIntegrationsAccess` (Task 5)
is the actual security boundary, this is only the navigation-level UX.

- [ ] **Step 4: Run the tests again to verify they pass**

Run: `cd frontend && npx vitest run src/pages/AdminChannelsPage.test.jsx`
Expected: PASS, all tests green.

- [ ] **Step 5: Run the full frontend suite**

Run: `cd frontend && npx vitest run`
Expected: PASS. This is the last frontend task.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/AdminChannelsPage.jsx frontend/src/pages/AdminChannelsPage.test.jsx
git commit -m "Hide Canais and Integrações navigation for a manager without the flag"
```

---

## Final verification (after all 10 tasks)

- [ ] Run `npm test` (backend) — full suite green.
- [ ] Run `cd frontend && npx vitest run` (frontend) — full suite green.
- [ ] Manually confirm (via `psql` or the Render dashboard once deployed) that
  `\d agents` shows the `agents_role_check` constraint allowing `'manager'` and a
  `can_manage_integrations` column, `NOT NULL DEFAULT false`.
- [ ] Log in as a freshly created manager (with and without the flag) in a local/dev
  environment and click through: create an attendant, reset an attendant's password,
  open the Dashboard de Atendimento, and confirm Canais/Integrações are hidden or shown
  exactly as expected for that flag.
