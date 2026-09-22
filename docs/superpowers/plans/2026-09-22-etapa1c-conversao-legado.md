# Conversão dos povoados legados (Etapa 1C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Converter os três registros de `cities` que já são povoados em produção — `Aurizona`, `Barão de Tromaí` e `Chega tudo` — para `kind='locality'` com o município correto, repontando os contatos deles, **sem perder nenhum `id` nem nenhum vínculo**.

**Architecture:** Uma operação administrativa à parte, em transação, disparada à mão e **um registro por vez**. Não é migration, não é rota e não afeta a edição comum. Cada execução exige que o município já esteja classificado e que o proprietário informe explicitamente qual é ele.

**Tech Stack:** Node.js, PostgreSQL 16.15, `pg`, Jest.

**Spec:** [`docs/superpowers/specs/2026-09-22-cadastros-e-contexto-dinamico-design.md`](../specs/2026-09-22-cadastros-e-contexto-dinamico-design.md) — seção A11.

**Depende de:** `2026-09-22-etapa1-cidades-e-localidades.md`, concluído e publicado.

## Global Constraints

- **Preservar os `id` existentes.** Nunca excluir, nunca recriar, nunca duplicar. Os 66 contatos vinculados dependem deles. Toda alteração é `UPDATE`.
- **NÃO é migration.** O Build Command do Render roda `npm run migrate -- up` sozinho a cada deploy. Uma conversão de dados dentro de `migrations/` seria executada **sem autorização, em produção, no meio de um deploy**. O arquivo mora em `scripts/`.
- **NÃO enfraquece o 409.** A rota `PATCH /api/admin/cities/:id` continua recusando mudança estrutural com vínculos, exatamente como está. Este script é caminho próprio e auditado — **nunca** uma flag de bypass na rota.
- **Contato ligado só ao município não é tocado.** Estar em Cândido Mendes não prova a qual povoado a pessoa pertence. Deduzir isso inventaria endereço de cliente real.
- **Não adivinhar município.** Só Barão de Tromaí tem o pai confirmado (`Cândido Mendes`, `e0713c35-f6d9-429e-a89f-bd1232a04d45`). Aurizona e "Chega tudo" **exigem confirmação do proprietário** antes de rodar.
- **`--dry-run` é o padrão.** Escrever só com `--confirmar` explícito.
- **Backend:** `npm test -- <arquivo>`.

---

## Contexto: o estado real em produção

Leitura de 2026-09-22. `cities` tem 13 registros, sem duplicata, e **nenhum aviso ativo** vinculado a eles neste momento.

| Registro | `id` | Contatos | Município |
|---|---|---|---|
| Aurizona | `c55ba683-e8f3-4ab5-80a0-5ba96eb393af` | 10 | **a confirmar** |
| Barão de Tromaí | `7da9519e-78ac-442f-a8c4-98f54e769ca6` | 24 | Cândido Mendes — `e0713c35-f6d9-429e-a89f-bd1232a04d45` |
| Chega tudo | `95a5648d-6e88-4356-a923-1f140c82ab10` | 32 | **a confirmar** |

**Como esses contatos estão hoje:** `city_id` aponta para o **povoado** e `locality_id` está vazio — porque, até agora, povoado e município ocupavam a mesma lista. A conversão move essa informação para o lugar certo sem perdê-la.

```
antes:  contact.city_id = Barão de Tromaí   locality_id = NULL
depois: contact.city_id = Cândido Mendes    locality_id = Barão de Tromaí
```

### A ordem das duas escritas não é arbitrária

A chave estrangeira composta exige que a linha da localidade **já tenha** o `parent_id` certo quando o contato passar a apontar para ela. Então, dentro da transação:

1. `UPDATE cities` — o povoado vira `locality` com `parent_id` do município;
2. `UPDATE contacts` — os contatos daquele povoado recebem `city_id` do município e `locality_id` do povoado.

O passo intermediário é válido: enquanto `locality_id` é nulo, a FK composta não é verificada (`MATCH SIMPLE`).

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `src/cities/converter-localidade.js` | A operação, pura o bastante para ser testada: valida, escreve em transação, devolve o relatório |
| `scripts/converter-localidade.js` | Entrada de linha de comando: lê argumentos, exige `--confirmar`, imprime o relatório |

---

### Task 1: A operação de conversão

**Files:**
- Create: `src/cities/converter-localidade.js`
- Test: `src/cities/converter-localidade.test.js`

**Interfaces:**
- Consumes: `cities` e `contacts` já evoluídas pelo plano de Cidades e Localidades.
- Produces:
  - `converterEmLocalidade({ placeId, parentId, confirmar }) → Promise<Relatorio>`
  - `Relatorio = { ok, motivo, place, parent, contatosMovidos, avisosPreservados, simulacao }`

- [ ] **Step 1: Write the failing test**

Arquivo `src/cities/converter-localidade.test.js`:

```js
const { getPool, closePool } = require('../db/pool');
const { findOrCreateContactByPhoneNumber } = require('../conversations/contact.repository');
const { createPlace, findCityById } = require('./city.repository');
const { converterEmLocalidade } = require('./converter-localidade');

async function cenario() {
  const municipio = await createPlace({ name: 'Candido Mendes', kind: 'city' });
  const { rows } = await getPool().query(
    "INSERT INTO cities (name) VALUES ('Barao de Tromai') RETURNING id"
  );
  const povoadoId = rows[0].id;

  const ids = [];
  for (let i = 0; i < 3; i += 1) {
    const contato = await findOrCreateContactByPhoneNumber(`+551190000${100 + i}`, `C${i}`);
    await getPool().query('UPDATE contacts SET city_id = $2 WHERE id = $1', [contato.id, povoadoId]);
    ids.push(contato.id);
  }

  const soMunicipio = await findOrCreateContactByPhoneNumber('+5511900009999', 'So municipio');
  await getPool().query('UPDATE contacts SET city_id = $2 WHERE id = $1', [soMunicipio.id, municipio.id]);

  return { municipioId: municipio.id, povoadoId, ids, soMunicipioId: soMunicipio.id };
}

describe('conversao de registro legado em localidade', () => {
  beforeEach(async () => {
    await getPool().query('TRUNCATE cities, contacts CASCADE');
  });

  afterAll(async () => {
    await closePool();
  });

  test('sem --confirmar nao escreve nada, so relata', async () => {
    const { municipioId, povoadoId } = await cenario();

    const relatorio = await converterEmLocalidade({ placeId: povoadoId, parentId: municipioId });

    expect(relatorio.ok).toBe(true);
    expect(relatorio.simulacao).toBe(true);
    expect(relatorio.contatosMovidos).toBe(3);
    expect((await findCityById(povoadoId)).kind).toBe('unclassified');
  });

  test('com --confirmar converte e preserva o id', async () => {
    const { municipioId, povoadoId, ids } = await cenario();

    const relatorio = await converterEmLocalidade({ placeId: povoadoId, parentId: municipioId, confirmar: true });

    expect(relatorio.ok).toBe(true);
    expect(relatorio.simulacao).toBe(false);
    expect(relatorio.contatosMovidos).toBe(3);

    const povoado = await findCityById(povoadoId);
    expect(povoado.id).toBe(povoadoId);
    expect(povoado.kind).toBe('locality');
    expect(povoado.parentId).toBe(municipioId);
    expect(povoado.name).toBe('Barao de Tromai');

    const { rows } = await getPool().query(
      'SELECT city_id, locality_id FROM contacts WHERE id = ANY($1) ORDER BY id',
      [ids]
    );
    for (const linha of rows) {
      expect(linha.city_id).toBe(municipioId);
      expect(linha.locality_id).toBe(povoadoId);
    }
  });

  test('contato ligado so ao municipio nao e tocado', async () => {
    const { municipioId, povoadoId, soMunicipioId } = await cenario();

    await converterEmLocalidade({ placeId: povoadoId, parentId: municipioId, confirmar: true });

    const { rows } = await getPool().query('SELECT city_id, locality_id FROM contacts WHERE id = $1', [soMunicipioId]);
    expect(rows[0].city_id).toBe(municipioId);
    expect(rows[0].locality_id).toBeNull();
  });

  test('o aviso do povoado continua apontando para o mesmo registro', async () => {
    const { municipioId, povoadoId } = await cenario();
    await getPool().query("INSERT INTO city_notices (city_id, message, enabled) VALUES ($1, 'falha', true)", [povoadoId]);

    const relatorio = await converterEmLocalidade({ placeId: povoadoId, parentId: municipioId, confirmar: true });

    expect(relatorio.avisosPreservados).toBe(1);
    const { rows } = await getPool().query('SELECT city_id, message FROM city_notices');
    expect(rows).toHaveLength(1);
    expect(rows[0].city_id).toBe(povoadoId);
    expect(rows[0].message).toBe('falha');
  });

  test('recusa quando o municipio ainda nao foi classificado', async () => {
    const legado = await getPool().query("INSERT INTO cities (name) VALUES ('Ainda legado') RETURNING id");
    const { povoadoId } = await cenario();

    const relatorio = await converterEmLocalidade({ placeId: povoadoId, parentId: legado.rows[0].id, confirmar: true });

    expect(relatorio.ok).toBe(false);
    expect(relatorio.motivo).toBe('parent_nao_e_municipio');
    expect((await findCityById(povoadoId)).kind).toBe('unclassified');
  });

  test('recusa quando o registro ja e localidade', async () => {
    const { municipioId } = await cenario();
    const ja = await createPlace({ name: 'Ja convertido', kind: 'locality', parentId: municipioId });

    const relatorio = await converterEmLocalidade({ placeId: ja.id, parentId: municipioId, confirmar: true });

    expect(relatorio.ok).toBe(false);
    expect(relatorio.motivo).toBe('ja_e_localidade');
  });

  test('recusa quando o registro tem localidades filhas', async () => {
    const { municipioId, povoadoId } = await cenario();
    await getPool().query("UPDATE cities SET kind = 'city' WHERE id = $1", [povoadoId]);
    await createPlace({ name: 'Neta', kind: 'locality', parentId: povoadoId });

    const relatorio = await converterEmLocalidade({ placeId: povoadoId, parentId: municipioId, confirmar: true });

    expect(relatorio.ok).toBe(false);
    expect(relatorio.motivo).toBe('tem_filhas');
  });

  test('recusa quando placeId e parentId sao o mesmo registro', async () => {
    const { municipioId } = await cenario();

    const relatorio = await converterEmLocalidade({ placeId: municipioId, parentId: municipioId, confirmar: true });

    expect(relatorio.ok).toBe(false);
    expect(relatorio.motivo).toBe('pai_igual_ao_filho');
  });

  test('uma falha depois do UPDATE de cities nao deixa estado pela metade', async () => {
    const { municipioId, povoadoId } = await cenario();

    // A operação usa connect(), não getPool().query: o espião precisa ser no
    // client, senão o teste passa sem exercitar a transação.
    const connectOriginal = getPool().connect.bind(getPool());
    jest.spyOn(getPool(), 'connect').mockImplementation(async () => {
      const client = await connectOriginal();
      const queryOriginal = client.query.bind(client);
      client.query = (...args) => {
        if (typeof args[0] === 'string' && args[0].includes('UPDATE contacts')) {
          return Promise.reject(new Error('falha simulada'));
        }
        return queryOriginal(...args);
      };
      return client;
    });

    await expect(
      converterEmLocalidade({ placeId: povoadoId, parentId: municipioId, confirmar: true })
    ).rejects.toThrow('falha simulada');

    getPool().connect.mockRestore();

    // O povoado tem de continuar legado: o ROLLBACK desfez o UPDATE de cities.
    expect((await findCityById(povoadoId)).kind).toBe('unclassified');
    const { rows } = await getPool().query('SELECT count(*)::int AS n FROM contacts WHERE locality_id IS NOT NULL');
    expect(rows[0].n).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/cities/converter-localidade.test.js`
Expected: FAIL — `Cannot find module './converter-localidade'`.

- [ ] **Step 3: Write the implementation**

Arquivo `src/cities/converter-localidade.js`:

```js
// Conversão de um registro legado de `cities` em localidade, repontando os
// contatos dele.
//
// NÃO é migration de propósito: o Render roda `migrate up` sozinho a cada
// deploy, e uma conversão de dados ali seria executada sem autorização, em
// produção, no meio de uma publicação. É operação administrativa, disparada à
// mão, um registro por vez.
//
// NÃO enfraquece o 409 da rota de edição: aquela continua recusando mudança
// estrutural com vínculos. Este é caminho próprio, explícito e auditado — não
// uma flag de bypass.
const { getPool } = require('../db/pool');

async function carregar(client, id) {
  const { rows } = await client.query(
    'SELECT id, name, kind, parent_id FROM cities WHERE id = $1',
    [id]
  );
  return rows[0] || null;
}

async function contar(client, placeId) {
  const { rows } = await client.query(
    `SELECT
       (SELECT count(*) FROM contacts     WHERE city_id   = $1)::int AS contatos,
       (SELECT count(*) FROM cities       WHERE parent_id = $1)::int AS filhas,
       (SELECT count(*) FROM city_notices WHERE city_id   = $1)::int AS avisos`,
    [placeId]
  );
  return rows[0];
}

function recusa(motivo) {
  return { ok: false, motivo, place: null, parent: null, contatosMovidos: 0, avisosPreservados: 0, simulacao: true };
}

async function converterEmLocalidade({ placeId, parentId, confirmar = false }) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    if (!placeId || !parentId) return recusa('faltam_ids');
    if (placeId === parentId) return recusa('pai_igual_ao_filho');

    const place = await carregar(client, placeId);
    if (!place) return recusa('place_nao_encontrado');
    if (place.kind === 'locality') return recusa('ja_e_localidade');

    const parent = await carregar(client, parentId);
    if (!parent) return recusa('parent_nao_encontrado');
    // O município precisa estar classificado ANTES. Classificar um município é
    // edição comum, feita na tela: nada depende dele como localidade, então a
    // rota permite. Aqui só conferimos.
    if (parent.kind !== 'city') return recusa('parent_nao_e_municipio');

    const antes = await contar(client, placeId);
    if (antes.filhas > 0) return recusa('tem_filhas');

    const relatorio = {
      ok: true,
      motivo: null,
      place: { id: place.id, name: place.name },
      parent: { id: parent.id, name: parent.name },
      contatosMovidos: antes.contatos,
      avisosPreservados: antes.avisos,
      simulacao: !confirmar,
    };

    if (!confirmar) {
      await client.query('ROLLBACK');
      return relatorio;
    }

    // A ordem importa: a FK composta exige que a linha da localidade JÁ tenha o
    // parent_id certo quando o contato passar a apontar para ela.
    await client.query(
      "UPDATE cities SET kind = 'locality', parent_id = $2 WHERE id = $1",
      [placeId, parentId]
    );
    // Só os contatos DESTE povoado. Quem está ligado apenas ao município não é
    // tocado: estar no município não prova a qual povoado a pessoa pertence.
    await client.query(
      'UPDATE contacts SET city_id = $2, locality_id = $1 WHERE city_id = $1',
      [placeId, parentId]
    );

    await client.query('COMMIT');
    return relatorio;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { converterEmLocalidade };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/cities/converter-localidade.test.js`
Expected: PASS, 9 testes.

- [ ] **Step 5: Commit**

```bash
git add src/cities/converter-localidade.js src/cities/converter-localidade.test.js
git commit -m "Conversao de registro legado em localidade, transacional e com simulacao

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: A entrada de linha de comando

**Files:**
- Create: `scripts/converter-localidade.js`

**Interfaces:**
- Consumes: Task 1.
- Produces: `node scripts/converter-localidade.js --place <uuid> --parent <uuid> [--confirmar]`

- [ ] **Step 1: Write the script**

```js
#!/usr/bin/env node
// Converte UM registro legado de `cities` em localidade, repontando os contatos.
//
// Simula por padrão. Escreve só com --confirmar.
//
//   node scripts/converter-localidade.js --place <uuid> --parent <uuid>
//   node scripts/converter-localidade.js --place <uuid> --parent <uuid> --confirmar
//
// Um registro por execução, de propósito: a conversão é decisão por registro, e
// o município de Aurizona e de "Chega tudo" ainda precisa ser confirmado pelo
// proprietário. O script NUNCA adivinha o município.
const { converterEmLocalidade } = require('../src/cities/converter-localidade');
const { closePool } = require('../src/db/pool');

function argumento(nome) {
  const i = process.argv.indexOf(`--${nome}`);
  return i === -1 ? null : process.argv[i + 1];
}

const MOTIVOS = {
  faltam_ids: 'Informe --place e --parent.',
  pai_igual_ao_filho: 'O município e o povoado são o mesmo registro.',
  place_nao_encontrado: 'O registro informado em --place não existe.',
  parent_nao_encontrado: 'O registro informado em --parent não existe.',
  ja_e_localidade: 'Esse registro já é uma localidade. Nada a fazer.',
  parent_nao_e_municipio: 'O município precisa estar classificado como Cidade antes. Faça isso na tela de Cidades e localidades e rode de novo.',
  tem_filhas: 'Esse registro tem localidades filhas e não pode virar localidade. Trate as filhas primeiro.',
};

(async () => {
  const confirmar = process.argv.includes('--confirmar');
  try {
    const r = await converterEmLocalidade({
      placeId: argumento('place'),
      parentId: argumento('parent'),
      confirmar,
    });

    if (!r.ok) {
      console.error(`RECUSADO (${r.motivo}): ${MOTIVOS[r.motivo] || 'motivo desconhecido'}`);
      process.exitCode = 1;
      return;
    }

    console.log(r.simulacao ? '--- SIMULAÇÃO, nada foi gravado ---' : '--- CONVERTIDO ---');
    console.log(`  ${r.place.name} (${r.place.id})`);
    console.log(`  passa a ser localidade de ${r.parent.name} (${r.parent.id})`);
    console.log(`  contatos repontados: ${r.contatosMovidos}`);
    console.log(`  avisos preservados no mesmo registro: ${r.avisosPreservados}`);
    if (r.simulacao) console.log('\nPara gravar de verdade, repita o comando com --confirmar.');
  } finally {
    await closePool();
  }
})().catch((err) => {
  console.error('FALHOU, e nada foi gravado:', err.message);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Provar a simulação no banco de teste**

```bash
npx dotenv -e .env.test -o -- node -e "
  const { getPool, closePool } = require('./src/db/pool');
  (async () => {
    await getPool().query('TRUNCATE cities, contacts CASCADE');
    const m = await getPool().query(\"INSERT INTO cities (name, kind) VALUES ('Municipio','city') RETURNING id\");
    const p = await getPool().query(\"INSERT INTO cities (name) VALUES ('Povoado') RETURNING id\");
    console.log('PLACE=' + p.rows[0].id, 'PARENT=' + m.rows[0].id);
    await closePool();
  })();
"
```

Rodar o script com os dois ids impressos, **sem** `--confirmar`.
Expected: imprime `--- SIMULAÇÃO, nada foi gravado ---` e sai com código 0.

- [ ] **Step 3: Provar a recusa do município não classificado**

Repetir o passo anterior criando o pai **sem** `kind` (legado) e rodar com `--confirmar`.
Expected: `RECUSADO (parent_nao_e_municipio)` e código de saída 1.

- [ ] **Step 4: Commit**

```bash
git add scripts/converter-localidade.js
git commit -m "Comando de conversao de localidade, com simulacao por padrao

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Roteiro de execução em produção

**Files:** nenhum. É operação, não código.

> **Nada aqui roda sem autorização explícita do proprietário, registro por registro.**

- [ ] **Step 1: Confirmar os municípios que faltam**

Perguntar ao proprietário a qual município pertencem **Aurizona** e **Chega tudo**. **Não deduzir.** Se algum não tiver município cadastrado, ele precisa ser criado antes, na tela.

- [ ] **Step 2: Classificar os municípios na tela**

Em *Cadastros auxiliares → Cidades e localidades*, editar cada município envolvido e definir o Tipo como **Cidade / Município**. É edição comum: nada depende deles como localidade, então a rota permite e não devolve 409.

Confirmar que `Cândido Mendes` (`e0713c35-f6d9-429e-a89f-bd1232a04d45`) está como Cidade antes de seguir.

- [ ] **Step 3: Simular os três, sem gravar**

```bash
node scripts/converter-localidade.js --place 7da9519e-78ac-442f-a8c4-98f54e769ca6 --parent e0713c35-f6d9-429e-a89f-bd1232a04d45
node scripts/converter-localidade.js --place c55ba683-e8f3-4ab5-80a0-5ba96eb393af --parent <municipio de Aurizona>
node scripts/converter-localidade.js --place 95a5648d-6e88-4356-a923-1f140c82ab10 --parent <municipio de Chega tudo>
```

Conferir que a contagem de contatos bate com o levantamento: **24**, **10** e **32**. Divergência significa que alguma coisa mudou desde 22/09 — **parar e investigar**, não seguir.

- [ ] **Step 4: Converter um de cada vez, com aprovação entre cada um**

Começar por **Barão de Tromaí**, que é o único com município confirmado. Rodar com `--confirmar`, conferir na tela e só então passar ao próximo.

- [ ] **Step 5: Conferir o resultado**

Somente leitura:

```sql
SELECT c.id, c.name, c.kind, p.name AS municipio,
       (SELECT count(*) FROM contacts WHERE locality_id = c.id) AS contatos
FROM cities c LEFT JOIN cities p ON p.id = c.parent_id
WHERE c.kind = 'locality';

-- Tem de voltar vazio: ninguém pode ter localidade sem município.
SELECT count(*) FROM contacts WHERE locality_id IS NOT NULL AND city_id IS NULL;
```

- [ ] **Step 6: Conferir que sobrou pendência classificada, não escondida**

```sql
SELECT id, name FROM cities WHERE kind = 'unclassified';
```

O que restar aí são registros legados que ainda ninguém classificou. **Não é erro** — é a pendência aparecendo, que foi exatamente a razão de `kind` nascer `'unclassified'` em vez de `'city'`.

---

## Depois deste plano

Com os povoados convertidos e os municípios classificados, a **Etapa 2** da spec pode começar: o proprietário popula os POPs e marca `served`, e as duas incertezas do `fatura2via` são respondidas com dado real.
