# Cidades e Localidades (Etapa 1 — estrutura) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer o cadastro de Cidades representar também povoados e localidades, com município pai e POP do SGP, sem alterar o comportamento de nenhum consumidor existente.

**Architecture:** Evolução **aditiva** da tabela `cities` — ela passa a guardar município e localidade na mesma lista, distinguidos por `kind`. `contacts` ganha `locality_id` ao lado do `city_id` que já existe, e a invariante "a localidade pertence ao município do contato" é garantida por chave estrangeira composta no banco. Os registros que já existem recebem `kind='unclassified'` e continuam aparecendo exatamente onde aparecem hoje. **Nenhum dado é convertido por este plano.**

**Tech Stack:** Node.js + Express, PostgreSQL 16.15, `node-pg-migrate`, Jest (backend), React + Vite + Vitest (frontend), Tailwind v4.

**Spec:** [`docs/superpowers/specs/2026-09-22-cadastros-e-contexto-dinamico-design.md`](../specs/2026-09-22-cadastros-e-contexto-dinamico-design.md) — seções A1 a A11 e D1 a D6.

## Global Constraints

- **Não tocar em nenhuma área protegida.** IA, prompts, compositor, `tool-registry`, autorização de ferramentas, OpenAI, transcrição, SGP, Pix/boleto, idempotência, desbloqueio, workers, Baileys, Meta Cloud, 360dialog, janela de 24 h e regras de atendimento **ficam intocados neste plano**.
- **Não converter dado legado.** Os três povoados que já existem em produção (`Aurizona`, `Barão de Tromaí`, `Chega tudo`) permanecem `kind='unclassified'`. A conversão é o plano `2026-09-22-etapa1c-conversao-legado.md`.
- **`listCities()` e `GET /api/cities` mantêm o significado atual:** devolvem `kind IN ('city','unclassified')`. Quem quiser localidades pede explicitamente.
- **`kind` só aceita `'city'`, `'locality'`, `'unclassified'`.** `'unclassified'` é valor de migração: a rota **recusa** criar ou editar para ele.
- **`sgp_pop` ausente é `NULL`,** nunca `''`.
- **`sgp_pop_key` nunca vem da rota.** É derivada, escrita só pelo repositório, usando `normalizar` de `src/cities/city-matcher.js`.
- **`served` nasce `false`.** Cobertura não se deduz da existência do registro.
- **Backend:** `npm test -- <arquivo>`. O `pretest` roda as migrations no banco de teste sozinho. Jest usa `maxWorkers: 1` e força `TZ=UTC`.
- **Frontend:** `cd frontend && npx vitest run <arquivo>`.
- **Commit a cada task.** Nunca `push`, `merge` ou `deploy` sem autorização explícita.

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `migrations/1789230000000_evolve-cities-to-places.js` | Colunas novas de `cities`, CHECKs, índice único de `sgp_pop_key`, `UNIQUE (id, parent_id)`, índice em `contacts.city_id` |
| `migrations/1789240000000_add-contact-locality.js` | `contacts.locality_id`, FK composta, CHECK, índice |
| `src/cities/city.repository.js` | Leitura e escrita de `cities`. Deriva `sgp_pop_key`. Não decide política de rota |
| `src/cities/place-dependencies.js` | Conta o que impede uma edição estrutural ou uma exclusão. Módulo próprio porque é consultado por duas rotas e tem teste próprio |
| `src/api/cities.routes.js` | `GET /api/cities`, com `includeLocalities` opcional |
| `src/api/admin-cities.routes.js` | `POST`, `PATCH`, `DELETE` de cidades/localidades, incluindo os 409 |
| `src/conversations/contact.repository.js` | Passa a ler e gravar `locality_id` |
| `src/conversations/conversation.repository.js` | Passa a trazer a localidade nos resumos de conversa |
| `src/api/contacts.routes.js` | Aceita `localityId`, com a invariante e a limpeza ao trocar de município |
| `frontend/src/services/api.js` | Chamadas novas |
| `frontend/src/hooks/useCities.js` | Municípios (legado) e hierarquia completa |
| `frontend/src/components/CitiesAdminTab.jsx` | Tabela com Tipo, Município, POP, Ativa, Atendida |
| `frontend/src/components/CityForm.jsx` | Criação **e** edição. Substitui `CreateCityForm.jsx` |
| `frontend/src/components/EditContactModal.jsx` | Dois selects encadeados |

---

### Task 1: Migration da estrutura de `cities`

**Files:**
- Create: `migrations/1789230000000_evolve-cities-to-places.js`
- Test: `src/cities/city-schema.migration.test.js`

**Interfaces:**
- Consumes: nada.
- Produces: colunas `kind`, `parent_id`, `sgp_pop`, `sgp_pop_key`, `active`, `served`, `note` em `cities`; constraint `cities_id_parent_unico UNIQUE (id, parent_id)`; índice `contacts_city_id_idx`.

- [ ] **Step 1: Write the failing test**

Arquivo `src/cities/city-schema.migration.test.js`:

```js
const { getPool, closePool } = require('../db/pool');

describe('esquema de cities depois da evolucao para lugares', () => {
  beforeEach(async () => {
    await getPool().query('TRUNCATE cities, contacts CASCADE');
  });

  afterAll(async () => {
    await closePool();
  });

  test('linha legada nasce unclassified, ativa e nao atendida', async () => {
    const { rows } = await getPool().query(
      "INSERT INTO cities (name) VALUES ('Legado') RETURNING kind, parent_id, sgp_pop, sgp_pop_key, active, served, note"
    );
    expect(rows[0].kind).toBe('unclassified');
    expect(rows[0].parent_id).toBeNull();
    expect(rows[0].sgp_pop).toBeNull();
    expect(rows[0].sgp_pop_key).toBeNull();
    expect(rows[0].active).toBe(true);
    expect(rows[0].served).toBe(false);
    expect(rows[0].note).toBe('');
  });

  test('locality exige parent_id', async () => {
    await expect(
      getPool().query("INSERT INTO cities (name, kind) VALUES ('Sem pai', 'locality')")
    ).rejects.toThrow(/cities_hierarquia/);
  });

  test('city nao pode ter parent_id', async () => {
    const { rows } = await getPool().query("INSERT INTO cities (name, kind) VALUES ('Municipio', 'city') RETURNING id");
    await expect(
      getPool().query("INSERT INTO cities (name, kind, parent_id) VALUES ('Errado', 'city', $1)", [rows[0].id])
    ).rejects.toThrow(/cities_hierarquia/);
  });

  test('kind fora da lista e recusado', async () => {
    await expect(
      getPool().query("INSERT INTO cities (name, kind) VALUES ('Errado', 'village')")
    ).rejects.toThrow(/cities_kind_valido/);
  });

  test('duas linhas nao podem ter a mesma sgp_pop_key', async () => {
    const { rows } = await getPool().query("INSERT INTO cities (name, kind) VALUES ('Municipio', 'city') RETURNING id");
    await getPool().query(
      "INSERT INTO cities (name, kind, parent_id, sgp_pop, sgp_pop_key) VALUES ('A', 'locality', $1, 'Barão', 'barao')",
      [rows[0].id]
    );
    await expect(
      getPool().query(
        "INSERT INTO cities (name, kind, parent_id, sgp_pop, sgp_pop_key) VALUES ('B', 'locality', $1, 'BARAO', 'barao')",
        [rows[0].id]
      )
    ).rejects.toThrow(/cities_sgp_pop_key_unico/);
  });

  test('varias linhas podem ficar sem POP ao mesmo tempo', async () => {
    await getPool().query("INSERT INTO cities (name, kind) VALUES ('Um', 'city'), ('Dois', 'city')");
    const { rows } = await getPool().query('SELECT count(*)::int AS total FROM cities WHERE sgp_pop_key IS NULL');
    expect(rows[0].total).toBe(2);
  });

  test('sgp_pop e sgp_pop_key andam juntas', async () => {
    await expect(
      getPool().query("INSERT INTO cities (name, kind, sgp_pop) VALUES ('Sem chave', 'city', 'Barão')")
    ).rejects.toThrow(/cities_pop_par/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/cities/city-schema.migration.test.js`
Expected: FAIL — `column "kind" of relation "cities" does not exist`.

- [ ] **Step 3: Write the migration**

Arquivo `migrations/1789230000000_evolve-cities-to-places.js`:

```js
// `cities` passa a representar município E localidade na mesma lista.
//
// kind nasce 'unclassified', não 'city': a consulta de produção de 2026-09-22
// mostrou que três dos treze registros são povoados com contatos vinculados
// (Aurizona, Barão de Tromaí, Chega tudo). Marcá-los como 'city' gravaria uma
// afirmação falsa. 'unclassified' preserva o comportamento atual sem mentir, e
// faz a pendência aparecer na tela. A conversão é operação separada e
// autorizada — NUNCA uma migration, porque o Render roda `migrate up` sozinho
// a cada deploy.
//
// served nasce false: este cadastro nasceu para localizar contatos, não para
// declarar cobertura comercial. Assumir true deduziria cobertura da simples
// existência do registro. false nunca produz negativa — produz
// "precisa_verificar_viabilidade".
//
// sgp_pop ausente é NULL, nunca '': com default '' um índice único tornaria
// impossível existirem duas cidades sem POP.
//
// sgp_pop_key é derivada, escrita pelo repositório com a MESMA função de
// normalização do city-matcher. Não é índice sobre expressão porque unaccent()
// não é IMMUTABLE e translate() não reproduz o NFD do JavaScript — divergência
// entre a chave do banco e a chave do matcher é exatamente o defeito a evitar.
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE cities
      ADD COLUMN IF NOT EXISTS kind        TEXT    NOT NULL DEFAULT 'unclassified',
      ADD COLUMN IF NOT EXISTS parent_id   UUID    REFERENCES cities(id),
      ADD COLUMN IF NOT EXISTS sgp_pop     TEXT,
      ADD COLUMN IF NOT EXISTS sgp_pop_key TEXT,
      ADD COLUMN IF NOT EXISTS active      BOOLEAN NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS served      BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS note        TEXT    NOT NULL DEFAULT '';

    ALTER TABLE cities
      ADD CONSTRAINT cities_kind_valido CHECK (kind IN ('city', 'locality', 'unclassified')),
      ADD CONSTRAINT cities_hierarquia CHECK (
        (kind = 'locality' AND parent_id IS NOT NULL)
        OR (kind IN ('city', 'unclassified') AND parent_id IS NULL)
      ),
      ADD CONSTRAINT cities_pop_par CHECK (
        (sgp_pop IS NULL AND sgp_pop_key IS NULL)
        OR (sgp_pop IS NOT NULL AND sgp_pop_key IS NOT NULL)
      );

    CREATE UNIQUE INDEX IF NOT EXISTS cities_sgp_pop_key_unico
      ON cities (sgp_pop_key) WHERE sgp_pop_key IS NOT NULL;

    CREATE INDEX IF NOT EXISTS cities_parent_id_idx ON cities (parent_id);

    -- Alvo da chave estrangeira composta de contacts (migration seguinte).
    ALTER TABLE cities ADD CONSTRAINT cities_id_parent_unico UNIQUE (id, parent_id);

    -- Lacuna que já existia: o Postgres não cria índice do lado filho de uma
    -- FK, então DELETE de cidade fazia varredura sequencial em contacts.
    CREATE INDEX IF NOT EXISTS contacts_city_id_idx ON contacts (city_id);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS contacts_city_id_idx;
    ALTER TABLE cities DROP CONSTRAINT IF EXISTS cities_id_parent_unico;
    DROP INDEX IF EXISTS cities_parent_id_idx;
    DROP INDEX IF EXISTS cities_sgp_pop_key_unico;
    ALTER TABLE cities
      DROP CONSTRAINT IF EXISTS cities_pop_par,
      DROP CONSTRAINT IF EXISTS cities_hierarquia,
      DROP CONSTRAINT IF EXISTS cities_kind_valido;
    ALTER TABLE cities
      DROP COLUMN IF EXISTS note,
      DROP COLUMN IF EXISTS served,
      DROP COLUMN IF EXISTS active,
      DROP COLUMN IF EXISTS sgp_pop_key,
      DROP COLUMN IF EXISTS sgp_pop,
      DROP COLUMN IF EXISTS parent_id,
      DROP COLUMN IF EXISTS kind;
  `);
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/cities/city-schema.migration.test.js`
Expected: PASS, 7 testes.

- [ ] **Step 5: Verificar que o `down` funciona**

Run: `npx dotenv -e .env.test -o -- node-pg-migrate down 1 && npx dotenv -e .env.test -o -- node-pg-migrate up`
Expected: as duas rodam sem erro.

> **Nunca rodar `down` com o código no ar.** Este passo é só no banco de teste.

- [ ] **Step 6: Provar que os testes de cidade que já existiam continuam passando**

Run: `npm test -- src/cities/ src/api/cities.routes.test.js src/api/admin-cities.routes.test.js src/city-notices/`
Expected: PASS. É a prova de que a migration é aditiva de verdade.

- [ ] **Step 7: Commit**

```bash
git add migrations/1789230000000_evolve-cities-to-places.js src/cities/city-schema.migration.test.js
git commit -m "Cities passa a representar municipio e localidade na mesma tabela

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Migration de `contacts.locality_id` com a invariante no banco

**Files:**
- Create: `migrations/1789240000000_add-contact-locality.js`
- Test: `src/conversations/contact-locality.migration.test.js`

**Interfaces:**
- Consumes: `cities_id_parent_unico` da Task 1.
- Produces: `contacts.locality_id`; FK composta `(locality_id, city_id) → cities(id, parent_id)` com `ON DELETE SET NULL (locality_id)`.

- [ ] **Step 1: Write the failing test**

Arquivo `src/conversations/contact-locality.migration.test.js`:

```js
const { getPool, closePool } = require('../db/pool');
const { findOrCreateContactByPhoneNumber } = require('./contact.repository');

async function criarMunicipioELocalidade() {
  const municipio = await getPool().query(
    "INSERT INTO cities (name, kind) VALUES ('Cidade Pai', 'city') RETURNING id"
  );
  const localidade = await getPool().query(
    "INSERT INTO cities (name, kind, parent_id) VALUES ('Povoado', 'locality', $1) RETURNING id",
    [municipio.rows[0].id]
  );
  return { municipioId: municipio.rows[0].id, localidadeId: localidade.rows[0].id };
}

describe('invariante municipio x localidade no contato', () => {
  beforeEach(async () => {
    await getPool().query('TRUNCATE cities, contacts CASCADE');
  });

  afterAll(async () => {
    await closePool();
  });

  test('aceita a localidade cujo pai e o municipio do contato', async () => {
    const { municipioId, localidadeId } = await criarMunicipioELocalidade();
    const contato = await findOrCreateContactByPhoneNumber('+5511900000001', 'Ana');

    await getPool().query('UPDATE contacts SET city_id = $2, locality_id = $3 WHERE id = $1', [
      contato.id, municipioId, localidadeId,
    ]);

    const { rows } = await getPool().query('SELECT locality_id FROM contacts WHERE id = $1', [contato.id]);
    expect(rows[0].locality_id).toBe(localidadeId);
  });

  test('recusa localidade de outro municipio', async () => {
    const { localidadeId } = await criarMunicipioELocalidade();
    const outro = await getPool().query("INSERT INTO cities (name, kind) VALUES ('Outro', 'city') RETURNING id");
    const contato = await findOrCreateContactByPhoneNumber('+5511900000002', 'Bia');

    await expect(
      getPool().query('UPDATE contacts SET city_id = $2, locality_id = $3 WHERE id = $1', [
        contato.id, outro.rows[0].id, localidadeId,
      ])
    ).rejects.toThrow();
  });

  test('recusa localidade sem municipio', async () => {
    const { localidadeId } = await criarMunicipioELocalidade();
    const contato = await findOrCreateContactByPhoneNumber('+5511900000003', 'Cid');

    await expect(
      getPool().query('UPDATE contacts SET locality_id = $2 WHERE id = $1', [contato.id, localidadeId])
    ).rejects.toThrow(/contacts_localidade_exige_municipio/);
  });

  test('apagar a localidade limpa so locality_id, preservando o municipio', async () => {
    const { municipioId, localidadeId } = await criarMunicipioELocalidade();
    const contato = await findOrCreateContactByPhoneNumber('+5511900000004', 'Dora');
    await getPool().query('UPDATE contacts SET city_id = $2, locality_id = $3 WHERE id = $1', [
      contato.id, municipioId, localidadeId,
    ]);

    await getPool().query('DELETE FROM cities WHERE id = $1', [localidadeId]);

    const { rows } = await getPool().query('SELECT city_id, locality_id FROM contacts WHERE id = $1', [contato.id]);
    expect(rows[0].locality_id).toBeNull();
    expect(rows[0].city_id).toBe(municipioId);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/conversations/contact-locality.migration.test.js`
Expected: FAIL — `column "locality_id" of relation "contacts" does not exist`.

- [ ] **Step 3: Write the migration**

Arquivo `migrations/1789240000000_add-contact-locality.js`:

```js
// O contato guarda os DOIS: city_id continua sendo o município, com o mesmo
// significado de antes, e locality_id é o povoado, opcional. Povoado nunca
// ocupa o lugar de município.
//
// A invariante "a localidade pertence ao município do contato" fica no banco,
// por chave estrangeira composta — não na aplicação. Combinação inválida a
// recusar: município Carutapera + localidade cujo pai é Cândido Mendes.
//
// ON DELETE SET NULL (locality_id) com lista de colunas é PostgreSQL 15+;
// produção roda 16.15 (verificado em 2026-09-22). Sem a lista, o SET NULL
// anularia TODAS as colunas da FK, e apagar um povoado zeraria também o
// município do contato.
//
// O CHECK é indispensável: MATCH SIMPLE considera a FK satisfeita quando
// QUALQUER coluna é nula, então sem ele um contato poderia ter localidade sem
// município.
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE contacts ADD COLUMN IF NOT EXISTS locality_id UUID;

    ALTER TABLE contacts
      ADD CONSTRAINT contacts_localidade_do_municipio
        FOREIGN KEY (locality_id, city_id) REFERENCES cities (id, parent_id)
        ON DELETE SET NULL (locality_id),
      ADD CONSTRAINT contacts_localidade_exige_municipio
        CHECK (locality_id IS NULL OR city_id IS NOT NULL);

    CREATE INDEX IF NOT EXISTS contacts_locality_id_idx ON contacts (locality_id);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS contacts_locality_id_idx;
    ALTER TABLE contacts
      DROP CONSTRAINT IF EXISTS contacts_localidade_exige_municipio,
      DROP CONSTRAINT IF EXISTS contacts_localidade_do_municipio;
    ALTER TABLE contacts DROP COLUMN IF EXISTS locality_id;
  `);
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/conversations/contact-locality.migration.test.js`
Expected: PASS, 4 testes.

- [ ] **Step 5: Provar que contatos e conversas continuam funcionando**

Run: `npm test -- src/conversations/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add migrations/1789240000000_add-contact-locality.js src/conversations/contact-locality.migration.test.js
git commit -m "Contato guarda municipio e localidade, com a invariante no banco

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Leitura em `city.repository`, com o legado preservado

**Files:**
- Modify: `src/cities/city.repository.js`
- Test: `src/cities/city.repository.test.js`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `listCities() → Promise<Place[]>` — só `kind IN ('city','unclassified')`, `ORDER BY name ASC`
  - `listPlaces() → Promise<Place[]>` — tudo, municípios antes das filhas
  - `findCityById(id) → Promise<Place|null>` — qualquer `kind`
  - `Place = { id, name, kind, parentId, sgpPop, active, served, note, createdAt }`
  - **`sgpPopKey` nunca sai no DTO.**

- [ ] **Step 1: Write the failing test**

Acrescentar a `src/cities/city.repository.test.js`:

```js
const { listPlaces } = require('./city.repository');

describe('city repository — lugares', () => {
  beforeEach(async () => {
    await getPool().query('TRUNCATE cities, contacts CASCADE');
  });

  test('listCities nao devolve localidades, mas devolve as legadas', async () => {
    const pai = await getPool().query("INSERT INTO cities (name, kind) VALUES ('Municipio', 'city') RETURNING id");
    await getPool().query("INSERT INTO cities (name, kind, parent_id) VALUES ('Povoado', 'locality', $1)", [pai.rows[0].id]);
    await getPool().query("INSERT INTO cities (name) VALUES ('Legado')");

    const cidades = await listCities();

    expect(cidades.map((c) => c.name)).toEqual(['Legado', 'Municipio']);
  });

  test('listPlaces devolve tudo, com a localidade depois do pai', async () => {
    const pai = await getPool().query("INSERT INTO cities (name, kind) VALUES ('Municipio', 'city') RETURNING id");
    await getPool().query("INSERT INTO cities (name, kind, parent_id) VALUES ('Povoado', 'locality', $1)", [pai.rows[0].id]);

    const lugares = await listPlaces();

    expect(lugares.map((l) => l.name)).toEqual(['Municipio', 'Povoado']);
    expect(lugares[1].parentId).toBe(pai.rows[0].id);
    expect(lugares[1].kind).toBe('locality');
  });

  test('o DTO nao expoe sgp_pop_key', async () => {
    await getPool().query("INSERT INTO cities (name, kind, sgp_pop, sgp_pop_key) VALUES ('Com pop', 'city', 'Barão', 'barao')");

    const [lugar] = await listCities();

    expect(lugar.sgpPop).toBe('Barão');
    expect(lugar).not.toHaveProperty('sgpPopKey');
    expect(lugar).not.toHaveProperty('sgp_pop_key');
  });

  test('findCityById encontra tambem uma localidade', async () => {
    const pai = await getPool().query("INSERT INTO cities (name, kind) VALUES ('Municipio', 'city') RETURNING id");
    const filha = await getPool().query(
      "INSERT INTO cities (name, kind, parent_id) VALUES ('Povoado', 'locality', $1) RETURNING id",
      [pai.rows[0].id]
    );

    const achada = await findCityById(filha.rows[0].id);

    expect(achada.kind).toBe('locality');
    expect(achada.parentId).toBe(pai.rows[0].id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/cities/city.repository.test.js`
Expected: FAIL — `listPlaces is not a function`.

- [ ] **Step 3: Write the implementation**

Substituir o topo de `src/cities/city.repository.js`:

```js
const { getPool } = require('../db/pool');

// Colunas enumeradas de propósito: o projeto não usa SELECT *, então coluna
// nova não chega sozinha à aplicação.
// sgp_pop_key fica FORA do DTO: é chave interna de casamento, não dado da tela.
const COLUNAS = 'id, name, kind, parent_id, sgp_pop, active, served, note, created_at';

// O conjunto que os consumidores antigos sempre enxergaram. 'unclassified'
// entra aqui de propósito: os povoados legados de produção precisam continuar
// aparecendo onde aparecem hoje, inclusive no seletor de cidade do contato.
// Depois da conversão eles saem daqui sozinhos, virando 'locality'.
const KINDS_LEGADO = ['city', 'unclassified'];

function toCity(row) {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    parentId: row.parent_id,
    sgpPop: row.sgp_pop,
    active: row.active,
    served: row.served,
    note: row.note,
    createdAt: row.created_at,
  };
}

async function listCities() {
  const result = await getPool().query(
    `SELECT ${COLUNAS} FROM cities WHERE kind = ANY($1) ORDER BY name ASC`,
    [KINDS_LEGADO]
  );
  return result.rows.map(toCity);
}

// Hierarquia completa: o município vem antes das localidades dele.
async function listPlaces() {
  const result = await getPool().query(`
    SELECT ${COLUNAS} FROM cities
    ORDER BY COALESCE((SELECT p.name FROM cities p WHERE p.id = cities.parent_id), cities.name) ASC,
             CASE WHEN parent_id IS NULL THEN 0 ELSE 1 END,
             name ASC
  `);
  return result.rows.map(toCity);
}

async function findCityById(id) {
  const result = await getPool().query(`SELECT ${COLUNAS} FROM cities WHERE id = $1`, [id]);
  if (result.rowCount === 0) return null;
  return toCity(result.rows[0]);
}
```

Atualizar o `module.exports` no fim do arquivo para incluir `listPlaces`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/cities/city.repository.test.js`
Expected: PASS, incluindo os 7 testes que já existiam.

- [ ] **Step 5: Commit**

```bash
git add src/cities/city.repository.js src/cities/city.repository.test.js
git commit -m "Repositorio de cidades le os campos de lugar, preservando o conjunto legado

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Escrita em `city.repository`, com `sgp_pop_key` derivada

**Files:**
- Modify: `src/cities/city.repository.js`
- Test: `src/cities/city.repository.test.js`

**Interfaces:**
- Consumes: Task 3, e `normalizar` de `src/cities/city-matcher.js`.
- Produces:
  - `createPlace({ name, kind, parentId, sgpPop, active, served, note }) → Promise<Place>`
  - `updatePlace(id, patch) → Promise<Place|null>` — parcial: chave ausente do objeto significa "não mexe"
  - `createCity({ name })` continua existindo, criando `kind='city'`

- [ ] **Step 1: Write the failing test**

Acrescentar a `src/cities/city.repository.test.js`:

```js
const { createPlace, updatePlace } = require('./city.repository');

describe('city repository — escrita de lugares', () => {
  beforeEach(async () => {
    await getPool().query('TRUNCATE cities, contacts CASCADE');
  });

  test('createPlace deriva sgp_pop_key com a normalizacao do matcher', async () => {
    const lugar = await createPlace({ name: 'Municipio', kind: 'city', sgpPop: '  BARÃO  Centro ' });

    expect(lugar.sgpPop).toBe('BARÃO  Centro');
    const { rows } = await getPool().query('SELECT sgp_pop_key FROM cities WHERE id = $1', [lugar.id]);
    expect(rows[0].sgp_pop_key).toBe('barao centro');
  });

  test('sem POP, as duas colunas ficam nulas', async () => {
    const lugar = await createPlace({ name: 'Sem pop', kind: 'city', sgpPop: '   ' });

    expect(lugar.sgpPop).toBeNull();
    const { rows } = await getPool().query('SELECT sgp_pop_key FROM cities WHERE id = $1', [lugar.id]);
    expect(rows[0].sgp_pop_key).toBeNull();
  });

  test('createCity continua criando municipio', async () => {
    const cidade = await createCity({ name: 'Classica' });
    expect(cidade.kind).toBe('city');
    expect(cidade.parentId).toBeNull();
  });

  test('updatePlace nao mexe em chave ausente', async () => {
    const lugar = await createPlace({ name: 'Original', kind: 'city', note: 'anotacao', served: true });

    const atualizado = await updatePlace(lugar.id, { name: 'Renomeado' });

    expect(atualizado.name).toBe('Renomeado');
    expect(atualizado.note).toBe('anotacao');
    expect(atualizado.served).toBe(true);
  });

  test('updatePlace aceita valor falso de propósito', async () => {
    const lugar = await createPlace({ name: 'Ativo', kind: 'city', active: true, served: true });

    const atualizado = await updatePlace(lugar.id, { active: false, served: false, note: '' });

    expect(atualizado.active).toBe(false);
    expect(atualizado.served).toBe(false);
    expect(atualizado.note).toBe('');
  });

  test('updatePlace limpando o POP zera tambem a chave', async () => {
    const lugar = await createPlace({ name: 'Com pop', kind: 'city', sgpPop: 'Barão' });

    const atualizado = await updatePlace(lugar.id, { sgpPop: null });

    expect(atualizado.sgpPop).toBeNull();
    const { rows } = await getPool().query('SELECT sgp_pop_key FROM cities WHERE id = $1', [lugar.id]);
    expect(rows[0].sgp_pop_key).toBeNull();
  });

  test('updatePlace devolve null quando o id nao existe', async () => {
    expect(await updatePlace('00000000-0000-0000-0000-000000000000', { name: 'x' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/cities/city.repository.test.js`
Expected: FAIL — `createPlace is not a function`.

- [ ] **Step 3: Write the implementation**

Em `src/cities/city.repository.js`, importar o normalizador e substituir `createCity`:

```js
const { normalizar } = require('./city-matcher');

// A chave de POP usa exatamente a mesma normalização do matcher. É o que
// garante que gravar " BARÃO " e consultar "barao" encontrem a mesma linha.
// NUNCA aceitar sgp_pop_key vinda da rota: ela é derivada, com caminho de
// escrita único.
function chaveDoPop(sgpPop) {
  const bruto = typeof sgpPop === 'string' ? sgpPop.trim() : null;
  if (!bruto) return { valor: null, chave: null };
  const chave = normalizar(bruto);
  if (!chave) return { valor: null, chave: null };
  return { valor: bruto, chave };
}

async function createPlace({ name, kind = 'city', parentId = null, sgpPop = null, active = true, served = false, note = '' }) {
  const pop = chaveDoPop(sgpPop);
  const result = await getPool().query(
    `INSERT INTO cities (name, kind, parent_id, sgp_pop, sgp_pop_key, active, served, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${COLUNAS}`,
    [name, kind, parentId, pop.valor, pop.chave, active, served, note]
  );
  return toCity(result.rows[0]);
}

async function createCity({ name }) {
  return createPlace({ name, kind: 'city' });
}

// Escrita parcial no padrão do ADR-011: o que decide "não mexe" é a chave NÃO
// ESTAR no objeto, nunca o valor ser falso, zero ou vazio — esses são valores
// legítimos. `served: false` e `note: ''` precisam ser graváveis.
const CAMPOS = {
  name: 'name',
  kind: 'kind',
  parentId: 'parent_id',
  active: 'active',
  served: 'served',
  note: 'note',
};

async function updatePlace(id, patch = {}) {
  const partes = [];
  const valores = [id];

  for (const [chave, coluna] of Object.entries(CAMPOS)) {
    if (!(chave in patch)) continue;
    valores.push(patch[chave]);
    partes.push(`${coluna} = $${valores.length}`);
  }

  if ('sgpPop' in patch) {
    const pop = chaveDoPop(patch.sgpPop);
    valores.push(pop.valor);
    partes.push(`sgp_pop = $${valores.length}`);
    valores.push(pop.chave);
    partes.push(`sgp_pop_key = $${valores.length}`);
  }

  if (partes.length === 0) return findCityById(id);

  const result = await getPool().query(
    `UPDATE cities SET ${partes.join(', ')} WHERE id = $1 RETURNING ${COLUNAS}`,
    valores
  );
  if (result.rowCount === 0) return null;
  return toCity(result.rows[0]);
}
```

Atualizar `module.exports` para incluir `createPlace` e `updatePlace`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/cities/city.repository.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cities/city.repository.js src/cities/city.repository.test.js
git commit -m "Criacao e edicao de lugar, com a chave de POP derivada no repositorio

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Dependências que bloqueiam edição estrutural

**Files:**
- Create: `src/cities/place-dependencies.js`
- Test: `src/cities/place-dependencies.test.js`

**Interfaces:**
- Consumes: Tasks 1 e 2.
- Produces: `dependenciasDoLugar(id) → Promise<{ contatosComoMunicipio, contatosComoLocalidade, filhas, avisos }>` — todos `number`.

- [ ] **Step 1: Write the failing test**

Arquivo `src/cities/place-dependencies.test.js`:

```js
const { getPool, closePool } = require('../db/pool');
const { findOrCreateContactByPhoneNumber } = require('../conversations/contact.repository');
const { createPlace } = require('./city.repository');
const { dependenciasDoLugar } = require('./place-dependencies');

describe('dependencias de um lugar', () => {
  beforeEach(async () => {
    await getPool().query('TRUNCATE cities, contacts CASCADE');
  });

  afterAll(async () => {
    await closePool();
  });

  test('lugar sem nada devolve tudo zerado', async () => {
    const lugar = await createPlace({ name: 'Solto', kind: 'city' });

    expect(await dependenciasDoLugar(lugar.id)).toEqual({
      contatosComoMunicipio: 0, contatosComoLocalidade: 0, filhas: 0, avisos: 0,
    });
  });

  test('conta contatos como municipio, como localidade, filhas e avisos', async () => {
    const municipio = await createPlace({ name: 'Municipio', kind: 'city' });
    const povoado = await createPlace({ name: 'Povoado', kind: 'locality', parentId: municipio.id });

    const um = await findOrCreateContactByPhoneNumber('+5511900000011', 'Um');
    const dois = await findOrCreateContactByPhoneNumber('+5511900000012', 'Dois');
    await getPool().query('UPDATE contacts SET city_id = $2 WHERE id = $1', [um.id, municipio.id]);
    await getPool().query('UPDATE contacts SET city_id = $2, locality_id = $3 WHERE id = $1', [
      dois.id, municipio.id, povoado.id,
    ]);
    await getPool().query("INSERT INTO city_notices (city_id, message, enabled) VALUES ($1, 'aviso', true)", [povoado.id]);

    expect(await dependenciasDoLugar(municipio.id)).toEqual({
      contatosComoMunicipio: 2, contatosComoLocalidade: 0, filhas: 1, avisos: 0,
    });
    expect(await dependenciasDoLugar(povoado.id)).toEqual({
      contatosComoMunicipio: 0, contatosComoLocalidade: 1, filhas: 0, avisos: 1,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/cities/place-dependencies.test.js`
Expected: FAIL — `Cannot find module './place-dependencies'`.

- [ ] **Step 3: Write the implementation**

Arquivo `src/cities/place-dependencies.js`:

```js
// O que está "no caminho" de uma edição estrutural ou de uma exclusão.
//
// Módulo próprio porque duas rotas consultam o mesmo conjunto e porque a
// mensagem do 409 precisa NOMEAR o que impede — quem administra tem de saber o
// que tratar antes de tentar de novo, e não receber "conflito" seco.
const { getPool } = require('../db/pool');

async function dependenciasDoLugar(id) {
  const { rows } = await getPool().query(
    `SELECT
       (SELECT count(*) FROM contacts     WHERE city_id     = $1)::int AS contatos_municipio,
       (SELECT count(*) FROM contacts     WHERE locality_id = $1)::int AS contatos_localidade,
       (SELECT count(*) FROM cities       WHERE parent_id   = $1)::int AS filhas,
       (SELECT count(*) FROM city_notices WHERE city_id     = $1)::int AS avisos`,
    [id]
  );
  return {
    contatosComoMunicipio: rows[0].contatos_municipio,
    contatosComoLocalidade: rows[0].contatos_localidade,
    filhas: rows[0].filhas,
    avisos: rows[0].avisos,
  };
}

module.exports = { dependenciasDoLugar };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/cities/place-dependencies.test.js`
Expected: PASS, 2 testes.

- [ ] **Step 5: Commit**

```bash
git add src/cities/place-dependencies.js src/cities/place-dependencies.test.js
git commit -m "Conta o que impede uma edicao estrutural de lugar

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Rotas de administração, com os 409

**Files:**
- Modify: `src/api/admin-cities.routes.js`
- Modify: `src/api/cities.routes.js`
- Test: `src/api/admin-cities.routes.test.js`, `src/api/cities.routes.test.js`

**Interfaces:**
- Consumes: Tasks 3, 4 e 5.
- Produces:
  - `POST /api/admin/cities` — aceita `{ name, kind, parentId, sgpPop, active, served, note }`
  - `PATCH /api/admin/cities/:id` — parcial
  - `DELETE /api/admin/cities/:id` — 409 se houver filhas
  - `GET /api/cities?includeLocalities=true`

- [ ] **Step 1: Write the failing test**

Acrescentar a `src/api/admin-cities.routes.test.js` (seguir o helper de autenticação já usado no arquivo):

```js
test('POST recusa kind unclassified', async () => {
  const res = await request(app).post('/api/admin/cities')
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .send({ name: 'Nao pode', kind: 'unclassified' });

  expect(res.status).toBe(400);
  expect(res.body.error).toBe('kind is invalid');
});

test('POST recusa locality sem parentId', async () => {
  const res = await request(app).post('/api/admin/cities')
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .send({ name: 'Sem pai', kind: 'locality' });

  expect(res.status).toBe(400);
  expect(res.body.error).toBe('parentId is required for locality');
});

test('POST recusa localidade filha de outra localidade', async () => {
  const pai = await createPlace({ name: 'Municipio', kind: 'city' });
  const filha = await createPlace({ name: 'Povoado', kind: 'locality', parentId: pai.id });

  const res = await request(app).post('/api/admin/cities')
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .send({ name: 'Neta', kind: 'locality', parentId: filha.id });

  expect(res.status).toBe(400);
  expect(res.body.error).toBe('parentId must be a city');
});

test('POST recusa POP ja usado por outro lugar', async () => {
  await createPlace({ name: 'Primeiro', kind: 'city', sgpPop: 'Barão' });

  const res = await request(app).post('/api/admin/cities')
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .send({ name: 'Segundo', kind: 'city', sgpPop: ' BARAO ' });

  expect(res.status).toBe(409);
  expect(res.body.error).toBe('sgpPop already in use');
});

test('PATCH renomeia sem tocar no resto', async () => {
  const lugar = await createPlace({ name: 'Antigo', kind: 'city', note: 'fica' });

  const res = await request(app).patch(`/api/admin/cities/${lugar.id}`)
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .send({ name: 'Novo' });

  expect(res.status).toBe(200);
  expect(res.body.name).toBe('Novo');
  expect(res.body.note).toBe('fica');
});

test('PATCH de parentId com contatos vinculados devolve 409 nomeando o que impede', async () => {
  const pai = await createPlace({ name: 'Cidade A', kind: 'city' });
  const outro = await createPlace({ name: 'Cidade B', kind: 'city' });
  const povoado = await createPlace({ name: 'Povoado', kind: 'locality', parentId: pai.id });
  const contato = await findOrCreateContactByPhoneNumber('+5511900000021', 'Ana');
  await getPool().query('UPDATE contacts SET city_id = $2, locality_id = $3 WHERE id = $1', [
    contato.id, pai.id, povoado.id,
  ]);

  const res = await request(app).patch(`/api/admin/cities/${povoado.id}`)
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .send({ parentId: outro.id });

  expect(res.status).toBe(409);
  expect(res.body.error).toBe('structural change blocked');
  expect(res.body.dependencies.contatosComoLocalidade).toBe(1);
});

test('PATCH de kind city para locality com contatos como municipio devolve 409', async () => {
  const cidade = await createPlace({ name: 'Cidade', kind: 'city' });
  const outra = await createPlace({ name: 'Outra', kind: 'city' });
  const contato = await findOrCreateContactByPhoneNumber('+5511900000022', 'Bia');
  await getPool().query('UPDATE contacts SET city_id = $2 WHERE id = $1', [contato.id, cidade.id]);

  const res = await request(app).patch(`/api/admin/cities/${cidade.id}`)
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .send({ kind: 'locality', parentId: outra.id });

  expect(res.status).toBe(409);
  expect(res.body.dependencies.contatosComoMunicipio).toBe(1);
});

test('PATCH estrutural passa quando nada depende do registro', async () => {
  const pai = await createPlace({ name: 'Municipio', kind: 'city' });
  const solto = await createPlace({ name: 'Solto', kind: 'city' });

  const res = await request(app).patch(`/api/admin/cities/${solto.id}`)
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .send({ kind: 'locality', parentId: pai.id });

  expect(res.status).toBe(200);
  expect(res.body.kind).toBe('locality');
  expect(res.body.parentId).toBe(pai.id);
});

test('DELETE de municipio com filha devolve 409', async () => {
  const pai = await createPlace({ name: 'Municipio', kind: 'city' });
  await createPlace({ name: 'Povoado', kind: 'locality', parentId: pai.id });

  const res = await request(app).delete(`/api/admin/cities/${pai.id}`)
    .set('Authorization', `Bearer ${tokenAdmin}`);

  expect(res.status).toBe(409);
  expect(res.body.dependencies.filhas).toBe(1);
});
```

Acrescentar a `src/api/cities.routes.test.js`:

```js
test('GET /api/cities nao devolve localidades por padrao', async () => {
  const pai = await createPlace({ name: 'Municipio', kind: 'city' });
  await createPlace({ name: 'Povoado', kind: 'locality', parentId: pai.id });

  const res = await request(app).get('/api/cities').set('Authorization', `Bearer ${token}`);

  expect(res.status).toBe(200);
  expect(res.body.map((c) => c.name)).toEqual(['Municipio']);
});

test('GET /api/cities?includeLocalities=true devolve a hierarquia', async () => {
  const pai = await createPlace({ name: 'Municipio', kind: 'city' });
  await createPlace({ name: 'Povoado', kind: 'locality', parentId: pai.id });

  const res = await request(app).get('/api/cities?includeLocalities=true').set('Authorization', `Bearer ${token}`);

  expect(res.body.map((c) => c.name)).toEqual(['Municipio', 'Povoado']);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/api/admin-cities.routes.test.js src/api/cities.routes.test.js`
Expected: FAIL — `PATCH` devolve 404 e o `includeLocalities` é ignorado.

- [ ] **Step 3: Write the implementation**

Substituir `src/api/admin-cities.routes.js`:

```js
const express = require('express');
const { requireAuth, requireRole } = require('../auth/auth.middleware');
const { createPlace, updatePlace, deleteCity, findCityById } = require('../cities/city.repository');
const { dependenciasDoLugar } = require('../cities/place-dependencies');

const router = express.Router();

// 'unclassified' é valor de MIGRAÇÃO, não opção de cadastro: representa um
// registro legado ainda não classificado. Só a conversão autorizada o remove.
const KINDS_ACEITOS = ['city', 'locality'];

function limpar(valor) {
  return typeof valor === 'string' ? valor.trim() : '';
}

async function validarEstrutura({ kind, parentId }) {
  if (!KINDS_ACEITOS.includes(kind)) return 'kind is invalid';
  if (kind === 'city') return parentId ? 'city cannot have parentId' : null;
  if (!parentId) return 'parentId is required for locality';
  const pai = await findCityById(parentId);
  if (!pai) return 'parentId not found';
  // Hierarquia de dois níveis: nenhum CHECK alcança outra linha, então é aqui.
  if (pai.kind === 'locality') return 'parentId must be a city';
  return null;
}

function popEmUso(err) {
  return err && err.code === '23505' && String(err.constraint) === 'cities_sgp_pop_key_unico';
}

router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  const { kind = 'city', parentId = null, sgpPop = null, active = true, served = false, note = '' } = req.body || {};
  const name = limpar((req.body || {}).name);
  if (!name) return res.status(400).json({ error: 'name is required' });

  const erro = await validarEstrutura({ kind, parentId });
  if (erro) return res.status(400).json({ error: erro });

  try {
    const lugar = await createPlace({ name, kind, parentId, sgpPop, active, served, note });
    return res.status(201).json(lugar);
  } catch (err) {
    if (popEmUso(err)) return res.status(409).json({ error: 'sgpPop already in use' });
    throw err;
  }
});

router.patch('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const atual = await findCityById(req.params.id);
  if (!atual) return res.status(404).json({ error: 'City not found' });

  const corpo = req.body || {};
  const patch = {};
  if ('name' in corpo) {
    const name = limpar(corpo.name);
    if (!name) return res.status(400).json({ error: 'name is required' });
    patch.name = name;
  }
  for (const campo of ['active', 'served']) {
    if (campo in corpo) {
      if (typeof corpo[campo] !== 'boolean') return res.status(400).json({ error: `${campo} must be a boolean` });
      patch[campo] = corpo[campo];
    }
  }
  if ('note' in corpo) patch.note = limpar(corpo.note);
  if ('sgpPop' in corpo) patch.sgpPop = corpo.sgpPop;

  // kind e parent_id mudam o SIGNIFICADO do registro na hierarquia e podem
  // invalidar vínculos existentes. Não corrigir registros em massa em silêncio,
  // não mover clientes automaticamente: 409 e tratamento explícito.
  const mudaEstrutura = 'kind' in corpo || 'parentId' in corpo;
  if (mudaEstrutura) {
    const kind = 'kind' in corpo ? corpo.kind : atual.kind;
    const parentId = 'parentId' in corpo ? corpo.parentId : atual.parentId;
    const erro = await validarEstrutura({ kind, parentId });
    if (erro) return res.status(400).json({ error: erro });

    const dependencies = await dependenciasDoLugar(atual.id);
    const impede =
      dependencies.filhas > 0
      || dependencies.contatosComoLocalidade > 0
      || (kind === 'locality' && dependencies.contatosComoMunicipio > 0);
    if (impede) {
      return res.status(409).json({ error: 'structural change blocked', dependencies });
    }
    patch.kind = kind;
    patch.parentId = parentId;
  }

  try {
    const lugar = await updatePlace(atual.id, patch);
    return res.json(lugar);
  } catch (err) {
    if (popEmUso(err)) return res.status(409).json({ error: 'sgpPop already in use' });
    throw err;
  }
});

router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const dependencies = await dependenciasDoLugar(req.params.id);
  if (dependencies.filhas > 0) {
    return res.status(409).json({ error: 'place has localities', dependencies });
  }
  const deleted = await deleteCity(req.params.id);
  if (!deleted) return res.status(404).json({ error: 'City not found' });
  res.status(204).send();
});

module.exports = router;
```

Substituir `src/api/cities.routes.js`:

```js
const express = require('express');
const { requireAuth } = require('../auth/auth.middleware');
const { listCities, listPlaces } = require('../cities/city.repository');

const router = express.Router();

// Compatibilidade segura por padrão: sem a flag, devolve exatamente o conjunto
// que os consumidores antigos sempre enxergaram (município e legado). Quem
// precisa de localidade pede explicitamente.
router.get('/', requireAuth, async (req, res) => {
  const completo = req.query.includeLocalities === 'true';
  const lugares = completo ? await listPlaces() : await listCities();
  res.json(lugares);
});

module.exports = router;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/api/admin-cities.routes.test.js src/api/cities.routes.test.js`
Expected: PASS, incluindo os testes que já existiam.

- [ ] **Step 5: Provar que os avisos por cidade não quebraram**

Run: `npm test -- src/api/admin-city-notices.routes.test.js src/city-notices/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/api/admin-cities.routes.js src/api/cities.routes.js src/api/admin-cities.routes.test.js src/api/cities.routes.test.js
git commit -m "Rotas de lugar: criar, editar e excluir, com 409 nas mudancas estruturais

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: `contact.repository` passa a ler e gravar `locality_id`

**Files:**
- Modify: `src/conversations/contact.repository.js`
- Test: `src/conversations/contact.repository.test.js`

**Interfaces:**
- Consumes: Task 2.
- Produces:
  - `toContact()` devolve `localityId`
  - `updateContact(id, patch)` aceita `localityId` com a mesma sentinela de `cityId`
  - `setContactLocalityIfEmpty(contactId, localityId) → Promise<boolean>`

- [ ] **Step 1: Write the failing test**

Acrescentar a `src/conversations/contact.repository.test.js`:

```js
const { setContactLocalityIfEmpty } = require('./contact.repository');

describe('contato com localidade', () => {
  async function municipioComPovoado() {
    const m = await getPool().query("INSERT INTO cities (name, kind) VALUES ('Municipio', 'city') RETURNING id");
    const p = await getPool().query(
      "INSERT INTO cities (name, kind, parent_id) VALUES ('Povoado', 'locality', $1) RETURNING id",
      [m.rows[0].id]
    );
    return { municipioId: m.rows[0].id, povoadoId: p.rows[0].id };
  }

  test('todas as leituras devolvem localityId', async () => {
    const { municipioId, povoadoId } = await municipioComPovoado();
    const contato = await findOrCreateContactByPhoneNumber('+5511900000031', 'Ana');
    await updateContact(contato.id, { cityId: municipioId, localityId: povoadoId });

    expect((await findContactById(contato.id)).localityId).toBe(povoadoId);
    expect((await findContactByPhoneNumber('+5511900000031')).localityId).toBe(povoadoId);
    expect((await findOrCreateContactByPhoneNumber('+5511900000031', 'Ana')).localityId).toBe(povoadoId);
  });

  test('patch sem localityId nao apaga a localidade', async () => {
    const { municipioId, povoadoId } = await municipioComPovoado();
    const contato = await findOrCreateContactByPhoneNumber('+5511900000032', 'Bia');
    await updateContact(contato.id, { cityId: municipioId, localityId: povoadoId });

    const atualizado = await updateContact(contato.id, { name: 'Beatriz' });

    expect(atualizado.localityId).toBe(povoadoId);
  });

  test('localityId null apaga de propósito', async () => {
    const { municipioId, povoadoId } = await municipioComPovoado();
    const contato = await findOrCreateContactByPhoneNumber('+5511900000033', 'Cid');
    await updateContact(contato.id, { cityId: municipioId, localityId: povoadoId });

    const atualizado = await updateContact(contato.id, { localityId: null });

    expect(atualizado.localityId).toBeNull();
    expect(atualizado.cityId).toBe(municipioId);
  });

  test('setContactLocalityIfEmpty nao sobrescreve escolha existente', async () => {
    const { municipioId, povoadoId } = await municipioComPovoado();
    const outro = await getPool().query(
      "INSERT INTO cities (name, kind, parent_id) VALUES ('Outro povoado', 'locality', $1) RETURNING id",
      [municipioId]
    );
    const contato = await findOrCreateContactByPhoneNumber('+5511900000034', 'Dora');
    await updateContact(contato.id, { cityId: municipioId, localityId: povoadoId });

    expect(await setContactLocalityIfEmpty(contato.id, outro.rows[0].id)).toBe(false);
    expect((await findContactById(contato.id)).localityId).toBe(povoadoId);
  });

  test('setContactLocalityIfEmpty grava quando esta vazio', async () => {
    const { municipioId, povoadoId } = await municipioComPovoado();
    const contato = await findOrCreateContactByPhoneNumber('+5511900000035', 'Edu');
    await updateContact(contato.id, { cityId: municipioId });

    expect(await setContactLocalityIfEmpty(contato.id, povoadoId)).toBe(true);
    expect((await findContactById(contato.id)).localityId).toBe(povoadoId);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/conversations/contact.repository.test.js`
Expected: FAIL — `localityId` vem `undefined`.

- [ ] **Step 3: Write the implementation**

Em `src/conversations/contact.repository.js`:

1. Em `toContact`, ao lado de `cityId: row.city_id`, acrescentar `localityId: row.locality_id`.
2. **Acrescentar `locality_id` à lista de colunas das SETE consultas** que já trazem `city_id`: o `SELECT` e o `RETURNING` de `findOrCreateContactByPhoneNumber`, o segundo `RETURNING` do upsert, `findContactById`, `findContactByPhoneNumber`, o `RETURNING` de `updateContact` e o `RETURNING` de `setContactSgpLink`.
3. Em `updateContact`, repetir a sentinela que `cityId` já usa:

```js
  const manterLocalidade = !('localityId' in patch);
  // ... na lista de parâmetros, depois dos de cidade:
  //   locality_id = CASE WHEN $N::boolean THEN locality_id ELSE $M::uuid END
```

4. Ao fim do arquivo, ao lado de `setContactCityIfEmpty`:

```js
// A condição vai no próprio UPDATE, e não numa leitura anterior: evita corrida
// e impede que o preenchimento automático sobrescreva escolha manual.
async function setContactLocalityIfEmpty(contactId, localityId) {
  const result = await getPool().query(
    'UPDATE contacts SET locality_id = $2 WHERE id = $1 AND locality_id IS NULL',
    [contactId, localityId]
  );
  return result.rowCount > 0;
}
```

5. Exportar `setContactLocalityIfEmpty`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/conversations/contact.repository.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/conversations/contact.repository.js src/conversations/contact.repository.test.js
git commit -m "Contato le e grava a localidade ao lado do municipio

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: A localidade chega aos resumos de conversa

**Files:**
- Modify: `src/conversations/conversation.repository.js`
- Test: `src/conversations/conversation.repository.test.js`

**Interfaces:**
- Consumes: Task 2.
- Produces: `contactLocalityId` e `contactLocalityName` em `toConversationSummary`.

> **Atenção — é aqui que o esquecimento acontece.** São **dez** funções com `LEFT JOIN cities`. Uma esquecida faz a localidade sumir numa tela só, e ninguém nota até produção.

- [ ] **Step 1: Write the failing test**

Acrescentar a `src/conversations/conversation.repository.test.js` um teste que percorra **todas** as dez funções:

```js
test('todas as consultas de conversa trazem a localidade do contato', async () => {
  const m = await getPool().query("INSERT INTO cities (name, kind) VALUES ('Municipio', 'city') RETURNING id");
  const p = await getPool().query(
    "INSERT INTO cities (name, kind, parent_id) VALUES ('Povoado', 'locality', $1) RETURNING id",
    [m.rows[0].id]
  );
  const contato = await findOrCreateContactByPhoneNumber('+5511900000041', 'Ana');
  await getPool().query('UPDATE contacts SET city_id = $2, locality_id = $3 WHERE id = $1', [
    contato.id, m.rows[0].id, p.rows[0].id,
  ]);
  const conversa = await criarConversaDeTeste(contato.id); // helper já existente no arquivo

  const conferir = (resumo, origem) => {
    expect(resumo.contactLocalityId).toBe(p.rows[0].id);
    expect(resumo.contactLocalityName).toBe('Povoado');
    expect(resumo.contactCityName).toBe('Municipio');
  };

  conferir(await getConversationWithContact(conversa.id), 'getConversationWithContact');
  conferir(await findConversationByProtocolNumber(conversa.protocolNumber), 'findConversationByProtocolNumber');
  conferir((await listConversationsByContact(contato.id))[0], 'listConversationsByContact');
  conferir((await listWaitingConversations())[0], 'listWaitingConversations');
});
```

Repetir o mesmo padrão para `listInProgressConversations`, `listWaitingForAgentConversations`, `listInAutomationConversations`, `listClosedSince`, `listConversationsByAgent` e `listClosedConversationsByAgent`, montando para cada uma o estado de conversa que ela exige (atribuída, encerrada, em automação), no mesmo estilo dos testes que já existem no arquivo.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/conversations/conversation.repository.test.js`
Expected: FAIL — `contactLocalityId` é `undefined`.

- [ ] **Step 3: Write the implementation**

1. Em `toConversationSummary`, ao lado de `contactCityName`:

```js
    contactLocalityId: row.contact_locality_id,
    contactLocalityName: row.contact_locality_name,
```

2. Nas **dez** funções, ao lado do par que já existe, acrescentar ao `SELECT`:

```sql
  ct.locality_id AS contact_locality_id,
  loc.name       AS contact_locality_name,
```

e ao `FROM`, logo depois do `LEFT JOIN cities ci`:

```sql
  LEFT JOIN cities loc ON loc.id = ct.locality_id
```

**Lista completa, para conferência:** `getConversationWithContact`, `findConversationByProtocolNumber`, `listConversationsByContact`, `listWaitingConversations`, `listInProgressConversations`, `listWaitingForAgentConversations`, `listInAutomationConversations`, `listClosedSince`, `listConversationsByAgent`, `listClosedConversationsByAgent`.

> `listClosedConversationsByContact` **não** traz cidade hoje e **não** deve passar a trazer: mudá-la está fora do escopo deste plano.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/conversations/conversation.repository.test.js`
Expected: PASS.

- [ ] **Step 5: Conferir que nenhuma função ficou para trás**

Run: `grep -c "contact_locality_name" src/conversations/conversation.repository.js`
Expected: `10`.

- [ ] **Step 6: Commit**

```bash
git add src/conversations/conversation.repository.js src/conversations/conversation.repository.test.js
git commit -m "Resumo de conversa traz a localidade do contato nas dez consultas

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: `PATCH /api/contacts/:id` com a invariante e a limpeza

**Files:**
- Modify: `src/api/contacts.routes.js`
- Test: `src/api/contacts.routes.test.js`

**Interfaces:**
- Consumes: Tasks 3 e 7.
- Produces: `PATCH /api/contacts/:id` aceita `localityId`; a resposta traz `localityId` e `localityName`.

- [ ] **Step 1: Write the failing test**

```js
test('aceita localidade cujo pai e o municipio enviado', async () => {
  const m = await createPlace({ name: 'Municipio', kind: 'city' });
  const p = await createPlace({ name: 'Povoado', kind: 'locality', parentId: m.id });
  const contato = await findOrCreateContactByPhoneNumber('+5511900000051', 'Ana');

  const res = await request(app).patch(`/api/contacts/${contato.id}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ cityId: m.id, localityId: p.id });

  expect(res.status).toBe(200);
  expect(res.body.localityId).toBe(p.id);
  expect(res.body.localityName).toBe('Povoado');
});

test('recusa localidade de outro municipio com 400', async () => {
  const a = await createPlace({ name: 'Cidade A', kind: 'city' });
  const b = await createPlace({ name: 'Cidade B', kind: 'city' });
  const p = await createPlace({ name: 'Povoado de A', kind: 'locality', parentId: a.id });
  const contato = await findOrCreateContactByPhoneNumber('+5511900000052', 'Bia');

  const res = await request(app).patch(`/api/contacts/${contato.id}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ cityId: b.id, localityId: p.id });

  expect(res.status).toBe(400);
  expect(res.body.error).toBe('locality does not belong to city');
});

test('trocar so o municipio limpa a localidade que deixou de pertencer a ele', async () => {
  const a = await createPlace({ name: 'Cidade A', kind: 'city' });
  const b = await createPlace({ name: 'Cidade B', kind: 'city' });
  const p = await createPlace({ name: 'Povoado de A', kind: 'locality', parentId: a.id });
  const contato = await findOrCreateContactByPhoneNumber('+5511900000053', 'Cid');
  await updateContact(contato.id, { cityId: a.id, localityId: p.id });

  const res = await request(app).patch(`/api/contacts/${contato.id}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ cityId: b.id });

  expect(res.status).toBe(200);
  expect(res.body.cityId).toBe(b.id);
  expect(res.body.localityId).toBeNull();
});

test('recusa um municipio no lugar da localidade', async () => {
  const a = await createPlace({ name: 'Cidade A', kind: 'city' });
  const b = await createPlace({ name: 'Cidade B', kind: 'city' });
  const contato = await findOrCreateContactByPhoneNumber('+5511900000054', 'Dora');

  const res = await request(app).patch(`/api/contacts/${contato.id}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ cityId: a.id, localityId: b.id });

  expect(res.status).toBe(400);
  expect(res.body.error).toBe('locality does not belong to city');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/api/contacts.routes.test.js`
Expected: FAIL — `localityId` é ignorado.

- [ ] **Step 3: Write the implementation**

Em `src/api/contacts.routes.js`, junto da validação de `cityId`:

```js
const { findCityById } = require('../cities/city.repository');

// ...dentro do handler do PATCH, depois de montar o patch de cityId:

const mudaCidade = 'cityId' in corpo;
const mudaLocalidade = 'localityId' in corpo;

if (mudaLocalidade && corpo.localityId) {
  if (!UUID.test(corpo.localityId)) return res.status(400).json({ error: 'localityId is invalid' });
  const municipioAlvo = mudaCidade ? corpo.cityId : atual.cityId;
  const localidade = await findCityById(corpo.localityId);
  // Município no lugar da localidade cai aqui: kind !== 'locality'.
  if (!localidade || localidade.kind !== 'locality' || localidade.parentId !== municipioAlvo) {
    return res.status(400).json({ error: 'locality does not belong to city' });
  }
  patch.localityId = corpo.localityId;
} else if (mudaLocalidade) {
  patch.localityId = null;
}

// Trocar o município sem dizer nada sobre a localidade: se a atual deixou de
// pertencer ao novo município, LIMPAR de forma explícita e previsível. Nunca
// manter combinação inválida, nunca "corrigir" o município para o pai da
// localidade — a FK composta recusaria o update, e o atendente veria um erro
// de banco em vez de um comportamento previsível.
if (mudaCidade && !mudaLocalidade && atual.localityId) {
  const localidadeAtual = await findCityById(atual.localityId);
  if (!localidadeAtual || localidadeAtual.parentId !== corpo.cityId) {
    patch.localityId = null;
  }
}
```

Na montagem da resposta, ao lado de `cityName`, resolver `localityName` com `findCityById(contato.localityId)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/api/contacts.routes.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/api/contacts.routes.js src/api/contacts.routes.test.js
git commit -m "PATCH de contato aceita localidade, com invariante e limpeza previsivel

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Cliente de API e hooks do frontend

**Files:**
- Modify: `frontend/src/services/api.js`
- Modify: `frontend/src/hooks/useCities.js`
- Test: `frontend/src/hooks/useCities.test.jsx`

**Interfaces:**
- Consumes: Task 6.
- Produces:
  - `listCities(token, { includeLocalities } = {})`
  - `updateCity(id, payload, token)`
  - `useCities()` — municípios, como hoje
  - `usePlaces()` — hierarquia completa

- [ ] **Step 1: Write the failing test**

Arquivo `frontend/src/hooks/useCities.test.jsx`:

```jsx
import { renderHook, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { useCities, usePlaces } from './useCities';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ token: 't' }) }));

test('useCities pede so os municipios', async () => {
  const spy = vi.spyOn(api, 'listCities').mockResolvedValue([{ id: '1', name: 'Municipio', kind: 'city' }]);
  const { result } = renderHook(() => useCities());
  await waitFor(() => expect(result.current.cities).toHaveLength(1));
  expect(spy).toHaveBeenCalledWith('t', undefined);
});

test('usePlaces pede a hierarquia completa', async () => {
  const spy = vi.spyOn(api, 'listCities').mockResolvedValue([]);
  renderHook(() => usePlaces());
  await waitFor(() => expect(spy).toHaveBeenCalledWith('t', { includeLocalities: true }));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/hooks/useCities.test.jsx`
Expected: FAIL — `usePlaces is not exported`.

- [ ] **Step 3: Write the implementation**

Em `frontend/src/services/api.js`:

```js
export function listCities(token, options) {
  const query = options && options.includeLocalities ? '?includeLocalities=true' : '';
  return apiFetch(`/api/cities${query}`, { token });
}

export function updateCity(id, payload, token) {
  return apiFetch(`/api/admin/cities/${id}`, { method: 'PATCH', body: payload, token });
}
```

Em `frontend/src/hooks/useCities.js`:

```js
import { useAuth } from '../contexts/AuthContext';
import { listCities } from '../services/api';
import { useAsyncResource } from './useAsyncResource';

function useListaDeLugares(options) {
  const { token } = useAuth();
  const { data, status, error, refresh } = useAsyncResource(
    () => listCities(token, options),
    [token, Boolean(options && options.includeLocalities)],
    { initial: [], enabled: Boolean(token) }
  );
  return { cities: data, status, error, loading: status === 'loading', refresh };
}

// Municípios, como sempre foi. Localidade não entra aqui.
export function useCities() {
  return useListaDeLugares(undefined);
}

// Hierarquia completa: a tela de cadastro e o seletor encadeado do contato.
export function usePlaces() {
  const { cities, ...resto } = useListaDeLugares({ includeLocalities: true });
  return { places: cities, ...resto };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/hooks/useCities.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/api.js frontend/src/hooks/useCities.js frontend/src/hooks/useCities.test.jsx
git commit -m "Frontend distingue lista de municipios de hierarquia completa

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: Tela de Cidades e localidades, com edição

**Files:**
- Create: `frontend/src/components/CityForm.jsx`
- Delete: `frontend/src/components/CreateCityForm.jsx` e `frontend/src/components/CreateCityForm.test.jsx`
- Modify: `frontend/src/components/CitiesAdminTab.jsx`
- Test: `frontend/src/components/CityForm.test.jsx`, `frontend/src/components/CitiesAdminTab.test.jsx`

**Interfaces:**
- Consumes: Task 10.
- Produces: `<CityForm place={null|Place} onSaved onCancel embedded />` — cria quando `place` é `null`, edita quando não é.

- [ ] **Step 1: Write the failing test**

Arquivo `frontend/src/components/CityForm.test.jsx`:

```jsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import CityForm from './CityForm';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ token: 't' }) }));

const MUNICIPIO = { id: 'm1', name: 'Candido Mendes', kind: 'city', parentId: null };

test('criar municipio nao mostra o campo de municipio pai', async () => {
  render(<CityForm place={null} places={[MUNICIPIO]} onSaved={vi.fn()} onCancel={vi.fn()} />);
  expect(screen.queryByLabelText('Município')).not.toBeInTheDocument();
});

test('escolher Povoado revela o municipio pai e envia parentId', async () => {
  const spy = vi.spyOn(api, 'createCity').mockResolvedValue({});
  const onSaved = vi.fn();
  render(<CityForm place={null} places={[MUNICIPIO]} onSaved={onSaved} onCancel={vi.fn()} />);

  await userEvent.type(screen.getByLabelText('Nome'), 'Barao de Tromai');
  await userEvent.selectOptions(screen.getByLabelText('Tipo'), 'locality');
  await userEvent.selectOptions(screen.getByLabelText('Município'), 'm1');
  await userEvent.type(screen.getByLabelText('POP do SGP'), 'Barao');
  await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));

  expect(spy).toHaveBeenCalledWith(
    { name: 'Barao de Tromai', kind: 'locality', parentId: 'm1', sgpPop: 'Barao', active: true, served: false, note: '' },
    't'
  );
});

test('editar um registro legado mostra Nao classificado e exige escolher um tipo', async () => {
  const legado = { id: 'l1', name: 'Aurizona', kind: 'unclassified', parentId: null, sgpPop: null, active: true, served: false, note: '' };
  render(<CityForm place={legado} places={[MUNICIPIO]} onSaved={vi.fn()} onCancel={vi.fn()} />);

  expect(screen.getByText('Não classificado')).toBeInTheDocument();
  expect(screen.getByLabelText('Tipo')).toHaveValue('');
});

test('o 409 de mudanca estrutural vira mensagem que nomeia o que impede', async () => {
  vi.spyOn(api, 'updateCity').mockRejectedValue({
    status: 409,
    body: { error: 'structural change blocked', dependencies: { contatosComoLocalidade: 24, filhas: 0, contatosComoMunicipio: 0, avisos: 0 } },
  });
  const povoado = { id: 'p1', name: 'Barao', kind: 'locality', parentId: 'm1', sgpPop: null, active: true, served: false, note: '' };
  render(<CityForm place={povoado} places={[MUNICIPIO, { id: 'm2', name: 'Outra', kind: 'city', parentId: null }]} onSaved={vi.fn()} onCancel={vi.fn()} />);

  await userEvent.selectOptions(screen.getByLabelText('Município'), 'm2');
  await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));

  expect(await screen.findByText(/24 contatos/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/CityForm.test.jsx`
Expected: FAIL — `Cannot find module './CityForm'`.

- [ ] **Step 3: Write the implementation**

Criar `frontend/src/components/CityForm.jsx` a partir de `CreateCityForm.jsx`, mantendo as mesmas classes Tailwind e o mesmo uso de `Button` e `descreverErro`, e acrescentando:

- campo `name` (label **"Nome"**);
- select `kind` (label **"Tipo"**) com opções `city` → "Cidade / Município" e `locality` → "Povoado / Localidade". Para um registro `unclassified`, o valor inicial é `''`, a tela mostra o texto **"Não classificado"** e o `Salvar` fica desabilitado enquanto o tipo não for escolhido;
- select `parentId` (label **"Município"**), **renderizado apenas** quando `kind === 'locality'`, listando `places.filter((p) => p.kind === 'city')`;
- campo `sgpPop` (label **"POP do SGP"**), opcional, com texto de ajuda: *"Exatamente como o SGP devolve. Serve para reconhecer a localidade do cliente."*;
- checkbox `active` (label **"Ativa"**, padrão marcado) e `served` (label **"Atendida"**, padrão desmarcado);
- textarea `note` (label **"Observação"**).

No `handleSubmit`, chamar `createCity(payload, token)` quando `place` for `null` e `updateCity(place.id, payload, token)` caso contrário. No `catch`, quando `err.status === 409` e `err.body.error === 'structural change blocked'`, montar a mensagem a partir de `err.body.dependencies`, por exemplo:

```js
function descreverBloqueio(dependencies) {
  const partes = [];
  if (dependencies.contatosComoLocalidade) partes.push(`${dependencies.contatosComoLocalidade} contatos usam este povoado`);
  if (dependencies.contatosComoMunicipio) partes.push(`${dependencies.contatosComoMunicipio} contatos usam este município`);
  if (dependencies.filhas) partes.push(`${dependencies.filhas} localidades dependem dele`);
  return `Não dá para mudar a estrutura agora: ${partes.join('; ')}. Trate esses vínculos primeiro.`;
}
```

Em `CitiesAdminTab.jsx`: trocar `useCities` por `usePlaces`; trocar as colunas de `['Cidade', 'Ações']` para `['Nome', 'Tipo', 'Município', 'POP', 'Ativa', 'Atendida', 'Ações']`; acrescentar um botão **Editar** em cada linha, abrindo o mesmo `WaDialog` com `<CityForm place={linha} />`; e estender a busca para casar também o nome do município pai.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/CityForm.test.jsx src/components/CitiesAdminTab.test.jsx`
Expected: PASS.

- [ ] **Step 5: Apagar o formulário antigo e conferir que ninguém o importa**

Run: `rm frontend/src/components/CreateCityForm.jsx frontend/src/components/CreateCityForm.test.jsx && grep -rn "CreateCityForm" frontend/src`
Expected: nenhum resultado.

- [ ] **Step 6: Commit**

```bash
git add -A frontend/src/components
git commit -m "Tela de Cidades e localidades, com tipo, municipio pai, POP e edicao

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: Dois selects encadeados no contato

**Files:**
- Modify: `frontend/src/components/EditContactModal.jsx`
- Test: `frontend/src/components/EditContactModal.test.jsx`

**Interfaces:**
- Consumes: Tasks 9 e 10.
- Produces: o modal envia `{ cityId, localityId }`.

- [ ] **Step 1: Write the failing test**

```jsx
const LUGARES = [
  { id: 'm1', name: 'Candido Mendes', kind: 'city', parentId: null },
  { id: 'm2', name: 'Carutapera', kind: 'city', parentId: null },
  { id: 'p1', name: 'Barao de Tromai', kind: 'locality', parentId: 'm1' },
];

test('a localidade so oferece filhas do municipio escolhido', async () => {
  render(<EditContactModal conversation={{ contactCityId: 'm1', contactLocalityId: null }} onSaved={vi.fn()} onClose={vi.fn()} />);

  const localidade = screen.getByLabelText('Localidade');
  expect(within(localidade).getByRole('option', { name: 'Barao de Tromai' })).toBeInTheDocument();

  await userEvent.selectOptions(screen.getByLabelText('Município'), 'm2');
  expect(within(screen.getByLabelText('Localidade')).queryByRole('option', { name: 'Barao de Tromai' })).not.toBeInTheDocument();
});

test('trocar de municipio limpa a localidade escolhida', async () => {
  const spy = vi.spyOn(api, 'updateContact').mockResolvedValue({});
  render(<EditContactModal conversation={{ contactCityId: 'm1', contactLocalityId: 'p1' }} onSaved={vi.fn()} onClose={vi.fn()} />);

  await userEvent.selectOptions(screen.getByLabelText('Município'), 'm2');
  await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));

  expect(spy).toHaveBeenCalledWith(expect.anything(), { cityId: 'm2', localityId: null }, 't');
});

test('sem municipio, a localidade fica desabilitada', () => {
  render(<EditContactModal conversation={{ contactCityId: null, contactLocalityId: null }} onSaved={vi.fn()} onClose={vi.fn()} />);
  expect(screen.getByLabelText('Localidade')).toBeDisabled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/EditContactModal.test.jsx`
Expected: FAIL — não existe campo "Localidade".

- [ ] **Step 3: Write the implementation**

Em `EditContactModal.jsx`: trocar `useCities` por `usePlaces`; renomear o label do select existente de "Cidade" para **"Município"**, filtrando `places.filter((p) => p.kind !== 'locality')`; acrescentar o select `contact-locality` (label **"Localidade"**) com `places.filter((p) => p.parentId === cityId)`, `disabled` quando não houver município e opção vazia "Nenhuma". No `onChange` do município, zerar a localidade no mesmo `setState`. Enviar `{ cityId: cityId || null, localityId: localityId || null }`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/EditContactModal.test.jsx`
Expected: PASS.

- [ ] **Step 5: Rodar a suíte inteira dos dois lados**

Run: `npm test` e depois `cd frontend && npx vitest run`
Expected: PASS nos dois. É a prova final de que nada existente regrediu.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/EditContactModal.jsx frontend/src/components/EditContactModal.test.jsx
git commit -m "Contato escolhe municipio e localidade em selects encadeados

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Depois deste plano

Ficam **fora**, cada um com escopo próprio:

- `2026-09-22-etapa1-cadastro-de-planos.md` — independente, pode correr em paralelo
- `2026-09-22-etapa1c-conversao-legado.md` — depende deste, e só roda com autorização explícita
- Etapas 3, 4 e 5 da spec — tocam área protegida e não começam sem aprovação própria
