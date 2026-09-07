# Meta Cloud Templates & Conversation Initiation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin create and track Meta-approved WhatsApp message templates from this system's own admin UI, and let an attendant start a brand-new conversation on a Meta Cloud channel using one of those approved templates (the only legal way to message a customer outside the 24-hour window on WhatsApp's official API).

**Architecture:** A new `message_templates` table plus a `wabaId` key added to each `meta_cloud` channel's existing JSONB `config` (a WABA can hold several phone numbers, and a template belongs to the WABA, not to one number). A new `src/templates/` module (repository + service + pure validator) orchestrates creation/deletion/sync against Meta's Graph API via new functions added to the existing `meta-cloud.adapter.js`. Approval status updates arrive on the existing Meta webhook. `POST /api/conversations/start` gains a second path for `meta_cloud` channels that requires an approved template instead of free text.

**Tech Stack:** Node.js/Express, PostgreSQL (`node-pg-migrate`), `axios` (already a dependency, used by `meta-cloud.adapter.js`), Bull (outbound queue), Jest (backend), React + Vite + Tailwind CSS, Vitest (frontend).

**Spec:** `docs/superpowers/specs/2026-09-06-meta-templates-design.md` (extends `docs/superpowers/specs/2026-09-04-whatsapp-attendance-system-design.md` and `docs/superpowers/specs/2026-09-06-attendant-initiated-conversations-design.md`)

## Global Constraints

- Template content in v1 is **body-only text with positional variables** (`{{1}}`, `{{2}}`, ...) — no header, footer, media, or buttons.
- Only two categories are offered: `MARKETING`, `UTILITY`. Never `AUTHENTICATION`.
- Template names must match Meta's own rule: lowercase letters, digits, and underscores only (`^[a-z0-9_]+$`).
- Variables must be sequential starting at `{{1}}` with no gaps (Meta rejects gaps); the same variable number may repeat.
- Templates cannot be edited once created — only created or deleted, matching a real limitation of Meta's API (never build an edit endpoint or UI for this).
- `status` on a template is one of exactly 5 values: `PENDING`, `APPROVED`, `REJECTED`, `PAUSED`, `DISABLED`. Any other value coming from Meta (webhook or sync) must be logged and ignored, never written to the database.
- A template can only be used to start a conversation on a channel whose `config.wabaId` matches the template's `waba_id` — never allow cross-WABA use.
- `POST /api/conversations/start` on a `meta_cloud` channel must always require an approved template; it must never accept free text for `meta_cloud` (Baileys keeps working exactly as it does today, unchanged).
- Every Graph API call this plan adds must reuse the exact `https://graph.facebook.com/v20.0/...` base URL and `Authorization: Bearer <accessToken>` header convention already used by `sendTextMessage`/`sendMediaMessage`/`downloadMetaMedia` in `src/whatsapp-adapters/meta-cloud.adapter.js` — do not introduce a second HTTP client or a different API version.
- Every new migration must be reversible (`up` then `down` then `up` again, verified by running it both ways) and production-safe (no new `NOT NULL` column without a default on an existing table with rows).

---

### Task 1: Template data layer — migration, validator, repository

**Files:**
- Create: `migrations/1788750000000_create-message-templates-table.js`
- Create: `src/templates/template-validator.js`
- Create: `src/templates/template-validator.test.js`
- Create: `src/templates/template.repository.js`
- Create: `src/templates/template.repository.test.js`

**Interfaces:**
- Produces: `isValidTemplateName(name)`, `extractVariableCount(bodyText)` (throws `Error` on non-sequential variables), `substituteVariables(bodyText, variables)` from `template-validator.js`.
- Produces: `listTemplates()`, `listApprovedTemplatesByWabaId(wabaId)`, `findTemplateById(id)`, `findTemplateByMetaTemplateId(metaTemplateId)`, `createTemplateRecord({wabaId, metaTemplateId, name, language, category, bodyText, variableCount})`, `updateTemplateStatusByMetaTemplateId(metaTemplateId, {status, rejectionReason})`, `deleteTemplateRecord(id)` from `template.repository.js`. Every returned template object has shape `{id, wabaId, metaTemplateId, name, language, category, bodyText, variableCount, status, rejectionReason, createdAt}`.

- [ ] **Step 1: Write the migration**

```js
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE message_templates (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      waba_id TEXT NOT NULL,
      meta_template_id TEXT NOT NULL,
      name TEXT NOT NULL,
      language TEXT NOT NULL,
      category TEXT NOT NULL CHECK (category IN ('MARKETING', 'UTILITY')),
      body_text TEXT NOT NULL,
      variable_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'PAUSED', 'DISABLED')),
      rejection_reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (waba_id, name, language)
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE message_templates;
  `);
};
```

- [ ] **Step 2: Run the migration up, then down, then up again to confirm reversibility**

Run: `npm run migrate -- up` then `npm run migrate -- down` then `npm run migrate -- up` (against the `.env.test` database — check `package.json`'s `migrate` script; it already targets whichever `DATABASE_URL` is active, matching how every prior migration in this project was verified).
Expected: all three succeed with no errors.

- [ ] **Step 3: Write the failing validator tests**

```js
const { isValidTemplateName, extractVariableCount, substituteVariables } = require('./template-validator');

describe('isValidTemplateName', () => {
  test('accepts lowercase letters, digits, and underscores', () => {
    expect(isValidTemplateName('fatura_vencida_2')).toBe(true);
  });

  test('rejects uppercase letters', () => {
    expect(isValidTemplateName('FaturaVencida')).toBe(false);
  });

  test('rejects spaces and hyphens', () => {
    expect(isValidTemplateName('fatura vencida')).toBe(false);
    expect(isValidTemplateName('fatura-vencida')).toBe(false);
  });

  test('rejects a non-string value', () => {
    expect(isValidTemplateName(null)).toBe(false);
    expect(isValidTemplateName(undefined)).toBe(false);
  });
});

describe('extractVariableCount', () => {
  test('returns 0 for a body with no variables', () => {
    expect(extractVariableCount('Sua fatura está disponível.')).toBe(0);
  });

  test('counts sequential variables starting at {{1}}', () => {
    expect(extractVariableCount('Olá {{1}}, sua fatura de {{2}} venceu em {{3}}.')).toBe(3);
  });

  test('deduplicates a variable that repeats in the body', () => {
    expect(extractVariableCount('Olá {{1}}, {{1}} sua fatura venceu.')).toBe(1);
  });

  test('throws when variables have a gap', () => {
    expect(() => extractVariableCount('Olá {{1}}, veja {{3}}.')).toThrow(
      'Template variables must be sequential starting at {{1}} with no gaps'
    );
  });

  test('throws when the first variable is not {{1}}', () => {
    expect(() => extractVariableCount('Veja {{2}}.')).toThrow(
      'Template variables must be sequential starting at {{1}} with no gaps'
    );
  });
});

describe('substituteVariables', () => {
  test('replaces each placeholder with its matching value', () => {
    const result = substituteVariables('Olá {{1}}, sua fatura de {{2}} venceu.', ['João', 'R$150,00']);
    expect(result).toBe('Olá João, sua fatura de R$150,00 venceu.');
  });

  test('replaces a repeated placeholder with the same value every time it appears', () => {
    const result = substituteVariables('{{1}}, {{1}}!', ['Oi']);
    expect(result).toBe('Oi, Oi!');
  });

  test('leaves the placeholder untouched when no matching value was given', () => {
    const result = substituteVariables('Olá {{1}}.', []);
    expect(result).toBe('Olá {{1}}.');
  });

  test('returns the body unchanged when it has no placeholders', () => {
    expect(substituteVariables('Sem variáveis aqui.', [])).toBe('Sem variáveis aqui.');
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npm test -- template-validator.test.js`
Expected: FAIL with "Cannot find module './template-validator'"

- [ ] **Step 5: Implement the validator**

```js
const NAME_PATTERN = /^[a-z0-9_]+$/;

function isValidTemplateName(name) {
  return typeof name === 'string' && NAME_PATTERN.test(name);
}

function extractVariableCount(bodyText) {
  const matches = [...bodyText.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
  if (matches.length === 0) return 0;
  const uniqueSorted = [...new Set(matches)].sort((a, b) => a - b);
  for (let i = 0; i < uniqueSorted.length; i += 1) {
    if (uniqueSorted[i] !== i + 1) {
      throw new Error('Template variables must be sequential starting at {{1}} with no gaps');
    }
  }
  return uniqueSorted.length;
}

function substituteVariables(bodyText, variables) {
  return bodyText.replace(/\{\{(\d+)\}\}/g, (match, indexStr) => {
    const index = Number(indexStr) - 1;
    return variables[index] != null ? String(variables[index]) : match;
  });
}

module.exports = { isValidTemplateName, extractVariableCount, substituteVariables };
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -- template-validator.test.js`
Expected: PASS, all 13 tests green.

- [ ] **Step 7: Commit**

```bash
git add migrations/1788750000000_create-message-templates-table.js src/templates/template-validator.js src/templates/template-validator.test.js
git commit -m "feat: add message_templates table and template validation helpers"
```

- [ ] **Step 8: Write the failing repository tests**

This project's repository tests always run against the real `.env.test` Postgres database, never a mock — `src/triage/triage.repository.test.js` is the exact convention to mirror: import `closePool` alongside `getPool` from `../db/pool`, and tear down with `afterAll(async () => { await closePool(); });`, never `getPool().end()` directly (that leaves the module's cached pool singleton pointing at a closed connection for anything else that calls `getPool()` afterward in the same test file).

```js
const { getPool, closePool } = require('../db/pool');
const {
  listTemplates,
  listApprovedTemplatesByWabaId,
  findTemplateById,
  findTemplateByMetaTemplateId,
  createTemplateRecord,
  updateTemplateStatusByMetaTemplateId,
  deleteTemplateRecord,
} = require('./template.repository');

beforeEach(async () => {
  await getPool().query('TRUNCATE message_templates');
});

afterAll(async () => {
  await closePool();
});

describe('createTemplateRecord', () => {
  test('creates a template with status PENDING and the given fields', async () => {
    const template = await createTemplateRecord({
      wabaId: 'waba-1',
      metaTemplateId: 'meta-tpl-1',
      name: 'fatura_vencida',
      language: 'pt_BR',
      category: 'UTILITY',
      bodyText: 'Olá {{1}}, sua fatura de {{2}} venceu.',
      variableCount: 2,
    });

    expect(template).toEqual({
      id: expect.any(String),
      wabaId: 'waba-1',
      metaTemplateId: 'meta-tpl-1',
      name: 'fatura_vencida',
      language: 'pt_BR',
      category: 'UTILITY',
      bodyText: 'Olá {{1}}, sua fatura de {{2}} venceu.',
      variableCount: 2,
      status: 'PENDING',
      rejectionReason: null,
      createdAt: expect.any(Date),
    });
  });

  test('rejects a duplicate (wabaId, name, language) combination', async () => {
    await createTemplateRecord({
      wabaId: 'waba-1', metaTemplateId: 'meta-tpl-1', name: 'fatura_vencida', language: 'pt_BR',
      category: 'UTILITY', bodyText: 'Corpo', variableCount: 0,
    });
    await expect(
      createTemplateRecord({
        wabaId: 'waba-1', metaTemplateId: 'meta-tpl-2', name: 'fatura_vencida', language: 'pt_BR',
        category: 'UTILITY', bodyText: 'Outro corpo', variableCount: 0,
      })
    ).rejects.toMatchObject({ code: '23505' });
  });
});

describe('listTemplates and listApprovedTemplatesByWabaId', () => {
  test('listTemplates returns every template regardless of status, newest first', async () => {
    const first = await createTemplateRecord({
      wabaId: 'waba-1', metaTemplateId: 'meta-1', name: 'a', language: 'pt_BR', category: 'UTILITY', bodyText: 'A', variableCount: 0,
    });
    const second = await createTemplateRecord({
      wabaId: 'waba-1', metaTemplateId: 'meta-2', name: 'b', language: 'pt_BR', category: 'MARKETING', bodyText: 'B', variableCount: 0,
    });
    const all = await listTemplates();
    expect(all.map((t) => t.id)).toEqual([second.id, first.id]);
  });

  test('listApprovedTemplatesByWabaId only returns APPROVED templates for that WABA', async () => {
    const approved = await createTemplateRecord({
      wabaId: 'waba-1', metaTemplateId: 'meta-1', name: 'approved_one', language: 'pt_BR', category: 'UTILITY', bodyText: 'A', variableCount: 0,
    });
    await updateTemplateStatusByMetaTemplateId('meta-1', { status: 'APPROVED', rejectionReason: null });
    await createTemplateRecord({
      wabaId: 'waba-1', metaTemplateId: 'meta-2', name: 'pending_one', language: 'pt_BR', category: 'UTILITY', bodyText: 'B', variableCount: 0,
    });
    await createTemplateRecord({
      wabaId: 'waba-2', metaTemplateId: 'meta-3', name: 'other_waba_approved', language: 'pt_BR', category: 'UTILITY', bodyText: 'C', variableCount: 0,
    });
    await updateTemplateStatusByMetaTemplateId('meta-3', { status: 'APPROVED', rejectionReason: null });

    const result = await listApprovedTemplatesByWabaId('waba-1');
    expect(result.map((t) => t.id)).toEqual([approved.id]);
  });
});

describe('findTemplateById and findTemplateByMetaTemplateId', () => {
  test('findTemplateById returns null for a missing id', async () => {
    expect(await findTemplateById('00000000-0000-0000-0000-000000000000')).toBeNull();
  });

  test('findTemplateByMetaTemplateId finds a template by its Meta-assigned id', async () => {
    const created = await createTemplateRecord({
      wabaId: 'waba-1', metaTemplateId: 'meta-xyz', name: 'x', language: 'pt_BR', category: 'UTILITY', bodyText: 'X', variableCount: 0,
    });
    const found = await findTemplateByMetaTemplateId('meta-xyz');
    expect(found.id).toBe(created.id);
  });

  test('findTemplateByMetaTemplateId returns null when no template matches', async () => {
    expect(await findTemplateByMetaTemplateId('does-not-exist')).toBeNull();
  });
});

describe('updateTemplateStatusByMetaTemplateId', () => {
  test('updates status and rejection reason', async () => {
    await createTemplateRecord({
      wabaId: 'waba-1', metaTemplateId: 'meta-r1', name: 'r1', language: 'pt_BR', category: 'UTILITY', bodyText: 'R', variableCount: 0,
    });
    const updated = await updateTemplateStatusByMetaTemplateId('meta-r1', { status: 'REJECTED', rejectionReason: 'Sample content mismatch' });
    expect(updated.status).toBe('REJECTED');
    expect(updated.rejectionReason).toBe('Sample content mismatch');
  });

  test('returns null when no template matches the given metaTemplateId', async () => {
    expect(await updateTemplateStatusByMetaTemplateId('nope', { status: 'APPROVED', rejectionReason: null })).toBeNull();
  });
});

describe('deleteTemplateRecord', () => {
  test('deletes an existing template and returns true', async () => {
    const created = await createTemplateRecord({
      wabaId: 'waba-1', metaTemplateId: 'meta-d1', name: 'd1', language: 'pt_BR', category: 'UTILITY', bodyText: 'D', variableCount: 0,
    });
    expect(await deleteTemplateRecord(created.id)).toBe(true);
    expect(await findTemplateById(created.id)).toBeNull();
  });

  test('returns false when the id does not exist', async () => {
    expect(await deleteTemplateRecord('00000000-0000-0000-0000-000000000000')).toBe(false);
  });
});
```

- [ ] **Step 9: Run the tests to verify they fail**

Run: `npm test -- template.repository.test.js`
Expected: FAIL with "Cannot find module './template.repository'"

- [ ] **Step 10: Implement the repository**

```js
const { getPool } = require('../db/pool');

const COLUMNS = `id, waba_id, meta_template_id, name, language, category, body_text, variable_count, status, rejection_reason, created_at`;

function toTemplate(row) {
  return {
    id: row.id,
    wabaId: row.waba_id,
    metaTemplateId: row.meta_template_id,
    name: row.name,
    language: row.language,
    category: row.category,
    bodyText: row.body_text,
    variableCount: row.variable_count,
    status: row.status,
    rejectionReason: row.rejection_reason,
    createdAt: row.created_at,
  };
}

async function listTemplates() {
  const result = await getPool().query(`SELECT ${COLUMNS} FROM message_templates ORDER BY created_at DESC`);
  return result.rows.map(toTemplate);
}

async function listApprovedTemplatesByWabaId(wabaId) {
  const result = await getPool().query(
    `SELECT ${COLUMNS} FROM message_templates WHERE waba_id = $1 AND status = 'APPROVED' ORDER BY name ASC`,
    [wabaId]
  );
  return result.rows.map(toTemplate);
}

async function findTemplateById(id) {
  const result = await getPool().query(`SELECT ${COLUMNS} FROM message_templates WHERE id = $1`, [id]);
  if (result.rowCount === 0) return null;
  return toTemplate(result.rows[0]);
}

async function findTemplateByMetaTemplateId(metaTemplateId) {
  const result = await getPool().query(`SELECT ${COLUMNS} FROM message_templates WHERE meta_template_id = $1`, [metaTemplateId]);
  if (result.rowCount === 0) return null;
  return toTemplate(result.rows[0]);
}

async function createTemplateRecord({ wabaId, metaTemplateId, name, language, category, bodyText, variableCount }) {
  const result = await getPool().query(
    `INSERT INTO message_templates (waba_id, meta_template_id, name, language, category, body_text, variable_count)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${COLUMNS}`,
    [wabaId, metaTemplateId, name, language, category, bodyText, variableCount]
  );
  return toTemplate(result.rows[0]);
}

async function updateTemplateStatusByMetaTemplateId(metaTemplateId, { status, rejectionReason }) {
  const result = await getPool().query(
    `UPDATE message_templates SET status = $2, rejection_reason = $3, updated_at = now()
     WHERE meta_template_id = $1
     RETURNING ${COLUMNS}`,
    [metaTemplateId, status, rejectionReason || null]
  );
  if (result.rowCount === 0) return null;
  return toTemplate(result.rows[0]);
}

async function deleteTemplateRecord(id) {
  const result = await getPool().query('DELETE FROM message_templates WHERE id = $1', [id]);
  return result.rowCount > 0;
}

module.exports = {
  listTemplates,
  listApprovedTemplatesByWabaId,
  findTemplateById,
  findTemplateByMetaTemplateId,
  createTemplateRecord,
  updateTemplateStatusByMetaTemplateId,
  deleteTemplateRecord,
};
```

- [ ] **Step 11: Run the tests to verify they pass**

Run: `npm test -- template.repository.test.js`
Expected: PASS, all 10 tests green.

- [ ] **Step 12: Commit**

```bash
git add src/templates/template.repository.js src/templates/template.repository.test.js
git commit -m "feat: add message_templates repository"
```

---

### Task 2: Channel WABA support

**Files:**
- Modify: `src/channels/channel.repository.js`
- Modify: `src/channels/channel.repository.test.js`
- Modify: `src/api/admin-channels.routes.js`
- Modify: `src/api/admin-channels.routes.test.js`

**Interfaces:**
- Consumes: `toChannel` mapper pattern already in `channel.repository.js` (unchanged).
- Produces: `findChannelByWabaId(wabaId)` (returns a `meta_cloud` channel object or `null`), `updateChannelWabaId(id, wabaId)` (returns the updated channel object or `null` if `id` doesn't exist or isn't `meta_cloud`) — both added to `channel.repository.js`'s exports, used by Task 4's `template.service.js`.

- [ ] **Step 1: Write the failing repository tests**

Read the top of `src/channels/channel.repository.test.js` first for its existing `beforeEach`/`createChannel` helper usage, then append:

```js
describe('findChannelByWabaId', () => {
  test('finds a meta_cloud channel by its configured wabaId', async () => {
    const created = await createChannel({
      type: 'meta_cloud', name: 'Oficial', phoneNumber: '+5511999990000',
      config: { phoneNumberId: '1234567890', accessToken: 'tok', wabaId: 'waba-abc' },
    });
    const found = await findChannelByWabaId('waba-abc');
    expect(found.id).toBe(created.id);
  });

  test('returns null when no channel has that wabaId', async () => {
    expect(await findChannelByWabaId('does-not-exist')).toBeNull();
  });

  test('never matches a baileys channel', async () => {
    await createChannel({ type: 'baileys', name: 'Berg', phoneNumber: '+5511999991111', config: {} });
    expect(await findChannelByWabaId(undefined)).toBeNull();
  });
});

describe('updateChannelWabaId', () => {
  test('updates the wabaId of an existing meta_cloud channel', async () => {
    const created = await createChannel({
      type: 'meta_cloud', name: 'Oficial', phoneNumber: '+5511999992222',
      config: { phoneNumberId: '1234567890', accessToken: 'tok', wabaId: 'old-waba' },
    });
    const updated = await updateChannelWabaId(created.id, 'new-waba');
    expect(updated.config.wabaId).toBe('new-waba');
    expect(updated.config.phoneNumberId).toBe('1234567890');
  });

  test('returns null for a baileys channel', async () => {
    const created = await createChannel({ type: 'baileys', name: 'Berg', phoneNumber: '+5511999993333', config: {} });
    expect(await updateChannelWabaId(created.id, 'waba-x')).toBeNull();
  });

  test('returns null for a non-existent id', async () => {
    expect(await updateChannelWabaId('00000000-0000-0000-0000-000000000000', 'waba-x')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- channel.repository.test.js`
Expected: FAIL with "findChannelByWabaId is not a function"

- [ ] **Step 3: Implement the repository additions**

Add to `src/channels/channel.repository.js`, right after `findChannelByMetaPhoneNumberId`:

```js
async function findChannelByWabaId(wabaId) {
  const result = await getPool().query(
    `SELECT id, type, name, phone_number, config, status, triage_enabled, created_at FROM channels
     WHERE type = 'meta_cloud' AND config->>'wabaId' = $1
     LIMIT 1`,
    [wabaId]
  );
  if (result.rowCount === 0) return null;
  return toChannel(result.rows[0]);
}
```

Add right after `updateChannelTriageEnabled`:

```js
async function updateChannelWabaId(id, wabaId) {
  const result = await getPool().query(
    `UPDATE channels SET config = jsonb_set(config, '{wabaId}', to_jsonb($2::text)) WHERE id = $1 AND type = 'meta_cloud'
     RETURNING id, type, name, phone_number, config, status, triage_enabled, created_at`,
    [id, wabaId]
  );
  if (result.rowCount === 0) return null;
  return toChannel(result.rows[0]);
}
```

Add both to `module.exports`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- channel.repository.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/channels/channel.repository.js src/channels/channel.repository.test.js
git commit -m "feat: add wabaId lookup and update to channel repository"
```

- [ ] **Step 6: Update the two existing tests that create a meta_cloud channel without a wabaId**

Two existing tests in this file's `describe('POST /api/admin/channels', ...)` block send a `type: 'meta_cloud'` body with no `wabaId` and expect success — they will break once `wabaId` becomes required. Update both:

- `'creates a meta_cloud channel'`: add `wabaId: 'waba-1'` to the `.send({...})` payload, and add `wabaId: 'waba-1'` inside the `config` object in the `expect(createChannel).toHaveBeenCalledWith({...})` assertion.
- `'returns 409 when the phone number is already in use'`: add `wabaId: 'waba-1'` to its `.send({...})` payload (no assertion on `createChannel`'s call args here, so only the request body needs the addition).

Do not change any other existing test in this file.

- [ ] **Step 7: Write the failing admin-channels route tests**

Read `src/api/admin-channels.routes.test.js`'s existing `buildApp`/`tokenFor` helpers first (mirror `admin-triage.routes.test.js`'s pattern read during Task 1 if this file uses something different), then add:

```js
describe('POST /api/admin/channels (meta_cloud, wabaId required)', () => {
  test('returns 400 when wabaId is missing for a meta_cloud channel', async () => {
    const res = await request(buildApp())
      .post('/api/admin/channels')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ type: 'meta_cloud', name: 'Oficial', phoneNumber: '+5511999990000', phoneNumberId: '123', accessToken: 'tok' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/wabaId/);
  });

  test('creates the channel with wabaId stored in config when all fields are given', async () => {
    createChannel.mockResolvedValue({
      id: 'ch-1', type: 'meta_cloud', name: 'Oficial', phoneNumber: '+5511999990000',
      config: { phoneNumberId: '123', accessToken: 'tok', wabaId: 'waba-1' }, status: 'disconnected', triageEnabled: false,
    });
    const res = await request(buildApp())
      .post('/api/admin/channels')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ type: 'meta_cloud', name: 'Oficial', phoneNumber: '+5511999990000', phoneNumberId: '123', accessToken: 'tok', wabaId: 'waba-1' });
    expect(res.status).toBe(201);
    expect(createChannel).toHaveBeenCalledWith({
      type: 'meta_cloud', name: 'Oficial', phoneNumber: '+5511999990000',
      config: { phoneNumberId: '123', accessToken: 'tok', wabaId: 'waba-1' },
    });
  });
});

describe('GET /api/admin/channels (wabaId in response)', () => {
  test('includes wabaId for a meta_cloud channel and omits it for a baileys channel', async () => {
    listChannels.mockResolvedValue([
      { id: 'ch-1', type: 'meta_cloud', name: 'Oficial', phoneNumber: '+5511999990000', config: { wabaId: 'waba-1' }, status: 'disconnected', triageEnabled: false },
      { id: 'ch-2', type: 'baileys', name: 'Berg', phoneNumber: '+5511999991111', config: {}, status: 'connected', triageEnabled: false },
    ]);
    const res = await request(buildApp()).get('/api/admin/channels').set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`);
    expect(res.body[0].wabaId).toBe('waba-1');
    expect(res.body[1].wabaId).toBeUndefined();
  });
});

describe('PATCH /api/admin/channels/:id (wabaId)', () => {
  test('updates wabaId when given', async () => {
    updateChannelWabaId.mockResolvedValue({
      id: 'ch-1', type: 'meta_cloud', name: 'Oficial', phoneNumber: '+5511999990000',
      config: { phoneNumberId: '123', accessToken: 'tok', wabaId: 'new-waba' }, status: 'disconnected', triageEnabled: false,
    });
    const res = await request(buildApp())
      .patch('/api/admin/channels/ch-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ wabaId: 'new-waba' });
    expect(res.status).toBe(200);
    expect(res.body.wabaId).toBe('new-waba');
    expect(updateChannelWabaId).toHaveBeenCalledWith('ch-1', 'new-waba');
  });

  test('returns 400 when neither triageEnabled nor wabaId is given', async () => {
    const res = await request(buildApp())
      .patch('/api/admin/channels/ch-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({});
    expect(res.status).toBe(400);
  });

  test('returns 404 when updateChannelWabaId finds no matching meta_cloud channel', async () => {
    updateChannelWabaId.mockResolvedValue(null);
    const res = await request(buildApp())
      .patch('/api/admin/channels/ch-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ wabaId: 'new-waba' });
    expect(res.status).toBe(404);
  });
});
```

Add `createChannel`, `listChannels`, `updateChannelWabaId` to whatever this test file's existing `jest.mock('../channels/channel.repository')` destructure already imports (it must already mock this module for the existing `updateChannelTriageEnabled` tests — extend that same destructure, don't add a second mock call).

- [ ] **Step 8: Run the tests to verify they fail**

Run: `npm test -- admin-channels.routes.test.js`
Expected: FAIL — the two updated pre-existing tests fail with 400 (missing wabaId), and the new tests fail (wabaId validation and response field don't exist yet).

- [ ] **Step 9: Implement the route changes**

In `src/api/admin-channels.routes.js`, update the `require` line to add `updateChannelWabaId`:

```js
const { listChannels, createChannel, findChannelById, updateChannelTriageEnabled, updateChannelWabaId } = require('../channels/channel.repository');
```

Replace the `GET /` handler's response mapping:

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
      wabaId: channel.type === 'meta_cloud' ? channel.config.wabaId : undefined,
    }))
  );
});
```

Replace the `POST /` handler's `meta_cloud` branch:

```js
if (type === 'meta_cloud') {
  const { phoneNumberId, accessToken, wabaId } = req.body;
  if (!phoneNumberId || !accessToken || !wabaId) {
    return res.status(400).json({ error: 'phoneNumberId, accessToken and wabaId are required for meta_cloud channels' });
  }
  const channel = await createChannel({ type, name, phoneNumber, config: { phoneNumberId, accessToken, wabaId } });
  return res.status(201).json(channel);
}
```

Replace the whole `PATCH /:id` handler:

```js
router.patch('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const { triageEnabled, wabaId } = req.body || {};
  if (triageEnabled === undefined && wabaId === undefined) {
    return res.status(400).json({ error: 'triageEnabled or wabaId is required' });
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
  res.json({
    id: channel.id,
    type: channel.type,
    name: channel.name,
    phoneNumber: channel.phoneNumber,
    status: channel.status,
    triageEnabled: channel.triageEnabled,
    wabaId: channel.type === 'meta_cloud' ? channel.config.wabaId : undefined,
  });
});
```

- [ ] **Step 10: Run the tests to verify they pass, including pre-existing ones**

Run: `npm test -- admin-channels.routes.test.js`
Expected: PASS — including every pre-existing test in this file (the pre-existing triage-toggle tests must still pass unchanged, since a lone `{triageEnabled: true}` body still takes the exact same code path as before).

- [ ] **Step 11: Commit**

```bash
git add src/api/admin-channels.routes.js src/api/admin-channels.routes.test.js
git commit -m "feat: require and expose wabaId for meta_cloud channels"
```

---

### Task 3: Meta Graph API template functions

**Files:**
- Modify: `src/whatsapp-adapters/meta-cloud.adapter.js`
- Modify: `src/whatsapp-adapters/meta-cloud.adapter.test.js`

**Interfaces:**
- Consumes: nothing new — same `channel.config` shape (`phoneNumberId`, `accessToken`, and now `wabaId`) already used by `sendTextMessage`.
- Produces: `createMetaTemplate(channel, {name, category, language, bodyText})` → `{metaTemplateId, status}`; `listMetaTemplates(channel)` → array of `{id, name, language, category, status}` (Meta's raw shape); `deleteMetaTemplate(channel, {name, metaTemplateId})` → resolves with no return value; `sendTemplateMessage(channel, toPhoneNumber, {name, language, variables})` → `{whatsappMessageId}`; `parseTemplateStatusUpdates(webhookBody)` → array of `{metaTemplateId, event, reason}`. All added to `meta-cloud.adapter.js`'s exports, consumed by Task 4's `template.service.js` and Task 7's `outbound-worker.js`.

- [ ] **Step 1: Write the failing adapter tests**

Append to `src/whatsapp-adapters/meta-cloud.adapter.test.js`, after the existing `sendMediaMessage` describe block (reuse the file's existing `jest.mock('axios')`/`const axios = require('axios')` already declared mid-file — do not add a second `jest.mock('axios')` call):

```js
const { createMetaTemplate, listMetaTemplates, deleteMetaTemplate, sendTemplateMessage, parseTemplateStatusUpdates } = require('./meta-cloud.adapter');

describe('createMetaTemplate', () => {
  test('posts the template to the Graph API and returns its id and status', async () => {
    axios.post.mockResolvedValue({ data: { id: 'meta-tpl-1', status: 'PENDING' } });
    const channel = { config: { accessToken: 'token-abc', wabaId: 'waba-1' } };

    const result = await createMetaTemplate(channel, {
      name: 'fatura_vencida', category: 'UTILITY', language: 'pt_BR', bodyText: 'Olá {{1}}, sua fatura venceu.',
    });

    expect(axios.post).toHaveBeenCalledWith(
      'https://graph.facebook.com/v20.0/waba-1/message_templates',
      { name: 'fatura_vencida', category: 'UTILITY', language: 'pt_BR', components: [{ type: 'BODY', text: 'Olá {{1}}, sua fatura venceu.' }] },
      { headers: { Authorization: 'Bearer token-abc' } }
    );
    expect(result).toEqual({ metaTemplateId: 'meta-tpl-1', status: 'PENDING' });
  });
});

describe('listMetaTemplates', () => {
  test('fetches the WABA template list with the expected fields', async () => {
    axios.get.mockResolvedValue({ data: { data: [{ id: 'meta-tpl-1', name: 'a', language: 'pt_BR', category: 'UTILITY', status: 'APPROVED' }] } });
    const channel = { config: { accessToken: 'token-abc', wabaId: 'waba-1' } };

    const result = await listMetaTemplates(channel);

    expect(axios.get).toHaveBeenCalledWith('https://graph.facebook.com/v20.0/waba-1/message_templates', {
      headers: { Authorization: 'Bearer token-abc' },
      params: { fields: 'id,name,language,category,status' },
    });
    expect(result).toEqual([{ id: 'meta-tpl-1', name: 'a', language: 'pt_BR', category: 'UTILITY', status: 'APPROVED' }]);
  });
});

describe('deleteMetaTemplate', () => {
  test('calls the delete endpoint with name and hsm_id', async () => {
    axios.delete.mockResolvedValue({ data: { success: true } });
    const channel = { config: { accessToken: 'token-abc', wabaId: 'waba-1' } };

    await deleteMetaTemplate(channel, { name: 'fatura_vencida', metaTemplateId: 'meta-tpl-1' });

    expect(axios.delete).toHaveBeenCalledWith('https://graph.facebook.com/v20.0/waba-1/message_templates', {
      headers: { Authorization: 'Bearer token-abc' },
      params: { name: 'fatura_vencida', hsm_id: 'meta-tpl-1' },
    });
  });
});

describe('sendTemplateMessage', () => {
  test('sends a template message with substituted body parameters', async () => {
    axios.post.mockResolvedValue({ data: { messages: [{ id: 'wamid.TPL1' }] } });
    const channel = { config: { phoneNumberId: '1234567890', accessToken: 'token-abc' } };

    const result = await sendTemplateMessage(channel, '5511999998888', {
      name: 'fatura_vencida', language: 'pt_BR', variables: ['João', 'R$150,00'],
    });

    expect(axios.post).toHaveBeenCalledWith(
      'https://graph.facebook.com/v20.0/1234567890/messages',
      {
        messaging_product: 'whatsapp', to: '5511999998888', type: 'template',
        template: {
          name: 'fatura_vencida', language: { code: 'pt_BR' },
          components: [{ type: 'body', parameters: [{ type: 'text', text: 'João' }, { type: 'text', text: 'R$150,00' }] }],
        },
      },
      { headers: { Authorization: 'Bearer token-abc' } }
    );
    expect(result).toEqual({ whatsappMessageId: 'wamid.TPL1' });
  });

  test('sends an empty components array for a template with zero variables', async () => {
    axios.post.mockResolvedValue({ data: { messages: [{ id: 'wamid.TPL2' }] } });
    const channel = { config: { phoneNumberId: '1234567890', accessToken: 'token-abc' } };

    await sendTemplateMessage(channel, '5511999998888', { name: 'boas_vindas', language: 'pt_BR', variables: [] });

    expect(axios.post).toHaveBeenCalledWith(
      'https://graph.facebook.com/v20.0/1234567890/messages',
      {
        messaging_product: 'whatsapp', to: '5511999998888', type: 'template',
        template: { name: 'boas_vindas', language: { code: 'pt_BR' }, components: [] },
      },
      { headers: { Authorization: 'Bearer token-abc' } }
    );
  });
});

describe('parseTemplateStatusUpdates', () => {
  test('extracts a template status update event', () => {
    const webhookBody = {
      entry: [{ id: 'waba-1', changes: [{ field: 'message_template_status_update', value: { message_template_id: '123', message_template_name: 'fatura_vencida', event: 'APPROVED' } }] }],
    };
    expect(parseTemplateStatusUpdates(webhookBody)).toEqual([{ metaTemplateId: '123', event: 'APPROVED', reason: null }]);
  });

  test('includes the rejection reason when present', () => {
    const webhookBody = {
      entry: [{ id: 'waba-1', changes: [{ field: 'message_template_status_update', value: { message_template_id: '456', event: 'REJECTED', reason: 'INVALID_FORMAT' } }] }],
    };
    expect(parseTemplateStatusUpdates(webhookBody)).toEqual([{ metaTemplateId: '456', event: 'REJECTED', reason: 'INVALID_FORMAT' }]);
  });

  test('ignores changes for other fields (e.g. messages)', () => {
    const webhookBody = { entry: [{ id: 'waba-1', changes: [{ field: 'messages', value: { messages: [] } }] }] };
    expect(parseTemplateStatusUpdates(webhookBody)).toEqual([]);
  });

  test('returns an empty array when there are no entries', () => {
    expect(parseTemplateStatusUpdates({})).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- meta-cloud.adapter.test.js`
Expected: FAIL with "createMetaTemplate is not a function" (and similarly for the other four).

- [ ] **Step 3: Implement the adapter additions**

Add to `src/whatsapp-adapters/meta-cloud.adapter.js`, after `sendMediaMessage`:

```js
async function createMetaTemplate(channel, { name, category, language, bodyText }) {
  const { accessToken, wabaId } = channel.config;
  const response = await axios.post(
    `https://graph.facebook.com/v20.0/${wabaId}/message_templates`,
    { name, category, language, components: [{ type: 'BODY', text: bodyText }] },
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  return { metaTemplateId: response.data.id, status: response.data.status };
}

async function listMetaTemplates(channel) {
  const { accessToken, wabaId } = channel.config;
  const response = await axios.get(`https://graph.facebook.com/v20.0/${wabaId}/message_templates`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    params: { fields: 'id,name,language,category,status' },
  });
  return response.data.data;
}

async function deleteMetaTemplate(channel, { name, metaTemplateId }) {
  const { accessToken, wabaId } = channel.config;
  await axios.delete(`https://graph.facebook.com/v20.0/${wabaId}/message_templates`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    params: { name, hsm_id: metaTemplateId },
  });
}

async function sendTemplateMessage(channel, toPhoneNumber, { name, language, variables }) {
  const { phoneNumberId, accessToken } = channel.config;
  const components = variables.length > 0 ? [{ type: 'body', parameters: variables.map((v) => ({ type: 'text', text: v })) }] : [];
  const response = await axios.post(
    `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`,
    { messaging_product: 'whatsapp', to: toPhoneNumber, type: 'template', template: { name, language: { code: language }, components } },
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  return { whatsappMessageId: response.data.messages[0].id };
}

function parseTemplateStatusUpdates(webhookBody) {
  const updates = [];
  const entries = webhookBody.entry || [];
  for (const entry of entries) {
    for (const change of entry.changes || []) {
      if (change.field !== 'message_template_status_update') continue;
      const value = change.value || {};
      if (!value.message_template_id) continue;
      updates.push({
        metaTemplateId: String(value.message_template_id),
        event: value.event,
        reason: value.reason || null,
      });
    }
  }
  return updates;
}
```

Add all five to `module.exports`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- meta-cloud.adapter.test.js`
Expected: PASS, including every pre-existing test in this file.

- [ ] **Step 5: Commit**

```bash
git add src/whatsapp-adapters/meta-cloud.adapter.js src/whatsapp-adapters/meta-cloud.adapter.test.js
git commit -m "feat: add Meta template management and template-send Graph API calls"
```

---

### Task 4: Template service (orchestration)

**Files:**
- Create: `src/templates/template.service.js`
- Create: `src/templates/template.service.test.js`

**Interfaces:**
- Consumes: `findChannelById`, `findChannelByWabaId` (Task 2); `listTemplates`, `listApprovedTemplatesByWabaId`, `findTemplateById`, `findTemplateByMetaTemplateId`, `createTemplateRecord`, `updateTemplateStatusByMetaTemplateId`, `deleteTemplateRecord` (Task 1); `isValidTemplateName`, `extractVariableCount` (Task 1); `createMetaTemplate`, `listMetaTemplates`, `deleteMetaTemplate`, `parseTemplateStatusUpdates` (Task 3).
- Produces: `createTemplate({channelId, name, category, language, bodyText})`, `listApprovedTemplatesForChannel(channelId)`, `deleteTemplate(id)` → `boolean`, `syncTemplatesForWaba(wabaId)` → the full template list, `applyTemplateStatusUpdates(webhookBody)`, and the `TemplateValidationError` class — all consumed by Task 5's routes and Task 6's webhook extension.

- [ ] **Step 1: Write the failing service tests**

```js
jest.mock('../channels/channel.repository');
jest.mock('./template.repository');
jest.mock('../whatsapp-adapters/meta-cloud.adapter');

const { findChannelById, findChannelByWabaId } = require('../channels/channel.repository');
const {
  listTemplates,
  listApprovedTemplatesByWabaId,
  findTemplateById,
  findTemplateByMetaTemplateId,
  createTemplateRecord,
  updateTemplateStatusByMetaTemplateId,
  deleteTemplateRecord,
} = require('./template.repository');
const metaCloudAdapter = require('../whatsapp-adapters/meta-cloud.adapter');
const {
  createTemplate,
  listApprovedTemplatesForChannel,
  deleteTemplate,
  syncTemplatesForWaba,
  applyTemplateStatusUpdates,
  TemplateValidationError,
} = require('./template.service');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('createTemplate', () => {
  const validInput = { channelId: 'ch-1', name: 'fatura_vencida', category: 'UTILITY', language: 'pt_BR', bodyText: 'Olá {{1}}, sua fatura venceu.' };

  test('rejects an invalid name without calling Meta', async () => {
    await expect(createTemplate({ ...validInput, name: 'Fatura Vencida' })).rejects.toThrow(TemplateValidationError);
    expect(metaCloudAdapter.createMetaTemplate).not.toHaveBeenCalled();
  });

  test('rejects a category outside MARKETING/UTILITY', async () => {
    await expect(createTemplate({ ...validInput, category: 'AUTHENTICATION' })).rejects.toThrow(TemplateValidationError);
  });

  test('rejects when the channel is not meta_cloud', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', type: 'baileys', config: {} });
    await expect(createTemplate(validInput)).rejects.toThrow(TemplateValidationError);
  });

  test('rejects when the meta_cloud channel has no wabaId configured', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', type: 'meta_cloud', config: { phoneNumberId: '123', accessToken: 'tok' } });
    await expect(createTemplate(validInput)).rejects.toThrow(TemplateValidationError);
  });

  test('submits to Meta then persists locally with the returned metaTemplateId', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', type: 'meta_cloud', config: { phoneNumberId: '123', accessToken: 'tok', wabaId: 'waba-1' } });
    metaCloudAdapter.createMetaTemplate.mockResolvedValue({ metaTemplateId: 'meta-tpl-9', status: 'PENDING' });
    createTemplateRecord.mockResolvedValue({ id: 'local-1', wabaId: 'waba-1', metaTemplateId: 'meta-tpl-9', name: 'fatura_vencida', language: 'pt_BR', category: 'UTILITY', bodyText: validInput.bodyText, variableCount: 1, status: 'PENDING', rejectionReason: null, createdAt: new Date() });

    const result = await createTemplate(validInput);

    expect(metaCloudAdapter.createMetaTemplate).toHaveBeenCalledWith(
      { id: 'ch-1', type: 'meta_cloud', config: { phoneNumberId: '123', accessToken: 'tok', wabaId: 'waba-1' } },
      { name: 'fatura_vencida', category: 'UTILITY', language: 'pt_BR', bodyText: validInput.bodyText }
    );
    expect(createTemplateRecord).toHaveBeenCalledWith({
      wabaId: 'waba-1', metaTemplateId: 'meta-tpl-9', name: 'fatura_vencida', language: 'pt_BR', category: 'UTILITY', bodyText: validInput.bodyText, variableCount: 1,
    });
    expect(result.id).toBe('local-1');
  });
});

describe('listApprovedTemplatesForChannel', () => {
  test('returns approved templates for the channel\'s wabaId', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', type: 'meta_cloud', config: { wabaId: 'waba-1' } });
    listApprovedTemplatesByWabaId.mockResolvedValue([{ id: 'tpl-1' }]);

    const result = await listApprovedTemplatesForChannel('ch-1');

    expect(listApprovedTemplatesByWabaId).toHaveBeenCalledWith('waba-1');
    expect(result).toEqual([{ id: 'tpl-1' }]);
  });

  test('returns an empty array when the channel has no wabaId', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', type: 'meta_cloud', config: {} });
    expect(await listApprovedTemplatesForChannel('ch-1')).toEqual([]);
    expect(listApprovedTemplatesByWabaId).not.toHaveBeenCalled();
  });

  test('returns an empty array when the channel does not exist', async () => {
    findChannelById.mockResolvedValue(null);
    expect(await listApprovedTemplatesForChannel('missing')).toEqual([]);
  });
});

describe('deleteTemplate', () => {
  test('deletes from Meta then locally when a channel for the WABA exists', async () => {
    findTemplateById.mockResolvedValue({ id: 'tpl-1', wabaId: 'waba-1', name: 'fatura_vencida', metaTemplateId: 'meta-tpl-1' });
    findChannelByWabaId.mockResolvedValue({ id: 'ch-1', config: { accessToken: 'tok', wabaId: 'waba-1' } });
    deleteTemplateRecord.mockResolvedValue(true);

    const result = await deleteTemplate('tpl-1');

    expect(metaCloudAdapter.deleteMetaTemplate).toHaveBeenCalledWith(
      { id: 'ch-1', config: { accessToken: 'tok', wabaId: 'waba-1' } },
      { name: 'fatura_vencida', metaTemplateId: 'meta-tpl-1' }
    );
    expect(deleteTemplateRecord).toHaveBeenCalledWith('tpl-1');
    expect(result).toBe(true);
  });

  test('returns false without calling Meta when the template does not exist locally', async () => {
    findTemplateById.mockResolvedValue(null);
    expect(await deleteTemplate('missing')).toBe(false);
    expect(metaCloudAdapter.deleteMetaTemplate).not.toHaveBeenCalled();
  });

  test('still deletes the local row when no channel remains for that WABA', async () => {
    findTemplateById.mockResolvedValue({ id: 'tpl-1', wabaId: 'waba-1', name: 'x', metaTemplateId: 'meta-1' });
    findChannelByWabaId.mockResolvedValue(null);
    deleteTemplateRecord.mockResolvedValue(true);

    const result = await deleteTemplate('tpl-1');

    expect(metaCloudAdapter.deleteMetaTemplate).not.toHaveBeenCalled();
    expect(deleteTemplateRecord).toHaveBeenCalledWith('tpl-1');
    expect(result).toBe(true);
  });
});

describe('syncTemplatesForWaba', () => {
  test('updates local status for each template Meta returns', async () => {
    findChannelByWabaId.mockResolvedValue({ id: 'ch-1', config: { accessToken: 'tok', wabaId: 'waba-1' } });
    metaCloudAdapter.listMetaTemplates.mockResolvedValue([
      { id: 'meta-1', status: 'APPROVED' },
      { id: 'meta-2', status: 'REJECTED' },
    ]);
    listTemplates.mockResolvedValue([{ id: 'tpl-1' }, { id: 'tpl-2' }]);

    const result = await syncTemplatesForWaba('waba-1');

    expect(updateTemplateStatusByMetaTemplateId).toHaveBeenCalledWith('meta-1', { status: 'APPROVED', rejectionReason: null });
    expect(updateTemplateStatusByMetaTemplateId).toHaveBeenCalledWith('meta-2', { status: 'REJECTED', rejectionReason: null });
    expect(result).toEqual([{ id: 'tpl-1' }, { id: 'tpl-2' }]);
  });

  test('skips an unrecognized status value without writing it', async () => {
    findChannelByWabaId.mockResolvedValue({ id: 'ch-1', config: { accessToken: 'tok', wabaId: 'waba-1' } });
    metaCloudAdapter.listMetaTemplates.mockResolvedValue([{ id: 'meta-1', status: 'IN_APPEAL' }]);
    listTemplates.mockResolvedValue([]);

    await syncTemplatesForWaba('waba-1');

    expect(updateTemplateStatusByMetaTemplateId).not.toHaveBeenCalled();
  });

  test('throws when no channel exists for the given wabaId', async () => {
    findChannelByWabaId.mockResolvedValue(null);
    await expect(syncTemplatesForWaba('waba-1')).rejects.toThrow(TemplateValidationError);
  });
});

describe('applyTemplateStatusUpdates', () => {
  test('updates the matching local template', async () => {
    metaCloudAdapter.parseTemplateStatusUpdates.mockReturnValue([{ metaTemplateId: 'meta-1', event: 'APPROVED', reason: null }]);
    findTemplateByMetaTemplateId.mockResolvedValue({ id: 'tpl-1', metaTemplateId: 'meta-1' });

    await applyTemplateStatusUpdates({ entry: [] });

    expect(updateTemplateStatusByMetaTemplateId).toHaveBeenCalledWith('meta-1', { status: 'APPROVED', rejectionReason: null });
  });

  test('skips an update for a template id with no local match', async () => {
    metaCloudAdapter.parseTemplateStatusUpdates.mockReturnValue([{ metaTemplateId: 'unknown', event: 'APPROVED', reason: null }]);
    findTemplateByMetaTemplateId.mockResolvedValue(null);

    await applyTemplateStatusUpdates({ entry: [] });

    expect(updateTemplateStatusByMetaTemplateId).not.toHaveBeenCalled();
  });

  test('skips an unrecognized event value without writing it', async () => {
    metaCloudAdapter.parseTemplateStatusUpdates.mockReturnValue([{ metaTemplateId: 'meta-1', event: 'IN_APPEAL', reason: null }]);
    findTemplateByMetaTemplateId.mockResolvedValue({ id: 'tpl-1', metaTemplateId: 'meta-1' });

    await applyTemplateStatusUpdates({ entry: [] });

    expect(updateTemplateStatusByMetaTemplateId).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- template.service.test.js`
Expected: FAIL with "Cannot find module './template.service'"

- [ ] **Step 3: Implement the service**

```js
const { findChannelById, findChannelByWabaId } = require('../channels/channel.repository');
const {
  listTemplates,
  listApprovedTemplatesByWabaId,
  findTemplateById,
  findTemplateByMetaTemplateId,
  createTemplateRecord,
  updateTemplateStatusByMetaTemplateId,
  deleteTemplateRecord,
} = require('./template.repository');
const { isValidTemplateName, extractVariableCount } = require('./template-validator');
const metaCloudAdapter = require('../whatsapp-adapters/meta-cloud.adapter');

const CATEGORIES = ['MARKETING', 'UTILITY'];
const KNOWN_STATUSES = new Set(['PENDING', 'APPROVED', 'REJECTED', 'PAUSED', 'DISABLED']);

class TemplateValidationError extends Error {}

async function createTemplate({ channelId, name, category, language, bodyText }) {
  if (!isValidTemplateName(name)) {
    throw new TemplateValidationError('Template name must contain only lowercase letters, numbers, and underscores');
  }
  if (!CATEGORIES.includes(category)) {
    throw new TemplateValidationError('category must be MARKETING or UTILITY');
  }
  if (!language) {
    throw new TemplateValidationError('language is required');
  }
  if (!bodyText) {
    throw new TemplateValidationError('bodyText is required');
  }
  const variableCount = extractVariableCount(bodyText);

  const channel = await findChannelById(channelId);
  if (!channel || channel.type !== 'meta_cloud') {
    throw new TemplateValidationError('channelId must reference a meta_cloud channel');
  }
  if (!channel.config.wabaId) {
    throw new TemplateValidationError('This channel has no WABA configured yet');
  }

  const { metaTemplateId } = await metaCloudAdapter.createMetaTemplate(channel, { name, category, language, bodyText });

  return createTemplateRecord({ wabaId: channel.config.wabaId, metaTemplateId, name, language, category, bodyText, variableCount });
}

async function listApprovedTemplatesForChannel(channelId) {
  const channel = await findChannelById(channelId);
  if (!channel || !channel.config.wabaId) return [];
  return listApprovedTemplatesByWabaId(channel.config.wabaId);
}

async function deleteTemplate(id) {
  const template = await findTemplateById(id);
  if (!template) return false;
  const channel = await findChannelByWabaId(template.wabaId);
  if (channel) {
    await metaCloudAdapter.deleteMetaTemplate(channel, { name: template.name, metaTemplateId: template.metaTemplateId });
  }
  return deleteTemplateRecord(id);
}

async function syncTemplatesForWaba(wabaId) {
  const channel = await findChannelByWabaId(wabaId);
  if (!channel) {
    throw new TemplateValidationError('No channel found for this WABA');
  }
  const metaTemplates = await metaCloudAdapter.listMetaTemplates(channel);
  for (const metaTemplate of metaTemplates) {
    if (!KNOWN_STATUSES.has(metaTemplate.status)) {
      console.warn(`Ignoring unknown template status "${metaTemplate.status}" for meta_template_id ${metaTemplate.id}`);
      continue;
    }
    await updateTemplateStatusByMetaTemplateId(String(metaTemplate.id), { status: metaTemplate.status, rejectionReason: null });
  }
  return listTemplates();
}

async function applyTemplateStatusUpdates(webhookBody) {
  const updates = metaCloudAdapter.parseTemplateStatusUpdates(webhookBody);
  for (const update of updates) {
    if (!KNOWN_STATUSES.has(update.event)) {
      console.warn(`Ignoring unknown template status event "${update.event}" for meta_template_id ${update.metaTemplateId}`);
      continue;
    }
    const existing = await findTemplateByMetaTemplateId(update.metaTemplateId);
    if (!existing) {
      console.warn(`Received status update for unknown template id ${update.metaTemplateId}`);
      continue;
    }
    await updateTemplateStatusByMetaTemplateId(update.metaTemplateId, { status: update.event, rejectionReason: update.reason });
  }
}

module.exports = {
  createTemplate,
  listApprovedTemplatesForChannel,
  deleteTemplate,
  syncTemplatesForWaba,
  applyTemplateStatusUpdates,
  TemplateValidationError,
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- template.service.test.js`
Expected: PASS, all 15 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/templates/template.service.js src/templates/template.service.test.js
git commit -m "feat: add template service orchestrating Meta template lifecycle"
```

---

### Task 5: Template API routes

**Files:**
- Create: `src/api/templates.routes.js`
- Create: `src/api/templates.routes.test.js`
- Create: `src/api/admin-templates.routes.js`
- Create: `src/api/admin-templates.routes.test.js`
- Modify: `src/server.js`

**Interfaces:**
- Consumes: `listApprovedTemplatesForChannel`, `createTemplate`, `deleteTemplate`, `syncTemplatesForWaba`, `TemplateValidationError` (Task 4); `listTemplates` (Task 1).
- Produces: `GET /api/templates?channelId=` (mounted in Task 5), `GET/POST/DELETE/POST-sync /api/admin/templates` (mounted in Task 5) — consumed by Task 11's frontend.

- [ ] **Step 1: Write the failing open-route tests**

```js
jest.mock('../templates/template.service');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const { listApprovedTemplatesForChannel } = require('../templates/template.service');
const templatesRoutes = require('./templates.routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/templates', templatesRoutes);
  return app;
}

function tokenFor(agentId, role) {
  return jwt.sign({ agentId, role }, process.env.JWT_SECRET);
}

describe('GET /api/templates', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns approved templates for the given channelId', async () => {
    listApprovedTemplatesForChannel.mockResolvedValue([{ id: 'tpl-1', name: 'fatura_vencida' }]);
    const res = await request(buildApp())
      .get('/api/templates?channelId=ch-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 'tpl-1', name: 'fatura_vencida' }]);
    expect(listApprovedTemplatesForChannel).toHaveBeenCalledWith('ch-1');
  });

  test('returns 400 when channelId is missing', async () => {
    const res = await request(buildApp()).get('/api/templates').set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(400);
  });

  test('returns 401 without a token', async () => {
    const res = await request(buildApp()).get('/api/templates?channelId=ch-1');
    expect(res.status).toBe(401);
  });

  test('works for a non-admin agent (open route)', async () => {
    listApprovedTemplatesForChannel.mockResolvedValue([]);
    const res = await request(buildApp())
      .get('/api/templates?channelId=ch-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- templates.routes.test.js`
Expected: FAIL with "Cannot find module './templates.routes'"

- [ ] **Step 3: Implement the open route**

```js
const express = require('express');
const { requireAuth } = require('../auth/auth.middleware');
const { listApprovedTemplatesForChannel } = require('../templates/template.service');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  const { channelId } = req.query;
  if (!channelId) {
    return res.status(400).json({ error: 'channelId is required' });
  }
  const templates = await listApprovedTemplatesForChannel(channelId);
  res.json(templates);
});

module.exports = router;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- templates.routes.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/api/templates.routes.js src/api/templates.routes.test.js
git commit -m "feat: add open GET /api/templates route"
```

- [ ] **Step 6: Write the failing admin-route tests**

```js
jest.mock('../templates/template.repository');
jest.mock('../templates/template.service');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const { listTemplates } = require('../templates/template.repository');
const { createTemplate, deleteTemplate, syncTemplatesForWaba, TemplateValidationError } = require('../templates/template.service');
const adminTemplatesRoutes = require('./admin-templates.routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/templates', adminTemplatesRoutes);
  return app;
}

function tokenFor(agentId, role) {
  return jwt.sign({ agentId, role }, process.env.JWT_SECRET);
}

beforeEach(() => jest.clearAllMocks());

describe('GET /api/admin/templates', () => {
  test('returns every template', async () => {
    listTemplates.mockResolvedValue([{ id: 'tpl-1' }]);
    const res = await request(buildApp()).get('/api/admin/templates').set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 'tpl-1' }]);
  });

  test('returns 403 for a non-admin', async () => {
    const res = await request(buildApp()).get('/api/admin/templates').set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(403);
  });
});

describe('POST /api/admin/templates', () => {
  test('returns 400 when a required field is missing', async () => {
    const res = await request(buildApp())
      .post('/api/admin/templates')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ channelId: 'ch-1', name: 'x' });
    expect(res.status).toBe(400);
    expect(createTemplate).not.toHaveBeenCalled();
  });

  test('creates the template and returns 201', async () => {
    createTemplate.mockResolvedValue({ id: 'tpl-1', name: 'fatura_vencida', status: 'PENDING' });
    const res = await request(buildApp())
      .post('/api/admin/templates')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ channelId: 'ch-1', name: 'fatura_vencida', category: 'UTILITY', language: 'pt_BR', bodyText: 'Olá {{1}}.' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 'tpl-1', name: 'fatura_vencida', status: 'PENDING' });
  });

  test('returns 400 for a TemplateValidationError', async () => {
    createTemplate.mockRejectedValue(new TemplateValidationError('bad name'));
    const res = await request(buildApp())
      .post('/api/admin/templates')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ channelId: 'ch-1', name: 'x', category: 'UTILITY', language: 'pt_BR', bodyText: 'Y' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('bad name');
  });

  test('returns 409 for a duplicate (wabaId, name, language)', async () => {
    createTemplate.mockRejectedValue(Object.assign(new Error('duplicate'), { code: '23505' }));
    const res = await request(buildApp())
      .post('/api/admin/templates')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ channelId: 'ch-1', name: 'x', category: 'UTILITY', language: 'pt_BR', bodyText: 'Y' });
    expect(res.status).toBe(409);
  });

  test('returns 502 with Meta\'s own error message when Meta rejects the request', async () => {
    createTemplate.mockRejectedValue({ response: { data: { error: { message: 'Invalid parameter' } } } });
    const res = await request(buildApp())
      .post('/api/admin/templates')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ channelId: 'ch-1', name: 'x', category: 'UTILITY', language: 'pt_BR', bodyText: 'Y' });
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('Invalid parameter');
  });
});

describe('DELETE /api/admin/templates/:id', () => {
  test('returns 204 when deleted', async () => {
    deleteTemplate.mockResolvedValue(true);
    const res = await request(buildApp()).delete('/api/admin/templates/tpl-1').set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`);
    expect(res.status).toBe(204);
  });

  test('returns 404 when not found', async () => {
    deleteTemplate.mockResolvedValue(false);
    const res = await request(buildApp()).delete('/api/admin/templates/tpl-1').set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`);
    expect(res.status).toBe(404);
  });
});

describe('POST /api/admin/templates/sync', () => {
  test('returns 400 when wabaId is missing', async () => {
    const res = await request(buildApp()).post('/api/admin/templates/sync').set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`).send({});
    expect(res.status).toBe(400);
  });

  test('returns the refreshed template list', async () => {
    syncTemplatesForWaba.mockResolvedValue([{ id: 'tpl-1', status: 'APPROVED' }]);
    const res = await request(buildApp())
      .post('/api/admin/templates/sync')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ wabaId: 'waba-1' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 'tpl-1', status: 'APPROVED' }]);
  });

  test('returns 400 for a TemplateValidationError', async () => {
    syncTemplatesForWaba.mockRejectedValue(new TemplateValidationError('No channel found for this WABA'));
    const res = await request(buildApp())
      .post('/api/admin/templates/sync')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ wabaId: 'waba-1' });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 7: Run the tests to verify they fail**

Run: `npm test -- admin-templates.routes.test.js`
Expected: FAIL with "Cannot find module './admin-templates.routes'"

- [ ] **Step 8: Implement the admin routes**

```js
const express = require('express');
const { requireAuth, requireRole } = require('../auth/auth.middleware');
const { listTemplates } = require('../templates/template.repository');
const { createTemplate, deleteTemplate, syncTemplatesForWaba, TemplateValidationError } = require('../templates/template.service');

const router = express.Router();

function metaErrorMessage(err) {
  return err.response && err.response.data && err.response.data.error && err.response.data.error.message;
}

router.get('/', requireAuth, requireRole('admin'), async (req, res) => {
  const templates = await listTemplates();
  res.json(templates);
});

router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  const { channelId, name, category, language, bodyText } = req.body || {};
  if (!channelId || !name || !category || !language || !bodyText) {
    return res.status(400).json({ error: 'channelId, name, category, language and bodyText are required' });
  }
  try {
    const template = await createTemplate({ channelId, name, category, language, bodyText });
    res.status(201).json(template);
  } catch (err) {
    if (err instanceof TemplateValidationError) {
      return res.status(400).json({ error: err.message });
    }
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A template with this name and language already exists for this WABA' });
    }
    const metaMessage = metaErrorMessage(err);
    if (metaMessage) {
      return res.status(502).json({ error: metaMessage });
    }
    throw err;
  }
});

router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const deleted = await deleteTemplate(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: 'Template not found' });
  }
  res.status(204).send();
});

router.post('/sync', requireAuth, requireRole('admin'), async (req, res) => {
  const { wabaId } = req.body || {};
  if (!wabaId) {
    return res.status(400).json({ error: 'wabaId is required' });
  }
  try {
    const templates = await syncTemplatesForWaba(wabaId);
    res.json(templates);
  } catch (err) {
    if (err instanceof TemplateValidationError) {
      return res.status(400).json({ error: err.message });
    }
    const metaMessage = metaErrorMessage(err);
    if (metaMessage) {
      return res.status(502).json({ error: metaMessage });
    }
    throw err;
  }
});

module.exports = router;
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npm test -- admin-templates.routes.test.js`
Expected: PASS, all 12 tests green.

- [ ] **Step 10: Mount both routers in `src/server.js`**

Add near the other route requires:

```js
const templatesRoutes = require('./api/templates.routes');
const adminTemplatesRoutes = require('./api/admin-templates.routes');
```

Add near the other `app.use` route mounts:

```js
app.use('/api/templates', templatesRoutes);
app.use('/api/admin/templates', adminTemplatesRoutes);
```

- [ ] **Step 11: Run the full backend suite to confirm nothing broke**

Run: `npm test`
Expected: PASS (aside from the 2 pre-existing, unrelated `outbound-queue.test.js` Bull/Redis timing flakes documented in this project's own history — if that's the only thing failing, it's the known baseline, not a regression).

- [ ] **Step 12: Commit**

```bash
git add src/api/admin-templates.routes.js src/api/admin-templates.routes.test.js src/server.js
git commit -m "feat: add admin CRUD and sync routes for message templates"
```

---

### Task 6: Webhook approval-status tracking

**Files:**
- Modify: `src/whatsapp-adapters/meta-cloud.routes.js`
- Modify: `src/whatsapp-adapters/meta-cloud.routes.test.js`

**Interfaces:**
- Consumes: `applyTemplateStatusUpdates` (Task 4).

- [ ] **Step 1: Write the failing webhook test**

This file's existing helpers are `buildApp()` and `sign(bodyString, secret)` — a signing helper, not a full request-building one. Every existing `POST /webhooks/meta` test builds its own request manually:

```js
const bodyString = JSON.stringify(payload);
const signature = sign(bodyString, 'app-secret');
const res = await request(buildApp())
  .post('/webhooks/meta')
  .set('X-Hub-Signature-256', signature)
  .set('Content-Type', 'application/json')
  .send(bodyString);
```

The existing `beforeEach` in `describe('POST /webhooks/meta', ...)` already sets `process.env.META_APP_SECRET = 'app-secret'` — reuse that same secret. Add `jest.mock('../templates/template.service')` alongside this file's existing `jest.mock(...)` calls at the top, and add a new `describe` block using the same request-building style:

```js
const { applyTemplateStatusUpdates } = require('../templates/template.service');

describe('POST /webhooks/meta (template status updates)', () => {
  test('forwards the webhook body to applyTemplateStatusUpdates', async () => {
    const payload = { entry: [{ id: 'waba-1', changes: [{ field: 'message_template_status_update', value: { message_template_id: '123', event: 'APPROVED' } }] }] };
    const bodyString = JSON.stringify(payload);
    const signature = sign(bodyString, 'app-secret');

    const res = await request(buildApp())
      .post('/webhooks/meta')
      .set('X-Hub-Signature-256', signature)
      .set('Content-Type', 'application/json')
      .send(bodyString);

    expect(res.status).toBe(200);
    expect(applyTemplateStatusUpdates).toHaveBeenCalledWith(payload);
  });

  test('still returns 200 when applyTemplateStatusUpdates throws', async () => {
    applyTemplateStatusUpdates.mockRejectedValue(new Error('boom'));
    const payload = { entry: [] };
    const bodyString = JSON.stringify(payload);
    const signature = sign(bodyString, 'app-secret');

    const res = await request(buildApp())
      .post('/webhooks/meta')
      .set('X-Hub-Signature-256', signature)
      .set('Content-Type', 'application/json')
      .send(bodyString);

    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- meta-cloud.routes.test.js`
Expected: FAIL — `applyTemplateStatusUpdates` is never called yet.

- [ ] **Step 3: Implement the webhook extension**

In `src/whatsapp-adapters/meta-cloud.routes.js`, add the import:

```js
const { applyTemplateStatusUpdates } = require('../templates/template.service');
```

In the `POST /meta` handler, after the `for (const inboundMessage of inboundMessages) { ... }` loop and before `res.sendStatus(200)`:

```js
try {
  await applyTemplateStatusUpdates(req.body);
} catch (err) {
  console.error('Failed to process template status update webhook', err);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- meta-cloud.routes.test.js`
Expected: PASS, including every pre-existing test in this file.

- [ ] **Step 5: Commit**

```bash
git add src/whatsapp-adapters/meta-cloud.routes.js src/whatsapp-adapters/meta-cloud.routes.test.js
git commit -m "feat: track template approval status via the Meta webhook"
```

---

### Task 7: Outbound queue and worker template support

**Files:**
- Modify: `src/queue/outbound-queue.js`
- Modify: `src/queue/outbound-queue.test.js`
- Modify: `src/queue/outbound-worker.js`
- Modify: `src/queue/outbound-worker.test.js`

**Interfaces:**
- Consumes: `sendTemplateMessage` (Task 3).
- Produces: `enqueueOutboundMessage` now also accepts `templateName`, `templateLanguage`, `templateVariables` — consumed by Task 8's `/start` route.

- [ ] **Step 1: Write the failing outbound-queue test**

Add to `src/queue/outbound-queue.test.js` (mirror this file's existing `enqueueOutboundMessage` test structure — read it first for its exact `createMessage`/`getOutboundQueue().add` mocking pattern):

```js
test('passes template fields through to the queued job', (done) => {
  processOutboundQueue((data) => {
    try {
      expect(data.templateName).toBe('fatura_vencida');
      expect(data.templateLanguage).toBe('pt_BR');
      expect(data.templateVariables).toEqual(['João', 'R$150,00']);
      done();
    } catch (err) {
      done(err);
    }
  });
  enqueueOutboundMessage({
    conversationId, channelId, content: 'Olá João, sua fatura de R$150,00 venceu.',
    templateName: 'fatura_vencida', templateLanguage: 'pt_BR', templateVariables: ['João', 'R$150,00'],
  });
});

test('defaults template fields to null when not a template message', (done) => {
  processOutboundQueue((data) => {
    try {
      expect(data.templateName).toBeNull();
      expect(data.templateLanguage).toBeNull();
      expect(data.templateVariables).toBeNull();
      done();
    } catch (err) {
      done(err);
    }
  });
  enqueueOutboundMessage({ conversationId, channelId, content: 'Mensagem normal' });
});
```

Use whatever `conversationId`/`channelId` fixtures this test file's existing tests already set up in a shared `beforeEach` — do not invent new ones if the file already has them in scope.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- outbound-queue.test.js`
Expected: FAIL — `data.templateName` is `undefined`, not present at all.

- [ ] **Step 3: Implement the queue change**

In `src/queue/outbound-queue.js`, update `enqueueOutboundMessage`'s signature and job payload:

```js
async function enqueueOutboundMessage({ conversationId, channelId, content, messageType, mediaPath, mediaMimeType, mediaFilename, templateName, templateLanguage, templateVariables }) {
  const message = await createMessage({
    conversationId,
    direction: 'outbound',
    content: content || null,
    whatsappMessageId: null,
    status: 'sent',
    messageType: messageType || 'text',
    mediaPath,
    mediaMimeType,
    mediaFilename,
  });
  await getOutboundQueue().add(
    {
      messageId: message.id,
      conversationId,
      channelId,
      content: message.content,
      messageType: message.messageType,
      mediaPath: message.mediaPath,
      mediaMimeType: message.mediaMimeType,
      mediaFilename: message.mediaFilename,
      templateName: templateName || null,
      templateLanguage: templateLanguage || null,
      templateVariables: templateVariables || null,
    },
    { attempts: 3, backoff: { type: 'exponential', delay: 5000 } }
  );
  return message;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- outbound-queue.test.js`
Expected: PASS, including every pre-existing test (the 2 known unrelated Bull/Redis timing flakes in this same file are pre-existing — see this project's own history if they show up here too).

- [ ] **Step 5: Commit**

```bash
git add src/queue/outbound-queue.js src/queue/outbound-queue.test.js
git commit -m "feat: pass template fields through the outbound queue"
```

- [ ] **Step 6: Write the failing worker test**

Add to `src/queue/outbound-worker.test.js` (this file already has `findMessageById.mockResolvedValue(null);` in its shared `beforeEach` from the triage-automation fix wave — reuse it):

```js
test('sends via sendTemplateMessage when the job carries a templateName', async () => {
  getConversationWithContact.mockResolvedValue({ id: 'conv-1', contactPhoneNumber: '5511999998888' });
  findChannelById.mockResolvedValue({ id: 'channel-1', type: 'meta_cloud', config: {} });
  metaCloudAdapter.sendTemplateMessage.mockResolvedValue({ whatsappMessageId: 'wamid.TPL1' });

  await handler({
    messageId: 'msg-1', conversationId: 'conv-1', channelId: 'channel-1', content: 'Olá João, sua fatura venceu.',
    templateName: 'fatura_vencida', templateLanguage: 'pt_BR', templateVariables: ['João'],
  });

  expect(metaCloudAdapter.sendTemplateMessage).toHaveBeenCalledWith(
    { id: 'channel-1', type: 'meta_cloud', config: {} },
    '5511999998888',
    { name: 'fatura_vencida', language: 'pt_BR', variables: ['João'] }
  );
  expect(metaCloudAdapter.sendTextMessage).not.toHaveBeenCalled();
  expect(recordMessageSent).toHaveBeenCalledWith('msg-1', 'wamid.TPL1');
});
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `npm test -- outbound-worker.test.js`
Expected: FAIL — `sendTemplateMessage` is never called; the handler falls through to `sendTextMessage` instead.

- [ ] **Step 8: Implement the worker branch**

In `src/queue/outbound-worker.js`, update the handler's destructured parameters and the send branch:

```js
function startOutboundWorker() {
  processOutboundQueue(async ({ messageId, conversationId, channelId, content, messageType, mediaPath, mediaMimeType, mediaFilename, templateName, templateLanguage, templateVariables }) => {
    const existingMessage = await findMessageById(messageId);
    if (existingMessage && existingMessage.whatsappMessageId) return;
    const conversation = await getConversationWithContact(conversationId);
    const channel = await findChannelById(channelId);
    try {
      const adapter = ADAPTERS_BY_CHANNEL_TYPE[channel.type];
      const { whatsappMessageId } = templateName
        ? await adapter.sendTemplateMessage(channel, conversation.contactPhoneNumber, {
            name: templateName,
            language: templateLanguage,
            variables: templateVariables || [],
          })
        : messageType && messageType !== 'text'
          ? await adapter.sendMediaMessage(channel, conversation.contactPhoneNumber, {
              messageType,
              mediaPath,
              mediaMimeType,
              mediaFilename,
              caption: content,
            })
          : await adapter.sendTextMessage(channel, conversation.contactPhoneNumber, content);
      const message = await recordMessageSent(messageId, whatsappMessageId);
      if (conversation.assignedAgentId) {
        emitToAgent(conversation.assignedAgentId, 'message:updated', { conversationId, message });
      }
    } catch (err) {
      const message = await updateMessageStatus(messageId, 'failed');
      if (conversation.assignedAgentId) {
        emitToAgent(conversation.assignedAgentId, 'message:updated', { conversationId, message });
      }
      throw err;
    }
  });
}
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npm test -- outbound-worker.test.js`
Expected: PASS, including every pre-existing test in this file.

- [ ] **Step 10: Commit**

```bash
git add src/queue/outbound-worker.js src/queue/outbound-worker.test.js
git commit -m "feat: send WhatsApp template messages from the outbound worker"
```

---

### Task 8: Conversation-start route for Meta Cloud

**Files:**
- Modify: `src/api/conversations.routes.js`
- Modify: `src/api/conversations.routes.test.js`

**Interfaces:**
- Consumes: `findTemplateById` (Task 1's `template.repository.js`), `substituteVariables` (Task 1's `template-validator.js`), the extended `enqueueOutboundMessage` (Task 7).

- [ ] **Step 1: Read the existing `POST /start` tests, then update the one that no longer applies**

Read every existing test in `src/api/conversations.routes.test.js` under `describe('POST /api/conversations/start', ...)` first. Ten of the eleven existing tests there keep passing unchanged under this task's restructuring (they either fail before reaching the new branch point, or exercise the Baileys path exactly as before with no behavior change). Exactly one needs updating:

`'returns 400 when the channel is not a Baileys channel'` currently mocks `findChannelById` to return a `meta_cloud` channel and asserts `res.body.error` matches `/baileys/i` — that assertion is about to become false, since `meta_cloud` is a supported channel type now (it just requires a template instead of `content`). This test's real purpose — reject an unsupported channel type outright — still exists in the restructured route, just needs a channel type that is actually unsupported. Change this test to mock `findChannelById` returning `{ id: 'channel-1', type: 'sms', status: 'connected' }` (or any type string that is neither `baileys` nor `meta_cloud`) and assert `res.body.error` matches `/unsupported channel type/i` instead. Do not remove this test — repurpose it.

Do not change any of the other ten existing tests in this `describe` block.

- [ ] **Step 2: Write the failing new tests**

Add these alongside the existing Baileys-path tests, mocking `../templates/template.repository` in addition to whatever this file already mocks:

```js
jest.mock('../templates/template.repository');
const { findTemplateById } = require('../templates/template.repository');

describe('POST /start (meta_cloud)', () => {
  const approvedTemplate = { id: 'tpl-1', wabaId: 'waba-1', name: 'fatura_vencida', language: 'pt_BR', bodyText: 'Olá {{1}}, sua fatura de {{2}} venceu.', variableCount: 2, status: 'APPROVED' };

  test('returns 400 when templateId is missing', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', type: 'meta_cloud', config: { wabaId: 'waba-1' } });
    const res = await request(buildApp())
      .post('/api/conversations/start')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ channelId: 'ch-1', phoneNumber: '5511999990000' });
    expect(res.status).toBe(400);
  });

  test('returns 404 when the template does not exist', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', type: 'meta_cloud', config: { wabaId: 'waba-1' } });
    findTemplateById.mockResolvedValue(null);
    const res = await request(buildApp())
      .post('/api/conversations/start')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ channelId: 'ch-1', phoneNumber: '5511999990000', templateId: 'missing' });
    expect(res.status).toBe(404);
  });

  test('returns 400 when the template is not approved', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', type: 'meta_cloud', config: { wabaId: 'waba-1' } });
    findTemplateById.mockResolvedValue({ ...approvedTemplate, status: 'PENDING' });
    const res = await request(buildApp())
      .post('/api/conversations/start')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ channelId: 'ch-1', phoneNumber: '5511999990000', templateId: 'tpl-1', templateVariables: ['João', 'R$150'] });
    expect(res.status).toBe(400);
  });

  test('returns 400 when the template belongs to a different WABA than the channel', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', type: 'meta_cloud', config: { wabaId: 'waba-OTHER' } });
    findTemplateById.mockResolvedValue(approvedTemplate);
    const res = await request(buildApp())
      .post('/api/conversations/start')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ channelId: 'ch-1', phoneNumber: '5511999990000', templateId: 'tpl-1', templateVariables: ['João', 'R$150'] });
    expect(res.status).toBe(400);
  });

  test('returns 400 when the variable count does not match', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', type: 'meta_cloud', config: { wabaId: 'waba-1' } });
    findTemplateById.mockResolvedValue(approvedTemplate);
    const res = await request(buildApp())
      .post('/api/conversations/start')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ channelId: 'ch-1', phoneNumber: '5511999990000', templateId: 'tpl-1', templateVariables: ['João'] });
    expect(res.status).toBe(400);
  });

  test('starts the conversation, substitutes variables, and enqueues the template send', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', type: 'meta_cloud', config: { wabaId: 'waba-1' } });
    findTemplateById.mockResolvedValue(approvedTemplate);
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-1', phoneNumber: '5511999990000' });
    findOpenConversation.mockResolvedValue(null);
    createConversation.mockResolvedValue({ id: 'conv-1' });
    claimConversation.mockResolvedValue({ id: 'conv-1', assignedAgentId: 'agent-1' });
    getConversationWithContact.mockResolvedValue({ id: 'conv-1', assignedAgentId: 'agent-1' });

    const res = await request(buildApp())
      .post('/api/conversations/start')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ channelId: 'ch-1', phoneNumber: '5511999990000', templateId: 'tpl-1', templateVariables: ['João', 'R$150,00'] });

    expect(res.status).toBe(201);
    expect(enqueueOutboundMessage).toHaveBeenCalledWith({
      conversationId: 'conv-1', channelId: 'ch-1',
      content: 'Olá João, sua fatura de R$150,00 venceu.',
      templateName: 'fatura_vencida', templateLanguage: 'pt_BR', templateVariables: ['João', 'R$150,00'],
    });
  });

  test('does not call baileysManager.resolveWhatsAppJid for a meta_cloud channel', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', type: 'meta_cloud', config: { wabaId: 'waba-1' } });
    findTemplateById.mockResolvedValue(approvedTemplate);
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-1', phoneNumber: '5511999990000' });
    findOpenConversation.mockResolvedValue(null);
    createConversation.mockResolvedValue({ id: 'conv-1' });
    claimConversation.mockResolvedValue({ id: 'conv-1', assignedAgentId: 'agent-1' });
    getConversationWithContact.mockResolvedValue({ id: 'conv-1', assignedAgentId: 'agent-1' });

    await request(buildApp())
      .post('/api/conversations/start')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ channelId: 'ch-1', phoneNumber: '5511999990000', templateId: 'tpl-1', templateVariables: ['João', 'R$150,00'] });

    expect(baileysManager.resolveWhatsAppJid).not.toHaveBeenCalled();
  });
});
```

Reuse whatever mock variable names (`findChannelById`, `findOrCreateContactByPhoneNumber`, `findOpenConversation`, `createConversation`, `claimConversation`, `getConversationWithContact`, `enqueueOutboundMessage`, `baileysManager`, `buildApp`, `tokenFor`) this test file's existing Baileys-path tests already declare — do not redeclare them.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -- conversations.routes.test.js`
Expected: FAIL — every `meta_cloud` request currently 400s with "Starting a conversation is only supported for Baileys channels".

- [ ] **Step 4: Implement the route change**

In `src/api/conversations.routes.js`, add the new imports:

```js
const { findTemplateById } = require('../templates/template.repository');
const { substituteVariables } = require('../templates/template-validator');
```

Replace the entire `router.post('/start', ...)` handler:

```js
router.post('/start', async (req, res) => {
  const { channelId, phoneNumber } = req.body || {};
  if (!channelId || !phoneNumber) {
    return res.status(400).json({ error: 'channelId and phoneNumber are required' });
  }
  if (typeof phoneNumber !== 'string') {
    return res.status(400).json({ error: 'phoneNumber must be a string' });
  }

  let channel;
  try {
    channel = await findChannelById(channelId);
  } catch (err) {
    if (err.code === '22P02') {
      return res.status(404).json({ error: 'Channel not found' });
    }
    throw err;
  }
  if (!channel) {
    return res.status(404).json({ error: 'Channel not found' });
  }
  if (channel.type !== 'baileys' && channel.type !== 'meta_cloud') {
    return res.status(400).json({ error: 'Unsupported channel type' });
  }

  const normalizedPhoneNumber = phoneNumber.replace(/\D/g, '');
  if (!normalizedPhoneNumber) {
    return res.status(400).json({ error: 'A valid phoneNumber is required' });
  }

  let canonicalPhoneNumber;
  let outboundPayload;

  if (channel.type === 'baileys') {
    const { content } = req.body || {};
    if (!content) {
      return res.status(400).json({ error: 'content is required' });
    }
    if (channel.status !== 'connected') {
      return res.status(400).json({ error: 'This channel is not connected' });
    }
    canonicalPhoneNumber = await baileysManager.resolveWhatsAppJid(channel, normalizedPhoneNumber);
    if (!canonicalPhoneNumber) {
      return res.status(400).json({ error: 'This phone number is not on WhatsApp' });
    }
    outboundPayload = { content };
  } else {
    const { templateId, templateVariables } = req.body || {};
    if (!templateId) {
      return res.status(400).json({ error: 'templateId is required' });
    }
    const template = await findTemplateById(templateId);
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }
    if (template.status !== 'APPROVED') {
      return res.status(400).json({ error: 'This template is not approved' });
    }
    if (template.wabaId !== channel.config.wabaId) {
      return res.status(400).json({ error: "This template does not belong to this channel's WABA" });
    }
    const variables = Array.isArray(templateVariables) ? templateVariables : [];
    if (variables.length !== template.variableCount) {
      return res.status(400).json({ error: `This template requires exactly ${template.variableCount} variable(s)` });
    }
    canonicalPhoneNumber = normalizedPhoneNumber;
    outboundPayload = {
      content: substituteVariables(template.bodyText, variables),
      templateName: template.name,
      templateLanguage: template.language,
      templateVariables: variables,
    };
  }

  const contact = await findOrCreateContactByPhoneNumber(canonicalPhoneNumber, null);

  const existing = await findOpenConversation(contact.id, channel.id);
  if (existing) {
    return res.status(409).json({ error: 'There is already an open conversation with this contact on this channel' });
  }

  const conversation = await createConversation(contact.id, channel.id);
  const claimed = await claimConversation(conversation.id, req.agent.agentId);
  if (!claimed) {
    throw new Error('Failed to claim newly created conversation');
  }
  await enqueueOutboundMessage({ conversationId: claimed.id, channelId: channel.id, ...outboundPayload });

  const conversationWithContact = await getConversationWithContact(claimed.id);
  emitToAgent(req.agent.agentId, 'conversation:assigned', { conversation: conversationWithContact });

  res.status(201).json(conversationWithContact);
});
```

- [ ] **Step 5: Run the tests to verify they pass, including pre-existing ones**

Run: `npm test -- conversations.routes.test.js`
Expected: PASS — every pre-existing Baileys-path test plus every new meta_cloud test.

- [ ] **Step 6: Run the full backend suite**

Run: `npm test`
Expected: PASS (aside from the 2 known pre-existing `outbound-queue.test.js` flakes).

- [ ] **Step 7: Commit**

```bash
git add src/api/conversations.routes.js src/api/conversations.routes.test.js
git commit -m "feat: support starting a Meta Cloud conversation with an approved template"
```

---

### Task 9: Frontend — channel WABA management

**Files:**
- Modify: `frontend/src/services/api.js`
- Modify: `frontend/src/components/CreateChannelForm.jsx`
- Modify: `frontend/src/components/CreateChannelForm.test.jsx`
- Modify: `frontend/src/pages/AdminChannelsPage.jsx`
- Modify: `frontend/src/pages/AdminChannelsPage.test.jsx`

**Interfaces:**
- Consumes: `POST /api/admin/channels` (now requires `wabaId` for `meta_cloud`), `PATCH /api/admin/channels/:id` (now accepts `wabaId`) — both from Task 2.
- Produces: `setChannelWabaId(id, wabaId, token)` in `api.js`, consumed within this same task.

- [ ] **Step 1: Add the API function**

In `frontend/src/services/api.js`, add near `setChannelTriageEnabled` (this project's convention is a `set...` name in the frontend `api.js` wrapper even when the backend repository function it calls is named `update...` — see `setChannelTriageEnabled` calling into `updateChannelTriageEnabled`):

```js
export function setChannelWabaId(id, wabaId, token) {
  return apiFetch(`/api/admin/channels/${id}`, { method: 'PATCH', body: { wabaId }, token });
}
```

- [ ] **Step 2: Update the existing `CreateChannelForm` meta_cloud test**

This file's existing test `'creates a meta_cloud channel with all fields'` fills in name/phone/phoneNumberId/accessToken and submits, asserting `api.createChannel` was called WITHOUT a `wabaId` key. Once `wabaId` becomes a `required` input, that test's submit will silently no-op (a `required` field left empty blocks the form's `submit` event from ever firing, even under `userEvent`, so `api.createChannel` never gets called and the test's `waitFor` times out) — update it in place, don't add a duplicate new test:

```jsx
test('creates a meta_cloud channel with all fields', async () => {
  api.createChannel.mockResolvedValue({ id: 'ch2' });
  render(<CreateChannelForm onCreated={vi.fn()} />);

  await userEvent.selectOptions(screen.getByLabelText(/tipo/i), 'meta_cloud');
  await userEvent.type(screen.getByLabelText(/^nome/i), 'Suporte');
  await userEvent.type(screen.getByLabelText(/telefone/i), '+5511999990000');
  await userEvent.type(screen.getByLabelText(/phone number id/i), '123456');
  await userEvent.type(screen.getByLabelText(/access token/i), 'tok-meta');
  await userEvent.type(screen.getByLabelText(/waba id/i), 'waba-1');
  await userEvent.click(screen.getByRole('button', { name: /cadastrar/i }));

  await waitFor(() =>
    expect(api.createChannel).toHaveBeenCalledWith(
      {
        type: 'meta_cloud',
        name: 'Suporte',
        phoneNumber: '+5511999990000',
        phoneNumberId: '123456',
        accessToken: 'tok-meta',
        wabaId: 'waba-1',
      },
      'tok-123'
    )
  );
});
```

Do not change any other existing test in this file.

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- CreateChannelForm.test.jsx` (from `frontend/`)
Expected: FAIL — `getByLabelText(/waba id/i)` finds nothing yet.

- [ ] **Step 4: Add the `wabaId` field to `CreateChannelForm.jsx`**

Add `const [wabaId, setWabaId] = useState('');` alongside the other `useState` calls. Update the payload construction:

```jsx
const payload =
  type === 'meta_cloud' ? { type, name, phoneNumber, phoneNumberId, accessToken, wabaId } : { type, name, phoneNumber };
```

Reset it alongside the other fields on success:

```jsx
setWabaId('');
```

Add the input inside the existing `{type === 'meta_cloud' && (...)}` block, after the Access Token field:

```jsx
<div>
  <label htmlFor="wabaId" className="mb-1 block text-sm text-gray-600">
    WABA ID
  </label>
  <input
    id="wabaId"
    value={wabaId}
    onChange={(e) => setWabaId(e.target.value)}
    className="w-full rounded border border-gray-300 px-3 py-2"
    required
  />
</div>
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- CreateChannelForm.test.jsx`
Expected: PASS, including every pre-existing test in this file.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/services/api.js frontend/src/components/CreateChannelForm.jsx frontend/src/components/CreateChannelForm.test.jsx
git commit -m "feat: collect wabaId when creating a meta_cloud channel"
```

- [ ] **Step 7: Write the failing `AdminChannelsPage` test for editing an existing channel's WABA ID**

Read `frontend/src/pages/AdminChannelsPage.test.jsx`'s existing channel-list test setup first, then add:

```jsx
test('lets an admin edit the WABA ID of a meta_cloud channel', async () => {
  useChannels.mockReturnValue({
    channels: [{ id: 'ch1', type: 'meta_cloud', name: 'Oficial', phoneNumber: '+5511999990000', status: 'disconnected', triageEnabled: false, wabaId: 'old-waba' }],
    loading: false,
    refresh: vi.fn(),
  });
  setChannelWabaId.mockResolvedValue({});
  render(<AdminChannelsPage />);

  const input = screen.getByLabelText(/waba id/i);
  await userEvent.clear(input);
  await userEvent.type(input, 'new-waba');
  await userEvent.click(screen.getByRole('button', { name: /salvar waba id/i }));

  await waitFor(() => expect(setChannelWabaId).toHaveBeenCalledWith('ch1', 'new-waba', 'tok-123'));
});

test('does not show a WABA ID field for a baileys channel', () => {
  useChannels.mockReturnValue({
    channels: [{ id: 'ch1', type: 'baileys', name: 'Berg', phoneNumber: '+5598985004187', status: 'connected' }],
    loading: false,
    refresh: vi.fn(),
  });
  render(<AdminChannelsPage />);
  expect(screen.queryByLabelText(/waba id/i)).not.toBeInTheDocument();
});
```

Add `import { setChannelWabaId } from '../services/api';` and mock it alongside this file's existing `vi.mock('../services/api')`.

- [ ] **Step 8: Run the tests to verify they fail**

Run: `npm test -- AdminChannelsPage.test.jsx`
Expected: FAIL — no WABA ID field exists yet.

- [ ] **Step 9: Add the inline WABA ID editor to `AdminChannelsPage.jsx`**

Add state and a handler near `handleToggleTriage`:

```jsx
const [wabaIdDrafts, setWabaIdDrafts] = useState({});
const [wabaIdError, setWabaIdError] = useState(null);

async function handleSaveWabaId(channelId) {
  setWabaIdError(null);
  try {
    await setChannelWabaId(channelId, wabaIdDrafts[channelId], token);
    refresh();
  } catch (err) {
    setWabaIdError((err.body && err.body.error) || 'Falha ao atualizar o WABA ID');
  }
}
```

Add the import: `import { setChannelTriageEnabled, setChannelWabaId } from '../services/api';`.

Inside the channel-row `<div>`, right after the triage-toggle `<label>`, add (only rendered for `meta_cloud` channels):

```jsx
{channel.type === 'meta_cloud' && (
  <div className="mt-2 flex items-center gap-2">
    <label htmlFor={`waba-id-${channel.id}`} className="text-sm text-gray-600">
      WABA ID
    </label>
    <input
      id={`waba-id-${channel.id}`}
      value={wabaIdDrafts[channel.id] ?? channel.wabaId ?? ''}
      onChange={(e) => setWabaIdDrafts((prev) => ({ ...prev, [channel.id]: e.target.value }))}
      className="rounded border border-gray-300 px-2 py-1 text-sm"
    />
    <button
      onClick={() => handleSaveWabaId(channel.id)}
      className="rounded bg-gray-200 px-2 py-1 text-sm text-gray-700"
    >
      Salvar WABA ID
    </button>
  </div>
)}
```

Add `{wabaIdError && <p className="text-sm text-red-600">{wabaIdError}</p>}` right after `{triageToggleError && ...}`.

- [ ] **Step 10: Run the tests to verify they pass, including pre-existing ones**

Run: `npm test -- AdminChannelsPage.test.jsx`
Expected: PASS — every pre-existing test plus the two new ones (the `id={`waba-id-${channel.id}`}`/`htmlFor` pairing gives each row's input a unique accessible label even with several meta_cloud channels on screen at once, so `getByLabelText` in the single-channel test above resolves unambiguously).

- [ ] **Step 11: Commit**

```bash
git add frontend/src/pages/AdminChannelsPage.jsx frontend/src/pages/AdminChannelsPage.test.jsx
git commit -m "feat: let an admin edit a meta_cloud channel's WABA ID"
```

---

### Task 10: Frontend — Templates admin tab

**Files:**
- Modify: `frontend/src/services/api.js`
- Create: `frontend/src/hooks/useTemplates.js`
- Create: `frontend/src/hooks/useTemplates.test.jsx`
- Create: `frontend/src/components/TemplatesAdminTab.jsx`
- Create: `frontend/src/components/TemplatesAdminTab.test.jsx`
- Modify: `frontend/src/pages/AdminChannelsPage.jsx`
- Modify: `frontend/src/pages/AdminChannelsPage.test.jsx`

**Interfaces:**
- Consumes: `GET/POST/DELETE /api/admin/templates`, `POST /api/admin/templates/sync` (Task 5); `useChannels` (existing hook, for the channel picker in the create form).
- Produces: `useTemplates()` → `{templates, loading, refresh}`, consumed only within this task.

- [ ] **Step 1: Add the API functions**

In `frontend/src/services/api.js`, add:

```js
export function listTemplatesAdmin(token) {
  return apiFetch('/api/admin/templates', { token });
}

export function createTemplateAdmin(data, token) {
  return apiFetch('/api/admin/templates', { method: 'POST', body: data, token });
}

export function deleteTemplateAdmin(id, token) {
  return apiFetch(`/api/admin/templates/${id}`, { method: 'DELETE', token });
}

export function syncTemplatesAdmin(wabaId, token) {
  return apiFetch('/api/admin/templates/sync', { method: 'POST', body: { wabaId }, token });
}
```

- [ ] **Step 2: Write the failing `useTemplates` test**

Mirror `frontend/src/hooks/useTriage.test.jsx`'s structure exactly (read it first for its `useAuth`/`listTemplatesAdmin` mocking pattern):

```jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useTemplates } from './useTemplates';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
});

describe('useTemplates', () => {
  test('fetches templates on mount', async () => {
    api.listTemplatesAdmin.mockResolvedValue([{ id: 'tpl-1', name: 'fatura_vencida' }]);
    const { result } = renderHook(() => useTemplates());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.templates).toEqual([{ id: 'tpl-1', name: 'fatura_vencida' }]);
  });

  test('refresh re-fetches the list', async () => {
    api.listTemplatesAdmin.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'tpl-2' }]);
    const { result } = renderHook(() => useTemplates());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.templates).toEqual([{ id: 'tpl-2' }]);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- useTemplates.test.jsx` (from `frontend/`)
Expected: FAIL with "Cannot find module './useTemplates'"

- [ ] **Step 4: Implement the hook**

Mirror `frontend/src/hooks/useTriage.js`'s exact structure:

```jsx
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { listTemplatesAdmin } from '../services/api';

export function useTemplates() {
  const { token } = useAuth();
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const data = await listTemplatesAdmin(token);
    setTemplates(data);
  }, [token]);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  return { templates, loading, refresh };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- useTemplates.test.jsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/services/api.js frontend/src/hooks/useTemplates.js frontend/src/hooks/useTemplates.test.jsx
git commit -m "feat: add useTemplates hook and admin template API functions"
```

- [ ] **Step 7: Write the failing `TemplatesAdminTab` tests**

```jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TemplatesAdminTab from './TemplatesAdminTab';
import { useTemplates } from '../hooks/useTemplates';
import { useChannels } from '../hooks/useChannels';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../hooks/useTemplates');
vi.mock('../hooks/useChannels');
vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
  useChannels.mockReturnValue({ channels: [{ id: 'ch-1', type: 'meta_cloud', name: 'Oficial', wabaId: 'waba-1' }] });
});

describe('TemplatesAdminTab', () => {
  test('lists templates with their status', () => {
    useTemplates.mockReturnValue({
      templates: [{ id: 'tpl-1', name: 'fatura_vencida', language: 'pt_BR', category: 'UTILITY', status: 'APPROVED', rejectionReason: null }],
      refresh: vi.fn(),
    });
    render(<TemplatesAdminTab />);
    expect(screen.getByText('fatura_vencida')).toBeInTheDocument();
    expect(screen.getByText('APPROVED')).toBeInTheDocument();
  });

  test('shows the rejection reason for a rejected template', () => {
    useTemplates.mockReturnValue({
      templates: [{ id: 'tpl-1', name: 'x', language: 'pt_BR', category: 'UTILITY', status: 'REJECTED', rejectionReason: 'Invalid format' }],
      refresh: vi.fn(),
    });
    render(<TemplatesAdminTab />);
    expect(screen.getByText('Invalid format')).toBeInTheDocument();
  });

  test('creates a new template and calls refresh', async () => {
    const refresh = vi.fn();
    useTemplates.mockReturnValue({ templates: [], refresh });
    api.createTemplateAdmin.mockResolvedValue({ id: 'tpl-2', name: 'boas_vindas', status: 'PENDING' });
    render(<TemplatesAdminTab />);

    await userEvent.selectOptions(screen.getByLabelText(/canal/i), 'ch-1');
    await userEvent.type(screen.getByLabelText(/^nome$/i), 'boas_vindas');
    await userEvent.selectOptions(screen.getByLabelText(/categoria/i), 'UTILITY');
    await userEvent.type(screen.getByLabelText(/idioma/i), 'pt_BR');
    await userEvent.type(screen.getByLabelText(/corpo/i), 'Olá, bem-vindo!');
    await userEvent.click(screen.getByRole('button', { name: /cadastrar/i }));

    await waitFor(() =>
      expect(api.createTemplateAdmin).toHaveBeenCalledWith(
        { channelId: 'ch-1', name: 'boas_vindas', category: 'UTILITY', language: 'pt_BR', bodyText: 'Olá, bem-vindo!' },
        'tok-123'
      )
    );
    expect(refresh).toHaveBeenCalled();
  });

  test('shows the Meta error message when creation fails', async () => {
    useTemplates.mockReturnValue({ templates: [], refresh: vi.fn() });
    api.createTemplateAdmin.mockRejectedValue({ body: { error: 'Invalid parameter' } });
    render(<TemplatesAdminTab />);

    await userEvent.selectOptions(screen.getByLabelText(/canal/i), 'ch-1');
    await userEvent.type(screen.getByLabelText(/^nome$/i), 'x');
    await userEvent.selectOptions(screen.getByLabelText(/categoria/i), 'UTILITY');
    await userEvent.type(screen.getByLabelText(/idioma/i), 'pt_BR');
    await userEvent.type(screen.getByLabelText(/corpo/i), 'Y');
    await userEvent.click(screen.getByRole('button', { name: /cadastrar/i }));

    await waitFor(() => expect(screen.getByText('Invalid parameter')).toBeInTheDocument());
  });

  test('deletes a template after confirmation', async () => {
    const refresh = vi.fn();
    useTemplates.mockReturnValue({
      templates: [{ id: 'tpl-1', name: 'x', language: 'pt_BR', category: 'UTILITY', status: 'APPROVED', rejectionReason: null }],
      refresh,
    });
    api.deleteTemplateAdmin.mockResolvedValue(undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<TemplatesAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /excluir/i }));

    await waitFor(() => expect(api.deleteTemplateAdmin).toHaveBeenCalledWith('tpl-1', 'tok-123'));
    expect(refresh).toHaveBeenCalled();
  });

  test('syncs templates for a WABA and calls refresh', async () => {
    const refresh = vi.fn();
    useTemplates.mockReturnValue({
      templates: [{ id: 'tpl-1', name: 'x', language: 'pt_BR', category: 'UTILITY', status: 'PENDING', rejectionReason: null }],
      refresh,
    });
    api.syncTemplatesAdmin.mockResolvedValue([]);
    render(<TemplatesAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /sincronizar agora/i }));

    await waitFor(() => expect(api.syncTemplatesAdmin).toHaveBeenCalledWith('waba-1', 'tok-123'));
    expect(refresh).toHaveBeenCalled();
  });
});
```

- [ ] **Step 8: Run the tests to verify they fail**

Run: `npm test -- TemplatesAdminTab.test.jsx`
Expected: FAIL with "Cannot find module './TemplatesAdminTab'"

- [ ] **Step 9: Implement the component**

```jsx
import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTemplates } from '../hooks/useTemplates';
import { useChannels } from '../hooks/useChannels';
import { createTemplateAdmin, deleteTemplateAdmin, syncTemplatesAdmin } from '../services/api';

function TemplateRow({ template, onDeleted }) {
  const { token } = useAuth();
  const [deleteError, setDeleteError] = useState(null);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!window.confirm(`Excluir o template ${template.name}?`)) {
      return;
    }
    setDeleteError(null);
    setDeleting(true);
    try {
      await deleteTemplateAdmin(template.id, token);
      onDeleted();
    } catch (err) {
      setDeleteError((err.body && err.body.error) || 'Falha ao excluir');
      setDeleting(false);
    }
  }

  return (
    <div className="rounded border border-gray-200 p-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium text-gray-800">{template.name}</p>
          <p className="text-sm text-gray-500">
            {template.language} · {template.category} · {template.status}
          </p>
          {template.rejectionReason && <p className="text-sm text-red-600">{template.rejectionReason}</p>}
        </div>
        <button onClick={handleDelete} disabled={deleting} className="text-sm text-red-600 underline disabled:opacity-50">
          Excluir
        </button>
      </div>
      {deleteError && <p className="mt-1 text-sm text-red-600">{deleteError}</p>}
    </div>
  );
}

function TemplatesAdminTab() {
  const { token } = useAuth();
  const { templates, refresh } = useTemplates();
  const { channels } = useChannels();
  const metaCloudChannels = channels.filter((channel) => channel.type === 'meta_cloud');

  const [channelId, setChannelId] = useState(metaCloudChannels[0]?.id || '');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('UTILITY');
  const [language, setLanguage] = useState('pt_BR');
  const [bodyText, setBodyText] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [syncError, setSyncError] = useState(null);

  const wabaIds = [...new Set(metaCloudChannels.map((channel) => channel.wabaId).filter(Boolean))];

  async function handleCreate(event) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await createTemplateAdmin({ channelId, name, category, language, bodyText }, token);
      setName('');
      setBodyText('');
      refresh();
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao criar template');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSync(wabaId) {
    setSyncError(null);
    try {
      await syncTemplatesAdmin(wabaId, token);
      refresh();
    } catch (err) {
      setSyncError((err.body && err.body.error) || 'Falha ao sincronizar');
    }
  }

  return (
    <div className="space-y-6">
      {wabaIds.map((wabaId) => (
        <button
          key={wabaId}
          onClick={() => handleSync(wabaId)}
          className="rounded bg-gray-200 px-3 py-1 text-sm text-gray-700"
        >
          Sincronizar agora ({wabaId})
        </button>
      ))}
      {syncError && <p className="text-sm text-red-600">{syncError}</p>}
      <div className="space-y-3">
        {templates.map((template) => (
          <TemplateRow key={template.id} template={template} onDeleted={refresh} />
        ))}
      </div>
      <form onSubmit={handleCreate} className="space-y-3 rounded border border-gray-200 p-4">
        <h3 className="font-semibold text-gray-800">Cadastrar novo template</h3>
        <div>
          <label htmlFor="template-channel" className="mb-1 block text-sm text-gray-600">
            Canal
          </label>
          <select
            id="template-channel"
            value={channelId}
            onChange={(e) => setChannelId(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2"
            required
          >
            {metaCloudChannels.map((channel) => (
              <option key={channel.id} value={channel.id}>
                {channel.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="template-name" className="mb-1 block text-sm text-gray-600">
            Nome
          </label>
          <input
            id="template-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="fatura_vencida"
            className="w-full rounded border border-gray-300 px-3 py-2"
            required
          />
        </div>
        <div>
          <label htmlFor="template-category" className="mb-1 block text-sm text-gray-600">
            Categoria
          </label>
          <select
            id="template-category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2"
          >
            <option value="UTILITY">Utilidade</option>
            <option value="MARKETING">Marketing</option>
          </select>
        </div>
        <div>
          <label htmlFor="template-language" className="mb-1 block text-sm text-gray-600">
            Idioma
          </label>
          <input
            id="template-language"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2"
            required
          />
        </div>
        <div>
          <label htmlFor="template-body" className="mb-1 block text-sm text-gray-600">
            Corpo da mensagem
          </label>
          <textarea
            id="template-body"
            value={bodyText}
            onChange={(e) => setBodyText(e.target.value)}
            placeholder="Olá {{1}}, sua fatura de {{2}} venceu."
            className="w-full rounded border border-gray-300 px-3 py-2"
            required
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" disabled={submitting} className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50">
          Cadastrar
        </button>
      </form>
    </div>
  );
}

export default TemplatesAdminTab;
```

Note: the test's `getByLabelText(/^nome$/i)` anchors on the exact word "Nome" to disambiguate from "Nome do template" if this label text is ever changed later — keep the label exactly `Nome`.

- [ ] **Step 10: Run the tests to verify they pass**

Run: `npm test -- TemplatesAdminTab.test.jsx`
Expected: PASS, all 6 tests green.

- [ ] **Step 11: Commit**

```bash
git add frontend/src/components/TemplatesAdminTab.jsx frontend/src/components/TemplatesAdminTab.test.jsx
git commit -m "feat: add the Templates admin tab"
```

- [ ] **Step 12: Write the failing `AdminChannelsPage` tab-wiring test**

```jsx
test('switches to the Templates tab and shows the templates management UI', async () => {
  useChannels.mockReturnValue({
    channels: [{ id: 'ch1', type: 'meta_cloud', name: 'Oficial', phoneNumber: '+5511999990000', status: 'disconnected', wabaId: 'waba-1' }],
    loading: false,
    refresh: vi.fn(),
  });
  useTemplates.mockReturnValue({ templates: [], refresh: vi.fn() });
  render(<AdminChannelsPage />);

  await userEvent.click(screen.getByRole('button', { name: /templates/i }));

  expect(screen.getByText(/cadastrar novo template/i)).toBeInTheDocument();
});
```

Add `import { useTemplates } from '../hooks/useTemplates';` and `vi.mock('../hooks/useTemplates');` at the top of the file, with a default `useTemplates.mockReturnValue({ templates: [], refresh: vi.fn() });` in the shared `beforeEach`.

- [ ] **Step 13: Run the test to verify it fails**

Run: `npm test -- AdminChannelsPage.test.jsx`
Expected: FAIL — there is no "Templates" tab button yet.

- [ ] **Step 14: Wire the tab into `AdminChannelsPage.jsx`**

Add the import: `import TemplatesAdminTab from '../components/TemplatesAdminTab';`. Add a tab button after the existing "Triagem" button:

```jsx
<button
  onClick={() => setActiveTab('templates')}
  className={`px-3 py-2 text-sm ${
    activeTab === 'templates' ? 'border-b-2 border-blue-600 font-semibold text-blue-600' : 'text-gray-500'
  }`}
>
  Templates
</button>
```

Change the final `) : (` branch of the tab-content ternary chain from rendering `<TriageAdminTab />` unconditionally to:

```jsx
) : activeTab === 'triage' ? (
  <TriageAdminTab />
) : (
  <TemplatesAdminTab />
)}
```

- [ ] **Step 15: Run the tests to verify they pass, including every pre-existing one**

Run: `npm test -- AdminChannelsPage.test.jsx`
Expected: PASS.

- [ ] **Step 16: Run the full frontend suite**

Run: `npm test -- --run` (from `frontend/`)
Expected: PASS.

- [ ] **Step 17: Commit**

```bash
git add frontend/src/pages/AdminChannelsPage.jsx frontend/src/pages/AdminChannelsPage.test.jsx
git commit -m "feat: wire the Templates tab into the admin page"
```

---

### Task 11: Frontend — Meta Cloud path in Start Conversation

**Files:**
- Modify: `frontend/src/services/api.js`
- Modify: `frontend/src/components/StartConversationModal.jsx`
- Modify: `frontend/src/components/StartConversationModal.test.jsx`

**Interfaces:**
- Consumes: `GET /api/templates?channelId=` (Task 5), `POST /api/conversations/start` with the `templateId`/`templateVariables` shape (Task 8).

- [ ] **Step 1: Update the API functions**

In `frontend/src/services/api.js`, add:

```js
export function listTemplatesForChannel(channelId, token) {
  return apiFetch(`/api/templates?channelId=${channelId}`, { token });
}
```

Replace `startConversation`:

```js
export function startConversation({ channelId, phoneNumber, content, templateId, templateVariables }, token) {
  return apiFetch('/api/conversations/start', {
    method: 'POST',
    body: { channelId, phoneNumber, content, templateId, templateVariables },
    token,
  });
}
```

- [ ] **Step 2: Read the existing modal tests, then write the failing new ones**

Read `frontend/src/components/StartConversationModal.test.jsx` fully first — this task changes the channel-eligibility filter from `type === 'baileys' && status === 'connected'` to also including any `type === 'meta_cloud'` channel regardless of `status` (meta_cloud has no live-connection concept; `status` on those rows is a leftover default that's never updated). Update any existing test whose channel fixture list assumed only Baileys channels could ever appear.

Add:

```jsx
test('shows the template banner and dropdown for a meta_cloud channel', async () => {
  listChannelsForAgent.mockResolvedValue([
    { id: 'ch-1', type: 'meta_cloud', name: 'Oficial', status: 'disconnected' },
  ]);
  listTemplatesForChannel.mockResolvedValue([
    { id: 'tpl-1', name: 'fatura_vencida', variableCount: 2 },
  ]);
  render(<StartConversationModal onClose={vi.fn()} onCreated={vi.fn()} />);

  await waitFor(() => expect(screen.getByText(/requer o uso de template/i)).toBeInTheDocument());
  expect(screen.getByLabelText(/template/i)).toBeInTheDocument();
});

test('renders one input per template variable and submits them with the template id', async () => {
  const onCreated = vi.fn();
  listChannelsForAgent.mockResolvedValue([{ id: 'ch-1', type: 'meta_cloud', name: 'Oficial', status: 'disconnected' }]);
  listTemplatesForChannel.mockResolvedValue([{ id: 'tpl-1', name: 'fatura_vencida', variableCount: 2 }]);
  startConversation.mockResolvedValue({ id: 'conv-1' });
  render(<StartConversationModal onClose={vi.fn()} onCreated={onCreated} />);

  await waitFor(() => expect(screen.getByLabelText(/template/i)).toBeInTheDocument());
  const variableInputs = screen.getAllByLabelText(/variável/i);
  expect(variableInputs).toHaveLength(2);
  await userEvent.type(variableInputs[0], 'João');
  await userEvent.type(variableInputs[1], 'R$150,00');
  await userEvent.type(screen.getByLabelText(/telefone/i), '5511999990000');
  await userEvent.click(screen.getByRole('button', { name: /iniciar/i }));

  await waitFor(() =>
    expect(startConversation).toHaveBeenCalledWith(
      { channelId: 'ch-1', phoneNumber: '5511999990000', templateId: 'tpl-1', templateVariables: ['João', 'R$150,00'] },
      'tok-123'
    )
  );
  expect(onCreated).toHaveBeenCalledWith({ id: 'conv-1' });
});

test('lists both baileys and meta_cloud channels together', async () => {
  listChannelsForAgent.mockResolvedValue([
    { id: 'ch-1', type: 'baileys', name: 'Berg', status: 'connected' },
    { id: 'ch-2', type: 'meta_cloud', name: 'Oficial', status: 'disconnected' },
  ]);
  listTemplatesForChannel.mockResolvedValue([]);
  render(<StartConversationModal onClose={vi.fn()} onCreated={vi.fn()} />);

  await waitFor(() => expect(screen.getByRole('option', { name: 'Berg' })).toBeInTheDocument());
  expect(screen.getByRole('option', { name: 'Oficial' })).toBeInTheDocument();
});

test('excludes a disconnected baileys channel but still includes a disconnected meta_cloud one', async () => {
  listChannelsForAgent.mockResolvedValue([
    { id: 'ch-1', type: 'baileys', name: 'Berg', status: 'disconnected' },
    { id: 'ch-2', type: 'meta_cloud', name: 'Oficial', status: 'disconnected' },
  ]);
  listTemplatesForChannel.mockResolvedValue([]);
  render(<StartConversationModal onClose={vi.fn()} onCreated={vi.fn()} />);

  await waitFor(() => expect(screen.getByRole('option', { name: 'Oficial' })).toBeInTheDocument());
  expect(screen.queryByRole('option', { name: 'Berg' })).not.toBeInTheDocument();
});
```

Add `import { listChannelsForAgent, startConversation, listTemplatesForChannel } from '../services/api';` (extending the existing import) and `vi.mock('../services/api')` if not already present in this file (check first — it may already mock this module for the existing tests).

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -- StartConversationModal.test.jsx`
Expected: FAIL — no template banner/dropdown exists yet, and the eligibility filter still excludes every `meta_cloud` channel.

- [ ] **Step 4: Rewrite `StartConversationModal.jsx`**

```jsx
import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { listChannelsForAgent, startConversation, listTemplatesForChannel } from '../services/api';

function StartConversationModal({ onClose, onCreated }) {
  const { token } = useAuth();
  const [channels, setChannels] = useState([]);
  const [channelId, setChannelId] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('55');
  const [content, setContent] = useState('');
  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState('');
  const [templateVariableValues, setTemplateVariableValues] = useState([]);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    listChannelsForAgent(token)
      .then((data) => {
        const eligible = data.filter(
          (channel) => (channel.type === 'baileys' && channel.status === 'connected') || channel.type === 'meta_cloud'
        );
        setChannels(eligible);
        if (eligible.length > 0) {
          setChannelId(eligible[0].id);
        }
      })
      .catch(() => {
        setLoadError(true);
      })
      .finally(() => setLoading(false));
  }, [token]);

  const selectedChannel = channels.find((channel) => channel.id === channelId);
  const isMetaCloud = selectedChannel && selectedChannel.type === 'meta_cloud';
  const selectedTemplate = templates.find((tpl) => tpl.id === templateId);

  useEffect(() => {
    if (!isMetaCloud || !channelId) {
      setTemplates([]);
      setTemplateId('');
      return;
    }
    listTemplatesForChannel(channelId, token).then((data) => {
      setTemplates(data);
      setTemplateId(data[0]?.id || '');
    });
  }, [isMetaCloud, channelId, token]);

  useEffect(() => {
    setTemplateVariableValues(selectedTemplate ? Array(selectedTemplate.variableCount).fill('') : []);
  }, [selectedTemplate]);

  function handleVariableChange(index, value) {
    setTemplateVariableValues((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const conversation = isMetaCloud
        ? await startConversation({ channelId, phoneNumber, templateId, templateVariables: templateVariableValues }, token)
        : await startConversation({ channelId, phoneNumber, content }, token);
      onCreated(conversation);
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao iniciar conversa');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/40">
      <div className="w-[90vw] max-w-80 rounded bg-white p-4 shadow">
        <h3 className="mb-3 font-semibold text-gray-800">Iniciar conversa</h3>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label htmlFor="start-conversation-channel" className="mb-1 block text-sm text-gray-600">
              Canal
            </label>
            {loading ? (
              <p className="text-sm text-gray-500">Carregando canais...</p>
            ) : loadError ? (
              <p className="text-sm text-red-600">Não foi possível carregar os canais. Feche e tente novamente.</p>
            ) : channels.length === 0 ? (
              <p className="text-sm text-gray-500">Nenhum canal conectado no momento.</p>
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
          {isMetaCloud ? (
            <>
              <p className="rounded border border-blue-200 bg-blue-50 p-2 text-sm text-blue-800">
                Este canal requer o uso de template para iniciar o atendimento!
              </p>
              <div>
                <label htmlFor="start-conversation-template" className="mb-1 block text-sm text-gray-600">
                  Template
                </label>
                {templates.length === 0 ? (
                  <p className="text-sm text-gray-500">Nenhum template aprovado para este canal.</p>
                ) : (
                  <select
                    id="start-conversation-template"
                    value={templateId}
                    onChange={(e) => setTemplateId(e.target.value)}
                    className="w-full rounded border border-gray-300 px-3 py-2"
                  >
                    {templates.map((tpl) => (
                      <option key={tpl.id} value={tpl.id}>
                        {tpl.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              {templateVariableValues.map((value, index) => (
                <div key={index}>
                  <label htmlFor={`start-conversation-variable-${index}`} className="mb-1 block text-sm text-gray-600">
                    Variável {index + 1}
                  </label>
                  <input
                    id={`start-conversation-variable-${index}`}
                    value={value}
                    onChange={(e) => handleVariableChange(index, e.target.value)}
                    className="w-full rounded border border-gray-300 px-3 py-2"
                    required
                  />
                </div>
              ))}
            </>
          ) : (
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
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitting || loading || loadError || channels.length === 0 || (isMetaCloud && templates.length === 0)}
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

Each variable input's `htmlFor`/`id` is `start-conversation-variable-${index}`, not a shared label — `screen.getAllByLabelText(/variável/i)` in the test matches all of them since each one's visible label text starts with "Variável".

- [ ] **Step 5: Run the tests to verify they pass, including pre-existing ones**

Run: `npm test -- StartConversationModal.test.jsx`
Expected: PASS.

- [ ] **Step 6: Run the full frontend suite**

Run: `npm test -- --run` (from `frontend/`)
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/services/api.js frontend/src/components/StartConversationModal.jsx frontend/src/components/StartConversationModal.test.jsx
git commit -m "feat: start a Meta Cloud conversation with an approved template from the UI"
```
