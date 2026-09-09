# Aviso Condicional por Cidade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deixar um admin cadastrar um aviso por cidade (ex: instabilidade de rede) que é
enviado automaticamente, uma vez por cliente por ativação, a todo contato daquela cidade que
entrar em contato — em conversa nova ou já em andamento — junto com a boas-vindas normal do
canal, não no lugar dela.

**Architecture:** Duas tabelas novas (`city_notices` 1-por-cidade, `city_notice_deliveries`
rastreando quem já recebeu). Um novo passo em `ingestInboundMessage`, independente do bloco
de boas-vindas/triagem, roda em toda mensagem inbound. Três rotas admin novas num arquivo
próprio. UI nova dentro da aba "Mensagens" já existente, replicando byte a byte o padrão
criar/editar/excluir que a seção "Boas-vindas por canal" já usa em produção (adaptado com um
toggle "Ativo" no lugar de "texto vazio desativa").

**Tech Stack:** Node.js/Express, PostgreSQL (`node-pg-migrate`), Jest (backend, testes de
integração reais contra o banco de teste), React + Vitest (frontend).

**Spec:** `docs/superpowers/specs/2026-09-09-city-notice-design.md`

## Global Constraints

- Mensagem do aviso: sempre obrigatória para salvar (`message NOT NULL` no banco, string
  não-vazia após `.trim()` na validação da rota) — ao contrário da boas-vindas, não existe
  "aviso vazio". O toggle `enabled` é o único controle de "ativo ou não".
- Limite de 4096 caracteres no `message`, mesma mensagem de erro do `welcomeMessage`:
  `'message must be 4096 characters or fewer'`.
- Reativar (`enabled` false→true) sempre reseta `city_notice_deliveries` daquele aviso —
  toda cidade recebe de novo, tratado como ocorrência nova do problema. Uma edição que
  mantém `enabled: true → true` NUNCA reseta as entregas.
- O aviso de cidade dispara em QUALQUER mensagem do contato (conversa nova ou já em
  andamento) enquanto o aviso estiver ativo — diferente da boas-vindas, que só dispara em
  `justCreated`.
- Ordem de disparo no histórico da conversa quando os dois se aplicam: boas-vindas do canal
  → aviso da cidade → pergunta de triagem.
- Todas as rotas admin exigem `requireAuth` + `requireRole('admin')`.

---

### Task 1: Migração + `findCityById` no repository de cidades

**Files:**
- Create: `migrations/1788860000000_create-city-notices-tables.js`
- Modify: `src/cities/city.repository.js`
- Test: `src/cities/city.repository.test.js`

**Interfaces:**
- Produces: `findCityById(id)` retorna `{id, name, createdAt}` ou `null`. Usado pela Task 4
  para validar que a cidade existe antes de criar/atualizar um aviso.

- [ ] **Step 1: Escrever a migração**

Criar `migrations/1788860000000_create-city-notices-tables.js`:

```javascript
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE city_notices (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      city_id UUID NOT NULL UNIQUE REFERENCES cities(id) ON DELETE CASCADE,
      message TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT false,
      activated_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  pgm.sql(`
    CREATE TABLE city_notice_deliveries (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      city_notice_id UUID NOT NULL REFERENCES city_notices(id) ON DELETE CASCADE,
      contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (city_notice_id, contact_id)
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE city_notice_deliveries;`);
  pgm.sql(`DROP TABLE city_notices;`);
};
```

- [ ] **Step 2: Rodar a migração no banco de teste**

Run: `npm run migrate:test -- up`
Expected: `city_notices` e `city_notice_deliveries` aparecem no schema, sem erro.

- [ ] **Step 3: Escrever o teste que falha para `findCityById`**

Em `src/cities/city.repository.test.js`, atualizar o import do topo do arquivo:

```javascript
const { listCities, createCity, deleteCity, findCityById } = require('./city.repository');
```

Adicionar este teste, dentro do `describe('city repository', ...)`:

```javascript
  test('findCityById returns the city, or null when it does not exist', async () => {
    const city = await createCity({ name: 'Bahia' });

    expect(await findCityById(city.id)).toEqual(city);
    expect(await findCityById('00000000-0000-0000-0000-000000000000')).toBeNull();
  });
```

- [ ] **Step 4: Rodar o teste pra confirmar que falha**

Run: `npm test -- city.repository.test.js`
Expected: FAIL — `findCityById is not a function` (ainda não exportado).

- [ ] **Step 5: Implementar `findCityById`**

Em `src/cities/city.repository.js`, adicionar a função (em qualquer lugar antes do
`module.exports`) e adicioná-la ao `module.exports`:

```javascript
async function findCityById(id) {
  const result = await getPool().query('SELECT id, name, created_at FROM cities WHERE id = $1', [id]);
  if (result.rowCount === 0) return null;
  return toCity(result.rows[0]);
}
```

```javascript
module.exports = { listCities, createCity, deleteCity, findCityById };
```

- [ ] **Step 6: Rodar o teste pra confirmar que passa**

Run: `npm test -- city.repository.test.js`
Expected: PASS (todos os testes do arquivo, incluindo o novo).

- [ ] **Step 7: Commit**

```bash
git add migrations/1788860000000_create-city-notices-tables.js src/cities/city.repository.js src/cities/city.repository.test.js
git commit -m "Add city_notices/city_notice_deliveries tables and findCityById"
```

---

### Task 2: Módulo `city-notice.repository.js`

**Files:**
- Create: `src/city-notices/city-notice.repository.js`
- Test: `src/city-notices/city-notice.repository.test.js`

**Interfaces:**
- Consumes: `city_notices`/`city_notice_deliveries` tabelas (Task 1); `createCity` de
  `../cities/city.repository` (só no teste, pra popular cidades); `findOrCreateContactByPhoneNumber`
  de `../conversations/contact.repository` (só no teste, pra popular contatos).
- Produces (usadas pela Task 3 e Task 4): `listCityNoticesByCityIds(cityIds)` retorna
  `[{id, cityId, message, enabled, activatedAt}]`; `findActiveCityNoticeByCityId(cityId)`
  retorna `{id, cityId, message, enabled, activatedAt}` ou `null` (`null` de cara se
  `cityId` for falsy, sem cidade sem aviso ativo, sem aviso desativado); `upsertCityNotice(cityId, {message, enabled})`
  retorna o objeto notice criado/atualizado, resetando `city_notice_deliveries` quando
  `enabled` passa de `false` para `true`; `deleteCityNotice(cityId)` retorna `true`/`false`;
  `hasContactReceivedNotice(cityNoticeId, contactId)` retorna boolean;
  `recordNoticeDelivery(cityNoticeId, contactId)` grava a entrega (idempotente).

- [ ] **Step 1: Escrever os testes que falham**

Criar `src/city-notices/city-notice.repository.test.js`:

```javascript
const { getPool, closePool } = require('../db/pool');
const { createCity } = require('../cities/city.repository');
const { findOrCreateContactByPhoneNumber } = require('../conversations/contact.repository');
const {
  listCityNoticesByCityIds,
  findActiveCityNoticeByCityId,
  upsertCityNotice,
  deleteCityNotice,
  hasContactReceivedNotice,
  recordNoticeDelivery,
} = require('./city-notice.repository');

describe('city notice repository', () => {
  beforeEach(async () => {
    await getPool().query('TRUNCATE city_notice_deliveries, city_notices, cities, contacts CASCADE');
  });

  afterAll(async () => {
    await closePool();
  });

  test('findActiveCityNoticeByCityId returns null when the city has no notice', async () => {
    const city = await createCity({ name: 'Maracaçumé' });
    expect(await findActiveCityNoticeByCityId(city.id)).toBeNull();
  });

  test('findActiveCityNoticeByCityId returns null for a null or undefined cityId, without querying', async () => {
    expect(await findActiveCityNoticeByCityId(null)).toBeNull();
    expect(await findActiveCityNoticeByCityId(undefined)).toBeNull();
  });

  test('findActiveCityNoticeByCityId returns null when the notice exists but is disabled', async () => {
    const city = await createCity({ name: 'Maracaçumé' });
    await upsertCityNotice(city.id, { message: 'Instabilidade na rede', enabled: false });
    expect(await findActiveCityNoticeByCityId(city.id)).toBeNull();
  });

  test('findActiveCityNoticeByCityId returns the notice when enabled', async () => {
    const city = await createCity({ name: 'Maracaçumé' });
    await upsertCityNotice(city.id, { message: 'Instabilidade na rede', enabled: true });

    const notice = await findActiveCityNoticeByCityId(city.id);

    expect(notice.cityId).toBe(city.id);
    expect(notice.message).toBe('Instabilidade na rede');
    expect(notice.enabled).toBe(true);
  });

  test('upsertCityNotice sets activatedAt when created already enabled', async () => {
    const city = await createCity({ name: 'Maracaçumé' });
    const notice = await upsertCityNotice(city.id, { message: 'Instabilidade', enabled: true });
    expect(notice.activatedAt).not.toBeNull();
  });

  test('upsertCityNotice leaves activatedAt null when created disabled', async () => {
    const city = await createCity({ name: 'Maracaçumé' });
    const notice = await upsertCityNotice(city.id, { message: 'Instabilidade', enabled: false });
    expect(notice.activatedAt).toBeNull();
  });

  test('upsertCityNotice updates the same row on a second call for the same city, instead of creating a second one', async () => {
    const city = await createCity({ name: 'Maracaçumé' });
    const first = await upsertCityNotice(city.id, { message: 'Primeiro texto', enabled: false });

    const second = await upsertCityNotice(city.id, { message: 'Segundo texto', enabled: false });

    expect(second.id).toBe(first.id);
    expect(second.message).toBe('Segundo texto');
  });

  test('upsertCityNotice resets deliveries when enabled transitions from false to true (reactivation)', async () => {
    const city = await createCity({ name: 'Maracaçumé' });
    const contact = await findOrCreateContactByPhoneNumber('+5598999990001', 'Cliente');
    const notice = await upsertCityNotice(city.id, { message: 'Instabilidade', enabled: true });
    await recordNoticeDelivery(notice.id, contact.id);
    expect(await hasContactReceivedNotice(notice.id, contact.id)).toBe(true);

    await upsertCityNotice(city.id, { message: 'Instabilidade', enabled: false });
    const reactivated = await upsertCityNotice(city.id, { message: 'Instabilidade de novo', enabled: true });

    expect(await hasContactReceivedNotice(reactivated.id, contact.id)).toBe(false);
  });

  test('upsertCityNotice does not reset deliveries when enabled stays true across an edit', async () => {
    const city = await createCity({ name: 'Maracaçumé' });
    const contact = await findOrCreateContactByPhoneNumber('+5598999990002', 'Cliente');
    const notice = await upsertCityNotice(city.id, { message: 'Instabilidade', enabled: true });
    await recordNoticeDelivery(notice.id, contact.id);

    await upsertCityNotice(city.id, { message: 'Texto editado', enabled: true });

    expect(await hasContactReceivedNotice(notice.id, contact.id)).toBe(true);
  });

  test('deleteCityNotice removes the notice and returns true', async () => {
    const city = await createCity({ name: 'Maracaçumé' });
    await upsertCityNotice(city.id, { message: 'Instabilidade', enabled: true });

    const deleted = await deleteCityNotice(city.id);

    expect(deleted).toBe(true);
    expect(await findActiveCityNoticeByCityId(city.id)).toBeNull();
  });

  test('deleteCityNotice returns false when the city has no notice', async () => {
    const city = await createCity({ name: 'Maracaçumé' });
    expect(await deleteCityNotice(city.id)).toBe(false);
  });

  test('deleteCityNotice cascades to remove delivery records', async () => {
    const city = await createCity({ name: 'Maracaçumé' });
    const contact = await findOrCreateContactByPhoneNumber('+5598999990003', 'Cliente');
    const notice = await upsertCityNotice(city.id, { message: 'Instabilidade', enabled: true });
    await recordNoticeDelivery(notice.id, contact.id);

    await deleteCityNotice(city.id);

    const result = await getPool().query('SELECT * FROM city_notice_deliveries WHERE city_notice_id = $1', [notice.id]);
    expect(result.rowCount).toBe(0);
  });

  test('listCityNoticesByCityIds returns notices for the given cities, empty array for an empty input', async () => {
    const cityA = await createCity({ name: 'Cidade A' });
    const cityB = await createCity({ name: 'Cidade B' });
    await upsertCityNotice(cityA.id, { message: 'Aviso A', enabled: true });

    expect(await listCityNoticesByCityIds([])).toEqual([]);
    const notices = await listCityNoticesByCityIds([cityA.id, cityB.id]);
    expect(notices).toHaveLength(1);
    expect(notices[0].cityId).toBe(cityA.id);
  });

  test('hasContactReceivedNotice returns false before any delivery is recorded', async () => {
    const city = await createCity({ name: 'Maracaçumé' });
    const contact = await findOrCreateContactByPhoneNumber('+5598999990004', 'Cliente');
    const notice = await upsertCityNotice(city.id, { message: 'Instabilidade', enabled: true });

    expect(await hasContactReceivedNotice(notice.id, contact.id)).toBe(false);
  });

  test('recordNoticeDelivery is idempotent — calling it twice does not throw or duplicate', async () => {
    const city = await createCity({ name: 'Maracaçumé' });
    const contact = await findOrCreateContactByPhoneNumber('+5598999990005', 'Cliente');
    const notice = await upsertCityNotice(city.id, { message: 'Instabilidade', enabled: true });

    await recordNoticeDelivery(notice.id, contact.id);
    await recordNoticeDelivery(notice.id, contact.id);

    const result = await getPool().query(
      'SELECT * FROM city_notice_deliveries WHERE city_notice_id = $1 AND contact_id = $2',
      [notice.id, contact.id]
    );
    expect(result.rowCount).toBe(1);
  });
});
```

- [ ] **Step 2: Rodar os testes pra confirmar que falham**

Run: `npm test -- city-notice.repository.test.js`
Expected: FAIL — `Cannot find module './city-notice.repository'` (arquivo ainda não existe).

- [ ] **Step 3: Implementar o repository**

Criar `src/city-notices/city-notice.repository.js`:

```javascript
const { getPool } = require('../db/pool');

function toCityNotice(row) {
  return {
    id: row.id,
    cityId: row.city_id,
    message: row.message,
    enabled: row.enabled,
    activatedAt: row.activated_at,
  };
}

async function listCityNoticesByCityIds(cityIds) {
  if (cityIds.length === 0) return [];
  const result = await getPool().query(
    'SELECT id, city_id, message, enabled, activated_at FROM city_notices WHERE city_id = ANY($1)',
    [cityIds]
  );
  return result.rows.map(toCityNotice);
}

async function findActiveCityNoticeByCityId(cityId) {
  if (!cityId) return null;
  const result = await getPool().query(
    'SELECT id, city_id, message, enabled, activated_at FROM city_notices WHERE city_id = $1 AND enabled = true',
    [cityId]
  );
  if (result.rowCount === 0) return null;
  return toCityNotice(result.rows[0]);
}

async function upsertCityNotice(cityId, { message, enabled }) {
  const existing = await getPool().query('SELECT enabled FROM city_notices WHERE city_id = $1', [cityId]);
  const wasEnabled = existing.rowCount > 0 && existing.rows[0].enabled;
  const isReactivation = enabled && !wasEnabled;

  const result = await getPool().query(
    `INSERT INTO city_notices (city_id, message, enabled, activated_at)
     VALUES ($1, $2, $3, NULL)
     ON CONFLICT (city_id) DO UPDATE SET
       message = EXCLUDED.message,
       enabled = EXCLUDED.enabled,
       activated_at = CASE WHEN EXCLUDED.enabled THEN city_notices.activated_at ELSE NULL END,
       updated_at = now()
     RETURNING id, city_id, message, enabled, activated_at`,
    [cityId, message, enabled]
  );
  const notice = toCityNotice(result.rows[0]);

  if (isReactivation) {
    // A reactivation (false -> true) is a fresh occurrence of the problem: forget who
    // already got the previous round, so every contact in the city is notified again.
    await getPool().query('UPDATE city_notices SET activated_at = now() WHERE id = $1', [notice.id]);
    await getPool().query('DELETE FROM city_notice_deliveries WHERE city_notice_id = $1', [notice.id]);
    notice.activatedAt = new Date();
  }
  return notice;
}

async function deleteCityNotice(cityId) {
  const result = await getPool().query('DELETE FROM city_notices WHERE city_id = $1', [cityId]);
  return result.rowCount > 0;
}

async function hasContactReceivedNotice(cityNoticeId, contactId) {
  const result = await getPool().query(
    'SELECT 1 FROM city_notice_deliveries WHERE city_notice_id = $1 AND contact_id = $2',
    [cityNoticeId, contactId]
  );
  return result.rowCount > 0;
}

async function recordNoticeDelivery(cityNoticeId, contactId) {
  await getPool().query(
    `INSERT INTO city_notice_deliveries (city_notice_id, contact_id)
     VALUES ($1, $2)
     ON CONFLICT (city_notice_id, contact_id) DO NOTHING`,
    [cityNoticeId, contactId]
  );
}

module.exports = {
  listCityNoticesByCityIds,
  findActiveCityNoticeByCityId,
  upsertCityNotice,
  deleteCityNotice,
  hasContactReceivedNotice,
  recordNoticeDelivery,
};
```

- [ ] **Step 4: Rodar os testes pra confirmar que passam**

Run: `npm test -- city-notice.repository.test.js`
Expected: PASS (todos os 15 testes).

- [ ] **Step 5: Commit**

```bash
git add src/city-notices/city-notice.repository.js src/city-notices/city-notice.repository.test.js
git commit -m "Add the city-notice repository, including reactivation delivery reset"
```

---

### Task 3: Disparo do aviso em `inbound-message.service.js`

**Files:**
- Modify: `src/conversations/inbound-message.service.js`
- Test: `src/conversations/inbound-message.service.test.js`

**Interfaces:**
- Consumes: `findActiveCityNoticeByCityId(cityId)`, `hasContactReceivedNotice(cityNoticeId, contactId)`,
  `recordNoticeDelivery(cityNoticeId, contactId)` de `../city-notices/city-notice.repository` (Task 2).

- [ ] **Step 1: Escrever os testes que falham**

Em `src/conversations/inbound-message.service.test.js`, adicionar o mock e o import no topo
do arquivo (junto aos `jest.mock`/`require` já existentes):

```javascript
jest.mock('../city-notices/city-notice.repository');
```

```javascript
const {
  findActiveCityNoticeByCityId,
  hasContactReceivedNotice,
  recordNoticeDelivery,
} = require('../city-notices/city-notice.repository');
```

Adicionar `findActiveCityNoticeByCityId.mockResolvedValue(null);` ao `beforeEach` já
existente (junto a `shouldStartTriage.mockResolvedValue(false);` e
`findChannelById.mockResolvedValue(...)`), para que nenhum teste pré-existente precise
mudar — sem aviso ativo é o padrão.

Adicionar estes testes, dentro do `describe('ingestInboundMessage', ...)`, em qualquer
posição depois dos testes de boas-vindas já existentes:

```javascript
  test('sends the city notice after the welcome message on a new conversation, when the contact city has an active notice', async () => {
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-city-1', cityId: 'city-1' });
    findOpenConversation.mockResolvedValue(null);
    shouldStartTriage.mockResolvedValue(false);
    findChannelById.mockResolvedValue({ id: 'channel-1', welcomeMessage: 'Bem-vindo!' });
    findActiveCityNoticeByCityId.mockResolvedValue({ id: 'notice-1', cityId: 'city-1', message: 'Instabilidade na rede' });
    hasContactReceivedNotice.mockResolvedValue(false);
    createConversation.mockResolvedValue({ id: 'conv-city-1', assignedAgentId: null, triageState: null });
    createMessage.mockResolvedValue({ id: 'msg-city-1' });
    getConversationWithContact.mockResolvedValue({ id: 'conv-city-1', assignedAgentId: null, triageState: null });

    await ingestInboundMessage({
      channelId: 'channel-1',
      fromPhoneNumber: '+5598999990010',
      contactDisplayName: 'Cliente de Maracaçumé',
      whatsappMessageId: 'wamid.CITY1',
      content: 'Oi',
    });

    expect(findActiveCityNoticeByCityId).toHaveBeenCalledWith('city-1');
    expect(recordNoticeDelivery).toHaveBeenCalledWith('notice-1', 'contact-city-1');
    expect(enqueueOutboundMessage.mock.calls[0][0].content).toBe('Bem-vindo!');
    expect(enqueueOutboundMessage.mock.calls[1][0]).toEqual({
      conversationId: 'conv-city-1',
      channelId: 'channel-1',
      content: 'Instabilidade na rede',
    });
  });

  test('sends the city notice on a conversation already in progress, not just new conversations', async () => {
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-city-2', cityId: 'city-1' });
    findOpenConversation.mockResolvedValue({ id: 'conv-city-2', assignedAgentId: 'agent-1', triageState: null });
    findActiveCityNoticeByCityId.mockResolvedValue({ id: 'notice-2', cityId: 'city-1', message: 'Instabilidade na rede' });
    hasContactReceivedNotice.mockResolvedValue(false);
    createMessage.mockResolvedValue({ id: 'msg-city-2' });
    getConversationWithContact.mockResolvedValue({ id: 'conv-city-2', assignedAgentId: 'agent-1', triageState: null });

    await ingestInboundMessage({
      channelId: 'channel-1',
      fromPhoneNumber: '+5598999990011',
      contactDisplayName: 'Cliente de Maracaçumé',
      whatsappMessageId: 'wamid.CITY2',
      content: 'Ainda sem internet',
    });

    expect(createConversation).not.toHaveBeenCalled();
    expect(enqueueOutboundMessage).toHaveBeenCalledWith({
      conversationId: 'conv-city-2',
      channelId: 'channel-1',
      content: 'Instabilidade na rede',
    });
  });

  test('does not resend the city notice to a contact who already received it', async () => {
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-city-3', cityId: 'city-1' });
    findOpenConversation.mockResolvedValue({ id: 'conv-city-3', assignedAgentId: null, triageState: null });
    findActiveCityNoticeByCityId.mockResolvedValue({ id: 'notice-3', cityId: 'city-1', message: 'Instabilidade na rede' });
    hasContactReceivedNotice.mockResolvedValue(true);
    createMessage.mockResolvedValue({ id: 'msg-city-3' });
    getConversationWithContact.mockResolvedValue({ id: 'conv-city-3', assignedAgentId: null, triageState: null });

    await ingestInboundMessage({
      channelId: 'channel-1',
      fromPhoneNumber: '+5598999990012',
      contactDisplayName: 'Cliente de Maracaçumé',
      whatsappMessageId: 'wamid.CITY3',
      content: 'Oi de novo',
    });

    expect(enqueueOutboundMessage).not.toHaveBeenCalled();
    expect(recordNoticeDelivery).not.toHaveBeenCalled();
  });

  test('does not send a city notice when the contact has no city', async () => {
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-city-4', cityId: null });
    findOpenConversation.mockResolvedValue({ id: 'conv-city-4', assignedAgentId: null, triageState: null });
    createMessage.mockResolvedValue({ id: 'msg-city-4' });
    getConversationWithContact.mockResolvedValue({ id: 'conv-city-4', assignedAgentId: null, triageState: null });

    await ingestInboundMessage({
      channelId: 'channel-1',
      fromPhoneNumber: '+5598999990013',
      contactDisplayName: 'Cliente Sem Cidade',
      whatsappMessageId: 'wamid.CITY4',
      content: 'Oi',
    });

    expect(enqueueOutboundMessage).not.toHaveBeenCalled();
  });

  test('does not send a city notice when the contact city has no active notice', async () => {
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-city-5', cityId: 'city-2' });
    findOpenConversation.mockResolvedValue({ id: 'conv-city-5', assignedAgentId: null, triageState: null });
    findActiveCityNoticeByCityId.mockResolvedValue(null);
    createMessage.mockResolvedValue({ id: 'msg-city-5' });
    getConversationWithContact.mockResolvedValue({ id: 'conv-city-5', assignedAgentId: null, triageState: null });

    await ingestInboundMessage({
      channelId: 'channel-1',
      fromPhoneNumber: '+5598999990014',
      contactDisplayName: 'Cliente Cidade Sem Aviso',
      whatsappMessageId: 'wamid.CITY5',
      content: 'Oi',
    });

    expect(enqueueOutboundMessage).not.toHaveBeenCalled();
    expect(recordNoticeDelivery).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Rodar os testes pra confirmar que falham**

Run: `npm test -- inbound-message.service.test.js`
Expected: FAIL — os 5 novos testes falham (`enqueueOutboundMessage`/`recordNoticeDelivery`
não chamados como esperado, já que o código-fonte ainda não tem o passo novo). Confirmar
também que os testes pré-existentes do arquivo continuam passando (o novo mock default não
deve quebrar nada).

- [ ] **Step 3: Implementar**

Em `src/conversations/inbound-message.service.js`, adicionar o import no topo:

```javascript
const { findActiveCityNoticeByCityId, hasContactReceivedNotice, recordNoticeDelivery } = require('../city-notices/city-notice.repository');
```

Adicionar um novo passo logo APÓS o bloco `if (justCreated) {...} else if (...) {...}`
existente (que trata boas-vindas/triagem), e ANTES da linha
`const conversationWithContact = await getConversationWithContact(conversation.id);`:

```javascript
  try {
    const cityNotice = await findActiveCityNoticeByCityId(contact.cityId);
    if (cityNotice && !(await hasContactReceivedNotice(cityNotice.id, contact.id))) {
      await enqueueOutboundMessage({ conversationId: conversation.id, channelId, content: cityNotice.message });
      await recordNoticeDelivery(cityNotice.id, contact.id);
    }
  } catch (err) {
    console.error(`Failed to send city notice for conversation ${conversation.id}`, err);
  }
```

- [ ] **Step 4: Rodar os testes pra confirmar que passam**

Run: `npm test -- inbound-message.service.test.js`
Expected: PASS (todos os testes do arquivo, incluindo os 5 novos e todos os ~24 já
existentes sem modificação).

- [ ] **Step 5: Rodar a suíte completa do backend**

Run: `npm test`
Expected: PASS, sem regressão em nenhum arquivo.

- [ ] **Step 6: Commit**

```bash
git add src/conversations/inbound-message.service.js src/conversations/inbound-message.service.test.js
git commit -m "Send the city notice on every message from a contact whose city has one active"
```

---

### Task 4: Rotas admin `admin-city-notices.routes.js`

**Files:**
- Create: `src/api/admin-city-notices.routes.js`
- Modify: `src/server.js`
- Test: `src/api/admin-city-notices.routes.test.js`

**Interfaces:**
- Consumes: `listCities`, `findCityById` de `../cities/city.repository` (Tasks já
  existentes/Task 1); `listCityNoticesByCityIds`, `upsertCityNotice`, `deleteCityNotice` de
  `../city-notices/city-notice.repository` (Task 2).
- Produces: `GET /api/admin/cities/notices` → `[{id, name, notice: {message, enabled} | null}]`.
  `PATCH /api/admin/cities/:id/notice` corpo `{message, enabled}` → retorna o notice
  atualizado. `DELETE /api/admin/cities/:id/notice` → 204.

- [ ] **Step 1: Escrever os testes que falham**

Criar `src/api/admin-city-notices.routes.test.js`:

```javascript
jest.mock('../cities/city.repository');
jest.mock('../city-notices/city-notice.repository');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const { listCities, findCityById } = require('../cities/city.repository');
const { listCityNoticesByCityIds, upsertCityNotice, deleteCityNotice } = require('../city-notices/city-notice.repository');
const adminCityNoticesRoutes = require('./admin-city-notices.routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/cities', adminCityNoticesRoutes);
  return app;
}

function tokenFor(agentId, role) {
  return jwt.sign({ agentId, role }, process.env.JWT_SECRET);
}

describe('GET /api/admin/cities/notices', () => {
  beforeEach(() => jest.clearAllMocks());

  test('lists every city with its notice, or null when it has none', async () => {
    listCities.mockResolvedValue([
      { id: 'city-1', name: 'Maracaçumé' },
      { id: 'city-2', name: 'Bahia' },
    ]);
    listCityNoticesByCityIds.mockResolvedValue([
      { id: 'notice-1', cityId: 'city-1', message: 'Instabilidade', enabled: true },
    ]);

    const res = await request(buildApp())
      .get('/api/admin/cities/notices')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);

    expect(res.status).toBe(200);
    expect(listCityNoticesByCityIds).toHaveBeenCalledWith(['city-1', 'city-2']);
    expect(res.body).toEqual([
      { id: 'city-1', name: 'Maracaçumé', notice: { message: 'Instabilidade', enabled: true } },
      { id: 'city-2', name: 'Bahia', notice: null },
    ]);
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .get('/api/admin/cities/notices')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);

    expect(res.status).toBe(403);
    expect(listCities).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/admin/cities/:id/notice', () => {
  beforeEach(() => jest.clearAllMocks());

  test('creates or updates the notice for the city, trimming the message', async () => {
    findCityById.mockResolvedValue({ id: 'city-1', name: 'Maracaçumé' });
    upsertCityNotice.mockResolvedValue({ id: 'notice-1', cityId: 'city-1', message: 'Instabilidade', enabled: true, activatedAt: new Date() });

    const res = await request(buildApp())
      .patch('/api/admin/cities/city-1/notice')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ message: '  Instabilidade  ', enabled: true });

    expect(res.status).toBe(200);
    expect(upsertCityNotice).toHaveBeenCalledWith('city-1', { message: 'Instabilidade', enabled: true });
  });

  test('returns 400 when message is missing', async () => {
    const res = await request(buildApp())
      .patch('/api/admin/cities/city-1/notice')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ enabled: true });

    expect(res.status).toBe(400);
    expect(upsertCityNotice).not.toHaveBeenCalled();
  });

  test('returns 400 when message is only whitespace', async () => {
    const res = await request(buildApp())
      .patch('/api/admin/cities/city-1/notice')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ message: '   ', enabled: true });

    expect(res.status).toBe(400);
    expect(upsertCityNotice).not.toHaveBeenCalled();
  });

  test('returns 400 when message is longer than 4096 characters', async () => {
    const res = await request(buildApp())
      .patch('/api/admin/cities/city-1/notice')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ message: 'a'.repeat(4097), enabled: true });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('message must be 4096 characters or fewer');
    expect(upsertCityNotice).not.toHaveBeenCalled();
  });

  test('returns 400 when enabled is not a boolean', async () => {
    const res = await request(buildApp())
      .patch('/api/admin/cities/city-1/notice')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ message: 'Instabilidade', enabled: 'yes' });

    expect(res.status).toBe(400);
    expect(upsertCityNotice).not.toHaveBeenCalled();
  });

  test('returns 404 when the city does not exist', async () => {
    findCityById.mockResolvedValue(null);

    const res = await request(buildApp())
      .patch('/api/admin/cities/does-not-exist/notice')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ message: 'Instabilidade', enabled: true });

    expect(res.status).toBe(404);
    expect(upsertCityNotice).not.toHaveBeenCalled();
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .patch('/api/admin/cities/city-1/notice')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ message: 'Instabilidade', enabled: true });

    expect(res.status).toBe(403);
    expect(upsertCityNotice).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/admin/cities/:id/notice', () => {
  beforeEach(() => jest.clearAllMocks());

  test('deletes the notice for the city', async () => {
    deleteCityNotice.mockResolvedValue(true);

    const res = await request(buildApp())
      .delete('/api/admin/cities/city-1/notice')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);

    expect(res.status).toBe(204);
    expect(deleteCityNotice).toHaveBeenCalledWith('city-1');
  });

  test('returns 404 when the city has no notice', async () => {
    deleteCityNotice.mockResolvedValue(false);

    const res = await request(buildApp())
      .delete('/api/admin/cities/city-1/notice')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);

    expect(res.status).toBe(404);
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .delete('/api/admin/cities/city-1/notice')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);

    expect(res.status).toBe(403);
    expect(deleteCityNotice).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar os testes pra confirmar que falham**

Run: `npm test -- admin-city-notices.routes.test.js`
Expected: FAIL — `Cannot find module './admin-city-notices.routes'`.

- [ ] **Step 3: Implementar as rotas**

Criar `src/api/admin-city-notices.routes.js`:

```javascript
const express = require('express');
const { requireAuth, requireRole } = require('../auth/auth.middleware');
const { listCities, findCityById } = require('../cities/city.repository');
const { listCityNoticesByCityIds, upsertCityNotice, deleteCityNotice } = require('../city-notices/city-notice.repository');

const router = express.Router();

router.get('/notices', requireAuth, requireRole('admin'), async (req, res) => {
  const cities = await listCities();
  const notices = await listCityNoticesByCityIds(cities.map((city) => city.id));
  const noticeByCityId = new Map(notices.map((notice) => [notice.cityId, notice]));
  res.json(
    cities.map((city) => {
      const notice = noticeByCityId.get(city.id);
      return {
        id: city.id,
        name: city.name,
        notice: notice ? { message: notice.message, enabled: notice.enabled } : null,
      };
    })
  );
});

router.patch('/:id/notice', requireAuth, requireRole('admin'), async (req, res) => {
  const { message, enabled } = req.body || {};
  if (typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'message is required' });
  }
  if (message.trim().length > 4096) {
    return res.status(400).json({ error: 'message must be 4096 characters or fewer' });
  }
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled must be a boolean' });
  }
  const city = await findCityById(req.params.id);
  if (!city) {
    return res.status(404).json({ error: 'City not found' });
  }
  const notice = await upsertCityNotice(req.params.id, { message: message.trim(), enabled });
  res.json(notice);
});

router.delete('/:id/notice', requireAuth, requireRole('admin'), async (req, res) => {
  const deleted = await deleteCityNotice(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: 'Notice not found' });
  }
  res.status(204).send();
});

module.exports = router;
```

Em `src/server.js`, adicionar o import junto aos outros requires de rotas admin (perto de
`const adminCitiesRoutes = require('./api/admin-cities.routes');`):

```javascript
const adminCityNoticesRoutes = require('./api/admin-city-notices.routes');
```

E montar junto aos outros `app.use`, logo após a linha
`app.use('/api/admin/cities', adminCitiesRoutes);`:

```javascript
app.use('/api/admin/cities', adminCityNoticesRoutes);
```

(Dois routers montados no mesmo prefixo — Express tenta cada um em ordem até um bater a
rota; `admin-cities.routes.js` só define `POST /` e `DELETE /:id`, que não colidem com
`GET /notices`, `PATCH /:id/notice` e `DELETE /:id/notice`.)

- [ ] **Step 4: Rodar os testes pra confirmar que passam**

Run: `npm test -- admin-city-notices.routes.test.js`
Expected: PASS (todos os 10 testes).

- [ ] **Step 5: Rodar a suíte completa do backend**

Run: `npm test`
Expected: PASS, sem regressão (confirmar em particular que `admin-cities.routes.test.js`
continua passando sem alteração).

- [ ] **Step 6: Commit**

```bash
git add src/api/admin-city-notices.routes.js src/server.js src/api/admin-city-notices.routes.test.js
git commit -m "Add admin routes to list, set and delete a city's notice"
```

---

### Task 5: Cliente de API e hook do frontend

**Files:**
- Modify: `frontend/src/services/api.js`
- Create: `frontend/src/hooks/useCityNotices.js`
- Test: `frontend/src/hooks/useCityNotices.test.jsx`

**Interfaces:**
- Produces: `listCityNotices(token)`, `setCityNotice(cityId, message, enabled, token)`,
  `deleteCityNotice(cityId, token)` em `services/api.js`. `useCityNotices()` retorna
  `{cityNotices, loading, refresh}`, onde cada item de `cityNotices` é
  `{id, name, notice: {message, enabled} | null}`.

- [ ] **Step 1: Adicionar as funções em `services/api.js`**

Em `frontend/src/services/api.js`, adicionar logo após `deleteCity`:

```javascript
export function listCityNotices(token) {
  return apiFetch('/api/admin/cities/notices', { token });
}

export function setCityNotice(cityId, message, enabled, token) {
  return apiFetch(`/api/admin/cities/${cityId}/notice`, { method: 'PATCH', body: { message, enabled }, token });
}

export function deleteCityNotice(cityId, token) {
  return apiFetch(`/api/admin/cities/${cityId}/notice`, { method: 'DELETE', token });
}
```

Não há teste dedicado para `services/api.js` neste projeto (confirmado: `setChannelWelcomeMessage`
e as outras funções de cidade também não têm) — é exercitado indiretamente pelos testes do
hook (Step 2) e do componente (Task 6).

- [ ] **Step 2: Escrever o teste que falha para o hook**

Criar `frontend/src/hooks/useCityNotices.test.jsx`:

```jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useCityNotices } from './useCityNotices';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
});

describe('useCityNotices', () => {
  test('fetches city notices on mount', async () => {
    api.listCityNotices.mockResolvedValue([{ id: 'city-1', name: 'Maracaçumé', notice: null }]);

    const { result } = renderHook(() => useCityNotices());

    await waitFor(() => expect(result.current.cityNotices).toEqual([{ id: 'city-1', name: 'Maracaçumé', notice: null }]));
    expect(api.listCityNotices).toHaveBeenCalledWith('tok-123');
  });

  test('refresh refetches the list', async () => {
    api.listCityNotices.mockResolvedValue([]);
    const { result } = renderHook(() => useCityNotices());
    await waitFor(() => expect(api.listCityNotices).toHaveBeenCalledTimes(1));

    api.listCityNotices.mockResolvedValue([{ id: 'city-2', name: 'Nova', notice: null }]);
    await act(() => result.current.refresh());

    expect(result.current.cityNotices).toEqual([{ id: 'city-2', name: 'Nova', notice: null }]);
  });
});
```

- [ ] **Step 3: Rodar o teste pra confirmar que falha**

Run: `cd frontend && npx vitest run useCityNotices`
Expected: FAIL — `Failed to resolve import './useCityNotices'`.

- [ ] **Step 4: Implementar o hook**

Criar `frontend/src/hooks/useCityNotices.js`:

```javascript
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { listCityNotices } from '../services/api';

export function useCityNotices() {
  const { token } = useAuth();
  const [cityNotices, setCityNotices] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    if (!token) return Promise.resolve();
    setLoading(true);
    return listCityNotices(token)
      .then((data) => {
        setCityNotices(data);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, [token]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { cityNotices, loading, refresh };
}
```

- [ ] **Step 5: Rodar o teste pra confirmar que passa**

Run: `cd frontend && npx vitest run useCityNotices`
Expected: PASS (os 2 testes).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/services/api.js frontend/src/hooks/useCityNotices.js frontend/src/hooks/useCityNotices.test.jsx
git commit -m "Add the city-notice API client functions and the useCityNotices hook"
```

---

### Task 6: Seção "Avisos por cidade" em `MessagesAdminTab`

**Files:**
- Modify: `frontend/src/components/MessagesAdminTab.jsx`
- Test: `frontend/src/components/MessagesAdminTab.test.jsx`

**Interfaces:**
- Consumes: `useCityNotices()` (Task 5) retornando `{cityNotices, loading, refresh}`;
  `setCityNotice(cityId, message, enabled, token)`, `deleteCityNotice(cityId, token)`
  (Task 5).

- [ ] **Step 1: Escrever os testes que falham**

Em `frontend/src/components/MessagesAdminTab.test.jsx`, adicionar o mock e o import no topo:

```jsx
import { useCityNotices } from '../hooks/useCityNotices';
```

```jsx
vi.mock('../hooks/useCityNotices');
```

Adicionar ao `beforeEach` já existente (junto ao `useChannels.mockReturnValue(...)`):

```jsx
  useCityNotices.mockReturnValue({ cityNotices: [], loading: false, refresh: vi.fn() });
```

Adicionar estes testes, dentro do `describe('MessagesAdminTab', ...)`, em qualquer posição
depois dos testes de boas-vindas já existentes:

```jsx
  test('shows a help box explaining what city notices are, with an example', () => {
    useCityNotices.mockReturnValue({ cityNotices: [], loading: false, refresh: vi.fn() });
    render(<MessagesAdminTab />);

    expect(screen.getByText(/nesse momento nossa rede está passando/i)).toBeInTheDocument();
  });

  test('a city without a notice shows a create button, not an open textarea', () => {
    useCityNotices.mockReturnValue({
      cityNotices: [{ id: 'city-1', name: 'Maracaçumé', notice: null }],
      loading: false,
      refresh: vi.fn(),
    });
    render(<MessagesAdminTab />);

    expect(screen.getByText('Maracaçumé')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /criar aviso/i })).toBeInTheDocument();
    const cityRow = screen.getByText('Maracaçumé').closest('.rounded-2xl');
    expect(within(cityRow).queryByRole('textbox')).not.toBeInTheDocument();
  });

  test('a city with a notice shows a closed row with status, preview, and edit/delete buttons', () => {
    useCityNotices.mockReturnValue({
      cityNotices: [{ id: 'city-1', name: 'Maracaçumé', notice: { message: 'Instabilidade na rede', enabled: true } }],
      loading: false,
      refresh: vi.fn(),
    });
    render(<MessagesAdminTab />);

    expect(screen.getByText('Maracaçumé')).toBeInTheDocument();
    expect(screen.getByText('Instabilidade na rede')).toBeInTheDocument();
    expect(screen.getByText('Ativo')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^editar$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^excluir$/i })).toBeInTheDocument();
    const cityRow = screen.getByText('Maracaçumé').closest('.rounded-2xl');
    expect(within(cityRow).queryByRole('textbox')).not.toBeInTheDocument();
  });

  test('a disabled notice shows the Inativo status instead of Ativo', () => {
    useCityNotices.mockReturnValue({
      cityNotices: [{ id: 'city-1', name: 'Maracaçumé', notice: { message: 'Instabilidade na rede', enabled: false } }],
      loading: false,
      refresh: vi.fn(),
    });
    render(<MessagesAdminTab />);

    expect(screen.getByText('Inativo')).toBeInTheDocument();
    expect(screen.queryByText('Ativo')).not.toBeInTheDocument();
  });

  test('creating a city notice opens the form, saves with the Ativo checkbox, and refreshes the list', async () => {
    const refresh = vi.fn();
    useCityNotices.mockReturnValue({
      cityNotices: [{ id: 'city-1', name: 'Maracaçumé', notice: null }],
      loading: false,
      refresh,
    });
    api.setCityNotice.mockResolvedValue({ id: 'notice-1', cityId: 'city-1', message: 'Instabilidade', enabled: true });
    render(<MessagesAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /criar aviso/i }));
    const textareas = screen.getAllByRole('textbox');
    const noticeTextarea = textareas.find((ta) => ta.tagName === 'TEXTAREA' && !ta.id);
    await userEvent.type(noticeTextarea, 'Instabilidade');
    await userEvent.click(screen.getByRole('checkbox', { name: /ativo/i }));
    await userEvent.click(screen.getByRole('button', { name: /^salvar$/i }));

    await waitFor(() => expect(api.setCityNotice).toHaveBeenCalledWith('city-1', 'Instabilidade', true, 'tok-123'));
    expect(refresh).toHaveBeenCalled();
  });

  test('editing an existing city notice pre-fills the text and the Ativo checkbox', async () => {
    useCityNotices.mockReturnValue({
      cityNotices: [{ id: 'city-1', name: 'Maracaçumé', notice: { message: 'Texto atual', enabled: true } }],
      loading: false,
      refresh: vi.fn(),
    });
    render(<MessagesAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /^editar$/i }));

    expect(screen.getByDisplayValue('Texto atual')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /ativo/i })).toBeChecked();
  });

  test('canceling a city-notice edit discards unsaved changes and shows the closed row again', async () => {
    useCityNotices.mockReturnValue({
      cityNotices: [{ id: 'city-1', name: 'Maracaçumé', notice: { message: 'Texto atual', enabled: true } }],
      loading: false,
      refresh: vi.fn(),
    });
    render(<MessagesAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /^editar$/i }));
    const textarea = screen.getByDisplayValue('Texto atual');
    await userEvent.clear(textarea);
    await userEvent.type(textarea, 'Rascunho abandonado');
    await userEvent.click(screen.getByRole('button', { name: /cancelar/i }));

    expect(screen.getByText('Texto atual')).toBeInTheDocument();
    expect(screen.queryByText('Rascunho abandonado')).not.toBeInTheDocument();
  });

  test('deleting a city notice asks for confirmation, then removes it and refreshes', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const refresh = vi.fn();
    useCityNotices.mockReturnValue({
      cityNotices: [{ id: 'city-1', name: 'Maracaçumé', notice: { message: 'Texto atual', enabled: true } }],
      loading: false,
      refresh,
    });
    api.deleteCityNotice.mockResolvedValue(undefined);
    render(<MessagesAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /^excluir$/i }));

    await waitFor(() => expect(api.deleteCityNotice).toHaveBeenCalledWith('city-1', 'tok-123'));
    expect(refresh).toHaveBeenCalled();
  });

  test('does not delete a city notice when the confirmation is declined', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    useCityNotices.mockReturnValue({
      cityNotices: [{ id: 'city-1', name: 'Maracaçumé', notice: { message: 'Texto atual', enabled: true } }],
      loading: false,
      refresh: vi.fn(),
    });
    render(<MessagesAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /^excluir$/i }));

    expect(api.deleteCityNotice).not.toHaveBeenCalled();
  });

  test('shows an error message when saving a city notice fails', async () => {
    useCityNotices.mockReturnValue({
      cityNotices: [{ id: 'city-1', name: 'Maracaçumé', notice: null }],
      loading: false,
      refresh: vi.fn(),
    });
    api.setCityNotice.mockRejectedValue({ body: { error: 'Falha ao salvar aviso' } });
    render(<MessagesAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /criar aviso/i }));
    const textareas = screen.getAllByRole('textbox');
    const noticeTextarea = textareas.find((ta) => ta.tagName === 'TEXTAREA' && !ta.id);
    await userEvent.type(noticeTextarea, 'Instabilidade');
    await userEvent.click(screen.getByRole('button', { name: /^salvar$/i }));

    expect(await screen.findByText('Falha ao salvar aviso')).toBeInTheDocument();
  });

  test('shows an error message when deleting a city notice fails', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    useCityNotices.mockReturnValue({
      cityNotices: [{ id: 'city-1', name: 'Maracaçumé', notice: { message: 'Texto atual', enabled: true } }],
      loading: false,
      refresh: vi.fn(),
    });
    api.deleteCityNotice.mockRejectedValue({ body: { error: 'Falha ao excluir aviso' } });
    render(<MessagesAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /^excluir$/i }));

    expect(await screen.findByText('Falha ao excluir aviso')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Rodar os testes pra confirmar que falham**

Run: `cd frontend && npx vitest run MessagesAdminTab`
Expected: FAIL — os novos testes de cidade falham (elemento/texto não encontrado). Confirmar
que todos os testes pré-existentes do arquivo (boas-vindas e respostas rápidas) continuam
passando.

- [ ] **Step 3: Implementar**

Em `frontend/src/components/MessagesAdminTab.jsx`, atualizar os imports do topo:

```jsx
import { useCityNotices } from '../hooks/useCityNotices';
```

```jsx
import { updateQuickReply, deleteQuickReply, setChannelWelcomeMessage, setCityNotice, deleteCityNotice } from '../services/api';
```

Adicionar um novo componente, em qualquer lugar acima de `MessagesAdminTab` (por exemplo,
logo após `ChannelWelcomeMessageRow`):

```jsx
function CityStatusDot({ enabled }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-950/60">
      <span className={`h-2 w-2 rounded-full ${enabled ? 'bg-teal-signal' : 'bg-ink-950/25'}`} aria-hidden="true" />
      {enabled ? 'Ativo' : 'Inativo'}
    </span>
  );
}

function CityNoticeRow({ city, onSaved }) {
  const { token } = useAuth();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState((city.notice && city.notice.message) || '');
  const [enabled, setEnabled] = useState(Boolean(city.notice && city.notice.enabled));
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const [deleting, setDeleting] = useState(false);

  function handleEditClick() {
    setText((city.notice && city.notice.message) || '');
    setEnabled(Boolean(city.notice && city.notice.enabled));
    setError(null);
    setEditing(true);
  }

  function handleCancel() {
    setText((city.notice && city.notice.message) || '');
    setEnabled(Boolean(city.notice && city.notice.enabled));
    setError(null);
    setEditing(false);
  }

  async function handleSave(event) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await setCityNotice(city.id, text, enabled, token);
      setEditing(false);
      onSaved();
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao salvar');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Remover o aviso da cidade "${city.name}"?`)) {
      return;
    }
    setDeleteError(null);
    setDeleting(true);
    try {
      await deleteCityNotice(city.id, token);
      onSaved();
    } catch (err) {
      setDeleteError((err.body && err.body.error) || 'Falha ao excluir');
      setDeleting(false);
    }
  }

  if (editing) {
    return (
      <form
        onSubmit={handleSave}
        className="space-y-2 rounded-2xl border border-white/70 bg-white/50 p-4 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)] backdrop-blur-xl"
      >
        <p className="font-medium text-ink-950">{city.name}</p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="w-full rounded-xl border border-ink-950/15 bg-white/60 px-3.5 py-2.5 text-ink-950 placeholder-ink-950/35 outline-none transition focus:border-teal-signal/60 focus:bg-white/90 focus:ring-2 focus:ring-teal-signal/25"
          required
        />
        <label className="flex items-center gap-2 text-sm text-ink-950/70">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-4 w-4 accent-teal-signal"
          />
          Ativo
        </label>
        {error && <p className="rounded-lg border border-red-300 bg-red-50/80 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-teal-signal px-3 py-1.5 text-sm font-medium text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Salvar
          </button>
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-lg border border-ink-950/15 bg-white/50 px-3 py-1.5 text-sm font-medium text-ink-950/70 transition hover:bg-white/80 hover:text-ink-950"
          >
            Cancelar
          </button>
        </div>
      </form>
    );
  }

  if (!city.notice) {
    return (
      <div className="flex items-center justify-between rounded-2xl border border-white/70 bg-white/50 p-4 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)] backdrop-blur-xl">
        <p className="font-medium text-ink-950">{city.name}</p>
        <button onClick={handleEditClick} className="text-sm font-medium text-teal-signal hover:text-teal-signal/80 hover:underline">
          Criar aviso
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/70 bg-white/50 p-4 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)] backdrop-blur-xl">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-medium text-ink-950">{city.name}</p>
          <p className="text-sm text-ink-950/55">{city.notice.message}</p>
        </div>
        <div className="flex items-center gap-3">
          <CityStatusDot enabled={city.notice.enabled} />
          <button onClick={handleEditClick} className="text-sm font-medium text-teal-signal hover:text-teal-signal/80 hover:underline">
            Editar
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="text-sm font-medium text-red-600 hover:text-red-700 hover:underline disabled:opacity-50"
          >
            Excluir
          </button>
        </div>
      </div>
      {deleteError && (
        <p className="mt-2 rounded-lg border border-red-300 bg-red-50/80 px-3 py-2 text-sm text-red-700">{deleteError}</p>
      )}
    </div>
  );
}
```

Dentro da função `MessagesAdminTab`, adicionar o hook:

```jsx
  const { cityNotices, refresh: refreshCityNotices } = useCityNotices();
```

E inserir a nova seção entre a seção "Boas-vindas por canal" e a seção "Respostas rápidas"
(o `<div className="space-y-8">` já existente ganha um terceiro filho `<div className="space-y-3">`):

```jsx
      <div className="space-y-3">
        <h2 className="font-display text-lg font-semibold text-ink-950">Avisos por cidade</h2>
        <div className="rounded-xl border border-teal-signal/25 bg-teal-signal/10 px-4 py-3 text-sm text-ink-950/70">
          <p className="font-medium text-ink-950">O que é isso?</p>
          <p className="mt-1">
            Enviado automaticamente para clientes daquela cidade quando entram em contato, além
            da boas-vindas normal — use para avisos de instabilidade ou manutenção pontual.
          </p>
          <p className="mt-2 italic">
            Exemplo: "Nesse momento nossa rede está passando por uma instabilidade na sua
            região. Nossa equipe já está trabalhando na correção."
          </p>
        </div>
        {cityNotices.map((city) => (
          <CityNoticeRow key={city.id} city={city} onSaved={refreshCityNotices} />
        ))}
      </div>
```

- [ ] **Step 4: Rodar os testes pra confirmar que passam**

Run: `cd frontend && npx vitest run MessagesAdminTab`
Expected: PASS (todos os testes do arquivo — boas-vindas, respostas rápidas, e os novos de
cidade).

- [ ] **Step 5: Rodar a suíte completa do frontend**

Run: `cd frontend && npx vitest run`
Expected: PASS, sem regressão em nenhum arquivo.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/MessagesAdminTab.jsx frontend/src/components/MessagesAdminTab.test.jsx
git commit -m "Add the Avisos por cidade section to the Mensagens admin tab"
```

---

## Verificação final

Depois da Task 6, rodar as duas suítes completas antes de considerar a feature pronta:

```bash
npm test
cd frontend && npx vitest run
```

Expected: todos os testes do backend e frontend passam, nenhuma falha introduzida em
arquivos que este plano não tocou. **A migração precisa rodar ANTES do deploy, seguindo a
mesma lição da feature de boas-vindas por canal** (`docs/superpowers/specs/2026-09-09-channel-welcome-message-design.md`
e a memória de projeto salva sobre ela): aplicar
`CREATE TABLE city_notices ...`/`CREATE TABLE city_notice_deliveries ...` no console do banco
antes do push que aciona o deploy, ou rodar `npm run migrate -- up` via Render Pre-Deploy
Command se o projeto suportar — nunca depender só de "rodar a migração depois do deploy",
porque `admin-city-notices.routes.js` e o novo passo em `ingestInboundMessage` dependem das
tabelas existirem desde o primeiro request.
