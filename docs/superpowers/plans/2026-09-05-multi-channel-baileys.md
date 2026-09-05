# Múltiplos Canais WhatsApp (Baileys dinâmico + administração de canais) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let DW Telecom add WhatsApp channels — official (Meta Cloud) or unofficial (Baileys) — as a running-system admin operation, and support any number of simultaneous Baileys connections instead of a single fixed one.

**Architecture:** A new `baileys.manager.js` module keeps one Baileys socket per `baileys`-type channel row, persisting each session under its own directory. A new admin HTTP API creates channels and exposes a browser-viewable QR page. The inbound realtime-emission logic that today lives in the Meta Cloud webhook route moves into `ingestInboundMessage` so both channel types get identical persistence + realtime behavior for free, and the outbound worker is fixed to pick the adapter by `channel.type` instead of hardcoding Meta Cloud.

**Tech Stack:** Node.js/Express (CommonJS), `@whiskeysockets/baileys` (new dependency), `qrcode` (new dependency), PostgreSQL (`pg`), Jest + Supertest, existing `jsonwebtoken`/`socket.io` infrastructure.

**Spec:** [docs/superpowers/specs/2026-09-05-multi-channel-baileys-design.md](../specs/2026-09-05-multi-channel-baileys-design.md) (extends [2026-09-04-whatsapp-attendance-system-design.md](../specs/2026-09-04-whatsapp-attendance-system-design.md))

## Global Constraints

- `package.json`'s `jest.maxWorkers` MUST stay `1`. Never remove it (real-Postgres test races).
- Modular monolith: everything runs in the same Node process. No separate service/process for Baileys.
- No database schema migration is needed for this plan — `channels.status` already includes `awaiting_qr`, and `channels.config` (JSONB) / `channels.phone_number` are already generic enough for any channel type.
- Every WhatsApp adapter (Meta Cloud, Baileys) exposes `sendTextMessage(channel, toPhoneNumber, content) -> Promise<{ whatsappMessageId }>` with this exact signature and return shape.
- `@whiskeysockets/baileys` is mocked entirely in tests (never contact real WhatsApp servers), the same pattern already used for mocking `axios` in the Meta Cloud adapter's tests.
- The `GET /api/admin/channels/:id/qr` route is the **only** route in the system that accepts its JWT via a `?token=` query string (in addition to the standard `Authorization: Bearer` header). This exception exists solely because the route is meant to be opened directly in a browser with no frontend to inject headers — it must not be generalized to any other route.
- All other admin channel routes use the existing `requireAuth` + `requireRole('admin')` middleware unchanged.
- Frontend for channel administration is out of scope — the QR route returns a minimal inline HTML page, not a SPA view.

---

### Task 1: `BAILEYS_SESSIONS_DIR` config

**Files:**
- Modify: `src/config/env.js`
- Modify: `src/config/env.test.js`
- Modify: `.env.test.example`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `loadConfig().baileysSessionsDir` (string) — consumed by Task 4's Baileys manager.

- [ ] **Step 1: Write the failing test**

Replace `src/config/env.test.js` with:

```js
const { loadConfig } = require('./env');

describe('loadConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  function setAllRequired() {
    process.env.DATABASE_URL = 'postgresql://localhost/test';
    process.env.JWT_SECRET = 'secret';
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.META_VERIFY_TOKEN = 'verify-token';
    process.env.META_APP_SECRET = 'app-secret';
    process.env.BAILEYS_SESSIONS_DIR = './.baileys-sessions';
  }

  test('throws when DATABASE_URL is missing', () => {
    setAllRequired();
    delete process.env.DATABASE_URL;
    expect(() => loadConfig()).toThrow('Missing required environment variables: DATABASE_URL');
  });

  test('throws when JWT_SECRET is missing', () => {
    setAllRequired();
    delete process.env.JWT_SECRET;
    expect(() => loadConfig()).toThrow('Missing required environment variables: JWT_SECRET');
  });

  test('throws when REDIS_URL is missing', () => {
    setAllRequired();
    delete process.env.REDIS_URL;
    expect(() => loadConfig()).toThrow('Missing required environment variables: REDIS_URL');
  });

  test('throws when META_VERIFY_TOKEN is missing', () => {
    setAllRequired();
    delete process.env.META_VERIFY_TOKEN;
    expect(() => loadConfig()).toThrow('Missing required environment variables: META_VERIFY_TOKEN');
  });

  test('throws when META_APP_SECRET is missing', () => {
    setAllRequired();
    delete process.env.META_APP_SECRET;
    expect(() => loadConfig()).toThrow('Missing required environment variables: META_APP_SECRET');
  });

  test('throws when BAILEYS_SESSIONS_DIR is missing', () => {
    setAllRequired();
    delete process.env.BAILEYS_SESSIONS_DIR;
    expect(() => loadConfig()).toThrow('Missing required environment variables: BAILEYS_SESSIONS_DIR');
  });

  test('lists all missing variables together', () => {
    process.env = {};
    expect(() => loadConfig()).toThrow(
      'Missing required environment variables: DATABASE_URL, JWT_SECRET, REDIS_URL, META_VERIFY_TOKEN, META_APP_SECRET, BAILEYS_SESSIONS_DIR'
    );
  });

  test('returns config with defaults when all required vars present', () => {
    setAllRequired();
    delete process.env.PORT;
    const config = loadConfig();
    expect(config).toEqual({
      port: 3000,
      databaseUrl: 'postgresql://localhost/test',
      jwtSecret: 'secret',
      redisUrl: 'redis://localhost:6379',
      metaVerifyToken: 'verify-token',
      metaAppSecret: 'app-secret',
      baileysSessionsDir: './.baileys-sessions',
    });
  });

  test('uses PORT env var when present', () => {
    setAllRequired();
    process.env.PORT = '4000';
    const config = loadConfig();
    expect(config.port).toBe(4000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/config/env.test.js`
Expected: FAIL — missing-vars message doesn't mention `BAILEYS_SESSIONS_DIR`, and the returned config object has no `baileysSessionsDir` key.

- [ ] **Step 3: Write minimal implementation**

Replace `src/config/env.js` with:

```js
function loadConfig() {
  const required = [
    'DATABASE_URL',
    'JWT_SECRET',
    'REDIS_URL',
    'META_VERIFY_TOKEN',
    'META_APP_SECRET',
    'BAILEYS_SESSIONS_DIR',
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
  };
}

module.exports = { loadConfig };
```

- [ ] **Step 4: Update `.env.test.example` and the local `.env.test`**

Append to `.env.test.example`:

```
BAILEYS_SESSIONS_DIR=./.baileys-sessions-test
```

`.env.test` is git-ignored and not tracked by this repo — manually append the same line to your local `.env.test` file before running the suite, or the pretest migration/test run will fail with the same "Missing required environment variables" error against real Postgres-backed tests.

- [ ] **Step 5: Ignore Baileys session directories**

Add to `.gitignore`:

```
.baileys-sessions*/
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test -- src/config/env.test.js`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/config/env.js src/config/env.test.js .env.test.example .gitignore
git commit -m "feat: add BAILEYS_SESSIONS_DIR required config"
```

---

### Task 2: Channel repository — `listChannels` and `updateChannelStatus`

**Files:**
- Modify: `src/channels/channel.repository.js`
- Modify: `src/channels/channel.repository.test.js`

**Interfaces:**
- Consumes: `getPool()` from `src/db/pool.js` (existing).
- Produces: `listChannels() -> Promise<Channel[]>`, `updateChannelStatus(id, status) -> Promise<Channel|null>` — both consumed by Task 4 (Baileys manager) and Task 6 (admin channels API). `Channel` shape (existing, unchanged): `{ id, type, name, phoneNumber, config, status, createdAt }`.

- [ ] **Step 1: Write the failing test**

Replace `src/channels/channel.repository.test.js` with:

```js
const { getPool, closePool } = require('../db/pool');
const {
  createChannel,
  findChannelById,
  findChannelByMetaPhoneNumberId,
  listChannels,
  updateChannelStatus,
} = require('./channel.repository');

describe('channel repository', () => {
  beforeEach(async () => {
    await getPool().query('TRUNCATE channels CASCADE');
  });

  afterAll(async () => {
    await closePool();
  });

  test('createChannel stores and returns a meta_cloud channel', async () => {
    const channel = await createChannel({
      type: 'meta_cloud',
      name: 'Suporte Principal',
      phoneNumber: '+5511999990001',
      config: { phoneNumberId: '1234567890', accessToken: 'token-abc' },
    });
    expect(channel.id).toBeDefined();
    expect(channel.type).toBe('meta_cloud');
    expect(channel.phoneNumber).toBe('+5511999990001');
    expect(channel.config).toEqual({ phoneNumberId: '1234567890', accessToken: 'token-abc' });
  });

  test('findChannelById returns null when not found', async () => {
    const channel = await findChannelById('00000000-0000-0000-0000-000000000000');
    expect(channel).toBeNull();
  });

  test('findChannelByMetaPhoneNumberId finds a channel by its Meta phone_number_id', async () => {
    await createChannel({
      type: 'meta_cloud',
      name: 'Suporte Financeiro',
      phoneNumber: '+5511999990002',
      config: { phoneNumberId: '9999999999', accessToken: 'token-xyz' },
    });
    const channel = await findChannelByMetaPhoneNumberId('9999999999');
    expect(channel.name).toBe('Suporte Financeiro');
  });

  test('findChannelByMetaPhoneNumberId returns null when not found', async () => {
    const channel = await findChannelByMetaPhoneNumberId('does-not-exist');
    expect(channel).toBeNull();
  });

  test('listChannels returns an empty array when there are no channels', async () => {
    const channels = await listChannels();
    expect(channels).toEqual([]);
  });

  test('listChannels returns all channels ordered by creation time', async () => {
    const first = await createChannel({
      type: 'meta_cloud',
      name: 'Primeiro Canal',
      phoneNumber: '+5511999990010',
      config: { phoneNumberId: '1', accessToken: 'a' },
    });
    const second = await createChannel({
      type: 'baileys',
      name: 'Segundo Canal',
      phoneNumber: '+5511999990011',
      config: {},
    });

    const channels = await listChannels();

    expect(channels.map((c) => c.id)).toEqual([first.id, second.id]);
  });

  test('updateChannelStatus updates and returns the channel with the new status', async () => {
    const channel = await createChannel({
      type: 'baileys',
      name: 'Canal Baileys',
      phoneNumber: '+5511999990012',
      config: {},
    });
    expect(channel.status).toBe('disconnected');

    const updated = await updateChannelStatus(channel.id, 'awaiting_qr');

    expect(updated.status).toBe('awaiting_qr');
    expect(updated.id).toBe(channel.id);
  });

  test('updateChannelStatus returns null when the channel does not exist', async () => {
    const updated = await updateChannelStatus('00000000-0000-0000-0000-000000000000', 'connected');
    expect(updated).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/channels/channel.repository.test.js`
Expected: FAIL with `listChannels is not a function` / `updateChannelStatus is not a function`.

- [ ] **Step 3: Write minimal implementation**

Replace `src/channels/channel.repository.js` with:

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
    createdAt: row.created_at,
  };
}

async function createChannel({ type, name, phoneNumber, config }) {
  const result = await getPool().query(
    `INSERT INTO channels (type, name, phone_number, config)
     VALUES ($1, $2, $3, $4)
     RETURNING id, type, name, phone_number, config, status, created_at`,
    [type, name, phoneNumber, JSON.stringify(config)]
  );
  return toChannel(result.rows[0]);
}

async function findChannelById(id) {
  const result = await getPool().query(
    'SELECT id, type, name, phone_number, config, status, created_at FROM channels WHERE id = $1',
    [id]
  );
  if (result.rowCount === 0) return null;
  return toChannel(result.rows[0]);
}

async function findChannelByMetaPhoneNumberId(phoneNumberId) {
  const result = await getPool().query(
    `SELECT id, type, name, phone_number, config, status, created_at FROM channels
     WHERE type = 'meta_cloud' AND config->>'phoneNumberId' = $1`,
    [phoneNumberId]
  );
  if (result.rowCount === 0) return null;
  return toChannel(result.rows[0]);
}

async function listChannels() {
  const result = await getPool().query(
    'SELECT id, type, name, phone_number, config, status, created_at FROM channels ORDER BY created_at ASC'
  );
  return result.rows.map(toChannel);
}

async function updateChannelStatus(id, status) {
  const result = await getPool().query(
    `UPDATE channels SET status = $2 WHERE id = $1
     RETURNING id, type, name, phone_number, config, status, created_at`,
    [id, status]
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
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/channels/channel.repository.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/channels/channel.repository.js src/channels/channel.repository.test.js
git commit -m "feat: add listChannels and updateChannelStatus to the channel repository"
```

---

### Task 3: Move realtime emission into `ingestInboundMessage`; simplify the Meta Cloud webhook route

**Files:**
- Modify: `src/conversations/inbound-message.service.js`
- Modify: `src/conversations/inbound-message.service.test.js`
- Modify: `src/whatsapp-adapters/meta-cloud.routes.js`
- Modify: `src/whatsapp-adapters/meta-cloud.routes.test.js`

**Interfaces:**
- Consumes: `emitToAgent(agentId, event, payload)`, `broadcast(event, payload)` from `src/realtime/socket-server.js` (existing, both silent no-ops when the socket server isn't initialized).
- Produces: `ingestInboundMessage(...)` keeps its existing return shape `{ contact, conversation, message }`, but now ALSO emits `message:new` (to `conversation.assignedAgentId`) or `queue:new` (broadcast) internally whenever `message` is non-null. This is what Task 4's Baileys manager relies on to get realtime push for free.

- [ ] **Step 1: Write the failing test**

Replace `src/conversations/inbound-message.service.test.js` with:

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

  test('reuses an existing open conversation and broadcasts queue:new when unassigned', async () => {
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-1' });
    findOpenConversation.mockResolvedValue({ id: 'conv-1', assignedAgentId: null });
    createMessage.mockResolvedValue({ id: 'msg-1' });

    const result = await ingestInboundMessage({
      channelId: 'channel-1',
      fromPhoneNumber: '+5511999998888',
      contactDisplayName: 'Cliente',
      whatsappMessageId: 'wamid.X',
      content: 'Oi',
    });

    expect(createConversation).not.toHaveBeenCalled();
    expect(createMessage).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      direction: 'inbound',
      content: 'Oi',
      whatsappMessageId: 'wamid.X',
      status: 'received',
    });
    expect(result).toEqual({
      contact: { id: 'contact-1' },
      conversation: { id: 'conv-1', assignedAgentId: null },
      message: { id: 'msg-1' },
    });
    expect(broadcast).toHaveBeenCalledWith('queue:new', {
      conversation: { id: 'conv-1', assignedAgentId: null },
      message: { id: 'msg-1' },
    });
    expect(emitToAgent).not.toHaveBeenCalled();
  });

  test('emits message:new to the assigned agent when the conversation is already assigned', async () => {
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-1b' });
    findOpenConversation.mockResolvedValue({ id: 'conv-1b', assignedAgentId: 'agent-1' });
    createMessage.mockResolvedValue({ id: 'msg-1b' });

    await ingestInboundMessage({
      channelId: 'channel-1',
      fromPhoneNumber: '+5511999998888',
      contactDisplayName: 'Cliente',
      whatsappMessageId: 'wamid.X2',
      content: 'Oi de novo',
    });

    expect(emitToAgent).toHaveBeenCalledWith('agent-1', 'message:new', {
      conversation: { id: 'conv-1b', assignedAgentId: 'agent-1' },
      message: { id: 'msg-1b' },
    });
    expect(broadcast).not.toHaveBeenCalled();
  });

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

  test('falls back to the existing conversation when createConversation races on a unique violation', async () => {
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-3' });
    findOpenConversation
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'conv-3', assignedAgentId: null });
    const uniqueViolation = Object.assign(new Error('duplicate key'), { code: '23505' });
    createConversation.mockRejectedValue(uniqueViolation);
    createMessage.mockResolvedValue({ id: 'msg-3' });

    const result = await ingestInboundMessage({
      channelId: 'channel-1',
      fromPhoneNumber: '+5511999996666',
      contactDisplayName: 'Concorrente',
      whatsappMessageId: 'wamid.Z',
      content: 'Oi de novo',
    });

    expect(findOpenConversation).toHaveBeenCalledTimes(2);
    expect(result.conversation).toEqual({ id: 'conv-3', assignedAgentId: null });
    expect(result.message).toEqual({ id: 'msg-3' });
  });

  test('rethrows when createConversation fails with a non-unique-violation error', async () => {
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-4' });
    findOpenConversation.mockResolvedValue(null);
    const otherError = new Error('connection lost');
    createConversation.mockRejectedValue(otherError);

    await expect(
      ingestInboundMessage({
        channelId: 'channel-1',
        fromPhoneNumber: '+5511999995555',
        contactDisplayName: 'Falha',
        whatsappMessageId: 'wamid.W',
        content: 'Oi',
      })
    ).rejects.toThrow('connection lost');

    expect(createMessage).not.toHaveBeenCalled();
    expect(emitToAgent).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
  });

  test('returns a null message and emits nothing when createMessage fails with a unique violation (already-processed webhook redelivery)', async () => {
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-5' });
    findOpenConversation.mockResolvedValue({ id: 'conv-5', assignedAgentId: null });
    const uniqueViolation = Object.assign(new Error('duplicate key'), { code: '23505' });
    createMessage.mockRejectedValue(uniqueViolation);

    const result = await ingestInboundMessage({
      channelId: 'channel-1',
      fromPhoneNumber: '+5511999994444',
      contactDisplayName: 'Reenvio',
      whatsappMessageId: 'wamid.DUP',
      content: 'Oi',
    });

    expect(result).toEqual({
      contact: { id: 'contact-5' },
      conversation: { id: 'conv-5', assignedAgentId: null },
      message: null,
    });
    expect(emitToAgent).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
  });

  test('rethrows when createMessage fails with a non-unique-violation error', async () => {
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-6' });
    findOpenConversation.mockResolvedValue({ id: 'conv-6', assignedAgentId: null });
    const otherError = new Error('disk full');
    createMessage.mockRejectedValue(otherError);

    await expect(
      ingestInboundMessage({
        channelId: 'channel-1',
        fromPhoneNumber: '+5511999993333',
        contactDisplayName: 'Erro',
        whatsappMessageId: 'wamid.ERR',
        content: 'Oi',
      })
    ).rejects.toThrow('disk full');

    expect(emitToAgent).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/conversations/inbound-message.service.test.js`
Expected: FAIL — `emitToAgent`/`broadcast` are never called by the current implementation.

- [ ] **Step 3: Write minimal implementation**

Replace `src/conversations/inbound-message.service.js` with:

```js
const { findOrCreateContactByPhoneNumber } = require('./contact.repository');
const { findOpenConversation, createConversation } = require('./conversation.repository');
const { createMessage } = require('./message.repository');
const { emitToAgent, broadcast } = require('../realtime/socket-server');

const UNIQUE_VIOLATION = '23505';

async function ingestInboundMessage({ channelId, fromPhoneNumber, contactDisplayName, whatsappMessageId, content }) {
  const contact = await findOrCreateContactByPhoneNumber(fromPhoneNumber, contactDisplayName);
  let conversation = await findOpenConversation(contact.id, channelId);
  if (!conversation) {
    try {
      conversation = await createConversation(contact.id, channelId);
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
    });
  } catch (err) {
    if (err.code !== UNIQUE_VIOLATION) {
      throw err;
    }
    return { contact, conversation, message: null };
  }

  if (conversation.assignedAgentId) {
    emitToAgent(conversation.assignedAgentId, 'message:new', { conversation, message });
  } else {
    broadcast('queue:new', { conversation, message });
  }

  return { contact, conversation, message };
}

module.exports = { ingestInboundMessage };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/conversations/inbound-message.service.test.js`
Expected: PASS

- [ ] **Step 5: Simplify the Meta Cloud webhook route (test first)**

Replace `src/whatsapp-adapters/meta-cloud.routes.test.js` with:

```js
jest.mock('../channels/channel.repository');
jest.mock('../conversations/inbound-message.service');
const request = require('supertest');
const express = require('express');
const crypto = require('crypto');
const { findChannelByMetaPhoneNumberId } = require('../channels/channel.repository');
const { ingestInboundMessage } = require('../conversations/inbound-message.service');
const metaCloudRoutes = require('./meta-cloud.routes');

function buildApp() {
  const app = express();
  app.use(
    express.json({
      verify: (req, res, buf) => {
        req.rawBody = buf;
      },
    })
  );
  app.use('/webhooks', metaCloudRoutes);
  return app;
}

function sign(bodyString, secret) {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(bodyString).digest('hex');
}

describe('GET /webhooks/meta', () => {
  beforeEach(() => {
    process.env.META_VERIFY_TOKEN = 'verify-me';
  });

  test('responds with the challenge when the token matches', async () => {
    const res = await request(buildApp())
      .get('/webhooks/meta')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'verify-me', 'hub.challenge': 'abc123' });
    expect(res.status).toBe(200);
    expect(res.text).toBe('abc123');
  });

  test('responds 403 when the token does not match', async () => {
    const res = await request(buildApp())
      .get('/webhooks/meta')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': 'abc123' });
    expect(res.status).toBe(403);
  });
});

describe('POST /webhooks/meta', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.META_APP_SECRET = 'app-secret';
  });

  test('processes a valid, signed webhook payload', async () => {
    findChannelByMetaPhoneNumberId.mockResolvedValue({ id: 'channel-1' });
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
    const bodyString = JSON.stringify(payload);
    const signature = sign(bodyString, 'app-secret');

    const res = await request(buildApp())
      .post('/webhooks/meta')
      .set('X-Hub-Signature-256', signature)
      .set('Content-Type', 'application/json')
      .send(bodyString);

    expect(res.status).toBe(200);
    expect(ingestInboundMessage).toHaveBeenCalledWith({
      channelId: 'channel-1',
      fromPhoneNumber: '5511999998888',
      contactDisplayName: 'Carlos',
      whatsappMessageId: 'wamid.ABC',
      content: 'Ola',
    });
  });

  test('responds 200 and continues processing when ingestInboundMessage fails for one message in a batch', async () => {
    findChannelByMetaPhoneNumberId.mockResolvedValue({ id: 'channel-1' });
    ingestInboundMessage.mockRejectedValueOnce(new Error('db unavailable')).mockResolvedValueOnce({});

    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: '1234567890' },
                contacts: [
                  { profile: { name: 'Carlos' }, wa_id: '5511999998888' },
                  { profile: { name: 'Maria' }, wa_id: '5511999997777' },
                ],
                messages: [
                  { from: '5511999998888', id: 'wamid.ABC', type: 'text', text: { body: 'Ola' } },
                  { from: '5511999997777', id: 'wamid.DEF', type: 'text', text: { body: 'Oi' } },
                ],
              },
            },
          ],
        },
      ],
    };
    const bodyString = JSON.stringify(payload);
    const signature = sign(bodyString, 'app-secret');

    const res = await request(buildApp())
      .post('/webhooks/meta')
      .set('X-Hub-Signature-256', signature)
      .set('Content-Type', 'application/json')
      .send(bodyString);

    expect(res.status).toBe(200);
    expect(ingestInboundMessage).toHaveBeenCalledTimes(2);
  });

  test('rejects a payload with an invalid signature', async () => {
    const bodyString = JSON.stringify({ entry: [] });
    const res = await request(buildApp())
      .post('/webhooks/meta')
      .set('X-Hub-Signature-256', 'sha256=' + '0'.repeat(64))
      .set('Content-Type', 'application/json')
      .send(bodyString);
    expect(res.status).toBe(403);
    expect(ingestInboundMessage).not.toHaveBeenCalled();
  });

  test('rejects a non-JSON content-type request even with a well-formed signature header', async () => {
    const res = await request(buildApp())
      .post('/webhooks/meta')
      .set('X-Hub-Signature-256', 'sha256=' + '0'.repeat(64))
      .set('Content-Type', 'text/plain')
      .send('not json');
    expect(res.status).toBe(403);
    expect(ingestInboundMessage).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm test -- src/whatsapp-adapters/meta-cloud.routes.test.js`
Expected: FAIL — the current route still imports `emitToAgent`/`broadcast` directly and the test no longer mocks `../realtime/socket-server`, so the require chain breaks the mock setup and stale emission-specific assertions are gone from this file (the route module itself still compiles, but this replacement is a prerequisite for Step 7's simplification, so run it to confirm today's route still passes trivially before simplifying — treat this step as a checkpoint, not a red bar).

- [ ] **Step 7: Simplify the route implementation**

Replace `src/whatsapp-adapters/meta-cloud.routes.js` with:

```js
const express = require('express');
const { loadConfig } = require('../config/env');
const { verifyWebhookChallenge, verifySignature, parseInboundMessages } = require('./meta-cloud.adapter');
const { findChannelByMetaPhoneNumberId } = require('../channels/channel.repository');
const { ingestInboundMessage } = require('../conversations/inbound-message.service');

const router = express.Router();

router.get('/meta', (req, res) => {
  const config = loadConfig();
  const challenge = verifyWebhookChallenge(req.query, config.metaVerifyToken);
  if (challenge === null) {
    return res.sendStatus(403);
  }
  res.status(200).send(challenge);
});

router.post('/meta', async (req, res) => {
  const config = loadConfig();
  const signature = req.headers['x-hub-signature-256'];
  if (!req.rawBody || !verifySignature(req.rawBody, signature, config.metaAppSecret)) {
    return res.sendStatus(403);
  }

  const inboundMessages = parseInboundMessages(req.body);
  for (const inboundMessage of inboundMessages) {
    try {
      const channel = await findChannelByMetaPhoneNumberId(inboundMessage.metaPhoneNumberId);
      if (!channel) {
        continue;
      }
      await ingestInboundMessage({
        channelId: channel.id,
        fromPhoneNumber: inboundMessage.fromPhoneNumber,
        contactDisplayName: inboundMessage.contactDisplayName,
        whatsappMessageId: inboundMessage.whatsappMessageId,
        content: inboundMessage.content,
      });
    } catch (err) {
      console.error('Failed to process inbound WhatsApp message', err);
    }
  }
  res.sendStatus(200);
});

module.exports = router;
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npm test -- src/whatsapp-adapters/meta-cloud.routes.test.js`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/conversations/inbound-message.service.js src/conversations/inbound-message.service.test.js src/whatsapp-adapters/meta-cloud.routes.js src/whatsapp-adapters/meta-cloud.routes.test.js
git commit -m "refactor: move realtime emission into ingestInboundMessage, simplify Meta webhook route"
```

---

### Task 4: Baileys connection manager

**Files:**
- Create: `src/whatsapp-adapters/baileys.manager.js`
- Test: `src/whatsapp-adapters/baileys.manager.test.js`
- Modify: `package.json` (new dependency)

**Interfaces:**
- Consumes: `loadConfig().baileysSessionsDir` (Task 1); `createChannel`, `updateChannelStatus`, `listChannels` from `src/channels/channel.repository.js` (Task 2); `ingestInboundMessage` from `src/conversations/inbound-message.service.js` (Task 3, unchanged signature).
- Produces (consumed by Task 5's outbound-worker fix and Task 6's admin API):
  - `startAllBaileysConnections() -> Promise<void>`
  - `startBaileysConnection(channel) -> Promise<Socket>` (`channel` is the repository's `Channel` shape)
  - `addBaileysChannel({ name, phoneNumber }) -> Promise<Channel>`
  - `sendTextMessage(channel, toPhoneNumber, content) -> Promise<{ whatsappMessageId }>` (same contract as the Meta Cloud adapter)
  - `getQrForChannel(channelId) -> string|null`

- [ ] **Step 1: Install the Baileys dependency**

Run: `npm install @whiskeysockets/baileys`

- [ ] **Step 2: Write the failing test**

Create `src/whatsapp-adapters/baileys.manager.test.js`:

```js
jest.mock('@whiskeysockets/baileys', () => ({
  default: jest.fn(),
  useMultiFileAuthState: jest.fn(),
  DisconnectReason: { loggedOut: 401 },
}));
jest.mock('../channels/channel.repository');
jest.mock('../conversations/inbound-message.service');
jest.mock('../config/env');
jest.mock('fs', () => ({
  promises: { rm: jest.fn().mockResolvedValue(undefined) },
}));

const path = require('path');
const fs = require('fs');
const baileysLib = require('@whiskeysockets/baileys');
const { loadConfig } = require('../config/env');
const { createChannel, updateChannelStatus, listChannels } = require('../channels/channel.repository');
const { ingestInboundMessage } = require('../conversations/inbound-message.service');
const manager = require('./baileys.manager');

function createMockSock() {
  const handlers = {};
  return {
    ev: {
      on: jest.fn((event, handler) => {
        handlers[event] = handler;
      }),
    },
    sendMessage: jest.fn().mockResolvedValue({ key: { id: 'wamid.SENT1' } }),
    handlers,
  };
}

describe('baileys.manager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    loadConfig.mockReturnValue({ baileysSessionsDir: '/sessions' });
    baileysLib.useMultiFileAuthState.mockResolvedValue({ state: {}, saveCreds: jest.fn() });
  });

  describe('startBaileysConnection', () => {
    test('opens the auth state from the per-channel session directory and creates a socket', async () => {
      const sock = createMockSock();
      baileysLib.default.mockReturnValue(sock);
      const channel = { id: 'channel-1', type: 'baileys' };

      await manager.startBaileysConnection(channel);

      expect(baileysLib.useMultiFileAuthState).toHaveBeenCalledWith(path.join('/sessions', 'channel-1'));
      expect(baileysLib.default).toHaveBeenCalledWith(expect.objectContaining({ auth: {} }));
      expect(sock.ev.on).toHaveBeenCalledWith('creds.update', expect.any(Function));
      expect(sock.ev.on).toHaveBeenCalledWith('connection.update', expect.any(Function));
      expect(sock.ev.on).toHaveBeenCalledWith('messages.upsert', expect.any(Function));
    });
  });

  describe('connection.update handling', () => {
    let sock;
    let channel;

    beforeEach(async () => {
      sock = createMockSock();
      baileysLib.default.mockReturnValue(sock);
      channel = { id: 'channel-2', type: 'baileys' };
      await manager.startBaileysConnection(channel);
    });

    test('stores the QR code and marks the channel as awaiting_qr', async () => {
      await sock.handlers['connection.update']({ qr: 'qr-raw-string' });

      expect(updateChannelStatus).toHaveBeenCalledWith('channel-2', 'awaiting_qr');
      expect(manager.getQrForChannel('channel-2')).toBe('qr-raw-string');
    });

    test('clears the QR code and marks the channel as connected when the connection opens', async () => {
      await sock.handlers['connection.update']({ qr: 'qr-raw-string' });
      await sock.handlers['connection.update']({ connection: 'open' });

      expect(updateChannelStatus).toHaveBeenCalledWith('channel-2', 'connected');
      expect(manager.getQrForChannel('channel-2')).toBeNull();
    });

    test('marks the channel disconnected and deletes the session on a logout', async () => {
      await sock.handlers['connection.update']({
        connection: 'close',
        lastDisconnect: { error: { output: { statusCode: 401 } } },
      });

      expect(updateChannelStatus).toHaveBeenCalledWith('channel-2', 'disconnected');
      expect(fs.promises.rm).toHaveBeenCalledWith(path.join('/sessions', 'channel-2'), {
        recursive: true,
        force: true,
      });
      expect(baileysLib.default).toHaveBeenCalledTimes(1);
    });

    test('reconnects automatically on a recoverable disconnect', async () => {
      await sock.handlers['connection.update']({
        connection: 'close',
        lastDisconnect: { error: { output: { statusCode: 500 } } },
      });

      expect(baileysLib.default).toHaveBeenCalledTimes(2);
      expect(updateChannelStatus).not.toHaveBeenCalledWith('channel-2', 'disconnected');
    });
  });

  describe('messages.upsert handling', () => {
    let sock;

    beforeEach(async () => {
      sock = createMockSock();
      baileysLib.default.mockReturnValue(sock);
      await manager.startBaileysConnection({ id: 'channel-3', type: 'baileys' });
    });

    test('ingests a text message received from a contact', async () => {
      await sock.handlers['messages.upsert']({
        type: 'notify',
        messages: [
          {
            key: { remoteJid: '5511999998888@s.whatsapp.net', fromMe: false, id: 'BAILEYS_MSG_1' },
            pushName: 'Cliente Baileys',
            message: { conversation: 'Oi, preciso de ajuda' },
          },
        ],
      });

      expect(ingestInboundMessage).toHaveBeenCalledWith({
        channelId: 'channel-3',
        fromPhoneNumber: '5511999998888',
        contactDisplayName: 'Cliente Baileys',
        whatsappMessageId: 'BAILEYS_MSG_1',
        content: 'Oi, preciso de ajuda',
      });
    });

    test('ingests an extended text message (reply/quoted message)', async () => {
      await sock.handlers['messages.upsert']({
        type: 'notify',
        messages: [
          {
            key: { remoteJid: '5511999997777@s.whatsapp.net', fromMe: false, id: 'BAILEYS_MSG_2' },
            pushName: 'Outro Cliente',
            message: { extendedTextMessage: { text: 'Respondendo aqui' } },
          },
        ],
      });

      expect(ingestInboundMessage).toHaveBeenCalledWith({
        channelId: 'channel-3',
        fromPhoneNumber: '5511999997777',
        contactDisplayName: 'Outro Cliente',
        whatsappMessageId: 'BAILEYS_MSG_2',
        content: 'Respondendo aqui',
      });
    });

    test('ignores messages sent by the connection itself', async () => {
      await sock.handlers['messages.upsert']({
        type: 'notify',
        messages: [
          {
            key: { remoteJid: '5511999996666@s.whatsapp.net', fromMe: true, id: 'BAILEYS_MSG_3' },
            message: { conversation: 'Eco do proprio envio' },
          },
        ],
      });

      expect(ingestInboundMessage).not.toHaveBeenCalled();
    });

    test('ignores non-notify upsert types (history sync)', async () => {
      await sock.handlers['messages.upsert']({
        type: 'append',
        messages: [
          {
            key: { remoteJid: '5511999995555@s.whatsapp.net', fromMe: false, id: 'X' },
            message: { conversation: 'Old' },
          },
        ],
      });

      expect(ingestInboundMessage).not.toHaveBeenCalled();
    });

    test('ignores messages without extractable text content', async () => {
      await sock.handlers['messages.upsert']({
        type: 'notify',
        messages: [
          {
            key: { remoteJid: '5511999994444@s.whatsapp.net', fromMe: false, id: 'IMG1' },
            message: { imageMessage: { caption: 'foto' } },
          },
        ],
      });

      expect(ingestInboundMessage).not.toHaveBeenCalled();
    });
  });

  describe('sendTextMessage', () => {
    test('sends a text message through the active socket and returns the WhatsApp message id', async () => {
      const sock = createMockSock();
      baileysLib.default.mockReturnValue(sock);
      const channel = { id: 'channel-4', type: 'baileys' };
      await manager.startBaileysConnection(channel);

      const result = await manager.sendTextMessage(channel, '5511999993333', 'Resposta via Baileys');

      expect(sock.sendMessage).toHaveBeenCalledWith('5511999993333@s.whatsapp.net', { text: 'Resposta via Baileys' });
      expect(result).toEqual({ whatsappMessageId: 'wamid.SENT1' });
    });

    test('throws when there is no active connection for the channel', async () => {
      await expect(
        manager.sendTextMessage({ id: 'channel-does-not-exist' }, '5511999992222', 'Oi')
      ).rejects.toThrow('No active Baileys connection for channel channel-does-not-exist');
    });
  });

  describe('addBaileysChannel', () => {
    test('creates the channel row and starts its connection', async () => {
      const sock = createMockSock();
      baileysLib.default.mockReturnValue(sock);
      createChannel.mockResolvedValue({
        id: 'channel-5',
        type: 'baileys',
        name: 'WhatsApp Vendas',
        phoneNumber: '+5511988887777',
      });

      const channel = await manager.addBaileysChannel({ name: 'WhatsApp Vendas', phoneNumber: '+5511988887777' });

      expect(createChannel).toHaveBeenCalledWith({
        type: 'baileys',
        name: 'WhatsApp Vendas',
        phoneNumber: '+5511988887777',
        config: {},
      });
      expect(baileysLib.default).toHaveBeenCalled();
      expect(channel).toEqual({
        id: 'channel-5',
        type: 'baileys',
        name: 'WhatsApp Vendas',
        phoneNumber: '+5511988887777',
      });
    });
  });

  describe('startAllBaileysConnections', () => {
    test('starts a connection for every baileys channel and skips meta_cloud channels', async () => {
      const sock = createMockSock();
      baileysLib.default.mockReturnValue(sock);
      listChannels.mockResolvedValue([
        { id: 'channel-6', type: 'baileys' },
        { id: 'channel-7', type: 'meta_cloud' },
        { id: 'channel-8', type: 'baileys' },
      ]);

      await manager.startAllBaileysConnections();

      expect(baileysLib.default).toHaveBeenCalledTimes(2);
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- src/whatsapp-adapters/baileys.manager.test.js`
Expected: FAIL — `Cannot find module './baileys.manager'`.

- [ ] **Step 4: Write the implementation**

Create `src/whatsapp-adapters/baileys.manager.js`:

```js
const fs = require('fs');
const path = require('path');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { loadConfig } = require('../config/env');
const { createChannel, updateChannelStatus, listChannels } = require('../channels/channel.repository');
const { ingestInboundMessage } = require('../conversations/inbound-message.service');

const connections = new Map();

const noopLogger = {
  fatal() {},
  error() {},
  warn() {},
  info() {},
  debug() {},
  trace() {},
  child() {
    return noopLogger;
  },
};

function jidToPhoneNumber(jid) {
  return jid.split('@')[0];
}

function extractTextContent(message) {
  if (!message) return null;
  if (message.conversation) return message.conversation;
  if (message.extendedTextMessage && message.extendedTextMessage.text) {
    return message.extendedTextMessage.text;
  }
  return null;
}

function sessionDirFor(channelId) {
  return path.join(loadConfig().baileysSessionsDir, channelId);
}

async function clearSession(channelId) {
  await fs.promises.rm(sessionDirFor(channelId), { recursive: true, force: true });
}

async function handleMessagesUpsert(channel, { messages, type }) {
  if (type !== 'notify') return;
  for (const msg of messages) {
    if (msg.key.fromMe) continue;
    const content = extractTextContent(msg.message);
    if (!content) continue;
    await ingestInboundMessage({
      channelId: channel.id,
      fromPhoneNumber: jidToPhoneNumber(msg.key.remoteJid),
      contactDisplayName: msg.pushName || null,
      whatsappMessageId: msg.key.id,
      content,
    });
  }
}

async function handleConnectionUpdate(channel, update) {
  const { connection, lastDisconnect, qr } = update;

  if (qr) {
    const entry = connections.get(channel.id);
    if (entry) entry.qr = qr;
    await updateChannelStatus(channel.id, 'awaiting_qr');
    return;
  }

  if (connection === 'open') {
    const entry = connections.get(channel.id);
    if (entry) entry.qr = null;
    await updateChannelStatus(channel.id, 'connected');
    return;
  }

  if (connection === 'close') {
    const statusCode =
      lastDisconnect && lastDisconnect.error && lastDisconnect.error.output
        ? lastDisconnect.error.output.statusCode
        : null;
    if (statusCode === DisconnectReason.loggedOut) {
      connections.delete(channel.id);
      await updateChannelStatus(channel.id, 'disconnected');
      await clearSession(channel.id);
    } else {
      await startBaileysConnection(channel);
    }
  }
}

async function startBaileysConnection(channel) {
  const { state, saveCreds } = await useMultiFileAuthState(sessionDirFor(channel.id));
  const sock = makeWASocket({ auth: state, logger: noopLogger, printQRInTerminal: false });
  connections.set(channel.id, { sock, qr: null });
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', (update) => handleConnectionUpdate(channel, update));
  sock.ev.on('messages.upsert', (payload) => handleMessagesUpsert(channel, payload));
  return sock;
}

async function startAllBaileysConnections() {
  const channels = await listChannels();
  for (const channel of channels.filter((c) => c.type === 'baileys')) {
    await startBaileysConnection(channel);
  }
}

async function addBaileysChannel({ name, phoneNumber }) {
  const channel = await createChannel({ type: 'baileys', name, phoneNumber, config: {} });
  await startBaileysConnection(channel);
  return channel;
}

async function sendTextMessage(channel, toPhoneNumber, content) {
  const entry = connections.get(channel.id);
  if (!entry) {
    throw new Error(`No active Baileys connection for channel ${channel.id}`);
  }
  const sent = await entry.sock.sendMessage(`${toPhoneNumber}@s.whatsapp.net`, { text: content });
  return { whatsappMessageId: sent.key.id };
}

function getQrForChannel(channelId) {
  const entry = connections.get(channelId);
  return entry ? entry.qr : null;
}

module.exports = {
  startAllBaileysConnections,
  startBaileysConnection,
  addBaileysChannel,
  sendTextMessage,
  getQrForChannel,
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- src/whatsapp-adapters/baileys.manager.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/whatsapp-adapters/baileys.manager.js src/whatsapp-adapters/baileys.manager.test.js
git commit -m "feat: add Baileys connection manager supporting N unofficial channels"
```

---

### Task 5: Outbound worker — dispatch adapter by `channel.type`

**Files:**
- Modify: `src/queue/outbound-worker.js`
- Modify: `src/queue/outbound-worker.test.js`

**Interfaces:**
- Consumes: `sendTextMessage(channel, toPhoneNumber, content)` from both `src/whatsapp-adapters/meta-cloud.adapter.js` (existing) and `src/whatsapp-adapters/baileys.manager.js` (Task 4).

- [ ] **Step 1: Write the failing test**

Replace `src/queue/outbound-worker.test.js` with:

```js
jest.mock('./outbound-queue');
jest.mock('../channels/channel.repository');
jest.mock('../conversations/conversation.repository');
jest.mock('../conversations/message.repository');
jest.mock('../whatsapp-adapters/meta-cloud.adapter');
jest.mock('../whatsapp-adapters/baileys.manager');
jest.mock('../realtime/socket-server');

const { processOutboundQueue } = require('./outbound-queue');
const { findChannelById } = require('../channels/channel.repository');
const { getConversationWithContact } = require('../conversations/conversation.repository');
const { updateMessageStatus, recordMessageSent } = require('../conversations/message.repository');
const metaCloudAdapter = require('../whatsapp-adapters/meta-cloud.adapter');
const baileysManager = require('../whatsapp-adapters/baileys.manager');
const { emitToAgent } = require('../realtime/socket-server');
const { startOutboundWorker } = require('./outbound-worker');

describe('startOutboundWorker', () => {
  let handler;

  beforeEach(() => {
    jest.clearAllMocks();
    processOutboundQueue.mockImplementation((h) => {
      handler = h;
    });
    startOutboundWorker();
  });

  test('sends via the Meta Cloud adapter when the channel type is meta_cloud', async () => {
    getConversationWithContact.mockResolvedValue({ id: 'conv-1', contactPhoneNumber: '5511999998888' });
    findChannelById.mockResolvedValue({
      id: 'channel-1',
      type: 'meta_cloud',
      config: { phoneNumberId: '123', accessToken: 'tok' },
    });
    metaCloudAdapter.sendTextMessage.mockResolvedValue({ whatsappMessageId: 'wamid.OUT1' });

    await handler({ messageId: 'msg-1', conversationId: 'conv-1', channelId: 'channel-1', content: 'Ola cliente' });

    expect(metaCloudAdapter.sendTextMessage).toHaveBeenCalledWith(
      { id: 'channel-1', type: 'meta_cloud', config: { phoneNumberId: '123', accessToken: 'tok' } },
      '5511999998888',
      'Ola cliente'
    );
    expect(baileysManager.sendTextMessage).not.toHaveBeenCalled();
    expect(recordMessageSent).toHaveBeenCalledWith('msg-1', 'wamid.OUT1');
    expect(updateMessageStatus).not.toHaveBeenCalled();
  });

  test('sends via the Baileys manager when the channel type is baileys', async () => {
    getConversationWithContact.mockResolvedValue({ id: 'conv-2', contactPhoneNumber: '5511999997777' });
    findChannelById.mockResolvedValue({ id: 'channel-2', type: 'baileys', config: {} });
    baileysManager.sendTextMessage.mockResolvedValue({ whatsappMessageId: 'BAILEYS_OUT_1' });

    await handler({ messageId: 'msg-2', conversationId: 'conv-2', channelId: 'channel-2', content: 'Ola cliente' });

    expect(baileysManager.sendTextMessage).toHaveBeenCalledWith(
      { id: 'channel-2', type: 'baileys', config: {} },
      '5511999997777',
      'Ola cliente'
    );
    expect(metaCloudAdapter.sendTextMessage).not.toHaveBeenCalled();
    expect(recordMessageSent).toHaveBeenCalledWith('msg-2', 'BAILEYS_OUT_1');
  });

  test('marks the message failed and rethrows when sending fails', async () => {
    getConversationWithContact.mockResolvedValue({ id: 'conv-1', contactPhoneNumber: '5511999998888' });
    findChannelById.mockResolvedValue({ id: 'channel-1', type: 'meta_cloud', config: {} });
    metaCloudAdapter.sendTextMessage.mockRejectedValue(new Error('network error'));

    await expect(
      handler({ messageId: 'msg-3', conversationId: 'conv-1', channelId: 'channel-1', content: 'Ola' })
    ).rejects.toThrow('network error');

    expect(updateMessageStatus).toHaveBeenCalledWith('msg-3', 'failed');
    expect(recordMessageSent).not.toHaveBeenCalled();
  });

  test('emits message:updated to the assigned agent on success', async () => {
    getConversationWithContact.mockResolvedValue({
      id: 'conv-1',
      contactPhoneNumber: '5511999998888',
      assignedAgentId: 'agent-1',
    });
    findChannelById.mockResolvedValue({
      id: 'channel-1',
      type: 'meta_cloud',
      config: { phoneNumberId: '123', accessToken: 'tok' },
    });
    metaCloudAdapter.sendTextMessage.mockResolvedValue({ whatsappMessageId: 'wamid.OUT1' });
    recordMessageSent.mockResolvedValue({ id: 'msg-1', status: 'sent', whatsappMessageId: 'wamid.OUT1' });

    await handler({ messageId: 'msg-1', conversationId: 'conv-1', channelId: 'channel-1', content: 'Ola cliente' });

    expect(emitToAgent).toHaveBeenCalledWith('agent-1', 'message:updated', {
      conversationId: 'conv-1',
      message: { id: 'msg-1', status: 'sent', whatsappMessageId: 'wamid.OUT1' },
    });
  });

  test('emits message:updated to the assigned agent on failure', async () => {
    getConversationWithContact.mockResolvedValue({
      id: 'conv-1',
      contactPhoneNumber: '5511999998888',
      assignedAgentId: 'agent-1',
    });
    findChannelById.mockResolvedValue({ id: 'channel-1', type: 'meta_cloud', config: {} });
    metaCloudAdapter.sendTextMessage.mockRejectedValue(new Error('network error'));
    updateMessageStatus.mockResolvedValue({ id: 'msg-2', status: 'failed' });

    await expect(
      handler({ messageId: 'msg-2', conversationId: 'conv-1', channelId: 'channel-1', content: 'Ola' })
    ).rejects.toThrow('network error');

    expect(emitToAgent).toHaveBeenCalledWith('agent-1', 'message:updated', {
      conversationId: 'conv-1',
      message: { id: 'msg-2', status: 'failed' },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/queue/outbound-worker.test.js`
Expected: FAIL — the current worker imports `sendTextMessage` only from the Meta Cloud adapter, so `metaCloudAdapter.sendTextMessage` (accessed as a namespace, not a destructured import) is never actually invoked as the test expects, and the "sends via the Baileys manager" test calls the Meta adapter regardless of `channel.type`.

- [ ] **Step 3: Write the implementation**

Replace `src/queue/outbound-worker.js` with:

```js
const { processOutboundQueue } = require('./outbound-queue');
const { findChannelById } = require('../channels/channel.repository');
const { getConversationWithContact } = require('../conversations/conversation.repository');
const { updateMessageStatus, recordMessageSent } = require('../conversations/message.repository');
const metaCloudAdapter = require('../whatsapp-adapters/meta-cloud.adapter');
const baileysManager = require('../whatsapp-adapters/baileys.manager');
const { emitToAgent } = require('../realtime/socket-server');

const ADAPTERS_BY_CHANNEL_TYPE = {
  meta_cloud: metaCloudAdapter,
  baileys: baileysManager,
};

function startOutboundWorker() {
  processOutboundQueue(async ({ messageId, conversationId, channelId, content }) => {
    const conversation = await getConversationWithContact(conversationId);
    const channel = await findChannelById(channelId);
    const adapter = ADAPTERS_BY_CHANNEL_TYPE[channel.type];
    try {
      const { whatsappMessageId } = await adapter.sendTextMessage(channel, conversation.contactPhoneNumber, content);
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

module.exports = { startOutboundWorker };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/queue/outbound-worker.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/queue/outbound-worker.js src/queue/outbound-worker.test.js
git commit -m "fix: dispatch outbound sends to the correct adapter by channel.type"
```

---

### Task 6: Admin channels API (list, create, QR)

**Files:**
- Create: `src/api/admin-channels.routes.js`
- Test: `src/api/admin-channels.routes.test.js`
- Modify: `package.json` (new dependency)

**Interfaces:**
- Consumes: `requireAuth`, `requireRole('admin')` from `src/auth/auth.middleware.js` (existing, unchanged); `verifyToken` from `src/auth/auth.service.js` (existing); `listChannels`, `createChannel`, `findChannelById` from `src/channels/channel.repository.js` (Task 2); `addBaileysChannel`, `getQrForChannel` from `src/whatsapp-adapters/baileys.manager.js` (Task 4).
- Produces: an Express router mounted by Task 7 at `/api/admin/channels`.

- [ ] **Step 1: Install the QR-rendering dependency**

Run: `npm install qrcode`

- [ ] **Step 2: Write the failing test**

Create `src/api/admin-channels.routes.test.js`:

```js
jest.mock('../channels/channel.repository');
jest.mock('../whatsapp-adapters/baileys.manager');
jest.mock('qrcode');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const QRCode = require('qrcode');
const { listChannels, createChannel, findChannelById } = require('../channels/channel.repository');
const baileysManager = require('../whatsapp-adapters/baileys.manager');
const adminChannelsRoutes = require('./admin-channels.routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/channels', adminChannelsRoutes);
  return app;
}

function tokenFor(agentId, role) {
  return jwt.sign({ agentId, role }, process.env.JWT_SECRET);
}

describe('GET /api/admin/channels', () => {
  beforeEach(() => jest.clearAllMocks());

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

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .get('/api/admin/channels')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(403);
  });

  test('returns 401 without a token', async () => {
    const res = await request(buildApp()).get('/api/admin/channels');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/admin/channels', () => {
  beforeEach(() => jest.clearAllMocks());

  test('creates a meta_cloud channel', async () => {
    createChannel.mockResolvedValue({
      id: 'channel-2',
      type: 'meta_cloud',
      name: 'Financeiro',
      phoneNumber: '+5511999990002',
      config: { phoneNumberId: '999', accessToken: 'tok' },
      status: 'disconnected',
    });

    const res = await request(buildApp())
      .post('/api/admin/channels')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({
        type: 'meta_cloud',
        name: 'Financeiro',
        phoneNumber: '+5511999990002',
        phoneNumberId: '999',
        accessToken: 'tok',
      });

    expect(res.status).toBe(201);
    expect(createChannel).toHaveBeenCalledWith({
      type: 'meta_cloud',
      name: 'Financeiro',
      phoneNumber: '+5511999990002',
      config: { phoneNumberId: '999', accessToken: 'tok' },
    });
  });

  test('rejects a meta_cloud channel missing credentials', async () => {
    const res = await request(buildApp())
      .post('/api/admin/channels')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ type: 'meta_cloud', name: 'Financeiro', phoneNumber: '+5511999990002' });

    expect(res.status).toBe(400);
    expect(createChannel).not.toHaveBeenCalled();
  });

  test('creates a baileys channel and starts its connection', async () => {
    baileysManager.addBaileysChannel.mockResolvedValue({
      id: 'channel-3',
      type: 'baileys',
      name: 'WhatsApp Vendas',
      phoneNumber: '+5511988887777',
      config: {},
      status: 'disconnected',
    });

    const res = await request(buildApp())
      .post('/api/admin/channels')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ type: 'baileys', name: 'WhatsApp Vendas', phoneNumber: '+5511988887777' });

    expect(res.status).toBe(201);
    expect(baileysManager.addBaileysChannel).toHaveBeenCalledWith({
      name: 'WhatsApp Vendas',
      phoneNumber: '+5511988887777',
    });
    expect(res.body.id).toBe('channel-3');
  });

  test('rejects an unknown channel type', async () => {
    const res = await request(buildApp())
      .post('/api/admin/channels')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ type: 'sms', name: 'X', phoneNumber: '+5511900000000' });

    expect(res.status).toBe(400);
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .post('/api/admin/channels')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ type: 'baileys', name: 'X', phoneNumber: '+5511900000000' });
    expect(res.status).toBe(403);
  });
});

describe('GET /api/admin/channels/:id/qr', () => {
  beforeEach(() => jest.clearAllMocks());

  test('renders the QR code page when the channel is awaiting_qr', async () => {
    findChannelById.mockResolvedValue({ id: 'channel-4', type: 'baileys', name: 'WhatsApp Vendas', status: 'awaiting_qr' });
    baileysManager.getQrForChannel.mockReturnValue('raw-qr-text');
    QRCode.toDataURL.mockResolvedValue('data:image/png;base64,FAKEDATA');

    const res = await request(buildApp())
      .get('/api/admin/channels/channel-4/qr')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`);

    expect(res.status).toBe(200);
    expect(res.text).toContain('data:image/png;base64,FAKEDATA');
    expect(QRCode.toDataURL).toHaveBeenCalledWith('raw-qr-text');
  });

  test('accepts the token via query string for browser access', async () => {
    findChannelById.mockResolvedValue({ id: 'channel-4', type: 'baileys', name: 'WhatsApp Vendas', status: 'awaiting_qr' });
    baileysManager.getQrForChannel.mockReturnValue('raw-qr-text');
    QRCode.toDataURL.mockResolvedValue('data:image/png;base64,FAKEDATA');

    const res = await request(buildApp()).get(
      `/api/admin/channels/channel-4/qr?token=${tokenFor('agent-1', 'admin')}`
    );

    expect(res.status).toBe(200);
  });

  test('returns 401 with no token in header or query string', async () => {
    const res = await request(buildApp()).get('/api/admin/channels/channel-4/qr');
    expect(res.status).toBe(401);
  });

  test('returns 403 via query string token for a non-admin agent', async () => {
    const res = await request(buildApp()).get(
      `/api/admin/channels/channel-4/qr?token=${tokenFor('agent-1', 'agent')}`
    );
    expect(res.status).toBe(403);
  });

  test('returns 404 when the channel does not exist', async () => {
    findChannelById.mockResolvedValue(null);
    const res = await request(buildApp())
      .get('/api/admin/channels/does-not-exist/qr')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`);
    expect(res.status).toBe(404);
  });

  test('returns 404 when the channel is not a baileys channel', async () => {
    findChannelById.mockResolvedValue({ id: 'channel-5', type: 'meta_cloud', status: 'connected' });
    const res = await request(buildApp())
      .get('/api/admin/channels/channel-5/qr')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`);
    expect(res.status).toBe(404);
  });

  test('returns 404 when the channel is not awaiting a QR code', async () => {
    findChannelById.mockResolvedValue({ id: 'channel-6', type: 'baileys', status: 'connected' });
    const res = await request(buildApp())
      .get('/api/admin/channels/channel-6/qr')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- src/api/admin-channels.routes.test.js`
Expected: FAIL — `Cannot find module './admin-channels.routes'`.

- [ ] **Step 4: Write the implementation**

Create `src/api/admin-channels.routes.js`:

```js
const express = require('express');
const QRCode = require('qrcode');
const { requireAuth, requireRole } = require('../auth/auth.middleware');
const { verifyToken } = require('../auth/auth.service');
const { listChannels, createChannel, findChannelById } = require('../channels/channel.repository');
const baileysManager = require('../whatsapp-adapters/baileys.manager');

const router = express.Router();

function authenticateQrRoute(req, res, next) {
  const header = req.headers.authorization;
  const headerToken = header && header.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
  const token = headerToken || req.query.token;
  if (!token) {
    return res.status(401).json({ error: 'Missing authorization token' });
  }
  try {
    req.agent = verifyToken(token);
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  if (req.agent.role !== 'admin') {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }
  next();
}

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

router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  const { type, name, phoneNumber } = req.body || {};
  if (!type || !name || !phoneNumber) {
    return res.status(400).json({ error: 'type, name and phoneNumber are required' });
  }

  if (type === 'meta_cloud') {
    const { phoneNumberId, accessToken } = req.body;
    if (!phoneNumberId || !accessToken) {
      return res.status(400).json({ error: 'phoneNumberId and accessToken are required for meta_cloud channels' });
    }
    const channel = await createChannel({ type, name, phoneNumber, config: { phoneNumberId, accessToken } });
    return res.status(201).json(channel);
  }

  if (type === 'baileys') {
    const channel = await baileysManager.addBaileysChannel({ name, phoneNumber });
    return res.status(201).json(channel);
  }

  return res.status(400).json({ error: 'type must be meta_cloud or baileys' });
});

router.get('/:id/qr', authenticateQrRoute, async (req, res) => {
  const channel = await findChannelById(req.params.id);
  if (!channel || channel.type !== 'baileys' || channel.status !== 'awaiting_qr') {
    return res.status(404).json({ error: 'No QR code available for this channel' });
  }
  const qr = baileysManager.getQrForChannel(channel.id);
  if (!qr) {
    return res.status(404).json({ error: 'No QR code available for this channel' });
  }
  const qrImageDataUrl = await QRCode.toDataURL(qr);
  res.status(200).send(`<!DOCTYPE html>
<html>
<head><title>QR - ${channel.name}</title></head>
<body>
<h1>Escaneie o QR code no WhatsApp: ${channel.name}</h1>
<img src="${qrImageDataUrl}" alt="QR code" />
</body>
</html>`);
});

module.exports = router;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- src/api/admin-channels.routes.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/api/admin-channels.routes.js src/api/admin-channels.routes.test.js
git commit -m "feat: add admin channels API (list, create, browser-viewable QR)"
```

---

### Task 7: Wire the admin API and Baileys startup into the server

**Files:**
- Modify: `src/server.js`

**Interfaces:**
- Consumes: `admin-channels.routes.js` (Task 6), `startAllBaileysConnections` from `baileys.manager.js` (Task 4).

- [ ] **Step 1: Modify `src/server.js`**

Replace the full contents of `src/server.js` with:

```js
require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const { loadConfig } = require('./config/env');
const { getPool } = require('./db/pool');
const authRoutes = require('./auth/auth.routes');
const metaCloudRoutes = require('./whatsapp-adapters/meta-cloud.routes');
const conversationsRoutes = require('./api/conversations.routes');
const adminChannelsRoutes = require('./api/admin-channels.routes');
const { startOutboundWorker } = require('./queue/outbound-worker');
const { initSocketServer } = require('./realtime/socket-server');
const { startAllBaileysConnections } = require('./whatsapp-adapters/baileys.manager');

const config = loadConfig();
const app = express();

app.use(cors());
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);

app.get('/health', async (req, res) => {
  try {
    await getPool().query('SELECT 1');
    res.json({ status: 'ok', db: 'ok' });
  } catch (err) {
    res.status(503).json({ status: 'ok', db: 'unreachable' });
  }
});

app.get('/', (req, res) => {
  res.json({ message: 'API WhatsApp DW Telecom' });
});

app.use('/api/auth', authRoutes);
app.use('/api/conversations', conversationsRoutes);
app.use('/api/admin/channels', adminChannelsRoutes);
app.use('/webhooks', metaCloudRoutes);

app.use((err, req, res, next) => {
  console.error('Unhandled API error', err);
  res.status(500).json({ error: 'Internal server error' });
});

if (require.main === module) {
  const httpServer = http.createServer(app);
  initSocketServer(httpServer);
  startOutboundWorker();
  startAllBaileysConnections().catch((err) => {
    console.error('Failed to start Baileys connections', err);
  });
  httpServer.listen(config.port, () => {
    console.log('Servidor rodando na porta ' + config.port);
  });
}

module.exports = app;
```

`startAllBaileysConnections()` is only invoked inside the `require.main === module` guard (same guard already used for `initSocketServer`/`startOutboundWorker`), so requiring `src/server.js` from tests (as `src/server.test.js` already does) never attempts a real Baileys connection.

- [ ] **Step 2: Run the full suite to verify nothing broke**

Run: `npm test`
Expected: PASS — all suites, including the existing `src/server.test.js`, which requires `./server` without mocking (so `admin-channels.routes.js` and `baileys.manager.js` load for real, but `require.main !== module` under Jest means `startAllBaileysConnections` never actually runs).

- [ ] **Step 3: Commit**

```bash
git add src/server.js
git commit -m "feat: mount admin channels API and start Baileys connections on boot"
```

---

## Self-Review

**Spec coverage:**
- "Gerenciador de conexões Baileys que suporta N números não oficiais simultâneos" → Task 4 (`connections` Map keyed by `channel.id`, `startAllBaileysConnections` iterates every `baileys`-type row).
- "API HTTP de administração de canais (listar, cadastrar Meta Cloud, cadastrar Baileys com fluxo de QR code via navegador)" → Task 6.
- "Reaproveitamento do motor de conversas (`ingestInboundMessage`)" → Task 3 (emission moved inside `ingestInboundMessage`) + Task 4 (Baileys manager calls the same function, no duplicated emission logic).
- "Correção de uma lacuna existente: `outbound-worker.js`" → Task 5.
- "Autenticação da rota do QR... aceita o token JWT também via query string" → Task 6's `authenticateQrRoute`, scoped only to `GET /:id/qr` — no other route touches query-string tokens, per the spec's explicit "única rota" constraint (captured in Global Constraints).
- "nenhuma alteração de schema é necessária" → confirmed; no migration task exists in this plan.
- "mockando a biblioteca `@whiskeysockets/baileys` inteira" → Task 4's test mocks the whole module via an explicit factory (no real WhatsApp contact).
- Frontend/load-balancing/schema migration explicitly out of scope per the spec → no tasks touch these.

**Placeholder scan:** No "TBD"/"TODO"/"add error handling" placeholders — every step has complete, runnable code or an exact shell command.

**Type consistency:** `sendTextMessage(channel, toPhoneNumber, content) -> Promise<{ whatsappMessageId }>` is identical across the Meta Cloud adapter (existing), the Baileys manager (Task 4), and the outbound worker's dispatch call (Task 5). `Channel` shape (`{ id, type, name, phoneNumber, config, status, createdAt }`) is consistent from `channel.repository.js` (Task 2) through the Baileys manager (Task 4) and the admin API (Task 6). `ingestInboundMessage`'s input fields (`channelId, fromPhoneNumber, contactDisplayName, whatsappMessageId, content`) match between the Meta Cloud route (Task 3) and the Baileys manager's `handleMessagesUpsert` (Task 4).
