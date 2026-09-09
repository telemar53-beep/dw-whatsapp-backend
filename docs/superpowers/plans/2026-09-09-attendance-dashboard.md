# Dashboard de atendimento Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give admins a live, cross-agent operational view of every attendance — grouped into Em andamento / Em espera / Na automação / Encerrados hoje — with real-time updates and click-to-open.

**Architecture:** No new tables. The 4 groups are derived from `conversations.status`/`triage_state` (already there) via 5 new repository queries. A new admin-only Socket.io room (`dashboard`) plus a single generic `dashboard:conversation` event, broadcast from every existing mutation point that already changes those fields, keeps the frontend in sync without polling. The frontend reuses the existing `ConversationListItem` card and `DashboardPage`'s existing `pendingConversation` mechanism to open a conversation the viewing admin doesn't already have loaded.

**Tech Stack:** Node.js/Express, PostgreSQL (`pg`), Socket.io, React 18, React Router v6, Vitest/Jest.

**Spec:** `docs/superpowers/specs/2026-09-09-attendance-dashboard-design.md`

## Global Constraints

- "Hoje" in "Encerrados hoje" means the last 24 hours (`now() - 24h`), not calendar day — same convention as the existing Métricas dashboard's "Hoje" button. Never introduce timezone/calendar-day logic for this.
- Every list/count query added here reuses the exact JOIN shape already used by `getConversationWithContact`/`listWaitingConversations` in `src/conversations/conversation.repository.js` (contacts, sectors, cities, last-message LATERAL) and returns rows through the existing `toConversationSummary` mapper — no new response shape.
- `broadcastToDashboard` (new) must be a silent no-op when the socket server isn't initialized, exactly like the existing `emitToAgent`/`broadcast`.
- Only `role === 'admin'` sockets join the `dashboard` room; only `role === 'admin'` HTTP callers can hit the new `/api/admin/dashboard/*` routes.

---

### Task 1: Repository queries for the dashboard groups

**Files:**
- Modify: `src/conversations/conversation.repository.js`
- Test: `src/conversations/conversation.repository.test.js`

**Interfaces:**
- Produces: `listInProgressConversations(): Promise<ConversationSummary[]>`, `listWaitingForAgentConversations(): Promise<ConversationSummary[]>`, `listInAutomationConversations(): Promise<ConversationSummary[]>`, `countClosedSince(since: Date): Promise<number>`, `listClosedSince(since: Date, {limit, offset}: {limit: number, offset: number}): Promise<Array<ConversationSummary & {closedAt: string}>>`. `ConversationSummary` is the existing shape produced by `toConversationSummary` (see the top of the file: `id, contactId, channelId, status, assignedAgentId, sectorId, triageState, triageAttempts, createdAt, updatedAt, contactPhoneNumber, contactDisplayName, contactAvatarPath, contactCityId, contactCityName, sectorName, lastMessageContent, lastMessageType, lastMessageStatus, lastMessageDirection, lastMessageAt`).

- [ ] **Step 1: Write the failing tests**

Add to `src/conversations/conversation.repository.test.js`, just before the file's closing `});` (after the last existing test, still inside `describe('conversation repository', ...)`):

```javascript
  test('listInProgressConversations returns only assigned conversations, most recently updated first', async () => {
    const waitingConversation = await createConversation(contactId, channelId);
    const assignedConversation = await createConversation(contactId, channelId);
    const agent = await createAgent({ email: 'dash1@dw.com', password: 'secret123', role: 'agent' });
    await claimConversation(assignedConversation.id, agent.id);

    const result = await listInProgressConversations();

    expect(result.map((c) => c.id)).toEqual([assignedConversation.id]);
    expect(result[0].contactPhoneNumber).toBe('+5511977776666');
    void waitingConversation;
  });

  test('listWaitingForAgentConversations returns waiting conversations whose triage is not pending', async () => {
    const waiting = await createConversation(contactId, channelId);
    const inTriage = await createConversation(contactId, channelId, 'pending');
    const agent = await createAgent({ email: 'dash2@dw.com', password: 'secret123', role: 'agent' });
    const assigned = await createConversation(contactId, channelId);
    await claimConversation(assigned.id, agent.id);

    const result = await listWaitingForAgentConversations();

    expect(result.map((c) => c.id)).toEqual([waiting.id]);
    void inTriage;
  });

  test('listInAutomationConversations returns only conversations with triage pending', async () => {
    const inTriage = await createConversation(contactId, channelId, 'pending');
    const waiting = await createConversation(contactId, channelId);

    const result = await listInAutomationConversations();

    expect(result.map((c) => c.id)).toEqual([inTriage.id]);
    void waiting;
  });

  test('countClosedSince counts only conversations closed at or after the given time', async () => {
    const agent = await createAgent({ email: 'dash3@dw.com', password: 'secret123', role: 'agent' });
    const oldEnough = await createConversation(contactId, channelId);
    await claimConversation(oldEnough.id, agent.id);
    await closeConversation(oldEnough.id, agent.id);

    const since = new Date(Date.now() - 60 * 60 * 1000);
    const count = await countClosedSince(since);

    expect(count).toBe(1);

    const future = new Date(Date.now() + 60 * 60 * 1000);
    expect(await countClosedSince(future)).toBe(0);
  });

  test('listClosedSince returns closed conversations most recently closed first, with closedAt and pagination', async () => {
    const agent = await createAgent({ email: 'dash4@dw.com', password: 'secret123', role: 'agent' });
    const first = await createConversation(contactId, channelId);
    await claimConversation(first.id, agent.id);
    await closeConversation(first.id, agent.id);
    const second = await createConversation(contactId, channelId);
    await claimConversation(second.id, agent.id);
    await closeConversation(second.id, agent.id);

    const since = new Date(Date.now() - 60 * 60 * 1000);
    const page1 = await listClosedSince(since, { limit: 1, offset: 0 });
    const page2 = await listClosedSince(since, { limit: 1, offset: 1 });

    expect(page1.map((c) => c.id)).toEqual([second.id]);
    expect(page1[0].closedAt).toBeDefined();
    expect(page2.map((c) => c.id)).toEqual([first.id]);
  });
```

Add the new function names to the destructured `require('./conversation.repository')` at the top of the test file:

```javascript
const {
  findOpenConversation,
  createConversation,
  claimConversation,
  transferConversation,
  closeConversation,
  getConversationWithContact,
  listWaitingConversations,
  listConversationsByAgent,
  listClosedConversationsByContact,
  completeTriage,
  incrementTriageAttempts,
  activateConversation,
  listInProgressConversations,
  listWaitingForAgentConversations,
  listInAutomationConversations,
  countClosedSince,
  listClosedSince,
} = require('./conversation.repository');
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- conversation.repository.test.js`
Expected: FAIL — `listInProgressConversations is not a function` (and similar for the other 4).

- [ ] **Step 3: Implement the 5 functions**

In `src/conversations/conversation.repository.js`, add these functions right after `listWaitingConversations` (which ends around line 191 with `return result.rows.map(toConversationSummary); }`):

```javascript
async function listInProgressConversations() {
  const result = await getPool().query(
    `SELECT c.id, c.contact_id, c.channel_id, c.status, c.assigned_agent_id, c.sector_id, c.triage_state, c.triage_attempts, c.created_at, c.updated_at,
            ct.phone_number AS contact_phone_number, ct.display_name AS contact_display_name,
            ct.avatar_path AS contact_avatar_path,
            ct.city_id AS contact_city_id, ci.name AS contact_city_name,
            s.name AS sector_name,
            lm.content AS last_message_content, lm.message_type AS last_message_type,
            lm.status AS last_message_status, lm.direction AS last_message_direction,
            lm.created_at AS last_message_at
     FROM conversations c
     JOIN contacts ct ON ct.id = c.contact_id
     LEFT JOIN sectors s ON s.id = c.sector_id
     LEFT JOIN cities ci ON ci.id = ct.city_id
     LEFT JOIN LATERAL (
       SELECT content, message_type, status, direction, created_at
       FROM messages m
       WHERE m.conversation_id = c.id
       ORDER BY m.created_at DESC
       LIMIT 1
     ) lm ON true
     WHERE c.status = 'assigned'
     ORDER BY c.updated_at DESC`
  );
  return result.rows.map(toConversationSummary);
}

async function listWaitingForAgentConversations() {
  const result = await getPool().query(
    `SELECT c.id, c.contact_id, c.channel_id, c.status, c.assigned_agent_id, c.sector_id, c.triage_state, c.triage_attempts, c.created_at, c.updated_at,
            ct.phone_number AS contact_phone_number, ct.display_name AS contact_display_name,
            ct.avatar_path AS contact_avatar_path,
            ct.city_id AS contact_city_id, ci.name AS contact_city_name,
            s.name AS sector_name,
            lm.content AS last_message_content, lm.message_type AS last_message_type,
            lm.status AS last_message_status, lm.direction AS last_message_direction,
            lm.created_at AS last_message_at
     FROM conversations c
     JOIN contacts ct ON ct.id = c.contact_id
     LEFT JOIN sectors s ON s.id = c.sector_id
     LEFT JOIN cities ci ON ci.id = ct.city_id
     LEFT JOIN LATERAL (
       SELECT content, message_type, status, direction, created_at
       FROM messages m
       WHERE m.conversation_id = c.id
       ORDER BY m.created_at DESC
       LIMIT 1
     ) lm ON true
     WHERE c.status = 'waiting' AND c.triage_state IS DISTINCT FROM 'pending'
     ORDER BY c.created_at ASC`
  );
  return result.rows.map(toConversationSummary);
}

async function listInAutomationConversations() {
  const result = await getPool().query(
    `SELECT c.id, c.contact_id, c.channel_id, c.status, c.assigned_agent_id, c.sector_id, c.triage_state, c.triage_attempts, c.created_at, c.updated_at,
            ct.phone_number AS contact_phone_number, ct.display_name AS contact_display_name,
            ct.avatar_path AS contact_avatar_path,
            ct.city_id AS contact_city_id, ci.name AS contact_city_name,
            s.name AS sector_name,
            lm.content AS last_message_content, lm.message_type AS last_message_type,
            lm.status AS last_message_status, lm.direction AS last_message_direction,
            lm.created_at AS last_message_at
     FROM conversations c
     JOIN contacts ct ON ct.id = c.contact_id
     LEFT JOIN sectors s ON s.id = c.sector_id
     LEFT JOIN cities ci ON ci.id = ct.city_id
     LEFT JOIN LATERAL (
       SELECT content, message_type, status, direction, created_at
       FROM messages m
       WHERE m.conversation_id = c.id
       ORDER BY m.created_at DESC
       LIMIT 1
     ) lm ON true
     WHERE c.triage_state = 'pending'
     ORDER BY c.created_at ASC`
  );
  return result.rows.map(toConversationSummary);
}

async function countClosedSince(since) {
  const result = await getPool().query(
    `SELECT COUNT(*)::int AS count FROM conversation_events WHERE event_type = 'closed' AND created_at >= $1`,
    [since]
  );
  return Number(result.rows[0].count);
}

async function listClosedSince(since, { limit, offset }) {
  const result = await getPool().query(
    `SELECT c.id, c.contact_id, c.channel_id, c.status, c.assigned_agent_id, c.sector_id, c.triage_state, c.triage_attempts, c.created_at, c.updated_at,
            ct.phone_number AS contact_phone_number, ct.display_name AS contact_display_name,
            ct.avatar_path AS contact_avatar_path,
            ct.city_id AS contact_city_id, ci.name AS contact_city_name,
            s.name AS sector_name,
            lm.content AS last_message_content, lm.message_type AS last_message_type,
            lm.status AS last_message_status, lm.direction AS last_message_direction,
            lm.created_at AS last_message_at,
            ce.created_at AS closed_at
     FROM conversation_events ce
     JOIN conversations c ON c.id = ce.conversation_id
     JOIN contacts ct ON ct.id = c.contact_id
     LEFT JOIN sectors s ON s.id = c.sector_id
     LEFT JOIN cities ci ON ci.id = ct.city_id
     LEFT JOIN LATERAL (
       SELECT content, message_type, status, direction, created_at
       FROM messages m
       WHERE m.conversation_id = c.id
       ORDER BY m.created_at DESC
       LIMIT 1
     ) lm ON true
     WHERE ce.event_type = 'closed' AND ce.created_at >= $1
     ORDER BY ce.created_at DESC
     LIMIT $2 OFFSET $3`,
    [since, limit, offset]
  );
  return result.rows.map((row) => ({ ...toConversationSummary(row), closedAt: row.closed_at }));
}
```

Update `module.exports` at the bottom of the file to add the 5 new names:

```javascript
module.exports = {
  findOpenConversation,
  createConversation,
  claimConversation,
  transferConversation,
  closeConversation,
  completeTriage,
  incrementTriageAttempts,
  activateConversation,
  getConversationWithContact,
  listWaitingConversations,
  listConversationsByAgent,
  listClosedConversationsByContact,
  listInProgressConversations,
  listWaitingForAgentConversations,
  listInAutomationConversations,
  countClosedSince,
  listClosedSince,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- conversation.repository.test.js`
Expected: PASS (all tests in the file, including the 5 new ones).

- [ ] **Step 5: Commit**

```bash
git add src/conversations/conversation.repository.js src/conversations/conversation.repository.test.js
git commit -m "Add repository queries for the attendance dashboard groups"
```

---

### Task 2: Admin-only `dashboard` socket room and `broadcastToDashboard`

**Files:**
- Modify: `src/realtime/socket-server.js`
- Test: `src/realtime/socket-server.test.js`

**Interfaces:**
- Consumes: `socket.agent.role` (already present in the JWT payload — see `src/auth/auth.service.js`'s `jwt.sign({ agentId: agent.id, role: agent.role }, ...)`).
- Produces: `broadcastToDashboard(event: string, payload: object): void`, exported alongside `emitToAgent`/`broadcast`.

- [ ] **Step 1: Write the failing tests**

Add to `src/realtime/socket-server.test.js`, inside the top `describe('socket server', ...)` block, right after the `'broadcast delivers to every connected client'` test (before the presence tests):

```javascript
  test('an admin socket joins the dashboard room and receives broadcastToDashboard events; a non-admin socket does not', (done) => {
    const adminToken = jwt.sign({ agentId: 'agent-admin-1', role: 'admin' }, process.env.JWT_SECRET);
    const agentToken = jwt.sign({ agentId: 'agent-plain-1', role: 'agent' }, process.env.JWT_SECRET);
    const adminClient = connect(adminToken);
    const agentClient = connect(agentToken);
    let connectedCount = 0;

    function onBothConnected() {
      connectedCount += 1;
      if (connectedCount !== 2) return;
      const receivedByAgent = jest.fn();
      agentClient.on('dashboard:conversation', receivedByAgent);
      adminClient.on('dashboard:conversation', (payload) => {
        expect(payload).toEqual({ hello: 'dashboard' });
        expect(receivedByAgent).not.toHaveBeenCalled();
        adminClient.close();
        agentClient.close();
        done();
      });
      broadcastToDashboard('dashboard:conversation', { hello: 'dashboard' });
    }

    adminClient.on('connect', onBothConnected);
    agentClient.on('connect', onBothConnected);
  });
```

Update the top import line to add `broadcastToDashboard`:

```javascript
const { initSocketServer, emitToAgent, broadcast, broadcastToDashboard, closeSocketServer } = require('./socket-server');
```

Add to the bottom `describe('socket server module-level guards', ...)` block, alongside the existing test:

```javascript
  test('broadcastToDashboard is a no-op before the server is initialized', () => {
    return closeSocketServer().then(() => {
      expect(() => broadcastToDashboard('some-event', {})).not.toThrow();
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- socket-server.test.js`
Expected: FAIL — `broadcastToDashboard is not a function`.

- [ ] **Step 3: Implement**

In `src/realtime/socket-server.js`, change the `connection` handler to also join the `dashboard` room for admins:

```javascript
  io.on('connection', (socket) => {
    socket.join(`agent:${socket.agent.agentId}`);
    if (socket.agent.role === 'admin') {
      socket.join('dashboard');
    }
    if (markAgentOnline(socket.agent.agentId)) {
```

(This inserts the 3 new lines right after the existing `socket.join(\`agent:${socket.agent.agentId}\`);` line — everything below it, starting with the `markAgentOnline` check, stays exactly as it already is.)

Add the new function right after `broadcast`:

```javascript
function broadcastToDashboard(event, payload) {
  if (!io) return;
  io.to('dashboard').emit(event, payload);
}
```

Update `module.exports`:

```javascript
module.exports = { initSocketServer, getSocketServer, emitToAgent, broadcast, broadcastToDashboard, closeSocketServer };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- socket-server.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/realtime/socket-server.js src/realtime/socket-server.test.js
git commit -m "Add an admin-only dashboard socket room and broadcastToDashboard"
```

---

### Task 3: Broadcast `dashboard:conversation` from every state-changing mutation

**Files:**
- Modify: `src/conversations/inbound-message.service.js`
- Modify: `src/api/conversations.routes.js`
- Test: `src/conversations/inbound-message.service.test.js`
- Test: `src/api/conversations.routes.test.js`

**Interfaces:**
- Consumes: `broadcastToDashboard(event, payload)` from Task 2.

- [ ] **Step 1: Write the failing tests**

In `src/conversations/inbound-message.service.test.js`, add `broadcastToDashboard` to the mocked import:

```javascript
const { emitToAgent, broadcast, broadcastToDashboard } = require('../realtime/socket-server');
```

Add this test right after the `'reuses an existing open conversation and broadcasts queue:new when unassigned'` test:

```javascript
  test('always broadcasts dashboard:conversation with the up-to-date conversation, regardless of assignment', async () => {
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-dash1' });
    findOpenConversation.mockResolvedValue({ id: 'conv-dash1', assignedAgentId: 'agent-9' });
    createMessage.mockResolvedValue({ id: 'msg-dash1' });
    getConversationWithContact.mockResolvedValue({
      id: 'conv-dash1',
      assignedAgentId: 'agent-9',
      status: 'assigned',
    });

    await ingestInboundMessage({
      channelId: 'channel-1',
      fromPhoneNumber: '+5511999980000',
      contactDisplayName: 'Cliente Dashboard',
      whatsappMessageId: 'wamid.DASH1',
      content: 'Oi',
    });

    expect(broadcastToDashboard).toHaveBeenCalledWith('dashboard:conversation', {
      conversation: { id: 'conv-dash1', assignedAgentId: 'agent-9', status: 'assigned' },
    });
  });

  test('does not broadcast dashboard:conversation for a duplicate webhook redelivery', async () => {
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-dash2' });
    findOpenConversation.mockResolvedValue({ id: 'conv-dash2', assignedAgentId: null });
    const uniqueViolation = Object.assign(new Error('duplicate key'), { code: '23505' });
    createMessage.mockRejectedValue(uniqueViolation);

    await ingestInboundMessage({
      channelId: 'channel-1',
      fromPhoneNumber: '+5511999980001',
      contactDisplayName: 'Reenvio Dashboard',
      whatsappMessageId: 'wamid.DASH2',
      content: 'Oi',
    });

    expect(broadcastToDashboard).not.toHaveBeenCalled();
  });
```

In `src/api/conversations.routes.test.js`, add `broadcastToDashboard` to the mocked import:

```javascript
const { emitToAgent, broadcast, broadcastToDashboard } = require('../realtime/socket-server');
```

Add this test inside `describe('POST /api/conversations/:id/claim', ...)`, right after `'broadcasts queue:removed and notifies the claiming agent on success'`:

```javascript
  test('also broadcasts dashboard:conversation on a successful claim', async () => {
    claimConversation.mockResolvedValue({ id: 'conv-1', status: 'assigned', assignedAgentId: 'agent-1' });
    getConversationWithContact.mockResolvedValue({ id: 'conv-1', status: 'assigned', assignedAgentId: 'agent-1' });
    await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/claim`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(broadcastToDashboard).toHaveBeenCalledWith('dashboard:conversation', {
      conversation: { id: 'conv-1', status: 'assigned', assignedAgentId: 'agent-1' },
    });
  });
```

Add this test inside `describe('POST /api/conversations/:id/transfer', ...)`, right after its success-path test that checks `emitToAgent`/`broadcast` (the test right before the last one in that block, following the same setup shape used there):

```javascript
  test('also broadcasts dashboard:conversation on a successful transfer', async () => {
    transferConversation.mockResolvedValue({ id: 'conv-1', status: 'assigned', assignedAgentId: 'agent-2' });
    getConversationWithContact.mockResolvedValue({ id: 'conv-1', status: 'assigned', assignedAgentId: 'agent-2' });
    await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/transfer`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ toAgentId: 'agent-2' });
    expect(broadcastToDashboard).toHaveBeenCalledWith('dashboard:conversation', {
      conversation: { id: 'conv-1', status: 'assigned', assignedAgentId: 'agent-2' },
    });
  });
```

Add this test inside `describe('POST /api/conversations/:id/close', ...)`, right after `'broadcasts queue:removed when closing a conversation that was never assigned'`:

```javascript
  test('also broadcasts dashboard:conversation with a closedAt timestamp on a successful close', async () => {
    closeConversation.mockResolvedValue({ id: 'conv-1', status: 'closed', assignedAgentId: 'agent-1' });
    getConversationWithContact.mockResolvedValue({ id: 'conv-1', status: 'closed', assignedAgentId: 'agent-1' });
    await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/close`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(broadcastToDashboard).toHaveBeenCalledWith(
      'dashboard:conversation',
      expect.objectContaining({
        conversation: { id: 'conv-1', status: 'closed', assignedAgentId: 'agent-1' },
        closedAt: expect.any(String),
      })
    );
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- inbound-message.service.test.js conversations.routes.test.js`
Expected: FAIL — `broadcastToDashboard` was called 0 times in each new test (the mocked functions exist since `jest.mock` auto-mocks every export, but nothing calls them yet).

- [ ] **Step 3: Implement**

In `src/conversations/inbound-message.service.js`, update the import and the final block:

```javascript
const { emitToAgent, broadcast, broadcastToDashboard } = require('../realtime/socket-server');
```

```javascript
  const conversationWithContact = await getConversationWithContact(conversation.id);
  if (conversationWithContact.assignedAgentId) {
    emitToAgent(conversationWithContact.assignedAgentId, 'message:new', { conversation: conversationWithContact, message });
  } else {
    broadcast('queue:new', { conversation: conversationWithContact, message });
  }
  broadcastToDashboard('dashboard:conversation', { conversation: conversationWithContact });
  return { contact, conversation, message, contactJustCreated };
```

In `src/api/conversations.routes.js`, update the import:

```javascript
const { emitToAgent, broadcast, broadcastToDashboard } = require('../realtime/socket-server');
```

Update the claim route:

```javascript
router.post('/:id/claim', async (req, res) => {
  const conversation = await claimConversation(req.params.id, req.agent.agentId);
  if (!conversation) {
    return res.status(409).json({ error: 'Conversation already assigned or closed' });
  }
  const conversationWithContact = await getConversationWithContact(conversation.id);
  broadcast('queue:removed', { conversationId: conversation.id });
  emitToAgent(conversation.assignedAgentId, 'conversation:assigned', { conversation: conversationWithContact });
  broadcastToDashboard('dashboard:conversation', { conversation: conversationWithContact });
  res.json(conversation);
});
```

Update the transfer route:

```javascript
router.post('/:id/transfer', async (req, res) => {
  const { toAgentId } = req.body || {};
  if (!toAgentId) {
    return res.status(400).json({ error: 'toAgentId is required' });
  }
  const conversation = await transferConversation(req.params.id, req.agent.agentId, toAgentId);
  if (!conversation) {
    return res.status(409).json({ error: 'Conversation is not currently assigned to you, or is closed' });
  }
  const conversationWithContact = await getConversationWithContact(conversation.id);
  emitToAgent(req.agent.agentId, 'conversation:removed', { conversationId: conversation.id });
  broadcast('queue:removed', { conversationId: conversation.id });
  emitToAgent(toAgentId, 'conversation:assigned', { conversation: conversationWithContact });
  broadcastToDashboard('dashboard:conversation', { conversation: conversationWithContact });
  res.json(conversation);
});
```

Update the close route:

```javascript
router.post('/:id/close', async (req, res) => {
  const conversation = await closeConversation(req.params.id, req.agent.agentId);
  if (!conversation) {
    return res.status(409).json({ error: 'Conversation is not currently assigned to you, or is closed' });
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- inbound-message.service.test.js conversations.routes.test.js`
Expected: PASS (all tests in both files).

- [ ] **Step 5: Commit**

```bash
git add src/conversations/inbound-message.service.js src/conversations/inbound-message.service.test.js src/api/conversations.routes.js src/api/conversations.routes.test.js
git commit -m "Broadcast dashboard:conversation from every conversation state change"
```

---

### Task 4: `GET /api/admin/dashboard/conversations` and `/conversations/closed-today`

**Files:**
- Create: `src/api/admin-dashboard.routes.js`
- Create: `src/api/admin-dashboard.routes.test.js`
- Modify: `src/server.js`

**Interfaces:**
- Consumes: the 5 repository functions from Task 1 (`listInProgressConversations`, `listWaitingForAgentConversations`, `listInAutomationConversations`, `countClosedSince`, `listClosedSince`); `requireAuth`/`requireRole` from `../auth/auth.middleware` (same as `admin-channels.routes.js`).

- [ ] **Step 1: Write the failing tests**

Create `src/api/admin-dashboard.routes.test.js`:

```javascript
jest.mock('../conversations/conversation.repository');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const {
  listInProgressConversations,
  listWaitingForAgentConversations,
  listInAutomationConversations,
  countClosedSince,
  listClosedSince,
} = require('../conversations/conversation.repository');
const adminDashboardRoutes = require('./admin-dashboard.routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/dashboard', adminDashboardRoutes);
  return app;
}

function tokenFor(agentId, role) {
  return jwt.sign({ agentId, role }, process.env.JWT_SECRET);
}

describe('GET /api/admin/dashboard/conversations', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns the 3 live groups plus the closed-today count for an admin', async () => {
    listInProgressConversations.mockResolvedValue([{ id: 'conv-1', status: 'assigned' }]);
    listWaitingForAgentConversations.mockResolvedValue([{ id: 'conv-2', status: 'waiting' }]);
    listInAutomationConversations.mockResolvedValue([{ id: 'conv-3', triageState: 'pending' }]);
    countClosedSince.mockResolvedValue(5);

    const res = await request(buildApp())
      .get('/api/admin/dashboard/conversations')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      inProgress: [{ id: 'conv-1', status: 'assigned' }],
      waiting: [{ id: 'conv-2', status: 'waiting' }],
      inAutomation: [{ id: 'conv-3', triageState: 'pending' }],
      closedTodayCount: 5,
    });
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .get('/api/admin/dashboard/conversations')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(403);
  });

  test('returns 401 without a token', async () => {
    const res = await request(buildApp()).get('/api/admin/dashboard/conversations');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/admin/dashboard/conversations/closed-today', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns a page of closed conversations with hasMore true when more remain', async () => {
    listClosedSince.mockResolvedValue([{ id: 'conv-1', closedAt: '2026-09-09T10:00:00.000Z' }]);
    countClosedSince.mockResolvedValue(3);

    const res = await request(buildApp())
      .get('/api/admin/dashboard/conversations/closed-today?limit=1&offset=0')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [{ id: 'conv-1', closedAt: '2026-09-09T10:00:00.000Z' }], hasMore: true });
    expect(listClosedSince).toHaveBeenCalledWith(expect.any(Date), { limit: 1, offset: 0 });
  });

  test('returns hasMore false when the page reaches the end', async () => {
    listClosedSince.mockResolvedValue([{ id: 'conv-1' }]);
    countClosedSince.mockResolvedValue(1);

    const res = await request(buildApp())
      .get('/api/admin/dashboard/conversations/closed-today?limit=20&offset=0')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);

    expect(res.body.hasMore).toBe(false);
  });

  test('defaults limit to 20 and caps it at 50', async () => {
    listClosedSince.mockResolvedValue([]);
    countClosedSince.mockResolvedValue(0);

    await request(buildApp())
      .get('/api/admin/dashboard/conversations/closed-today')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);
    expect(listClosedSince).toHaveBeenCalledWith(expect.any(Date), { limit: 20, offset: 0 });

    jest.clearAllMocks();
    listClosedSince.mockResolvedValue([]);
    countClosedSince.mockResolvedValue(0);
    await request(buildApp())
      .get('/api/admin/dashboard/conversations/closed-today?limit=999')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);
    expect(listClosedSince).toHaveBeenCalledWith(expect.any(Date), { limit: 50, offset: 0 });
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .get('/api/admin/dashboard/conversations/closed-today')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- admin-dashboard.routes.test.js`
Expected: FAIL — `Cannot find module './admin-dashboard.routes'`.

- [ ] **Step 3: Implement**

Create `src/api/admin-dashboard.routes.js`:

```javascript
const express = require('express');
const { requireAuth, requireRole } = require('../auth/auth.middleware');
const {
  listInProgressConversations,
  listWaitingForAgentConversations,
  listInAutomationConversations,
  countClosedSince,
  listClosedSince,
} = require('../conversations/conversation.repository');

const router = express.Router();

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const SINCE_WINDOW_MS = 24 * 60 * 60 * 1000;

function sinceNow() {
  return new Date(Date.now() - SINCE_WINDOW_MS);
}

router.get('/conversations', requireAuth, requireRole('admin'), async (req, res) => {
  const [inProgress, waiting, inAutomation, closedTodayCount] = await Promise.all([
    listInProgressConversations(),
    listWaitingForAgentConversations(),
    listInAutomationConversations(),
    countClosedSince(sinceNow()),
  ]);
  res.json({ inProgress, waiting, inAutomation, closedTodayCount });
});

router.get('/conversations/closed-today', requireAuth, requireRole('admin'), async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || DEFAULT_LIMIT, MAX_LIMIT);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const since = sinceNow();
  const [items, total] = await Promise.all([listClosedSince(since, { limit, offset }), countClosedSince(since)]);
  res.json({ items, hasMore: offset + items.length < total });
});

module.exports = router;
```

Register it in `src/server.js`. Add the require near the other admin route requires (right after `const adminIntegrationsRoutes = require('./api/admin-integrations.routes');`):

```javascript
const adminDashboardRoutes = require('./api/admin-dashboard.routes');
```

Add the mount right after `app.use('/api/admin/integrations', adminIntegrationsRoutes);`:

```javascript
app.use('/api/admin/dashboard', adminDashboardRoutes);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- admin-dashboard.routes.test.js`
Expected: PASS. Then run: `npm test` (full backend suite) to confirm `server.js`'s own tests (if any import the full app) still pass with the new route mounted.

- [ ] **Step 5: Commit**

```bash
git add src/api/admin-dashboard.routes.js src/api/admin-dashboard.routes.test.js src/server.js
git commit -m "Add the admin dashboard conversations endpoints"
```

---

### Task 5: Frontend API client functions

**Files:**
- Modify: `frontend/src/services/api.js`

**Interfaces:**
- Produces: `getDashboardConversations(token)`, `getDashboardClosedToday({offset, limit}, token)`.

- [ ] **Step 1: Implement (no separate test file — `services/api.js` has no dedicated test file in this project; it's exercised indirectly through the hooks/components that call it, covered in Tasks 6-7)**

In `frontend/src/services/api.js`, add these two functions right after `listChannelsForAgent`:

```javascript
export function getDashboardConversations(token) {
  return apiFetch('/api/admin/dashboard/conversations', { token });
}

export function getDashboardClosedToday({ offset = 0, limit = 20 } = {}, token) {
  return apiFetch(`/api/admin/dashboard/conversations/closed-today?offset=${offset}&limit=${limit}`, { token });
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/services/api.js
git commit -m "Add API client functions for the attendance dashboard"
```

---

### Task 6: `useAttendanceDashboard` hook

**Files:**
- Create: `frontend/src/hooks/useAttendanceDashboard.js`
- Create: `frontend/src/hooks/useAttendanceDashboard.test.jsx`

**Interfaces:**
- Consumes: `getDashboardConversations(token)` from Task 5; `useAuth()` (`../contexts/AuthContext`), `useSocket()` (`../contexts/SocketContext`) — same pattern as `useQueue.js`.
- Produces: `useAttendanceDashboard(): { inProgress: ConversationSummary[], waiting: ConversationSummary[], inAutomation: ConversationSummary[], closedTodayCount: number, loading: boolean, refresh: () => void }`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/hooks/useAttendanceDashboard.test.jsx`:

```jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useAttendanceDashboard } from './useAttendanceDashboard';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import { getDashboardConversations } from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../contexts/SocketContext');
vi.mock('../services/api');

function makeFakeSocket() {
  const handlers = {};
  return {
    on: vi.fn((event, handler) => {
      handlers[event] = handler;
    }),
    off: vi.fn(),
    emit(event, payload) {
      handlers[event] && handlers[event](payload);
    },
  };
}

describe('useAttendanceDashboard', () => {
  let socket;

  beforeEach(() => {
    vi.clearAllMocks();
    useAuth.mockReturnValue({ token: 'tok-123' });
    socket = makeFakeSocket();
    useSocket.mockReturnValue(socket);
  });

  test('fetches the initial snapshot on mount', async () => {
    getDashboardConversations.mockResolvedValue({
      inProgress: [{ id: 'c1', status: 'assigned' }],
      waiting: [{ id: 'c2', status: 'waiting', triageState: null }],
      inAutomation: [{ id: 'c3', status: 'waiting', triageState: 'pending' }],
      closedTodayCount: 4,
    });

    const { result } = renderHook(() => useAttendanceDashboard());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.inProgress).toEqual([{ id: 'c1', status: 'assigned' }]);
    expect(result.current.waiting).toEqual([{ id: 'c2', status: 'waiting', triageState: null }]);
    expect(result.current.inAutomation).toEqual([{ id: 'c3', status: 'waiting', triageState: 'pending' }]);
    expect(result.current.closedTodayCount).toBe(4);
  });

  test('upserts an assigned conversation into inProgress and removes it from the other lists on a dashboard:conversation event', async () => {
    getDashboardConversations.mockResolvedValue({
      inProgress: [],
      waiting: [{ id: 'c1', status: 'waiting', triageState: null }],
      inAutomation: [],
      closedTodayCount: 0,
    });
    const { result } = renderHook(() => useAttendanceDashboard());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      socket.emit('dashboard:conversation', { conversation: { id: 'c1', status: 'assigned', triageState: 'completed' } });
    });

    expect(result.current.inProgress).toEqual([{ id: 'c1', status: 'assigned', triageState: 'completed' }]);
    expect(result.current.waiting).toEqual([]);
  });

  test('moves a conversation into inAutomation when triageState becomes pending', async () => {
    getDashboardConversations.mockResolvedValue({ inProgress: [], waiting: [], inAutomation: [], closedTodayCount: 0 });
    const { result } = renderHook(() => useAttendanceDashboard());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      socket.emit('dashboard:conversation', { conversation: { id: 'c9', status: 'waiting', triageState: 'pending' } });
    });

    expect(result.current.inAutomation).toEqual([{ id: 'c9', status: 'waiting', triageState: 'pending' }]);
    expect(result.current.waiting).toEqual([]);
  });

  test('removes a conversation from every live list when it closes, and increments closedTodayCount', async () => {
    getDashboardConversations.mockResolvedValue({
      inProgress: [{ id: 'c1', status: 'assigned' }],
      waiting: [],
      inAutomation: [],
      closedTodayCount: 2,
    });
    const { result } = renderHook(() => useAttendanceDashboard());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      socket.emit('dashboard:conversation', {
        conversation: { id: 'c1', status: 'closed' },
        closedAt: '2026-09-09T12:00:00.000Z',
      });
    });

    expect(result.current.inProgress).toEqual([]);
    expect(result.current.closedTodayCount).toBe(3);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run useAttendanceDashboard`
Expected: FAIL — `Failed to resolve import "./useAttendanceDashboard"`.

- [ ] **Step 3: Implement**

Create `frontend/src/hooks/useAttendanceDashboard.js`:

```javascript
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import { getDashboardConversations } from '../services/api';

function upsert(list, conversation) {
  const index = list.findIndex((c) => c.id === conversation.id);
  if (index === -1) return [...list, conversation];
  const next = [...list];
  next[index] = conversation;
  return next;
}

function remove(list, id) {
  return list.filter((c) => c.id !== id);
}

export function useAttendanceDashboard() {
  const { token } = useAuth();
  const socket = useSocket();
  const [inProgress, setInProgress] = useState([]);
  const [waiting, setWaiting] = useState([]);
  const [inAutomation, setInAutomation] = useState([]);
  const [closedTodayCount, setClosedTodayCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    if (!token) return Promise.resolve();
    setLoading(true);
    return getDashboardConversations(token)
      .then((data) => {
        setInProgress(data.inProgress);
        setWaiting(data.waiting);
        setInAutomation(data.inAutomation);
        setClosedTodayCount(data.closedTodayCount);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!socket) return undefined;

    function onDashboardConversation({ conversation, closedAt }) {
      const isInProgress = conversation.status === 'assigned';
      const isInAutomation = conversation.triageState === 'pending';
      const isWaiting = conversation.status === 'waiting' && !isInAutomation;

      setInProgress((prev) => (isInProgress ? upsert(prev, conversation) : remove(prev, conversation.id)));
      setWaiting((prev) => (isWaiting ? upsert(prev, conversation) : remove(prev, conversation.id)));
      setInAutomation((prev) => (isInAutomation ? upsert(prev, conversation) : remove(prev, conversation.id)));

      if (closedAt) {
        setClosedTodayCount((prev) => prev + 1);
      }
    }

    socket.on('dashboard:conversation', onDashboardConversation);
    return () => socket.off('dashboard:conversation', onDashboardConversation);
  }, [socket]);

  return { inProgress, waiting, inAutomation, closedTodayCount, loading, refresh };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run useAttendanceDashboard`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useAttendanceDashboard.js frontend/src/hooks/useAttendanceDashboard.test.jsx
git commit -m "Add the useAttendanceDashboard hook"
```

---

### Task 7: `AttendanceDashboardPage` — 4 columns, filters, load more

**Files:**
- Create: `frontend/src/pages/AttendanceDashboardPage.jsx`
- Create: `frontend/src/pages/AttendanceDashboardPage.test.jsx`

**Interfaces:**
- Consumes: `useAttendanceDashboard()` (Task 6), `getDashboardClosedToday` (Task 5), `useChannels(enabled, includeHidden)` returning `{channels, loading, refresh}`, `useAgents()` returning an array of `{id, email, role, name, online}`, `useSectors()` returning `{sectors, loading, refresh}`, `ConversationListItem` (`../components/ConversationListItem`, props `conversation`, `onSelect(id)`, `selected`, optional `unread`), `useNavigate` from `react-router-dom`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/pages/AttendanceDashboardPage.test.jsx`:

```jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import AttendanceDashboardPage from './AttendanceDashboardPage';
import { useAttendanceDashboard } from '../hooks/useAttendanceDashboard';
import { useChannels } from '../hooks/useChannels';
import { useAgents } from '../hooks/useAgents';
import { useSectors } from '../hooks/useSectors';
import { useAuth } from '../contexts/AuthContext';
import { getDashboardClosedToday } from '../services/api';

vi.mock('../hooks/useAttendanceDashboard');
vi.mock('../hooks/useChannels');
vi.mock('../hooks/useAgents');
vi.mock('../hooks/useSectors');
vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

function renderPage() {
  return render(
    <MemoryRouter>
      <AttendanceDashboardPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
  useChannels.mockReturnValue({ channels: [{ id: 'chan-1', name: 'WhatsApp Vendas' }], loading: false, refresh: vi.fn() });
  useAgents.mockReturnValue([{ id: 'agent-1', name: 'Ana', email: 'ana@dw.com' }]);
  useSectors.mockReturnValue({ sectors: [{ id: 'sector-1', name: 'Financeiro' }], loading: false, refresh: vi.fn() });
  getDashboardClosedToday.mockResolvedValue({ items: [], hasMore: false });
  useAttendanceDashboard.mockReturnValue({
    inProgress: [{ id: 'c1', contactDisplayName: 'Carlos', channelId: 'chan-1', assignedAgentId: 'agent-1', sectorId: 'sector-1' }],
    waiting: [{ id: 'c2', contactDisplayName: 'Maria', channelId: 'chan-1', assignedAgentId: null, sectorId: null }],
    inAutomation: [{ id: 'c3', contactDisplayName: 'Joao', channelId: 'chan-1', assignedAgentId: null, sectorId: null }],
    closedTodayCount: 0,
    loading: false,
    refresh: vi.fn(),
  });
});

describe('AttendanceDashboardPage', () => {
  test('renders the 4 columns with their conversations', () => {
    renderPage();
    expect(screen.getByText('Em andamento')).toBeInTheDocument();
    expect(screen.getByText('Carlos')).toBeInTheDocument();
    expect(screen.getByText('Em espera')).toBeInTheDocument();
    expect(screen.getByText('Maria')).toBeInTheDocument();
    expect(screen.getByText('Na automação')).toBeInTheDocument();
    expect(screen.getByText('Joao')).toBeInTheDocument();
    expect(screen.getByText('Encerrados hoje')).toBeInTheDocument();
  });

  test('clicking a card navigates to / with the conversation as pendingConversation state', async () => {
    renderPage();
    await userEvent.click(screen.getByText('Carlos'));
    expect(mockNavigate).toHaveBeenCalledWith('/', {
      state: {
        pendingConversation: { id: 'c1', contactDisplayName: 'Carlos', channelId: 'chan-1', assignedAgentId: 'agent-1', sectorId: 'sector-1' },
      },
    });
  });

  test('filtering by channel hides conversations from other channels', async () => {
    useChannels.mockReturnValue({
      channels: [
        { id: 'chan-1', name: 'WhatsApp Vendas' },
        { id: 'chan-2', name: 'WhatsApp Suporte' },
      ],
      loading: false,
      refresh: vi.fn(),
    });
    renderPage();
    expect(screen.getByText('Carlos')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /canais/i }));
    await userEvent.click(screen.getByLabelText('WhatsApp Suporte'));

    expect(screen.queryByText('Carlos')).not.toBeInTheDocument();
  });

  test('shows a "Carregar mais" button for Encerrados hoje when there are more pages, and loads the next page on click', async () => {
    getDashboardClosedToday
      .mockResolvedValueOnce({ items: [{ id: 'c10', contactDisplayName: 'Pedro', channelId: 'chan-1' }], hasMore: true })
      .mockResolvedValueOnce({ items: [{ id: 'c11', contactDisplayName: 'Rita', channelId: 'chan-1' }], hasMore: false });

    renderPage();
    expect(await screen.findByText('Pedro')).toBeInTheDocument();
    const loadMore = screen.getByRole('button', { name: /carregar mais/i });

    await userEvent.click(loadMore);

    expect(await screen.findByText('Rita')).toBeInTheDocument();
    expect(getDashboardClosedToday).toHaveBeenCalledWith({ offset: 1, limit: 20 }, 'tok-123');
    expect(screen.queryByRole('button', { name: /carregar mais/i })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run AttendanceDashboardPage`
Expected: FAIL — `Failed to resolve import "./AttendanceDashboardPage"`.

- [ ] **Step 3: Implement**

Create `frontend/src/pages/AttendanceDashboardPage.jsx`:

```jsx
import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useAttendanceDashboard } from '../hooks/useAttendanceDashboard';
import { useChannels } from '../hooks/useChannels';
import { useAgents } from '../hooks/useAgents';
import { useSectors } from '../hooks/useSectors';
import { getDashboardClosedToday } from '../services/api';
import ConversationListItem from '../components/ConversationListItem';

const CLOSED_PAGE_SIZE = 20;

function matchesFilters(conversation, { channelIds, agentIds, sectorIds }) {
  if (channelIds.length > 0 && !channelIds.includes(conversation.channelId)) return false;
  if (agentIds.length > 0 && !agentIds.includes(conversation.assignedAgentId)) return false;
  if (sectorIds.length > 0 && !sectorIds.includes(conversation.sectorId)) return false;
  return true;
}

function FilterDropdown({ label, options, selected, onToggle }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="rounded-full border border-wa-border bg-wa-panel px-3 py-1.5 text-[13px] text-wa-text hover:bg-wa-hover"
      >
        {label}
        {selected.length > 0 && <span className="ml-1.5 font-medium">{selected.length}</span>}
      </button>
      {open && (
        <div className="absolute z-10 mt-1 max-h-64 w-56 overflow-y-auto rounded-lg border border-wa-border bg-wa-panel p-2 shadow-lg">
          {options.length === 0 ? (
            <p className="px-2 py-1 text-[13px] text-wa-muted">Nenhuma opção</p>
          ) : (
            options.map((option) => (
              <label key={option.value} className="flex items-center gap-2 rounded px-2 py-1 text-[13px] hover:bg-wa-hover">
                <input type="checkbox" checked={selected.includes(option.value)} onChange={() => onToggle(option.value)} />
                {option.label}
              </label>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function DashboardColumn({ title, count, conversations, onSelect, emptyMessage, footer }) {
  return (
    <div className="flex min-w-[280px] flex-1 flex-col rounded-lg border border-wa-border bg-wa-panel">
      <div className="flex items-center justify-between border-b border-wa-border px-4 py-3">
        <h2 className="text-[15px] font-semibold text-wa-text">{title}</h2>
        <span className="rounded-full bg-wa-chip px-2 py-[1px] text-[12px] font-medium text-wa-chip-text">{count}</span>
      </div>
      <div className="wa-scroll min-h-0 flex-1 overflow-y-auto">
        {conversations.length === 0 ? (
          <p className="px-4 py-8 text-center text-[13px] text-wa-muted">{emptyMessage}</p>
        ) : (
          <ul>
            {conversations.map((conversation) => (
              <ConversationListItem key={conversation.id} conversation={conversation} onSelect={onSelect} selected={false} />
            ))}
          </ul>
        )}
      </div>
      {footer}
    </div>
  );
}

function AttendanceDashboardPage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const { inProgress, waiting, inAutomation, closedTodayCount } = useAttendanceDashboard();
  const { channels } = useChannels(true);
  const agents = useAgents();
  const { sectors } = useSectors();

  const [channelFilter, setChannelFilter] = useState([]);
  const [agentFilter, setAgentFilter] = useState([]);
  const [sectorFilter, setSectorFilter] = useState([]);

  const [closedItems, setClosedItems] = useState([]);
  const [closedOffset, setClosedOffset] = useState(0);
  const [closedHasMore, setClosedHasMore] = useState(false);
  const [loadingClosed, setLoadingClosed] = useState(false);

  useEffect(() => {
    if (!token) return;
    getDashboardClosedToday({ offset: 0, limit: CLOSED_PAGE_SIZE }, token).then((data) => {
      setClosedItems(data.items);
      setClosedOffset(data.items.length);
      setClosedHasMore(data.hasMore);
    });
  }, [token]);

  function loadMoreClosed() {
    setLoadingClosed(true);
    getDashboardClosedToday({ offset: closedOffset, limit: CLOSED_PAGE_SIZE }, token)
      .then((data) => {
        setClosedItems((prev) => [...prev, ...data.items]);
        setClosedOffset((prev) => prev + data.items.length);
        setClosedHasMore(data.hasMore);
        setLoadingClosed(false);
      })
      .catch(() => setLoadingClosed(false));
  }

  const filters = useMemo(
    () => ({ channelIds: channelFilter, agentIds: agentFilter, sectorIds: sectorFilter }),
    [channelFilter, agentFilter, sectorFilter]
  );

  const filteredInProgress = inProgress.filter((c) => matchesFilters(c, filters));
  const filteredWaiting = waiting.filter((c) => matchesFilters(c, filters));
  const filteredInAutomation = inAutomation.filter((c) => matchesFilters(c, filters));
  const filteredClosed = closedItems.filter((c) => matchesFilters(c, filters));

  function openConversation(conversationId) {
    const conversation =
      filteredInProgress.find((c) => c.id === conversationId) ||
      filteredWaiting.find((c) => c.id === conversationId) ||
      filteredInAutomation.find((c) => c.id === conversationId) ||
      filteredClosed.find((c) => c.id === conversationId);
    navigate('/', { state: { pendingConversation: conversation } });
  }

  function toggleFilterValue(setFilter, value) {
    setFilter((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  }

  return (
    <div className="flex h-dvh flex-col bg-wa-page font-wa text-wa-text">
      <header className="flex items-center justify-between border-b border-wa-border px-6 py-4">
        <h1 className="text-[19px] font-bold text-wa-green-dark">Dashboard de atendimento</h1>
      </header>

      <div className="flex flex-wrap gap-3 border-b border-wa-border px-6 py-3">
        <FilterDropdown
          label="Canais"
          options={channels.map((c) => ({ value: c.id, label: c.name }))}
          selected={channelFilter}
          onToggle={(value) => toggleFilterValue(setChannelFilter, value)}
        />
        <FilterDropdown
          label="Atendentes"
          options={agents.map((a) => ({ value: a.id, label: a.name || a.email }))}
          selected={agentFilter}
          onToggle={(value) => toggleFilterValue(setAgentFilter, value)}
        />
        <FilterDropdown
          label="Departamentos"
          options={sectors.map((s) => ({ value: s.id, label: s.name }))}
          selected={sectorFilter}
          onToggle={(value) => toggleFilterValue(setSectorFilter, value)}
        />
      </div>

      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-4">
        <DashboardColumn
          title="Em andamento"
          count={filteredInProgress.length}
          conversations={filteredInProgress}
          onSelect={openConversation}
          emptyMessage="Nenhum atendimento em andamento."
        />
        <DashboardColumn
          title="Em espera"
          count={filteredWaiting.length}
          conversations={filteredWaiting}
          onSelect={openConversation}
          emptyMessage="Nenhuma conversa aguardando."
        />
        <DashboardColumn
          title="Na automação"
          count={filteredInAutomation.length}
          conversations={filteredInAutomation}
          onSelect={openConversation}
          emptyMessage="Nenhuma conversa em triagem automática."
        />
        <DashboardColumn
          title="Encerrados hoje"
          count={closedTodayCount}
          conversations={filteredClosed}
          onSelect={openConversation}
          emptyMessage="Nenhum atendimento encerrado nas últimas 24 horas."
          footer={
            closedHasMore && (
              <button
                type="button"
                onClick={loadMoreClosed}
                disabled={loadingClosed}
                className="border-t border-wa-border px-4 py-2 text-[13px] font-medium text-wa-green-dark hover:bg-wa-hover disabled:opacity-50"
              >
                {loadingClosed ? 'Carregando...' : 'Carregar mais'}
              </button>
            )
          }
        />
      </div>
    </div>
  );
}

export default AttendanceDashboardPage;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run AttendanceDashboardPage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/AttendanceDashboardPage.jsx frontend/src/pages/AttendanceDashboardPage.test.jsx
git commit -m "Add the AttendanceDashboardPage with filters and load-more"
```

---

### Task 8: Route and nav link

**Files:**
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/pages/DashboardPage.jsx`
- Test: `frontend/src/pages/DashboardPage.test.jsx`

**Interfaces:**
- Consumes: `AttendanceDashboardPage` (Task 7).

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/pages/DashboardPage.test.jsx`, inside `describe('DashboardPage', ...)`:

```jsx
  test('shows a link to the attendance dashboard for an admin, and not for a regular agent', () => {
    useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'agent-1', role: 'admin' }, logout: vi.fn() });
    useQueue.mockReturnValue([]);
    useMyConversations.mockReturnValue([]);
    renderDashboard();
    expect(screen.getByLabelText('Dashboard de atendimento')).toBeInTheDocument();
  });

  test('does not show the attendance dashboard link for a non-admin agent', () => {
    useQueue.mockReturnValue([]);
    useMyConversations.mockReturnValue([]);
    renderDashboard();
    expect(screen.queryByLabelText('Dashboard de atendimento')).not.toBeInTheDocument();
  });
```

(The `beforeEach` already sets `useAuth.mockReturnValue({ ..., agent: { id: 'agent-1', role: 'agent' }, ... })`, which is what the second test relies on — it doesn't override it.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run DashboardPage`
Expected: FAIL — `Unable to find a label with the text of: Dashboard de atendimento` on the first new test.

- [ ] **Step 3: Implement**

In `frontend/src/App.jsx`, add the import:

```jsx
import AttendanceDashboardPage from './pages/AttendanceDashboardPage';
```

Add the route, right after the `/admin/channels` route:

```jsx
            <Route
              path="/admin/dashboard"
              element={
                <ProtectedRoute requireAdmin>
                  <AttendanceDashboardPage />
                </ProtectedRoute>
              }
            />
```

In `frontend/src/pages/DashboardPage.jsx`, add `IconTeam` to the icon import:

```jsx
import {
  IconChats,
  IconChart,
  IconSettings,
  IconBellOn,
  IconBellOff,
  IconKey,
  IconLogout,
  IconNewChat,
  IconSearch,
  IconLock,
  IconEmptyChat,
  IconTeam,
} from '../components/icons/WaIcons';
```

Add the nav link right before the existing `{agent?.role === 'admin' && (...)}` block for "Administração" (both end up inside the same conditional, as siblings):

```jsx
            {agent?.role === 'admin' && (
              <>
                <RailLink to="/admin/dashboard" label="Dashboard de atendimento">
                  <IconTeam size={22} />
                </RailLink>
                <RailLink to="/admin/channels" label="Administração">
                  <IconSettings size={22} />
                </RailLink>
              </>
            )}
```

(This replaces the existing single-`RailLink` block for `/admin/channels` with the fragment above containing both links.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run DashboardPage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.jsx frontend/src/pages/DashboardPage.jsx frontend/src/pages/DashboardPage.test.jsx
git commit -m "Wire up the attendance dashboard route and nav link"
```

---

### Task 9: Open a conversation passed in from the attendance dashboard

**Files:**
- Modify: `frontend/src/pages/DashboardPage.jsx`
- Test: `frontend/src/pages/DashboardPage.test.jsx`

**Interfaces:**
- Consumes: `location.state.pendingConversation` (set by `AttendanceDashboardPage`'s `navigate('/', { state: { pendingConversation } })` from Task 7).

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/pages/DashboardPage.test.jsx`, inside `describe('DashboardPage', ...)`:

```jsx
  test('opens a conversation passed in via location.state.pendingConversation, even when not in queue or myConversations', () => {
    useQueue.mockReturnValue([]);
    useMyConversations.mockReturnValue([]);
    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: '/',
            state: {
              pendingConversation: {
                id: 'conv-other-agent',
                contactDisplayName: 'Cliente de Outro Atendente',
                assignedAgentId: 'agent-2',
                status: 'assigned',
              },
            },
          },
        ]}
      >
        <DashboardPage />
      </MemoryRouter>
    );
    expect(screen.getByText('Cliente de Outro Atendente')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run DashboardPage`
Expected: FAIL — the empty-state placeholder ("Selecione uma conversa...") renders instead of the conversation, since nothing yet consumes `location.state`.

- [ ] **Step 3: Implement**

In `frontend/src/pages/DashboardPage.jsx`, update the `react-router-dom` import:

```jsx
import { Link, useLocation, useNavigate } from 'react-router-dom';
```

Add these two hook calls right after `const { agent, logout } = useAuth();`:

```jsx
  const location = useLocation();
  const navigate = useNavigate();
```

Add this effect right after the existing `useEffect` that clears `pendingConversation` once it appears in `queue`/`myConversations` (so it runs once, right after the component and its other state are set up):

```jsx
  useEffect(() => {
    if (location.state && location.state.pendingConversation) {
      const conversation = location.state.pendingConversation;
      setPendingConversation(conversation);
      setSelectedId(conversation.id);
      navigate(location.pathname, { replace: true, state: null });
    }
    // Only ever consume the one-shot navigation payload on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run DashboardPage`
Expected: PASS (all tests in the file, including the ones from Task 8).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/DashboardPage.jsx frontend/src/pages/DashboardPage.test.jsx
git commit -m "Let DashboardPage open a conversation passed in via navigation state"
```

---

## Final verification

After Task 9, run both full suites clean before considering the feature done:

```bash
npm test
cd frontend && npx vitest run
```

Expected: all backend and frontend tests pass, no failures introduced in files this plan didn't touch.
