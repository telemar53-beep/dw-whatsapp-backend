# Atribuir um Atendimento — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an agent claims/starts a conversation, the customer automatically
receives a personalized opening message (time-of-day greeting + agent's first name +
sequential protocol number); a matching closing message fires when the conversation is
closed. Both are gated by an admin-selectable set of agents AND channels.

**Architecture:** A new `assignment-messages` module owns a singleton config table
(mirrors `sgp_query_config`), an atomic protocol-number claim on `conversations`, and a
named-placeholder substitution engine (`@chat_saudacao_maiusculo`, `@chat_atendente`,
`@chat_protocolo`) independent of the Meta official-template system. Two service
functions (`sendOpeningMessageIfApplicable`, `sendClosingMessageIfApplicable`) are
called from the existing `/claim`, `/start`, and `/close` conversation routes inside
try/catch blocks that never change those routes' existing status codes. A new admin
route and a new UI section in `MessagesAdminTab.jsx` let the admin configure it.

**Tech Stack:** Node.js/Express, PostgreSQL (node-pg-migrate), Jest + supertest
(backend), React, Vitest + Testing Library (frontend).

**Spec:** `docs/superpowers/specs/2026-09-10-assignment-message-design.md`

## Global Constraints

- Placeholder tokens, verbatim, case-sensitive: `@chat_saudacao_maiusculo`,
  `@chat_atendente`, `@chat_protocolo`.
- Greeting time boundaries (server local time, `Date#getHours()`): `0-11` → `Bom dia`,
  `12-17` → `Boa tarde`, `18-23` → `Boa noite`. Normal sentence-start capitalization
  (`Bom dia`), never all-caps (`BOM DIA`).
- Admin route mount path: `/api/admin/assignment-message` (singular, singleton —
  mirrors how `sgp-query-config` lives under `/api/admin/integrations`).
- The closing message does **not** re-check `enabled`/agent-list/channel-list — it
  fires whenever `conversation.protocolNumber` is already set (meaning the opening
  logic already ran for that conversation at claim time). This keeps the
  opening/closing pair consistent even if the admin edits the agent/channel selection
  mid-conversation. See spec section 5.
- `POST /:id/transfer` never triggers either message — only `/claim`, `/start` (which
  calls `claimConversation` internally), and `/close`.
- Only `claimConversation` and `closeConversation` in `conversation.repository.js` gain
  `protocol_number` in their `RETURNING` clause. Do **not** touch
  `listWaitingConversations`, `listInProgressConversations`,
  `listWaitingForAgentConversations`, `listInAutomationConversations`,
  `listClosedSince`, `listConversationsByAgent`, `getConversationWithContact`, or any
  other listing/read function — nothing in this feature consumes `protocol_number` from
  them (YAGNI).
- Every migration statement uses `IF NOT EXISTS`/`IF EXISTS` — this project's deploy
  process sometimes needs migrations pre-applied by hand before `migrate up` runs, and a
  non-idempotent migration has broken that before (see the city-notice feature).
- Every git commit this plan produces ends with the trailer
  `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` — spell this out verbatim in
  every implementer dispatch; omitting it makes the subagent default to its own model
  identity in the trailer.

---

### Task 1: Migration — sequence, config tables, protocol_number column

**Files:**
- Create: `migrations/1788870000000_create-assignment-message-tables.js`

**Interfaces:**
- Produces: table `assignment_message_config` (columns: `id`, `enabled`,
  `opening_message`, `closing_message`, `created_at`, `updated_at`), table
  `assignment_message_agents` (column: `agent_id`, PK, FK → `agents(id)` ON DELETE
  CASCADE), table `assignment_message_channels` (column: `channel_id`, PK, FK →
  `channels(id)` ON DELETE CASCADE), sequence `assignment_protocol_seq`, column
  `conversations.protocol_number` (INTEGER, nullable). All consumed by Task 3 (config
  tables + sequence) and Task 4 (protocol_number column).

- [ ] **Step 1: Write the migration**

```js
exports.up = (pgm) => {
  pgm.sql(`CREATE SEQUENCE IF NOT EXISTS assignment_protocol_seq START 1;`);

  pgm.sql(`
    CREATE TABLE IF NOT EXISTS assignment_message_config (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      enabled BOOLEAN NOT NULL DEFAULT false,
      opening_message TEXT NOT NULL DEFAULT '',
      closing_message TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  pgm.sql(`
    CREATE TABLE IF NOT EXISTS assignment_message_agents (
      agent_id UUID PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE
    );
  `);

  pgm.sql(`
    CREATE TABLE IF NOT EXISTS assignment_message_channels (
      channel_id UUID PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE
    );
  `);

  pgm.sql(`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS protocol_number INTEGER;`);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE conversations DROP COLUMN IF EXISTS protocol_number;`);
  pgm.sql(`DROP TABLE IF EXISTS assignment_message_channels;`);
  pgm.sql(`DROP TABLE IF EXISTS assignment_message_agents;`);
  pgm.sql(`DROP TABLE IF EXISTS assignment_message_config;`);
  pgm.sql(`DROP SEQUENCE IF EXISTS assignment_protocol_seq;`);
};
```

- [ ] **Step 2: Run the migration against the local dev database**

Run: `npm run migrate up` (check `package.json` for the exact script name if this
differs — it must match whatever the last migration, `1788860000000_create-city-notices-tables.js`, was applied with).

Expected: migration reports success; `psql` (or any DB client) confirms
`assignment_message_config`, `assignment_message_agents`, `assignment_message_channels`
exist, `assignment_protocol_seq` exists, and `conversations` has a `protocol_number`
column.

- [ ] **Step 3: Commit**

```bash
git add migrations/1788870000000_create-assignment-message-tables.js
git commit -m "$(cat <<'EOF'
Add tables and sequence for the assignment message feature

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Placeholder substitution engine

**Files:**
- Create: `src/assignment-messages/message-placeholders.js`
- Test: `src/assignment-messages/message-placeholders.test.js`

**Interfaces:**
- Produces: `greetingForNow(date = new Date())` → `'Bom dia' | 'Boa tarde' | 'Boa noite'`;
  `firstNameOf(fullName)` → `string`; `substituteAssignmentPlaceholders(template, { agentName, protocolNumber })` →
  `string`. Consumed by Task 5 (`assignment-message.service.js`).

- [ ] **Step 1: Write the failing tests**

```js
const { greetingForNow, firstNameOf, substituteAssignmentPlaceholders } = require('./message-placeholders');

describe('greetingForNow', () => {
  test('returns Bom dia at the start of the morning window (00:00)', () => {
    expect(greetingForNow(new Date(2026, 0, 1, 0, 0))).toBe('Bom dia');
  });

  test('returns Bom dia at the end of the morning window (11:59)', () => {
    expect(greetingForNow(new Date(2026, 0, 1, 11, 59))).toBe('Bom dia');
  });

  test('returns Boa tarde at the start of the afternoon window (12:00)', () => {
    expect(greetingForNow(new Date(2026, 0, 1, 12, 0))).toBe('Boa tarde');
  });

  test('returns Boa tarde at the end of the afternoon window (17:59)', () => {
    expect(greetingForNow(new Date(2026, 0, 1, 17, 59))).toBe('Boa tarde');
  });

  test('returns Boa noite at the start of the evening window (18:00)', () => {
    expect(greetingForNow(new Date(2026, 0, 1, 18, 0))).toBe('Boa noite');
  });

  test('returns Boa noite at the end of the evening window (23:59)', () => {
    expect(greetingForNow(new Date(2026, 0, 1, 23, 59))).toBe('Boa noite');
  });
});

describe('firstNameOf', () => {
  test('returns the whole name when it is a single word', () => {
    expect(firstNameOf('Geovanna')).toBe('Geovanna');
  });

  test('returns only the first word of a multi-word name', () => {
    expect(firstNameOf('Geovanna Silva Santos')).toBe('Geovanna');
  });

  test('trims and collapses extra whitespace before splitting', () => {
    expect(firstNameOf('  Geovanna   Silva  ')).toBe('Geovanna');
  });
});

describe('substituteAssignmentPlaceholders', () => {
  test('replaces the greeting, agent name and protocol number with the right values', () => {
    const fixedMorning = new Date(2026, 0, 1, 9, 0);
    jest.spyOn(global, 'Date').mockImplementation(() => fixedMorning);
    const template = '@chat_saudacao_maiusculo, meu nome é @chat_atendente. O protocolo do seu atendimento é @chat_protocolo';
    const result = substituteAssignmentPlaceholders(template, {
      agentName: 'Geovanna Silva',
      protocolNumber: 1042,
    });
    global.Date.mockRestore();
    expect(result).toBe('Bom dia, meu nome é Geovanna. O protocolo do seu atendimento é 1042');
  });

  test('leaves text without placeholders unchanged', () => {
    expect(substituteAssignmentPlaceholders('Mensagem fixa sem tokens', { agentName: 'Ana', protocolNumber: 7 })).toBe(
      'Mensagem fixa sem tokens'
    );
  });

  test('replaces a repeated placeholder every time it appears', () => {
    const fixedEvening = new Date(2026, 0, 1, 20, 0);
    jest.spyOn(global, 'Date').mockImplementation(() => fixedEvening);
    const result = substituteAssignmentPlaceholders('@chat_protocolo - @chat_protocolo', { agentName: 'Ana', protocolNumber: 5 });
    global.Date.mockRestore();
    expect(result).toBe('5 - 5');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/assignment-messages/message-placeholders.test.js`
Expected: FAIL with "Cannot find module './message-placeholders'"

- [ ] **Step 3: Implement**

```js
function greetingForNow(date = new Date()) {
  const hour = date.getHours();
  if (hour < 12) return 'Bom dia';
  if (hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

function firstNameOf(fullName) {
  return fullName.trim().split(/\s+/)[0];
}

function substituteAssignmentPlaceholders(template, { agentName, protocolNumber }) {
  return template
    .split('@chat_saudacao_maiusculo').join(greetingForNow())
    .split('@chat_atendente').join(firstNameOf(agentName))
    .split('@chat_protocolo').join(String(protocolNumber));
}

module.exports = { greetingForNow, firstNameOf, substituteAssignmentPlaceholders };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/assignment-messages/message-placeholders.test.js`
Expected: PASS, all tests green

- [ ] **Step 5: Commit**

```bash
git add src/assignment-messages/message-placeholders.js src/assignment-messages/message-placeholders.test.js
git commit -m "$(cat <<'EOF'
Add the assignment-message placeholder substitution engine

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Assignment message config repository (singleton + protocol claim)

**Files:**
- Create: `src/assignment-messages/assignment-message.repository.js`
- Test: `src/assignment-messages/assignment-message.repository.test.js`

**Interfaces:**
- Consumes: `getPool`, `withTransaction` from `../db/pool`. Tables from Task 1.
- Produces: `getAssignmentMessageConfig()` → `Promise<{ id: string|null, enabled: boolean, openingMessage: string, closingMessage: string, agentIds: string[], channelIds: string[] }>`
  (when no config row exists: `{ id: null, enabled: false, openingMessage: '', closingMessage: '', agentIds: [], channelIds: [] }`);
  `upsertAssignmentMessageConfig({ enabled, openingMessage, closingMessage, agentIds, channelIds })` →
  same shape, `id` always set after this call; `claimProtocolNumber(conversationId)` →
  `Promise<number>`. Consumed by Task 5 (`assignment-message.service.js`) and Task 7
  (admin routes).

This is an **integration test** against the real local Postgres, following the exact
pattern of `src/integrations/sgp-query-config.repository.test.js` (TRUNCATE in
`beforeEach`, real `getPool()`/`closePool()`, no mocking).

- [ ] **Step 1: Write the failing tests**

```js
const { getPool, closePool } = require('../db/pool');
const { createAgent } = require('../agents/agent.repository');
const { createChannel } = require('../channels/channel.repository');
const {
  getAssignmentMessageConfig,
  upsertAssignmentMessageConfig,
  claimProtocolNumber,
} = require('./assignment-message.repository');
const { findOrCreateContactByPhoneNumber } = require('../conversations/contact.repository');
const { createConversation } = require('../conversations/conversation.repository');

describe('assignment message repository', () => {
  beforeEach(async () => {
    await getPool().query(
      'TRUNCATE assignment_message_config, assignment_message_agents, assignment_message_channels, conversations, contacts, channels, agents CASCADE'
    );
  });

  afterAll(async () => {
    await closePool();
  });

  test('getAssignmentMessageConfig returns the empty default when nothing is configured', async () => {
    expect(await getAssignmentMessageConfig()).toEqual({
      id: null,
      enabled: false,
      openingMessage: '',
      closingMessage: '',
      agentIds: [],
      channelIds: [],
    });
  });

  test('upsertAssignmentMessageConfig creates the row and the agent/channel selections on first save', async () => {
    const agent = await createAgent({ name: 'Geovanna Silva', email: 'geovanna@dw.com', password: 'secret123', role: 'agent' });
    const channel = await createChannel({
      type: 'meta_cloud',
      name: 'Canal Teste',
      phoneNumber: '+5511999990009',
      config: { phoneNumberId: '111', accessToken: 'tok' },
    });

    const config = await upsertAssignmentMessageConfig({
      enabled: true,
      openingMessage: '@chat_saudacao_maiusculo, meu nome é @chat_atendente',
      closingMessage: 'Encerrando, protocolo @chat_protocolo',
      agentIds: [agent.id],
      channelIds: [channel.id],
    });

    expect(config.enabled).toBe(true);
    expect(config.openingMessage).toBe('@chat_saudacao_maiusculo, meu nome é @chat_atendente');
    expect(config.agentIds).toEqual([agent.id]);
    expect(config.channelIds).toEqual([channel.id]);

    const fetched = await getAssignmentMessageConfig();
    expect(fetched.id).toBe(config.id);
    expect(fetched.agentIds).toEqual([agent.id]);
  });

  test('upsertAssignmentMessageConfig updates the existing row instead of creating a second one', async () => {
    await upsertAssignmentMessageConfig({
      enabled: true,
      openingMessage: 'abertura 1',
      closingMessage: 'fechamento 1',
      agentIds: [],
      channelIds: [],
    });
    const updated = await upsertAssignmentMessageConfig({
      enabled: false,
      openingMessage: 'abertura 2',
      closingMessage: 'fechamento 2',
      agentIds: [],
      channelIds: [],
    });

    expect(updated.enabled).toBe(false);
    expect(updated.openingMessage).toBe('abertura 2');

    const all = await getPool().query('SELECT id FROM assignment_message_config');
    expect(all.rowCount).toBe(1);
  });

  test('upsertAssignmentMessageConfig replaces the agent/channel selection, not appends to it', async () => {
    const agent1 = await createAgent({ email: 'a1@dw.com', password: 'secret123', role: 'agent' });
    const agent2 = await createAgent({ email: 'a2@dw.com', password: 'secret123', role: 'agent' });

    await upsertAssignmentMessageConfig({
      enabled: true,
      openingMessage: 'x',
      closingMessage: 'y',
      agentIds: [agent1.id],
      channelIds: [],
    });
    const updated = await upsertAssignmentMessageConfig({
      enabled: true,
      openingMessage: 'x',
      closingMessage: 'y',
      agentIds: [agent2.id],
      channelIds: [],
    });

    expect(updated.agentIds).toEqual([agent2.id]);
  });

  test('claimProtocolNumber generates a number on the first call for a conversation', async () => {
    const contact = await findOrCreateContactByPhoneNumber('+5511977776666', 'Joao');
    const channel = await createChannel({
      type: 'meta_cloud',
      name: 'Canal Teste',
      phoneNumber: '+5511999990009',
      config: { phoneNumberId: '111', accessToken: 'tok' },
    });
    const conversation = await createConversation(contact.id, channel.id);

    const protocolNumber = await claimProtocolNumber(conversation.id);
    expect(typeof protocolNumber).toBe('number');
    expect(protocolNumber).toBeGreaterThan(0);
  });

  test('claimProtocolNumber reuses the same number on a second call for the same conversation', async () => {
    const contact = await findOrCreateContactByPhoneNumber('+5511977776666', 'Joao');
    const channel = await createChannel({
      type: 'meta_cloud',
      name: 'Canal Teste',
      phoneNumber: '+5511999990009',
      config: { phoneNumberId: '111', accessToken: 'tok' },
    });
    const conversation = await createConversation(contact.id, channel.id);

    const first = await claimProtocolNumber(conversation.id);
    const second = await claimProtocolNumber(conversation.id);
    expect(second).toBe(first);
  });

  test('claimProtocolNumber assigns different numbers to different conversations', async () => {
    const contact = await findOrCreateContactByPhoneNumber('+5511977776666', 'Joao');
    const channel = await createChannel({
      type: 'meta_cloud',
      name: 'Canal Teste',
      phoneNumber: '+5511999990009',
      config: { phoneNumberId: '111', accessToken: 'tok' },
    });
    const conversationA = await createConversation(contact.id, channel.id);
    const conversationB = await createConversation(contact.id, channel.id);

    const numberA = await claimProtocolNumber(conversationA.id);
    const numberB = await claimProtocolNumber(conversationB.id);
    expect(numberA).not.toBe(numberB);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/assignment-messages/assignment-message.repository.test.js`
Expected: FAIL with "Cannot find module './assignment-message.repository'"

- [ ] **Step 3: Implement**

```js
const { getPool, withTransaction } = require('../db/pool');

function toConfig(row, agentIds, channelIds) {
  return {
    id: row.id,
    enabled: row.enabled,
    openingMessage: row.opening_message,
    closingMessage: row.closing_message,
    agentIds,
    channelIds,
  };
}

async function fetchAgentIds(client) {
  const result = await client.query('SELECT agent_id FROM assignment_message_agents ORDER BY agent_id');
  return result.rows.map((row) => row.agent_id);
}

async function fetchChannelIds(client) {
  const result = await client.query('SELECT channel_id FROM assignment_message_channels ORDER BY channel_id');
  return result.rows.map((row) => row.channel_id);
}

async function getAssignmentMessageConfig() {
  const pool = getPool();
  const result = await pool.query('SELECT * FROM assignment_message_config ORDER BY created_at ASC LIMIT 1');
  if (result.rowCount === 0) {
    return { id: null, enabled: false, openingMessage: '', closingMessage: '', agentIds: [], channelIds: [] };
  }
  const agentIds = await fetchAgentIds(pool);
  const channelIds = await fetchChannelIds(pool);
  return toConfig(result.rows[0], agentIds, channelIds);
}

async function upsertAssignmentMessageConfig({ enabled, openingMessage, closingMessage, agentIds, channelIds }) {
  return withTransaction(async (client) => {
    const existing = await client.query('SELECT id FROM assignment_message_config ORDER BY created_at ASC LIMIT 1');
    let row;
    if (existing.rowCount === 0) {
      const inserted = await client.query(
        `INSERT INTO assignment_message_config (enabled, opening_message, closing_message)
         VALUES ($1, $2, $3) RETURNING *`,
        [enabled, openingMessage, closingMessage]
      );
      row = inserted.rows[0];
    } else {
      const updated = await client.query(
        `UPDATE assignment_message_config SET enabled = $2, opening_message = $3, closing_message = $4, updated_at = now()
         WHERE id = $1 RETURNING *`,
        [existing.rows[0].id, enabled, openingMessage, closingMessage]
      );
      row = updated.rows[0];
    }

    await client.query('DELETE FROM assignment_message_agents');
    for (const agentId of agentIds) {
      await client.query('INSERT INTO assignment_message_agents (agent_id) VALUES ($1)', [agentId]);
    }

    await client.query('DELETE FROM assignment_message_channels');
    for (const channelId of channelIds) {
      await client.query('INSERT INTO assignment_message_channels (channel_id) VALUES ($1)', [channelId]);
    }

    return toConfig(row, agentIds, channelIds);
  });
}

async function claimProtocolNumber(conversationId) {
  const result = await getPool().query(
    `UPDATE conversations
     SET protocol_number = COALESCE(protocol_number, nextval('assignment_protocol_seq'))
     WHERE id = $1
     RETURNING protocol_number`,
    [conversationId]
  );
  return result.rows[0].protocol_number;
}

module.exports = { getAssignmentMessageConfig, upsertAssignmentMessageConfig, claimProtocolNumber };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/assignment-messages/assignment-message.repository.test.js`
Expected: PASS, all tests green

- [ ] **Step 5: Commit**

```bash
git add src/assignment-messages/assignment-message.repository.js src/assignment-messages/assignment-message.repository.test.js
git commit -m "$(cat <<'EOF'
Add the assignment-message config repository and atomic protocol claim

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Propagate protocol_number through claim/close

**Files:**
- Modify: `src/conversations/conversation.repository.js`
- Test: `src/conversations/conversation.repository.test.js`

**Interfaces:**
- Consumes: `protocol_number` column added to `conversations` in Task 1.
- Produces: `toConversation(row)` now includes `protocolNumber: row.protocol_number`;
  `claimConversation` and `closeConversation`'s resolved objects both carry
  `protocolNumber`. Consumed by Task 5 (`sendClosingMessageIfApplicable` reads
  `conversation.protocolNumber`) and Task 6 (route handlers pass the conversation object
  through).

- [ ] **Step 1: Write the failing tests**

Add these two tests to the existing `describe('conversation repository', ...)` block in
`src/conversations/conversation.repository.test.js`, near the other `claimConversation`/
`closeConversation` tests (around line 66-160):

```js
  test('claimConversation returns protocolNumber as null before any protocol has been claimed', async () => {
    const conversation = await createConversation(contactId, channelId);
    const agent = await createAgent({ email: 'agent-protocol@dw.com', password: 'secret123', role: 'agent' });
    const claimed = await claimConversation(conversation.id, agent.id);
    expect(claimed.protocolNumber).toBeNull();
  });

  test('closeConversation returns the protocol_number set for the conversation, if any', async () => {
    const conversation = await createConversation(contactId, channelId);
    const agent = await createAgent({ email: 'agent-protocol-2@dw.com', password: 'secret123', role: 'agent' });
    await claimConversation(conversation.id, agent.id);
    await getPool().query('UPDATE conversations SET protocol_number = 42 WHERE id = $1', [conversation.id]);

    const closed = await closeConversation(conversation.id, agent.id);
    expect(closed.protocolNumber).toBe(42);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/conversations/conversation.repository.test.js -t "protocolNumber"`
Expected: FAIL — `claimed.protocolNumber` / `closed.protocolNumber` is `undefined`, not
`null`/`42`

- [ ] **Step 3: Implement**

In `src/conversations/conversation.repository.js`:

Modify `toConversation` (around line 3-16):

```js
function toConversation(row) {
  return {
    id: row.id,
    contactId: row.contact_id,
    channelId: row.channel_id,
    status: row.status,
    assignedAgentId: row.assigned_agent_id,
    sectorId: row.sector_id,
    triageState: row.triage_state,
    triageAttempts: row.triage_attempts,
    protocolNumber: row.protocol_number !== undefined ? row.protocol_number : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
```

Modify `claimConversation`'s `RETURNING` clause (around line 54-69):

```js
async function claimConversation(conversationId, agentId) {
  return withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE conversations SET status = 'assigned', assigned_agent_id = $2, triage_state = 'completed', updated_at = now()
       WHERE id = $1 AND assigned_agent_id IS NULL AND status <> 'closed'
       RETURNING id, contact_id, channel_id, status, assigned_agent_id, sector_id, triage_state, triage_attempts, protocol_number, created_at, updated_at`,
      [conversationId, agentId]
    );
    if (result.rowCount === 0) return null;
    await client.query(
      `INSERT INTO conversation_events (conversation_id, event_type, to_agent_id) VALUES ($1, 'assigned', $2)`,
      [conversationId, agentId]
    );
    return toConversation(result.rows[0]);
  });
}
```

Modify `closeConversation`'s `RETURNING` clause (around line 88-103):

```js
async function closeConversation(conversationId, agentId) {
  return withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE conversations SET status = 'closed', updated_at = now()
       WHERE id = $1 AND (assigned_agent_id = $2 OR assigned_agent_id IS NULL) AND status <> 'closed'
       RETURNING id, contact_id, channel_id, status, assigned_agent_id, sector_id, triage_state, triage_attempts, protocol_number, created_at, updated_at`,
      [conversationId, agentId]
    );
    if (result.rowCount === 0) return null;
    await client.query(
      `INSERT INTO conversation_events (conversation_id, event_type, from_agent_id) VALUES ($1, 'closed', $2)`,
      [conversationId, agentId]
    );
    return toConversation(result.rows[0]);
  });
}
```

Do not modify any other function in this file.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/conversations/conversation.repository.test.js`
Expected: PASS, all tests green (including the pre-existing ones — `toConversation` is
shared by every function, so double check nothing else broke)

- [ ] **Step 5: Commit**

```bash
git add src/conversations/conversation.repository.js src/conversations/conversation.repository.test.js
git commit -m "$(cat <<'EOF'
Return protocol_number from claimConversation and closeConversation

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Assignment message service (gating + dispatch)

**Files:**
- Create: `src/assignment-messages/assignment-message.service.js`
- Test: `src/assignment-messages/assignment-message.service.test.js`

**Interfaces:**
- Consumes: `getAssignmentMessageConfig`, `claimProtocolNumber` from
  `./assignment-message.repository` (Task 3); `substituteAssignmentPlaceholders` from
  `./message-placeholders` (Task 2); `findAgentById` from `../agents/agent.repository`;
  `enqueueOutboundMessage` from `../queue/outbound-queue`; a conversation object shaped
  like `{ id, channelId, protocolNumber }` (from Task 4's `toConversation`).
- Produces: `sendOpeningMessageIfApplicable(conversation, agentId)` → `Promise<void>`;
  `sendClosingMessageIfApplicable(conversation, agentId)` → `Promise<void>`. Consumed by
  Task 6 (`conversations.routes.js`).

- [ ] **Step 1: Write the failing tests**

```js
jest.mock('./assignment-message.repository');
jest.mock('../agents/agent.repository');
jest.mock('../queue/outbound-queue');

const { getAssignmentMessageConfig, claimProtocolNumber } = require('./assignment-message.repository');
const { findAgentById } = require('../agents/agent.repository');
const { enqueueOutboundMessage } = require('../queue/outbound-queue');
const { sendOpeningMessageIfApplicable, sendClosingMessageIfApplicable } = require('./assignment-message.service');

const CONVERSATION = { id: 'conv-1', channelId: 'channel-1', protocolNumber: null };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('sendOpeningMessageIfApplicable', () => {
  test('does nothing when the feature is disabled', async () => {
    getAssignmentMessageConfig.mockResolvedValue({ enabled: false, agentIds: ['agent-1'], channelIds: ['channel-1'], openingMessage: 'x' });
    await sendOpeningMessageIfApplicable(CONVERSATION, 'agent-1');
    expect(enqueueOutboundMessage).not.toHaveBeenCalled();
  });

  test('does nothing when the agent is not in the allowed list', async () => {
    getAssignmentMessageConfig.mockResolvedValue({ enabled: true, agentIds: ['agent-other'], channelIds: ['channel-1'], openingMessage: 'x' });
    await sendOpeningMessageIfApplicable(CONVERSATION, 'agent-1');
    expect(enqueueOutboundMessage).not.toHaveBeenCalled();
  });

  test('does nothing when the channel is not in the allowed list', async () => {
    getAssignmentMessageConfig.mockResolvedValue({ enabled: true, agentIds: ['agent-1'], channelIds: ['channel-other'], openingMessage: 'x' });
    await sendOpeningMessageIfApplicable(CONVERSATION, 'agent-1');
    expect(enqueueOutboundMessage).not.toHaveBeenCalled();
  });

  test('claims a protocol number, builds the text and enqueues it when enabled and both lists match', async () => {
    getAssignmentMessageConfig.mockResolvedValue({
      enabled: true,
      agentIds: ['agent-1'],
      channelIds: ['channel-1'],
      openingMessage: 'Olá, meu nome é @chat_atendente, protocolo @chat_protocolo',
    });
    findAgentById.mockResolvedValue({ id: 'agent-1', name: 'Geovanna Silva' });
    claimProtocolNumber.mockResolvedValue(1042);
    enqueueOutboundMessage.mockResolvedValue({ id: 'msg-1' });

    await sendOpeningMessageIfApplicable(CONVERSATION, 'agent-1');

    expect(claimProtocolNumber).toHaveBeenCalledWith('conv-1');
    expect(enqueueOutboundMessage).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      channelId: 'channel-1',
      content: 'Olá, meu nome é Geovanna, protocolo 1042',
    });
  });
});

describe('sendClosingMessageIfApplicable', () => {
  test('does nothing when the conversation has no protocol number', async () => {
    await sendClosingMessageIfApplicable({ ...CONVERSATION, protocolNumber: null }, 'agent-1');
    expect(getAssignmentMessageConfig).not.toHaveBeenCalled();
    expect(enqueueOutboundMessage).not.toHaveBeenCalled();
  });

  test('sends the closing message when a protocol number already exists, without re-checking agent/channel lists', async () => {
    getAssignmentMessageConfig.mockResolvedValue({
      enabled: false,
      agentIds: [],
      channelIds: [],
      closingMessage: 'Encerrando o atendimento @chat_protocolo, @chat_atendente',
    });
    findAgentById.mockResolvedValue({ id: 'agent-1', name: 'Geovanna Silva' });
    enqueueOutboundMessage.mockResolvedValue({ id: 'msg-2' });

    await sendClosingMessageIfApplicable({ ...CONVERSATION, protocolNumber: 1042 }, 'agent-1');

    expect(enqueueOutboundMessage).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      channelId: 'channel-1',
      content: 'Encerrando o atendimento 1042, Geovanna',
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/assignment-messages/assignment-message.service.test.js`
Expected: FAIL with "Cannot find module './assignment-message.service'"

- [ ] **Step 3: Implement**

```js
const { getAssignmentMessageConfig, claimProtocolNumber } = require('./assignment-message.repository');
const { substituteAssignmentPlaceholders } = require('./message-placeholders');
const { findAgentById } = require('../agents/agent.repository');
const { enqueueOutboundMessage } = require('../queue/outbound-queue');

async function sendOpeningMessageIfApplicable(conversation, agentId) {
  const config = await getAssignmentMessageConfig();
  if (!config.enabled) return;
  if (!config.agentIds.includes(agentId)) return;
  if (!config.channelIds.includes(conversation.channelId)) return;

  const agent = await findAgentById(agentId);
  const protocolNumber = await claimProtocolNumber(conversation.id);
  const content = substituteAssignmentPlaceholders(config.openingMessage, {
    agentName: agent.name,
    protocolNumber,
  });
  await enqueueOutboundMessage({ conversationId: conversation.id, channelId: conversation.channelId, content });
}

async function sendClosingMessageIfApplicable(conversation, agentId) {
  if (!conversation.protocolNumber) return;

  const config = await getAssignmentMessageConfig();
  const agent = await findAgentById(agentId);
  const content = substituteAssignmentPlaceholders(config.closingMessage, {
    agentName: agent.name,
    protocolNumber: conversation.protocolNumber,
  });
  await enqueueOutboundMessage({ conversationId: conversation.id, channelId: conversation.channelId, content });
}

module.exports = { sendOpeningMessageIfApplicable, sendClosingMessageIfApplicable };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/assignment-messages/assignment-message.service.test.js`
Expected: PASS, all tests green

- [ ] **Step 5: Commit**

```bash
git add src/assignment-messages/assignment-message.service.js src/assignment-messages/assignment-message.service.test.js
git commit -m "$(cat <<'EOF'
Add the assignment-message gating and dispatch service

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Wire opening/closing dispatch into the conversation routes

**Files:**
- Modify: `src/api/conversations.routes.js`
- Test: `src/api/conversations.routes.test.js`

**Interfaces:**
- Consumes: `sendOpeningMessageIfApplicable`, `sendClosingMessageIfApplicable` from
  `../assignment-messages/assignment-message.service` (Task 5).

- [ ] **Step 1: Write the failing tests**

Add `jest.mock('../assignment-messages/assignment-message.service');` to the top of
`src/api/conversations.routes.test.js`, alongside the other `jest.mock(...)` calls
(around line 1-11), and import the two functions:

```js
const {
  sendOpeningMessageIfApplicable,
  sendClosingMessageIfApplicable,
} = require('../assignment-messages/assignment-message.service');
```

Add this test inside `describe('POST /api/conversations/:id/claim', ...)` (after the
existing tests, around line 203):

```js
  test('calls sendOpeningMessageIfApplicable with the claimed conversation and agent id', async () => {
    const claimedConversation = { id: 'conv-1', status: 'assigned', assignedAgentId: 'agent-1', channelId: 'channel-1', protocolNumber: null };
    claimConversation.mockResolvedValue(claimedConversation);
    getConversationWithContact.mockResolvedValue(claimedConversation);
    await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/claim`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(sendOpeningMessageIfApplicable).toHaveBeenCalledWith(claimedConversation, 'agent-1');
  });

  test('does not call sendOpeningMessageIfApplicable when the claim fails', async () => {
    claimConversation.mockResolvedValue(null);
    await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/claim`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(sendOpeningMessageIfApplicable).not.toHaveBeenCalled();
  });

  test('a failure inside sendOpeningMessageIfApplicable does not break the 200 response', async () => {
    const claimedConversation = { id: 'conv-1', status: 'assigned', assignedAgentId: 'agent-1', channelId: 'channel-1', protocolNumber: null };
    claimConversation.mockResolvedValue(claimedConversation);
    getConversationWithContact.mockResolvedValue(claimedConversation);
    sendOpeningMessageIfApplicable.mockRejectedValue(new Error('boom'));
    const res = await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/claim`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(200);
  });
```

Add this test inside `describe('POST /api/conversations/:id/close', ...)` (after the
existing tests, around line 730):

```js
  test('calls sendClosingMessageIfApplicable with the closed conversation and agent id', async () => {
    const closedConversation = { id: 'conv-1', status: 'closed', assignedAgentId: 'agent-1', channelId: 'channel-1', protocolNumber: 1042 };
    closeConversation.mockResolvedValue(closedConversation);
    await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/close`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(sendClosingMessageIfApplicable).toHaveBeenCalledWith(closedConversation, 'agent-1');
  });

  test('does not call sendClosingMessageIfApplicable when the close fails', async () => {
    closeConversation.mockResolvedValue(null);
    await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/close`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(sendClosingMessageIfApplicable).not.toHaveBeenCalled();
  });

  test('a failure inside sendClosingMessageIfApplicable does not break the 200 response', async () => {
    const closedConversation = { id: 'conv-1', status: 'closed', assignedAgentId: 'agent-1', channelId: 'channel-1', protocolNumber: 1042 };
    closeConversation.mockResolvedValue(closedConversation);
    sendClosingMessageIfApplicable.mockRejectedValue(new Error('boom'));
    const res = await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/close`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(200);
  });
```

Add this test inside `describe('POST /api/conversations/start', ...)` (after the "happy
path" test, around line 950):

```js
  test('calls sendOpeningMessageIfApplicable before enqueuing the typed content, on the happy path', async () => {
    findChannelById.mockResolvedValue(BAILEYS_CHANNEL);
    baileysManager.resolveWhatsAppJid.mockResolvedValue('559899990000');
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-1', phoneNumber: '559899990000' });
    findOpenConversation.mockResolvedValue(null);
    createConversation.mockResolvedValue({ id: CONVERSATION_ID, contactId: 'contact-1', channelId: 'channel-1' });
    const claimedConversation = { id: CONVERSATION_ID, contactId: 'contact-1', channelId: 'channel-1', assignedAgentId: 'agent-1', protocolNumber: null };
    claimConversation.mockResolvedValue(claimedConversation);
    getConversationWithContact.mockResolvedValue({ ...claimedConversation, contactPhoneNumber: '559899990000' });

    const callOrder = [];
    sendOpeningMessageIfApplicable.mockImplementation(async () => { callOrder.push('opening'); });
    enqueueOutboundMessage.mockImplementation(async () => { callOrder.push('enqueue'); return { id: 'msg-1' }; });

    await request(buildApp())
      .post('/api/conversations/start')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ channelId: 'channel-1', phoneNumber: '5598999990000', content: 'Oi, tudo bem?' });

    expect(sendOpeningMessageIfApplicable).toHaveBeenCalledWith(claimedConversation, 'agent-1');
    expect(callOrder).toEqual(['opening', 'enqueue']);
  });
```

Add this test inside `describe('POST /api/conversations/:id/transfer', ...)`:

```js
  test('never calls sendOpeningMessageIfApplicable or sendClosingMessageIfApplicable', async () => {
    transferConversation.mockResolvedValue({ id: 'conv-1', status: 'assigned', assignedAgentId: 'agent-2' });
    await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/transfer`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ toAgentId: 'agent-2' });
    expect(sendOpeningMessageIfApplicable).not.toHaveBeenCalled();
    expect(sendClosingMessageIfApplicable).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/api/conversations.routes.test.js`
Expected: FAIL — the new assertions have nothing to call yet (`sendOpeningMessageIfApplicable`/
`sendClosingMessageIfApplicable` never invoked)

- [ ] **Step 3: Implement**

In `src/api/conversations.routes.js`, add the import near the other repository/service
imports (after the `template-validator` import, around line 24):

```js
const { sendOpeningMessageIfApplicable, sendClosingMessageIfApplicable } = require('../assignment-messages/assignment-message.service');
```

In `router.post('/:id/claim', ...)` (around line 182-192), call it right after
`claimConversation` succeeds, before the existing broadcasts:

```js
router.post('/:id/claim', async (req, res) => {
  const conversation = await claimConversation(req.params.id, req.agent.agentId);
  if (!conversation) {
    return res.status(409).json({ error: 'Conversation already assigned or closed' });
  }
  try {
    await sendOpeningMessageIfApplicable(conversation, req.agent.agentId);
  } catch (err) {
    console.error(`Failed to send assignment opening message for conversation ${conversation.id}`, err);
  }
  const conversationWithContact = await getConversationWithContact(conversation.id);
  broadcast('queue:removed', { conversationId: conversation.id });
  emitToAgent(conversation.assignedAgentId, 'conversation:assigned', { conversation: conversationWithContact });
  broadcastToDashboard('dashboard:conversation', { conversation: conversationWithContact });
  res.json(conversation);
});
```

In `router.post('/start', ...)` (around line 164), call it right before the existing
`enqueueOutboundMessage` call for the agent's typed content:

```js
  try {
    await sendOpeningMessageIfApplicable(claimed, req.agent.agentId);
  } catch (err) {
    console.error(`Failed to send assignment opening message for conversation ${claimed.id}`, err);
  }
  await enqueueOutboundMessage({ conversationId: claimed.id, channelId: channel.id, ...outboundPayload });
```

(This goes right before the existing line
`await enqueueOutboundMessage({ conversationId: claimed.id, channelId: channel.id, ...outboundPayload });`
— do not reorder anything else in this handler.)

In `router.post('/:id/close', ...)` (around line 309-322), call it right after
`closeConversation` succeeds:

```js
router.post('/:id/close', async (req, res) => {
  const conversation = await closeConversation(req.params.id, req.agent.agentId);
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

Do not touch `router.post('/:id/transfer', ...)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/api/conversations.routes.test.js`
Expected: PASS, all tests green

- [ ] **Step 5: Commit**

```bash
git add src/api/conversations.routes.js src/api/conversations.routes.test.js
git commit -m "$(cat <<'EOF'
Dispatch assignment opening/closing messages from claim/start/close

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Admin routes for the assignment message config

**Files:**
- Create: `src/api/admin-assignment-messages.routes.js`
- Test: `src/api/admin-assignment-messages.routes.test.js`
- Modify: `src/server.js`

**Interfaces:**
- Consumes: `getAssignmentMessageConfig`, `upsertAssignmentMessageConfig` from
  `../assignment-messages/assignment-message.repository` (Task 3).
- Produces: `GET /api/admin/assignment-message` → `{ enabled, openingMessage, closingMessage, agentIds, channelIds }`;
  `PUT /api/admin/assignment-message` with the same body shape. Consumed by Task 8
  (`frontend/src/services/api.js`).

- [ ] **Step 1: Write the failing tests**

```js
jest.mock('../assignment-messages/assignment-message.repository');

const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const {
  getAssignmentMessageConfig,
  upsertAssignmentMessageConfig,
} = require('../assignment-messages/assignment-message.repository');
const adminAssignmentMessagesRoutes = require('./admin-assignment-messages.routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/assignment-message', adminAssignmentMessagesRoutes);
  return app;
}

function tokenFor(agentId, role) {
  return jwt.sign({ agentId, role }, process.env.JWT_SECRET);
}

describe('GET /api/admin/assignment-message', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns the current config', async () => {
    getAssignmentMessageConfig.mockResolvedValue({
      id: 'config-1',
      enabled: true,
      openingMessage: 'abertura',
      closingMessage: 'fechamento',
      agentIds: ['agent-1'],
      channelIds: ['channel-1'],
    });
    const res = await request(buildApp())
      .get('/api/admin/assignment-message')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: 'config-1',
      enabled: true,
      openingMessage: 'abertura',
      closingMessage: 'fechamento',
      agentIds: ['agent-1'],
      channelIds: ['channel-1'],
    });
  });

  test('returns id: null when nothing is configured yet', async () => {
    getAssignmentMessageConfig.mockResolvedValue({
      id: null,
      enabled: false,
      openingMessage: '',
      closingMessage: '',
      agentIds: [],
      channelIds: [],
    });
    const res = await request(buildApp())
      .get('/api/admin/assignment-message')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBeNull();
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .get('/api/admin/assignment-message')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(403);
  });
});

describe('PUT /api/admin/assignment-message', () => {
  beforeEach(() => jest.clearAllMocks());

  test('saves the config and returns it', async () => {
    upsertAssignmentMessageConfig.mockResolvedValue({
      id: 'config-1',
      enabled: true,
      openingMessage: 'abertura',
      closingMessage: 'fechamento',
      agentIds: ['agent-1'],
      channelIds: ['channel-1'],
    });
    const res = await request(buildApp())
      .put('/api/admin/assignment-message')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ enabled: true, openingMessage: 'abertura', closingMessage: 'fechamento', agentIds: ['agent-1'], channelIds: ['channel-1'] });
    expect(res.status).toBe(200);
    expect(upsertAssignmentMessageConfig).toHaveBeenCalledWith({
      enabled: true,
      openingMessage: 'abertura',
      closingMessage: 'fechamento',
      agentIds: ['agent-1'],
      channelIds: ['channel-1'],
    });
    expect(res.body.openingMessage).toBe('abertura');
  });

  test('returns 400 when agentIds is not an array', async () => {
    const res = await request(buildApp())
      .put('/api/admin/assignment-message')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ enabled: true, openingMessage: 'x', closingMessage: 'y', agentIds: 'not-an-array', channelIds: [] });
    expect(res.status).toBe(400);
    expect(upsertAssignmentMessageConfig).not.toHaveBeenCalled();
  });

  test('returns 400 when channelIds is not an array', async () => {
    const res = await request(buildApp())
      .put('/api/admin/assignment-message')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ enabled: true, openingMessage: 'x', closingMessage: 'y', agentIds: [], channelIds: 'not-an-array' });
    expect(res.status).toBe(400);
    expect(upsertAssignmentMessageConfig).not.toHaveBeenCalled();
  });

  test('returns 400 when openingMessage is empty', async () => {
    const res = await request(buildApp())
      .put('/api/admin/assignment-message')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ enabled: true, openingMessage: '   ', closingMessage: 'y', agentIds: [], channelIds: [] });
    expect(res.status).toBe(400);
    expect(upsertAssignmentMessageConfig).not.toHaveBeenCalled();
  });

  test('returns 400 when closingMessage is empty', async () => {
    const res = await request(buildApp())
      .put('/api/admin/assignment-message')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ enabled: true, openingMessage: 'x', closingMessage: '', agentIds: [], channelIds: [] });
    expect(res.status).toBe(400);
    expect(upsertAssignmentMessageConfig).not.toHaveBeenCalled();
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .put('/api/admin/assignment-message')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ enabled: true, openingMessage: 'x', closingMessage: 'y', agentIds: [], channelIds: [] });
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/api/admin-assignment-messages.routes.test.js`
Expected: FAIL with "Cannot find module './admin-assignment-messages.routes'"

- [ ] **Step 3: Implement**

Create `src/api/admin-assignment-messages.routes.js`:

```js
const express = require('express');
const { requireAuth, requireRole } = require('../auth/auth.middleware');
const {
  getAssignmentMessageConfig,
  upsertAssignmentMessageConfig,
} = require('../assignment-messages/assignment-message.repository');

const router = express.Router();

function toResponse(config) {
  return {
    id: config.id,
    enabled: config.enabled,
    openingMessage: config.openingMessage,
    closingMessage: config.closingMessage,
    agentIds: config.agentIds,
    channelIds: config.channelIds,
  };
}

router.get('/', requireAuth, requireRole('admin'), async (req, res) => {
  const config = await getAssignmentMessageConfig();
  res.json(toResponse(config));
});

router.put('/', requireAuth, requireRole('admin'), async (req, res) => {
  const { enabled, openingMessage, closingMessage, agentIds, channelIds } = req.body || {};
  if (!Array.isArray(agentIds)) {
    return res.status(400).json({ error: 'agentIds must be an array' });
  }
  if (!Array.isArray(channelIds)) {
    return res.status(400).json({ error: 'channelIds must be an array' });
  }
  if (typeof openingMessage !== 'string' || !openingMessage.trim()) {
    return res.status(400).json({ error: 'openingMessage is required' });
  }
  if (typeof closingMessage !== 'string' || !closingMessage.trim()) {
    return res.status(400).json({ error: 'closingMessage is required' });
  }
  const config = await upsertAssignmentMessageConfig({
    enabled: Boolean(enabled),
    openingMessage,
    closingMessage,
    agentIds,
    channelIds,
  });
  res.json(toResponse(config));
});

module.exports = router;
```

In `src/server.js`, add the require near the other admin route requires (after
`adminDashboardRoutes`, around line 30, following the same numbering as the existing
block):

```js
const adminAssignmentMessagesRoutes = require('./api/admin-assignment-messages.routes');
```

And mount it near the other `app.use('/api/admin/...')` lines (after
`app.use('/api/admin/dashboard', adminDashboardRoutes);`, around line 86):

```js
app.use('/api/admin/assignment-message', adminAssignmentMessagesRoutes);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/api/admin-assignment-messages.routes.test.js`
Expected: PASS, all tests green

- [ ] **Step 5: Commit**

```bash
git add src/api/admin-assignment-messages.routes.js src/api/admin-assignment-messages.routes.test.js src/server.js
git commit -m "$(cat <<'EOF'
Add admin routes to configure the assignment message feature

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Frontend service functions and hook

**Files:**
- Modify: `frontend/src/services/api.js`
- Create: `frontend/src/hooks/useAssignmentMessageConfig.js`
- Test: `frontend/src/hooks/useAssignmentMessageConfig.test.jsx`

**Interfaces:**
- Consumes: `apiFetch` from `./api.js` (already defined).
- Produces: `getAssignmentMessageConfig(token)`, `updateAssignmentMessageConfig(payload, token)`
  in `services/api.js`; `useAssignmentMessageConfig()` → `{ config, loading, refresh }`
  where `config` defaults to `{ id: null, enabled: false, openingMessage: '', closingMessage: '', agentIds: [], channelIds: [] }`
  — `id === null` is the signal for "never configured yet" (mirrors how
  `useSgpQueryConfig` signals its own not-configured state, avoiding the class of bug
  already found and fixed once this session in `SgpQueryConfigCard`, where inferring
  state from field emptiness instead of an explicit flag caused a stale-draft bug).
  Consumed by Task 9 (`MessagesAdminTab.jsx`).

- [ ] **Step 1: Write the failing test**

```jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useAssignmentMessageConfig } from './useAssignmentMessageConfig';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
});

describe('useAssignmentMessageConfig', () => {
  test('fetches the config on mount', async () => {
    api.getAssignmentMessageConfig.mockResolvedValue({
      enabled: true,
      openingMessage: 'abertura',
      closingMessage: 'fechamento',
      agentIds: ['agent-1'],
      channelIds: ['channel-1'],
    });

    const { result } = renderHook(() => useAssignmentMessageConfig());

    await waitFor(() => expect(result.current.config.enabled).toBe(true));
    expect(api.getAssignmentMessageConfig).toHaveBeenCalledWith('tok-123');
  });

  test('starts with the empty default before the fetch resolves', () => {
    api.getAssignmentMessageConfig.mockResolvedValue({ id: null, enabled: false, openingMessage: '', closingMessage: '', agentIds: [], channelIds: [] });
    const { result } = renderHook(() => useAssignmentMessageConfig());
    expect(result.current.config).toEqual({ id: null, enabled: false, openingMessage: '', closingMessage: '', agentIds: [], channelIds: [] });
  });

  test('refresh refetches the config', async () => {
    api.getAssignmentMessageConfig.mockResolvedValue({ enabled: false, openingMessage: '', closingMessage: '', agentIds: [], channelIds: [] });
    const { result } = renderHook(() => useAssignmentMessageConfig());
    await waitFor(() => expect(api.getAssignmentMessageConfig).toHaveBeenCalledTimes(1));

    api.getAssignmentMessageConfig.mockResolvedValue({ enabled: true, openingMessage: 'nova', closingMessage: 'y', agentIds: [], channelIds: [] });
    await act(() => result.current.refresh());

    expect(result.current.config.openingMessage).toBe('nova');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/hooks/useAssignmentMessageConfig.test.jsx`
Expected: FAIL with "Failed to resolve import './useAssignmentMessageConfig'"

- [ ] **Step 3: Implement**

In `frontend/src/services/api.js`, add near the other SGP config functions (after
`updateSgpQueryConfig`, around line 314):

```js
export function getAssignmentMessageConfig(token) {
  return apiFetch('/api/admin/assignment-message', { token });
}

export function updateAssignmentMessageConfig(payload, token) {
  return apiFetch('/api/admin/assignment-message', { method: 'PUT', body: payload, token });
}
```

Create `frontend/src/hooks/useAssignmentMessageConfig.js`:

```js
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getAssignmentMessageConfig } from '../services/api';

const EMPTY_CONFIG = { id: null, enabled: false, openingMessage: '', closingMessage: '', agentIds: [], channelIds: [] };

export function useAssignmentMessageConfig() {
  const { token } = useAuth();
  const [config, setConfig] = useState(EMPTY_CONFIG);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    if (!token) return Promise.resolve();
    setLoading(true);
    return getAssignmentMessageConfig(token)
      .then((data) => {
        setConfig(data);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, [token]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { config, loading, refresh };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/hooks/useAssignmentMessageConfig.test.jsx`
Expected: PASS, all tests green

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/api.js frontend/src/hooks/useAssignmentMessageConfig.js frontend/src/hooks/useAssignmentMessageConfig.test.jsx
git commit -m "$(cat <<'EOF'
Add frontend API functions and hook for the assignment message config

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: "Atribuir um atendimento" section in MessagesAdminTab

**Files:**
- Modify: `frontend/src/components/MessagesAdminTab.jsx`
- Test: `frontend/src/components/MessagesAdminTab.test.jsx`

**Interfaces:**
- Consumes: `useAssignmentMessageConfig` (Task 8), `updateAssignmentMessageConfig` from
  `../services/api` (Task 8), `useAgentsAdmin(true)` (existing hook, returns
  `{ agents, loading, refresh }` where each agent has `{ id, name, email, ... }`),
  `useChannels(true)` (existing hook, already imported in this file), `WaDialog`,
  `waPrimaryButtonClass` (existing, already imported), `SectionHelp` (existing, defined
  earlier in this same file).

- [ ] **Step 1: Write the failing tests**

Read the full current content of `frontend/src/components/MessagesAdminTab.test.jsx`
first, to match its existing mocking setup (it already mocks `useChannels`,
`useCityNotices`, `useQuickReplies`, and the relevant `services/api` functions — follow
that exact pattern for the new hook/API functions). Add a
`vi.mock('../hooks/useAgentsAdmin')` and a `vi.mock('../hooks/useAssignmentMessageConfig')`
alongside the existing hook mocks, and mock `updateAssignmentMessageConfig` from
`services/api` alongside the other mocked API functions. Then add these tests to the
file (inside the existing top-level `describe` block, or a new one following the file's
existing structure):

```jsx
describe('Atribuir um atendimento', () => {
  beforeEach(() => {
    useAgentsAdmin.mockReturnValue({
      agents: [
        { id: 'agent-1', name: 'Geovanna Silva', email: 'geovanna@dw.com' },
        { id: 'agent-2', name: 'Carlos Souza', email: 'carlos@dw.com' },
      ],
      loading: false,
      refresh: vi.fn(),
    });
  });

  test('shows a "Criar" button when no config exists yet', () => {
    useAssignmentMessageConfig.mockReturnValue({
      config: { id: null, enabled: false, openingMessage: '', closingMessage: '', agentIds: [], channelIds: [] },
      loading: false,
      refresh: vi.fn(),
    });
    render(<MessagesAdminTab />);
    expect(screen.getByRole('button', { name: /criar atribuição/i })).toBeInTheDocument();
  });

  test('fills the form, saves and shows the closed summary', async () => {
    const refresh = vi.fn();
    useAssignmentMessageConfig.mockReturnValue({
      config: { id: null, enabled: false, openingMessage: '', closingMessage: '', agentIds: [], channelIds: [] },
      loading: false,
      refresh,
    });
    api.updateAssignmentMessageConfig.mockResolvedValue({});
    render(<MessagesAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /criar atribuição|criar/i }));
    await userEvent.type(screen.getByLabelText(/mensagem de abertura/i), 'Olá @chat_atendente');
    await userEvent.type(screen.getByLabelText(/mensagem de encerramento/i), 'Tchau @chat_protocolo');
    await userEvent.click(screen.getByLabelText('Geovanna Silva'));
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));

    await waitFor(() =>
      expect(api.updateAssignmentMessageConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          openingMessage: 'Olá @chat_atendente',
          closingMessage: 'Tchau @chat_protocolo',
          agentIds: ['agent-1'],
        }),
        expect.any(String)
      )
    );
    expect(refresh).toHaveBeenCalled();
  });

  test('canceling while creating does not leave a stale draft on reopen', async () => {
    useAssignmentMessageConfig.mockReturnValue({
      config: { id: null, enabled: false, openingMessage: '', closingMessage: '', agentIds: [], channelIds: [] },
      loading: false,
      refresh: vi.fn(),
    });
    render(<MessagesAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /criar atribuição|criar/i }));
    await userEvent.type(screen.getByLabelText(/mensagem de abertura/i), 'rascunho descartado');
    await userEvent.click(screen.getByRole('button', { name: /cancelar/i }));

    await userEvent.click(screen.getByRole('button', { name: /criar atribuição|criar/i }));
    expect(screen.getByLabelText(/mensagem de abertura/i)).toHaveValue('');
  });

  test('shows the closed-state summary with counts when a config already exists', () => {
    useAssignmentMessageConfig.mockReturnValue({
      config: {
        id: 'config-1',
        enabled: true,
        openingMessage: 'abertura',
        closingMessage: 'fechamento',
        agentIds: ['agent-1', 'agent-2'],
        channelIds: [],
      },
      loading: false,
      refresh: vi.fn(),
    });
    render(<MessagesAdminTab />);
    expect(screen.getByText(/2 atendentes/i)).toBeInTheDocument();
  });
});
```

Adjust the exact button/label text expectations in these tests to match the button
label you actually implement in Step 3 (the plan text above uses "Criar atribuição" and
"Mensagem de abertura"/"Mensagem de encerramento" as canonical labels — keep the test
selectors and the implementation consistent with each other).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/MessagesAdminTab.test.jsx`
Expected: FAIL — the new section doesn't exist yet

- [ ] **Step 3: Implement**

In `frontend/src/components/MessagesAdminTab.jsx`, add these imports at the top,
alongside the existing ones:

```js
import { useAgentsAdmin } from '../hooks/useAgentsAdmin';
import { useAssignmentMessageConfig } from '../hooks/useAssignmentMessageConfig';
import { updateAssignmentMessageConfig } from '../services/api';
```

Add a new local component, `AssignmentMessageSection`, before `function MessagesAdminTab()`:

```jsx
function AssignmentMessageSection() {
  const { token } = useAuth();
  const { config, refresh } = useAssignmentMessageConfig();
  const { agents } = useAgentsAdmin(true);
  const { channels } = useChannels(true);
  const [editing, setEditing] = useState(false);
  const [enabled, setEnabled] = useState(config.enabled);
  const [openingMessage, setOpeningMessage] = useState(config.openingMessage);
  const [closingMessage, setClosingMessage] = useState(config.closingMessage);
  const [agentIds, setAgentIds] = useState(config.agentIds);
  const [channelIds, setChannelIds] = useState(config.channelIds);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  function handleEditClick() {
    setEnabled(config.enabled);
    setOpeningMessage(config.openingMessage);
    setClosingMessage(config.closingMessage);
    setAgentIds(config.agentIds);
    setChannelIds(config.channelIds);
    setError(null);
    setEditing(true);
  }

  function handleCancel() {
    setEnabled(config.enabled);
    setOpeningMessage(config.openingMessage);
    setClosingMessage(config.closingMessage);
    setAgentIds(config.agentIds);
    setChannelIds(config.channelIds);
    setError(null);
    setEditing(false);
  }

  function toggleAgent(agentId) {
    setAgentIds((prev) => (prev.includes(agentId) ? prev.filter((id) => id !== agentId) : [...prev, agentId]));
  }

  function toggleChannel(channelId) {
    setChannelIds((prev) => (prev.includes(channelId) ? prev.filter((id) => id !== channelId) : [...prev, channelId]));
  }

  async function handleSave(event) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await updateAssignmentMessageConfig({ enabled, openingMessage, closingMessage, agentIds, channelIds }, token);
      setEditing(false);
      refresh();
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao salvar');
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <form
        onSubmit={handleSave}
        className="space-y-3 rounded-2xl border border-white/70 bg-white/50 p-4 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)] backdrop-blur-xl"
      >
        <label className="flex items-center gap-2 text-sm text-ink-950/70">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4 accent-teal-signal" />
          Ativo
        </label>
        <div className="space-y-1">
          <label htmlFor="assignment-opening-message" className="text-sm font-medium text-ink-950">
            Mensagem de abertura
          </label>
          <textarea
            id="assignment-opening-message"
            value={openingMessage}
            onChange={(e) => setOpeningMessage(e.target.value)}
            placeholder="@chat_saudacao_maiusculo, meu nome é @chat_atendente. Irei iniciar seu atendimento, como posso te ajudar? O protocolo do seu atendimento é @chat_protocolo"
            className={inputClass}
            required
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="assignment-closing-message" className="text-sm font-medium text-ink-950">
            Mensagem de encerramento
          </label>
          <textarea
            id="assignment-closing-message"
            value={closingMessage}
            onChange={(e) => setClosingMessage(e.target.value)}
            placeholder="Estou encerrando seu atendimento! Qualquer dúvida coloco-me prontamente à disposição."
            className={inputClass}
            required
          />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium text-ink-950">Atendentes</p>
          <div className="space-y-1">
            {agents.map((agent) => (
              <label key={agent.id} className="flex items-center gap-2 text-sm text-ink-950/70">
                <input
                  type="checkbox"
                  checked={agentIds.includes(agent.id)}
                  onChange={() => toggleAgent(agent.id)}
                  className="h-4 w-4 accent-teal-signal"
                />
                {agent.name}
              </label>
            ))}
          </div>
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium text-ink-950">Canais</p>
          <div className="space-y-1">
            {channels.map((channel) => (
              <label key={channel.id} className="flex items-center gap-2 text-sm text-ink-950/70">
                <input
                  type="checkbox"
                  checked={channelIds.includes(channel.id)}
                  onChange={() => toggleChannel(channel.id)}
                  className="h-4 w-4 accent-teal-signal"
                />
                {channel.name}
              </label>
            ))}
          </div>
        </div>
        {error && <p className="rounded-lg border border-red-300 bg-red-50/80 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={saving}
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

  if (config.id === null) {
    return (
      <div className="flex items-center justify-between rounded-2xl border border-white/70 bg-white/50 p-4 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)] backdrop-blur-xl">
        <p className="text-sm text-ink-950/55">Nenhuma configuração criada ainda.</p>
        <button onClick={handleEditClick} className="text-sm font-medium text-teal-signal hover:text-teal-signal/80 hover:underline">
          Criar atribuição
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/70 bg-white/50 p-4 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)] backdrop-blur-xl">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-ink-950/70">
          {config.agentIds.length} atendentes, {config.channelIds.length} canais
        </p>
        <div className="flex items-center gap-3">
          <CityStatusDot enabled={config.enabled} />
          <button onClick={handleEditClick} className="text-sm font-medium text-teal-signal hover:text-teal-signal/80 hover:underline">
            Editar
          </button>
        </div>
      </div>
    </div>
  );
}
```

Add the new section to `MessagesAdminTab`'s render, between "Avisos por cidade" and
"Respostas rápidas":

```jsx
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="font-display text-lg font-semibold text-ink-950">Atribuir um atendimento</h2>
          <SectionHelp label="Atribuir um atendimento" title="Atribuir um atendimento">
            <p>
              Enviada automaticamente para o cliente quando um atendente assume o
              atendimento, e uma segunda mensagem quando ele é encerrado. Escolha
              abaixo quais atendentes e quais canais disparam essas mensagens.
            </p>
            <p className="mt-2">Placeholders disponíveis:</p>
            <ul className="mt-1 list-disc pl-5">
              <li><code>@chat_saudacao_maiusculo</code> — Bom dia / Boa tarde / Boa noite, automático</li>
              <li><code>@chat_atendente</code> — primeiro nome de quem assumiu</li>
              <li><code>@chat_protocolo</code> — número do protocolo do atendimento</li>
            </ul>
            <p className="mt-2 italic">
              Exemplo: "Bom dia, meu nome é Geovanna. Irei iniciar seu atendimento,
              como posso te ajudar? O protocolo do seu atendimento é 1042"
            </p>
          </SectionHelp>
        </div>
        <AssignmentMessageSection />
      </div>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/MessagesAdminTab.test.jsx`
Expected: PASS, all tests green. If any selector text mismatches (button label,
`aria-label`), fix the implementation or the test so both agree — whichever reads more
naturally as UI copy wins; keep them consistent.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/MessagesAdminTab.jsx frontend/src/components/MessagesAdminTab.test.jsx
git commit -m "$(cat <<'EOF'
Add the Atribuir um atendimento section to MessagesAdminTab

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Check AdminChannelsPage.test.jsx for fallout

**Files:**
- Modify (only if needed): `frontend/src/pages/AdminChannelsPage.test.jsx`

**Interfaces:**
- None new — this task only reacts to Task 9's UI change.

`AdminChannelsPage.test.jsx` renders `MessagesAdminTab` (via the "Mensagens" tab) for
real, not mocked, when its tests switch tabs. In 3 of the 6 admin-UI redecorations
earlier in this project, that produced a small, necessary fix — see
`docs/superpowers/specs/2026-09-10-assignment-message-design.md` section 10 and the
project's own memory of this pattern. This task exists to check, not to guess.

- [ ] **Step 1: Run the existing test file as-is**

Run: `cd frontend && npx vitest run src/pages/AdminChannelsPage.test.jsx`

- [ ] **Step 2: If it fails, read the failure and the relevant test**

If a test that switches to the "Mensagens" tab fails because it can't find content that
used to be immediately visible (or now finds unexpected content e.g. duplicate "Criar"
buttons or ambiguous label matches introduced by the new "Atribuir um atendimento"
section), read that specific test in `AdminChannelsPage.test.jsx` and adjust its
assertions minimally — e.g. scope a query more precisely, or click through the new
section's own controls — following the same minimal, targeted style as the fixes
already made for the quick-replies and templates sections earlier in this project. Do
not change unrelated tests.

If it passes with no changes, that is a valid outcome — note it and move on.

- [ ] **Step 3: Run the full test file again to confirm green**

Run: `cd frontend && npx vitest run src/pages/AdminChannelsPage.test.jsx`
Expected: PASS, all tests green

- [ ] **Step 4: Commit (only if Step 2 required a change)**

```bash
git add frontend/src/pages/AdminChannelsPage.test.jsx
git commit -m "$(cat <<'EOF'
Fix AdminChannelsPage tests for the new Atribuir um atendimento section

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

If no change was needed, skip the commit — there is nothing to commit.

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
