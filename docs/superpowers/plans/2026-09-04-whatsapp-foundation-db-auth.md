# Fundação: Banco de Dados e Autenticação de Atendentes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Estabelecer o esquema de banco de dados (Postgres) e a autenticação de atendentes (JWT) que servirão de base para todos os módulos seguintes (conversas, adaptadores WhatsApp, API, frontend).

**Architecture:** Monólito Node.js/Express existente evolui com um módulo de configuração de ambiente, um pool de conexão Postgres, migrações versionadas (node-pg-migrate) para as 6 tabelas do domínio, e um módulo de autenticação (repositório de atendentes + serviço de login JWT + middleware de proteção de rotas).

**Tech Stack:** Node.js (CommonJS), Express, PostgreSQL (`pg`), `node-pg-migrate`, `bcrypt`, `jsonwebtoken`, Jest + Supertest para testes.

**Spec:** [docs/superpowers/specs/2026-09-04-whatsapp-attendance-system-design.md](../specs/2026-09-04-whatsapp-attendance-system-design.md)

## Global Constraints

- Node.js v22.x (ambiente local já confirmado), módulos em CommonJS (`require`/`module.exports`), consistente com `src/server.js` existente.
- Todas as tabelas usam chave primária `UUID DEFAULT gen_random_uuid()` (extensão `pgcrypto`), conforme o modelo de dados do spec.
- Sem comentários no código exceto onde uma restrição não óbvia exigir explicação.
- Testes via Jest (`npm test`); testes que tocam o banco usam um Postgres real de teste (local via Docker ou instância dedicada) — não usar mocks para a camada de banco.
- Este é o Plano 1 de uma série. Próximos planos (não cobertos aqui): motor de conversas + adaptador Meta Cloud API + fila de saída (Bull); adaptador Baileys; tempo real (Socket.io); frontend React.

## Pré-requisito manual (antes de começar)

Este plano precisa de um Postgres alcançável para desenvolvimento/teste local. Se você não tiver um Postgres local, o caminho mais simples é Docker:

```bash
docker run --name dw-whatsapp-postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=dw_whatsapp_test -p 5432:5432 -d postgres:16
```

Isso é independente do Postgres de produção no Render (que ainda precisa ser provisionado antes do deploy, conforme registrado no spec) — para este plano, só precisamos de um banco local para rodar os testes.

---

### Task 1: Configuração de ambiente (`src/config/env.js`)

**Files:**
- Create: `src/config/env.js`
- Test: `src/config/env.test.js`

**Interfaces:**
- Produces: `loadConfig(): { port: number, databaseUrl: string, jwtSecret: string }` — lança `Error` se `DATABASE_URL` ou `JWT_SECRET` estiverem ausentes.

- [ ] **Step 1: Instalar Jest e Supertest**

```bash
npm install --save-dev jest supertest
```

- [ ] **Step 2: Atualizar `package.json`**

Substitua o script `"test"` existente e adicione a configuração do Jest:

```json
"scripts": {
  "start": "node src/server.js",
  "dev": "nodemon src/server.js",
  "test": "jest"
},
"jest": {
  "testEnvironment": "node"
}
```

- [ ] **Step 3: Escrever o teste que falha**

Criar `src/config/env.test.js`:

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

  test('throws when DATABASE_URL is missing', () => {
    delete process.env.DATABASE_URL;
    process.env.JWT_SECRET = 'secret';
    expect(() => loadConfig()).toThrow('Missing required environment variables: DATABASE_URL');
  });

  test('throws when JWT_SECRET is missing', () => {
    process.env.DATABASE_URL = 'postgresql://localhost/test';
    delete process.env.JWT_SECRET;
    expect(() => loadConfig()).toThrow('Missing required environment variables: JWT_SECRET');
  });

  test('returns config with defaults when all required vars present', () => {
    process.env.DATABASE_URL = 'postgresql://localhost/test';
    process.env.JWT_SECRET = 'secret';
    delete process.env.PORT;
    const config = loadConfig();
    expect(config).toEqual({ port: 3000, databaseUrl: 'postgresql://localhost/test', jwtSecret: 'secret' });
  });

  test('uses PORT env var when present', () => {
    process.env.DATABASE_URL = 'postgresql://localhost/test';
    process.env.JWT_SECRET = 'secret';
    process.env.PORT = '4000';
    const config = loadConfig();
    expect(config.port).toBe(4000);
  });
});
```

- [ ] **Step 4: Rodar o teste e confirmar que falha**

Run: `npx jest src/config/env.test.js`
Expected: FAIL com "Cannot find module './env'"

- [ ] **Step 5: Implementar `src/config/env.js`**

```js
function loadConfig() {
  const required = ['DATABASE_URL', 'JWT_SECRET'];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  return {
    port: Number(process.env.PORT) || 3000,
    databaseUrl: process.env.DATABASE_URL,
    jwtSecret: process.env.JWT_SECRET,
  };
}

module.exports = { loadConfig };
```

- [ ] **Step 6: Rodar o teste e confirmar que passa**

Run: `npx jest src/config/env.test.js`
Expected: PASS (4 testes)

- [ ] **Step 7: Commit**

```bash
git add package.json src/config/env.js src/config/env.test.js
git commit -m "feat: add environment config loader with validation"
```

---

### Task 2: Pool de conexão Postgres (`src/db/pool.js`)

**Files:**
- Create: `src/db/pool.js`
- Create: `.env.test.example`
- Modify: `.gitignore`
- Modify: `package.json`
- Test: `src/db/pool.test.js`

**Interfaces:**
- Consumes: `loadConfig()` de `src/config/env.js` (Task 1).
- Produces: `getPool(): pg.Pool` (singleton), `closePool(): Promise<void>`.

- [ ] **Step 1: Criar `.env.test.example`** (arquivo committed, serve de referência)

```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/dw_whatsapp_test
JWT_SECRET=test-secret
```

- [ ] **Step 2: Copiar para `.env.test` localmente (não committed)**

```bash
cp .env.test.example .env.test
```

- [ ] **Step 3: Adicionar `.env.test` ao `.gitignore`**

Adicionar a linha `.env.test` ao arquivo `.gitignore` existente (que já ignora `node_modules/` e `.env`).

- [ ] **Step 4: Instalar `dotenv-cli` e atualizar o script de teste**

```bash
npm install --save-dev dotenv-cli
```

Atualizar `package.json`:

```json
"scripts": {
  "start": "node src/server.js",
  "dev": "nodemon src/server.js",
  "test": "dotenv -e .env.test -- jest"
}
```

- [ ] **Step 5: Escrever o teste que falha**

Criar `src/db/pool.test.js`:

```js
const { getPool, closePool } = require('./pool');

describe('getPool', () => {
  afterAll(async () => {
    await closePool();
  });

  test('connects to postgres and runs a query', async () => {
    const pool = getPool();
    const result = await pool.query('SELECT 1 AS value');
    expect(result.rows[0].value).toBe(1);
  });

  test('returns the same pool instance on repeated calls', () => {
    const first = getPool();
    const second = getPool();
    expect(first).toBe(second);
  });
});
```

- [ ] **Step 6: Rodar o teste e confirmar que falha**

Run: `npm test -- src/db/pool.test.js`
Expected: FAIL com "Cannot find module './pool'"

- [ ] **Step 7: Implementar `src/db/pool.js`**

```js
const { Pool } = require('pg');
const { loadConfig } = require('../config/env');

let pool;

function getPool() {
  if (!pool) {
    const config = loadConfig();
    pool = new Pool({ connectionString: config.databaseUrl });
  }
  return pool;
}

async function closePool() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

module.exports = { getPool, closePool };
```

- [ ] **Step 8: Rodar o teste e confirmar que passa**

Run: `npm test -- src/db/pool.test.js`
Expected: PASS (2 testes). Requer o Postgres local do pré-requisito rodando.

- [ ] **Step 9: Commit**

```bash
git add .env.test.example .gitignore package.json package-lock.json src/db/pool.js src/db/pool.test.js
git commit -m "feat: add postgres connection pool"
```

---

### Task 3: Esquema do banco de dados (migrações)

**Files:**
- Create: `migrations/*_enable-pgcrypto.js`
- Create: `migrations/*_create-agents-table.js`
- Create: `migrations/*_create-channels-table.js`
- Create: `migrations/*_create-contacts-table.js`
- Create: `migrations/*_create-conversations-table.js`
- Create: `migrations/*_create-messages-table.js`
- Create: `migrations/*_create-conversation-events-table.js`
- Modify: `package.json`
- Test: `src/db/schema.test.js`

**Interfaces:**
- Consumes: `getPool()`/`closePool()` de `src/db/pool.js` (Task 2).
- Produces: tabelas `agents`, `channels`, `contacts`, `conversations`, `messages`, `conversation_events` no banco de dados apontado por `DATABASE_URL`.

- [ ] **Step 1: Instalar `node-pg-migrate` e adicionar scripts**

```bash
npm install --save-dev node-pg-migrate
```

Atualizar `package.json`:

```json
"scripts": {
  "start": "node src/server.js",
  "dev": "nodemon src/server.js",
  "migrate": "node-pg-migrate",
  "migrate:test": "dotenv -e .env.test -- node-pg-migrate",
  "pretest": "npm run migrate:test -- up",
  "test": "dotenv -e .env.test -- jest"
}
```

- [ ] **Step 2: Escrever o teste que falha**

Criar `src/db/schema.test.js`:

```js
const { getPool, closePool } = require('./pool');

describe('database schema', () => {
  afterAll(async () => {
    await closePool();
  });

  const tables = ['agents', 'channels', 'contacts', 'conversations', 'messages', 'conversation_events'];

  test.each(tables)('table %s exists', async (tableName) => {
    const pool = getPool();
    const result = await pool.query(
      'SELECT table_name FROM information_schema.tables WHERE table_name = $1',
      [tableName]
    );
    expect(result.rowCount).toBe(1);
  });

  test('conversations has a unique index for open conversations per contact/channel', async () => {
    const pool = getPool();
    const result = await pool.query(
      "SELECT indexname FROM pg_indexes WHERE tablename = 'conversations' AND indexname = 'conversations_open_per_contact_channel'"
    );
    expect(result.rowCount).toBe(1);
  });
});
```

- [ ] **Step 3: Rodar o teste e confirmar que falha**

Run: `npm test -- src/db/schema.test.js`
Expected: FAIL — todas as tabelas ausentes (0 migrações ainda existem, `pretest` roda sem efeito).

- [ ] **Step 4: Criar as migrações**

Gerar cada arquivo com o comando (o nome final incluirá um timestamp — usar o conteúdo abaixo independente do nome exato):

```bash
npx node-pg-migrate create enable-pgcrypto
npx node-pg-migrate create create-agents-table
npx node-pg-migrate create create-channels-table
npx node-pg-migrate create create-contacts-table
npx node-pg-migrate create create-conversations-table
npx node-pg-migrate create create-messages-table
npx node-pg-migrate create create-conversation-events-table
```

Conteúdo de `*_enable-pgcrypto.js`:

```js
exports.up = (pgm) => {
  pgm.sql('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
};

exports.down = (pgm) => {
  pgm.sql('DROP EXTENSION IF EXISTS pgcrypto;');
};
```

Conteúdo de `*_create-agents-table.js`:

```js
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE agents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('agent', 'admin')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE agents;');
};
```

Conteúdo de `*_create-channels-table.js`:

```js
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE channels (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      type TEXT NOT NULL CHECK (type IN ('meta_cloud', 'baileys')),
      name TEXT NOT NULL,
      config JSONB NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN ('connected', 'disconnected', 'awaiting_qr')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE channels;');
};
```

Conteúdo de `*_create-contacts-table.js`:

```js
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE contacts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      phone_number TEXT NOT NULL UNIQUE,
      display_name TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE contacts;');
};
```

Conteúdo de `*_create-conversations-table.js`:

```js
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE conversations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      contact_id UUID NOT NULL REFERENCES contacts(id),
      channel_id UUID NOT NULL REFERENCES channels(id),
      status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'assigned', 'closed')),
      assigned_agent_id UUID REFERENCES agents(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE UNIQUE INDEX conversations_open_per_contact_channel
      ON conversations (contact_id, channel_id)
      WHERE status <> 'closed';
  `);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE conversations;');
};
```

Conteúdo de `*_create-messages-table.js`:

```js
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id UUID NOT NULL REFERENCES conversations(id),
      direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
      content TEXT NOT NULL,
      whatsapp_message_id TEXT,
      status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'delivered', 'read', 'failed', 'received')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE messages;');
};
```

Conteúdo de `*_create-conversation-events-table.js`:

```js
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE conversation_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id UUID NOT NULL REFERENCES conversations(id),
      event_type TEXT NOT NULL CHECK (event_type IN ('assigned', 'transferred', 'closed', 'reopened')),
      from_agent_id UUID REFERENCES agents(id),
      to_agent_id UUID REFERENCES agents(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE conversation_events;');
};
```

- [ ] **Step 5: Rodar o teste e confirmar que passa**

Run: `npm test -- src/db/schema.test.js`
Expected: PASS (7 testes). O `pretest` aplica as 7 migrações antes do Jest rodar.

- [ ] **Step 6: Verificar reversibilidade das migrações (manual)**

```bash
npm run migrate:test -- down 7
npm run migrate:test -- up
```

Confirmar que os dois comandos rodam sem erro (as tabelas somem e voltam).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json migrations/ src/db/schema.test.js
git commit -m "feat: add database schema migrations"
```

---

### Task 4: Repositório de atendentes (`src/agents/agent.repository.js`)

**Files:**
- Create: `src/agents/agent.repository.js`
- Test: `src/agents/agent.repository.test.js`

**Interfaces:**
- Consumes: `getPool()` de `src/db/pool.js` (Task 2); tabela `agents` (Task 3).
- Produces:
  - `createAgent({ email, password, role }): Promise<{ id, email, role, createdAt }>`
  - `findAgentByEmail(email): Promise<{ id, email, role, passwordHash, createdAt } | null>`
  - `findAgentById(id): Promise<{ id, email, role, createdAt } | null>`

- [ ] **Step 1: Instalar `bcrypt`**

```bash
npm install bcrypt
```

- [ ] **Step 2: Escrever o teste que falha**

Criar `src/agents/agent.repository.test.js`:

```js
const bcrypt = require('bcrypt');
const { getPool, closePool } = require('../db/pool');
const { createAgent, findAgentByEmail, findAgentById } = require('./agent.repository');

describe('agent repository', () => {
  beforeEach(async () => {
    await getPool().query('TRUNCATE agents CASCADE');
  });

  afterAll(async () => {
    await closePool();
  });

  test('createAgent stores a hashed password and returns the agent without it', async () => {
    const agent = await createAgent({ email: 'a@dw.com', password: 'secret123', role: 'agent' });
    expect(agent.email).toBe('a@dw.com');
    expect(agent.role).toBe('agent');
    expect(agent.passwordHash).toBeUndefined();
    expect(agent.id).toBeDefined();
  });

  test('findAgentByEmail returns the agent with its password hash', async () => {
    await createAgent({ email: 'b@dw.com', password: 'secret123', role: 'admin' });
    const agent = await findAgentByEmail('b@dw.com');
    expect(agent.email).toBe('b@dw.com');
    const matches = await bcrypt.compare('secret123', agent.passwordHash);
    expect(matches).toBe(true);
  });

  test('findAgentByEmail returns null when not found', async () => {
    const agent = await findAgentByEmail('missing@dw.com');
    expect(agent).toBeNull();
  });

  test('findAgentById returns the agent without its password hash', async () => {
    const created = await createAgent({ email: 'c@dw.com', password: 'secret123', role: 'agent' });
    const agent = await findAgentById(created.id);
    expect(agent.email).toBe('c@dw.com');
    expect(agent.passwordHash).toBeUndefined();
  });
});
```

- [ ] **Step 3: Rodar o teste e confirmar que falha**

Run: `npm test -- src/agents/agent.repository.test.js`
Expected: FAIL com "Cannot find module './agent.repository'"

- [ ] **Step 4: Implementar `src/agents/agent.repository.js`**

```js
const bcrypt = require('bcrypt');
const { getPool } = require('../db/pool');

const SALT_ROUNDS = 10;

function toPublicAgent(row) {
  return { id: row.id, email: row.email, role: row.role, createdAt: row.created_at };
}

async function createAgent({ email, password, role }) {
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const result = await getPool().query(
    `INSERT INTO agents (email, password_hash, role) VALUES ($1, $2, $3)
     RETURNING id, email, role, created_at`,
    [email, passwordHash, role]
  );
  return toPublicAgent(result.rows[0]);
}

async function findAgentByEmail(email) {
  const result = await getPool().query(
    'SELECT id, email, role, password_hash, created_at FROM agents WHERE email = $1',
    [email]
  );
  if (result.rowCount === 0) return null;
  const row = result.rows[0];
  return { id: row.id, email: row.email, role: row.role, passwordHash: row.password_hash, createdAt: row.created_at };
}

async function findAgentById(id) {
  const result = await getPool().query(
    'SELECT id, email, role, created_at FROM agents WHERE id = $1',
    [id]
  );
  if (result.rowCount === 0) return null;
  return toPublicAgent(result.rows[0]);
}

module.exports = { createAgent, findAgentByEmail, findAgentById };
```

- [ ] **Step 5: Rodar o teste e confirmar que passa**

Run: `npm test -- src/agents/agent.repository.test.js`
Expected: PASS (4 testes)

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/agents/agent.repository.js src/agents/agent.repository.test.js
git commit -m "feat: add agent repository with password hashing"
```

---

### Task 5: Serviço de autenticação (`src/auth/auth.service.js`)

**Files:**
- Create: `src/auth/auth.service.js`
- Test: `src/auth/auth.service.test.js`

**Interfaces:**
- Consumes: `findAgentByEmail(email)` de `src/agents/agent.repository.js` (Task 4); `process.env.JWT_SECRET`.
- Produces:
  - `login({ email, password }): Promise<{ token, agent: { id, email, role } }>` — lança `Error('Invalid credentials')` em falha.
  - `verifyToken(token): { agentId, role, iat, exp }` — lança em token inválido.

- [ ] **Step 1: Instalar `jsonwebtoken`**

```bash
npm install jsonwebtoken
```

- [ ] **Step 2: Escrever o teste que falha**

Criar `src/auth/auth.service.test.js`:

```js
jest.mock('../agents/agent.repository');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { findAgentByEmail } = require('../agents/agent.repository');
const { login, verifyToken } = require('./auth.service');

describe('auth service', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret';
    jest.clearAllMocks();
  });

  test('login returns a token when credentials are valid', async () => {
    const passwordHash = await bcrypt.hash('secret123', 10);
    findAgentByEmail.mockResolvedValue({ id: 'agent-1', email: 'a@dw.com', role: 'agent', passwordHash });

    const result = await login({ email: 'a@dw.com', password: 'secret123' });

    expect(result.token).toBeDefined();
    const decoded = jwt.verify(result.token, 'test-secret');
    expect(decoded.agentId).toBe('agent-1');
    expect(decoded.role).toBe('agent');
  });

  test('login throws when agent does not exist', async () => {
    findAgentByEmail.mockResolvedValue(null);
    await expect(login({ email: 'missing@dw.com', password: 'x' })).rejects.toThrow('Invalid credentials');
  });

  test('login throws when password is wrong', async () => {
    const passwordHash = await bcrypt.hash('secret123', 10);
    findAgentByEmail.mockResolvedValue({ id: 'agent-1', email: 'a@dw.com', role: 'agent', passwordHash });
    await expect(login({ email: 'a@dw.com', password: 'wrong' })).rejects.toThrow('Invalid credentials');
  });

  test('verifyToken returns the decoded payload for a valid token', () => {
    const token = jwt.sign({ agentId: 'agent-1', role: 'admin' }, 'test-secret');
    const decoded = verifyToken(token);
    expect(decoded.agentId).toBe('agent-1');
    expect(decoded.role).toBe('admin');
  });

  test('verifyToken throws for an invalid token', () => {
    expect(() => verifyToken('not-a-token')).toThrow();
  });
});
```

- [ ] **Step 3: Rodar o teste e confirmar que falha**

Run: `npm test -- src/auth/auth.service.test.js`
Expected: FAIL com "Cannot find module './auth.service'"

- [ ] **Step 4: Implementar `src/auth/auth.service.js`**

```js
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { findAgentByEmail } = require('../agents/agent.repository');

const TOKEN_EXPIRY = '12h';

async function login({ email, password }) {
  const agent = await findAgentByEmail(email);
  if (!agent) {
    throw new Error('Invalid credentials');
  }
  const matches = await bcrypt.compare(password, agent.passwordHash);
  if (!matches) {
    throw new Error('Invalid credentials');
  }
  const token = jwt.sign(
    { agentId: agent.id, role: agent.role },
    process.env.JWT_SECRET,
    { expiresIn: TOKEN_EXPIRY }
  );
  return { token, agent: { id: agent.id, email: agent.email, role: agent.role } };
}

function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}

module.exports = { login, verifyToken };
```

- [ ] **Step 5: Rodar o teste e confirmar que passa**

Run: `npm test -- src/auth/auth.service.test.js`
Expected: PASS (5 testes)

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/auth/auth.service.js src/auth/auth.service.test.js
git commit -m "feat: add JWT-based auth service"
```

---

### Task 6: Middleware de autenticação (`src/auth/auth.middleware.js`)

**Files:**
- Create: `src/auth/auth.middleware.js`
- Test: `src/auth/auth.middleware.test.js`

**Interfaces:**
- Consumes: `verifyToken(token)` de `src/auth/auth.service.js` (Task 5).
- Produces:
  - `requireAuth(req, res, next)` — popula `req.agent = { agentId, role }` ou responde 401.
  - `requireRole(role)(req, res, next)` — responde 403 se `req.agent.role !== role`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/auth/auth.middleware.test.js`:

```js
jest.mock('./auth.service');
const { verifyToken } = require('./auth.service');
const { requireAuth, requireRole } = require('./auth.middleware');

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

describe('requireAuth', () => {
  beforeEach(() => jest.clearAllMocks());

  test('attaches decoded agent to req and calls next when token is valid', () => {
    verifyToken.mockReturnValue({ agentId: 'agent-1', role: 'agent' });
    const req = { headers: { authorization: 'Bearer valid-token' } };
    const res = mockRes();
    const next = jest.fn();

    requireAuth(req, res, next);

    expect(req.agent).toEqual({ agentId: 'agent-1', role: 'agent' });
    expect(next).toHaveBeenCalled();
  });

  test('returns 401 when authorization header is missing', () => {
    const req = { headers: {} };
    const res = mockRes();
    const next = jest.fn();

    requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('returns 401 when token is invalid', () => {
    verifyToken.mockImplementation(() => { throw new Error('invalid'); });
    const req = { headers: { authorization: 'Bearer bad-token' } };
    const res = mockRes();
    const next = jest.fn();

    requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('requireRole', () => {
  test('calls next when agent has the required role', () => {
    const req = { agent: { role: 'admin' } };
    const res = mockRes();
    const next = jest.fn();

    requireRole('admin')(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  test('returns 403 when agent lacks the required role', () => {
    const req = { agent: { role: 'agent' } };
    const res = mockRes();
    const next = jest.fn();

    requireRole('admin')(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npm test -- src/auth/auth.middleware.test.js`
Expected: FAIL com "Cannot find module './auth.middleware'"

- [ ] **Step 3: Implementar `src/auth/auth.middleware.js`**

```js
const { verifyToken } = require('./auth.service');

function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization token' });
  }
  const token = header.slice('Bearer '.length);
  try {
    req.agent = verifyToken(token);
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireRole(role) {
  return (req, res, next) => {
    if (req.agent?.role !== role) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npm test -- src/auth/auth.middleware.test.js`
Expected: PASS (5 testes)

- [ ] **Step 5: Commit**

```bash
git add src/auth/auth.middleware.js src/auth/auth.middleware.test.js
git commit -m "feat: add auth middleware for protected routes"
```

---

### Task 7: Rota de login e integração no servidor

**Files:**
- Create: `src/auth/auth.routes.js`
- Create: `src/auth/auth.routes.test.js`
- Modify: `src/server.js`
- Create: `src/server.test.js`

**Interfaces:**
- Consumes: `login()` de `src/auth/auth.service.js` (Task 5); `loadConfig()` (Task 1); `getPool()` (Task 2).
- Produces: `POST /api/auth/login` (200 + `{ token, agent }` | 400 | 401); `GET /health` retorna `{ status: 'ok', db: 'ok' | 'unreachable' }`; `module.exports = app` (Express app, sem chamar `listen` quando importado como módulo).

- [ ] **Step 1: Escrever o teste que falha para a rota**

Criar `src/auth/auth.routes.test.js`:

```js
jest.mock('./auth.service');
const request = require('supertest');
const express = require('express');
const { login } = require('./auth.service');
const authRoutes = require('./auth.routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  return app;
}

describe('POST /api/auth/login', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns 200 and a token on valid credentials', async () => {
    login.mockResolvedValue({ token: 'jwt-token', agent: { id: '1', email: 'a@dw.com', role: 'agent' } });
    const res = await request(buildApp()).post('/api/auth/login').send({ email: 'a@dw.com', password: 'secret123' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBe('jwt-token');
  });

  test('returns 400 when email is missing', async () => {
    const res = await request(buildApp()).post('/api/auth/login').send({ password: 'secret123' });
    expect(res.status).toBe(400);
  });

  test('returns 401 when login rejects', async () => {
    login.mockRejectedValue(new Error('Invalid credentials'));
    const res = await request(buildApp()).post('/api/auth/login').send({ email: 'a@dw.com', password: 'wrong' });
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npm test -- src/auth/auth.routes.test.js`
Expected: FAIL com "Cannot find module './auth.routes'"

- [ ] **Step 3: Implementar `src/auth/auth.routes.js`**

```js
const express = require('express');
const { login } = require('./auth.service');

const router = express.Router();

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }
  try {
    const result = await login({ email, password });
    res.json(result);
  } catch (err) {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

module.exports = router;
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npm test -- src/auth/auth.routes.test.js`
Expected: PASS (3 testes)

- [ ] **Step 5: Reescrever `src/server.js`**

```js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { loadConfig } = require('./config/env');
const { getPool } = require('./db/pool');
const authRoutes = require('./auth/auth.routes');

const config = loadConfig();
const app = express();

app.use(cors());
app.use(express.json());

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

if (require.main === module) {
  app.listen(config.port, () => {
    console.log('Servidor rodando na porta ' + config.port);
  });
}

module.exports = app;
```

- [ ] **Step 6: Escrever o teste do servidor**

Criar `src/server.test.js`:

```js
const request = require('supertest');
const { closePool } = require('./db/pool');
const app = require('./server');

describe('GET /health', () => {
  afterAll(async () => {
    await closePool();
  });

  test('returns ok status with db reachable', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', db: 'ok' });
  });
});
```

- [ ] **Step 7: Rodar toda a suíte de testes e confirmar que passa**

Run: `npm test`
Expected: PASS em todos os arquivos (env, pool, schema, agent.repository, auth.service, auth.middleware, auth.routes, server)

- [ ] **Step 8: Commit**

```bash
git add src/auth/auth.routes.js src/auth/auth.routes.test.js src/server.js src/server.test.js
git commit -m "feat: wire login route and db-aware health check into server"
```

---

### Task 8: Script para criar o primeiro atendente admin

**Files:**
- Create: `scripts/create-agent.js`

**Interfaces:**
- Consumes: `createAgent()` de `src/agents/agent.repository.js` (Task 4); `closePool()` de `src/db/pool.js` (Task 2).
- Produces: script CLI, sem interface para outros módulos.

- [ ] **Step 1: Implementar `scripts/create-agent.js`**

```js
require('dotenv').config();
const { createAgent } = require('../src/agents/agent.repository');
const { closePool } = require('../src/db/pool');

async function main() {
  const [, , email, password, role = 'agent'] = process.argv;
  if (!email || !password) {
    console.error('Usage: node scripts/create-agent.js <email> <password> [role]');
    process.exitCode = 1;
    return;
  }
  const agent = await createAgent({ email, password, role });
  console.log('Agent created:', agent);
}

main().finally(() => closePool());
```

- [ ] **Step 2: Verificação manual — criar o admin no banco de teste**

```bash
dotenv -e .env.test -- node scripts/create-agent.js admin@dwtelecom.com.br supersecret123 admin
```

Confirmar que o console mostra o agente criado com um `id`.

- [ ] **Step 3: Verificação manual — login end-to-end**

Em um terminal, suba o servidor apontando para o banco de teste:

```bash
dotenv -e .env.test -- npm start
```

Em outro terminal:

```bash
curl -X POST http://localhost:3000/api/auth/login -H "Content-Type: application/json" -d "{\"email\":\"admin@dwtelecom.com.br\",\"password\":\"supersecret123\"}"
```

Confirmar que a resposta contém um `token` JWT.

- [ ] **Step 4: Commit**

```bash
git add scripts/create-agent.js
git commit -m "feat: add CLI script to bootstrap the first admin agent"
```

---

## Self-Review

**Cobertura do spec:** módulo `db/` (schema completo das 6 tabelas), autenticação de atendentes (`agents`, JWT, papéis `agent`/`admin`) e o pré-requisito de configuração de ambiente estão cobertos. Os módulos `whatsapp-adapters/`, `conversations/`, `outbound-queue/`, `realtime/` e o restante de `api/` ficam para os próximos planos (fora do escopo desta fundação).

**Placeholders:** nenhum "TBD"/"depois" — todo passo tem código completo ou comando exato.

**Consistência de tipos:** `createAgent`/`findAgentByEmail`/`findAgentById` usam os mesmos nomes de campo (`id`, `email`, `role`, `passwordHash`, `createdAt`) em todas as tasks que os consomem (5, 6 via `auth.service`, 8 via script). `verifyToken` retorna `{ agentId, role }`, usado de forma consistente em `auth.middleware.js` (Task 6) e nos testes de Task 5/6.
