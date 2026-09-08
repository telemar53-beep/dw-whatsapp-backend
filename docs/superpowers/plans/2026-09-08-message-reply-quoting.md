# Responder/citar mensagem (reply/quote) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deixar o atendente selecionar uma mensagem existente numa conversa aberta e responder citando ela, como o WhatsApp real faz — tanto para Baileys quanto para Meta Cloud API.

**Architecture:** Uma coluna nova auto-referenciando `messages` guarda qual mensagem está sendo respondida; o backend valida, resolve os dados da mensagem original e repassa pela fila de envio já existente até os dois adaptadores, cada um montando a citação do jeito que sua própria API exige (Baileys precisa de um stub da mensagem original; Meta Cloud só precisa do ID). O frontend deixa selecionar uma mensagem (só as que têm texto), mostra uma prévia ao compor, e mostra a citação na mensagem enviada.

**Tech Stack:** Node.js/Express, Postgres (node-pg-migrate), Bull/Redis, React 18.

**Spec:** `docs/superpowers/specs/2026-09-08-message-reply-quoting-design.md`

## Global Constraints

- Só o atendente inicia uma citação pelo painel — o sistema NÃO interpreta citações que chegam do lado do cliente (fora de escopo).
- Só mensagens com `content` não-vazio podem ser citadas (texto normal, ou mídia com legenda). Mídia sem legenda nunca é citável.
- Aplica-se só a `sendTextMessage`/`sendMediaMessage` nos dois adaptadores — nunca a `sendTemplateMessage`.
- Abordagem de dados: referência (`replied_to_message_id`) + busca via JOIN ao carregar, nunca cópia do conteúdo.
- Se a mensagem original referenciada não for encontrada no momento real do envio (não deveria acontecer, mas defensivo), o envio segue sem citação em vez de falhar.
- Toda função de adaptador (`sendTextMessage`/`sendMediaMessage` em ambos os arquivos) deve continuar podendo ser chamada exatamente como hoje (sem os novos parâmetros) sem nenhuma mudança de comportamento — os testes existentes que fazem `toHaveBeenCalledWith` com o número de argumentos atual não podem quebrar.

---

### Task 1: Migração + camada de repositório (`message.repository.js`)

**Files:**
- Create: `migrations/1788820000000_add-replied-to-message-id-to-messages.js`
- Modify: `src/conversations/message.repository.js`
- Test: `src/conversations/message.repository.test.js`

**Interfaces:**
- Produces: `createMessage({..., repliedToMessageId})` (parâmetro novo, opcional); `toMessage(row)` ganha `repliedToMessageId`; nova função `toMessageWithReplyPreview(row)` (não exportada — só usada internamente por `listMessagesByConversation`); `listMessagesByConversation(conversationId)` continua com a mesma assinatura, mas cada mensagem retornada agora pode ter `repliedToPreview: {content, direction} | null`.

- [ ] **Step 1: Criar a migração**

```js
exports.up = (pgm) => {
  pgm.sql(`ALTER TABLE messages ADD COLUMN replied_to_message_id UUID REFERENCES messages(id) ON DELETE SET NULL;`);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE messages DROP COLUMN replied_to_message_id;`);
};
```

- [ ] **Step 2: Rodar a migração no banco de teste**

Run: `npm run migrate:test -- up`
Expected: a migração `1788820000000_add-replied-to-message-id-to-messages` aparece como aplicada, sem erro.

- [ ] **Step 3: Escrever os testes que falham**

Adicionar ao final de `src/conversations/message.repository.test.js`, dentro do `describe('message repository', ...)` já existente (antes do `describe('advanceMessageStatus', ...)` interno, no mesmo nível dos outros `test(...)`):

```js
  test('createMessage stores a reply reference when repliedToMessageId is provided', async () => {
    const original = await createMessage({
      conversationId,
      direction: 'inbound',
      content: 'Qual o valor da fatura?',
      whatsappMessageId: 'wamid.ORIG1',
      status: 'received',
    });
    const reply = await createMessage({
      conversationId,
      direction: 'outbound',
      content: 'R$150,00',
      whatsappMessageId: null,
      status: 'sent',
      repliedToMessageId: original.id,
    });
    expect(reply.repliedToMessageId).toBe(original.id);
  });

  test('createMessage leaves repliedToMessageId null when not provided', async () => {
    const message = await createMessage({
      conversationId,
      direction: 'inbound',
      content: 'Oi',
      whatsappMessageId: 'wamid.NOREPLY1',
      status: 'received',
    });
    expect(message.repliedToMessageId).toBeNull();
  });

  describe('listMessagesByConversation reply previews', () => {
    test('includes a repliedToPreview for a message that replies to another', async () => {
      const original = await createMessage({
        conversationId,
        direction: 'inbound',
        content: 'Qual o valor da fatura?',
        whatsappMessageId: 'wamid.ORIG2',
        status: 'received',
      });
      await createMessage({
        conversationId,
        direction: 'outbound',
        content: 'R$150,00',
        whatsappMessageId: null,
        status: 'sent',
        repliedToMessageId: original.id,
      });

      const messages = await listMessagesByConversation(conversationId);
      const replyMessage = messages.find((m) => m.content === 'R$150,00');

      expect(replyMessage.repliedToPreview).toEqual({
        content: 'Qual o valor da fatura?',
        direction: 'inbound',
      });
    });

    test('repliedToPreview is null for a message that does not reply to anything', async () => {
      await createMessage({
        conversationId,
        direction: 'inbound',
        content: 'Mensagem solta',
        whatsappMessageId: 'wamid.SOLTA1',
        status: 'received',
      });

      const messages = await listMessagesByConversation(conversationId);
      const message = messages.find((m) => m.content === 'Mensagem solta');

      expect(message.repliedToPreview).toBeNull();
    });
  });
```

- [ ] **Step 4: Rodar os testes pra confirmar que falham**

Run: `npx dotenv -e .env.test -o -- jest src/conversations/message.repository.test.js`
Expected: FAIL — `repliedToMessageId`/`repliedToPreview` são `undefined` (a coluna existe no banco desde o Step 2, mas o código do repositório ainda não lê/escreve nela).

- [ ] **Step 5: Implementar**

Substituir `src/conversations/message.repository.js` inteiro por:

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
    repliedToMessageId: row.replied_to_message_id,
    createdAt: row.created_at,
  };
}

function toMessageWithReplyPreview(row) {
  return {
    ...toMessage(row),
    repliedToPreview: row.replied_to_message_id
      ? { content: row.replied_to_content, direction: row.replied_to_direction }
      : null,
  };
}

const MESSAGE_COLUMNS = `id, conversation_id, direction, content, whatsapp_message_id, status,
       message_type, media_path, media_mime_type, media_filename,
       location_latitude, location_longitude, replied_to_message_id, created_at`;

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
  repliedToMessageId,
}) {
  const result = await getPool().query(
    `INSERT INTO messages (
       conversation_id, direction, content, whatsapp_message_id, status,
       message_type, media_path, media_mime_type, media_filename,
       location_latitude, location_longitude, replied_to_message_id
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
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
      repliedToMessageId || null,
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

const STATUS_RANK_SQL = `CASE status WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 WHEN 'failed' THEN 4 ELSE 0 END`;

async function advanceMessageStatus(whatsappMessageId, status) {
  const result = await getPool().query(
    `UPDATE messages SET status = $2
     WHERE whatsapp_message_id = $1
       AND ${STATUS_RANK_SQL} < (CASE $2 WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 WHEN 'failed' THEN 4 ELSE 0 END)
     RETURNING ${MESSAGE_COLUMNS}`,
    [whatsappMessageId, status]
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
    `SELECT m.id, m.conversation_id, m.direction, m.content, m.whatsapp_message_id, m.status,
            m.message_type, m.media_path, m.media_mime_type, m.media_filename,
            m.location_latitude, m.location_longitude, m.replied_to_message_id, m.created_at,
            rm.content AS replied_to_content, rm.direction AS replied_to_direction
     FROM messages m
     LEFT JOIN messages rm ON rm.id = m.replied_to_message_id
     WHERE m.conversation_id = $1
     ORDER BY m.created_at ASC`,
    [conversationId]
  );
  return result.rows.map(toMessageWithReplyPreview);
}

async function findMessageById(id) {
  const result = await getPool().query(`SELECT ${MESSAGE_COLUMNS} FROM messages WHERE id = $1`, [id]);
  if (result.rowCount === 0) return null;
  return toMessage(result.rows[0]);
}

module.exports = {
  createMessage,
  updateMessageStatus,
  advanceMessageStatus,
  recordMessageSent,
  listMessagesByConversation,
  findMessageById,
};
```

- [ ] **Step 6: Rodar os testes pra confirmar que passam**

Run: `npx dotenv -e .env.test -o -- jest src/conversations/message.repository.test.js`
Expected: PASS (todos os testes do arquivo, incluindo os 4 novos).

- [ ] **Step 7: Commit**

```bash
git add migrations/1788820000000_add-replied-to-message-id-to-messages.js src/conversations/message.repository.js src/conversations/message.repository.test.js
git commit -m "Add replied_to_message_id column and thread it through the message repository"
```

---

### Task 2: Validação na rota de envio (`conversations.routes.js`)

**Files:**
- Modify: `src/api/conversations.routes.js`
- Test: `src/api/conversations.routes.test.js`

**Interfaces:**
- Consumes: Task 1's `findMessageById` (já existia, agora retorna `repliedToMessageId`) — este arquivo precisa importá-lo pela primeira vez.
- Produces: `POST /api/conversations/:id/messages` aceita um campo opcional `repliedToMessageId` no corpo; quando presente e válido, é incluído no objeto passado para `enqueueOutboundMessage`.

- [ ] **Step 1: Escrever os testes que falham**

No arquivo `src/api/conversations.routes.test.js`, dentro do `describe('POST /api/conversations/:id/messages', ...)` já existente (linha ~195), adicionar `findMessageById` ao import de `../conversations/message.repository` (linha 28 hoje: `const { listMessagesByConversation } = require('../conversations/message.repository');` vira `const { listMessagesByConversation, findMessageById } = require('../conversations/message.repository');`), e adicionar estes testes ao final do describe block (antes do `});` que fecha em torno da linha 405):

```js
  test('accepts a repliedToMessageId and passes it to enqueueOutboundMessage', async () => {
    getConversationWithContact.mockResolvedValue({ id: 'conv-1', channelId: 'channel-1', assignedAgentId: 'agent-1' });
    findMessageById.mockResolvedValue({
      id: 'msg-original',
      conversationId: 'conv-1',
      content: 'Qual o valor?',
      whatsappMessageId: 'wamid.ORIG1',
    });
    enqueueOutboundMessage.mockResolvedValue({ id: 'msg-reply', status: 'sent' });

    const res = await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/messages`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ content: 'R$150,00', repliedToMessageId: 'msg-original' });

    expect(res.status).toBe(201);
    expect(findMessageById).toHaveBeenCalledWith('msg-original');
    expect(enqueueOutboundMessage).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      channelId: 'channel-1',
      content: 'R$150,00',
      repliedToMessageId: 'msg-original',
    });
  });

  test('returns 400 when repliedToMessageId does not exist', async () => {
    getConversationWithContact.mockResolvedValue({ id: 'conv-1', channelId: 'channel-1', assignedAgentId: 'agent-1' });
    findMessageById.mockResolvedValue(null);

    const res = await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/messages`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ content: 'R$150,00', repliedToMessageId: 'does-not-exist' });

    expect(res.status).toBe(400);
    expect(enqueueOutboundMessage).not.toHaveBeenCalled();
  });

  test('returns 400 when repliedToMessageId belongs to a different conversation', async () => {
    getConversationWithContact.mockResolvedValue({ id: 'conv-1', channelId: 'channel-1', assignedAgentId: 'agent-1' });
    findMessageById.mockResolvedValue({
      id: 'msg-original',
      conversationId: 'conv-OTHER',
      content: 'Qual o valor?',
      whatsappMessageId: 'wamid.ORIG1',
    });

    const res = await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/messages`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ content: 'R$150,00', repliedToMessageId: 'msg-original' });

    expect(res.status).toBe(400);
    expect(enqueueOutboundMessage).not.toHaveBeenCalled();
  });

  test('returns 400 when repliedToMessageId points to a message with no text content', async () => {
    getConversationWithContact.mockResolvedValue({ id: 'conv-1', channelId: 'channel-1', assignedAgentId: 'agent-1' });
    findMessageById.mockResolvedValue({
      id: 'msg-original',
      conversationId: 'conv-1',
      content: null,
      whatsappMessageId: 'wamid.ORIG1',
    });

    const res = await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/messages`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ content: 'R$150,00', repliedToMessageId: 'msg-original' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/text/i);
    expect(enqueueOutboundMessage).not.toHaveBeenCalled();
  });

  test('returns 400 when repliedToMessageId points to a message not yet delivered', async () => {
    getConversationWithContact.mockResolvedValue({ id: 'conv-1', channelId: 'channel-1', assignedAgentId: 'agent-1' });
    findMessageById.mockResolvedValue({
      id: 'msg-original',
      conversationId: 'conv-1',
      content: 'Ainda na fila',
      whatsappMessageId: null,
    });

    const res = await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/messages`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ content: 'R$150,00', repliedToMessageId: 'msg-original' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/delivered/i);
    expect(enqueueOutboundMessage).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Rodar os testes pra confirmar que falham**

Run: `npx dotenv -e .env.test -o -- jest src/api/conversations.routes.test.js -t "repliedToMessageId"`
Expected: FAIL — `findMessageById` nunca é chamado, `repliedToMessageId` nunca chega no `enqueueOutboundMessage`, nenhuma validação existe ainda.

- [ ] **Step 3: Implementar**

Em `src/api/conversations.routes.js`, trocar a linha de import (hoje: `const { listMessagesByConversation } = require('../conversations/message.repository');`):

```js
const { listMessagesByConversation, findMessageById } = require('../conversations/message.repository');
```

E substituir o handler `router.post('/:id/messages', ...)` inteiro (hoje começa com `const content = (req.body && req.body.content) || null;`) por:

```js
router.post('/:id/messages', upload.single('file'), async (req, res) => {
  const content = (req.body && req.body.content) || null;
  const file = req.file;
  const repliedToMessageId = (req.body && req.body.repliedToMessageId) || null;
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

  if (repliedToMessageId) {
    const repliedTo = await findMessageById(repliedToMessageId);
    if (!repliedTo || repliedTo.conversationId !== conversation.id) {
      return res.status(400).json({ error: 'repliedToMessageId does not belong to this conversation' });
    }
    if (!repliedTo.content) {
      return res.status(400).json({ error: 'Only messages with text can be replied to' });
    }
    if (!repliedTo.whatsappMessageId) {
      return res.status(400).json({ error: 'This message has not been delivered yet; wait before replying to it' });
    }
  }

  const messagePayload = {
    conversationId: conversation.id,
    channelId: conversation.channelId,
    content,
  };
  if (repliedToMessageId) {
    messagePayload.repliedToMessageId = repliedToMessageId;
  }

  if (file) {
    const messageType = messageTypeForMimeType(file.mimetype);
    const maxSize = MAX_SIZE_BY_MESSAGE_TYPE[messageType] || MAX_SIZE_BY_MESSAGE_TYPE.document;
    if (file.size > maxSize) {
      return res.status(400).json({ error: `File exceeds the ${Math.round(maxSize / (1024 * 1024))}MB limit for ${messageType}` });
    }
    if ((messageType === 'audio' || messageType === 'sticker') && content) {
      return res.status(400).json({ error: 'Audio and sticker messages cannot include a caption; send the text as a separate message' });
    }
    messagePayload.messageType = messageType;
    messagePayload.mediaPath = await saveMediaFile(file.buffer, extensionForMimeType(file.mimetype));
    messagePayload.mediaMimeType = file.mimetype;
    messagePayload.mediaFilename = file.originalname;
  }

  const message = await enqueueOutboundMessage(messagePayload);
  res.status(201).json(message);
});
```

**Atenção:** o campo `repliedToMessageId` só é incluído no `messagePayload` quando realmente presente (`if (repliedToMessageId) { messagePayload.repliedToMessageId = ... }`), nunca como uma chave extra com valor `null`/`undefined` sempre presente — isso é o que mantém os testes já existentes (que fazem `toHaveBeenCalledWith({conversationId, channelId, content})`, sem essa chave) passando sem nenhuma mudança.

- [ ] **Step 4: Rodar os testes pra confirmar que passam**

Run: `npx dotenv -e .env.test -o -- jest src/api/conversations.routes.test.js`
Expected: PASS (todos os testes do arquivo, incluindo os 5 novos e todos os já existentes sem modificação).

- [ ] **Step 5: Commit**

```bash
git add src/api/conversations.routes.js src/api/conversations.routes.test.js
git commit -m "Validate and forward repliedToMessageId on POST /:id/messages"
```

---

### Task 3: Fila de envio (`outbound-queue.js`)

**Files:**
- Modify: `src/queue/outbound-queue.js`
- Test: `src/queue/outbound-queue.test.js`

**Interfaces:**
- Consumes: Task 1's `createMessage({..., repliedToMessageId})`.
- Produces: `enqueueOutboundMessage({..., repliedToMessageId})` — o job do Bull passa a carregar `repliedToMessageId` (`null` quando ausente, mesmo padrão de `templateName`/`headerType`).

- [ ] **Step 1: Escrever os testes que falham**

Adicionar ao `describe('outbound queue', ...)` em `src/queue/outbound-queue.test.js`:

```js
  test('passes repliedToMessageId through to the queued job', (done) => {
    processOutboundQueue((data) => {
      try {
        expect(data.repliedToMessageId).toBe('msg-original');
        done();
      } catch (err) {
        done(err);
      }
    });
    enqueueOutboundMessage({ conversationId, channelId, content: 'R$150,00', repliedToMessageId: 'msg-original' });
  });

  test('defaults repliedToMessageId to null when not provided', (done) => {
    processOutboundQueue((data) => {
      try {
        expect(data.repliedToMessageId).toBeNull();
        done();
      } catch (err) {
        done(err);
      }
    });
    enqueueOutboundMessage({ conversationId, channelId, content: 'Mensagem normal' });
  });
```

- [ ] **Step 2: Rodar os testes pra confirmar que falham**

Run: `npx dotenv -e .env.test -o -- jest src/queue/outbound-queue.test.js -t "repliedToMessageId"`
Expected: FAIL — `data.repliedToMessageId` é `undefined` nos dois casos.

- [ ] **Step 3: Implementar**

Em `src/queue/outbound-queue.js`, atualizar a assinatura e o payload do job de `enqueueOutboundMessage`:

```js
async function enqueueOutboundMessage({ conversationId, channelId, content, messageType, mediaPath, mediaMimeType, mediaFilename, templateName, templateLanguage, templateVariables, headerType, headerLink, repliedToMessageId }) {
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
    repliedToMessageId,
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
      repliedToMessageId: repliedToMessageId || null,
    },
    { attempts: 3, backoff: { type: 'exponential', delay: 5000 } }
  );
  return message;
}
```

(Só essa função muda; `getOutboundQueue`/`processOutboundQueue`/`closeOutboundQueue` continuam iguais.)

- [ ] **Step 4: Rodar os testes pra confirmar que passam**

Run: `npx dotenv -e .env.test -o -- jest src/queue/outbound-queue.test.js`
Expected: PASS (todos os testes do arquivo, incluindo os 2 novos). Se aparecerem falhas isoladas de timeout no mesmo arquivo (não relacionadas aos 2 testes novos), é a flakiness de Redis já conhecida e documentada neste projeto — confirme rodando só os 2 testes novos com `-t "repliedToMessageId"` isoladamente antes de assumir uma regressão real.

- [ ] **Step 5: Commit**

```bash
git add src/queue/outbound-queue.js src/queue/outbound-queue.test.js
git commit -m "Thread repliedToMessageId through enqueueOutboundMessage"
```

---

### Task 4: Worker de envio (`outbound-worker.js`)

**Files:**
- Modify: `src/queue/outbound-worker.js`
- Test: `src/queue/outbound-worker.test.js`

**Interfaces:**
- Consumes: Task 3's job payload (`repliedToMessageId`); `findMessageById` (já importado neste arquivo).
- Produces: quando `repliedToMessageId` está presente E a mensagem original é encontrada, `sendTextMessage`/`sendMediaMessage` do adaptador correspondente são chamados com um 4º argumento (texto) ou campos extras no objeto de opções (mídia): `{repliedToWhatsappMessageId, repliedToDirection, repliedToContent}`. Quando ausente, os adaptadores continuam sendo chamados exatamente como hoje (sem esse argumento/campos extras).

- [ ] **Step 1: Escrever os testes que falham**

Adicionar ao `describe('startOutboundWorker', ...)` em `src/queue/outbound-worker.test.js`:

```js
  test('passes reply context to sendTextMessage when repliedToMessageId is present and the original message is found', async () => {
    getConversationWithContact.mockResolvedValue({ id: 'conv-1', contactPhoneNumber: '5511999998888' });
    findChannelById.mockResolvedValue({ id: 'channel-1', type: 'meta_cloud', config: {} });
    findMessageById.mockImplementation((id) => {
      if (id === 'msg-1') return Promise.resolve(null); // idempotency check at the top of the handler
      if (id === 'msg-original') {
        return Promise.resolve({ id: 'msg-original', whatsappMessageId: 'wamid.ORIG1', direction: 'inbound', content: 'Qual o valor?' });
      }
      return Promise.resolve(null);
    });
    metaCloudAdapter.sendTextMessage.mockResolvedValue({ whatsappMessageId: 'wamid.REPLY1' });

    await handler({
      messageId: 'msg-1', conversationId: 'conv-1', channelId: 'channel-1', content: 'R$150,00',
      repliedToMessageId: 'msg-original',
    });

    expect(metaCloudAdapter.sendTextMessage).toHaveBeenCalledWith(
      { id: 'channel-1', type: 'meta_cloud', config: {} },
      '5511999998888',
      'R$150,00',
      { repliedToWhatsappMessageId: 'wamid.ORIG1', repliedToDirection: 'inbound', repliedToContent: 'Qual o valor?' }
    );
  });

  test('sends without a 4th argument when repliedToMessageId is absent (unchanged behavior)', async () => {
    getConversationWithContact.mockResolvedValue({ id: 'conv-1', contactPhoneNumber: '5511999998888' });
    findChannelById.mockResolvedValue({ id: 'channel-1', type: 'meta_cloud', config: {} });
    metaCloudAdapter.sendTextMessage.mockResolvedValue({ whatsappMessageId: 'wamid.PLAIN1' });

    await handler({ messageId: 'msg-1', conversationId: 'conv-1', channelId: 'channel-1', content: 'Oi' });

    expect(metaCloudAdapter.sendTextMessage).toHaveBeenCalledWith(
      { id: 'channel-1', type: 'meta_cloud', config: {} },
      '5511999998888',
      'Oi'
    );
  });

  test('sends without reply context when the original message is not found (defensive fallback)', async () => {
    getConversationWithContact.mockResolvedValue({ id: 'conv-1', contactPhoneNumber: '5511999998888' });
    findChannelById.mockResolvedValue({ id: 'channel-1', type: 'meta_cloud', config: {} });
    findMessageById.mockResolvedValue(null);
    metaCloudAdapter.sendTextMessage.mockResolvedValue({ whatsappMessageId: 'wamid.FALLBACK1' });

    await handler({
      messageId: 'msg-1', conversationId: 'conv-1', channelId: 'channel-1', content: 'R$150,00',
      repliedToMessageId: 'msg-gone',
    });

    expect(metaCloudAdapter.sendTextMessage).toHaveBeenCalledWith(
      { id: 'channel-1', type: 'meta_cloud', config: {} },
      '5511999998888',
      'R$150,00'
    );
  });

  test('passes reply context to sendMediaMessage when repliedToMessageId is present', async () => {
    getConversationWithContact.mockResolvedValue({ id: 'conv-1', contactPhoneNumber: '5511999998888' });
    findChannelById.mockResolvedValue({ id: 'channel-1', type: 'meta_cloud', config: {} });
    findMessageById.mockImplementation((id) => {
      if (id === 'msg-1') return Promise.resolve(null);
      return Promise.resolve({ id: 'msg-original', whatsappMessageId: 'wamid.ORIG1', direction: 'outbound', content: 'Segue o boleto' });
    });
    metaCloudAdapter.sendMediaMessage.mockResolvedValue({ whatsappMessageId: 'wamid.REPLYMEDIA1' });

    await handler({
      messageId: 'msg-1', conversationId: 'conv-1', channelId: 'channel-1', content: 'Aqui está',
      messageType: 'image', mediaPath: 'file.jpg', mediaMimeType: 'image/jpeg', mediaFilename: null,
      repliedToMessageId: 'msg-original',
    });

    expect(metaCloudAdapter.sendMediaMessage).toHaveBeenCalledWith(
      { id: 'channel-1', type: 'meta_cloud', config: {} },
      '5511999998888',
      {
        messageType: 'image', mediaPath: 'file.jpg', mediaMimeType: 'image/jpeg', mediaFilename: null, caption: 'Aqui está',
        repliedToWhatsappMessageId: 'wamid.ORIG1', repliedToDirection: 'outbound', repliedToContent: 'Segue o boleto',
      }
    );
  });
```

- [ ] **Step 2: Rodar os testes pra confirmar que falham**

Run: `npx dotenv -e .env.test -o -- jest src/queue/outbound-worker.test.js -t "reply context|4th argument|original message is not found"`
Expected: FAIL — o worker ainda não lê `repliedToMessageId` nem busca a mensagem original.

- [ ] **Step 3: Implementar**

Substituir `src/queue/outbound-worker.js` inteiro por:

```js
const { processOutboundQueue } = require('./outbound-queue');
const { findChannelById } = require('../channels/channel.repository');
const { getConversationWithContact } = require('../conversations/conversation.repository');
const { findMessageById, updateMessageStatus, recordMessageSent } = require('../conversations/message.repository');
const metaCloudAdapter = require('../whatsapp-adapters/meta-cloud.adapter');
const baileysManager = require('../whatsapp-adapters/baileys.manager');
const { emitToAgent } = require('../realtime/socket-server');

const ADAPTERS_BY_CHANNEL_TYPE = {
  meta_cloud: metaCloudAdapter,
  baileys: baileysManager,
};

function startOutboundWorker() {
  processOutboundQueue(async ({ messageId, conversationId, channelId, content, messageType, mediaPath, mediaMimeType, mediaFilename, templateName, templateLanguage, templateVariables, headerType, headerLink, repliedToMessageId }) => {
    const existingMessage = await findMessageById(messageId);
    if (existingMessage && existingMessage.whatsappMessageId) return;
    const conversation = await getConversationWithContact(conversationId);
    const channel = await findChannelById(channelId);
    try {
      const adapter = ADAPTERS_BY_CHANNEL_TYPE[channel.type];

      let replyOptions;
      if (repliedToMessageId) {
        const original = await findMessageById(repliedToMessageId);
        if (original) {
          replyOptions = {
            repliedToWhatsappMessageId: original.whatsappMessageId,
            repliedToDirection: original.direction,
            repliedToContent: original.content,
          };
        }
      }

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
              ...(replyOptions || {}),
            })
          : replyOptions
            ? await adapter.sendTextMessage(channel, conversation.contactPhoneNumber, content, replyOptions)
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

module.exports = { startOutboundWorker };
```

**Atenção:** `sendTextMessage` só recebe o 4º argumento quando `replyOptions` existe de verdade (`replyOptions ? adapter.sendTextMessage(..., replyOptions) : adapter.sendTextMessage(...)`) — nunca passar `replyOptions` como `undefined` explicitamente no lugar do 4º argumento, porque uma chamada com 4 argumentos (mesmo o último sendo `undefined`) tem contagem de argumentos diferente de uma chamada com 3, e os testes existentes (`toHaveBeenCalledWith(channel, phone, content)`, só 3 argumentos) quebrariam. Para `sendMediaMessage`, como o 3º argumento já é sempre um objeto, `...(replyOptions || {})` é seguro (não adiciona nenhuma chave quando `replyOptions` é `undefined`).

- [ ] **Step 4: Rodar os testes pra confirmar que passam**

Run: `npx dotenv -e .env.test -o -- jest src/queue/outbound-worker.test.js`
Expected: PASS (todos os testes do arquivo, incluindo os 4 novos e todos os já existentes sem modificação nenhuma).

- [ ] **Step 5: Commit**

```bash
git add src/queue/outbound-worker.js src/queue/outbound-worker.test.js
git commit -m "Look up the replied-to message and pass reply context to the adapter"
```

---

### Task 5: Adaptador Baileys (`baileys.manager.js`)

**Files:**
- Modify: `src/whatsapp-adapters/baileys.manager.js`
- Test: `src/whatsapp-adapters/baileys.manager.test.js`

**Interfaces:**
- Consumes: Task 4's chamada `sendTextMessage(channel, phone, content, replyOptions?)` / `sendMediaMessage(channel, phone, {..., repliedToWhatsappMessageId?, repliedToDirection?, repliedToContent?})`.
- Produces: quando os campos de resposta estão presentes, `entry.sock.sendMessage` é chamado com um 3º argumento `{ quoted: {...} }`. Quando ausentes, `entry.sock.sendMessage` continua sendo chamado com exatamente 2 argumentos, como hoje.

- [ ] **Step 1: Escrever os testes que falham**

Adicionar ao `describe('sendTextMessage', ...)` em `src/whatsapp-adapters/baileys.manager.test.js` (depois do teste existente `'sends a text message through the active socket...'`, antes do `'throws when there is no active connection...'`):

```js
    test('sends a quoted reply when reply context is provided', async () => {
      const sock = createMockSock();
      baileysLib.default.mockReturnValue(sock);
      const channel = { id: 'channel-4', type: 'baileys' };
      await manager.startBaileysConnection(channel);

      await manager.sendTextMessage(channel, '5511999993333', 'R$150,00', {
        repliedToWhatsappMessageId: 'wamid.ORIG1',
        repliedToDirection: 'inbound',
        repliedToContent: 'Qual o valor?',
      });

      expect(sock.sendMessage).toHaveBeenCalledWith(
        '5511999993333@s.whatsapp.net',
        { text: 'R$150,00' },
        { quoted: { key: { remoteJid: '5511999993333@s.whatsapp.net', id: 'wamid.ORIG1', fromMe: false }, message: { conversation: 'Qual o valor?' } } }
      );
    });

    test('marks fromMe true when replying to an outbound message', async () => {
      const sock = createMockSock();
      baileysLib.default.mockReturnValue(sock);
      const channel = { id: 'channel-4', type: 'baileys' };
      await manager.startBaileysConnection(channel);

      await manager.sendTextMessage(channel, '5511999993333', 'Confirmado', {
        repliedToWhatsappMessageId: 'wamid.ORIG2',
        repliedToDirection: 'outbound',
        repliedToContent: 'Já registramos o pagamento',
      });

      expect(sock.sendMessage).toHaveBeenCalledWith(
        '5511999993333@s.whatsapp.net',
        { text: 'Confirmado' },
        expect.objectContaining({ quoted: expect.objectContaining({ key: expect.objectContaining({ fromMe: true }) }) })
      );
    });
```

Adicionar ao `describe('sendMediaMessage', ...)` no mesmo arquivo (depois de qualquer um dos testes existentes desse describe):

```js
    test('sends a quoted reply when reply context is provided', async () => {
      const sock = createMockSock();
      baileysLib.default.mockReturnValue(sock);
      const channel = { id: 'channel-5', type: 'baileys' };
      await manager.startBaileysConnection(channel);
      const { getMediaFilePath } = require('../media/media-storage');
      getMediaFilePath.mockReturnValue('/fake/path/image.jpg');
      const fs = require('fs');
      fs.promises.readFile = jest.fn().mockResolvedValue(Buffer.from('fake-image-bytes'));

      await manager.sendMediaMessage(channel, '5511999993333', {
        messageType: 'image',
        mediaPath: 'image.jpg',
        mediaMimeType: 'image/jpeg',
        caption: 'Segue o comprovante',
        repliedToWhatsappMessageId: 'wamid.ORIG3',
        repliedToDirection: 'inbound',
        repliedToContent: 'Manda o comprovante',
      });

      expect(sock.sendMessage).toHaveBeenCalledWith(
        '5511999993333@s.whatsapp.net',
        { image: Buffer.from('fake-image-bytes'), caption: 'Segue o comprovante' },
        { quoted: { key: { remoteJid: '5511999993333@s.whatsapp.net', id: 'wamid.ORIG3', fromMe: false }, message: { conversation: 'Manda o comprovante' } } }
      );
    });
```

- [ ] **Step 2: Rodar os testes pra confirmar que falham**

Run: `npx dotenv -e .env.test -o -- jest src/whatsapp-adapters/baileys.manager.test.js -t "quoted reply|fromMe true"`
Expected: FAIL — `sock.sendMessage` ainda é chamado sem o 3º argumento em qualquer cenário.

- [ ] **Step 3: Implementar**

Em `src/whatsapp-adapters/baileys.manager.js`, substituir `sendTextMessage` e `sendMediaMessage`:

```js
function buildQuotedOptions(jid, { repliedToWhatsappMessageId, repliedToDirection, repliedToContent } = {}) {
  if (!repliedToWhatsappMessageId) return undefined;
  return {
    quoted: {
      key: { remoteJid: jid, id: repliedToWhatsappMessageId, fromMe: repliedToDirection === 'outbound' },
      message: { conversation: repliedToContent },
    },
  };
}

async function sendTextMessage(channel, toPhoneNumber, content, replyContext = {}) {
  const entry = connections.get(channel.id);
  if (!entry) {
    throw new Error(`No active Baileys connection for channel ${channel.id}`);
  }
  const jid = `${toPhoneNumber}@s.whatsapp.net`;
  const options = buildQuotedOptions(jid, replyContext);
  const sent = options
    ? await entry.sock.sendMessage(jid, { text: content }, options)
    : await entry.sock.sendMessage(jid, { text: content });
  return { whatsappMessageId: sent.key.id };
}

async function sendMediaMessage(channel, toPhoneNumber, { messageType, mediaPath, mediaMimeType, mediaFilename, caption, ...replyContext }) {
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
    payload = caption
      ? { document: buffer, mimetype: mediaMimeType, fileName: mediaFilename || 'arquivo', caption }
      : { document: buffer, mimetype: mediaMimeType, fileName: mediaFilename || 'arquivo' };
  } else if (messageType === 'sticker') {
    payload = { sticker: buffer };
  } else {
    throw new Error(`Unsupported media message type: ${messageType}`);
  }

  const options = buildQuotedOptions(jid, replyContext);
  const sent = options ? await entry.sock.sendMessage(jid, payload, options) : await entry.sock.sendMessage(jid, payload);
  return { whatsappMessageId: sent.key.id };
}
```

`buildQuotedOptions` é uma função nova, privada (não exportada) — colocar logo acima de `sendTextMessage` no arquivo. `sendMediaMessage` usa `...replyContext` pra capturar `repliedToWhatsappMessageId`/`repliedToDirection`/`repliedToContent` do mesmo objeto de opções que já tem `messageType`/`mediaPath`/etc, sem precisar de um parâmetro extra separado.

- [ ] **Step 4: Rodar os testes pra confirmar que passam**

Run: `npx dotenv -e .env.test -o -- jest src/whatsapp-adapters/baileys.manager.test.js`
Expected: PASS (todos os testes do arquivo, incluindo os 3 novos e todos os já existentes sem modificação).

- [ ] **Step 5: Commit**

```bash
git add src/whatsapp-adapters/baileys.manager.js src/whatsapp-adapters/baileys.manager.test.js
git commit -m "Let Baileys sendTextMessage/sendMediaMessage attach a quoted reply"
```

---

### Task 6: Adaptador Meta Cloud (`meta-cloud.adapter.js`)

**Files:**
- Modify: `src/whatsapp-adapters/meta-cloud.adapter.js`
- Test: `src/whatsapp-adapters/meta-cloud.adapter.test.js`

**Interfaces:**
- Consumes: Task 4's chamada `sendTextMessage(channel, phone, content, replyOptions?)` / `sendMediaMessage(channel, phone, {..., repliedToWhatsappMessageId?})`.
- Produces: quando `repliedToWhatsappMessageId` está presente, o corpo da requisição pro Graph API ganha `context: {message_id: repliedToWhatsappMessageId}`. Quando ausente, o corpo continua exatamente como hoje.

- [ ] **Step 1: Escrever os testes que falham**

Adicionar ao `describe('sendTextMessage', ...)` em `src/whatsapp-adapters/meta-cloud.adapter.test.js`:

```js
  test('adds a context field when replying to a message', async () => {
    axios.post.mockResolvedValue({ data: { messages: [{ id: 'wamid.REPLY1' }] } });
    const channel = { config: { phoneNumberId: '1234567890', accessToken: 'token-abc' } };

    await sendTextMessage(channel, '5511999998888', 'R$150,00', { repliedToWhatsappMessageId: 'wamid.ORIG1' });

    expect(axios.post).toHaveBeenCalledWith(
      'https://graph.facebook.com/v20.0/1234567890/messages',
      {
        messaging_product: 'whatsapp', to: '5511999998888', type: 'text', text: { body: 'R$150,00' },
        context: { message_id: 'wamid.ORIG1' },
      },
      { headers: { Authorization: 'Bearer token-abc' } }
    );
  });
```

Adicionar ao `describe('sendMediaMessage', ...)` no mesmo arquivo:

```js
  test('adds a context field to the message payload when replying to a message', async () => {
    getMediaFilePath.mockReturnValue('/fake/path/to/file');
    fs.promises = { readFile: jest.fn().mockResolvedValue(Buffer.from('fake-image-bytes')) };
    axios.post
      .mockResolvedValueOnce({ data: { id: 'UPLOADED_MEDIA_ID' } })
      .mockResolvedValueOnce({ data: { messages: [{ id: 'wamid.REPLYMEDIA1' }] } });

    const channel = { config: { phoneNumberId: '1234567890', accessToken: 'token-abc' } };
    await sendMediaMessage(channel, '5511999998888', {
      messageType: 'image',
      mediaPath: 'abc.jpg',
      mediaMimeType: 'image/jpeg',
      mediaFilename: null,
      caption: 'Segue o comprovante',
      repliedToWhatsappMessageId: 'wamid.ORIG2',
    });

    expect(axios.post).toHaveBeenNthCalledWith(
      2,
      'https://graph.facebook.com/v20.0/1234567890/messages',
      {
        messaging_product: 'whatsapp',
        to: '5511999998888',
        type: 'image',
        image: { id: 'UPLOADED_MEDIA_ID', caption: 'Segue o comprovante' },
        context: { message_id: 'wamid.ORIG2' },
      },
      { headers: { Authorization: 'Bearer token-abc' } }
    );
  });
```

- [ ] **Step 2: Rodar os testes pra confirmar que falham**

Run: `npx dotenv -e .env.test -o -- jest src/whatsapp-adapters/meta-cloud.adapter.test.js -t "context field"`
Expected: FAIL — o corpo da requisição nunca inclui `context`.

- [ ] **Step 3: Implementar**

Em `src/whatsapp-adapters/meta-cloud.adapter.js`, substituir `sendTextMessage` e `sendMediaMessage`:

```js
async function sendTextMessage(channel, toPhoneNumber, content, { repliedToWhatsappMessageId } = {}) {
  const { phoneNumberId, accessToken } = channel.config;
  const body = {
    messaging_product: 'whatsapp',
    to: toPhoneNumber,
    type: 'text',
    text: { body: content },
  };
  if (repliedToWhatsappMessageId) {
    body.context = { message_id: repliedToWhatsappMessageId };
  }
  const response = await axios.post(
    `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`,
    body,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  return { whatsappMessageId: response.data.messages[0].id };
}

async function sendMediaMessage(channel, toPhoneNumber, { messageType, mediaPath, mediaMimeType, mediaFilename, caption, repliedToWhatsappMessageId }) {
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
  if (repliedToWhatsappMessageId) {
    messagePayload.context = { message_id: repliedToWhatsappMessageId };
  }
  const response = await axios.post(`https://graph.facebook.com/v20.0/${phoneNumberId}/messages`, messagePayload, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return { whatsappMessageId: response.data.messages[0].id };
}
```

(`repliedToDirection`/`repliedToContent` são ignorados aqui de propósito — a Meta Cloud só precisa do ID.)

- [ ] **Step 4: Rodar os testes pra confirmar que passam**

Run: `npx dotenv -e .env.test -o -- jest src/whatsapp-adapters/meta-cloud.adapter.test.js`
Expected: PASS (todos os testes do arquivo, incluindo os 2 novos).

- [ ] **Step 5: Commit**

```bash
git add src/whatsapp-adapters/meta-cloud.adapter.js src/whatsapp-adapters/meta-cloud.adapter.test.js
git commit -m "Let Meta Cloud sendTextMessage/sendMediaMessage attach a reply context"
```

---

### Task 7: Frontend — `services/api.js` + `useConversationMessages.js`

**Files:**
- Modify: `frontend/src/services/api.js`
- Modify: `frontend/src/hooks/useConversationMessages.js`
- Test: `frontend/src/hooks/useConversationMessages.test.jsx`

**Interfaces:**
- Produces: `sendMessage(conversationId, content, token, file, repliedToMessageId)` em `services/api.js`; o hook `useConversationMessages(conversationId)`'s `sendMessage` ganha um 3º parâmetro `repliedToMessageId`, repassado pra `apiSendMessage`.

- [ ] **Step 1: Escrever os testes que falham**

Em `frontend/src/hooks/useConversationMessages.test.jsx`, os dois testes existentes de `sendMessage` (por volta das linhas 100-126) precisam ser atualizados — `apiSendMessage` agora é sempre chamada com 5 argumentos posicionais (o 5º sendo `undefined` quando não há resposta). Trocar:

```js
    expect(api.sendMessage).toHaveBeenCalledWith('conv-1', 'Ola cliente', 'tok-123', undefined);
```
por:
```js
    expect(api.sendMessage).toHaveBeenCalledWith('conv-1', 'Ola cliente', 'tok-123', undefined, undefined);
```

e
```js
    expect(api.sendMessage).toHaveBeenCalledWith('conv-1', 'Legenda', 'tok-123', fakeFile);
```
por:
```js
    expect(api.sendMessage).toHaveBeenCalledWith('conv-1', 'Legenda', 'tok-123', fakeFile, undefined);
```

E adicionar um novo teste ao final do `describe` do arquivo:

```js
  test('sendMessage forwards the repliedToMessageId argument to the api call', async () => {
    const { result } = renderHook(() => useConversationMessages('conv-1'));
    api.sendMessage.mockResolvedValue({ id: 'm4', content: 'R$150,00', status: 'sent' });

    await act(async () => {
      await result.current.sendMessage('R$150,00', undefined, 'msg-original');
    });

    expect(api.sendMessage).toHaveBeenCalledWith('conv-1', 'R$150,00', 'tok-123', undefined, 'msg-original');
  });
```

- [ ] **Step 2: Rodar os testes pra confirmar que falham**

Run: `cd frontend && npx vitest run src/hooks/useConversationMessages.test.jsx`
Expected: FAIL — os 2 testes editados falham (contagem de argumentos não bate), o novo teste falha (`repliedToMessageId` nunca chega no `apiSendMessage`).

- [ ] **Step 3: Implementar**

Em `frontend/src/services/api.js`, substituir `sendMessage`:

```js
export function sendMessage(conversationId, content, token, file, repliedToMessageId) {
  if (file) {
    const formData = new FormData();
    if (content) {
      formData.append('content', content);
    }
    formData.append('file', file);
    if (repliedToMessageId) {
      formData.append('repliedToMessageId', repliedToMessageId);
    }
    return apiFetch(`/api/conversations/${conversationId}/messages`, { method: 'POST', body: formData, token });
  }
  return apiFetch(`/api/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: repliedToMessageId ? { content, repliedToMessageId } : { content },
    token,
  });
}
```

Em `frontend/src/hooks/useConversationMessages.js`, substituir a definição de `sendMessage`:

```js
  const sendMessage = useCallback(
    async (content, file, repliedToMessageId) => {
      const created = await apiSendMessage(conversationId, content, token, file, repliedToMessageId);
      setMessages((prev) => [...prev, created]);
      return created;
    },
    [conversationId, token]
  );
```

- [ ] **Step 4: Rodar os testes pra confirmar que passam**

Run: `cd frontend && npx vitest run src/hooks/useConversationMessages.test.jsx`
Expected: PASS (todos os testes do arquivo).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/api.js frontend/src/hooks/useConversationMessages.js frontend/src/hooks/useConversationMessages.test.jsx
git commit -m "Thread repliedToMessageId through sendMessage (api + hook)"
```

---

### Task 8: Frontend — `MessageInput.jsx`

**Files:**
- Modify: `frontend/src/components/MessageInput.jsx`
- Test: `frontend/src/components/MessageInput.test.jsx`

**Interfaces:**
- Consumes: nada de outras tasks (componente isolado, recebe tudo por props).
- Produces: `MessageInput` ganha props opcionais `replyingTo` (`{id, content, direction} | null`) e `onCancelReply` (função). `onSend` passa a ser sempre chamado com 3 argumentos: `(content, file, repliedToMessageId)`, onde `repliedToMessageId` é `replyingTo ? replyingTo.id : null`. Consumido pela Task 9.

- [ ] **Step 1: Escrever os testes que falham**

Em `frontend/src/components/MessageInput.test.jsx`, o teste existente (por volta da linha 92-101) precisa ser atualizado — `onSend` agora é sempre chamado com 3 argumentos. Trocar:

```js
    await waitFor(() => expect(onSend).toHaveBeenCalledWith('Oi', null));
```
por:
```js
    await waitFor(() => expect(onSend).toHaveBeenCalledWith('Oi', null, null));
```

E adicionar estes 3 testes novos ao final do `describe('MessageInput', ...)`:

```js
  test('shows a reply preview bar when replyingTo is set', () => {
    render(<MessageInput onSend={vi.fn()} replyingTo={{ id: 'msg-1', content: 'Qual o valor da fatura?', direction: 'inbound' }} onCancelReply={vi.fn()} />);
    expect(screen.getByText('Qual o valor da fatura?')).toBeInTheDocument();
  });

  test('shows no reply preview bar when replyingTo is null', () => {
    render(<MessageInput onSend={vi.fn()} replyingTo={null} onCancelReply={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /cancelar resposta/i })).not.toBeInTheDocument();
  });

  test('cancelling the reply preview calls onCancelReply', async () => {
    const onCancelReply = vi.fn();
    render(<MessageInput onSend={vi.fn()} replyingTo={{ id: 'msg-1', content: 'Qual o valor?', direction: 'inbound' }} onCancelReply={onCancelReply} />);

    await userEvent.click(screen.getByRole('button', { name: /cancelar resposta/i }));

    expect(onCancelReply).toHaveBeenCalled();
  });

  test('sends the repliedToMessageId as the third argument to onSend when replying', async () => {
    const onSend = vi.fn().mockResolvedValue({});
    render(<MessageInput onSend={onSend} replyingTo={{ id: 'msg-1', content: 'Qual o valor?', direction: 'inbound' }} onCancelReply={vi.fn()} />);

    await userEvent.type(screen.getByPlaceholderText(/digite uma mensagem/i), 'R$150,00');
    await userEvent.click(screen.getByRole('button', { name: /enviar/i }));

    await waitFor(() => expect(onSend).toHaveBeenCalledWith('R$150,00', null, 'msg-1'));
  });
```

- [ ] **Step 2: Rodar os testes pra confirmar que falham**

Run: `cd frontend && npx vitest run src/components/MessageInput.test.jsx`
Expected: FAIL — a barra de preview não existe, `onSend` ainda é chamado com 2 argumentos.

- [ ] **Step 3: Implementar**

Em `frontend/src/components/MessageInput.jsx`:

1. Trocar a assinatura da função: `function MessageInput({ onSend, quickReplies = [], replyingTo = null, onCancelReply }) {`

2. Em `handleSubmit`, trocar a chamada `await onSend(content, file);` por `await onSend(content, file, replyingTo ? replyingTo.id : null);`

3. Adicionar, imediatamente antes do `<form onSubmit={handleSubmit} ...>` de abertura (ou seja, como o primeiro elemento dentro do JSX retornado, envolvendo o form ou logo acima dele — a estrutura atual retorna só o `<form>`, então envolva num fragmento):

```jsx
  return (
    <>
      {replyingTo && (
        <div className="flex items-center justify-between gap-2 border-t border-gray-200 bg-gray-50 px-3 py-2 text-sm">
          <p className="truncate text-gray-600">
            Respondendo: <span className="font-medium">{replyingTo.content}</span>
          </p>
          <button type="button" onClick={onCancelReply} aria-label="Cancelar resposta" className="text-gray-500 hover:text-gray-700">
            ✕
          </button>
        </div>
      )}
      <form onSubmit={handleSubmit} className="border-t border-gray-200 p-3">
```

E fechar o fragmento no final do arquivo, trocando o `</form>` final por `</form>\n    </>`. (O restante do conteúdo do `<form>` — todos os inputs, botões, gravação de áudio, respostas rápidas — não muda nada.)

- [ ] **Step 4: Rodar os testes pra confirmar que passam**

Run: `cd frontend && npx vitest run src/components/MessageInput.test.jsx`
Expected: PASS (todos os testes do arquivo, incluindo os 4 novos/atualizados).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/MessageInput.jsx frontend/src/components/MessageInput.test.jsx
git commit -m "Add a reply preview bar to MessageInput and forward repliedToMessageId to onSend"
```

---

### Task 9: Frontend — `ConversationView.jsx`

**Files:**
- Modify: `frontend/src/components/ConversationView.jsx`
- Test: `frontend/src/components/ConversationView.test.jsx`

**Interfaces:**
- Consumes: Task 7's `sendMessage(content, file, repliedToMessageId)`; Task 8's `MessageInput`'s `replyingTo`/`onCancelReply` props.
- Produces: cada bolha com `content` ganha um botão "↩" (só quando `isMine`) que seleciona aquela mensagem pra responder; bolhas com `repliedToPreview` mostram uma citação; `MessageInput` recebe `replyingTo`/`onCancelReply` e um `onSend` que limpa a seleção após o envio ter sucesso.

- [ ] **Step 1: Escrever os testes que falham**

O teste existente em `frontend/src/components/ConversationView.test.jsx` que hoje faz `expect(sendMessage).toHaveBeenCalledWith('Segue a foto', fakeFile));` (por volta da linha 185) precisa virar:

```js
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith('Segue a foto', fakeFile, null));
```

E adicionar estes 4 testes novos ao `describe('ConversationView', ...)`:

```js
  test('shows a reply button on a message with content when the conversation is mine', () => {
    useConversationMessages.mockReturnValue({
      messages: [{ id: 'm1', direction: 'inbound', content: 'Qual o valor da fatura?' }],
      sendMessage: vi.fn(),
    });
    render(
      <ConversationView
        conversation={{ id: 'c1', status: 'assigned', assignedAgentId: 'agent-1' }}
        onTransferClick={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: /responder/i })).toBeInTheDocument();
  });

  test('shows no reply button when the conversation is not mine', () => {
    useConversationMessages.mockReturnValue({
      messages: [{ id: 'm1', direction: 'inbound', content: 'Qual o valor da fatura?' }],
      sendMessage: vi.fn(),
    });
    render(
      <ConversationView
        conversation={{ id: 'c1', status: 'waiting', assignedAgentId: null }}
        onTransferClick={vi.fn()}
      />
    );
    expect(screen.queryByRole('button', { name: /responder/i })).not.toBeInTheDocument();
  });

  test('clicking the reply button on a message stages it, and sending clears it', async () => {
    const sendMessage = vi.fn().mockResolvedValue({});
    useConversationMessages.mockReturnValue({
      messages: [{ id: 'm1', direction: 'inbound', content: 'Qual o valor da fatura?' }],
      sendMessage,
    });
    render(
      <ConversationView
        conversation={{ id: 'c1', status: 'assigned', assignedAgentId: 'agent-1' }}
        onTransferClick={vi.fn()}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: /responder/i }));
    expect(screen.getAllByText('Qual o valor da fatura?').length).toBeGreaterThan(1);

    await userEvent.type(screen.getByPlaceholderText(/digite uma mensagem/i), 'R$150,00');
    await userEvent.click(screen.getByRole('button', { name: /enviar/i }));

    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith('R$150,00', null, 'm1'));
    await waitFor(() => expect(screen.queryByRole('button', { name: /cancelar resposta/i })).not.toBeInTheDocument());
  });

  test('shows a quoted preview on a message that has repliedToPreview', () => {
    useConversationMessages.mockReturnValue({
      messages: [
        {
          id: 'm2',
          direction: 'outbound',
          content: 'R$150,00',
          repliedToPreview: { content: 'Qual o valor da fatura?', direction: 'inbound' },
        },
      ],
      sendMessage: vi.fn(),
    });
    render(
      <ConversationView
        conversation={{ id: 'c1', status: 'assigned', assignedAgentId: 'agent-1', contactDisplayName: 'Carlos' }}
        onTransferClick={vi.fn()}
      />
    );
    expect(screen.getByText('Qual o valor da fatura?')).toBeInTheDocument();
    // 'Carlos' legitimately appears twice — once in the header, once as the quote's label —
    // so this must NOT use the singular getByText (it throws on more than one match).
    expect(screen.getAllByText('Carlos').length).toBeGreaterThan(1);
  });

  test('labels a quoted reply to your own earlier message as "Você"', () => {
    useConversationMessages.mockReturnValue({
      messages: [
        {
          id: 'm2',
          direction: 'outbound',
          content: 'Confirmado',
          repliedToPreview: { content: 'Já registramos o pagamento', direction: 'outbound' },
        },
      ],
      sendMessage: vi.fn(),
    });
    render(
      <ConversationView
        conversation={{ id: 'c1', status: 'assigned', assignedAgentId: 'agent-1', contactDisplayName: 'Carlos' }}
        onTransferClick={vi.fn()}
      />
    );
    expect(screen.getByText('Você')).toBeInTheDocument();
    expect(screen.getByText('Já registramos o pagamento')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Rodar os testes pra confirmar que falham**

Run: `cd frontend && npx vitest run src/components/ConversationView.test.jsx`
Expected: FAIL — não existe botão "Responder", não existe citação nas bolhas, `sendMessage` ainda é chamado com 2 argumentos.

- [ ] **Step 3: Implementar**

Substituir `frontend/src/components/ConversationView.jsx` inteiro por:

```jsx
import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useConversationMessages } from '../hooks/useConversationMessages';
import { useQuickReplies } from '../hooks/useQuickReplies';
import { claimConversation, closeConversation } from '../services/api';
import MessageInput from './MessageInput';
import MessageAttachment from './MessageAttachment';
import MessageStatusTicks from './MessageStatusTicks';
import ConversationHistoryModal from './ConversationHistoryModal';
import ContactAvatar from './ContactAvatar';
import EditContactModal from './EditContactModal';

function ConversationView({ conversation, onTransferClick, onBack }) {
  const { token, agent } = useAuth();
  const { messages, sendMessage } = useConversationMessages(conversation.id);
  const { quickReplies } = useQuickReplies();
  const [showingHistory, setShowingHistory] = useState(false);
  const [editingContact, setEditingContact] = useState(false);
  const [contactOverride, setContactOverride] = useState(null);
  const [replyingTo, setReplyingTo] = useState(null);

  useEffect(() => {
    setContactOverride(null);
    setEditingContact(false);
    setReplyingTo(null);
  }, [conversation.id]);

  const isUnassigned = conversation.status !== 'closed' && !conversation.assignedAgentId;
  const isMine = conversation.assignedAgentId === agent.id;
  const displayName = contactOverride ? contactOverride.displayName : conversation.contactDisplayName;
  const cityName = contactOverride ? contactOverride.cityName : conversation.contactCityName;
  const nameLabel = displayName || conversation.contactPhoneNumber || 'Conversa';
  const headerLabel = cityName ? `${nameLabel} - ${cityName}` : nameLabel;

  async function handleSend(content, file, repliedToMessageId) {
    await sendMessage(content, file, repliedToMessageId);
    setReplyingTo(null);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 p-3">
        <div className="flex items-center gap-2">
          <button onClick={onBack} className="rounded p-3 text-gray-500 md:hidden" aria-label="Voltar para a lista">
            ←
          </button>
          <button
            onClick={() => setEditingContact(true)}
            className="flex items-center gap-2"
            aria-label={`Editar cliente: ${headerLabel}`}
          >
            <ContactAvatar
              contactId={conversation.contactId}
              avatarPath={conversation.contactAvatarPath}
              displayName={displayName}
              phoneNumber={conversation.contactPhoneNumber}
            />
            <span className="font-semibold text-gray-800">{headerLabel}</span>
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setShowingHistory(true)}
            className="rounded bg-gray-200 px-3 py-1 text-sm text-gray-700"
          >
            Ver atendimentos anteriores
          </button>
          {isUnassigned && (
            <button
              onClick={() => claimConversation(conversation.id, token)}
              className="rounded bg-green-600 px-3 py-1 text-sm text-white"
            >
              Assumir
            </button>
          )}
          {isMine && (
            <>
              <button
                onClick={() => onTransferClick(conversation.id)}
                className="rounded bg-blue-600 px-3 py-1 text-sm text-white"
              >
                Transferir
              </button>
              <button
                onClick={() => closeConversation(conversation.id, token)}
                className="rounded bg-gray-600 px-3 py-1 text-sm text-white"
              >
                Fechar
              </button>
            </>
          )}
        </div>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {messages.map((message) => {
          const repliedToLabel = message.repliedToPreview
            ? message.repliedToPreview.direction === 'outbound'
              ? 'Você'
              : displayName || conversation.contactPhoneNumber || 'Conversa'
            : null;
          return (
            <div
              key={message.id}
              className={`max-w-[85%] space-y-1 rounded px-3 py-2 text-sm md:max-w-xs ${
                message.direction === 'inbound' ? 'bg-gray-100 text-gray-800' : 'ml-auto bg-blue-100 text-gray-800'
              }`}
            >
              {message.repliedToPreview && (
                <div className="rounded border-l-2 border-gray-400 bg-black/5 px-2 py-1 text-xs text-gray-600">
                  <p className="font-medium">{repliedToLabel}</p>
                  <p className="truncate">{message.repliedToPreview.content}</p>
                </div>
              )}
              {message.content && <p className="break-words">{message.content}</p>}
              <MessageAttachment message={message} />
              <div className="flex items-center justify-end gap-2">
                {isMine && message.content && (
                  <button
                    onClick={() => setReplyingTo(message)}
                    aria-label="Responder"
                    title="Responder"
                    className="text-xs text-gray-500 hover:underline"
                  >
                    ↩
                  </button>
                )}
                {message.direction === 'outbound' && <MessageStatusTicks status={message.status} />}
              </div>
            </div>
          );
        })}
      </div>
      {isMine && (
        <MessageInput
          onSend={handleSend}
          quickReplies={quickReplies}
          replyingTo={replyingTo}
          onCancelReply={() => setReplyingTo(null)}
        />
      )}
      {showingHistory && (
        <ConversationHistoryModal contactId={conversation.contactId} onClose={() => setShowingHistory(false)} />
      )}
      {editingContact && (
        <EditContactModal
          conversation={{
            ...conversation,
            contactDisplayName: contactOverride ? contactOverride.displayName : conversation.contactDisplayName,
            contactCityId: contactOverride ? contactOverride.cityId : conversation.contactCityId,
          }}
          onClose={() => setEditingContact(false)}
          onSaved={(updated) => setContactOverride(updated)}
        />
      )}
    </div>
  );
}

export default ConversationView;
```

- [ ] **Step 4: Rodar os testes pra confirmar que passam**

Run: `cd frontend && npx vitest run src/components/ConversationView.test.jsx`
Expected: PASS (todos os testes do arquivo, incluindo os 4 novos e o já existente atualizado).

- [ ] **Step 5: Rodar a suíte completa do frontend**

Run: `cd frontend && npx vitest run`
Expected: PASS em todos os arquivos (nenhuma outra suíte referencia `ConversationView`/`MessageInput` de um jeito que quebraria com essas mudanças).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/ConversationView.jsx frontend/src/components/ConversationView.test.jsx
git commit -m "Let the attendant select a message to reply to, and show quoted replies in bubbles"
```

---

## Migração em produção

**Lembrete de alta prioridade, como toda vez que uma migração é adicionada neste projeto:** depois do merge/deploy, rodar `npm run migrate -- up` (ou confirmar que o passo automático configurado no Render, se já estiver ativo, rodou) antes de considerar a feature entregue — sem isso, a nova coluna `replied_to_message_id` não existe em produção e qualquer tentativa de responder uma mensagem vai falhar com erro de coluna inexistente.
