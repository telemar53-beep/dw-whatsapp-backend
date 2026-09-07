# Integração SGP com o WhatsApp Oficial (Meta Cloud) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the SGP trigger WhatsApp messages via the official Meta Cloud API (template + optional media header), alongside the already-working Baileys free-text integration.

**Architecture:** `platform_integrations` becomes a list (was a singleton) — one row per SGP gateway registration, each with a `mode` derived from its channel's type (`baileys` → `freetext`, `meta_cloud` → `template`). The existing `GET /api/integrations/sgp/messages` endpoint branches on `mode`: `freetext` is unchanged (Baileys); `template` parses a new DSL string (`variables=...||header_link=...||header_type=...||template=<name>`) mirroring the Chat Mix convention already configured on the SGP side, looks up the template by name, and sends via the existing outbound queue (extended with `headerType`/`headerLink`).

**Tech Stack:** Node.js/Express, PostgreSQL (`node-pg-migrate`), Bull/Redis (existing outbound queue), Meta Graph API (WhatsApp Cloud API), React 18 (frontend admin).

**Spec:** `docs/superpowers/specs/2026-09-07-sgp-meta-cloud-integration-design.md` (extends `docs/superpowers/specs/2026-09-07-sgp-integration-design.md`)

## Global Constraints

- `mode` on a `platform_integrations` row is always derived from its `channel_id`'s channel type — never accepted directly from an API client. `baileys` → `'freetext'`, `meta_cloud` → `'template'`.
- The SGP "Mensagem" DSL for template mode is `variables=v1|v2|...|vN||header_link=<url>||header_type=<document|image|video>||template=<name>` — `header_link`/`header_type` must appear together or not at all.
- Template-mode sends reuse `enqueueOutboundMessage`/`outbound-worker.js` exactly like `POST /api/conversations/start`'s Meta Cloud branch already does — never a direct/synchronous call to the Meta adapter from the route handler.
- Header media is referenced by `link` (a public URL Meta fetches itself) — never downloaded/re-uploaded by this system.
- The `no_key` status from the old singleton `verifySgpApiKey` is retired; the only statuses now are `not_configured`, `invalid`, `disabled`, `ok`.
- ⚠️ Both new migrations must run in production immediately after deploy — forgetting breaks the already-live Baileys SGP integration, not just the new feature (see spec's Migração section).

---

### Task 1: Migrations — multi-gateway `platform_integrations` + `header_type` on `message_templates`

**Files:**
- Create: `migrations/1788800000000_alter-platform-integrations-for-multi-gateway.js`
- Create: `migrations/1788810000000_add-header-type-to-message-templates.js`

**Interfaces:**
- Produces: `platform_integrations` gains `description TEXT NOT NULL DEFAULT ''`, `mode TEXT NOT NULL DEFAULT 'freetext' CHECK (mode IN ('freetext','template'))`, `default_template_id UUID REFERENCES message_templates(id) ON DELETE SET NULL`; loses its `UNIQUE(platform)` constraint (confirmed name: `platform_integrations_platform_key`). `message_templates` gains `header_type TEXT CHECK (header_type IN ('document','image','video'))`.

- [ ] **Step 1: Write the first migration**

```js
// migrations/1788800000000_alter-platform-integrations-for-multi-gateway.js
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE platform_integrations
      DROP CONSTRAINT platform_integrations_platform_key,
      ADD COLUMN description TEXT NOT NULL DEFAULT '',
      ADD COLUMN mode TEXT NOT NULL DEFAULT 'freetext' CHECK (mode IN ('freetext', 'template')),
      ADD COLUMN default_template_id UUID REFERENCES message_templates(id) ON DELETE SET NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE platform_integrations
      DROP COLUMN default_template_id,
      DROP COLUMN mode,
      DROP COLUMN description,
      ADD CONSTRAINT platform_integrations_platform_key UNIQUE (platform);
  `);
};
```

- [ ] **Step 2: Write the second migration**

```js
// migrations/1788810000000_add-header-type-to-message-templates.js
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE message_templates
      ADD COLUMN header_type TEXT CHECK (header_type IN ('document', 'image', 'video'));
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE message_templates
      DROP COLUMN header_type;
  `);
};
```

- [ ] **Step 3: Apply both migrations to the local test database**

Run: `npm run migrate:test -- up`
Expected: both new migrations listed as applied, no errors.

- [ ] **Step 4: Verify the schema landed correctly**

```bash
node -e "
const { Client } = require('pg');
require('dotenv').config({ path: '.env.test' });
const c = new Client({ connectionString: process.env.DATABASE_URL });
c.connect().then(async () => {
  const cols = await c.query(\"SELECT column_name FROM information_schema.columns WHERE table_name = 'platform_integrations' AND column_name IN ('description','mode','default_template_id')\");
  console.log('platform_integrations new columns:', cols.rows.map((r) => r.column_name));
  const uniq = await c.query(\"SELECT conname FROM pg_constraint WHERE conrelid = 'platform_integrations'::regclass AND contype = 'u'\");
  console.log('unique constraints remaining:', uniq.rows.map((r) => r.conname));
  const headerCol = await c.query(\"SELECT column_name FROM information_schema.columns WHERE table_name = 'message_templates' AND column_name = 'header_type'\");
  console.log('message_templates header_type present:', headerCol.rowCount === 1);
  await c.end();
});
"
```

Expected: `platform_integrations new columns: [ 'description', 'mode', 'default_template_id' ]` (order may vary), `unique constraints remaining: []` (the old `UNIQUE(platform)` is gone), `message_templates header_type present: true`.

- [ ] **Step 5: Commit**

```bash
git add migrations/1788800000000_alter-platform-integrations-for-multi-gateway.js migrations/1788810000000_add-header-type-to-message-templates.js
git commit -m "Add migrations for multi-gateway SGP integrations and template header type"
```

---

### Task 2: `sgp-integration.repository.js` — rewrite for multiple gateway registrations

**Files:**
- Modify: `src/integrations/sgp-integration.repository.js`
- Modify (full rewrite): `src/integrations/sgp-integration.repository.test.js`

**Interfaces:**
- Consumes: Task 1's schema.
- Produces (consumed by Task 3's admin routes and Task 10's public route):
  - `listSgpIntegrations()` → `Promise<Integration[]>`
  - `createSgpIntegration({description, channelId, mode, defaultTemplateId, enabled})` → `Promise<Integration>`
  - `updateSgpIntegration(id, {description, channelId, mode, defaultTemplateId, enabled})` → `Promise<Integration|null>`
  - `rotateSgpApiKey(id)` → `Promise<{apiKey: string, integration: Integration}|null>`
  - `verifySgpApiKey(candidateKey)` → `Promise<{status:'not_configured'}|{status:'invalid'}|{status:'disabled'}|{status:'ok', channelId, mode, defaultTemplateId}>`
  - `findSgpDispatchByReferenceId`/`createSgpDispatch` — unchanged from before.
  - `Integration` shape: `{id, description, channelId, mode, defaultTemplateId, enabled, hasApiKey, createdAt, updatedAt}`.

- [ ] **Step 1: Write the failing tests (full replacement of the test file)**

Replace the entire content of `src/integrations/sgp-integration.repository.test.js` with:

```js
const { getPool, closePool } = require('../db/pool');
const { createChannel } = require('../channels/channel.repository');
const { findOrCreateContactByPhoneNumber } = require('../conversations/contact.repository');
const { createConversation } = require('../conversations/conversation.repository');
const { createMessage } = require('../conversations/message.repository');
const {
  listSgpIntegrations,
  createSgpIntegration,
  updateSgpIntegration,
  rotateSgpApiKey,
  verifySgpApiKey,
  findSgpDispatchByReferenceId,
  createSgpDispatch,
} = require('./sgp-integration.repository');

describe('sgp integration repository', () => {
  let channelId;
  let otherChannelId;
  let conversationId;
  let messageId;

  beforeEach(async () => {
    await getPool().query('TRUNCATE platform_integrations, sgp_dispatches, conversations, contacts, channels CASCADE');
    const channel = await createChannel({ type: 'baileys', name: 'Berg', phoneNumber: '+5598900000000', config: {} });
    channelId = channel.id;
    const otherChannel = await createChannel({ type: 'baileys', name: 'Outro', phoneNumber: '+5598900000001', config: {} });
    otherChannelId = otherChannel.id;
    const contact = await findOrCreateContactByPhoneNumber('+5511988885555', 'Cliente SGP');
    const conversation = await createConversation(contact.id, channelId);
    conversationId = conversation.id;
    const message = await createMessage({
      conversationId, direction: 'outbound', content: 'Oi', whatsappMessageId: null, status: 'sent',
    });
    messageId = message.id;
  });

  afterAll(async () => {
    await closePool();
  });

  test('listSgpIntegrations returns an empty array when none exist', async () => {
    expect(await listSgpIntegrations()).toEqual([]);
  });

  test('createSgpIntegration creates a new row with hasApiKey false', async () => {
    const integration = await createSgpIntegration({ description: 'Baileys', channelId, mode: 'freetext', defaultTemplateId: null, enabled: true });
    expect(integration.description).toBe('Baileys');
    expect(integration.channelId).toBe(channelId);
    expect(integration.mode).toBe('freetext');
    expect(integration.defaultTemplateId).toBeNull();
    expect(integration.enabled).toBe(true);
    expect(integration.hasApiKey).toBe(false);
  });

  test('listSgpIntegrations returns multiple integrations, oldest first', async () => {
    const first = await createSgpIntegration({ description: 'Baileys', channelId, mode: 'freetext', defaultTemplateId: null, enabled: true });
    const second = await createSgpIntegration({ description: 'Oficial', channelId: otherChannelId, mode: 'template', defaultTemplateId: null, enabled: true });
    const all = await listSgpIntegrations();
    expect(all.map((i) => i.id)).toEqual([first.id, second.id]);
  });

  test('updateSgpIntegration updates fields without touching the api key', async () => {
    const created = await createSgpIntegration({ description: 'Baileys', channelId, mode: 'freetext', defaultTemplateId: null, enabled: true });
    await rotateSgpApiKey(created.id);

    const updated = await updateSgpIntegration(created.id, { description: 'Baileys renomeado', channelId: otherChannelId, mode: 'freetext', defaultTemplateId: null, enabled: false });

    expect(updated.description).toBe('Baileys renomeado');
    expect(updated.channelId).toBe(otherChannelId);
    expect(updated.enabled).toBe(false);
    expect(updated.hasApiKey).toBe(true);
  });

  test('updateSgpIntegration returns null for a non-existent id', async () => {
    expect(await updateSgpIntegration('00000000-0000-0000-0000-000000000000', { description: 'x', channelId, mode: 'freetext', defaultTemplateId: null, enabled: true })).toBeNull();
  });

  test('rotateSgpApiKey returns null for a non-existent id', async () => {
    expect(await rotateSgpApiKey('00000000-0000-0000-0000-000000000000')).toBeNull();
  });

  test('rotateSgpApiKey generates a plain key and stores only its hash', async () => {
    const created = await createSgpIntegration({ description: 'Baileys', channelId, mode: 'freetext', defaultTemplateId: null, enabled: true });

    const rotated = await rotateSgpApiKey(created.id);

    expect(typeof rotated.apiKey).toBe('string');
    expect(rotated.apiKey.length).toBeGreaterThan(20);
    expect(rotated.integration.hasApiKey).toBe(true);
  });

  test('verifySgpApiKey reports not_configured when there are no integrations at all', async () => {
    expect(await verifySgpApiKey('anything')).toEqual({ status: 'not_configured' });
  });

  test('verifySgpApiKey reports invalid when integrations exist but none have a matching key', async () => {
    await createSgpIntegration({ description: 'Baileys', channelId, mode: 'freetext', defaultTemplateId: null, enabled: true });
    expect(await verifySgpApiKey('anything')).toEqual({ status: 'invalid' });
  });

  test('verifySgpApiKey reports disabled when the matching integration is turned off', async () => {
    const created = await createSgpIntegration({ description: 'Baileys', channelId, mode: 'freetext', defaultTemplateId: null, enabled: false });
    const rotated = await rotateSgpApiKey(created.id);

    expect(await verifySgpApiKey(rotated.apiKey)).toEqual({ status: 'disabled' });
  });

  test('verifySgpApiKey reports ok with channelId/mode/defaultTemplateId for the correct key', async () => {
    const created = await createSgpIntegration({ description: 'Baileys', channelId, mode: 'freetext', defaultTemplateId: null, enabled: true });
    const rotated = await rotateSgpApiKey(created.id);

    expect(await verifySgpApiKey(rotated.apiKey)).toEqual({ status: 'ok', channelId, mode: 'freetext', defaultTemplateId: null });
  });

  test('verifySgpApiKey distinguishes between two different registered integrations by key', async () => {
    const first = await createSgpIntegration({ description: 'Baileys', channelId, mode: 'freetext', defaultTemplateId: null, enabled: true });
    const firstKey = (await rotateSgpApiKey(first.id)).apiKey;
    const second = await createSgpIntegration({ description: 'Oficial', channelId: otherChannelId, mode: 'template', defaultTemplateId: null, enabled: true });
    const secondKey = (await rotateSgpApiKey(second.id)).apiKey;

    expect(await verifySgpApiKey(firstKey)).toEqual({ status: 'ok', channelId, mode: 'freetext', defaultTemplateId: null });
    expect(await verifySgpApiKey(secondKey)).toEqual({ status: 'ok', channelId: otherChannelId, mode: 'template', defaultTemplateId: null });
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
    await expect(createSgpDispatch({ referenceId: 'boleto-2', conversationId, messageId })).rejects.toMatchObject({ code: '23505' });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx dotenv -e .env.test -o -- jest src/integrations/sgp-integration.repository.test.js`
Expected: FAIL — the old singleton functions (`getSgpIntegration`, `saveSgpIntegrationChannel`) don't match these new imports; `listSgpIntegrations` etc. are not exported yet.

- [ ] **Step 3: Replace `src/integrations/sgp-integration.repository.js` entirely**

```js
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { getPool } = require('../db/pool');

const SALT_ROUNDS = 10;

function toIntegration(row) {
  return {
    id: row.id,
    description: row.description,
    channelId: row.channel_id,
    mode: row.mode,
    defaultTemplateId: row.default_template_id,
    enabled: row.enabled,
    hasApiKey: row.api_key_hash !== null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function listSgpIntegrations() {
  const result = await getPool().query(
    `SELECT id, description, channel_id, mode, default_template_id, enabled, api_key_hash, created_at, updated_at
     FROM platform_integrations WHERE platform = 'sgp' ORDER BY created_at ASC`
  );
  return result.rows.map(toIntegration);
}

async function createSgpIntegration({ description, channelId, mode, defaultTemplateId, enabled }) {
  const result = await getPool().query(
    `INSERT INTO platform_integrations (platform, description, channel_id, mode, default_template_id, enabled)
     VALUES ('sgp', $1, $2, $3, $4, $5)
     RETURNING id, description, channel_id, mode, default_template_id, enabled, api_key_hash, created_at, updated_at`,
    [description, channelId, mode, defaultTemplateId || null, enabled]
  );
  return toIntegration(result.rows[0]);
}

async function updateSgpIntegration(id, { description, channelId, mode, defaultTemplateId, enabled }) {
  const result = await getPool().query(
    `UPDATE platform_integrations
     SET description = $2, channel_id = $3, mode = $4, default_template_id = $5, enabled = $6, updated_at = now()
     WHERE id = $1 AND platform = 'sgp'
     RETURNING id, description, channel_id, mode, default_template_id, enabled, api_key_hash, created_at, updated_at`,
    [id, description, channelId, mode, defaultTemplateId || null, enabled]
  );
  if (result.rowCount === 0) return null;
  return toIntegration(result.rows[0]);
}

async function rotateSgpApiKey(id) {
  const apiKey = crypto.randomBytes(32).toString('hex');
  const apiKeyHash = await bcrypt.hash(apiKey, SALT_ROUNDS);
  const result = await getPool().query(
    `UPDATE platform_integrations SET api_key_hash = $2, updated_at = now()
     WHERE id = $1 AND platform = 'sgp'
     RETURNING id, description, channel_id, mode, default_template_id, enabled, api_key_hash, created_at, updated_at`,
    [id, apiKeyHash]
  );
  if (result.rowCount === 0) return null;
  return { apiKey, integration: toIntegration(result.rows[0]) };
}

async function verifySgpApiKey(candidateKey) {
  const result = await getPool().query(
    `SELECT channel_id, mode, default_template_id, enabled, api_key_hash
     FROM platform_integrations WHERE platform = 'sgp'`
  );
  if (result.rowCount === 0) return { status: 'not_configured' };
  for (const row of result.rows) {
    if (!row.api_key_hash) continue;
    const matches = await bcrypt.compare(candidateKey, row.api_key_hash);
    if (matches) {
      if (!row.enabled) return { status: 'disabled' };
      return { status: 'ok', channelId: row.channel_id, mode: row.mode, defaultTemplateId: row.default_template_id };
    }
  }
  return { status: 'invalid' };
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
  listSgpIntegrations,
  createSgpIntegration,
  updateSgpIntegration,
  rotateSgpApiKey,
  verifySgpApiKey,
  findSgpDispatchByReferenceId,
  createSgpDispatch,
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx dotenv -e .env.test -o -- jest src/integrations/sgp-integration.repository.test.js`
Expected: PASS (15 tests).

- [ ] **Step 5: Commit**

```bash
git add src/integrations/sgp-integration.repository.js src/integrations/sgp-integration.repository.test.js
git commit -m "Rewrite the SGP integration repository to support multiple gateway registrations"
```

---

### Task 3: `admin-integrations.routes.js` — rewrite as a list CRUD

**Files:**
- Modify: `src/api/admin-integrations.routes.js`
- Modify (full rewrite): `src/api/admin-integrations.routes.test.js`

**Interfaces:**
- Consumes: Task 2's `listSgpIntegrations`, `createSgpIntegration`, `updateSgpIntegration`, `rotateSgpApiKey(id)`; existing `findChannelById`.
- Produces: `GET /api/admin/integrations/sgp` (list), `POST /api/admin/integrations/sgp` (create), `PUT /api/admin/integrations/sgp/:id` (update), `POST /api/admin/integrations/sgp/:id/rotate-key` — all `requireAuth` + `requireRole('admin')`. Response item shape: `{id, description, channelId, mode, defaultTemplateId, enabled, hasApiKey}`.

- [ ] **Step 1: Write the failing tests (full replacement of the test file)**

Replace the entire content of `src/api/admin-integrations.routes.test.js` with:

```js
jest.mock('../integrations/sgp-integration.repository');
jest.mock('../channels/channel.repository');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const {
  listSgpIntegrations,
  createSgpIntegration,
  updateSgpIntegration,
  rotateSgpApiKey,
} = require('../integrations/sgp-integration.repository');
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

const BAILEYS_CHANNEL = { id: 'channel-1', type: 'baileys' };
const META_CHANNEL = { id: 'channel-2', type: 'meta_cloud' };

describe('GET /api/admin/integrations/sgp', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns the list of integrations', async () => {
    listSgpIntegrations.mockResolvedValue([
      { id: 'int-1', description: 'Baileys', channelId: 'channel-1', mode: 'freetext', defaultTemplateId: null, enabled: true, hasApiKey: true },
    ]);
    const res = await request(buildApp())
      .get('/api/admin/integrations/sgp')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: 'int-1', description: 'Baileys', channelId: 'channel-1', mode: 'freetext', defaultTemplateId: null, enabled: true, hasApiKey: true },
    ]);
  });

  test('returns an empty array when there are none', async () => {
    listSgpIntegrations.mockResolvedValue([]);
    const res = await request(buildApp())
      .get('/api/admin/integrations/sgp')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .get('/api/admin/integrations/sgp')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(403);
    expect(listSgpIntegrations).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/integrations/sgp', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns 400 when description is missing', async () => {
    const res = await request(buildApp())
      .post('/api/admin/integrations/sgp')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ channelId: 'channel-1', enabled: true });
    expect(res.status).toBe(400);
    expect(findChannelById).not.toHaveBeenCalled();
  });

  test('returns 400 when channelId is missing', async () => {
    const res = await request(buildApp())
      .post('/api/admin/integrations/sgp')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ description: 'Baileys', enabled: true });
    expect(res.status).toBe(400);
  });

  test('returns 400 when enabled is not a boolean', async () => {
    const res = await request(buildApp())
      .post('/api/admin/integrations/sgp')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ description: 'Baileys', channelId: 'channel-1', enabled: 'yes' });
    expect(res.status).toBe(400);
  });

  test('returns 404 when the channel does not exist', async () => {
    findChannelById.mockResolvedValue(null);
    const res = await request(buildApp())
      .post('/api/admin/integrations/sgp')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ description: 'Baileys', channelId: 'channel-1', enabled: true });
    expect(res.status).toBe(404);
  });

  test('returns 400 for an unsupported channel type', async () => {
    findChannelById.mockResolvedValue({ id: 'channel-3', type: 'sms' });
    const res = await request(buildApp())
      .post('/api/admin/integrations/sgp')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ description: 'x', channelId: 'channel-3', enabled: true });
    expect(res.status).toBe(400);
    expect(createSgpIntegration).not.toHaveBeenCalled();
  });

  test('derives mode "freetext" for a baileys channel', async () => {
    findChannelById.mockResolvedValue(BAILEYS_CHANNEL);
    createSgpIntegration.mockResolvedValue({ id: 'int-1', description: 'Baileys', channelId: 'channel-1', mode: 'freetext', defaultTemplateId: null, enabled: true, hasApiKey: false });

    const res = await request(buildApp())
      .post('/api/admin/integrations/sgp')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ description: 'Baileys', channelId: 'channel-1', enabled: true });

    expect(createSgpIntegration).toHaveBeenCalledWith({ description: 'Baileys', channelId: 'channel-1', mode: 'freetext', defaultTemplateId: null, enabled: true });
    expect(res.status).toBe(201);
  });

  test('derives mode "template" for a meta_cloud channel and passes defaultTemplateId through', async () => {
    findChannelById.mockResolvedValue(META_CHANNEL);
    createSgpIntegration.mockResolvedValue({ id: 'int-2', description: 'Oficial', channelId: 'channel-2', mode: 'template', defaultTemplateId: 'tpl-1', enabled: true, hasApiKey: false });

    const res = await request(buildApp())
      .post('/api/admin/integrations/sgp')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ description: 'Oficial', channelId: 'channel-2', defaultTemplateId: 'tpl-1', enabled: true });

    expect(createSgpIntegration).toHaveBeenCalledWith({ description: 'Oficial', channelId: 'channel-2', mode: 'template', defaultTemplateId: 'tpl-1', enabled: true });
    expect(res.status).toBe(201);
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .post('/api/admin/integrations/sgp')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ description: 'Baileys', channelId: 'channel-1', enabled: true });
    expect(res.status).toBe(403);
    expect(createSgpIntegration).not.toHaveBeenCalled();
  });
});

describe('PUT /api/admin/integrations/sgp/:id', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns 404 when the integration does not exist', async () => {
    findChannelById.mockResolvedValue(BAILEYS_CHANNEL);
    updateSgpIntegration.mockResolvedValue(null);
    const res = await request(buildApp())
      .put('/api/admin/integrations/sgp/int-missing')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ description: 'Baileys', channelId: 'channel-1', enabled: true });
    expect(res.status).toBe(404);
  });

  test('updates the integration, re-deriving mode from the current channel', async () => {
    findChannelById.mockResolvedValue(META_CHANNEL);
    updateSgpIntegration.mockResolvedValue({ id: 'int-1', description: 'Oficial', channelId: 'channel-2', mode: 'template', defaultTemplateId: 'tpl-2', enabled: false, hasApiKey: true });

    const res = await request(buildApp())
      .put('/api/admin/integrations/sgp/int-1')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ description: 'Oficial', channelId: 'channel-2', defaultTemplateId: 'tpl-2', enabled: false });

    expect(updateSgpIntegration).toHaveBeenCalledWith('int-1', { description: 'Oficial', channelId: 'channel-2', mode: 'template', defaultTemplateId: 'tpl-2', enabled: false });
    expect(res.status).toBe(200);
  });

  test('clears defaultTemplateId when the channel is not meta_cloud', async () => {
    findChannelById.mockResolvedValue(BAILEYS_CHANNEL);
    updateSgpIntegration.mockResolvedValue({ id: 'int-1', description: 'Baileys', channelId: 'channel-1', mode: 'freetext', defaultTemplateId: null, enabled: true, hasApiKey: true });

    await request(buildApp())
      .put('/api/admin/integrations/sgp/int-1')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ description: 'Baileys', channelId: 'channel-1', defaultTemplateId: 'tpl-stale', enabled: true });

    expect(updateSgpIntegration).toHaveBeenCalledWith('int-1', { description: 'Baileys', channelId: 'channel-1', mode: 'freetext', defaultTemplateId: null, enabled: true });
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .put('/api/admin/integrations/sgp/int-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ description: 'x', channelId: 'channel-1', enabled: true });
    expect(res.status).toBe(403);
    expect(updateSgpIntegration).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/integrations/sgp/:id/rotate-key', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns the new plain api key', async () => {
    rotateSgpApiKey.mockResolvedValue({
      apiKey: 'plain-key-value',
      integration: { id: 'int-1', description: 'Baileys', channelId: 'channel-1', mode: 'freetext', defaultTemplateId: null, enabled: true, hasApiKey: true },
    });

    const res = await request(buildApp())
      .post('/api/admin/integrations/sgp/int-1/rotate-key')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);

    expect(rotateSgpApiKey).toHaveBeenCalledWith('int-1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ apiKey: 'plain-key-value', id: 'int-1', description: 'Baileys', channelId: 'channel-1', mode: 'freetext', defaultTemplateId: null, enabled: true, hasApiKey: true });
  });

  test('returns 404 when the integration does not exist', async () => {
    rotateSgpApiKey.mockResolvedValue(null);
    const res = await request(buildApp())
      .post('/api/admin/integrations/sgp/int-missing/rotate-key')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);
    expect(res.status).toBe(404);
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .post('/api/admin/integrations/sgp/int-1/rotate-key')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(403);
    expect(rotateSgpApiKey).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx dotenv -e .env.test -o -- jest src/api/admin-integrations.routes.test.js`
Expected: FAIL — the route file still exposes the old singleton `GET/PUT /sgp` + `POST /sgp/rotate-key` shape, not this list CRUD.

- [ ] **Step 3: Replace `src/api/admin-integrations.routes.js` entirely**

```js
const express = require('express');
const { requireAuth, requireRole } = require('../auth/auth.middleware');
const {
  listSgpIntegrations,
  createSgpIntegration,
  updateSgpIntegration,
  rotateSgpApiKey,
} = require('../integrations/sgp-integration.repository');
const { findChannelById } = require('../channels/channel.repository');

const router = express.Router();

function toIntegrationResponse(integration) {
  return {
    id: integration.id,
    description: integration.description,
    channelId: integration.channelId,
    mode: integration.mode,
    defaultTemplateId: integration.defaultTemplateId,
    enabled: integration.enabled,
    hasApiKey: integration.hasApiKey,
  };
}

function modeForChannel(channel) {
  return channel.type === 'meta_cloud' ? 'template' : 'freetext';
}

router.get('/sgp', requireAuth, requireRole('admin'), async (req, res) => {
  const integrations = await listSgpIntegrations();
  res.json(integrations.map(toIntegrationResponse));
});

router.post('/sgp', requireAuth, requireRole('admin'), async (req, res) => {
  const { description, channelId, defaultTemplateId, enabled } = req.body || {};
  if (typeof description !== 'string' || !description.trim()) {
    return res.status(400).json({ error: 'description is required' });
  }
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
  if (channel.type !== 'baileys' && channel.type !== 'meta_cloud') {
    return res.status(400).json({ error: 'Unsupported channel type' });
  }
  const mode = modeForChannel(channel);
  const integration = await createSgpIntegration({
    description: description.trim(),
    channelId,
    mode,
    defaultTemplateId: mode === 'template' ? defaultTemplateId || null : null,
    enabled,
  });
  res.status(201).json(toIntegrationResponse(integration));
});

router.put('/sgp/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const { description, channelId, defaultTemplateId, enabled } = req.body || {};
  if (typeof description !== 'string' || !description.trim()) {
    return res.status(400).json({ error: 'description is required' });
  }
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
  if (channel.type !== 'baileys' && channel.type !== 'meta_cloud') {
    return res.status(400).json({ error: 'Unsupported channel type' });
  }
  const mode = modeForChannel(channel);
  const integration = await updateSgpIntegration(req.params.id, {
    description: description.trim(),
    channelId,
    mode,
    defaultTemplateId: mode === 'template' ? defaultTemplateId || null : null,
    enabled,
  });
  if (!integration) {
    return res.status(404).json({ error: 'Integration not found' });
  }
  res.json(toIntegrationResponse(integration));
});

router.post('/sgp/:id/rotate-key', requireAuth, requireRole('admin'), async (req, res) => {
  const rotated = await rotateSgpApiKey(req.params.id);
  if (!rotated) {
    return res.status(404).json({ error: 'Integration not found' });
  }
  res.json({ apiKey: rotated.apiKey, ...toIntegrationResponse(rotated.integration) });
});

module.exports = router;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx dotenv -e .env.test -o -- jest src/api/admin-integrations.routes.test.js`
Expected: PASS (18 tests).

- [ ] **Step 5: Commit**

```bash
git add src/api/admin-integrations.routes.js src/api/admin-integrations.routes.test.js
git commit -m "Rewrite admin SGP integration routes as list CRUD"
```

---

### Task 4: `template.repository.js` — `headerType` column + `findTemplateByNameAndWaba`

**Files:**
- Modify: `src/templates/template.repository.js`
- Modify: `src/templates/template.repository.test.js`

**Interfaces:**
- Consumes: Task 1's `message_templates.header_type` column.
- Produces (consumed by Task 5's `registerExistingTemplate` and Task 10's route): `createTemplateRecord(...)` gains an optional `headerType` field (stored, defaults to `null`); `toTemplate(row)` includes `headerType`; new `findTemplateByNameAndWaba(name, wabaId)` → `Promise<Template|null>` (picks the oldest match if more than one exists for that name+WABA).

- [ ] **Step 1: Write the failing tests**

Add to `src/templates/template.repository.test.js`, inside the existing `describe('createTemplateRecord', ...)` block:

```js
test('accepts an optional headerType', async () => {
  const template = await createTemplateRecord({
    wabaId: 'waba-1', metaTemplateId: 'meta-h1', name: 'com_cabecalho', language: 'pt_BR',
    category: 'UTILITY', bodyText: 'Corpo {{1}}', variableCount: 1, headerType: 'document',
  });
  expect(template.headerType).toBe('document');
});

test('defaults headerType to null when not given', async () => {
  const template = await createTemplateRecord({
    wabaId: 'waba-1', metaTemplateId: 'meta-h2', name: 'sem_cabecalho', language: 'pt_BR',
    category: 'UTILITY', bodyText: 'Corpo', variableCount: 0,
  });
  expect(template.headerType).toBeNull();
});
```

Add a new top-level describe block, and add `findTemplateByNameAndWaba` to the file's existing destructured `require('./template.repository')` import:

```js
describe('findTemplateByNameAndWaba', () => {
  test('finds a template by exact name and wabaId', async () => {
    const created = await createTemplateRecord({
      wabaId: 'waba-1', metaTemplateId: 'meta-n1', name: 'aviso_cobranca', language: 'pt_BR',
      category: 'UTILITY', bodyText: 'Corpo', variableCount: 0,
    });
    const found = await findTemplateByNameAndWaba('aviso_cobranca', 'waba-1');
    expect(found.id).toBe(created.id);
  });

  test('returns null when no template matches the name for that wabaId', async () => {
    await createTemplateRecord({
      wabaId: 'waba-1', metaTemplateId: 'meta-n2', name: 'aviso_cobranca', language: 'pt_BR',
      category: 'UTILITY', bodyText: 'Corpo', variableCount: 0,
    });
    expect(await findTemplateByNameAndWaba('aviso_cobranca', 'waba-2')).toBeNull();
    expect(await findTemplateByNameAndWaba('outro_nome', 'waba-1')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx dotenv -e .env.test -o -- jest src/templates/template.repository.test.js`
Expected: FAIL — `headerType` is not persisted yet, `findTemplateByNameAndWaba` is not exported.

- [ ] **Step 3: Implement**

In `src/templates/template.repository.js`, update `COLUMNS`, `toTemplate`, and `createTemplateRecord`:

```js
const COLUMNS = `id, waba_id, meta_template_id, name, language, category, body_text, variable_count, header_type, status, rejection_reason, created_at`;

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
    headerType: row.header_type,
    status: row.status,
    rejectionReason: row.rejection_reason,
    createdAt: row.created_at,
  };
}
```

```js
async function createTemplateRecord({ wabaId, metaTemplateId, name, language, category, bodyText, variableCount, headerType }) {
  const result = await getPool().query(
    `INSERT INTO message_templates (waba_id, meta_template_id, name, language, category, body_text, variable_count, header_type)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING ${COLUMNS}`,
    [wabaId, metaTemplateId, name, language, category, bodyText, variableCount, headerType || null]
  );
  return toTemplate(result.rows[0]);
}
```

Add, right after `findTemplateByMetaTemplateId`:

```js
async function findTemplateByNameAndWaba(name, wabaId) {
  const result = await getPool().query(
    `SELECT ${COLUMNS} FROM message_templates WHERE name = $1 AND waba_id = $2 ORDER BY created_at ASC LIMIT 1`,
    [name, wabaId]
  );
  if (result.rowCount === 0) return null;
  return toTemplate(result.rows[0]);
}
```

Add `findTemplateByNameAndWaba` to `module.exports`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx dotenv -e .env.test -o -- jest src/templates/template.repository.test.js`
Expected: PASS (all tests in the file, including the 4 new ones).

- [ ] **Step 5: Commit**

```bash
git add src/templates/template.repository.js src/templates/template.repository.test.js
git commit -m "Add header_type support and findTemplateByNameAndWaba to the template repository"
```

---

### Task 5: `listMetaTemplates` gains `components` + new `registerExistingTemplate` service function

**Files:**
- Modify: `src/whatsapp-adapters/meta-cloud.adapter.js`
- Modify: `src/whatsapp-adapters/meta-cloud.adapter.test.js`
- Modify: `src/templates/template.service.js`
- Modify: `src/templates/template.service.test.js`

**Interfaces:**
- Consumes: Task 4's `createTemplateRecord` (now accepts `headerType`) and `findChannelById` (existing); `extractVariableCount`/`isValidTemplateName` (existing, from `template-validator.js`).
- Produces: `listMetaTemplates(channel)` now returns each entry's `components` array too (used to read the body text). `registerExistingTemplate({channelId, name, language, headerType})` → `Promise<Template>` (throws `TemplateValidationError` on any validation failure), exported from `template.service.js`. Consumed by Task 6's new admin route.

- [ ] **Step 1: Write the failing tests**

In `src/whatsapp-adapters/meta-cloud.adapter.test.js`, replace the existing `describe('listMetaTemplates', ...)` block with:

```js
describe('listMetaTemplates', () => {
  test('fetches the WABA template list including components', async () => {
    axios.get.mockResolvedValue({
      data: { data: [{ id: 'meta-tpl-1', name: 'a', language: 'pt_BR', category: 'UTILITY', status: 'APPROVED', rejected_reason: null, components: [{ type: 'BODY', text: 'Olá {{1}}' }] }] },
    });
    const channel = { config: { accessToken: 'token-abc', wabaId: 'waba-1' } };

    const result = await listMetaTemplates(channel);

    expect(axios.get).toHaveBeenCalledWith('https://graph.facebook.com/v20.0/waba-1/message_templates', {
      headers: { Authorization: 'Bearer token-abc' },
      params: { fields: 'id,name,language,category,status,rejected_reason,components' },
    });
    expect(result).toEqual([
      { id: 'meta-tpl-1', name: 'a', language: 'pt_BR', category: 'UTILITY', status: 'APPROVED', rejected_reason: null, components: [{ type: 'BODY', text: 'Olá {{1}}' }] },
    ]);
  });
});
```

Replace the entire content of `src/templates/template.service.test.js` with everything it already has (unchanged) **plus** a new `describe('registerExistingTemplate', ...)` block added at the end, right before the file's final closing — and add `registerExistingTemplate` to the file's existing destructured `require('./template.service')` import line:

```js
describe('registerExistingTemplate', () => {
  const validInput = { channelId: 'ch-1', name: 'aviso_cobranca', language: 'pt_BR' };

  test('rejects an invalid name without calling Meta', async () => {
    await expect(registerExistingTemplate({ ...validInput, name: 'Aviso Cobranca' })).rejects.toThrow(TemplateValidationError);
    expect(metaCloudAdapter.listMetaTemplates).not.toHaveBeenCalled();
  });

  test('rejects an invalid headerType', async () => {
    await expect(registerExistingTemplate({ ...validInput, headerType: 'audio' })).rejects.toThrow(TemplateValidationError);
  });

  test('rejects when language is missing', async () => {
    await expect(registerExistingTemplate({ channelId: 'ch-1', name: 'aviso_cobranca' })).rejects.toThrow(TemplateValidationError);
  });

  test('rejects when the channel is not meta_cloud', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', type: 'baileys', config: {} });
    await expect(registerExistingTemplate(validInput)).rejects.toThrow(TemplateValidationError);
  });

  test('rejects when the meta_cloud channel has no wabaId configured', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', type: 'meta_cloud', config: {} });
    await expect(registerExistingTemplate(validInput)).rejects.toThrow(TemplateValidationError);
  });

  test('rejects when no template matches the given name and language', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', type: 'meta_cloud', config: { wabaId: 'waba-1' } });
    metaCloudAdapter.listMetaTemplates.mockResolvedValue([{ id: 'meta-1', name: 'outro', language: 'pt_BR', category: 'UTILITY', components: [] }]);
    await expect(registerExistingTemplate(validInput)).rejects.toThrow(TemplateValidationError);
  });

  test('finds the matching template by name+language and registers it locally without calling Meta to create anything', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', type: 'meta_cloud', config: { wabaId: 'waba-1' } });
    metaCloudAdapter.listMetaTemplates.mockResolvedValue([
      { id: 984, name: 'aviso_cobranca', language: 'pt_BR', category: 'UTILITY', status: 'APPROVED', components: [{ type: 'BODY', text: 'Olá {{1}}, valor {{2}}' }] },
    ]);
    createTemplateRecord.mockResolvedValue({ id: 'local-1', name: 'aviso_cobranca' });

    const result = await registerExistingTemplate({ ...validInput, headerType: 'document' });

    expect(metaCloudAdapter.createMetaTemplate).not.toHaveBeenCalled();
    expect(createTemplateRecord).toHaveBeenCalledWith({
      wabaId: 'waba-1', metaTemplateId: '984', name: 'aviso_cobranca', language: 'pt_BR',
      category: 'UTILITY', bodyText: 'Olá {{1}}, valor {{2}}', variableCount: 2, headerType: 'document',
    });
    expect(result.id).toBe('local-1');
  });

  test('rejects a matched template whose body has a variable gap', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', type: 'meta_cloud', config: { wabaId: 'waba-1' } });
    metaCloudAdapter.listMetaTemplates.mockResolvedValue([
      { id: 1, name: 'aviso_cobranca', language: 'pt_BR', category: 'UTILITY', components: [{ type: 'BODY', text: 'Olá {{1}}, veja {{3}}' }] },
    ]);
    await expect(registerExistingTemplate(validInput)).rejects.toThrow(TemplateValidationError);
    expect(createTemplateRecord).not.toHaveBeenCalled();
  });

  test('rejects a matched template with no BODY component', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', type: 'meta_cloud', config: { wabaId: 'waba-1' } });
    metaCloudAdapter.listMetaTemplates.mockResolvedValue([
      { id: 1, name: 'aviso_cobranca', language: 'pt_BR', category: 'UTILITY', components: [{ type: 'HEADER', format: 'DOCUMENT' }] },
    ]);
    await expect(registerExistingTemplate(validInput)).rejects.toThrow(TemplateValidationError);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx dotenv -e .env.test -o -- jest src/whatsapp-adapters/meta-cloud.adapter.test.js src/templates/template.service.test.js`
Expected: FAIL — `listMetaTemplates` doesn't request `components` yet; `registerExistingTemplate` is not exported.

- [ ] **Step 3: Implement**

In `src/whatsapp-adapters/meta-cloud.adapter.js`, update `listMetaTemplates`:

```js
async function listMetaTemplates(channel) {
  const { accessToken, wabaId } = channel.config;
  const response = await axios.get(`https://graph.facebook.com/v20.0/${wabaId}/message_templates`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    params: { fields: 'id,name,language,category,status,rejected_reason,components' },
  });
  return response.data.data;
}
```

In `src/templates/template.service.js`, add a `HEADER_TYPES` constant near the existing `CATEGORIES` constant:

```js
const HEADER_TYPES = ['document', 'image', 'video'];
```

Add the new function, after `createTemplate`:

```js
async function registerExistingTemplate({ channelId, name, language, headerType }) {
  if (!isValidTemplateName(name)) {
    throw new TemplateValidationError('Template name must contain only lowercase letters, numbers, and underscores');
  }
  if (!language) {
    throw new TemplateValidationError('language is required');
  }
  if (headerType && !HEADER_TYPES.includes(headerType)) {
    throw new TemplateValidationError('headerType must be document, image, or video');
  }

  const channel = await findChannelById(channelId);
  if (!channel || channel.type !== 'meta_cloud') {
    throw new TemplateValidationError('channelId must reference a meta_cloud channel');
  }
  if (!channel.config.wabaId) {
    throw new TemplateValidationError('This channel has no WABA configured yet');
  }

  const metaTemplates = await metaCloudAdapter.listMetaTemplates(channel);
  const match = metaTemplates.find((t) => t.name === name && t.language === language);
  if (!match) {
    throw new TemplateValidationError('No template with this name and language was found for this WABA');
  }

  const bodyComponent = (match.components || []).find((c) => c.type === 'BODY');
  if (!bodyComponent || !bodyComponent.text) {
    throw new TemplateValidationError('The matched template has no body text to register');
  }

  let variableCount;
  try {
    variableCount = extractVariableCount(bodyComponent.text);
  } catch (err) {
    throw new TemplateValidationError(err.message);
  }

  return createTemplateRecord({
    wabaId: channel.config.wabaId,
    metaTemplateId: String(match.id),
    name,
    language,
    category: match.category,
    bodyText: bodyComponent.text,
    variableCount,
    headerType: headerType || null,
  });
}
```

Add `registerExistingTemplate` to `module.exports`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx dotenv -e .env.test -o -- jest src/whatsapp-adapters/meta-cloud.adapter.test.js src/templates/template.service.test.js`
Expected: PASS (all tests in both files, including the new ones).

- [ ] **Step 5: Commit**

```bash
git add src/whatsapp-adapters/meta-cloud.adapter.js src/whatsapp-adapters/meta-cloud.adapter.test.js src/templates/template.service.js src/templates/template.service.test.js
git commit -m "Add registerExistingTemplate, fetching body/header data from Meta by name+language"
```

---

### Task 6: `admin-templates.routes.js` — `POST /register-existing`

**Files:**
- Modify: `src/api/admin-templates.routes.js`
- Modify: `src/api/admin-templates.routes.test.js`

**Interfaces:**
- Consumes: Task 5's `registerExistingTemplate`.
- Produces: `POST /api/admin/templates/register-existing` (admin-only), body `{channelId, name, language, headerType}`, mirroring the existing `POST /` route's error-handling conventions (`TemplateValidationError` → 400, unique-violation `23505` → 409, a Meta API error body → 502).

- [ ] **Step 1: Write the failing tests**

First, open `src/api/admin-templates.routes.test.js` and check its existing mocking setup (it already mocks `../templates/template.service` and destructures `createTemplate`/`deleteTemplate`/`syncTemplatesForWaba`/`TemplateValidationError` from it, matching this task's route file's own imports). Add `registerExistingTemplate` to that existing destructured import, and add this new describe block to the end of the file:

```js
describe('POST /api/admin/templates/register-existing', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns 400 when channelId, name or language is missing', async () => {
    const res = await request(buildApp())
      .post('/api/admin/templates/register-existing')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ channelId: 'ch-1', name: 'aviso_cobranca' });
    expect(res.status).toBe(400);
    expect(registerExistingTemplate).not.toHaveBeenCalled();
  });

  test('registers the template and returns 201', async () => {
    registerExistingTemplate.mockResolvedValue({ id: 'tpl-1', name: 'aviso_cobranca', headerType: 'document' });

    const res = await request(buildApp())
      .post('/api/admin/templates/register-existing')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ channelId: 'ch-1', name: 'aviso_cobranca', language: 'pt_BR', headerType: 'document' });

    expect(registerExistingTemplate).toHaveBeenCalledWith({ channelId: 'ch-1', name: 'aviso_cobranca', language: 'pt_BR', headerType: 'document' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 'tpl-1', name: 'aviso_cobranca', headerType: 'document' });
  });

  test('returns 400 for a TemplateValidationError', async () => {
    registerExistingTemplate.mockRejectedValue(new TemplateValidationError('No template found'));

    const res = await request(buildApp())
      .post('/api/admin/templates/register-existing')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ channelId: 'ch-1', name: 'aviso_cobranca', language: 'pt_BR' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('No template found');
  });

  test('returns 409 on a duplicate (wabaId, name, language) unique violation', async () => {
    registerExistingTemplate.mockRejectedValue(Object.assign(new Error('duplicate'), { code: '23505' }));

    const res = await request(buildApp())
      .post('/api/admin/templates/register-existing')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ channelId: 'ch-1', name: 'aviso_cobranca', language: 'pt_BR' });

    expect(res.status).toBe(409);
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .post('/api/admin/templates/register-existing')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ channelId: 'ch-1', name: 'aviso_cobranca', language: 'pt_BR' });
    expect(res.status).toBe(403);
    expect(registerExistingTemplate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx dotenv -e .env.test -o -- jest src/api/admin-templates.routes.test.js`
Expected: FAIL — `POST /register-existing` doesn't exist yet (404s), `registerExistingTemplate` isn't imported by the test file yet.

- [ ] **Step 3: Implement**

In `src/api/admin-templates.routes.js`, add `registerExistingTemplate` to the existing `require('../templates/template.service')` destructure, then add the new route (after the existing `router.post('/', ...)` route):

```js
router.post('/register-existing', requireAuth, requireRole('admin'), async (req, res) => {
  const { channelId, name, language, headerType } = req.body || {};
  if (!channelId || !name || !language) {
    return res.status(400).json({ error: 'channelId, name and language are required' });
  }
  try {
    const template = await registerExistingTemplate({ channelId, name, language, headerType: headerType || null });
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx dotenv -e .env.test -o -- jest src/api/admin-templates.routes.test.js`
Expected: PASS (all tests in the file, including the 5 new ones).

- [ ] **Step 5: Commit**

```bash
git add src/api/admin-templates.routes.js src/api/admin-templates.routes.test.js
git commit -m "Add POST /api/admin/templates/register-existing"
```

---

### Task 7: `sendTemplateMessage` — optional header media component

**Files:**
- Modify: `src/whatsapp-adapters/meta-cloud.adapter.js`
- Modify: `src/whatsapp-adapters/meta-cloud.adapter.test.js`

**Interfaces:**
- Produces: `sendTemplateMessage(channel, toPhoneNumber, {name, language, variables, headerType, headerLink})` — `headerType`/`headerLink` are optional; when both present, prepends a `header` component referencing the media by `link`. Consumed by Task 8's `outbound-worker.js`.

- [ ] **Step 1: Write the failing tests**

Add to `src/whatsapp-adapters/meta-cloud.adapter.test.js`'s existing `describe('sendTemplateMessage', ...)` block:

```js
test('includes a header component with the media link when headerType/headerLink are provided', async () => {
  axios.post.mockResolvedValue({ data: { messages: [{ id: 'wamid.TPL3' }] } });
  const channel = { config: { phoneNumberId: '1234567890', accessToken: 'token-abc' } };

  await sendTemplateMessage(channel, '5511999998888', {
    name: 'aviso_cobranca', language: 'pt_BR', variables: ['João', 'R$150,00'],
    headerType: 'document', headerLink: 'https://boleto.link/xyz.pdf',
  });

  expect(axios.post).toHaveBeenCalledWith(
    'https://graph.facebook.com/v20.0/1234567890/messages',
    {
      messaging_product: 'whatsapp', to: '5511999998888', type: 'template',
      template: {
        name: 'aviso_cobranca', language: { code: 'pt_BR' },
        components: [
          { type: 'header', parameters: [{ type: 'document', document: { link: 'https://boleto.link/xyz.pdf' } }] },
          { type: 'body', parameters: [{ type: 'text', text: 'João' }, { type: 'text', text: 'R$150,00' }] },
        ],
      },
    },
    { headers: { Authorization: 'Bearer token-abc' } }
  );
});

test('omits the header component when headerType/headerLink are not provided', async () => {
  axios.post.mockResolvedValue({ data: { messages: [{ id: 'wamid.TPL4' }] } });
  const channel = { config: { phoneNumberId: '1234567890', accessToken: 'token-abc' } };

  await sendTemplateMessage(channel, '5511999998888', { name: 'boas_vindas', language: 'pt_BR', variables: [] });

  const lastCall = axios.post.mock.calls[axios.post.mock.calls.length - 1];
  expect(lastCall[1].template.components.some((c) => c.type === 'header')).toBe(false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx dotenv -e .env.test -o -- jest src/whatsapp-adapters/meta-cloud.adapter.test.js -t "header component"`
Expected: FAIL — `sendTemplateMessage` doesn't build a header component yet.

- [ ] **Step 3: Implement**

Replace `sendTemplateMessage` in `src/whatsapp-adapters/meta-cloud.adapter.js`:

```js
async function sendTemplateMessage(channel, toPhoneNumber, { name, language, variables, headerType, headerLink }) {
  const { phoneNumberId, accessToken } = channel.config;
  const components = [];
  if (headerType && headerLink) {
    components.push({ type: 'header', parameters: [{ type: headerType, [headerType]: { link: headerLink } }] });
  }
  if (variables.length > 0) {
    components.push({ type: 'body', parameters: variables.map((v) => ({ type: 'text', text: v })) });
  }
  const response = await axios.post(
    `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`,
    { messaging_product: 'whatsapp', to: toPhoneNumber, type: 'template', template: { name, language: { code: language }, components } },
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  return { whatsappMessageId: response.data.messages[0].id };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx dotenv -e .env.test -o -- jest src/whatsapp-adapters/meta-cloud.adapter.test.js`
Expected: PASS (all tests in the file, including the 2 new ones — the pre-existing `sendTemplateMessage` tests keep passing since `headerType`/`headerLink` are `undefined` for them, and `undefined && ...` is falsy).

- [ ] **Step 5: Commit**

```bash
git add src/whatsapp-adapters/meta-cloud.adapter.js src/whatsapp-adapters/meta-cloud.adapter.test.js
git commit -m "Let sendTemplateMessage attach an optional header media component"
```

---

### Task 8: `enqueueOutboundMessage` + `outbound-worker.js` — carry `headerType`/`headerLink` through the queue

**Files:**
- Modify: `src/queue/outbound-queue.js`
- Modify: `src/queue/outbound-queue.test.js`
- Modify: `src/queue/outbound-worker.js`
- Modify: `src/queue/outbound-worker.test.js`

**Interfaces:**
- Consumes: Task 7's extended `sendTemplateMessage`.
- Produces: `enqueueOutboundMessage(...)` accepts optional `headerType`/`headerLink`, both default to `null` in the queued job data. `outbound-worker.js`'s template branch forwards them to `adapter.sendTemplateMessage`. Consumed by Task 10's route.

- [ ] **Step 1: Write the failing tests**

Add to `src/queue/outbound-queue.test.js`'s `describe('outbound queue', ...)` block:

```js
test('passes header fields through to the queued job', (done) => {
  processOutboundQueue((data) => {
    try {
      expect(data.headerType).toBe('document');
      expect(data.headerLink).toBe('https://boleto.link/xyz.pdf');
      done();
    } catch (err) {
      done(err);
    }
  });
  enqueueOutboundMessage({
    conversationId, channelId, content: 'Olá João', templateName: 'aviso_cobranca', templateLanguage: 'pt_BR',
    templateVariables: ['João'], headerType: 'document', headerLink: 'https://boleto.link/xyz.pdf',
  });
});

test('defaults header fields to null when not provided', (done) => {
  processOutboundQueue((data) => {
    try {
      expect(data.headerType).toBeNull();
      expect(data.headerLink).toBeNull();
      done();
    } catch (err) {
      done(err);
    }
  });
  enqueueOutboundMessage({ conversationId, channelId, content: 'Mensagem normal' });
});
```

Add to `src/queue/outbound-worker.test.js`'s `describe('startOutboundWorker', ...)` block:

```js
test('passes headerType/headerLink through to sendTemplateMessage when present', async () => {
  getConversationWithContact.mockResolvedValue({ id: 'conv-1', contactPhoneNumber: '5511999998888' });
  findChannelById.mockResolvedValue({ id: 'channel-1', type: 'meta_cloud', config: {} });
  metaCloudAdapter.sendTemplateMessage.mockResolvedValue({ whatsappMessageId: 'wamid.TPL2' });

  await handler({
    messageId: 'msg-1', conversationId: 'conv-1', channelId: 'channel-1', content: 'Olá João',
    templateName: 'aviso_cobranca', templateLanguage: 'pt_BR', templateVariables: ['João'],
    headerType: 'document', headerLink: 'https://boleto.link/xyz.pdf',
  });

  expect(metaCloudAdapter.sendTemplateMessage).toHaveBeenCalledWith(
    { id: 'channel-1', type: 'meta_cloud', config: {} },
    '5511999998888',
    { name: 'aviso_cobranca', language: 'pt_BR', variables: ['João'], headerType: 'document', headerLink: 'https://boleto.link/xyz.pdf' }
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx dotenv -e .env.test -o -- jest src/queue/outbound-queue.test.js src/queue/outbound-worker.test.js`
Expected: FAIL — `data.headerType`/`data.headerLink` are `undefined` (not `null`); the worker's `sendTemplateMessage` call doesn't include `headerType`/`headerLink` yet.

- [ ] **Step 3: Implement**

In `src/queue/outbound-queue.js`, update `enqueueOutboundMessage`'s signature and the job payload:

```js
async function enqueueOutboundMessage({ conversationId, channelId, content, messageType, mediaPath, mediaMimeType, mediaFilename, templateName, templateLanguage, templateVariables, headerType, headerLink }) {
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
      headerType: headerType || null,
      headerLink: headerLink || null,
    },
    { attempts: 3, backoff: { type: 'exponential', delay: 5000 } }
  );
  return message;
}
```

In `src/queue/outbound-worker.js`, update the destructured job data and the template branch:

```js
function startOutboundWorker() {
  processOutboundQueue(async ({ messageId, conversationId, channelId, content, messageType, mediaPath, mediaMimeType, mediaFilename, templateName, templateLanguage, templateVariables, headerType, headerLink }) => {
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
            headerType,
            headerLink,
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

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx dotenv -e .env.test -o -- jest src/queue/outbound-queue.test.js src/queue/outbound-worker.test.js`
Expected: PASS (all tests in both files — the pre-existing worker test asserting `sendTemplateMessage` was called with just `{name, language, variables}` still passes, since Jest's `toHaveBeenCalledWith` treats `headerType: undefined`/`headerLink: undefined` as equal to those keys being absent).

- [ ] **Step 5: Commit**

```bash
git add src/queue/outbound-queue.js src/queue/outbound-queue.test.js src/queue/outbound-worker.js src/queue/outbound-worker.test.js
git commit -m "Carry headerType/headerLink through the outbound queue to sendTemplateMessage"
```

---

### Task 9: `sgp-template-payload-parser.js` — parse the SGP "Mensagem" DSL

**Files:**
- Create: `src/integrations/sgp-template-payload-parser.js`
- Create: `src/integrations/sgp-template-payload-parser.test.js`

**Interfaces:**
- Produces: `parseSgpTemplatePayload(raw)` → `{variables: string[], templateName: string, headerLink: string|null, headerType: string|null}` (throws `SgpTemplatePayloadError` on any malformed input). Both exported. Consumed by Task 10's route.

- [ ] **Step 1: Write the failing tests**

Create `src/integrations/sgp-template-payload-parser.test.js`:

```js
const { parseSgpTemplatePayload, SgpTemplatePayloadError } = require('./sgp-template-payload-parser');

describe('parseSgpTemplatePayload', () => {
  test('parses variables and template name with no header', () => {
    const result = parseSgpTemplatePayload('variables=João|150,00|10/09/2026|https://boleto.link/xyz||template=aviso_cobranca');
    expect(result).toEqual({
      variables: ['João', '150,00', '10/09/2026', 'https://boleto.link/xyz'],
      templateName: 'aviso_cobranca',
      headerLink: null,
      headerType: null,
    });
  });

  test('parses variables, header, and template name together', () => {
    const result = parseSgpTemplatePayload(
      'variables=João|150,00|10/09/2026||header_link=https://boleto.link/xyz.pdf||header_type=document||template=aviso_cobranca_anexo'
    );
    expect(result).toEqual({
      variables: ['João', '150,00', '10/09/2026'],
      templateName: 'aviso_cobranca_anexo',
      headerLink: 'https://boleto.link/xyz.pdf',
      headerType: 'document',
    });
  });

  test('parses zero variables', () => {
    const result = parseSgpTemplatePayload('variables=||template=boas_vindas');
    expect(result.variables).toEqual([]);
  });

  test('throws when content is empty', () => {
    expect(() => parseSgpTemplatePayload('')).toThrow(SgpTemplatePayloadError);
  });

  test('throws when content does not start with variables=', () => {
    expect(() => parseSgpTemplatePayload('template=aviso_cobranca')).toThrow(SgpTemplatePayloadError);
  });

  test('throws when template= is missing', () => {
    expect(() => parseSgpTemplatePayload('variables=João')).toThrow(SgpTemplatePayloadError);
  });

  test('throws when header_link is present without header_type', () => {
    expect(() =>
      parseSgpTemplatePayload('variables=João||header_link=https://boleto.link/xyz.pdf||template=aviso_cobranca')
    ).toThrow(SgpTemplatePayloadError);
  });

  test('throws when header_type is present without header_link', () => {
    expect(() =>
      parseSgpTemplatePayload('variables=João||header_type=document||template=aviso_cobranca')
    ).toThrow(SgpTemplatePayloadError);
  });

  test('throws when a segment has no "=" at all', () => {
    expect(() => parseSgpTemplatePayload('variables=João||garbage||template=x')).toThrow(SgpTemplatePayloadError);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx dotenv -e .env.test -o -- jest src/integrations/sgp-template-payload-parser.test.js`
Expected: FAIL — `Cannot find module './sgp-template-payload-parser'`.

- [ ] **Step 3: Implement**

Create `src/integrations/sgp-template-payload-parser.js`:

```js
class SgpTemplatePayloadError extends Error {}

function parseSgpTemplatePayload(raw) {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new SgpTemplatePayloadError('content is required');
  }
  const segments = raw.split('||');
  const variablesSegment = segments[0];
  if (!variablesSegment.startsWith('variables=')) {
    throw new SgpTemplatePayloadError('content must start with "variables="');
  }
  const variablesRaw = variablesSegment.slice('variables='.length);
  const variables = variablesRaw.length > 0 ? variablesRaw.split('|') : [];

  const fields = {};
  for (const segment of segments.slice(1)) {
    const eqIndex = segment.indexOf('=');
    if (eqIndex === -1) {
      throw new SgpTemplatePayloadError(`Malformed segment "${segment}" — expected key=value`);
    }
    const key = segment.slice(0, eqIndex);
    const value = segment.slice(eqIndex + 1);
    fields[key] = value;
  }

  if (!fields.template) {
    throw new SgpTemplatePayloadError('content must include "template=<name>"');
  }
  const hasHeaderLink = fields.header_link !== undefined;
  const hasHeaderType = fields.header_type !== undefined;
  if (hasHeaderLink !== hasHeaderType) {
    throw new SgpTemplatePayloadError('header_link and header_type must both be present or both be absent');
  }

  return {
    variables,
    templateName: fields.template,
    headerLink: hasHeaderLink ? fields.header_link : null,
    headerType: hasHeaderType ? fields.header_type : null,
  };
}

module.exports = { parseSgpTemplatePayload, SgpTemplatePayloadError };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx dotenv -e .env.test -o -- jest src/integrations/sgp-template-payload-parser.test.js`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/integrations/sgp-template-payload-parser.js src/integrations/sgp-template-payload-parser.test.js
git commit -m "Add the SGP template-mode Mensagem DSL parser"
```

---

### Task 10: `integrations-sgp.routes.js` — branch on `mode`, wire in the template path

**Files:**
- Modify: `src/api/integrations-sgp.routes.js`
- Modify: `src/api/integrations-sgp.routes.test.js`

**Interfaces:**
- Consumes: Task 2's `verifySgpApiKey` (now returns `mode`/`defaultTemplateId`), Task 4's `findTemplateByNameAndWaba`, Task 9's `parseSgpTemplatePayload`/`SgpTemplatePayloadError`, Task 8's extended `enqueueOutboundMessage`.
- Produces: the `GET /messages` route now handles both `mode: 'freetext'` (unchanged Baileys path) and `mode: 'template'` (new Meta Cloud path).

- [ ] **Step 1: Write the failing tests**

In `src/api/integrations-sgp.routes.test.js`:

1. Add `findTemplateByNameAndWaba` to a new `jest.mock('../templates/template.repository')` and its destructured require, alongside the file's existing mocks/requires.
2. Remove the test `'returns 400 when no api key has been generated yet'` entirely (the `no_key` status no longer exists after Task 2).
3. Add a new top-level `describe` block, as a sibling of the existing `describe('with a valid token', ...)` block:

```js
describe('with a valid token for a template-mode integration', () => {
  const TEMPLATE_CHANNEL = { id: 'channel-2', type: 'meta_cloud', status: 'connected', config: { phoneNumberId: '999', accessToken: 'tok', wabaId: 'waba-1' } };
  const TEMPLATE = { id: 'tpl-1', name: 'aviso_cobranca', language: 'pt_BR', variableCount: 2, headerType: null };

  beforeEach(() => {
    verifySgpApiKey.mockResolvedValue({ status: 'ok', channelId: 'channel-2', mode: 'template', defaultTemplateId: null });
    findChannelById.mockResolvedValue(TEMPLATE_CHANNEL);
    findTemplateByNameAndWaba.mockResolvedValue(TEMPLATE);
  });

  test('sends a template message with parsed variables, without checking channel connectivity or resolveWhatsAppJid', async () => {
    const res = await request(buildApp())
      .get('/api/integrations/sgp/messages')
      .query({ phoneNumber: '5598999990000', content: 'variables=João|150,00||template=aviso_cobranca', token: 'the-key' });

    expect(baileysManager.resolveWhatsAppJid).not.toHaveBeenCalled();
    expect(findTemplateByNameAndWaba).toHaveBeenCalledWith('aviso_cobranca', 'waba-1');
    expect(enqueueOutboundMessage).toHaveBeenCalledWith({
      conversationId: 'conv-1', channelId: 'channel-2', content: null,
      templateName: 'aviso_cobranca', templateLanguage: 'pt_BR', templateVariables: ['João', '150,00'],
      headerType: null, headerLink: null,
    });
    expect(res.status).toBe(200);
  });

  test('sends a template message with a header when the payload includes one and it matches the template', async () => {
    findTemplateByNameAndWaba.mockResolvedValue({ ...TEMPLATE, name: 'aviso_com_anexo', variableCount: 1, headerType: 'document' });

    const res = await request(buildApp())
      .get('/api/integrations/sgp/messages')
      .query({ phoneNumber: '5598999990000', content: 'variables=João||header_link=https://boleto.link/x.pdf||header_type=document||template=aviso_com_anexo', token: 'the-key' });

    expect(enqueueOutboundMessage).toHaveBeenCalledWith({
      conversationId: 'conv-1', channelId: 'channel-2', content: null,
      templateName: 'aviso_com_anexo', templateLanguage: 'pt_BR', templateVariables: ['João'],
      headerType: 'document', headerLink: 'https://boleto.link/x.pdf',
    });
    expect(res.status).toBe(200);
  });

  test('returns 400 when the content is not a valid template payload', async () => {
    const res = await request(buildApp())
      .get('/api/integrations/sgp/messages')
      .query({ phoneNumber: '5598999990000', content: 'isso não é o formato certo', token: 'the-key' });
    expect(res.status).toBe(400);
    expect(enqueueOutboundMessage).not.toHaveBeenCalled();
  });

  test('returns 400 when the template name is not found', async () => {
    findTemplateByNameAndWaba.mockResolvedValue(null);
    const res = await request(buildApp())
      .get('/api/integrations/sgp/messages')
      .query({ phoneNumber: '5598999990000', content: 'variables=João|150,00||template=nao_existe', token: 'the-key' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not found/i);
  });

  test('returns 400 when the variable count does not match', async () => {
    const res = await request(buildApp())
      .get('/api/integrations/sgp/messages')
      .query({ phoneNumber: '5598999990000', content: 'variables=SóUmaVariavel||template=aviso_cobranca', token: 'the-key' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/variable/i);
  });

  test('returns 400 when the header_type in the payload does not match the registered template', async () => {
    const res = await request(buildApp())
      .get('/api/integrations/sgp/messages')
      .query({ phoneNumber: '5598999990000', content: 'variables=João|150,00||header_link=https://x.pdf||header_type=image||template=aviso_cobranca', token: 'the-key' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/header/i);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx dotenv -e .env.test -o -- jest src/api/integrations-sgp.routes.test.js`
Expected: FAIL — the route has no `mode` branching yet; `findTemplateByNameAndWaba` is never called.

- [ ] **Step 3: Implement**

Replace `src/api/integrations-sgp.routes.js` entirely:

```js
const express = require('express');
const { verifySgpApiKey, findSgpDispatchByReferenceId, createSgpDispatch } = require('../integrations/sgp-integration.repository');
const { parseSgpTemplatePayload, SgpTemplatePayloadError } = require('../integrations/sgp-template-payload-parser');
const { findChannelById } = require('../channels/channel.repository');
const { findTemplateByNameAndWaba } = require('../templates/template.repository');
const { findOrCreateContactByPhoneNumber } = require('../conversations/contact.repository');
const { findOpenConversation, createConversation, getConversationWithContact } = require('../conversations/conversation.repository');
const { enqueueOutboundMessage } = require('../queue/outbound-queue');
const { emitToAgent } = require('../realtime/socket-server');
const baileysManager = require('../whatsapp-adapters/baileys.manager');

const router = express.Router();
const UNIQUE_VIOLATION = '23505';

async function requireSgpApiKey(req, res, next) {
  const apiKey = typeof req.query.token === 'string' ? req.query.token : null;
  if (!apiKey) {
    return res.status(401).json({ error: 'Missing token' });
  }
  const verification = await verifySgpApiKey(apiKey);
  if (verification.status === 'not_configured') {
    return res.status(400).json({ error: 'SGP integration is not configured' });
  }
  if (verification.status === 'disabled') {
    return res.status(400).json({ error: 'SGP integration is not enabled' });
  }
  if (verification.status === 'invalid') {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  req.sgpChannelId = verification.channelId;
  req.sgpMode = verification.mode;
  next();
}

router.get('/messages', requireSgpApiKey, async (req, res) => {
  const { phoneNumber, content, referenceId } = req.query;
  if (typeof phoneNumber !== 'string' || !phoneNumber.trim()) {
    return res.status(400).json({ error: 'phoneNumber is required' });
  }
  if (typeof content !== 'string' || !content.trim()) {
    return res.status(400).json({ error: 'content is required' });
  }
  const hasReferenceId = typeof referenceId === 'string' && referenceId.trim().length > 0;

  if (hasReferenceId) {
    const existingDispatch = await findSgpDispatchByReferenceId(referenceId);
    if (existingDispatch) {
      return res.status(200).json({
        conversationId: existingDispatch.conversationId,
        messageId: existingDispatch.messageId,
        duplicate: true,
      });
    }
  }

  const channel = await findChannelById(req.sgpChannelId);
  if (!channel) {
    return res.status(400).json({ error: 'The configured channel no longer exists' });
  }

  let canonicalPhoneNumber;
  let outboundPayload;

  if (req.sgpMode === 'template') {
    const normalizedPhoneNumber = phoneNumber.replace(/\D/g, '');
    if (!normalizedPhoneNumber) {
      return res.status(400).json({ error: 'A valid phoneNumber is required' });
    }
    canonicalPhoneNumber = normalizedPhoneNumber;

    let payload;
    try {
      payload = parseSgpTemplatePayload(content);
    } catch (err) {
      if (err instanceof SgpTemplatePayloadError) {
        return res.status(400).json({ error: err.message });
      }
      throw err;
    }

    const template = await findTemplateByNameAndWaba(payload.templateName, channel.config.wabaId);
    if (!template) {
      return res.status(400).json({ error: `Template "${payload.templateName}" not found for this channel` });
    }
    if (payload.variables.length !== template.variableCount) {
      return res.status(400).json({ error: `Template "${template.name}" requires exactly ${template.variableCount} variable(s)` });
    }
    if ((payload.headerType || null) !== (template.headerType || null)) {
      return res.status(400).json({ error: `Template "${template.name}" header type mismatch` });
    }

    outboundPayload = {
      content: null,
      templateName: template.name,
      templateLanguage: template.language,
      templateVariables: payload.variables,
      headerType: payload.headerType,
      headerLink: payload.headerLink,
    };
  } else {
    if (channel.status !== 'connected') {
      return res.status(400).json({ error: 'The configured channel is not connected' });
    }
    const normalizedPhoneNumber = phoneNumber.replace(/\D/g, '');
    if (!normalizedPhoneNumber) {
      return res.status(400).json({ error: 'A valid phoneNumber is required' });
    }
    canonicalPhoneNumber = await baileysManager.resolveWhatsAppJid(channel, normalizedPhoneNumber);
    if (!canonicalPhoneNumber) {
      return res.status(400).json({ error: 'This phone number is not on WhatsApp' });
    }
    outboundPayload = { content };
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

  const message = await enqueueOutboundMessage({ conversationId: conversation.id, channelId: channel.id, ...outboundPayload });

  if (conversation.assignedAgentId) {
    const conversationWithContact = await getConversationWithContact(conversation.id);
    emitToAgent(conversation.assignedAgentId, 'message:new', { conversation: conversationWithContact, message });
  }

  if (hasReferenceId) {
    try {
      await createSgpDispatch({ referenceId, conversationId: conversation.id, messageId: message.id });
    } catch (err) {
      if (err.code !== UNIQUE_VIOLATION) throw err;
    }
  }

  res.status(200).json({ conversationId: conversation.id, messageId: message.id });
});

module.exports = router;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx dotenv -e .env.test -o -- jest src/api/integrations-sgp.routes.test.js`
Expected: PASS (23 tests: 18 pre-existing minus the removed `no_key` test = 17, plus 6 new template-mode tests).

- [ ] **Step 5: Run the full backend suite**

Run: `npm test`
Expected: all suites pass except the pre-existing known `outbound-queue.test.js` Redis-timing flake (2-4 failures there is normal and unrelated).

- [ ] **Step 6: Commit**

```bash
git add src/api/integrations-sgp.routes.js src/api/integrations-sgp.routes.test.js
git commit -m "Branch the SGP messages endpoint on mode: freetext (Baileys) vs template (Meta Cloud)"
```

---

### Task 11: Frontend — `services/api.js` + `useSgpIntegrations` (list-based)

**Files:**
- Modify: `frontend/src/services/api.js`
- Delete: `frontend/src/hooks/useSgpIntegration.js`
- Delete: `frontend/src/hooks/useSgpIntegration.test.jsx`
- Create: `frontend/src/hooks/useSgpIntegrations.js`
- Create: `frontend/src/hooks/useSgpIntegrations.test.jsx`
- Modify: `frontend/src/services/api.test.js` (if it references the old function names — check; if no such test file exists, skip)

**Interfaces:**
- Consumes: Task 3's list-based admin routes.
- Produces: `listSgpIntegrations(token)`, `createSgpIntegration(payload, token)`, `updateSgpIntegration(id, payload, token)`, `rotateSgpIntegrationKey(id, token)` from `services/api.js`; `useSgpIntegrations()` → `{integrations, loading, refresh}`. Consumed by Task 12's `IntegrationsAdminTab.jsx`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/hooks/useSgpIntegrations.test.jsx`:

```jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useSgpIntegrations } from './useSgpIntegrations';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
});

describe('useSgpIntegrations', () => {
  test('fetches the list on mount', async () => {
    api.listSgpIntegrations.mockResolvedValue([
      { id: 'int-1', description: 'Baileys', channelId: 'channel-1', mode: 'freetext', defaultTemplateId: null, enabled: true, hasApiKey: true },
    ]);

    const { result } = renderHook(() => useSgpIntegrations());

    await waitFor(() => expect(result.current.integrations).toHaveLength(1));
    expect(api.listSgpIntegrations).toHaveBeenCalledWith('tok-123');
  });

  test('refresh refetches the list', async () => {
    api.listSgpIntegrations.mockResolvedValue([]);
    const { result } = renderHook(() => useSgpIntegrations());
    await waitFor(() => expect(api.listSgpIntegrations).toHaveBeenCalledTimes(1));

    api.listSgpIntegrations.mockResolvedValue([
      { id: 'int-2', description: 'Oficial', channelId: 'channel-2', mode: 'template', defaultTemplateId: null, enabled: true, hasApiKey: false },
    ]);
    await act(() => result.current.refresh());

    expect(result.current.integrations).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/hooks/useSgpIntegrations.test.jsx`
Expected: FAIL — `Failed to resolve import "./useSgpIntegrations"`.

- [ ] **Step 3: Implement**

Delete `frontend/src/hooks/useSgpIntegration.js` and `frontend/src/hooks/useSgpIntegration.test.jsx`.

In `frontend/src/services/api.js`, replace the existing `getSgpIntegration`/`saveSgpIntegration`/`rotateSgpIntegrationKey` functions with:

```js
export function listSgpIntegrations(token) {
  return apiFetch('/api/admin/integrations/sgp', { token });
}

export function createSgpIntegration(payload, token) {
  return apiFetch('/api/admin/integrations/sgp', { method: 'POST', body: payload, token });
}

export function updateSgpIntegration(id, payload, token) {
  return apiFetch(`/api/admin/integrations/sgp/${id}`, { method: 'PUT', body: payload, token });
}

export function rotateSgpIntegrationKey(id, token) {
  return apiFetch(`/api/admin/integrations/sgp/${id}/rotate-key`, { method: 'POST', token });
}
```

Also add, near the existing `createTemplateAdmin`/`syncTemplatesAdmin` functions (needed by Task 13, adding it now keeps this file's SGP-adjacent edits together):

```js
export function registerExistingTemplateAdmin(data, token) {
  return apiFetch('/api/admin/templates/register-existing', { method: 'POST', body: data, token });
}
```

Create `frontend/src/hooks/useSgpIntegrations.js`:

```js
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { listSgpIntegrations } from '../services/api';

export function useSgpIntegrations() {
  const { token } = useAuth();
  const [integrations, setIntegrations] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    if (!token) return Promise.resolve();
    setLoading(true);
    return listSgpIntegrations(token)
      .then((data) => {
        setIntegrations(data);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, [token]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { integrations, loading, refresh };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/hooks/useSgpIntegrations.test.jsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/api.js frontend/src/hooks/useSgpIntegrations.js frontend/src/hooks/useSgpIntegrations.test.jsx
git rm frontend/src/hooks/useSgpIntegration.js frontend/src/hooks/useSgpIntegration.test.jsx
git commit -m "Replace the singleton SGP integration api/hook with list-based versions"
```

---

### Task 12: Frontend — `IntegrationsAdminTab.jsx` rewritten as a list

**Files:**
- Modify (full rewrite): `frontend/src/components/IntegrationsAdminTab.jsx`
- Modify (full rewrite): `frontend/src/components/IntegrationsAdminTab.test.jsx`

**Interfaces:**
- Consumes: Task 11's `useSgpIntegrations()`, `createSgpIntegration`/`updateSgpIntegration`/`rotateSgpIntegrationKey` from `services/api.js`; existing `useChannels()`, `useTemplates()` (from `frontend/src/hooks/useTemplates.js`, already exists — returns `{templates, loading, refresh}`).
- Produces: `IntegrationsAdminTab` (default export) — a list of integration cards + a create form. Each card's "Ativo" checkbox has a distinct accessible name (`aria-label={\`Ativo: ${integration.description}\`}`) so multiple cards (and the create form's own "Ativo" checkbox) never collide in accessible-name-based queries.

- [ ] **Step 1: Write the failing tests (full replacement of the test file)**

Replace the entire content of `frontend/src/components/IntegrationsAdminTab.test.jsx` with:

```jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import IntegrationsAdminTab from './IntegrationsAdminTab';
import { useSgpIntegrations } from '../hooks/useSgpIntegrations';
import { useChannels } from '../hooks/useChannels';
import { useTemplates } from '../hooks/useTemplates';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../hooks/useSgpIntegrations');
vi.mock('../hooks/useChannels');
vi.mock('../hooks/useTemplates');
vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

const BAILEYS_CHANNEL = { id: 'channel-1', type: 'baileys', name: 'Berg' };
const META_CHANNEL = { id: 'channel-2', type: 'meta_cloud', name: 'Oficial' };
const APPROVED_TEMPLATE = { id: 'tpl-1', name: 'aviso_cobranca', status: 'APPROVED' };

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
  useChannels.mockReturnValue({ channels: [BAILEYS_CHANNEL, META_CHANNEL] });
  useTemplates.mockReturnValue({ templates: [APPROVED_TEMPLATE] });
});

describe('IntegrationsAdminTab', () => {
  test('lists existing integrations with their channel name and mode label', () => {
    useSgpIntegrations.mockReturnValue({
      integrations: [{ id: 'int-1', description: 'Baileys principal', channelId: 'channel-1', mode: 'freetext', defaultTemplateId: null, enabled: true, hasApiKey: true }],
      refresh: vi.fn(),
    });
    render(<IntegrationsAdminTab />);
    expect(screen.getByText('Baileys principal')).toBeInTheDocument();
    expect(screen.getByText(/Berg/)).toBeInTheDocument();
    expect(screen.getByText(/Texto livre/)).toBeInTheDocument();
  });

  test('the template selector only appears after choosing a meta_cloud channel', async () => {
    useSgpIntegrations.mockReturnValue({ integrations: [], refresh: vi.fn() });
    render(<IntegrationsAdminTab />);

    expect(screen.queryByLabelText(/template padrão/i)).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText(/^canal$/i), 'channel-2');

    expect(screen.getByLabelText(/template padrão/i)).toBeInTheDocument();
  });

  test('creates a new freetext integration for a baileys channel', async () => {
    const refresh = vi.fn();
    useSgpIntegrations.mockReturnValue({ integrations: [], refresh });
    api.createSgpIntegration.mockResolvedValue({ id: 'int-1', description: 'Baileys', channelId: 'channel-1', mode: 'freetext', defaultTemplateId: null, enabled: true, hasApiKey: false });
    render(<IntegrationsAdminTab />);

    await userEvent.type(screen.getByLabelText(/descrição/i), 'Baileys');
    await userEvent.selectOptions(screen.getByLabelText(/^canal$/i), 'channel-1');
    await userEvent.click(screen.getByRole('button', { name: /cadastrar/i }));

    await waitFor(() =>
      expect(api.createSgpIntegration).toHaveBeenCalledWith({ description: 'Baileys', channelId: 'channel-1', defaultTemplateId: null, enabled: true }, 'tok-123')
    );
    expect(refresh).toHaveBeenCalled();
  });

  test('creates a new template integration for a meta_cloud channel with a chosen default template', async () => {
    const refresh = vi.fn();
    useSgpIntegrations.mockReturnValue({ integrations: [], refresh });
    api.createSgpIntegration.mockResolvedValue({ id: 'int-2', description: 'Oficial', channelId: 'channel-2', mode: 'template', defaultTemplateId: 'tpl-1', enabled: true, hasApiKey: false });
    render(<IntegrationsAdminTab />);

    await userEvent.type(screen.getByLabelText(/descrição/i), 'Oficial');
    await userEvent.selectOptions(screen.getByLabelText(/^canal$/i), 'channel-2');
    await userEvent.selectOptions(screen.getByLabelText(/template padrão/i), 'tpl-1');
    await userEvent.click(screen.getByRole('button', { name: /cadastrar/i }));

    await waitFor(() =>
      expect(api.createSgpIntegration).toHaveBeenCalledWith({ description: 'Oficial', channelId: 'channel-2', defaultTemplateId: 'tpl-1', enabled: true }, 'tok-123')
    );
  });

  test('toggling Ativo on a card calls updateSgpIntegration with that card current values', async () => {
    const refresh = vi.fn();
    useSgpIntegrations.mockReturnValue({
      integrations: [{ id: 'int-1', description: 'Baileys', channelId: 'channel-1', mode: 'freetext', defaultTemplateId: null, enabled: true, hasApiKey: true }],
      refresh,
    });
    api.updateSgpIntegration.mockResolvedValue({});
    render(<IntegrationsAdminTab />);

    await userEvent.click(screen.getByLabelText('Ativo: Baileys'));

    await waitFor(() =>
      expect(api.updateSgpIntegration).toHaveBeenCalledWith('int-1', { description: 'Baileys', channelId: 'channel-1', defaultTemplateId: null, enabled: false }, 'tok-123')
    );
    expect(refresh).toHaveBeenCalled();
  });

  test('generating a key shows it once', async () => {
    useSgpIntegrations.mockReturnValue({
      integrations: [{ id: 'int-1', description: 'Baileys', channelId: 'channel-1', mode: 'freetext', defaultTemplateId: null, enabled: true, hasApiKey: false }],
      refresh: vi.fn(),
    });
    api.rotateSgpIntegrationKey.mockResolvedValue({ apiKey: 'plain-key-abc' });
    render(<IntegrationsAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /gerar nova chave/i }));

    expect(await screen.findByText('plain-key-abc')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/IntegrationsAdminTab.test.jsx`
Expected: FAIL — the component still renders the old singleton form (no list, no per-card checkbox, no template selector).

- [ ] **Step 3: Replace `frontend/src/components/IntegrationsAdminTab.jsx` entirely**

```jsx
import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useSgpIntegrations } from '../hooks/useSgpIntegrations';
import { useChannels } from '../hooks/useChannels';
import { useTemplates } from '../hooks/useTemplates';
import { createSgpIntegration, updateSgpIntegration, rotateSgpIntegrationKey } from '../services/api';

const inputClass =
  'w-full rounded-xl border border-ink-950/15 bg-white/60 px-3.5 py-2.5 text-ink-950 outline-none transition focus:border-teal-signal/60 focus:bg-white/90 focus:ring-2 focus:ring-teal-signal/25';
const labelClass = 'mb-1.5 block text-sm font-medium text-ink-950/70';
const cardClass = 'space-y-3 rounded-2xl border border-white/70 bg-white/50 p-6 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)] backdrop-blur-xl';

const MODE_LABELS = { freetext: 'Texto livre (Baileys)', template: 'Template (oficial)' };

function IntegrationCard({ integration, channels, onChanged }) {
  const { token } = useAuth();
  const [rotating, setRotating] = useState(false);
  const [generatedKey, setGeneratedKey] = useState(null);
  const [error, setError] = useState(null);
  const channel = channels.find((c) => c.id === integration.channelId);

  async function handleToggleEnabled(event) {
    setError(null);
    try {
      await updateSgpIntegration(
        integration.id,
        { description: integration.description, channelId: integration.channelId, defaultTemplateId: integration.defaultTemplateId, enabled: event.target.checked },
        token
      );
      onChanged();
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao atualizar');
    }
  }

  async function handleRotateKey() {
    setError(null);
    setRotating(true);
    try {
      const result = await rotateSgpIntegrationKey(integration.id, token);
      setGeneratedKey(result.apiKey);
      onChanged();
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao gerar a chave');
    } finally {
      setRotating(false);
    }
  }

  return (
    <div className={cardClass}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-medium text-ink-950">{integration.description}</p>
          <p className="text-sm text-ink-950/55">
            {channel ? channel.name : 'Canal removido'} — {MODE_LABELS[integration.mode] || integration.mode}
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-ink-950/70">
          <input
            type="checkbox"
            checked={integration.enabled}
            onChange={handleToggleEnabled}
            aria-label={`Ativo: ${integration.description}`}
            className="h-4 w-4 accent-teal-signal"
          />
          Ativo
        </label>
      </div>
      <p className="text-sm text-ink-950/55">{integration.hasApiKey ? 'Uma chave já foi gerada.' : 'Nenhuma chave foi gerada ainda.'}</p>
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
      {error && <p className="rounded-lg border border-red-300 bg-red-50/80 px-3 py-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}

function IntegrationsAdminTab() {
  const { token } = useAuth();
  const { integrations, refresh } = useSgpIntegrations();
  const { channels } = useChannels();
  const { templates } = useTemplates();
  const eligibleChannels = channels.filter((channel) => channel.type === 'baileys' || channel.type === 'meta_cloud');

  const [description, setDescription] = useState('');
  const [channelId, setChannelId] = useState('');
  const [defaultTemplateId, setDefaultTemplateId] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const selectedChannel = channels.find((c) => c.id === channelId);
  const isTemplateMode = Boolean(selectedChannel && selectedChannel.type === 'meta_cloud');
  const approvedTemplates = templates.filter((t) => t.status === 'APPROVED');

  async function handleCreate(event) {
    event.preventDefault();
    if (!description.trim()) {
      setError('Descrição é obrigatória');
      return;
    }
    if (!channelId) {
      setError('Escolha um canal');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await createSgpIntegration(
        { description: description.trim(), channelId, defaultTemplateId: isTemplateMode && defaultTemplateId ? defaultTemplateId : null, enabled },
        token
      );
      setDescription('');
      setChannelId('');
      setDefaultTemplateId('');
      setEnabled(true);
      refresh();
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao cadastrar a integração');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        {integrations.map((integration) => (
          <IntegrationCard key={integration.id} integration={integration} channels={channels} onChanged={refresh} />
        ))}
      </div>
      <form onSubmit={handleCreate} className={cardClass}>
        <h3 className="font-display text-base font-semibold text-ink-950">Nova integração SGP</h3>
        <div>
          <label htmlFor="sgp-description" className={labelClass}>Descrição</label>
          <input id="sgp-description" value={description} onChange={(e) => setDescription(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label htmlFor="sgp-channel" className={labelClass}>Canal</label>
          <select id="sgp-channel" value={channelId} onChange={(e) => setChannelId(e.target.value)} className={inputClass}>
            <option value="">Selecione um canal</option>
            {eligibleChannels.map((channel) => (
              <option key={channel.id} value={channel.id}>{channel.name}</option>
            ))}
          </select>
        </div>
        {isTemplateMode && (
          <div>
            <label htmlFor="sgp-default-template" className={labelClass}>Template padrão (opcional)</label>
            <select id="sgp-default-template" value={defaultTemplateId} onChange={(e) => setDefaultTemplateId(e.target.value)} className={inputClass}>
              <option value="">Nenhum</option>
              {approvedTemplates.map((template) => (
                <option key={template.id} value={template.id}>{template.name}</option>
              ))}
            </select>
          </div>
        )}
        <label className="flex items-center gap-2 text-sm text-ink-950/70">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4 accent-teal-signal" />
          Ativo
        </label>
        {error && <p className="rounded-lg border border-red-300 bg-red-50/80 px-3 py-2 text-sm text-red-700">{error}</p>}
        <button
          type="submit"
          disabled={saving}
          className="rounded-xl bg-gradient-to-r from-amber-signal to-amber-signal-dark px-4 py-2.5 font-medium text-ink-950 shadow-[0_10px_30px_-8px_rgba(242,169,60,0.5)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Cadastrar
        </button>
      </form>
    </div>
  );
}

export default IntegrationsAdminTab;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/IntegrationsAdminTab.test.jsx`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/IntegrationsAdminTab.jsx frontend/src/components/IntegrationsAdminTab.test.jsx
git commit -m "Rewrite IntegrationsAdminTab as a list supporting multiple SGP gateways"
```

---

### Task 13: Frontend — `TemplatesAdminTab.jsx` gains "Registrar template existente"

**Files:**
- Modify: `frontend/src/components/TemplatesAdminTab.jsx`
- Modify (full rewrite): `frontend/src/components/TemplatesAdminTab.test.jsx`

**Interfaces:**
- Consumes: Task 11's `registerExistingTemplateAdmin` from `services/api.js`; existing `useChannels()`.
- Produces: a second form rendered below the existing "Cadastrar novo template" form. Both forms get `aria-label`s (`"Cadastrar novo template"` / `"Registrar template existente"`) so tests can scope queries with `within(screen.getByRole('form', {name: ...}))` — required because both forms now have same-named fields ("Canal", "Idioma").

- [ ] **Step 1: Write the failing tests (full replacement of the test file)**

Replace the entire content of `frontend/src/components/TemplatesAdminTab.test.jsx` with:

```jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
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
    const form = within(screen.getByRole('form', { name: /cadastrar novo template/i }));

    await userEvent.selectOptions(form.getByLabelText(/canal/i), 'ch-1');
    await userEvent.type(form.getByLabelText(/^nome$/i), 'boas_vindas');
    await userEvent.selectOptions(form.getByLabelText(/categoria/i), 'UTILITY');
    await userEvent.type(form.getByLabelText(/idioma/i), 'pt_BR');
    await userEvent.type(form.getByLabelText(/corpo/i), 'Olá, bem-vindo!');
    await userEvent.click(form.getByRole('button', { name: /cadastrar/i }));

    await waitFor(() =>
      expect(api.createTemplateAdmin).toHaveBeenCalledWith(
        { channelId: 'ch-1', name: 'boas_vindas', category: 'UTILITY', language: 'pt_BR', bodyText: 'Olá, bem-vindo!' },
        'tok-123'
      )
    );
    expect(refresh).toHaveBeenCalled();
  });

  test('selects the first meta_cloud channel automatically once channels finish loading, without touching the dropdown', async () => {
    const refresh = vi.fn();
    useTemplates.mockReturnValue({ templates: [], refresh });
    useChannels.mockReturnValue({ channels: [] });
    const { rerender } = render(<TemplatesAdminTab />);

    useChannels.mockReturnValue({ channels: [{ id: 'ch-1', type: 'meta_cloud', name: 'Oficial', wabaId: 'waba-1' }] });
    rerender(<TemplatesAdminTab />);
    const form = within(screen.getByRole('form', { name: /cadastrar novo template/i }));

    api.createTemplateAdmin.mockResolvedValue({ id: 'tpl-2', name: 'boas_vindas', status: 'PENDING' });
    await userEvent.type(form.getByLabelText(/^nome$/i), 'boas_vindas');
    await userEvent.type(form.getByLabelText(/idioma/i), 'pt_BR');
    await userEvent.type(form.getByLabelText(/corpo/i), 'Olá, bem-vindo!');
    await userEvent.click(form.getByRole('button', { name: /cadastrar/i }));

    await waitFor(() =>
      expect(api.createTemplateAdmin).toHaveBeenCalledWith(
        { channelId: 'ch-1', name: 'boas_vindas', category: 'UTILITY', language: 'pt_BR', bodyText: 'Olá, bem-vindo!' },
        'tok-123'
      )
    );
  });

  test('shows the Meta error message when creation fails', async () => {
    useTemplates.mockReturnValue({ templates: [], refresh: vi.fn() });
    api.createTemplateAdmin.mockRejectedValue({ body: { error: 'Invalid parameter' } });
    render(<TemplatesAdminTab />);
    const form = within(screen.getByRole('form', { name: /cadastrar novo template/i }));

    await userEvent.selectOptions(form.getByLabelText(/canal/i), 'ch-1');
    await userEvent.type(form.getByLabelText(/^nome$/i), 'x');
    await userEvent.selectOptions(form.getByLabelText(/categoria/i), 'UTILITY');
    await userEvent.type(form.getByLabelText(/idioma/i), 'pt_BR');
    await userEvent.type(form.getByLabelText(/corpo/i), 'Y');
    await userEvent.click(form.getByRole('button', { name: /cadastrar/i }));

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

  test('registers an existing template by name and language', async () => {
    const refresh = vi.fn();
    useTemplates.mockReturnValue({ templates: [], refresh });
    api.registerExistingTemplateAdmin.mockResolvedValue({ id: 'tpl-3', name: 'aviso_cobranca' });
    render(<TemplatesAdminTab />);
    const form = within(screen.getByRole('form', { name: /registrar template existente/i }));

    await userEvent.selectOptions(form.getByLabelText(/canal/i), 'ch-1');
    await userEvent.type(form.getByLabelText(/nome exato na meta/i), 'aviso_cobranca');
    await userEvent.type(form.getByLabelText(/idioma/i), 'pt_BR');
    await userEvent.selectOptions(form.getByLabelText(/cabeçalho/i), 'document');
    await userEvent.click(form.getByRole('button', { name: /^registrar$/i }));

    await waitFor(() =>
      expect(api.registerExistingTemplateAdmin).toHaveBeenCalledWith(
        { channelId: 'ch-1', name: 'aviso_cobranca', language: 'pt_BR', headerType: 'document' },
        'tok-123'
      )
    );
    expect(refresh).toHaveBeenCalled();
  });

  test('shows an error message when registering an existing template fails', async () => {
    useTemplates.mockReturnValue({ templates: [], refresh: vi.fn() });
    api.registerExistingTemplateAdmin.mockRejectedValue({ body: { error: 'No template found' } });
    render(<TemplatesAdminTab />);
    const form = within(screen.getByRole('form', { name: /registrar template existente/i }));

    await userEvent.selectOptions(form.getByLabelText(/canal/i), 'ch-1');
    await userEvent.type(form.getByLabelText(/nome exato na meta/i), 'x');
    await userEvent.type(form.getByLabelText(/idioma/i), 'pt_BR');
    await userEvent.click(form.getByRole('button', { name: /^registrar$/i }));

    await waitFor(() => expect(screen.getByText('No template found')).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/TemplatesAdminTab.test.jsx`
Expected: FAIL — the existing tests fail because both forms don't exist yet (no `aria-label`s to scope by, and `getByRole('form', ...)` finds nothing); the new "register existing" tests fail because that form doesn't exist.

- [ ] **Step 3: Implement**

In `frontend/src/components/TemplatesAdminTab.jsx`:

1. Add `registerExistingTemplateAdmin` to the existing `import { createTemplateAdmin, deleteTemplateAdmin, syncTemplatesAdmin } from '../services/api';` line.
2. Add `aria-label="Cadastrar novo template"` to the existing `<form onSubmit={handleCreate} className="...">` element (keep everything else about it unchanged).
3. Add a new `RegisterExistingTemplateForm` component, defined right after the existing `TemplateRow` component:

```jsx
function RegisterExistingTemplateForm({ onRegistered }) {
  const { token } = useAuth();
  const { channels } = useChannels();
  const metaCloudChannels = channels.filter((channel) => channel.type === 'meta_cloud');

  const [channelId, setChannelId] = useState('');
  const [name, setName] = useState('');
  const [language, setLanguage] = useState('');
  const [headerType, setHeaderType] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await registerExistingTemplateAdmin({ channelId, name, language, headerType: headerType || null }, token);
      setName('');
      setLanguage('');
      setHeaderType('');
      onRegistered();
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao registrar template');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-label="Registrar template existente"
      className="space-y-3 rounded-2xl border border-white/70 bg-white/50 p-6 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)] backdrop-blur-xl"
    >
      <h3 className="font-display text-base font-semibold text-ink-950">Registrar template existente</h3>
      <p className="text-sm text-ink-950/55">
        Para um template já aprovado pela Meta fora deste sistema — busca o corpo e a quantidade de variáveis automaticamente pelo nome.
      </p>
      <div>
        <label htmlFor="existing-template-channel" className="mb-1.5 block text-sm font-medium text-ink-950/70">Canal</label>
        <select
          id="existing-template-channel"
          value={channelId}
          onChange={(e) => setChannelId(e.target.value)}
          className="w-full rounded-xl border border-ink-950/15 bg-white/60 px-3.5 py-2.5 text-ink-950 outline-none transition focus:border-teal-signal/60 focus:bg-white/90 focus:ring-2 focus:ring-teal-signal/25"
          required
        >
          <option value="">Selecione um canal</option>
          {metaCloudChannels.map((channel) => (
            <option key={channel.id} value={channel.id}>{channel.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="existing-template-name" className="mb-1.5 block text-sm font-medium text-ink-950/70">Nome exato na Meta</label>
        <input
          id="existing-template-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-xl border border-ink-950/15 bg-white/60 px-3.5 py-2.5 text-ink-950 outline-none transition focus:border-teal-signal/60 focus:bg-white/90 focus:ring-2 focus:ring-teal-signal/25"
          required
        />
      </div>
      <div>
        <label htmlFor="existing-template-language" className="mb-1.5 block text-sm font-medium text-ink-950/70">Idioma</label>
        <input
          id="existing-template-language"
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          className="w-full rounded-xl border border-ink-950/15 bg-white/60 px-3.5 py-2.5 text-ink-950 outline-none transition focus:border-teal-signal/60 focus:bg-white/90 focus:ring-2 focus:ring-teal-signal/25"
          required
        />
      </div>
      <div>
        <label htmlFor="existing-template-header" className="mb-1.5 block text-sm font-medium text-ink-950/70">Cabeçalho</label>
        <select
          id="existing-template-header"
          value={headerType}
          onChange={(e) => setHeaderType(e.target.value)}
          className="w-full rounded-xl border border-ink-950/15 bg-white/60 px-3.5 py-2.5 text-ink-950 outline-none transition focus:border-teal-signal/60 focus:bg-white/90 focus:ring-2 focus:ring-teal-signal/25"
        >
          <option value="">Nenhum</option>
          <option value="document">Documento</option>
          <option value="image">Imagem</option>
          <option value="video">Vídeo</option>
        </select>
      </div>
      {error && <p className="rounded-lg border border-red-300 bg-red-50/80 px-3 py-2 text-sm text-red-700">{error}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="rounded-xl bg-gradient-to-r from-amber-signal to-amber-signal-dark px-4 py-2.5 font-medium text-ink-950 shadow-[0_10px_30px_-8px_rgba(242,169,60,0.5)] transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-signal/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        Registrar
      </button>
    </form>
  );
}
```

4. In the main `TemplatesAdminTab` component's returned JSX, add `<RegisterExistingTemplateForm onRegistered={refresh} />` right after the closing `</form>` of the existing "Cadastrar novo template" form (as the last element inside the outer `<div className="space-y-6">`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/TemplatesAdminTab.test.jsx`
Expected: PASS (all 9 tests — 7 pre-existing + 2 new).

- [ ] **Step 5: Run the full frontend suite**

Run: `cd frontend && npx vitest run`
Expected: all tests pass (previous total + this plan's new tests, no regressions).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/TemplatesAdminTab.jsx frontend/src/components/TemplatesAdminTab.test.jsx
git commit -m "Add the Registrar template existente form to TemplatesAdminTab"
```
