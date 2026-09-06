# Atendente iniciar conversa (somente Baileys) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an authenticated attendant start a brand-new conversation with a customer (by phone number) on a connected Baileys channel, with the conversation auto-assigned to whoever started it.

**Architecture:** One new backend route (`POST /api/conversations/start`) composes existing repository/queue/socket functions with no new tables. One new backend route (`GET /api/channels`) exposes a non-admin-safe channel list (the existing `GET /api/admin/channels` is admin-only, so it cannot back this feature). On the frontend, a new modal (`StartConversationModal`) collects channel/phone/message and a small addition to `DashboardPage` opens the created conversation immediately, without waiting for the Socket.io event that also arrives at nearly the same time.

**Tech Stack:** Node.js/Express, Jest + Supertest (backend), React 18 + Vitest + Testing Library (frontend). No new dependencies.

**Spec:** [docs/superpowers/specs/2026-09-06-attendant-initiated-conversations-design.md](../specs/2026-09-06-attendant-initiated-conversations-design.md)

## Global Constraints

- Scope is restricted to Baileys channels in this delivery. A Meta Cloud channel must be rejected with a clear 400 — Meta template support is a separate, future spec.
- No new database tables or columns. Every mutation reuses functions that already exist in `conversation.repository.js`, `contact.repository.js`, `channel.repository.js`, and `outbound-queue.js`.
- Phone number normalization is `phoneNumber.replace(/\D/g, '')` — the same digits-only format `baileys.manager.js`'s `sendTextMessage`/`sendMediaMessage` already assume when building the JID (`` `${toPhoneNumber}@s.whatsapp.net` ``).
- The new `GET /api/channels` route must be reachable by **any** authenticated agent (`requireAuth` only, no `requireRole('admin')`) — mirrors the existing `GET /api/agents` convention — and must return only the same non-sensitive fields `GET /api/admin/channels` already returns (`id`, `type`, `name`, `phoneNumber`, `status`), never `config`/`accessToken`.
- Every new/changed route follows the JSON error-body convention already used everywhere else in this codebase: `res.status(<code>).json({ error: '<message>' })`.

---

### Task 1: Backend — `GET /api/channels` (any authenticated agent)

**Files:**
- Create: `src/api/channels.routes.js`
- Create: `src/api/channels.routes.test.js`
- Modify: `src/server.js`

**Interfaces:**
- Consumes: `listChannels()` from `src/channels/channel.repository.js` (already exists, returns `[{id, type, name, phoneNumber, config, status, createdAt}]`).
- Produces: `GET /api/channels` — any authenticated agent, 200 with `[{id, type, name, phoneNumber, status}]` (no `config`). Mounted at `/api/channels` in `src/server.js`. Task 3 depends on this route existing.

- [ ] **Step 1: Write the failing tests**

Create `src/api/channels.routes.test.js`:

```js
jest.mock('../channels/channel.repository');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const { listChannels } = require('../channels/channel.repository');
const channelsRoutes = require('./channels.routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/channels', channelsRoutes);
  return app;
}

function tokenFor(agentId, role) {
  return jwt.sign({ agentId, role }, process.env.JWT_SECRET);
}

describe('GET /api/channels', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns the channel list for any authenticated agent, without config', async () => {
    listChannels.mockResolvedValue([
      {
        id: 'channel-1',
        type: 'baileys',
        name: 'Berg',
        phoneNumber: '5598985004187',
        config: { sessionPath: '/secret/path' },
        status: 'connected',
      },
    ]);

    const res = await request(buildApp())
      .get('/api/channels')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: 'channel-1', type: 'baileys', name: 'Berg', phoneNumber: '5598985004187', status: 'connected' },
    ]);
  });

  test('returns 401 without a token', async () => {
    const res = await request(buildApp()).get('/api/channels');
    expect(res.status).toBe(401);
    expect(listChannels).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/api/channels.routes.test.js`
Expected: FAIL — `Cannot find module './channels.routes'`.

- [ ] **Step 3: Implement the route**

Create `src/api/channels.routes.js`:

```js
const express = require('express');
const { requireAuth } = require('../auth/auth.middleware');
const { listChannels } = require('../channels/channel.repository');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  const channels = await listChannels();
  res.json(
    channels.map((channel) => ({
      id: channel.id,
      type: channel.type,
      name: channel.name,
      phoneNumber: channel.phoneNumber,
      status: channel.status,
    }))
  );
});

module.exports = router;
```

In `src/server.js`, add the require next to the other route requires:

```js
const conversationsRoutes = require('./api/conversations.routes');
const agentsRoutes = require('./api/agents.routes');
const channelsRoutes = require('./api/channels.routes');
```

And mount it next to `/api/agents`:

```js
app.use('/api/conversations', conversationsRoutes);
app.use('/api/agents', agentsRoutes);
app.use('/api/channels', channelsRoutes);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/api/channels.routes.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/api/channels.routes.js src/api/channels.routes.test.js src/server.js
git commit -m "Add GET /api/channels for any authenticated agent"
```

---

### Task 2: Backend — `POST /api/conversations/start`

**Files:**
- Modify: `src/api/conversations.routes.js`
- Modify: `src/api/conversations.routes.test.js`

**Interfaces:**
- Consumes: `findChannelById(id)` from `src/channels/channel.repository.js` (returns `{id, type, name, phoneNumber, config, status, createdAt}` or `null`); `findOrCreateContactByPhoneNumber(phoneNumber, displayName)` from `src/conversations/contact.repository.js` (returns `{id, phoneNumber, displayName, createdAt}`); `findOpenConversation(contactId, channelId)`, `createConversation(contactId, channelId)`, `claimConversation(conversationId, agentId)`, `getConversationWithContact(conversationId)` — all already imported or importable from `src/conversations/conversation.repository.js`; `enqueueOutboundMessage({conversationId, channelId, content, ...})` from `src/queue/outbound-queue.js` (already imported); `emitToAgent(agentId, event, payload)` from `src/realtime/socket-server.js` (already imported).
- Produces: `POST /api/conversations/start` — body `{channelId, phoneNumber, content}`, 201 with the same shape `getConversationWithContact` returns (`{id, contactId, channelId, status, assignedAgentId, createdAt, updatedAt, contactPhoneNumber, contactDisplayName}`). Task 3's `startConversation()` frontend function calls this route.

- [ ] **Step 1: Write the failing tests**

In `src/api/conversations.routes.test.js`, add two more `jest.mock` calls right after the existing ones at the top of the file (do not remove the existing mocks):

```js
jest.mock('../channels/channel.repository');
jest.mock('../conversations/contact.repository');
```

Add to the existing `require` block that pulls in mocked functions:

```js
const {
  listWaitingConversations,
  listConversationsByAgent,
  getConversationWithContact,
  claimConversation,
  transferConversation,
  closeConversation,
  listClosedConversationsByContact,
  findOpenConversation,
  createConversation,
} = require('../conversations/conversation.repository');
const { findOrCreateContactByPhoneNumber } = require('../conversations/contact.repository');
const { findChannelById } = require('../channels/channel.repository');
```

Append this new `describe` block at the end of the file, before the final closing of the file:

```js
describe('POST /api/conversations/start', () => {
  beforeEach(() => jest.clearAllMocks());

  const BAILEYS_CHANNEL = { id: 'channel-1', type: 'baileys', status: 'connected' };

  test('returns 400 when channelId, phoneNumber or content is missing', async () => {
    const res = await request(buildApp())
      .post('/api/conversations/start')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ phoneNumber: '5598999990000', content: 'Oi' });
    expect(res.status).toBe(400);
    expect(findChannelById).not.toHaveBeenCalled();
  });

  test('returns 404 when the channel does not exist', async () => {
    findChannelById.mockResolvedValue(null);
    const res = await request(buildApp())
      .post('/api/conversations/start')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ channelId: 'channel-1', phoneNumber: '5598999990000', content: 'Oi' });
    expect(res.status).toBe(404);
  });

  test('returns 400 when the channel is not a Baileys channel', async () => {
    findChannelById.mockResolvedValue({ id: 'channel-1', type: 'meta_cloud', status: 'connected' });
    const res = await request(buildApp())
      .post('/api/conversations/start')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ channelId: 'channel-1', phoneNumber: '5598999990000', content: 'Oi' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/baileys/i);
    expect(findOrCreateContactByPhoneNumber).not.toHaveBeenCalled();
  });

  test('returns 400 when the Baileys channel is not connected', async () => {
    findChannelById.mockResolvedValue({ id: 'channel-1', type: 'baileys', status: 'awaiting_qr' });
    const res = await request(buildApp())
      .post('/api/conversations/start')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ channelId: 'channel-1', phoneNumber: '5598999990000', content: 'Oi' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not connected/i);
  });

  test('returns 400 when the phone number has no digits after normalization', async () => {
    findChannelById.mockResolvedValue(BAILEYS_CHANNEL);
    const res = await request(buildApp())
      .post('/api/conversations/start')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ channelId: 'channel-1', phoneNumber: '+++', content: 'Oi' });
    expect(res.status).toBe(400);
    expect(findOrCreateContactByPhoneNumber).not.toHaveBeenCalled();
  });

  test('returns 409 when the contact already has an open conversation on this channel', async () => {
    findChannelById.mockResolvedValue(BAILEYS_CHANNEL);
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-1', phoneNumber: '5598999990000' });
    findOpenConversation.mockResolvedValue({ id: 'conv-existing' });
    const res = await request(buildApp())
      .post('/api/conversations/start')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ channelId: 'channel-1', phoneNumber: '(55) 98999-9000', content: 'Oi' });
    expect(res.status).toBe(409);
    expect(createConversation).not.toHaveBeenCalled();
  });

  test('creates, claims and enqueues the first message on the happy path', async () => {
    findChannelById.mockResolvedValue(BAILEYS_CHANNEL);
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-1', phoneNumber: '5598999990000' });
    findOpenConversation.mockResolvedValue(null);
    createConversation.mockResolvedValue({ id: CONVERSATION_ID, contactId: 'contact-1', channelId: 'channel-1' });
    claimConversation.mockResolvedValue({
      id: CONVERSATION_ID,
      contactId: 'contact-1',
      channelId: 'channel-1',
      assignedAgentId: 'agent-1',
    });
    getConversationWithContact.mockResolvedValue({
      id: CONVERSATION_ID,
      contactId: 'contact-1',
      channelId: 'channel-1',
      assignedAgentId: 'agent-1',
      contactPhoneNumber: '5598999990000',
      contactDisplayName: null,
    });

    const res = await request(buildApp())
      .post('/api/conversations/start')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ channelId: 'channel-1', phoneNumber: '(55) 98999-9000', content: 'Oi, tudo bem?' });

    expect(res.status).toBe(201);
    expect(findOrCreateContactByPhoneNumber).toHaveBeenCalledWith('5598999990000', null);
    expect(findOpenConversation).toHaveBeenCalledWith('contact-1', 'channel-1');
    expect(createConversation).toHaveBeenCalledWith('contact-1', 'channel-1');
    expect(claimConversation).toHaveBeenCalledWith(CONVERSATION_ID, 'agent-1');
    expect(enqueueOutboundMessage).toHaveBeenCalledWith({
      conversationId: CONVERSATION_ID,
      channelId: 'channel-1',
      content: 'Oi, tudo bem?',
    });
    expect(emitToAgent).toHaveBeenCalledWith('agent-1', 'conversation:assigned', {
      conversation: expect.objectContaining({ id: CONVERSATION_ID }),
    });
    expect(res.body).toEqual(expect.objectContaining({ id: CONVERSATION_ID, contactPhoneNumber: '5598999990000' }));
  });

  test('returns 401 without a token', async () => {
    const res = await request(buildApp())
      .post('/api/conversations/start')
      .send({ channelId: 'channel-1', phoneNumber: '5598999990000', content: 'Oi' });
    expect(res.status).toBe(401);
    expect(findChannelById).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/api/conversations.routes.test.js`
Expected: FAIL — `404` instead of the expected statuses (the route doesn't exist yet, so Express falls through with no matching handler and `router.use(requireAuth)` alone returns 404 from Express's default handler, or the assertions on mocked functions fail because the route was never reached).

- [ ] **Step 3: Implement the route**

In `src/api/conversations.routes.js`, update the top imports:

```js
const {
  listWaitingConversations,
  listConversationsByAgent,
  getConversationWithContact,
  claimConversation,
  transferConversation,
  closeConversation,
  listClosedConversationsByContact,
  findOpenConversation,
  createConversation,
} = require('../conversations/conversation.repository');
const { findOrCreateContactByPhoneNumber } = require('../conversations/contact.repository');
const { findChannelById } = require('../channels/channel.repository');
const { listMessagesByConversation } = require('../conversations/message.repository');
const { enqueueOutboundMessage } = require('../queue/outbound-queue');
const { emitToAgent, broadcast } = require('../realtime/socket-server');
const { saveMediaFile, extensionForMimeType, messageTypeForMimeType } = require('../media/media-storage');
```

Add the new route right after the `/contacts/:contactId/history` route and before `/:id/messages`:

```js
router.post('/start', async (req, res) => {
  const { channelId, phoneNumber, content } = req.body || {};
  if (!channelId || !phoneNumber || !content) {
    return res.status(400).json({ error: 'channelId, phoneNumber and content are required' });
  }

  const channel = await findChannelById(channelId);
  if (!channel) {
    return res.status(404).json({ error: 'Channel not found' });
  }
  if (channel.type !== 'baileys') {
    return res.status(400).json({ error: 'Starting a conversation is only supported for Baileys channels' });
  }
  if (channel.status !== 'connected') {
    return res.status(400).json({ error: 'This channel is not connected' });
  }

  const normalizedPhoneNumber = phoneNumber.replace(/\D/g, '');
  if (!normalizedPhoneNumber) {
    return res.status(400).json({ error: 'A valid phoneNumber is required' });
  }

  const contact = await findOrCreateContactByPhoneNumber(normalizedPhoneNumber, null);

  const existing = await findOpenConversation(contact.id, channel.id);
  if (existing) {
    return res.status(409).json({ error: 'There is already an open conversation with this contact on this channel' });
  }

  const conversation = await createConversation(contact.id, channel.id);
  const claimed = await claimConversation(conversation.id, req.agent.agentId);
  if (!claimed) {
    throw new Error('Failed to claim newly created conversation');
  }
  await enqueueOutboundMessage({ conversationId: claimed.id, channelId: channel.id, content });

  const conversationWithContact = await getConversationWithContact(claimed.id);
  emitToAgent(req.agent.agentId, 'conversation:assigned', { conversation: conversationWithContact });

  res.status(201).json(conversationWithContact);
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/api/conversations.routes.test.js`
Expected: PASS (all existing tests plus the 7 new ones in `POST /api/conversations/start`).

- [ ] **Step 5: Commit**

```bash
git add src/api/conversations.routes.js src/api/conversations.routes.test.js
git commit -m "Add POST /api/conversations/start for Baileys-only attendant-initiated conversations"
```

---

### Task 3: Frontend — `services/api.js` additions + `StartConversationModal`

**Files:**
- Modify: `frontend/src/services/api.js`
- Modify: `frontend/src/services/api.test.js`
- Create: `frontend/src/components/StartConversationModal.jsx`
- Create: `frontend/src/components/StartConversationModal.test.jsx`

**Interfaces:**
- Consumes: `apiFetch` (already in `api.js`); `useAuth()` from `frontend/src/contexts/AuthContext.jsx` (already exists, returns `{token, ...}`).
- Produces: `listChannelsForAgent(token)` → `GET /api/channels` (Task 1's route). `startConversation({channelId, phoneNumber, content}, token)` → `POST /api/conversations/start` (Task 2's route). `StartConversationModal({onClose, onCreated})` — a component Task 4 imports and renders; calls `onCreated(conversation)` with the exact object `startConversation` resolved to.

- [ ] **Step 1: Write the failing tests**

In `frontend/src/services/api.test.js`, update the import list at the top to add the two new functions:

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
} from './api';
```

Append these two `describe` blocks at the end of the file:

```js
describe('listChannelsForAgent', () => {
  test('fetches the channel list for any authenticated agent', async () => {
    global.fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('[]') });
    await listChannelsForAgent('tok-123');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/channels',
      expect.objectContaining({ method: 'GET' })
    );
  });
});

describe('startConversation', () => {
  test('posts the new conversation payload', async () => {
    global.fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('{}') });
    await startConversation({ channelId: 'channel-1', phoneNumber: '5598999990000', content: 'Oi' }, 'tok-123');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/conversations/start',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ channelId: 'channel-1', phoneNumber: '5598999990000', content: 'Oi' }),
      })
    );
  });
});
```

Create `frontend/src/components/StartConversationModal.test.jsx`:

```jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StartConversationModal from './StartConversationModal';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
});

describe('StartConversationModal', () => {
  test('lists only connected Baileys channels', async () => {
    api.listChannelsForAgent.mockResolvedValue([
      { id: 'ch-1', type: 'baileys', name: 'Berg', status: 'connected' },
      { id: 'ch-2', type: 'baileys', name: 'Desconectado', status: 'awaiting_qr' },
      { id: 'ch-3', type: 'meta_cloud', name: 'Oficial', status: 'connected' },
    ]);
    render(<StartConversationModal onClose={vi.fn()} onCreated={vi.fn()} />);

    expect(await screen.findByText('Berg')).toBeInTheDocument();
    expect(screen.queryByText('Desconectado')).not.toBeInTheDocument();
    expect(screen.queryByText('Oficial')).not.toBeInTheDocument();
  });

  test('shows a message when there is no eligible channel', async () => {
    api.listChannelsForAgent.mockResolvedValue([]);
    render(<StartConversationModal onClose={vi.fn()} onCreated={vi.fn()} />);

    expect(await screen.findByText(/nenhum canal baileys conectado/i)).toBeInTheDocument();
  });

  test('submits the form and calls onCreated with the new conversation', async () => {
    api.listChannelsForAgent.mockResolvedValue([{ id: 'ch-1', type: 'baileys', name: 'Berg', status: 'connected' }]);
    api.startConversation.mockResolvedValue({ id: 'conv-new' });
    const onCreated = vi.fn();
    render(<StartConversationModal onClose={vi.fn()} onCreated={onCreated} />);

    await screen.findByText('Berg');
    await userEvent.type(screen.getByLabelText(/telefone/i), '5598999990000');
    await userEvent.type(screen.getByLabelText(/mensagem/i), 'Oi, tudo bem?');
    await userEvent.click(screen.getByRole('button', { name: /iniciar/i }));

    await waitFor(() =>
      expect(api.startConversation).toHaveBeenCalledWith(
        { channelId: 'ch-1', phoneNumber: '5598999990000', content: 'Oi, tudo bem?' },
        'tok-123'
      )
    );
    expect(onCreated).toHaveBeenCalledWith({ id: 'conv-new' });
  });

  test('shows an error and keeps the modal open when the API rejects', async () => {
    api.listChannelsForAgent.mockResolvedValue([{ id: 'ch-1', type: 'baileys', name: 'Berg', status: 'connected' }]);
    api.startConversation.mockRejectedValue({ body: { error: 'Já existe um atendimento em andamento' } });
    const onClose = vi.fn();
    render(<StartConversationModal onClose={onClose} onCreated={vi.fn()} />);

    await screen.findByText('Berg');
    await userEvent.type(screen.getByLabelText(/telefone/i), '5598999990000');
    await userEvent.type(screen.getByLabelText(/mensagem/i), 'Oi');
    await userEvent.click(screen.getByRole('button', { name: /iniciar/i }));

    expect(await screen.findByText('Já existe um atendimento em andamento')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  test('calls onClose when Cancelar is clicked', async () => {
    api.listChannelsForAgent.mockResolvedValue([]);
    const onClose = vi.fn();
    render(<StartConversationModal onClose={onClose} onCreated={vi.fn()} />);

    await userEvent.click(await screen.findByRole('button', { name: /cancelar/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run frontend/src/services/api.test.js frontend/src/components/StartConversationModal.test.jsx` (run from the `frontend` directory, or prefix the paths — use whichever the project's existing frontend test script uses, e.g. `cd frontend && npx vitest run src/services/api.test.js src/components/StartConversationModal.test.jsx`)
Expected: FAIL — `listChannelsForAgent`/`startConversation` are not exported from `api.js`, and `StartConversationModal` does not exist yet.

- [ ] **Step 3: Implement**

Add to the end of `frontend/src/services/api.js`:

```js
export function listChannelsForAgent(token) {
  return apiFetch('/api/channels', { token });
}

export function startConversation({ channelId, phoneNumber, content }, token) {
  return apiFetch('/api/conversations/start', {
    method: 'POST',
    body: { channelId, phoneNumber, content },
    token,
  });
}
```

Create `frontend/src/components/StartConversationModal.jsx`:

```jsx
import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { listChannelsForAgent, startConversation } from '../services/api';

function StartConversationModal({ onClose, onCreated }) {
  const { token } = useAuth();
  const [channels, setChannels] = useState([]);
  const [channelId, setChannelId] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [content, setContent] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    listChannelsForAgent(token)
      .then((data) => {
        const eligible = data.filter((channel) => channel.type === 'baileys' && channel.status === 'connected');
        setChannels(eligible);
        if (eligible.length > 0) {
          setChannelId(eligible[0].id);
        }
      })
      .catch(() => {});
  }, [token]);

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const conversation = await startConversation({ channelId, phoneNumber, content }, token);
      onCreated(conversation);
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao iniciar conversa');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/40">
      <div className="w-80 rounded bg-white p-4 shadow">
        <h3 className="mb-3 font-semibold text-gray-800">Iniciar conversa</h3>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label htmlFor="start-conversation-channel" className="mb-1 block text-sm text-gray-600">
              Canal
            </label>
            {channels.length === 0 ? (
              <p className="text-sm text-gray-500">Nenhum canal Baileys conectado no momento.</p>
            ) : (
              <select
                id="start-conversation-channel"
                value={channelId}
                onChange={(e) => setChannelId(e.target.value)}
                className="w-full rounded border border-gray-300 px-3 py-2"
              >
                {channels.map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    {channel.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div>
            <label htmlFor="start-conversation-phone" className="mb-1 block text-sm text-gray-600">
              Telefone
            </label>
            <input
              id="start-conversation-phone"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2"
              required
            />
          </div>
          <div>
            <label htmlFor="start-conversation-message" className="mb-1 block text-sm text-gray-600">
              Mensagem
            </label>
            <textarea
              id="start-conversation-message"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2"
              required
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitting || channels.length === 0}
              className="flex-1 rounded bg-blue-600 py-2 text-sm text-white disabled:opacity-50"
            >
              Iniciar
            </button>
            <button type="button" onClick={onClose} className="flex-1 rounded bg-gray-200 py-2 text-sm text-gray-700">
              Cancelar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default StartConversationModal;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/services/api.test.js src/components/StartConversationModal.test.jsx`
Expected: PASS (all tests in both files).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/api.js frontend/src/services/api.test.js frontend/src/components/StartConversationModal.jsx frontend/src/components/StartConversationModal.test.jsx
git commit -m "Add StartConversationModal and its API functions"
```

---

### Task 4: Frontend — wire into `DashboardPage`

**Files:**
- Modify: `frontend/src/pages/DashboardPage.jsx`
- Modify: `frontend/src/pages/DashboardPage.test.jsx`

**Interfaces:**
- Consumes: `StartConversationModal` (Task 3), `useMyConversations()`, `useQueue()` (unchanged, already exist).
- Produces: an "Iniciar conversa" button in the dashboard sidebar, visible to any attendant, opening `StartConversationModal`; on success the created conversation is selected and rendered immediately via a `pendingConversation` fallback (covers the gap before the `conversation:assigned` Socket.io event lands in `myConversations`).

- [ ] **Step 1: Write the failing tests**

In `frontend/src/pages/DashboardPage.test.jsx`, add this mock next to the other `vi.mock` calls at the top of the file:

```jsx
vi.mock('../components/StartConversationModal', () => ({
  default: ({ onCreated }) => (
    <button
      onClick={() =>
        onCreated({ id: 'conv-new', contactPhoneNumber: '5598999990000', assignedAgentId: 'agent-1', status: 'assigned' })
      }
    >
      Mock Start Conversation
    </button>
  ),
}));
```

Append these two tests inside the existing `describe('DashboardPage', ...)` block:

```jsx
  test('shows an Iniciar conversa button for any attendant', () => {
    useQueue.mockReturnValue([]);
    useMyConversations.mockReturnValue([]);
    renderDashboard();
    expect(screen.getByRole('button', { name: /iniciar conversa/i })).toBeInTheDocument();
  });

  test('starting a conversation opens it immediately, even before it appears in myConversations', async () => {
    useQueue.mockReturnValue([]);
    useMyConversations.mockReturnValue([]);
    renderDashboard();

    await userEvent.click(screen.getByRole('button', { name: /iniciar conversa/i }));
    await userEvent.click(screen.getByText('Mock Start Conversation'));

    expect(screen.getByRole('button', { name: /transferir/i })).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/pages/DashboardPage.test.jsx`
Expected: FAIL — no "Iniciar conversa" button exists yet.

- [ ] **Step 3: Implement**

Replace the full contents of `frontend/src/pages/DashboardPage.jsx`:

```jsx
import { useState } from 'react';
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

function DashboardPage() {
  const { agent, logout } = useAuth();
  const queue = useQueue();
  const myConversations = useMyConversations();
  const [selectedId, setSelectedId] = useState(null);
  const [transferringId, setTransferringId] = useState(null);
  const [changingPassword, setChangingPassword] = useState(false);
  const [startingConversation, setStartingConversation] = useState(false);
  const [pendingConversation, setPendingConversation] = useState(null);

  const selectedConversation =
    [...queue, ...myConversations].find((c) => c.id === selectedId) ||
    (pendingConversation && pendingConversation.id === selectedId ? pendingConversation : null);

  return (
    <div className="flex h-screen flex-col">
      <ChannelStatusBanner />
      <header className="flex items-center justify-between border-b border-gray-200 px-4 py-2">
        <h1 className="font-semibold text-gray-800">DW Telecom - Atendimento</h1>
        <div className="flex items-center gap-4">
          {agent?.role === 'admin' && (
            <Link to="/admin/channels" className="text-sm text-gray-500 hover:underline">
              Administração
            </Link>
          )}
          <button onClick={() => setChangingPassword(true)} className="text-sm text-gray-500 hover:underline">
            Trocar senha
          </button>
          <button onClick={logout} className="text-sm text-gray-500 hover:underline">
            Sair
          </button>
        </div>
      </header>
      <div className="flex flex-1 overflow-hidden">
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
      {changingPassword && <ChangePasswordModal onClose={() => setChangingPassword(false)} />}
      {startingConversation && (
        <StartConversationModal
          onClose={() => setStartingConversation(false)}
          onCreated={(conversation) => {
            setPendingConversation(conversation);
            setSelectedId(conversation.id);
            setStartingConversation(false);
          }}
        />
      )}
    </div>
  );
}

export default DashboardPage;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/pages/DashboardPage.test.jsx`
Expected: PASS (all existing tests plus the 2 new ones).

Then run the full frontend and backend suites to confirm nothing else broke:

Run: `cd frontend && npx vitest run`
Run: `npm test` (from the repo root)
Expected: PASS (frontend and backend, aside from the pre-existing, unrelated `src/queue/outbound-queue.test.js` Bull/Redis timing flake documented in the project's own history — safe to ignore if it's the only failure and it's timeout-only).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/DashboardPage.jsx frontend/src/pages/DashboardPage.test.jsx
git commit -m "Wire StartConversationModal into DashboardPage"
```

---

## Manual end-to-end test (after all tasks are merged)

Per the spec's testing section: start a real conversation from the deployed attendant panel, on the "Berg" Baileys channel, to a real phone number, and confirm the message actually arrives on that phone's WhatsApp — the same kind of manual check already done for Plan 7 (media messages).
