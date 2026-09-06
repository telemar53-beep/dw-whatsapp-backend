# Triage Automation Bot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically ask every new customer conversation (on channels where it's enabled) a single configurable question to route it to a sector, before it reaches a human attendant.

**Architecture:** All new behavior hooks into the single existing entry point every inbound message already passes through (`ingestInboundMessage`). A new `src/triage/` module owns the triage config/options data and the matching logic; `conversation.repository.js` and `channel.repository.js` gain a few new columns/functions; the queue already shows every waiting conversation from its first message (no change needed there) — it just gains a `sectorName` tag once triage resolves.

**Tech Stack:** Node.js/Express/PostgreSQL (existing), React/Vite/Tailwind (existing). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-06-triage-automation-design.md`

## Global Constraints

- One single shared triage configuration (question, confirmation message, max attempts, and the numbered option list) — never per-channel. Each channel only has an on/off toggle (`channels.triage_enabled`).
- The bot's question message is composed as `questionText + "\n" + "<number> - <sector name>"` for every configured option, one per line — the admin only writes the intro sentence; the numbered list is generated automatically from `triage_options` so it can never drift out of sync.
- Matching a reply: an exact match on the option's number (as a string) OR a case-insensitive substring match against any of that option's configured keyword phrases. If more than one option matches, the option with the lowest `option_number` wins.
- Triage only ever runs for **customer-initiated** conversations (created inside `ingestInboundMessage`). Conversations created by an attendant via `POST /api/conversations/start` (in `conversations.routes.js`) never go through triage — that route's existing 2-argument call to `createConversation` needs no change, since the new third argument defaults to `null`.
- A conversation whose triage is still pending is claimable and visible in the queue exactly like any other waiting conversation (no hidden state) — claiming it cancels the triage immediately, in the same database write as the claim.
- No sector-based queue filtering of any kind — `sectorId`/`sectorName` on a conversation are informational only.
- If a channel has `triage_enabled = true` but zero triage options are configured, triage does not start at all for that channel (avoids trapping a customer in a loop with no valid options to pick from).

---

### Task 1: Triage schema, repository, and matching logic

**Files:**
- Create: `migrations/1788740000000_create-triage-tables.js`
- Create: `src/triage/triage.repository.js`
- Create: `src/triage/triage.repository.test.js`
- Create: `src/triage/triage-matcher.js`
- Create: `src/triage/triage-matcher.test.js`

**Interfaces:**
- Produces: `getTriageConfig()` → `Promise<{questionText, confirmationText, maxAttempts}>`; `updateTriageConfig({questionText, confirmationText, maxAttempts})` → `Promise<{questionText, confirmationText, maxAttempts}>`; `listTriageOptions()` → `Promise<Array<{id, optionNumber, sectorId, sectorName, keywords}>>`, ordered by `optionNumber` ascending; `createTriageOption({optionNumber, sectorId, keywords})` → `Promise<option>`; `updateTriageOption(id, {optionNumber, sectorId, keywords})` → `Promise<option|null>`; `deleteTriageOption(id)` → `Promise<boolean>`. `findMatchingOption(options, replyText)` → the matched option object or `null`. Task 3 consumes all of these; Task 4's admin routes consume the repository functions directly.

- [ ] **Step 1: Write the migration**

Create `migrations/1788740000000_create-triage-tables.js`:

```js
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE channels
      ADD COLUMN triage_enabled BOOLEAN NOT NULL DEFAULT false;

    ALTER TABLE conversations
      ADD COLUMN sector_id UUID REFERENCES sectors(id) ON DELETE SET NULL,
      ADD COLUMN triage_state TEXT CHECK (triage_state IN ('pending', 'completed')),
      ADD COLUMN triage_attempts INTEGER NOT NULL DEFAULT 0;

    CREATE TABLE triage_config (
      id INTEGER PRIMARY KEY DEFAULT 1,
      question_text TEXT NOT NULL,
      confirmation_text TEXT NOT NULL,
      max_attempts INTEGER NOT NULL DEFAULT 2,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    INSERT INTO triage_config (id, question_text, confirmation_text, max_attempts) VALUES (
      1,
      'Para agilizar seu atendimento, escolha uma opção digitando o número correspondente:',
      'Obrigado! Você será atendido em breve.',
      2
    );

    CREATE TABLE triage_options (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      option_number INTEGER NOT NULL UNIQUE,
      sector_id UUID NOT NULL REFERENCES sectors(id) ON DELETE CASCADE,
      keywords TEXT[] NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE triage_options;
    DROP TABLE triage_config;

    ALTER TABLE conversations
      DROP COLUMN sector_id,
      DROP COLUMN triage_state,
      DROP COLUMN triage_attempts;

    ALTER TABLE channels
      DROP COLUMN triage_enabled;
  `);
};
```

This depends on the `sectors` table, which already exists (from the agent-sectors plan). `npm test`'s `pretest` script already runs `migrate:test -- up` automatically — no manual step needed.

- [ ] **Step 2: Write the failing tests for the matcher (pure logic, no DB)**

Create `src/triage/triage-matcher.test.js`:

```js
const { findMatchingOption } = require('./triage-matcher');

describe('findMatchingOption', () => {
  const options = [
    { id: 'opt-1', optionNumber: 1, sectorId: 'sector-1', sectorName: 'Financeiro', keywords: ['financeiro', 'conta', 'fatura', 'boleto'] },
    { id: 'opt-2', optionNumber: 2, sectorId: 'sector-2', sectorName: 'Suporte', keywords: ['suporte', 'internet', 'sem sinal'] },
  ];

  test('matches by exact option number', () => {
    expect(findMatchingOption(options, '1')).toEqual(options[0]);
    expect(findMatchingOption(options, '2')).toEqual(options[1]);
  });

  test('matches by a keyword contained anywhere in the reply, case-insensitively', () => {
    expect(findMatchingOption(options, 'queria saber da minha FATURA')).toEqual(options[0]);
    expect(findMatchingOption(options, 'minha internet caiu')).toEqual(options[1]);
  });

  test('trims whitespace before comparing the option number', () => {
    expect(findMatchingOption(options, '  1  ')).toEqual(options[0]);
  });

  test('returns null when nothing matches', () => {
    expect(findMatchingOption(options, 'não sei o que quero')).toBeNull();
  });

  test('returns null for an empty or missing reply', () => {
    expect(findMatchingOption(options, '')).toBeNull();
    expect(findMatchingOption(options, null)).toBeNull();
    expect(findMatchingOption(options, undefined)).toBeNull();
  });

  test('when multiple options match, the lowest option number wins', () => {
    const overlapping = [
      { id: 'opt-3', optionNumber: 3, sectorId: 'sector-3', sectorName: 'Comercial', keywords: ['ajuda'] },
      { id: 'opt-4', optionNumber: 1, sectorId: 'sector-4', sectorName: 'Geral', keywords: ['ajuda'] },
    ];
    expect(findMatchingOption(overlapping, 'preciso de ajuda')).toEqual(overlapping[1]);
  });

  test('does not depend on the input array already being sorted', () => {
    const reversed = [options[1], options[0]];
    expect(findMatchingOption(reversed, '1')).toEqual(options[0]);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx dotenv -e .env.test -o -- jest src/triage/triage-matcher.test.js`
Expected: FAIL with "Cannot find module './triage-matcher'"

- [ ] **Step 4: Implement the matcher**

Create `src/triage/triage-matcher.js`:

```js
function findMatchingOption(options, replyText) {
  const trimmed = (replyText || '').trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  const sorted = [...options].sort((a, b) => a.optionNumber - b.optionNumber);
  return (
    sorted.find((option) => {
      if (trimmed === String(option.optionNumber)) return true;
      return (option.keywords || []).some((keyword) => lower.includes(keyword.toLowerCase()));
    }) || null
  );
}

module.exports = { findMatchingOption };
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx dotenv -e .env.test -o -- jest src/triage/triage-matcher.test.js`
Expected: PASS, 7/7 tests

- [ ] **Step 6: Commit**

```bash
git add src/triage/triage-matcher.js src/triage/triage-matcher.test.js
git commit -m "feat: add pure triage option-matching logic"
```

- [ ] **Step 7: Write the failing tests for the triage repository**

Create `src/triage/triage.repository.test.js`:

```js
const { getPool, closePool } = require('../db/pool');
const { createSector } = require('../sectors/sector.repository');
const {
  getTriageConfig,
  updateTriageConfig,
  listTriageOptions,
  createTriageOption,
  updateTriageOption,
  deleteTriageOption,
} = require('./triage.repository');

const DEFAULT_QUESTION = 'Para agilizar seu atendimento, escolha uma opção digitando o número correspondente:';
const DEFAULT_CONFIRMATION = 'Obrigado! Você será atendido em breve.';

describe('triage repository', () => {
  let financeiroId;
  let suporteId;

  beforeEach(async () => {
    await getPool().query('TRUNCATE triage_options, sectors CASCADE');
    await getPool().query('UPDATE triage_config SET question_text = $1, confirmation_text = $2, max_attempts = $3 WHERE id = 1', [
      DEFAULT_QUESTION,
      DEFAULT_CONFIRMATION,
      2,
    ]);
    const financeiro = await createSector({ name: 'Financeiro' });
    const suporte = await createSector({ name: 'Suporte' });
    financeiroId = financeiro.id;
    suporteId = suporte.id;
  });

  afterAll(async () => {
    await closePool();
  });

  test('getTriageConfig returns the seeded singleton row', async () => {
    const config = await getTriageConfig();
    expect(config).toEqual({ questionText: DEFAULT_QUESTION, confirmationText: DEFAULT_CONFIRMATION, maxAttempts: 2 });
  });

  test('updateTriageConfig overwrites the singleton row and returns it', async () => {
    const updated = await updateTriageConfig({ questionText: 'Nova pergunta', confirmationText: 'Nova confirmação', maxAttempts: 3 });
    expect(updated).toEqual({ questionText: 'Nova pergunta', confirmationText: 'Nova confirmação', maxAttempts: 3 });
    const reread = await getTriageConfig();
    expect(reread).toEqual(updated);
  });

  test('listTriageOptions returns an empty array when none are configured', async () => {
    expect(await listTriageOptions()).toEqual([]);
  });

  test('createTriageOption stores and returns the option with its sector name', async () => {
    const option = await createTriageOption({ optionNumber: 1, sectorId: financeiroId, keywords: ['financeiro', 'fatura'] });
    expect(option).toEqual({
      id: expect.any(String),
      optionNumber: 1,
      sectorId: financeiroId,
      sectorName: 'Financeiro',
      keywords: ['financeiro', 'fatura'],
    });
  });

  test('listTriageOptions returns options ordered by option number ascending', async () => {
    await createTriageOption({ optionNumber: 2, sectorId: suporteId, keywords: ['suporte'] });
    await createTriageOption({ optionNumber: 1, sectorId: financeiroId, keywords: ['financeiro'] });

    const options = await listTriageOptions();

    expect(options.map((o) => o.optionNumber)).toEqual([1, 2]);
    expect(options.map((o) => o.sectorName)).toEqual(['Financeiro', 'Suporte']);
  });

  test('createTriageOption rejects a duplicate option number', async () => {
    await createTriageOption({ optionNumber: 1, sectorId: financeiroId, keywords: [] });
    await expect(createTriageOption({ optionNumber: 1, sectorId: suporteId, keywords: [] })).rejects.toMatchObject({
      code: '23505',
    });
  });

  test('updateTriageOption changes the number, sector, and keywords', async () => {
    const option = await createTriageOption({ optionNumber: 1, sectorId: financeiroId, keywords: ['financeiro'] });

    const updated = await updateTriageOption(option.id, { optionNumber: 5, sectorId: suporteId, keywords: ['suporte', 'internet'] });

    expect(updated).toEqual({
      id: option.id,
      optionNumber: 5,
      sectorId: suporteId,
      sectorName: 'Suporte',
      keywords: ['suporte', 'internet'],
    });
  });

  test('updateTriageOption returns null when the option does not exist', async () => {
    const updated = await updateTriageOption('00000000-0000-0000-0000-000000000000', {
      optionNumber: 1,
      sectorId: financeiroId,
      keywords: [],
    });
    expect(updated).toBeNull();
  });

  test('deleteTriageOption removes the option and returns true', async () => {
    const option = await createTriageOption({ optionNumber: 1, sectorId: financeiroId, keywords: [] });
    expect(await deleteTriageOption(option.id)).toBe(true);
    expect(await listTriageOptions()).toEqual([]);
  });

  test('deleteTriageOption returns false when the option does not exist', async () => {
    expect(await deleteTriageOption('00000000-0000-0000-0000-000000000000')).toBe(false);
  });

  test('deleting a sector cascades and removes its triage option', async () => {
    const option = await createTriageOption({ optionNumber: 1, sectorId: financeiroId, keywords: [] });
    await getPool().query('DELETE FROM sectors WHERE id = $1', [financeiroId]);
    expect(await listTriageOptions()).toEqual([]);
    expect(await updateTriageOption(option.id, { optionNumber: 1, sectorId: suporteId, keywords: [] })).toBeNull();
  });
});
```

- [ ] **Step 8: Run the test to verify it fails**

Run: `npx dotenv -e .env.test -o -- jest src/triage/triage.repository.test.js`
Expected: FAIL with "Cannot find module './triage.repository'"

- [ ] **Step 9: Implement the triage repository**

Create `src/triage/triage.repository.js`:

```js
const { getPool } = require('../db/pool');

function toTriageConfig(row) {
  return {
    questionText: row.question_text,
    confirmationText: row.confirmation_text,
    maxAttempts: row.max_attempts,
  };
}

function toTriageOption(row) {
  return {
    id: row.id,
    optionNumber: row.option_number,
    sectorId: row.sector_id,
    sectorName: row.sector_name,
    keywords: row.keywords,
  };
}

async function getTriageConfig() {
  const result = await getPool().query(
    'SELECT question_text, confirmation_text, max_attempts FROM triage_config WHERE id = 1'
  );
  return toTriageConfig(result.rows[0]);
}

async function updateTriageConfig({ questionText, confirmationText, maxAttempts }) {
  const result = await getPool().query(
    `UPDATE triage_config SET question_text = $1, confirmation_text = $2, max_attempts = $3, updated_at = now()
     WHERE id = 1
     RETURNING question_text, confirmation_text, max_attempts`,
    [questionText, confirmationText, maxAttempts]
  );
  return toTriageConfig(result.rows[0]);
}

async function listTriageOptions() {
  const result = await getPool().query(
    `SELECT o.id, o.option_number, o.sector_id, o.keywords, s.name AS sector_name
     FROM triage_options o
     JOIN sectors s ON s.id = o.sector_id
     ORDER BY o.option_number ASC`
  );
  return result.rows.map(toTriageOption);
}

async function findTriageOptionById(id) {
  const result = await getPool().query(
    `SELECT o.id, o.option_number, o.sector_id, o.keywords, s.name AS sector_name
     FROM triage_options o
     JOIN sectors s ON s.id = o.sector_id
     WHERE o.id = $1`,
    [id]
  );
  if (result.rowCount === 0) return null;
  return toTriageOption(result.rows[0]);
}

async function createTriageOption({ optionNumber, sectorId, keywords }) {
  const insertResult = await getPool().query(
    'INSERT INTO triage_options (option_number, sector_id, keywords) VALUES ($1, $2, $3) RETURNING id',
    [optionNumber, sectorId, keywords]
  );
  return findTriageOptionById(insertResult.rows[0].id);
}

async function updateTriageOption(id, { optionNumber, sectorId, keywords }) {
  const result = await getPool().query(
    `UPDATE triage_options SET option_number = $2, sector_id = $3, keywords = $4
     WHERE id = $1
     RETURNING id`,
    [id, optionNumber, sectorId, keywords]
  );
  if (result.rowCount === 0) return null;
  return findTriageOptionById(id);
}

async function deleteTriageOption(id) {
  const result = await getPool().query('DELETE FROM triage_options WHERE id = $1', [id]);
  return result.rowCount > 0;
}

module.exports = {
  getTriageConfig,
  updateTriageConfig,
  listTriageOptions,
  createTriageOption,
  updateTriageOption,
  deleteTriageOption,
};
```

- [ ] **Step 10: Run the test to verify it passes**

Run: `npx dotenv -e .env.test -o -- jest src/triage/triage.repository.test.js`
Expected: PASS, 12/12 tests

- [ ] **Step 11: Commit**

```bash
git add migrations/1788740000000_create-triage-tables.js src/triage/triage.repository.js src/triage/triage.repository.test.js
git commit -m "feat: add triage config/options schema and repository"
```

---

### Task 2: Extend `conversation.repository.js` and `channel.repository.js` for triage

**Files:**
- Modify: `src/conversations/conversation.repository.js` (whole file, 160 lines)
- Modify: `src/conversations/conversation.repository.test.js` (add tests; update the `beforeEach` TRUNCATE line)
- Modify: `src/channels/channel.repository.js` (whole file, 68 lines)
- Modify: `src/channels/channel.repository.test.js` (add tests)

**Interfaces:**
- Consumes: nothing new from Task 1 directly (this task only needs the migrated columns, already applied).
- Produces: `createConversation(contactId, channelId, triageState = null)` (3rd param optional, backward compatible); `claimConversation` now also sets `triage_state = 'completed'` on every successful claim; `completeTriage(conversationId, sectorId)` → `Promise<conversation|null>`; `incrementTriageAttempts(conversationId)` → `Promise<number>` (the new attempt count); every conversation object now also carries `sectorId`, `triageState`, `triageAttempts`, and (for `getConversationWithContact`/`listWaitingConversations`/`listConversationsByAgent`) `sectorName`. `updateChannelTriageEnabled(id, triageEnabled)` → `Promise<channel|null>`; every channel object now also carries `triageEnabled`. Task 3 consumes `completeTriage`, `incrementTriageAttempts`, and `findChannelById`'s new `triageEnabled` field. Task 4 consumes `updateChannelTriageEnabled`. Task 5 consumes `sectorName` on queue/mine conversation objects.

- [ ] **Step 1: Write the failing tests for `conversation.repository.js`**

`src/conversations/conversation.repository.test.js` currently starts like this (lines 1-32):

```js
const { getPool, closePool } = require('../db/pool');
const { createChannel } = require('../channels/channel.repository');
const { findOrCreateContactByPhoneNumber } = require('./contact.repository');
const { createAgent } = require('../agents/agent.repository');
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
} = require('./conversation.repository');

describe('conversation repository', () => {
  let contactId;
  let channelId;

  beforeEach(async () => {
    await getPool().query('TRUNCATE conversations, contacts, channels, agents, conversation_events CASCADE');
    const contact = await findOrCreateContactByPhoneNumber('+5511977776666', 'Joao');
    const channel = await createChannel({
      type: 'meta_cloud',
      name: 'Canal Teste',
      phoneNumber: '+5511999990009',
      config: { phoneNumberId: '111', accessToken: 'tok' },
    });
    contactId = contact.id;
    channelId = channel.id;
  });

  afterAll(async () => {
    await closePool();
```

Change the imports and the `TRUNCATE` line to add `sectors` (needed by the new tests below) and `completeTriage`/`incrementTriageAttempts`:

```js
const { getPool, closePool } = require('../db/pool');
const { createChannel } = require('../channels/channel.repository');
const { findOrCreateContactByPhoneNumber } = require('./contact.repository');
const { createAgent } = require('../agents/agent.repository');
const { createSector } = require('../sectors/sector.repository');
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
} = require('./conversation.repository');

describe('conversation repository', () => {
  let contactId;
  let channelId;

  beforeEach(async () => {
    await getPool().query('TRUNCATE conversations, contacts, channels, agents, conversation_events, sectors CASCADE');
    const contact = await findOrCreateContactByPhoneNumber('+5511977776666', 'Joao');
    const channel = await createChannel({
      type: 'meta_cloud',
      name: 'Canal Teste',
      phoneNumber: '+5511999990009',
      config: { phoneNumberId: '111', accessToken: 'tok' },
    });
    contactId = contact.id;
    channelId = channel.id;
  });

  afterAll(async () => {
    await closePool();
```

Then add these tests anywhere inside the `describe('conversation repository', ...)` block:

```js
  test('createConversation defaults triageState to null when not provided', async () => {
    const conversation = await createConversation(contactId, channelId);
    expect(conversation.triageState).toBeNull();
    expect(conversation.triageAttempts).toBe(0);
    expect(conversation.sectorId).toBeNull();
  });

  test('createConversation stores a provided triageState', async () => {
    const conversation = await createConversation(contactId, channelId, 'pending');
    expect(conversation.triageState).toBe('pending');
  });

  test('claimConversation completes any pending triage as part of the claim', async () => {
    const conversation = await createConversation(contactId, channelId, 'pending');
    const agent = await createAgent({ email: 'triageagent@dw.com', password: 'secret123', role: 'agent' });

    const claimed = await claimConversation(conversation.id, agent.id);

    expect(claimed.triageState).toBe('completed');
  });

  test('completeTriage sets the sector and marks triage completed', async () => {
    const sector = await createSector({ name: 'Financeiro' });
    const conversation = await createConversation(contactId, channelId, 'pending');

    const updated = await completeTriage(conversation.id, sector.id);

    expect(updated.sectorId).toBe(sector.id);
    expect(updated.triageState).toBe('completed');
  });

  test('completeTriage accepts a null sectorId for the fallback-to-general-queue case', async () => {
    const conversation = await createConversation(contactId, channelId, 'pending');

    const updated = await completeTriage(conversation.id, null);

    expect(updated.sectorId).toBeNull();
    expect(updated.triageState).toBe('completed');
  });

  test('incrementTriageAttempts increases the counter and returns the new value', async () => {
    const conversation = await createConversation(contactId, channelId, 'pending');

    const first = await incrementTriageAttempts(conversation.id);
    const second = await incrementTriageAttempts(conversation.id);

    expect(first).toBe(1);
    expect(second).toBe(2);
  });

  test('getConversationWithContact includes the sector name when a sector is set', async () => {
    const sector = await createSector({ name: 'Suporte' });
    const conversation = await createConversation(contactId, channelId);
    await completeTriage(conversation.id, sector.id);

    const result = await getConversationWithContact(conversation.id);

    expect(result.sectorId).toBe(sector.id);
    expect(result.sectorName).toBe('Suporte');
  });

  test('getConversationWithContact has a null sectorName when no sector is set', async () => {
    const conversation = await createConversation(contactId, channelId);

    const result = await getConversationWithContact(conversation.id);

    expect(result.sectorId).toBeNull();
    expect(result.sectorName).toBeNull();
  });

  test('listWaitingConversations includes the sector name for a triaged conversation', async () => {
    const sector = await createSector({ name: 'Comercial' });
    const conversation = await createConversation(contactId, channelId);
    await completeTriage(conversation.id, sector.id);

    const waiting = await listWaitingConversations();

    expect(waiting[0].sectorId).toBe(sector.id);
    expect(waiting[0].sectorName).toBe('Comercial');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx dotenv -e .env.test -o -- jest src/conversations/conversation.repository.test.js`
Expected: FAIL — `conversation.triageState`/`sectorId` are `undefined` (columns don't exist in the current SELECT lists yet), and `completeTriage`/`incrementTriageAttempts` are not exported.

- [ ] **Step 3: Implement the changes**

Replace the full contents of `src/conversations/conversation.repository.js` (currently 160 lines) with:

```js
const { getPool, withTransaction } = require('../db/pool');

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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toConversationSummary(row) {
  return {
    ...toConversation(row),
    contactPhoneNumber: row.contact_phone_number,
    contactDisplayName: row.contact_display_name,
    sectorName: row.sector_name,
  };
}

async function findOpenConversation(contactId, channelId) {
  const result = await getPool().query(
    `SELECT id, contact_id, channel_id, status, assigned_agent_id, sector_id, triage_state, triage_attempts, created_at, updated_at
     FROM conversations WHERE contact_id = $1 AND channel_id = $2 AND status <> 'closed'`,
    [contactId, channelId]
  );
  if (result.rowCount === 0) return null;
  return toConversation(result.rows[0]);
}

async function createConversation(contactId, channelId, triageState = null) {
  const result = await getPool().query(
    `INSERT INTO conversations (contact_id, channel_id, triage_state) VALUES ($1, $2, $3)
     RETURNING id, contact_id, channel_id, status, assigned_agent_id, sector_id, triage_state, triage_attempts, created_at, updated_at`,
    [contactId, channelId, triageState]
  );
  return toConversation(result.rows[0]);
}

async function claimConversation(conversationId, agentId) {
  return withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE conversations SET status = 'assigned', assigned_agent_id = $2, triage_state = 'completed', updated_at = now()
       WHERE id = $1 AND assigned_agent_id IS NULL AND status <> 'closed'
       RETURNING id, contact_id, channel_id, status, assigned_agent_id, sector_id, triage_state, triage_attempts, created_at, updated_at`,
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

async function transferConversation(conversationId, fromAgentId, toAgentId) {
  return withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE conversations SET assigned_agent_id = $2, updated_at = now()
       WHERE id = $1 AND assigned_agent_id = $3 AND status <> 'closed'
       RETURNING id, contact_id, channel_id, status, assigned_agent_id, sector_id, triage_state, triage_attempts, created_at, updated_at`,
      [conversationId, toAgentId, fromAgentId]
    );
    if (result.rowCount === 0) return null;
    await client.query(
      `INSERT INTO conversation_events (conversation_id, event_type, from_agent_id, to_agent_id) VALUES ($1, 'transferred', $2, $3)`,
      [conversationId, fromAgentId, toAgentId]
    );
    return toConversation(result.rows[0]);
  });
}

async function closeConversation(conversationId, agentId) {
  return withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE conversations SET status = 'closed', updated_at = now()
       WHERE id = $1 AND assigned_agent_id = $2 AND status <> 'closed'
       RETURNING id, contact_id, channel_id, status, assigned_agent_id, sector_id, triage_state, triage_attempts, created_at, updated_at`,
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

async function completeTriage(conversationId, sectorId) {
  const result = await getPool().query(
    `UPDATE conversations SET sector_id = $2, triage_state = 'completed', updated_at = now()
     WHERE id = $1
     RETURNING id, contact_id, channel_id, status, assigned_agent_id, sector_id, triage_state, triage_attempts, created_at, updated_at`,
    [conversationId, sectorId]
  );
  if (result.rowCount === 0) return null;
  return toConversation(result.rows[0]);
}

async function incrementTriageAttempts(conversationId) {
  const result = await getPool().query(
    `UPDATE conversations SET triage_attempts = triage_attempts + 1, updated_at = now()
     WHERE id = $1
     RETURNING triage_attempts`,
    [conversationId]
  );
  if (result.rowCount === 0) return 0;
  return result.rows[0].triage_attempts;
}

async function getConversationWithContact(conversationId) {
  const result = await getPool().query(
    `SELECT c.id, c.contact_id, c.channel_id, c.status, c.assigned_agent_id, c.sector_id, c.triage_state, c.triage_attempts, c.created_at, c.updated_at,
            ct.phone_number AS contact_phone_number, ct.display_name AS contact_display_name,
            s.name AS sector_name
     FROM conversations c
     JOIN contacts ct ON ct.id = c.contact_id
     LEFT JOIN sectors s ON s.id = c.sector_id
     WHERE c.id = $1`,
    [conversationId]
  );
  if (result.rowCount === 0) return null;
  return toConversationSummary(result.rows[0]);
}

async function listWaitingConversations() {
  const result = await getPool().query(
    `SELECT c.id, c.contact_id, c.channel_id, c.status, c.assigned_agent_id, c.sector_id, c.triage_state, c.triage_attempts, c.created_at, c.updated_at,
            ct.phone_number AS contact_phone_number, ct.display_name AS contact_display_name,
            s.name AS sector_name
     FROM conversations c
     JOIN contacts ct ON ct.id = c.contact_id
     LEFT JOIN sectors s ON s.id = c.sector_id
     WHERE c.status = 'waiting'
     ORDER BY c.created_at ASC`
  );
  return result.rows.map(toConversationSummary);
}

async function listConversationsByAgent(agentId) {
  const result = await getPool().query(
    `SELECT c.id, c.contact_id, c.channel_id, c.status, c.assigned_agent_id, c.sector_id, c.triage_state, c.triage_attempts, c.created_at, c.updated_at,
            ct.phone_number AS contact_phone_number, ct.display_name AS contact_display_name,
            s.name AS sector_name
     FROM conversations c
     JOIN contacts ct ON ct.id = c.contact_id
     LEFT JOIN sectors s ON s.id = c.sector_id
     WHERE c.assigned_agent_id = $1 AND c.status <> 'closed'
     ORDER BY c.updated_at DESC`,
    [agentId]
  );
  return result.rows.map(toConversationSummary);
}

async function listClosedConversationsByContact(contactId) {
  const result = await getPool().query(
    `SELECT c.id, c.contact_id, c.channel_id, c.status, c.assigned_agent_id, c.created_at, c.updated_at,
            ch.name AS channel_name, ch.type AS channel_type
     FROM conversations c
     JOIN channels ch ON ch.id = c.channel_id
     WHERE c.contact_id = $1 AND c.status = 'closed'
     ORDER BY c.updated_at DESC
     LIMIT 50`,
    [contactId]
  );
  return result.rows.map((row) => ({
    ...toConversation(row),
    channelName: row.channel_name,
    channelType: row.channel_type,
  }));
}

module.exports = {
  findOpenConversation,
  createConversation,
  claimConversation,
  transferConversation,
  closeConversation,
  completeTriage,
  incrementTriageAttempts,
  getConversationWithContact,
  listWaitingConversations,
  listConversationsByAgent,
  listClosedConversationsByContact,
};
```

Note: `listClosedConversationsByContact` is deliberately left untouched (no sector join) — the spec only requires the sector tag on the queue and "minhas conversas" lists, not on the closed-conversation-history view. Its `SELECT` list also doesn't need `sector_id`/`triage_state`/`triage_attempts` added since `toConversation` reading `undefined` values for those there is harmless (this list's own object literal already overrides the shape with `channelName`/`channelType` on top of `toConversation`'s spread) — but for consistency don't add the new columns to this one query; it's genuinely out of scope.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx dotenv -e .env.test -o -- jest src/conversations/conversation.repository.test.js`
Expected: PASS, all tests in the file (existing + 9 new)

- [ ] **Step 5: Commit**

```bash
git add src/conversations/conversation.repository.js src/conversations/conversation.repository.test.js
git commit -m "feat: track triage state and sector on conversations"
```

- [ ] **Step 6: Write the failing tests for `channel.repository.js`**

Add these tests anywhere inside `src/channels/channel.repository.test.js`'s `describe('channel repository', ...)` block, and import `updateChannelTriageEnabled` alongside the existing imports:

Current import block (lines 1-8):

```js
const { getPool, closePool } = require('../db/pool');
const {
  createChannel,
  findChannelById,
  findChannelByMetaPhoneNumberId,
  listChannels,
  updateChannelStatus,
} = require('./channel.repository');
```

New:

```js
const { getPool, closePool } = require('../db/pool');
const {
  createChannel,
  findChannelById,
  findChannelByMetaPhoneNumberId,
  listChannels,
  updateChannelStatus,
  updateChannelTriageEnabled,
} = require('./channel.repository');
```

New tests (add anywhere inside the `describe` block):

```js
  test('createChannel defaults triageEnabled to false', async () => {
    const channel = await createChannel({
      type: 'baileys',
      name: 'Canal Sem Triagem',
      phoneNumber: '+5511999990020',
      config: {},
    });
    expect(channel.triageEnabled).toBe(false);
  });

  test('updateChannelTriageEnabled turns triage on and off', async () => {
    const channel = await createChannel({
      type: 'baileys',
      name: 'Canal Com Triagem',
      phoneNumber: '+5511999990021',
      config: {},
    });

    const enabled = await updateChannelTriageEnabled(channel.id, true);
    expect(enabled.triageEnabled).toBe(true);

    const disabled = await updateChannelTriageEnabled(channel.id, false);
    expect(disabled.triageEnabled).toBe(false);
  });

  test('updateChannelTriageEnabled returns null when the channel does not exist', async () => {
    const result = await updateChannelTriageEnabled('00000000-0000-0000-0000-000000000000', true);
    expect(result).toBeNull();
  });
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `npx dotenv -e .env.test -o -- jest src/channels/channel.repository.test.js`
Expected: FAIL — `channel.triageEnabled` is `undefined`, `updateChannelTriageEnabled` is not exported.

- [ ] **Step 8: Implement the changes**

Replace the full contents of `src/channels/channel.repository.js` (currently 68 lines) with:

```js
const { getPool } = require('../db/pool');

function toChannel(row) {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    phoneNumber: row.phone_number,
    config: row.config,
    status: row.status,
    triageEnabled: row.triage_enabled,
    createdAt: row.created_at,
  };
}

async function createChannel({ type, name, phoneNumber, config }) {
  const result = await getPool().query(
    `INSERT INTO channels (type, name, phone_number, config)
     VALUES ($1, $2, $3, $4)
     RETURNING id, type, name, phone_number, config, status, triage_enabled, created_at`,
    [type, name, phoneNumber, JSON.stringify(config)]
  );
  return toChannel(result.rows[0]);
}

async function findChannelById(id) {
  const result = await getPool().query(
    'SELECT id, type, name, phone_number, config, status, triage_enabled, created_at FROM channels WHERE id = $1',
    [id]
  );
  if (result.rowCount === 0) return null;
  return toChannel(result.rows[0]);
}

async function findChannelByMetaPhoneNumberId(phoneNumberId) {
  const result = await getPool().query(
    `SELECT id, type, name, phone_number, config, status, triage_enabled, created_at FROM channels
     WHERE type = 'meta_cloud' AND config->>'phoneNumberId' = $1`,
    [phoneNumberId]
  );
  if (result.rowCount === 0) return null;
  return toChannel(result.rows[0]);
}

async function listChannels() {
  const result = await getPool().query(
    'SELECT id, type, name, phone_number, config, status, triage_enabled, created_at FROM channels ORDER BY created_at ASC'
  );
  return result.rows.map(toChannel);
}

async function updateChannelStatus(id, status) {
  const result = await getPool().query(
    `UPDATE channels SET status = $2 WHERE id = $1
     RETURNING id, type, name, phone_number, config, status, triage_enabled, created_at`,
    [id, status]
  );
  if (result.rowCount === 0) return null;
  return toChannel(result.rows[0]);
}

async function updateChannelTriageEnabled(id, triageEnabled) {
  const result = await getPool().query(
    `UPDATE channels SET triage_enabled = $2 WHERE id = $1
     RETURNING id, type, name, phone_number, config, status, triage_enabled, created_at`,
    [id, triageEnabled]
  );
  if (result.rowCount === 0) return null;
  return toChannel(result.rows[0]);
}

module.exports = {
  createChannel,
  findChannelById,
  findChannelByMetaPhoneNumberId,
  listChannels,
  updateChannelStatus,
  updateChannelTriageEnabled,
};
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `npx dotenv -e .env.test -o -- jest src/channels/channel.repository.test.js`
Expected: PASS, all tests in the file (existing + 3 new)

- [ ] **Step 10: Run the full backend suite**

Run: `npm test`
Expected: PASS, all suites green except the 2 known pre-existing `outbound-queue.test.js` Bull/Redis timing flakes.

- [ ] **Step 11: Commit**

```bash
git add src/channels/channel.repository.js src/channels/channel.repository.test.js
git commit -m "feat: add per-channel triage_enabled toggle"
```

---

### Task 3: Triage service and `ingestInboundMessage` wiring

**Files:**
- Create: `src/triage/triage.service.js`
- Modify: `src/conversations/inbound-message.service.js` (whole file, 72 lines)
- Modify: `src/conversations/inbound-message.service.test.js` (update one existing assertion; add 4 new tests; add a new `jest.mock`)

**Interfaces:**
- Consumes: `getTriageConfig`, `listTriageOptions` (Task 1); `completeTriage`, `incrementTriageAttempts` (Task 2, from `conversation.repository.js`); `findChannelById` (Task 2, `channel.repository.js`, now returning `triageEnabled`); `findMatchingOption` (Task 1).
- Produces: `shouldStartTriage(channelId)` → `Promise<boolean>`; `sendTriageQuestion(conversationId, channelId)` → `Promise<void>`; `processTriageReply(conversation, channelId, replyText)` → `Promise<conversation>` (the updated conversation object — either still pending, unchanged, or with `sectorId`/`triageState` now set to `'completed'`). `ingestInboundMessage`'s emitted `queue:new`/`message:new` payloads now reflect the post-triage-processing conversation state.

- [ ] **Step 1: Write the failing tests for the inbound-message wiring**

`src/conversations/inbound-message.service.test.js` currently starts with (lines 1-12):

```js
jest.mock('./contact.repository');
jest.mock('./conversation.repository');
jest.mock('./message.repository');
jest.mock('../realtime/socket-server');
const { findOrCreateContactByPhoneNumber } = require('./contact.repository');
const { findOpenConversation, createConversation } = require('./conversation.repository');
const { createMessage } = require('./message.repository');
const { emitToAgent, broadcast } = require('../realtime/socket-server');
const { ingestInboundMessage } = require('./inbound-message.service');

describe('ingestInboundMessage', () => {
  beforeEach(() => jest.clearAllMocks());
```

Change it to also mock the new triage service, and default `shouldStartTriage` to `false` so every pre-existing test keeps its current behavior:

```js
jest.mock('./contact.repository');
jest.mock('./conversation.repository');
jest.mock('./message.repository');
jest.mock('../realtime/socket-server');
jest.mock('../triage/triage.service');
const { findOrCreateContactByPhoneNumber } = require('./contact.repository');
const { findOpenConversation, createConversation } = require('./conversation.repository');
const { createMessage } = require('./message.repository');
const { emitToAgent, broadcast } = require('../realtime/socket-server');
const { shouldStartTriage, sendTriageQuestion, processTriageReply } = require('../triage/triage.service');
const { ingestInboundMessage } = require('./inbound-message.service');

describe('ingestInboundMessage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    shouldStartTriage.mockResolvedValue(false);
  });
```

Then find this existing test (around line 85-101):

```js
  test('creates a new conversation when none is open', async () => {
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-2' });
    findOpenConversation.mockResolvedValue(null);
    createConversation.mockResolvedValue({ id: 'conv-2', assignedAgentId: null });
    createMessage.mockResolvedValue({ id: 'msg-2' });

    const result = await ingestInboundMessage({
      channelId: 'channel-1',
      fromPhoneNumber: '+5511999997777',
      contactDisplayName: 'Outro Cliente',
      whatsappMessageId: 'wamid.Y',
      content: 'Ola',
    });

    expect(createConversation).toHaveBeenCalledWith('contact-2', 'channel-1');
    expect(result.conversation).toEqual({ id: 'conv-2', assignedAgentId: null });
  });
```

Change only the assertion — `createConversation` now always receives a 3rd argument:

```js
  test('creates a new conversation when none is open', async () => {
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-2' });
    findOpenConversation.mockResolvedValue(null);
    createConversation.mockResolvedValue({ id: 'conv-2', assignedAgentId: null });
    createMessage.mockResolvedValue({ id: 'msg-2' });

    const result = await ingestInboundMessage({
      channelId: 'channel-1',
      fromPhoneNumber: '+5511999997777',
      contactDisplayName: 'Outro Cliente',
      whatsappMessageId: 'wamid.Y',
      content: 'Ola',
    });

    expect(createConversation).toHaveBeenCalledWith('contact-2', 'channel-1', null);
    expect(result.conversation).toEqual({ id: 'conv-2', assignedAgentId: null });
  });
```

Then add these 4 new tests anywhere inside the `describe('ingestInboundMessage', ...)` block:

```js
  test('starts triage by sending the question when a new conversation begins on a channel with triage enabled', async () => {
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-9', phoneNumber: '+5511999990000', displayName: 'Novo Cliente' });
    findOpenConversation.mockResolvedValue(null);
    shouldStartTriage.mockResolvedValue(true);
    createConversation.mockResolvedValue({ id: 'conv-9', assignedAgentId: null, triageState: 'pending' });
    createMessage.mockResolvedValue({ id: 'msg-9' });

    await ingestInboundMessage({
      channelId: 'channel-1',
      fromPhoneNumber: '+5511999990000',
      contactDisplayName: 'Novo Cliente',
      whatsappMessageId: 'wamid.TRIAGE1',
      content: 'Oi',
    });

    expect(createConversation).toHaveBeenCalledWith('contact-9', 'channel-1', 'pending');
    expect(sendTriageQuestion).toHaveBeenCalledWith('conv-9', 'channel-1');
    expect(processTriageReply).not.toHaveBeenCalled();
  });

  test('processes a reply through triage when an existing conversation still has triage pending', async () => {
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-10', phoneNumber: '+5511999990001', displayName: 'Cliente Triagem' });
    findOpenConversation.mockResolvedValue({ id: 'conv-10', assignedAgentId: null, triageState: 'pending' });
    createMessage.mockResolvedValue({ id: 'msg-10' });
    processTriageReply.mockResolvedValue({ id: 'conv-10', assignedAgentId: null, sectorId: 'sector-1', triageState: 'completed' });

    await ingestInboundMessage({
      channelId: 'channel-1',
      fromPhoneNumber: '+5511999990001',
      contactDisplayName: 'Cliente Triagem',
      whatsappMessageId: 'wamid.TRIAGE2',
      content: '1',
    });

    expect(shouldStartTriage).not.toHaveBeenCalled();
    expect(processTriageReply).toHaveBeenCalledWith(
      { id: 'conv-10', assignedAgentId: null, triageState: 'pending' },
      'channel-1',
      '1'
    );
    expect(sendTriageQuestion).not.toHaveBeenCalled();
    expect(broadcast).toHaveBeenCalledWith('queue:new', {
      conversation: {
        id: 'conv-10',
        assignedAgentId: null,
        sectorId: 'sector-1',
        triageState: 'completed',
        contactPhoneNumber: '+5511999990001',
        contactDisplayName: 'Cliente Triagem',
      },
      message: { id: 'msg-10' },
    });
  });

  test('does not process triage for a duplicate webhook redelivery even if triage is pending', async () => {
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-11' });
    findOpenConversation.mockResolvedValue({ id: 'conv-11', assignedAgentId: null, triageState: 'pending' });
    const uniqueViolation = Object.assign(new Error('duplicate key'), { code: '23505' });
    createMessage.mockRejectedValue(uniqueViolation);

    await ingestInboundMessage({
      channelId: 'channel-1',
      fromPhoneNumber: '+5511999990002',
      contactDisplayName: 'Reenvio Triagem',
      whatsappMessageId: 'wamid.TRIAGE3',
      content: '1',
    });

    expect(processTriageReply).not.toHaveBeenCalled();
    expect(sendTriageQuestion).not.toHaveBeenCalled();
  });

  test('does not start triage for a new conversation when the channel does not have it enabled', async () => {
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-12' });
    findOpenConversation.mockResolvedValue(null);
    shouldStartTriage.mockResolvedValue(false);
    createConversation.mockResolvedValue({ id: 'conv-12', assignedAgentId: null, triageState: null });
    createMessage.mockResolvedValue({ id: 'msg-12' });

    await ingestInboundMessage({
      channelId: 'channel-1',
      fromPhoneNumber: '+5511999990003',
      contactDisplayName: 'Cliente Normal',
      whatsappMessageId: 'wamid.NOTRIAGE',
      content: 'Oi',
    });

    expect(createConversation).toHaveBeenCalledWith('contact-12', 'channel-1', null);
    expect(sendTriageQuestion).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx dotenv -e .env.test -o -- jest src/conversations/inbound-message.service.test.js`
Expected: FAIL — `../triage/triage.service` doesn't exist yet, and the updated/new assertions don't match current behavior.

- [ ] **Step 3: Implement the triage service**

Create `src/triage/triage.service.js`:

```js
const { findChannelById } = require('../channels/channel.repository');
const { enqueueOutboundMessage } = require('../queue/outbound-queue');
const { getTriageConfig, listTriageOptions } = require('./triage.repository');
const { completeTriage, incrementTriageAttempts } = require('../conversations/conversation.repository');
const { findMatchingOption } = require('./triage-matcher');

function composeQuestionMessage(config, options) {
  const optionLines = options.map((option) => `${option.optionNumber} - ${option.sectorName}`).join('\n');
  return optionLines ? `${config.questionText}\n${optionLines}` : config.questionText;
}

async function shouldStartTriage(channelId) {
  const channel = await findChannelById(channelId);
  if (!channel || !channel.triageEnabled) return false;
  const options = await listTriageOptions();
  return options.length > 0;
}

async function sendTriageQuestion(conversationId, channelId) {
  const config = await getTriageConfig();
  const options = await listTriageOptions();
  await enqueueOutboundMessage({ conversationId, channelId, content: composeQuestionMessage(config, options) });
}

async function processTriageReply(conversation, channelId, replyText) {
  const options = await listTriageOptions();
  const matched = findMatchingOption(options, replyText);
  const config = await getTriageConfig();

  if (matched) {
    const updated = await completeTriage(conversation.id, matched.sectorId);
    await enqueueOutboundMessage({ conversationId: conversation.id, channelId, content: config.confirmationText });
    return updated;
  }

  const attempts = await incrementTriageAttempts(conversation.id);
  if (attempts >= config.maxAttempts) {
    const updated = await completeTriage(conversation.id, null);
    await enqueueOutboundMessage({ conversationId: conversation.id, channelId, content: config.confirmationText });
    return updated;
  }

  await enqueueOutboundMessage({ conversationId: conversation.id, channelId, content: composeQuestionMessage(config, options) });
  return { ...conversation, triageAttempts: attempts };
}

module.exports = { shouldStartTriage, sendTriageQuestion, processTriageReply };
```

- [ ] **Step 4: Wire it into `ingestInboundMessage`**

Replace the full contents of `src/conversations/inbound-message.service.js` (currently 72 lines) with:

```js
const { findOrCreateContactByPhoneNumber } = require('./contact.repository');
const { findOpenConversation, createConversation } = require('./conversation.repository');
const { createMessage } = require('./message.repository');
const { emitToAgent, broadcast } = require('../realtime/socket-server');
const { shouldStartTriage, sendTriageQuestion, processTriageReply } = require('../triage/triage.service');

const UNIQUE_VIOLATION = '23505';

async function ingestInboundMessage({
  channelId,
  fromPhoneNumber,
  contactDisplayName,
  whatsappMessageId,
  content,
  messageType,
  mediaPath,
  mediaMimeType,
  mediaFilename,
  locationLatitude,
  locationLongitude,
}) {
  const contact = await findOrCreateContactByPhoneNumber(fromPhoneNumber, contactDisplayName);
  let conversation = await findOpenConversation(contact.id, channelId);
  let justCreated = false;
  if (!conversation) {
    const startTriage = await shouldStartTriage(channelId);
    try {
      conversation = await createConversation(contact.id, channelId, startTriage ? 'pending' : null);
      justCreated = true;
    } catch (err) {
      if (err.code !== UNIQUE_VIOLATION) {
        throw err;
      }
      conversation = await findOpenConversation(contact.id, channelId);
    }
  }

  let message;
  try {
    message = await createMessage({
      conversationId: conversation.id,
      direction: 'inbound',
      content,
      whatsappMessageId,
      status: 'received',
      messageType,
      mediaPath,
      mediaMimeType,
      mediaFilename,
      locationLatitude,
      locationLongitude,
    });
  } catch (err) {
    if (err.code !== UNIQUE_VIOLATION) {
      throw err;
    }
    return { contact, conversation, message: null };
  }

  if (justCreated && conversation.triageState === 'pending') {
    await sendTriageQuestion(conversation.id, channelId);
  } else if (!justCreated && conversation.triageState === 'pending') {
    conversation = await processTriageReply(conversation, channelId, content);
  }

  const conversationWithContact = {
    ...conversation,
    contactPhoneNumber: contact.phoneNumber,
    contactDisplayName: contact.displayName,
  };

  if (conversation.assignedAgentId) {
    emitToAgent(conversation.assignedAgentId, 'message:new', { conversation: conversationWithContact, message });
  } else {
    broadcast('queue:new', { conversation: conversationWithContact, message });
  }

  return { contact, conversation, message };
}

module.exports = { ingestInboundMessage };
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx dotenv -e .env.test -o -- jest src/conversations/inbound-message.service.test.js`
Expected: PASS, all tests in the file (existing, with the one updated assertion, plus 4 new)

- [ ] **Step 6: Run the full backend suite**

Run: `npm test`
Expected: PASS, all suites green except the 2 known pre-existing `outbound-queue.test.js` flakes.

- [ ] **Step 7: Commit**

```bash
git add src/triage/triage.service.js src/conversations/inbound-message.service.js src/conversations/inbound-message.service.test.js
git commit -m "feat: run the triage bot on inbound messages"
```

---

### Task 4: Admin API routes

**Files:**
- Create: `src/api/admin-triage.routes.js`
- Create: `src/api/admin-triage.routes.test.js`
- Modify: `src/api/admin-channels.routes.js` (add one route + update the GET response mapping)
- Modify: `src/api/admin-channels.routes.test.js` (update one existing test; add new tests)
- Modify: `src/server.js` (mount the new router)

**Interfaces:**
- Consumes: everything from `src/triage/triage.repository.js` (Task 1) and `updateChannelTriageEnabled` (Task 2).
- Produces: `GET /api/admin/triage` → `{questionText, confirmationText, maxAttempts, options: [...]}`; `PUT /api/admin/triage/config`; `POST /api/admin/triage/options`; `PATCH /api/admin/triage/options/:id`; `DELETE /api/admin/triage/options/:id`; `PATCH /api/admin/channels/:id` → `{triageEnabled}`. Task 5's frontend consumes all of these.

- [ ] **Step 1: Write the failing tests for `admin-triage.routes.js`**

Create `src/api/admin-triage.routes.test.js`:

```js
jest.mock('../triage/triage.repository');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const {
  getTriageConfig,
  updateTriageConfig,
  listTriageOptions,
  createTriageOption,
  updateTriageOption,
  deleteTriageOption,
} = require('../triage/triage.repository');
const adminTriageRoutes = require('./admin-triage.routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/triage', adminTriageRoutes);
  return app;
}

function tokenFor(agentId, role) {
  return jwt.sign({ agentId, role }, process.env.JWT_SECRET);
}

describe('GET /api/admin/triage', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns the config combined with the options list', async () => {
    getTriageConfig.mockResolvedValue({ questionText: 'Pergunta', confirmationText: 'Confirmação', maxAttempts: 2 });
    listTriageOptions.mockResolvedValue([
      { id: 'opt-1', optionNumber: 1, sectorId: 'sector-1', sectorName: 'Financeiro', keywords: ['fatura'] },
    ]);

    const res = await request(buildApp())
      .get('/api/admin/triage')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      questionText: 'Pergunta',
      confirmationText: 'Confirmação',
      maxAttempts: 2,
      options: [{ id: 'opt-1', optionNumber: 1, sectorId: 'sector-1', sectorName: 'Financeiro', keywords: ['fatura'] }],
    });
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .get('/api/admin/triage')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(403);
  });

  test('returns 401 without a token', async () => {
    const res = await request(buildApp()).get('/api/admin/triage');
    expect(res.status).toBe(401);
  });
});

describe('PUT /api/admin/triage/config', () => {
  beforeEach(() => jest.clearAllMocks());

  test('updates the config', async () => {
    updateTriageConfig.mockResolvedValue({ questionText: 'Nova', confirmationText: 'Nova conf', maxAttempts: 3 });

    const res = await request(buildApp())
      .put('/api/admin/triage/config')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ questionText: 'Nova', confirmationText: 'Nova conf', maxAttempts: 3 });

    expect(res.status).toBe(200);
    expect(updateTriageConfig).toHaveBeenCalledWith({ questionText: 'Nova', confirmationText: 'Nova conf', maxAttempts: 3 });
    expect(res.body).toEqual({ questionText: 'Nova', confirmationText: 'Nova conf', maxAttempts: 3 });
  });

  test('returns 400 when questionText is blank', async () => {
    const res = await request(buildApp())
      .put('/api/admin/triage/config')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ questionText: '  ', confirmationText: 'Conf', maxAttempts: 2 });

    expect(res.status).toBe(400);
    expect(updateTriageConfig).not.toHaveBeenCalled();
  });

  test('returns 400 when maxAttempts is not a positive integer', async () => {
    const res = await request(buildApp())
      .put('/api/admin/triage/config')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ questionText: 'Pergunta', confirmationText: 'Conf', maxAttempts: 0 });

    expect(res.status).toBe(400);
    expect(updateTriageConfig).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/triage/options', () => {
  beforeEach(() => jest.clearAllMocks());

  test('creates an option', async () => {
    createTriageOption.mockResolvedValue({ id: 'opt-1', optionNumber: 1, sectorId: 'sector-1', sectorName: 'Financeiro', keywords: ['fatura'] });

    const res = await request(buildApp())
      .post('/api/admin/triage/options')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ optionNumber: 1, sectorId: 'sector-1', keywords: [' fatura ', '', 'boleto'] });

    expect(res.status).toBe(201);
    expect(createTriageOption).toHaveBeenCalledWith({ optionNumber: 1, sectorId: 'sector-1', keywords: ['fatura', 'boleto'] });
  });

  test('returns 400 when sectorId is missing', async () => {
    const res = await request(buildApp())
      .post('/api/admin/triage/options')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ optionNumber: 1, keywords: [] });

    expect(res.status).toBe(400);
    expect(createTriageOption).not.toHaveBeenCalled();
  });

  test('returns 409 when the option number already exists', async () => {
    createTriageOption.mockRejectedValue(Object.assign(new Error('duplicate key'), { code: '23505' }));

    const res = await request(buildApp())
      .post('/api/admin/triage/options')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ optionNumber: 1, sectorId: 'sector-1', keywords: [] });

    expect(res.status).toBe(409);
  });
});

describe('PATCH /api/admin/triage/options/:id', () => {
  beforeEach(() => jest.clearAllMocks());

  test('updates an option', async () => {
    updateTriageOption.mockResolvedValue({ id: 'opt-1', optionNumber: 2, sectorId: 'sector-2', sectorName: 'Suporte', keywords: ['internet'] });

    const res = await request(buildApp())
      .patch('/api/admin/triage/options/opt-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ optionNumber: 2, sectorId: 'sector-2', keywords: ['internet'] });

    expect(res.status).toBe(200);
    expect(updateTriageOption).toHaveBeenCalledWith('opt-1', { optionNumber: 2, sectorId: 'sector-2', keywords: ['internet'] });
  });

  test('returns 404 when the option does not exist', async () => {
    updateTriageOption.mockResolvedValue(null);

    const res = await request(buildApp())
      .patch('/api/admin/triage/options/does-not-exist')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ optionNumber: 1, sectorId: 'sector-1', keywords: [] });

    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/admin/triage/options/:id', () => {
  beforeEach(() => jest.clearAllMocks());

  test('deletes an option', async () => {
    deleteTriageOption.mockResolvedValue(true);

    const res = await request(buildApp())
      .delete('/api/admin/triage/options/opt-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`);

    expect(res.status).toBe(204);
  });

  test('returns 404 when the option does not exist', async () => {
    deleteTriageOption.mockResolvedValue(false);

    const res = await request(buildApp())
      .delete('/api/admin/triage/options/does-not-exist')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`);

    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx dotenv -e .env.test -o -- jest src/api/admin-triage.routes.test.js`
Expected: FAIL with "Cannot find module './admin-triage.routes'"

- [ ] **Step 3: Implement the routes**

Create `src/api/admin-triage.routes.js`:

```js
const express = require('express');
const { requireAuth, requireRole } = require('../auth/auth.middleware');
const {
  getTriageConfig,
  updateTriageConfig,
  listTriageOptions,
  createTriageOption,
  updateTriageOption,
  deleteTriageOption,
} = require('../triage/triage.repository');

const router = express.Router();

function normalizeKeywords(keywords) {
  return Array.isArray(keywords) ? keywords.map((k) => (k || '').trim()).filter(Boolean) : [];
}

router.get('/', requireAuth, requireRole('admin'), async (req, res) => {
  const config = await getTriageConfig();
  const options = await listTriageOptions();
  res.json({ ...config, options });
});

router.put('/config', requireAuth, requireRole('admin'), async (req, res) => {
  const { questionText: rawQuestionText, confirmationText: rawConfirmationText, maxAttempts } = req.body || {};
  const questionText = (rawQuestionText || '').trim();
  const confirmationText = (rawConfirmationText || '').trim();
  if (!questionText || !confirmationText) {
    return res.status(400).json({ error: 'questionText and confirmationText are required' });
  }
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    return res.status(400).json({ error: 'maxAttempts must be a positive integer' });
  }
  const config = await updateTriageConfig({ questionText, confirmationText, maxAttempts });
  res.json(config);
});

router.post('/options', requireAuth, requireRole('admin'), async (req, res) => {
  const { optionNumber, sectorId, keywords } = req.body || {};
  if (!Number.isInteger(optionNumber) || optionNumber < 1) {
    return res.status(400).json({ error: 'optionNumber must be a positive integer' });
  }
  if (!sectorId) {
    return res.status(400).json({ error: 'sectorId is required' });
  }
  try {
    const option = await createTriageOption({ optionNumber, sectorId, keywords: normalizeKeywords(keywords) });
    res.status(201).json(option);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'An option with this number already exists' });
    }
    throw err;
  }
});

router.patch('/options/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const { optionNumber, sectorId, keywords } = req.body || {};
  if (!Number.isInteger(optionNumber) || optionNumber < 1) {
    return res.status(400).json({ error: 'optionNumber must be a positive integer' });
  }
  if (!sectorId) {
    return res.status(400).json({ error: 'sectorId is required' });
  }
  try {
    const option = await updateTriageOption(req.params.id, { optionNumber, sectorId, keywords: normalizeKeywords(keywords) });
    if (!option) {
      return res.status(404).json({ error: 'Triage option not found' });
    }
    res.json(option);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'An option with this number already exists' });
    }
    throw err;
  }
});

router.delete('/options/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const deleted = await deleteTriageOption(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: 'Triage option not found' });
  }
  res.status(204).send();
});

module.exports = router;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx dotenv -e .env.test -o -- jest src/api/admin-triage.routes.test.js`
Expected: PASS, all tests

- [ ] **Step 5: Commit**

```bash
git add src/api/admin-triage.routes.js src/api/admin-triage.routes.test.js
git commit -m "feat: add admin routes for triage configuration"
```

- [ ] **Step 6: Write the failing tests for the channel toggle route**

`src/api/admin-channels.routes.test.js`'s `'lists channels for an admin'` test (lines 26-46) currently reads:

```js
  test('lists channels for an admin', async () => {
    listChannels.mockResolvedValue([
      {
        id: 'channel-1',
        type: 'meta_cloud',
        name: 'Suporte',
        phoneNumber: '+5511999990001',
        config: { phoneNumberId: '1', accessToken: 'tok' },
        status: 'connected',
      },
    ]);

    const res = await request(buildApp())
      .get('/api/admin/channels')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: 'channel-1', type: 'meta_cloud', name: 'Suporte', phoneNumber: '+5511999990001', status: 'connected' },
    ]);
  });
```

Update the mock and the expectation to include `triageEnabled`:

```js
  test('lists channels for an admin', async () => {
    listChannels.mockResolvedValue([
      {
        id: 'channel-1',
        type: 'meta_cloud',
        name: 'Suporte',
        phoneNumber: '+5511999990001',
        config: { phoneNumberId: '1', accessToken: 'tok' },
        status: 'connected',
        triageEnabled: false,
      },
    ]);

    const res = await request(buildApp())
      .get('/api/admin/channels')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        id: 'channel-1',
        type: 'meta_cloud',
        name: 'Suporte',
        phoneNumber: '+5511999990001',
        status: 'connected',
        triageEnabled: false,
      },
    ]);
  });
```

Then add this new `describe` block anywhere in the file, after the existing ones (needs `updateChannelTriageEnabled` added to the destructured import at the top of the file — change `const { listChannels, createChannel, findChannelById } = require('../channels/channel.repository');` to `const { listChannels, createChannel, findChannelById, updateChannelTriageEnabled } = require('../channels/channel.repository');`):

```js
describe('PATCH /api/admin/channels/:id', () => {
  beforeEach(() => jest.clearAllMocks());

  test('toggles triageEnabled on', async () => {
    updateChannelTriageEnabled.mockResolvedValue({
      id: 'channel-1',
      type: 'baileys',
      name: 'Suporte',
      phoneNumber: '+5511999990001',
      status: 'connected',
      triageEnabled: true,
    });

    const res = await request(buildApp())
      .patch('/api/admin/channels/channel-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ triageEnabled: true });

    expect(res.status).toBe(200);
    expect(updateChannelTriageEnabled).toHaveBeenCalledWith('channel-1', true);
    expect(res.body).toEqual({
      id: 'channel-1',
      type: 'baileys',
      name: 'Suporte',
      phoneNumber: '+5511999990001',
      status: 'connected',
      triageEnabled: true,
    });
  });

  test('returns 400 when triageEnabled is not a boolean', async () => {
    const res = await request(buildApp())
      .patch('/api/admin/channels/channel-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ triageEnabled: 'yes' });

    expect(res.status).toBe(400);
    expect(updateChannelTriageEnabled).not.toHaveBeenCalled();
  });

  test('returns 404 when the channel does not exist', async () => {
    updateChannelTriageEnabled.mockResolvedValue(null);

    const res = await request(buildApp())
      .patch('/api/admin/channels/does-not-exist')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ triageEnabled: true });

    expect(res.status).toBe(404);
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .patch('/api/admin/channels/channel-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ triageEnabled: true });
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `npx dotenv -e .env.test -o -- jest src/api/admin-channels.routes.test.js`
Expected: FAIL — the GET test's expectation doesn't match yet, and the PATCH route doesn't exist.

- [ ] **Step 8: Implement the route**

`src/api/admin-channels.routes.js` currently starts with (lines 1-9):

```js
const express = require('express');
const QRCode = require('qrcode');
const { requireAuth, requireRole } = require('../auth/auth.middleware');
const { verifyToken } = require('../auth/auth.service');
const { listChannels, createChannel, findChannelById } = require('../channels/channel.repository');
const baileysManager = require('../whatsapp-adapters/baileys.manager');

const router = express.Router();

const UNIQUE_VIOLATION = '23505';
```

Change the repository import to add `updateChannelTriageEnabled`:

```js
const express = require('express');
const QRCode = require('qrcode');
const { requireAuth, requireRole } = require('../auth/auth.middleware');
const { verifyToken } = require('../auth/auth.service');
const { listChannels, createChannel, findChannelById, updateChannelTriageEnabled } = require('../channels/channel.repository');
const baileysManager = require('../whatsapp-adapters/baileys.manager');

const router = express.Router();

const UNIQUE_VIOLATION = '23505';
```

The existing `GET /` route (lines 30-41) currently reads:

```js
router.get('/', requireAuth, requireRole('admin'), async (req, res) => {
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
```

Add `triageEnabled` to the mapped response:

```js
router.get('/', requireAuth, requireRole('admin'), async (req, res) => {
  const channels = await listChannels();
  res.json(
    channels.map((channel) => ({
      id: channel.id,
      type: channel.type,
      name: channel.name,
      phoneNumber: channel.phoneNumber,
      status: channel.status,
      triageEnabled: channel.triageEnabled,
    }))
  );
});
```

Then add this new route right after the existing `POST /` route (after its closing `});`, before the `router.get('/:id/qr', ...)` route):

```js
router.patch('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const { triageEnabled } = req.body || {};
  if (typeof triageEnabled !== 'boolean') {
    return res.status(400).json({ error: 'triageEnabled must be a boolean' });
  }
  const channel = await updateChannelTriageEnabled(req.params.id, triageEnabled);
  if (!channel) {
    return res.status(404).json({ error: 'Channel not found' });
  }
  res.json({
    id: channel.id,
    type: channel.type,
    name: channel.name,
    phoneNumber: channel.phoneNumber,
    status: channel.status,
    triageEnabled: channel.triageEnabled,
  });
});
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `npx dotenv -e .env.test -o -- jest src/api/admin-channels.routes.test.js`
Expected: PASS, all tests in the file (existing, with the one updated test, plus 4 new)

- [ ] **Step 10: Mount the new router**

`src/server.js` currently has (around lines 15-18):

```js
const adminChannelsRoutes = require('./api/admin-channels.routes');
const adminAgentsRoutes = require('./api/admin-agents.routes');
const adminQuickRepliesRoutes = require('./api/admin-quick-replies.routes');
const adminSectorsRoutes = require('./api/admin-sectors.routes');
```

Add the new route import:

```js
const adminChannelsRoutes = require('./api/admin-channels.routes');
const adminAgentsRoutes = require('./api/admin-agents.routes');
const adminQuickRepliesRoutes = require('./api/admin-quick-replies.routes');
const adminSectorsRoutes = require('./api/admin-sectors.routes');
const adminTriageRoutes = require('./api/admin-triage.routes');
```

And (around lines 54-57):

```js
app.use('/api/admin/channels', adminChannelsRoutes);
app.use('/api/admin/agents', adminAgentsRoutes);
app.use('/api/admin/quick-replies', adminQuickRepliesRoutes);
app.use('/api/admin/sectors', adminSectorsRoutes);
```

Add the new mount:

```js
app.use('/api/admin/channels', adminChannelsRoutes);
app.use('/api/admin/agents', adminAgentsRoutes);
app.use('/api/admin/quick-replies', adminQuickRepliesRoutes);
app.use('/api/admin/sectors', adminSectorsRoutes);
app.use('/api/admin/triage', adminTriageRoutes);
```

- [ ] **Step 11: Run the full backend suite**

Run: `npm test`
Expected: PASS, all suites green except the 2 known pre-existing `outbound-queue.test.js` flakes.

- [ ] **Step 12: Commit**

```bash
git add src/api/admin-channels.routes.js src/api/admin-channels.routes.test.js src/server.js
git commit -m "feat: add channel triage toggle route and mount admin triage routes"
```

---

### Task 5: Frontend — admin UI and queue sector tag

**Files:**
- Create: `frontend/src/hooks/useTriage.js`
- Create: `frontend/src/hooks/useTriage.test.jsx`
- Create: `frontend/src/components/TriageConfigForm.jsx`
- Create: `frontend/src/components/CreateTriageOptionForm.jsx`
- Create: `frontend/src/components/TriageAdminTab.jsx`
- Create: `frontend/src/components/TriageAdminTab.test.jsx`
- Create: `frontend/src/components/ConversationListItem.test.jsx`
- Modify: `frontend/src/services/api.js` (add 6 new functions)
- Modify: `frontend/src/services/api.test.js` (add tests for the 6 new functions)
- Modify: `frontend/src/components/ConversationListItem.jsx` (whole file, 18 lines)
- Modify: `frontend/src/pages/AdminChannelsPage.jsx` (whole file, 83 lines)
- Modify: `frontend/src/pages/AdminChannelsPage.test.jsx` (add mocks and tests)

**Interfaces:**
- Consumes: `GET /api/admin/triage`, `PUT /api/admin/triage/config`, `POST/PATCH/DELETE /api/admin/triage/options[/:id]`, `PATCH /api/admin/channels/:id` (all Task 4). `conversation.sectorName` on queue/mine conversation objects (Task 2).
- Produces: nothing consumed by later tasks — this is the last task.

- [ ] **Step 1: Write the failing tests for the 6 new API functions**

`frontend/src/services/api.test.js` currently ends its import block with (lines 21-27):

```js
  listSectors,
  createSector,
  updateSector,
  deleteSector,
  setAgentSectors,
  getMetrics,
} from './api';
```

Add the 6 new function names:

```js
  listSectors,
  createSector,
  updateSector,
  deleteSector,
  setAgentSectors,
  getMetrics,
  getTriage,
  updateTriageConfig,
  createTriageOption,
  updateTriageOption,
  deleteTriageOption,
  setChannelTriageEnabled,
} from './api';
```

Then add these 6 new `describe` blocks at the end of the file, after the existing `describe('getMetrics', ...)` block:

```js
describe('getTriage', () => {
  test('fetches the triage configuration and options', async () => {
    global.fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('{}') });
    await getTriage('tok-123');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/admin/triage',
      expect.objectContaining({ method: 'GET' })
    );
  });
});

describe('updateTriageConfig', () => {
  test('puts the triage config payload', async () => {
    global.fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('{}') });
    await updateTriageConfig({ questionText: 'Pergunta', confirmationText: 'Confirmação', maxAttempts: 2 }, 'tok-123');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/admin/triage/config',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ questionText: 'Pergunta', confirmationText: 'Confirmação', maxAttempts: 2 }),
      })
    );
  });
});

describe('createTriageOption', () => {
  test('posts the new triage option payload', async () => {
    global.fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('{}') });
    await createTriageOption({ optionNumber: 1, sectorId: 'sector-1', keywords: ['fatura'] }, 'tok-123');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/admin/triage/options',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ optionNumber: 1, sectorId: 'sector-1', keywords: ['fatura'] }),
      })
    );
  });
});

describe('updateTriageOption', () => {
  test('patches the triage option payload', async () => {
    global.fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('{}') });
    await updateTriageOption('opt-1', { optionNumber: 2, sectorId: 'sector-2', keywords: ['internet'] }, 'tok-123');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/admin/triage/options/opt-1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ optionNumber: 2, sectorId: 'sector-2', keywords: ['internet'] }),
      })
    );
  });
});

describe('deleteTriageOption', () => {
  test('sends a DELETE request for the triage option', async () => {
    global.fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('') });
    await deleteTriageOption('opt-1', 'tok-123');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/admin/triage/options/opt-1',
      expect.objectContaining({ method: 'DELETE' })
    );
  });
});

describe('setChannelTriageEnabled', () => {
  test('patches the channel triageEnabled flag', async () => {
    global.fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('{}') });
    await setChannelTriageEnabled('channel-1', true, 'tok-123');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/admin/channels/channel-1',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ triageEnabled: true }) })
    );
  });
});
```

- [ ] **Step 1b: Run the test to verify it fails**

Run (from `frontend/`): `npx vitest run src/services/api.test.js`
Expected: FAIL — the 6 new functions aren't exported from `api.js` yet.

- [ ] **Step 2: Add the new API functions**

Add these 6 functions to the end of `frontend/src/services/api.js`:

```js
export function getTriage(token) {
  return apiFetch('/api/admin/triage', { token });
}

export function updateTriageConfig(payload, token) {
  return apiFetch('/api/admin/triage/config', { method: 'PUT', body: payload, token });
}

export function createTriageOption(payload, token) {
  return apiFetch('/api/admin/triage/options', { method: 'POST', body: payload, token });
}

export function updateTriageOption(id, payload, token) {
  return apiFetch(`/api/admin/triage/options/${id}`, { method: 'PATCH', body: payload, token });
}

export function deleteTriageOption(id, token) {
  return apiFetch(`/api/admin/triage/options/${id}`, { method: 'DELETE', token });
}

export function setChannelTriageEnabled(channelId, triageEnabled, token) {
  return apiFetch(`/api/admin/channels/${channelId}`, { method: 'PATCH', body: { triageEnabled }, token });
}
```

- [ ] **Step 3: Run the frontend test suite for `api.js`**

Run (from `frontend/`): `npx vitest run src/services/api.test.js`
Expected: PASS, including the new tests written in Step 1

- [ ] **Step 4: Commit**

```bash
git add frontend/src/services/api.js frontend/src/services/api.test.js
git commit -m "feat: add frontend API functions for triage configuration"
```

- [ ] **Step 5: Write the failing test for `useTriage`**

Create `frontend/src/hooks/useTriage.test.jsx`:

```jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useTriage } from './useTriage';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
});

describe('useTriage', () => {
  test('fetches the config and options on mount', async () => {
    api.getTriage.mockResolvedValue({
      questionText: 'Pergunta',
      confirmationText: 'Confirmação',
      maxAttempts: 2,
      options: [{ id: 'opt-1', optionNumber: 1, sectorId: 's1', sectorName: 'Financeiro', keywords: ['fatura'] }],
    });

    const { result } = renderHook(() => useTriage());

    await waitFor(() => expect(result.current.config).toEqual({ questionText: 'Pergunta', confirmationText: 'Confirmação', maxAttempts: 2 }));
    expect(result.current.options).toEqual([{ id: 'opt-1', optionNumber: 1, sectorId: 's1', sectorName: 'Financeiro', keywords: ['fatura'] }]);
  });

  test('refresh refetches the data', async () => {
    api.getTriage.mockResolvedValue({ questionText: 'A', confirmationText: 'B', maxAttempts: 1, options: [] });
    const { result } = renderHook(() => useTriage());
    await waitFor(() => expect(result.current.config).not.toBeNull());

    api.getTriage.mockResolvedValue({ questionText: 'C', confirmationText: 'D', maxAttempts: 5, options: [] });
    await result.current.refresh();

    await waitFor(() => expect(result.current.config.questionText).toBe('C'));
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run (from `frontend/`): `npx vitest run src/hooks/useTriage.test.jsx`
Expected: FAIL with "Failed to resolve import './useTriage'"

- [ ] **Step 7: Implement `useTriage`**

Create `frontend/src/hooks/useTriage.js`:

```js
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getTriage } from '../services/api';

export function useTriage() {
  const { token } = useAuth();
  const [config, setConfig] = useState(null);
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    if (!token) return Promise.resolve();
    setLoading(true);
    return getTriage(token)
      .then((data) => {
        setConfig({ questionText: data.questionText, confirmationText: data.confirmationText, maxAttempts: data.maxAttempts });
        setOptions(data.options);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, [token]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { config, options, loading, refresh };
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run (from `frontend/`): `npx vitest run src/hooks/useTriage.test.jsx`
Expected: PASS, 2/2 tests

- [ ] **Step 9: Commit**

```bash
git add frontend/src/hooks/useTriage.js frontend/src/hooks/useTriage.test.jsx
git commit -m "feat: add useTriage hook"
```

- [ ] **Step 10: Write the failing test for the sector tag on `ConversationListItem`**

Create `frontend/src/components/ConversationListItem.test.jsx`:

```jsx
import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ConversationListItem from './ConversationListItem';

describe('ConversationListItem', () => {
  test('shows the contact name and phone number', () => {
    render(
      <ul>
        <ConversationListItem
          conversation={{ id: 'c1', contactDisplayName: 'Carlos', contactPhoneNumber: '+5511999990000' }}
          onSelect={vi.fn()}
        />
      </ul>
    );
    expect(screen.getByText('Carlos')).toBeInTheDocument();
    expect(screen.getByText('+5511999990000')).toBeInTheDocument();
  });

  test('shows a sector tag when the conversation has one', () => {
    render(
      <ul>
        <ConversationListItem
          conversation={{ id: 'c1', contactDisplayName: 'Carlos', contactPhoneNumber: '+5511999990000', sectorName: 'Financeiro' }}
          onSelect={vi.fn()}
        />
      </ul>
    );
    expect(screen.getByText('Financeiro')).toBeInTheDocument();
  });

  test('shows no tag when the conversation has no sector', () => {
    render(
      <ul>
        <ConversationListItem
          conversation={{ id: 'c1', contactDisplayName: 'Carlos', contactPhoneNumber: '+5511999990000', sectorName: null }}
          onSelect={vi.fn()}
        />
      </ul>
    );
    expect(screen.queryByText('Financeiro')).not.toBeInTheDocument();
  });

  test('calls onSelect with the conversation id when clicked', async () => {
    const onSelect = vi.fn();
    render(
      <ul>
        <ConversationListItem
          conversation={{ id: 'c1', contactDisplayName: 'Carlos', contactPhoneNumber: '+5511999990000' }}
          onSelect={onSelect}
        />
      </ul>
    );
    await userEvent.click(screen.getByText('Carlos'));
    expect(onSelect).toHaveBeenCalledWith('c1');
  });
});
```

- [ ] **Step 11: Run the test to verify it fails**

Run (from `frontend/`): `npx vitest run src/components/ConversationListItem.test.jsx`
Expected: FAIL — no sector tag is rendered yet.

- [ ] **Step 12: Implement the sector tag**

Replace the full contents of `frontend/src/components/ConversationListItem.jsx` (currently 18 lines) with:

```jsx
function ConversationListItem({ conversation, onSelect }) {
  return (
    <li>
      <button
        onClick={() => onSelect(conversation.id)}
        className="w-full rounded border border-gray-200 px-3 py-2 text-left hover:bg-gray-50"
      >
        <div className="flex items-center justify-between gap-2">
          <p className="font-medium text-gray-800">
            {conversation.contactDisplayName || conversation.contactPhoneNumber}
          </p>
          {conversation.sectorName && (
            <span className="shrink-0 rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-700">{conversation.sectorName}</span>
          )}
        </div>
        <p className="text-xs text-gray-500">{conversation.contactPhoneNumber}</p>
      </button>
    </li>
  );
}

export default ConversationListItem;
```

- [ ] **Step 13: Run the test to verify it passes**

Run (from `frontend/`): `npx vitest run src/components/ConversationListItem.test.jsx`
Expected: PASS, 4/4 tests

- [ ] **Step 14: Commit**

```bash
git add frontend/src/components/ConversationListItem.jsx frontend/src/components/ConversationListItem.test.jsx
git commit -m "feat: show the sector tag on queued and assigned conversations"
```

- [ ] **Step 15: Write the failing tests for `TriageAdminTab`**

Create `frontend/src/components/TriageAdminTab.test.jsx`:

```jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TriageAdminTab from './TriageAdminTab';
import { useTriage } from '../hooks/useTriage';
import { useSectors } from '../hooks/useSectors';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../hooks/useTriage');
vi.mock('../hooks/useSectors');
vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
  useSectors.mockReturnValue({ sectors: [{ id: 's1', name: 'Financeiro' }, { id: 's2', name: 'Suporte' }] });
});

describe('TriageAdminTab', () => {
  test('shows a loading message before the config arrives', () => {
    useTriage.mockReturnValue({ config: null, options: [], refresh: vi.fn() });
    render(<TriageAdminTab />);
    expect(screen.getByText(/carregando/i)).toBeInTheDocument();
  });

  test('renders the config form fields with the current values', () => {
    useTriage.mockReturnValue({
      config: { questionText: 'Escolha uma opção', confirmationText: 'Obrigado', maxAttempts: 2 },
      options: [],
      refresh: vi.fn(),
    });
    render(<TriageAdminTab />);
    expect(screen.getByDisplayValue('Escolha uma opção')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Obrigado')).toBeInTheDocument();
    expect(screen.getByDisplayValue('2')).toBeInTheDocument();
  });

  test('saves the config and calls refresh', async () => {
    const refresh = vi.fn();
    useTriage.mockReturnValue({
      config: { questionText: 'Pergunta', confirmationText: 'Confirmação', maxAttempts: 2 },
      options: [],
      refresh,
    });
    api.updateTriageConfig.mockResolvedValue({ questionText: 'Pergunta', confirmationText: 'Confirmação', maxAttempts: 3 });
    render(<TriageAdminTab />);

    await userEvent.clear(screen.getByLabelText(/tentativas/i));
    await userEvent.type(screen.getByLabelText(/tentativas/i), '3');
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));

    await waitFor(() =>
      expect(api.updateTriageConfig).toHaveBeenCalledWith(
        { questionText: 'Pergunta', confirmationText: 'Confirmação', maxAttempts: 3 },
        'tok-123'
      )
    );
    expect(refresh).toHaveBeenCalled();
  });

  test('lists existing options with their sector and keywords', () => {
    useTriage.mockReturnValue({
      config: { questionText: 'Pergunta', confirmationText: 'Confirmação', maxAttempts: 2 },
      options: [{ id: 'opt-1', optionNumber: 1, sectorId: 's1', sectorName: 'Financeiro', keywords: ['fatura', 'boleto'] }],
      refresh: vi.fn(),
    });
    render(<TriageAdminTab />);
    expect(screen.getByText('1 - Financeiro')).toBeInTheDocument();
    expect(screen.getByText('fatura, boleto')).toBeInTheDocument();
  });

  test('creates a new option and calls refresh', async () => {
    const refresh = vi.fn();
    useTriage.mockReturnValue({
      config: { questionText: 'Pergunta', confirmationText: 'Confirmação', maxAttempts: 2 },
      options: [],
      refresh,
    });
    api.createTriageOption.mockResolvedValue({ id: 'opt-2', optionNumber: 2, sectorId: 's2', sectorName: 'Suporte', keywords: ['internet'] });
    render(<TriageAdminTab />);

    await userEvent.type(screen.getByLabelText(/número da opção/i), '2');
    await userEvent.selectOptions(screen.getByLabelText(/^setor$/i), 's2');
    await userEvent.type(screen.getByLabelText(/frases-gatilho/i), 'internet');
    await userEvent.click(screen.getByRole('button', { name: /cadastrar/i }));

    await waitFor(() =>
      expect(api.createTriageOption).toHaveBeenCalledWith({ optionNumber: 2, sectorId: 's2', keywords: ['internet'] }, 'tok-123')
    );
    expect(refresh).toHaveBeenCalled();
  });

  test('deletes an option after confirmation', async () => {
    const refresh = vi.fn();
    useTriage.mockReturnValue({
      config: { questionText: 'Pergunta', confirmationText: 'Confirmação', maxAttempts: 2 },
      options: [{ id: 'opt-1', optionNumber: 1, sectorId: 's1', sectorName: 'Financeiro', keywords: [] }],
      refresh,
    });
    api.deleteTriageOption.mockResolvedValue(undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<TriageAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /excluir/i }));

    await waitFor(() => expect(api.deleteTriageOption).toHaveBeenCalledWith('opt-1', 'tok-123'));
    expect(refresh).toHaveBeenCalled();
  });
});
```

- [ ] **Step 16: Run the test to verify it fails**

Run (from `frontend/`): `npx vitest run src/components/TriageAdminTab.test.jsx`
Expected: FAIL with "Failed to resolve import './TriageAdminTab'"

- [ ] **Step 17: Implement `TriageConfigForm`**

Create `frontend/src/components/TriageConfigForm.jsx`:

```jsx
import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { updateTriageConfig } from '../services/api';

function TriageConfigForm({ config, onSaved }) {
  const { token } = useAuth();
  const [questionText, setQuestionText] = useState(config.questionText);
  const [confirmationText, setConfirmationText] = useState(config.confirmationText);
  const [maxAttempts, setMaxAttempts] = useState(String(config.maxAttempts));
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    setQuestionText(config.questionText);
    setConfirmationText(config.confirmationText);
    setMaxAttempts(String(config.maxAttempts));
  }, [config]);

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setSuccess(false);
    setSubmitting(true);
    try {
      await updateTriageConfig({ questionText, confirmationText, maxAttempts: Number(maxAttempts) }, token);
      setSuccess(true);
      onSaved();
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao salvar');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded border border-gray-200 p-4">
      <h3 className="font-semibold text-gray-800">Pergunta de triagem</h3>
      <div>
        <label htmlFor="triage-question" className="mb-1 block text-sm text-gray-600">
          Pergunta (a lista de opções é adicionada automaticamente abaixo dela)
        </label>
        <textarea
          id="triage-question"
          value={questionText}
          onChange={(e) => setQuestionText(e.target.value)}
          className="w-full rounded border border-gray-300 px-3 py-2"
          required
        />
      </div>
      <div>
        <label htmlFor="triage-confirmation" className="mb-1 block text-sm text-gray-600">
          Mensagem de confirmação
        </label>
        <textarea
          id="triage-confirmation"
          value={confirmationText}
          onChange={(e) => setConfirmationText(e.target.value)}
          className="w-full rounded border border-gray-300 px-3 py-2"
          required
        />
      </div>
      <div>
        <label htmlFor="triage-max-attempts" className="mb-1 block text-sm text-gray-600">
          Tentativas antes de cair na fila geral
        </label>
        <input
          id="triage-max-attempts"
          type="number"
          min="1"
          value={maxAttempts}
          onChange={(e) => setMaxAttempts(e.target.value)}
          className="w-32 rounded border border-gray-300 px-3 py-2"
          required
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {success && <p className="text-sm text-green-600">Configuração salva.</p>}
      <button type="submit" disabled={submitting} className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50">
        Salvar
      </button>
    </form>
  );
}

export default TriageConfigForm;
```

- [ ] **Step 18: Implement `CreateTriageOptionForm`**

Create `frontend/src/components/CreateTriageOptionForm.jsx`:

```jsx
import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useSectors } from '../hooks/useSectors';
import { createTriageOption } from '../services/api';

function CreateTriageOptionForm({ onCreated }) {
  const { token } = useAuth();
  const { sectors } = useSectors();
  const [optionNumber, setOptionNumber] = useState('');
  const [sectorId, setSectorId] = useState('');
  const [keywords, setKeywords] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const keywordList = keywords.split(',').map((k) => k.trim()).filter(Boolean);
      await createTriageOption({ optionNumber: Number(optionNumber), sectorId, keywords: keywordList }, token);
      setOptionNumber('');
      setSectorId('');
      setKeywords('');
      onCreated();
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao cadastrar opção');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded border border-gray-200 p-4">
      <h3 className="font-semibold text-gray-800">Cadastrar nova opção</h3>
      <div>
        <label htmlFor="option-number" className="mb-1 block text-sm text-gray-600">
          Número da opção
        </label>
        <input
          id="option-number"
          type="number"
          min="1"
          value={optionNumber}
          onChange={(e) => setOptionNumber(e.target.value)}
          className="w-32 rounded border border-gray-300 px-3 py-2"
          required
        />
      </div>
      <div>
        <label htmlFor="option-sector" className="mb-1 block text-sm text-gray-600">
          Setor
        </label>
        <select
          id="option-sector"
          value={sectorId}
          onChange={(e) => setSectorId(e.target.value)}
          className="w-full rounded border border-gray-300 px-3 py-2"
          required
        >
          <option value="">Selecione um setor</option>
          {sectors.map((sector) => (
            <option key={sector.id} value={sector.id}>
              {sector.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="option-keywords" className="mb-1 block text-sm text-gray-600">
          Frases-gatilho (separadas por vírgula)
        </label>
        <input
          id="option-keywords"
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
          className="w-full rounded border border-gray-300 px-3 py-2"
          placeholder="financeiro, conta, fatura, boleto"
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={submitting} className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50">
        Cadastrar
      </button>
    </form>
  );
}

export default CreateTriageOptionForm;
```

- [ ] **Step 19: Implement `TriageAdminTab`**

Create `frontend/src/components/TriageAdminTab.jsx`:

```jsx
import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTriage } from '../hooks/useTriage';
import { useSectors } from '../hooks/useSectors';
import { updateTriageOption, deleteTriageOption } from '../services/api';
import TriageConfigForm from './TriageConfigForm';
import CreateTriageOptionForm from './CreateTriageOptionForm';

function TriageOptionRow({ option, onSaved, onDeleted }) {
  const { token } = useAuth();
  const { sectors } = useSectors();
  const [editing, setEditing] = useState(false);
  const [optionNumber, setOptionNumber] = useState(String(option.optionNumber));
  const [sectorId, setSectorId] = useState(option.sectorId);
  const [keywords, setKeywords] = useState(option.keywords.join(', '));
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const [deleting, setDeleting] = useState(false);

  function handleEditClick() {
    setOptionNumber(String(option.optionNumber));
    setSectorId(option.sectorId);
    setKeywords(option.keywords.join(', '));
    setError(null);
    setEditing(true);
  }

  function handleCancel() {
    setOptionNumber(String(option.optionNumber));
    setSectorId(option.sectorId);
    setKeywords(option.keywords.join(', '));
    setError(null);
    setEditing(false);
  }

  async function handleSave(event) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const keywordList = keywords.split(',').map((k) => k.trim()).filter(Boolean);
      await updateTriageOption(option.id, { optionNumber: Number(optionNumber), sectorId, keywords: keywordList }, token);
      setEditing(false);
      onSaved();
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao salvar');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Excluir a opção ${option.optionNumber} (${option.sectorName})?`)) {
      return;
    }
    setDeleteError(null);
    setDeleting(true);
    try {
      await deleteTriageOption(option.id, token);
      onDeleted();
    } catch (err) {
      setDeleteError((err.body && err.body.error) || 'Falha ao excluir');
      setDeleting(false);
    }
  }

  if (editing) {
    return (
      <form onSubmit={handleSave} className="space-y-2 rounded border border-gray-200 p-3">
        <input
          type="number"
          min="1"
          value={optionNumber}
          onChange={(e) => setOptionNumber(e.target.value)}
          className="w-32 rounded border border-gray-300 px-3 py-2"
          required
        />
        <select
          value={sectorId}
          onChange={(e) => setSectorId(e.target.value)}
          className="w-full rounded border border-gray-300 px-3 py-2"
          required
        >
          {sectors.map((sector) => (
            <option key={sector.id} value={sector.id}>
              {sector.name}
            </option>
          ))}
        </select>
        <input
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
          className="w-full rounded border border-gray-300 px-3 py-2"
          placeholder="financeiro, conta, fatura, boleto"
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
          <button type="button" onClick={handleCancel} className="rounded bg-gray-200 px-3 py-1 text-sm text-gray-700">
            Cancelar
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="rounded border border-gray-200 p-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium text-gray-800">
            {option.optionNumber} - {option.sectorName}
          </p>
          <p className="text-sm text-gray-500">{option.keywords.join(', ') || 'Sem frases-gatilho'}</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={handleEditClick} className="text-sm text-blue-600 underline">
            Editar
          </button>
          <button onClick={handleDelete} disabled={deleting} className="text-sm text-red-600 underline disabled:opacity-50">
            Excluir
          </button>
        </div>
      </div>
      {deleteError && <p className="mt-1 text-sm text-red-600">{deleteError}</p>}
    </div>
  );
}

function TriageAdminTab() {
  const { config, options, refresh } = useTriage();

  if (!config) {
    return <p className="text-sm text-gray-500">Carregando...</p>;
  }

  return (
    <div className="space-y-6">
      <TriageConfigForm config={config} onSaved={refresh} />
      <div className="space-y-3">
        {options.map((option) => (
          <TriageOptionRow key={option.id} option={option} onSaved={refresh} onDeleted={refresh} />
        ))}
      </div>
      <CreateTriageOptionForm onCreated={refresh} />
    </div>
  );
}

export default TriageAdminTab;
```

- [ ] **Step 20: Run the test to verify it passes**

Run (from `frontend/`): `npx vitest run src/components/TriageAdminTab.test.jsx`
Expected: PASS, all 6 tests

- [ ] **Step 21: Commit**

```bash
git add frontend/src/components/TriageConfigForm.jsx frontend/src/components/CreateTriageOptionForm.jsx frontend/src/components/TriageAdminTab.jsx frontend/src/components/TriageAdminTab.test.jsx
git commit -m "feat: add the Triagem admin tab"
```

- [ ] **Step 22: Write the failing tests for the `AdminChannelsPage` wiring**

`frontend/src/pages/AdminChannelsPage.test.jsx` currently starts with (lines 1-23):

```jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminChannelsPage from './AdminChannelsPage';
import { useChannels } from '../hooks/useChannels';
import { useAgentsAdmin } from '../hooks/useAgentsAdmin';
import { useQuickReplies } from '../hooks/useQuickReplies';
import { useSectors } from '../hooks/useSectors';
import { useAuth } from '../contexts/AuthContext';

vi.mock('../hooks/useChannels');
vi.mock('../hooks/useAgentsAdmin');
vi.mock('../hooks/useQuickReplies');
vi.mock('../hooks/useSectors');
vi.mock('../contexts/AuthContext');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'admin-1', role: 'admin' } });
  useAgentsAdmin.mockReturnValue({ agents: [], refresh: vi.fn() });
  useQuickReplies.mockReturnValue({ quickReplies: [], refresh: vi.fn() });
  useSectors.mockReturnValue({ sectors: [], refresh: vi.fn() });
});
```

Change it to also mock the new `useTriage` hook (the new "Triagem" tab will call it once wired in — this is the same "mock the hook a shared component starts calling" step this codebase has followed for every previous new tab):

```jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminChannelsPage from './AdminChannelsPage';
import { useChannels } from '../hooks/useChannels';
import { useAgentsAdmin } from '../hooks/useAgentsAdmin';
import { useQuickReplies } from '../hooks/useQuickReplies';
import { useSectors } from '../hooks/useSectors';
import { useTriage } from '../hooks/useTriage';
import { useAuth } from '../contexts/AuthContext';

vi.mock('../hooks/useChannels');
vi.mock('../hooks/useAgentsAdmin');
vi.mock('../hooks/useQuickReplies');
vi.mock('../hooks/useSectors');
vi.mock('../hooks/useTriage');
vi.mock('../contexts/AuthContext');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'admin-1', role: 'admin' } });
  useAgentsAdmin.mockReturnValue({ agents: [], refresh: vi.fn() });
  useQuickReplies.mockReturnValue({ quickReplies: [], refresh: vi.fn() });
  useSectors.mockReturnValue({ sectors: [], refresh: vi.fn() });
  useTriage.mockReturnValue({ config: { questionText: 'Q', confirmationText: 'C', maxAttempts: 2 }, options: [], refresh: vi.fn() });
});
```

Then add these 2 new tests anywhere inside the `describe('AdminChannelsPage', ...)` block:

```jsx
  test('switches to the Triagem tab and shows the triage configuration UI', async () => {
    useChannels.mockReturnValue({
      channels: [{ id: 'ch1', type: 'baileys', name: 'Berg', phoneNumber: '+5598985004187', status: 'connected', triageEnabled: false }],
      loading: false,
      refresh: vi.fn(),
    });
    render(<AdminChannelsPage />);

    expect(screen.getByText('Berg')).toBeInTheDocument();
    expect(screen.queryByText(/pergunta de triagem/i)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /triagem/i }));

    expect(screen.getByText(/pergunta de triagem/i)).toBeInTheDocument();
    expect(screen.queryByText('Berg')).not.toBeInTheDocument();
  });

  test('shows a checkbox per channel to toggle automatic triage', () => {
    useChannels.mockReturnValue({
      channels: [{ id: 'ch1', type: 'baileys', name: 'Berg', phoneNumber: '+5598985004187', status: 'connected', triageEnabled: true }],
      loading: false,
      refresh: vi.fn(),
    });
    render(<AdminChannelsPage />);
    expect(screen.getByRole('checkbox', { name: /usar triagem automática/i })).toBeChecked();
  });
```

- [ ] **Step 23: Run the test to verify it fails**

Run (from `frontend/`): `npx vitest run src/pages/AdminChannelsPage.test.jsx`
Expected: FAIL — no "Triagem" tab button exists yet, and no checkbox is rendered.

- [ ] **Step 24: Implement the wiring**

Replace the full contents of `frontend/src/pages/AdminChannelsPage.jsx` (currently 83 lines) with:

```jsx
import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useChannels } from '../hooks/useChannels';
import CreateChannelForm from '../components/CreateChannelForm';
import QrCodeView from '../components/QrCodeView';
import AgentsAdminTab from '../components/AgentsAdminTab';
import QuickRepliesAdminTab from '../components/QuickRepliesAdminTab';
import SectorsAdminTab from '../components/SectorsAdminTab';
import TriageAdminTab from '../components/TriageAdminTab';
import { setChannelTriageEnabled } from '../services/api';

function AdminChannelsPage() {
  const { token } = useAuth();
  const { channels, refresh } = useChannels();
  const [activeTab, setActiveTab] = useState('channels');

  async function handleToggleTriage(channelId, triageEnabled) {
    await setChannelTriageEnabled(channelId, triageEnabled, token);
    refresh();
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className="text-xl font-semibold text-gray-800">Administração</h1>
      <div className="flex gap-4 border-b border-gray-200">
        <button
          onClick={() => setActiveTab('channels')}
          className={`px-3 py-2 text-sm ${
            activeTab === 'channels' ? 'border-b-2 border-blue-600 font-semibold text-blue-600' : 'text-gray-500'
          }`}
        >
          Canais
        </button>
        <button
          onClick={() => setActiveTab('agents')}
          className={`px-3 py-2 text-sm ${
            activeTab === 'agents' ? 'border-b-2 border-blue-600 font-semibold text-blue-600' : 'text-gray-500'
          }`}
        >
          Atendentes
        </button>
        <button
          onClick={() => setActiveTab('quickReplies')}
          className={`px-3 py-2 text-sm ${
            activeTab === 'quickReplies' ? 'border-b-2 border-blue-600 font-semibold text-blue-600' : 'text-gray-500'
          }`}
        >
          Respostas rápidas
        </button>
        <button
          onClick={() => setActiveTab('sectors')}
          className={`px-3 py-2 text-sm ${
            activeTab === 'sectors' ? 'border-b-2 border-blue-600 font-semibold text-blue-600' : 'text-gray-500'
          }`}
        >
          Setores
        </button>
        <button
          onClick={() => setActiveTab('triage')}
          className={`px-3 py-2 text-sm ${
            activeTab === 'triage' ? 'border-b-2 border-blue-600 font-semibold text-blue-600' : 'text-gray-500'
          }`}
        >
          Triagem
        </button>
      </div>
      {activeTab === 'channels' ? (
        <div className="space-y-6">
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
                <label className="mt-2 flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={!!channel.triageEnabled}
                    onChange={(e) => handleToggleTriage(channel.id, e.target.checked)}
                  />
                  Usar triagem automática
                </label>
                <QrCodeView channel={channel} onRefresh={refresh} />
              </div>
            ))}
          </div>
          <CreateChannelForm onCreated={refresh} />
        </div>
      ) : activeTab === 'agents' ? (
        <AgentsAdminTab />
      ) : activeTab === 'quickReplies' ? (
        <QuickRepliesAdminTab />
      ) : activeTab === 'sectors' ? (
        <SectorsAdminTab />
      ) : (
        <TriageAdminTab />
      )}
    </div>
  );
}

export default AdminChannelsPage;
```

- [ ] **Step 25: Run the test to verify it passes**

Run (from `frontend/`): `npx vitest run src/pages/AdminChannelsPage.test.jsx`
Expected: PASS, all tests in the file (existing + 2 new)

- [ ] **Step 26: Run the full frontend suite**

Run (from `frontend/`): `npm test`
Expected: PASS, every test file green.

- [ ] **Step 27: Run the full backend suite one more time**

Run (from the repo root): `npm test`
Expected: PASS, all suites green except the 2 known pre-existing `outbound-queue.test.js` flakes.

- [ ] **Step 28: Commit**

```bash
git add frontend/src/pages/AdminChannelsPage.jsx frontend/src/pages/AdminChannelsPage.test.jsx
git commit -m "feat: add the Triagem tab and per-channel triage toggle to the admin page"
```
