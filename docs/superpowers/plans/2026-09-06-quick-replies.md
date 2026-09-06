# Respostas rápidas (quick replies) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin cadastrar (create/edit/delete) a shared list of reusable message templates ("respostas rápidas"), and let any attendant pick one from a button next to the message compose box to prefill the text before sending.

**Architecture:** One new table (`quick_replies`), a repository module, two route files split by auth level (an open `GET` for any attendant, an admin-only CRUD trio) — mirroring the exact split already used for channels (`channels.routes.js` vs `admin-channels.routes.js`) and agents (`agents.routes.js` vs `admin-agents.routes.js`). Frontend: a third admin tab for management, and a picker button added to the existing `MessageInput` component (fed via a prop from `ConversationView`, not a context dependency inside `MessageInput` itself — keeps `MessageInput` a pure, prop-driven component as it is today).

**Tech Stack:** Node.js/Express, node-pg-migrate, Jest + Supertest (backend), React 18 + Vitest + Testing Library (frontend). No new dependencies.

**Spec:** [docs/superpowers/specs/2026-09-06-quick-replies-design.md](../specs/2026-09-06-quick-replies-design.md)

## Global Constraints

- Shared list only — no per-agent ownership column, no personal quick replies in this delivery.
- No variables/placeholders, no categories/folders — a quick reply is exactly `{title, content}`, flat list ordered by title.
- Reading the list (`GET /api/quick-replies`) is open to **any authenticated agent** (`requireAuth` only) — mirrors `GET /api/agents` and `GET /api/channels`. Creating, editing, and deleting are **admin-only** (`requireAuth` + `requireRole('admin')`), in a separate route file mounted under `/api/admin/`.
- Selecting a quick reply in the compose box **replaces** whatever the attendant had already typed — it does not insert at cursor position or append. The attendant can still edit before sending; nothing is auto-sent.
- Every route follows the JSON error-body convention already used everywhere in this codebase: `res.status(<code>).json({ error: '<message>' })`.
- `MessageInput.jsx` stays a pure, prop-driven component with no context/data-fetching of its own (matches its current design) — the quick-replies list is fetched by `ConversationView` (which already uses `useAuth`) and passed down as a `quickReplies` prop.

---

### Task 1: Backend — `quick_replies` table + repository

**Files:**
- Create: `migrations/1788720000000_create-quick-replies-table.js`
- Create: `src/quick-replies/quick-reply.repository.js`
- Test: `src/quick-replies/quick-reply.repository.test.js`

**Interfaces:**
- Produces: `listQuickReplies()` → `Promise<[{id, title, content, createdAt, updatedAt}]>` ordered by `title` ascending. `createQuickReply({title, content})` → `Promise<{id, title, content, createdAt, updatedAt}>`. `updateQuickReply(id, {title, content})` → the updated row, or `null` if `id` doesn't exist. `deleteQuickReply(id)` → `true` if a row was deleted, `false` if `id` didn't exist. Task 2's routes consume all four of these exact signatures.

- [ ] **Step 1: Write the failing test**

Create `src/quick-replies/quick-reply.repository.test.js`:

```js
const { getPool, closePool } = require('../db/pool');
const { listQuickReplies, createQuickReply, updateQuickReply, deleteQuickReply } = require('./quick-reply.repository');

describe('quick-reply repository', () => {
  beforeEach(async () => {
    await getPool().query('TRUNCATE quick_replies CASCADE');
  });

  afterAll(async () => {
    await closePool();
  });

  test('createQuickReply stores and returns a quick reply', async () => {
    const quickReply = await createQuickReply({ title: 'Boas-vindas', content: 'Olá! Como posso ajudar?' });
    expect(quickReply.id).toBeDefined();
    expect(quickReply.title).toBe('Boas-vindas');
    expect(quickReply.content).toBe('Olá! Como posso ajudar?');
    expect(quickReply.createdAt).toBeDefined();
  });

  test('listQuickReplies returns an empty array when there are none', async () => {
    const quickReplies = await listQuickReplies();
    expect(quickReplies).toEqual([]);
  });

  test('listQuickReplies returns all quick replies ordered by title', async () => {
    await createQuickReply({ title: 'Zebra', content: 'Conteúdo Z' });
    await createQuickReply({ title: 'Abelha', content: 'Conteúdo A' });

    const quickReplies = await listQuickReplies();

    expect(quickReplies.map((q) => q.title)).toEqual(['Abelha', 'Zebra']);
  });

  test('updateQuickReply updates and returns the quick reply with new values', async () => {
    const quickReply = await createQuickReply({ title: 'Original', content: 'Texto original' });

    const updated = await updateQuickReply(quickReply.id, { title: 'Editado', content: 'Texto editado' });

    expect(updated.id).toBe(quickReply.id);
    expect(updated.title).toBe('Editado');
    expect(updated.content).toBe('Texto editado');
  });

  test('updateQuickReply returns null when the id does not exist', async () => {
    const updated = await updateQuickReply('00000000-0000-0000-0000-000000000000', { title: 'X', content: 'Y' });
    expect(updated).toBeNull();
  });

  test('deleteQuickReply removes the row and returns true', async () => {
    const quickReply = await createQuickReply({ title: 'Para excluir', content: 'Texto' });

    const deleted = await deleteQuickReply(quickReply.id);

    expect(deleted).toBe(true);
    expect(await listQuickReplies()).toEqual([]);
  });

  test('deleteQuickReply returns false when the id does not exist', async () => {
    const deleted = await deleteQuickReply('00000000-0000-0000-0000-000000000000');
    expect(deleted).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/quick-replies/quick-reply.repository.test.js`
Expected: FAIL — `Cannot find module './quick-reply.repository'` (and, once that's created empty, `relation "quick_replies" does not exist` until the migration is applied).

- [ ] **Step 3: Write the migration**

Create `migrations/1788720000000_create-quick-replies-table.js`:

```js
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE quick_replies (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE quick_replies;`);
};
```

Run: `npm run migrate:test -- up` — this project's `pretest` script runs this automatically before every `npm test`, but running it once explicitly here lets you confirm the migration itself applies cleanly before writing the repository code.

- [ ] **Step 4: Write the repository**

Create `src/quick-replies/quick-reply.repository.js`:

```js
const { getPool } = require('../db/pool');

function toQuickReply(row) {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function listQuickReplies() {
  const result = await getPool().query(
    'SELECT id, title, content, created_at, updated_at FROM quick_replies ORDER BY title ASC'
  );
  return result.rows.map(toQuickReply);
}

async function createQuickReply({ title, content }) {
  const result = await getPool().query(
    `INSERT INTO quick_replies (title, content) VALUES ($1, $2)
     RETURNING id, title, content, created_at, updated_at`,
    [title, content]
  );
  return toQuickReply(result.rows[0]);
}

async function updateQuickReply(id, { title, content }) {
  const result = await getPool().query(
    `UPDATE quick_replies SET title = $2, content = $3, updated_at = now()
     WHERE id = $1
     RETURNING id, title, content, created_at, updated_at`,
    [id, title, content]
  );
  if (result.rowCount === 0) return null;
  return toQuickReply(result.rows[0]);
}

async function deleteQuickReply(id) {
  const result = await getPool().query('DELETE FROM quick_replies WHERE id = $1', [id]);
  return result.rowCount > 0;
}

module.exports = { listQuickReplies, createQuickReply, updateQuickReply, deleteQuickReply };
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- src/quick-replies/quick-reply.repository.test.js`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add migrations/1788720000000_create-quick-replies-table.js src/quick-replies/quick-reply.repository.js src/quick-replies/quick-reply.repository.test.js
git commit -m "Add quick_replies table and repository"
```

---

### Task 2: Backend — `GET /api/quick-replies` + admin CRUD routes

**Files:**
- Create: `src/api/quick-replies.routes.js`
- Create: `src/api/quick-replies.routes.test.js`
- Create: `src/api/admin-quick-replies.routes.js`
- Create: `src/api/admin-quick-replies.routes.test.js`
- Modify: `src/server.js`

**Interfaces:**
- Consumes: `listQuickReplies`, `createQuickReply`, `updateQuickReply`, `deleteQuickReply` from `src/quick-replies/quick-reply.repository.js` (Task 1).
- Produces: `GET /api/quick-replies` (any authenticated agent, 200 with the array). `POST /api/admin/quick-replies` (admin, 201 with the created quick reply, 400 if `title`/`content` missing). `PATCH /api/admin/quick-replies/:id` (admin, 200 with the updated quick reply, 400 if `title`/`content` missing, 404 if `id` doesn't exist). `DELETE /api/admin/quick-replies/:id` (admin, 204 empty body, 404 if `id` doesn't exist). Task 3's frontend API functions call these four exactly.

- [ ] **Step 1: Write the failing tests**

Create `src/api/quick-replies.routes.test.js`:

```js
jest.mock('../quick-replies/quick-reply.repository');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const { listQuickReplies } = require('../quick-replies/quick-reply.repository');
const quickRepliesRoutes = require('./quick-replies.routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/quick-replies', quickRepliesRoutes);
  return app;
}

function tokenFor(agentId, role) {
  return jwt.sign({ agentId, role }, process.env.JWT_SECRET);
}

describe('GET /api/quick-replies', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns the quick reply list for any authenticated agent', async () => {
    listQuickReplies.mockResolvedValue([
      { id: 'qr-1', title: 'Boas-vindas', content: 'Olá!', createdAt: new Date(), updatedAt: new Date() },
    ]);

    const res = await request(buildApp())
      .get('/api/quick-replies')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: 'qr-1', title: 'Boas-vindas', content: 'Olá!', createdAt: expect.any(String), updatedAt: expect.any(String) },
    ]);
  });

  test('returns 401 without a token', async () => {
    const res = await request(buildApp()).get('/api/quick-replies');
    expect(res.status).toBe(401);
    expect(listQuickReplies).not.toHaveBeenCalled();
  });
});
```

Create `src/api/admin-quick-replies.routes.test.js`:

```js
jest.mock('../quick-replies/quick-reply.repository');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const {
  createQuickReply,
  updateQuickReply,
  deleteQuickReply,
} = require('../quick-replies/quick-reply.repository');
const adminQuickRepliesRoutes = require('./admin-quick-replies.routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/quick-replies', adminQuickRepliesRoutes);
  return app;
}

function tokenFor(agentId, role) {
  return jwt.sign({ agentId, role }, process.env.JWT_SECRET);
}

describe('POST /api/admin/quick-replies', () => {
  beforeEach(() => jest.clearAllMocks());

  test('creates a new quick reply', async () => {
    createQuickReply.mockResolvedValue({
      id: 'qr-1',
      title: 'Boas-vindas',
      content: 'Olá!',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await request(buildApp())
      .post('/api/admin/quick-replies')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ title: 'Boas-vindas', content: 'Olá!' });

    expect(res.status).toBe(201);
    expect(createQuickReply).toHaveBeenCalledWith({ title: 'Boas-vindas', content: 'Olá!' });
    expect(res.body.id).toBe('qr-1');
  });

  test('returns 400 when title or content is missing', async () => {
    const res = await request(buildApp())
      .post('/api/admin/quick-replies')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ title: 'Boas-vindas' });

    expect(res.status).toBe(400);
    expect(createQuickReply).not.toHaveBeenCalled();
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .post('/api/admin/quick-replies')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ title: 'Boas-vindas', content: 'Olá!' });

    expect(res.status).toBe(403);
    expect(createQuickReply).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/admin/quick-replies/:id', () => {
  beforeEach(() => jest.clearAllMocks());

  test('updates an existing quick reply', async () => {
    updateQuickReply.mockResolvedValue({
      id: 'qr-1',
      title: 'Editado',
      content: 'Texto editado',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await request(buildApp())
      .patch('/api/admin/quick-replies/qr-1')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ title: 'Editado', content: 'Texto editado' });

    expect(res.status).toBe(200);
    expect(updateQuickReply).toHaveBeenCalledWith('qr-1', { title: 'Editado', content: 'Texto editado' });
    expect(res.body.title).toBe('Editado');
  });

  test('returns 400 when title or content is missing', async () => {
    const res = await request(buildApp())
      .patch('/api/admin/quick-replies/qr-1')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ title: 'Editado' });

    expect(res.status).toBe(400);
    expect(updateQuickReply).not.toHaveBeenCalled();
  });

  test('returns 404 when the quick reply does not exist', async () => {
    updateQuickReply.mockResolvedValue(null);

    const res = await request(buildApp())
      .patch('/api/admin/quick-replies/does-not-exist')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ title: 'Editado', content: 'Texto editado' });

    expect(res.status).toBe(404);
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .patch('/api/admin/quick-replies/qr-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ title: 'Editado', content: 'Texto editado' });

    expect(res.status).toBe(403);
    expect(updateQuickReply).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/admin/quick-replies/:id', () => {
  beforeEach(() => jest.clearAllMocks());

  test('deletes an existing quick reply', async () => {
    deleteQuickReply.mockResolvedValue(true);

    const res = await request(buildApp())
      .delete('/api/admin/quick-replies/qr-1')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);

    expect(res.status).toBe(204);
    expect(deleteQuickReply).toHaveBeenCalledWith('qr-1');
  });

  test('returns 404 when the quick reply does not exist', async () => {
    deleteQuickReply.mockResolvedValue(false);

    const res = await request(buildApp())
      .delete('/api/admin/quick-replies/does-not-exist')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);

    expect(res.status).toBe(404);
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .delete('/api/admin/quick-replies/qr-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);

    expect(res.status).toBe(403);
    expect(deleteQuickReply).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/api/quick-replies.routes.test.js src/api/admin-quick-replies.routes.test.js`
Expected: FAIL — `Cannot find module './quick-replies.routes'` / `'./admin-quick-replies.routes'`.

- [ ] **Step 3: Implement the routes**

Create `src/api/quick-replies.routes.js`:

```js
const express = require('express');
const { requireAuth } = require('../auth/auth.middleware');
const { listQuickReplies } = require('../quick-replies/quick-reply.repository');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  const quickReplies = await listQuickReplies();
  res.json(quickReplies);
});

module.exports = router;
```

Create `src/api/admin-quick-replies.routes.js`:

```js
const express = require('express');
const { requireAuth, requireRole } = require('../auth/auth.middleware');
const {
  createQuickReply,
  updateQuickReply,
  deleteQuickReply,
} = require('../quick-replies/quick-reply.repository');

const router = express.Router();

router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  const { title, content } = req.body || {};
  if (!title || !content) {
    return res.status(400).json({ error: 'title and content are required' });
  }
  const quickReply = await createQuickReply({ title, content });
  res.status(201).json(quickReply);
});

router.patch('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const { title, content } = req.body || {};
  if (!title || !content) {
    return res.status(400).json({ error: 'title and content are required' });
  }
  const quickReply = await updateQuickReply(req.params.id, { title, content });
  if (!quickReply) {
    return res.status(404).json({ error: 'Quick reply not found' });
  }
  res.json(quickReply);
});

router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const deleted = await deleteQuickReply(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: 'Quick reply not found' });
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
const adminChannelsRoutes = require('./api/admin-channels.routes');
const adminAgentsRoutes = require('./api/admin-agents.routes');
const adminQuickRepliesRoutes = require('./api/admin-quick-replies.routes');
```

And mount them next to their siblings:

```js
app.use('/api/conversations', conversationsRoutes);
app.use('/api/agents', agentsRoutes);
app.use('/api/channels', channelsRoutes);
app.use('/api/quick-replies', quickRepliesRoutes);
app.use('/api/admin/channels', adminChannelsRoutes);
app.use('/api/admin/agents', adminAgentsRoutes);
app.use('/api/admin/quick-replies', adminQuickRepliesRoutes);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/api/quick-replies.routes.test.js src/api/admin-quick-replies.routes.test.js`
Expected: PASS (2 tests + 9 tests = 11 tests).

- [ ] **Step 5: Commit**

```bash
git add src/api/quick-replies.routes.js src/api/quick-replies.routes.test.js src/api/admin-quick-replies.routes.js src/api/admin-quick-replies.routes.test.js src/server.js
git commit -m "Add quick-replies routes (open list, admin CRUD)"
```

---

### Task 3: Frontend — admin management (api.js, hook, form, tab)

**Files:**
- Modify: `frontend/src/services/api.js`
- Modify: `frontend/src/services/api.test.js`
- Create: `frontend/src/hooks/useQuickReplies.js`
- Create: `frontend/src/hooks/useQuickReplies.test.jsx`
- Create: `frontend/src/components/CreateQuickReplyForm.jsx`
- Create: `frontend/src/components/CreateQuickReplyForm.test.jsx`
- Create: `frontend/src/components/QuickRepliesAdminTab.jsx`
- Create: `frontend/src/components/QuickRepliesAdminTab.test.jsx`
- Modify: `frontend/src/pages/AdminChannelsPage.jsx`
- Modify: `frontend/src/pages/AdminChannelsPage.test.jsx`

**Interfaces:**
- Consumes: Task 2's four routes. `apiFetch` (already in `api.js`). `useAuth()` from `frontend/src/contexts/AuthContext.jsx`.
- Produces: `listQuickReplies(token)`, `createQuickReply(payload, token)`, `updateQuickReply(id, payload, token)`, `deleteQuickReply(id, token)` in `api.js`. `useQuickReplies()` → `{quickReplies, loading, refresh}` — Task 4 also imports this hook. `QuickRepliesAdminTab` — a self-contained component Task 4 does NOT touch (it lives entirely inside the "Respostas rápidas" admin tab).

- [ ] **Step 1: Write the failing tests**

In `frontend/src/services/api.test.js`, update the import list at the top to add the four new functions:

```js
import {
  apiFetch,
  ApiError,
  login,
  getQueue,
  setUnauthorizedHandler,
  sendMessage,
  mediaUrl,
  listAgentsAdmin,
  createAgent,
  setAgentActive,
  changePassword,
  getConversationHistory,
  listChannelsForAgent,
  startConversation,
  listQuickReplies,
  createQuickReply,
  updateQuickReply,
  deleteQuickReply,
} from './api';
```

Append these `describe` blocks at the end of the file:

```js
describe('listQuickReplies', () => {
  test('fetches the quick reply list for any authenticated agent', async () => {
    global.fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('[]') });
    await listQuickReplies('tok-123');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/quick-replies',
      expect.objectContaining({ method: 'GET' })
    );
  });
});

describe('createQuickReply', () => {
  test('posts the new quick reply payload', async () => {
    global.fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('{}') });
    await createQuickReply({ title: 'Boas-vindas', content: 'Olá!' }, 'tok-123');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/admin/quick-replies',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ title: 'Boas-vindas', content: 'Olá!' }),
      })
    );
  });
});

describe('updateQuickReply', () => {
  test('patches the quick reply payload', async () => {
    global.fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('{}') });
    await updateQuickReply('qr-1', { title: 'Editado', content: 'Texto editado' }, 'tok-123');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/admin/quick-replies/qr-1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ title: 'Editado', content: 'Texto editado' }),
      })
    );
  });
});

describe('deleteQuickReply', () => {
  test('sends a DELETE request for the quick reply', async () => {
    global.fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('') });
    await deleteQuickReply('qr-1', 'tok-123');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/admin/quick-replies/qr-1',
      expect.objectContaining({ method: 'DELETE' })
    );
  });
});
```

Create `frontend/src/hooks/useQuickReplies.test.jsx`, matching the exact style of the existing `frontend/src/hooks/useAgentsAdmin.test.jsx` (namespace import of `services/api`, `act` around the manual `refresh()` call):

```jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useQuickReplies } from './useQuickReplies';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
});

describe('useQuickReplies', () => {
  test('fetches quick replies on mount', async () => {
    api.listQuickReplies.mockResolvedValue([{ id: 'qr-1', title: 'Boas-vindas', content: 'Olá!' }]);

    const { result } = renderHook(() => useQuickReplies());

    await waitFor(() => expect(result.current.quickReplies).toEqual([{ id: 'qr-1', title: 'Boas-vindas', content: 'Olá!' }]));
    expect(api.listQuickReplies).toHaveBeenCalledWith('tok-123');
  });

  test('refresh refetches the list', async () => {
    api.listQuickReplies.mockResolvedValue([]);
    const { result } = renderHook(() => useQuickReplies());
    await waitFor(() => expect(api.listQuickReplies).toHaveBeenCalledTimes(1));

    api.listQuickReplies.mockResolvedValue([{ id: 'qr-2', title: 'Nova', content: 'Texto' }]);
    await act(() => result.current.refresh());

    expect(result.current.quickReplies).toEqual([{ id: 'qr-2', title: 'Nova', content: 'Texto' }]);
  });
});
```

Create `frontend/src/components/CreateQuickReplyForm.test.jsx`, matching the exact style of the existing `frontend/src/components/CreateAgentForm.test.jsx`:

```jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CreateQuickReplyForm from './CreateQuickReplyForm';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
});

describe('CreateQuickReplyForm', () => {
  test('creates a quick reply and calls onCreated', async () => {
    api.createQuickReply.mockResolvedValue({ id: 'qr-1', title: 'Boas-vindas', content: 'Olá!' });
    const onCreated = vi.fn();
    render(<CreateQuickReplyForm onCreated={onCreated} />);

    await userEvent.type(screen.getByLabelText(/título/i), 'Boas-vindas');
    await userEvent.type(screen.getByLabelText(/mensagem/i), 'Olá!');
    await userEvent.click(screen.getByRole('button', { name: /cadastrar/i }));

    await waitFor(() =>
      expect(api.createQuickReply).toHaveBeenCalledWith({ title: 'Boas-vindas', content: 'Olá!' }, 'tok-123')
    );
    expect(onCreated).toHaveBeenCalled();
  });

  test('shows an error message when creation fails', async () => {
    api.createQuickReply.mockRejectedValue({ body: { error: 'Falha ao cadastrar' } });
    render(<CreateQuickReplyForm onCreated={vi.fn()} />);

    await userEvent.type(screen.getByLabelText(/título/i), 'Boas-vindas');
    await userEvent.type(screen.getByLabelText(/mensagem/i), 'Olá!');
    await userEvent.click(screen.getByRole('button', { name: /cadastrar/i }));

    expect(await screen.findByText('Falha ao cadastrar')).toBeInTheDocument();
  });
});
```

Create `frontend/src/components/QuickRepliesAdminTab.test.jsx`:

```jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import QuickRepliesAdminTab from './QuickRepliesAdminTab';
import { useQuickReplies } from '../hooks/useQuickReplies';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../hooks/useQuickReplies');
vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
});

describe('QuickRepliesAdminTab', () => {
  test('lists existing quick replies', () => {
    useQuickReplies.mockReturnValue({
      quickReplies: [{ id: 'qr-1', title: 'Boas-vindas', content: 'Olá!' }],
      refresh: vi.fn(),
    });
    render(<QuickRepliesAdminTab />);

    expect(screen.getByText('Boas-vindas')).toBeInTheDocument();
    expect(screen.getByText('Olá!')).toBeInTheDocument();
  });

  test('editing a quick reply calls updateQuickReply and refreshes', async () => {
    const refresh = vi.fn();
    useQuickReplies.mockReturnValue({
      quickReplies: [{ id: 'qr-1', title: 'Boas-vindas', content: 'Olá!' }],
      refresh,
    });
    api.updateQuickReply.mockResolvedValue({ id: 'qr-1', title: 'Editado', content: 'Novo texto' });
    render(<QuickRepliesAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /editar/i }));
    const titleInput = screen.getByDisplayValue('Boas-vindas');
    await userEvent.clear(titleInput);
    await userEvent.type(titleInput, 'Editado');
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));

    await waitFor(() =>
      expect(api.updateQuickReply).toHaveBeenCalledWith('qr-1', { title: 'Editado', content: 'Olá!' }, 'tok-123')
    );
    expect(refresh).toHaveBeenCalled();
  });

  test('deleting a quick reply calls deleteQuickReply and refreshes', async () => {
    const refresh = vi.fn();
    useQuickReplies.mockReturnValue({
      quickReplies: [{ id: 'qr-1', title: 'Boas-vindas', content: 'Olá!' }],
      refresh,
    });
    api.deleteQuickReply.mockResolvedValue(undefined);
    render(<QuickRepliesAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /excluir/i }));

    await waitFor(() => expect(api.deleteQuickReply).toHaveBeenCalledWith('qr-1', 'tok-123'));
    expect(refresh).toHaveBeenCalled();
  });
});
```

`frontend/src/pages/AdminChannelsPage.test.jsx` renders `AdminChannelsPage` directly (no render helper function) and renders `AgentsAdminTab` for real, only mocking the hooks it calls (`useChannels`, `useAgentsAdmin`, `useAuth`) — no `vi.mock('../components/AgentsAdminTab')`. `QuickRepliesAdminTab` will be rendered the same way (for real), so it needs the same treatment: mock the hook it calls, not the component.

Add this import and mock near the existing ones at the top of the file:

```jsx
import { useQuickReplies } from '../hooks/useQuickReplies';
```

```jsx
vi.mock('../hooks/useQuickReplies');
```

Add this line inside the existing `beforeEach`, alongside `useAgentsAdmin.mockReturnValue(...)`:

```jsx
  useQuickReplies.mockReturnValue({ quickReplies: [], refresh: vi.fn() });
```

Add this test inside the existing `describe('AdminChannelsPage', ...)` block, right after the `'switches to the Atendentes tab...'` test:

```jsx
  test('switches to the Respostas rápidas tab and shows the quick-reply management UI', async () => {
    useChannels.mockReturnValue({
      channels: [{ id: 'ch1', type: 'baileys', name: 'Berg', phoneNumber: '+5598985004187', status: 'connected' }],
      loading: false,
      refresh: vi.fn(),
    });
    useQuickReplies.mockReturnValue({
      quickReplies: [{ id: 'qr1', title: 'Boas-vindas', content: 'Olá!' }],
      refresh: vi.fn(),
    });
    render(<AdminChannelsPage />);

    expect(screen.getByText('Berg')).toBeInTheDocument();
    expect(screen.queryByText('Boas-vindas')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /respostas rápidas/i }));

    expect(screen.getByText('Boas-vindas')).toBeInTheDocument();
    expect(screen.queryByText('Berg')).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `frontend/`): `npx vitest run src/services/api.test.js src/hooks/useQuickReplies.test.jsx src/components/CreateQuickReplyForm.test.jsx src/components/QuickRepliesAdminTab.test.jsx src/pages/AdminChannelsPage.test.jsx`
Expected: FAIL — the four new `api.js` exports don't exist yet, and `useQuickReplies.js`/`CreateQuickReplyForm.jsx`/`QuickRepliesAdminTab.jsx` don't exist yet.

- [ ] **Step 3: Implement**

Add to the end of `frontend/src/services/api.js`:

```js
export function listQuickReplies(token) {
  return apiFetch('/api/quick-replies', { token });
}

export function createQuickReply(payload, token) {
  return apiFetch('/api/admin/quick-replies', { method: 'POST', body: payload, token });
}

export function updateQuickReply(id, payload, token) {
  return apiFetch(`/api/admin/quick-replies/${id}`, { method: 'PATCH', body: payload, token });
}

export function deleteQuickReply(id, token) {
  return apiFetch(`/api/admin/quick-replies/${id}`, { method: 'DELETE', token });
}
```

Create `frontend/src/hooks/useQuickReplies.js`:

```jsx
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { listQuickReplies } from '../services/api';

export function useQuickReplies() {
  const { token } = useAuth();
  const [quickReplies, setQuickReplies] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    if (!token) return Promise.resolve();
    setLoading(true);
    return listQuickReplies(token)
      .then((data) => {
        setQuickReplies(data);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, [token]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { quickReplies, loading, refresh };
}
```

Create `frontend/src/components/CreateQuickReplyForm.jsx`:

```jsx
import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { createQuickReply } from '../services/api';

function CreateQuickReplyForm({ onCreated }) {
  const { token } = useAuth();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await createQuickReply({ title, content }, token);
      setTitle('');
      setContent('');
      onCreated();
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao cadastrar resposta rápida');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded border border-gray-200 p-4">
      <h3 className="font-semibold text-gray-800">Cadastrar nova resposta rápida</h3>
      <div>
        <label htmlFor="quick-reply-title" className="mb-1 block text-sm text-gray-600">
          Título
        </label>
        <input
          id="quick-reply-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full rounded border border-gray-300 px-3 py-2"
          required
        />
      </div>
      <div>
        <label htmlFor="quick-reply-content" className="mb-1 block text-sm text-gray-600">
          Mensagem
        </label>
        <textarea
          id="quick-reply-content"
          value={content}
          onChange={(e) => setContent(e.target.value)}
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

export default CreateQuickReplyForm;
```

Create `frontend/src/components/QuickRepliesAdminTab.jsx`:

```jsx
import { useState } from 'react';
import { useQuickReplies } from '../hooks/useQuickReplies';
import { useAuth } from '../contexts/AuthContext';
import { updateQuickReply, deleteQuickReply } from '../services/api';
import CreateQuickReplyForm from './CreateQuickReplyForm';

function QuickReplyRow({ quickReply, onSaved, onDeleted }) {
  const { token } = useAuth();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(quickReply.title);
  const [content, setContent] = useState(quickReply.content);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSave(event) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await updateQuickReply(quickReply.id, { title, content }, token);
      setEditing(false);
      onSaved();
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao salvar');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    await deleteQuickReply(quickReply.id, token);
    onDeleted();
  }

  if (editing) {
    return (
      <form onSubmit={handleSave} className="space-y-2 rounded border border-gray-200 p-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full rounded border border-gray-300 px-3 py-2"
          required
        />
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
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
          <button type="button" onClick={() => setEditing(false)} className="rounded bg-gray-200 px-3 py-1 text-sm text-gray-700">
            Cancelar
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex items-center justify-between rounded border border-gray-200 p-3">
      <div>
        <p className="font-medium text-gray-800">{quickReply.title}</p>
        <p className="text-sm text-gray-500">{quickReply.content}</p>
      </div>
      <div className="flex items-center gap-3">
        <button onClick={() => setEditing(true)} className="text-sm text-blue-600 underline">
          Editar
        </button>
        <button onClick={handleDelete} className="text-sm text-red-600 underline">
          Excluir
        </button>
      </div>
    </div>
  );
}

function QuickRepliesAdminTab() {
  const { quickReplies, refresh } = useQuickReplies();

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        {quickReplies.map((quickReply) => (
          <QuickReplyRow key={quickReply.id} quickReply={quickReply} onSaved={refresh} onDeleted={refresh} />
        ))}
      </div>
      <CreateQuickReplyForm onCreated={refresh} />
    </div>
  );
}

export default QuickRepliesAdminTab;
```

In `frontend/src/pages/AdminChannelsPage.jsx`, add the import:

```jsx
import QuickRepliesAdminTab from '../components/QuickRepliesAdminTab';
```

Add a third tab button next to "Canais" and "Atendentes" (same style, `activeTab === 'quickReplies'`):

```jsx
        <button
          onClick={() => setActiveTab('quickReplies')}
          className={`px-3 py-2 text-sm ${
            activeTab === 'quickReplies' ? 'border-b-2 border-blue-600 font-semibold text-blue-600' : 'text-gray-500'
          }`}
        >
          Respostas rápidas
        </button>
```

And extend the conditional rendering below the tab bar (currently a two-way `? :` between "channels" and the `AgentsAdminTab` fallback) into a three-way check, e.g.:

```jsx
      {activeTab === 'channels' ? (
        <div className="space-y-6">
          {/* ...unchanged channels content... */}
        </div>
      ) : activeTab === 'agents' ? (
        <AgentsAdminTab />
      ) : (
        <QuickRepliesAdminTab />
      )}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run (from `frontend/`): `npx vitest run src/services/api.test.js src/hooks/useQuickReplies.test.jsx src/components/CreateQuickReplyForm.test.jsx src/components/QuickRepliesAdminTab.test.jsx src/pages/AdminChannelsPage.test.jsx`
Expected: PASS (all tests in all five files).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/api.js frontend/src/services/api.test.js frontend/src/hooks/useQuickReplies.js frontend/src/hooks/useQuickReplies.test.jsx frontend/src/components/CreateQuickReplyForm.jsx frontend/src/components/CreateQuickReplyForm.test.jsx frontend/src/components/QuickRepliesAdminTab.jsx frontend/src/components/QuickRepliesAdminTab.test.jsx frontend/src/pages/AdminChannelsPage.jsx frontend/src/pages/AdminChannelsPage.test.jsx
git commit -m "Add quick-replies admin management tab"
```

---

### Task 4: Frontend — picker button in `MessageInput`

**Files:**
- Modify: `frontend/src/components/MessageInput.jsx`
- Modify: `frontend/src/components/MessageInput.test.jsx`
- Modify: `frontend/src/components/ConversationView.jsx`
- Modify: `frontend/src/components/ConversationView.test.jsx`
- Modify: `frontend/src/pages/DashboardPage.test.jsx`

**Interfaces:**
- Consumes: `useQuickReplies()` (Task 3) — called inside `ConversationView`, NOT inside `MessageInput`.
- Produces: `MessageInput` gains a new optional prop `quickReplies` (array, default `[]`) — purely presentational, no behavior change for any existing caller that doesn't pass it.

**⚠️ Important cross-file consequence, read before starting:** `ConversationView` is rendered, un-mocked, by two other test files — `ConversationView.test.jsx` itself and `frontend/src/pages/DashboardPage.test.jsx` (which renders the real `ConversationView` when a conversation is selected). Once `ConversationView.jsx` calls `useQuickReplies()` internally, BOTH of those test files must mock the `useQuickReplies` hook (add `vi.mock('../hooks/useQuickReplies')` at the top and set a default return value in `beforeEach`), or the real hook will run inside those tests and call the real (differently-mocked or unmocked) `services/api`, breaking pre-existing passing tests that have nothing to do with this feature. Do this in both files even though `DashboardPage.test.jsx` never mentions quick replies directly.

- [ ] **Step 1: Write the failing tests**

In `frontend/src/components/MessageInput.test.jsx`, append this test inside the existing `describe('MessageInput', ...)` block:

```jsx
  test('selecting a quick reply fills the message field, replacing what was typed', async () => {
    const onSend = vi.fn();
    const quickReplies = [
      { id: 'qr-1', title: 'Boas-vindas', content: 'Olá! Como posso ajudar?' },
      { id: 'qr-2', title: 'Encerramento', content: 'Foi um prazer atender você!' },
    ];
    render(<MessageInput onSend={onSend} quickReplies={quickReplies} />);

    await userEvent.type(screen.getByPlaceholderText(/digite uma mensagem/i), 'rascunho');
    await userEvent.click(screen.getByRole('button', { name: /respostas rápidas/i }));
    await userEvent.click(screen.getByText('Boas-vindas'));

    expect(screen.getByPlaceholderText(/digite uma mensagem/i)).toHaveValue('Olá! Como posso ajudar?');
    expect(screen.queryByText('Encerramento')).not.toBeInTheDocument();
  });

  test('shows a message when there are no quick replies registered', async () => {
    render(<MessageInput onSend={vi.fn()} quickReplies={[]} />);

    await userEvent.click(screen.getByRole('button', { name: /respostas rápidas/i }));

    expect(screen.getByText(/nenhuma resposta cadastrada/i)).toBeInTheDocument();
  });
```

In `frontend/src/components/ConversationView.test.jsx`, add near the other `vi.mock` calls at the top:

```jsx
vi.mock('../hooks/useQuickReplies');
```

And in its `beforeEach`, alongside the existing mock setups, add:

```jsx
  useQuickReplies.mockReturnValue({ quickReplies: [], refresh: vi.fn() });
```

(Import `useQuickReplies` from `'../hooks/useQuickReplies'` at the top of the file alongside the other imports.)

In `frontend/src/pages/DashboardPage.test.jsx`, add the same two additions — `vi.mock('../hooks/useQuickReplies')` near its existing `vi.mock` calls, the import, and `useQuickReplies.mockReturnValue({ quickReplies: [], refresh: vi.fn() });` in its `beforeEach` — for exactly the reason explained in this task's header above.

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `frontend/`): `npx vitest run src/components/MessageInput.test.jsx src/components/ConversationView.test.jsx src/pages/DashboardPage.test.jsx`
Expected: FAIL — `MessageInput` has no "Respostas rápidas" button yet; the two other files will fail once `ConversationView.jsx` is changed in the next step if their mocks aren't added first (add the mocks now, before the implementation step, so you can confirm they still pass against the *current*, unchanged `ConversationView.jsx` — then re-run again after the implementation step below).

- [ ] **Step 3: Implement**

In `frontend/src/components/MessageInput.jsx`, change the function signature to accept the new prop:

```jsx
function MessageInput({ onSend, quickReplies = [] }) {
```

Add a new state declaration alongside the existing ones:

```jsx
  const [showingQuickReplies, setShowingQuickReplies] = useState(false);
```

Add this block right after the microphone/stop button's closing `)}` and before the text `<input>` in the JSX:

```jsx
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowingQuickReplies((prev) => !prev)}
            title="Respostas rápidas"
            aria-label="Respostas rápidas"
            className="rounded border border-gray-300 px-3 py-2"
            disabled={recording}
          >
            💬
          </button>
          {showingQuickReplies && (
            <div className="absolute bottom-full left-0 z-10 mb-1 w-64 rounded border border-gray-200 bg-white p-2 shadow">
              {quickReplies.length === 0 ? (
                <p className="text-sm text-gray-500">Nenhuma resposta cadastrada</p>
              ) : (
                <ul className="space-y-1">
                  {quickReplies.map((quickReply) => (
                    <li key={quickReply.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setContent(quickReply.content);
                          setShowingQuickReplies(false);
                        }}
                        className="w-full rounded px-2 py-1 text-left text-sm hover:bg-gray-50"
                      >
                        {quickReply.title}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
```

In `frontend/src/components/ConversationView.jsx`, add the import:

```jsx
import { useQuickReplies } from '../hooks/useQuickReplies';
```

Inside the `ConversationView` function, add the hook call alongside the existing ones:

```jsx
  const { quickReplies } = useQuickReplies();
```

And pass it down where `MessageInput` is rendered:

```jsx
      {isMine && <MessageInput onSend={sendMessage} quickReplies={quickReplies} />}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run (from `frontend/`): `npx vitest run src/components/MessageInput.test.jsx src/components/ConversationView.test.jsx src/pages/DashboardPage.test.jsx`
Expected: PASS (all tests in all three files).

Then run the full frontend and backend suites to confirm nothing else broke:

Run: `cd frontend && npx vitest run`
Run: `npm test` (from the repo root)
Expected: PASS (aside from the pre-existing, unrelated `src/queue/outbound-queue.test.js` Bull/Redis timing flake — safe to ignore if it's the only failure and it's timeout-only).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/MessageInput.jsx frontend/src/components/MessageInput.test.jsx frontend/src/components/ConversationView.jsx frontend/src/components/ConversationView.test.jsx frontend/src/pages/DashboardPage.test.jsx
git commit -m "Add quick-reply picker to MessageInput"
```

---

## Manual end-to-end test (after all tasks are merged)

Per the spec's testing section: log in as an admin, cadastrar a couple of respostas rápidas, then log in (or switch) as an attendant, open a conversation, use the new button to pick one, confirm it fills the message box correctly, edit it, and send — confirm the message reaches a real WhatsApp number normally (same send path as any typed message, so this is mostly confirming the UI wiring, not the WhatsApp integration itself).
