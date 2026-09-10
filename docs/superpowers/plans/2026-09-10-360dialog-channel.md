# Canal 360dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third channel type, `360dialog`, so an admin can connect a WhatsApp
number through the 360dialog BSP (Business Solution Provider) instead of only Baileys
or a direct Meta Cloud API connection — behaving identically to `meta_cloud` in every
business rule, with only the underlying HTTP calls (send, receive, template
management) differing.

**Architecture:** A new adapter module (`three-sixty-dialog.adapter.js`) implements the
same function contract as the existing `meta-cloud.adapter.js`, reusing its webhook
payload parsers (the payload shape is identical). A new webhook route identifies the
channel via a unique per-channel token embedded in the URL itself (360dialog has no
HMAC signature scheme like Meta's), registered automatically with 360dialog's API when
the channel is created. Every place the codebase currently branches on
`channel.type === 'meta_cloud'` for a business-rule reason (not a technical HTTP-call
reason) is generalized to a shared `isOfficialChannelType()` check covering both types.

**Tech Stack:** Node.js/Express, PostgreSQL (node-pg-migrate), axios (already a
dependency), Jest + supertest (backend), React, Vitest + Testing Library (frontend).

**Spec:** `docs/superpowers/specs/2026-09-10-360dialog-channel-design.md`

## Global Constraints

- 360dialog's messaging API base URL is exactly `https://waba-v2.360dialog.io`;
  authentication is the header `D360-API-KEY: <apiKey>` — never `Authorization: Bearer`.
- 360dialog channels store `apiKey`, `wabaId`, and `webhookToken` in `channels.config` —
  `wabaId` is required even though 360dialog's own API doesn't need it, because this
  project's existing template storage is keyed by `wabaId` (see
  `template.repository.js`'s use in `template.service.js`), and reusing that key avoids
  inventing a second identifier concept.
- The webhook route identifies the channel via a token in the URL path
  (`/webhooks/360dialog/:webhookToken`), not via payload content or HMAC signature —
  360dialog does not support Meta's `X-Hub-Signature-256` scheme.
- Creating a 360dialog channel must call 360dialog's webhook-registration API
  synchronously; if that call fails, the channel is NOT created (atomic failure) and the
  admin sees the error immediately.
- Every place the codebase checks `channel.type === 'meta_cloud'` for a **business
  rule** (24h window / template requirement / SGP integration mode) must be generalized
  to also cover `360dialog` via a shared `isOfficialChannelType()` helper — never touch
  the places that check `channel.type === 'meta_cloud'` for a **technical HTTP
  contract** reason (those stay meta_cloud-specific, since 360dialog's actual HTTP
  calls differ).
- `src/config/env.js` gains a new required environment variable, `PUBLIC_BASE_URL` (no
  trailing slash) — must be set in `.env`/`.env.test` locally and in Render's
  environment before this feature deploys.
- Every migration statement uses `IF NOT EXISTS`/`IF EXISTS` where applicable (a CHECK
  constraint replacement uses `DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT`, which is
  itself idempotent since the constraint name is fixed and deterministic).
- Every git commit ends with the trailer
  `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` — spell this out verbatim in
  every implementer dispatch; omitting it has caused subagents to default to their own
  model identity in the trailer multiple times this session when the instruction wasn't
  repeated.

---

### Task 1: Migration + shared official-channel-type helper

**Files:**
- Create: `migrations/1788890000000_add-360dialog-channel-type.js`
- Create: `src/channels/channel-types.js`
- Test: `src/channels/channel-types.test.js`

**Interfaces:**
- Produces: the `channels.type` CHECK constraint accepts `'360dialog'` in addition to
  `'meta_cloud'`/`'baileys'`; `OFFICIAL_CHANNEL_TYPES` (array `['meta_cloud',
  '360dialog']`) and `isOfficialChannelType(type)` (boolean) from
  `src/channels/channel-types.js`. Consumed by Tasks 3, 7, 8, 9 (business-rule checks),
  and referenced by Task 5's admin route.

`channel-types.js` is a standalone leaf module (no dependencies on `channel.repository.js`
or anything else) specifically so every file that needs it — including
`channel.repository.js` itself in Task 3 — can import it without any risk of a circular
require.

- [ ] **Step 1: Write the migration**

```js
exports.up = (pgm) => {
  pgm.sql(`ALTER TABLE channels DROP CONSTRAINT IF EXISTS channels_type_check;`);
  pgm.sql(`ALTER TABLE channels ADD CONSTRAINT channels_type_check CHECK (type IN ('meta_cloud', 'baileys', '360dialog'));`);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE channels DROP CONSTRAINT IF EXISTS channels_type_check;`);
  pgm.sql(`ALTER TABLE channels ADD CONSTRAINT channels_type_check CHECK (type IN ('meta_cloud', 'baileys'));`);
};
```

`channels_type_check` is Postgres's default auto-generated name for an inline
column-level `CHECK` (`<table>_<column>_check`) — confirmed by reading the original
migration (`migrations/1788610140627_create-channels-table.js:5`), which declares the
constraint inline with no explicit name. `DROP CONSTRAINT IF EXISTS` before `ADD
CONSTRAINT` makes re-running this migration safe (idempotent), matching this project's
established migration discipline.

- [ ] **Step 2: Run the migration against the local dev database**

Run: `npm run migrate up`

Expected: migration reports success. Confirm with a DB client that inserting a channel
row with `type = '360dialog'` no longer violates the constraint (you can check this via
`\d channels` in `psql` to see the updated constraint definition, or just proceed —
Task 3's repository test will exercise this for real).

- [ ] **Step 3: Write the failing test for the helper module**

```js
const { OFFICIAL_CHANNEL_TYPES, isOfficialChannelType } = require('./channel-types');

describe('isOfficialChannelType', () => {
  test('returns true for meta_cloud', () => {
    expect(isOfficialChannelType('meta_cloud')).toBe(true);
  });

  test('returns true for 360dialog', () => {
    expect(isOfficialChannelType('360dialog')).toBe(true);
  });

  test('returns false for baileys', () => {
    expect(isOfficialChannelType('baileys')).toBe(false);
  });

  test('returns false for an unknown type', () => {
    expect(isOfficialChannelType('unknown')).toBe(false);
  });
});

describe('OFFICIAL_CHANNEL_TYPES', () => {
  test('contains exactly meta_cloud and 360dialog', () => {
    expect(OFFICIAL_CHANNEL_TYPES).toEqual(['meta_cloud', '360dialog']);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx jest src/channels/channel-types.test.js`
Expected: FAIL with "Cannot find module './channel-types'"

- [ ] **Step 5: Implement**

```js
const OFFICIAL_CHANNEL_TYPES = ['meta_cloud', '360dialog'];

function isOfficialChannelType(type) {
  return OFFICIAL_CHANNEL_TYPES.includes(type);
}

module.exports = { OFFICIAL_CHANNEL_TYPES, isOfficialChannelType };
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx jest src/channels/channel-types.test.js`
Expected: PASS, all tests green

- [ ] **Step 7: Commit**

```bash
git add migrations/1788890000000_add-360dialog-channel-type.js src/channels/channel-types.js src/channels/channel-types.test.js
git commit -m "$(cat <<'EOF'
Add the 360dialog channel type and a shared official-channel helper

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 360dialog adapter

**Files:**
- Create: `src/whatsapp-adapters/three-sixty-dialog.adapter.js`
- Test: `src/whatsapp-adapters/three-sixty-dialog.adapter.test.js`

**Interfaces:**
- Consumes: `parseInboundMessages`, `parseStatusUpdates`, `parseTemplateStatusUpdates`
  from `./meta-cloud.adapter` (already exist, unchanged — the webhook payload shape is
  identical for 360dialog, confirmed against 360dialog's own documentation).
- Produces: `sendTextMessage(channel, toPhoneNumber, content, options?)`,
  `sendMediaMessage(channel, toPhoneNumber, {...})`,
  `sendTemplateMessage(channel, toPhoneNumber, {...})`,
  `downloadMedia(mediaId, channel)`,
  `createMetaTemplate(channel, {name, category, language, bodyText})`,
  `listMetaTemplates(channel)`,
  `deleteMetaTemplate(channel, {name, metaTemplateId})`,
  `registerWebhook(channel, webhookUrl)`, plus re-exported `parseInboundMessages`,
  `parseStatusUpdates`, `parseTemplateStatusUpdates`. `channel` for every function is
  the full channel object (`channel.config.apiKey` is read internally) — this matches
  `meta-cloud.adapter.js`'s contract except `downloadMedia` takes `channel` instead of
  a bare `accessToken` (called out explicitly because 360dialog's auth is a full header
  the caller must not try to extract manually). Consumed by Task 4 (webhook route),
  Task 5 (channel creation, `registerWebhook`), Task 6 (`outbound-worker.js`), Task 7
  (`template.service.js`).

- [ ] **Step 1: Write the failing tests**

```js
const axios = require('axios');
const {
  sendTextMessage,
  sendMediaMessage,
  sendTemplateMessage,
  createMetaTemplate,
  listMetaTemplates,
  deleteMetaTemplate,
  registerWebhook,
  parseInboundMessages,
} = require('./three-sixty-dialog.adapter');

jest.mock('axios');
jest.mock('fs', () => ({
  promises: { readFile: jest.fn() },
}));
const fs = require('fs');

const CHANNEL = { id: 'channel-1', config: { apiKey: 'd360-key-abc', wabaId: 'waba-1', webhookToken: 'token-xyz' } };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('sendTextMessage', () => {
  test('posts to waba-v2.360dialog.io/messages with the D360-API-KEY header', async () => {
    axios.post.mockResolvedValue({ data: { messages: [{ id: 'wamid.SENT1' }] } });

    const result = await sendTextMessage(CHANNEL, '5511999998888', 'Ola');

    expect(axios.post).toHaveBeenCalledWith(
      'https://waba-v2.360dialog.io/messages',
      { messaging_product: 'whatsapp', to: '5511999998888', type: 'text', text: { body: 'Ola' } },
      { headers: { 'D360-API-KEY': 'd360-key-abc' } }
    );
    expect(result).toEqual({ whatsappMessageId: 'wamid.SENT1' });
  });

  test('includes a reply context when repliedToWhatsappMessageId is passed', async () => {
    axios.post.mockResolvedValue({ data: { messages: [{ id: 'wamid.REPLY1' }] } });

    await sendTextMessage(CHANNEL, '5511999998888', 'Ola', { repliedToWhatsappMessageId: 'wamid.ORIGINAL' });

    expect(axios.post).toHaveBeenCalledWith(
      'https://waba-v2.360dialog.io/messages',
      expect.objectContaining({ context: { message_id: 'wamid.ORIGINAL' } }),
      expect.anything()
    );
  });
});

describe('sendTemplateMessage', () => {
  test('sends a template message with body variables', async () => {
    axios.post.mockResolvedValue({ data: { messages: [{ id: 'wamid.TPL1' }] } });

    const result = await sendTemplateMessage(CHANNEL, '5511999998888', {
      name: 'fatura_vencida',
      language: 'pt_BR',
      variables: ['Joao', '150,00'],
    });

    expect(axios.post).toHaveBeenCalledWith(
      'https://waba-v2.360dialog.io/messages',
      {
        messaging_product: 'whatsapp',
        to: '5511999998888',
        type: 'template',
        template: {
          name: 'fatura_vencida',
          language: { code: 'pt_BR' },
          components: [{ type: 'body', parameters: [{ type: 'text', text: 'Joao' }, { type: 'text', text: '150,00' }] }],
        },
      },
      { headers: { 'D360-API-KEY': 'd360-key-abc' } }
    );
    expect(result).toEqual({ whatsappMessageId: 'wamid.TPL1' });
  });
});

describe('sendMediaMessage', () => {
  test('uploads the file then sends a media message referencing the uploaded id', async () => {
    fs.promises.readFile.mockResolvedValue(Buffer.from('fake-image-bytes'));
    axios.post
      .mockResolvedValueOnce({ data: { id: 'media-360-1' } })
      .mockResolvedValueOnce({ data: { messages: [{ id: 'wamid.MEDIA1' }] } });

    const result = await sendMediaMessage(CHANNEL, '5511999998888', {
      messageType: 'image',
      mediaPath: 'foo.jpg',
      mediaMimeType: 'image/jpeg',
      mediaFilename: 'foo.jpg',
      caption: 'Comprovante',
    });

    expect(axios.post).toHaveBeenNthCalledWith(1, 'https://waba-v2.360dialog.io/media', expect.anything(), expect.objectContaining({
      headers: expect.objectContaining({ 'D360-API-KEY': 'd360-key-abc' }),
    }));
    expect(axios.post).toHaveBeenNthCalledWith(
      2,
      'https://waba-v2.360dialog.io/messages',
      { messaging_product: 'whatsapp', to: '5511999998888', type: 'image', image: { id: 'media-360-1', caption: 'Comprovante' } },
      { headers: { 'D360-API-KEY': 'd360-key-abc' } }
    );
    expect(result).toEqual({ whatsappMessageId: 'wamid.MEDIA1' });
  });
});

describe('createMetaTemplate', () => {
  test('posts to message_templates with the D360-API-KEY header', async () => {
    axios.post.mockResolvedValue({ data: { id: 'tpl-360-1', status: 'PENDING' } });

    const result = await createMetaTemplate(CHANNEL, { name: 'fatura_vencida', category: 'UTILITY', language: 'pt_BR', bodyText: 'Ola {{1}}' });

    expect(axios.post).toHaveBeenCalledWith(
      'https://waba-v2.360dialog.io/message_templates',
      { name: 'fatura_vencida', category: 'UTILITY', language: 'pt_BR', components: [{ type: 'BODY', text: 'Ola {{1}}' }] },
      { headers: { 'D360-API-KEY': 'd360-key-abc' } }
    );
    expect(result).toEqual({ metaTemplateId: 'tpl-360-1', status: 'PENDING' });
  });
});

describe('listMetaTemplates', () => {
  test('gets message_templates and returns the data array', async () => {
    axios.get.mockResolvedValue({ data: { data: [{ id: 'tpl-1', name: 'fatura_vencida', status: 'APPROVED' }] } });

    const result = await listMetaTemplates(CHANNEL);

    expect(axios.get).toHaveBeenCalledWith('https://waba-v2.360dialog.io/message_templates', { headers: { 'D360-API-KEY': 'd360-key-abc' } });
    expect(result).toEqual([{ id: 'tpl-1', name: 'fatura_vencida', status: 'APPROVED' }]);
  });
});

describe('deleteMetaTemplate', () => {
  test('deletes by name and hsm_id', async () => {
    axios.delete.mockResolvedValue({});

    await deleteMetaTemplate(CHANNEL, { name: 'fatura_vencida', metaTemplateId: 'tpl-360-1' });

    expect(axios.delete).toHaveBeenCalledWith('https://waba-v2.360dialog.io/message_templates', {
      headers: { 'D360-API-KEY': 'd360-key-abc' },
      params: { name: 'fatura_vencida', hsm_id: 'tpl-360-1' },
    });
  });
});

describe('registerWebhook', () => {
  test('posts the webhook URL to v1/configs/webhook', async () => {
    axios.post.mockResolvedValue({});

    await registerWebhook(CHANNEL, 'https://example.com/webhooks/360dialog/token-xyz');

    expect(axios.post).toHaveBeenCalledWith(
      'https://waba-v2.360dialog.io/v1/configs/webhook',
      { url: 'https://example.com/webhooks/360dialog/token-xyz' },
      { headers: { 'D360-API-KEY': 'd360-key-abc' } }
    );
  });

  test('propagates an error when the API key is rejected', async () => {
    axios.post.mockRejectedValue(new Error('401 Unauthorized'));

    await expect(registerWebhook(CHANNEL, 'https://example.com/webhooks/360dialog/token-xyz')).rejects.toThrow('401 Unauthorized');
  });
});

describe('re-exported webhook parsers', () => {
  test('parseInboundMessages is the same function as meta-cloud.adapter exports', () => {
    const metaCloudAdapter = require('./meta-cloud.adapter');
    expect(parseInboundMessages).toBe(metaCloudAdapter.parseInboundMessages);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/whatsapp-adapters/three-sixty-dialog.adapter.test.js`
Expected: FAIL with "Cannot find module './three-sixty-dialog.adapter'"

- [ ] **Step 3: Implement**

```js
const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');
const { getMediaFilePath } = require('../media/media-storage');
const {
  parseInboundMessages,
  parseStatusUpdates,
  parseTemplateStatusUpdates,
} = require('./meta-cloud.adapter');

const BASE_URL = 'https://waba-v2.360dialog.io';

function authHeaders(channel) {
  return { 'D360-API-KEY': channel.config.apiKey };
}

async function sendTextMessage(channel, toPhoneNumber, content, { repliedToWhatsappMessageId } = {}) {
  const body = {
    messaging_product: 'whatsapp',
    to: toPhoneNumber,
    type: 'text',
    text: { body: content },
  };
  if (repliedToWhatsappMessageId) {
    body.context = { message_id: repliedToWhatsappMessageId };
  }
  const response = await axios.post(`${BASE_URL}/messages`, body, { headers: authHeaders(channel) });
  return { whatsappMessageId: response.data.messages[0].id };
}

async function sendMediaMessage(channel, toPhoneNumber, { messageType, mediaPath, mediaMimeType, mediaFilename, caption, repliedToWhatsappMessageId }) {
  const buffer = await fs.promises.readFile(getMediaFilePath(mediaPath));

  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('file', buffer, { filename: mediaFilename || 'file', contentType: mediaMimeType });
  const uploadResponse = await axios.post(`${BASE_URL}/media`, form, {
    headers: { ...form.getHeaders(), ...authHeaders(channel) },
  });

  const mediaId = uploadResponse.data.id;
  const messagePayload = {
    messaging_product: 'whatsapp',
    to: toPhoneNumber,
    type: messageType,
    [messageType]: caption ? { id: mediaId, caption } : { id: mediaId },
  };
  if (repliedToWhatsappMessageId) {
    messagePayload.context = { message_id: repliedToWhatsappMessageId };
  }
  const response = await axios.post(`${BASE_URL}/messages`, messagePayload, { headers: authHeaders(channel) });
  return { whatsappMessageId: response.data.messages[0].id };
}

async function sendTemplateMessage(channel, toPhoneNumber, { name, language, variables, headerType, headerLink }) {
  const components = [];
  if (headerType && headerLink) {
    components.push({ type: 'header', parameters: [{ type: headerType, [headerType]: { link: headerLink } }] });
  }
  if (variables.length > 0) {
    components.push({ type: 'body', parameters: variables.map((v) => ({ type: 'text', text: v })) });
  }
  const response = await axios.post(
    `${BASE_URL}/messages`,
    { messaging_product: 'whatsapp', to: toPhoneNumber, type: 'template', template: { name, language: { code: language }, components } },
    { headers: authHeaders(channel) }
  );
  return { whatsappMessageId: response.data.messages[0].id };
}

async function downloadMedia(mediaId, channel) {
  const metaResponse = await axios.get(`${BASE_URL}/${mediaId}`, { headers: authHeaders(channel) });
  const fileResponse = await axios.get(metaResponse.data.url, {
    headers: authHeaders(channel),
    responseType: 'arraybuffer',
  });
  return Buffer.from(fileResponse.data);
}

async function createMetaTemplate(channel, { name, category, language, bodyText }) {
  const response = await axios.post(
    `${BASE_URL}/message_templates`,
    { name, category, language, components: [{ type: 'BODY', text: bodyText }] },
    { headers: authHeaders(channel) }
  );
  return { metaTemplateId: response.data.id, status: response.data.status };
}

async function listMetaTemplates(channel) {
  const response = await axios.get(`${BASE_URL}/message_templates`, { headers: authHeaders(channel) });
  return response.data.data || response.data;
}

async function deleteMetaTemplate(channel, { name, metaTemplateId }) {
  await axios.delete(`${BASE_URL}/message_templates`, {
    headers: authHeaders(channel),
    params: { name, hsm_id: metaTemplateId },
  });
}

async function registerWebhook(channel, webhookUrl) {
  await axios.post(`${BASE_URL}/v1/configs/webhook`, { url: webhookUrl }, { headers: authHeaders(channel) });
}

module.exports = {
  sendTextMessage,
  sendMediaMessage,
  sendTemplateMessage,
  downloadMedia,
  createMetaTemplate,
  listMetaTemplates,
  deleteMetaTemplate,
  registerWebhook,
  parseInboundMessages,
  parseStatusUpdates,
  parseTemplateStatusUpdates,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/whatsapp-adapters/three-sixty-dialog.adapter.test.js`
Expected: PASS, all tests green

- [ ] **Step 5: Commit**

```bash
git add src/whatsapp-adapters/three-sixty-dialog.adapter.js src/whatsapp-adapters/three-sixty-dialog.adapter.test.js
git commit -m "$(cat <<'EOF'
Add the 360dialog messaging adapter

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Channel repository — webhook token lookup + wabaId generalization

**Files:**
- Modify: `src/channels/channel.repository.js`
- Test: `src/channels/channel.repository.test.js`

**Interfaces:**
- Produces: `findChannelByWebhookToken(webhookToken)` → channel or `null`;
  `findChannelByWabaId(wabaId)` → now matches ANY channel type with that `wabaId` in
  `config` (previously restricted to `type = 'meta_cloud'`);
  `updateChannelWabaId(id, wabaId)` → now succeeds for `meta_cloud` OR `360dialog`
  channels (previously only `meta_cloud`). Consumed by Task 4 (webhook route uses
  `findChannelByWebhookToken`), Task 5 (admin routes), Task 7/8 (`findChannelByWabaId`
  already used by `template.service.js`/`conversations.routes.js`, unchanged call
  sites, just broader matching now).

**Important — do not touch any other function in this file.** This file backs
production channel management for all three types; the scope here is exactly the three
functions named above plus one new one.

- [ ] **Step 1: Write the failing tests**

Add to the existing `describe('channel repository', ...)` block in
`src/channels/channel.repository.test.js`:

```js
  test('createChannel stores and returns a 360dialog channel', async () => {
    const channel = await createChannel({
      type: '360dialog',
      name: 'Suporte via BSP',
      phoneNumber: '+5511999990003',
      config: { apiKey: 'd360-key-abc', wabaId: 'waba-360-1', webhookToken: 'token-abc123' },
    });
    expect(channel.id).toBeDefined();
    expect(channel.type).toBe('360dialog');
    expect(channel.config).toEqual({ apiKey: 'd360-key-abc', wabaId: 'waba-360-1', webhookToken: 'token-abc123' });
  });

  describe('findChannelByWebhookToken', () => {
    test('finds a 360dialog channel by its webhookToken', async () => {
      const created = await createChannel({
        type: '360dialog', name: 'Suporte via BSP', phoneNumber: '+5511999990004',
        config: { apiKey: 'key-1', wabaId: 'waba-1', webhookToken: 'find-me-token' },
      });
      const found = await findChannelByWebhookToken('find-me-token');
      expect(found.id).toBe(created.id);
    });

    test('returns null when no channel has that token', async () => {
      expect(await findChannelByWebhookToken('does-not-exist')).toBeNull();
    });
  });
```

Update the existing `describe('findChannelByWabaId', ...)` block (around line 180) —
add a new test proving it now matches `360dialog` too, without touching the three
existing tests in that block (they stay exactly as they are, and must still pass):

```js
  test('finds a 360dialog channel by its configured wabaId', async () => {
    const created = await createChannel({
      type: '360dialog', name: 'Via BSP', phoneNumber: '+5511999990005',
      config: { apiKey: 'key-1', wabaId: 'waba-360-2', webhookToken: 'tok-1' },
    });
    const found = await findChannelByWabaId('waba-360-2');
    expect(found.id).toBe(created.id);
  });
```

Update the existing `describe('updateChannelWabaId', ...)` block (around line 200) —
add a new test proving it now works for `360dialog` too, without touching the existing
test:

```js
  test('updates the wabaId of an existing 360dialog channel', async () => {
    const created = await createChannel({
      type: '360dialog', name: 'Via BSP', phoneNumber: '+5511999990006',
      config: { apiKey: 'key-1', wabaId: 'old-waba', webhookToken: 'tok-2' },
    });
    const updated = await updateChannelWabaId(created.id, 'new-waba');
    expect(updated.config.wabaId).toBe('new-waba');
  });
```

Add `findChannelByWebhookToken` to the destructured import at the top of the test file
(alongside the existing `findChannelByMetaPhoneNumberId`, `findChannelByWabaId`, etc.).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/channels/channel.repository.test.js`
Expected: FAIL — `findChannelByWebhookToken is not a function`, and the new
`360dialog`-specific assertions fail against the old `type = 'meta_cloud'`-restricted
queries

- [ ] **Step 3: Implement**

In `src/channels/channel.repository.js`, add the new function (near
`findChannelByWabaId`):

```js
async function findChannelByWebhookToken(webhookToken) {
  const result = await getPool().query(
    `SELECT id, type, name, phone_number, config, status, triage_enabled, hidden, welcome_message, created_at FROM channels
     WHERE type = '360dialog' AND config->>'webhookToken' = $1`,
    [webhookToken]
  );
  if (result.rowCount === 0) return null;
  return toChannel(result.rows[0]);
}
```

Replace `findChannelByWabaId`'s body (drop the `type = 'meta_cloud'` filter):

```js
async function findChannelByWabaId(wabaId) {
  const result = await getPool().query(
    `SELECT id, type, name, phone_number, config, status, triage_enabled, hidden, welcome_message, created_at FROM channels
     WHERE config->>'wabaId' = $1
     LIMIT 1`,
    [wabaId]
  );
  if (result.rowCount === 0) return null;
  return toChannel(result.rows[0]);
}
```

Replace `updateChannelWabaId`'s `WHERE` clause (drop the single-type restriction, list
both official types literally — simpler than passing an array through the pg driver
for just this one query):

```js
async function updateChannelWabaId(id, wabaId) {
  const result = await getPool().query(
    `UPDATE channels SET config = jsonb_set(config, '{wabaId}', to_jsonb($2::text)) WHERE id = $1 AND type IN ('meta_cloud', '360dialog')
     RETURNING id, type, name, phone_number, config, status, triage_enabled, hidden, welcome_message, created_at`,
    [id, wabaId]
  );
  if (result.rowCount === 0) return null;
  return toChannel(result.rows[0]);
}
```

Add `findChannelByWebhookToken` to `module.exports`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/channels/channel.repository.test.js`
Expected: PASS, all tests green (including every pre-existing test in the file — this
confirms the `meta_cloud`-only test cases for `findChannelByWabaId`/`updateChannelWabaId`
still pass unchanged under the new, broader queries)

- [ ] **Step 5: Commit**

```bash
git add src/channels/channel.repository.js src/channels/channel.repository.test.js
git commit -m "$(cat <<'EOF'
Add webhook-token lookup and generalize wabaId queries to 360dialog

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: 360dialog webhook route

**Files:**
- Create: `src/whatsapp-adapters/three-sixty-dialog.routes.js`
- Test: `src/whatsapp-adapters/three-sixty-dialog.routes.test.js`
- Modify: `src/server.js`

**Interfaces:**
- Consumes: `findChannelByWebhookToken` (Task 3); `parseInboundMessages`,
  `downloadMedia` from `./three-sixty-dialog.adapter` (Task 2); `ingestInboundMessage`,
  `applyTemplateStatusUpdates`, `applyMessageStatusUpdates` (existing, already used
  identically by `meta-cloud.routes.js`).
- Produces: `POST /webhooks/360dialog/:webhookToken` → 200 on success, 404 when the
  token doesn't match any channel or the channel is hidden.

- [ ] **Step 1: Write the failing tests**

```js
jest.mock('../channels/channel.repository');
jest.mock('../conversations/inbound-message.service');
jest.mock('../templates/template.service');
jest.mock('../conversations/message-status.service');
jest.mock('../media/media-storage', () => ({
  ...jest.requireActual('../media/media-storage'),
  saveMediaFile: jest.fn(),
}));
jest.mock('./three-sixty-dialog.adapter', () => ({
  ...jest.requireActual('./three-sixty-dialog.adapter'),
  downloadMedia: jest.fn(),
}));
const request = require('supertest');
const express = require('express');
const { findChannelByWebhookToken } = require('../channels/channel.repository');
const { ingestInboundMessage } = require('../conversations/inbound-message.service');
const { applyTemplateStatusUpdates } = require('../templates/template.service');
const { applyMessageStatusUpdates } = require('../conversations/message-status.service');
const { downloadMedia } = require('./three-sixty-dialog.adapter');
const threeSixtyDialogRoutes = require('./three-sixty-dialog.routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/webhooks', threeSixtyDialogRoutes);
  return app;
}

describe('POST /webhooks/360dialog/:webhookToken', () => {
  beforeEach(() => jest.clearAllMocks());

  test('processes a valid webhook payload for a matching channel', async () => {
    findChannelByWebhookToken.mockResolvedValue({ id: 'channel-1', hidden: false, config: { apiKey: 'key-1' } });
    ingestInboundMessage.mockResolvedValue({});

    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: '1234567890' },
                contacts: [{ profile: { name: 'Carlos' }, wa_id: '5511999998888' }],
                messages: [{ from: '5511999998888', id: 'wamid.ABC', type: 'text', text: { body: 'Ola' } }],
              },
            },
          ],
        },
      ],
    };

    const res = await request(buildApp()).post('/webhooks/360dialog/valid-token').send(payload);

    expect(res.status).toBe(200);
    expect(findChannelByWebhookToken).toHaveBeenCalledWith('valid-token');
    expect(ingestInboundMessage).toHaveBeenCalledWith({
      channelId: 'channel-1',
      fromPhoneNumber: '5511999998888',
      contactDisplayName: 'Carlos',
      whatsappMessageId: 'wamid.ABC',
      messageType: 'text',
      content: 'Ola',
      mediaPath: undefined,
      mediaMimeType: undefined,
      mediaFilename: undefined,
      locationLatitude: undefined,
      locationLongitude: undefined,
    });
  });

  test('returns 404 when the token matches no channel', async () => {
    findChannelByWebhookToken.mockResolvedValue(null);

    const res = await request(buildApp()).post('/webhooks/360dialog/unknown-token').send({ entry: [] });

    expect(res.status).toBe(404);
    expect(ingestInboundMessage).not.toHaveBeenCalled();
  });

  test('returns 404 when the matched channel is hidden', async () => {
    findChannelByWebhookToken.mockResolvedValue({ id: 'channel-1', hidden: true, config: {} });

    const res = await request(buildApp()).post('/webhooks/360dialog/hidden-token').send({ entry: [] });

    expect(res.status).toBe(404);
    expect(ingestInboundMessage).not.toHaveBeenCalled();
  });

  test('downloads media using the matched channel, not just an access token', async () => {
    findChannelByWebhookToken.mockResolvedValue({ id: 'channel-1', hidden: false, config: { apiKey: 'key-1' } });
    downloadMedia.mockResolvedValue(Buffer.from('fake-bytes'));
    ingestInboundMessage.mockResolvedValue({});

    const payload = {
      entry: [{ changes: [{ value: {
        metadata: { phone_number_id: '1234567890' },
        messages: [{ from: '5511999998888', id: 'wamid.IMG1', type: 'image', image: { id: 'media-1', mime_type: 'image/jpeg' } }],
      } }] }],
    };

    await request(buildApp()).post('/webhooks/360dialog/valid-token').send(payload);

    expect(downloadMedia).toHaveBeenCalledWith('media-1', { id: 'channel-1', hidden: false, config: { apiKey: 'key-1' } });
  });

  test('still returns 200 even if applyTemplateStatusUpdates and applyMessageStatusUpdates both throw', async () => {
    findChannelByWebhookToken.mockResolvedValue({ id: 'channel-1', hidden: false, config: {} });
    applyTemplateStatusUpdates.mockRejectedValue(new Error('boom'));
    applyMessageStatusUpdates.mockRejectedValue(new Error('boom'));

    const res = await request(buildApp()).post('/webhooks/360dialog/valid-token').send({ entry: [] });

    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/whatsapp-adapters/three-sixty-dialog.routes.test.js`
Expected: FAIL with "Cannot find module './three-sixty-dialog.routes'"

- [ ] **Step 3: Implement**

`src/whatsapp-adapters/three-sixty-dialog.routes.js`:
```js
const express = require('express');
const threeSixtyDialogAdapter = require('./three-sixty-dialog.adapter');
const { findChannelByWebhookToken } = require('../channels/channel.repository');
const { ingestInboundMessage } = require('../conversations/inbound-message.service');
const { applyTemplateStatusUpdates } = require('../templates/template.service');
const { applyMessageStatusUpdates } = require('../conversations/message-status.service');
const { saveMediaFile, extensionForMimeType } = require('../media/media-storage');

const router = express.Router();

router.post('/360dialog/:webhookToken', async (req, res) => {
  const channel = await findChannelByWebhookToken(req.params.webhookToken);
  if (!channel || channel.hidden) {
    return res.sendStatus(404);
  }

  const inboundMessages = threeSixtyDialogAdapter.parseInboundMessages(req.body);
  for (const inboundMessage of inboundMessages) {
    try {
      let mediaPath;
      if (inboundMessage.mediaId) {
        const buffer = await threeSixtyDialogAdapter.downloadMedia(inboundMessage.mediaId, channel);
        mediaPath = await saveMediaFile(buffer, extensionForMimeType(inboundMessage.mediaMimeType));
      }
      await ingestInboundMessage({
        channelId: channel.id,
        fromPhoneNumber: inboundMessage.fromPhoneNumber,
        contactDisplayName: inboundMessage.contactDisplayName,
        whatsappMessageId: inboundMessage.whatsappMessageId,
        messageType: inboundMessage.messageType,
        content: inboundMessage.content,
        mediaPath,
        mediaMimeType: inboundMessage.mediaMimeType,
        mediaFilename: inboundMessage.mediaFilename,
        locationLatitude: inboundMessage.latitude,
        locationLongitude: inboundMessage.longitude,
      });
    } catch (err) {
      console.error('Failed to process inbound 360dialog message', err);
    }
  }
  try {
    await applyTemplateStatusUpdates(req.body);
  } catch (err) {
    console.error('Failed to process 360dialog template status update webhook', err);
  }
  try {
    await applyMessageStatusUpdates(req.body);
  } catch (err) {
    console.error('Failed to process 360dialog message status update webhook', err);
  }
  res.sendStatus(200);
});

module.exports = router;
```

In `src/server.js`, add the require near the other webhook-adjacent requires (after
`metaCloudRoutes`, around line 9):
```js
const threeSixtyDialogRoutes = require('./whatsapp-adapters/three-sixty-dialog.routes');
```
And mount it near the existing `app.use('/webhooks', metaCloudRoutes);` line (currently
the last route mount before the error-handling middleware):
```js
app.use('/webhooks', threeSixtyDialogRoutes);
```
Do not touch any other line in `server.js`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/whatsapp-adapters/three-sixty-dialog.routes.test.js`
Expected: PASS, all tests green

- [ ] **Step 5: Commit**

```bash
git add src/whatsapp-adapters/three-sixty-dialog.routes.js src/whatsapp-adapters/three-sixty-dialog.routes.test.js src/server.js
git commit -m "$(cat <<'EOF'
Add the 360dialog webhook route

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Admin channel creation — 360dialog branch with automatic webhook registration

**Files:**
- Modify: `src/config/env.js`
- Modify: `src/api/admin-channels.routes.js`
- Test: `src/api/admin-channels.routes.test.js`

**Interfaces:**
- Consumes: `registerWebhook` from `../whatsapp-adapters/three-sixty-dialog.adapter`
  (Task 2); `loadConfig().publicBaseUrl` (this task adds it); `isOfficialChannelType`
  from `../channels/channel-types` (Task 1).
- Produces: `POST /api/admin/channels` accepts `type: '360dialog'` with `{apiKey,
  wabaId}`, registers the webhook automatically, and only creates the channel if that
  registration succeeds. `toChannelResponse` exposes `wabaId` for `360dialog` channels
  too.

- [ ] **Step 1: Update `src/config/env.js`**

```js
function loadConfig() {
  const required = [
    'DATABASE_URL',
    'JWT_SECRET',
    'REDIS_URL',
    'META_VERIFY_TOKEN',
    'META_APP_SECRET',
    'BAILEYS_SESSIONS_DIR',
    'MEDIA_STORAGE_DIR',
    'PUBLIC_BASE_URL',
  ];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  return {
    port: Number(process.env.PORT) || 3000,
    databaseUrl: process.env.DATABASE_URL,
    jwtSecret: process.env.JWT_SECRET,
    redisUrl: process.env.REDIS_URL,
    metaVerifyToken: process.env.META_VERIFY_TOKEN,
    metaAppSecret: process.env.META_APP_SECRET,
    baileysSessionsDir: process.env.BAILEYS_SESSIONS_DIR,
    mediaStorageDir: process.env.MEDIA_STORAGE_DIR,
    frontendOrigin: process.env.FRONTEND_ORIGIN || null,
    publicBaseUrl: process.env.PUBLIC_BASE_URL,
  };
}

module.exports = { loadConfig };
```

Add `PUBLIC_BASE_URL=http://localhost:3000` (or whatever this project's `.env`/
`.env.test` files use for local URLs — check `.env.example` if one exists, otherwise
use `http://localhost:3000`) to both `.env` and `.env.test` in the repo root, if a
`.env.example` file exists update it too. These are local dev files — check whether
they're gitignored before deciding whether to stage them (this project's `.env`/
`.env.test` are almost certainly gitignored already, matching how `META_VERIFY_TOKEN`
etc. already work; do not commit real secrets).

- [ ] **Step 2: Write the failing tests**

Add to `src/api/admin-channels.routes.test.js`, inside the existing
`describe('POST /api/admin/channels', ...)` block:

```js
  test('creates a 360dialog channel, registering the webhook first', async () => {
    threeSixtyDialogAdapter.registerWebhook.mockResolvedValue(undefined);
    createChannel.mockResolvedValue({
      id: 'channel-9', type: '360dialog', name: 'Via BSP', phoneNumber: '+5511999990009',
      config: { apiKey: 'd360-key', wabaId: 'waba-9', webhookToken: expect.any(String) },
      status: 'disconnected', triageEnabled: false, hidden: false, welcomeMessage: null,
    });

    const res = await request(buildApp())
      .post('/api/admin/channels')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ type: '360dialog', name: 'Via BSP', phoneNumber: '+5511999990009', apiKey: 'd360-key', wabaId: 'waba-9' });

    expect(res.status).toBe(201);
    expect(threeSixtyDialogAdapter.registerWebhook).toHaveBeenCalledTimes(1);
    const [registeredChannel, webhookUrl] = threeSixtyDialogAdapter.registerWebhook.mock.calls[0];
    expect(registeredChannel.config.apiKey).toBe('d360-key');
    expect(webhookUrl).toMatch(/^http:\/\/localhost:3000\/webhooks\/360dialog\/[a-f0-9]{48}$/);
    expect(createChannel).toHaveBeenCalledWith(expect.objectContaining({
      type: '360dialog', name: 'Via BSP', phoneNumber: '+5511999990009',
      config: expect.objectContaining({ apiKey: 'd360-key', wabaId: 'waba-9' }),
    }));
  });

  test('rejects a 360dialog channel missing apiKey', async () => {
    const res = await request(buildApp())
      .post('/api/admin/channels')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ type: '360dialog', name: 'Via BSP', phoneNumber: '+5511999990009', wabaId: 'waba-9' });

    expect(res.status).toBe(400);
    expect(createChannel).not.toHaveBeenCalled();
  });

  test('rejects a 360dialog channel missing wabaId', async () => {
    const res = await request(buildApp())
      .post('/api/admin/channels')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ type: '360dialog', name: 'Via BSP', phoneNumber: '+5511999990009', apiKey: 'd360-key' });

    expect(res.status).toBe(400);
    expect(createChannel).not.toHaveBeenCalled();
  });

  test('does not create the channel when webhook registration fails', async () => {
    threeSixtyDialogAdapter.registerWebhook.mockRejectedValue(new Error('401 Unauthorized'));

    const res = await request(buildApp())
      .post('/api/admin/channels')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ type: '360dialog', name: 'Via BSP', phoneNumber: '+5511999990009', apiKey: 'bad-key', wabaId: 'waba-9' });

    expect(res.status).toBe(400);
    expect(createChannel).not.toHaveBeenCalled();
  });
```

Add the mock and import at the top of the test file:
```js
jest.mock('../whatsapp-adapters/three-sixty-dialog.adapter');
```
```js
const threeSixtyDialogAdapter = require('../whatsapp-adapters/three-sixty-dialog.adapter');
```
And set `process.env.PUBLIC_BASE_URL = 'http://localhost:3000';` in a `beforeEach` (or
confirm it's already set globally for the test environment via `.env.test` — check
before adding a duplicate).

Also add a test to the existing `describe(...)` block covering `toChannelResponse` (find
the `GET /api/admin/channels` describe block) proving `wabaId` is now exposed for a
`360dialog` channel too:
```js
  test('includes wabaId for a 360dialog channel', async () => {
    listChannels.mockResolvedValue([
      { id: 'channel-9', type: '360dialog', name: 'Via BSP', phoneNumber: '+5511999990009', config: { apiKey: 'k', wabaId: 'waba-9', webhookToken: 't' }, status: 'disconnected', triageEnabled: false, hidden: false, welcomeMessage: null },
    ]);
    const res = await request(buildApp())
      .get('/api/admin/channels')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`);
    expect(res.body[0].wabaId).toBe('waba-9');
  });
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx jest src/api/admin-channels.routes.test.js`
Expected: FAIL — 360dialog branch doesn't exist yet, `toChannelResponse` doesn't expose
`wabaId` for 360dialog

- [ ] **Step 4: Implement**

In `src/api/admin-channels.routes.js`, add imports at the top:
```js
const crypto = require('crypto');
const { loadConfig } = require('../config/env');
const threeSixtyDialogAdapter = require('../whatsapp-adapters/three-sixty-dialog.adapter');
const { isOfficialChannelType } = require('../channels/channel-types');
```

Update `toChannelResponse`:
```js
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
    wabaId: isOfficialChannelType(channel.type) ? channel.config.wabaId : undefined,
  };
}
```

Update `POST /` — add the `360dialog` branch before the final fallback, and update the
fallback error message:
```js
router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  const { type, name, phoneNumber } = req.body || {};
  if (!type || !name || !phoneNumber) {
    return res.status(400).json({ error: 'type, name and phoneNumber are required' });
  }

  try {
    if (type === 'meta_cloud') {
      const { phoneNumberId, accessToken, wabaId } = req.body;
      if (!phoneNumberId || !accessToken || !wabaId) {
        return res.status(400).json({ error: 'phoneNumberId, accessToken and wabaId are required for meta_cloud channels' });
      }
      const channel = await createChannel({ type, name, phoneNumber, config: { phoneNumberId, accessToken, wabaId } });
      return res.status(201).json(channel);
    }

    if (type === '360dialog') {
      const { apiKey, wabaId } = req.body;
      if (!apiKey || !wabaId) {
        return res.status(400).json({ error: 'apiKey and wabaId are required for 360dialog channels' });
      }
      const webhookToken = crypto.randomBytes(24).toString('hex');
      const config = { apiKey, wabaId, webhookToken };
      const webhookUrl = `${loadConfig().publicBaseUrl}/webhooks/360dialog/${webhookToken}`;
      try {
        await threeSixtyDialogAdapter.registerWebhook({ config }, webhookUrl);
      } catch (err) {
        return res.status(400).json({ error: 'Não foi possível registrar o webhook na 360dialog — confira a API Key' });
      }
      const channel = await createChannel({ type, name, phoneNumber, config });
      return res.status(201).json(channel);
    }

    if (type === 'baileys') {
      const channel = await baileysManager.addBaileysChannel({ name, phoneNumber });
      return res.status(201).json(channel);
    }
  } catch (err) {
    if (err.code === UNIQUE_VIOLATION) {
      return res.status(409).json({ error: 'A channel with this phone number already exists' });
    }
    throw err;
  }

  return res.status(400).json({ error: 'type must be meta_cloud, baileys, or 360dialog' });
});
```

Do not touch `PATCH /:id`, `POST /:id/reconnect`, `DELETE /:id`, or `GET /:id/qr` in
this task — `PATCH /:id`'s `wabaId` update already works for `360dialog` automatically
because Task 3 already generalized `updateChannelWabaId` itself; no route-level change
is needed there.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest src/api/admin-channels.routes.test.js`
Expected: PASS, all tests green (run the full file, not just the new tests — this file
is large and shared across all three channel types)

- [ ] **Step 6: Commit**

```bash
git add src/config/env.js src/api/admin-channels.routes.js src/api/admin-channels.routes.test.js
git commit -m "$(cat <<'EOF'
Create 360dialog channels with automatic webhook registration

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

(If you added `PUBLIC_BASE_URL` to `.env`/`.env.test` and they are gitignored — expected
— do not `git add` them; only stage the three files above. If either file is NOT
gitignored, stop and report this to the controller rather than committing local
environment values.)

---

### Task 6: Outbound worker — route 360dialog messages through the new adapter

**Files:**
- Modify: `src/queue/outbound-worker.js`
- Test: `src/queue/outbound-worker.test.js`

**Interfaces:**
- Consumes: the full adapter contract from Task 2.
- Produces: `ADAPTERS_BY_CHANNEL_TYPE['360dialog']` routes outbound sends through
  `three-sixty-dialog.adapter.js`.

- [ ] **Step 1: Write the failing test**

Add to `src/queue/outbound-worker.test.js`, mirroring the existing
`'sends via the Meta Cloud adapter when the channel type is meta_cloud'` test:

```js
  test('sends via the 360dialog adapter when the channel type is 360dialog', async () => {
    findChannelById.mockResolvedValue({ id: 'channel-3', type: '360dialog', config: { apiKey: 'key-1', wabaId: 'waba-1' } });
    threeSixtyDialogAdapter.sendTextMessage.mockResolvedValue({ whatsappMessageId: 'D360_OUT_1' });
    getConversationWithContact.mockResolvedValue({ id: 'conv-1', contactPhoneNumber: '5511999998888', assignedAgentId: null });
    recordMessageSent.mockResolvedValue({ id: 'msg-1' });

    await handler({ messageId: 'msg-1', conversationId: 'conv-1', channelId: 'channel-3', content: 'Ola' });

    expect(threeSixtyDialogAdapter.sendTextMessage).toHaveBeenCalledWith(
      { id: 'channel-3', type: '360dialog', config: { apiKey: 'key-1', wabaId: 'waba-1' } },
      '5511999998888',
      'Ola'
    );
    expect(metaCloudAdapter.sendTextMessage).not.toHaveBeenCalled();
    expect(baileysManager.sendTextMessage).not.toHaveBeenCalled();
  });
```

Add `jest.mock('../whatsapp-adapters/three-sixty-dialog.adapter');` alongside the
existing `jest.mock(...)` calls at the top of the file, and
`const threeSixtyDialogAdapter = require('../whatsapp-adapters/three-sixty-dialog.adapter');`
alongside the other adapter imports.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/queue/outbound-worker.test.js -t "360dialog"`
Expected: FAIL — `channel.type` `'360dialog'` has no entry in `ADAPTERS_BY_CHANNEL_TYPE`,
so `adapter` is `undefined` and the call throws

- [ ] **Step 3: Implement**

In `src/queue/outbound-worker.js`, add the import near the other adapter requires:
```js
const threeSixtyDialogAdapter = require('../whatsapp-adapters/three-sixty-dialog.adapter');
```
Update `ADAPTERS_BY_CHANNEL_TYPE`:
```js
const ADAPTERS_BY_CHANNEL_TYPE = {
  meta_cloud: metaCloudAdapter,
  baileys: baileysManager,
  '360dialog': threeSixtyDialogAdapter,
};
```
Do not touch anything else in this file.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/queue/outbound-worker.test.js`
Expected: PASS, all tests green

- [ ] **Step 5: Commit**

```bash
git add src/queue/outbound-worker.js src/queue/outbound-worker.test.js
git commit -m "$(cat <<'EOF'
Route outbound messages for 360dialog channels through their adapter

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Template service — adapter selection + official-channel gating

**Files:**
- Modify: `src/templates/template.service.js`
- Test: `src/templates/template.service.test.js`

**Interfaces:**
- Consumes: `isOfficialChannelType` (Task 1); the adapter contract (Task 2).
- Produces: `createTemplate`, `registerExistingTemplate`, `deleteTemplate`,
  `syncTemplatesForWaba` all work identically for `360dialog` channels as they already
  do for `meta_cloud`.

**Important:** `applyTemplateStatusUpdates(webhookBody)` does NOT change — it only
parses a webhook body via `metaCloudAdapter.parseTemplateStatusUpdates`, a pure function
with no channel/adapter selection, and `three-sixty-dialog.adapter.js` re-exports that
exact same function (Task 2), so 360dialog webhooks already parse correctly through the
existing call. Do not touch this function.

- [ ] **Step 1: Write the failing tests**

Add to `src/templates/template.service.test.js`, inside the existing
`describe('createTemplate', ...)` block, a new test alongside the existing
`'rejects when the channel is not meta_cloud'` test (do not modify that existing test —
it still correctly rejects `baileys`):

```js
  test('accepts a 360dialog channel the same way it accepts meta_cloud', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', type: '360dialog', config: { apiKey: 'key-1', wabaId: 'waba-1' } });
    threeSixtyDialogAdapter.createMetaTemplate.mockResolvedValue({ metaTemplateId: 'meta-tpl-9', status: 'PENDING' });
    createTemplateRecord.mockResolvedValue({ id: 'local-1', wabaId: 'waba-1', metaTemplateId: 'meta-tpl-9', name: 'fatura_vencida', language: 'pt_BR', category: 'UTILITY', bodyText: validInput.bodyText, variableCount: 1, status: 'PENDING', rejectionReason: null, createdAt: new Date() });

    await createTemplate(validInput);

    expect(threeSixtyDialogAdapter.createMetaTemplate).toHaveBeenCalledWith(
      { id: 'ch-1', type: '360dialog', config: { apiKey: 'key-1', wabaId: 'waba-1' } },
      expect.objectContaining({ name: 'fatura_vencida' })
    );
    expect(metaCloudAdapter.createMetaTemplate).not.toHaveBeenCalled();
  });
```

Add, inside the existing `describe('registerExistingTemplate', ...)` block, alongside
its existing `'rejects when the channel is not meta_cloud'` test:

```js
  test('accepts a 360dialog channel the same way it accepts meta_cloud', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', type: '360dialog', config: { wabaId: 'waba-1' } });
    threeSixtyDialogAdapter.listMetaTemplates.mockResolvedValue([
      { id: 984, name: 'aviso_cobranca', language: 'pt_BR', category: 'UTILITY', status: 'APPROVED', components: [{ type: 'BODY', text: 'Ola {{1}}' }] },
    ]);
    createTemplateRecord.mockResolvedValue({ id: 'local-1', metaTemplateId: '984', name: 'aviso_cobranca', status: 'PENDING' });
    updateTemplateStatusByMetaTemplateId.mockResolvedValue({ id: 'local-1', metaTemplateId: '984', status: 'APPROVED' });

    await registerExistingTemplate({ channelId: 'ch-1', name: 'aviso_cobranca', language: 'pt_BR' });

    expect(threeSixtyDialogAdapter.listMetaTemplates).toHaveBeenCalledWith({ id: 'ch-1', type: '360dialog', config: { wabaId: 'waba-1' } });
    expect(metaCloudAdapter.listMetaTemplates).not.toHaveBeenCalled();
  });
```

Add a test to a `describe('deleteTemplate', ...)` block (find it, or add one if this
exact function has no dedicated describe block yet — check the file's structure) proving
`deleteTemplate` calls the right adapter for a `360dialog`-owned template:

```js
  test('deletes via the 360dialog adapter when the owning channel is 360dialog', async () => {
    findTemplateById.mockResolvedValue({ id: 'local-1', wabaId: 'waba-1', name: 'fatura_vencida', metaTemplateId: 'meta-tpl-1' });
    findChannelByWabaId.mockResolvedValue({ id: 'ch-1', type: '360dialog', config: { apiKey: 'key-1', wabaId: 'waba-1' } });
    deleteTemplateRecord.mockResolvedValue(true);

    await deleteTemplate('local-1');

    expect(threeSixtyDialogAdapter.deleteMetaTemplate).toHaveBeenCalledWith(
      { id: 'ch-1', type: '360dialog', config: { apiKey: 'key-1', wabaId: 'waba-1' } },
      { name: 'fatura_vencida', metaTemplateId: 'meta-tpl-1' }
    );
    expect(metaCloudAdapter.deleteMetaTemplate).not.toHaveBeenCalled();
  });
```

Add at the top of the test file: `jest.mock('../whatsapp-adapters/three-sixty-dialog.adapter');`
and `const threeSixtyDialogAdapter = require('../whatsapp-adapters/three-sixty-dialog.adapter');`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/templates/template.service.test.js`
Expected: FAIL — `channel.type !== 'meta_cloud'` rejects `360dialog` channels, and
`metaCloudAdapter` is hardcoded so `threeSixtyDialogAdapter`'s mocks are never called

- [ ] **Step 3: Implement**

In `src/templates/template.service.js`, add imports:
```js
const threeSixtyDialogAdapter = require('../whatsapp-adapters/three-sixty-dialog.adapter');
const { isOfficialChannelType } = require('../channels/channel-types');

const ADAPTERS_BY_CHANNEL_TYPE = {
  meta_cloud: metaCloudAdapter,
  '360dialog': threeSixtyDialogAdapter,
};
```

In `createTemplate`, change:
```js
  if (!channel || channel.type !== 'meta_cloud') {
    throw new TemplateValidationError('channelId must reference a meta_cloud channel');
  }
```
to:
```js
  if (!channel || !isOfficialChannelType(channel.type)) {
    throw new TemplateValidationError('channelId must reference an official channel (meta_cloud or 360dialog)');
  }
```
and change the `metaCloudAdapter.createMetaTemplate(channel, ...)` call to
`ADAPTERS_BY_CHANNEL_TYPE[channel.type].createMetaTemplate(channel, ...)`. Do the same
for the rollback `metaCloudAdapter.deleteMetaTemplate(channel, ...)` call inside the
same function's catch block.

In `registerExistingTemplate`, apply the identical two changes: the `channel.type
!== 'meta_cloud'` guard becomes `!isOfficialChannelType(channel.type)` (same new error
message), and `metaCloudAdapter.listMetaTemplates(channel)` becomes
`ADAPTERS_BY_CHANNEL_TYPE[channel.type].listMetaTemplates(channel)`.

In `deleteTemplate`, change `metaCloudAdapter.deleteMetaTemplate(channel, ...)` to
`ADAPTERS_BY_CHANNEL_TYPE[channel.type].deleteMetaTemplate(channel, ...)`.

In `syncTemplatesForWaba`, change `metaCloudAdapter.listMetaTemplates(channel)` to
`ADAPTERS_BY_CHANNEL_TYPE[channel.type].listMetaTemplates(channel)`.

Leave `applyTemplateStatusUpdates` completely untouched (see the Interfaces note above).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/templates/template.service.test.js`
Expected: PASS, all tests green — including every pre-existing test that asserts
`baileys` channels are still rejected (the new error message text changed, so if any
pre-existing test asserts the OLD exact error string, update that assertion to expect
`TemplateValidationError` generically via `.rejects.toThrow(TemplateValidationError)`,
which is what the existing tests already do — they should keep passing unchanged since
none of them assert the literal message text; confirm this by reading the file, and
only touch a test if it genuinely breaks).

- [ ] **Step 5: Commit**

```bash
git add src/templates/template.service.js src/templates/template.service.test.js
git commit -m "$(cat <<'EOF'
Let template management work for 360dialog channels too

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Conversations routes — generalize /start's three channel-type checks

**Files:**
- Modify: `src/api/conversations.routes.js`
- Test: `src/api/conversations.routes.test.js`

**Interfaces:**
- Consumes: `isOfficialChannelType` (Task 1).
- Produces: `POST /start` treats `360dialog` identically to `meta_cloud` in all three
  places it currently checks the type.

**Important — this file has exactly three distinct `meta_cloud`-related checks in
`/start` (confirmed by reading the full handler, lines 85-173), each with different
logic. Do not conflate them:**

1. Line 85 — `if (channel.type !== 'baileys' && channel.type !== 'meta_cloud')` → 400
   "Unsupported channel type". Generalize to
   `if (channel.type !== 'baileys' && !isOfficialChannelType(channel.type))`.
2. Line 122 — `template.wabaId !== channel.config.wabaId`. **Do not change this line at
   all** — it already works correctly for `360dialog` because Task 5 already ensures
   `360dialog` channels store `wabaId` the same way `meta_cloud` does.
3. Line 166 — `if (channel.type !== 'meta_cloud') { await sendOpeningMessageIfApplicable(...) }`.
   This is INVERTED logic from the other two (it skips the call FOR official channels,
   because the assignment-message feature's free-text opening message would fail
   outside 360dialog/meta_cloud's 24h window on a business-initiated `/start`).
   Generalize to `if (!isOfficialChannelType(channel.type))` — skip for `meta_cloud`
   AND `360dialog`, fire only for `baileys`.

- [ ] **Step 1: Write the failing tests**

Add to `src/api/conversations.routes.test.js`, inside the existing
`describe('POST /api/conversations/start', ...)` block. Find the existing test that
proves the `meta_cloud`-only "Unsupported channel type" gate accepts `meta_cloud`
(search for `BAILEYS_CHANNEL` and the template-based happy-path tests near it to match
this file's exact fixture conventions), and add:

```js
  test('accepts a 360dialog channel in the type gate, same as meta_cloud', async () => {
    const threeSixtyDialogChannel = { id: 'channel-1', type: '360dialog', config: { wabaId: 'waba-1' } };
    findChannelById.mockResolvedValue(threeSixtyDialogChannel);
    findTemplateById.mockResolvedValue({ id: 'tpl-1', status: 'APPROVED', wabaId: 'waba-1', variableCount: 0, bodyText: 'Oi', name: 'saudacao', language: 'pt_BR' });
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-1', phoneNumber: '559899990000' });
    findOpenConversation.mockResolvedValue(null);
    createConversation.mockResolvedValue({ id: CONVERSATION_ID, contactId: 'contact-1', channelId: 'channel-1' });
    claimConversation.mockResolvedValue({ id: CONVERSATION_ID, contactId: 'contact-1', channelId: 'channel-1', assignedAgentId: 'agent-1', protocolNumber: null });
    getConversationWithContact.mockResolvedValue({ id: CONVERSATION_ID, contactId: 'contact-1', channelId: 'channel-1', assignedAgentId: 'agent-1', contactPhoneNumber: '559899990000' });

    const res = await request(buildApp())
      .post('/api/conversations/start')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ channelId: 'channel-1', phoneNumber: '5598999990000', templateId: 'tpl-1', templateVariables: [] });

    expect(res.status).not.toBe(400);
  });

  test('does not dispatch the assignment opening message for a 360dialog channel', async () => {
    const threeSixtyDialogChannel = { id: 'channel-1', type: '360dialog', config: { wabaId: 'waba-1' } };
    findChannelById.mockResolvedValue(threeSixtyDialogChannel);
    findTemplateById.mockResolvedValue({ id: 'tpl-1', status: 'APPROVED', wabaId: 'waba-1', variableCount: 0, bodyText: 'Oi', name: 'saudacao', language: 'pt_BR' });
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-1', phoneNumber: '559899990000' });
    findOpenConversation.mockResolvedValue(null);
    createConversation.mockResolvedValue({ id: CONVERSATION_ID, contactId: 'contact-1', channelId: 'channel-1' });
    claimConversation.mockResolvedValue({ id: CONVERSATION_ID, contactId: 'contact-1', channelId: 'channel-1', assignedAgentId: 'agent-1', protocolNumber: null });
    getConversationWithContact.mockResolvedValue({ id: CONVERSATION_ID, contactId: 'contact-1', channelId: 'channel-1', assignedAgentId: 'agent-1', contactPhoneNumber: '559899990000' });

    await request(buildApp())
      .post('/api/conversations/start')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ channelId: 'channel-1', phoneNumber: '5598999990000', templateId: 'tpl-1', templateVariables: [] });

    expect(sendOpeningMessageIfApplicable).not.toHaveBeenCalled();
  });
```

Check this file's real fixture/mock names before finalizing (`findTemplateById`,
`findOrCreateContactByPhoneNumber`, `findOpenConversation`, `createConversation`,
`claimConversation`, `getConversationWithContact`, `CONVERSATION_ID`,
`sendOpeningMessageIfApplicable` should already be imported/mocked at the top of this
file from earlier tasks this session — reuse them, do not redeclare).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/api/conversations.routes.test.js -t "360dialog"`
Expected: FAIL — the type gate rejects `360dialog` with 400, and (once that's fixed
manually to check) the opening-message dispatch would fire for `360dialog` before this
task's fix

- [ ] **Step 3: Implement**

In `src/api/conversations.routes.js`, add the import:
```js
const { isOfficialChannelType } = require('../channels/channel-types');
```

Change line 85:
```js
  if (channel.type !== 'baileys' && !isOfficialChannelType(channel.type)) {
    return res.status(400).json({ error: 'Unsupported channel type' });
  }
```

Leave line 122 (`template.wabaId !== channel.config.wabaId`) completely unchanged.

Change line 166:
```js
  if (!isOfficialChannelType(channel.type)) {
    try {
      await sendOpeningMessageIfApplicable(claimed, req.agent.agentId);
    } catch (err) {
      console.error(`Failed to send assignment opening message for conversation ${claimed.id}`, err);
    }
  }
```

Do not touch `/:id/claim`, `/:id/close`, or `/:id/transfer` in this task.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/api/conversations.routes.test.js`
Expected: PASS, all tests green — run the full file, since this is a shared,
high-traffic route file touched by two earlier features this session

- [ ] **Step 5: Commit**

```bash
git add src/api/conversations.routes.js src/api/conversations.routes.test.js
git commit -m "$(cat <<'EOF'
Treat 360dialog like meta_cloud in the /start route's channel-type checks

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: SGP integration mode — generalize to 360dialog

**Files:**
- Modify: `src/api/admin-integrations.routes.js`
- Test: `src/api/admin-integrations.routes.test.js`

**Interfaces:**
- Consumes: `isOfficialChannelType` (Task 1).
- Produces: `modeForChannel(channel)` returns `'template'` for `360dialog` channels too
  (previously only `meta_cloud`).

- [ ] **Step 1: Write the failing test**

Add to `src/api/admin-integrations.routes.test.js`, inside the existing
`describe('POST /api/admin/integrations/sgp', ...)` block, alongside the existing
`'derives mode "template" for a meta_cloud channel...'` test:

```js
  test('derives mode "template" for a 360dialog channel too', async () => {
    const threeSixtyDialogChannel = { id: 'channel-3', type: '360dialog' };
    findChannelById.mockResolvedValue(threeSixtyDialogChannel);
    createSgpIntegration.mockResolvedValue({ id: 'int-3', description: 'Via BSP', channelId: 'channel-3', mode: 'template', defaultTemplateId: 'tpl-1', enabled: true, hasApiKey: false });

    const res = await request(buildApp())
      .post('/api/admin/integrations/sgp')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ description: 'Via BSP', channelId: 'channel-3', defaultTemplateId: 'tpl-1', enabled: true });

    expect(createSgpIntegration).toHaveBeenCalledWith({ description: 'Via BSP', channelId: 'channel-3', mode: 'template', defaultTemplateId: 'tpl-1', enabled: true });
    expect(res.status).toBe(201);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/api/admin-integrations.routes.test.js -t "360dialog"`
Expected: FAIL — `modeForChannel` returns `'freetext'` for a `360dialog` channel today

- [ ] **Step 3: Implement**

In `src/api/admin-integrations.routes.js`, add the import:
```js
const { isOfficialChannelType } = require('../channels/channel-types');
```
Change `modeForChannel`:
```js
function modeForChannel(channel) {
  return isOfficialChannelType(channel.type) ? 'template' : 'freetext';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/api/admin-integrations.routes.test.js`
Expected: PASS, all tests green

- [ ] **Step 5: Commit**

```bash
git add src/api/admin-integrations.routes.js src/api/admin-integrations.routes.test.js
git commit -m "$(cat <<'EOF'
Derive template mode for 360dialog channels in the SGP integration

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Frontend — third channel type in the create-channel flow

**Files:**
- Modify: `frontend/src/components/CreateChannelModal.jsx`
- Modify: `frontend/src/components/CreateChannelForm.jsx`
- Test: `frontend/src/components/CreateChannelModal.test.jsx`
- Test: `frontend/src/components/CreateChannelForm.test.jsx`

**Interfaces:**
- Produces: a third option card ("360dialog (oficial via BSP)") in the create-channel
  popup; the form shows `apiKey`/`wabaId` fields when `type === '360dialog'` and posts
  `{type, name, phoneNumber, apiKey, wabaId}`.

- [ ] **Step 1: Write the failing tests**

Read `frontend/src/components/CreateChannelModal.test.jsx` and
`frontend/src/components/CreateChannelForm.test.jsx` in full first, to match their
existing conventions exactly (mock setup, query style) — this plan gives you the
concrete test bodies below, but the surrounding `describe`/`beforeEach`/import
boilerplate must match what's already there, not be guessed.

Add to `CreateChannelModal.test.jsx`:
```jsx
test('shows a third option for 360dialog and leads to its form', async () => {
  render(<CreateChannelModal onClose={vi.fn()} onCreated={vi.fn()} />);

  expect(screen.getByText(/360dialog/i)).toBeInTheDocument();

  await userEvent.click(screen.getByText(/360dialog/i));

  expect(screen.getByLabelText(/api key/i)).toBeInTheDocument();
});
```

Add to `CreateChannelForm.test.jsx`:
```jsx
test('shows apiKey and wabaId fields only for type 360dialog', () => {
  render(<CreateChannelForm type="360dialog" onCreated={vi.fn()} />);
  expect(screen.getByLabelText(/api key/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/waba id/i)).toBeInTheDocument();
  expect(screen.queryByLabelText(/phone number id/i)).not.toBeInTheDocument();
});

test('submits the 360dialog payload with apiKey and wabaId', async () => {
  api.createChannel.mockResolvedValue({ id: 'channel-9' });
  render(<CreateChannelForm type="360dialog" onCreated={vi.fn()} />);

  await userEvent.type(screen.getByLabelText(/^nome$/i), 'Via BSP');
  await userEvent.type(screen.getByLabelText(/telefone/i), '+5511999990009');
  await userEvent.type(screen.getByLabelText(/api key/i), 'd360-key-abc');
  await userEvent.type(screen.getByLabelText(/waba id/i), 'waba-9');
  await userEvent.click(screen.getByRole('button', { name: /cadastrar/i }));

  expect(api.createChannel).toHaveBeenCalledWith(
    { type: '360dialog', name: 'Via BSP', phoneNumber: '+5511999990009', apiKey: 'd360-key-abc', wabaId: 'waba-9' },
    'tok-123'
  );
});
```
(Adjust label/text queries to match this file's real conventions — read it first, as
instructed above; these bodies show the required behavior, not necessarily
byte-for-byte final selectors if the real file's existing `meta_cloud` tests use a
different query style for e.g. the "Nome"/"Telefone" fields — match whatever's already
there.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/CreateChannelModal.test.jsx src/components/CreateChannelForm.test.jsx`
Expected: FAIL — no 360dialog option/fields exist yet

- [ ] **Step 3: Implement**

In `frontend/src/components/CreateChannelModal.jsx`, add a third entry to
`TYPE_OPTIONS`:
```js
const TYPE_OPTIONS = [
  {
    value: 'baileys',
    label: 'Baileys (não oficial)',
    description: 'Conecta pelo WhatsApp normal, escaneando um QR code — mais rápido de configurar.',
  },
  {
    value: 'meta_cloud',
    label: 'Meta Cloud (oficial)',
    description: 'API oficial da Meta — precisa de Phone Number ID, Access Token e WABA ID.',
  },
  {
    value: '360dialog',
    label: '360dialog (oficial via BSP)',
    description: 'API oficial via 360dialog — precisa só da API Key (D360-API-KEY) e do WABA ID.',
  },
];
```
No other change needed in this file — it already renders `TYPE_OPTIONS` generically and
passes `type` straight through to `CreateChannelForm`.

In `frontend/src/components/CreateChannelForm.jsx`, add `apiKey` state and the
conditional fields. Full updated component:
```jsx
import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { createChannel } from '../services/api';

const inputClass =
  'w-full rounded-xl border border-ink-950/15 bg-white/60 px-3.5 py-2.5 text-ink-950 placeholder-ink-950/35 outline-none transition focus:border-teal-signal/60 focus:bg-white/90 focus:ring-2 focus:ring-teal-signal/25';
const labelClass = 'mb-1.5 block text-sm font-medium text-ink-950/70';

function CreateChannelForm({ type, onCreated, onCancel }) {
  const { token } = useAuth();
  const [name, setName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [wabaId, setWabaId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    const payload =
      type === 'meta_cloud'
        ? { type, name, phoneNumber, phoneNumberId, accessToken, wabaId }
        : type === '360dialog'
          ? { type, name, phoneNumber, apiKey, wabaId }
          : { type, name, phoneNumber };
    try {
      await createChannel(payload, token);
      setName('');
      setPhoneNumber('');
      setPhoneNumberId('');
      setAccessToken('');
      setWabaId('');
      setApiKey('');
      onCreated();
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao cadastrar canal');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label htmlFor="name" className={labelClass}>
          Nome
        </label>
        <input id="name" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} required />
      </div>
      <div>
        <label htmlFor="phoneNumber" className={labelClass}>
          Telefone
        </label>
        <input
          id="phoneNumber"
          value={phoneNumber}
          onChange={(e) => setPhoneNumber(e.target.value)}
          placeholder="+5511999998888"
          className={inputClass}
          required
        />
      </div>
      {type === 'meta_cloud' && (
        <>
          <div>
            <label htmlFor="phoneNumberId" className={labelClass}>
              Phone Number ID
            </label>
            <input
              id="phoneNumberId"
              value={phoneNumberId}
              onChange={(e) => setPhoneNumberId(e.target.value)}
              className={inputClass}
              required
            />
          </div>
          <div>
            <label htmlFor="accessToken" className={labelClass}>
              Access Token
            </label>
            <input
              id="accessToken"
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              className={inputClass}
              required
            />
          </div>
          <div>
            <label htmlFor="wabaId" className={labelClass}>
              WABA ID
            </label>
            <input id="wabaId" value={wabaId} onChange={(e) => setWabaId(e.target.value)} className={inputClass} required />
          </div>
        </>
      )}
      {type === '360dialog' && (
        <>
          <div>
            <label htmlFor="apiKey" className={labelClass}>
              API Key (D360-API-KEY)
            </label>
            <input id="apiKey" value={apiKey} onChange={(e) => setApiKey(e.target.value)} className={inputClass} required />
          </div>
          <div>
            <label htmlFor="wabaId360" className={labelClass}>
              WABA ID
            </label>
            <input id="wabaId360" value={wabaId} onChange={(e) => setWabaId(e.target.value)} className={inputClass} required />
          </div>
        </>
      )}
      {error && <p className="rounded-lg border border-red-300 bg-red-50/80 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-xl bg-gradient-to-r from-amber-signal to-amber-signal-dark px-4 py-2.5 font-medium text-ink-950 shadow-[0_10px_30px_-8px_rgba(242,169,60,0.5)] transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-signal/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          Cadastrar
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-ink-950/15 bg-white/50 px-3 py-1.5 text-sm font-medium text-ink-950/70 transition hover:bg-white/80 hover:text-ink-950"
          >
            Cancelar
          </button>
        )}
      </div>
    </form>
  );
}

export default CreateChannelForm;
```
(The `wabaId360` id, distinct from `meta_cloud`'s own `wabaId` field id, exists purely
because the two conditional blocks never render together but DOM element ids must
still be unique per page — both bind to the same `wabaId` state variable.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/CreateChannelModal.test.jsx src/components/CreateChannelForm.test.jsx`
Expected: PASS, all tests green

Then check `frontend/src/pages/AdminChannelsPage.test.jsx` — this file has repeatedly
needed small adjustments this session when channel-creation UI changed, because it
renders child components for real on some interactions. Run:
`cd frontend && npx vitest run src/pages/AdminChannelsPage.test.jsx`
If it fails, make the minimal fix (same pattern as every prior instance this session);
if it already passes, that's a valid outcome — note it and move on.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/CreateChannelModal.jsx frontend/src/components/CreateChannelForm.jsx frontend/src/components/CreateChannelModal.test.jsx frontend/src/components/CreateChannelForm.test.jsx
git commit -m "$(cat <<'EOF'
Add 360dialog as a third channel type in the create-channel UI

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

(If Step 4's `AdminChannelsPage.test.jsx` check required a fix, stage and commit that
file separately, same pattern as prior instances this session.)

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

Additionally, since this feature adds a new required environment variable
(`PUBLIC_BASE_URL`), confirm before finishing that it's documented wherever this
project tracks required env vars for deployment (check for a `.env.example` file or
deployment notes), and flag to the user that Render's environment needs this variable
set before the branch is deployed — same "config before deploy" discipline already
established for this project's migrations.
