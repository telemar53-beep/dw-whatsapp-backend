# Presence Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any attendant see, live, which teammates are currently online.

**Architecture:** A new in-memory presence-tracking module hooks into the existing Socket.io connect/disconnect lifecycle to broadcast `presence:online`/`presence:offline` events; the already-open `GET /api/agents` route gains a live `online` snapshot field; a new frontend hook and sidebar panel render it, updating from the socket events exactly like `useQueue` already does for the conversation queue.

**Tech Stack:** Node.js/Express, Socket.io (existing), React (existing hooks/context pattern, no new libraries).

**Spec:** `docs/superpowers/specs/2026-09-06-presence-indicator-design.md`

## Global Constraints

- No new database tables or migrations — presence lives only in an in-memory `Map` inside the running Node process, for the life of that process.
- Two new Socket.io events: `presence:online` and `presence:offline`, each with payload `{ agentId }`, broadcast to every connected client via the existing `broadcast()` function in `src/realtime/socket-server.js` — fired only on a true 0→1 (online) or 1→0 (offline) transition in an agent's connection count, never on every connect/disconnect (an agent with two open tabs must not flicker offline when one tab closes).
- `GET /api/agents` stays `requireAuth`-only (no role restriction) — unchanged from today.
- Frontend data flow follows the same pattern already used by `useQueue`: fetch the initial state once via REST, then update only from Socket.io events — no polling anywhere.
- Deactivated agents (`active: false`) are not filtered out of the roster or the new panel in this plan — they simply can never hold a live connection, so they always show offline. This matches `TransferModal`'s existing behavior of listing every agent regardless of `active`.
- The presence panel shows every agent including the currently logged-in one, with no special-casing — it doubles as a visual confirmation that the viewer's own connection is live.

---

### Task 1: Presence tracking module + Socket.io wiring

**Files:**
- Create: `src/realtime/presence.js`
- Create: `src/realtime/presence.test.js`
- Modify: `src/realtime/socket-server.js:1-22` (the `require`s at the top and the `initSocketServer` function)
- Modify: `src/realtime/socket-server.test.js` (add a `resetPresence()` import + call, and 3 new tests)

**Interfaces:**
- Produces: `markAgentOnline(agentId)` → `boolean` (true only on a real 0→1 transition), `markAgentOffline(agentId)` → `boolean` (true only on a real 1→0 transition), `isAgentOnline(agentId)` → `boolean`, `getOnlineAgentIds()` → `string[]`, `resetPresence()` → `void` (test-only utility that clears all tracked state). Task 2 consumes `isAgentOnline`. Task 3 consumes the `presence:online`/`presence:offline` socket events this task starts broadcasting.

- [ ] **Step 1: Write the failing tests for the presence module**

Create `src/realtime/presence.test.js`:

```js
const {
  markAgentOnline,
  markAgentOffline,
  isAgentOnline,
  getOnlineAgentIds,
  resetPresence,
} = require('./presence');

describe('presence', () => {
  beforeEach(() => {
    resetPresence();
  });

  test('markAgentOnline returns true on the first connection for an agent', () => {
    expect(markAgentOnline('agent-1')).toBe(true);
  });

  test('markAgentOnline returns false for a second simultaneous connection from the same agent', () => {
    markAgentOnline('agent-1');
    expect(markAgentOnline('agent-1')).toBe(false);
  });

  test('markAgentOffline returns true when the last connection for an agent closes', () => {
    markAgentOnline('agent-1');
    expect(markAgentOffline('agent-1')).toBe(true);
  });

  test('markAgentOffline returns false while other connections for the same agent remain open', () => {
    markAgentOnline('agent-1');
    markAgentOnline('agent-1');
    expect(markAgentOffline('agent-1')).toBe(false);
  });

  test('isAgentOnline reflects the current connection count', () => {
    expect(isAgentOnline('agent-1')).toBe(false);
    markAgentOnline('agent-1');
    expect(isAgentOnline('agent-1')).toBe(true);
    markAgentOffline('agent-1');
    expect(isAgentOnline('agent-1')).toBe(false);
  });

  test('getOnlineAgentIds lists every agent with at least one open connection', () => {
    markAgentOnline('agent-1');
    markAgentOnline('agent-2');
    expect(getOnlineAgentIds().sort()).toEqual(['agent-1', 'agent-2']);
    markAgentOffline('agent-1');
    expect(getOnlineAgentIds()).toEqual(['agent-2']);
  });

  test('markAgentOffline is a safe no-op for an agent with no tracked connections', () => {
    expect(markAgentOffline('agent-unknown')).toBe(false);
    expect(isAgentOnline('agent-unknown')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx dotenv -e .env.test -o -- jest src/realtime/presence.test.js`
Expected: FAIL with "Cannot find module './presence'"

- [ ] **Step 3: Implement the presence module**

Create `src/realtime/presence.js`:

```js
const onlineCounts = new Map();

function markAgentOnline(agentId) {
  const count = onlineCounts.get(agentId) || 0;
  onlineCounts.set(agentId, count + 1);
  return count === 0;
}

function markAgentOffline(agentId) {
  const count = onlineCounts.get(agentId) || 0;
  if (count <= 1) {
    onlineCounts.delete(agentId);
    return count === 1;
  }
  onlineCounts.set(agentId, count - 1);
  return false;
}

function isAgentOnline(agentId) {
  return onlineCounts.has(agentId);
}

function getOnlineAgentIds() {
  return Array.from(onlineCounts.keys());
}

function resetPresence() {
  onlineCounts.clear();
}

module.exports = { markAgentOnline, markAgentOffline, isAgentOnline, getOnlineAgentIds, resetPresence };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx dotenv -e .env.test -o -- jest src/realtime/presence.test.js`
Expected: PASS, 7/7 tests

- [ ] **Step 5: Commit**

```bash
git add src/realtime/presence.js src/realtime/presence.test.js
git commit -m "feat: add in-memory presence tracking module"
```

- [ ] **Step 6: Write the failing tests for the Socket.io wiring**

`src/realtime/socket-server.test.js` currently starts like this:

```js
const http = require('http');
const jwt = require('jsonwebtoken');
const { io: ioClient } = require('socket.io-client');
const { initSocketServer, emitToAgent, broadcast, closeSocketServer } = require('./socket-server');

describe('socket server', () => {
  let httpServer;
  let port;

  beforeEach((done) => {
    httpServer = http.createServer();
    initSocketServer(httpServer);
    httpServer.listen(0, () => {
      port = httpServer.address().port;
      done();
    });
  });
```

Change the top of the file to also import and reset presence state before each test:

```js
const http = require('http');
const jwt = require('jsonwebtoken');
const { io: ioClient } = require('socket.io-client');
const { initSocketServer, emitToAgent, broadcast, closeSocketServer } = require('./socket-server');
const { resetPresence } = require('./presence');

describe('socket server', () => {
  let httpServer;
  let port;

  beforeEach((done) => {
    resetPresence();
    httpServer = http.createServer();
    initSocketServer(httpServer);
    httpServer.listen(0, () => {
      port = httpServer.address().port;
      done();
    });
  });
```

Then add these 3 new tests directly after the existing `'broadcast delivers to every connected client'` test, immediately before the closing `});` of the `describe('socket server', ...)` block (that `describe` block ends right before the separate `describe('socket server module-level guards', ...)` block starts):

```js
  test('connecting broadcasts presence:online to already-connected clients', (done) => {
    const tokenA = jwt.sign({ agentId: 'agent-presence-a', role: 'agent' }, process.env.JWT_SECRET);
    const tokenB = jwt.sign({ agentId: 'agent-presence-b', role: 'agent' }, process.env.JWT_SECRET);
    const clientA = connect(tokenA);
    let clientB;
    clientA.on('connect', () => {
      clientA.on('presence:online', (payload) => {
        expect(payload).toEqual({ agentId: 'agent-presence-b' });
        clientA.close();
        clientB.close();
        done();
      });
      clientB = connect(tokenB);
    });
  });

  test('disconnecting broadcasts presence:offline once the last connection for that agent closes', (done) => {
    const tokenA = jwt.sign({ agentId: 'agent-presence-c', role: 'agent' }, process.env.JWT_SECRET);
    const tokenB = jwt.sign({ agentId: 'agent-presence-d', role: 'agent' }, process.env.JWT_SECRET);
    const clientA = connect(tokenA);
    const clientB = connect(tokenB);
    let connectedCount = 0;

    function onBothConnected() {
      connectedCount += 1;
      if (connectedCount !== 2) return;
      clientA.on('presence:offline', (payload) => {
        expect(payload).toEqual({ agentId: 'agent-presence-d' });
        clientA.close();
        done();
      });
      clientB.close();
    }

    clientA.on('connect', onBothConnected);
    clientB.on('connect', onBothConnected);
  });

  test('a second connection from the same agent does not trigger a duplicate presence:online', (done) => {
    const tokenA = jwt.sign({ agentId: 'agent-presence-e', role: 'agent' }, process.env.JWT_SECRET);
    const tokenSame = jwt.sign({ agentId: 'agent-presence-f', role: 'agent' }, process.env.JWT_SECRET);
    const clientA = connect(tokenA);
    clientA.on('connect', () => {
      const onlineEvents = [];
      clientA.on('presence:online', (payload) => onlineEvents.push(payload));
      const firstTab = connect(tokenSame);
      firstTab.on('connect', () => {
        const secondTab = connect(tokenSame);
        secondTab.on('connect', () => {
          setTimeout(() => {
            expect(onlineEvents).toEqual([{ agentId: 'agent-presence-f' }]);
            clientA.close();
            firstTab.close();
            secondTab.close();
            done();
          }, 100);
        });
      });
    });
  });
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `npx dotenv -e .env.test -o -- jest src/realtime/socket-server.test.js`
Expected: FAIL — the 3 new tests time out waiting for `presence:online`/`presence:offline`, which nothing emits yet.

- [ ] **Step 8: Wire presence into the Socket.io connection lifecycle**

`src/realtime/socket-server.js` currently reads:

```js
const { Server } = require('socket.io');
const { verifyToken } = require('../auth/auth.service');
const { getAllowedOrigins } = require('../config/cors-origins');

let io;

function initSocketServer(httpServer) {
  io = new Server(httpServer, { cors: { origin: getAllowedOrigins() } });
  io.use((socket, next) => {
    try {
      const payload = verifyToken(socket.handshake.auth && socket.handshake.auth.token);
      socket.agent = payload;
      next();
    } catch (err) {
      next(new Error('Unauthorized'));
    }
  });
  io.on('connection', (socket) => {
    socket.join(`agent:${socket.agent.agentId}`);
  });
  return io;
}
```

Replace it with:

```js
const { Server } = require('socket.io');
const { verifyToken } = require('../auth/auth.service');
const { getAllowedOrigins } = require('../config/cors-origins');
const { markAgentOnline, markAgentOffline } = require('./presence');

let io;

function initSocketServer(httpServer) {
  io = new Server(httpServer, { cors: { origin: getAllowedOrigins() } });
  io.use((socket, next) => {
    try {
      const payload = verifyToken(socket.handshake.auth && socket.handshake.auth.token);
      socket.agent = payload;
      next();
    } catch (err) {
      next(new Error('Unauthorized'));
    }
  });
  io.on('connection', (socket) => {
    socket.join(`agent:${socket.agent.agentId}`);
    if (markAgentOnline(socket.agent.agentId)) {
      broadcast('presence:online', { agentId: socket.agent.agentId });
    }
    socket.on('disconnect', () => {
      if (markAgentOffline(socket.agent.agentId)) {
        broadcast('presence:offline', { agentId: socket.agent.agentId });
      }
    });
  });
  return io;
}
```

(`broadcast` is declared later in the same file as a function declaration, which is hoisted — calling it here, before its textual definition, works exactly the same way `emitToAgent`/`broadcast` are already called from other modules today.)

- [ ] **Step 9: Run the test to verify it passes**

Run: `npx dotenv -e .env.test -o -- jest src/realtime/socket-server.test.js`
Expected: PASS, all tests in the file green (the 3 pre-existing plus the 3 new ones)

- [ ] **Step 10: Commit**

```bash
git add src/realtime/socket-server.js src/realtime/socket-server.test.js
git commit -m "feat: broadcast presence:online/offline on socket connect and disconnect"
```

---

### Task 2: Expose live presence on `GET /api/agents`

**Files:**
- Modify: `src/api/agents.routes.js` (whole file, 13 lines)
- Modify: `src/api/agents.routes.test.js` (whole file, 45 lines)

**Interfaces:**
- Consumes: `isAgentOnline(agentId)` from `src/realtime/presence.js` (Task 1). `listAgents()` from `src/agents/agent.repository.js` already returns `{ id, name, email, role, active, createdAt, sectors }` per agent — unchanged by this task.
- Produces: `GET /api/agents` now returns `[{ id, name, email, role, online }, ...]` (added `name` and `online`; `active`/`sectors`/`createdAt` stay excluded from this response, same as today). Task 3's `TeamPanel`/`usePresence` consume this shape.

- [ ] **Step 1: Write the failing test**

Replace the full contents of `src/api/agents.routes.test.js` (currently 45 lines) with:

```js
jest.mock('../agents/agent.repository');
jest.mock('../realtime/presence');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const { listAgents } = require('../agents/agent.repository');
const { isAgentOnline } = require('../realtime/presence');
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

  test('returns the agent list with name and live online status for any authenticated agent', async () => {
    listAgents.mockResolvedValue([
      { id: 'agent-1', name: 'Ana', email: 'a@dw.com', role: 'agent', createdAt: new Date() },
      { id: 'agent-2', name: 'Bruno', email: 'b@dw.com', role: 'admin', createdAt: new Date() },
    ]);
    isAgentOnline.mockImplementation((id) => id === 'agent-1');

    const res = await request(buildApp())
      .get('/api/agents')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: 'agent-1', name: 'Ana', email: 'a@dw.com', role: 'agent', online: true },
      { id: 'agent-2', name: 'Bruno', email: 'b@dw.com', role: 'admin', online: false },
    ]);
  });

  test('returns 401 without a token', async () => {
    const res = await request(buildApp()).get('/api/agents');
    expect(res.status).toBe(401);
    expect(listAgents).not.toHaveBeenCalled();
    expect(isAgentOnline).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx dotenv -e .env.test -o -- jest src/api/agents.routes.test.js`
Expected: FAIL — the first test's `res.body` is missing `name` and `online` (current route only returns `{ id, email, role }`)

- [ ] **Step 3: Update the route**

Replace the full contents of `src/api/agents.routes.js` (currently 13 lines) with:

```js
const express = require('express');
const { requireAuth } = require('../auth/auth.middleware');
const { listAgents } = require('../agents/agent.repository');
const { isAgentOnline } = require('../realtime/presence');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  const agents = await listAgents();
  res.json(
    agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      email: agent.email,
      role: agent.role,
      online: isAgentOnline(agent.id),
    }))
  );
});

module.exports = router;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx dotenv -e .env.test -o -- jest src/api/agents.routes.test.js`
Expected: PASS, 2/2 tests

- [ ] **Step 5: Commit**

```bash
git add src/api/agents.routes.js src/api/agents.routes.test.js
git commit -m "feat: include name and live online status in GET /api/agents"
```

---

### Task 3: Frontend presence hook + team panel

**Files:**
- Create: `frontend/src/hooks/usePresence.js`
- Create: `frontend/src/hooks/usePresence.test.jsx`
- Create: `frontend/src/components/TeamPanel.jsx`
- Create: `frontend/src/components/TeamPanel.test.jsx`
- Modify: `frontend/src/pages/DashboardPage.jsx:1-12` (imports) and `:65-66` (the `<aside>` contents)
- Modify: `frontend/src/pages/DashboardPage.test.jsx:13-19` (the `vi.mock` block) and add one new test at the end of the `describe('DashboardPage', ...)` block

**Interfaces:**
- Consumes: `GET /api/agents` now returns `{ id, name, email, role, online }` per agent (Task 2) via the existing `listAgents(token)` in `frontend/src/services/api.js` (unchanged) and the existing `useAgents()` hook in `frontend/src/hooks/useAgents.js` (unchanged — it already just returns whatever the API sends). Consumes the `presence:online`/`presence:offline` socket events from Task 1, and the existing `useSocket()` from `frontend/src/contexts/SocketContext.jsx`. Also consumes the existing `useAuth()` from `frontend/src/contexts/AuthContext.jsx` (already used elsewhere in this project) — see the note below on why.
- Produces: `usePresence(agents)` → a `Set` of online agent ids, for any future consumer. `TeamPanel` (no props — it calls `useAgents()` and `usePresence()` itself, same self-contained pattern as `TransferModal`).

**Note carried from Task 1's review (ruling, not optional):** Task 1's implementer found that the server cannot broadcast a `presence:online` event back to the very socket that just triggered it — `io.emit`-based broadcast (what the plan originally specified) caused a connecting client to spuriously receive its own "online" event due to Socket.io's internal packet ordering, so Task 1 correctly switched to `socket.broadcast.emit` (excludes the sender) for `presence:online` specifically. The consequence: **a viewer never receives their own `presence:online` event.** If `GET /api/agents`'s initial snapshot happens to be fetched before that viewer's own socket handshake completes server-side, their own row in `TeamPanel` would show as offline and — since no event will ever arrive to correct it — would stay wrong until a full page reload. `usePresence` must defend against this: it always treats the current authenticated agent (from `useAuth()`) as online, regardless of what the initial snapshot or any socket event says. This is why `useAuth()` is a new dependency of this hook.

- [ ] **Step 1: Write the failing test for `usePresence`**

Create `frontend/src/hooks/usePresence.test.jsx`:

```jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePresence } from './usePresence';
import { useSocket } from '../contexts/SocketContext';
import { useAuth } from '../contexts/AuthContext';

vi.mock('../contexts/SocketContext');
vi.mock('../contexts/AuthContext');

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
  useSocket.mockReturnValue(fakeSocket);
  useAuth.mockReturnValue({ agent: { id: 'self-1' } });
});

describe('usePresence', () => {
  test('seeds the online set from the agents list online field, plus the current agent', () => {
    const agents = [
      { id: 'a1', online: true },
      { id: 'a2', online: false },
    ];
    const { result } = renderHook(() => usePresence(agents));
    expect(result.current).toEqual(new Set(['a1', 'self-1']));
  });

  test('always includes the current agent as online, even if the initial snapshot missed it', () => {
    const agents = [{ id: 'self-1', online: false }];
    const { result } = renderHook(() => usePresence(agents));
    expect(result.current.has('self-1')).toBe(true);
  });

  test('presence:online adds the agent to the online set', () => {
    const agents = [{ id: 'a1', online: false }];
    const { result } = renderHook(() => usePresence(agents));
    expect(result.current).toEqual(new Set(['self-1']));

    act(() => {
      fakeSocket.trigger('presence:online', { agentId: 'a1' });
    });

    expect(result.current).toEqual(new Set(['self-1', 'a1']));
  });

  test('presence:offline removes the agent from the online set', () => {
    const agents = [{ id: 'a1', online: true }];
    const { result } = renderHook(() => usePresence(agents));
    expect(result.current).toEqual(new Set(['a1', 'self-1']));

    act(() => {
      fakeSocket.trigger('presence:offline', { agentId: 'a1' });
    });

    expect(result.current).toEqual(new Set(['self-1']));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `frontend/`): `npx vitest run src/hooks/usePresence.test.jsx`
Expected: FAIL with "Failed to resolve import './usePresence'"

- [ ] **Step 3: Implement `usePresence`**

Create `frontend/src/hooks/usePresence.js`:

```js
import { useState, useEffect } from 'react';
import { useSocket } from '../contexts/SocketContext';
import { useAuth } from '../contexts/AuthContext';

export function usePresence(agents) {
  const socket = useSocket();
  const { agent } = useAuth();
  const [onlineIds, setOnlineIds] = useState(() => new Set());

  useEffect(() => {
    const seeded = new Set(agents.filter((a) => a.online).map((a) => a.id));
    // The server never broadcasts a socket's own presence:online event back to
    // itself (see socket-server.js), so the initial snapshot can race and miss
    // the current agent — always assume the viewer is online.
    if (agent) {
      seeded.add(agent.id);
    }
    setOnlineIds(seeded);
  }, [agents, agent]);

  useEffect(() => {
    if (!socket) return undefined;

    function onOnline({ agentId }) {
      setOnlineIds((prev) => new Set(prev).add(agentId));
    }

    function onOffline({ agentId }) {
      setOnlineIds((prev) => {
        const next = new Set(prev);
        next.delete(agentId);
        return next;
      });
    }

    socket.on('presence:online', onOnline);
    socket.on('presence:offline', onOffline);
    return () => {
      socket.off('presence:online', onOnline);
      socket.off('presence:offline', onOffline);
    };
  }, [socket]);

  return onlineIds;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run (from `frontend/`): `npx vitest run src/hooks/usePresence.test.jsx`
Expected: PASS, 4/4 tests

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/usePresence.js frontend/src/hooks/usePresence.test.jsx
git commit -m "feat: add usePresence hook for live agent online status"
```

- [ ] **Step 6: Write the failing test for `TeamPanel`**

Create `frontend/src/components/TeamPanel.test.jsx`:

```jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import TeamPanel from './TeamPanel';
import { useAgents } from '../hooks/useAgents';
import { usePresence } from '../hooks/usePresence';

vi.mock('../hooks/useAgents');
vi.mock('../hooks/usePresence');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TeamPanel', () => {
  test('shows a message when there are no agents', () => {
    useAgents.mockReturnValue([]);
    usePresence.mockReturnValue(new Set());
    render(<TeamPanel />);
    expect(screen.getByText(/nenhum atendente cadastrado/i)).toBeInTheDocument();
  });

  test('lists online agents before offline agents, alphabetically within each group', () => {
    useAgents.mockReturnValue([
      { id: 'a1', name: 'Carlos' },
      { id: 'a2', name: 'Ana' },
      { id: 'a3', name: 'Bruno' },
    ]);
    usePresence.mockReturnValue(new Set(['a1', 'a2']));
    render(<TeamPanel />);

    const items = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toEqual(['Ana', 'Carlos', 'Bruno']);
  });

  test('shows an online dot for a connected agent and an offline dot for a disconnected one', () => {
    useAgents.mockReturnValue([
      { id: 'a1', name: 'Ana' },
      { id: 'a2', name: 'Bruno' },
    ]);
    usePresence.mockReturnValue(new Set(['a1']));
    render(<TeamPanel />);

    expect(screen.getByTitle('Online')).toBeInTheDocument();
    expect(screen.getByTitle('Offline')).toBeInTheDocument();
  });
});
```

- [ ] **Step 7: Run the test to verify it fails**

Run (from `frontend/`): `npx vitest run src/components/TeamPanel.test.jsx`
Expected: FAIL with "Failed to resolve import './TeamPanel'"

- [ ] **Step 8: Implement `TeamPanel`**

Create `frontend/src/components/TeamPanel.jsx`:

```jsx
import { useAgents } from '../hooks/useAgents';
import { usePresence } from '../hooks/usePresence';

function sortAgents(agents, onlineIds) {
  return [...agents].sort((a, b) => {
    const aOnline = onlineIds.has(a.id);
    const bOnline = onlineIds.has(b.id);
    if (aOnline !== bOnline) return aOnline ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function TeamPanel() {
  const agents = useAgents();
  const onlineIds = usePresence(agents);
  const sorted = sortAgents(agents, onlineIds);

  return (
    <div>
      <h2 className="mb-2 font-semibold text-gray-700">Equipe</h2>
      {sorted.length === 0 ? (
        <p className="text-sm text-gray-400">Nenhum atendente cadastrado.</p>
      ) : (
        <ul className="space-y-1">
          {sorted.map((agent) => (
            <li key={agent.id} className="flex items-center gap-2 text-sm text-gray-700">
              <span
                title={onlineIds.has(agent.id) ? 'Online' : 'Offline'}
                className={`inline-block h-2 w-2 rounded-full ${
                  onlineIds.has(agent.id) ? 'bg-green-500' : 'bg-gray-300'
                }`}
              />
              {agent.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default TeamPanel;
```

- [ ] **Step 9: Run the test to verify it passes**

Run (from `frontend/`): `npx vitest run src/components/TeamPanel.test.jsx`
Expected: PASS, 3/3 tests

- [ ] **Step 10: Commit**

```bash
git add frontend/src/components/TeamPanel.jsx frontend/src/components/TeamPanel.test.jsx
git commit -m "feat: add TeamPanel component showing agent online status"
```

- [ ] **Step 11: Write the failing test for `DashboardPage`**

`frontend/src/pages/DashboardPage.test.jsx` currently has this `vi.mock` block (lines 13-19):

```js
vi.mock('../contexts/AuthContext');
vi.mock('../hooks/useQueue');
vi.mock('../hooks/useMyConversations');
vi.mock('../hooks/useChannels');
vi.mock('../hooks/useAgents', () => ({ useAgents: () => [] }));
vi.mock('../hooks/useConversationMessages');
vi.mock('../hooks/useQuickReplies');
```

Change it to also mock `usePresence` (`TeamPanel` will call it once inserted into `DashboardPage`, the same "mock the hook a shared component starts calling" step this codebase already followed for `useQuickReplies`):

```js
vi.mock('../contexts/AuthContext');
vi.mock('../hooks/useQueue');
vi.mock('../hooks/useMyConversations');
vi.mock('../hooks/useChannels');
vi.mock('../hooks/useAgents', () => ({ useAgents: () => [] }));
vi.mock('../hooks/usePresence', () => ({ usePresence: () => new Set() }));
vi.mock('../hooks/useConversationMessages');
vi.mock('../hooks/useQuickReplies');
```

Then add this test at the end of the `describe('DashboardPage', ...)` block, right after the existing `'shows a Métricas link for any attendant'` test (before the block's closing `});`):

```js
  test('renders the team panel', () => {
    useQueue.mockReturnValue([]);
    useMyConversations.mockReturnValue([]);
    renderDashboard();
    expect(screen.getByText('Equipe')).toBeInTheDocument();
    expect(screen.getByText(/nenhum atendente cadastrado/i)).toBeInTheDocument();
  });
```

- [ ] **Step 12: Run the test to verify it fails**

Run (from `frontend/`): `npx vitest run src/pages/DashboardPage.test.jsx`
Expected: FAIL — the new test can't find "Equipe" since `TeamPanel` isn't rendered by `DashboardPage` yet.

- [ ] **Step 13: Wire `TeamPanel` into `DashboardPage`**

`frontend/src/pages/DashboardPage.jsx` currently imports (lines 1-13):

```jsx
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useQueue } from '../hooks/useQueue';
import { useMyConversations } from '../hooks/useMyConversations';
import QueueList from '../components/QueueList';
import MyConversationsList from '../components/MyConversationsList';
import ConversationView from '../components/ConversationView';
import TransferModal from '../components/TransferModal';
import ChannelStatusBanner from '../components/ChannelStatusBanner';
import ChangePasswordModal from '../components/ChangePasswordModal';
import StartConversationModal from '../components/StartConversationModal';
```

Add one import line, right after `StartConversationModal`'s:

```jsx
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useQueue } from '../hooks/useQueue';
import { useMyConversations } from '../hooks/useMyConversations';
import QueueList from '../components/QueueList';
import MyConversationsList from '../components/MyConversationsList';
import ConversationView from '../components/ConversationView';
import TransferModal from '../components/TransferModal';
import ChannelStatusBanner from '../components/ChannelStatusBanner';
import ChangePasswordModal from '../components/ChangePasswordModal';
import StartConversationModal from '../components/StartConversationModal';
import TeamPanel from '../components/TeamPanel';
```

Then, inside the `<aside>` (currently lines 57-66):

```jsx
        <aside className="w-64 space-y-4 overflow-y-auto border-r border-gray-200 p-3">
          <button
            onClick={() => setStartingConversation(true)}
            className="w-full rounded bg-green-600 px-3 py-2 text-sm text-white"
          >
            Iniciar conversa
          </button>
          <QueueList conversations={queue} onSelect={setSelectedId} />
          <MyConversationsList conversations={myConversations} onSelect={setSelectedId} />
        </aside>
```

Add `<TeamPanel />` right after `<MyConversationsList .../>`:

```jsx
        <aside className="w-64 space-y-4 overflow-y-auto border-r border-gray-200 p-3">
          <button
            onClick={() => setStartingConversation(true)}
            className="w-full rounded bg-green-600 px-3 py-2 text-sm text-white"
          >
            Iniciar conversa
          </button>
          <QueueList conversations={queue} onSelect={setSelectedId} />
          <MyConversationsList conversations={myConversations} onSelect={setSelectedId} />
          <TeamPanel />
        </aside>
```

- [ ] **Step 14: Run the test to verify it passes**

Run (from `frontend/`): `npx vitest run src/pages/DashboardPage.test.jsx`
Expected: PASS, all tests in the file green (the pre-existing ones plus the new one)

- [ ] **Step 15: Run the full frontend suite**

Run (from `frontend/`): `npm test`
Expected: PASS, all test files green

- [ ] **Step 16: Commit**

```bash
git add frontend/src/pages/DashboardPage.jsx frontend/src/pages/DashboardPage.test.jsx
git commit -m "feat: show the team presence panel on the dashboard"
```
