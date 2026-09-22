# Cadastro de Planos (Etapa 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar o cadastro estruturado de planos comerciais no painel, para que preço, velocidade e condição de instalação deixem de existir apenas como texto livre nas Instruções adicionais da IA.

**Architecture:** Tabela nova `plans`, repositório próprio e duas formas de resposta: a administrativa, que inclui a observação interna, e a operacional, que **não inclui**. Nasce **inerte** — nenhum consumidor de IA é criado neste plano. É independente do plano de Cidades e Localidades e pode correr em paralelo com ele.

**Tech Stack:** Node.js + Express, PostgreSQL 16.15, `node-pg-migrate`, Jest, React + Vite + Vitest, Tailwind v4.

**Spec:** [`docs/superpowers/specs/2026-09-22-cadastros-e-contexto-dinamico-design.md`](../specs/2026-09-22-cadastros-e-contexto-dinamico-design.md) — seções B1, B2 e B6.

## Global Constraints

- **Nada de IA neste plano.** Não criar ferramenta, não tocar em prompt, compositor, `tool-registry` ou `ai_config`. As Instruções adicionais **continuam como estão** — esvaziá-las é Etapa 4 e exige que as ferramentas estejam provadas antes.
- **`note` nunca sai do escopo administrativo.** A resposta operacional **não tem a chave** — não `null`, não string vazia. É o padrão do ADR-008, o mesmo já usado na nota interna do contato.
- **Preço é `NUMERIC(10,2)`,** nunca texto formatado. `R$ 100,00` é responsabilidade da camada de exibição.
- **Velocidade é `INTEGER` nullable.** Nulo significa "plano sem velocidade" (TV, combo), e é mais honesto que zero.
- **Não criar `plan_coverage` nem parâmetro `localityId`.** A porta para cobertura por plano é a existência do serviço, não um argumento que hoje seria ignorado.
- **Backend:** `npm test -- <arquivo>`. **Frontend:** `cd frontend && npx vitest run <arquivo>`.
- **Commit a cada task.** Nunca `push`, `merge` ou `deploy` sem autorização explícita.

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `migrations/1789250000000_create-plans.js` | Tabela `plans` |
| `src/plans/plan.repository.js` | Leitura e escrita. Expõe as duas formas de resposta |
| `src/api/plans.routes.js` | `GET /api/plans` — operacional, sem `note` |
| `src/api/admin-plans.routes.js` | CRUD administrativo |
| `frontend/src/pages/settings/registers/PlansPage.jsx` | Página, no grupo Cadastros auxiliares |
| `frontend/src/components/PlansAdminTab.jsx` | Tabela e ações |
| `frontend/src/components/PlanForm.jsx` | Criação e edição |
| `frontend/src/hooks/usePlans.js` | Carregamento |

---

### Task 1: Tabela `plans`

**Files:**
- Create: `migrations/1789250000000_create-plans.js`
- Test: `src/plans/plan-schema.migration.test.js`

**Interfaces:**
- Consumes: nada.
- Produces: tabela `plans`.

- [ ] **Step 1: Write the failing test**

Arquivo `src/plans/plan-schema.migration.test.js`:

```js
const { getPool, closePool } = require('../db/pool');

describe('esquema de plans', () => {
  beforeEach(async () => {
    await getPool().query('TRUNCATE plans CASCADE');
  });

  afterAll(async () => {
    await closePool();
  });

  test('nasce ativo, sem observacao e na ordem zero', async () => {
    const { rows } = await getPool().query(
      "INSERT INTO plans (name, monthly_price) VALUES ('500 Mega', 100) RETURNING speed_mbps, install_condition, active, sort_order, note"
    );
    expect(rows[0].speed_mbps).toBeNull();
    expect(rows[0].install_condition).toBe('');
    expect(rows[0].active).toBe(true);
    expect(rows[0].sort_order).toBe(0);
    expect(rows[0].note).toBe('');
  });

  test('preco guarda duas casas sem virar texto', async () => {
    const { rows } = await getPool().query(
      "INSERT INTO plans (name, monthly_price) VALUES ('Teste', 99.9) RETURNING monthly_price"
    );
    expect(Number(rows[0].monthly_price)).toBe(99.9);
  });

  test('preco negativo e recusado', async () => {
    await expect(
      getPool().query("INSERT INTO plans (name, monthly_price) VALUES ('Errado', -1)")
    ).rejects.toThrow(/plans_preco_nao_negativo/);
  });

  test('velocidade zero ou negativa e recusada, mas nula e aceita', async () => {
    await expect(
      getPool().query("INSERT INTO plans (name, monthly_price, speed_mbps) VALUES ('Errado', 10, 0)")
    ).rejects.toThrow(/plans_velocidade_positiva/);

    const { rows } = await getPool().query(
      "INSERT INTO plans (name, monthly_price, speed_mbps) VALUES ('TV', 50, NULL) RETURNING speed_mbps"
    );
    expect(rows[0].speed_mbps).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/plans/plan-schema.migration.test.js`
Expected: FAIL — `relation "plans" does not exist`.

- [ ] **Step 3: Write the migration**

Arquivo `migrations/1789250000000_create-plans.js`:

```js
// Catálogo comercial de planos. Hoje ele só existe como TEXTO LIVRE dentro de
// ai_config.triage_extra_instructions, colado verbatim no prompt — o que
// significa que o preço vai para a OpenAI em toda conversa, inclusive nas de
// boleto, e que uma alteração de preço depende de alguém reescrever o texto.
//
// monthly_price é NUMERIC, nunca texto formatado: é o que de fato elimina o
// risco de preço desatualizado. "R$ 100,00" é problema da camada de exibição.
//
// speed_mbps é INTEGER e NULLABLE. Inteiro para ordenar, comparar e filtrar sem
// parsing, e para lidar com 1000 Mbps. Nulo porque o SGP já tem planotv: um
// plano de TV ou combo não tem velocidade, e nulo é mais honesto que zero.
//
// note é INTERNA: não sai na resposta operacional nem chega à IA. Quem decide
// isso é a forma da resposta no repositório, não a obediência do modelo.
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS plans (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name              TEXT NOT NULL,
      speed_mbps        INTEGER,
      monthly_price     NUMERIC(10,2) NOT NULL,
      install_condition TEXT NOT NULL DEFAULT '',
      active            BOOLEAN NOT NULL DEFAULT true,
      sort_order        INTEGER NOT NULL DEFAULT 0,
      note              TEXT NOT NULL DEFAULT '',
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT plans_preco_nao_negativo  CHECK (monthly_price >= 0),
      CONSTRAINT plans_velocidade_positiva CHECK (speed_mbps IS NULL OR speed_mbps > 0)
    );

    CREATE INDEX IF NOT EXISTS plans_ordem_idx ON plans (sort_order ASC, name ASC);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS plans_ordem_idx;
    DROP TABLE IF EXISTS plans;
  `);
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/plans/plan-schema.migration.test.js`
Expected: PASS, 4 testes.

- [ ] **Step 5: Verificar o `down`**

Run: `npx dotenv -e .env.test -o -- node-pg-migrate down 1 && npx dotenv -e .env.test -o -- node-pg-migrate up`
Expected: as duas rodam sem erro.

- [ ] **Step 6: Commit**

```bash
git add migrations/1789250000000_create-plans.js src/plans/plan-schema.migration.test.js
git commit -m "Tabela de planos comerciais, com preco numerico e velocidade inteira

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Repositório, com as duas formas de resposta

**Files:**
- Create: `src/plans/plan.repository.js`
- Test: `src/plans/plan.repository.test.js`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `listPlansForAdmin() → Promise<PlanoAdmin[]>` — todos, com `note`
  - `listarPlanosDisponiveis() → Promise<PlanoOperacional[]>` — só ativos, **sem `note`**
  - `createPlan({ name, speedMbps, monthlyPrice, installCondition, active, sortOrder, note }) → Promise<PlanoAdmin>`
  - `updatePlan(id, patch) → Promise<PlanoAdmin|null>` — parcial
  - `deletePlan(id) → Promise<boolean>`
  - `PlanoAdmin = { id, name, speedMbps, monthlyPrice, installCondition, active, sortOrder, note, createdAt }`
  - `PlanoOperacional = { id, name, speedMbps, monthlyPrice, installCondition }`

- [ ] **Step 1: Write the failing test**

Arquivo `src/plans/plan.repository.test.js`:

```js
const { getPool, closePool } = require('../db/pool');
const {
  listPlansForAdmin, listarPlanosDisponiveis, createPlan, updatePlan, deletePlan,
} = require('./plan.repository');

describe('plan repository', () => {
  beforeEach(async () => {
    await getPool().query('TRUNCATE plans CASCADE');
  });

  afterAll(async () => {
    await closePool();
  });

  test('createPlan guarda e devolve o plano', async () => {
    const plano = await createPlan({ name: '500 Mega', speedMbps: 500, monthlyPrice: 100, installCondition: 'Gratis' });

    expect(plano.id).toBeDefined();
    expect(plano.speedMbps).toBe(500);
    expect(plano.monthlyPrice).toBe(100);
    expect(plano.installCondition).toBe('Gratis');
    expect(plano.active).toBe(true);
  });

  test('monthlyPrice volta como numero, nao string', async () => {
    const plano = await createPlan({ name: 'Teste', monthlyPrice: 99.9 });
    expect(typeof plano.monthlyPrice).toBe('number');
    expect(plano.monthlyPrice).toBe(99.9);
  });

  test('a lista operacional traz so os ativos e NAO traz note', async () => {
    await createPlan({ name: 'Ativo', monthlyPrice: 100, note: 'segredo' });
    await createPlan({ name: 'Inativo', monthlyPrice: 130, active: false });

    const planos = await listarPlanosDisponiveis();

    expect(planos.map((p) => p.name)).toEqual(['Ativo']);
    expect(planos[0]).not.toHaveProperty('note');
    expect(Object.keys(planos[0]).sort()).toEqual(
      ['id', 'installCondition', 'monthlyPrice', 'name', 'speedMbps'].sort()
    );
  });

  test('a lista administrativa traz inativos e traz note', async () => {
    await createPlan({ name: 'Inativo', monthlyPrice: 130, active: false, note: 'margem baixa' });

    const planos = await listPlansForAdmin();

    expect(planos).toHaveLength(1);
    expect(planos[0].note).toBe('margem baixa');
  });

  test('ordena por sortOrder e depois por nome', async () => {
    await createPlan({ name: 'C', monthlyPrice: 10, sortOrder: 2 });
    await createPlan({ name: 'A', monthlyPrice: 10, sortOrder: 1 });
    await createPlan({ name: 'B', monthlyPrice: 10, sortOrder: 1 });

    expect((await listarPlanosDisponiveis()).map((p) => p.name)).toEqual(['A', 'B', 'C']);
  });

  test('updatePlan nao mexe em chave ausente e aceita valor falso', async () => {
    const plano = await createPlan({ name: 'Original', monthlyPrice: 100, note: 'fica', active: true });

    const so_nome = await updatePlan(plano.id, { name: 'Renomeado' });
    expect(so_nome.note).toBe('fica');
    expect(so_nome.active).toBe(true);

    const desligado = await updatePlan(plano.id, { active: false, note: '', speedMbps: null });
    expect(desligado.active).toBe(false);
    expect(desligado.note).toBe('');
    expect(desligado.speedMbps).toBeNull();
  });

  test('updatePlan devolve null quando o id nao existe', async () => {
    expect(await updatePlan('00000000-0000-0000-0000-000000000000', { name: 'x' })).toBeNull();
  });

  test('deletePlan remove e devolve true, ou false quando nao existe', async () => {
    const plano = await createPlan({ name: 'Sai', monthlyPrice: 10 });
    expect(await deletePlan(plano.id)).toBe(true);
    expect(await deletePlan(plano.id)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/plans/plan.repository.test.js`
Expected: FAIL — `Cannot find module './plan.repository'`.

- [ ] **Step 3: Write the implementation**

Arquivo `src/plans/plan.repository.js`:

```js
const { getPool } = require('../db/pool');

// Colunas enumeradas: o projeto não usa SELECT *.
const COLUNAS = 'id, name, speed_mbps, monthly_price, install_condition, active, sort_order, note, created_at';

// Duas formas de resposta, e a separação é ESTRUTURAL — não depende de a IA
// ignorar o campo. Quem não pode ver `note` recebe a resposta SEM A CHAVE: não
// null, não string vazia. Aplicação direta do ADR-008.
function paraAdmin(row) {
  return {
    id: row.id,
    name: row.name,
    speedMbps: row.speed_mbps,
    // NUMERIC volta como string no driver pg: converter aqui, uma vez, para o
    // resto do sistema nunca precisar lembrar disso.
    monthlyPrice: Number(row.monthly_price),
    installCondition: row.install_condition,
    active: row.active,
    sortOrder: row.sort_order,
    note: row.note,
    createdAt: row.created_at,
  };
}

function paraOperacao(row) {
  return {
    id: row.id,
    name: row.name,
    speedMbps: row.speed_mbps,
    monthlyPrice: Number(row.monthly_price),
    installCondition: row.install_condition,
  };
}

const ORDEM = 'ORDER BY sort_order ASC, name ASC';

async function listPlansForAdmin() {
  const result = await getPool().query(`SELECT ${COLUNAS} FROM plans ${ORDEM}`);
  return result.rows.map(paraAdmin);
}

// Sem argumento de propósito. A porta para cobertura por plano é a existência
// deste serviço, não um parâmetro que hoje seria ignorado — abstração morta é
// dívida, não preparação.
async function listarPlanosDisponiveis() {
  const result = await getPool().query(`SELECT ${COLUNAS} FROM plans WHERE active = true ${ORDEM}`);
  return result.rows.map(paraOperacao);
}

async function createPlan({
  name, speedMbps = null, monthlyPrice, installCondition = '', active = true, sortOrder = 0, note = '',
}) {
  const result = await getPool().query(
    `INSERT INTO plans (name, speed_mbps, monthly_price, install_condition, active, sort_order, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${COLUNAS}`,
    [name, speedMbps, monthlyPrice, installCondition, active, sortOrder, note]
  );
  return paraAdmin(result.rows[0]);
}

// Escrita parcial no padrão do ADR-011: o que decide "não mexe" é a chave NÃO
// ESTAR no objeto, nunca o valor ser falso, zero ou vazio.
const CAMPOS = {
  name: 'name',
  speedMbps: 'speed_mbps',
  monthlyPrice: 'monthly_price',
  installCondition: 'install_condition',
  active: 'active',
  sortOrder: 'sort_order',
  note: 'note',
};

async function updatePlan(id, patch = {}) {
  const partes = [];
  const valores = [id];
  for (const [chave, coluna] of Object.entries(CAMPOS)) {
    if (!(chave in patch)) continue;
    valores.push(patch[chave]);
    partes.push(`${coluna} = $${valores.length}`);
  }
  if (partes.length === 0) {
    const atual = await getPool().query(`SELECT ${COLUNAS} FROM plans WHERE id = $1`, [id]);
    return atual.rowCount === 0 ? null : paraAdmin(atual.rows[0]);
  }
  partes.push('updated_at = now()');
  const result = await getPool().query(
    `UPDATE plans SET ${partes.join(', ')} WHERE id = $1 RETURNING ${COLUNAS}`,
    valores
  );
  if (result.rowCount === 0) return null;
  return paraAdmin(result.rows[0]);
}

async function deletePlan(id) {
  const result = await getPool().query('DELETE FROM plans WHERE id = $1', [id]);
  return result.rowCount > 0;
}

module.exports = { listPlansForAdmin, listarPlanosDisponiveis, createPlan, updatePlan, deletePlan };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/plans/plan.repository.test.js`
Expected: PASS, 8 testes.

- [ ] **Step 5: Commit**

```bash
git add src/plans/plan.repository.js src/plans/plan.repository.test.js
git commit -m "Repositorio de planos, com resposta operacional sem a observacao interna

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Rotas de planos

**Files:**
- Create: `src/api/plans.routes.js`, `src/api/admin-plans.routes.js`
- Modify: `src/server.js`
- Test: `src/api/plans.routes.test.js`, `src/api/admin-plans.routes.test.js`

**Interfaces:**
- Consumes: Task 2.
- Produces:
  - `GET /api/plans` — `requireAuth`, resposta operacional
  - `GET|POST /api/admin/plans`, `PATCH|DELETE /api/admin/plans/:id` — `requireAuth` + `requireRole('admin')`

- [ ] **Step 1: Write the failing test**

Arquivo `src/api/plans.routes.test.js` (seguir o helper de autenticação dos outros testes de rota):

```js
test('GET /api/plans devolve so ativos e nunca a observacao interna', async () => {
  await createPlan({ name: 'Ativo', monthlyPrice: 100, note: 'segredo' });
  await createPlan({ name: 'Inativo', monthlyPrice: 130, active: false });

  const res = await request(app).get('/api/plans').set('Authorization', `Bearer ${token}`);

  expect(res.status).toBe(200);
  expect(res.body.map((p) => p.name)).toEqual(['Ativo']);
  expect(res.body[0]).not.toHaveProperty('note');
});

test('GET /api/plans exige autenticacao', async () => {
  const res = await request(app).get('/api/plans');
  expect(res.status).toBe(401);
});
```

Arquivo `src/api/admin-plans.routes.test.js`:

```js
test('POST cria e devolve 201', async () => {
  const res = await request(app).post('/api/admin/plans')
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .send({ name: '500 Mega', speedMbps: 500, monthlyPrice: 100, installCondition: 'Gratis' });

  expect(res.status).toBe(201);
  expect(res.body.monthlyPrice).toBe(100);
});

test('POST recusa nome vazio', async () => {
  const res = await request(app).post('/api/admin/plans')
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .send({ name: '   ', monthlyPrice: 100 });

  expect(res.status).toBe(400);
  expect(res.body.error).toBe('name is required');
});

test('POST recusa preco ausente, negativo ou nao numerico', async () => {
  for (const monthlyPrice of [undefined, -1, 'cem']) {
    const res = await request(app).post('/api/admin/plans')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ name: 'Teste', monthlyPrice });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('monthlyPrice is invalid');
  }
});

test('POST recusa velocidade nao inteira ou nao positiva', async () => {
  for (const speedMbps of [0, -5, 1.5, '500'] ) {
    const res = await request(app).post('/api/admin/plans')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ name: 'Teste', monthlyPrice: 100, speedMbps });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('speedMbps is invalid');
  }
});

test('PATCH altera so o que veio', async () => {
  const plano = await createPlan({ name: 'Original', monthlyPrice: 100, note: 'fica' });

  const res = await request(app).patch(`/api/admin/plans/${plano.id}`)
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .send({ monthlyPrice: 150 });

  expect(res.status).toBe(200);
  expect(res.body.monthlyPrice).toBe(150);
  expect(res.body.note).toBe('fica');
});

test('PATCH de id inexistente devolve 404', async () => {
  const res = await request(app).patch('/api/admin/plans/00000000-0000-0000-0000-000000000000')
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .send({ name: 'x' });
  expect(res.status).toBe(404);
});

test('atendente comum nao administra planos', async () => {
  const res = await request(app).post('/api/admin/plans')
    .set('Authorization', `Bearer ${tokenAgente}`)
    .send({ name: 'Teste', monthlyPrice: 100 });
  expect(res.status).toBe(403);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/api/plans.routes.test.js src/api/admin-plans.routes.test.js`
Expected: FAIL — 404 em todas as rotas.

- [ ] **Step 3: Write the implementation**

Arquivo `src/api/plans.routes.js`:

```js
const express = require('express');
const { requireAuth } = require('../auth/auth.middleware');
const { listarPlanosDisponiveis } = require('../plans/plan.repository');

const router = express.Router();

// Resposta OPERACIONAL: sem a observação interna. A separação é estrutural —
// a chave não existe na resposta.
router.get('/', requireAuth, async (req, res) => {
  res.json(await listarPlanosDisponiveis());
});

module.exports = router;
```

Arquivo `src/api/admin-plans.routes.js`:

```js
const express = require('express');
const { requireAuth, requireRole } = require('../auth/auth.middleware');
const { listPlansForAdmin, createPlan, updatePlan, deletePlan } = require('../plans/plan.repository');

const router = express.Router();

function precoValido(valor) {
  return typeof valor === 'number' && Number.isFinite(valor) && valor >= 0;
}

// Nulo é legítimo: plano de TV ou combo não tem velocidade.
function velocidadeValida(valor) {
  return valor === null || valor === undefined || (Number.isInteger(valor) && valor > 0);
}

router.get('/', requireAuth, requireRole('admin'), async (req, res) => {
  res.json(await listPlansForAdmin());
});

router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  const corpo = req.body || {};
  const name = typeof corpo.name === 'string' ? corpo.name.trim() : '';
  if (!name) return res.status(400).json({ error: 'name is required' });
  if (!precoValido(corpo.monthlyPrice)) return res.status(400).json({ error: 'monthlyPrice is invalid' });
  if (!velocidadeValida(corpo.speedMbps)) return res.status(400).json({ error: 'speedMbps is invalid' });

  const plano = await createPlan({
    name,
    speedMbps: corpo.speedMbps === undefined ? null : corpo.speedMbps,
    monthlyPrice: corpo.monthlyPrice,
    installCondition: typeof corpo.installCondition === 'string' ? corpo.installCondition.trim() : '',
    active: typeof corpo.active === 'boolean' ? corpo.active : true,
    sortOrder: Number.isInteger(corpo.sortOrder) ? corpo.sortOrder : 0,
    note: typeof corpo.note === 'string' ? corpo.note.trim() : '',
  });
  res.status(201).json(plano);
});

router.patch('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const corpo = req.body || {};
  const patch = {};

  if ('name' in corpo) {
    const name = typeof corpo.name === 'string' ? corpo.name.trim() : '';
    if (!name) return res.status(400).json({ error: 'name is required' });
    patch.name = name;
  }
  if ('monthlyPrice' in corpo) {
    if (!precoValido(corpo.monthlyPrice)) return res.status(400).json({ error: 'monthlyPrice is invalid' });
    patch.monthlyPrice = corpo.monthlyPrice;
  }
  if ('speedMbps' in corpo) {
    if (!velocidadeValida(corpo.speedMbps)) return res.status(400).json({ error: 'speedMbps is invalid' });
    patch.speedMbps = corpo.speedMbps === undefined ? null : corpo.speedMbps;
  }
  if ('installCondition' in corpo) patch.installCondition = String(corpo.installCondition || '').trim();
  if ('note' in corpo) patch.note = String(corpo.note || '').trim();
  if ('active' in corpo) {
    if (typeof corpo.active !== 'boolean') return res.status(400).json({ error: 'active must be a boolean' });
    patch.active = corpo.active;
  }
  if ('sortOrder' in corpo) {
    if (!Number.isInteger(corpo.sortOrder)) return res.status(400).json({ error: 'sortOrder is invalid' });
    patch.sortOrder = corpo.sortOrder;
  }

  const plano = await updatePlan(req.params.id, patch);
  if (!plano) return res.status(404).json({ error: 'Plan not found' });
  res.json(plano);
});

router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const removido = await deletePlan(req.params.id);
  if (!removido) return res.status(404).json({ error: 'Plan not found' });
  res.status(204).send();
});

module.exports = router;
```

Em `src/server.js`, ao lado das montagens de cidades:

```js
app.use('/api/plans', plansRoutes);
app.use('/api/admin/plans', adminPlansRoutes);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/api/plans.routes.test.js src/api/admin-plans.routes.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/api/plans.routes.js src/api/admin-plans.routes.js src/server.js src/api/plans.routes.test.js src/api/admin-plans.routes.test.js
git commit -m "Rotas de planos: operacional sem observacao, administracao com CRUD

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Tela de Planos

**Files:**
- Create: `frontend/src/pages/settings/registers/PlansPage.jsx`, `frontend/src/components/PlansAdminTab.jsx`, `frontend/src/components/PlanForm.jsx`, `frontend/src/hooks/usePlans.js`
- Modify: `frontend/src/services/api.js`, `frontend/src/navigation/navItems.js`, `frontend/src/App.jsx`
- Test: `frontend/src/components/PlansAdminTab.test.jsx`, `frontend/src/components/PlanForm.test.jsx`

**Interfaces:**
- Consumes: Task 3.
- Produces: rota `/configuracoes/cadastros/planos`, no grupo **Cadastros auxiliares**, `level: 'admin'`.

- [ ] **Step 1: Write the failing test**

Arquivo `frontend/src/components/PlanForm.test.jsx`:

```jsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import PlanForm from './PlanForm';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ token: 't' }) }));

test('envia preco como numero, nao como texto', async () => {
  const spy = vi.spyOn(api, 'createPlan').mockResolvedValue({});
  render(<PlanForm plan={null} onSaved={vi.fn()} onCancel={vi.fn()} />);

  await userEvent.type(screen.getByLabelText('Nome'), '500 Mega');
  await userEvent.type(screen.getByLabelText('Velocidade (Mbps)'), '500');
  await userEvent.type(screen.getByLabelText('Mensalidade (R$)'), '100,50');
  await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));

  expect(spy).toHaveBeenCalledWith(
    expect.objectContaining({ name: '500 Mega', speedMbps: 500, monthlyPrice: 100.5 }),
    't'
  );
});

test('velocidade em branco vira null, nao zero', async () => {
  const spy = vi.spyOn(api, 'createPlan').mockResolvedValue({});
  render(<PlanForm plan={null} onSaved={vi.fn()} onCancel={vi.fn()} />);

  await userEvent.type(screen.getByLabelText('Nome'), 'TV');
  await userEvent.type(screen.getByLabelText('Mensalidade (R$)'), '50');
  await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));

  expect(spy).toHaveBeenCalledWith(expect.objectContaining({ speedMbps: null }), 't');
});

test('a observacao e apresentada como interna', () => {
  render(<PlanForm plan={null} onSaved={vi.fn()} onCancel={vi.fn()} />);
  expect(screen.getByText(/nunca é enviada ao cliente/i)).toBeInTheDocument();
});
```

Arquivo `frontend/src/components/PlansAdminTab.test.jsx`:

```jsx
test('mostra o preco formatado em real brasileiro', async () => {
  vi.spyOn(api, 'listPlansForAdmin').mockResolvedValue([
    { id: '1', name: '500 Mega', speedMbps: 500, monthlyPrice: 100, installCondition: 'Gratis', active: true, sortOrder: 0, note: '' },
  ]);
  render(<PlansAdminTab />);
  expect(await screen.findByText('R$ 100,00')).toBeInTheDocument();
  expect(screen.getByText('500 Mbps')).toBeInTheDocument();
});

test('plano sem velocidade mostra tracinho, nao zero', async () => {
  vi.spyOn(api, 'listPlansForAdmin').mockResolvedValue([
    { id: '1', name: 'TV', speedMbps: null, monthlyPrice: 50, installCondition: '', active: true, sortOrder: 0, note: '' },
  ]);
  render(<PlansAdminTab />);
  expect(await screen.findByText('—')).toBeInTheDocument();
});

test('plano inativo aparece marcado', async () => {
  vi.spyOn(api, 'listPlansForAdmin').mockResolvedValue([
    { id: '1', name: 'Antigo', speedMbps: 300, monthlyPrice: 80, installCondition: '', active: false, sortOrder: 0, note: '' },
  ]);
  render(<PlansAdminTab />);
  expect(await screen.findByText('Inativo')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/PlanForm.test.jsx src/components/PlansAdminTab.test.jsx`
Expected: FAIL — módulos não existem.

- [ ] **Step 3: Write the implementation**

Em `frontend/src/services/api.js`:

> `GET /api/plans` **não ganha cliente no frontend**: nenhuma tela da Etapa 1 o consome, e exportar uma função que ninguém chama é código morto. Ele existe para o backend da Etapa 4.

```js
export function listPlansForAdmin(token) {
  return apiFetch('/api/admin/plans', { token });
}

export function createPlan(payload, token) {
  return apiFetch('/api/admin/plans', { method: 'POST', body: payload, token });
}

export function updatePlan(id, payload, token) {
  return apiFetch(`/api/admin/plans/${id}`, { method: 'PATCH', body: payload, token });
}

export function deletePlan(id, token) {
  return apiFetch(`/api/admin/plans/${id}`, { method: 'DELETE', token });
}
```

Arquivo `frontend/src/hooks/usePlans.js`, no mesmo formato de `useCities.js`, chamando `listPlansForAdmin(token)` e devolvendo `{ plans, status, error, loading, refresh }`.

Arquivo `frontend/src/components/PlanForm.jsx`, no mesmo estilo de `CityForm`/`CreateCityForm` (mesmas classes Tailwind, `Button`, `descreverErro`), com os campos **Nome**, **Velocidade (Mbps)**, **Mensalidade (R$)**, **Condição de instalação**, **Ativo**, **Ordem de exibição** e **Observação**. A observação leva o texto de ajuda *"Uso interno da equipe. Nunca é enviada ao cliente nem à assistente virtual."*

A conversão do preço aceita vírgula decimal, porque é como o operador brasileiro digita:

```js
function precoEmNumero(texto) {
  const limpo = String(texto || '').trim().replace(/\./g, '').replace(',', '.');
  const numero = Number(limpo);
  return Number.isFinite(numero) ? numero : null;
}

// Em branco significa "plano sem velocidade" — null, nunca 0.
function velocidadeEmNumero(texto) {
  const limpo = String(texto || '').trim();
  if (!limpo) return null;
  const numero = Number(limpo);
  return Number.isInteger(numero) && numero > 0 ? numero : null;
}
```

Arquivo `frontend/src/components/PlansAdminTab.jsx`, espelhando `CitiesAdminTab.jsx`: `ui/DataTable` com as colunas **Nome**, **Velocidade**, **Mensalidade**, **Instalação**, **Situação**, **Ações**; `WaDialog` para criar e editar; `confirm()` antes de excluir. Formatação:

```js
const MOEDA = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const formatarPreco = (valor) => MOEDA.format(valor);
const formatarVelocidade = (mbps) => (mbps ? `${mbps} Mbps` : '—');
```

Arquivo `frontend/src/pages/settings/registers/PlansPage.jsx`, espelhando `CitiesPage.jsx`, com `title="Planos"` e `description="Os planos comerciais oferecidos: velocidade, mensalidade e condição de instalação."`.

Em `navItems.js`, dentro do grupo `cadastros`: `{ key: 'planos', label: 'Planos', to: '/configuracoes/cadastros/planos', level: 'admin' }`.
Em `App.jsx`, dentro do `RegistersLayout`: `<Route path="planos" element={<PlansPage />} />`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/PlanForm.test.jsx src/components/PlansAdminTab.test.jsx`
Expected: PASS.

- [ ] **Step 5: Rodar a suíte inteira dos dois lados**

Run: `npm test` e depois `cd frontend && npx vitest run`
Expected: PASS nos dois.

- [ ] **Step 6: Commit**

```bash
git add -A frontend/src src/api
git commit -m "Tela de cadastro de planos, em Cadastros auxiliares

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Depois deste plano

O cadastro existe e está **inerte**: nenhuma ferramenta o consulta e o prompt continua lendo as Instruções adicionais.

Ligar os planos à IA é a **Etapa 4** da spec — `consultar_planos`, `verificar_cobertura`, a guarda de proveniência e, só depois de tudo provado, a retirada do bloco das Instruções adicionais. Toca área protegida e **não começa sem aprovação própria**.
