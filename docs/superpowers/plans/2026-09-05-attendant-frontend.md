# Frontend de Atendimento Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the React attendant frontend (login, queue + my-conversations dashboard, conversation view, channel administration) that replaces direct API calls as the way DW Telecom's attendants use the system, plus the two backend gaps it depends on.

**Architecture:** A Vite + React + Tailwind single-page app in `frontend/` (same repo, independent `package.json`), using React Context (not Redux/Zustand) for auth and the shared Socket.io connection, with per-domain hooks (`useQueue`, `useMyConversations`, `useConversationMessages`, `useAgents`, `useChannels`) that fetch initial state via REST and then react to Socket.io events pushed by the server — never re-polling. Two small backend additions unblock this: a `GET /api/agents` endpoint (for the transfer picker) and a real CORS origin allowlist (replacing the current wide-open `cors()`).

**Tech Stack:** React 18, Vite, React Router v6, Tailwind CSS v4, `socket.io-client`, Vitest + React Testing Library (frontend testing) — on top of the existing Node.js/Express/Postgres/Redis/Socket.io backend.

**Spec:** [docs/superpowers/specs/2026-09-05-attendant-frontend-design.md](../specs/2026-09-05-attendant-frontend-design.md) (extends [2026-09-04-whatsapp-attendance-system-design.md](../specs/2026-09-04-whatsapp-attendance-system-design.md))

## Global Constraints

- `package.json`'s (backend) `jest.maxWorkers` MUST stay `1`. Never remove it.
- No new backend database migration is needed for this plan.
- `FRONTEND_ORIGIN` is an **optional** backend config value (not added to the `required` list in `loadConfig()`) — CORS always allows `http://localhost:5173` (the Vite dev server) regardless of environment, and additionally allows `FRONTEND_ORIGIN` when it's set. This is a deliberate exception to this codebase's usual "everything in `loadConfig()` is required" pattern, since forcing every dev/test setup to define a production frontend URL would be needless friction.
- The frontend never does optimistic UI updates from list-changing actions (claim/transfer/close) — those lists only change when the corresponding Socket.io event arrives, keeping the server as the single source of truth. **One narrow, deliberate exception:** sending a message (`POST /api/conversations/:id/messages`) has no corresponding creation-time Socket.io event (the backend only emits `message:updated` later, once the outbound worker actually attempts delivery) — so the frontend appends the HTTP response's created message directly to the conversation view, and later merges the `message:updated` event by message `id` when it arrives.
- `queue:new` is an upsert by `conversation.id`, never an append (a waiting conversation can emit it more than once). `message:updated` may arrive for a conversation no longer open in the UI and must be ignored silently. A JWT-expiry socket disconnect (`connect_error`) does not auto-reconnect — the frontend must treat it as a forced logout.
- Every new frontend file is ES modules (`import`/`export`), matching Vite's default — do not use CommonJS (`require`/`module.exports`) in `frontend/`. The existing backend code (`src/`, outside `frontend/`) stays CommonJS, unchanged.
- Follow the backend's existing TDD/commit conventions for the two backend tasks (Jest + Supertest, `UNIQUE_VIOLATION` / real-Postgres repository test patterns already established in this codebase).

---

### Task 1: `GET /api/agents` endpoint

**Files:**
- Modify: `src/agents/agent.repository.js`
- Modify: `src/agents/agent.repository.test.js`
- Create: `src/api/agents.routes.js`
- Create: `src/api/agents.routes.test.js`
- Modify: `src/server.js`

**Interfaces:**
- Produces: `listAgents() -> Promise<{id, email, role, createdAt}[]>` (repository); `GET /api/agents` (protected by `requireAuth` only — any authenticated agent, not just admins, needs this for the transfer picker), returns `[{id, email, role}]` (no `createdAt`, no password hash). Consumed by the frontend's `useAgents` hook (Task 8).

- [ ] **Step 1: Write the failing repository test**

Add to `src/agents/agent.repository.test.js` (append inside the existing `describe('agent repository', ...)` block, after the last test):

```js
  test('listAgents returns every agent ordered by email', async () => {
    await createAgent({ email: 'zeta@dw.com', password: 'secret123', role: 'agent' });
    await createAgent({ email: 'alpha@dw.com', password: 'secret123', role: 'admin' });

    const agents = await listAgents();

    expect(agents.map((a) => a.email)).toEqual(['alpha@dw.com', 'zeta@dw.com']);
    expect(agents[0].passwordHash).toBeUndefined();
  });
```

And update the import line at the top of the file:

```js
const { createAgent, findAgentByEmail, findAgentById, listAgents } = require('./agent.repository');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/agents/agent.repository.test.js`
Expected: FAIL with `listAgents is not a function`.

- [ ] **Step 3: Write minimal implementation**

Replace `src/agents/agent.repository.js` with:

```js
const bcrypt = require('bcrypt');
const { getPool } = require('../db/pool');

const SALT_ROUNDS = 10;

function toPublicAgent(row) {
  return { id: row.id, email: row.email, role: row.role, createdAt: row.created_at };
}

async function createAgent({ email, password, role }) {
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const result = await getPool().query(
    `INSERT INTO agents (email, password_hash, role) VALUES ($1, $2, $3)
     RETURNING id, email, role, created_at`,
    [email, passwordHash, role]
  );
  return toPublicAgent(result.rows[0]);
}

async function findAgentByEmail(email) {
  const result = await getPool().query(
    'SELECT id, email, role, password_hash, created_at FROM agents WHERE email = $1',
    [email]
  );
  if (result.rowCount === 0) return null;
  const row = result.rows[0];
  return { id: row.id, email: row.email, role: row.role, passwordHash: row.password_hash, createdAt: row.created_at };
}

async function findAgentById(id) {
  const result = await getPool().query(
    'SELECT id, email, role, created_at FROM agents WHERE id = $1',
    [id]
  );
  if (result.rowCount === 0) return null;
  return toPublicAgent(result.rows[0]);
}

async function listAgents() {
  const result = await getPool().query(
    'SELECT id, email, role, created_at FROM agents ORDER BY email ASC'
  );
  return result.rows.map(toPublicAgent);
}

module.exports = { createAgent, findAgentByEmail, findAgentById, listAgents };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/agents/agent.repository.test.js`
Expected: PASS

- [ ] **Step 5: Write the failing route test**

Create `src/api/agents.routes.test.js`:

```js
jest.mock('../agents/agent.repository');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const { listAgents } = require('../agents/agent.repository');
const agentsRoutes = require('./agents.routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/agents', agentsRoutes);
  return app;
}

function tokenFor(agentId, role) {
  return jwt.sign({ agentId, role }, process.env.JWT_SECRET);
}

describe('GET /api/agents', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns the agent list for any authenticated agent', async () => {
    listAgents.mockResolvedValue([
      { id: 'agent-1', email: 'a@dw.com', role: 'agent', createdAt: new Date() },
      { id: 'agent-2', email: 'b@dw.com', role: 'admin', createdAt: new Date() },
    ]);

    const res = await request(buildApp())
      .get('/api/agents')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: 'agent-1', email: 'a@dw.com', role: 'agent' },
      { id: 'agent-2', email: 'b@dw.com', role: 'admin' },
    ]);
  });

  test('returns 401 without a token', async () => {
    const res = await request(buildApp()).get('/api/agents');
    expect(res.status).toBe(401);
    expect(listAgents).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm test -- src/api/agents.routes.test.js`
Expected: FAIL with `Cannot find module './agents.routes'`.

- [ ] **Step 7: Write the implementation**

Create `src/api/agents.routes.js`:

```js
const express = require('express');
const { requireAuth } = require('../auth/auth.middleware');
const { listAgents } = require('../agents/agent.repository');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  const agents = await listAgents();
  res.json(agents.map((agent) => ({ id: agent.id, email: agent.email, role: agent.role })));
});

module.exports = router;
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npm test -- src/api/agents.routes.test.js`
Expected: PASS

- [ ] **Step 9: Mount the route in `src/server.js`**

In `src/server.js`, add the require alongside the other route imports:

```js
const conversationsRoutes = require('./api/conversations.routes');
const agentsRoutes = require('./api/agents.routes');
const adminChannelsRoutes = require('./api/admin-channels.routes');
```

And mount it alongside the other `/api/*` mounts:

```js
app.use('/api/auth', authRoutes);
app.use('/api/conversations', conversationsRoutes);
app.use('/api/agents', agentsRoutes);
app.use('/api/admin/channels', adminChannelsRoutes);
app.use('/webhooks', metaCloudRoutes);
```

- [ ] **Step 10: Run the full backend suite**

Run: `npm test`
Expected: PASS, all suites (one more suite and a few more tests than before).

- [ ] **Step 11: Commit**

```bash
git add src/agents/agent.repository.js src/agents/agent.repository.test.js src/api/agents.routes.js src/api/agents.routes.test.js src/server.js
git commit -m "feat: add GET /api/agents endpoint for the transfer picker"
```

---

### Task 2: CORS origin allowlist

**Files:**
- Modify: `src/config/env.js`
- Modify: `src/config/env.test.js`
- Create: `src/config/cors-origins.js`
- Create: `src/config/cors-origins.test.js`
- Modify: `src/server.js`
- Modify: `src/realtime/socket-server.js`

Note: `.env.test.example` is deliberately **not** touched by this task — `FRONTEND_ORIGIN` is optional (see Step 11).

**Interfaces:**
- Produces: `loadConfig().frontendOrigin` (string or `null`, NOT in the required-vars list); `getAllowedOrigins() -> string[]` (always includes `'http://localhost:5173'`, plus `frontendOrigin` when set). Consumed by `server.js` (Express `cors()`) and `socket-server.js` (Socket.io's own `cors` option).

- [ ] **Step 1: Write the failing config test**

Add to `src/config/env.test.js`, inside the existing `describe('loadConfig', ...)` block, after the `'uses PORT env var when present'` test:

```js
  test('frontendOrigin is null when FRONTEND_ORIGIN is not set', () => {
    setAllRequired();
    delete process.env.FRONTEND_ORIGIN;
    const config = loadConfig();
    expect(config.frontendOrigin).toBeNull();
  });

  test('frontendOrigin reflects FRONTEND_ORIGIN when set', () => {
    setAllRequired();
    process.env.FRONTEND_ORIGIN = 'https://dw-whatsapp-frontend.onrender.com';
    const config = loadConfig();
    expect(config.frontendOrigin).toBe('https://dw-whatsapp-frontend.onrender.com');
  });

  test('does not require FRONTEND_ORIGIN to be set', () => {
    setAllRequired();
    delete process.env.FRONTEND_ORIGIN;
    expect(() => loadConfig()).not.toThrow();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/config/env.test.js`
Expected: FAIL — `config.frontendOrigin` is `undefined`, not `null`.

- [ ] **Step 3: Update `src/config/env.js`**

Replace `src/config/env.js` with (only the `required` list and the returned object are unchanged except for the new `frontendOrigin` line — `FRONTEND_ORIGIN` is deliberately NOT added to `required`):

```js
function loadConfig() {
  const required = [
    'DATABASE_URL',
    'JWT_SECRET',
    'REDIS_URL',
    'META_VERIFY_TOKEN',
    'META_APP_SECRET',
    'BAILEYS_SESSIONS_DIR',
  ];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  return {
    port: Number(process.env.PORT) || 3000,
    databaseUrl: process.env.DATABASE_URL,
    jwtSecret: process.env.JWT_SECRET,
    redisUrl: process.env.REDIS_URL,
    metaVerifyToken: process.env.META_VERIFY_TOKEN,
    metaAppSecret: process.env.META_APP_SECRET,
    baileysSessionsDir: process.env.BAILEYS_SESSIONS_DIR,
    frontendOrigin: process.env.FRONTEND_ORIGIN || null,
  };
}

module.exports = { loadConfig };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/config/env.test.js`
Expected: PASS

- [ ] **Step 5: Write the failing test for the allowlist helper**

Create `src/config/cors-origins.test.js`:

```js
jest.mock('./env');
const { loadConfig } = require('./env');
const { getAllowedOrigins } = require('./cors-origins');

describe('getAllowedOrigins', () => {
  test('always includes the local Vite dev server origin', () => {
    loadConfig.mockReturnValue({ frontendOrigin: null });
    expect(getAllowedOrigins()).toEqual(['http://localhost:5173']);
  });

  test('also includes FRONTEND_ORIGIN when configured', () => {
    loadConfig.mockReturnValue({ frontendOrigin: 'https://dw-whatsapp-frontend.onrender.com' });
    expect(getAllowedOrigins()).toEqual([
      'http://localhost:5173',
      'https://dw-whatsapp-frontend.onrender.com',
    ]);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm test -- src/config/cors-origins.test.js`
Expected: FAIL with `Cannot find module './cors-origins'`.

- [ ] **Step 7: Write the implementation**

Create `src/config/cors-origins.js`:

```js
const { loadConfig } = require('./env');

function getAllowedOrigins() {
  const origins = ['http://localhost:5173'];
  const { frontendOrigin } = loadConfig();
  if (frontendOrigin) {
    origins.push(frontendOrigin);
  }
  return origins;
}

module.exports = { getAllowedOrigins };
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npm test -- src/config/cors-origins.test.js`
Expected: PASS

- [ ] **Step 9: Wire it into `src/server.js`**

In `src/server.js`, add the require:

```js
const { loadConfig } = require('./config/env');
const { getAllowedOrigins } = require('./config/cors-origins');
```

Replace `app.use(cors());` with:

```js
app.use(cors({ origin: getAllowedOrigins() }));
```

- [ ] **Step 10: Wire it into `src/realtime/socket-server.js`**

In `src/realtime/socket-server.js`, add the require:

```js
const { Server } = require('socket.io');
const { verifyToken } = require('../auth/auth.service');
const { getAllowedOrigins } = require('../config/cors-origins');
```

Replace `io = new Server(httpServer, { cors: { origin: '*' } });` with:

```js
io = new Server(httpServer, { cors: { origin: getAllowedOrigins() } });
```

- [ ] **Step 11: Update `.env.test.example` with a comment (no required value)**

`FRONTEND_ORIGIN` must NOT be added as a required line in `.env.test.example` (it's optional and the test suite must keep passing without it) — skip adding anything here. This step is a no-op by design; do not modify `.env.test.example` in this task.

- [ ] **Step 12: Run the full backend suite**

Run: `npm test`
Expected: PASS — all suites, including `src/realtime/socket-server.test.js` (that test file doesn't mock `config/env` or `config/cors-origins`, so it exercises the real `getAllowedOrigins()` against `.env.test`'s values, which has no `FRONTEND_ORIGIN` set — `frontendOrigin` resolves to `null`, so the allowlist is just `['http://localhost:5173']`; the test's `socket.io-client` connections in that file connect directly via a raw HTTP server URL, not through a browser `Origin` header, so they are unaffected by the allowlist).

- [ ] **Step 13: Commit**

```bash
git add src/config/env.js src/config/env.test.js src/config/cors-origins.js src/config/cors-origins.test.js src/server.js src/realtime/socket-server.js
git commit -m "feat: restrict CORS to an explicit origin allowlist"
```

---

### Task 3: Frontend scaffold + `services/api.js`

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/vite.config.js`
- Create: `frontend/index.html`
- Create: `frontend/src/index.css`
- Create: `frontend/src/main.jsx`
- Create: `frontend/src/App.jsx`
- Create: `frontend/src/services/api.js`
- Create: `frontend/src/services/api.test.js`
- Create: `frontend/src/setupTests.js`
- Create: `frontend/.gitignore`

**Interfaces:**
- Produces: `apiFetch(path, {method, body, token}) -> Promise<any>` (throws `ApiError` with `.status`/`.body` on a non-2xx response); domain helpers `login(email, password)`, `getQueue(token)`, `getMyConversations(token)`, `getMessages(conversationId, token)`, `claimConversation(conversationId, token)`, `sendMessage(conversationId, content, token)`, `transferConversation(conversationId, toAgentId, token)`, `closeConversation(conversationId, token)`, `listAgents(token)`, `listChannels(token)`, `createChannel(payload, token)` — all built on `apiFetch`, all consumed by later tasks' hooks.
- Produces: `API_BASE_URL` (exported constant, read from `import.meta.env.VITE_API_BASE_URL`, defaulting to `http://localhost:3000`) — consumed by Task 5's `SocketContext` to connect to the same backend.

- [ ] **Step 1: Create the frontend directory and `package.json`**

Create `frontend/package.json`:

```json
{
  "name": "dw-whatsapp-frontend",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.26.2",
    "socket.io-client": "^4.8.3"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.5.0",
    "@testing-library/react": "^16.0.1",
    "@testing-library/user-event": "^14.5.2",
    "@tailwindcss/vite": "^4.0.0",
    "@vitejs/plugin-react": "^4.3.2",
    "jsdom": "^25.0.1",
    "tailwindcss": "^4.0.0",
    "vite": "^5.4.8",
    "vitest": "^2.1.2"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run: `cd frontend && npm install`

- [ ] **Step 3: Create the Vite config with Tailwind and Vitest wired in**

Create `frontend/vite.config.js`:

```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/setupTests.js'],
  },
});
```

- [ ] **Step 4: Create the test setup file**

Create `frontend/src/setupTests.js`:

```js
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 5: Create `index.html`**

Create `frontend/index.html`:

```html
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>DW Telecom - Atendimento</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

- [ ] **Step 6: Create the Tailwind entry stylesheet**

Create `frontend/src/index.css`:

```css
@import "tailwindcss";
```

- [ ] **Step 7: Write the failing test for `api.js`**

Create `frontend/src/services/api.test.js`:

```jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { apiFetch, ApiError, login, getQueue } from './api';

beforeEach(() => {
  global.fetch = vi.fn();
});

describe('apiFetch', () => {
  test('sends the Authorization header when a token is provided', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ hello: 'world' })),
    });

    const result = await apiFetch('/api/conversations/queue', { token: 'tok-123' });

    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/conversations/queue',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'Bearer tok-123' }),
      })
    );
    expect(result).toEqual({ hello: 'world' });
  });

  test('sends a JSON body for POST requests', async () => {
    global.fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('{}') });

    await apiFetch('/api/conversations/abc/claim', { method: 'POST', token: 'tok-123' });

    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/conversations/abc/claim',
      expect.objectContaining({ method: 'POST' })
    );
  });

  test('throws ApiError with status and body on a non-2xx response', async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 409,
      text: () => Promise.resolve(JSON.stringify({ error: 'Already assigned' })),
    });

    await expect(apiFetch('/api/conversations/abc/claim', { method: 'POST' })).rejects.toMatchObject({
      status: 409,
      body: { error: 'Already assigned' },
    });
  });

  test('returns null when the response body is empty', async () => {
    global.fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('') });
    const result = await apiFetch('/health');
    expect(result).toBeNull();
  });
});

describe('login', () => {
  test('posts credentials to /api/auth/login', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ token: 'tok', agent: { id: 'a1', role: 'agent' } })),
    });

    const result = await login('a@dw.com', 'secret123');

    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/auth/login',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'a@dw.com', password: 'secret123' }),
      })
    );
    expect(result).toEqual({ token: 'tok', agent: { id: 'a1', role: 'agent' } });
  });
});

describe('getQueue', () => {
  test('fetches the waiting queue with the given token', async () => {
    global.fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('[]') });
    await getQueue('tok-123');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/conversations/queue',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer tok-123' }) })
    );
  });
});

describe('ApiError', () => {
  test('carries status and body', () => {
    const err = new ApiError(404, { error: 'Not found' });
    expect(err.status).toBe(404);
    expect(err.body).toEqual({ error: 'Not found' });
    expect(err.message).toBe('Not found');
  });
});
```

- [ ] **Step 8: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/services/api.test.js`
Expected: FAIL with `Cannot find module './api'` (or similar).

- [ ] **Step 9: Write the implementation**

Create `frontend/src/services/api.js`:

```js
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

export class ApiError extends Error {
  constructor(status, body) {
    super((body && body.error) || `Request failed with status ${status}`);
    this.status = status;
    this.body = body;
  }
}

export async function apiFetch(path, { method = 'GET', body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new ApiError(response.status, data);
  }
  return data;
}

export function login(email, password) {
  return apiFetch('/api/auth/login', { method: 'POST', body: { email, password } });
}

export function getQueue(token) {
  return apiFetch('/api/conversations/queue', { token });
}

export function getMyConversations(token) {
  return apiFetch('/api/conversations/mine', { token });
}

export function getMessages(conversationId, token) {
  return apiFetch(`/api/conversations/${conversationId}/messages`, { token });
}

export function claimConversation(conversationId, token) {
  return apiFetch(`/api/conversations/${conversationId}/claim`, { method: 'POST', token });
}

export function sendMessage(conversationId, content, token) {
  return apiFetch(`/api/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: { content },
    token,
  });
}

export function transferConversation(conversationId, toAgentId, token) {
  return apiFetch(`/api/conversations/${conversationId}/transfer`, {
    method: 'POST',
    body: { toAgentId },
    token,
  });
}

export function closeConversation(conversationId, token) {
  return apiFetch(`/api/conversations/${conversationId}/close`, { method: 'POST', token });
}

export function listAgents(token) {
  return apiFetch('/api/agents', { token });
}

export function listChannels(token) {
  return apiFetch('/api/admin/channels', { token });
}

export function createChannel(payload, token) {
  return apiFetch('/api/admin/channels', { method: 'POST', body: payload, token });
}
```

- [ ] **Step 10: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/services/api.test.js`
Expected: PASS

- [ ] **Step 11: Create a placeholder `App.jsx` and `main.jsx` so the dev server boots**

Create `frontend/src/App.jsx`:

```jsx
function App() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100">
      <p className="text-gray-500">DW Telecom - carregando...</p>
    </div>
  );
}

export default App;
```

Create `frontend/src/main.jsx`:

```jsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './index.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

- [ ] **Step 12: Create `.gitignore` for the frontend**

Create `frontend/.gitignore`:

```
node_modules/
dist/
```

- [ ] **Step 13: Verify the dev server and build both work**

Run: `cd frontend && npm run build`
Expected: build succeeds, produces a `dist/` directory (gitignored).

- [ ] **Step 14: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/vite.config.js frontend/index.html frontend/src/index.css frontend/src/main.jsx frontend/src/App.jsx frontend/src/services/api.js frontend/src/services/api.test.js frontend/src/setupTests.js frontend/.gitignore
git commit -m "feat: scaffold the Vite/React/Tailwind frontend and the API client"
```

---

### Task 4: `AuthContext`, `LoginPage`, `ProtectedRoute`

**Files:**
- Create: `frontend/src/contexts/AuthContext.jsx`
- Create: `frontend/src/contexts/AuthContext.test.jsx`
- Create: `frontend/src/pages/LoginPage.jsx`
- Create: `frontend/src/pages/LoginPage.test.jsx`
- Create: `frontend/src/components/ProtectedRoute.jsx`

**Interfaces:**
- Consumes: `login(email, password)` from `services/api.js` (Task 3).
- Produces: `AuthProvider` (context provider component), `useAuth() -> {token, agent, login(email, password), logout()}` (`agent` is `{id, email, role}` or `null`; `login`/`logout` persist to `localStorage` under keys `dw_token`/`dw_agent`). Consumed by every later frontend task (`SocketContext`, all hooks, `ProtectedRoute`, `App.jsx` routing).
- Produces: `ProtectedRoute({children, requireAdmin})` — redirects to `/login` when there's no token, or to `/` when `requireAdmin` is true and the agent isn't an admin.

- [ ] **Step 1: Write the failing test for `AuthContext`**

Create `frontend/src/contexts/AuthContext.test.jsx`:

```jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider, useAuth } from './AuthContext';
import * as api from '../services/api';

vi.mock('../services/api');

function TestConsumer() {
  const { token, agent, login, logout } = useAuth();
  return (
    <div>
      <span data-testid="token">{token || 'no-token'}</span>
      <span data-testid="role">{agent ? agent.role : 'no-agent'}</span>
      <button onClick={() => login('a@dw.com', 'secret123')}>Login</button>
      <button onClick={logout}>Logout</button>
    </div>
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe('AuthProvider', () => {
  test('starts with no token when localStorage is empty', () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );
    expect(screen.getByTestId('token')).toHaveTextContent('no-token');
    expect(screen.getByTestId('role')).toHaveTextContent('no-agent');
  });

  test('login stores the token and agent, and updates context', async () => {
    api.login.mockResolvedValue({ token: 'tok-123', agent: { id: 'a1', email: 'a@dw.com', role: 'admin' } });
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    await userEvent.click(screen.getByText('Login'));

    await waitFor(() => expect(screen.getByTestId('token')).toHaveTextContent('tok-123'));
    expect(screen.getByTestId('role')).toHaveTextContent('admin');
    expect(localStorage.getItem('dw_token')).toBe('tok-123');
    expect(JSON.parse(localStorage.getItem('dw_agent'))).toEqual({ id: 'a1', email: 'a@dw.com', role: 'admin' });
  });

  test('logout clears the token, agent, and localStorage', async () => {
    localStorage.setItem('dw_token', 'tok-123');
    localStorage.setItem('dw_agent', JSON.stringify({ id: 'a1', email: 'a@dw.com', role: 'agent' }));
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );
    expect(screen.getByTestId('token')).toHaveTextContent('tok-123');

    await userEvent.click(screen.getByText('Logout'));

    expect(screen.getByTestId('token')).toHaveTextContent('no-token');
    expect(localStorage.getItem('dw_token')).toBeNull();
    expect(localStorage.getItem('dw_agent')).toBeNull();
  });

  test('restores token and agent from localStorage on mount', () => {
    localStorage.setItem('dw_token', 'tok-existing');
    localStorage.setItem('dw_agent', JSON.stringify({ id: 'a2', email: 'b@dw.com', role: 'agent' }));
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );
    expect(screen.getByTestId('token')).toHaveTextContent('tok-existing');
    expect(screen.getByTestId('role')).toHaveTextContent('agent');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/contexts/AuthContext.test.jsx`
Expected: FAIL with `Cannot find module './AuthContext'`.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/contexts/AuthContext.jsx`:

```jsx
import { createContext, useContext, useState, useCallback } from 'react';
import { login as apiLogin } from '../services/api';

const AuthContext = createContext(null);

function readStoredAgent() {
  const stored = localStorage.getItem('dw_agent');
  return stored ? JSON.parse(stored) : null;
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem('dw_token'));
  const [agent, setAgent] = useState(readStoredAgent);

  const login = useCallback(async (email, password) => {
    const result = await apiLogin(email, password);
    localStorage.setItem('dw_token', result.token);
    localStorage.setItem('dw_agent', JSON.stringify(result.agent));
    setToken(result.token);
    setAgent(result.agent);
    return result;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('dw_token');
    localStorage.removeItem('dw_agent');
    setToken(null);
    setAgent(null);
  }, []);

  return <AuthContext.Provider value={{ token, agent, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/contexts/AuthContext.test.jsx`
Expected: PASS

- [ ] **Step 5: Write the failing test for `LoginPage`**

Create `frontend/src/pages/LoginPage.test.jsx`:

```jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import LoginPage from './LoginPage';
import { useAuth } from '../contexts/AuthContext';

vi.mock('../contexts/AuthContext');
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('LoginPage', () => {
  test('submits the form and navigates to the dashboard on success', async () => {
    const login = vi.fn().mockResolvedValue({});
    useAuth.mockReturnValue({ login });

    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    );

    await userEvent.type(screen.getByLabelText(/email/i), 'a@dw.com');
    await userEvent.type(screen.getByLabelText(/senha/i), 'secret123');
    await userEvent.click(screen.getByRole('button', { name: /entrar/i }));

    await waitFor(() => expect(login).toHaveBeenCalledWith('a@dw.com', 'secret123'));
    expect(mockNavigate).toHaveBeenCalledWith('/');
  });

  test('shows an error message when login fails', async () => {
    const login = vi.fn().mockRejectedValue({ body: { error: 'Invalid credentials' } });
    useAuth.mockReturnValue({ login });

    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    );

    await userEvent.type(screen.getByLabelText(/email/i), 'a@dw.com');
    await userEvent.type(screen.getByLabelText(/senha/i), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: /entrar/i }));

    expect(await screen.findByText('Invalid credentials')).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/pages/LoginPage.test.jsx`
Expected: FAIL with `Cannot find module './LoginPage'`.

- [ ] **Step 7: Write the implementation**

Create `frontend/src/pages/LoginPage.jsx`:

```jsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao entrar');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100">
      <form onSubmit={handleSubmit} className="w-80 rounded bg-white p-6 shadow">
        <h1 className="mb-4 text-lg font-semibold text-gray-800">DW Telecom - Atendimento</h1>
        <label htmlFor="email" className="mb-1 block text-sm text-gray-600">
          Email
        </label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mb-3 w-full rounded border border-gray-300 px-3 py-2"
          required
        />
        <label htmlFor="password" className="mb-1 block text-sm text-gray-600">
          Senha
        </label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mb-3 w-full rounded border border-gray-300 px-3 py-2"
          required
        />
        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded bg-blue-600 py-2 text-white disabled:opacity-50"
        >
          Entrar
        </button>
      </form>
    </div>
  );
}

export default LoginPage;
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/pages/LoginPage.test.jsx`
Expected: PASS

- [ ] **Step 9: Create `ProtectedRoute` (no test — pure routing logic exercised end-to-end in Task 11's `App.jsx` test)**

Create `frontend/src/components/ProtectedRoute.jsx`:

```jsx
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

function ProtectedRoute({ children, requireAdmin = false }) {
  const { token, agent } = useAuth();
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  if (requireAdmin && (!agent || agent.role !== 'admin')) {
    return <Navigate to="/" replace />;
  }
  return children;
}

export default ProtectedRoute;
```

- [ ] **Step 10: Run the full frontend suite**

Run: `cd frontend && npx vitest run`
Expected: PASS, all frontend test files so far.

- [ ] **Step 11: Commit**

```bash
git add frontend/src/contexts/AuthContext.jsx frontend/src/contexts/AuthContext.test.jsx frontend/src/pages/LoginPage.jsx frontend/src/pages/LoginPage.test.jsx frontend/src/components/ProtectedRoute.jsx
git commit -m "feat: add AuthContext, LoginPage, and ProtectedRoute"
```

---

### Task 5: `SocketContext`

**Files:**
- Create: `frontend/src/contexts/SocketContext.jsx`
- Create: `frontend/src/contexts/SocketContext.test.jsx`

**Interfaces:**
- Consumes: `useAuth() -> {token, logout}` (Task 4); `API_BASE_URL` from `services/api.js` (Task 3); `io` from `socket.io-client`.
- Produces: `SocketProvider`, `useSocket() -> Socket | null` (the raw `socket.io-client` instance, or `null` when not connected — e.g. before login). Consumed by every hook in Tasks 6-8 that listens for realtime events.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/contexts/SocketContext.test.jsx`:

```jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { SocketProvider, useSocket } from './SocketContext';
import { useAuth } from './AuthContext';
import { io } from 'socket.io-client';

vi.mock('./AuthContext');
vi.mock('socket.io-client');

function TestConsumer() {
  const socket = useSocket();
  return <span data-testid="socket">{socket ? 'connected' : 'no-socket'}</span>;
}

let fakeSocket;

beforeEach(() => {
  vi.clearAllMocks();
  fakeSocket = { on: vi.fn(), off: vi.fn(), close: vi.fn() };
  io.mockReturnValue(fakeSocket);
});

describe('SocketProvider', () => {
  test('does not connect when there is no token', () => {
    useAuth.mockReturnValue({ token: null, logout: vi.fn() });
    render(
      <SocketProvider>
        <TestConsumer />
      </SocketProvider>
    );
    expect(io).not.toHaveBeenCalled();
    expect(screen.getByTestId('socket')).toHaveTextContent('no-socket');
  });

  test('connects with the token in auth options when a token is present', async () => {
    useAuth.mockReturnValue({ token: 'tok-123', logout: vi.fn() });
    render(
      <SocketProvider>
        <TestConsumer />
      </SocketProvider>
    );
    await waitFor(() => expect(screen.getByTestId('socket')).toHaveTextContent('connected'));
    expect(io).toHaveBeenCalledWith('http://localhost:3000', { auth: { token: 'tok-123' } });
  });

  test('logs out when the socket reports a connect_error', () => {
    const logout = vi.fn();
    useAuth.mockReturnValue({ token: 'tok-123', logout });
    render(
      <SocketProvider>
        <TestConsumer />
      </SocketProvider>
    );
    const errorHandler = fakeSocket.on.mock.calls.find(([event]) => event === 'connect_error')[1];
    errorHandler(new Error('Unauthorized'));
    expect(logout).toHaveBeenCalled();
  });

  test('closes the socket when the token becomes null', () => {
    const { rerender } = render(<div />);
    useAuth.mockReturnValue({ token: 'tok-123', logout: vi.fn() });
    rerender(
      <SocketProvider>
        <TestConsumer />
      </SocketProvider>
    );
    useAuth.mockReturnValue({ token: null, logout: vi.fn() });
    rerender(
      <SocketProvider>
        <TestConsumer />
      </SocketProvider>
    );
    expect(fakeSocket.close).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/contexts/SocketContext.test.jsx`
Expected: FAIL with `Cannot find module './SocketContext'`.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/contexts/SocketContext.jsx`:

```jsx
import { createContext, useContext, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext';
import { API_BASE_URL } from '../services/api';

const SocketContext = createContext(null);

export function SocketProvider({ children }) {
  const { token, logout } = useAuth();
  const [socket, setSocket] = useState(null);

  useEffect(() => {
    if (!token) {
      setSocket(null);
      return undefined;
    }
    const connection = io(API_BASE_URL, { auth: { token } });
    connection.on('connect_error', () => {
      logout();
    });
    setSocket(connection);
    return () => {
      connection.close();
    };
  }, [token, logout]);

  return <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>;
}

export function useSocket() {
  return useContext(SocketContext);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/contexts/SocketContext.test.jsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/contexts/SocketContext.jsx frontend/src/contexts/SocketContext.test.jsx
git commit -m "feat: add SocketContext for the shared realtime connection"
```

---

### Task 6: `useQueue`, `useMyConversations`, list components

**Files:**
- Create: `frontend/src/hooks/useQueue.js`
- Create: `frontend/src/hooks/useQueue.test.jsx`
- Create: `frontend/src/hooks/useMyConversations.js`
- Create: `frontend/src/hooks/useMyConversations.test.jsx`
- Create: `frontend/src/components/ConversationListItem.jsx`
- Create: `frontend/src/components/QueueList.jsx`
- Create: `frontend/src/components/MyConversationsList.jsx`

**Interfaces:**
- Consumes: `useAuth()` (Task 4), `useSocket()` (Task 5), `getQueue`/`getMyConversations` (Task 3).
- Produces: `useQueue() -> Conversation[]`, `useMyConversations() -> Conversation[]` (`Conversation` shape: `{id, contactId, channelId, status, assignedAgentId, createdAt, updatedAt, contactPhoneNumber, contactDisplayName}`, matching the backend's `listWaitingConversations`/`listConversationsByAgent` response shape). `QueueList({conversations, onSelect})`, `MyConversationsList({conversations, onSelect})` — consumed by `DashboardPage` (Task 9).

- [ ] **Step 1: Write the failing test for `useQueue`**

Create `frontend/src/hooks/useQueue.test.jsx`:

```jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useQueue } from './useQueue';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../contexts/SocketContext');
vi.mock('../services/api');

function createFakeSocket() {
  const handlers = {};
  return {
    on: vi.fn((event, cb) => {
      handlers[event] = cb;
    }),
    off: vi.fn(),
    trigger: (event, payload) => handlers[event] && handlers[event](payload),
  };
}

let fakeSocket;

beforeEach(() => {
  vi.clearAllMocks();
  fakeSocket = createFakeSocket();
  useAuth.mockReturnValue({ token: 'tok-123' });
  useSocket.mockReturnValue(fakeSocket);
});

describe('useQueue', () => {
  test('fetches the initial queue on mount', async () => {
    api.getQueue.mockResolvedValue([{ id: 'c1', contactDisplayName: 'Carlos' }]);
    const { result } = renderHook(() => useQueue());
    await waitFor(() => expect(result.current).toEqual([{ id: 'c1', contactDisplayName: 'Carlos' }]));
  });

  test('queue:new upserts by conversation id instead of appending', async () => {
    api.getQueue.mockResolvedValue([{ id: 'c1', contactDisplayName: 'Carlos' }]);
    const { result } = renderHook(() => useQueue());
    await waitFor(() => expect(result.current).toHaveLength(1));

    act(() => {
      fakeSocket.trigger('queue:new', { conversation: { id: 'c1', contactDisplayName: 'Carlos (atualizado)' } });
    });

    expect(result.current).toEqual([{ id: 'c1', contactDisplayName: 'Carlos (atualizado)' }]);
  });

  test('queue:new adds a new entry for an unseen conversation', async () => {
    api.getQueue.mockResolvedValue([]);
    const { result } = renderHook(() => useQueue());
    await waitFor(() => expect(result.current).toEqual([]));

    act(() => {
      fakeSocket.trigger('queue:new', { conversation: { id: 'c2', contactDisplayName: 'Maria' } });
    });

    expect(result.current).toEqual([{ id: 'c2', contactDisplayName: 'Maria' }]);
  });

  test('queue:removed removes the conversation from the list', async () => {
    api.getQueue.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]);
    const { result } = renderHook(() => useQueue());
    await waitFor(() => expect(result.current).toHaveLength(2));

    act(() => {
      fakeSocket.trigger('queue:removed', { conversationId: 'c1' });
    });

    expect(result.current).toEqual([{ id: 'c2' }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/hooks/useQueue.test.jsx`
Expected: FAIL with `Cannot find module './useQueue'`.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/hooks/useQueue.js`:

```js
import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import { getQueue } from '../services/api';

export function useQueue() {
  const { token } = useAuth();
  const socket = useSocket();
  const [queue, setQueue] = useState([]);

  useEffect(() => {
    if (!token) return;
    getQueue(token).then(setQueue).catch(() => {});
  }, [token]);

  useEffect(() => {
    if (!socket) return undefined;

    function onNew({ conversation }) {
      setQueue((prev) => {
        const index = prev.findIndex((c) => c.id === conversation.id);
        if (index === -1) return [...prev, conversation];
        const next = [...prev];
        next[index] = conversation;
        return next;
      });
    }

    function onRemoved({ conversationId }) {
      setQueue((prev) => prev.filter((c) => c.id !== conversationId));
    }

    socket.on('queue:new', onNew);
    socket.on('queue:removed', onRemoved);
    return () => {
      socket.off('queue:new', onNew);
      socket.off('queue:removed', onRemoved);
    };
  }, [socket]);

  return queue;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/hooks/useQueue.test.jsx`
Expected: PASS

- [ ] **Step 5: Write the failing test for `useMyConversations`**

Create `frontend/src/hooks/useMyConversations.test.jsx`:

```jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useMyConversations } from './useMyConversations';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../contexts/SocketContext');
vi.mock('../services/api');

function createFakeSocket() {
  const handlers = {};
  return {
    on: vi.fn((event, cb) => {
      handlers[event] = cb;
    }),
    off: vi.fn(),
    trigger: (event, payload) => handlers[event] && handlers[event](payload),
  };
}

let fakeSocket;

beforeEach(() => {
  vi.clearAllMocks();
  fakeSocket = createFakeSocket();
  useAuth.mockReturnValue({ token: 'tok-123' });
  useSocket.mockReturnValue(fakeSocket);
});

describe('useMyConversations', () => {
  test('fetches the initial list on mount', async () => {
    api.getMyConversations.mockResolvedValue([{ id: 'c1' }]);
    const { result } = renderHook(() => useMyConversations());
    await waitFor(() => expect(result.current).toEqual([{ id: 'c1' }]));
  });

  test('conversation:assigned adds the conversation to the list', async () => {
    api.getMyConversations.mockResolvedValue([]);
    const { result } = renderHook(() => useMyConversations());
    await waitFor(() => expect(result.current).toEqual([]));

    act(() => {
      fakeSocket.trigger('conversation:assigned', { conversation: { id: 'c1' } });
    });

    expect(result.current).toEqual([{ id: 'c1' }]);
  });

  test('conversation:removed removes the conversation from the list', async () => {
    api.getMyConversations.mockResolvedValue([{ id: 'c1' }]);
    const { result } = renderHook(() => useMyConversations());
    await waitFor(() => expect(result.current).toHaveLength(1));

    act(() => {
      fakeSocket.trigger('conversation:removed', { conversationId: 'c1' });
    });

    expect(result.current).toEqual([]);
  });

  test('conversation:closed removes the conversation from the list', async () => {
    api.getMyConversations.mockResolvedValue([{ id: 'c1' }]);
    const { result } = renderHook(() => useMyConversations());
    await waitFor(() => expect(result.current).toHaveLength(1));

    act(() => {
      fakeSocket.trigger('conversation:closed', { conversationId: 'c1' });
    });

    expect(result.current).toEqual([]);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/hooks/useMyConversations.test.jsx`
Expected: FAIL with `Cannot find module './useMyConversations'`.

- [ ] **Step 7: Write the implementation**

Create `frontend/src/hooks/useMyConversations.js`:

```js
import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import { getMyConversations } from '../services/api';

export function useMyConversations() {
  const { token } = useAuth();
  const socket = useSocket();
  const [conversations, setConversations] = useState([]);

  useEffect(() => {
    if (!token) return;
    getMyConversations(token).then(setConversations).catch(() => {});
  }, [token]);

  useEffect(() => {
    if (!socket) return undefined;

    function onAssigned({ conversation }) {
      setConversations((prev) => {
        const index = prev.findIndex((c) => c.id === conversation.id);
        if (index === -1) return [...prev, conversation];
        const next = [...prev];
        next[index] = conversation;
        return next;
      });
    }

    function onRemoved({ conversationId }) {
      setConversations((prev) => prev.filter((c) => c.id !== conversationId));
    }

    socket.on('conversation:assigned', onAssigned);
    socket.on('conversation:removed', onRemoved);
    socket.on('conversation:closed', onRemoved);
    return () => {
      socket.off('conversation:assigned', onAssigned);
      socket.off('conversation:removed', onRemoved);
      socket.off('conversation:closed', onRemoved);
    };
  }, [socket]);

  return conversations;
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/hooks/useMyConversations.test.jsx`
Expected: PASS

- [ ] **Step 9: Create the list components (no dedicated tests — pure rendering, exercised via `DashboardPage`'s test in Task 9)**

Create `frontend/src/components/ConversationListItem.jsx`:

```jsx
function ConversationListItem({ conversation, onSelect }) {
  return (
    <li>
      <button
        onClick={() => onSelect(conversation.id)}
        className="w-full rounded border border-gray-200 px-3 py-2 text-left hover:bg-gray-50"
      >
        <p className="font-medium text-gray-800">
          {conversation.contactDisplayName || conversation.contactPhoneNumber}
        </p>
        <p className="text-xs text-gray-500">{conversation.contactPhoneNumber}</p>
      </button>
    </li>
  );
}

export default ConversationListItem;
```

Create `frontend/src/components/QueueList.jsx`:

```jsx
import ConversationListItem from './ConversationListItem';

function QueueList({ conversations, onSelect }) {
  return (
    <div>
      <h2 className="mb-2 font-semibold text-gray-700">Fila de espera</h2>
      {conversations.length === 0 ? (
        <p className="text-sm text-gray-400">Nenhuma conversa aguardando.</p>
      ) : (
        <ul className="space-y-1">
          {conversations.map((conversation) => (
            <ConversationListItem key={conversation.id} conversation={conversation} onSelect={onSelect} />
          ))}
        </ul>
      )}
    </div>
  );
}

export default QueueList;
```

Create `frontend/src/components/MyConversationsList.jsx`:

```jsx
import ConversationListItem from './ConversationListItem';

function MyConversationsList({ conversations, onSelect }) {
  return (
    <div>
      <h2 className="mb-2 font-semibold text-gray-700">Minhas conversas</h2>
      {conversations.length === 0 ? (
        <p className="text-sm text-gray-400">Nenhuma conversa atribuída.</p>
      ) : (
        <ul className="space-y-1">
          {conversations.map((conversation) => (
            <ConversationListItem key={conversation.id} conversation={conversation} onSelect={onSelect} />
          ))}
        </ul>
      )}
    </div>
  );
}

export default MyConversationsList;
```

- [ ] **Step 10: Run the full frontend suite**

Run: `cd frontend && npx vitest run`
Expected: PASS, all frontend test files so far.

- [ ] **Step 11: Commit**

```bash
git add frontend/src/hooks/useQueue.js frontend/src/hooks/useQueue.test.jsx frontend/src/hooks/useMyConversations.js frontend/src/hooks/useMyConversations.test.jsx frontend/src/components/ConversationListItem.jsx frontend/src/components/QueueList.jsx frontend/src/components/MyConversationsList.jsx
git commit -m "feat: add queue and my-conversations hooks and list components"
```

---

### Task 7: `useConversationMessages`, `ConversationView`, `MessageInput`

**Files:**
- Create: `frontend/src/hooks/useConversationMessages.js`
- Create: `frontend/src/hooks/useConversationMessages.test.jsx`
- Create: `frontend/src/components/MessageInput.jsx`
- Create: `frontend/src/components/ConversationView.jsx`
- Create: `frontend/src/components/ConversationView.test.jsx`

**Interfaces:**
- Consumes: `useAuth()` (Task 4), `useSocket()` (Task 5), `getMessages`/`sendMessage`/`claimConversation`/`closeConversation` (Task 3).
- Produces: `useConversationMessages(conversationId) -> {messages, sendMessage(content)}` (`messages` shape: `{id, conversationId, direction, content, whatsappMessageId, status, createdAt}`, matching `listMessagesByConversation`). `ConversationView({conversation, onTransferClick})` — renders the message history, the input box, and the Assumir/Transferir/Fechar buttons; consumed by `DashboardPage` (Task 9).

- [ ] **Step 1: Write the failing test for `useConversationMessages`**

Create `frontend/src/hooks/useConversationMessages.test.jsx`:

```jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useConversationMessages } from './useConversationMessages';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../contexts/SocketContext');
vi.mock('../services/api');

function createFakeSocket() {
  const handlers = {};
  return {
    on: vi.fn((event, cb) => {
      handlers[event] = cb;
    }),
    off: vi.fn(),
    trigger: (event, payload) => handlers[event] && handlers[event](payload),
  };
}

let fakeSocket;

beforeEach(() => {
  vi.clearAllMocks();
  fakeSocket = createFakeSocket();
  useAuth.mockReturnValue({ token: 'tok-123' });
  useSocket.mockReturnValue(fakeSocket);
});

describe('useConversationMessages', () => {
  test('fetches the message history for the given conversation', async () => {
    api.getMessages.mockResolvedValue([{ id: 'm1', content: 'Oi' }]);
    const { result } = renderHook(() => useConversationMessages('conv-1'));
    await waitFor(() => expect(result.current.messages).toEqual([{ id: 'm1', content: 'Oi' }]));
    expect(api.getMessages).toHaveBeenCalledWith('conv-1', 'tok-123');
  });

  test('message:new appends a message for this conversation', async () => {
    api.getMessages.mockResolvedValue([]);
    const { result } = renderHook(() => useConversationMessages('conv-1'));
    await waitFor(() => expect(result.current.messages).toEqual([]));

    act(() => {
      fakeSocket.trigger('message:new', {
        conversation: { id: 'conv-1' },
        message: { id: 'm1', content: 'Oi' },
      });
    });

    expect(result.current.messages).toEqual([{ id: 'm1', content: 'Oi' }]);
  });

  test('message:new for a different conversation is ignored', async () => {
    api.getMessages.mockResolvedValue([]);
    const { result } = renderHook(() => useConversationMessages('conv-1'));
    await waitFor(() => expect(result.current.messages).toEqual([]));

    act(() => {
      fakeSocket.trigger('message:new', {
        conversation: { id: 'conv-OTHER' },
        message: { id: 'm1', content: 'Oi' },
      });
    });

    expect(result.current.messages).toEqual([]);
  });

  test('message:updated merges into the existing message by id', async () => {
    api.getMessages.mockResolvedValue([{ id: 'm1', content: 'Resposta', status: 'sent' }]);
    const { result } = renderHook(() => useConversationMessages('conv-1'));
    await waitFor(() => expect(result.current.messages).toHaveLength(1));

    act(() => {
      fakeSocket.trigger('message:updated', {
        conversationId: 'conv-1',
        message: { id: 'm1', content: 'Resposta', status: 'failed' },
      });
    });

    expect(result.current.messages).toEqual([{ id: 'm1', content: 'Resposta', status: 'failed' }]);
  });

  test('message:updated for a different conversation is ignored', async () => {
    api.getMessages.mockResolvedValue([{ id: 'm1', status: 'sent' }]);
    const { result } = renderHook(() => useConversationMessages('conv-1'));
    await waitFor(() => expect(result.current.messages).toHaveLength(1));

    act(() => {
      fakeSocket.trigger('message:updated', {
        conversationId: 'conv-OTHER',
        message: { id: 'm1', status: 'failed' },
      });
    });

    expect(result.current.messages).toEqual([{ id: 'm1', status: 'sent' }]);
  });

  test('sendMessage posts to the API and appends the created message immediately', async () => {
    api.getMessages.mockResolvedValue([]);
    api.sendMessage.mockResolvedValue({ id: 'm2', content: 'Ola cliente', status: 'sent' });
    const { result } = renderHook(() => useConversationMessages('conv-1'));
    await waitFor(() => expect(result.current.messages).toEqual([]));

    await act(async () => {
      await result.current.sendMessage('Ola cliente');
    });

    expect(api.sendMessage).toHaveBeenCalledWith('conv-1', 'Ola cliente', 'tok-123');
    expect(result.current.messages).toEqual([{ id: 'm2', content: 'Ola cliente', status: 'sent' }]);
  });

  test('resets the message list when the conversationId changes', async () => {
    api.getMessages.mockResolvedValueOnce([{ id: 'm1' }]).mockResolvedValueOnce([{ id: 'm2' }]);
    const { result, rerender } = renderHook(({ id }) => useConversationMessages(id), {
      initialProps: { id: 'conv-1' },
    });
    await waitFor(() => expect(result.current.messages).toEqual([{ id: 'm1' }]));

    rerender({ id: 'conv-2' });

    await waitFor(() => expect(result.current.messages).toEqual([{ id: 'm2' }]));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/hooks/useConversationMessages.test.jsx`
Expected: FAIL with `Cannot find module './useConversationMessages'`.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/hooks/useConversationMessages.js`:

```js
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import { getMessages, sendMessage as apiSendMessage } from '../services/api';

export function useConversationMessages(conversationId) {
  const { token } = useAuth();
  const socket = useSocket();
  const [messages, setMessages] = useState([]);

  useEffect(() => {
    setMessages([]);
    if (!conversationId || !token) return;
    getMessages(conversationId, token).then(setMessages).catch(() => {});
  }, [conversationId, token]);

  useEffect(() => {
    if (!socket || !conversationId) return undefined;

    function onNew({ conversation, message }) {
      if (conversation.id !== conversationId) return;
      setMessages((prev) => [...prev, message]);
    }

    function onUpdated({ conversationId: updatedId, message }) {
      if (updatedId !== conversationId) return;
      setMessages((prev) => prev.map((m) => (m.id === message.id ? message : m)));
    }

    socket.on('message:new', onNew);
    socket.on('message:updated', onUpdated);
    return () => {
      socket.off('message:new', onNew);
      socket.off('message:updated', onUpdated);
    };
  }, [socket, conversationId]);

  const sendMessage = useCallback(
    async (content) => {
      const created = await apiSendMessage(conversationId, content, token);
      setMessages((prev) => [...prev, created]);
      return created;
    },
    [conversationId, token]
  );

  return { messages, sendMessage };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/hooks/useConversationMessages.test.jsx`
Expected: PASS

- [ ] **Step 5: Create `MessageInput` (no dedicated test — its one interaction is exercised via `ConversationView`'s test below)**

Create `frontend/src/components/MessageInput.jsx`:

```jsx
import { useState } from 'react';

function MessageInput({ onSend }) {
  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    if (!content.trim()) return;
    setSending(true);
    try {
      await onSend(content);
      setContent('');
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2 border-t border-gray-200 p-3">
      <input
        type="text"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Digite uma mensagem..."
        className="flex-1 rounded border border-gray-300 px-3 py-2"
      />
      <button type="submit" disabled={sending} className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50">
        Enviar
      </button>
    </form>
  );
}

export default MessageInput;
```

- [ ] **Step 6: Write the failing test for `ConversationView`**

Create `frontend/src/components/ConversationView.test.jsx`:

```jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ConversationView from './ConversationView';
import { useAuth } from '../contexts/AuthContext';
import { useConversationMessages } from '../hooks/useConversationMessages';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../hooks/useConversationMessages');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'agent-1', role: 'agent' } });
  useConversationMessages.mockReturnValue({
    messages: [{ id: 'm1', direction: 'inbound', content: 'Oi, preciso de ajuda' }],
    sendMessage: vi.fn(),
  });
});

describe('ConversationView', () => {
  test('renders the message history', () => {
    render(<ConversationView conversation={{ id: 'c1', status: 'waiting', assignedAgentId: null }} onTransferClick={vi.fn()} />);
    expect(screen.getByText('Oi, preciso de ajuda')).toBeInTheDocument();
  });

  test('shows the Assumir button when the conversation is unassigned', () => {
    render(<ConversationView conversation={{ id: 'c1', status: 'waiting', assignedAgentId: null }} onTransferClick={vi.fn()} />);
    expect(screen.getByRole('button', { name: /assumir/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /transferir/i })).not.toBeInTheDocument();
  });

  test('clicking Assumir calls claimConversation', async () => {
    api.claimConversation.mockResolvedValue({});
    render(<ConversationView conversation={{ id: 'c1', status: 'waiting', assignedAgentId: null }} onTransferClick={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /assumir/i }));
    await waitFor(() => expect(api.claimConversation).toHaveBeenCalledWith('c1', 'tok-123'));
  });

  test('shows Transferir and Fechar when assigned to me', () => {
    render(
      <ConversationView
        conversation={{ id: 'c1', status: 'assigned', assignedAgentId: 'agent-1' }}
        onTransferClick={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: /transferir/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /fechar/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /assumir/i })).not.toBeInTheDocument();
  });

  test('clicking Fechar calls closeConversation', async () => {
    api.closeConversation.mockResolvedValue({});
    render(
      <ConversationView
        conversation={{ id: 'c1', status: 'assigned', assignedAgentId: 'agent-1' }}
        onTransferClick={vi.fn()}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: /fechar/i }));
    await waitFor(() => expect(api.closeConversation).toHaveBeenCalledWith('c1', 'tok-123'));
  });

  test('clicking Transferir calls onTransferClick with the conversation id', async () => {
    const onTransferClick = vi.fn();
    render(
      <ConversationView
        conversation={{ id: 'c1', status: 'assigned', assignedAgentId: 'agent-1' }}
        onTransferClick={onTransferClick}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: /transferir/i }));
    expect(onTransferClick).toHaveBeenCalledWith('c1');
  });

  test('shows neither action button when assigned to another agent', () => {
    render(
      <ConversationView
        conversation={{ id: 'c1', status: 'assigned', assignedAgentId: 'agent-OTHER' }}
        onTransferClick={vi.fn()}
      />
    );
    expect(screen.queryByRole('button', { name: /assumir/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /transferir/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /fechar/i })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/ConversationView.test.jsx`
Expected: FAIL with `Cannot find module './ConversationView'`.

- [ ] **Step 8: Write the implementation**

Create `frontend/src/components/ConversationView.jsx`:

```jsx
import { useAuth } from '../contexts/AuthContext';
import { useConversationMessages } from '../hooks/useConversationMessages';
import { claimConversation, closeConversation } from '../services/api';
import MessageInput from './MessageInput';

function ConversationView({ conversation, onTransferClick }) {
  const { token, agent } = useAuth();
  const { messages, sendMessage } = useConversationMessages(conversation.id);

  const isUnassigned = conversation.status !== 'closed' && !conversation.assignedAgentId;
  const isMine = conversation.assignedAgentId === agent.id;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-gray-200 p-3">
        <h3 className="font-semibold text-gray-800">Conversa</h3>
        <div className="flex gap-2">
          {isUnassigned && (
            <button
              onClick={() => claimConversation(conversation.id, token)}
              className="rounded bg-green-600 px-3 py-1 text-sm text-white"
            >
              Assumir
            </button>
          )}
          {isMine && (
            <>
              <button
                onClick={() => onTransferClick(conversation.id)}
                className="rounded bg-blue-600 px-3 py-1 text-sm text-white"
              >
                Transferir
              </button>
              <button
                onClick={() => closeConversation(conversation.id, token)}
                className="rounded bg-gray-600 px-3 py-1 text-sm text-white"
              >
                Fechar
              </button>
            </>
          )}
        </div>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`max-w-xs rounded px-3 py-2 text-sm ${
              message.direction === 'inbound' ? 'bg-gray-100 text-gray-800' : 'ml-auto bg-blue-100 text-gray-800'
            }`}
          >
            {message.content}
          </div>
        ))}
      </div>
      <MessageInput onSend={sendMessage} />
    </div>
  );
}

export default ConversationView;
```

- [ ] **Step 9: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/ConversationView.test.jsx`
Expected: PASS

- [ ] **Step 10: Run the full frontend suite**

Run: `cd frontend && npx vitest run`
Expected: PASS, all frontend test files so far.

- [ ] **Step 11: Commit**

```bash
git add frontend/src/hooks/useConversationMessages.js frontend/src/hooks/useConversationMessages.test.jsx frontend/src/components/MessageInput.jsx frontend/src/components/ConversationView.jsx frontend/src/components/ConversationView.test.jsx
git commit -m "feat: add conversation messages hook, ConversationView, and MessageInput"
```

---

### Task 8: `useAgents`, `TransferModal`

**Files:**
- Create: `frontend/src/hooks/useAgents.js`
- Create: `frontend/src/components/TransferModal.jsx`
- Create: `frontend/src/components/TransferModal.test.jsx`

**Interfaces:**
- Consumes: `useAuth()` (Task 4), `listAgents`/`transferConversation` (Task 3).
- Produces: `useAgents() -> {id, email, role}[]`. `TransferModal({conversationId, onClose})` — a list of agents to transfer to; consumed by `DashboardPage` (Task 9).

- [ ] **Step 1: Create `useAgents` (no dedicated test — trivial fetch-on-mount, exercised via `TransferModal`'s test below)**

Create `frontend/src/hooks/useAgents.js`:

```js
import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { listAgents } from '../services/api';

export function useAgents() {
  const { token } = useAuth();
  const [agents, setAgents] = useState([]);

  useEffect(() => {
    if (!token) return;
    listAgents(token).then(setAgents).catch(() => {});
  }, [token]);

  return agents;
}
```

- [ ] **Step 2: Write the failing test for `TransferModal`**

Create `frontend/src/components/TransferModal.test.jsx`:

```jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TransferModal from './TransferModal';
import { useAuth } from '../contexts/AuthContext';
import { useAgents } from '../hooks/useAgents';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../hooks/useAgents');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'agent-1' } });
  useAgents.mockReturnValue([
    { id: 'agent-1', email: 'me@dw.com', role: 'agent' },
    { id: 'agent-2', email: 'other@dw.com', role: 'agent' },
  ]);
});

describe('TransferModal', () => {
  test('lists every agent except myself', () => {
    render(<TransferModal conversationId="c1" onClose={vi.fn()} />);
    expect(screen.queryByText('me@dw.com')).not.toBeInTheDocument();
    expect(screen.getByText('other@dw.com')).toBeInTheDocument();
  });

  test('selecting an agent transfers the conversation and closes the modal', async () => {
    api.transferConversation.mockResolvedValue({});
    const onClose = vi.fn();
    render(<TransferModal conversationId="c1" onClose={onClose} />);

    await userEvent.click(screen.getByText('other@dw.com'));

    await waitFor(() => expect(api.transferConversation).toHaveBeenCalledWith('c1', 'agent-2', 'tok-123'));
    expect(onClose).toHaveBeenCalled();
  });

  test('clicking the cancel button closes the modal without transferring', async () => {
    const onClose = vi.fn();
    render(<TransferModal conversationId="c1" onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: /cancelar/i }));
    expect(onClose).toHaveBeenCalled();
    expect(api.transferConversation).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/TransferModal.test.jsx`
Expected: FAIL with `Cannot find module './TransferModal'`.

- [ ] **Step 4: Write the implementation**

Create `frontend/src/components/TransferModal.jsx`:

```jsx
import { useAuth } from '../contexts/AuthContext';
import { useAgents } from '../hooks/useAgents';
import { transferConversation } from '../services/api';

function TransferModal({ conversationId, onClose }) {
  const { token, agent } = useAuth();
  const agents = useAgents().filter((a) => a.id !== agent.id);

  async function handleSelect(toAgentId) {
    await transferConversation(conversationId, toAgentId, token);
    onClose();
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/40">
      <div className="w-72 rounded bg-white p-4 shadow">
        <h3 className="mb-3 font-semibold text-gray-800">Transferir para</h3>
        <ul className="mb-3 space-y-1">
          {agents.map((a) => (
            <li key={a.id}>
              <button
                onClick={() => handleSelect(a.id)}
                className="w-full rounded border border-gray-200 px-3 py-2 text-left hover:bg-gray-50"
              >
                {a.email}
              </button>
            </li>
          ))}
        </ul>
        <button onClick={onClose} className="w-full rounded bg-gray-200 py-2 text-sm text-gray-700">
          Cancelar
        </button>
      </div>
    </div>
  );
}

export default TransferModal;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/TransferModal.test.jsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add frontend/src/hooks/useAgents.js frontend/src/components/TransferModal.jsx frontend/src/components/TransferModal.test.jsx
git commit -m "feat: add agents hook and the transfer modal"
```

---

### Task 9: `DashboardPage`, `useChannels`, `ChannelStatusBanner`

**Files:**
- Create: `frontend/src/hooks/useChannels.js`
- Create: `frontend/src/components/ChannelStatusBanner.jsx`
- Create: `frontend/src/components/ChannelStatusBanner.test.jsx`
- Create: `frontend/src/pages/DashboardPage.jsx`
- Create: `frontend/src/pages/DashboardPage.test.jsx`

**Interfaces:**
- Consumes: `useAuth()` (Task 4), `useQueue`/`useMyConversations` (Task 6), `ConversationView` (Task 7), `TransferModal` (Task 8), `listChannels` (Task 3).
- Produces: `useChannels() -> {channels, loading, refresh()}` (`Channel` shape: `{id, type, name, phoneNumber, status}`, matching `GET /api/admin/channels`'s response) — reused by `AdminChannelsPage` (Task 10). `DashboardPage` — the main authenticated screen, mounted at `/` in `App.jsx` (Task 11).

- [ ] **Step 1: Create `useChannels` (no dedicated test — trivial fetch-on-mount with a refresh function, exercised via `ChannelStatusBanner`'s and Task 10's tests)**

Create `frontend/src/hooks/useChannels.js`:

```js
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { listChannels } from '../services/api';

export function useChannels() {
  const { token } = useAuth();
  const [channels, setChannels] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    if (!token) return Promise.resolve();
    setLoading(true);
    return listChannels(token).then((data) => {
      setChannels(data);
      setLoading(false);
    });
  }, [token]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { channels, loading, refresh };
}
```

- [ ] **Step 2: Write the failing test for `ChannelStatusBanner`**

Create `frontend/src/components/ChannelStatusBanner.test.jsx`:

```jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import ChannelStatusBanner from './ChannelStatusBanner';
import { useAuth } from '../contexts/AuthContext';
import { useChannels } from '../hooks/useChannels';

vi.mock('../contexts/AuthContext');
vi.mock('../hooks/useChannels');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ChannelStatusBanner', () => {
  test('renders nothing for a non-admin agent', () => {
    useAuth.mockReturnValue({ agent: { role: 'agent' } });
    useChannels.mockReturnValue({ channels: [{ id: 'ch1', name: 'Berg', status: 'disconnected' }], loading: false });
    const { container } = render(<ChannelStatusBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  test('renders nothing for an admin when every channel is connected', () => {
    useAuth.mockReturnValue({ agent: { role: 'admin' } });
    useChannels.mockReturnValue({ channels: [{ id: 'ch1', name: 'Berg', status: 'connected' }], loading: false });
    const { container } = render(<ChannelStatusBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  test('warns an admin about a disconnected channel', () => {
    useAuth.mockReturnValue({ agent: { role: 'admin' } });
    useChannels.mockReturnValue({
      channels: [{ id: 'ch1', name: 'Berg', status: 'disconnected' }],
      loading: false,
    });
    render(<ChannelStatusBanner />);
    expect(screen.getByText(/Berg/)).toBeInTheDocument();
    expect(screen.getByText(/desconectado/i)).toBeInTheDocument();
  });

  test('warns an admin about a channel awaiting QR', () => {
    useAuth.mockReturnValue({ agent: { role: 'admin' } });
    useChannels.mockReturnValue({
      channels: [{ id: 'ch1', name: 'Berg', status: 'awaiting_qr' }],
      loading: false,
    });
    render(<ChannelStatusBanner />);
    expect(screen.getByText(/QR/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/ChannelStatusBanner.test.jsx`
Expected: FAIL with `Cannot find module './ChannelStatusBanner'`.

- [ ] **Step 4: Write the implementation**

Create `frontend/src/components/ChannelStatusBanner.jsx`:

```jsx
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useChannels } from '../hooks/useChannels';

function ChannelStatusBanner() {
  const { agent } = useAuth();
  const { channels } = useChannels();

  if (agent.role !== 'admin') return null;

  const problemChannels = channels.filter((c) => c.status !== 'connected');
  if (problemChannels.length === 0) return null;

  return (
    <div className="bg-yellow-100 px-4 py-2 text-sm text-yellow-800">
      {problemChannels.map((channel) => (
        <p key={channel.id}>
          Canal <strong>{channel.name}</strong> está{' '}
          {channel.status === 'awaiting_qr' ? 'aguardando leitura do QR code' : 'desconectado'} —{' '}
          <Link to="/admin/channels" className="underline">
            ver na administração de canais
          </Link>
        </p>
      ))}
    </div>
  );
}

export default ChannelStatusBanner;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/ChannelStatusBanner.test.jsx`
Expected: PASS

- [ ] **Step 6: Write the failing test for `DashboardPage`**

Create `frontend/src/pages/DashboardPage.test.jsx`:

```jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import DashboardPage from './DashboardPage';
import { useAuth } from '../contexts/AuthContext';
import { useQueue } from '../hooks/useQueue';
import { useMyConversations } from '../hooks/useMyConversations';
import { useChannels } from '../hooks/useChannels';
import { useConversationMessages } from '../hooks/useConversationMessages';

vi.mock('../contexts/AuthContext');
vi.mock('../hooks/useQueue');
vi.mock('../hooks/useMyConversations');
vi.mock('../hooks/useChannels');
vi.mock('../hooks/useAgents', () => ({ useAgents: () => [] }));
vi.mock('../hooks/useConversationMessages');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'agent-1', role: 'agent' }, logout: vi.fn() });
  useChannels.mockReturnValue({ channels: [], loading: false, refresh: vi.fn() });
  // DashboardPage's own wiring is what this file tests — ConversationView's
  // internals (already covered by Task 7's ConversationView.test.jsx) are
  // stubbed out here so selecting a conversation doesn't trigger a real,
  // unmocked fetch via the real useConversationMessages/services/api.
  useConversationMessages.mockReturnValue({ messages: [], sendMessage: vi.fn() });
});

function renderDashboard() {
  return render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>
  );
}

describe('DashboardPage', () => {
  test('renders both the queue and my-conversations lists', () => {
    useQueue.mockReturnValue([{ id: 'c1', contactDisplayName: 'Carlos' }]);
    useMyConversations.mockReturnValue([{ id: 'c2', contactDisplayName: 'Maria' }]);
    renderDashboard();
    expect(screen.getByText('Carlos')).toBeInTheDocument();
    expect(screen.getByText('Maria')).toBeInTheDocument();
  });

  test('selecting a conversation from the queue opens the conversation view', async () => {
    useQueue.mockReturnValue([{ id: 'c1', contactDisplayName: 'Carlos', status: 'waiting', assignedAgentId: null }]);
    useMyConversations.mockReturnValue([]);
    renderDashboard();
    await userEvent.click(screen.getByText('Carlos'));
    expect(screen.getByRole('button', { name: /assumir/i })).toBeInTheDocument();
  });

  test('shows a placeholder when no conversation is selected', () => {
    useQueue.mockReturnValue([]);
    useMyConversations.mockReturnValue([]);
    renderDashboard();
    expect(screen.getByText(/selecione uma conversa/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/pages/DashboardPage.test.jsx`
Expected: FAIL with `Cannot find module './DashboardPage'`.

- [ ] **Step 8: Write the implementation**

Create `frontend/src/pages/DashboardPage.jsx`:

```jsx
import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useQueue } from '../hooks/useQueue';
import { useMyConversations } from '../hooks/useMyConversations';
import QueueList from '../components/QueueList';
import MyConversationsList from '../components/MyConversationsList';
import ConversationView from '../components/ConversationView';
import TransferModal from '../components/TransferModal';
import ChannelStatusBanner from '../components/ChannelStatusBanner';

function DashboardPage() {
  const { logout } = useAuth();
  const queue = useQueue();
  const myConversations = useMyConversations();
  const [selectedId, setSelectedId] = useState(null);
  const [transferringId, setTransferringId] = useState(null);

  const selectedConversation = [...queue, ...myConversations].find((c) => c.id === selectedId) || null;

  return (
    <div className="flex h-screen flex-col">
      <ChannelStatusBanner />
      <header className="flex items-center justify-between border-b border-gray-200 px-4 py-2">
        <h1 className="font-semibold text-gray-800">DW Telecom - Atendimento</h1>
        <button onClick={logout} className="text-sm text-gray-500 hover:underline">
          Sair
        </button>
      </header>
      <div className="flex flex-1 overflow-hidden">
        <aside className="w-64 space-y-4 overflow-y-auto border-r border-gray-200 p-3">
          <QueueList conversations={queue} onSelect={setSelectedId} />
          <MyConversationsList conversations={myConversations} onSelect={setSelectedId} />
        </aside>
        <main className="flex-1">
          {selectedConversation ? (
            <ConversationView conversation={selectedConversation} onTransferClick={setTransferringId} />
          ) : (
            <p className="flex h-full items-center justify-center text-gray-400">
              Selecione uma conversa na lista ao lado.
            </p>
          )}
        </main>
      </div>
      {transferringId && <TransferModal conversationId={transferringId} onClose={() => setTransferringId(null)} />}
    </div>
  );
}

export default DashboardPage;
```

- [ ] **Step 9: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/pages/DashboardPage.test.jsx`
Expected: PASS

- [ ] **Step 10: Run the full frontend suite**

Run: `cd frontend && npx vitest run`
Expected: PASS, all frontend test files so far.

- [ ] **Step 11: Commit**

```bash
git add frontend/src/hooks/useChannels.js frontend/src/components/ChannelStatusBanner.jsx frontend/src/components/ChannelStatusBanner.test.jsx frontend/src/pages/DashboardPage.jsx frontend/src/pages/DashboardPage.test.jsx
git commit -m "feat: add DashboardPage, channel status banner, and useChannels"
```

---

### Task 10: `AdminChannelsPage`, `CreateChannelForm`, `QrCodeView`

**Files:**
- Create: `frontend/src/components/CreateChannelForm.jsx`
- Create: `frontend/src/components/CreateChannelForm.test.jsx`
- Create: `frontend/src/components/QrCodeView.jsx`
- Create: `frontend/src/pages/AdminChannelsPage.jsx`
- Create: `frontend/src/pages/AdminChannelsPage.test.jsx`

**Interfaces:**
- Consumes: `useAuth()` (Task 4), `useChannels` (Task 9), `createChannel` (Task 3).
- Produces: `AdminChannelsPage` — mounted at `/admin/channels` in `App.jsx` (Task 11), behind `ProtectedRoute`'s `requireAdmin`.

- [ ] **Step 1: Write the failing test for `CreateChannelForm`**

Create `frontend/src/components/CreateChannelForm.test.jsx`:

```jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CreateChannelForm from './CreateChannelForm';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
});

describe('CreateChannelForm', () => {
  test('creates a baileys channel with just name and phone number', async () => {
    api.createChannel.mockResolvedValue({ id: 'ch1' });
    const onCreated = vi.fn();
    render(<CreateChannelForm onCreated={onCreated} />);

    await userEvent.selectOptions(screen.getByLabelText(/tipo/i), 'baileys');
    await userEvent.type(screen.getByLabelText(/^nome/i), 'Vendas');
    await userEvent.type(screen.getByLabelText(/telefone/i), '+5511988887777');
    await userEvent.click(screen.getByRole('button', { name: /cadastrar/i }));

    await waitFor(() =>
      expect(api.createChannel).toHaveBeenCalledWith(
        { type: 'baileys', name: 'Vendas', phoneNumber: '+5511988887777' },
        'tok-123'
      )
    );
    expect(onCreated).toHaveBeenCalled();
  });

  test('shows the phoneNumberId and accessToken fields only for meta_cloud', async () => {
    render(<CreateChannelForm onCreated={vi.fn()} />);
    expect(screen.queryByLabelText(/phone number id/i)).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText(/tipo/i), 'meta_cloud');

    expect(screen.getByLabelText(/phone number id/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/access token/i)).toBeInTheDocument();
  });

  test('creates a meta_cloud channel with all fields', async () => {
    api.createChannel.mockResolvedValue({ id: 'ch2' });
    render(<CreateChannelForm onCreated={vi.fn()} />);

    await userEvent.selectOptions(screen.getByLabelText(/tipo/i), 'meta_cloud');
    await userEvent.type(screen.getByLabelText(/^nome/i), 'Suporte');
    await userEvent.type(screen.getByLabelText(/telefone/i), '+5511999990000');
    await userEvent.type(screen.getByLabelText(/phone number id/i), '123456');
    await userEvent.type(screen.getByLabelText(/access token/i), 'tok-meta');
    await userEvent.click(screen.getByRole('button', { name: /cadastrar/i }));

    await waitFor(() =>
      expect(api.createChannel).toHaveBeenCalledWith(
        {
          type: 'meta_cloud',
          name: 'Suporte',
          phoneNumber: '+5511999990000',
          phoneNumberId: '123456',
          accessToken: 'tok-meta',
        },
        'tok-123'
      )
    );
  });

  test('shows an error message when creation fails', async () => {
    api.createChannel.mockRejectedValue({ body: { error: 'Ja existe um canal com esse telefone' } });
    render(<CreateChannelForm onCreated={vi.fn()} />);

    await userEvent.selectOptions(screen.getByLabelText(/tipo/i), 'baileys');
    await userEvent.type(screen.getByLabelText(/^nome/i), 'Vendas');
    await userEvent.type(screen.getByLabelText(/telefone/i), '+5511988887777');
    await userEvent.click(screen.getByRole('button', { name: /cadastrar/i }));

    expect(await screen.findByText('Ja existe um canal com esse telefone')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/CreateChannelForm.test.jsx`
Expected: FAIL with `Cannot find module './CreateChannelForm'`.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/components/CreateChannelForm.jsx`:

```jsx
import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { createChannel } from '../services/api';

function CreateChannelForm({ onCreated }) {
  const { token } = useAuth();
  const [type, setType] = useState('baileys');
  const [name, setName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    const payload =
      type === 'meta_cloud' ? { type, name, phoneNumber, phoneNumberId, accessToken } : { type, name, phoneNumber };
    try {
      await createChannel(payload, token);
      setName('');
      setPhoneNumber('');
      setPhoneNumberId('');
      setAccessToken('');
      onCreated();
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao cadastrar canal');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded border border-gray-200 p-4">
      <h3 className="font-semibold text-gray-800">Cadastrar novo canal</h3>
      <div>
        <label htmlFor="type" className="mb-1 block text-sm text-gray-600">
          Tipo
        </label>
        <select
          id="type"
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="w-full rounded border border-gray-300 px-3 py-2"
        >
          <option value="baileys">Baileys (não oficial)</option>
          <option value="meta_cloud">Meta Cloud (oficial)</option>
        </select>
      </div>
      <div>
        <label htmlFor="name" className="mb-1 block text-sm text-gray-600">
          Nome
        </label>
        <input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded border border-gray-300 px-3 py-2"
          required
        />
      </div>
      <div>
        <label htmlFor="phoneNumber" className="mb-1 block text-sm text-gray-600">
          Telefone
        </label>
        <input
          id="phoneNumber"
          value={phoneNumber}
          onChange={(e) => setPhoneNumber(e.target.value)}
          placeholder="+5511999998888"
          className="w-full rounded border border-gray-300 px-3 py-2"
          required
        />
      </div>
      {type === 'meta_cloud' && (
        <>
          <div>
            <label htmlFor="phoneNumberId" className="mb-1 block text-sm text-gray-600">
              Phone Number ID
            </label>
            <input
              id="phoneNumberId"
              value={phoneNumberId}
              onChange={(e) => setPhoneNumberId(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2"
              required
            />
          </div>
          <div>
            <label htmlFor="accessToken" className="mb-1 block text-sm text-gray-600">
              Access Token
            </label>
            <input
              id="accessToken"
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2"
              required
            />
          </div>
        </>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={submitting} className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50">
        Cadastrar
      </button>
    </form>
  );
}

export default CreateChannelForm;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/CreateChannelForm.test.jsx`
Expected: PASS

- [ ] **Step 5: Create `QrCodeView` (no dedicated test — it only embeds a URL built from `API_BASE_URL`/token in an iframe, since the backend route returns a full HTML page, not raw image bytes; exercised via `AdminChannelsPage`'s test below)**

Create `frontend/src/components/QrCodeView.jsx`:

```jsx
import { useAuth } from '../contexts/AuthContext';
import { API_BASE_URL } from '../services/api';

function QrCodeView({ channel, onRefresh }) {
  const { token } = useAuth();

  if (channel.status !== 'awaiting_qr') return null;

  const qrUrl = `${API_BASE_URL}/api/admin/channels/${channel.id}/qr?token=${token}`;

  return (
    <div className="rounded border border-gray-200 p-3 text-center">
      <p className="mb-2 text-sm text-gray-600">Escaneie o QR code no WhatsApp: {channel.name}</p>
      <iframe title={`QR - ${channel.name}`} src={qrUrl} className="mx-auto h-64 w-64 border-0" />
      <button onClick={onRefresh} className="mt-2 text-sm text-blue-600 underline">
        Atualizar
      </button>
    </div>
  );
}

export default QrCodeView;
```

- [ ] **Step 6: Write the failing test for `AdminChannelsPage`**

Create `frontend/src/pages/AdminChannelsPage.test.jsx`:

```jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import AdminChannelsPage from './AdminChannelsPage';
import { useChannels } from '../hooks/useChannels';
import { useAuth } from '../contexts/AuthContext';

vi.mock('../hooks/useChannels');
vi.mock('../contexts/AuthContext');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
});

describe('AdminChannelsPage', () => {
  test('lists every channel with its status', () => {
    useChannels.mockReturnValue({
      channels: [
        { id: 'ch1', type: 'baileys', name: 'Berg', phoneNumber: '+5598985004187', status: 'connected' },
        { id: 'ch2', type: 'meta_cloud', name: 'Suporte', phoneNumber: '+5511999990000', status: 'connected' },
      ],
      loading: false,
      refresh: vi.fn(),
    });
    render(<AdminChannelsPage />);
    expect(screen.getByText('Berg')).toBeInTheDocument();
    expect(screen.getByText('Suporte')).toBeInTheDocument();
  });

  test('shows the QR view for a channel awaiting_qr', () => {
    useChannels.mockReturnValue({
      channels: [{ id: 'ch1', type: 'baileys', name: 'Berg', phoneNumber: '+5598985004187', status: 'awaiting_qr' }],
      loading: false,
      refresh: vi.fn(),
    });
    render(<AdminChannelsPage />);
    expect(screen.getByText(/Escaneie o QR code/)).toBeInTheDocument();
  });

  test('renders the create-channel form', () => {
    useChannels.mockReturnValue({ channels: [], loading: false, refresh: vi.fn() });
    render(<AdminChannelsPage />);
    expect(screen.getByText(/Cadastrar novo canal/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/pages/AdminChannelsPage.test.jsx`
Expected: FAIL with `Cannot find module './AdminChannelsPage'`.

- [ ] **Step 8: Write the implementation**

Create `frontend/src/pages/AdminChannelsPage.jsx`:

```jsx
import { useChannels } from '../hooks/useChannels';
import CreateChannelForm from '../components/CreateChannelForm';
import QrCodeView from '../components/QrCodeView';

function AdminChannelsPage() {
  const { channels, refresh } = useChannels();

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className="text-xl font-semibold text-gray-800">Administração de Canais</h1>
      <div className="space-y-3">
        {channels.map((channel) => (
          <div key={channel.id} className="rounded border border-gray-200 p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-gray-800">{channel.name}</p>
                <p className="text-sm text-gray-500">
                  {channel.type === 'meta_cloud' ? 'Meta Cloud (oficial)' : 'Baileys (não oficial)'} —{' '}
                  {channel.phoneNumber}
                </p>
              </div>
              <span className="text-sm text-gray-500">{channel.status}</span>
            </div>
            <QrCodeView channel={channel} onRefresh={refresh} />
          </div>
        ))}
      </div>
      <CreateChannelForm onCreated={refresh} />
    </div>
  );
}

export default AdminChannelsPage;
```

- [ ] **Step 9: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/pages/AdminChannelsPage.test.jsx`
Expected: PASS

- [ ] **Step 10: Run the full frontend suite**

Run: `cd frontend && npx vitest run`
Expected: PASS, all frontend test files so far.

- [ ] **Step 11: Commit**

```bash
git add frontend/src/components/CreateChannelForm.jsx frontend/src/components/CreateChannelForm.test.jsx frontend/src/components/QrCodeView.jsx frontend/src/pages/AdminChannelsPage.jsx frontend/src/pages/AdminChannelsPage.test.jsx
git commit -m "feat: add AdminChannelsPage, CreateChannelForm, and QrCodeView"
```

---

### Task 11: Routing wiring (`App.jsx`) and production build config

**Files:**
- Modify: `frontend/src/App.jsx`
- Create: `frontend/src/App.test.jsx`
- Create: `frontend/.env.production.example`

**Interfaces:**
- Consumes: `AuthProvider`/`useAuth` (Task 4), `SocketProvider` (Task 5), `ProtectedRoute` (Task 4), `LoginPage` (Task 4), `DashboardPage` (Task 9), `AdminChannelsPage` (Task 10).
- Produces: the fully wired `App` component — the last piece; after this task the frontend is a complete, navigable application.

- [ ] **Step 1: Write the failing test for the wired `App`**

Create `frontend/src/App.test.jsx`:

```jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import * as api from './services/api';
import { io } from 'socket.io-client';

vi.mock('./services/api');
vi.mock('socket.io-client');

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  io.mockReturnValue({ on: vi.fn(), off: vi.fn(), close: vi.fn() });
});

describe('App', () => {
  test('redirects an unauthenticated visitor to the login page', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: /entrar/i })).toBeInTheDocument();
  });

  test('logs in and reaches the dashboard', async () => {
    api.login.mockResolvedValue({ token: 'tok-123', agent: { id: 'agent-1', email: 'a@dw.com', role: 'agent' } });
    api.getQueue.mockResolvedValue([]);
    api.getMyConversations.mockResolvedValue([]);
    api.listChannels.mockResolvedValue([]);

    render(<App />);

    await userEvent.type(screen.getByLabelText(/email/i), 'a@dw.com');
    await userEvent.type(screen.getByLabelText(/senha/i), 'secret123');
    await userEvent.click(screen.getByRole('button', { name: /entrar/i }));

    expect(await screen.findByText(/DW Telecom - Atendimento/)).toBeInTheDocument();
  });

  test('an already-authenticated non-admin visiting /admin/channels is redirected to the dashboard', async () => {
    localStorage.setItem('dw_token', 'tok-123');
    localStorage.setItem('dw_agent', JSON.stringify({ id: 'agent-1', email: 'a@dw.com', role: 'agent' }));
    window.history.pushState({}, '', '/admin/channels');
    api.getQueue.mockResolvedValue([]);
    api.getMyConversations.mockResolvedValue([]);
    api.listChannels.mockResolvedValue([]);

    render(<App />);

    await waitFor(() => expect(screen.getByText(/DW Telecom - Atendimento/)).toBeInTheDocument());
    expect(screen.queryByText(/Administração de Canais/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/App.test.jsx`
Expected: FAIL — `App` currently renders only a static loading placeholder, not a router.

- [ ] **Step 3: Write the implementation**

Replace `frontend/src/App.jsx` with:

```jsx
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { SocketProvider } from './contexts/SocketContext';
import ProtectedRoute from './components/ProtectedRoute';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import AdminChannelsPage from './pages/AdminChannelsPage';

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <SocketProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <DashboardPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/channels"
              element={
                <ProtectedRoute requireAdmin>
                  <AdminChannelsPage />
                </ProtectedRoute>
              }
            />
          </Routes>
        </SocketProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/App.test.jsx`
Expected: PASS

- [ ] **Step 5: Document the production API URL configuration**

Create `frontend/.env.production.example`:

```
VITE_API_BASE_URL=https://dw-whatsapp-backend.onrender.com
```

This documents that a Render Static Site deploy needs `VITE_API_BASE_URL` set (Vite bakes `import.meta.env.VITE_*` values in at build time) to point at the deployed backend instead of the `http://localhost:3000` default. This file is a template only — it is not read by Vite itself (only a real `.env.production` or the hosting platform's build-time environment variables are).

- [ ] **Step 6: Run the full frontend suite one more time**

Run: `cd frontend && npx vitest run`
Expected: PASS, every frontend test file.

- [ ] **Step 7: Run a production build**

Run: `cd frontend && npm run build`
Expected: succeeds.

- [ ] **Step 8: Run the full backend suite once more to confirm no cross-contamination**

Run: `npm test` (from the repository root, not `frontend/`)
Expected: PASS — the backend's Jest suite never touches `frontend/`, this is a final sanity check that nothing in this plan's backend tasks (1-2) regressed.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/App.jsx frontend/src/App.test.jsx frontend/.env.production.example
git commit -m "feat: wire routing and finish the attendant frontend"
```

---

## Self-Review

**Spec coverage:**
- "Tela de login" → Task 4 (`LoginPage`).
- "Painel principal... fila de espera e conversas atribuídas visíveis ao mesmo tempo" → Task 6 (hooks/lists) + Task 9 (`DashboardPage` laying them out side by side).
- "Visualização de conversa com histórico e envio de mensagens, ações de assumir/transferir/fechar" → Task 7 (`ConversationView`, `MessageInput`) + Task 8 (`TransferModal`).
- "Indicador de status de canal (visível a admins)" → Task 9 (`ChannelStatusBanner`).
- "Tela de administração de canais" → Task 10 (`AdminChannelsPage`, `CreateChannelForm`, `QrCodeView`).
- "Endpoint para listar atendentes" → Task 1 (`GET /api/agents`), consumed by Task 8's `useAgents`.
- "Allowlist real de CORS" → Task 2 (`getAllowedOrigins`, wired into both Express and Socket.io).
- Context-based state management (no external state library), hooks reacting to socket events without re-polling, no optimistic updates except the documented message-send exception → threaded through Tasks 6-7 and called out explicitly in Global Constraints.
- Hospedagem no Render Static Site → Task 11's `.env.production.example` documents the `VITE_API_BASE_URL` build-time variable a Render Static Site deploy needs.

**Placeholder scan:** No "TBD"/"TODO"/"add appropriate error handling" — every step has complete, runnable code, and every test has real assertions matching the implementation that follows it.

**Type consistency:** `Conversation` shape (`{id, contactId, channelId, status, assignedAgentId, createdAt, updatedAt, contactPhoneNumber, contactDisplayName}`) is used consistently from Task 6's hooks through Task 7's `ConversationView` and Task 9's `DashboardPage`. `Channel` shape (`{id, type, name, phoneNumber, status}`) is consistent from Task 9's `useChannels` through Task 10's `AdminChannelsPage`/`QrCodeView`. Socket event payload shapes (`{conversation}` for `queue:new`/`conversation:assigned`, `{conversationId}` for `queue:removed`/`conversation:removed`/`conversation:closed`, `{conversation, message}` for `message:new`, `{conversationId, message}` for `message:updated`) match the backend's actual emission call sites (`inbound-message.service.js`, `conversations.routes.js`, `outbound-worker.js`) and are used identically across Tasks 6-7. `useAuth()`'s `agent` shape (`{id, email, role}`) matches `POST /api/auth/login`'s response and is used consistently in Tasks 4, 7, 8, 9.
