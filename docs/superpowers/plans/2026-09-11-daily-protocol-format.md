# Daily Protocol Format (AAAAMMDD-XXXX) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the plain-integer conversation protocol number with a daily-resetting
`AAAAMMDD-XXXX` format (e.g. `20260911-0001`), while leaving every protocol already
issued to a real customer untouched.

**Architecture:** A new `protocol_counters` table (one row per calendar day, in
América/São_Paulo) backs an atomic `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`
increment. `conversations.protocol_number` moves from `INTEGER` to `TEXT` so it can hold
both the old plain-integer values and the new `AAAAMMDD-XXXX` strings side by side,
forever. `claimProtocolNumber` (the single place that generates a protocol today) is the
only production function that changes; every other consumer already treats the value as
an opaque string.

**Tech Stack:** Node.js/Express, PostgreSQL (node-pg-migrate), Jest + real Postgres for
repository tests, React/Vite + Vitest for the frontend.

**Spec:** `docs/superpowers/specs/2026-09-11-daily-protocol-format-design.md`

## Global Constraints

- No new date/timezone library — use the native `Intl.DateTimeFormat`, same as
  `[[project_business_hours_auto_reply]]`'s `getSaoPauloParts`.
- The date segment of the protocol is always computed in the fixed timezone
  `America/Sao_Paulo`, never server-local time (Render runs in UTC).
- Protocols already issued (plain integers, e.g. `"1042"`) are never rewritten or
  backfilled — they keep displaying and matching exactly as they are today.
- `conversations.protocol_number` is `TEXT` after this plan — no code anywhere may treat
  it as a number (no `Number(...)`, no `::int` cast, no numeric comparison).
- The 4-digit sequence has no hard ceiling — beyond `9999` it grows to 5+ digits
  (`-10000`, `-10001`, ...) instead of failing or wrapping.
- All new SQL is idempotent (`IF NOT EXISTS`/`IF EXISTS`), matching every prior migration
  in `migrations/`.

---

## Task 1: Migration — `protocol_counters` table and `protocol_number` → TEXT

**Files:**
- Create: `migrations/1788940000000_add-daily-protocol-format.js`
- Modify: `src/conversations/conversation.repository.test.js:315,331,346`

**Interfaces:**
- Produces: table `protocol_counters(day DATE PRIMARY KEY, last_seq INTEGER NOT NULL DEFAULT 0)`;
  `conversations.protocol_number` becomes `TEXT` (was `INTEGER`). Task 2 depends on both.

This task only touches schema. The three lines in `conversation.repository.test.js` are
included here (not in a later task) because they break the moment the column type
changes — before any new generation logic exists — since Postgres has no implicit
assignment cast from an integer literal to a `text` column.

- [ ] **Step 1: Write the migration**

Create `migrations/1788940000000_add-daily-protocol-format.js`:

```js
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS protocol_counters (
      day DATE PRIMARY KEY,
      last_seq INTEGER NOT NULL DEFAULT 0
    );
  `);
  pgm.sql(`ALTER TABLE conversations ALTER COLUMN protocol_number TYPE TEXT USING protocol_number::TEXT;`);
};

exports.down = (pgm) => {
  // Best-effort revert: fails if any row already holds a non-numeric "AAAAMMDD-XXXX"
  // value, which is expected and acceptable once the new format is in production use.
  pgm.sql(`ALTER TABLE conversations ALTER COLUMN protocol_number TYPE INTEGER USING protocol_number::INTEGER;`);
  pgm.sql(`DROP TABLE IF EXISTS protocol_counters;`);
};
```

- [ ] **Step 2: Update the three raw-SQL literals in `conversation.repository.test.js` that assign an integer into `protocol_number`**

In `src/conversations/conversation.repository.test.js`, change:

```js
    await getPool().query('UPDATE conversations SET protocol_number = 42 WHERE id = $1', [conversation.id]);
```
to:
```js
    await getPool().query("UPDATE conversations SET protocol_number = '42' WHERE id = $1", [conversation.id]);
```

and the two occurrences of:

```js
    await getPool().query('UPDATE conversations SET protocol_number = 1042 WHERE id = $1', [conversation.id]);
```
to:
```js
    await getPool().query("UPDATE conversations SET protocol_number = '1042' WHERE id = $1", [conversation.id]);
```

Also update the assertions that compare against the numeric literal so they compare
against the string instead — in the same file:

```js
    expect(closed.protocolNumber).toBe(42);
```
→
```js
    expect(closed.protocolNumber).toBe('42');
```

```js
    expect(result.protocolNumber).toBe(1042);
```
(this appears once, in the `'getConversationWithContact includes the protocol number
when one has been claimed'` test) →
```js
    expect(result.protocolNumber).toBe('1042');
```

And the call in `findConversationByProtocolNumber`'s own test (a different test further
down the file, whose two `UPDATE`/assertion lines are separate from the one above even
though both use the literal `1042`):

```js
    const result = await findConversationByProtocolNumber(1042);
```
→
```js
    const result = await findConversationByProtocolNumber('1042');
```

- [ ] **Step 3: Run the affected test file to confirm the schema change and the test fixes are consistent**

Run: `npm test -- conversation.repository.test.js`
Expected: PASS (the `pretest` script runs `node-pg-migrate up` against the test database
first, applying the new migration automatically).

- [ ] **Step 4: Run the full backend suite once to confirm nothing else broke from the column type change**

Run: `npm test`
Expected: PASS. (If anything outside the two files above fails because it assigns a raw
integer literal into `protocol_number`, that is a gap this plan's investigation missed —
fix it the same way: quote the literal as a string.)

- [ ] **Step 5: Commit**

```bash
git add migrations/1788940000000_add-daily-protocol-format.js src/conversations/conversation.repository.test.js
git commit -m "Add protocol_counters table and widen protocol_number to TEXT"
```

---

## Task 2: Daily-resetting protocol generation in `assignment-message.repository.js`

**Files:**
- Modify: `src/assignment-messages/assignment-message.repository.js`
- Modify: `src/assignment-messages/assignment-message.repository.test.js`

**Interfaces:**
- Consumes: `protocol_counters` table and `conversations.protocol_number TEXT` from Task 1.
- Produces: `todaySaoPauloDateString(date = new Date())` → string `"AAAAMMDD"`, newly
  exported from the module. `claimProtocolNumber(conversationId)` now resolves to a
  string like `"20260911-0001"` instead of a number — same call signature, same
  idempotent-per-conversation behavior, consumed unchanged by
  `assignment-message.service.js` (which only ever does `String(protocolNumber)`, so no
  change needed there).

- [ ] **Step 1: Write the failing tests for `todaySaoPauloDateString`**

In `src/assignment-messages/assignment-message.repository.test.js`, add this import
alongside the existing one:

```js
const {
  getAssignmentMessageConfig,
  upsertAssignmentMessageConfig,
  claimProtocolNumber,
  clearProtocolNumber,
  todaySaoPauloDateString,
} = require('./assignment-message.repository');
```

Add a new top-level `describe` block (this one doesn't touch the database, so it can sit
outside the existing `beforeEach`/`afterAll` block — add it as a sibling `describe` in
the same file, after the closing `});` of `describe('assignment message repository', ...)`):

```js
describe('todaySaoPauloDateString', () => {
  test('returns AAAAMMDD for a time comfortably inside the São Paulo day', () => {
    expect(todaySaoPauloDateString(new Date('2026-09-11T15:00:00.000Z'))).toBe('20260911');
  });

  test('uses the São Paulo day, not the UTC day, right after UTC midnight', () => {
    // 2026-09-11T02:30:00.000Z is 2026-09-10T23:30:00 in São Paulo (UTC-3, no DST).
    expect(todaySaoPauloDateString(new Date('2026-09-11T02:30:00.000Z'))).toBe('20260910');
  });
});
```

- [ ] **Step 2: Run the new tests to confirm they fail**

Run: `npm test -- assignment-message.repository.test.js -t "todaySaoPauloDateString"`
Expected: FAIL with "todaySaoPauloDateString is not a function" (it isn't exported yet).

- [ ] **Step 3: Implement `todaySaoPauloDateString` and the atomic per-day counter, and rewrite `claimProtocolNumber`**

In `src/assignment-messages/assignment-message.repository.js`, add this above
`claimProtocolNumber` (which gets replaced):

```js
const PROTOCOL_TIMEZONE = 'America/Sao_Paulo';

function todaySaoPauloDateString(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: PROTOCOL_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  // en-CA formats as YYYY-MM-DD; strip the dashes for the AAAAMMDD segment.
  return formatter.format(date).replace(/-/g, '');
}

async function nextProtocolSequenceForToday() {
  const day = todaySaoPauloDateString();
  const result = await getPool().query(
    `INSERT INTO protocol_counters (day, last_seq) VALUES ($1, 1)
     ON CONFLICT (day) DO UPDATE SET last_seq = protocol_counters.last_seq + 1
     RETURNING last_seq`,
    [day]
  );
  return `${day}-${String(result.rows[0].last_seq).padStart(4, '0')}`;
}

async function claimProtocolNumber(conversationId) {
  const candidate = await nextProtocolSequenceForToday();
  const result = await getPool().query(
    `UPDATE conversations
     SET protocol_number = COALESCE(protocol_number, $2)
     WHERE id = $1
     RETURNING protocol_number`,
    [conversationId, candidate]
  );
  return result.rows[0].protocol_number;
}
```

This fully replaces the previous body of `claimProtocolNumber` (which used
`nextval('assignment_protocol_seq')` inside the `UPDATE` itself — that whole approach is
gone; the sequence value is now computed in JS beforehand). `clearProtocolNumber` is
unchanged.

Update the module's exports to include the new function needed by tests:

```js
module.exports = {
  getAssignmentMessageConfig,
  upsertAssignmentMessageConfig,
  claimProtocolNumber,
  clearProtocolNumber,
  todaySaoPauloDateString,
};
```

- [ ] **Step 4: Run the `todaySaoPauloDateString` tests again to confirm they pass**

Run: `npm test -- assignment-message.repository.test.js -t "todaySaoPauloDateString"`
Expected: PASS.

- [ ] **Step 5: Update the existing `claimProtocolNumber` tests for the new string format**

In the same file, replace this test:

```js
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
```

with:

```js
  test('claimProtocolNumber generates an AAAAMMDD-XXXX protocol on the first call for a conversation', async () => {
    const contact = await findOrCreateContactByPhoneNumber('+5511977776666', 'Joao');
    const channel = await createChannel({
      type: 'meta_cloud',
      name: 'Canal Teste',
      phoneNumber: '+5511999990009',
      config: { phoneNumberId: '111', accessToken: 'tok' },
    });
    const conversation = await createConversation(contact.id, channel.id);

    const protocolNumber = await claimProtocolNumber(conversation.id);
    expect(protocolNumber).toMatch(/^\d{8}-\d{4,}$/);
    expect(protocolNumber.startsWith(todaySaoPauloDateString())).toBe(true);
  });
```

The next test (`'claimProtocolNumber reuses the same number on a second call for the
same conversation'`) needs no change — `expect(second).toBe(first)` is format-agnostic.

Replace the "assigns different numbers" test:

```js
  test('claimProtocolNumber assigns different numbers to different conversations', async () => {
    const contact = await findOrCreateContactByPhoneNumber('+5511977776666', 'Joao');
    const otherContact = await findOrCreateContactByPhoneNumber('+5511977775555', 'Segunda Pessoa');
    const channel = await createChannel({
      type: 'meta_cloud',
      name: 'Canal Teste',
      phoneNumber: '+5511999990009',
      config: { phoneNumberId: '111', accessToken: 'tok' },
    });
    const conversationA = await createConversation(contact.id, channel.id);
    const conversationB = await createConversation(otherContact.id, channel.id);

    const numberA = await claimProtocolNumber(conversationA.id);
    const numberB = await claimProtocolNumber(conversationB.id);
    expect(numberA).not.toBe(numberB);
  });
```

with a version that also asserts the two sequences are consecutive (proving the atomic
per-day counter, not just "any two different values"):

```js
  test('claimProtocolNumber assigns consecutive sequence numbers to different conversations claimed the same day', async () => {
    const contact = await findOrCreateContactByPhoneNumber('+5511977776666', 'Joao');
    const otherContact = await findOrCreateContactByPhoneNumber('+5511977775555', 'Segunda Pessoa');
    const channel = await createChannel({
      type: 'meta_cloud',
      name: 'Canal Teste',
      phoneNumber: '+5511999990009',
      config: { phoneNumberId: '111', accessToken: 'tok' },
    });
    const conversationA = await createConversation(contact.id, channel.id);
    const conversationB = await createConversation(otherContact.id, channel.id);

    const numberA = await claimProtocolNumber(conversationA.id);
    const numberB = await claimProtocolNumber(conversationB.id);

    const seqA = Number(numberA.split('-')[1]);
    const seqB = Number(numberB.split('-')[1]);
    expect(seqB).toBe(seqA + 1);
  });
```

`clearProtocolNumber`'s existing test needs no change — it only checks the column is
`NULL` afterward, independent of format.

- [ ] **Step 6: Run the full file to confirm everything passes**

Run: `npm test -- assignment-message.repository.test.js`
Expected: PASS, all tests green.

- [ ] **Step 7: Commit**

```bash
git add src/assignment-messages/assignment-message.repository.js src/assignment-messages/assignment-message.repository.test.js
git commit -m "Generate daily-resetting AAAAMMDD-XXXX protocol numbers"
```

---

## Task 3: Admin search by protocol accepts both formats

**Files:**
- Modify: `src/api/admin-dashboard.routes.js:42,48`
- Modify: `src/api/admin-dashboard.routes.test.js:131,138,139`

**Interfaces:**
- Consumes: `findConversationByProtocolNumber(protocolNumber)` from
  `conversation.repository.js` — unchanged signature, now always called with a string.

- [ ] **Step 1: Update the existing test's mock value and add a new-format case**

In `src/api/admin-dashboard.routes.test.js`, change:

```js
  test('returns the conversation with that protocol number', async () => {
    findConversationByProtocolNumber.mockResolvedValue({ id: 'conv-1', protocolNumber: 1042 });

    const res = await request(buildApp())
      .get('/api/admin/dashboard/conversations/by-protocol/1042')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);

    expect(res.status).toBe(200);
    expect(findConversationByProtocolNumber).toHaveBeenCalledWith(1042);
    expect(res.body).toEqual({ id: 'conv-1', protocolNumber: 1042 });
  });
```

to:

```js
  test('returns the conversation with that protocol number (legacy plain-integer format)', async () => {
    findConversationByProtocolNumber.mockResolvedValue({ id: 'conv-1', protocolNumber: '1042' });

    const res = await request(buildApp())
      .get('/api/admin/dashboard/conversations/by-protocol/1042')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);

    expect(res.status).toBe(200);
    expect(findConversationByProtocolNumber).toHaveBeenCalledWith('1042');
    expect(res.body).toEqual({ id: 'conv-1', protocolNumber: '1042' });
  });

  test('returns the conversation with that protocol number (new AAAAMMDD-XXXX format)', async () => {
    findConversationByProtocolNumber.mockResolvedValue({ id: 'conv-2', protocolNumber: '20260911-0001' });

    const res = await request(buildApp())
      .get('/api/admin/dashboard/conversations/by-protocol/20260911-0001')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);

    expect(res.status).toBe(200);
    expect(findConversationByProtocolNumber).toHaveBeenCalledWith('20260911-0001');
    expect(res.body).toEqual({ id: 'conv-2', protocolNumber: '20260911-0001' });
  });
```

The two tests below it (`'returns 404 when no conversation has that protocol number'` and
`'returns 403 for a non-admin agent'`) need no change. The `'returns 400 when
protocolNumber is not a positive integer'` test (using `not-a-number`) also needs no
change — that string still matches neither branch of the new pattern.

- [ ] **Step 2: Run the tests to confirm the new-format case fails**

Run: `npm test -- admin-dashboard.routes.test.js -t "by-protocol"`
Expected: FAIL on the new "AAAAMMDD-XXXX format" test — the route's regex rejects the
hyphen and returns 400 instead of 200.

- [ ] **Step 3: Update the route**

In `src/api/admin-dashboard.routes.js`, change:

```js
const PROTOCOL_NUMBER_PATTERN = /^\d+$/;

router.get('/conversations/by-protocol/:protocolNumber', requireAuth, requireRole('admin'), async (req, res) => {
  if (!PROTOCOL_NUMBER_PATTERN.test(req.params.protocolNumber)) {
    return res.status(400).json({ error: 'protocolNumber must be a positive integer' });
  }
  const conversation = await findConversationByProtocolNumber(Number(req.params.protocolNumber));
  if (!conversation) {
    return res.status(404).json({ error: 'No conversation found with that protocol number' });
  }
  res.json(conversation);
});
```

to:

```js
const PROTOCOL_NUMBER_PATTERN = /^(\d+|\d{8}-\d{4,})$/;

router.get('/conversations/by-protocol/:protocolNumber', requireAuth, requireRole('admin'), async (req, res) => {
  if (!PROTOCOL_NUMBER_PATTERN.test(req.params.protocolNumber)) {
    return res.status(400).json({ error: 'protocolNumber must be a valid protocol number' });
  }
  const conversation = await findConversationByProtocolNumber(req.params.protocolNumber);
  if (!conversation) {
    return res.status(404).json({ error: 'No conversation found with that protocol number' });
  }
  res.json(conversation);
});
```

- [ ] **Step 4: Run the tests again to confirm they pass**

Run: `npm test -- admin-dashboard.routes.test.js -t "by-protocol"`
Expected: PASS.

- [ ] **Step 5: Run the full backend suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/api/admin-dashboard.routes.js src/api/admin-dashboard.routes.test.js
git commit -m "Accept the AAAAMMDD-XXXX protocol format in the admin protocol search"
```

---

## Task 4: Frontend — protocol search field accepts the hyphen

**Files:**
- Modify: `frontend/src/pages/AttendanceDashboardPage.jsx:318`
- Modify: `frontend/src/pages/AttendanceDashboardPage.test.jsx`

**Interfaces:**
- Consumes: `getDashboardConversationByProtocol(query, token)` from
  `frontend/src/services/api.js` — unchanged, already forwards the raw string.

`inputMode="numeric"` hints mobile browsers to show a number-only keyboard, which has no
hyphen key — that would make the new format impossible to type by hand on a phone.
Everything else about the field (the `handleProtocolSearch` handler, the API call)
already passes the typed string through untouched, so no other frontend change is
needed.

- [ ] **Step 1: Write the failing test**

In `frontend/src/pages/AttendanceDashboardPage.test.jsx`, add this test right after the
existing `'searching by protocol number opens the matching conversation'` test:

```js
  test('searching by the new AAAAMMDD-XXXX protocol format opens the matching conversation', async () => {
    getDashboardConversationByProtocol.mockResolvedValue({
      id: 'conv-found-2',
      status: 'closed',
      protocolNumber: '20260911-0001',
      contactDisplayName: 'Cliente Novo',
      assignedAgentId: 'agent-1',
    });
    renderPage();

    await userEvent.type(screen.getByLabelText(/buscar por protocolo/i), '20260911-0001{Enter}');

    expect(getDashboardConversationByProtocol).toHaveBeenCalledWith('20260911-0001', 'tok-123');
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the new test to confirm it fails**

Run: `cd frontend && npx vitest run src/pages/AttendanceDashboardPage.test.jsx -t "AAAAMMDD-XXXX"`
Expected: This test actually already passes today, because `userEvent.type` can type a
`-` character into any `<input type="text">` regardless of `inputMode` (`inputMode` only
hints the on-screen virtual keyboard shown on real touch devices — it has no effect in
jsdom). This step exists to document the *why* precisely: run it, confirm it's green even
before Step 3, then proceed — the fix in Step 3 is a real-device mobile-keyboard concern
that this automated test cannot exercise, not a regression this suite can catch. Do not
skip Step 3 just because this test passed early.

- [ ] **Step 3: Change the input's `inputMode`**

In `frontend/src/pages/AttendanceDashboardPage.jsx`, change:

```jsx
          <input
            type="text"
            inputMode="numeric"
            value={protocolQuery}
            onChange={(e) => setProtocolQuery(e.target.value)}
            placeholder="Buscar por protocolo"
            aria-label="Buscar por protocolo"
            className="h-[38px] w-[170px] rounded-full border border-white/[0.12] bg-white/[0.06] px-4 text-[14px] text-chat-text outline-none placeholder:text-chat-muted focus:border-white/25"
          />
```

to:

```jsx
          <input
            type="text"
            value={protocolQuery}
            onChange={(e) => setProtocolQuery(e.target.value)}
            placeholder="Buscar por protocolo"
            aria-label="Buscar por protocolo"
            className="h-[38px] w-[170px] rounded-full border border-white/[0.12] bg-white/[0.06] px-4 text-[14px] text-chat-text outline-none placeholder:text-chat-muted focus:border-white/25"
          />
```

(just removing the `inputMode="numeric"` attribute — with no `inputMode` set, the
browser falls back to its default text keyboard, which has a hyphen key).

- [ ] **Step 4: Run the full frontend test file to confirm nothing regressed**

Run: `cd frontend && npx vitest run src/pages/AttendanceDashboardPage.test.jsx`
Expected: PASS, all tests green (including the two pre-existing protocol-search tests).

- [ ] **Step 5: Run the full frontend suite**

Run: `cd frontend && npx vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/AttendanceDashboardPage.jsx frontend/src/pages/AttendanceDashboardPage.test.jsx
git commit -m "Allow typing the hyphenated AAAAMMDD-XXXX protocol format on mobile"
```

---

## Final verification (after all 4 tasks)

- [ ] Run `npm test` (backend) — full suite green.
- [ ] Run `cd frontend && npx vitest run` — full suite green.
- [ ] Manually confirm (via `psql` or the Render dashboard once deployed) that
  `\d conversations` shows `protocol_number` as `text`, and that
  `SELECT protocol_number FROM conversations WHERE protocol_number IS NOT NULL LIMIT 5;`
  still returns any pre-existing plain-integer values unchanged.
