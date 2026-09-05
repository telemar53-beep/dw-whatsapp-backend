# Tempo Real via Socket.io — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminar a necessidade de recarregar a página para ver atualizações — quando uma mensagem chega, uma conversa é assumida/transferida/fechada, ou uma mensagem de saída muda de status, os atendentes conectados recebem o evento em tempo real via Socket.io.

**Architecture:** Novo módulo `realtime/` com um servidor Socket.io anexado ao mesmo servidor HTTP do Express, autenticado por JWT (mesma chave usada pela API REST), com cada atendente entrando numa "sala" própria (`agent:<agentId>`) para receber eventos direcionados, além de um canal de broadcast para eventos que interessam a todos (fila de espera). Os pontos de entrada existentes (webhook da Meta, rotas de conversa, worker de envio) chamam esse módulo para emitir eventos depois de uma operação bem-sucedida — a lógica de negócio em si (repositórios, serviços) permanece sem nenhuma dependência de Socket.io.

**Tech Stack:** `socket.io` (servidor), `socket.io-client` (só para testes), reutilizando `jsonwebtoken`/`verifyToken` já existentes para autenticação.

**Spec:** [docs/superpowers/specs/2026-09-04-whatsapp-attendance-system-design.md](../specs/2026-09-04-whatsapp-attendance-system-design.md)

## Global Constraints

- Node.js v22.x, CommonJS modules, consistente com os Planos 1-3.
- Sem comentários no código exceto onde uma restrição não óbvia exigir explicação.
- Jest configurado com `maxWorkers: 1` — não remover.
- O teste do módulo `realtime/socket-server.js` usa uma conexão Socket.io real (servidor HTTP real, cliente `socket.io-client` real) — sem mockar a camada de socket em si, mesmo espírito do "sem mocks na camada de infraestrutura" já aplicado a Postgres/Redis. Os testes das rotas/webhook/worker que **chamam** esse módulo mockam `realtime/socket-server` inteiro (camada de serviço, igual ao padrão já usado para `queue/outbound-queue` etc.).
- **Escopo desta v1:** eventos de mensagem nova, conversa entrando/saindo da fila, atribuição/transferência/fechamento e atualização de status de mensagem de saída. Eventos de status de canal (ex: "Baileys caiu", citado no spec) ficam fora de escopo — não há nenhum código ainda que produza mudanças de status de canal (isso é do Plano do adaptador Baileys, ainda não construído).
- O CORS do Socket.io usa a mesma política aberta (`origin: '*'`) já em uso pelo `cors()` do Express — ambos devem ser restringidos juntos quando o frontend tiver uma origem real, não é escopo deste plano.

---

### Task 1: Servidor Socket.io com autenticação por sala de atendente

**Files:**
- Create: `src/realtime/socket-server.js`
- Test: `src/realtime/socket-server.test.js`
- Modify: `package.json`
- Modify: `src/server.js`

**Interfaces:**
- Consumes: `verifyToken()` (`src/auth/auth.service.js`, Plano 1).
- Produces:
  - `initSocketServer(httpServer): Server` — cria o servidor Socket.io, valida o token de cada conexão (`socket.handshake.auth.token`) via `verifyToken`, e coloca a conexão autenticada na sala `agent:<agentId>`. Conexão sem token válido é rejeitada.
  - `getSocketServer(): Server` — lança erro se chamado antes de `initSocketServer`.
  - `emitToAgent(agentId, event, payload): void` — emite um evento só para a sala daquele atendente.
  - `broadcast(event, payload): void` — emite um evento para todas as conexões.
  - `closeSocketServer(): void` — fecha o servidor (usado em testes).

- [ ] **Step 1: Instalar as dependências**

```bash
npm install socket.io
npm install --save-dev socket.io-client
```

- [ ] **Step 2: Escrever o teste que falha**

Criar `src/realtime/socket-server.test.js`:

```js
const http = require('http');
const jwt = require('jsonwebtoken');
const { io: ioClient } = require('socket.io-client');
const { initSocketServer, emitToAgent, broadcast, closeSocketServer } = require('./socket-server');

describe('socket server', () => {
  let httpServer;
  let port;

  beforeEach((done) => {
    httpServer = http.createServer();
    initSocketServer(httpServer);
    httpServer.listen(0, () => {
      port = httpServer.address().port;
      done();
    });
  });

  afterEach((done) => {
    closeSocketServer();
    httpServer.close(done);
  });

  function connect(token) {
    return ioClient(`http://localhost:${port}`, {
      auth: { token },
      reconnection: false,
      forceNew: true,
      transports: ['websocket'],
    });
  }

  test('rejects a connection without a valid token', (done) => {
    const client = connect('invalid-token');
    client.on('connect_error', (err) => {
      expect(err.message).toBe('Unauthorized');
      client.close();
      done();
    });
  });

  test('emitToAgent only delivers to the connection in that agent room', (done) => {
    const tokenA = jwt.sign({ agentId: 'agent-a', role: 'agent' }, process.env.JWT_SECRET);
    const tokenB = jwt.sign({ agentId: 'agent-b', role: 'agent' }, process.env.JWT_SECRET);
    const clientA = connect(tokenA);
    const clientB = connect(tokenB);
    let connectedCount = 0;

    function onBothConnected() {
      connectedCount += 1;
      if (connectedCount !== 2) return;
      const receivedByB = jest.fn();
      clientB.on('greeting', receivedByB);
      clientA.on('greeting', (payload) => {
        expect(payload).toEqual({ hello: 'a' });
        expect(receivedByB).not.toHaveBeenCalled();
        clientA.close();
        clientB.close();
        done();
      });
      emitToAgent('agent-a', 'greeting', { hello: 'a' });
    }

    clientA.on('connect', onBothConnected);
    clientB.on('connect', onBothConnected);
  });

  test('broadcast delivers to every connected client', (done) => {
    const token = jwt.sign({ agentId: 'agent-c', role: 'agent' }, process.env.JWT_SECRET);
    const client = connect(token);
    client.on('connect', () => {
      client.on('announcement', (payload) => {
        expect(payload).toEqual({ text: 'hi' });
        client.close();
        done();
      });
      broadcast('announcement', { text: 'hi' });
    });
  });
});
```

- [ ] **Step 3: Rodar o teste e confirmar que falha**

Run: `npm test -- src/realtime/socket-server.test.js`
Expected: FAIL com "Cannot find module './socket-server'"

- [ ] **Step 4: Implementar `src/realtime/socket-server.js`**

```js
const { Server } = require('socket.io');
const { verifyToken } = require('../auth/auth.service');

let io;

function initSocketServer(httpServer) {
  io = new Server(httpServer, { cors: { origin: '*' } });
  io.use((socket, next) => {
    try {
      const payload = verifyToken(socket.handshake.auth && socket.handshake.auth.token);
      socket.agent = payload;
      next();
    } catch (err) {
      next(new Error('Unauthorized'));
    }
  });
  io.on('connection', (socket) => {
    socket.join(`agent:${socket.agent.agentId}`);
  });
  return io;
}

function getSocketServer() {
  if (!io) {
    throw new Error('Socket server not initialized');
  }
  return io;
}

function emitToAgent(agentId, event, payload) {
  getSocketServer().to(`agent:${agentId}`).emit(event, payload);
}

function broadcast(event, payload) {
  getSocketServer().emit(event, payload);
}

function closeSocketServer() {
  if (io) {
    io.close();
    io = undefined;
  }
}

module.exports = { initSocketServer, getSocketServer, emitToAgent, broadcast, closeSocketServer };
```

- [ ] **Step 5: Rodar o teste e confirmar que passa**

Run: `npm test -- src/realtime/socket-server.test.js`
Expected: PASS (3 testes)

- [ ] **Step 6: Integrar em `src/server.js`**

Substituir todo o conteúdo de `src/server.js` por:

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
const { startOutboundWorker } = require('./queue/outbound-worker');
const { initSocketServer } = require('./realtime/socket-server');

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
app.use('/webhooks', metaCloudRoutes);

app.use((err, req, res, next) => {
  console.error('Unhandled API error', err);
  res.status(500).json({ error: 'Internal server error' });
});

if (require.main === module) {
  const httpServer = http.createServer(app);
  initSocketServer(httpServer);
  startOutboundWorker();
  httpServer.listen(config.port, () => {
    console.log('Servidor rodando na porta ' + config.port);
  });
}

module.exports = app;
```

`module.exports = app` continua igual (os testes com `supertest` usam só o app Express, não o `http.Server` — nada muda para eles).

- [ ] **Step 7: Rodar a suíte inteira**

Run: `npm test`
Expected: PASS em todos os arquivos.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json src/realtime/socket-server.js src/realtime/socket-server.test.js src/server.js
git commit -m "feat: add authenticated Socket.io server with per-agent rooms"
```

---

### Task 2: Emitir eventos ao receber mensagem (webhook Meta Cloud)

**Files:**
- Modify: `src/whatsapp-adapters/meta-cloud.routes.js`
- Modify: `src/whatsapp-adapters/meta-cloud.routes.test.js`

**Interfaces:**
- Consumes: `emitToAgent`, `broadcast` (Task 1).
- Produces: para cada mensagem de entrada processada com sucesso, emite `message:new` (para o atendente responsável, se a conversa já estiver atribuída) ou `queue:new` (broadcast, se a conversa estiver sem atendente).

- [ ] **Step 1: Escrever o teste que falha**

Adicionar `jest.mock('../realtime/socket-server');` ao topo de `src/whatsapp-adapters/meta-cloud.routes.test.js`, junto aos outros `jest.mock`, e `const { emitToAgent, broadcast } = require('../realtime/socket-server');` junto aos outros `require`s. Adicionar ao `describe('POST /webhooks/meta', ...)` existente (mantendo os testes já existentes intactos):

```js
test('broadcasts queue:new when the conversation has no assigned agent', async () => {
  findChannelByMetaPhoneNumberId.mockResolvedValue({ id: 'channel-1' });
  ingestInboundMessage.mockResolvedValue({
    conversation: { id: 'conv-1', assignedAgentId: null },
    message: { id: 'msg-1', content: 'Ola' },
  });

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

  await request(buildApp())
    .post('/webhooks/meta')
    .set('X-Hub-Signature-256', signature)
    .set('Content-Type', 'application/json')
    .send(bodyString);

  expect(broadcast).toHaveBeenCalledWith('queue:new', {
    conversation: { id: 'conv-1', assignedAgentId: null },
    message: { id: 'msg-1', content: 'Ola' },
  });
  expect(emitToAgent).not.toHaveBeenCalled();
});

test('emits message:new to the assigned agent when the conversation is already assigned', async () => {
  findChannelByMetaPhoneNumberId.mockResolvedValue({ id: 'channel-1' });
  ingestInboundMessage.mockResolvedValue({
    conversation: { id: 'conv-1', assignedAgentId: 'agent-1' },
    message: { id: 'msg-1', content: 'Ola' },
  });

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

  await request(buildApp())
    .post('/webhooks/meta')
    .set('X-Hub-Signature-256', signature)
    .set('Content-Type', 'application/json')
    .send(bodyString);

  expect(emitToAgent).toHaveBeenCalledWith('agent-1', 'message:new', {
    conversation: { id: 'conv-1', assignedAgentId: 'agent-1' },
    message: { id: 'msg-1', content: 'Ola' },
  });
  expect(broadcast).not.toHaveBeenCalled();
});

test('emits nothing when the message was a duplicate (idempotency short-circuit)', async () => {
  findChannelByMetaPhoneNumberId.mockResolvedValue({ id: 'channel-1' });
  ingestInboundMessage.mockResolvedValue({
    conversation: { id: 'conv-1', assignedAgentId: null },
    message: null,
  });

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

  await request(buildApp())
    .post('/webhooks/meta')
    .set('X-Hub-Signature-256', signature)
    .set('Content-Type', 'application/json')
    .send(bodyString);

  expect(broadcast).not.toHaveBeenCalled();
  expect(emitToAgent).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npm test -- src/whatsapp-adapters/meta-cloud.routes.test.js`
Expected: FAIL — os 3 novos testes falham (nada é emitido ainda), os testes antigos continuam passando.

- [ ] **Step 3: Atualizar `src/whatsapp-adapters/meta-cloud.routes.js`**

Adicionar o `require` no topo:

```js
const { emitToAgent, broadcast } = require('../realtime/socket-server');
```

Substituir o corpo do `for` dentro da rota `POST /meta`:

```js
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
      const result = await ingestInboundMessage({
        channelId: channel.id,
        fromPhoneNumber: inboundMessage.fromPhoneNumber,
        contactDisplayName: inboundMessage.contactDisplayName,
        whatsappMessageId: inboundMessage.whatsappMessageId,
        content: inboundMessage.content,
      });
      if (result.message) {
        if (result.conversation.assignedAgentId) {
          emitToAgent(result.conversation.assignedAgentId, 'message:new', {
            conversation: result.conversation,
            message: result.message,
          });
        } else {
          broadcast('queue:new', {
            conversation: result.conversation,
            message: result.message,
          });
        }
      }
    } catch (err) {
      console.error('Failed to process inbound WhatsApp message', err);
    }
  }
  res.sendStatus(200);
});
```

(As duas rotas restantes do arquivo — `GET /meta` e o `module.exports` — permanecem inalteradas.)

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npm test -- src/whatsapp-adapters/meta-cloud.routes.test.js`
Expected: PASS (8 testes: 5 antigos + 3 novos)

- [ ] **Step 5: Rodar a suíte inteira**

Run: `npm test`
Expected: PASS em todos os arquivos.

- [ ] **Step 6: Commit**

```bash
git add src/whatsapp-adapters/meta-cloud.routes.js src/whatsapp-adapters/meta-cloud.routes.test.js
git commit -m "feat: emit realtime events when an inbound WhatsApp message is ingested"
```

---

### Task 3: Emitir eventos de assumir/transferir/fechar

**Files:**
- Modify: `src/api/conversations.routes.js`
- Modify: `src/api/conversations.routes.test.js`

**Interfaces:**
- Consumes: `emitToAgent`, `broadcast` (Task 1).
- Produces: `POST /:id/claim` emite `queue:removed` (broadcast) + `conversation:assigned` (para o atendente que assumiu). `POST /:id/transfer` emite `conversation:removed` (para o atendente anterior) + `conversation:assigned` (para o novo atendente). `POST /:id/close` emite `conversation:closed` (para o atendente designado, se houver) ou `queue:removed` (broadcast, se a conversa nunca foi atribuída).

- [ ] **Step 1: Escrever o teste que falha**

Adicionar `jest.mock('../realtime/socket-server');` ao topo de `src/api/conversations.routes.test.js`, junto aos outros `jest.mock`, e `const { emitToAgent, broadcast } = require('../realtime/socket-server');` junto aos outros `require`s.

Adicionar ao `describe('POST /api/conversations/:id/claim', ...)` existente:

```js
test('broadcasts queue:removed and notifies the claiming agent on success', async () => {
  claimConversation.mockResolvedValue({ id: 'conv-1', status: 'assigned', assignedAgentId: 'agent-1' });
  await request(buildApp())
    .post(`/api/conversations/${CONVERSATION_ID}/claim`)
    .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
  expect(broadcast).toHaveBeenCalledWith('queue:removed', { conversationId: 'conv-1' });
  expect(emitToAgent).toHaveBeenCalledWith('agent-1', 'conversation:assigned', {
    conversation: { id: 'conv-1', status: 'assigned', assignedAgentId: 'agent-1' },
  });
});

test('does not emit anything when claim fails', async () => {
  claimConversation.mockResolvedValue(null);
  await request(buildApp())
    .post(`/api/conversations/${CONVERSATION_ID}/claim`)
    .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
  expect(broadcast).not.toHaveBeenCalled();
  expect(emitToAgent).not.toHaveBeenCalled();
});
```

Adicionar ao `describe('POST /api/conversations/:id/transfer', ...)` existente:

```js
test('notifies both the previous and new agent on a successful transfer', async () => {
  transferConversation.mockResolvedValue({ id: 'conv-1', assignedAgentId: 'agent-2' });
  await request(buildApp())
    .post(`/api/conversations/${CONVERSATION_ID}/transfer`)
    .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
    .send({ toAgentId: 'agent-2' });
  expect(emitToAgent).toHaveBeenCalledWith('agent-1', 'conversation:removed', { conversationId: 'conv-1' });
  expect(emitToAgent).toHaveBeenCalledWith('agent-2', 'conversation:assigned', {
    conversation: { id: 'conv-1', assignedAgentId: 'agent-2' },
  });
});
```

Adicionar ao `describe('POST /api/conversations/:id/close', ...)` existente:

```js
test('notifies the assigned agent when closing an assigned conversation', async () => {
  closeConversation.mockResolvedValue({ id: 'conv-1', status: 'closed', assignedAgentId: 'agent-1' });
  await request(buildApp())
    .post(`/api/conversations/${CONVERSATION_ID}/close`)
    .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
  expect(emitToAgent).toHaveBeenCalledWith('agent-1', 'conversation:closed', { conversationId: 'conv-1' });
  expect(broadcast).not.toHaveBeenCalled();
});

test('broadcasts queue:removed when closing a conversation that was never assigned', async () => {
  closeConversation.mockResolvedValue({ id: 'conv-1', status: 'closed', assignedAgentId: null });
  await request(buildApp())
    .post(`/api/conversations/${CONVERSATION_ID}/close`)
    .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
  expect(broadcast).toHaveBeenCalledWith('queue:removed', { conversationId: 'conv-1' });
  expect(emitToAgent).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npm test -- src/api/conversations.routes.test.js`
Expected: FAIL — os 4 novos testes falham, os testes antigos continuam passando.

- [ ] **Step 3: Atualizar `src/api/conversations.routes.js`**

Adicionar o `require` no topo:

```js
const { emitToAgent, broadcast } = require('../realtime/socket-server');
```

Atualizar a rota de assumir:

```js
router.post('/:id/claim', async (req, res) => {
  const conversation = await claimConversation(req.params.id, req.agent.agentId);
  if (!conversation) {
    return res.status(409).json({ error: 'Conversation already assigned or closed' });
  }
  broadcast('queue:removed', { conversationId: conversation.id });
  emitToAgent(conversation.assignedAgentId, 'conversation:assigned', { conversation });
  res.json(conversation);
});
```

Atualizar a rota de transferência:

```js
router.post('/:id/transfer', async (req, res) => {
  const { toAgentId } = req.body || {};
  if (!toAgentId) {
    return res.status(400).json({ error: 'toAgentId is required' });
  }
  const conversation = await transferConversation(req.params.id, req.agent.agentId, toAgentId);
  if (!conversation) {
    return res.status(409).json({ error: 'Conversation is not currently assigned to you, or is closed' });
  }
  emitToAgent(req.agent.agentId, 'conversation:removed', { conversationId: conversation.id });
  emitToAgent(toAgentId, 'conversation:assigned', { conversation });
  res.json(conversation);
});
```

Atualizar a rota de fechamento:

```js
router.post('/:id/close', async (req, res) => {
  const conversation = await closeConversation(req.params.id, req.agent.agentId);
  if (!conversation) {
    return res.status(404).json({ error: 'Conversation not found' });
  }
  if (conversation.assignedAgentId) {
    emitToAgent(conversation.assignedAgentId, 'conversation:closed', { conversationId: conversation.id });
  } else {
    broadcast('queue:removed', { conversationId: conversation.id });
  }
  res.json(conversation);
});
```

(As demais rotas do arquivo — `GET /queue`, `GET /mine`, `GET /:id/messages`, `POST /:id/messages` — permanecem inalteradas.)

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npm test -- src/api/conversations.routes.test.js`
Expected: PASS (20 testes: 16 antigos + 4 novos)

- [ ] **Step 5: Rodar a suíte inteira**

Run: `npm test`
Expected: PASS em todos os arquivos.

- [ ] **Step 6: Commit**

```bash
git add src/api/conversations.routes.js src/api/conversations.routes.test.js
git commit -m "feat: emit realtime events on claim, transfer, and close"
```

---

### Task 4: Emitir atualização de status de mensagem de saída

**Files:**
- Modify: `src/queue/outbound-worker.js`
- Modify: `src/queue/outbound-worker.test.js`

**Interfaces:**
- Consumes: `emitToAgent` (Task 1).
- Produces: após o envio (sucesso ou falha), emite `message:updated` para o atendente designado da conversa, se houver.

- [ ] **Step 1: Escrever o teste que falha**

Adicionar `jest.mock('../realtime/socket-server');` ao topo de `src/queue/outbound-worker.test.js`, junto aos outros `jest.mock`, e `const { emitToAgent } = require('../realtime/socket-server');` junto aos outros `require`s. Adicionar ao `describe('startOutboundWorker', ...)` existente (mantendo os dois testes já existentes intactos):

```js
test('emits message:updated to the assigned agent on success', async () => {
  getConversationWithContact.mockResolvedValue({
    id: 'conv-1',
    contactPhoneNumber: '5511999998888',
    assignedAgentId: 'agent-1',
  });
  findChannelById.mockResolvedValue({ id: 'channel-1', config: { phoneNumberId: '123', accessToken: 'tok' } });
  sendTextMessage.mockResolvedValue({ whatsappMessageId: 'wamid.OUT1' });
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
  findChannelById.mockResolvedValue({ id: 'channel-1', config: {} });
  sendTextMessage.mockRejectedValue(new Error('network error'));
  updateMessageStatus.mockResolvedValue({ id: 'msg-2', status: 'failed' });

  await expect(
    handler({ messageId: 'msg-2', conversationId: 'conv-1', channelId: 'channel-1', content: 'Ola' })
  ).rejects.toThrow('network error');

  expect(emitToAgent).toHaveBeenCalledWith('agent-1', 'message:updated', {
    conversationId: 'conv-1',
    message: { id: 'msg-2', status: 'failed' },
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npm test -- src/queue/outbound-worker.test.js`
Expected: FAIL — os 2 novos testes falham, os 2 antigos continuam passando.

- [ ] **Step 3: Atualizar `src/queue/outbound-worker.js`**

```js
const { processOutboundQueue } = require('./outbound-queue');
const { findChannelById } = require('../channels/channel.repository');
const { getConversationWithContact } = require('../conversations/conversation.repository');
const { updateMessageStatus, recordMessageSent } = require('../conversations/message.repository');
const { sendTextMessage } = require('../whatsapp-adapters/meta-cloud.adapter');
const { emitToAgent } = require('../realtime/socket-server');

function startOutboundWorker() {
  processOutboundQueue(async ({ messageId, conversationId, channelId, content }) => {
    const conversation = await getConversationWithContact(conversationId);
    const channel = await findChannelById(channelId);
    try {
      const { whatsappMessageId } = await sendTextMessage(channel, conversation.contactPhoneNumber, content);
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

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npm test -- src/queue/outbound-worker.test.js`
Expected: PASS (4 testes: 2 antigos + 2 novos)

- [ ] **Step 5: Rodar a suíte inteira**

Run: `npm test`
Expected: PASS em todos os arquivos.

- [ ] **Step 6: Commit**

```bash
git add src/queue/outbound-worker.js src/queue/outbound-worker.test.js
git commit -m "feat: emit realtime message status updates from the outbound worker"
```

---

## Self-Review

**Cobertura do spec:** os quatro eventos que o spec pede para `realtime/` — "nova mensagem, conversa entrou na fila, conversa atribuída/transferida, [e a versão de saída] atualização de status de mensagem" — estão cobertos pelas Tasks 2-4. "Atualização de status de canal" (Baileys caiu) fica explicitamente fora de escopo, documentado nos Global Constraints, já que não existe ainda nenhum código que produza esse tipo de evento.

**Placeholders:** nenhum "TBD"/"depois" — todo passo tem código completo e casos de teste reais.

**Consistência de tipos:** `emitToAgent(agentId, event, payload)` e `broadcast(event, payload)` são usados com a mesma assinatura em todos os pontos de chamada (Tasks 2, 3, 4). Os nomes de evento (`message:new`, `queue:new`, `conversation:assigned`, `conversation:removed`, `conversation:closed`, `queue:removed`, `message:updated`) são usados de forma consistente entre onde são emitidos e o que um futuro frontend precisaria escutar — nenhum eco de nome de evento diferente para a mesma situação.
