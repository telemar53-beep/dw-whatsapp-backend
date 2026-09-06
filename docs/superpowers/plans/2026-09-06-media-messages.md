# Suporte a Mensagens de Mídia Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let customers' photos, PDFs, audio, video, stickers, and location messages reach the attendant on both WhatsApp channels (Meta Cloud and Baileys), and let attendants send the same kinds of files back, all backed by files persisted on the Render disk and exposed through an authenticated media route.

**Architecture:** New `message_type`/`media_path`/`media_mime_type`/`media_filename`/`location_latitude`/`location_longitude` columns on the existing `messages` table (one file per message, matching WhatsApp's own protocol). A new `src/media/media-storage.js` module owns all disk I/O and mime-type/extension mapping. Both adapters (`meta-cloud.adapter.js`, `baileys.manager.js`) gain a `sendMediaMessage(channel, toPhoneNumber, {...})` alongside their existing `sendTextMessage`, with the same download-then-persist pattern on the inbound side. The outbound worker dispatches to whichever function the message's type calls for. The frontend gains a file-attach button and a per-type message renderer.

**Tech Stack:** Same as the existing backend (Node.js/Express/Postgres/Redis/Bull) plus two new dependencies (`multer` for multipart uploads, `form-data` for the Meta Cloud media-upload API), and the existing frontend (React/Vite) with no new dependencies.

**Spec:** [docs/superpowers/specs/2026-09-06-media-messages-design.md](../specs/2026-09-06-media-messages-design.md) (extends [2026-09-04-whatsapp-attendance-system-design.md](../specs/2026-09-04-whatsapp-attendance-system-design.md))

## Global Constraints

- `package.json`'s (backend) `jest.maxWorkers` MUST stay `1`. Never remove it.
- `MEDIA_STORAGE_DIR` is a **required** config value (added to `loadConfig()`'s `required` array, unlike the optional `FRONTEND_ORIGIN`) — every environment (including tests) must define it, matching the existing pattern for `BAILEYS_SESSIONS_DIR`.
- `content` on the `messages` table becomes nullable — it holds the text body for `message_type = 'text'`, or an optional caption for image/document/audio/video, or `null` when there's no caption.
- Every message has at most one media file, matching WhatsApp's own protocol (never multiple attachments per message) — this is why the plan adds columns to `messages` directly instead of a separate attachments table.
- File size limits match what WhatsApp itself enforces: 16 MB for image/audio/video/sticker, 100 MB for document. Reject anything larger with a 400 before ever touching disk or the outbound queue.
- `GET /api/media/:messageId` is the **second** route in the system that accepts its JWT via a `?token=` query string (the first is `GET /api/admin/channels/:id/qr`, from an earlier plan) — both exist for the same reason: the resource is loaded directly by an HTML element (`<img>`, `<audio>`, `<a>`) that cannot inject an `Authorization` header. This remains a narrow, deliberate exception, not the general auth pattern.
- Every new frontend file stays ES modules (`import`/`export`) — never CommonJS.
- No behavior change for plain text messages — every existing test for text-only flows must keep passing unmodified.

---

### Task 1: Schema + message repository

**Files:**
- Create: `migrations/1788700000000_add-media-columns-to-messages.js`
- Modify: `src/conversations/message.repository.js`
- Modify: `src/conversations/message.repository.test.js`

**Interfaces:**
- Produces: `createMessage({conversationId, direction, content, whatsappMessageId, status, messageType, mediaPath, mediaMimeType, mediaFilename, locationLatitude, locationLongitude})` — all the new fields are optional (default `messageType: 'text'`, everything else `null`), so every existing call site keeps working unchanged until later tasks update them. `Message` shape gains `messageType`, `mediaPath`, `mediaMimeType`, `mediaFilename`, `locationLatitude`, `locationLongitude`. New: `findMessageById(id) -> Message | null`. Consumed by Task 3 (media route) and every adapter task.

- [ ] **Step 1: Write the failing migration test evidence via the repository test**

Replace `src/conversations/message.repository.test.js` with:

```js
const { getPool, closePool } = require('../db/pool');
const { createChannel } = require('../channels/channel.repository');
const { findOrCreateContactByPhoneNumber } = require('./contact.repository');
const { createConversation } = require('./conversation.repository');
const {
  createMessage,
  updateMessageStatus,
  recordMessageSent,
  listMessagesByConversation,
  findMessageById,
} = require('./message.repository');

describe('message repository', () => {
  let conversationId;

  beforeEach(async () => {
    await getPool().query('TRUNCATE conversations, contacts, channels, messages CASCADE');
    const contact = await findOrCreateContactByPhoneNumber('+5511966665555', 'Ana');
    const channel = await createChannel({
      type: 'meta_cloud',
      name: 'Canal Teste 2',
      phoneNumber: '+5511999990010',
      config: { phoneNumberId: '222', accessToken: 'tok2' },
    });
    const conversation = await createConversation(contact.id, channel.id);
    conversationId = conversation.id;
  });

  afterAll(async () => {
    await closePool();
  });

  test('createMessage stores an inbound text message with messageType defaulting to text', async () => {
    const message = await createMessage({
      conversationId,
      direction: 'inbound',
      content: 'Oi, preciso de ajuda',
      whatsappMessageId: 'wamid.ABC123',
      status: 'received',
    });
    expect(message.id).toBeDefined();
    expect(message.direction).toBe('inbound');
    expect(message.status).toBe('received');
    expect(message.messageType).toBe('text');
    expect(message.mediaPath).toBeNull();
  });

  test('createMessage stores an image message with a caption and media fields', async () => {
    const message = await createMessage({
      conversationId,
      direction: 'inbound',
      content: 'Aqui está o comprovante',
      whatsappMessageId: 'wamid.IMG1',
      status: 'received',
      messageType: 'image',
      mediaPath: 'abc123.jpg',
      mediaMimeType: 'image/jpeg',
      mediaFilename: null,
    });
    expect(message.messageType).toBe('image');
    expect(message.mediaPath).toBe('abc123.jpg');
    expect(message.mediaMimeType).toBe('image/jpeg');
    expect(message.content).toBe('Aqui está o comprovante');
  });

  test('createMessage stores a message with no content when there is no caption', async () => {
    const message = await createMessage({
      conversationId,
      direction: 'inbound',
      whatsappMessageId: 'wamid.AUD1',
      status: 'received',
      messageType: 'audio',
      mediaPath: 'def456.ogg',
      mediaMimeType: 'audio/ogg',
    });
    expect(message.content).toBeNull();
    expect(message.messageType).toBe('audio');
  });

  test('createMessage stores a location message with coordinates and no media', async () => {
    const message = await createMessage({
      conversationId,
      direction: 'inbound',
      whatsappMessageId: 'wamid.LOC1',
      status: 'received',
      messageType: 'location',
      locationLatitude: -3.119,
      locationLongitude: -60.021,
    });
    expect(message.messageType).toBe('location');
    expect(message.locationLatitude).toBe(-3.119);
    expect(message.locationLongitude).toBe(-60.021);
    expect(message.mediaPath).toBeNull();
  });

  test('updateMessageStatus changes the status', async () => {
    const message = await createMessage({
      conversationId,
      direction: 'outbound',
      content: 'Resposta',
      whatsappMessageId: null,
      status: 'sent',
    });
    const updated = await updateMessageStatus(message.id, 'failed');
    expect(updated.status).toBe('failed');
  });

  test('recordMessageSent sets the whatsapp message id', async () => {
    const message = await createMessage({
      conversationId,
      direction: 'outbound',
      content: 'Resposta',
      whatsappMessageId: null,
      status: 'sent',
    });
    const updated = await recordMessageSent(message.id, 'wamid.OUT1');
    expect(updated.whatsappMessageId).toBe('wamid.OUT1');
  });

  test('listMessagesByConversation returns messages in chronological order', async () => {
    await createMessage({ conversationId, direction: 'inbound', content: 'primeira', whatsappMessageId: 'wamid.1', status: 'received' });
    await createMessage({ conversationId, direction: 'outbound', content: 'segunda', whatsappMessageId: null, status: 'sent' });
    const messages = await listMessagesByConversation(conversationId);
    expect(messages.map((m) => m.content)).toEqual(['primeira', 'segunda']);
  });

  test('findMessageById returns the message with its media fields', async () => {
    const created = await createMessage({
      conversationId,
      direction: 'inbound',
      whatsappMessageId: 'wamid.DOC1',
      status: 'received',
      messageType: 'document',
      mediaPath: 'ghi789.pdf',
      mediaMimeType: 'application/pdf',
      mediaFilename: 'comprovante.pdf',
    });
    const found = await findMessageById(created.id);
    expect(found.mediaPath).toBe('ghi789.pdf');
    expect(found.mediaFilename).toBe('comprovante.pdf');
  });

  test('findMessageById returns null when not found', async () => {
    const found = await findMessageById('00000000-0000-0000-0000-000000000000');
    expect(found).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/conversations/message.repository.test.js`
Expected: FAIL — the new columns don't exist yet, and `findMessageById` isn't exported.

- [ ] **Step 3: Write the migration**

Create `migrations/1788700000000_add-media-columns-to-messages.js`:

```js
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE messages
      ALTER COLUMN content DROP NOT NULL,
      ADD COLUMN message_type TEXT NOT NULL DEFAULT 'text'
        CHECK (message_type IN ('text', 'image', 'document', 'audio', 'video', 'sticker', 'location')),
      ADD COLUMN media_path TEXT,
      ADD COLUMN media_mime_type TEXT,
      ADD COLUMN media_filename TEXT,
      ADD COLUMN location_latitude DOUBLE PRECISION,
      ADD COLUMN location_longitude DOUBLE PRECISION;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE messages
      DROP COLUMN message_type,
      DROP COLUMN media_path,
      DROP COLUMN media_mime_type,
      DROP COLUMN media_filename,
      DROP COLUMN location_latitude,
      DROP COLUMN location_longitude,
      ALTER COLUMN content SET NOT NULL;
  `);
};
```

- [ ] **Step 4: Run the migration against the test database**

Run: `npm run migrate:test -- up`
Expected: the new migration applies cleanly.

- [ ] **Step 5: Update `src/conversations/message.repository.js`**

Replace the entire file with:

```js
const { getPool } = require('../db/pool');

function toMessage(row) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    direction: row.direction,
    content: row.content,
    messageType: row.message_type,
    mediaPath: row.media_path,
    mediaMimeType: row.media_mime_type,
    mediaFilename: row.media_filename,
    locationLatitude: row.location_latitude !== null ? Number(row.location_latitude) : null,
    locationLongitude: row.location_longitude !== null ? Number(row.location_longitude) : null,
    whatsappMessageId: row.whatsapp_message_id,
    status: row.status,
    createdAt: row.created_at,
  };
}

const MESSAGE_COLUMNS = `id, conversation_id, direction, content, whatsapp_message_id, status,
       message_type, media_path, media_mime_type, media_filename,
       location_latitude, location_longitude, created_at`;

async function createMessage({
  conversationId,
  direction,
  content,
  whatsappMessageId,
  status,
  messageType,
  mediaPath,
  mediaMimeType,
  mediaFilename,
  locationLatitude,
  locationLongitude,
}) {
  const result = await getPool().query(
    `INSERT INTO messages (
       conversation_id, direction, content, whatsapp_message_id, status,
       message_type, media_path, media_mime_type, media_filename,
       location_latitude, location_longitude
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING ${MESSAGE_COLUMNS}`,
    [
      conversationId,
      direction,
      content || null,
      whatsappMessageId || null,
      status,
      messageType || 'text',
      mediaPath || null,
      mediaMimeType || null,
      mediaFilename || null,
      locationLatitude != null ? locationLatitude : null,
      locationLongitude != null ? locationLongitude : null,
    ]
  );
  return toMessage(result.rows[0]);
}

async function updateMessageStatus(messageId, status) {
  const result = await getPool().query(
    `UPDATE messages SET status = $2 WHERE id = $1 RETURNING ${MESSAGE_COLUMNS}`,
    [messageId, status]
  );
  if (result.rowCount === 0) return null;
  return toMessage(result.rows[0]);
}

async function recordMessageSent(messageId, whatsappMessageId) {
  const result = await getPool().query(
    `UPDATE messages SET whatsapp_message_id = $2 WHERE id = $1 RETURNING ${MESSAGE_COLUMNS}`,
    [messageId, whatsappMessageId]
  );
  if (result.rowCount === 0) return null;
  return toMessage(result.rows[0]);
}

async function listMessagesByConversation(conversationId) {
  const result = await getPool().query(
    `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC`,
    [conversationId]
  );
  return result.rows.map(toMessage);
}

async function findMessageById(id) {
  const result = await getPool().query(`SELECT ${MESSAGE_COLUMNS} FROM messages WHERE id = $1`, [id]);
  if (result.rowCount === 0) return null;
  return toMessage(result.rows[0]);
}

module.exports = {
  createMessage,
  updateMessageStatus,
  recordMessageSent,
  listMessagesByConversation,
  findMessageById,
};
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test -- src/conversations/message.repository.test.js`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add migrations/1788700000000_add-media-columns-to-messages.js src/conversations/message.repository.js src/conversations/message.repository.test.js
git commit -m "feat: add media columns to messages and findMessageById"
```

---

### Task 2: `MEDIA_STORAGE_DIR` config + media storage module

**Files:**
- Modify: `src/config/env.js`
- Modify: `src/config/env.test.js`
- Modify: `.env.test.example`
- Create: `src/media/media-storage.js`
- Create: `src/media/media-storage.test.js`

**Interfaces:**
- Produces: `loadConfig().mediaStorageDir` (required, string). `saveMediaFile(buffer, extension) -> Promise<relativePath>`, `getMediaFilePath(relativePath) -> absolutePath`, `extensionForMimeType(mimeType) -> string`, `messageTypeForMimeType(mimeType) -> 'image'|'document'|'audio'|'video'`. Consumed by every later task that reads or writes a media file.

- [ ] **Step 1: Write the failing config test**

Add to `src/config/env.test.js`'s `setAllRequired()` helper and add a new test, following the exact pattern already used for `BAILEYS_SESSIONS_DIR` in this same file — read the file first to see its current exact structure, then:
- add `process.env.MEDIA_STORAGE_DIR = './.media-storage';` to `setAllRequired()`
- add a test `'throws when MEDIA_STORAGE_DIR is missing'` (delete it after `setAllRequired()`, expect the same "Missing required environment variables: MEDIA_STORAGE_DIR" throw pattern used for the other required vars)
- update the `'lists all missing variables together'` test's expected message to include `, MEDIA_STORAGE_DIR` at the end
- update the `'returns config with defaults when all required vars present'` test's expected object to include `mediaStorageDir: './.media-storage'`

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/config/env.test.js`
Expected: FAIL — `MEDIA_STORAGE_DIR` isn't required yet, `config.mediaStorageDir` is `undefined`.

- [ ] **Step 3: Update `src/config/env.js`**

Add `'MEDIA_STORAGE_DIR'` to the `required` array (after `'BAILEYS_SESSIONS_DIR'`) and add `mediaStorageDir: process.env.MEDIA_STORAGE_DIR,` to the returned object (after `baileysSessionsDir`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/config/env.test.js`
Expected: PASS

- [ ] **Step 5: Update `.env.test.example`**

Append a line: `MEDIA_STORAGE_DIR=./.media-storage-test`

Also append the same line to your local `.env.test` (git-ignored, not committed) before running the full suite later in this task, or every other test suite will start failing with "Missing required environment variables: MEDIA_STORAGE_DIR".

- [ ] **Step 6: Add the ignore pattern to `.gitignore`**

Add a line: `.media-storage*/`

- [ ] **Step 7: Write the failing test for `media-storage.js`**

Create `src/media/media-storage.test.js`:

```js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadConfig } = require('../config/env');
const {
  saveMediaFile,
  getMediaFilePath,
  extensionForMimeType,
  messageTypeForMimeType,
} = require('./media-storage');

describe('media-storage', () => {
  let tempDir;
  let originalMediaStorageDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-media-test-'));
    originalMediaStorageDir = process.env.MEDIA_STORAGE_DIR;
    process.env.MEDIA_STORAGE_DIR = tempDir;
  });

  afterEach(() => {
    process.env.MEDIA_STORAGE_DIR = originalMediaStorageDir;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('saveMediaFile / getMediaFilePath', () => {
    test('writes the buffer to disk and returns a relative path with the given extension', async () => {
      const buffer = Buffer.from('fake image bytes');
      const relativePath = await saveMediaFile(buffer, '.jpg');

      expect(relativePath).toMatch(/\.jpg$/);
      const fullPath = getMediaFilePath(relativePath);
      expect(fs.existsSync(fullPath)).toBe(true);
      expect(fs.readFileSync(fullPath)).toEqual(buffer);
    });

    test('generates a different path for each call, even with the same extension', async () => {
      const path1 = await saveMediaFile(Buffer.from('a'), '.pdf');
      const path2 = await saveMediaFile(Buffer.from('b'), '.pdf');
      expect(path1).not.toBe(path2);
    });

    test('creates the storage directory if it does not exist yet', async () => {
      const nestedDir = path.join(tempDir, 'does-not-exist-yet');
      process.env.MEDIA_STORAGE_DIR = nestedDir;
      const relativePath = await saveMediaFile(Buffer.from('x'), '.png');
      expect(fs.existsSync(getMediaFilePath(relativePath))).toBe(true);
    });
  });

  describe('extensionForMimeType', () => {
    test.each([
      ['image/jpeg', '.jpg'],
      ['image/png', '.png'],
      ['application/pdf', '.pdf'],
      ['audio/ogg; codecs=opus', '.ogg'],
      ['video/mp4', '.mp4'],
    ])('maps %s to %s', (mimeType, expected) => {
      expect(extensionForMimeType(mimeType)).toBe(expected);
    });

    test('returns an empty string for an unknown mime type', () => {
      expect(extensionForMimeType('application/x-made-up')).toBe('');
    });

    test('returns an empty string when mimeType is falsy', () => {
      expect(extensionForMimeType(null)).toBe('');
    });
  });

  describe('messageTypeForMimeType', () => {
    test.each([
      ['image/jpeg', 'image'],
      ['audio/ogg', 'audio'],
      ['video/mp4', 'video'],
      ['application/pdf', 'document'],
      ['application/octet-stream', 'document'],
    ])('maps %s to %s', (mimeType, expected) => {
      expect(messageTypeForMimeType(mimeType)).toBe(expected);
    });

    test('defaults to document when mimeType is falsy', () => {
      expect(messageTypeForMimeType(null)).toBe('document');
    });
  });
});
```

- [ ] **Step 8: Run test to verify it fails**

Run: `npm test -- src/media/media-storage.test.js`
Expected: FAIL with `Cannot find module './media-storage'`.

- [ ] **Step 9: Write the implementation**

Create `src/media/media-storage.js`:

```js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadConfig } = require('../config/env');

const EXTENSION_BY_MIME_TYPE = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'application/pdf': '.pdf',
  'audio/ogg': '.ogg',
  'audio/ogg; codecs=opus': '.ogg',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'video/mp4': '.mp4',
  'video/3gpp': '.3gp',
};

function extensionForMimeType(mimeType) {
  if (!mimeType) return '';
  const base = mimeType.split(';')[0].trim();
  return EXTENSION_BY_MIME_TYPE[mimeType] || EXTENSION_BY_MIME_TYPE[base] || '';
}

function messageTypeForMimeType(mimeType) {
  if (!mimeType) return 'document';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('video/')) return 'video';
  return 'document';
}

async function saveMediaFile(buffer, extension) {
  const dir = loadConfig().mediaStorageDir;
  await fs.promises.mkdir(dir, { recursive: true });
  const relativePath = `${crypto.randomUUID()}${extension || ''}`;
  await fs.promises.writeFile(path.join(dir, relativePath), buffer);
  return relativePath;
}

function getMediaFilePath(relativePath) {
  return path.join(loadConfig().mediaStorageDir, relativePath);
}

module.exports = { saveMediaFile, getMediaFilePath, extensionForMimeType, messageTypeForMimeType };
```

- [ ] **Step 10: Run test to verify it passes**

Run: `npm test -- src/media/media-storage.test.js`
Expected: PASS

- [ ] **Step 11: Run the full backend suite**

Run: `npm test`
Expected: PASS, all suites (make sure your local `.env.test` has `MEDIA_STORAGE_DIR` set, per Step 5).

- [ ] **Step 12: Commit**

```bash
git add src/config/env.js src/config/env.test.js .env.test.example .gitignore src/media/media-storage.js src/media/media-storage.test.js
git commit -m "feat: add MEDIA_STORAGE_DIR config and the media storage module"
```

---

### Task 3: Authenticated media-serving route

**Files:**
- Create: `src/api/media.routes.js`
- Create: `src/api/media.routes.test.js`
- Modify: `src/server.js`

**Interfaces:**
- Consumes: `findMessageById` (Task 1), `getMediaFilePath` (Task 2), `verifyToken` from `../auth/auth.service` (existing).
- Produces: `GET /api/media/:messageId` — mounted at `/api/media` in `server.js`.

- [ ] **Step 1: Write the failing test**

Create `src/api/media.routes.test.js`:

```js
jest.mock('../conversations/message.repository');
jest.mock('../media/media-storage');
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const { findMessageById } = require('../conversations/message.repository');
const { getMediaFilePath } = require('../media/media-storage');
const mediaRoutes = require('./media.routes');

function buildApp() {
  const app = express();
  app.use('/api/media', mediaRoutes);
  return app;
}

function tokenFor(agentId, role) {
  return jwt.sign({ agentId, role }, process.env.JWT_SECRET);
}

describe('GET /api/media/:messageId', () => {
  let tempFile;

  beforeEach(() => {
    jest.clearAllMocks();
    tempFile = path.join(os.tmpdir(), `dw-media-route-test-${Date.now()}.txt`);
    fs.writeFileSync(tempFile, 'conteudo do arquivo de teste');
  });

  afterEach(() => {
    fs.rmSync(tempFile, { force: true });
  });

  test('serves the file when the message exists and has media', async () => {
    findMessageById.mockResolvedValue({ id: 'msg-1', mediaPath: 'whatever.txt' });
    getMediaFilePath.mockReturnValue(tempFile);

    const res = await request(buildApp())
      .get('/api/media/msg-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);

    expect(res.status).toBe(200);
    expect(res.text).toBe('conteudo do arquivo de teste');
  });

  test('accepts the token via query string', async () => {
    findMessageById.mockResolvedValue({ id: 'msg-1', mediaPath: 'whatever.txt' });
    getMediaFilePath.mockReturnValue(tempFile);

    const res = await request(buildApp()).get(`/api/media/msg-1?token=${tokenFor('agent-1', 'agent')}`);

    expect(res.status).toBe(200);
  });

  test('returns 401 with no token in header or query string', async () => {
    const res = await request(buildApp()).get('/api/media/msg-1');
    expect(res.status).toBe(401);
    expect(findMessageById).not.toHaveBeenCalled();
  });

  test('returns 404 when the message does not exist', async () => {
    findMessageById.mockResolvedValue(null);
    const res = await request(buildApp())
      .get('/api/media/does-not-exist')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(404);
  });

  test('returns 404 when the message has no media', async () => {
    findMessageById.mockResolvedValue({ id: 'msg-2', mediaPath: null });
    const res = await request(buildApp())
      .get('/api/media/msg-2')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/api/media.routes.test.js`
Expected: FAIL with `Cannot find module './media.routes'`.

- [ ] **Step 3: Write the implementation**

Create `src/api/media.routes.js`:

```js
const express = require('express');
const { verifyToken } = require('../auth/auth.service');
const { findMessageById } = require('../conversations/message.repository');
const { getMediaFilePath } = require('../media/media-storage');

const router = express.Router();

function authenticateMediaRoute(req, res, next) {
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
  next();
}

router.get('/:messageId', authenticateMediaRoute, async (req, res) => {
  const message = await findMessageById(req.params.messageId);
  if (!message || !message.mediaPath) {
    return res.status(404).json({ error: 'Media not found' });
  }
  res.sendFile(getMediaFilePath(message.mediaPath), (err) => {
    if (err && !res.headersSent) {
      res.status(404).json({ error: 'Media not found' });
    }
  });
});

module.exports = router;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/api/media.routes.test.js`
Expected: PASS

- [ ] **Step 5: Mount the route in `src/server.js`**

Add the require alongside the other route imports:

```js
const mediaRoutes = require('./api/media.routes');
```

And mount it:

```js
app.use('/api/media', mediaRoutes);
```

- [ ] **Step 6: Run the full backend suite**

Run: `npm test`
Expected: PASS, all suites.

- [ ] **Step 7: Commit**

```bash
git add src/api/media.routes.js src/api/media.routes.test.js src/server.js
git commit -m "feat: add authenticated GET /api/media/:messageId route"
```

---

### Task 4: `ingestInboundMessage` accepts media fields

**Files:**
- Modify: `src/conversations/inbound-message.service.js`
- Modify: `src/conversations/inbound-message.service.test.js`

**Interfaces:**
- Consumes: `createMessage` (Task 1, already accepts the new fields).
- Produces: `ingestInboundMessage({channelId, fromPhoneNumber, contactDisplayName, whatsappMessageId, content, messageType, mediaPath, mediaMimeType, mediaFilename, locationLatitude, locationLongitude})` — every new field optional, defaulting through to `createMessage`'s own defaults. Consumed by Tasks 5 and 7 (both adapters' inbound handling).

- [ ] **Step 1: Write the failing test**

Add this test to `src/conversations/inbound-message.service.test.js`, inside the existing `describe('ingestInboundMessage', ...)` block (after the existing tests — read the file first to match its exact current structure and mocking style before adding):

```js
  test('passes media fields through to createMessage and the emitted payload', async () => {
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-7', phoneNumber: '+5511999992222', displayName: 'Cliente Mídia' });
    findOpenConversation.mockResolvedValue({ id: 'conv-7', assignedAgentId: null });
    createMessage.mockResolvedValue({ id: 'msg-7', messageType: 'image', mediaPath: 'abc.jpg' });

    await ingestInboundMessage({
      channelId: 'channel-1',
      fromPhoneNumber: '+5511999992222',
      contactDisplayName: 'Cliente Mídia',
      whatsappMessageId: 'wamid.IMG',
      content: 'Comprovante',
      messageType: 'image',
      mediaPath: 'abc.jpg',
      mediaMimeType: 'image/jpeg',
      mediaFilename: null,
    });

    expect(createMessage).toHaveBeenCalledWith({
      conversationId: 'conv-7',
      direction: 'inbound',
      content: 'Comprovante',
      whatsappMessageId: 'wamid.IMG',
      status: 'received',
      messageType: 'image',
      mediaPath: 'abc.jpg',
      mediaMimeType: 'image/jpeg',
      mediaFilename: null,
      locationLatitude: undefined,
      locationLongitude: undefined,
    });
    expect(broadcast).toHaveBeenCalledWith('queue:new', {
      conversation: { id: 'conv-7', assignedAgentId: null },
      message: { id: 'msg-7', messageType: 'image', mediaPath: 'abc.jpg' },
    });
  });

  test('defaults messageType-related fields to undefined when not provided (plain text still works)', async () => {
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-8' });
    findOpenConversation.mockResolvedValue({ id: 'conv-8', assignedAgentId: null });
    createMessage.mockResolvedValue({ id: 'msg-8' });

    await ingestInboundMessage({
      channelId: 'channel-1',
      fromPhoneNumber: '+5511999991111',
      contactDisplayName: 'Cliente Texto',
      whatsappMessageId: 'wamid.TXT',
      content: 'Oi',
    });

    expect(createMessage).toHaveBeenCalledWith({
      conversationId: 'conv-8',
      direction: 'inbound',
      content: 'Oi',
      whatsappMessageId: 'wamid.TXT',
      status: 'received',
      messageType: undefined,
      mediaPath: undefined,
      mediaMimeType: undefined,
      mediaFilename: undefined,
      locationLatitude: undefined,
      locationLongitude: undefined,
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/conversations/inbound-message.service.test.js`
Expected: FAIL — `createMessage` isn't called with the new fields yet.

- [ ] **Step 3: Update `src/conversations/inbound-message.service.js`**

Change the function signature and the `createMessage` call. Replace:

```js
async function ingestInboundMessage({ channelId, fromPhoneNumber, contactDisplayName, whatsappMessageId, content }) {
```

with:

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
```

And replace the `createMessage` call:

```js
    message = await createMessage({
      conversationId: conversation.id,
      direction: 'inbound',
      content,
      whatsappMessageId,
      status: 'received',
    });
```

with:

```js
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
```

Nothing else in the file changes — the emission logic (`broadcast`/`emitToAgent`) already forwards whatever `message` object `createMessage` returns, unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/conversations/inbound-message.service.test.js`
Expected: PASS

- [ ] **Step 5: Run the full backend suite**

Run: `npm test`
Expected: PASS, all suites.

- [ ] **Step 6: Commit**

```bash
git add src/conversations/inbound-message.service.js src/conversations/inbound-message.service.test.js
git commit -m "feat: pass media fields through ingestInboundMessage"
```

---

### Task 5: Meta Cloud — receiving media

**Files:**
- Modify: `src/whatsapp-adapters/meta-cloud.adapter.js`
- Modify: `src/whatsapp-adapters/meta-cloud.adapter.test.js`
- Modify: `src/whatsapp-adapters/meta-cloud.routes.js`
- Modify: `src/whatsapp-adapters/meta-cloud.routes.test.js`

**Interfaces:**
- Consumes: `saveMediaFile`, `extensionForMimeType` (Task 2), `ingestInboundMessage` (Task 4).
- Produces: `parseInboundMessages` now returns `messageType` on every parsed message, plus `mediaId`/`mediaMimeType`/`mediaFilename` for media types, or `latitude`/`longitude` for `location`. New: `downloadMetaMedia(mediaId, accessToken) -> Promise<Buffer>`.

- [ ] **Step 1: Write the failing test for `parseInboundMessages`**

In `src/whatsapp-adapters/meta-cloud.adapter.test.js`, replace the existing `describe('parseInboundMessages', ...)` block (read the file first, then replace just that block, leaving `verifyWebhookChallenge`/`verifySignature`/`sendTextMessage` describe blocks untouched) with:

```js
describe('parseInboundMessages', () => {
  test('extracts text messages with contact name, phone_number_id, and messageType text', () => {
    const webhookBody = {
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
    const result = parseInboundMessages(webhookBody);
    expect(result).toEqual([
      {
        metaPhoneNumberId: '1234567890',
        fromPhoneNumber: '5511999998888',
        contactDisplayName: 'Carlos',
        whatsappMessageId: 'wamid.ABC',
        messageType: 'text',
        content: 'Ola',
      },
    ]);
  });

  test('extracts an image message with a caption', () => {
    const webhookBody = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: '1234567890' },
                contacts: [{ profile: { name: 'Carlos' }, wa_id: '5511999998888' }],
                messages: [
                  {
                    from: '5511999998888',
                    id: 'wamid.IMG',
                    type: 'image',
                    image: { id: 'MEDIA123', mime_type: 'image/jpeg', caption: 'Comprovante' },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const result = parseInboundMessages(webhookBody);
    expect(result).toEqual([
      {
        metaPhoneNumberId: '1234567890',
        fromPhoneNumber: '5511999998888',
        contactDisplayName: 'Carlos',
        whatsappMessageId: 'wamid.IMG',
        messageType: 'image',
        mediaId: 'MEDIA123',
        mediaMimeType: 'image/jpeg',
        mediaFilename: null,
        content: 'Comprovante',
      },
    ]);
  });

  test('extracts a document message with a filename and no caption', () => {
    const webhookBody = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: '1234567890' },
                contacts: [],
                messages: [
                  {
                    from: '5511999998888',
                    id: 'wamid.DOC',
                    type: 'document',
                    document: { id: 'MEDIA456', mime_type: 'application/pdf', filename: 'comprovante.pdf' },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const result = parseInboundMessages(webhookBody);
    expect(result).toEqual([
      {
        metaPhoneNumberId: '1234567890',
        fromPhoneNumber: '5511999998888',
        contactDisplayName: null,
        whatsappMessageId: 'wamid.DOC',
        messageType: 'document',
        mediaId: 'MEDIA456',
        mediaMimeType: 'application/pdf',
        mediaFilename: 'comprovante.pdf',
        content: null,
      },
    ]);
  });

  test.each(['audio', 'video', 'sticker'])('extracts a %s message', (type) => {
    const webhookBody = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: '1234567890' },
                contacts: [],
                messages: [{ from: '5511999998888', id: `wamid.${type}`, type, [type]: { id: 'MEDIA789', mime_type: 'application/octet-stream' } }],
              },
            },
          ],
        },
      ],
    };
    const result = parseInboundMessages(webhookBody);
    expect(result).toEqual([
      {
        metaPhoneNumberId: '1234567890',
        fromPhoneNumber: '5511999998888',
        contactDisplayName: null,
        whatsappMessageId: `wamid.${type}`,
        messageType: type,
        mediaId: 'MEDIA789',
        mediaMimeType: 'application/octet-stream',
        mediaFilename: null,
        content: null,
      },
    ]);
  });

  test('extracts a location message with coordinates and no media fields', () => {
    const webhookBody = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: '1234567890' },
                contacts: [],
                messages: [
                  {
                    from: '5511999998888',
                    id: 'wamid.LOC',
                    type: 'location',
                    location: { latitude: -3.119, longitude: -60.021 },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const result = parseInboundMessages(webhookBody);
    expect(result).toEqual([
      {
        metaPhoneNumberId: '1234567890',
        fromPhoneNumber: '5511999998888',
        contactDisplayName: null,
        whatsappMessageId: 'wamid.LOC',
        messageType: 'location',
        latitude: -3.119,
        longitude: -60.021,
      },
    ]);
  });

  test('ignores unsupported message types (e.g. reactions)', () => {
    const webhookBody = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: '1234567890' },
                contacts: [],
                messages: [{ from: '5511999998888', id: 'wamid.REACT', type: 'reaction' }],
              },
            },
          ],
        },
      ],
    };
    expect(parseInboundMessages(webhookBody)).toEqual([]);
  });

  test('returns an empty array when there are no entries', () => {
    expect(parseInboundMessages({})).toEqual([]);
  });
});

describe('downloadMetaMedia', () => {
  test('fetches the temporary media URL then downloads the file bytes', async () => {
    axios.get
      .mockResolvedValueOnce({ data: { url: 'https://lookaside.fbsbx.com/temp-url' } })
      .mockResolvedValueOnce({ data: Buffer.from('fake-bytes') });

    const buffer = await downloadMetaMedia('MEDIA123', 'token-abc');

    expect(axios.get).toHaveBeenNthCalledWith(1, 'https://graph.facebook.com/v20.0/MEDIA123', {
      headers: { Authorization: 'Bearer token-abc' },
    });
    expect(axios.get).toHaveBeenNthCalledWith(2, 'https://lookaside.fbsbx.com/temp-url', {
      headers: { Authorization: 'Bearer token-abc' },
      responseType: 'arraybuffer',
    });
    expect(buffer).toEqual(Buffer.from('fake-bytes'));
  });
});
```

Also add `downloadMetaMedia` to the `require('./meta-cloud.adapter')` import at the top of the test file (in the `jest.mock('axios')` section that already exists for `sendTextMessage`'s tests).

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/whatsapp-adapters/meta-cloud.adapter.test.js`
Expected: FAIL — `parseInboundMessages` doesn't return `messageType` yet, `downloadMetaMedia` doesn't exist.

- [ ] **Step 3: Update `src/whatsapp-adapters/meta-cloud.adapter.js`**

Replace the `parseInboundMessages` function with:

```js
const MEDIA_MESSAGE_TYPES = ['image', 'document', 'audio', 'video', 'sticker'];

function parseInboundMessages(webhookBody) {
  const messages = [];
  const entries = webhookBody.entry || [];
  for (const entry of entries) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      const phoneNumberId = value.metadata && value.metadata.phone_number_id;
      const contactsById = {};
      for (const contact of value.contacts || []) {
        contactsById[contact.wa_id] = contact.profile && contact.profile.name;
      }
      for (const message of value.messages || []) {
        const base = {
          metaPhoneNumberId: phoneNumberId,
          fromPhoneNumber: message.from,
          contactDisplayName: contactsById[message.from] || null,
          whatsappMessageId: message.id,
        };
        if (message.type === 'text') {
          messages.push({ ...base, messageType: 'text', content: message.text.body });
        } else if (MEDIA_MESSAGE_TYPES.includes(message.type)) {
          const media = message[message.type];
          messages.push({
            ...base,
            messageType: message.type,
            mediaId: media.id,
            mediaMimeType: media.mime_type,
            mediaFilename: media.filename || null,
            content: media.caption || null,
          });
        } else if (message.type === 'location') {
          messages.push({
            ...base,
            messageType: 'location',
            latitude: message.location.latitude,
            longitude: message.location.longitude,
          });
        }
      }
    }
  }
  return messages;
}
```

Add this new function after `sendTextMessage`:

```js
async function downloadMetaMedia(mediaId, accessToken) {
  const metaResponse = await axios.get(`https://graph.facebook.com/v20.0/${mediaId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const fileResponse = await axios.get(metaResponse.data.url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    responseType: 'arraybuffer',
  });
  return Buffer.from(fileResponse.data);
}
```

Update the final `module.exports` line to also export `downloadMetaMedia`:

```js
module.exports = { verifyWebhookChallenge, verifySignature, parseInboundMessages, sendTextMessage, downloadMetaMedia };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/whatsapp-adapters/meta-cloud.adapter.test.js`
Expected: PASS

- [ ] **Step 5: Write the failing test for the webhook route's media handling**

In `src/whatsapp-adapters/meta-cloud.routes.test.js`, add `jest.mock('../media/media-storage');` near the top (alongside the existing `jest.mock` calls) and import `saveMediaFile`/`downloadMetaMedia` where needed. Add this new test inside the existing `describe('POST /webhooks/meta', ...)` block (after the existing tests):

```js
  test('downloads and saves media before ingesting an image message', async () => {
    findChannelByMetaPhoneNumberId.mockResolvedValue({ id: 'channel-1', config: { accessToken: 'tok-meta' } });
    ingestInboundMessage.mockResolvedValue({});
    downloadMetaMedia.mockResolvedValue(Buffer.from('fake-image-bytes'));
    saveMediaFile.mockResolvedValue('generated-name.jpg');

    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: '1234567890' },
                contacts: [{ profile: { name: 'Carlos' }, wa_id: '5511999998888' }],
                messages: [
                  {
                    from: '5511999998888',
                    id: 'wamid.IMG',
                    type: 'image',
                    image: { id: 'MEDIA123', mime_type: 'image/jpeg', caption: 'Comprovante' },
                  },
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
    expect(downloadMetaMedia).toHaveBeenCalledWith('MEDIA123', 'tok-meta');
    expect(saveMediaFile).toHaveBeenCalledWith(Buffer.from('fake-image-bytes'), '.jpg');
    expect(ingestInboundMessage).toHaveBeenCalledWith({
      channelId: 'channel-1',
      fromPhoneNumber: '5511999998888',
      contactDisplayName: 'Carlos',
      whatsappMessageId: 'wamid.IMG',
      messageType: 'image',
      content: 'Comprovante',
      mediaPath: 'generated-name.jpg',
      mediaMimeType: 'image/jpeg',
      mediaFilename: null,
      locationLatitude: undefined,
      locationLongitude: undefined,
    });
  });

  test('ingests a location message without touching media storage', async () => {
    findChannelByMetaPhoneNumberId.mockResolvedValue({ id: 'channel-1', config: {} });
    ingestInboundMessage.mockResolvedValue({});

    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: '1234567890' },
                contacts: [],
                messages: [
                  { from: '5511999998888', id: 'wamid.LOC', type: 'location', location: { latitude: -3.1, longitude: -60.0 } },
                ],
              },
            },
          ],
        },
      ],
    };
    const bodyString = JSON.stringify(payload);
    const signature = sign(bodyString, 'app-secret');

    await request(buildApp())
      .post('/webhooks/meta')
      .set('X-Hub-Signature-256', signature)
      .set('Content-Type', 'application/json')
      .send(bodyString);

    expect(downloadMetaMedia).not.toHaveBeenCalled();
    expect(ingestInboundMessage).toHaveBeenCalledWith({
      channelId: 'channel-1',
      fromPhoneNumber: '5511999998888',
      contactDisplayName: null,
      whatsappMessageId: 'wamid.LOC',
      messageType: 'location',
      content: undefined,
      mediaPath: undefined,
      mediaMimeType: undefined,
      mediaFilename: undefined,
      locationLatitude: -3.1,
      locationLongitude: -60.0,
    });
  });
```

Update the existing `'processes a valid, signed webhook payload'` test's `expect(ingestInboundMessage).toHaveBeenCalledWith(...)` assertion to add `messageType: 'text',` and `mediaPath: undefined, mediaMimeType: undefined, mediaFilename: undefined, locationLatitude: undefined, locationLongitude: undefined,` to the expected object (the plain-text path now passes these through too, all `undefined`).

- [ ] **Step 6: Run test to verify it fails**

Run: `npm test -- src/whatsapp-adapters/meta-cloud.routes.test.js`
Expected: FAIL — the route doesn't download/save media yet, and the updated text-path assertion doesn't match the current call.

- [ ] **Step 7: Update `src/whatsapp-adapters/meta-cloud.routes.js`**

Replace the entire file with:

```js
const express = require('express');
const { loadConfig } = require('../config/env');
const { verifyWebhookChallenge, verifySignature, parseInboundMessages, downloadMetaMedia } = require('./meta-cloud.adapter');
const { findChannelByMetaPhoneNumberId } = require('../channels/channel.repository');
const { ingestInboundMessage } = require('../conversations/inbound-message.service');
const { saveMediaFile, extensionForMimeType } = require('../media/media-storage');

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
      let mediaPath;
      if (inboundMessage.mediaId) {
        const buffer = await downloadMetaMedia(inboundMessage.mediaId, channel.config.accessToken);
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

- [ ] **Step 9: Run the full backend suite**

Run: `npm test`
Expected: PASS, all suites.

- [ ] **Step 10: Commit**

```bash
git add src/whatsapp-adapters/meta-cloud.adapter.js src/whatsapp-adapters/meta-cloud.adapter.test.js src/whatsapp-adapters/meta-cloud.routes.js src/whatsapp-adapters/meta-cloud.routes.test.js
git commit -m "feat: receive image/document/audio/video/sticker/location on Meta Cloud"
```

---

### Task 6: Meta Cloud — sending media

**Files:**
- Modify: `src/whatsapp-adapters/meta-cloud.adapter.js`
- Modify: `src/whatsapp-adapters/meta-cloud.adapter.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `getMediaFilePath` (Task 2).
- Produces: `sendMediaMessage(channel, toPhoneNumber, {messageType, mediaPath, mediaMimeType, mediaFilename, caption}) -> Promise<{whatsappMessageId}>` — same contract shape as `sendTextMessage`. Consumed by Task 9 (outbound worker).

- [ ] **Step 1: Install the `form-data` dependency**

Run: `npm install form-data`

- [ ] **Step 2: Write the failing test**

Add to `src/whatsapp-adapters/meta-cloud.adapter.test.js`, in the existing `jest.mock('axios')` section (after the `sendTextMessage` describe block):

```js
jest.mock('fs');
const fs = require('fs');

describe('sendMediaMessage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('uploads the file then sends a message referencing the returned media id', async () => {
    fs.promises = { readFile: jest.fn().mockResolvedValue(Buffer.from('fake-image-bytes')) };
    axios.post
      .mockResolvedValueOnce({ data: { id: 'UPLOADED_MEDIA_ID' } })
      .mockResolvedValueOnce({ data: { messages: [{ id: 'wamid.SENT_IMG' }] } });

    const channel = { config: { phoneNumberId: '1234567890', accessToken: 'token-abc' } };
    const result = await sendMediaMessage(channel, '5511999998888', {
      messageType: 'image',
      mediaPath: 'abc.jpg',
      mediaMimeType: 'image/jpeg',
      mediaFilename: null,
      caption: 'Resposta do atendente',
    });

    expect(axios.post).toHaveBeenNthCalledWith(
      1,
      'https://graph.facebook.com/v20.0/1234567890/media',
      expect.anything(),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer token-abc' }) })
    );
    expect(axios.post).toHaveBeenNthCalledWith(
      2,
      'https://graph.facebook.com/v20.0/1234567890/messages',
      {
        messaging_product: 'whatsapp',
        to: '5511999998888',
        type: 'image',
        image: { id: 'UPLOADED_MEDIA_ID', caption: 'Resposta do atendente' },
      },
      { headers: { Authorization: 'Bearer token-abc' } }
    );
    expect(result).toEqual({ whatsappMessageId: 'wamid.SENT_IMG' });
  });

  test('omits caption from the message payload when there is none', async () => {
    fs.promises = { readFile: jest.fn().mockResolvedValue(Buffer.from('fake-doc-bytes')) };
    axios.post
      .mockResolvedValueOnce({ data: { id: 'UPLOADED_MEDIA_ID_2' } })
      .mockResolvedValueOnce({ data: { messages: [{ id: 'wamid.SENT_DOC' }] } });

    const channel = { config: { phoneNumberId: '1234567890', accessToken: 'token-abc' } };
    await sendMediaMessage(channel, '5511999998888', {
      messageType: 'document',
      mediaPath: 'doc.pdf',
      mediaMimeType: 'application/pdf',
      mediaFilename: 'comprovante.pdf',
      caption: null,
    });

    expect(axios.post).toHaveBeenNthCalledWith(
      2,
      'https://graph.facebook.com/v20.0/1234567890/messages',
      {
        messaging_product: 'whatsapp',
        to: '5511999998888',
        type: 'document',
        document: { id: 'UPLOADED_MEDIA_ID_2' },
      },
      { headers: { Authorization: 'Bearer token-abc' } }
    );
  });
});
```

Also import `sendMediaMessage` in the `require('./meta-cloud.adapter')` line at the top of the test file, and mock `../media/media-storage`'s `getMediaFilePath` (add `jest.mock('../media/media-storage')` and `const { getMediaFilePath } = require('../media/media-storage');`, and in each test call `getMediaFilePath.mockReturnValue('/fake/path/to/file')` before the assertions — `fs.promises.readFile` is mocked to ignore the actual path anyway).

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- src/whatsapp-adapters/meta-cloud.adapter.test.js`
Expected: FAIL — `sendMediaMessage` doesn't exist yet.

- [ ] **Step 4: Write the implementation**

At the top of `src/whatsapp-adapters/meta-cloud.adapter.js`, add:

```js
const fs = require('fs');
const FormData = require('form-data');
const { getMediaFilePath } = require('../media/media-storage');
```

After `sendTextMessage`, add:

```js
async function sendMediaMessage(channel, toPhoneNumber, { messageType, mediaPath, mediaMimeType, mediaFilename, caption }) {
  const { phoneNumberId, accessToken } = channel.config;
  const buffer = await fs.promises.readFile(getMediaFilePath(mediaPath));

  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('file', buffer, { filename: mediaFilename || 'file', contentType: mediaMimeType });
  const uploadResponse = await axios.post(`https://graph.facebook.com/v20.0/${phoneNumberId}/media`, form, {
    headers: { ...form.getHeaders(), Authorization: `Bearer ${accessToken}` },
  });

  const mediaId = uploadResponse.data.id;
  const messagePayload = {
    messaging_product: 'whatsapp',
    to: toPhoneNumber,
    type: messageType,
    [messageType]: caption ? { id: mediaId, caption } : { id: mediaId },
  };
  const response = await axios.post(`https://graph.facebook.com/v20.0/${phoneNumberId}/messages`, messagePayload, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return { whatsappMessageId: response.data.messages[0].id };
}
```

Update the final `module.exports` to also include `sendMediaMessage`:

```js
module.exports = {
  verifyWebhookChallenge,
  verifySignature,
  parseInboundMessages,
  sendTextMessage,
  downloadMetaMedia,
  sendMediaMessage,
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- src/whatsapp-adapters/meta-cloud.adapter.test.js`
Expected: PASS

- [ ] **Step 6: Run the full backend suite**

Run: `npm test`
Expected: PASS, all suites.

- [ ] **Step 7: Commit**

```bash
git add src/whatsapp-adapters/meta-cloud.adapter.js src/whatsapp-adapters/meta-cloud.adapter.test.js package.json package-lock.json
git commit -m "feat: send image/document/audio/video on Meta Cloud"
```

---

### Task 7: Baileys — receiving media

**Files:**
- Modify: `src/whatsapp-adapters/baileys.manager.js`
- Modify: `src/whatsapp-adapters/baileys.manager.test.js`

**Interfaces:**
- Consumes: `saveMediaFile`, `extensionForMimeType` (Task 2), `ingestInboundMessage` (Task 4).
- Produces: `handleMessagesUpsert` (already exported implicitly via the module's event wiring, not directly exported — tested through the captured `messages.upsert` handler, same as today) now recognizes `imageMessage`/`documentMessage`/`audioMessage`/`videoMessage`/`stickerMessage`/`locationMessage`.

- [ ] **Step 1: Write the failing test**

Add these tests to `src/whatsapp-adapters/baileys.manager.test.js`, inside the existing `describe('messages.upsert handling', ...)` block (after the existing tests — read the file first to match the exact current setup, in particular the `beforeEach` that starts a connection on `channel-3` and the `createMockSock()`/`sock.handlers['messages.upsert']` pattern already used):

```js
    test('downloads and saves an image message with a caption', async () => {
      const { saveMediaFile } = require('../media/media-storage');
      saveMediaFile.mockResolvedValue('generated-image.jpg');
      baileysLib.downloadMediaMessage.mockResolvedValue(Buffer.from('fake-image-bytes'));

      await sock.handlers['messages.upsert']({
        type: 'notify',
        messages: [
          {
            key: { remoteJid: '5511999998888@s.whatsapp.net', fromMe: false, id: 'BAILEYS_IMG_1' },
            pushName: 'Cliente Baileys',
            message: { imageMessage: { mimetype: 'image/jpeg', caption: 'Comprovante' } },
          },
        ],
      });

      expect(baileysLib.downloadMediaMessage).toHaveBeenCalled();
      expect(saveMediaFile).toHaveBeenCalledWith(Buffer.from('fake-image-bytes'), '.jpg');
      expect(ingestInboundMessage).toHaveBeenCalledWith({
        channelId: 'channel-3',
        fromPhoneNumber: '5511999998888',
        contactDisplayName: 'Cliente Baileys',
        whatsappMessageId: 'BAILEYS_IMG_1',
        messageType: 'image',
        content: 'Comprovante',
        mediaPath: 'generated-image.jpg',
        mediaMimeType: 'image/jpeg',
        mediaFilename: undefined,
      });
    });

    test('downloads a document message with a filename', async () => {
      const { saveMediaFile } = require('../media/media-storage');
      saveMediaFile.mockResolvedValue('generated-doc.pdf');
      baileysLib.downloadMediaMessage.mockResolvedValue(Buffer.from('fake-doc-bytes'));

      await sock.handlers['messages.upsert']({
        type: 'notify',
        messages: [
          {
            key: { remoteJid: '5511999997777@s.whatsapp.net', fromMe: false, id: 'BAILEYS_DOC_1' },
            pushName: 'Outro Cliente',
            message: { documentMessage: { mimetype: 'application/pdf', fileName: 'comprovante.pdf' } },
          },
        ],
      });

      expect(ingestInboundMessage).toHaveBeenCalledWith({
        channelId: 'channel-3',
        fromPhoneNumber: '5511999997777',
        contactDisplayName: 'Outro Cliente',
        whatsappMessageId: 'BAILEYS_DOC_1',
        messageType: 'document',
        content: null,
        mediaPath: 'generated-doc.pdf',
        mediaMimeType: 'application/pdf',
        mediaFilename: 'comprovante.pdf',
      });
    });

    test('ingests a location message with coordinates and no media download', async () => {
      const { saveMediaFile } = require('../media/media-storage');

      await sock.handlers['messages.upsert']({
        type: 'notify',
        messages: [
          {
            key: { remoteJid: '5511999996666@s.whatsapp.net', fromMe: false, id: 'BAILEYS_LOC_1' },
            pushName: 'Cliente Localização',
            message: { locationMessage: { degreesLatitude: -3.119, degreesLongitude: -60.021 } },
          },
        ],
      });

      expect(saveMediaFile).not.toHaveBeenCalled();
      expect(baileysLib.downloadMediaMessage).not.toHaveBeenCalled();
      expect(ingestInboundMessage).toHaveBeenCalledWith({
        channelId: 'channel-3',
        fromPhoneNumber: '5511999996666',
        contactDisplayName: 'Cliente Localização',
        whatsappMessageId: 'BAILEYS_LOC_1',
        messageType: 'location',
        locationLatitude: -3.119,
        locationLongitude: -60.021,
      });
    });
```

Also, in the top-of-file `jest.mock('@whiskeysockets/baileys', () => ({...}))` factory, add `downloadMediaMessage: jest.fn(),` alongside the existing `default`/`useMultiFileAuthState`/`DisconnectReason` entries. Add `jest.mock('../media/media-storage');` near the top of the file (alongside the other `jest.mock` calls).

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/whatsapp-adapters/baileys.manager.test.js`
Expected: FAIL — `handleMessagesUpsert` doesn't recognize media/location messages yet.

- [ ] **Step 3: Update `src/whatsapp-adapters/baileys.manager.js`**

Add this import at the top, alongside the existing ones:

```js
const { saveMediaFile, extensionForMimeType } = require('../media/media-storage');
```

Add these two helper functions, near `extractTextContent`:

```js
function extractMediaInfo(message) {
  if (!message) return null;
  if (message.imageMessage) {
    return { type: 'image', mimeType: message.imageMessage.mimetype, caption: message.imageMessage.caption || null, filename: null };
  }
  if (message.documentMessage) {
    return {
      type: 'document',
      mimeType: message.documentMessage.mimetype,
      caption: message.documentMessage.caption || null,
      filename: message.documentMessage.fileName || null,
    };
  }
  if (message.audioMessage) {
    return { type: 'audio', mimeType: message.audioMessage.mimetype, caption: null, filename: null };
  }
  if (message.videoMessage) {
    return { type: 'video', mimeType: message.videoMessage.mimetype, caption: message.videoMessage.caption || null, filename: null };
  }
  if (message.stickerMessage) {
    return { type: 'sticker', mimeType: message.stickerMessage.mimetype, caption: null, filename: null };
  }
  return null;
}

function extractLocation(message) {
  if (!message || !message.locationMessage) return null;
  return {
    latitude: message.locationMessage.degreesLatitude,
    longitude: message.locationMessage.degreesLongitude,
  };
}
```

Replace `handleMessagesUpsert` with:

```js
async function handleMessagesUpsert(channel, { messages, type }) {
  if (type !== 'notify') return;
  for (const msg of messages) {
    if (msg.key.fromMe) continue;
    const phoneJid = resolveContactPhoneJid(msg.key);
    if (!phoneJid) continue;
    const fromPhoneNumber = jidToPhoneNumber(phoneJid);
    const contactDisplayName = msg.pushName ? msg.pushName.trim() : null;

    const location = extractLocation(msg.message);
    if (location) {
      await ingestInboundMessage({
        channelId: channel.id,
        fromPhoneNumber,
        contactDisplayName,
        whatsappMessageId: msg.key.id,
        messageType: 'location',
        locationLatitude: location.latitude,
        locationLongitude: location.longitude,
      });
      continue;
    }

    const mediaInfo = extractMediaInfo(msg.message);
    if (mediaInfo) {
      const { downloadMediaMessage } = loadBaileysLib();
      const buffer = await downloadMediaMessage(msg, 'buffer', {});
      const mediaPath = await saveMediaFile(buffer, extensionForMimeType(mediaInfo.mimeType));
      await ingestInboundMessage({
        channelId: channel.id,
        fromPhoneNumber,
        contactDisplayName,
        whatsappMessageId: msg.key.id,
        messageType: mediaInfo.type,
        content: mediaInfo.caption,
        mediaPath,
        mediaMimeType: mediaInfo.mimeType,
        mediaFilename: mediaInfo.filename,
      });
      continue;
    }

    const content = extractTextContent(msg.message);
    if (!content) continue;
    await ingestInboundMessage({
      channelId: channel.id,
      fromPhoneNumber,
      contactDisplayName,
      whatsappMessageId: msg.key.id,
      messageType: 'text',
      content,
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/whatsapp-adapters/baileys.manager.test.js`
Expected: PASS

- [ ] **Step 5: Run the full backend suite**

Run: `npm test`
Expected: PASS, all suites.

- [ ] **Step 6: Commit**

```bash
git add src/whatsapp-adapters/baileys.manager.js src/whatsapp-adapters/baileys.manager.test.js
git commit -m "feat: receive image/document/audio/video/sticker/location on Baileys"
```

---

### Task 8: Baileys — sending media

**Files:**
- Modify: `src/whatsapp-adapters/baileys.manager.js`
- Modify: `src/whatsapp-adapters/baileys.manager.test.js`

**Interfaces:**
- Consumes: `getMediaFilePath` (Task 2).
- Produces: `sendMediaMessage(channel, toPhoneNumber, {messageType, mediaPath, mediaMimeType, mediaFilename, caption}) -> Promise<{whatsappMessageId}>` — same contract as Meta Cloud's (Task 6). Consumed by Task 9.

- [ ] **Step 1: Write the failing test**

Add to `src/whatsapp-adapters/baileys.manager.test.js`, inside the existing `describe('sendTextMessage', ...)` block's parent scope (add a new sibling `describe('sendMediaMessage', ...)` block after it — read the file first to match the exact channel/connection setup pattern already used in the `sendTextMessage` tests):

```js
  describe('sendMediaMessage', () => {
    test('sends an image with a caption through the active socket', async () => {
      const sock = createMockSock();
      baileysLib.default.mockReturnValue(sock);
      const channel = { id: 'channel-5', type: 'baileys' };
      await manager.startBaileysConnection(channel);
      const { getMediaFilePath } = require('../media/media-storage');
      getMediaFilePath.mockReturnValue('/fake/path/image.jpg');
      const fs = require('fs');
      fs.promises.readFile = jest.fn().mockResolvedValue(Buffer.from('fake-image-bytes'));

      const result = await manager.sendMediaMessage(channel, '5511999993333', {
        messageType: 'image',
        mediaPath: 'image.jpg',
        mediaMimeType: 'image/jpeg',
        caption: 'Resposta do atendente',
      });

      expect(sock.sendMessage).toHaveBeenCalledWith('5511999993333@s.whatsapp.net', {
        image: Buffer.from('fake-image-bytes'),
        caption: 'Resposta do atendente',
      });
      expect(result).toEqual({ whatsappMessageId: 'wamid.SENT1' });
    });

    test('sends a document with a filename and no caption', async () => {
      const sock = createMockSock();
      baileysLib.default.mockReturnValue(sock);
      const channel = { id: 'channel-6', type: 'baileys' };
      await manager.startBaileysConnection(channel);
      const { getMediaFilePath } = require('../media/media-storage');
      getMediaFilePath.mockReturnValue('/fake/path/doc.pdf');
      const fs = require('fs');
      fs.promises.readFile = jest.fn().mockResolvedValue(Buffer.from('fake-doc-bytes'));

      await manager.sendMediaMessage(channel, '5511999993333', {
        messageType: 'document',
        mediaPath: 'doc.pdf',
        mediaMimeType: 'application/pdf',
        mediaFilename: 'resposta.pdf',
        caption: null,
      });

      expect(sock.sendMessage).toHaveBeenCalledWith('5511999993333@s.whatsapp.net', {
        document: Buffer.from('fake-doc-bytes'),
        mimetype: 'application/pdf',
        fileName: 'resposta.pdf',
      });
    });

    test('throws when there is no active connection for the channel', async () => {
      await expect(
        manager.sendMediaMessage({ id: 'channel-does-not-exist' }, '5511999992222', { messageType: 'image', mediaPath: 'x.jpg' })
      ).rejects.toThrow('No active Baileys connection for channel channel-does-not-exist');
    });
  });
```

Add `jest.mock('../media/media-storage');` near the top of the file if not already added by Task 7 (it was — this task just uses the same mock, adding `getMediaFilePath` usage on top of `saveMediaFile`/`extensionForMimeType`).

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/whatsapp-adapters/baileys.manager.test.js`
Expected: FAIL — `sendMediaMessage` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

Add `getMediaFilePath` to the existing `require('../media/media-storage')` import line, and add `fs.promises.readFile` usage (the `fs` module is already required at the top of this file). After the existing `sendTextMessage` function, add:

```js
async function sendMediaMessage(channel, toPhoneNumber, { messageType, mediaPath, mediaMimeType, mediaFilename, caption }) {
  const entry = connections.get(channel.id);
  if (!entry) {
    throw new Error(`No active Baileys connection for channel ${channel.id}`);
  }
  const buffer = await fs.promises.readFile(getMediaFilePath(mediaPath));
  const jid = `${toPhoneNumber}@s.whatsapp.net`;

  let payload;
  if (messageType === 'image') {
    payload = caption ? { image: buffer, caption } : { image: buffer };
  } else if (messageType === 'video') {
    payload = caption ? { video: buffer, caption } : { video: buffer };
  } else if (messageType === 'audio') {
    payload = { audio: buffer, mimetype: mediaMimeType };
  } else if (messageType === 'document') {
    payload = { document: buffer, mimetype: mediaMimeType, fileName: mediaFilename || 'arquivo' };
  } else if (messageType === 'sticker') {
    payload = { sticker: buffer };
  } else {
    throw new Error(`Unsupported media message type: ${messageType}`);
  }

  const sent = await entry.sock.sendMessage(jid, payload);
  return { whatsappMessageId: sent.key.id };
}
```

Update the final `module.exports` to add `sendMediaMessage`:

```js
module.exports = {
  startAllBaileysConnections,
  startBaileysConnection,
  addBaileysChannel,
  sendTextMessage,
  sendMediaMessage,
  getQrForChannel,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/whatsapp-adapters/baileys.manager.test.js`
Expected: PASS

- [ ] **Step 5: Run the full backend suite**

Run: `npm test`
Expected: PASS, all suites.

- [ ] **Step 6: Commit**

```bash
git add src/whatsapp-adapters/baileys.manager.js src/whatsapp-adapters/baileys.manager.test.js
git commit -m "feat: send image/document/audio/video/sticker on Baileys"
```

---

### Task 9: Outbound queue + worker dispatch media

**Files:**
- Modify: `src/queue/outbound-queue.js`
- Modify: `src/queue/outbound-queue.test.js`
- Modify: `src/queue/outbound-worker.js`
- Modify: `src/queue/outbound-worker.test.js`

**Interfaces:**
- Consumes: `sendMediaMessage` (Tasks 6 and 8, same contract on both adapters).
- Produces: `enqueueOutboundMessage({conversationId, channelId, content, messageType, mediaPath, mediaMimeType, mediaFilename})` — new fields all optional, defaulting through `createMessage`. The outbound worker now calls `adapter.sendMediaMessage(...)` instead of `adapter.sendTextMessage(...)` whenever the message's `messageType` isn't `'text'`.

- [ ] **Step 1: Write the failing test for `enqueueOutboundMessage`**

Add this test to `src/queue/outbound-queue.test.js`, inside the existing `describe('outbound queue', ...)` block (after the existing test):

```js
  test('passes media fields through to the created message and the queued job', (done) => {
    processOutboundQueue((data) => {
      try {
        expect(data.messageType).toBe('image');
        expect(data.mediaPath).toBe('some-file.jpg');
        expect(data.mediaMimeType).toBe('image/jpeg');
        done();
      } catch (err) {
        done(err);
      }
    });
    enqueueOutboundMessage({
      conversationId,
      channelId,
      content: 'Aqui está',
      messageType: 'image',
      mediaPath: 'some-file.jpg',
      mediaMimeType: 'image/jpeg',
      mediaFilename: null,
    }).then((message) => {
      expect(message.messageType).toBe('image');
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/queue/outbound-queue.test.js`
Expected: FAIL — `enqueueOutboundMessage` doesn't forward the media fields yet.

- [ ] **Step 3: Update `src/queue/outbound-queue.js`**

Replace `enqueueOutboundMessage` with:

```js
async function enqueueOutboundMessage({ conversationId, channelId, content, messageType, mediaPath, mediaMimeType, mediaFilename }) {
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
    },
    { attempts: 3, backoff: { type: 'exponential', delay: 5000 } }
  );
  return message;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/queue/outbound-queue.test.js`
Expected: PASS

- [ ] **Step 5: Write the failing test for the outbound worker's dispatch**

Add to `src/queue/outbound-worker.test.js`, inside the existing `describe('startOutboundWorker', ...)` block (after the existing tests):

```js
  test('sends via sendMediaMessage when the message has a non-text messageType', async () => {
    getConversationWithContact.mockResolvedValue({ id: 'conv-1', contactPhoneNumber: '5511999998888' });
    findChannelById.mockResolvedValue({
      id: 'channel-1',
      type: 'meta_cloud',
      config: { phoneNumberId: '123', accessToken: 'tok' },
    });
    metaCloudAdapter.sendMediaMessage.mockResolvedValue({ whatsappMessageId: 'wamid.MEDIA1' });

    await handler({
      messageId: 'msg-4',
      conversationId: 'conv-1',
      channelId: 'channel-1',
      content: 'Aqui está',
      messageType: 'image',
      mediaPath: 'file.jpg',
      mediaMimeType: 'image/jpeg',
      mediaFilename: null,
    });

    expect(metaCloudAdapter.sendMediaMessage).toHaveBeenCalledWith(
      { id: 'channel-1', type: 'meta_cloud', config: { phoneNumberId: '123', accessToken: 'tok' } },
      '5511999998888',
      { messageType: 'image', mediaPath: 'file.jpg', mediaMimeType: 'image/jpeg', mediaFilename: null, caption: 'Aqui está' }
    );
    expect(metaCloudAdapter.sendTextMessage).not.toHaveBeenCalled();
    expect(recordMessageSent).toHaveBeenCalledWith('msg-4', 'wamid.MEDIA1');
  });

  test('sends via sendTextMessage when messageType is text or absent', async () => {
    getConversationWithContact.mockResolvedValue({ id: 'conv-1', contactPhoneNumber: '5511999998888' });
    findChannelById.mockResolvedValue({ id: 'channel-1', type: 'meta_cloud', config: {} });
    metaCloudAdapter.sendTextMessage.mockResolvedValue({ whatsappMessageId: 'wamid.TXT1' });

    await handler({ messageId: 'msg-5', conversationId: 'conv-1', channelId: 'channel-1', content: 'Oi', messageType: 'text' });

    expect(metaCloudAdapter.sendTextMessage).toHaveBeenCalledWith(
      { id: 'channel-1', type: 'meta_cloud', config: {} },
      '5511999998888',
      'Oi'
    );
    expect(metaCloudAdapter.sendMediaMessage).not.toHaveBeenCalled();
  });
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm test -- src/queue/outbound-worker.test.js`
Expected: FAIL — the worker doesn't call `sendMediaMessage` yet.

- [ ] **Step 7: Update `src/queue/outbound-worker.js`**

Replace the handler body inside `startOutboundWorker` with:

```js
function startOutboundWorker() {
  processOutboundQueue(async ({ messageId, conversationId, channelId, content, messageType, mediaPath, mediaMimeType, mediaFilename }) => {
    const conversation = await getConversationWithContact(conversationId);
    const channel = await findChannelById(channelId);
    try {
      const adapter = ADAPTERS_BY_CHANNEL_TYPE[channel.type];
      const { whatsappMessageId } =
        messageType && messageType !== 'text'
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

- [ ] **Step 8: Run test to verify it passes**

Run: `npm test -- src/queue/outbound-worker.test.js`
Expected: PASS

- [ ] **Step 9: Run the full backend suite**

Run: `npm test`
Expected: PASS, all suites.

- [ ] **Step 10: Commit**

```bash
git add src/queue/outbound-queue.js src/queue/outbound-queue.test.js src/queue/outbound-worker.js src/queue/outbound-worker.test.js
git commit -m "feat: dispatch outbound media messages to sendMediaMessage"
```

---

### Task 10: `POST /:id/messages` accepts file uploads

**Files:**
- Modify: `src/api/conversations.routes.js`
- Modify: `src/api/conversations.routes.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `saveMediaFile`, `extensionForMimeType`, `messageTypeForMimeType` (Task 2), `enqueueOutboundMessage` (Task 9, already accepts media fields).
- Produces: `POST /api/conversations/:id/messages` now accepts either a JSON body (`{content}`, unchanged) or `multipart/form-data` (optional `content` field + optional `file` field).

- [ ] **Step 1: Install the `multer` dependency**

Run: `npm install multer`

- [ ] **Step 2: Write the failing test**

In `src/api/conversations.routes.test.js`, add `jest.mock('../media/media-storage');` near the top (alongside the existing `jest.mock` calls) and import `saveMediaFile` where needed. Add these tests inside the existing `describe('POST /:id/messages', ...)`-equivalent block (read the file first to find the exact describe block name and existing test structure for this route, then add alongside them):

```js
  test('accepts a multipart upload with an image file and no text content', async () => {
    const { saveMediaFile } = require('../media/media-storage');
    getConversationWithContact.mockResolvedValue({
      id: CONVERSATION_ID,
      channelId: 'channel-1',
      status: 'assigned',
      assignedAgentId: 'agent-1',
    });
    saveMediaFile.mockResolvedValue('generated-name.jpg');
    enqueueOutboundMessage.mockResolvedValue({ id: 'msg-1', messageType: 'image' });

    const res = await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/messages`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .attach('file', Buffer.from('fake-image-bytes'), { filename: 'foto.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(201);
    expect(saveMediaFile).toHaveBeenCalledWith(Buffer.from('fake-image-bytes'), '.jpg');
    expect(enqueueOutboundMessage).toHaveBeenCalledWith({
      conversationId: CONVERSATION_ID,
      channelId: 'channel-1',
      content: null,
      messageType: 'image',
      mediaPath: 'generated-name.jpg',
      mediaMimeType: 'image/jpeg',
      mediaFilename: 'foto.jpg',
    });
  });

  test('accepts a multipart upload with both a file and a caption', async () => {
    const { saveMediaFile } = require('../media/media-storage');
    getConversationWithContact.mockResolvedValue({
      id: CONVERSATION_ID,
      channelId: 'channel-1',
      status: 'assigned',
      assignedAgentId: 'agent-1',
    });
    saveMediaFile.mockResolvedValue('generated-doc.pdf');
    enqueueOutboundMessage.mockResolvedValue({ id: 'msg-2', messageType: 'document' });

    const res = await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/messages`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .field('content', 'Segue o comprovante')
      .attach('file', Buffer.from('fake-pdf-bytes'), { filename: 'comprovante.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(201);
    expect(enqueueOutboundMessage).toHaveBeenCalledWith({
      conversationId: CONVERSATION_ID,
      channelId: 'channel-1',
      content: 'Segue o comprovante',
      messageType: 'document',
      mediaPath: 'generated-doc.pdf',
      mediaMimeType: 'application/pdf',
      mediaFilename: 'comprovante.pdf',
    });
  });

  test('rejects a request with neither content nor a file', async () => {
    const res = await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/messages`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({});
    expect(res.status).toBe(400);
    expect(enqueueOutboundMessage).not.toHaveBeenCalled();
  });

  test('rejects a file larger than the type-specific size limit', async () => {
    getConversationWithContact.mockResolvedValue({
      id: CONVERSATION_ID,
      channelId: 'channel-1',
      status: 'assigned',
      assignedAgentId: 'agent-1',
    });
    const tooLarge = Buffer.alloc(17 * 1024 * 1024); // 17MB, over the 16MB image limit

    const res = await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/messages`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .attach('file', tooLarge, { filename: 'grande.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(400);
    expect(enqueueOutboundMessage).not.toHaveBeenCalled();
  });
```

Check the existing `'sends a text-only JSON message'`-equivalent test in this file still exists and still passes unmodified — plain JSON requests (`.send({content: '...'})` with the default `Content-Type: application/json` supertest uses) must keep working exactly as before, since `multer`'s middleware only engages for `multipart/form-data` requests and leaves everything else to `express.json()`.

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- src/api/conversations.routes.test.js`
Expected: FAIL — the route doesn't accept file uploads yet.

- [ ] **Step 4: Update `src/api/conversations.routes.js`**

Add these imports at the top:

```js
const multer = require('multer');
const { saveMediaFile, extensionForMimeType, messageTypeForMimeType } = require('../media/media-storage');
```

Add this constant near the top of the file (after `router.param('id', ...)`):

```js
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });
const MAX_SIZE_BY_MESSAGE_TYPE = {
  image: 16 * 1024 * 1024,
  audio: 16 * 1024 * 1024,
  video: 16 * 1024 * 1024,
  document: 100 * 1024 * 1024,
};
```

Replace the `POST /:id/messages` route with:

```js
router.post('/:id/messages', upload.single('file'), async (req, res) => {
  const content = (req.body && req.body.content) || null;
  const file = req.file;
  if (!content && !file) {
    return res.status(400).json({ error: 'content or file is required' });
  }
  const conversation = await getConversationWithContact(req.params.id);
  if (!conversation) {
    return res.status(404).json({ error: 'Conversation not found' });
  }
  if (conversation.status === 'closed') {
    return res.status(409).json({ error: 'Conversation is closed' });
  }
  if (conversation.assignedAgentId !== req.agent.agentId) {
    return res.status(403).json({ error: 'Only the assigned agent can send messages on this conversation' });
  }

  let messageType = 'text';
  let mediaPath;
  let mediaMimeType;
  let mediaFilename;
  if (file) {
    messageType = messageTypeForMimeType(file.mimetype);
    const maxSize = MAX_SIZE_BY_MESSAGE_TYPE[messageType] || MAX_SIZE_BY_MESSAGE_TYPE.document;
    if (file.size > maxSize) {
      return res.status(400).json({ error: `File exceeds the ${Math.round(maxSize / (1024 * 1024))}MB limit for ${messageType}` });
    }
    mediaPath = await saveMediaFile(file.buffer, extensionForMimeType(file.mimetype));
    mediaMimeType = file.mimetype;
    mediaFilename = file.originalname;
  }

  const message = await enqueueOutboundMessage({
    conversationId: conversation.id,
    channelId: conversation.channelId,
    content,
    messageType,
    mediaPath,
    mediaMimeType,
    mediaFilename,
  });
  res.status(201).json(message);
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- src/api/conversations.routes.test.js`
Expected: PASS

- [ ] **Step 6: Run the full backend suite**

Run: `npm test`
Expected: PASS, all suites.

- [ ] **Step 7: Commit**

```bash
git add src/api/conversations.routes.js src/api/conversations.routes.test.js package.json package-lock.json
git commit -m "feat: accept file uploads on POST /:id/messages"
```

---

### Task 11: Frontend — `api.js` supports file upload and media URLs

**Files:**
- Modify: `frontend/src/services/api.js`
- Modify: `frontend/src/services/api.test.js`
- Modify: `frontend/src/hooks/useConversationMessages.js`
- Modify: `frontend/src/hooks/useConversationMessages.test.jsx`

**Interfaces:**
- Produces: `sendMessage(conversationId, content, token, file)` — `file` is an optional `File`/`Blob`; when present, the request is sent as `multipart/form-data` instead of JSON. `mediaUrl(messageId, token) -> string`. `apiFetch` now sends a request body as-is (no `JSON.stringify`, no `Content-Type` header) whenever it's a `FormData` instance. `useConversationMessages`'s returned `sendMessage(content, file)` now accepts the optional file too. Consumed by Task 14 (`MessageInput`).

- [ ] **Step 1: Write the failing test for `apiFetch`'s FormData handling and `mediaUrl`**

Add to `frontend/src/services/api.test.js`, inside the existing `describe('apiFetch', ...)` block (after the existing tests):

```js
  test('sends a FormData body as-is, without a Content-Type header or JSON.stringify', async () => {
    global.fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('{}') });
    const formData = new FormData();
    formData.append('content', 'Legenda');

    await apiFetch('/api/conversations/abc/messages', { method: 'POST', body: formData, token: 'tok-123' });

    const callArgs = global.fetch.mock.calls[0][1];
    expect(callArgs.body).toBe(formData);
    expect(callArgs.headers['Content-Type']).toBeUndefined();
    expect(callArgs.headers.Authorization).toBe('Bearer tok-123');
  });
```

Add a new `describe` block at the end of the file, before the closing of the file:

```js
describe('mediaUrl', () => {
  test('builds a URL with the message id and token as query string', () => {
    expect(mediaUrl('msg-123', 'tok-abc')).toBe('http://localhost:3000/api/media/msg-123?token=tok-abc');
  });
});
```

Update the import line at the top of the file to include `sendMessage` and `mediaUrl`: `import { apiFetch, ApiError, login, getQueue, setUnauthorizedHandler, sendMessage, mediaUrl } from './api';`

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/services/api.test.js`
Expected: FAIL — `apiFetch` still JSON-encodes everything, `mediaUrl` doesn't exist.

- [ ] **Step 3: Update `frontend/src/services/api.js`**

Replace `apiFetch` with:

```js
export async function apiFetch(path, { method = 'GET', body, token } = {}) {
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
  const headers = {};
  if (!isFormData) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: isFormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    if (response.status === 401 && unauthorizedHandler) {
      unauthorizedHandler();
    }
    throw new ApiError(response.status, data);
  }
  return data;
}
```

Replace `sendMessage` with:

```js
export function sendMessage(conversationId, content, token, file) {
  if (file) {
    const formData = new FormData();
    if (content) {
      formData.append('content', content);
    }
    formData.append('file', file);
    return apiFetch(`/api/conversations/${conversationId}/messages`, { method: 'POST', body: formData, token });
  }
  return apiFetch(`/api/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: { content },
    token,
  });
}
```

Add this new function at the end of the file:

```js
export function mediaUrl(messageId, token) {
  return `${API_BASE_URL}/api/media/${messageId}?token=${token}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/services/api.test.js`
Expected: PASS

- [ ] **Step 5: Write the failing test for `useConversationMessages`'s file parameter**

Add to `frontend/src/hooks/useConversationMessages.test.jsx`, inside the existing `describe('useConversationMessages', ...)` block (after the existing `sendMessage` test):

```js
  test('sendMessage forwards the file argument to the api call', async () => {
    api.getMessages.mockResolvedValue([]);
    api.sendMessage.mockResolvedValue({ id: 'm3', messageType: 'image' });
    const { result } = renderHook(() => useConversationMessages('conv-1'));
    await waitFor(() => expect(result.current.messages).toEqual([]));
    const fakeFile = new File(['bytes'], 'foto.jpg', { type: 'image/jpeg' });

    await act(async () => {
      await result.current.sendMessage('Legenda', fakeFile);
    });

    expect(api.sendMessage).toHaveBeenCalledWith('conv-1', 'Legenda', 'tok-123', fakeFile);
  });
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/hooks/useConversationMessages.test.jsx`
Expected: FAIL — `sendMessage` doesn't accept/forward a file argument yet.

- [ ] **Step 7: Update `frontend/src/hooks/useConversationMessages.js`**

Replace the `sendMessage` callback with:

```js
  const sendMessage = useCallback(
    async (content, file) => {
      const created = await apiSendMessage(conversationId, content, token, file);
      setMessages((prev) => [...prev, created]);
      return created;
    },
    [conversationId, token]
  );
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/hooks/useConversationMessages.test.jsx`
Expected: PASS

- [ ] **Step 9: Run the full frontend suite**

Run: `cd frontend && npx vitest run`
Expected: PASS, all suites.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/services/api.js frontend/src/services/api.test.js frontend/src/hooks/useConversationMessages.js frontend/src/hooks/useConversationMessages.test.jsx
git commit -m "feat: support file uploads and media URLs in the API client"
```

---

### Task 12: `MessageAttachment` component

**Files:**
- Create: `frontend/src/components/MessageAttachment.jsx`
- Create: `frontend/src/components/MessageAttachment.test.jsx`

**Interfaces:**
- Consumes: `useAuth()` (existing), `mediaUrl` (Task 11).
- Produces: `MessageAttachment({message})` — renders nothing for a plain text message, an image/sticker thumbnail, an audio/video player, a document download link, or a "view on map" link for a location, based on `message.messageType`. Consumed by Task 13 (`ConversationView`).

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/MessageAttachment.test.jsx`:

```jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import MessageAttachment from './MessageAttachment';
import { useAuth } from '../contexts/AuthContext';

vi.mock('../contexts/AuthContext');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
});

describe('MessageAttachment', () => {
  test('renders nothing for a plain text message', () => {
    const { container } = render(<MessageAttachment message={{ id: 'm1', messageType: 'text', mediaPath: null }} />);
    expect(container).toBeEmptyDOMElement();
  });

  test('renders an image with the authenticated media URL', () => {
    render(<MessageAttachment message={{ id: 'm2', messageType: 'image', mediaPath: 'foo.jpg', mediaFilename: null }} />);
    const img = screen.getByRole('img');
    expect(img.src).toBe('http://localhost:3000/api/media/m2?token=tok-123');
  });

  test('renders a sticker the same way as an image', () => {
    render(<MessageAttachment message={{ id: 'm3', messageType: 'sticker', mediaPath: 'bar.webp' }} />);
    expect(screen.getByRole('img')).toBeInTheDocument();
  });

  test('renders an audio player', () => {
    render(<MessageAttachment message={{ id: 'm4', messageType: 'audio', mediaPath: 'baz.ogg' }} />);
    expect(document.querySelector('audio')).toBeInTheDocument();
    expect(document.querySelector('audio').src).toBe('http://localhost:3000/api/media/m4?token=tok-123');
  });

  test('renders a video player', () => {
    render(<MessageAttachment message={{ id: 'm5', messageType: 'video', mediaPath: 'qux.mp4' }} />);
    expect(document.querySelector('video')).toBeInTheDocument();
  });

  test('renders a document download link with the filename', () => {
    render(<MessageAttachment message={{ id: 'm6', messageType: 'document', mediaPath: 'doc.pdf', mediaFilename: 'comprovante.pdf' }} />);
    const link = screen.getByRole('link', { name: /comprovante\.pdf/i });
    expect(link.href).toBe('http://localhost:3000/api/media/m6?token=tok-123');
  });

  test('renders a Google Maps link for a location message', () => {
    render(
      <MessageAttachment
        message={{ id: 'm7', messageType: 'location', locationLatitude: -3.119, locationLongitude: -60.021 }}
      />
    );
    const link = screen.getByRole('link', { name: /ver localiza/i });
    expect(link.href).toBe('https://www.google.com/maps?q=-3.119,-60.021');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/MessageAttachment.test.jsx`
Expected: FAIL with `Cannot find module './MessageAttachment'`.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/components/MessageAttachment.jsx`:

```jsx
import { useAuth } from '../contexts/AuthContext';
import { mediaUrl } from '../services/api';

function MessageAttachment({ message }) {
  const { token } = useAuth();

  if (message.messageType === 'location') {
    const mapsUrl = `https://www.google.com/maps?q=${message.locationLatitude},${message.locationLongitude}`;
    return (
      <a href={mapsUrl} target="_blank" rel="noreferrer" className="text-blue-600 underline">
        Ver localização no mapa
      </a>
    );
  }

  if (!message.mediaPath) return null;

  const url = mediaUrl(message.id, token);

  if (message.messageType === 'image' || message.messageType === 'sticker') {
    return <img src={url} alt={message.mediaFilename || 'Imagem'} className="max-w-xs rounded" />;
  }
  if (message.messageType === 'audio') {
    return <audio controls src={url} className="max-w-xs" />;
  }
  if (message.messageType === 'video') {
    return <video controls src={url} className="max-w-xs rounded" />;
  }
  if (message.messageType === 'document') {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="text-blue-600 underline">
        📄 {message.mediaFilename || 'Documento'}
      </a>
    );
  }
  return null;
}

export default MessageAttachment;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/MessageAttachment.test.jsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/MessageAttachment.jsx frontend/src/components/MessageAttachment.test.jsx
git commit -m "feat: add MessageAttachment component for per-type media rendering"
```

---

### Task 13: `ConversationView` renders attachments

**Files:**
- Modify: `frontend/src/components/ConversationView.jsx`
- Modify: `frontend/src/components/ConversationView.test.jsx`

**Interfaces:**
- Consumes: `MessageAttachment` (Task 12).
- Produces: each message bubble in `ConversationView` now shows its text content (if any) and its `MessageAttachment` (if any) — both, either, or neither, depending on the message.

- [ ] **Step 1: Write the failing test**

Add this test to `frontend/src/components/ConversationView.test.jsx`, inside the existing `describe('ConversationView', ...)` block (after the existing `'renders the message history'` test — read the file first to match the exact mocking setup already used for `useConversationMessages`):

```js
  test('renders an image attachment alongside a caption', () => {
    useConversationMessages.mockReturnValue({
      messages: [
        { id: 'm1', direction: 'inbound', messageType: 'image', mediaPath: 'foo.jpg', content: 'Comprovante', mediaFilename: null },
      ],
      sendMessage: vi.fn(),
    });
    render(<ConversationView conversation={{ id: 'c1', status: 'waiting', assignedAgentId: null }} onTransferClick={vi.fn()} />);
    expect(screen.getByText('Comprovante')).toBeInTheDocument();
    expect(screen.getByRole('img')).toBeInTheDocument();
  });

  test('renders a location message without a text bubble', () => {
    useConversationMessages.mockReturnValue({
      messages: [{ id: 'm2', direction: 'inbound', messageType: 'location', locationLatitude: -3.1, locationLongitude: -60.0, content: null }],
      sendMessage: vi.fn(),
    });
    render(<ConversationView conversation={{ id: 'c1', status: 'waiting', assignedAgentId: null }} onTransferClick={vi.fn()} />);
    expect(screen.getByRole('link', { name: /ver localiza/i })).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/ConversationView.test.jsx`
Expected: FAIL — the component only renders `message.content`, never an attachment.

- [ ] **Step 3: Update `frontend/src/components/ConversationView.jsx`**

Add the import at the top:

```jsx
import MessageAttachment from './MessageAttachment';
```

Replace the message-rendering block:

```jsx
        {messages.map((message) => (
          <div
            key={message.id}
            className={`max-w-xs rounded px-3 py-2 text-sm ${
              message.direction === 'inbound' ? 'bg-gray-100 text-gray-800' : 'ml-auto bg-blue-100 text-gray-800'
            }`}
          >
            {message.content}
          </div>
        ))}
```

with:

```jsx
        {messages.map((message) => (
          <div
            key={message.id}
            className={`max-w-xs space-y-1 rounded px-3 py-2 text-sm ${
              message.direction === 'inbound' ? 'bg-gray-100 text-gray-800' : 'ml-auto bg-blue-100 text-gray-800'
            }`}
          >
            {message.content && <p>{message.content}</p>}
            <MessageAttachment message={message} />
          </div>
        ))}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/ConversationView.test.jsx`
Expected: PASS

- [ ] **Step 5: Run the full frontend suite**

Run: `cd frontend && npx vitest run`
Expected: PASS, all suites.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/ConversationView.jsx frontend/src/components/ConversationView.test.jsx
git commit -m "feat: render message attachments in ConversationView"
```

---

### Task 14: `MessageInput` gains a file-attach button

**Files:**
- Modify: `frontend/src/components/MessageInput.jsx`
- Modify: `frontend/src/components/ConversationView.test.jsx`

**Interfaces:**
- Produces: `MessageInput`'s `onSend` is now called as `onSend(content, file)` (file is `null` when none was picked) — matches `useConversationMessages.sendMessage(content, file)`'s signature from Task 11.

- [ ] **Step 1: Write the failing test**

Add this test to `frontend/src/components/ConversationView.test.jsx`, inside the existing `describe('ConversationView', ...)` block (after the tests added in Task 13 — this is the last test added to this file across the whole plan):

```js
  test('sending a message with an attached file calls sendMessage with both content and the file', async () => {
    const sendMessage = vi.fn().mockResolvedValue({});
    useConversationMessages.mockReturnValue({ messages: [], sendMessage });
    render(
      <ConversationView
        conversation={{ id: 'c1', status: 'assigned', assignedAgentId: 'agent-1' }}
        onTransferClick={vi.fn()}
      />
    );
    const fakeFile = new File(['bytes'], 'foto.jpg', { type: 'image/jpeg' });
    const fileInput = document.querySelector('input[type="file"]');

    await userEvent.upload(fileInput, fakeFile);
    await userEvent.type(screen.getByPlaceholderText(/digite uma mensagem/i), 'Segue a foto');
    await userEvent.click(screen.getByRole('button', { name: /enviar/i }));

    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith('Segue a foto', fakeFile));
  });
```

Add `waitFor` to the existing `import { render, screen } from '@testing-library/react';` line at the top of the file if it isn't already imported (change to `import { render, screen, waitFor } from '@testing-library/react';`).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/ConversationView.test.jsx`
Expected: FAIL — `MessageInput` has no file input yet, and calls `onSend(content)` with a single argument.

- [ ] **Step 3: Update `frontend/src/components/MessageInput.jsx`**

Replace the entire file with:

```jsx
import { useState, useRef } from 'react';

function MessageInput({ onSend }) {
  const [content, setContent] = useState('');
  const [file, setFile] = useState(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);

  async function handleSubmit(event) {
    event.preventDefault();
    if (!content.trim() && !file) return;
    setSending(true);
    setError(null);
    try {
      await onSend(content, file);
      setContent('');
      setFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao enviar mensagem');
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="border-t border-gray-200 p-3">
      <div className="flex items-center gap-2">
        <input
          type="file"
          ref={fileInputRef}
          onChange={(e) => setFile(e.target.files[0] || null)}
          className="hidden"
          id="message-file-input"
        />
        <label
          htmlFor="message-file-input"
          className="cursor-pointer rounded border border-gray-300 px-3 py-2"
          title="Anexar arquivo"
        >
          📎
        </label>
        <input
          type="text"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Digite uma mensagem..."
          className="flex-1 rounded border border-gray-300 px-3 py-2"
        />
        <button type="submit" disabled={sending} className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50">
          Enviar
        </button>
      </div>
      {file && <p className="mt-1 text-sm text-gray-600">Anexo: {file.name}</p>}
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </form>
  );
}

export default MessageInput;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/ConversationView.test.jsx`
Expected: PASS

- [ ] **Step 5: Run the full frontend suite**

Run: `cd frontend && npx vitest run`
Expected: PASS, all suites.

- [ ] **Step 6: Run the full backend suite once more, from the repository root**

Run: `npm test` (from the repository root, not `frontend/`)
Expected: PASS — final sanity check that nothing regressed across the whole plan.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/MessageInput.jsx frontend/src/components/ConversationView.test.jsx
git commit -m "feat: add file-attach button to MessageInput"
```

---

## Self-Review

**Spec coverage:**
- "Modelo de dados" (new columns, `content` nullable) → Task 1.
- "Módulo de armazenamento de mídia" → Task 2.
- "Rota de servir mídia" (query-string token exception) → Task 3.
- "Recebimento (inbound)" on Meta Cloud → Task 5. On Baileys → Task 7.
- "Envio (outbound)" on Meta Cloud → Task 6. On Baileys → Task 8. Dispatch by type in the worker → Task 9. Upload endpoint → Task 10.
- "Frontend" per-type rendering → Tasks 12-13. Upload UI → Task 14. API client support → Task 11.
- Global Constraints (`MEDIA_STORAGE_DIR` required, `content` nullable, one file per message, size limits, the second query-string-token route, ES modules, no text-flow regression) are each implemented in a specific task and exercised by that task's tests — the file-size limit specifically has a dedicated rejection test in Task 10.

**Placeholder scan:** No "TBD"/"TODO"/"add appropriate error handling" — every step has complete, runnable code, and every test has real assertions matching the implementation that follows it.

**Type consistency:** `sendMediaMessage(channel, toPhoneNumber, {messageType, mediaPath, mediaMimeType, mediaFilename, caption}) -> Promise<{whatsappMessageId}>` has the identical signature on both adapters (Tasks 6 and 8), matching `sendTextMessage`'s existing contract shape. The `Message` shape (`messageType`, `mediaPath`, `mediaMimeType`, `mediaFilename`, `locationLatitude`, `locationLongitude`) is introduced in Task 1 and used identically by `ingestInboundMessage` (Task 4), both adapters' inbound handlers (Tasks 5, 7), the outbound queue/worker (Task 9), the upload route (Task 10), and the frontend's `MessageAttachment`/`ConversationView` (Tasks 12-13). `MessageInput`'s `onSend(content, file)` (Task 14) matches `useConversationMessages.sendMessage(content, file)`'s signature from Task 11 exactly.
