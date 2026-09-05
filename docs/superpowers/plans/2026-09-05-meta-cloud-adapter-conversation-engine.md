# Adaptador Meta Cloud API + Motor de Conversas + Fila de Envio — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Conectar os 2 números oficiais (Meta Cloud API) ao backend, persistindo o fluxo completo de mensagens (recebida → conversa → banco) e permitindo respostas de saída via uma fila confiável (Bull/Redis), sem ainda expor isso a uma API HTTP para atendentes (isso é o próximo plano).

**Architecture:** Continua o monólito modular do Plano 1. Adiciona três módulos novos: `channels/` (cadastro dos números), `conversations/` (contatos, conversas, mensagens — a lógica de negócio central), `whatsapp-adapters/` (tradução do formato Meta Cloud para o formato interno, nos dois sentidos) e `queue/` (fila de envio via Bull/Redis). O webhook de entrada grava direto no banco via o motor de conversas; o envio de saída passa pela fila antes de chamar a API da Meta, para respeitar limite de taxa e permitir retry.

**Tech Stack:** Node.js (CommonJS), Express, PostgreSQL (`pg`), Redis (`ioredis` já é dependência, mas este plano usa a lib `bull` diretamente, que gerencia sua própria conexão Redis), `axios` (chamadas à Graph API), `crypto` (nativo, validação de assinatura do webhook), Jest + Supertest.

**Spec:** [docs/superpowers/specs/2026-09-04-whatsapp-attendance-system-design.md](../specs/2026-09-04-whatsapp-attendance-system-design.md)

## Global Constraints

- Node.js v22.x, CommonJS modules, consistente com o Plano 1.
- Sem comentários no código exceto onde uma restrição não óbvia exigir explicação.
- Jest configurado com `maxWorkers: 1` (herdado do Plano 1) — todo teste novo que grava no Postgres real deve continuar respeitando essa serialização; não remover essa configuração.
- Testes de repositório (camada de banco) e da fila (Bull/Redis) usam infraestrutura real — Postgres e Redis locais — nunca mocks nesses dois casos. Testes de serviço/adapter/rota mockam apenas a camada imediatamente abaixo (mesmo padrão do Plano 1).
- `channels.config` é uma coluna `JSONB`: sempre gravar com `JSON.stringify(config)`; a leitura já volta como objeto JS (o driver `pg` faz o parse automaticamente).
- **Escopo desta v1 do adaptador:** apenas mensagens de texto são processadas (mensagens de outros tipos — imagem, áudio, etc. — são ignoradas na entrada). Webhooks de status de entrega (`delivered`/`read`) e roteamento por departamento continuam fora de escopo, conforme o spec.
- `loadConfig()` (`src/config/env.js`, do Plano 1) valida variáveis obrigatórias na inicialização; este plano estende a lista obrigatória.

## Pré-requisito manual (antes de começar)

Este plano precisa de um Redis alcançável para desenvolvimento/teste local, além do Postgres já usado no Plano 1. Via Docker:

```bash
docker run --name dw-whatsapp-redis -p 6379:6379 -d redis:7
```

Confirme que está rodando: `docker ps` deve listar `dw-whatsapp-redis` e `dw-whatsapp-postgres`.

---

### Task 1: Estender configuração de ambiente (Redis + Meta Cloud)

**Files:**
- Modify: `src/config/env.js`
- Modify: `src/config/env.test.js` (reescrita completa)
- Modify: `.env.test.example`

**Interfaces:**
- Produces: `loadConfig(): { port, databaseUrl, jwtSecret, redisUrl, metaVerifyToken, metaAppSecret }` — lança `Error` listando todas as variáveis obrigatórias ausentes.

- [ ] **Step 1: Reescrever o teste (falha esperada)**

Substituir todo o conteúdo de `src/config/env.test.js` por:

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

  test('lists all missing variables together', () => {
    process.env = {};
    expect(() => loadConfig()).toThrow(
      'Missing required environment variables: DATABASE_URL, JWT_SECRET, REDIS_URL, META_VERIFY_TOKEN, META_APP_SECRET'
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

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npm test -- src/config/env.test.js`
Expected: FAIL — as novas variáveis não são validadas ainda.

- [ ] **Step 3: Atualizar `src/config/env.js`**

```js
function loadConfig() {
  const required = ['DATABASE_URL', 'JWT_SECRET', 'REDIS_URL', 'META_VERIFY_TOKEN', 'META_APP_SECRET'];
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
  };
}

module.exports = { loadConfig };
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npm test -- src/config/env.test.js`
Expected: PASS (8 testes)

- [ ] **Step 5: Atualizar `.env.test.example`**

```
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/dw_whatsapp_test
JWT_SECRET=test-secret
REDIS_URL=redis://127.0.0.1:6379
META_VERIFY_TOKEN=test-verify-token
META_APP_SECRET=test-app-secret
```

Copie também para o seu `.env.test` local (não versionado): `cp .env.test.example .env.test`.

- [ ] **Step 6: Rodar a suíte inteira e confirmar que nada mais quebrou**

Run: `npm test`
Expected: PASS em todos os arquivos (as rotas/servidor do Plano 1 usam `loadConfig()`, então precisam das novas variáveis no `.env.test` para continuar passando).

- [ ] **Step 7: Commit**

```bash
git add src/config/env.js src/config/env.test.js .env.test.example
git commit -m "feat: extend env config with Redis and Meta Cloud credentials"
```

---

### Task 2: Módulo de conexão Redis

**Files:**
- Create: `src/queue/redis.js`
- Test: `src/queue/redis.test.js`

**Interfaces:**
- Consumes: `loadConfig()` (Task 1).
- Produces: `getRedisClient(): ioredis.Redis` (singleton), `closeRedisClient(): Promise<void>`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/queue/redis.test.js`:

```js
const { getRedisClient, closeRedisClient } = require('./redis');

describe('getRedisClient', () => {
  afterAll(async () => {
    await closeRedisClient();
  });

  test('connects to redis and can set/get a value', async () => {
    const client = getRedisClient();
    await client.set('plan2-test-key', 'test-value');
    const value = await client.get('plan2-test-key');
    expect(value).toBe('test-value');
  });

  test('returns the same client instance on repeated calls', () => {
    const first = getRedisClient();
    const second = getRedisClient();
    expect(first).toBe(second);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npm test -- src/queue/redis.test.js`
Expected: FAIL com "Cannot find module './redis'"

- [ ] **Step 3: Implementar `src/queue/redis.js`**

```js
const Redis = require('ioredis');
const { loadConfig } = require('../config/env');

let client;

function getRedisClient() {
  if (!client) {
    const config = loadConfig();
    client = new Redis(config.redisUrl);
    client.on('error', (err) => {
      console.error('Unexpected error on Redis client', err);
    });
  }
  return client;
}

async function closeRedisClient() {
  if (client) {
    await client.quit();
    client = undefined;
  }
}

module.exports = { getRedisClient, closeRedisClient };
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npm test -- src/queue/redis.test.js`
Expected: PASS (2 testes). Requer o Redis local do pré-requisito rodando.

- [ ] **Step 5: Commit**

```bash
git add src/queue/redis.js src/queue/redis.test.js
git commit -m "feat: add redis connection client"
```

---

### Task 3: Migração — identificador do canal e índices de consulta

**Files:**
- Create: `migrations/*_add-channel-phone-number-and-indexes.js`
- Modify: `src/db/schema.test.js`

**Interfaces:**
- Consumes: `getPool()`/`closePool()` (Plano 1).
- Produces: coluna `channels.phone_number` (com índice único parcial), e índices em `messages(conversation_id, created_at)`, `conversations(status)`, `conversations(assigned_agent_id)`.

- [ ] **Step 1: Escrever o teste que falha**

Adicionar ao final de `src/db/schema.test.js` (mantendo o conteúdo existente do Plano 1):

```js
test('channels has a phone_number column', async () => {
  const pool = getPool();
  const result = await pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'channels' AND column_name = 'phone_number'"
  );
  expect(result.rowCount).toBe(1);
});

test.each([
  'channels_phone_number_unique',
  'messages_conversation_id_created_at_idx',
  'conversations_status_idx',
  'conversations_assigned_agent_id_idx',
])('index %s exists', async (indexName) => {
  const pool = getPool();
  const result = await pool.query('SELECT indexname FROM pg_indexes WHERE indexname = $1', [indexName]);
  expect(result.rowCount).toBe(1);
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npm test -- src/db/schema.test.js`
Expected: FAIL — coluna e índices ainda não existem.

- [ ] **Step 3: Criar a migração**

```bash
npx node-pg-migrate create add-channel-phone-number-and-indexes
```

Conteúdo do arquivo gerado (nome exato terá um timestamp — usar este conteúdo):

```js
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE channels ADD COLUMN phone_number TEXT;
    CREATE UNIQUE INDEX channels_phone_number_unique ON channels (phone_number) WHERE phone_number IS NOT NULL;
    CREATE INDEX messages_conversation_id_created_at_idx ON messages (conversation_id, created_at);
    CREATE INDEX conversations_status_idx ON conversations (status);
    CREATE INDEX conversations_assigned_agent_id_idx ON conversations (assigned_agent_id);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX conversations_assigned_agent_id_idx;
    DROP INDEX conversations_status_idx;
    DROP INDEX messages_conversation_id_created_at_idx;
    DROP INDEX channels_phone_number_unique;
    ALTER TABLE channels DROP COLUMN phone_number;
  `);
};
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npm test -- src/db/schema.test.js`
Expected: PASS (o `pretest` do `npm test` já aplica a migração automaticamente antes do Jest rodar)

- [ ] **Step 5: Commit**

```bash
git add migrations/ src/db/schema.test.js
git commit -m "feat: add channel phone_number column and conversation/message indexes"
```

---

### Task 4: Repositório de canais

**Files:**
- Create: `src/channels/channel.repository.js`
- Test: `src/channels/channel.repository.test.js`

**Interfaces:**
- Consumes: `getPool()` (Plano 1).
- Produces:
  - `createChannel({ type, name, phoneNumber, config }): Promise<{ id, type, name, phoneNumber, config, status, createdAt }>`
  - `findChannelById(id): Promise<{...} | null>`
  - `findChannelByMetaPhoneNumberId(phoneNumberId): Promise<{...} | null>` — busca por `config.phoneNumberId` (específico do tipo `meta_cloud`).

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/channels/channel.repository.test.js`:

```js
const { getPool, closePool } = require('../db/pool');
const { createChannel, findChannelById, findChannelByMetaPhoneNumberId } = require('./channel.repository');

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
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npm test -- src/channels/channel.repository.test.js`
Expected: FAIL com "Cannot find module './channel.repository'"

- [ ] **Step 3: Implementar `src/channels/channel.repository.js`**

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

module.exports = { createChannel, findChannelById, findChannelByMetaPhoneNumberId };
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npm test -- src/channels/channel.repository.test.js`
Expected: PASS (4 testes)

- [ ] **Step 5: Commit**

```bash
git add src/channels/channel.repository.js src/channels/channel.repository.test.js
git commit -m "feat: add channel repository"
```

---

### Task 5: Script para cadastrar um canal

**Files:**
- Create: `scripts/create-channel.js`

**Interfaces:**
- Consumes: `createChannel()` (Task 4), `closePool()` (Plano 1).

- [ ] **Step 1: Implementar `scripts/create-channel.js`**

```js
require('dotenv').config();
const { createChannel } = require('../src/channels/channel.repository');
const { closePool } = require('../src/db/pool');

async function main() {
  const [, , type, name, phoneNumber, phoneNumberId, accessToken] = process.argv;
  if (!type || !name || !phoneNumber) {
    console.error(
      'Usage: node scripts/create-channel.js <type: meta_cloud|baileys> <name> <phoneNumber> [phoneNumberId] [accessToken]'
    );
    process.exitCode = 1;
    return;
  }
  const config = type === 'meta_cloud' ? { phoneNumberId, accessToken } : {};
  const channel = await createChannel({ type, name, phoneNumber, config });
  console.log('Channel created:', channel);
}

main()
  .catch((err) => {
    console.error('Failed to create channel:', err.message);
    process.exitCode = 1;
  })
  .finally(() => closePool());
```

- [ ] **Step 2: Verificação manual**

```bash
dotenv -e .env.test -- node scripts/create-channel.js meta_cloud "Canal Teste" "+5511999990099" "1112223330" "token-de-teste"
```

Confirmar que o console mostra o canal criado com um `id`.

- [ ] **Step 3: Commit**

```bash
git add scripts/create-channel.js
git commit -m "feat: add CLI script to register a channel"
```

---

### Task 6: Repositório de contatos

**Files:**
- Create: `src/conversations/contact.repository.js`
- Test: `src/conversations/contact.repository.test.js`

**Interfaces:**
- Consumes: `getPool()` (Plano 1).
- Produces: `findOrCreateContactByPhoneNumber(phoneNumber, displayName): Promise<{ id, phoneNumber, displayName, createdAt }>`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/conversations/contact.repository.test.js`:

```js
const { getPool, closePool } = require('../db/pool');
const { findOrCreateContactByPhoneNumber } = require('./contact.repository');

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
  });

  test('returns the existing contact on a second call with the same phone number', async () => {
    const first = await findOrCreateContactByPhoneNumber('+5511988887777', 'Maria');
    const second = await findOrCreateContactByPhoneNumber('+5511988887777', 'Maria');
    expect(second.id).toBe(first.id);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npm test -- src/conversations/contact.repository.test.js`
Expected: FAIL com "Cannot find module './contact.repository'"

- [ ] **Step 3: Implementar `src/conversations/contact.repository.js`**

```js
const { getPool } = require('../db/pool');

function toContact(row) {
  return { id: row.id, phoneNumber: row.phone_number, displayName: row.display_name, createdAt: row.created_at };
}

async function findOrCreateContactByPhoneNumber(phoneNumber, displayName) {
  const existing = await getPool().query(
    'SELECT id, phone_number, display_name, created_at FROM contacts WHERE phone_number = $1',
    [phoneNumber]
  );
  if (existing.rowCount > 0) {
    return toContact(existing.rows[0]);
  }
  const inserted = await getPool().query(
    `INSERT INTO contacts (phone_number, display_name) VALUES ($1, $2)
     ON CONFLICT (phone_number) DO UPDATE SET phone_number = EXCLUDED.phone_number
     RETURNING id, phone_number, display_name, created_at`,
    [phoneNumber, displayName || null]
  );
  return toContact(inserted.rows[0]);
}

module.exports = { findOrCreateContactByPhoneNumber };
```

Nota: o `ON CONFLICT DO UPDATE` (em vez de checar-depois-inserir) evita uma condição de corrida se duas mensagens do mesmo contato novo chegarem quase simultaneamente.

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npm test -- src/conversations/contact.repository.test.js`
Expected: PASS (2 testes)

- [ ] **Step 5: Commit**

```bash
git add src/conversations/contact.repository.js src/conversations/contact.repository.test.js
git commit -m "feat: add contact repository"
```

---

### Task 7: Repositório de conversas

**Files:**
- Create: `src/conversations/conversation.repository.js`
- Test: `src/conversations/conversation.repository.test.js`

**Interfaces:**
- Consumes: `getPool()` (Plano 1); `createChannel()` (Task 4); `findOrCreateContactByPhoneNumber()` (Task 6); `createAgent()` (Plano 1).
- Produces:
  - `findOpenConversation(contactId, channelId): Promise<Conversation | null>`
  - `createConversation(contactId, channelId): Promise<Conversation>`
  - `claimConversation(conversationId, agentId): Promise<Conversation | null>` — `null` se já atribuída (atualização atômica).
  - `transferConversation(conversationId, fromAgentId, toAgentId): Promise<Conversation | null>`
  - `closeConversation(conversationId): Promise<Conversation | null>`
  - `getConversationWithContact(conversationId): Promise<(Conversation & { contactPhoneNumber: string }) | null>`
  - Onde `Conversation = { id, contactId, channelId, status, assignedAgentId, createdAt, updatedAt }`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/conversations/conversation.repository.test.js`:

```js
const { getPool, closePool } = require('../db/pool');
const { createChannel } = require('../channels/channel.repository');
const { findOrCreateContactByPhoneNumber } = require('./contact.repository');
const { createAgent } = require('../agents/agent.repository');
const {
  findOpenConversation,
  createConversation,
  claimConversation,
  transferConversation,
  closeConversation,
  getConversationWithContact,
} = require('./conversation.repository');

describe('conversation repository', () => {
  let contactId;
  let channelId;

  beforeEach(async () => {
    await getPool().query('TRUNCATE conversations, contacts, channels, agents, conversation_events CASCADE');
    const contact = await findOrCreateContactByPhoneNumber('+5511977776666', 'Joao');
    const channel = await createChannel({
      type: 'meta_cloud',
      name: 'Canal Teste',
      phoneNumber: '+5511999990009',
      config: { phoneNumberId: '111', accessToken: 'tok' },
    });
    contactId = contact.id;
    channelId = channel.id;
  });

  afterAll(async () => {
    await closePool();
  });

  test('findOpenConversation returns null when none exists', async () => {
    const conversation = await findOpenConversation(contactId, channelId);
    expect(conversation).toBeNull();
  });

  test('createConversation starts a conversation in waiting status', async () => {
    const conversation = await createConversation(contactId, channelId);
    expect(conversation.status).toBe('waiting');
    expect(conversation.assignedAgentId).toBeNull();
  });

  test('findOpenConversation finds the created conversation', async () => {
    const created = await createConversation(contactId, channelId);
    const found = await findOpenConversation(contactId, channelId);
    expect(found.id).toBe(created.id);
  });

  test('claimConversation assigns an unassigned conversation atomically', async () => {
    const conversation = await createConversation(contactId, channelId);
    const agent = await createAgent({ email: 'agent1@dw.com', password: 'secret123', role: 'agent' });
    const claimed = await claimConversation(conversation.id, agent.id);
    expect(claimed.status).toBe('assigned');
    expect(claimed.assignedAgentId).toBe(agent.id);
  });

  test('claimConversation returns null when already assigned', async () => {
    const conversation = await createConversation(contactId, channelId);
    const agent1 = await createAgent({ email: 'agent2@dw.com', password: 'secret123', role: 'agent' });
    const agent2 = await createAgent({ email: 'agent3@dw.com', password: 'secret123', role: 'agent' });
    await claimConversation(conversation.id, agent1.id);
    const secondClaim = await claimConversation(conversation.id, agent2.id);
    expect(secondClaim).toBeNull();
  });

  test('transferConversation moves the conversation to another agent', async () => {
    const conversation = await createConversation(contactId, channelId);
    const agent1 = await createAgent({ email: 'agent4@dw.com', password: 'secret123', role: 'agent' });
    const agent2 = await createAgent({ email: 'agent5@dw.com', password: 'secret123', role: 'agent' });
    await claimConversation(conversation.id, agent1.id);
    const transferred = await transferConversation(conversation.id, agent1.id, agent2.id);
    expect(transferred.assignedAgentId).toBe(agent2.id);
  });

  test('closeConversation marks the conversation closed', async () => {
    const conversation = await createConversation(contactId, channelId);
    const closed = await closeConversation(conversation.id);
    expect(closed.status).toBe('closed');
  });

  test('getConversationWithContact includes the contact phone number', async () => {
    const conversation = await createConversation(contactId, channelId);
    const result = await getConversationWithContact(conversation.id);
    expect(result.id).toBe(conversation.id);
    expect(result.contactPhoneNumber).toBe('+5511977776666');
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npm test -- src/conversations/conversation.repository.test.js`
Expected: FAIL com "Cannot find module './conversation.repository'"

- [ ] **Step 3: Implementar `src/conversations/conversation.repository.js`**

```js
const { getPool } = require('../db/pool');

function toConversation(row) {
  return {
    id: row.id,
    contactId: row.contact_id,
    channelId: row.channel_id,
    status: row.status,
    assignedAgentId: row.assigned_agent_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function findOpenConversation(contactId, channelId) {
  const result = await getPool().query(
    `SELECT id, contact_id, channel_id, status, assigned_agent_id, created_at, updated_at
     FROM conversations WHERE contact_id = $1 AND channel_id = $2 AND status <> 'closed'`,
    [contactId, channelId]
  );
  if (result.rowCount === 0) return null;
  return toConversation(result.rows[0]);
}

async function createConversation(contactId, channelId) {
  const result = await getPool().query(
    `INSERT INTO conversations (contact_id, channel_id) VALUES ($1, $2)
     RETURNING id, contact_id, channel_id, status, assigned_agent_id, created_at, updated_at`,
    [contactId, channelId]
  );
  return toConversation(result.rows[0]);
}

async function claimConversation(conversationId, agentId) {
  const result = await getPool().query(
    `UPDATE conversations SET status = 'assigned', assigned_agent_id = $2, updated_at = now()
     WHERE id = $1 AND assigned_agent_id IS NULL
     RETURNING id, contact_id, channel_id, status, assigned_agent_id, created_at, updated_at`,
    [conversationId, agentId]
  );
  if (result.rowCount === 0) return null;
  await getPool().query(
    `INSERT INTO conversation_events (conversation_id, event_type, to_agent_id) VALUES ($1, 'assigned', $2)`,
    [conversationId, agentId]
  );
  return toConversation(result.rows[0]);
}

async function transferConversation(conversationId, fromAgentId, toAgentId) {
  const result = await getPool().query(
    `UPDATE conversations SET assigned_agent_id = $2, updated_at = now()
     WHERE id = $1 AND assigned_agent_id = $3
     RETURNING id, contact_id, channel_id, status, assigned_agent_id, created_at, updated_at`,
    [conversationId, toAgentId, fromAgentId]
  );
  if (result.rowCount === 0) return null;
  await getPool().query(
    `INSERT INTO conversation_events (conversation_id, event_type, from_agent_id, to_agent_id) VALUES ($1, 'transferred', $2, $3)`,
    [conversationId, fromAgentId, toAgentId]
  );
  return toConversation(result.rows[0]);
}

async function closeConversation(conversationId) {
  const result = await getPool().query(
    `UPDATE conversations SET status = 'closed', updated_at = now()
     WHERE id = $1 AND status <> 'closed'
     RETURNING id, contact_id, channel_id, status, assigned_agent_id, created_at, updated_at`,
    [conversationId]
  );
  if (result.rowCount === 0) return null;
  await getPool().query(`INSERT INTO conversation_events (conversation_id, event_type) VALUES ($1, 'closed')`, [
    conversationId,
  ]);
  return toConversation(result.rows[0]);
}

async function getConversationWithContact(conversationId) {
  const result = await getPool().query(
    `SELECT c.id, c.contact_id, c.channel_id, c.status, c.assigned_agent_id, c.created_at, c.updated_at,
            ct.phone_number AS contact_phone_number
     FROM conversations c
     JOIN contacts ct ON ct.id = c.contact_id
     WHERE c.id = $1`,
    [conversationId]
  );
  if (result.rowCount === 0) return null;
  const row = result.rows[0];
  return { ...toConversation(row), contactPhoneNumber: row.contact_phone_number };
}

module.exports = {
  findOpenConversation,
  createConversation,
  claimConversation,
  transferConversation,
  closeConversation,
  getConversationWithContact,
};
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npm test -- src/conversations/conversation.repository.test.js`
Expected: PASS (8 testes)

- [ ] **Step 5: Commit**

```bash
git add src/conversations/conversation.repository.js src/conversations/conversation.repository.test.js
git commit -m "feat: add conversation repository with atomic claim/transfer/close"
```

---

### Task 8: Repositório de mensagens

**Files:**
- Create: `src/conversations/message.repository.js`
- Test: `src/conversations/message.repository.test.js`

**Interfaces:**
- Consumes: `getPool()` (Plano 1); `createChannel()` (Task 4); `findOrCreateContactByPhoneNumber()` (Task 6); `createConversation()` (Task 7).
- Produces:
  - `createMessage({ conversationId, direction, content, whatsappMessageId, status }): Promise<Message>`
  - `updateMessageStatus(messageId, status): Promise<Message | null>`
  - `recordMessageSent(messageId, whatsappMessageId): Promise<Message | null>`
  - `listMessagesByConversation(conversationId): Promise<Message[]>` — ordenado por `created_at` crescente.
  - Onde `Message = { id, conversationId, direction, content, whatsappMessageId, status, createdAt }`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/conversations/message.repository.test.js`:

```js
const { getPool, closePool } = require('../db/pool');
const { createChannel } = require('../channels/channel.repository');
const { findOrCreateContactByPhoneNumber } = require('./contact.repository');
const { createConversation } = require('./conversation.repository');
const { createMessage, updateMessageStatus, recordMessageSent, listMessagesByConversation } = require('./message.repository');

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

  test('createMessage stores an inbound message', async () => {
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
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npm test -- src/conversations/message.repository.test.js`
Expected: FAIL com "Cannot find module './message.repository'"

- [ ] **Step 3: Implementar `src/conversations/message.repository.js`**

```js
const { getPool } = require('../db/pool');

function toMessage(row) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    direction: row.direction,
    content: row.content,
    whatsappMessageId: row.whatsapp_message_id,
    status: row.status,
    createdAt: row.created_at,
  };
}

async function createMessage({ conversationId, direction, content, whatsappMessageId, status }) {
  const result = await getPool().query(
    `INSERT INTO messages (conversation_id, direction, content, whatsapp_message_id, status)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, conversation_id, direction, content, whatsapp_message_id, status, created_at`,
    [conversationId, direction, content, whatsappMessageId || null, status]
  );
  return toMessage(result.rows[0]);
}

async function updateMessageStatus(messageId, status) {
  const result = await getPool().query(
    `UPDATE messages SET status = $2 WHERE id = $1
     RETURNING id, conversation_id, direction, content, whatsapp_message_id, status, created_at`,
    [messageId, status]
  );
  if (result.rowCount === 0) return null;
  return toMessage(result.rows[0]);
}

async function recordMessageSent(messageId, whatsappMessageId) {
  const result = await getPool().query(
    `UPDATE messages SET whatsapp_message_id = $2 WHERE id = $1
     RETURNING id, conversation_id, direction, content, whatsapp_message_id, status, created_at`,
    [messageId, whatsappMessageId]
  );
  if (result.rowCount === 0) return null;
  return toMessage(result.rows[0]);
}

async function listMessagesByConversation(conversationId) {
  const result = await getPool().query(
    `SELECT id, conversation_id, direction, content, whatsapp_message_id, status, created_at
     FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC`,
    [conversationId]
  );
  return result.rows.map(toMessage);
}

module.exports = { createMessage, updateMessageStatus, recordMessageSent, listMessagesByConversation };
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npm test -- src/conversations/message.repository.test.js`
Expected: PASS (4 testes)

- [ ] **Step 5: Commit**

```bash
git add src/conversations/message.repository.js src/conversations/message.repository.test.js
git commit -m "feat: add message repository"
```

---

### Task 9: Adaptador Meta Cloud — verificação e normalização de entrada

**Files:**
- Create: `src/whatsapp-adapters/meta-cloud.adapter.js`
- Test: `src/whatsapp-adapters/meta-cloud.adapter.test.js`

**Interfaces:**
- Produces:
  - `verifyWebhookChallenge(query, verifyToken): string | null` — retorna o valor de `hub.challenge` se `hub.mode === 'subscribe'` e `hub.verify_token` bater; senão `null`.
  - `verifySignature(rawBody: Buffer, signatureHeader: string | undefined, appSecret: string): boolean`.
  - `parseInboundMessages(webhookBody): Array<{ metaPhoneNumberId, fromPhoneNumber, contactDisplayName, whatsappMessageId, content }>` — só mensagens de texto; ignora outros tipos.

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/whatsapp-adapters/meta-cloud.adapter.test.js`:

```js
const crypto = require('crypto');
const { verifyWebhookChallenge, verifySignature, parseInboundMessages } = require('./meta-cloud.adapter');

describe('verifyWebhookChallenge', () => {
  test('returns the challenge when mode and token match', () => {
    const result = verifyWebhookChallenge(
      { 'hub.mode': 'subscribe', 'hub.verify_token': 'secret-token', 'hub.challenge': '12345' },
      'secret-token'
    );
    expect(result).toBe('12345');
  });

  test('returns null when the token does not match', () => {
    const result = verifyWebhookChallenge(
      { 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong-token', 'hub.challenge': '12345' },
      'secret-token'
    );
    expect(result).toBeNull();
  });
});

describe('verifySignature', () => {
  const appSecret = 'app-secret-123';
  const rawBody = Buffer.from(JSON.stringify({ hello: 'world' }));

  function signatureFor(body) {
    const hash = crypto.createHmac('sha256', appSecret).update(body).digest('hex');
    return `sha256=${hash}`;
  }

  test('returns true for a valid signature', () => {
    const signature = signatureFor(rawBody);
    expect(verifySignature(rawBody, signature, appSecret)).toBe(true);
  });

  test('returns false for an invalid signature', () => {
    const wrongButSameLength = 'sha256=' + '0'.repeat(64);
    expect(verifySignature(rawBody, wrongButSameLength, appSecret)).toBe(false);
  });

  test('returns false when the header is missing', () => {
    expect(verifySignature(rawBody, undefined, appSecret)).toBe(false);
  });
});

describe('parseInboundMessages', () => {
  test('extracts text messages with contact name and phone_number_id', () => {
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
        content: 'Ola',
      },
    ]);
  });

  test('ignores non-text messages', () => {
    const webhookBody = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: '1234567890' },
                contacts: [],
                messages: [{ from: '5511999998888', id: 'wamid.IMG', type: 'image' }],
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
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npm test -- src/whatsapp-adapters/meta-cloud.adapter.test.js`
Expected: FAIL com "Cannot find module './meta-cloud.adapter'"

- [ ] **Step 3: Implementar `src/whatsapp-adapters/meta-cloud.adapter.js`**

```js
const crypto = require('crypto');

function verifyWebhookChallenge(query, verifyToken) {
  if (query['hub.mode'] === 'subscribe' && query['hub.verify_token'] === verifyToken) {
    return query['hub.challenge'];
  }
  return null;
}

function verifySignature(rawBody, signatureHeader, appSecret) {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
    return false;
  }
  const expectedSignature = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const providedSignature = signatureHeader.slice('sha256='.length);
  const expectedBuffer = Buffer.from(expectedSignature, 'hex');
  const providedBuffer = Buffer.from(providedSignature, 'hex');
  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

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
        if (message.type !== 'text') {
          continue;
        }
        messages.push({
          metaPhoneNumberId: phoneNumberId,
          fromPhoneNumber: message.from,
          contactDisplayName: contactsById[message.from] || null,
          whatsappMessageId: message.id,
          content: message.text.body,
        });
      }
    }
  }
  return messages;
}

module.exports = { verifyWebhookChallenge, verifySignature, parseInboundMessages };
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npm test -- src/whatsapp-adapters/meta-cloud.adapter.test.js`
Expected: PASS (8 testes)

- [ ] **Step 5: Commit**

```bash
git add src/whatsapp-adapters/meta-cloud.adapter.js src/whatsapp-adapters/meta-cloud.adapter.test.js
git commit -m "feat: add Meta Cloud webhook verification and inbound parsing"
```

---

### Task 10: Serviço de ingestão de mensagens de entrada

**Files:**
- Create: `src/conversations/inbound-message.service.js`
- Test: `src/conversations/inbound-message.service.test.js`

**Interfaces:**
- Consumes: `findOrCreateContactByPhoneNumber()` (Task 6), `findOpenConversation()`/`createConversation()` (Task 7), `createMessage()` (Task 8).
- Produces: `ingestInboundMessage({ channelId, fromPhoneNumber, contactDisplayName, whatsappMessageId, content }): Promise<{ contact, conversation, message }>`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/conversations/inbound-message.service.test.js`:

```js
jest.mock('./contact.repository');
jest.mock('./conversation.repository');
jest.mock('./message.repository');
const { findOrCreateContactByPhoneNumber } = require('./contact.repository');
const { findOpenConversation, createConversation } = require('./conversation.repository');
const { createMessage } = require('./message.repository');
const { ingestInboundMessage } = require('./inbound-message.service');

describe('ingestInboundMessage', () => {
  beforeEach(() => jest.clearAllMocks());

  test('reuses an existing open conversation', async () => {
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-1' });
    findOpenConversation.mockResolvedValue({ id: 'conv-1' });
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
      conversation: { id: 'conv-1' },
      message: { id: 'msg-1' },
    });
  });

  test('creates a new conversation when none is open', async () => {
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-2' });
    findOpenConversation.mockResolvedValue(null);
    createConversation.mockResolvedValue({ id: 'conv-2' });
    createMessage.mockResolvedValue({ id: 'msg-2' });

    const result = await ingestInboundMessage({
      channelId: 'channel-1',
      fromPhoneNumber: '+5511999997777',
      contactDisplayName: 'Outro Cliente',
      whatsappMessageId: 'wamid.Y',
      content: 'Ola',
    });

    expect(createConversation).toHaveBeenCalledWith('contact-2', 'channel-1');
    expect(result.conversation).toEqual({ id: 'conv-2' });
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npm test -- src/conversations/inbound-message.service.test.js`
Expected: FAIL com "Cannot find module './inbound-message.service'"

- [ ] **Step 3: Implementar `src/conversations/inbound-message.service.js`**

```js
const { findOrCreateContactByPhoneNumber } = require('./contact.repository');
const { findOpenConversation, createConversation } = require('./conversation.repository');
const { createMessage } = require('./message.repository');

async function ingestInboundMessage({ channelId, fromPhoneNumber, contactDisplayName, whatsappMessageId, content }) {
  const contact = await findOrCreateContactByPhoneNumber(fromPhoneNumber, contactDisplayName);
  let conversation = await findOpenConversation(contact.id, channelId);
  if (!conversation) {
    conversation = await createConversation(contact.id, channelId);
  }
  const message = await createMessage({
    conversationId: conversation.id,
    direction: 'inbound',
    content,
    whatsappMessageId,
    status: 'received',
  });
  return { contact, conversation, message };
}

module.exports = { ingestInboundMessage };
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npm test -- src/conversations/inbound-message.service.test.js`
Expected: PASS (2 testes)

- [ ] **Step 5: Commit**

```bash
git add src/conversations/inbound-message.service.js src/conversations/inbound-message.service.test.js
git commit -m "feat: add inbound message ingestion service"
```

---

### Task 11: Rota do webhook Meta Cloud + integração no servidor

**Files:**
- Create: `src/whatsapp-adapters/meta-cloud.routes.js`
- Test: `src/whatsapp-adapters/meta-cloud.routes.test.js`
- Modify: `src/server.js`

**Interfaces:**
- Consumes: `loadConfig()` (Task 1); `verifyWebhookChallenge`/`verifySignature`/`parseInboundMessages` (Task 9); `findChannelByMetaPhoneNumberId()` (Task 4); `ingestInboundMessage()` (Task 10).
- Produces: `GET /webhooks/meta` (verificação), `POST /webhooks/meta` (recebimento); `req.rawBody` disponível em toda requisição (necessário para validar assinatura).

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/whatsapp-adapters/meta-cloud.routes.test.js`:

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
});
```

Nota: enviar o corpo como string JSON já serializada (`.send(bodyString)`), não como objeto — assim o `supertest` não re-serializa o corpo, e os bytes assinados no teste são exatamente os bytes que o servidor recebe e verifica.

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npm test -- src/whatsapp-adapters/meta-cloud.routes.test.js`
Expected: FAIL com "Cannot find module './meta-cloud.routes'"

- [ ] **Step 3: Implementar `src/whatsapp-adapters/meta-cloud.routes.js`**

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
  if (!verifySignature(req.rawBody, signature, config.metaAppSecret)) {
    return res.sendStatus(403);
  }

  const inboundMessages = parseInboundMessages(req.body);
  for (const inboundMessage of inboundMessages) {
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
  }
  res.sendStatus(200);
});

module.exports = router;
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npm test -- src/whatsapp-adapters/meta-cloud.routes.test.js`
Expected: PASS (4 testes)

- [ ] **Step 5: Atualizar `src/server.js`**

Modificar o `app.use(express.json())` existente para capturar o corpo bruto, e montar a nova rota. O restante do arquivo (helper `/health`, `/`, `/api/auth`, guarda `require.main === module`) permanece igual ao do Plano 1:

```js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { loadConfig } = require('./config/env');
const { getPool } = require('./db/pool');
const authRoutes = require('./auth/auth.routes');
const metaCloudRoutes = require('./whatsapp-adapters/meta-cloud.routes');

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
app.use('/webhooks', metaCloudRoutes);

if (require.main === module) {
  app.listen(config.port, () => {
    console.log('Servidor rodando na porta ' + config.port);
  });
}

module.exports = app;
```

- [ ] **Step 6: Rodar a suíte inteira e confirmar que passa**

Run: `npm test`
Expected: PASS em todos os arquivos.

- [ ] **Step 7: Commit**

```bash
git add src/whatsapp-adapters/meta-cloud.routes.js src/whatsapp-adapters/meta-cloud.routes.test.js src/server.js
git commit -m "feat: wire Meta Cloud webhook route into server"
```

---

### Task 12: Fila de envio (Bull)

**Files:**
- Create: `src/queue/outbound-queue.js`
- Test: `src/queue/outbound-queue.test.js`

**Interfaces:**
- Consumes: `loadConfig()` (Task 1).
- Produces:
  - `enqueueOutboundMessage({ conversationId, channelId, content }): Promise<Bull.Job>`
  - `processOutboundQueue(handler: (data) => Promise<void>): void`
  - `closeOutboundQueue(): Promise<void>`

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/queue/outbound-queue.test.js`:

```js
const { enqueueOutboundMessage, processOutboundQueue, closeOutboundQueue } = require('./outbound-queue');

describe('outbound queue', () => {
  afterEach(async () => {
    await closeOutboundQueue();
  });

  test('a job enqueued is delivered to the processor with the right data', (done) => {
    processOutboundQueue((data) => {
      try {
        expect(data).toEqual({ conversationId: 'conv-1', channelId: 'channel-1', content: 'Ola' });
        done();
      } catch (err) {
        done(err);
      }
    });
    enqueueOutboundMessage({ conversationId: 'conv-1', channelId: 'channel-1', content: 'Ola' });
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npm test -- src/queue/outbound-queue.test.js`
Expected: FAIL com "Cannot find module './outbound-queue'"

- [ ] **Step 3: Implementar `src/queue/outbound-queue.js`**

```js
const Queue = require('bull');
const { loadConfig } = require('../config/env');

let queue;

function getOutboundQueue() {
  if (!queue) {
    const config = loadConfig();
    queue = new Queue('outbound-messages', config.redisUrl);
  }
  return queue;
}

async function enqueueOutboundMessage({ conversationId, channelId, content }) {
  return getOutboundQueue().add({ conversationId, channelId, content });
}

function processOutboundQueue(handler) {
  getOutboundQueue().process(async (job) => handler(job.data));
}

async function closeOutboundQueue() {
  if (queue) {
    await queue.close();
    queue = undefined;
  }
}

module.exports = { getOutboundQueue, enqueueOutboundMessage, processOutboundQueue, closeOutboundQueue };
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npm test -- src/queue/outbound-queue.test.js`
Expected: PASS (1 teste). Requer o Redis local do pré-requisito rodando.

- [ ] **Step 5: Commit**

```bash
git add src/queue/outbound-queue.js src/queue/outbound-queue.test.js
git commit -m "feat: add Bull-based outbound message queue"
```

---

### Task 13: Adaptador Meta Cloud — envio de saída + worker da fila

**Files:**
- Modify: `src/whatsapp-adapters/meta-cloud.adapter.js`
- Modify: `src/whatsapp-adapters/meta-cloud.adapter.test.js`
- Create: `src/queue/outbound-worker.js`
- Test: `src/queue/outbound-worker.test.js`
- Modify: `src/server.js`

**Interfaces:**
- Consumes: `processOutboundQueue()` (Task 12); `findChannelById()` (Task 4); `getConversationWithContact()` (Task 7); `createMessage()`/`updateMessageStatus()`/`recordMessageSent()` (Task 8).
- Produces: `sendTextMessage(channel, toPhoneNumber, content): Promise<{ whatsappMessageId }>`; `startOutboundWorker(): void`.

- [ ] **Step 1: Adicionar o teste que falha ao adaptador**

Adicionar ao final de `src/whatsapp-adapters/meta-cloud.adapter.test.js` (mantendo o conteúdo da Task 9):

```js
jest.mock('axios');
const axios = require('axios');
const { sendTextMessage } = require('./meta-cloud.adapter');

describe('sendTextMessage', () => {
  test('posts to the Graph API and returns the WhatsApp message id', async () => {
    axios.post.mockResolvedValue({ data: { messages: [{ id: 'wamid.SENT123' }] } });
    const channel = { config: { phoneNumberId: '1234567890', accessToken: 'token-abc' } };

    const result = await sendTextMessage(channel, '5511999998888', 'Resposta do atendente');

    expect(axios.post).toHaveBeenCalledWith(
      'https://graph.facebook.com/v20.0/1234567890/messages',
      { messaging_product: 'whatsapp', to: '5511999998888', type: 'text', text: { body: 'Resposta do atendente' } },
      { headers: { Authorization: 'Bearer token-abc' } }
    );
    expect(result).toEqual({ whatsappMessageId: 'wamid.SENT123' });
  });
});
```

**Nota:** `jest.mock('axios')` no topo do arquivo afeta todos os testes do arquivo, inclusive os da Task 9 (`verifyWebhookChallenge`, `verifySignature`, `parseInboundMessages`) — como nenhum deles usa `axios`, o mock não interfere neles.

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npm test -- src/whatsapp-adapters/meta-cloud.adapter.test.js`
Expected: FAIL — `sendTextMessage` não existe ainda.

- [ ] **Step 3: Adicionar `sendTextMessage` ao adaptador**

No topo de `src/whatsapp-adapters/meta-cloud.adapter.js`, adicionar `const axios = require('axios');` junto ao `require('crypto')` existente. No final do arquivo, adicionar a função e atualizar o `module.exports`:

```js
async function sendTextMessage(channel, toPhoneNumber, content) {
  const { phoneNumberId, accessToken } = channel.config;
  const response = await axios.post(
    `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`,
    {
      messaging_product: 'whatsapp',
      to: toPhoneNumber,
      type: 'text',
      text: { body: content },
    },
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  return { whatsappMessageId: response.data.messages[0].id };
}

module.exports = { verifyWebhookChallenge, verifySignature, parseInboundMessages, sendTextMessage };
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npm test -- src/whatsapp-adapters/meta-cloud.adapter.test.js`
Expected: PASS (9 testes)

- [ ] **Step 5: Escrever o teste que falha para o worker**

Criar `src/queue/outbound-worker.test.js`:

```js
jest.mock('./outbound-queue');
jest.mock('../channels/channel.repository');
jest.mock('../conversations/conversation.repository');
jest.mock('../conversations/message.repository');
jest.mock('../whatsapp-adapters/meta-cloud.adapter');

const { processOutboundQueue } = require('./outbound-queue');
const { findChannelById } = require('../channels/channel.repository');
const { getConversationWithContact } = require('../conversations/conversation.repository');
const { createMessage, updateMessageStatus, recordMessageSent } = require('../conversations/message.repository');
const { sendTextMessage } = require('../whatsapp-adapters/meta-cloud.adapter');
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

  test('sends the message and records the whatsapp message id on success', async () => {
    getConversationWithContact.mockResolvedValue({ id: 'conv-1', contactPhoneNumber: '5511999998888' });
    findChannelById.mockResolvedValue({ id: 'channel-1', config: { phoneNumberId: '123', accessToken: 'tok' } });
    createMessage.mockResolvedValue({ id: 'msg-1' });
    sendTextMessage.mockResolvedValue({ whatsappMessageId: 'wamid.OUT1' });

    await handler({ conversationId: 'conv-1', channelId: 'channel-1', content: 'Ola cliente' });

    expect(sendTextMessage).toHaveBeenCalledWith(
      { id: 'channel-1', config: { phoneNumberId: '123', accessToken: 'tok' } },
      '5511999998888',
      'Ola cliente'
    );
    expect(recordMessageSent).toHaveBeenCalledWith('msg-1', 'wamid.OUT1');
    expect(updateMessageStatus).not.toHaveBeenCalled();
  });

  test('marks the message failed and rethrows when sending fails', async () => {
    getConversationWithContact.mockResolvedValue({ id: 'conv-1', contactPhoneNumber: '5511999998888' });
    findChannelById.mockResolvedValue({ id: 'channel-1', config: {} });
    createMessage.mockResolvedValue({ id: 'msg-2' });
    sendTextMessage.mockRejectedValue(new Error('network error'));

    await expect(
      handler({ conversationId: 'conv-1', channelId: 'channel-1', content: 'Ola' })
    ).rejects.toThrow('network error');

    expect(updateMessageStatus).toHaveBeenCalledWith('msg-2', 'failed');
    expect(recordMessageSent).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Rodar o teste e confirmar que falha**

Run: `npm test -- src/queue/outbound-worker.test.js`
Expected: FAIL com "Cannot find module './outbound-worker'"

- [ ] **Step 7: Implementar `src/queue/outbound-worker.js`**

```js
const { processOutboundQueue } = require('./outbound-queue');
const { findChannelById } = require('../channels/channel.repository');
const { getConversationWithContact } = require('../conversations/conversation.repository');
const { createMessage, updateMessageStatus, recordMessageSent } = require('../conversations/message.repository');
const { sendTextMessage } = require('../whatsapp-adapters/meta-cloud.adapter');

function startOutboundWorker() {
  processOutboundQueue(async ({ conversationId, channelId, content }) => {
    const conversation = await getConversationWithContact(conversationId);
    const channel = await findChannelById(channelId);
    const message = await createMessage({
      conversationId,
      direction: 'outbound',
      content,
      whatsappMessageId: null,
      status: 'sent',
    });
    try {
      const { whatsappMessageId } = await sendTextMessage(channel, conversation.contactPhoneNumber, content);
      await recordMessageSent(message.id, whatsappMessageId);
    } catch (err) {
      await updateMessageStatus(message.id, 'failed');
      throw err;
    }
  });
}

module.exports = { startOutboundWorker };
```

- [ ] **Step 8: Rodar o teste e confirmar que passa**

Run: `npm test -- src/queue/outbound-worker.test.js`
Expected: PASS (2 testes)

- [ ] **Step 9: Ligar o worker na inicialização do servidor**

Em `src/server.js`, adicionar o import `const { startOutboundWorker } = require('./queue/outbound-worker');` junto aos outros `require`s, e chamar `startOutboundWorker();` dentro do bloco `if (require.main === module) { ... }`, antes do `app.listen(...)`:

```js
if (require.main === module) {
  startOutboundWorker();
  app.listen(config.port, () => {
    console.log('Servidor rodando na porta ' + config.port);
  });
}
```

- [ ] **Step 10: Rodar a suíte inteira e confirmar que passa**

Run: `npm test`
Expected: PASS em todos os arquivos.

- [ ] **Step 11: Commit**

```bash
git add src/whatsapp-adapters/meta-cloud.adapter.js src/whatsapp-adapters/meta-cloud.adapter.test.js src/queue/outbound-worker.js src/queue/outbound-worker.test.js src/server.js
git commit -m "feat: add Meta Cloud outbound send and wire the outbound worker"
```

---

## Self-Review

**Cobertura do spec:** o fluxo de entrada completo do spec (webhook validado → normalização → `messages` → `conversations` → fila de espera implícita via `status = 'waiting'`) está coberto pelas Tasks 9-11. O fluxo de saída (mensagem → fila Bull → adaptador → atualização de status) está coberto pelas Tasks 12-13. A regra de "assumir" atômica e transferência (Task 7) está pronta como módulo, mas **ainda não exposta via API HTTP** — isso é escopo do próximo plano (API de atendimento), assim como `realtime/` (Socket.io) e o frontend. Essa divisão foi deliberada (ver Scope Check da skill writing-plans) para manter este plano testável de ponta a ponta sem depender de peças que ainda não existem.

**Placeholders:** nenhum "TBD"/"depois" — todo passo tem código completo, comandos exatos ou payloads de exemplo reais.

**Consistência de tipos:** `Conversation` e `Message` mantêm os mesmos nomes de campo (camelCase) em todas as tasks que os consomem — `conversation.repository.js` (Task 7) e `message.repository.js` (Task 8) definem o formato consumido por `inbound-message.service.js` (Task 10) e `outbound-worker.js` (Task 13) sem divergência. `channel.config` é sempre um objeto JS nas assinaturas (nunca uma string JSON) — a serialização para `JSONB` fica isolada dentro do repositório (Task 4).
