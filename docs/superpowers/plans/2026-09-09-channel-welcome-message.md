# Mensagem de boas-vindas por canal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin configure a per-channel welcome message, sent automatically before any triage question every time a new conversation starts.

**Architecture:** One nullable `welcome_message` text column on `channels` (empty = disabled). The existing inbound-message pipeline sends it through the same outbound queue every other message already uses, right before the existing triage-question dispatch. Admin UI lives inside the "Respostas rápidas" tab, renamed "Mensagens".

**Tech Stack:** Node.js/Express, PostgreSQL (`pg`, `node-pg-migrate`), Bull (Redis-backed outbound queue), React 18/Vite, Jest, Vitest/Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-09-channel-welcome-message-design.md`

## Global Constraints

- `welcome_message` is nullable TEXT on `channels`, no default (`NULL` = disabled). Never a separate `*_enabled` boolean — the text itself carries on/off.
- Welcome message fires only when `justCreated` is true in `ingestInboundMessage` (a genuinely new `conversations` row) — never on a triage-reply branch.
- When a channel has both a welcome message and triage enabled: welcome message is enqueued first, triage question second — same order every time, via `enqueueOutboundMessage` call order (same Bull queue, same single worker).
- No variables/interpolation in the welcome text for this delivery — plain fixed string.

---

### Task 1: Repository layer — `welcome_message` on channels

**Files:**
- Create: `migrations/1788850000000_add-welcome-message-to-channels.js`
- Modify: `src/channels/channel.repository.js`
- Test: `src/channels/channel.repository.test.js`

**Interfaces:**
- Produces: `toChannel(row)` includes `welcomeMessage`; every existing exported read/write function on this file (`createChannel`, `findChannelById`, `findChannelByMetaPhoneNumberId`, `findChannelByWabaId`, `listChannels`, `updateChannelStatus`, `updateChannelTriageEnabled`, `updateChannelWabaId`, `updateChannelHidden`) returns rows that include `welcome_message` so `toChannel` can map it; new `updateChannelWelcomeMessage(id: string, welcomeMessage: string | null): Promise<Channel | null>`.

- [ ] **Step 1: Write the failing tests**

Add to `src/channels/channel.repository.test.js`, importing the new function alongside the existing ones:

```javascript
const {
  createChannel,
  findChannelById,
  findChannelByMetaPhoneNumberId,
  findChannelByWabaId,
  listChannels,
  updateChannelStatus,
  updateChannelTriageEnabled,
  updateChannelWabaId,
  updateChannelHidden,
  updateChannelWelcomeMessage,
  countChannelDependents,
  deleteChannel,
} = require('./channel.repository');
```

Add these tests inside the top `describe('channel repository', ...)` block, right after the `updateChannelTriageEnabled returns null when the channel does not exist` test:

```javascript
  test('createChannel defaults welcomeMessage to null', async () => {
    const channel = await createChannel({
      type: 'baileys',
      name: 'Canal Sem Boas-Vindas',
      phoneNumber: '+5511999990022',
      config: {},
    });
    expect(channel.welcomeMessage).toBeNull();
  });

  test('updateChannelWelcomeMessage sets and clears the welcome message', async () => {
    const channel = await createChannel({
      type: 'baileys',
      name: 'Canal Com Boas-Vindas',
      phoneNumber: '+5511999990023',
      config: {},
    });

    const withMessage = await updateChannelWelcomeMessage(channel.id, 'Olá! Bem-vindo.');
    expect(withMessage.welcomeMessage).toBe('Olá! Bem-vindo.');

    const cleared = await updateChannelWelcomeMessage(channel.id, null);
    expect(cleared.welcomeMessage).toBeNull();
  });

  test('updateChannelWelcomeMessage returns null when the channel does not exist', async () => {
    const result = await updateChannelWelcomeMessage('00000000-0000-0000-0000-000000000000', 'Oi');
    expect(result).toBeNull();
  });

  test('findChannelById includes welcomeMessage', async () => {
    const channel = await createChannel({
      type: 'baileys',
      name: 'Canal Buscavel',
      phoneNumber: '+5511999990024',
      config: {},
    });
    await updateChannelWelcomeMessage(channel.id, 'Seja bem-vindo!');

    const found = await findChannelById(channel.id);
    expect(found.welcomeMessage).toBe('Seja bem-vindo!');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- channel.repository.test.js`
Expected: FAIL — `updateChannelWelcomeMessage is not a function`, and the other new tests fail with `welcomeMessage` being `undefined` instead of the expected value (the migration hasn't run yet either, so tests may also fail with "column welcome_message does not exist" until Step 3's migration is applied and `npm test`'s `pretest` migration step re-runs).

- [ ] **Step 3: Create the migration**

Create `migrations/1788850000000_add-welcome-message-to-channels.js`:

```javascript
exports.up = (pgm) => {
  pgm.sql(`ALTER TABLE channels ADD COLUMN welcome_message TEXT;`);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE channels DROP COLUMN welcome_message;`);
};
```

- [ ] **Step 4: Implement the repository changes**

In `src/channels/channel.repository.js`:

Update `toChannel`:

```javascript
function toChannel(row) {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    phoneNumber: row.phone_number,
    config: row.config,
    status: row.status,
    triageEnabled: row.triage_enabled,
    hidden: row.hidden,
    welcomeMessage: row.welcome_message,
    createdAt: row.created_at,
  };
}
```

Add `welcome_message` to every column list. Each of these queries currently reads
`id, type, name, phone_number, config, status, triage_enabled, hidden, created_at` — insert
`welcome_message` right before `created_at` in each one (both the `SELECT` list and any
`RETURNING` list): `createChannel`'s `RETURNING`, `findChannelById`'s `SELECT`,
`findChannelByMetaPhoneNumberId`'s `SELECT`, `findChannelByWabaId`'s `SELECT`,
`listChannels`'s `SELECT`, `updateChannelStatus`'s `RETURNING`,
`updateChannelTriageEnabled`'s `RETURNING`, `updateChannelWabaId`'s `RETURNING`,
`updateChannelHidden`'s `RETURNING`. For example, `findChannelById` becomes:

```javascript
async function findChannelById(id) {
  const result = await getPool().query(
    'SELECT id, type, name, phone_number, config, status, triage_enabled, hidden, welcome_message, created_at FROM channels WHERE id = $1',
    [id]
  );
  if (result.rowCount === 0) return null;
  return toChannel(result.rows[0]);
}
```

Apply the same `welcome_message` insertion (before `created_at`) to all 8 other queries listed above — the rest of each function's body (WHERE clauses, parameters, JOIN logic) is unchanged.

Add the new function, right after `updateChannelHidden`:

```javascript
async function updateChannelWelcomeMessage(id, welcomeMessage) {
  const result = await getPool().query(
    `UPDATE channels SET welcome_message = $2 WHERE id = $1
     RETURNING id, type, name, phone_number, config, status, triage_enabled, hidden, welcome_message, created_at`,
    [id, welcomeMessage]
  );
  if (result.rowCount === 0) return null;
  return toChannel(result.rows[0]);
}
```

Add it to `module.exports`:

```javascript
module.exports = {
  createChannel,
  findChannelById,
  findChannelByMetaPhoneNumberId,
  findChannelByWabaId,
  listChannels,
  updateChannelStatus,
  updateChannelTriageEnabled,
  updateChannelWabaId,
  updateChannelHidden,
  updateChannelWelcomeMessage,
  countChannelDependents,
  deleteChannel,
};
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- channel.repository.test.js`
Expected: PASS (all tests in the file, including the 4 new ones).

- [ ] **Step 6: Commit**

```bash
git add migrations/1788850000000_add-welcome-message-to-channels.js src/channels/channel.repository.js src/channels/channel.repository.test.js
git commit -m "Add welcome_message column and repository support for channels"
```

---

### Task 2: `PATCH /api/admin/channels/:id` accepts `welcomeMessage`

**Files:**
- Modify: `src/api/admin-channels.routes.js`
- Test: `src/api/admin-channels.routes.test.js`

**Interfaces:**
- Consumes: `updateChannelWelcomeMessage(id, welcomeMessage)` from Task 1.
- Produces: `toChannelResponse(channel)` includes `welcomeMessage` in every response that uses it (`GET /`, `POST /`, `PATCH /:id`).

- [ ] **Step 1: Write the failing tests**

In `src/api/admin-channels.routes.test.js`, find the top of the file where repository functions are imported from `'../channels/channel.repository'` and add `updateChannelWelcomeMessage` to that destructured import.

Add these tests inside `describe('PATCH /api/admin/channels/:id', ...)`, right after the existing `'returns 403 for a non-admin agent'` test:

```javascript
  test('sets welcomeMessage', async () => {
    updateChannelWelcomeMessage.mockResolvedValue({
      id: 'channel-1',
      type: 'baileys',
      name: 'Suporte',
      phoneNumber: '+5511999990001',
      status: 'connected',
      triageEnabled: false,
      welcomeMessage: 'Olá! Bem-vindo.',
    });

    const res = await request(buildApp())
      .patch('/api/admin/channels/channel-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ welcomeMessage: 'Olá! Bem-vindo.' });

    expect(res.status).toBe(200);
    expect(updateChannelWelcomeMessage).toHaveBeenCalledWith('channel-1', 'Olá! Bem-vindo.');
    expect(res.body.welcomeMessage).toBe('Olá! Bem-vindo.');
  });

  test('trims welcomeMessage and stores an empty/whitespace-only value as null', async () => {
    updateChannelWelcomeMessage.mockResolvedValue({
      id: 'channel-1',
      type: 'baileys',
      name: 'Suporte',
      phoneNumber: '+5511999990001',
      status: 'connected',
      triageEnabled: false,
      welcomeMessage: null,
    });

    const res = await request(buildApp())
      .patch('/api/admin/channels/channel-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ welcomeMessage: '   ' });

    expect(res.status).toBe(200);
    expect(updateChannelWelcomeMessage).toHaveBeenCalledWith('channel-1', null);
  });

  test('returns 400 when welcomeMessage is not a string', async () => {
    const res = await request(buildApp())
      .patch('/api/admin/channels/channel-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ welcomeMessage: 123 });

    expect(res.status).toBe(400);
    expect(updateChannelWelcomeMessage).not.toHaveBeenCalled();
  });

  test('returns 404 for welcomeMessage on a non-existent channel', async () => {
    updateChannelWelcomeMessage.mockResolvedValue(null);

    const res = await request(buildApp())
      .patch('/api/admin/channels/does-not-exist')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ welcomeMessage: 'Oi' });

    expect(res.status).toBe(404);
  });

  test('returns 400 when none of triageEnabled, wabaId, hidden or welcomeMessage is provided', async () => {
    const res = await request(buildApp())
      .patch('/api/admin/channels/channel-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/welcomeMessage/);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- admin-channels.routes.test.js`
Expected: FAIL — `updateChannelWelcomeMessage` mock is `undefined`/not a function reference from the import, and the route doesn't yet recognize `welcomeMessage`.

- [ ] **Step 3: Implement**

In `src/api/admin-channels.routes.js`, add `updateChannelWelcomeMessage` to the existing destructured import from `../channels/channel.repository`.

Update `toChannelResponse`:

```javascript
function toChannelResponse(channel) {
  return {
    id: channel.id,
    type: channel.type,
    name: channel.name,
    phoneNumber: channel.phoneNumber,
    status: channel.status,
    triageEnabled: channel.triageEnabled,
    hidden: channel.hidden,
    welcomeMessage: channel.welcomeMessage,
    wabaId: channel.type === 'meta_cloud' ? channel.config.wabaId : undefined,
  };
}
```

Update the `PATCH /:id` handler:

```javascript
router.patch('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const { triageEnabled, wabaId, hidden, welcomeMessage } = req.body || {};
  if (triageEnabled === undefined && wabaId === undefined && hidden === undefined && welcomeMessage === undefined) {
    return res.status(400).json({ error: 'triageEnabled, wabaId, hidden or welcomeMessage is required' });
  }
  if (hidden !== undefined && typeof hidden !== 'boolean') {
    return res.status(400).json({ error: 'hidden must be a boolean' });
  }
  if (welcomeMessage !== undefined && typeof welcomeMessage !== 'string') {
    return res.status(400).json({ error: 'welcomeMessage must be a string' });
  }
  let channel;
  if (triageEnabled !== undefined) {
    if (typeof triageEnabled !== 'boolean') {
      return res.status(400).json({ error: 'triageEnabled must be a boolean' });
    }
    channel = await updateChannelTriageEnabled(req.params.id, triageEnabled);
    if (!channel) {
      return res.status(404).json({ error: 'Channel not found' });
    }
  }
  if (wabaId !== undefined) {
    if (typeof wabaId !== 'string' || !wabaId.trim()) {
      return res.status(400).json({ error: 'wabaId must be a non-empty string' });
    }
    channel = await updateChannelWabaId(req.params.id, wabaId.trim());
    if (!channel) {
      return res.status(404).json({ error: 'Channel not found or not a meta_cloud channel' });
    }
  }
  if (hidden !== undefined) {
    const existing = await findChannelById(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Channel not found' });
    }
    if (hidden && existing.type === 'baileys') {
      await baileysManager.stopBaileysChannel(existing.id);
    }
    channel = await updateChannelHidden(req.params.id, hidden);
    if (!channel) {
      return res.status(404).json({ error: 'Channel not found' });
    }
  }
  if (welcomeMessage !== undefined) {
    channel = await updateChannelWelcomeMessage(req.params.id, welcomeMessage.trim() || null);
    if (!channel) {
      return res.status(404).json({ error: 'Channel not found' });
    }
  }
  res.json(toChannelResponse(channel));
});
```

(Only the 400-guard block, `toChannelResponse`, and the new `if (welcomeMessage !== undefined)` block at the end are new — the `triageEnabled`/`wabaId`/`hidden` blocks are unchanged from what's already in the file.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- admin-channels.routes.test.js`
Expected: PASS (all tests in the file, including the 5 new ones — and the pre-existing `'toggles triageEnabled on'` test at the top of the same describe block must still pass unmodified, since its mock response has no `welcomeMessage` field, which `toChannelResponse` will pass through as `undefined` and JSON drops from the response body).

- [ ] **Step 5: Commit**

```bash
git add src/api/admin-channels.routes.js src/api/admin-channels.routes.test.js
git commit -m "Let admins set a per-channel welcome message via PATCH"
```

---

### Task 3: Send the welcome message on every new conversation

**Files:**
- Modify: `src/conversations/inbound-message.service.js`
- Test: `src/conversations/inbound-message.service.test.js`

**Interfaces:**
- Consumes: `findChannelById(channelId)` from `../channels/channel.repository` (Task 1's `welcomeMessage` field); `enqueueOutboundMessage({conversationId, channelId, content})` from `../queue/outbound-queue`.

- [ ] **Step 1: Write the failing tests**

In `src/conversations/inbound-message.service.test.js`, add two new mocks at the top alongside the existing ones:

```javascript
jest.mock('./contact.repository');
jest.mock('./conversation.repository');
jest.mock('./message.repository');
jest.mock('../realtime/socket-server');
jest.mock('../triage/triage.service');
jest.mock('../channels/channel.repository');
jest.mock('../queue/outbound-queue');
const { findOrCreateContactByPhoneNumber } = require('./contact.repository');
const { findOpenConversation, createConversation, getConversationWithContact, activateConversation } = require('./conversation.repository');
const { createMessage } = require('./message.repository');
const { emitToAgent, broadcast, broadcastToDashboard } = require('../realtime/socket-server');
const { shouldStartTriage, sendTriageQuestion, processTriageReply } = require('../triage/triage.service');
const { findChannelById } = require('../channels/channel.repository');
const { enqueueOutboundMessage } = require('../queue/outbound-queue');
const { ingestInboundMessage } = require('./inbound-message.service');
```

Add `findChannelById.mockResolvedValue({ id: 'channel-1', welcomeMessage: null });` to the existing top-level `beforeEach` (alongside the existing `shouldStartTriage.mockResolvedValue(false);`), so every existing test in the file (which doesn't care about welcome messages) keeps working without modification — a channel with no welcome message configured is the default.

Add these new tests, anywhere inside `describe('ingestInboundMessage', ...)`:

```javascript
  test('sends the channel welcome message before the triage question on a new conversation', async () => {
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-welcome-1' });
    findOpenConversation.mockResolvedValue(null);
    shouldStartTriage.mockResolvedValue(true);
    findChannelById.mockResolvedValue({ id: 'channel-1', welcomeMessage: 'Olá! Bem-vindo à DW Telecom.' });
    createConversation.mockResolvedValue({ id: 'conv-welcome-1', assignedAgentId: null, triageState: 'pending' });
    createMessage.mockResolvedValue({ id: 'msg-welcome-1' });
    getConversationWithContact.mockResolvedValue({ id: 'conv-welcome-1', assignedAgentId: null, triageState: 'pending' });

    await ingestInboundMessage({
      channelId: 'channel-1',
      fromPhoneNumber: '+5511999980010',
      contactDisplayName: 'Cliente Novo',
      whatsappMessageId: 'wamid.WELCOME1',
      content: 'Oi',
    });

    expect(enqueueOutboundMessage).toHaveBeenCalledWith({
      conversationId: 'conv-welcome-1',
      channelId: 'channel-1',
      content: 'Olá! Bem-vindo à DW Telecom.',
    });
    expect(enqueueOutboundMessage.mock.invocationCallOrder[0]).toBeLessThan(sendTriageQuestion.mock.invocationCallOrder[0]);
  });

  test('does not enqueue a welcome message when the channel has none configured', async () => {
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-welcome-2' });
    findOpenConversation.mockResolvedValue(null);
    shouldStartTriage.mockResolvedValue(false);
    findChannelById.mockResolvedValue({ id: 'channel-1', welcomeMessage: null });
    createConversation.mockResolvedValue({ id: 'conv-welcome-2', assignedAgentId: null, triageState: null });
    createMessage.mockResolvedValue({ id: 'msg-welcome-2' });
    getConversationWithContact.mockResolvedValue({ id: 'conv-welcome-2', assignedAgentId: null, triageState: null });

    await ingestInboundMessage({
      channelId: 'channel-1',
      fromPhoneNumber: '+5511999980011',
      contactDisplayName: 'Cliente Sem Boas-Vindas',
      whatsappMessageId: 'wamid.WELCOME2',
      content: 'Oi',
    });

    expect(enqueueOutboundMessage).not.toHaveBeenCalled();
  });

  test('does not re-send the welcome message on a reply to an existing pending-triage conversation', async () => {
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-welcome-3' });
    findOpenConversation.mockResolvedValue({ id: 'conv-welcome-3', assignedAgentId: null, triageState: 'pending' });
    findChannelById.mockResolvedValue({ id: 'channel-1', welcomeMessage: 'Olá! Bem-vindo.' });
    createMessage.mockResolvedValue({ id: 'msg-welcome-3' });
    processTriageReply.mockResolvedValue({ id: 'conv-welcome-3', assignedAgentId: null, triageState: 'completed' });
    getConversationWithContact.mockResolvedValue({ id: 'conv-welcome-3', assignedAgentId: null, triageState: 'completed' });

    await ingestInboundMessage({
      channelId: 'channel-1',
      fromPhoneNumber: '+5511999980012',
      contactDisplayName: 'Cliente Respondendo',
      whatsappMessageId: 'wamid.WELCOME3',
      content: '1',
    });

    expect(enqueueOutboundMessage).not.toHaveBeenCalled();
  });

  test('sends the welcome message even when the channel has no triage configured', async () => {
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-welcome-4' });
    findOpenConversation.mockResolvedValue(null);
    shouldStartTriage.mockResolvedValue(false);
    findChannelById.mockResolvedValue({ id: 'channel-1', welcomeMessage: 'Oi! Já te atendemos.' });
    createConversation.mockResolvedValue({ id: 'conv-welcome-4', assignedAgentId: null, triageState: null });
    createMessage.mockResolvedValue({ id: 'msg-welcome-4' });
    getConversationWithContact.mockResolvedValue({ id: 'conv-welcome-4', assignedAgentId: null, triageState: null });

    await ingestInboundMessage({
      channelId: 'channel-1',
      fromPhoneNumber: '+5511999980013',
      contactDisplayName: 'Cliente Sem Triagem',
      whatsappMessageId: 'wamid.WELCOME4',
      content: 'Oi',
    });

    expect(enqueueOutboundMessage).toHaveBeenCalledWith({
      conversationId: 'conv-welcome-4',
      channelId: 'channel-1',
      content: 'Oi! Já te atendemos.',
    });
    expect(sendTriageQuestion).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- inbound-message.service.test.js`
Expected: FAIL — `findChannelById`/`enqueueOutboundMessage` are not called (0 calls) in the 4 new tests, since the source doesn't call them yet. Also confirm the *existing* tests in the file still pass at this point (they should — the new top-level mock default doesn't change any existing assertion).

- [ ] **Step 3: Implement**

In `src/conversations/inbound-message.service.js`, update the imports:

```javascript
const { findOrCreateContactByPhoneNumber } = require('./contact.repository');
const { findOpenConversation, createConversation, getConversationWithContact, activateConversation } = require('./conversation.repository');
const { createMessage } = require('./message.repository');
const { emitToAgent, broadcast, broadcastToDashboard } = require('../realtime/socket-server');
const { shouldStartTriage, sendTriageQuestion, processTriageReply } = require('../triage/triage.service');
const { findChannelById } = require('../channels/channel.repository');
const { enqueueOutboundMessage } = require('../queue/outbound-queue');
```

Replace this block:

```javascript
  if (justCreated && conversation.triageState === 'pending') {
    await sendTriageQuestion(conversation.id, channelId);
  } else if (!justCreated && conversation.triageState === 'pending') {
    conversation = await processTriageReply(conversation, channelId, content);
  }
```

with:

```javascript
  if (justCreated) {
    const channel = await findChannelById(channelId);
    if (channel.welcomeMessage) {
      await enqueueOutboundMessage({ conversationId: conversation.id, channelId, content: channel.welcomeMessage });
    }
    if (conversation.triageState === 'pending') {
      await sendTriageQuestion(conversation.id, channelId);
    }
  } else if (!justCreated && conversation.triageState === 'pending') {
    conversation = await processTriageReply(conversation, channelId, content);
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- inbound-message.service.test.js`
Expected: PASS (all tests in the file, including the 4 new ones and every pre-existing test).

- [ ] **Step 5: Commit**

```bash
git add src/conversations/inbound-message.service.js src/conversations/inbound-message.service.test.js
git commit -m "Send the channel welcome message before triage on every new conversation"
```

---

### Task 4: Frontend API client function

**Files:**
- Modify: `frontend/src/services/api.js`

**Interfaces:**
- Produces: `setChannelWelcomeMessage(id, welcomeMessage, token)`.

- [ ] **Step 1: Implement (no dedicated test file for `services/api.js` in this project — exercised indirectly through Task 5's component tests)**

In `frontend/src/services/api.js`, add this function right after `setChannelWabaId`:

```javascript
export function setChannelWelcomeMessage(id, welcomeMessage, token) {
  return apiFetch(`/api/admin/channels/${id}`, { method: 'PATCH', body: { welcomeMessage }, token });
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/services/api.js
git commit -m "Add the setChannelWelcomeMessage API client function"
```

---

### Task 5: Rename the admin tab to "Mensagens" and add the welcome-message section

**Files:**
- Create: `frontend/src/components/MessagesAdminTab.jsx` (via `git mv` from `QuickRepliesAdminTab.jsx`, then edited)
- Create: `frontend/src/components/MessagesAdminTab.test.jsx` (via `git mv` from `QuickRepliesAdminTab.test.jsx`, then edited)
- Delete: `frontend/src/components/QuickRepliesAdminTab.jsx`, `frontend/src/components/QuickRepliesAdminTab.test.jsx` (via the `git mv` above — nothing left behind under the old name)

**Interfaces:**
- Consumes: `useChannels(enabled)` (returns `{channels, loading, refresh}`, already exists), `setChannelWelcomeMessage(id, welcomeMessage, token)` from Task 4.
- Produces: default export `MessagesAdminTab` (replaces `QuickRepliesAdminTab` as the default export of this file — same component tree for quick replies, unchanged).

- [ ] **Step 1: Rename the files**

```bash
git mv frontend/src/components/QuickRepliesAdminTab.jsx frontend/src/components/MessagesAdminTab.jsx
git mv frontend/src/components/QuickRepliesAdminTab.test.jsx frontend/src/components/MessagesAdminTab.test.jsx
```

- [ ] **Step 2: Write the failing tests**

In `frontend/src/components/MessagesAdminTab.test.jsx`, update the import of the component under test and add a mock for `useChannels`:

```jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MessagesAdminTab from './MessagesAdminTab';
import { useQuickReplies } from '../hooks/useQuickReplies';
import { useChannels } from '../hooks/useChannels';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../hooks/useQuickReplies');
vi.mock('../hooks/useChannels');
vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
  useChannels.mockReturnValue({ channels: [], loading: false, refresh: vi.fn() });
});
```

Change every `render(<QuickRepliesAdminTab />)` in the file (7 occurrences) to `render(<MessagesAdminTab />)`. Change the outer `describe('QuickRepliesAdminTab', ...)` to `describe('MessagesAdminTab', ...)`.

Add these new tests inside that same `describe` block:

```jsx
  test('lists a card per channel with an editable welcome message', () => {
    useChannels.mockReturnValue({
      channels: [
        { id: 'ch-1', name: 'WhatsApp Vendas', welcomeMessage: 'Olá! Bem-vindo às vendas.' },
        { id: 'ch-2', name: 'WhatsApp Suporte', welcomeMessage: null },
      ],
      loading: false,
      refresh: vi.fn(),
    });
    useQuickReplies.mockReturnValue({ quickReplies: [], refresh: vi.fn() });
    render(<MessagesAdminTab />);

    expect(screen.getByText('WhatsApp Vendas')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Olá! Bem-vindo às vendas.')).toBeInTheDocument();
    expect(screen.getByText('WhatsApp Suporte')).toBeInTheDocument();
  });

  test('saving a welcome message calls setChannelWelcomeMessage and refreshes the channel list', async () => {
    const refreshChannels = vi.fn();
    useChannels.mockReturnValue({
      channels: [{ id: 'ch-1', name: 'WhatsApp Vendas', welcomeMessage: '' }],
      loading: false,
      refresh: refreshChannels,
    });
    useQuickReplies.mockReturnValue({ quickReplies: [], refresh: vi.fn() });
    api.setChannelWelcomeMessage.mockResolvedValue({ id: 'ch-1', welcomeMessage: 'Novo texto' });
    render(<MessagesAdminTab />);

    const textarea = screen.getByPlaceholderText(/sem boas-vindas configurada/i);
    await userEvent.type(textarea, 'Novo texto');
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));

    await waitFor(() => expect(api.setChannelWelcomeMessage).toHaveBeenCalledWith('ch-1', 'Novo texto', 'tok-123'));
    expect(refreshChannels).toHaveBeenCalled();
  });

  test('shows an error message when saving a welcome message fails', async () => {
    useChannels.mockReturnValue({
      channels: [{ id: 'ch-1', name: 'WhatsApp Vendas', welcomeMessage: '' }],
      loading: false,
      refresh: vi.fn(),
    });
    useQuickReplies.mockReturnValue({ quickReplies: [], refresh: vi.fn() });
    api.setChannelWelcomeMessage.mockRejectedValue({ body: { error: 'Falha ao salvar boas-vindas' } });
    render(<MessagesAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));

    expect(await screen.findByText('Falha ao salvar boas-vindas')).toBeInTheDocument();
  });
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd frontend && npx vitest run MessagesAdminTab`
Expected: FAIL — `Failed to resolve import` for `useChannels` usage inside the not-yet-updated component, or the 3 new tests fail because no channel cards/welcome-message UI exists yet.

- [ ] **Step 4: Implement**

In `frontend/src/components/MessagesAdminTab.jsx`, add the new imports at the top, alongside the existing ones:

```jsx
import { useChannels } from '../hooks/useChannels';
import { setChannelWelcomeMessage } from '../services/api';
```

(`useAuth`, `updateQuickReply`, `deleteQuickReply`, `CreateQuickReplyForm` stay imported exactly as they already are.)

Add a new component, anywhere above the default-exported function (e.g. right after the existing `QuickReplyRow` function):

```jsx
function ChannelWelcomeMessageRow({ channel, onSaved }) {
  const { token } = useAuth();
  const [text, setText] = useState(channel.welcomeMessage || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      await setChannelWelcomeMessage(channel.id, text, token);
      onSaved();
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao salvar');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-2xl border border-white/70 bg-white/50 p-4 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)] backdrop-blur-xl">
      <p className="font-medium text-ink-950">{channel.name}</p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Sem boas-vindas configurada — deixe em branco para desativar."
        className="mt-2 w-full rounded-xl border border-ink-950/15 bg-white/60 px-3.5 py-2.5 text-ink-950 placeholder-ink-950/35 outline-none transition focus:border-teal-signal/60 focus:bg-white/90 focus:ring-2 focus:ring-teal-signal/25"
      />
      {error && <p className="mt-2 rounded-lg border border-red-300 bg-red-50/80 px-3 py-2 text-sm text-red-700">{error}</p>}
      <button
        onClick={handleSave}
        disabled={saving}
        className="mt-2 rounded-lg bg-teal-signal px-3 py-1.5 text-sm font-medium text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving ? 'Salvando...' : 'Salvar'}
      </button>
    </div>
  );
}
```

Rename the default-exported function and its body (currently `QuickRepliesAdminTab`):

```jsx
function MessagesAdminTab() {
  const { quickReplies, refresh } = useQuickReplies();
  const { channels, refresh: refreshChannels } = useChannels(true);

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <h2 className="font-display text-lg font-semibold text-ink-950">Boas-vindas por canal</h2>
        <p className="text-sm text-ink-950/55">
          Enviada automaticamente sempre que uma conversa nova começa nesse canal.
        </p>
        {channels.map((channel) => (
          <ChannelWelcomeMessageRow key={channel.id} channel={channel} onSaved={refreshChannels} />
        ))}
      </div>

      <div className="space-y-3">
        <h2 className="font-display text-lg font-semibold text-ink-950">Respostas rápidas</h2>
        {quickReplies.map((quickReply) => (
          <QuickReplyRow key={quickReply.id} quickReply={quickReply} onSaved={refresh} onDeleted={refresh} />
        ))}
        <CreateQuickReplyForm onCreated={refresh} />
      </div>
    </div>
  );
}

export default MessagesAdminTab;
```

`QuickReplyRow` itself and its internals are unchanged — only relocated inside the same file, which is already the case since it isn't moving.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd frontend && npx vitest run MessagesAdminTab`
Expected: PASS (all tests in the file — the pre-existing quick-reply tests renamed in Step 2, plus the 3 new welcome-message tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/MessagesAdminTab.jsx frontend/src/components/MessagesAdminTab.test.jsx
git status --short
```

Confirm the status output shows the old `QuickRepliesAdminTab.jsx`/`.test.jsx` paths as renames (`R`), not as separate delete+add — `git mv` in Step 1 already staged this correctly, so a plain `git add` on the new paths is enough to include the whole rename in the commit.

```bash
git commit -m "Rename the quick-replies admin tab to Mensagens, add per-channel welcome message editing"
```

---

### Task 6: Wire the renamed tab into `AdminChannelsPage`

**Files:**
- Modify: `frontend/src/pages/AdminChannelsPage.jsx`
- Test: `frontend/src/pages/AdminChannelsPage.test.jsx`

**Interfaces:**
- Consumes: default export `MessagesAdminTab` from Task 5 (`frontend/src/components/MessagesAdminTab.jsx`).

- [ ] **Step 1: Write the failing test**

In `frontend/src/pages/AdminChannelsPage.test.jsx`, replace the existing test `'switches to the Respostas rápidas tab and shows the quick-reply management UI'` (around line 155) with:

```jsx
  test('switches to the Mensagens tab and shows quick replies and per-channel welcome messages', async () => {
    useChannels.mockReturnValue({
      channels: [{ id: 'ch1', type: 'baileys', name: 'Berg', phoneNumber: '+5598985004187', status: 'connected', welcomeMessage: null }],
      loading: false,
      refresh: vi.fn(),
    });
    useQuickReplies.mockReturnValue({
      quickReplies: [{ id: 'qr1', title: 'Boas-vindas', content: 'Olá!' }],
      refresh: vi.fn(),
    });
    render(
      <MemoryRouter>
        <AdminChannelsPage />
      </MemoryRouter>
    );

    expect(screen.getByText('Conectado')).toBeInTheDocument();
    expect(screen.queryByText('Boas-vindas')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /mensagens/i }));

    expect(screen.getByText('Boas-vindas')).toBeInTheDocument();
    expect(screen.getByText('Berg')).toBeInTheDocument();
    expect(screen.queryByText('Conectado')).not.toBeInTheDocument();
  });
```

(This replaces the old assertion that "Berg" is absent from the quick-replies tab — that's no longer true, since the channel name now legitimately appears there as the welcome-message card's heading. "Conectado", the Canais tab's own status-label text, is used instead to prove the tabs are still mutually exclusive.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run AdminChannelsPage`
Expected: FAIL — `Unable to find an accessible element with the role "button" and name /mensagens/i` (the tab is still labeled "Respostas rápidas" at this point).

- [ ] **Step 3: Implement**

In `frontend/src/pages/AdminChannelsPage.jsx`, update the import:

```jsx
import MessagesAdminTab from '../components/MessagesAdminTab';
```

In the `TABS` array, change:

```jsx
  { value: 'quickReplies', label: 'Respostas rápidas' },
```

to:

```jsx
  { value: 'quickReplies', label: 'Mensagens' },
```

Where the page renders `<QuickRepliesAdminTab />` for `activeTab === 'quickReplies'`, change it to `<MessagesAdminTab />`. (The `value: 'quickReplies'` string itself stays the same — only the visible label and the rendered component change — so no other conditional in the file needs touching.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run AdminChannelsPage`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/AdminChannelsPage.jsx frontend/src/pages/AdminChannelsPage.test.jsx
git commit -m "Point the renamed Mensagens tab at MessagesAdminTab"
```

---

## Final verification

After Task 6, run both full suites clean before considering the feature done:

```bash
npm test
cd frontend && npx vitest run
```

Expected: all backend and frontend tests pass, no failures introduced in files this plan didn't touch.

**Deploy ordering matters more than "run the migration after deploy" suggests.** Before `welcome_message` exists, every `SELECT` in `channel.repository.js` throws instead of returning — and the failure is silent, not a 500: `startAllBaileysConnections()` swallows the error on boot, so no Baileys channel reconnects at all (a full outage for that channel type, not a degradation); the Meta Cloud webhook handler still returns `200` after catching the error per-message, so Meta never retries and the customer's message is lost with only a log line; queued outbound sends burn their retries and land as `failed`. The safe sequence is **migrate first, deploy second** — set a Render Pre-Deploy Command of `npm run migrate -- up` if the project's Render setup supports one, or manually apply the column from the DB console immediately before deploying. The migration is idempotent (`ADD COLUMN IF NOT EXISTS`), so applying it early and then letting the formal migration run again post-deploy is safe.
