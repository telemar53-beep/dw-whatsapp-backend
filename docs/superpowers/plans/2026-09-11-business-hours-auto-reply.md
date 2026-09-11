# Auto-resposta por horário de atendimento Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a customer message arrives outside configured business hours, send an
automatic notice (once per conversation) instead of leaving the customer with no
response until an agent sees it later.

**Architecture:** A new singleton config table (`business_hours_config`, mirrors
`assignment_message_config`) holds the enabled flag, start/end time, and message text. A
new `business-hours` module exposes a pure time-check function using `Intl.DateTimeFormat`
fixed to América/São_Paulo (no new dependency). `inbound-message.service.js` — the same
function that already orchestrates the welcome-message and city-notice automatic sends —
is extended to check business hours once per inbound message and, when applicable, send
the notice and suppress starting a new triage flow. A new `conversations` column tracks
whether the notice already fired for that conversation, enforcing "once per atendimento."

**Tech Stack:** Node.js/Express, PostgreSQL (node-pg-migrate), Jest + supertest (backend),
React + Vite + Vitest + Testing Library (frontend). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-11-business-hours-auto-reply-design.md`

## Global Constraints

- Business hours are **global** (one config for the whole company, not per-channel).
- Same start/end time **every weekday** (Monday–Friday); Saturday/Sunday are always
  outside business hours — no per-day grid.
- Timezone is **fixed to `America/Sao_Paulo`** — no configurable timezone field.
- The notice fires **at most once per conversation** (`conversations.business_hours_notice_sent_at`
  gates it — `NULL` = not yet sent).
- A **new** conversation created outside business hours does **not** start the automated
  triage flow (only the notice fires). An **existing** conversation already mid-triage
  keeps processing triage replies normally outside business hours — only the notice is
  added, nothing is interrupted.
- The notice message text is **admin-editable free text**, always required
  (`.trim()` non-empty), independent of the `enabled` flag.
- `endTime` must be strictly after `startTime` (same-day window only — no overnight
  windows like 22:00–06:00).
- Time values travel through the whole stack (DB, API, frontend) as `"HH:MM"` strings.
- Errors inside the business-hours send block are caught and logged
  (`console.error`), never thrown — mirrors the existing welcome-message/city-notice
  pattern in `inbound-message.service.js`. A failure to send the notice must never break
  inbound message processing.

---

### Task 1: Migration — `business_hours_config` table + `conversations` column

**Files:**
- Create: `migrations/1788930000000_add-business-hours.js`

**Interfaces:**
- Produces: table `business_hours_config` (`id`, `enabled`, `start_time`, `end_time`,
  `message`, `created_at`, `updated_at`), column `conversations.business_hours_notice_sent_at`
  (`TIMESTAMPTZ`, nullable).

- [ ] **Step 1: Write the migration**

```js
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS business_hours_config (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      enabled BOOLEAN NOT NULL DEFAULT false,
      start_time TIME NOT NULL DEFAULT '08:00',
      end_time TIME NOT NULL DEFAULT '18:00',
      message TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  pgm.sql(`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS business_hours_notice_sent_at TIMESTAMPTZ;`);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE conversations DROP COLUMN IF EXISTS business_hours_notice_sent_at;`);
  pgm.sql(`DROP TABLE IF EXISTS business_hours_config;`);
};
```

- [ ] **Step 2: Run the migration against the dev database**

Run: `npm run migrate up`
Expected: output includes `1788930000000_add-business-hours` and `Migrations complete!`

- [ ] **Step 3: Run the migration against the test database**

Run: `npm run migrate:test -- up`
Expected: output includes `1788930000000_add-business-hours` and `Migrations complete!`

- [ ] **Step 4: Commit**

```bash
git add migrations/1788930000000_add-business-hours.js
git commit -m "Add business_hours_config table and conversations.business_hours_notice_sent_at column"
```

---

### Task 2: `business-hours.repository.js` — singleton config CRUD

**Files:**
- Create: `src/business-hours/business-hours.repository.js`
- Test: `src/business-hours/business-hours.repository.test.js`

**Interfaces:**
- Consumes: `getPool()` from `src/db/pool.js`.
- Produces: `getBusinessHoursConfig(): Promise<{id, enabled, startTime, endTime, message}>`,
  `upsertBusinessHoursConfig({enabled, startTime, endTime, message}): Promise<{id, enabled, startTime, endTime, message}>`.
  Absent config: `{ id: null, enabled: false, startTime: '08:00', endTime: '18:00', message: '' }`.

- [ ] **Step 1: Write the failing tests**

```js
const { getPool, closePool } = require('../db/pool');
const { getBusinessHoursConfig, upsertBusinessHoursConfig } = require('./business-hours.repository');

describe('business hours repository', () => {
  beforeEach(async () => {
    await getPool().query('TRUNCATE business_hours_config');
  });

  afterAll(async () => {
    await closePool();
  });

  test('getBusinessHoursConfig returns the empty default when nothing is configured', async () => {
    expect(await getBusinessHoursConfig()).toEqual({
      id: null,
      enabled: false,
      startTime: '08:00',
      endTime: '18:00',
      message: '',
    });
  });

  test('upsertBusinessHoursConfig creates the row on first save', async () => {
    const config = await upsertBusinessHoursConfig({
      enabled: true,
      startTime: '09:00',
      endTime: '17:30',
      message: 'Nosso horário de atendimento é seg-sex das 09:00 às 17:30.',
    });

    expect(config.id).not.toBeNull();
    expect(config.enabled).toBe(true);
    expect(config.startTime).toBe('09:00');
    expect(config.endTime).toBe('17:30');
    expect(config.message).toBe('Nosso horário de atendimento é seg-sex das 09:00 às 17:30.');

    const fetched = await getBusinessHoursConfig();
    expect(fetched.id).toBe(config.id);
    expect(fetched.startTime).toBe('09:00');
  });

  test('upsertBusinessHoursConfig updates the existing row instead of creating a second one', async () => {
    await upsertBusinessHoursConfig({ enabled: true, startTime: '08:00', endTime: '18:00', message: 'primeira' });
    const updated = await upsertBusinessHoursConfig({ enabled: false, startTime: '10:00', endTime: '16:00', message: 'segunda' });

    expect(updated.enabled).toBe(false);
    expect(updated.startTime).toBe('10:00');
    expect(updated.message).toBe('segunda');

    const all = await getPool().query('SELECT id FROM business_hours_config');
    expect(all.rowCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx dotenv -e .env.test -o -- jest src/business-hours/business-hours.repository.test.js`
Expected: FAIL — `Cannot find module './business-hours.repository'`

- [ ] **Step 3: Write the implementation**

```js
const { getPool } = require('../db/pool');

function toConfig(row) {
  return {
    id: row.id,
    enabled: row.enabled,
    startTime: row.start_time.slice(0, 5),
    endTime: row.end_time.slice(0, 5),
    message: row.message,
  };
}

async function getBusinessHoursConfig() {
  const result = await getPool().query('SELECT * FROM business_hours_config ORDER BY created_at ASC LIMIT 1');
  if (result.rowCount === 0) {
    return { id: null, enabled: false, startTime: '08:00', endTime: '18:00', message: '' };
  }
  return toConfig(result.rows[0]);
}

async function upsertBusinessHoursConfig({ enabled, startTime, endTime, message }) {
  const existing = await getPool().query('SELECT id FROM business_hours_config ORDER BY created_at ASC LIMIT 1');
  if (existing.rowCount === 0) {
    const inserted = await getPool().query(
      `INSERT INTO business_hours_config (enabled, start_time, end_time, message)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [enabled, startTime, endTime, message]
    );
    return toConfig(inserted.rows[0]);
  }
  const updated = await getPool().query(
    `UPDATE business_hours_config SET enabled = $2, start_time = $3, end_time = $4, message = $5, updated_at = now()
     WHERE id = $1 RETURNING *`,
    [existing.rows[0].id, enabled, startTime, endTime, message]
  );
  return toConfig(updated.rows[0]);
}

module.exports = { getBusinessHoursConfig, upsertBusinessHoursConfig };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx dotenv -e .env.test -o -- jest src/business-hours/business-hours.repository.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/business-hours/business-hours.repository.js src/business-hours/business-hours.repository.test.js
git commit -m "Add business-hours config repository (singleton get/upsert)"
```

---

### Task 3: `business-hours.service.js` — `isOutsideBusinessHours`

**Files:**
- Create: `src/business-hours/business-hours.service.js`
- Test: `src/business-hours/business-hours.service.test.js`

**Interfaces:**
- Consumes: nothing (pure function).
- Produces: `isOutsideBusinessHours(config: {startTime, endTime}, now?: Date): boolean`
  where `config.startTime`/`config.endTime` are `"HH:MM"` strings. `now` defaults to
  `new Date()`.

- [ ] **Step 1: Write the failing tests**

All timestamps below use `America/Sao_Paulo` = UTC-3 year-round (Brazil abolished DST in
2019). 2026-09-14 is a Monday, 2026-09-12 a Saturday, 2026-09-13 a Sunday.

```js
const { isOutsideBusinessHours } = require('./business-hours.service');

const CONFIG = { startTime: '08:00', endTime: '18:00' };

describe('isOutsideBusinessHours', () => {
  test('is false in the middle of a weekday inside the window', () => {
    // Monday 2026-09-14, 12:00 São Paulo = 15:00 UTC
    expect(isOutsideBusinessHours(CONFIG, new Date('2026-09-14T15:00:00.000Z'))).toBe(false);
  });

  test('is false exactly at the start time (inclusive)', () => {
    // Monday 2026-09-14, 08:00 São Paulo = 11:00 UTC
    expect(isOutsideBusinessHours(CONFIG, new Date('2026-09-14T11:00:00.000Z'))).toBe(false);
  });

  test('is true one minute before the start time', () => {
    // Monday 2026-09-14, 07:59 São Paulo = 10:59 UTC
    expect(isOutsideBusinessHours(CONFIG, new Date('2026-09-14T10:59:00.000Z'))).toBe(true);
  });

  test('is true exactly at the end time (exclusive)', () => {
    // Monday 2026-09-14, 18:00 São Paulo = 21:00 UTC
    expect(isOutsideBusinessHours(CONFIG, new Date('2026-09-14T21:00:00.000Z'))).toBe(true);
  });

  test('is true one minute before the end time is false, one minute after is true', () => {
    // Monday 2026-09-14, 17:59 São Paulo = 20:59 UTC (still inside)
    expect(isOutsideBusinessHours(CONFIG, new Date('2026-09-14T20:59:00.000Z'))).toBe(false);
    // Monday 2026-09-14, 18:01 São Paulo = 21:01 UTC (outside)
    expect(isOutsideBusinessHours(CONFIG, new Date('2026-09-14T21:01:00.000Z'))).toBe(true);
  });

  test('is true on Saturday even during normal weekday hours', () => {
    // Saturday 2026-09-12, 12:00 São Paulo = 15:00 UTC
    expect(isOutsideBusinessHours(CONFIG, new Date('2026-09-12T15:00:00.000Z'))).toBe(true);
  });

  test('is true on Sunday even during normal weekday hours', () => {
    // Sunday 2026-09-13, 12:00 São Paulo = 15:00 UTC
    expect(isOutsideBusinessHours(CONFIG, new Date('2026-09-13T15:00:00.000Z'))).toBe(true);
  });

  test('handles midnight correctly (Node ICU formats it as hour 24, must normalize to 0)', () => {
    // Monday 2026-09-14, 00:00 São Paulo = 03:00 UTC
    expect(isOutsideBusinessHours(CONFIG, new Date('2026-09-14T03:00:00.000Z'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx dotenv -e .env.test -o -- jest src/business-hours/business-hours.service.test.js`
Expected: FAIL — `Cannot find module './business-hours.service'`

- [ ] **Step 3: Write the implementation**

```js
const TIMEZONE = 'America/Sao_Paulo';

function getSaoPauloParts(date) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const weekday = parts.find((p) => p.type === 'weekday').value;
  let hour = Number(parts.find((p) => p.type === 'hour').value);
  const minute = Number(parts.find((p) => p.type === 'minute').value);
  if (hour === 24) hour = 0;
  return { weekday, hour, minute };
}

function timeStringToMinutes(timeString) {
  const [hours, minutes] = timeString.split(':').map(Number);
  return hours * 60 + minutes;
}

function isOutsideBusinessHours(config, now = new Date()) {
  const { weekday, hour, minute } = getSaoPauloParts(now);
  if (weekday === 'Sat' || weekday === 'Sun') return true;
  const nowMinutes = hour * 60 + minute;
  return nowMinutes < timeStringToMinutes(config.startTime) || nowMinutes >= timeStringToMinutes(config.endTime);
}

module.exports = { isOutsideBusinessHours };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx dotenv -e .env.test -o -- jest src/business-hours/business-hours.service.test.js`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/business-hours/business-hours.service.js src/business-hours/business-hours.service.test.js
git commit -m "Add isOutsideBusinessHours (fixed America/Sao_Paulo, no new dependency)"
```

---

### Task 4: `conversation.repository.js` — `businessHoursNoticeSentAt` + `markBusinessHoursNoticeSent`

**Files:**
- Modify: `src/conversations/conversation.repository.js`
- Test: `src/conversations/conversation.repository.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `toConversation(row)` now includes `businessHoursNoticeSentAt`;
  `findOpenConversation`, `createConversation`, `activateConversation` now return that
  field; new `markBusinessHoursNoticeSent(conversationId): Promise<Conversation>`.

- [ ] **Step 1: Write the failing tests**

Add to `src/conversations/conversation.repository.test.js` (the file already imports
`getPool`, `closePool`, and truncates `conversations, contacts, channels, agents,
conversation_events, sectors, cities CASCADE` in `beforeEach` — reuse the existing
`contactId`/`channelId` set up there). Add `markBusinessHoursNoticeSent` to the existing
destructured `require('./conversation.repository')` import at the top of the file.

```js
test('a freshly created conversation has a null businessHoursNoticeSentAt', async () => {
  const conversation = await createConversation(contactId, channelId);
  expect(conversation.businessHoursNoticeSentAt).toBeNull();
});

test('markBusinessHoursNoticeSent sets a timestamp', async () => {
  const conversation = await createConversation(contactId, channelId);

  const updated = await markBusinessHoursNoticeSent(conversation.id);

  expect(updated.businessHoursNoticeSentAt).not.toBeNull();
});

test('findOpenConversation returns businessHoursNoticeSentAt after it was marked', async () => {
  const conversation = await createConversation(contactId, channelId);
  await markBusinessHoursNoticeSent(conversation.id);

  const found = await findOpenConversation(contactId, channelId);

  expect(found.businessHoursNoticeSentAt).not.toBeNull();
});

test('activateConversation preserves a previously marked businessHoursNoticeSentAt', async () => {
  const conversation = await createConversation(contactId, channelId, null, 'silent');
  await markBusinessHoursNoticeSent(conversation.id);

  const activated = await activateConversation(conversation.id);

  expect(activated.businessHoursNoticeSentAt).not.toBeNull();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx dotenv -e .env.test -o -- jest src/conversations/conversation.repository.test.js -t "businessHoursNoticeSentAt|markBusinessHoursNoticeSent"`
Expected: FAIL — `businessHoursNoticeSentAt` is `undefined`, and `markBusinessHoursNoticeSent is not a function`

- [ ] **Step 3: Write the implementation**

In `src/conversations/conversation.repository.js`:

Modify `toConversation`:

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
    businessHoursNoticeSentAt: row.business_hours_notice_sent_at !== undefined ? row.business_hours_notice_sent_at : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
```

Modify `findOpenConversation`'s `SELECT`:

```js
async function findOpenConversation(contactId, channelId) {
  const result = await getPool().query(
    `SELECT id, contact_id, channel_id, status, assigned_agent_id, sector_id, triage_state, triage_attempts, business_hours_notice_sent_at, created_at, updated_at
     FROM conversations WHERE contact_id = $1 AND channel_id = $2 AND status <> 'closed'`,
    [contactId, channelId]
  );
  if (result.rowCount === 0) return null;
  return toConversation(result.rows[0]);
}
```

Modify `createConversation`'s `RETURNING`:

```js
async function createConversation(contactId, channelId, triageState = null, status = 'waiting') {
  const result = await getPool().query(
    `INSERT INTO conversations (contact_id, channel_id, triage_state, status) VALUES ($1, $2, $3, $4)
     RETURNING id, contact_id, channel_id, status, assigned_agent_id, sector_id, triage_state, triage_attempts, business_hours_notice_sent_at, created_at, updated_at`,
    [contactId, channelId, triageState, status]
  );
  return toConversation(result.rows[0]);
}
```

Modify `activateConversation`'s `RETURNING`:

```js
async function activateConversation(conversationId) {
  const result = await getPool().query(
    `UPDATE conversations SET status = 'waiting', updated_at = now()
     WHERE id = $1 AND status = 'silent'
     RETURNING id, contact_id, channel_id, status, assigned_agent_id, sector_id, triage_state, triage_attempts, business_hours_notice_sent_at, created_at, updated_at`,
    [conversationId]
  );
  if (result.rowCount === 0) return null;
  return toConversation(result.rows[0]);
}
```

Add a new function `markBusinessHoursNoticeSent`, placed directly after `activateConversation`:

```js
async function markBusinessHoursNoticeSent(conversationId) {
  const result = await getPool().query(
    `UPDATE conversations SET business_hours_notice_sent_at = now() WHERE id = $1
     RETURNING id, contact_id, channel_id, status, assigned_agent_id, sector_id, triage_state, triage_attempts, business_hours_notice_sent_at, created_at, updated_at`,
    [conversationId]
  );
  return toConversation(result.rows[0]);
}
```

Add `markBusinessHoursNoticeSent` to the existing `module.exports` block at the bottom
of the file. The current block (do not create a second `module.exports`):

```js
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

Add `markBusinessHoursNoticeSent,` as a new line inside it (position doesn't matter).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx dotenv -e .env.test -o -- jest src/conversations/conversation.repository.test.js`
Expected: PASS (full file, including the 4 new tests — this file is large, run it whole
to also confirm the `protocol_number`/other pre-existing columns weren't disturbed)

- [ ] **Step 5: Commit**

```bash
git add src/conversations/conversation.repository.js src/conversations/conversation.repository.test.js
git commit -m "Add businessHoursNoticeSentAt to conversation.repository.js"
```

---

### Task 5: Integrate business-hours check into `inbound-message.service.js`

**Files:**
- Modify: `src/conversations/inbound-message.service.js`
- Test: `src/conversations/inbound-message.service.test.js`

**Interfaces:**
- Consumes: `getBusinessHoursConfig` (Task 2), `isOutsideBusinessHours` (Task 3),
  `markBusinessHoursNoticeSent` (Task 4), `enqueueOutboundMessage` (existing),
  `shouldStartTriage` (existing).
- Produces: no new exports — behavior change only inside `ingestInboundMessage`.

- [ ] **Step 1: Write the failing tests**

Add to `src/conversations/inbound-message.service.test.js`. First, extend the file's
existing mock/import/beforeEach setup (near the top of the file) — add two new
`jest.mock` calls alongside the existing ones, two new `require`s, add
`markBusinessHoursNoticeSent` to the existing `conversation.repository` destructure, and
a default mock in `beforeEach` so every pre-existing test in this file keeps passing
unmodified (business hours disabled by default):

```js
jest.mock('../business-hours/business-hours.repository');
jest.mock('../business-hours/business-hours.service');
```

```js
const { getBusinessHoursConfig } = require('../business-hours/business-hours.repository');
const { isOutsideBusinessHours } = require('../business-hours/business-hours.service');
```

Change the existing conversation.repository destructure line to also pull in
`markBusinessHoursNoticeSent`:

```js
const { findOpenConversation, createConversation, getConversationWithContact, activateConversation, markBusinessHoursNoticeSent } = require('./conversation.repository');
```

Add to the existing `beforeEach`:

```js
getBusinessHoursConfig.mockResolvedValue({ enabled: false, startTime: '08:00', endTime: '18:00', message: '' });
isOutsideBusinessHours.mockReturnValue(false);
```

Then add a new `describe` block with the business-hours-specific tests:

```js
describe('business hours notice', () => {
  test('sends the notice and does not start triage when a new conversation arrives outside business hours', async () => {
    getBusinessHoursConfig.mockResolvedValue({
      enabled: true,
      startTime: '08:00',
      endTime: '18:00',
      message: 'Nosso horário de atendimento é seg-sex das 08:00 às 18:00.',
    });
    isOutsideBusinessHours.mockReturnValue(true);
    shouldStartTriage.mockResolvedValue(true);
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-1', phoneNumber: '+5511999998888' });
    findOpenConversation.mockResolvedValue(null);
    createConversation.mockResolvedValue({ id: 'conv-1', assignedAgentId: null, triageState: null, businessHoursNoticeSentAt: null });
    createMessage.mockResolvedValue({ id: 'msg-1' });
    markBusinessHoursNoticeSent.mockResolvedValue({ id: 'conv-1', assignedAgentId: null, triageState: null, businessHoursNoticeSentAt: '2026-09-14T03:00:00.000Z' });
    getConversationWithContact.mockResolvedValue({ id: 'conv-1', assignedAgentId: null });

    await ingestInboundMessage({
      channelId: 'channel-1',
      fromPhoneNumber: '+5511999998888',
      contactDisplayName: 'Cliente',
      whatsappMessageId: 'wamid.X',
      content: 'Oi',
    });

    expect(createConversation).toHaveBeenCalledWith('contact-1', 'channel-1', null);
    expect(enqueueOutboundMessage).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      channelId: 'channel-1',
      content: 'Nosso horário de atendimento é seg-sex das 08:00 às 18:00.',
    });
    expect(markBusinessHoursNoticeSent).toHaveBeenCalledWith('conv-1');
    expect(sendTriageQuestion).not.toHaveBeenCalled();
  });

  test('starts triage normally for a new conversation inside business hours (regression)', async () => {
    getBusinessHoursConfig.mockResolvedValue({ enabled: true, startTime: '08:00', endTime: '18:00', message: 'aviso' });
    isOutsideBusinessHours.mockReturnValue(false);
    shouldStartTriage.mockResolvedValue(true);
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-1', phoneNumber: '+5511999998888' });
    findOpenConversation.mockResolvedValue(null);
    createConversation.mockResolvedValue({ id: 'conv-1', assignedAgentId: null, triageState: 'pending', businessHoursNoticeSentAt: null });
    createMessage.mockResolvedValue({ id: 'msg-1' });
    getConversationWithContact.mockResolvedValue({ id: 'conv-1', assignedAgentId: null });

    await ingestInboundMessage({
      channelId: 'channel-1',
      fromPhoneNumber: '+5511999998888',
      contactDisplayName: 'Cliente',
      whatsappMessageId: 'wamid.X',
      content: 'Oi',
    });

    expect(createConversation).toHaveBeenCalledWith('contact-1', 'channel-1', 'pending');
    expect(sendTriageQuestion).toHaveBeenCalledWith('conv-1', 'channel-1');
    expect(markBusinessHoursNoticeSent).not.toHaveBeenCalled();
  });

  test('does not repeat the notice on a second message in the same conversation', async () => {
    getBusinessHoursConfig.mockResolvedValue({ enabled: true, startTime: '08:00', endTime: '18:00', message: 'aviso' });
    isOutsideBusinessHours.mockReturnValue(true);
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-1', phoneNumber: '+5511999998888' });
    findOpenConversation.mockResolvedValue({
      id: 'conv-1',
      assignedAgentId: null,
      triageState: null,
      businessHoursNoticeSentAt: '2026-09-14T03:00:00.000Z',
    });
    createMessage.mockResolvedValue({ id: 'msg-2' });
    getConversationWithContact.mockResolvedValue({ id: 'conv-1', assignedAgentId: null });

    await ingestInboundMessage({
      channelId: 'channel-1',
      fromPhoneNumber: '+5511999998888',
      contactDisplayName: 'Cliente',
      whatsappMessageId: 'wamid.Y',
      content: 'Segunda mensagem',
    });

    expect(markBusinessHoursNoticeSent).not.toHaveBeenCalled();
    expect(enqueueOutboundMessage).not.toHaveBeenCalled();
  });

  test('sends the notice on an existing conversation with pending triage without interrupting the triage reply', async () => {
    getBusinessHoursConfig.mockResolvedValue({ enabled: true, startTime: '08:00', endTime: '18:00', message: 'aviso de horário' });
    isOutsideBusinessHours.mockReturnValue(true);
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-1', phoneNumber: '+5511999998888' });
    findOpenConversation.mockResolvedValue({
      id: 'conv-1',
      assignedAgentId: null,
      triageState: 'pending',
      businessHoursNoticeSentAt: null,
    });
    createMessage.mockResolvedValue({ id: 'msg-2' });
    markBusinessHoursNoticeSent.mockResolvedValue({
      id: 'conv-1',
      assignedAgentId: null,
      triageState: 'pending',
      businessHoursNoticeSentAt: '2026-09-14T03:00:00.000Z',
    });
    processTriageReply.mockResolvedValue({ id: 'conv-1', assignedAgentId: null, triageState: 'completed' });
    getConversationWithContact.mockResolvedValue({ id: 'conv-1', assignedAgentId: null });

    await ingestInboundMessage({
      channelId: 'channel-1',
      fromPhoneNumber: '+5511999998888',
      contactDisplayName: 'Cliente',
      whatsappMessageId: 'wamid.Y',
      content: '1',
    });

    expect(enqueueOutboundMessage).toHaveBeenCalledWith({ conversationId: 'conv-1', channelId: 'channel-1', content: 'aviso de horário' });
    expect(markBusinessHoursNoticeSent).toHaveBeenCalledWith('conv-1');
    expect(processTriageReply).toHaveBeenCalledWith(
      { id: 'conv-1', assignedAgentId: null, triageState: 'pending', businessHoursNoticeSentAt: '2026-09-14T03:00:00.000Z' },
      'channel-1',
      '1'
    );
  });

  test('never checks business hours behavior when the config is disabled', async () => {
    getBusinessHoursConfig.mockResolvedValue({ enabled: false, startTime: '08:00', endTime: '18:00', message: 'aviso' });
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-1', phoneNumber: '+5511999998888' });
    findOpenConversation.mockResolvedValue({ id: 'conv-1', assignedAgentId: null, triageState: null, businessHoursNoticeSentAt: null });
    createMessage.mockResolvedValue({ id: 'msg-1' });
    getConversationWithContact.mockResolvedValue({ id: 'conv-1', assignedAgentId: null });

    await ingestInboundMessage({
      channelId: 'channel-1',
      fromPhoneNumber: '+5511999998888',
      contactDisplayName: 'Cliente',
      whatsappMessageId: 'wamid.X',
      content: 'Oi',
    });

    expect(isOutsideBusinessHours).not.toHaveBeenCalled();
    expect(markBusinessHoursNoticeSent).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx dotenv -e .env.test -o -- jest src/conversations/inbound-message.service.test.js`
Expected: FAIL — the new `describe('business hours notice', ...)` tests fail (notice
never sent, triage always starts); pre-existing tests in the file should still PASS
already at this point (the default `beforeEach` mocks make `outsideBusinessHours`
effectively `false` even before the implementation exists, since the current code simply
ignores the new mocks) — if any pre-existing test fails here, stop and re-check the
`beforeEach` edit before continuing.

- [ ] **Step 3: Write the implementation**

In `src/conversations/inbound-message.service.js`, add two new requires at the top,
alongside the existing ones:

```js
const { getBusinessHoursConfig } = require('../business-hours/business-hours.repository');
const { isOutsideBusinessHours } = require('../business-hours/business-hours.service');
```

Add `markBusinessHoursNoticeSent` to the existing conversation.repository require line:

```js
const { findOpenConversation, createConversation, getConversationWithContact, activateConversation, markBusinessHoursNoticeSent } = require('./conversation.repository');
```

Replace the whole body of `ingestInboundMessage` with:

```js
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
  const { wasCreated, ...contact } = await findOrCreateContactByPhoneNumber(fromPhoneNumber, contactDisplayName);
  const contactJustCreated = Boolean(wasCreated);

  const businessHoursConfig = await getBusinessHoursConfig();
  const outsideBusinessHours = businessHoursConfig.enabled && isOutsideBusinessHours(businessHoursConfig);

  let conversation = await findOpenConversation(contact.id, channelId);
  if (conversation && conversation.status === 'silent') {
    conversation = await activateConversation(conversation.id);
  }
  let justCreated = false;
  if (!conversation) {
    const startTriage = !outsideBusinessHours && (await shouldStartTriage(channelId));
    try {
      conversation = await createConversation(contact.id, channelId, startTriage ? 'pending' : null);
      justCreated = true;
    } catch (err) {
      if (err.code !== UNIQUE_VIOLATION) throw err;
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
    if (err.code !== UNIQUE_VIOLATION) throw err;
    return { contact, conversation, message: null, contactJustCreated };
  }
  if (justCreated) {
    try {
      const channel = await findChannelById(channelId);
      if (channel && channel.welcomeMessage) {
        await enqueueOutboundMessage({ conversationId: conversation.id, channelId, content: channel.welcomeMessage });
      }
    } catch (err) {
      console.error(`Failed to send welcome message for conversation ${conversation.id}`, err);
    }
  }

  try {
    const cityNotice = await findActiveCityNoticeByCityId(contact.cityId);
    if (cityNotice && (await recordNoticeDelivery(cityNotice.id, contact.id))) {
      await enqueueOutboundMessage({ conversationId: conversation.id, channelId, content: cityNotice.message });
    }
  } catch (err) {
    console.error(`Failed to send city notice for conversation ${conversation.id}`, err);
  }

  if (outsideBusinessHours && !conversation.businessHoursNoticeSentAt) {
    try {
      await enqueueOutboundMessage({ conversationId: conversation.id, channelId, content: businessHoursConfig.message });
      conversation = await markBusinessHoursNoticeSent(conversation.id);
    } catch (err) {
      console.error(`Failed to send business hours notice for conversation ${conversation.id}`, err);
    }
  }

  if (justCreated) {
    try {
      if (conversation.triageState === 'pending') {
        await sendTriageQuestion(conversation.id, channelId);
      }
    } catch (err) {
      console.error(`Failed to start triage for conversation ${conversation.id}`, err);
    }
  } else if (!justCreated && conversation.triageState === 'pending') {
    conversation = await processTriageReply(conversation, channelId, content);
  }
  const conversationWithContact = await getConversationWithContact(conversation.id);
  if (conversationWithContact.assignedAgentId) {
    emitToAgent(conversationWithContact.assignedAgentId, 'message:new', { conversation: conversationWithContact, message });
  } else {
    broadcast('queue:new', { conversation: conversationWithContact, message });
  }
  broadcastToDashboard('dashboard:conversation', { conversation: conversationWithContact });
  return { contact, conversation, message, contactJustCreated };
}
```

(Only the two `require` lines, the `businessHoursConfig`/`outsideBusinessHours`
computation, the `!outsideBusinessHours &&` guard on `startTriage`, and the new
`if (outsideBusinessHours && ...)` block are new — every other line is unchanged from
the current file.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx dotenv -e .env.test -o -- jest src/conversations/inbound-message.service.test.js`
Expected: PASS (full file — every pre-existing test plus the new `business hours notice`
block)

- [ ] **Step 5: Commit**

```bash
git add src/conversations/inbound-message.service.js src/conversations/inbound-message.service.test.js
git commit -m "Send a business-hours notice on inbound messages outside configured hours"
```

---

### Task 6: Admin route `/api/admin/business-hours`

**Files:**
- Create: `src/api/admin-business-hours.routes.js`
- Test: `src/api/admin-business-hours.routes.test.js`
- Modify: `src/server.js`

**Interfaces:**
- Consumes: `getBusinessHoursConfig`, `upsertBusinessHoursConfig` (Task 2).
- Produces: `GET /api/admin/business-hours` → `{id, enabled, startTime, endTime, message}`;
  `PUT /api/admin/business-hours` (same body/response shape).

- [ ] **Step 1: Write the failing tests**

```js
jest.mock('../business-hours/business-hours.repository');

const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const { getBusinessHoursConfig, upsertBusinessHoursConfig } = require('../business-hours/business-hours.repository');
const adminBusinessHoursRoutes = require('./admin-business-hours.routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/business-hours', adminBusinessHoursRoutes);
  return app;
}

function tokenFor(agentId, role) {
  return jwt.sign({ agentId, role }, process.env.JWT_SECRET);
}

describe('GET /api/admin/business-hours', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns the current config', async () => {
    getBusinessHoursConfig.mockResolvedValue({ id: 'config-1', enabled: true, startTime: '08:00', endTime: '18:00', message: 'aviso' });
    const res = await request(buildApp())
      .get('/api/admin/business-hours')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 'config-1', enabled: true, startTime: '08:00', endTime: '18:00', message: 'aviso' });
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .get('/api/admin/business-hours')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(403);
  });
});

describe('PUT /api/admin/business-hours', () => {
  beforeEach(() => jest.clearAllMocks());

  test('saves the config and returns it', async () => {
    upsertBusinessHoursConfig.mockResolvedValue({ id: 'config-1', enabled: true, startTime: '08:00', endTime: '18:00', message: 'aviso' });
    const res = await request(buildApp())
      .put('/api/admin/business-hours')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ enabled: true, startTime: '08:00', endTime: '18:00', message: 'aviso' });
    expect(res.status).toBe(200);
    expect(upsertBusinessHoursConfig).toHaveBeenCalledWith({ enabled: true, startTime: '08:00', endTime: '18:00', message: 'aviso' });
    expect(res.body.startTime).toBe('08:00');
  });

  test('returns 400 when startTime is not HH:MM', async () => {
    const res = await request(buildApp())
      .put('/api/admin/business-hours')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ enabled: true, startTime: '8:00', endTime: '18:00', message: 'aviso' });
    expect(res.status).toBe(400);
    expect(upsertBusinessHoursConfig).not.toHaveBeenCalled();
  });

  test('returns 400 when endTime is not HH:MM', async () => {
    const res = await request(buildApp())
      .put('/api/admin/business-hours')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ enabled: true, startTime: '08:00', endTime: '25:00', message: 'aviso' });
    expect(res.status).toBe(400);
    expect(upsertBusinessHoursConfig).not.toHaveBeenCalled();
  });

  test('returns 400 when endTime is not after startTime', async () => {
    const res = await request(buildApp())
      .put('/api/admin/business-hours')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ enabled: true, startTime: '18:00', endTime: '08:00', message: 'aviso' });
    expect(res.status).toBe(400);
    expect(upsertBusinessHoursConfig).not.toHaveBeenCalled();
  });

  test('returns 400 when endTime equals startTime', async () => {
    const res = await request(buildApp())
      .put('/api/admin/business-hours')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ enabled: true, startTime: '08:00', endTime: '08:00', message: 'aviso' });
    expect(res.status).toBe(400);
    expect(upsertBusinessHoursConfig).not.toHaveBeenCalled();
  });

  test('returns 400 when message is empty', async () => {
    const res = await request(buildApp())
      .put('/api/admin/business-hours')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ enabled: true, startTime: '08:00', endTime: '18:00', message: '   ' });
    expect(res.status).toBe(400);
    expect(upsertBusinessHoursConfig).not.toHaveBeenCalled();
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .put('/api/admin/business-hours')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ enabled: true, startTime: '08:00', endTime: '18:00', message: 'aviso' });
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx dotenv -e .env.test -o -- jest src/api/admin-business-hours.routes.test.js`
Expected: FAIL — `Cannot find module './admin-business-hours.routes'`

- [ ] **Step 3: Write the implementation**

`src/api/admin-business-hours.routes.js`:

```js
const express = require('express');
const { requireAuth, requireRole } = require('../auth/auth.middleware');
const { getBusinessHoursConfig, upsertBusinessHoursConfig } = require('../business-hours/business-hours.repository');

const router = express.Router();

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function toResponse(config) {
  return {
    id: config.id,
    enabled: config.enabled,
    startTime: config.startTime,
    endTime: config.endTime,
    message: config.message,
  };
}

function timeToMinutes(timeString) {
  const [hours, minutes] = timeString.split(':').map(Number);
  return hours * 60 + minutes;
}

router.get('/', requireAuth, requireRole('admin'), async (req, res) => {
  const config = await getBusinessHoursConfig();
  res.json(toResponse(config));
});

router.put('/', requireAuth, requireRole('admin'), async (req, res) => {
  const { enabled, startTime, endTime, message } = req.body || {};
  if (typeof startTime !== 'string' || !TIME_PATTERN.test(startTime)) {
    return res.status(400).json({ error: 'startTime must be in HH:MM format' });
  }
  if (typeof endTime !== 'string' || !TIME_PATTERN.test(endTime)) {
    return res.status(400).json({ error: 'endTime must be in HH:MM format' });
  }
  if (timeToMinutes(endTime) <= timeToMinutes(startTime)) {
    return res.status(400).json({ error: 'endTime must be after startTime' });
  }
  if (typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'message is required' });
  }
  const config = await upsertBusinessHoursConfig({ enabled: Boolean(enabled), startTime, endTime, message });
  res.json(toResponse(config));
});

module.exports = router;
```

In `src/server.js`, add the require alongside the other admin route requires (right
after the `adminAssignmentMessagesRoutes` require, line 32):

```js
const adminBusinessHoursRoutes = require('./api/admin-business-hours.routes');
```

And mount it alongside the other `/api/admin/...` routes (right after
`app.use('/api/admin/assignment-message', adminAssignmentMessagesRoutes);`, line 93):

```js
app.use('/api/admin/business-hours', adminBusinessHoursRoutes);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx dotenv -e .env.test -o -- jest src/api/admin-business-hours.routes.test.js`
Expected: PASS (9 tests)

- [ ] **Step 5: Run the full backend suite**

Run: `npm test`
Expected: PASS (all suites, including `server.js`-loading tests that would catch a typo
in the new require/mount lines)

- [ ] **Step 6: Commit**

```bash
git add src/api/admin-business-hours.routes.js src/api/admin-business-hours.routes.test.js src/server.js
git commit -m "Add admin GET/PUT /api/admin/business-hours route"
```

---

### Task 7: Frontend — config hook + "Horário de atendimento" section

**Files:**
- Modify: `frontend/src/services/api.js`
- Create: `frontend/src/hooks/useBusinessHoursConfig.js`
- Modify: `frontend/src/components/MessagesAdminTab.jsx`
- Modify: `frontend/src/components/MessagesAdminTab.test.jsx`

**Interfaces:**
- Consumes: `apiFetch` (existing helper in `services/api.js`).
- Produces: `getBusinessHoursConfig(token)`, `updateBusinessHoursConfig(payload, token)`
  in `services/api.js`; `useBusinessHoursConfig()` hook returning
  `{config, loading, refresh}`; a `BusinessHoursSection` component rendered inside
  `MessagesAdminTab`.

- [ ] **Step 1: Add the API functions**

In `frontend/src/services/api.js`, add these two functions right after the existing
`updateAssignmentMessageConfig` function:

```js
export function getBusinessHoursConfig(token) {
  return apiFetch('/api/admin/business-hours', { token });
}

export function updateBusinessHoursConfig(payload, token) {
  return apiFetch('/api/admin/business-hours', { method: 'PUT', body: payload, token });
}
```

- [ ] **Step 2: Add the hook**

Create `frontend/src/hooks/useBusinessHoursConfig.js`:

```js
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getBusinessHoursConfig } from '../services/api';

const EMPTY_CONFIG = { id: null, enabled: false, startTime: '08:00', endTime: '18:00', message: '' };

export function useBusinessHoursConfig() {
  const { token } = useAuth();
  const [config, setConfig] = useState(EMPTY_CONFIG);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    if (!token) return Promise.resolve();
    setLoading(true);
    return getBusinessHoursConfig(token)
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

- [ ] **Step 3: Write the failing tests for the new section**

Add to `frontend/src/components/MessagesAdminTab.test.jsx`. First, add the import and
mock alongside the existing ones near the top of the file:

```js
import { useBusinessHoursConfig } from '../hooks/useBusinessHoursConfig';
```

```js
vi.mock('../hooks/useBusinessHoursConfig');
```

Add a default mock to the file's existing top-level `beforeEach`:

```js
useBusinessHoursConfig.mockReturnValue({
  config: { id: null, enabled: false, startTime: '08:00', endTime: '18:00', message: '' },
  loading: false,
  refresh: vi.fn(),
});
```

Also change the file's existing `@testing-library/react` import line to add `fireEvent`
(needed below — `<input type="time">` fields are not reliably filled by
`userEvent.type()` in jsdom, so this plan uses `fireEvent.change` for them instead, the
standard robust pattern for date/time inputs in Testing Library):

```js
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
```

Then add a new `describe` block, mirroring the existing `'Atribuir um atendimento'`
block's style:

```js
describe('Horário de atendimento', () => {
  test('shows a "Criar" button when no config exists yet', () => {
    useBusinessHoursConfig.mockReturnValue({
      config: { id: null, enabled: false, startTime: '08:00', endTime: '18:00', message: '' },
      loading: false,
      refresh: vi.fn(),
    });
    render(<MessagesAdminTab />);
    expect(screen.getByRole('button', { name: 'Criar horário de atendimento' })).toBeInTheDocument();
  });

  test('fills the form, saves and shows the closed summary', async () => {
    const refresh = vi.fn();
    useBusinessHoursConfig.mockReturnValue({
      config: { id: null, enabled: false, startTime: '08:00', endTime: '18:00', message: '' },
      loading: false,
      refresh,
    });
    api.updateBusinessHoursConfig.mockResolvedValue({
      id: 'config-1',
      enabled: true,
      startTime: '09:00',
      endTime: '17:00',
      message: 'Atendemos de seg a sex, das 09:00 às 17:00.',
    });
    render(<MessagesAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: 'Criar horário de atendimento' }));
    await userEvent.click(screen.getByLabelText(/ativo/i));
    fireEvent.change(screen.getByLabelText(/hora de início/i), { target: { value: '09:00' } });
    fireEvent.change(screen.getByLabelText(/hora de fim/i), { target: { value: '17:00' } });
    await userEvent.type(screen.getByLabelText(/mensagem/i), 'Atendemos de seg a sex, das 09:00 às 17:00.');
    await userEvent.click(screen.getByRole('button', { name: /^salvar$/i }));

    await waitFor(() =>
      expect(api.updateBusinessHoursConfig).toHaveBeenCalledWith(
        { enabled: true, startTime: '09:00', endTime: '17:00', message: 'Atendemos de seg a sex, das 09:00 às 17:00.' },
        'tok-123'
      )
    );
    expect(refresh).toHaveBeenCalled();
    expect(screen.getByText(/09:00.*17:00/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Criar horário de atendimento' })).not.toBeInTheDocument();
  });

  test('canceling while creating does not leave a stale draft on reopen', async () => {
    useBusinessHoursConfig.mockReturnValue({
      config: { id: null, enabled: false, startTime: '08:00', endTime: '18:00', message: '' },
      loading: false,
      refresh: vi.fn(),
    });
    render(<MessagesAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: 'Criar horário de atendimento' }));
    await userEvent.type(screen.getByLabelText(/mensagem/i), 'rascunho descartado');
    await userEvent.click(screen.getByRole('button', { name: /^cancelar$/i }));

    await userEvent.click(screen.getByRole('button', { name: 'Criar horário de atendimento' }));
    expect(screen.getByLabelText(/mensagem/i)).toHaveValue('');
  });

  test('shows the closed-state summary with the configured window when a config already exists', () => {
    useBusinessHoursConfig.mockReturnValue({
      config: { id: 'config-1', enabled: true, startTime: '08:00', endTime: '18:00', message: 'aviso' },
      loading: false,
      refresh: vi.fn(),
    });
    render(<MessagesAdminTab />);
    expect(screen.getByText(/08:00.*18:00/)).toBeInTheDocument();
  });

  test('editing an existing config pre-fills the form fields', async () => {
    useBusinessHoursConfig.mockReturnValue({
      config: { id: 'config-1', enabled: true, startTime: '09:00', endTime: '17:00', message: 'Texto do aviso' },
      loading: false,
      refresh: vi.fn(),
    });
    render(<MessagesAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /^editar$/i }));

    expect(screen.getByLabelText(/hora de início/i)).toHaveValue('09:00');
    expect(screen.getByLabelText(/hora de fim/i)).toHaveValue('17:00');
    expect(screen.getByLabelText(/mensagem/i)).toHaveValue('Texto do aviso');
  });
});
```

Note: several other `describe` blocks in this file already use
`getByRole('button', { name: /^editar$/i })`/`/^salvar$/i`/`/^cancelar$/i` and render
`<MessagesAdminTab />` with every section mounted at once — these matchers are scoped to
whichever section's form is open at the time (only one form is open per test), matching
the existing file's established pattern (see the `'Atribuir um atendimento'` block
above), so no ambiguity is introduced.

- [ ] **Step 4: Run tests to verify they fail**

Run (from `frontend/`): `npx vitest run src/components/MessagesAdminTab.test.jsx`
Expected: FAIL — the new `'Horário de atendimento'` tests fail (button/labels not found)

- [ ] **Step 5: Write the implementation**

In `frontend/src/components/MessagesAdminTab.jsx`, add the import alongside the existing
hook imports:

```js
import { useBusinessHoursConfig } from '../hooks/useBusinessHoursConfig';
```

Add `updateBusinessHoursConfig` to the existing `services/api` import block (alongside
`updateAssignmentMessageConfig`):

```js
import {
  updateQuickReply,
  deleteQuickReply,
  setChannelWelcomeMessage,
  setCityNotice,
  deleteCityNotice,
  updateAssignmentMessageConfig,
  updateBusinessHoursConfig,
} from '../services/api';
```

Add a new `BusinessHoursSection` component, placed directly after the
`AssignmentMessageSection` function (before `MessagesAdminTab`):

```js
function BusinessHoursSection() {
  const { token } = useAuth();
  const { config: fetchedConfig, refresh } = useBusinessHoursConfig();
  const [editing, setEditing] = useState(false);
  const [savedConfig, setSavedConfig] = useState(null);
  const config = savedConfig || fetchedConfig;
  const [enabled, setEnabled] = useState(config.enabled);
  const [startTime, setStartTime] = useState(config.startTime);
  const [endTime, setEndTime] = useState(config.endTime);
  const [message, setMessage] = useState(config.message);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  function handleEditClick() {
    setEnabled(config.enabled);
    setStartTime(config.startTime);
    setEndTime(config.endTime);
    setMessage(config.message);
    setError(null);
    setEditing(true);
  }

  function handleCancel() {
    setEnabled(config.enabled);
    setStartTime(config.startTime);
    setEndTime(config.endTime);
    setMessage(config.message);
    setError(null);
    setEditing(false);
  }

  async function handleSave(event) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const saved = await updateBusinessHoursConfig({ enabled, startTime, endTime, message }, token);
      setSavedConfig(saved);
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
        className="space-y-3 rounded-2xl border border-wa-surface-line bg-wa-surface p-4 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)] backdrop-blur-xl"
      >
        <label className="flex items-center gap-2 text-sm text-wa-muted">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4 accent-wa-green" />
          Ativo
        </label>
        <div className="flex gap-3">
          <div className="space-y-1">
            <label htmlFor="business-hours-start" className="text-sm font-medium text-wa-text">
              Hora de início
            </label>
            <input
              id="business-hours-start"
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className={inputClass}
              required
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="business-hours-end" className="text-sm font-medium text-wa-text">
              Hora de fim
            </label>
            <input
              id="business-hours-end"
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className={inputClass}
              required
            />
          </div>
        </div>
        <div className="space-y-1">
          <label htmlFor="business-hours-message" className="text-sm font-medium text-wa-text">
            Mensagem
          </label>
          <textarea
            id="business-hours-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Nosso horário de atendimento é de segunda a sexta, das 08:00 às 18:00. Sua mensagem será respondida assim que possível."
            className={inputClass}
            required
          />
        </div>
        {error && <p className="rounded-lg border border-wa-error-text/30 bg-wa-error-bg px-3 py-2 text-sm text-wa-error-text">{error}</p>}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-wa-green px-3 py-1.5 text-sm font-medium text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Salvar
          </button>
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-lg border border-wa-border bg-wa-surface px-3 py-1.5 text-sm font-medium text-wa-muted transition hover:bg-wa-panel hover:text-wa-text"
          >
            Cancelar
          </button>
        </div>
      </form>
    );
  }

  if (config.id === null) {
    return (
      <div className="flex items-center justify-between rounded-2xl border border-wa-surface-line bg-wa-surface p-4 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)] backdrop-blur-xl">
        <p className="text-sm text-wa-muted">Nenhum horário configurado ainda.</p>
        <button onClick={handleEditClick} className="text-sm font-medium text-wa-link hover:text-wa-link/80 hover:underline">
          Criar horário de atendimento
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-wa-surface-line bg-wa-surface p-4 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)] backdrop-blur-xl">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-wa-muted">
          Das {config.startTime} às {config.endTime}, segunda a sexta
        </p>
        <div className="flex items-center gap-3">
          <CityStatusDot enabled={config.enabled} />
          <button onClick={handleEditClick} className="text-sm font-medium text-wa-link hover:text-wa-link/80 hover:underline">
            Editar
          </button>
        </div>
      </div>
    </div>
  );
}
```

Add the new section inside `MessagesAdminTab`'s returned JSX, right after the
"Atribuir um atendimento" section's closing `</div>` and before the "Respostas rápidas"
section:

```jsx
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="font-display text-lg font-semibold text-wa-text">Horário de atendimento</h2>
          <SectionHelp label="Horário de atendimento" title="Horário de atendimento">
            <p>
              Quando um cliente manda mensagem fora do horário configurado, ele recebe
              essa mensagem automaticamente, uma única vez por atendimento — em vez de
              ficar sem resposta até um atendente ver na volta. Vale de segunda a
              sexta, no mesmo horário todo dia; sábado e domingo são sempre
              considerados fora do expediente.
            </p>
            <p className="mt-2 italic">
              Exemplo: "Nosso horário de atendimento é de segunda a sexta, das 08:00 às
              18:00. Sua mensagem será respondida assim que possível."
            </p>
          </SectionHelp>
        </div>
        <BusinessHoursSection />
      </div>
```

- [ ] **Step 6: Run tests to verify they pass**

Run (from `frontend/`): `npx vitest run src/components/MessagesAdminTab.test.jsx`
Expected: PASS (full file, including all new and pre-existing tests)

- [ ] **Step 7: Run the full frontend suite**

Run (from `frontend/`): `npx vitest run`
Expected: PASS (all files)

- [ ] **Step 8: Commit**

```bash
git add frontend/src/services/api.js frontend/src/hooks/useBusinessHoursConfig.js frontend/src/components/MessagesAdminTab.jsx frontend/src/components/MessagesAdminTab.test.jsx
git commit -m "Add business hours admin UI (Horário de atendimento section)"
```

---

## Final Verification

After all 7 tasks are complete:

- [ ] Run the full backend suite: `npm test` (from the repo root) — expect all suites
      passing, including `admin-business-hours.routes.test.js`,
      `business-hours.repository.test.js`, `business-hours.service.test.js`,
      `conversation.repository.test.js`, `inbound-message.service.test.js`.
- [ ] Run the full frontend suite: `npx vitest run` (from `frontend/`) — expect all
      files passing, including the updated `MessagesAdminTab.test.jsx`.
- [ ] Confirm the migration ran on both `dw_whatsapp_dev` and `dw_whatsapp_test`
      (Task 1, Steps 2–3) — this is the same category of deploy-order risk documented
      for `[[project_agent_profile]]` and `[[project_contact_internal_note]]`: the
      migration must run in production **before or with** the deploy that ships this
      code, since `conversation.repository.js` immediately starts selecting the new
      column.
