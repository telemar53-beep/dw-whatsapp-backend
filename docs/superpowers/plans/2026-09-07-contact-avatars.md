# Foto de perfil do contato Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the customer's real WhatsApp profile photo (Baileys channels only) throughout the attendant UI, matching what Chat Mix already does today.

**Architecture:** Fetch the photo once, the moment a Baileys contact is first created, using the already-open `sock.profilePictureUrl`; download and cache the bytes to the same disk `media-storage.js` already uses for message attachments; serve it through a new authenticated route mirroring `GET /api/media/:messageId`; thread the cached path through the existing conversation-summary queries into two frontend components.

**Tech Stack:** Node.js/Express/PostgreSQL backend (Jest), React/Vite frontend (Vitest + Testing Library), `@whiskeysockets/baileys`, `axios`.

**Spec:** [docs/superpowers/specs/2026-09-07-contact-avatars-design.md](../specs/2026-09-07-contact-avatars-design.md)

## Global Constraints

- Only Baileys (unofficial) channels ever get a real photo. Meta Cloud's official API does not expose customer profile photos — no code in this plan touches `meta-cloud.adapter.js`/`meta-cloud.routes.js`.
- The photo is fetched **exactly once**, at the moment a contact is first created (`wasCreated`/`contactJustCreated` transition). A failed first attempt is never retried on a later message — this is a deliberate, approved scope choice, not a bug to fix later.
- Photo bytes are cached to disk by reusing the existing `MEDIA_STORAGE_DIR`-backed `saveMediaFile`/`getMediaFilePath` from `src/media/media-storage.js`. No new environment variable.
- WhatsApp always serves profile pictures from `profilePictureUrl` as JPEG — the stored file's extension is hardcoded to `.jpg`, no MIME sniffing needed.
- The avatar fetch is fire-and-forget from the live inbound-message path — it must never delay or fail message ingestion. Every failure (no photo available, network error) is caught and logged, never thrown.
- `ConversationHistoryModal.jsx` is explicitly out of scope — it shows no contact identity today, so adding only a photo there would be inconsistent with this plan's own pattern.
- New migration `contacts.avatar_path` needs the standard post-deploy manual step: `npm run migrate -- up` via the Render Shell.

---

### Task 1: `contacts.avatar_path` migration and contact repository changes

**Files:**
- Create: `migrations/1788760000000_add-avatar-path-to-contacts.js`
- Modify: `src/conversations/contact.repository.js`
- Test: `src/conversations/contact.repository.test.js`

**Interfaces:**
- Produces: `findOrCreateContactByPhoneNumber(phoneNumber, displayName)` now resolves to `{ id, phoneNumber, displayName, avatarPath, createdAt, wasCreated }` — `wasCreated: true` only on the branch that inserts a brand-new row.
- Produces: `setContactAvatarPath(contactId, avatarPath)` → `Promise<void>`.
- Produces: `findContactById(id)` → `Promise<{ id, phoneNumber, displayName, avatarPath, createdAt } | null>`.
- Produces: `listContactsMissingAvatarForBaileysBackfill()` → `Promise<Array<{ contactId, phoneNumber, channelId }>>` — one row per contact with `avatar_path IS NULL` that has at least one conversation on a `baileys`-type channel, `channelId` being that contact's most-recently-updated Baileys conversation's channel.

- [ ] **Step 1: Write the failing migration and repository tests**

Create `migrations/1788760000000_add-avatar-path-to-contacts.js`:

```js
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE contacts ADD COLUMN avatar_path TEXT;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE contacts DROP COLUMN avatar_path;
  `);
};
```

Replace the full contents of `src/conversations/contact.repository.test.js` with:

```js
const { getPool, closePool } = require('../db/pool');
const { createChannel } = require('../channels/channel.repository');
const { createConversation } = require('./conversation.repository');
const {
  findOrCreateContactByPhoneNumber,
  setContactAvatarPath,
  findContactById,
  listContactsMissingAvatarForBaileysBackfill,
} = require('./contact.repository');

describe('contact repository', () => {
  beforeEach(async () => {
    await getPool().query('TRUNCATE contacts CASCADE');
  });

  afterAll(async () => {
    await closePool();
  });

  test('creates a new contact when phone number is not known', async () => {
    const contact = await findOrCreateContactByPhoneNumber('+5511988887777', 'Maria');
    expect(contact.id).toBeDefined();
    expect(contact.phoneNumber).toBe('+5511988887777');
    expect(contact.displayName).toBe('Maria');
    expect(contact.avatarPath).toBeNull();
  });

  test('returns the existing contact on a second call with the same phone number', async () => {
    const first = await findOrCreateContactByPhoneNumber('+5511988887777', 'Maria');
    const second = await findOrCreateContactByPhoneNumber('+5511988887777', 'Maria');
    expect(second.id).toBe(first.id);
  });

  test('resolves to the same contact when called concurrently for a new phone number', async () => {
    const [first, second] = await Promise.all([
      findOrCreateContactByPhoneNumber('+5511955554444', 'Concurrent Contact'),
      findOrCreateContactByPhoneNumber('+5511955554444', 'Concurrent Contact'),
    ]);
    expect(first.id).toBe(second.id);

    const result = await getPool().query('SELECT count(*) FROM contacts WHERE phone_number = $1', ['+5511955554444']);
    expect(Number(result.rows[0].count)).toBe(1);
  });

  test('marks wasCreated true when a brand-new contact is inserted', async () => {
    const contact = await findOrCreateContactByPhoneNumber('+5511988887777', 'Maria');
    expect(contact.wasCreated).toBe(true);
  });

  test('marks wasCreated false when reusing an existing contact', async () => {
    await findOrCreateContactByPhoneNumber('+5511988887777', 'Maria');
    const second = await findOrCreateContactByPhoneNumber('+5511988887777', 'Maria');
    expect(second.wasCreated).toBe(false);
  });

  test('setContactAvatarPath stores the path, reflected by a later findContactById', async () => {
    const contact = await findOrCreateContactByPhoneNumber('+5511988887777', 'Maria');
    await setContactAvatarPath(contact.id, 'abc123.jpg');
    const found = await findContactById(contact.id);
    expect(found.avatarPath).toBe('abc123.jpg');
  });

  test('findContactById returns null for an unknown id', async () => {
    const found = await findContactById('00000000-0000-0000-0000-000000000000');
    expect(found).toBeNull();
  });

  describe('listContactsMissingAvatarForBaileysBackfill', () => {
    test('returns a contact with no avatar that has a Baileys conversation', async () => {
      const contact = await findOrCreateContactByPhoneNumber('+5511977776666', 'Joao');
      const channel = await createChannel({ type: 'baileys', name: 'Baileys Teste', phoneNumber: '+5511999990000', config: {} });
      await createConversation(contact.id, channel.id);

      const results = await listContactsMissingAvatarForBaileysBackfill();

      expect(results).toEqual([{ contactId: contact.id, phoneNumber: '+5511977776666', channelId: channel.id }]);
    });

    test('excludes a contact that already has an avatar', async () => {
      const contact = await findOrCreateContactByPhoneNumber('+5511977776667', 'Joao Dois');
      const channel = await createChannel({ type: 'baileys', name: 'Baileys Teste 2', phoneNumber: '+5511999990001', config: {} });
      await createConversation(contact.id, channel.id);
      await setContactAvatarPath(contact.id, 'existing.jpg');

      const results = await listContactsMissingAvatarForBaileysBackfill();

      expect(results).toEqual([]);
    });

    test('excludes a contact whose only conversation is on a Meta Cloud channel', async () => {
      const contact = await findOrCreateContactByPhoneNumber('+5511977776668', 'Joao Tres');
      const channel = await createChannel({
        type: 'meta_cloud',
        name: 'Meta Teste',
        phoneNumber: '+5511999990002',
        config: { phoneNumberId: '1', accessToken: 'x' },
      });
      await createConversation(contact.id, channel.id);

      const results = await listContactsMissingAvatarForBaileysBackfill();

      expect(results).toEqual([]);
    });

    test('picks the most recently updated Baileys channel when a contact has conversations on more than one', async () => {
      const contact = await findOrCreateContactByPhoneNumber('+5511977776669', 'Joao Quatro');
      const olderChannel = await createChannel({ type: 'baileys', name: 'Canal Antigo', phoneNumber: '+5511999990003', config: {} });
      const newerChannel = await createChannel({ type: 'baileys', name: 'Canal Novo', phoneNumber: '+5511999990004', config: {} });
      await createConversation(contact.id, olderChannel.id);
      await new Promise((resolve) => setTimeout(resolve, 10));
      await createConversation(contact.id, newerChannel.id);

      const results = await listContactsMissingAvatarForBaileysBackfill();

      expect(results).toEqual([{ contactId: contact.id, phoneNumber: '+5511977776669', channelId: newerChannel.id }]);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/conversations/contact.repository.test.js`
Expected: FAIL — `setContactAvatarPath`, `findContactById`, `listContactsMissingAvatarForBaileysBackfill` are undefined, and `wasCreated`/`avatarPath` are missing from the plain result.

- [ ] **Step 3: Apply the migration to the test database**

Run: `npm run migrate:test -- up`
Expected: reports the new migration applied.

- [ ] **Step 4: Replace the contents of `src/conversations/contact.repository.js`**

```js
const { getPool } = require('../db/pool');

function toContact(row) {
  return {
    id: row.id,
    phoneNumber: row.phone_number,
    displayName: row.display_name,
    avatarPath: row.avatar_path,
    createdAt: row.created_at,
  };
}

async function findOrCreateContactByPhoneNumber(phoneNumber, displayName) {
  const existing = await getPool().query(
    'SELECT id, phone_number, display_name, avatar_path, created_at FROM contacts WHERE phone_number = $1',
    [phoneNumber]
  );
  if (existing.rowCount > 0) {
    return { ...toContact(existing.rows[0]), wasCreated: false };
  }
  const inserted = await getPool().query(
    `INSERT INTO contacts (phone_number, display_name) VALUES ($1, $2)
     ON CONFLICT (phone_number) DO UPDATE SET phone_number = EXCLUDED.phone_number
     RETURNING id, phone_number, display_name, avatar_path, created_at`,
    [phoneNumber, displayName || null]
  );
  return { ...toContact(inserted.rows[0]), wasCreated: true };
}

async function setContactAvatarPath(contactId, avatarPath) {
  await getPool().query('UPDATE contacts SET avatar_path = $2 WHERE id = $1', [contactId, avatarPath]);
}

async function findContactById(id) {
  const result = await getPool().query(
    'SELECT id, phone_number, display_name, avatar_path, created_at FROM contacts WHERE id = $1',
    [id]
  );
  if (result.rowCount === 0) return null;
  return toContact(result.rows[0]);
}

async function listContactsMissingAvatarForBaileysBackfill() {
  const result = await getPool().query(`
    SELECT DISTINCT ON (ct.id) ct.id AS contact_id, ct.phone_number, c.channel_id
    FROM contacts ct
    JOIN conversations c ON c.contact_id = ct.id
    JOIN channels ch ON ch.id = c.channel_id AND ch.type = 'baileys'
    WHERE ct.avatar_path IS NULL
    ORDER BY ct.id, c.updated_at DESC
  `);
  return result.rows.map((row) => ({
    contactId: row.contact_id,
    phoneNumber: row.phone_number,
    channelId: row.channel_id,
  }));
}

module.exports = {
  findOrCreateContactByPhoneNumber,
  setContactAvatarPath,
  findContactById,
  listContactsMissingAvatarForBaileysBackfill,
};
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- src/conversations/contact.repository.test.js`
Expected: PASS (all tests, including the 4 new `listContactsMissingAvatarForBaileysBackfill` ones).

- [ ] **Step 6: Commit**

```bash
git add migrations/1788760000000_add-avatar-path-to-contacts.js src/conversations/contact.repository.js src/conversations/contact.repository.test.js
git commit -m "feat: add contacts.avatar_path and avatar-related repository functions"
```

---

### Task 2: Propagate `contactJustCreated` through `ingestInboundMessage`

**Files:**
- Modify: `src/conversations/inbound-message.service.js`
- Test: `src/conversations/inbound-message.service.test.js`

**Interfaces:**
- Consumes: `findOrCreateContactByPhoneNumber` now resolves `{ ...contact, wasCreated }` (Task 1).
- Produces: `ingestInboundMessage(...)` now resolves `{ contact, conversation, message, contactJustCreated }` — `contact` itself is unchanged (no `wasCreated` leaks into it), `contactJustCreated` is a plain boolean.

- [ ] **Step 1: Update the two whole-result assertions and add two new tests**

In `src/conversations/inbound-message.service.test.js`:

1. In the test `'reuses an existing open conversation and broadcasts queue:new when unassigned'`, change:

```js
    expect(result).toEqual({
      contact: { id: 'contact-1', phoneNumber: '+5511999998888', displayName: 'Cliente' },
      conversation: { id: 'conv-1', assignedAgentId: null },
      message: { id: 'msg-1' },
    });
```

to:

```js
    expect(result).toEqual({
      contact: { id: 'contact-1', phoneNumber: '+5511999998888', displayName: 'Cliente' },
      conversation: { id: 'conv-1', assignedAgentId: null },
      message: { id: 'msg-1' },
      contactJustCreated: false,
    });
```

2. In the test `'returns a null message and emits nothing when createMessage fails with a unique violation (already-processed webhook redelivery)'`, change:

```js
    expect(result).toEqual({
      contact: { id: 'contact-5' },
      conversation: { id: 'conv-5', assignedAgentId: null },
      message: null,
    });
```

to:

```js
    expect(result).toEqual({
      contact: { id: 'contact-5' },
      conversation: { id: 'conv-5', assignedAgentId: null },
      message: null,
      contactJustCreated: false,
    });
```

3. Add two new tests at the end of the `describe('ingestInboundMessage', ...)` block, right before the closing `});`:

```js
  test('reports contactJustCreated as true when the contact repository reports a new contact', async () => {
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-13', wasCreated: true });
    findOpenConversation.mockResolvedValue({ id: 'conv-13', assignedAgentId: null });
    createMessage.mockResolvedValue({ id: 'msg-13' });
    getConversationWithContact.mockResolvedValue({ id: 'conv-13', assignedAgentId: null });

    const result = await ingestInboundMessage({
      channelId: 'channel-1',
      fromPhoneNumber: '+5511999990010',
      contactDisplayName: 'Cliente Novo',
      whatsappMessageId: 'wamid.NEW1',
      content: 'Oi',
    });

    expect(result.contactJustCreated).toBe(true);
    expect(result.contact).toEqual({ id: 'contact-13' });
  });

  test('reports contactJustCreated as false when reusing an existing contact', async () => {
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-14', wasCreated: false });
    findOpenConversation.mockResolvedValue({ id: 'conv-14', assignedAgentId: null });
    createMessage.mockResolvedValue({ id: 'msg-14' });
    getConversationWithContact.mockResolvedValue({ id: 'conv-14', assignedAgentId: null });

    const result = await ingestInboundMessage({
      channelId: 'channel-1',
      fromPhoneNumber: '+5511999990011',
      contactDisplayName: 'Cliente Existente',
      whatsappMessageId: 'wamid.NEW2',
      content: 'Oi',
    });

    expect(result.contactJustCreated).toBe(false);
  });
```

- [ ] **Step 2: Run tests to verify the new/changed ones fail**

Run: `npm test -- src/conversations/inbound-message.service.test.js`
Expected: FAIL — the two updated `toEqual` calls fail (missing `contactJustCreated` key on the actual value), and the two new tests fail (`result.contactJustCreated` is `undefined`).

- [ ] **Step 3: Replace the contents of `src/conversations/inbound-message.service.js`**

```js
const { findOrCreateContactByPhoneNumber } = require('./contact.repository');
const { findOpenConversation, createConversation, getConversationWithContact } = require('./conversation.repository');
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
  const { wasCreated, ...contact } = await findOrCreateContactByPhoneNumber(fromPhoneNumber, contactDisplayName);
  const contactJustCreated = Boolean(wasCreated);
  let conversation = await findOpenConversation(contact.id, channelId);
  let justCreated = false;
  if (!conversation) {
    const startTriage = await shouldStartTriage(channelId);
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
  if (justCreated && conversation.triageState === 'pending') {
    await sendTriageQuestion(conversation.id, channelId);
  } else if (!justCreated && conversation.triageState === 'pending') {
    conversation = await processTriageReply(conversation, channelId, content);
  }
  const conversationWithContact = await getConversationWithContact(conversation.id);
  if (conversationWithContact.assignedAgentId) {
    emitToAgent(conversationWithContact.assignedAgentId, 'message:new', { conversation: conversationWithContact, message });
  } else {
    broadcast('queue:new', { conversation: conversationWithContact, message });
  }
  return { contact, conversation, message, contactJustCreated };
}

module.exports = { ingestInboundMessage };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/conversations/inbound-message.service.test.js`
Expected: PASS (all tests, including the 2 new ones).

- [ ] **Step 5: Commit**

```bash
git add src/conversations/inbound-message.service.js src/conversations/inbound-message.service.test.js
git commit -m "feat: propagate contactJustCreated from ingestInboundMessage"
```

---

### Task 3: Fetch and store the Baileys profile photo on new-contact ingestion

**Files:**
- Modify: `src/whatsapp-adapters/baileys.manager.js`
- Test: `src/whatsapp-adapters/baileys.manager.test.js`

**Interfaces:**
- Consumes: `ingestInboundMessage(...)` now resolves `{ contact, contactJustCreated, ... }` (Task 2); `setContactAvatarPath(contactId, avatarPath)` (Task 1); `saveMediaFile(buffer, extension)` (existing).
- Produces: exported `fetchContactAvatarForChannel(channel, contactId, phoneNumber)` → `Promise<void>` — throws `No active Baileys connection for channel <id>` when the channel has no live socket (mirrors `resolveWhatsAppJid`); otherwise never rejects. Used by Task 6's backfill script.

- [ ] **Step 1: Add avatar-fetch mocks and write the failing tests**

In `src/whatsapp-adapters/baileys.manager.test.js`:

1. Add `jest.mock('axios');` right after the existing `jest.mock('fs', ...)` block (before the `require`s).

2. Add `const axios = require('axios');` and `const { setContactAvatarPath } = require('../conversations/contact.repository');` to the `require` block near the top (alongside the existing `manager`/`ingestInboundMessage` requires). Note `contact.repository` is not yet mocked anywhere in this file — add `jest.mock('../conversations/contact.repository');` next to the other `jest.mock(...)` calls at the top.

3. In `createMockSock()`, add `profilePictureUrl: jest.fn(),` next to the existing `onWhatsApp: jest.fn(),` line, so every mock socket in this file has it available.

4. In the top-level `beforeEach`, right after `baileysLib.useMultiFileAuthState.mockResolvedValue(...)`, add a default so every existing test (which never configures `ingestInboundMessage`'s return value) keeps working unchanged:

```js
    ingestInboundMessage.mockResolvedValue({ contact: { id: 'contact-default' }, contactJustCreated: false });
```

5. Add a new `describe` block, after the existing `describe('messages.upsert handling', ...)` block and before `describe('sendTextMessage', ...)`:

```js
  describe('contact avatar fetching', () => {
    let sock;

    beforeEach(async () => {
      sock = createMockSock();
      baileysLib.default.mockReturnValue(sock);
      await manager.startBaileysConnection({ id: 'channel-avatar', type: 'baileys' });
    });

    async function flushAvatarFetch() {
      // The avatar fetch is fire-and-forget (never awaited by handleMessagesUpsert),
      // so its own promise chain (profilePictureUrl -> axios.get -> saveMediaFile ->
      // setContactAvatarPath) needs a macrotask tick to fully settle before assertions.
      await new Promise((resolve) => setImmediate(resolve));
    }

    test('fetches and stores the avatar when the inbound message created a brand-new contact', async () => {
      ingestInboundMessage.mockResolvedValue({ contact: { id: 'contact-new-1' }, contactJustCreated: true });
      sock.profilePictureUrl.mockResolvedValue('https://pps.whatsapp.net/fake-avatar.jpg');
      axios.get.mockResolvedValue({ data: Buffer.from('fake-avatar-bytes') });
      const { saveMediaFile } = require('../media/media-storage');
      saveMediaFile.mockResolvedValue('generated-avatar.jpg');

      await sock.handlers['messages.upsert']({
        type: 'notify',
        messages: [
          {
            key: { remoteJid: '5511999998888@s.whatsapp.net', fromMe: false, id: 'AVATAR_MSG_1' },
            pushName: 'Cliente Novo',
            message: { conversation: 'Primeira mensagem' },
          },
        ],
      });
      await flushAvatarFetch();

      expect(sock.profilePictureUrl).toHaveBeenCalledWith('5511999998888@s.whatsapp.net', 'image');
      expect(axios.get).toHaveBeenCalledWith('https://pps.whatsapp.net/fake-avatar.jpg', { responseType: 'arraybuffer' });
      expect(saveMediaFile).toHaveBeenCalledWith(Buffer.from('fake-avatar-bytes'), '.jpg');
      expect(setContactAvatarPath).toHaveBeenCalledWith('contact-new-1', 'generated-avatar.jpg');
    });

    test('does not fetch an avatar when the contact already existed', async () => {
      ingestInboundMessage.mockResolvedValue({ contact: { id: 'contact-existing-1' }, contactJustCreated: false });

      await sock.handlers['messages.upsert']({
        type: 'notify',
        messages: [
          {
            key: { remoteJid: '5511999997777@s.whatsapp.net', fromMe: false, id: 'AVATAR_MSG_2' },
            pushName: 'Cliente Existente',
            message: { conversation: 'Mensagem de novo' },
          },
        ],
      });
      await flushAvatarFetch();

      expect(sock.profilePictureUrl).not.toHaveBeenCalled();
    });

    test('does not throw and never stores an avatar when the photo is unavailable', async () => {
      ingestInboundMessage.mockResolvedValue({ contact: { id: 'contact-new-2' }, contactJustCreated: true });
      sock.profilePictureUrl.mockRejectedValue(new Error('not-authorized'));

      await expect(
        sock.handlers['messages.upsert']({
          type: 'notify',
          messages: [
            {
              key: { remoteJid: '5511999996666@s.whatsapp.net', fromMe: false, id: 'AVATAR_MSG_3' },
              pushName: 'Cliente Privado',
              message: { conversation: 'Oi' },
            },
          ],
        })
      ).resolves.not.toThrow();
      await flushAvatarFetch();

      expect(setContactAvatarPath).not.toHaveBeenCalled();
    });
  });
```

6. Add a new `describe('fetchContactAvatarForChannel', ...)` block after the `describe('resolveWhatsAppJid', ...)` block:

```js
  describe('fetchContactAvatarForChannel', () => {
    test('fetches through the active connection for the channel', async () => {
      const sock = createMockSock();
      sock.profilePictureUrl.mockResolvedValue('https://pps.whatsapp.net/fake-avatar-2.jpg');
      axios.get.mockResolvedValue({ data: Buffer.from('fake-avatar-bytes-2') });
      const { saveMediaFile } = require('../media/media-storage');
      saveMediaFile.mockResolvedValue('generated-avatar-2.jpg');
      baileysLib.default.mockReturnValue(sock);
      const channel = { id: 'channel-backfill-1', type: 'baileys' };
      await manager.startBaileysConnection(channel);

      await manager.fetchContactAvatarForChannel(channel, 'contact-backfill-1', '5511999995555');

      expect(sock.profilePictureUrl).toHaveBeenCalledWith('5511999995555@s.whatsapp.net', 'image');
      expect(setContactAvatarPath).toHaveBeenCalledWith('contact-backfill-1', 'generated-avatar-2.jpg');
    });

    test('throws when there is no active connection for the channel', async () => {
      await expect(
        manager.fetchContactAvatarForChannel({ id: 'channel-does-not-exist' }, 'contact-x', '5511999992222')
      ).rejects.toThrow('No active Baileys connection for channel channel-does-not-exist');
    });
  });
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npm test -- src/whatsapp-adapters/baileys.manager.test.js`
Expected: FAIL — `manager.fetchContactAvatarForChannel` is undefined, and `sock.profilePictureUrl` is never called.

- [ ] **Step 3: Modify `src/whatsapp-adapters/baileys.manager.js`**

Add near the top, alongside the other `require`s:

```js
const axios = require('axios');
const { setContactAvatarPath } = require('../conversations/contact.repository');
```

Add two new functions right after `resolveContactPhoneJid` and before `handleMessagesUpsert`:

```js
async function fetchAndStoreContactAvatar(sock, phoneJid, contactId) {
  try {
    const url = await sock.profilePictureUrl(phoneJid, 'image');
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    const avatarPath = await saveMediaFile(Buffer.from(response.data), '.jpg');
    await setContactAvatarPath(contactId, avatarPath);
  } catch (err) {
    console.log(`Could not fetch profile photo for contact ${contactId}: ${err.message}`);
  }
}

async function fetchContactAvatarForChannel(channel, contactId, phoneNumber) {
  const entry = connections.get(channel.id);
  if (!entry) {
    throw new Error(`No active Baileys connection for channel ${channel.id}`);
  }
  await fetchAndStoreContactAvatar(entry.sock, `${phoneNumber}@s.whatsapp.net`, contactId);
}
```

Replace `handleMessagesUpsert` with:

```js
async function handleMessagesUpsert(channel, { messages, type }) {
  if (type !== 'notify') return;
  const entry = connections.get(channel.id);
  for (const msg of messages) {
    if (msg.key.fromMe) continue;
    const phoneJid = resolveContactPhoneJid(msg.key);
    if (!phoneJid) continue;
    const fromPhoneNumber = jidToPhoneNumber(phoneJid);
    const contactDisplayName = msg.pushName ? msg.pushName.trim() : null;
    const innerMessage = unwrapMessage(msg.message);

    const location = extractLocation(innerMessage);
    if (location) {
      const result = await ingestInboundMessage({
        channelId: channel.id,
        fromPhoneNumber,
        contactDisplayName,
        whatsappMessageId: msg.key.id,
        messageType: 'location',
        locationLatitude: location.latitude,
        locationLongitude: location.longitude,
      });
      if (result.contactJustCreated && entry) {
        fetchAndStoreContactAvatar(entry.sock, phoneJid, result.contact.id);
      }
      continue;
    }

    const mediaInfo = extractMediaInfo(innerMessage);
    if (mediaInfo) {
      const { downloadMediaMessage } = loadBaileysLib();
      const buffer = await downloadMediaMessage(msg, 'buffer', {});
      const mediaPath = await saveMediaFile(buffer, extensionForMimeType(mediaInfo.mimeType));
      const result = await ingestInboundMessage({
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
      if (result.contactJustCreated && entry) {
        fetchAndStoreContactAvatar(entry.sock, phoneJid, result.contact.id);
      }
      continue;
    }

    const content = extractTextContent(innerMessage);
    if (!content) {
      console.log(
        `Unrecognized Baileys message type for channel ${channel.id}, keys: ${
          innerMessage ? Object.keys(innerMessage).join(', ') : '(no message)'
        }`
      );
      continue;
    }
    const result = await ingestInboundMessage({
      channelId: channel.id,
      fromPhoneNumber,
      contactDisplayName,
      whatsappMessageId: msg.key.id,
      messageType: 'text',
      content,
    });
    if (result.contactJustCreated && entry) {
      fetchAndStoreContactAvatar(entry.sock, phoneJid, result.contact.id);
    }
  }
}
```

Add `fetchContactAvatarForChannel` to `module.exports`:

```js
module.exports = {
  startAllBaileysConnections,
  startBaileysConnection,
  addBaileysChannel,
  sendTextMessage,
  sendMediaMessage,
  resolveWhatsAppJid,
  getQrForChannel,
  fetchContactAvatarForChannel,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/whatsapp-adapters/baileys.manager.test.js`
Expected: PASS (all tests — the ~30 pre-existing ones unchanged in behavior, plus the 5 new ones).

- [ ] **Step 5: Commit**

```bash
git add src/whatsapp-adapters/baileys.manager.js src/whatsapp-adapters/baileys.manager.test.js
git commit -m "feat: fetch and cache the Baileys contact avatar on first message"
```

---

### Task 4: Surface `contactAvatarPath` on conversation summaries

**Files:**
- Modify: `src/conversations/conversation.repository.js`
- Test: `src/conversations/conversation.repository.test.js`

**Interfaces:**
- Consumes: `setContactAvatarPath(contactId, avatarPath)` (Task 1).
- Produces: `toConversationSummary(row)` output (used by `getConversationWithContact`, `listWaitingConversations`, `listConversationsByAgent`) now includes `contactAvatarPath: string | null`.

- [ ] **Step 1: Write the failing tests**

In `src/conversations/conversation.repository.test.js`, add `setContactAvatarPath` to the existing `require('./contact.repository')` line at the top (it currently only imports `findOrCreateContactByPhoneNumber`):

```js
const { findOrCreateContactByPhoneNumber, setContactAvatarPath } = require('./contact.repository');
```

Add these tests right after the existing `'getConversationWithContact includes the contact phone number and display name'` test:

```js
  test('getConversationWithContact includes the contact avatar path', async () => {
    await setContactAvatarPath(contactId, 'avatars/joao.jpg');
    const conversation = await createConversation(contactId, channelId);
    const result = await getConversationWithContact(conversation.id);
    expect(result.contactAvatarPath).toBe('avatars/joao.jpg');
  });

  test('getConversationWithContact has a null contactAvatarPath when the contact has no photo', async () => {
    const conversation = await createConversation(contactId, channelId);
    const result = await getConversationWithContact(conversation.id);
    expect(result.contactAvatarPath).toBeNull();
  });
```

Add this test right after the existing `'listWaitingConversations returns only waiting conversations with contact info, oldest first'` test:

```js
  test('listWaitingConversations includes the contact avatar path', async () => {
    await setContactAvatarPath(contactId, 'avatars/joao.jpg');
    await createConversation(contactId, channelId);

    const waiting = await listWaitingConversations();

    expect(waiting[0].contactAvatarPath).toBe('avatars/joao.jpg');
  });
```

Add this test right after the existing `'listConversationsByAgent returns only that agent non-closed conversations'` test:

```js
  test('listConversationsByAgent includes the contact avatar path', async () => {
    await setContactAvatarPath(contactId, 'avatars/joao.jpg');
    const conversation = await createConversation(contactId, channelId);
    const agent = await createAgent({ email: 'listagent4@dw.com', password: 'secret123', role: 'agent' });
    await claimConversation(conversation.id, agent.id);

    const mine = await listConversationsByAgent(agent.id);

    expect(mine[0].contactAvatarPath).toBe('avatars/joao.jpg');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/conversations/conversation.repository.test.js`
Expected: FAIL — `contactAvatarPath` is `undefined` on every result.

- [ ] **Step 3: Modify `src/conversations/conversation.repository.js`**

Change `toConversationSummary`:

```js
function toConversationSummary(row) {
  return {
    ...toConversation(row),
    contactPhoneNumber: row.contact_phone_number,
    contactDisplayName: row.contact_display_name,
    contactAvatarPath: row.contact_avatar_path,
    sectorName: row.sector_name,
  };
}
```

In `getConversationWithContact`, `listWaitingConversations`, and `listConversationsByAgent`, change the shared `SELECT` fragment from:

```sql
            ct.phone_number AS contact_phone_number, ct.display_name AS contact_display_name,
            s.name AS sector_name
```

to:

```sql
            ct.phone_number AS contact_phone_number, ct.display_name AS contact_display_name,
            ct.avatar_path AS contact_avatar_path,
            s.name AS sector_name
```

(all three functions have this exact two-line fragment — apply the same edit to each of the three query strings; `listClosedConversationsByContact` does not join `contacts` at all and is intentionally left unchanged).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/conversations/conversation.repository.test.js`
Expected: PASS (all tests, including the 4 new ones).

- [ ] **Step 5: Commit**

```bash
git add src/conversations/conversation.repository.js src/conversations/conversation.repository.test.js
git commit -m "feat: surface contactAvatarPath on conversation summary queries"
```

---

### Task 5: Authenticated avatar-serving route

**Files:**
- Create: `src/api/contacts.routes.js`
- Create: `src/api/contacts.routes.test.js`
- Modify: `src/server.js`

**Interfaces:**
- Consumes: `findContactById(id)` (Task 1); `getMediaFilePath(relativePath)` (existing, `src/media/media-storage.js`).
- Produces: `GET /api/contacts/:contactId/avatar` — 200 with the JPEG bytes and `Content-Type: image/jpeg` when the contact has an avatar; 404 when the contact does not exist or has none; 401 with no valid token (header `Authorization: Bearer <token>` or `?token=`).

- [ ] **Step 1: Write the failing test file**

Create `src/api/contacts.routes.test.js`:

```js
jest.mock('../conversations/contact.repository');
jest.mock('../media/media-storage');
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const { findContactById } = require('../conversations/contact.repository');
const { getMediaFilePath } = require('../media/media-storage');
const contactsRoutes = require('./contacts.routes');

function buildApp() {
  const app = express();
  app.use('/api/contacts', contactsRoutes);
  return app;
}

function tokenFor(agentId, role) {
  return jwt.sign({ agentId, role }, process.env.JWT_SECRET);
}

describe('GET /api/contacts/:contactId/avatar', () => {
  let tempFile;

  beforeEach(() => {
    jest.clearAllMocks();
    tempFile = path.join(os.tmpdir(), `dw-avatar-route-test-${Date.now()}.jpg`);
    fs.writeFileSync(tempFile, 'conteudo de imagem falso');
  });

  afterEach(() => {
    fs.rmSync(tempFile, { force: true });
  });

  test('serves the file when the contact has an avatar', async () => {
    findContactById.mockResolvedValue({ id: 'contact-1', avatarPath: 'whatever.jpg' });
    getMediaFilePath.mockReturnValue(tempFile);

    const res = await request(buildApp())
      .get('/api/contacts/contact-1/avatar')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);

    expect(res.status).toBe(200);
    expect(res.text).toBe('conteudo de imagem falso');
    expect(res.headers['content-type']).toBe('image/jpeg');
  });

  test('accepts the token via query string', async () => {
    findContactById.mockResolvedValue({ id: 'contact-1', avatarPath: 'whatever.jpg' });
    getMediaFilePath.mockReturnValue(tempFile);

    const res = await request(buildApp()).get(`/api/contacts/contact-1/avatar?token=${tokenFor('agent-1', 'agent')}`);

    expect(res.status).toBe(200);
  });

  test('returns 401 with no token in header or query string', async () => {
    const res = await request(buildApp()).get('/api/contacts/contact-1/avatar');
    expect(res.status).toBe(401);
    expect(findContactById).not.toHaveBeenCalled();
  });

  test('returns 404 when the contact does not exist', async () => {
    findContactById.mockResolvedValue(null);
    const res = await request(buildApp())
      .get('/api/contacts/does-not-exist/avatar')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(404);
  });

  test('returns 404 when the contact has no avatar', async () => {
    findContactById.mockResolvedValue({ id: 'contact-2', avatarPath: null });
    const res = await request(buildApp())
      .get('/api/contacts/contact-2/avatar')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/api/contacts.routes.test.js`
Expected: FAIL — `Cannot find module './contacts.routes'`.

- [ ] **Step 3: Create `src/api/contacts.routes.js`**

```js
const express = require('express');
const { verifyToken } = require('../auth/auth.service');
const { findContactById } = require('../conversations/contact.repository');
const { getMediaFilePath } = require('../media/media-storage');

const router = express.Router();

function authenticateContactRoute(req, res, next) {
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

router.get('/:contactId/avatar', authenticateContactRoute, async (req, res) => {
  const contact = await findContactById(req.params.contactId);
  if (!contact || !contact.avatarPath) {
    return res.status(404).json({ error: 'Avatar not found' });
  }
  res.type('image/jpeg');
  res.sendFile(getMediaFilePath(contact.avatarPath), (err) => {
    if (err && !res.headersSent) {
      res.status(404).json({ error: 'Avatar not found' });
    }
  });
});

module.exports = router;
```

- [ ] **Step 4: Mount the route in `src/server.js`**

Add the require alongside the other route requires:

```js
const contactsRoutes = require('./api/contacts.routes');
```

Add the mount alongside the other `app.use('/api/...')` lines, right after `app.use('/api/channels', channelsRoutes);`:

```js
app.use('/api/contacts', contactsRoutes);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- src/api/contacts.routes.test.js`
Expected: PASS (all 5 tests).

- [ ] **Step 6: Run the full backend suite to confirm no regressions**

Run: `npm test`
Expected: PASS (all test files).

- [ ] **Step 7: Commit**

```bash
git add src/api/contacts.routes.js src/api/contacts.routes.test.js src/server.js
git commit -m "feat: serve contact avatars through an authenticated route"
```

---

### Task 6: Backfill script for contacts created before this feature

**Files:**
- Create: `scripts/backfill-contact-avatars.js`

**Interfaces:**
- Consumes: `listContactsMissingAvatarForBaileysBackfill()` (Task 1), `findChannelById(id)` (existing, `src/channels/channel.repository.js`), `startAllBaileysConnections()` (existing), `fetchContactAvatarForChannel(channel, contactId, phoneNumber)` (Task 3), `closePool()` (existing, `src/db/pool.js`).

No automated test for this file — matches the existing precedent of `scripts/create-agent.js` and `scripts/create-channel.js`, neither of which has a test file. Verified by manual run against the local dev database in Step 2.

- [ ] **Step 1: Create `scripts/backfill-contact-avatars.js`**

```js
require('dotenv').config();
const { listContactsMissingAvatarForBaileysBackfill } = require('../src/conversations/contact.repository');
const { findChannelById } = require('../src/channels/channel.repository');
const { startAllBaileysConnections, fetchContactAvatarForChannel } = require('../src/whatsapp-adapters/baileys.manager');
const { closePool } = require('../src/db/pool');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log('Starting Baileys connections...');
  await startAllBaileysConnections();
  // Give already-authenticated sockets a moment to finish reconnecting before
  // hitting them with profilePictureUrl calls.
  await wait(10000);

  const contacts = await listContactsMissingAvatarForBaileysBackfill();
  console.log(`Found ${contacts.length} contact(s) missing an avatar.`);

  for (const { contactId, phoneNumber, channelId } of contacts) {
    const channel = await findChannelById(channelId);
    try {
      await fetchContactAvatarForChannel(channel, contactId, phoneNumber);
      console.log(`Fetched avatar for contact ${contactId}`);
    } catch (err) {
      console.log(`Skipped contact ${contactId}: ${err.message}`);
    }
    await wait(1000);
  }

  console.log('Backfill complete.');
}

main()
  .catch((err) => {
    console.error('Backfill failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => closePool());
```

- [ ] **Step 2: Manually verify against the local dev database**

Run: `node scripts/backfill-contact-avatars.js` (with `.env` pointing at `dw_whatsapp_dev`, same setup as any other manual script run in this project)
Expected: logs starting Baileys connections, then a count of contacts found, then one line per contact (fetched or skipped), then "Backfill complete." with exit code 0. Spot-check in the database that at least one previously-avatar-less contact tied to the "Berg" Baileys channel now has a non-null `avatar_path`, and that the file at that path exists under the local `MEDIA_STORAGE_DIR`.

- [ ] **Step 3: Commit**

```bash
git add scripts/backfill-contact-avatars.js
git commit -m "feat: add one-off script to backfill avatars for pre-existing contacts"
```

---

### Task 7: `ContactAvatar` frontend component

**Files:**
- Modify: `frontend/src/services/api.js`
- Create: `frontend/src/components/ContactAvatar.jsx`
- Create: `frontend/src/components/ContactAvatar.test.jsx`

**Interfaces:**
- Produces: `avatarUrl(contactId, token)` → `string`, exported from `services/api.js`, same shape as the existing `mediaUrl(messageId, token)`.
- Produces: `<ContactAvatar contactId avatarPath displayName phoneNumber />` — renders the real photo (`<img role="img">`) when `avatarPath` is truthy, otherwise a placeholder circle showing the first letter of `displayName`, or the first digit of `phoneNumber` if there is no `displayName`.

- [ ] **Step 1: Write the failing test file**

Create `frontend/src/components/ContactAvatar.test.jsx`:

```jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import ContactAvatar from './ContactAvatar';
import { useAuth } from '../contexts/AuthContext';

vi.mock('../contexts/AuthContext');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
});

describe('ContactAvatar', () => {
  test('renders the photo with the authenticated avatar URL when avatarPath is set', () => {
    render(<ContactAvatar contactId="c1" avatarPath="avatars/c1.jpg" displayName="Carlos" phoneNumber="+5511999990000" />);
    const img = screen.getByRole('img');
    expect(img.src).toBe('http://localhost:3000/api/contacts/c1/avatar?token=tok-123');
  });

  test('renders the first letter of the display name when there is no avatarPath', () => {
    render(<ContactAvatar contactId="c1" avatarPath={null} displayName="Carlos" phoneNumber="+5511999990000" />);
    expect(screen.getByText('C')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  test('falls back to the first digit of the phone number when there is no display name', () => {
    render(<ContactAvatar contactId="c1" avatarPath={null} displayName={null} phoneNumber="+5511999990000" />);
    expect(screen.getByText('5')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --run ContactAvatar.test.jsx` (from `frontend/`)
Expected: FAIL — `Cannot find module './ContactAvatar'`.

- [ ] **Step 3: Add `avatarUrl` to `frontend/src/services/api.js`**

Add right after the existing `mediaUrl` function:

```js
export function avatarUrl(contactId, token) {
  return `${API_BASE_URL}/api/contacts/${contactId}/avatar?token=${token}`;
}
```

- [ ] **Step 4: Create `frontend/src/components/ContactAvatar.jsx`**

```jsx
import { useAuth } from '../contexts/AuthContext';
import { avatarUrl } from '../services/api';

function initialFor(displayName, phoneNumber) {
  if (displayName) return displayName.trim().charAt(0).toUpperCase();
  if (phoneNumber) {
    const digitsOnly = phoneNumber.replace(/\D/g, '');
    if (digitsOnly) return digitsOnly.charAt(0);
  }
  return '?';
}

function ContactAvatar({ contactId, avatarPath, displayName, phoneNumber }) {
  const { token } = useAuth();

  if (avatarPath) {
    return (
      <img
        src={avatarUrl(contactId, token)}
        alt={displayName || phoneNumber || 'Contato'}
        className="h-8 w-8 shrink-0 rounded-full object-cover"
      />
    );
  }

  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-500 text-xs font-semibold text-white">
      {initialFor(displayName, phoneNumber)}
    </span>
  );
}

export default ContactAvatar;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- --run ContactAvatar.test.jsx` (from `frontend/`)
Expected: PASS (all 3 tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/services/api.js frontend/src/components/ContactAvatar.jsx frontend/src/components/ContactAvatar.test.jsx
git commit -m "feat: add ContactAvatar component with photo/placeholder fallback"
```

---

### Task 8: Wire `ContactAvatar` into the conversation list and the open-conversation header

**Files:**
- Modify: `frontend/src/components/ConversationListItem.jsx`
- Modify: `frontend/src/components/ConversationListItem.test.jsx`
- Modify: `frontend/src/components/ConversationView.jsx`
- Modify: `frontend/src/components/ConversationView.test.jsx`

**Interfaces:**
- Consumes: `<ContactAvatar contactId avatarPath displayName phoneNumber />` (Task 7); `conversation.contactId`/`contactAvatarPath`/`contactDisplayName`/`contactPhoneNumber` (already present on every conversation-summary object as of Task 4 for `contactAvatarPath`, and pre-existing for the rest).

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `frontend/src/components/ConversationListItem.test.jsx`:

```jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ConversationListItem from './ConversationListItem';
import { useAuth } from '../contexts/AuthContext';

vi.mock('../contexts/AuthContext');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
});

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

  test('shows the contact avatar photo when contactAvatarPath is set', () => {
    render(
      <ul>
        <ConversationListItem
          conversation={{
            id: 'c1',
            contactId: 'contact-1',
            contactDisplayName: 'Carlos',
            contactPhoneNumber: '+5511999990000',
            contactAvatarPath: 'avatars/c1.jpg',
          }}
          onSelect={vi.fn()}
        />
      </ul>
    );
    expect(screen.getByRole('img')).toBeInTheDocument();
  });

  test('shows a placeholder initial when there is no contactAvatarPath', () => {
    render(
      <ul>
        <ConversationListItem
          conversation={{
            id: 'c1',
            contactId: 'contact-1',
            contactDisplayName: 'Carlos',
            contactPhoneNumber: '+5511999990000',
            contactAvatarPath: null,
          }}
          onSelect={vi.fn()}
        />
      </ul>
    );
    expect(screen.getByText('C')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
```

In `frontend/src/components/ConversationView.test.jsx`, add these two tests at the end of the `describe('ConversationView', ...)` block, right before the closing `});`:

```jsx
  test('shows the contact name and avatar in the header', () => {
    render(
      <ConversationView
        conversation={{
          id: 'c1',
          contactId: 'contact-1',
          status: 'waiting',
          assignedAgentId: null,
          contactDisplayName: 'Carlos',
          contactPhoneNumber: '+5511999990000',
          contactAvatarPath: 'avatars/c1.jpg',
        }}
        onTransferClick={vi.fn()}
      />
    );
    expect(screen.getByText('Carlos')).toBeInTheDocument();
    expect(screen.getByRole('img')).toBeInTheDocument();
  });

  test('falls back to "Conversa" in the header when the contact has no name or phone number yet', () => {
    render(<ConversationView conversation={{ id: 'c1', status: 'waiting', assignedAgentId: null }} onTransferClick={vi.fn()} />);
    expect(screen.getByText('Conversa')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npm test -- --run ConversationListItem.test.jsx ConversationView.test.jsx` (from `frontend/`)
Expected: FAIL — `useAuth must be used within an AuthProvider` on the `ConversationListItem` tests (no `ContactAvatar` yet renders, but this confirms the mock is wired for when it does); the two new `ConversationView` tests fail (no avatar/header-fallback rendered yet).

- [ ] **Step 3: Modify `frontend/src/components/ConversationListItem.jsx`**

```jsx
import ContactAvatar from './ContactAvatar';

function ConversationListItem({ conversation, onSelect }) {
  return (
    <li>
      <button
        onClick={() => onSelect(conversation.id)}
        className="flex w-full items-center gap-2 rounded border border-gray-200 px-3 py-2 text-left hover:bg-gray-50"
      >
        <ContactAvatar
          contactId={conversation.contactId}
          avatarPath={conversation.contactAvatarPath}
          displayName={conversation.contactDisplayName}
          phoneNumber={conversation.contactPhoneNumber}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="font-medium text-gray-800">
              {conversation.contactDisplayName || conversation.contactPhoneNumber}
            </p>
            {conversation.sectorName && (
              <span className="shrink-0 rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-700">{conversation.sectorName}</span>
            )}
          </div>
          <p className="text-xs text-gray-500">{conversation.contactPhoneNumber}</p>
        </div>
      </button>
    </li>
  );
}

export default ConversationListItem;
```

- [ ] **Step 4: Modify `frontend/src/components/ConversationView.jsx`**

Add the import at the top, alongside the other component imports:

```jsx
import ContactAvatar from './ContactAvatar';
```

Replace:

```jsx
        <div className="flex items-center gap-2">
          <button onClick={onBack} className="rounded p-3 text-gray-500 md:hidden" aria-label="Voltar para a lista">
            ←
          </button>
          <h3 className="font-semibold text-gray-800">Conversa</h3>
        </div>
```

with:

```jsx
        <div className="flex items-center gap-2">
          <button onClick={onBack} className="rounded p-3 text-gray-500 md:hidden" aria-label="Voltar para a lista">
            ←
          </button>
          <ContactAvatar
            contactId={conversation.contactId}
            avatarPath={conversation.contactAvatarPath}
            displayName={conversation.contactDisplayName}
            phoneNumber={conversation.contactPhoneNumber}
          />
          <h3 className="font-semibold text-gray-800">
            {conversation.contactDisplayName || conversation.contactPhoneNumber || 'Conversa'}
          </h3>
        </div>
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- --run ConversationListItem.test.jsx ConversationView.test.jsx` (from `frontend/`)
Expected: PASS (all tests in both files).

- [ ] **Step 6: Run the full frontend suite to confirm no regressions**

Run: `npm test -- --run` (from `frontend/`)
Expected: PASS (all test files — baseline was 245/245 clean before this task).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/ConversationListItem.jsx frontend/src/components/ConversationListItem.test.jsx frontend/src/components/ConversationView.jsx frontend/src/components/ConversationView.test.jsx
git commit -m "feat: show contact avatar in the conversation list and open-conversation header"
```
