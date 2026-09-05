# API HTTP de Conversas para Atendentes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expor o motor de conversas (Plano 2) via API REST para atendentes: ver a fila de espera, ver "minhas conversas", assumir, responder, transferir e fechar — o primeiro ponto em que um humano (via um futuro frontend) interage de verdade com o sistema.

**Architecture:** Continua o monólito modular. Adiciona o módulo `api/` (rotas HTTP protegidas por `requireAuth`, do Plano 1) sobre o `conversations/` e `queue/` já existentes (Plano 2). Também fecha uma dívida técnica registrada no Plano 2: adiciona um helper `withTransaction()` ao `db/pool.js` e o usa para tornar `claimConversation`/`transferConversation`/`closeConversation` verdadeiramente atômicos junto com seu registro de auditoria em `conversation_events` — antes, eram duas instruções SQL separadas.

**Tech Stack:** Node.js (CommonJS), Express, PostgreSQL (`pg`), `jsonwebtoken` (só nos testes, para gerar tokens de teste), Jest + Supertest.

**Spec:** [docs/superpowers/specs/2026-09-04-whatsapp-attendance-system-design.md](../specs/2026-09-04-whatsapp-attendance-system-design.md)

## Global Constraints

- Node.js v22.x, CommonJS modules, consistente com os Planos 1 e 2.
- Sem comentários no código exceto onde uma restrição não óbvia exigir explicação.
- Jest configurado com `maxWorkers: 1` — não remover; toda tabela compartilhada usada por testes novos deve continuar segura sob execução serial.
- Testes de repositório usam Postgres real (`getPool()`, sem mocks); testes de rota mockam a camada de repositório/fila diretamente abaixo (mesmo padrão dos Planos 1 e 2). Um teste de rota usa o `requireAuth` **real** (gera um JWT válido de teste com `jsonwebtoken` + `process.env.JWT_SECRET`), não mocka o middleware de autenticação.
- **Modelo de autorização desta v1 (decisão explícita deste plano, não estava no spec original):**
  - Ver fila (`GET /queue`), ver "minhas conversas" (`GET /mine`) e ver histórico (`GET /:id/messages`): qualquer atendente autenticado.
  - Assumir (`POST /:id/claim`): qualquer atendente autenticado, sujeito à atualização atômica existente (`claimConversation` já retorna `null` se a conversa já tiver dono).
  - Enviar mensagem (`POST /:id/messages`): só o atendente atualmente designado para aquela conversa (403 caso contrário).
  - Transferir (`POST /:id/transfer`): só o atendente atualmente designado — reforçado pela própria atualização atômica de `transferConversation` (que já falha se `fromAgentId` não bater), sem checagem adicional na rota.
  - Fechar (`POST /:id/close`): qualquer atendente autenticado, sem checagem de dono — simplificação deliberada para v1 (equipe pequena e confiável); pode ser revisitado depois se necessário.

---

### Task 1: Helper de transação no pool

**Files:**
- Modify: `src/db/pool.js`
- Modify: `src/db/pool.test.js`

**Interfaces:**
- Consumes: `getPool()` (já existente no próprio arquivo).
- Produces: `withTransaction(fn: (client: pg.PoolClient) => Promise<T>): Promise<T>` — executa `fn` dentro de `BEGIN`/`COMMIT`, faz `ROLLBACK` e relança o erro se `fn` rejeitar, sempre libera o client (`finally`).

- [ ] **Step 1: Escrever o teste que falha**

Substituir a primeira linha de `src/db/pool.test.js` (o `require`) e adicionar um novo `describe` ao final do arquivo, mantendo o `describe('getPool', ...)` existente intacto:

```js
const { getPool, closePool, withTransaction } = require('./pool');
const { createChannel } = require('../channels/channel.repository');
```

(Essas duas linhas substituem a única linha de `require` que hoje existe no topo do arquivo.)

Ao final do arquivo, depois do `describe('getPool', ...)` existente, adicionar:

```js
describe('withTransaction', () => {
  beforeEach(async () => {
    await getPool().query('TRUNCATE channels CASCADE');
  });

  afterAll(async () => {
    await closePool();
  });

  test('commits all writes when the callback succeeds', async () => {
    const channel = await createChannel({
      type: 'meta_cloud',
      name: 'Tx Test',
      phoneNumber: '+5511999990030',
      config: {},
    });
    await withTransaction(async (client) => {
      await client.query("UPDATE channels SET status = 'connected' WHERE id = $1", [channel.id]);
    });
    const result = await getPool().query('SELECT status FROM channels WHERE id = $1', [channel.id]);
    expect(result.rows[0].status).toBe('connected');
  });

  test('rolls back all writes when the callback throws', async () => {
    const channel = await createChannel({
      type: 'meta_cloud',
      name: 'Tx Test 2',
      phoneNumber: '+5511999990031',
      config: {},
    });
    await expect(
      withTransaction(async (client) => {
        await client.query("UPDATE channels SET status = 'connected' WHERE id = $1", [channel.id]);
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    const result = await getPool().query('SELECT status FROM channels WHERE id = $1', [channel.id]);
    expect(result.rows[0].status).toBe('disconnected');
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npm test -- src/db/pool.test.js`
Expected: FAIL — `withTransaction` ainda não existe.

- [ ] **Step 3: Implementar `withTransaction` em `src/db/pool.js`**

Adicionar a nova função entre `getPool` e `closePool`, e atualizar o `module.exports`:

```js
async function withTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
```

```js
module.exports = { getPool, closePool, withTransaction };
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npm test -- src/db/pool.test.js`
Expected: PASS (4 testes: 2 antigos + 2 novos)

- [ ] **Step 5: Commit**

```bash
git add src/db/pool.js src/db/pool.test.js
git commit -m "feat: add withTransaction helper to the postgres pool"
```

---

### Task 2: Tornar claim/transfer/close atômicos com o log de auditoria

**Files:**
- Modify: `src/conversations/conversation.repository.js`

**Interfaces:**
- Consumes: `withTransaction()` (Task 1).
- Produces: mesma assinatura pública de `claimConversation`, `transferConversation`, `closeConversation` — comportamento externo idêntico, agora com a garantia de que a atualização da conversa e o registro em `conversation_events` acontecem na mesma transação (ou as duas, ou nenhuma).

Este é um refactor interno puro — nenhum teste novo é necessário; os testes existentes em `src/conversations/conversation.repository.test.js` (do Plano 2) devem continuar passando sem alteração, e são a prova de que o comportamento externo não mudou. (Forçar uma falha real entre as duas instruções para testar o rollback especificamente aqui exigiria mexer no banco por fora da API pública; a Task 1 já prova que `withTransaction` reverte corretamente em um caso genérico — aqui só aplicamos o mecanismo.)

- [ ] **Step 1: Rodar os testes existentes e confirmar que passam (baseline antes do refactor)**

Run: `npm test -- src/conversations/conversation.repository.test.js`
Expected: PASS (todos os testes do Plano 2, sem alteração ainda)

- [ ] **Step 2: Importar `withTransaction` em `src/conversations/conversation.repository.js`**

No topo do arquivo, mudar:

```js
const { getPool } = require('../db/pool');
```

para:

```js
const { getPool, withTransaction } = require('../db/pool');
```

- [ ] **Step 3: Reescrever `claimConversation`**

Substituir o corpo da função por:

```js
async function claimConversation(conversationId, agentId) {
  return withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE conversations SET status = 'assigned', assigned_agent_id = $2, updated_at = now()
       WHERE id = $1 AND assigned_agent_id IS NULL AND status <> 'closed'
       RETURNING id, contact_id, channel_id, status, assigned_agent_id, created_at, updated_at`,
      [conversationId, agentId]
    );
    if (result.rowCount === 0) return null;
    await client.query(
      `INSERT INTO conversation_events (conversation_id, event_type, to_agent_id) VALUES ($1, 'assigned', $2)`,
      [conversationId, agentId]
    );
    return toConversation(result.rows[0]);
  });
}
```

- [ ] **Step 4: Reescrever `transferConversation`**

```js
async function transferConversation(conversationId, fromAgentId, toAgentId) {
  return withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE conversations SET assigned_agent_id = $2, updated_at = now()
       WHERE id = $1 AND assigned_agent_id = $3 AND status <> 'closed'
       RETURNING id, contact_id, channel_id, status, assigned_agent_id, created_at, updated_at`,
      [conversationId, toAgentId, fromAgentId]
    );
    if (result.rowCount === 0) return null;
    await client.query(
      `INSERT INTO conversation_events (conversation_id, event_type, from_agent_id, to_agent_id) VALUES ($1, 'transferred', $2, $3)`,
      [conversationId, fromAgentId, toAgentId]
    );
    return toConversation(result.rows[0]);
  });
}
```

- [ ] **Step 5: Reescrever `closeConversation`**

```js
async function closeConversation(conversationId) {
  return withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE conversations SET status = 'closed', updated_at = now()
       WHERE id = $1 AND status <> 'closed'
       RETURNING id, contact_id, channel_id, status, assigned_agent_id, created_at, updated_at`,
      [conversationId]
    );
    if (result.rowCount === 0) return null;
    await client.query(`INSERT INTO conversation_events (conversation_id, event_type) VALUES ($1, 'closed')`, [
      conversationId,
    ]);
    return toConversation(result.rows[0]);
  });
}
```

- [ ] **Step 6: Rodar os testes existentes e confirmar que ainda passam**

Run: `npm test -- src/conversations/conversation.repository.test.js`
Expected: PASS — mesma contagem de testes de antes do refactor, todos verdes.

- [ ] **Step 7: Rodar a suíte inteira**

Run: `npm test`
Expected: PASS em todos os arquivos.

- [ ] **Step 8: Commit**

```bash
git add src/conversations/conversation.repository.js
git commit -m "fix: make conversation state changes atomic with their audit log entry"
```

---

### Task 3: Consultas de listagem (fila e "minhas conversas")

**Files:**
- Modify: `src/conversations/conversation.repository.js`
- Modify: `src/conversations/conversation.repository.test.js`

**Interfaces:**
- Consumes: `getPool()`, `toConversation()` (já existentes no arquivo).
- Produces:
  - `listWaitingConversations(): Promise<ConversationSummary[]>` — conversas com `status = 'waiting'`, mais antigas primeiro.
  - `listConversationsByAgent(agentId): Promise<ConversationSummary[]>` — conversas não fechadas atribuídas a `agentId`, mais recentemente atualizadas primeiro.
  - Onde `ConversationSummary = Conversation & { contactPhoneNumber: string, contactDisplayName: string | null }`.

- [ ] **Step 1: Escrever o teste que falha**

Adicionar ao final de `src/conversations/conversation.repository.test.js` (mantendo todo o conteúdo existente do Plano 2), dentro do mesmo `describe('conversation repository', ...)` ou logo após seu fechamento — como novos `test(...)` que reutilizam as variáveis `contactId`/`channelId` já preparadas no `beforeEach` existente do arquivo:

```js
test('listWaitingConversations returns only waiting conversations with contact info, oldest first', async () => {
  const otherContact = await findOrCreateContactByPhoneNumber('+5511977775555', 'Segunda Pessoa');
  const waitingConversation = await createConversation(contactId, channelId);
  const assignedConversation = await createConversation(otherContact.id, channelId);
  const agent = await createAgent({ email: 'listagent1@dw.com', password: 'secret123', role: 'agent' });
  await claimConversation(assignedConversation.id, agent.id);

  const waiting = await listWaitingConversations();

  expect(waiting.map((c) => c.id)).toEqual([waitingConversation.id]);
  expect(waiting[0].contactPhoneNumber).toBe('+5511977776666');
  expect(waiting[0].contactDisplayName).toBe('Joao');
});

test('listConversationsByAgent returns only that agent non-closed conversations', async () => {
  const conversation = await createConversation(contactId, channelId);
  const agent = await createAgent({ email: 'listagent2@dw.com', password: 'secret123', role: 'agent' });
  const otherAgent = await createAgent({ email: 'listagent3@dw.com', password: 'secret123', role: 'agent' });
  await claimConversation(conversation.id, agent.id);
  const otherContact = await findOrCreateContactByPhoneNumber('+5511911119999', 'Outra Pessoa');
  const otherConversation = await createConversation(otherContact.id, channelId);
  await claimConversation(otherConversation.id, otherAgent.id);

  const mine = await listConversationsByAgent(agent.id);

  expect(mine.map((c) => c.id)).toEqual([conversation.id]);
});
```

(`findOrCreateContactByPhoneNumber` e `createAgent` já são importados nesse arquivo pelos testes do Plano 2 — se algum não estiver, adicionar o `require` correspondente no topo do arquivo: `const { findOrCreateContactByPhoneNumber } = require('./contact.repository');` e `const { createAgent } = require('../agents/agent.repository');`.)

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npm test -- src/conversations/conversation.repository.test.js`
Expected: FAIL — `listWaitingConversations is not a function` (ou `undefined`).

- [ ] **Step 3: Implementar as duas funções**

Adicionar a `src/conversations/conversation.repository.js`, logo após `getConversationWithContact`:

```js
function toConversationSummary(row) {
  return {
    ...toConversation(row),
    contactPhoneNumber: row.contact_phone_number,
    contactDisplayName: row.contact_display_name,
  };
}

async function listWaitingConversations() {
  const result = await getPool().query(
    `SELECT c.id, c.contact_id, c.channel_id, c.status, c.assigned_agent_id, c.created_at, c.updated_at,
            ct.phone_number AS contact_phone_number, ct.display_name AS contact_display_name
     FROM conversations c
     JOIN contacts ct ON ct.id = c.contact_id
     WHERE c.status = 'waiting'
     ORDER BY c.created_at ASC`
  );
  return result.rows.map(toConversationSummary);
}

async function listConversationsByAgent(agentId) {
  const result = await getPool().query(
    `SELECT c.id, c.contact_id, c.channel_id, c.status, c.assigned_agent_id, c.created_at, c.updated_at,
            ct.phone_number AS contact_phone_number, ct.display_name AS contact_display_name
     FROM conversations c
     JOIN contacts ct ON ct.id = c.contact_id
     WHERE c.assigned_agent_id = $1 AND c.status <> 'closed'
     ORDER BY c.updated_at DESC`,
    [agentId]
  );
  return result.rows.map(toConversationSummary);
}
```

Atualizar o `module.exports` no final do arquivo para incluir as duas novas funções:

```js
module.exports = {
  findOpenConversation,
  createConversation,
  claimConversation,
  transferConversation,
  closeConversation,
  getConversationWithContact,
  listWaitingConversations,
  listConversationsByAgent,
};
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npm test -- src/conversations/conversation.repository.test.js`
Expected: PASS (todos os testes antigos + 2 novos)

- [ ] **Step 5: Commit**

```bash
git add src/conversations/conversation.repository.js src/conversations/conversation.repository.test.js
git commit -m "feat: add listWaitingConversations and listConversationsByAgent"
```

---

### Task 4: Rotas de leitura (fila, minhas conversas, histórico)

**Files:**
- Create: `src/api/conversations.routes.js`
- Test: `src/api/conversations.routes.test.js`

**Interfaces:**
- Consumes: `requireAuth` (Plano 1, `src/auth/auth.middleware.js`); `listWaitingConversations`, `listConversationsByAgent`, `getConversationWithContact` (Task 3 / Plano 2); `listMessagesByConversation` (Plano 2, `src/conversations/message.repository.js`).
- Produces: `GET /queue` (200, array), `GET /mine` (200, array), `GET /:id/messages` (200, array | 404 se a conversa não existir). Todas exigem `Authorization: Bearer <token>` válido (401 caso contrário, via `requireAuth`).

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/api/conversations.routes.test.js`:

```js
jest.mock('../conversations/conversation.repository');
jest.mock('../conversations/message.repository');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const {
  listWaitingConversations,
  listConversationsByAgent,
  getConversationWithContact,
} = require('../conversations/conversation.repository');
const { listMessagesByConversation } = require('../conversations/message.repository');
const conversationsRoutes = require('./conversations.routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/conversations', conversationsRoutes);
  return app;
}

function tokenFor(agentId, role) {
  return jwt.sign({ agentId, role }, process.env.JWT_SECRET);
}

describe('GET /api/conversations/queue', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns the waiting queue for an authenticated agent', async () => {
    listWaitingConversations.mockResolvedValue([{ id: 'conv-1', status: 'waiting' }]);
    const res = await request(buildApp())
      .get('/api/conversations/queue')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 'conv-1', status: 'waiting' }]);
  });

  test('returns 401 without a token', async () => {
    const res = await request(buildApp()).get('/api/conversations/queue');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/conversations/mine', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns conversations assigned to the requesting agent', async () => {
    listConversationsByAgent.mockResolvedValue([{ id: 'conv-2', assignedAgentId: 'agent-1' }]);
    const res = await request(buildApp())
      .get('/api/conversations/mine')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(200);
    expect(listConversationsByAgent).toHaveBeenCalledWith('agent-1');
    expect(res.body).toEqual([{ id: 'conv-2', assignedAgentId: 'agent-1' }]);
  });
});

describe('GET /api/conversations/:id/messages', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns the message history for an existing conversation', async () => {
    getConversationWithContact.mockResolvedValue({ id: 'conv-1' });
    listMessagesByConversation.mockResolvedValue([{ id: 'msg-1', content: 'Oi' }]);
    const res = await request(buildApp())
      .get('/api/conversations/conv-1/messages')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 'msg-1', content: 'Oi' }]);
  });

  test('returns 404 when the conversation does not exist', async () => {
    getConversationWithContact.mockResolvedValue(null);
    const res = await request(buildApp())
      .get('/api/conversations/does-not-exist/messages')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npm test -- src/api/conversations.routes.test.js`
Expected: FAIL com "Cannot find module './conversations.routes'"

- [ ] **Step 3: Implementar `src/api/conversations.routes.js`**

```js
const express = require('express');
const { requireAuth } = require('../auth/auth.middleware');
const {
  listWaitingConversations,
  listConversationsByAgent,
  getConversationWithContact,
} = require('../conversations/conversation.repository');
const { listMessagesByConversation } = require('../conversations/message.repository');

const router = express.Router();

router.use(requireAuth);

router.get('/queue', async (req, res) => {
  const conversations = await listWaitingConversations();
  res.json(conversations);
});

router.get('/mine', async (req, res) => {
  const conversations = await listConversationsByAgent(req.agent.agentId);
  res.json(conversations);
});

router.get('/:id/messages', async (req, res) => {
  const conversation = await getConversationWithContact(req.params.id);
  if (!conversation) {
    return res.sendStatus(404);
  }
  const messages = await listMessagesByConversation(req.params.id);
  res.json(messages);
});

module.exports = router;
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npm test -- src/api/conversations.routes.test.js`
Expected: PASS (5 testes)

- [ ] **Step 5: Commit**

```bash
git add src/api/conversations.routes.js src/api/conversations.routes.test.js
git commit -m "feat: add read endpoints for the attendant conversations API"
```

---

### Task 5: Rota de assumir conversa

**Files:**
- Modify: `src/api/conversations.routes.js`
- Modify: `src/api/conversations.routes.test.js`

**Interfaces:**
- Consumes: `claimConversation` (Plano 2).
- Produces: `POST /:id/claim` — 200 com a conversa atualizada, ou 409 se já estiver atribuída/fechada.

- [ ] **Step 1: Escrever o teste que falha**

Adicionar a `src/api/conversations.routes.test.js`:

```js
describe('POST /api/conversations/:id/claim', () => {
  beforeEach(() => jest.clearAllMocks());

  test('claims a waiting conversation for the requesting agent', async () => {
    claimConversation.mockResolvedValue({ id: 'conv-1', status: 'assigned', assignedAgentId: 'agent-1' });
    const res = await request(buildApp())
      .post('/api/conversations/conv-1/claim')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(200);
    expect(claimConversation).toHaveBeenCalledWith('conv-1', 'agent-1');
    expect(res.body.status).toBe('assigned');
  });

  test('returns 409 when the conversation is already assigned or closed', async () => {
    claimConversation.mockResolvedValue(null);
    const res = await request(buildApp())
      .post('/api/conversations/conv-1/claim')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(409);
  });
});
```

Adicionar `claimConversation` à lista de funções desestruturadas do `require('../conversations/conversation.repository')` no topo do arquivo de teste.

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npm test -- src/api/conversations.routes.test.js`
Expected: FAIL — rota `POST /:id/claim` não existe (404).

- [ ] **Step 3: Adicionar a rota**

Em `src/api/conversations.routes.js`, adicionar `claimConversation` ao `require` de `../conversations/conversation.repository`, e adicionar a rota antes do `module.exports`:

```js
router.post('/:id/claim', async (req, res) => {
  const conversation = await claimConversation(req.params.id, req.agent.agentId);
  if (!conversation) {
    return res.status(409).json({ error: 'Conversation already assigned or closed' });
  }
  res.json(conversation);
});
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npm test -- src/api/conversations.routes.test.js`
Expected: PASS (7 testes)

- [ ] **Step 5: Commit**

```bash
git add src/api/conversations.routes.js src/api/conversations.routes.test.js
git commit -m "feat: add claim endpoint for the attendant conversations API"
```

---

### Task 6: Rota de envio de mensagem

**Files:**
- Modify: `src/api/conversations.routes.js`
- Modify: `src/api/conversations.routes.test.js`

**Interfaces:**
- Consumes: `getConversationWithContact` (já usado); `enqueueOutboundMessage` (Plano 2, `src/queue/outbound-queue.js`).
- Produces: `POST /:id/messages` — body `{content}`; 400 se `content` ausente; 404 se a conversa não existir; 403 se o solicitante não for o atendente designado; 201 com a mensagem criada em caso de sucesso.

- [ ] **Step 1: Escrever o teste que falha**

Adicionar a `src/api/conversations.routes.test.js` (e `jest.mock('../queue/outbound-queue');` no topo do arquivo, junto aos outros `jest.mock`):

```js
describe('POST /api/conversations/:id/messages', () => {
  beforeEach(() => jest.clearAllMocks());

  test('enqueues a message when the requester is the assigned agent', async () => {
    getConversationWithContact.mockResolvedValue({ id: 'conv-1', channelId: 'channel-1', assignedAgentId: 'agent-1' });
    enqueueOutboundMessage.mockResolvedValue({ id: 'msg-1', status: 'sent' });
    const res = await request(buildApp())
      .post('/api/conversations/conv-1/messages')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ content: 'Ola cliente' });
    expect(res.status).toBe(201);
    expect(enqueueOutboundMessage).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      channelId: 'channel-1',
      content: 'Ola cliente',
    });
    expect(res.body).toEqual({ id: 'msg-1', status: 'sent' });
  });

  test('returns 400 when content is missing', async () => {
    const res = await request(buildApp())
      .post('/api/conversations/conv-1/messages')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({});
    expect(res.status).toBe(400);
    expect(enqueueOutboundMessage).not.toHaveBeenCalled();
  });

  test('returns 404 when the conversation does not exist', async () => {
    getConversationWithContact.mockResolvedValue(null);
    const res = await request(buildApp())
      .post('/api/conversations/does-not-exist/messages')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ content: 'Ola' });
    expect(res.status).toBe(404);
  });

  test('returns 403 when the requester is not the assigned agent', async () => {
    getConversationWithContact.mockResolvedValue({ id: 'conv-1', channelId: 'channel-1', assignedAgentId: 'agent-2' });
    const res = await request(buildApp())
      .post('/api/conversations/conv-1/messages')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ content: 'Ola' });
    expect(res.status).toBe(403);
    expect(enqueueOutboundMessage).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npm test -- src/api/conversations.routes.test.js`
Expected: FAIL — rota `POST /:id/messages` não existe (404 em todos os casos, inclusive os que esperam 400/403).

- [ ] **Step 3: Adicionar a rota**

Em `src/api/conversations.routes.js`, adicionar `const { enqueueOutboundMessage } = require('../queue/outbound-queue');` ao topo, e a rota:

```js
router.post('/:id/messages', async (req, res) => {
  const { content } = req.body || {};
  if (!content) {
    return res.status(400).json({ error: 'content is required' });
  }
  const conversation = await getConversationWithContact(req.params.id);
  if (!conversation) {
    return res.sendStatus(404);
  }
  if (conversation.assignedAgentId !== req.agent.agentId) {
    return res.status(403).json({ error: 'Only the assigned agent can send messages on this conversation' });
  }
  const message = await enqueueOutboundMessage({
    conversationId: conversation.id,
    channelId: conversation.channelId,
    content,
  });
  res.status(201).json(message);
});
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npm test -- src/api/conversations.routes.test.js`
Expected: PASS (11 testes)

- [ ] **Step 5: Commit**

```bash
git add src/api/conversations.routes.js src/api/conversations.routes.test.js
git commit -m "feat: add send-message endpoint for the attendant conversations API"
```

---

### Task 7: Rota de transferência

**Files:**
- Modify: `src/api/conversations.routes.js`
- Modify: `src/api/conversations.routes.test.js`

**Interfaces:**
- Consumes: `transferConversation` (Plano 2).
- Produces: `POST /:id/transfer` — body `{toAgentId}`; 400 se ausente; 409 se a conversa não estiver atualmente atribuída ao solicitante (ou estiver fechada); 200 com a conversa atualizada em caso de sucesso.

- [ ] **Step 1: Escrever o teste que falha**

Adicionar a `src/api/conversations.routes.test.js`:

```js
describe('POST /api/conversations/:id/transfer', () => {
  beforeEach(() => jest.clearAllMocks());

  test('transfers the conversation when the requester currently owns it', async () => {
    transferConversation.mockResolvedValue({ id: 'conv-1', assignedAgentId: 'agent-2' });
    const res = await request(buildApp())
      .post('/api/conversations/conv-1/transfer')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ toAgentId: 'agent-2' });
    expect(res.status).toBe(200);
    expect(transferConversation).toHaveBeenCalledWith('conv-1', 'agent-1', 'agent-2');
    expect(res.body.assignedAgentId).toBe('agent-2');
  });

  test('returns 400 when toAgentId is missing', async () => {
    const res = await request(buildApp())
      .post('/api/conversations/conv-1/transfer')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({});
    expect(res.status).toBe(400);
    expect(transferConversation).not.toHaveBeenCalled();
  });

  test('returns 409 when the requester does not currently own the conversation', async () => {
    transferConversation.mockResolvedValue(null);
    const res = await request(buildApp())
      .post('/api/conversations/conv-1/transfer')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ toAgentId: 'agent-2' });
    expect(res.status).toBe(409);
  });
});
```

Adicionar `transferConversation` à lista desestruturada do `require('../conversations/conversation.repository')` no topo do arquivo de teste.

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npm test -- src/api/conversations.routes.test.js`
Expected: FAIL — rota `POST /:id/transfer` não existe.

- [ ] **Step 3: Adicionar a rota**

Em `src/api/conversations.routes.js`, adicionar `transferConversation` ao `require` de `../conversations/conversation.repository`, e a rota:

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
  res.json(conversation);
});
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npm test -- src/api/conversations.routes.test.js`
Expected: PASS (14 testes)

- [ ] **Step 5: Commit**

```bash
git add src/api/conversations.routes.js src/api/conversations.routes.test.js
git commit -m "feat: add transfer endpoint for the attendant conversations API"
```

---

### Task 8: Rota de fechamento + integração no servidor

**Files:**
- Modify: `src/api/conversations.routes.js`
- Modify: `src/api/conversations.routes.test.js`
- Modify: `src/server.js`

**Interfaces:**
- Consumes: `closeConversation` (Plano 2).
- Produces: `POST /:id/close` — 404 se a conversa não existir ou já estiver fechada; 200 com a conversa fechada em caso de sucesso. `src/server.js` monta o router em `/api/conversations`.

- [ ] **Step 1: Escrever o teste que falha**

Adicionar a `src/api/conversations.routes.test.js`:

```js
describe('POST /api/conversations/:id/close', () => {
  beforeEach(() => jest.clearAllMocks());

  test('closes an open conversation', async () => {
    closeConversation.mockResolvedValue({ id: 'conv-1', status: 'closed' });
    const res = await request(buildApp())
      .post('/api/conversations/conv-1/close')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('closed');
  });

  test('returns 404 when the conversation does not exist or is already closed', async () => {
    closeConversation.mockResolvedValue(null);
    const res = await request(buildApp())
      .post('/api/conversations/conv-1/close')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(404);
  });
});
```

Adicionar `closeConversation` à lista desestruturada do `require('../conversations/conversation.repository')` no topo do arquivo de teste.

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npm test -- src/api/conversations.routes.test.js`
Expected: FAIL — rota `POST /:id/close` não existe.

- [ ] **Step 3: Adicionar a rota**

Em `src/api/conversations.routes.js`, adicionar `closeConversation` ao `require` de `../conversations/conversation.repository`, e a rota:

```js
router.post('/:id/close', async (req, res) => {
  const conversation = await closeConversation(req.params.id);
  if (!conversation) {
    return res.sendStatus(404);
  }
  res.json(conversation);
});
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npm test -- src/api/conversations.routes.test.js`
Expected: PASS (16 testes)

- [ ] **Step 5: Integrar em `src/server.js`**

Adicionar o `require` junto aos outros, e montar a rota:

```js
const conversationsRoutes = require('./api/conversations.routes');
```

```js
app.use('/api/conversations', conversationsRoutes);
```

(Adicionar essas duas linhas nos mesmos lugares onde `authRoutes`/`metaCloudRoutes` já são importadas e montadas — o restante do arquivo permanece inalterado.)

- [ ] **Step 6: Rodar a suíte inteira**

Run: `npm test`
Expected: PASS em todos os arquivos.

- [ ] **Step 7: Commit**

```bash
git add src/api/conversations.routes.js src/api/conversations.routes.test.js src/server.js
git commit -m "feat: add close endpoint and mount the attendant conversations API"
```

---

## Self-Review

**Cobertura do spec:** o fluxo de saída completo do spec ("Frontend chama POST /api/conversations/:id/messages... enfileirada na fila Bull...") e a regra de fila/distribuição ("Assumir é uma atualização atômica...", "Transferência troca assigned_agent_id e registra evento") estão cobertos e agora expostos via HTTP. `realtime/` (Socket.io) continua fora de escopo — as atualizações via WebSocket para os outros atendentes conectados ficam para um plano futuro; por ora, um atendente só vê mudanças ao recarregar `/queue`/`/mine`. Isso é uma limitação conhecida e aceitável até o plano de tempo real.

**Placeholders:** nenhum "TBD"/"depois" — todo passo tem código completo, comandos exatos e casos de teste reais.

**Consistência de tipos:** `ConversationSummary` (Task 3) estende `Conversation` sem quebrar nenhum consumidor existente de `toConversation`. `req.agent.agentId`/`req.agent.role` usados em todas as rotas correspondem exatamente ao payload que `verifyToken` (Plano 1) decodifica do JWT. Os nomes de campo em toda a cadeia de teste (`conversationId`, `channelId`, `assignedAgentId`, `toAgentId`) batem com as assinaturas reais dos repositórios dos Planos 1 e 2.
