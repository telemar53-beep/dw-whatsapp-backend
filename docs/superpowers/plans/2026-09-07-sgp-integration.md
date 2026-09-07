# Integração com o SGP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the SGP trigger a WhatsApp message send through this system via an authenticated HTTP endpoint, and manage that integration (channel choice, enable/disable, API key) from a new admin tab.

**Architecture:** Reuse the existing conversation/message/outbound-queue machinery end to end. A new `platform_integrations` table (generic across future platforms, singleton per `platform` value for now) holds the SGP config + hashed API key; a new `sgp_dispatches` table gives idempotency and an audit trail keyed by the SGP's own reference id. A new `'silent'` conversation status keeps SGP-initiated conversations out of every attendant's queue until the customer actually replies, at which point the existing inbound-message pipeline flips it to `'waiting'`.

**Tech Stack:** Node.js/Express, PostgreSQL (`node-pg-migrate`), `bcrypt` (already a dependency), Bull/Redis (existing outbound queue), React 18 (frontend admin tab).

**Spec:** `docs/superpowers/specs/2026-09-07-sgp-integration-design.md` (extends `docs/superpowers/specs/2026-09-04-whatsapp-attendance-system-design.md`)

## Global Constraints

- Only Baileys channels can be chosen for the SGP integration (Meta Cloud needs an approved template for cold outreach, which doesn't fit this endpoint's free-text contract).
- The SGP endpoint (`POST /api/integrations/sgp/messages`) authenticates via `Authorization: Bearer <api_key>` compared against a `bcrypt` hash — never store or log the plain key after generation.
- A newly generated API key is returned in plain text exactly once, in the response of `POST /api/admin/integrations/sgp/rotate-key`. It is never retrievable again.
- Idempotency is mandatory: a repeated call with the same `referenceId` must not send a second message.
- A conversation created by the SGP endpoint starts with `status = 'silent'` and must not appear in `GET /api/conversations/queue` (`listWaitingConversations`) until the customer's first reply flips it to `'waiting'`.
- This plan requires two new migrations. **After deploy, `npm run migrate -- up` must be run in the Render Shell** — without it, both the SGP endpoint and the admin tab are broken.

---

### Task 1: Migrations — `platform_integrations`, `sgp_dispatches`, and the `'silent'` conversation status

**Files:**
- Create: `migrations/1788780000000_create-platform-integrations-and-sgp-dispatches.js`
- Create: `migrations/1788790000000_add-silent-status-to-conversations.js`

**Interfaces:**
- Produces: table `platform_integrations` (`id UUID`, `platform TEXT CHECK IN ('sgp')`, `channel_id UUID NOT NULL REFERENCES channels(id)`, `api_key_hash TEXT` nullable, `enabled BOOLEAN NOT NULL DEFAULT true`, `created_at`, `updated_at`, `UNIQUE(platform)`); table `sgp_dispatches` (`id UUID`, `reference_id TEXT NOT NULL UNIQUE`, `conversation_id UUID NOT NULL REFERENCES conversations(id)`, `message_id UUID NOT NULL REFERENCES messages(id)`, `created_at`); `conversations.status` CHECK widened to also allow `'silent'` (constraint name confirmed as `conversations_status_check`, Postgres's default name for this table's unnamed column check).

- [ ] **Step 1: Write the first migration**

```js
// migrations/1788780000000_create-platform-integrations-and-sgp-dispatches.js
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE platform_integrations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      platform TEXT NOT NULL CHECK (platform IN ('sgp')),
      channel_id UUID NOT NULL REFERENCES channels(id),
      api_key_hash TEXT,
      enabled BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (platform)
    );

    CREATE TABLE sgp_dispatches (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      reference_id TEXT NOT NULL UNIQUE,
      conversation_id UUID NOT NULL REFERENCES conversations(id),
      message_id UUID NOT NULL REFERENCES messages(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE sgp_dispatches;
    DROP TABLE platform_integrations;
  `);
};
```

- [ ] **Step 2: Write the second migration**

```js
// migrations/1788790000000_add-silent-status-to-conversations.js
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE conversations DROP CONSTRAINT conversations_status_check;
    ALTER TABLE conversations ADD CONSTRAINT conversations_status_check
      CHECK (status IN ('waiting', 'assigned', 'closed', 'silent'));
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE conversations DROP CONSTRAINT conversations_status_check;
    ALTER TABLE conversations ADD CONSTRAINT conversations_status_check
      CHECK (status IN ('waiting', 'assigned', 'closed'));
  `);
};
```

- [ ] **Step 3: Apply both migrations to the local test database**

Run: `npm run migrate:test -- up`
Expected: output lists both new migrations as applied, no errors.

- [ ] **Step 4: Verify the schema landed correctly**

Run this one-off check (uses the same `.env.test` connection string as the test suite):

```bash
node -e "
const { Client } = require('pg');
require('dotenv').config({ path: '.env.test' });
const c = new Client({ connectionString: process.env.DATABASE_URL });
c.connect().then(async () => {
  const tables = await c.query(\"SELECT table_name FROM information_schema.tables WHERE table_name IN ('platform_integrations','sgp_dispatches')\");
  console.log('tables:', tables.rows.map((r) => r.table_name));
  const check = await c.query(\"SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'conversations_status_check'\");
  console.log('constraint:', check.rows[0].def);
  await c.end();
});
"
```

Expected: `tables: [ 'platform_integrations', 'sgp_dispatches' ]` (order may vary) and the constraint definition includes `'silent'`.

- [ ] **Step 5: Commit**

```bash
git add migrations/1788780000000_create-platform-integrations-and-sgp-dispatches.js migrations/1788790000000_add-silent-status-to-conversations.js
git commit -m "Add platform_integrations/sgp_dispatches tables and the silent conversation status"
```

---

### Task 2: `conversation.repository.js` — configurable creation status + `activateConversation`

**Files:**
- Modify: `src/conversations/conversation.repository.js`
- Test: `src/conversations/conversation.repository.test.js`

**Interfaces:**
- Consumes: Task 1's `'silent'`-inclusive `conversations.status` CHECK constraint.
- Produces: `createConversation(contactId, channelId, triageState = null, status = 'waiting')` — new 4th optional parameter, backward compatible with every existing 2-arg/3-arg call site. `activateConversation(conversationId)` — `async (conversationId) => Conversation | null`, updates a `'silent'` conversation to `'waiting'`, returns `null` if the conversation doesn't exist or isn't currently `'silent'`. Both exported from `conversation.repository.js`, consumed by Task 4 (`inbound-message.service.js`) and Task 5 (`integrations-sgp.routes.js`).

- [ ] **Step 1: Write the failing tests**

Add to `src/conversations/conversation.repository.test.js` (the `describe('conversation repository', ...)` block already declares `contactId`/`channelId` in its `beforeEach` — reuse them):

```js
test('createConversation accepts an explicit status', async () => {
  const conversation = await createConversation(contactId, channelId, null, 'silent');
  expect(conversation.status).toBe('silent');
});

test('activateConversation flips a silent conversation to waiting', async () => {
  const created = await createConversation(contactId, channelId, null, 'silent');
  const activated = await activateConversation(created.id);
  expect(activated.status).toBe('waiting');
  const found = await findOpenConversation(contactId, channelId);
  expect(found.status).toBe('waiting');
});

test('activateConversation returns null for a conversation that is not silent', async () => {
  const created = await createConversation(contactId, channelId);
  const result = await activateConversation(created.id);
  expect(result).toBeNull();
});

test('activateConversation returns null for a non-existent conversation id', async () => {
  const result = await activateConversation('00000000-0000-0000-0000-000000000000');
  expect(result).toBeNull();
});
```

Add `activateConversation` to the destructured import at the top of the test file (alongside the existing `findOpenConversation, createConversation, ...`).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest src/conversations/conversation.repository.test.js -t "createConversation accepts an explicit status"`
Expected: FAIL — `createConversation` ignores the 4th argument (conversation is created as `'waiting'`, not `'silent'`), and/or `activateConversation is not a function`.

- [ ] **Step 3: Implement**

In `src/conversations/conversation.repository.js`, replace the existing `createConversation`:

```js
async function createConversation(contactId, channelId, triageState = null, status = 'waiting') {
  const result = await getPool().query(
    `INSERT INTO conversations (contact_id, channel_id, triage_state, status) VALUES ($1, $2, $3, $4)
     RETURNING id, contact_id, channel_id, status, assigned_agent_id, sector_id, triage_state, triage_attempts, created_at, updated_at`,
    [contactId, channelId, triageState, status]
  );
  return toConversation(result.rows[0]);
}
```

Add a new function, right after `incrementTriageAttempts`:

```js
async function activateConversation(conversationId) {
  const result = await getPool().query(
    `UPDATE conversations SET status = 'waiting', updated_at = now()
     WHERE id = $1 AND status = 'silent'
     RETURNING id, contact_id, channel_id, status, assigned_agent_id, sector_id, triage_state, triage_attempts, created_at, updated_at`,
    [conversationId]
  );
  if (result.rowCount === 0) return null;
  return toConversation(result.rows[0]);
}
```

Add `activateConversation` to `module.exports`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest src/conversations/conversation.repository.test.js`
Expected: PASS (all tests in the file, including the 4 new ones).

- [ ] **Step 5: Commit**

```bash
git add src/conversations/conversation.repository.js src/conversations/conversation.repository.test.js
git commit -m "Let createConversation set an explicit status and add activateConversation"
```

---

### Task 3: `sgp-integration.repository.js` — data access for the integration config and dispatch log

**Files:**
- Create: `src/integrations/sgp-integration.repository.js`
- Test: `src/integrations/sgp-integration.repository.test.js`

**Interfaces:**
- Consumes: Task 1's `platform_integrations`/`sgp_dispatches` tables; `bcrypt` (already in `package.json`, same usage pattern as `src/agents/agent.repository.js`).
- Produces (all consumed by Task 5's `integrations-sgp.routes.js` and Task 6's `admin-integrations.routes.js`):
  - `getSgpIntegration()` → `Promise<{id, channelId, enabled, hasApiKey, createdAt, updatedAt} | null>`
  - `saveSgpIntegrationChannel({channelId, enabled})` → `Promise<Integration>` (creates the singleton row on first call, updates `channel_id`/`enabled` on later calls; never touches `api_key_hash`)
  - `rotateSgpApiKey()` → `Promise<{apiKey: string, integration: Integration} | null>` (`null` when no row exists yet — the admin must call `saveSgpIntegrationChannel` first)
  - `verifySgpApiKey(candidateKey)` → `Promise<{status: 'not_configured'} | {status: 'disabled'} | {status: 'no_key'} | {status: 'invalid'} | {status: 'ok', channelId: string}>`
  - `findSgpDispatchByReferenceId(referenceId)` → `Promise<{id, referenceId, conversationId, messageId, createdAt} | null>`
  - `createSgpDispatch({referenceId, conversationId, messageId})` → `Promise<Dispatch>` (throws with `err.code === '23505'` on a duplicate `referenceId`, same convention as every other unique-constraint violation in this codebase)

- [ ] **Step 1: Write the failing tests**

Create `src/integrations/sgp-integration.repository.test.js`:

```js
const bcrypt = require('bcrypt');
const { getPool, closePool } = require('../db/pool');
const { createChannel } = require('../channels/channel.repository');
const { findOrCreateContactByPhoneNumber } = require('../conversations/contact.repository');
const { createConversation } = require('../conversations/conversation.repository');
const { createMessage } = require('../conversations/message.repository');
const {
  getSgpIntegration,
  saveSgpIntegrationChannel,
  rotateSgpApiKey,
  verifySgpApiKey,
  findSgpDispatchByReferenceId,
  createSgpDispatch,
} = require('./sgp-integration.repository');

describe('sgp integration repository', () => {
  let channelId;
  let conversationId;
  let messageId;

  beforeEach(async () => {
    await getPool().query('TRUNCATE platform_integrations, sgp_dispatches, conversations, contacts, channels CASCADE');
    const channel = await createChannel({ type: 'baileys', name: 'Berg', phoneNumber: '+5598900000000', config: {} });
    channelId = channel.id;
    const contact = await findOrCreateContactByPhoneNumber('+5511988885555', 'Cliente SGP');
    const conversation = await createConversation(contact.id, channelId);
    conversationId = conversation.id;
    const message = await createMessage({
      conversationId,
      direction: 'outbound',
      content: 'Oi',
      whatsappMessageId: null,
      status: 'sent',
    });
    messageId = message.id;
  });

  afterAll(async () => {
    await closePool();
  });

  test('getSgpIntegration returns null when not configured', async () => {
    expect(await getSgpIntegration()).toBeNull();
  });

  test('saveSgpIntegrationChannel creates the singleton row on first call', async () => {
    const integration = await saveSgpIntegrationChannel({ channelId, enabled: true });
    expect(integration.channelId).toBe(channelId);
    expect(integration.enabled).toBe(true);
    expect(integration.hasApiKey).toBe(false);
  });

  test('saveSgpIntegrationChannel updates the existing row without touching the api key', async () => {
    await saveSgpIntegrationChannel({ channelId, enabled: true });
    await rotateSgpApiKey();

    const otherChannel = await createChannel({ type: 'baileys', name: 'Outro', phoneNumber: '+5598900000001', config: {} });
    const updated = await saveSgpIntegrationChannel({ channelId: otherChannel.id, enabled: false });

    expect(updated.channelId).toBe(otherChannel.id);
    expect(updated.enabled).toBe(false);
    expect(updated.hasApiKey).toBe(true);
  });

  test('rotateSgpApiKey returns null when no integration has been configured yet', async () => {
    expect(await rotateSgpApiKey()).toBeNull();
  });

  test('rotateSgpApiKey generates a plain key and stores only its hash', async () => {
    await saveSgpIntegrationChannel({ channelId, enabled: true });

    const rotated = await rotateSgpApiKey();

    expect(typeof rotated.apiKey).toBe('string');
    expect(rotated.apiKey.length).toBeGreaterThan(20);
    expect(rotated.integration.hasApiKey).toBe(true);
    const integration = await getSgpIntegration();
    expect(integration.hasApiKey).toBe(true);
  });

  test('verifySgpApiKey reports not_configured when there is no integration row', async () => {
    expect(await verifySgpApiKey('anything')).toEqual({ status: 'not_configured' });
  });

  test('verifySgpApiKey reports disabled when the integration is turned off', async () => {
    await saveSgpIntegrationChannel({ channelId, enabled: false });
    await rotateSgpApiKey();

    expect(await verifySgpApiKey('anything')).toEqual({ status: 'disabled' });
  });

  test('verifySgpApiKey reports no_key when a channel is set but no key was generated', async () => {
    await saveSgpIntegrationChannel({ channelId, enabled: true });

    expect(await verifySgpApiKey('anything')).toEqual({ status: 'no_key' });
  });

  test('verifySgpApiKey reports invalid for a wrong key', async () => {
    await saveSgpIntegrationChannel({ channelId, enabled: true });
    await rotateSgpApiKey();

    expect(await verifySgpApiKey('wrong-key')).toEqual({ status: 'invalid' });
  });

  test('verifySgpApiKey reports ok and the channel id for the correct key', async () => {
    await saveSgpIntegrationChannel({ channelId, enabled: true });
    const rotated = await rotateSgpApiKey();

    expect(await verifySgpApiKey(rotated.apiKey)).toEqual({ status: 'ok', channelId });
  });

  test('findSgpDispatchByReferenceId returns null when not found', async () => {
    expect(await findSgpDispatchByReferenceId('missing')).toBeNull();
  });

  test('createSgpDispatch stores and findSgpDispatchByReferenceId retrieves it', async () => {
    const dispatch = await createSgpDispatch({ referenceId: 'boleto-1', conversationId, messageId });
    expect(dispatch.referenceId).toBe('boleto-1');

    const found = await findSgpDispatchByReferenceId('boleto-1');
    expect(found).toEqual(dispatch);
  });

  test('createSgpDispatch rejects a duplicate referenceId with a unique-violation error', async () => {
    await createSgpDispatch({ referenceId: 'boleto-2', conversationId, messageId });

    await expect(createSgpDispatch({ referenceId: 'boleto-2', conversationId, messageId })).rejects.toMatchObject({
      code: '23505',
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest src/integrations/sgp-integration.repository.test.js`
Expected: FAIL — `Cannot find module './sgp-integration.repository'`.

- [ ] **Step 3: Implement**

Create `src/integrations/sgp-integration.repository.js`:

```js
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { getPool } = require('../db/pool');

const SALT_ROUNDS = 10;

function toIntegration(row) {
  return {
    id: row.id,
    channelId: row.channel_id,
    enabled: row.enabled,
    hasApiKey: row.api_key_hash !== null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getSgpIntegration() {
  const result = await getPool().query(
    `SELECT id, channel_id, enabled, api_key_hash, created_at, updated_at
     FROM platform_integrations WHERE platform = 'sgp'`
  );
  if (result.rowCount === 0) return null;
  return toIntegration(result.rows[0]);
}

async function saveSgpIntegrationChannel({ channelId, enabled }) {
  const result = await getPool().query(
    `INSERT INTO platform_integrations (platform, channel_id, enabled)
     VALUES ('sgp', $1, $2)
     ON CONFLICT (platform) DO UPDATE SET channel_id = EXCLUDED.channel_id, enabled = EXCLUDED.enabled, updated_at = now()
     RETURNING id, channel_id, enabled, api_key_hash, created_at, updated_at`,
    [channelId, enabled]
  );
  return toIntegration(result.rows[0]);
}

async function rotateSgpApiKey() {
  const apiKey = crypto.randomBytes(32).toString('hex');
  const apiKeyHash = await bcrypt.hash(apiKey, SALT_ROUNDS);
  const result = await getPool().query(
    `UPDATE platform_integrations SET api_key_hash = $1, updated_at = now() WHERE platform = 'sgp'
     RETURNING id, channel_id, enabled, api_key_hash, created_at, updated_at`,
    [apiKeyHash]
  );
  if (result.rowCount === 0) return null;
  return { apiKey, integration: toIntegration(result.rows[0]) };
}

async function verifySgpApiKey(candidateKey) {
  const result = await getPool().query(
    `SELECT channel_id, enabled, api_key_hash FROM platform_integrations WHERE platform = 'sgp'`
  );
  if (result.rowCount === 0) return { status: 'not_configured' };
  const row = result.rows[0];
  if (!row.enabled) return { status: 'disabled' };
  if (!row.api_key_hash) return { status: 'no_key' };
  const matches = await bcrypt.compare(candidateKey, row.api_key_hash);
  if (!matches) return { status: 'invalid' };
  return { status: 'ok', channelId: row.channel_id };
}

function toDispatch(row) {
  return {
    id: row.id,
    referenceId: row.reference_id,
    conversationId: row.conversation_id,
    messageId: row.message_id,
    createdAt: row.created_at,
  };
}

async function findSgpDispatchByReferenceId(referenceId) {
  const result = await getPool().query(
    'SELECT id, reference_id, conversation_id, message_id, created_at FROM sgp_dispatches WHERE reference_id = $1',
    [referenceId]
  );
  if (result.rowCount === 0) return null;
  return toDispatch(result.rows[0]);
}

async function createSgpDispatch({ referenceId, conversationId, messageId }) {
  const result = await getPool().query(
    `INSERT INTO sgp_dispatches (reference_id, conversation_id, message_id) VALUES ($1, $2, $3)
     RETURNING id, reference_id, conversation_id, message_id, created_at`,
    [referenceId, conversationId, messageId]
  );
  return toDispatch(result.rows[0]);
}

module.exports = {
  getSgpIntegration,
  saveSgpIntegrationChannel,
  rotateSgpApiKey,
  verifySgpApiKey,
  findSgpDispatchByReferenceId,
  createSgpDispatch,
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest src/integrations/sgp-integration.repository.test.js`
Expected: PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
git add src/integrations/sgp-integration.repository.js src/integrations/sgp-integration.repository.test.js
git commit -m "Add the SGP integration repository (config, api key, dispatch idempotency log)"
```

---

### Task 4: `inbound-message.service.js` — activate a silent conversation on the customer's first reply

**Files:**
- Modify: `src/conversations/inbound-message.service.js`
- Test: `src/conversations/inbound-message.service.test.js`

**Interfaces:**
- Consumes: Task 2's `activateConversation(conversationId)`.
- Produces: no new exports — `ingestInboundMessage` gains this behavior internally, transparent to every existing caller (Baileys/Meta webhook handlers).

- [ ] **Step 1: Write the failing tests**

Add `activateConversation` to the destructured import at the top of `src/conversations/inbound-message.service.test.js` (`const { findOpenConversation, createConversation, getConversationWithContact, activateConversation } = require('./conversation.repository');`).

Add these two tests to the `describe('ingestInboundMessage', ...)` block:

```js
test("activates a silent conversation on the customer's first reply and broadcasts queue:new", async () => {
  findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-sgp-1' });
  findOpenConversation.mockResolvedValue({ id: 'conv-sgp-1', assignedAgentId: null, status: 'silent' });
  activateConversation.mockResolvedValue({ id: 'conv-sgp-1', assignedAgentId: null, status: 'waiting' });
  createMessage.mockResolvedValue({ id: 'msg-sgp-1' });
  getConversationWithContact.mockResolvedValue({
    id: 'conv-sgp-1',
    assignedAgentId: null,
    status: 'waiting',
    contactPhoneNumber: '+5511999990099',
  });

  await ingestInboundMessage({
    channelId: 'channel-1',
    fromPhoneNumber: '+5511999990099',
    contactDisplayName: 'Cliente SGP',
    whatsappMessageId: 'wamid.SGP1',
    content: 'Já paguei, obrigado!',
  });

  expect(activateConversation).toHaveBeenCalledWith('conv-sgp-1');
  expect(createConversation).not.toHaveBeenCalled();
  expect(createMessage).toHaveBeenCalledWith({
    conversationId: 'conv-sgp-1',
    direction: 'inbound',
    content: 'Já paguei, obrigado!',
    whatsappMessageId: 'wamid.SGP1',
    status: 'received',
  });
  expect(broadcast).toHaveBeenCalledWith('queue:new', {
    conversation: {
      id: 'conv-sgp-1',
      assignedAgentId: null,
      status: 'waiting',
      contactPhoneNumber: '+5511999990099',
    },
    message: { id: 'msg-sgp-1' },
  });
});

test('does not call activateConversation when the existing conversation is not silent', async () => {
  findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-sgp-2' });
  findOpenConversation.mockResolvedValue({ id: 'conv-sgp-2', assignedAgentId: null, status: 'waiting' });
  createMessage.mockResolvedValue({ id: 'msg-sgp-2' });
  getConversationWithContact.mockResolvedValue({ id: 'conv-sgp-2', assignedAgentId: null, status: 'waiting' });

  await ingestInboundMessage({
    channelId: 'channel-1',
    fromPhoneNumber: '+5511999990098',
    contactDisplayName: 'Cliente Normal',
    whatsappMessageId: 'wamid.NORM1',
    content: 'Oi',
  });

  expect(activateConversation).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest src/conversations/inbound-message.service.test.js -t "activates a silent conversation"`
Expected: FAIL — `activateConversation` is never called (conversation stays `'silent'` in the code path today).

- [ ] **Step 3: Implement**

In `src/conversations/inbound-message.service.js`, add `activateConversation` to the existing require:

```js
const { findOpenConversation, createConversation, getConversationWithContact, activateConversation } = require('./conversation.repository');
```

Right after `let conversation = await findOpenConversation(contact.id, channelId);` and before `let justCreated = false;`, insert:

```js
  if (conversation && conversation.status === 'silent') {
    conversation = await activateConversation(conversation.id);
  }
```

(Full surrounding context after the change:)

```js
  const { wasCreated, ...contact } = await findOrCreateContactByPhoneNumber(fromPhoneNumber, contactDisplayName);
  const contactJustCreated = Boolean(wasCreated);
  let conversation = await findOpenConversation(contact.id, channelId);
  if (conversation && conversation.status === 'silent') {
    conversation = await activateConversation(conversation.id);
  }
  let justCreated = false;
  if (!conversation) {
    ...
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest src/conversations/inbound-message.service.test.js`
Expected: PASS (all tests in the file, including the 2 new ones).

- [ ] **Step 5: Commit**

```bash
git add src/conversations/inbound-message.service.js src/conversations/inbound-message.service.test.js
git commit -m "Activate silent conversations when the customer sends their first reply"
```

---

### Task 5: `POST /api/integrations/sgp/messages` — the endpoint the SGP calls

**Files:**
- Create: `src/api/integrations-sgp.routes.js`
- Test: `src/api/integrations-sgp.routes.test.js`
- Modify: `src/server.js`

**Interfaces:**
- Consumes: Task 2's `createConversation(contactId, channelId, triageState, status)` / `findOpenConversation`; Task 3's `verifySgpApiKey`, `findSgpDispatchByReferenceId`, `createSgpDispatch`; existing `findChannelById` (`src/channels/channel.repository.js`), `findOrCreateContactByPhoneNumber` (`src/conversations/contact.repository.js`), `enqueueOutboundMessage` (`src/queue/outbound-queue.js`), `baileysManager.resolveWhatsAppJid(channel, phoneNumber)` (`src/whatsapp-adapters/baileys.manager.js`).
- Produces: `router` (default export) mounted at `/api/integrations/sgp` in `server.js`, exposing `POST /messages`.

- [ ] **Step 1: Write the failing tests**

Create `src/api/integrations-sgp.routes.test.js`:

```js
jest.mock('../integrations/sgp-integration.repository');
jest.mock('../channels/channel.repository');
jest.mock('../conversations/contact.repository');
jest.mock('../conversations/conversation.repository');
jest.mock('../queue/outbound-queue');
jest.mock('../whatsapp-adapters/baileys.manager');
const request = require('supertest');
const express = require('express');
const {
  verifySgpApiKey,
  findSgpDispatchByReferenceId,
  createSgpDispatch,
} = require('../integrations/sgp-integration.repository');
const { findChannelById } = require('../channels/channel.repository');
const { findOrCreateContactByPhoneNumber } = require('../conversations/contact.repository');
const { findOpenConversation, createConversation } = require('../conversations/conversation.repository');
const { enqueueOutboundMessage } = require('../queue/outbound-queue');
const baileysManager = require('../whatsapp-adapters/baileys.manager');
const integrationsSgpRoutes = require('./integrations-sgp.routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/integrations/sgp', integrationsSgpRoutes);
  return app;
}

const CHANNEL = { id: 'channel-1', type: 'baileys', status: 'connected' };
const VALID_BODY = { phoneNumber: '5598999990000', content: 'Seu boleto vence em 10/09', referenceId: 'boleto-1' };

describe('POST /api/integrations/sgp/messages', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    findSgpDispatchByReferenceId.mockResolvedValue(null);
    findChannelById.mockResolvedValue(CHANNEL);
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-1' });
    findOpenConversation.mockResolvedValue(null);
    createConversation.mockResolvedValue({ id: 'conv-1', status: 'silent' });
    enqueueOutboundMessage.mockResolvedValue({ id: 'msg-1' });
    createSgpDispatch.mockResolvedValue({ id: 'dispatch-1', referenceId: 'boleto-1', conversationId: 'conv-1', messageId: 'msg-1' });
    baileysManager.resolveWhatsAppJid.mockResolvedValue('5598999990000');
  });

  test('returns 401 when the Authorization header is missing', async () => {
    const res = await request(buildApp()).post('/api/integrations/sgp/messages').send(VALID_BODY);
    expect(res.status).toBe(401);
    expect(verifySgpApiKey).not.toHaveBeenCalled();
  });

  test('returns 401 when the api key is invalid', async () => {
    verifySgpApiKey.mockResolvedValue({ status: 'invalid' });
    const res = await request(buildApp())
      .post('/api/integrations/sgp/messages')
      .set('Authorization', 'Bearer wrong-key')
      .send(VALID_BODY);
    expect(res.status).toBe(401);
    expect(verifySgpApiKey).toHaveBeenCalledWith('wrong-key');
  });

  test('returns 400 when the integration is not configured', async () => {
    verifySgpApiKey.mockResolvedValue({ status: 'not_configured' });
    const res = await request(buildApp())
      .post('/api/integrations/sgp/messages')
      .set('Authorization', 'Bearer any-key')
      .send(VALID_BODY);
    expect(res.status).toBe(400);
  });

  test('returns 400 when the integration is disabled', async () => {
    verifySgpApiKey.mockResolvedValue({ status: 'disabled' });
    const res = await request(buildApp())
      .post('/api/integrations/sgp/messages')
      .set('Authorization', 'Bearer any-key')
      .send(VALID_BODY);
    expect(res.status).toBe(400);
  });

  test('returns 400 when no api key has been generated yet', async () => {
    verifySgpApiKey.mockResolvedValue({ status: 'no_key' });
    const res = await request(buildApp())
      .post('/api/integrations/sgp/messages')
      .set('Authorization', 'Bearer any-key')
      .send(VALID_BODY);
    expect(res.status).toBe(400);
  });

  describe('with a valid api key', () => {
    beforeEach(() => {
      verifySgpApiKey.mockResolvedValue({ status: 'ok', channelId: 'channel-1' });
    });

    test('returns 400 when phoneNumber is missing', async () => {
      const res = await request(buildApp())
        .post('/api/integrations/sgp/messages')
        .set('Authorization', 'Bearer key')
        .send({ content: 'Oi', referenceId: 'ref-1' });
      expect(res.status).toBe(400);
      expect(findChannelById).not.toHaveBeenCalled();
    });

    test('returns 400 when content is missing', async () => {
      const res = await request(buildApp())
        .post('/api/integrations/sgp/messages')
        .set('Authorization', 'Bearer key')
        .send({ phoneNumber: '5598999990000', referenceId: 'ref-1' });
      expect(res.status).toBe(400);
    });

    test('returns 400 when referenceId is missing', async () => {
      const res = await request(buildApp())
        .post('/api/integrations/sgp/messages')
        .set('Authorization', 'Bearer key')
        .send({ phoneNumber: '5598999990000', content: 'Oi' });
      expect(res.status).toBe(400);
    });

    test('returns 200 without resending when referenceId was already processed', async () => {
      findSgpDispatchByReferenceId.mockResolvedValue({
        id: 'dispatch-1',
        referenceId: 'boleto-1',
        conversationId: 'conv-existing',
        messageId: 'msg-existing',
      });

      const res = await request(buildApp())
        .post('/api/integrations/sgp/messages')
        .set('Authorization', 'Bearer key')
        .send(VALID_BODY);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ conversationId: 'conv-existing', messageId: 'msg-existing', duplicate: true });
      expect(enqueueOutboundMessage).not.toHaveBeenCalled();
    });

    test('returns 400 when the configured channel is not connected', async () => {
      findChannelById.mockResolvedValue({ ...CHANNEL, status: 'awaiting_qr' });
      const res = await request(buildApp())
        .post('/api/integrations/sgp/messages')
        .set('Authorization', 'Bearer key')
        .send(VALID_BODY);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/not connected/i);
    });

    test('returns 400 when the phone number is not registered on WhatsApp', async () => {
      baileysManager.resolveWhatsAppJid.mockResolvedValue(null);
      const res = await request(buildApp())
        .post('/api/integrations/sgp/messages')
        .set('Authorization', 'Bearer key')
        .send(VALID_BODY);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/not.*whatsapp/i);
      expect(findOrCreateContactByPhoneNumber).not.toHaveBeenCalled();
    });

    test('creates a new silent conversation when none is open and sends the message', async () => {
      const res = await request(buildApp())
        .post('/api/integrations/sgp/messages')
        .set('Authorization', 'Bearer key')
        .send(VALID_BODY);

      expect(baileysManager.resolveWhatsAppJid).toHaveBeenCalledWith(CHANNEL, '5598999990000');
      expect(findOrCreateContactByPhoneNumber).toHaveBeenCalledWith('5598999990000', null);
      expect(createConversation).toHaveBeenCalledWith('contact-1', 'channel-1', null, 'silent');
      expect(enqueueOutboundMessage).toHaveBeenCalledWith({
        conversationId: 'conv-1',
        channelId: 'channel-1',
        content: 'Seu boleto vence em 10/09',
      });
      expect(createSgpDispatch).toHaveBeenCalledWith({ referenceId: 'boleto-1', conversationId: 'conv-1', messageId: 'msg-1' });
      expect(res.status).toBe(202);
      expect(res.body).toEqual({ conversationId: 'conv-1', messageId: 'msg-1' });
    });

    test('reuses an existing open conversation instead of creating a new one', async () => {
      findOpenConversation.mockResolvedValue({ id: 'conv-existing', status: 'waiting' });

      const res = await request(buildApp())
        .post('/api/integrations/sgp/messages')
        .set('Authorization', 'Bearer key')
        .send(VALID_BODY);

      expect(createConversation).not.toHaveBeenCalled();
      expect(enqueueOutboundMessage).toHaveBeenCalledWith({
        conversationId: 'conv-existing',
        channelId: 'channel-1',
        content: 'Seu boleto vence em 10/09',
      });
      expect(res.status).toBe(202);
    });

    test('falls back to the existing conversation when createConversation races on a unique violation', async () => {
      const uniqueViolation = Object.assign(new Error('duplicate key'), { code: '23505' });
      createConversation.mockRejectedValue(uniqueViolation);
      findOpenConversation.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'conv-race', status: 'silent' });

      const res = await request(buildApp())
        .post('/api/integrations/sgp/messages')
        .set('Authorization', 'Bearer key')
        .send(VALID_BODY);

      expect(findOpenConversation).toHaveBeenCalledTimes(2);
      expect(enqueueOutboundMessage).toHaveBeenCalledWith({
        conversationId: 'conv-race',
        channelId: 'channel-1',
        content: 'Seu boleto vence em 10/09',
      });
      expect(res.status).toBe(202);
    });

    test('falls back to the already-recorded dispatch when createSgpDispatch races on a unique violation', async () => {
      const uniqueViolation = Object.assign(new Error('duplicate key'), { code: '23505' });
      createSgpDispatch.mockRejectedValue(uniqueViolation);
      findSgpDispatchByReferenceId
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'dispatch-race', referenceId: 'boleto-1', conversationId: 'conv-1', messageId: 'msg-1' });

      const res = await request(buildApp())
        .post('/api/integrations/sgp/messages')
        .set('Authorization', 'Bearer key')
        .send(VALID_BODY);

      expect(res.status).toBe(202);
      expect(res.body).toEqual({ conversationId: 'conv-1', messageId: 'msg-1' });
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest src/api/integrations-sgp.routes.test.js`
Expected: FAIL — `Cannot find module './integrations-sgp.routes'`.

- [ ] **Step 3: Implement**

Create `src/api/integrations-sgp.routes.js`:

```js
const express = require('express');
const { verifySgpApiKey, findSgpDispatchByReferenceId, createSgpDispatch } = require('../integrations/sgp-integration.repository');
const { findChannelById } = require('../channels/channel.repository');
const { findOrCreateContactByPhoneNumber } = require('../conversations/contact.repository');
const { findOpenConversation, createConversation } = require('../conversations/conversation.repository');
const { enqueueOutboundMessage } = require('../queue/outbound-queue');
const baileysManager = require('../whatsapp-adapters/baileys.manager');

const router = express.Router();
const UNIQUE_VIOLATION = '23505';

async function requireSgpApiKey(req, res, next) {
  const header = req.headers.authorization;
  const apiKey = header && header.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
  if (!apiKey) {
    return res.status(401).json({ error: 'Missing authorization token' });
  }
  const verification = await verifySgpApiKey(apiKey);
  if (verification.status === 'not_configured') {
    return res.status(400).json({ error: 'SGP integration is not configured' });
  }
  if (verification.status === 'disabled') {
    return res.status(400).json({ error: 'SGP integration is not enabled' });
  }
  if (verification.status === 'no_key') {
    return res.status(400).json({ error: 'No API key has been generated for the SGP integration yet' });
  }
  if (verification.status === 'invalid') {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  req.sgpChannelId = verification.channelId;
  next();
}

router.post('/messages', requireSgpApiKey, async (req, res) => {
  const { phoneNumber, content, referenceId } = req.body || {};
  if (typeof phoneNumber !== 'string' || !phoneNumber.trim()) {
    return res.status(400).json({ error: 'phoneNumber is required' });
  }
  if (typeof content !== 'string' || !content.trim()) {
    return res.status(400).json({ error: 'content is required' });
  }
  if (typeof referenceId !== 'string' || !referenceId.trim()) {
    return res.status(400).json({ error: 'referenceId is required' });
  }

  const existingDispatch = await findSgpDispatchByReferenceId(referenceId);
  if (existingDispatch) {
    return res.status(200).json({
      conversationId: existingDispatch.conversationId,
      messageId: existingDispatch.messageId,
      duplicate: true,
    });
  }

  const channel = await findChannelById(req.sgpChannelId);
  if (!channel || channel.status !== 'connected') {
    return res.status(400).json({ error: 'The configured channel is not connected' });
  }

  const normalizedPhoneNumber = phoneNumber.replace(/\D/g, '');
  if (!normalizedPhoneNumber) {
    return res.status(400).json({ error: 'A valid phoneNumber is required' });
  }
  const canonicalPhoneNumber = await baileysManager.resolveWhatsAppJid(channel, normalizedPhoneNumber);
  if (!canonicalPhoneNumber) {
    return res.status(400).json({ error: 'This phone number is not on WhatsApp' });
  }

  const contact = await findOrCreateContactByPhoneNumber(canonicalPhoneNumber, null);

  let conversation = await findOpenConversation(contact.id, channel.id);
  if (!conversation) {
    try {
      conversation = await createConversation(contact.id, channel.id, null, 'silent');
    } catch (err) {
      if (err.code !== UNIQUE_VIOLATION) throw err;
      conversation = await findOpenConversation(contact.id, channel.id);
    }
  }

  const message = await enqueueOutboundMessage({ conversationId: conversation.id, channelId: channel.id, content });

  let dispatch;
  try {
    dispatch = await createSgpDispatch({ referenceId, conversationId: conversation.id, messageId: message.id });
  } catch (err) {
    if (err.code !== UNIQUE_VIOLATION) throw err;
    dispatch = await findSgpDispatchByReferenceId(referenceId);
  }

  res.status(202).json({ conversationId: dispatch.conversationId, messageId: dispatch.messageId });
});

module.exports = router;
```

In `src/server.js`, add the require near the other route requires:

```js
const integrationsSgpRoutes = require('./api/integrations-sgp.routes');
```

And mount it near the other `app.use('/api/...')` lines (public route, no `requireAuth` — it authenticates itself):

```js
app.use('/api/integrations/sgp', integrationsSgpRoutes);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest src/api/integrations-sgp.routes.test.js`
Expected: PASS (15 tests).

- [ ] **Step 5: Commit**

```bash
git add src/api/integrations-sgp.routes.js src/api/integrations-sgp.routes.test.js src/server.js
git commit -m "Add the POST /api/integrations/sgp/messages endpoint"
```

---

### Task 6: `admin-integrations.routes.js` — manage the SGP integration from the admin API

**Files:**
- Create: `src/api/admin-integrations.routes.js`
- Test: `src/api/admin-integrations.routes.test.js`
- Modify: `src/server.js`

**Interfaces:**
- Consumes: Task 3's `getSgpIntegration`, `saveSgpIntegrationChannel`, `rotateSgpApiKey`; existing `findChannelById`.
- Produces: `router` (default export) mounted at `/api/admin/integrations` in `server.js`, exposing `GET /sgp`, `PUT /sgp`, `POST /sgp/rotate-key`, all `requireAuth + requireRole('admin')`. Response shape `{configured: false}` or `{configured: true, channelId, enabled, hasApiKey}` — the plain API key is present ONLY in the `rotate-key` response, as `apiKey`.

- [ ] **Step 1: Write the failing tests**

Create `src/api/admin-integrations.routes.test.js`:

```js
jest.mock('../integrations/sgp-integration.repository');
jest.mock('../channels/channel.repository');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const { getSgpIntegration, saveSgpIntegrationChannel, rotateSgpApiKey } = require('../integrations/sgp-integration.repository');
const { findChannelById } = require('../channels/channel.repository');
const adminIntegrationsRoutes = require('./admin-integrations.routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/integrations', adminIntegrationsRoutes);
  return app;
}

function tokenFor(agentId, role) {
  return jwt.sign({ agentId, role }, process.env.JWT_SECRET);
}

describe('GET /api/admin/integrations/sgp', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns configured: false when there is no integration yet', async () => {
    getSgpIntegration.mockResolvedValue(null);
    const res = await request(buildApp())
      .get('/api/admin/integrations/sgp')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ configured: false });
  });

  test('returns the current configuration without the api key', async () => {
    getSgpIntegration.mockResolvedValue({ channelId: 'channel-1', enabled: true, hasApiKey: true });
    const res = await request(buildApp())
      .get('/api/admin/integrations/sgp')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ configured: true, channelId: 'channel-1', enabled: true, hasApiKey: true });
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .get('/api/admin/integrations/sgp')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(403);
    expect(getSgpIntegration).not.toHaveBeenCalled();
  });
});

describe('PUT /api/admin/integrations/sgp', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns 400 when channelId is missing', async () => {
    const res = await request(buildApp())
      .put('/api/admin/integrations/sgp')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ enabled: true });
    expect(res.status).toBe(400);
    expect(findChannelById).not.toHaveBeenCalled();
  });

  test('returns 400 when enabled is not a boolean', async () => {
    const res = await request(buildApp())
      .put('/api/admin/integrations/sgp')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ channelId: 'channel-1', enabled: 'yes' });
    expect(res.status).toBe(400);
  });

  test('returns 404 when the channel does not exist', async () => {
    findChannelById.mockResolvedValue(null);
    const res = await request(buildApp())
      .put('/api/admin/integrations/sgp')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ channelId: 'channel-1', enabled: true });
    expect(res.status).toBe(404);
  });

  test('returns 400 when the channel is not a baileys channel', async () => {
    findChannelById.mockResolvedValue({ id: 'channel-1', type: 'meta_cloud' });
    const res = await request(buildApp())
      .put('/api/admin/integrations/sgp')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ channelId: 'channel-1', enabled: true });
    expect(res.status).toBe(400);
    expect(saveSgpIntegrationChannel).not.toHaveBeenCalled();
  });

  test('saves the channel and enabled flag', async () => {
    findChannelById.mockResolvedValue({ id: 'channel-1', type: 'baileys' });
    saveSgpIntegrationChannel.mockResolvedValue({ channelId: 'channel-1', enabled: true, hasApiKey: false });

    const res = await request(buildApp())
      .put('/api/admin/integrations/sgp')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ channelId: 'channel-1', enabled: true });

    expect(saveSgpIntegrationChannel).toHaveBeenCalledWith({ channelId: 'channel-1', enabled: true });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ configured: true, channelId: 'channel-1', enabled: true, hasApiKey: false });
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .put('/api/admin/integrations/sgp')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ channelId: 'channel-1', enabled: true });
    expect(res.status).toBe(403);
    expect(saveSgpIntegrationChannel).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/integrations/sgp/rotate-key', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns the new plain api key', async () => {
    rotateSgpApiKey.mockResolvedValue({
      apiKey: 'plain-key-value',
      integration: { channelId: 'channel-1', enabled: true, hasApiKey: true },
    });

    const res = await request(buildApp())
      .post('/api/admin/integrations/sgp/rotate-key')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ apiKey: 'plain-key-value', configured: true, channelId: 'channel-1', enabled: true, hasApiKey: true });
  });

  test('returns 400 when no channel has been chosen yet', async () => {
    rotateSgpApiKey.mockResolvedValue(null);

    const res = await request(buildApp())
      .post('/api/admin/integrations/sgp/rotate-key')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);

    expect(res.status).toBe(400);
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .post('/api/admin/integrations/sgp/rotate-key')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(403);
    expect(rotateSgpApiKey).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest src/api/admin-integrations.routes.test.js`
Expected: FAIL — `Cannot find module './admin-integrations.routes'`.

- [ ] **Step 3: Implement**

Create `src/api/admin-integrations.routes.js`:

```js
const express = require('express');
const { requireAuth, requireRole } = require('../auth/auth.middleware');
const { getSgpIntegration, saveSgpIntegrationChannel, rotateSgpApiKey } = require('../integrations/sgp-integration.repository');
const { findChannelById } = require('../channels/channel.repository');

const router = express.Router();

function toIntegrationResponse(integration) {
  if (!integration) return { configured: false };
  return {
    configured: true,
    channelId: integration.channelId,
    enabled: integration.enabled,
    hasApiKey: integration.hasApiKey,
  };
}

router.get('/sgp', requireAuth, requireRole('admin'), async (req, res) => {
  const integration = await getSgpIntegration();
  res.json(toIntegrationResponse(integration));
});

router.put('/sgp', requireAuth, requireRole('admin'), async (req, res) => {
  const { channelId, enabled } = req.body || {};
  if (!channelId || typeof channelId !== 'string') {
    return res.status(400).json({ error: 'channelId is required' });
  }
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled must be a boolean' });
  }
  const channel = await findChannelById(channelId);
  if (!channel) {
    return res.status(404).json({ error: 'Channel not found' });
  }
  if (channel.type !== 'baileys') {
    return res.status(400).json({ error: 'Only Baileys channels can be used for the SGP integration' });
  }
  const integration = await saveSgpIntegrationChannel({ channelId, enabled });
  res.json(toIntegrationResponse(integration));
});

router.post('/sgp/rotate-key', requireAuth, requireRole('admin'), async (req, res) => {
  const rotated = await rotateSgpApiKey();
  if (!rotated) {
    return res.status(400).json({ error: 'Choose a channel for the SGP integration before generating a key' });
  }
  res.json({ apiKey: rotated.apiKey, ...toIntegrationResponse(rotated.integration) });
});

module.exports = router;
```

In `src/server.js`, add the require near the other admin route requires:

```js
const adminIntegrationsRoutes = require('./api/admin-integrations.routes');
```

And mount it near the other `app.use('/api/admin/...')` lines:

```js
app.use('/api/admin/integrations', adminIntegrationsRoutes);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest src/api/admin-integrations.routes.test.js`
Expected: PASS (12 tests).

- [ ] **Step 5: Run the full backend suite**

Run: `npm test`
Expected: all suites pass except the pre-existing known `outbound-queue.test.js` Redis-timing flake (2-4 failures there is normal and unrelated to this work — see `docs/superpowers/` project memory if unsure).

- [ ] **Step 6: Commit**

```bash
git add src/api/admin-integrations.routes.js src/api/admin-integrations.routes.test.js src/server.js
git commit -m "Add admin routes to configure the SGP integration and rotate its api key"
```

---

### Task 7: Frontend — `services/api.js` additions and the `useSgpIntegration` hook

**Files:**
- Modify: `frontend/src/services/api.js`
- Create: `frontend/src/hooks/useSgpIntegration.js`
- Create: `frontend/src/hooks/useSgpIntegration.test.jsx`

**Interfaces:**
- Consumes: Task 6's `GET/PUT /api/admin/integrations/sgp`, `POST /api/admin/integrations/sgp/rotate-key`; the existing `apiFetch(path, {method, body, token})` helper.
- Produces: `getSgpIntegration(token)`, `saveSgpIntegration(payload, token)`, `rotateSgpIntegrationKey(token)` (all from `services/api.js`); `useSgpIntegration()` → `{integration, loading, refresh}` (consumed by Task 8's `IntegrationsAdminTab.jsx`).

- [ ] **Step 1: Write the failing test**

Create `frontend/src/hooks/useSgpIntegration.test.jsx`:

```jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useSgpIntegration } from './useSgpIntegration';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
});

describe('useSgpIntegration', () => {
  test('fetches the integration on mount', async () => {
    api.getSgpIntegration.mockResolvedValue({ configured: true, channelId: 'channel-1', enabled: true, hasApiKey: true });

    const { result } = renderHook(() => useSgpIntegration());

    await waitFor(() =>
      expect(result.current.integration).toEqual({ configured: true, channelId: 'channel-1', enabled: true, hasApiKey: true })
    );
    expect(api.getSgpIntegration).toHaveBeenCalledWith('tok-123');
  });

  test('refresh refetches the integration', async () => {
    api.getSgpIntegration.mockResolvedValue({ configured: false });
    const { result } = renderHook(() => useSgpIntegration());
    await waitFor(() => expect(api.getSgpIntegration).toHaveBeenCalledTimes(1));

    api.getSgpIntegration.mockResolvedValue({ configured: true, channelId: 'channel-2', enabled: false, hasApiKey: false });
    await act(() => result.current.refresh());

    expect(result.current.integration).toEqual({ configured: true, channelId: 'channel-2', enabled: false, hasApiKey: false });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/hooks/useSgpIntegration.test.jsx`
Expected: FAIL — `Failed to resolve import "./useSgpIntegration"`.

- [ ] **Step 3: Implement**

Add to `frontend/src/services/api.js` (after the existing `deleteCity` function, matching its style):

```js
export function getSgpIntegration(token) {
  return apiFetch('/api/admin/integrations/sgp', { token });
}

export function saveSgpIntegration(payload, token) {
  return apiFetch('/api/admin/integrations/sgp', { method: 'PUT', body: payload, token });
}

export function rotateSgpIntegrationKey(token) {
  return apiFetch('/api/admin/integrations/sgp/rotate-key', { method: 'POST', token });
}
```

Create `frontend/src/hooks/useSgpIntegration.js`:

```js
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getSgpIntegration } from '../services/api';

export function useSgpIntegration() {
  const { token } = useAuth();
  const [integration, setIntegration] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    if (!token) return Promise.resolve();
    setLoading(true);
    return getSgpIntegration(token)
      .then((data) => {
        setIntegration(data);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, [token]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { integration, loading, refresh };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/hooks/useSgpIntegration.test.jsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/api.js frontend/src/hooks/useSgpIntegration.js frontend/src/hooks/useSgpIntegration.test.jsx
git commit -m "Add SGP integration api client functions and the useSgpIntegration hook"
```

---

### Task 8: Frontend — `IntegrationsAdminTab.jsx` and the new "Integrações" admin tab

**Files:**
- Create: `frontend/src/components/IntegrationsAdminTab.jsx`
- Create: `frontend/src/components/IntegrationsAdminTab.test.jsx`
- Modify: `frontend/src/pages/AdminChannelsPage.jsx`

**Interfaces:**
- Consumes: Task 7's `useSgpIntegration()`, `saveSgpIntegration(payload, token)`, `rotateSgpIntegrationKey(token)`; the existing `useChannels()` hook.
- Produces: `IntegrationsAdminTab` (default export), rendered as a new tab in `AdminChannelsPage.jsx`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/components/IntegrationsAdminTab.test.jsx`:

```jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import IntegrationsAdminTab from './IntegrationsAdminTab';
import { useSgpIntegration } from '../hooks/useSgpIntegration';
import { useChannels } from '../hooks/useChannels';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../hooks/useSgpIntegration');
vi.mock('../hooks/useChannels');
vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

const BAILEYS_CHANNEL = { id: 'channel-1', type: 'baileys', name: 'Berg' };
const META_CHANNEL = { id: 'channel-2', type: 'meta_cloud', name: 'Oficial' };

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
  useChannels.mockReturnValue({ channels: [BAILEYS_CHANNEL, META_CHANNEL] });
});

describe('IntegrationsAdminTab', () => {
  test('only lists Baileys channels in the dropdown', () => {
    useSgpIntegration.mockReturnValue({ integration: { configured: false }, refresh: vi.fn() });
    render(<IntegrationsAdminTab />);

    expect(screen.getByRole('option', { name: 'Berg' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Oficial' })).not.toBeInTheDocument();
  });

  test('saves the chosen channel', async () => {
    const refresh = vi.fn();
    useSgpIntegration.mockReturnValue({ integration: { configured: false }, refresh });
    api.saveSgpIntegration.mockResolvedValue({ configured: true, channelId: 'channel-1', enabled: true, hasApiKey: false });
    render(<IntegrationsAdminTab />);

    await userEvent.selectOptions(screen.getByLabelText(/canal/i), 'channel-1');
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));

    await waitFor(() =>
      expect(api.saveSgpIntegration).toHaveBeenCalledWith({ channelId: 'channel-1', enabled: true }, 'tok-123')
    );
    expect(refresh).toHaveBeenCalled();
  });

  test('shows the generate-key button once configured, and shows the key once after generating', async () => {
    useSgpIntegration.mockReturnValue({
      integration: { configured: true, channelId: 'channel-1', enabled: true, hasApiKey: false },
      refresh: vi.fn(),
    });
    api.rotateSgpIntegrationKey.mockResolvedValue({
      apiKey: 'plain-key-abc',
      configured: true,
      channelId: 'channel-1',
      enabled: true,
      hasApiKey: true,
    });
    render(<IntegrationsAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /gerar nova chave/i }));

    expect(await screen.findByText('plain-key-abc')).toBeInTheDocument();
  });

  test('does not show the key section before the integration is configured', () => {
    useSgpIntegration.mockReturnValue({ integration: { configured: false }, refresh: vi.fn() });
    render(<IntegrationsAdminTab />);

    expect(screen.queryByRole('button', { name: /gerar nova chave/i })).not.toBeInTheDocument();
  });

  test('shows an error message when saving fails', async () => {
    useSgpIntegration.mockReturnValue({ integration: { configured: false }, refresh: vi.fn() });
    api.saveSgpIntegration.mockRejectedValue({ body: { error: 'Falha ao salvar' } });
    render(<IntegrationsAdminTab />);

    await userEvent.selectOptions(screen.getByLabelText(/canal/i), 'channel-1');
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));

    expect(await screen.findByText('Falha ao salvar')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/IntegrationsAdminTab.test.jsx`
Expected: FAIL — `Failed to resolve import "./IntegrationsAdminTab"`.

- [ ] **Step 3: Implement**

Create `frontend/src/components/IntegrationsAdminTab.jsx`:

```jsx
import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useSgpIntegration } from '../hooks/useSgpIntegration';
import { useChannels } from '../hooks/useChannels';
import { saveSgpIntegration, rotateSgpIntegrationKey } from '../services/api';

const inputClass =
  'w-full rounded-xl border border-ink-950/15 bg-white/60 px-3.5 py-2.5 text-ink-950 outline-none transition focus:border-teal-signal/60 focus:bg-white/90 focus:ring-2 focus:ring-teal-signal/25';
const labelClass = 'mb-1.5 block text-sm font-medium text-ink-950/70';
const cardClass = 'space-y-3 rounded-2xl border border-white/70 bg-white/50 p-6 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)] backdrop-blur-xl';

function IntegrationsAdminTab() {
  const { token } = useAuth();
  const { integration, refresh } = useSgpIntegration();
  const { channels } = useChannels();
  const baileysChannels = channels.filter((channel) => channel.type === 'baileys');

  const [channelId, setChannelId] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [generatedKey, setGeneratedKey] = useState(null);

  const selectedChannelId = channelId || (integration && integration.channelId) || '';
  const selectedEnabled = channelId ? enabled : integration ? integration.enabled !== false : enabled;

  async function handleSave(event) {
    event.preventDefault();
    if (!selectedChannelId) {
      setError('Escolha um canal');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await saveSgpIntegration({ channelId: selectedChannelId, enabled: selectedEnabled }, token);
      await refresh();
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao salvar a integração');
    } finally {
      setSaving(false);
    }
  }

  async function handleRotateKey() {
    setError(null);
    setRotating(true);
    try {
      const result = await rotateSgpIntegrationKey(token);
      setGeneratedKey(result.apiKey);
      await refresh();
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao gerar a chave');
    } finally {
      setRotating(false);
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleSave} className={cardClass}>
        <h3 className="font-display text-base font-semibold text-ink-950">SGP</h3>
        <p className="text-sm text-ink-950/55">Permite que o SGP dispare mensagens de WhatsApp através deste sistema.</p>
        <div>
          <label htmlFor="sgp-channel" className={labelClass}>
            Canal
          </label>
          <select id="sgp-channel" value={selectedChannelId} onChange={(e) => setChannelId(e.target.value)} className={inputClass}>
            <option value="">Selecione um canal</option>
            {baileysChannels.map((channel) => (
              <option key={channel.id} value={channel.id}>
                {channel.name}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm text-ink-950/70">
          <input
            type="checkbox"
            checked={selectedEnabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-4 w-4 accent-teal-signal"
          />
          Ativo
        </label>
        {error && <p className="rounded-lg border border-red-300 bg-red-50/80 px-3 py-2 text-sm text-red-700">{error}</p>}
        <button
          type="submit"
          disabled={saving}
          className="rounded-xl bg-gradient-to-r from-amber-signal to-amber-signal-dark px-4 py-2.5 font-medium text-ink-950 shadow-[0_10px_30px_-8px_rgba(242,169,60,0.5)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Salvar
        </button>
      </form>

      {integration && integration.configured && (
        <div className={cardClass}>
          <h3 className="font-display text-base font-semibold text-ink-950">Chave de API</h3>
          <p className="text-sm text-ink-950/55">
            {integration.hasApiKey ? 'Uma chave já foi gerada.' : 'Nenhuma chave foi gerada ainda.'}
          </p>
          <button
            onClick={handleRotateKey}
            disabled={rotating}
            className="rounded-lg bg-teal-signal px-3 py-2 text-sm font-medium text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Gerar nova chave
          </button>
          {generatedKey && (
            <div className="rounded-lg border border-amber-signal/50 bg-amber-signal/10 px-3 py-2 text-sm text-ink-950">
              <p className="font-medium">Copie agora — esta chave não será mostrada novamente:</p>
              <code className="mt-1 block break-all rounded bg-white/70 px-2 py-1">{generatedKey}</code>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default IntegrationsAdminTab;
```

In `frontend/src/pages/AdminChannelsPage.jsx`:

Add the import, alongside the other tab component imports:

```js
import IntegrationsAdminTab from '../components/IntegrationsAdminTab';
```

Add a new entry to `TABS`, after `'templates'`:

```js
const TABS = [
  { value: 'channels', label: 'Canais' },
  { value: 'agents', label: 'Atendentes' },
  { value: 'quickReplies', label: 'Respostas rápidas' },
  { value: 'sectors', label: 'Setores' },
  { value: 'cities', label: 'Cidades' },
  { value: 'triage', label: 'Triagem' },
  { value: 'templates', label: 'Templates' },
  { value: 'integrations', label: 'Integrações' },
];
```

Change the final `else` branch of the tab-content conditional from an unconditional `<TemplatesAdminTab />` to distinguish `'templates'` from the new `'integrations'` value:

```jsx
        ) : activeTab === 'templates' ? (
          <TemplatesAdminTab />
        ) : (
          <IntegrationsAdminTab />
        )}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/IntegrationsAdminTab.test.jsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Run the full frontend suite**

Run: `cd frontend && npx vitest run`
Expected: all tests pass (previous total + the new tests from Tasks 7 and 8, no regressions).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/IntegrationsAdminTab.jsx frontend/src/components/IntegrationsAdminTab.test.jsx frontend/src/pages/AdminChannelsPage.jsx
git commit -m "Add the Integrações admin tab for configuring the SGP integration"
```
