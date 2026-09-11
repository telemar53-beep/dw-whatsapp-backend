# Disparo em massa / campanha Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que qualquer atendente crie uma "campanha" — a mesma mensagem (texto
livre ou template aprovado) enviada a uma lista de números colada — com envio pausado
por uma fila própria e acompanhamento de progresso.

**Architecture:** Duas tabelas novas (`campaigns`, `campaign_recipients`). Uma fila Bull
nova (`campaign-messages`) com `limiter` nativo para o ritmo de envio, processada por um
worker que, por destinatário, resolve o contato/conversa e delega o envio de fato ao
`enqueueOutboundMessage` já existente (mesmo pipeline de toda mensagem de saída do
sistema). Template é validado e resolvido **uma única vez**, na criação da campanha
(não por destinatário) — mesma validação que `POST /api/conversations/start` já faz
hoje. Nenhuma conversa criada por uma campanha é atribuída automaticamente — todas
nascem `'waiting'`, caem na fila compartilhada normal quando o cliente responde.

**Tech Stack:** Node.js/Express, PostgreSQL (node-pg-migrate), Bull/Redis (fila já
usada pelo projeto), React, Vitest + Testing Library (frontend), Jest + supertest
(backend).

**Spec:** `docs/superpowers/specs/2026-09-11-bulk-campaign-design.md`

## Global Constraints

- Lista de destinatários é colada em texto, uma linha por destinatário:
  `telefone` ou `telefone,nome` (nome opcional).
- Canais permitidos: Baileys (texto livre) e canais oficiais (Meta Cloud/360dialog,
  exige template aprovado) — mesma validação de canal/template que
  `POST /api/conversations/start` já faz (`src/api/conversations.routes.js:65-140`).
- Mesma mensagem/template para todos os destinatários da campanha — sem personalização
  por linha nesta versão.
- Qualquer atendente autenticado pode criar/disparar uma campanha (sem exigir admin).
- Conversa criada por uma campanha **nunca** é atribuída automaticamente e **nunca**
  recebe a mensagem de abertura/protocolo (`sendOpeningMessageIfApplicable`) —
  nasce com `status = 'waiting'`, cai na fila compartilhada como qualquer conversa
  recebida.
- Se o destinatário já tem uma conversa aberta (qualquer status não-`'closed'`,
  inclusive `'silent'`) no mesmo canal, marca `skipped` e não manda a mensagem de
  campanha ali.
- Ritmo de envio: no máximo 20 mensagens por minuto por campanha (mesmo teto para
  Baileys e canal oficial nesta versão) — via `limiter: { max: 20, duration: 60000 }`
  do Bull, não cálculo manual de atraso.
- `campaigns.content` sempre guarda o texto final (livre ou já substituído a partir do
  template) — só para registro local; `template_name`/`template_language`/
  `template_variables` guardam o que a API do WhatsApp precisa para reenviar o
  template de fato a cada destinatário.
- A tabela de templates do projeto se chama `message_templates` (não `templates`) —
  confirme em `src/templates/template.repository.js` antes de referenciar em SQL.
- Todo commit git termina com o trailer `Co-Authored-By: Claude Sonnet 5
  <noreply@anthropic.com>` — repita isto literalmente em todo dispatch de implementador.

---

### Task 1: Migração + `campaign.repository.js`

**Files:**
- Create: `migrations/1788910000000_create-campaigns-tables.js`
- Create: `src/campaigns/campaign.repository.js`
- Test: `src/campaigns/campaign.repository.test.js`

**Interfaces:**
- Produces: `createCampaign({name, channelId, messageType, content, templateName,
  templateLanguage, templateVariables, createdBy, totalRecipients})` → campanha criada;
  `findCampaignById(id)` → campanha ou `null`; `listCampaigns()` → array de campanhas,
  mais recente primeiro; `createCampaignRecipients(campaignId, recipients)` → array de
  destinatários criados (`recipients` é um array de `{rawPhoneNumber, phoneNumber,
  displayName, status, errorMessage}`, `status`/`errorMessage` opcionais, default
  `status: 'pending'`); `listCampaignRecipients(campaignId)` → array de destinatários,
  criado-em ascendente; `updateCampaignRecipientStatus(id, {status, errorMessage,
  contactId, conversationId})` → destinatário atualizado ou `null`;
  `incrementCampaignCounter(campaignId, outcome, amount = 1)` (`outcome` é `'sent'`,
  `'failed'` ou `'skipped'`) → `void`. Consumido pela Task 2 (processor) e Task 3
  (rotas).

- [ ] **Step 1: Escrever a migração**

```js
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT,
      channel_id UUID NOT NULL REFERENCES channels(id),
      message_type TEXT NOT NULL CHECK (message_type IN ('text', 'template')),
      content TEXT NOT NULL,
      template_name TEXT,
      template_language TEXT,
      template_variables JSONB,
      created_by UUID NOT NULL REFERENCES agents(id),
      total_recipients INT NOT NULL DEFAULT 0,
      sent_count INT NOT NULL DEFAULT 0,
      failed_count INT NOT NULL DEFAULT 0,
      skipped_count INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS campaign_recipients (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      raw_phone_number TEXT NOT NULL,
      phone_number TEXT NOT NULL,
      display_name TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
      error_message TEXT,
      contact_id UUID REFERENCES contacts(id),
      conversation_id UUID REFERENCES conversations(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      processed_at TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS campaign_recipients_campaign_id_idx ON campaign_recipients(campaign_id);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS campaign_recipients;
    DROP TABLE IF EXISTS campaigns;
  `);
};
```

- [ ] **Step 2: Rodar a migração no banco de dev local**

Run: `npm run migrate up`
Expected: relata sucesso, as duas tabelas existem.

- [ ] **Step 3: Escrever os testes que falham**

```js
const { getPool, closePool } = require('../db/pool');
const {
  createCampaign,
  findCampaignById,
  listCampaigns,
  createCampaignRecipients,
  listCampaignRecipients,
  updateCampaignRecipientStatus,
  incrementCampaignCounter,
} = require('./campaign.repository');
const { createAgent } = require('../agents/agent.repository');
const { createChannel } = require('../channels/channel.repository');

async function makeAgent() {
  return createAgent({ name: 'Ana', email: `ana-${Date.now()}-${Math.random()}@dw.com`, password: 'secret123', role: 'agent' });
}

async function makeChannel() {
  return createChannel({
    type: 'baileys',
    name: `Canal ${Date.now()}-${Math.random()}`,
    phoneNumber: `+551199990000${Math.floor(Math.random() * 1000)}`,
    config: {},
  });
}

describe('campaign repository', () => {
  beforeEach(async () => {
    await getPool().query('TRUNCATE campaign_recipients, campaigns, agents, channels CASCADE');
  });

  afterAll(async () => {
    await closePool();
  });

  test('createCampaign stores and returns a text campaign', async () => {
    const agent = await makeAgent();
    const channel = await makeChannel();

    const campaign = await createCampaign({
      name: 'Aviso',
      channelId: channel.id,
      messageType: 'text',
      content: 'Ola clientes',
      createdBy: agent.id,
      totalRecipients: 3,
    });

    expect(campaign.id).toBeDefined();
    expect(campaign.name).toBe('Aviso');
    expect(campaign.messageType).toBe('text');
    expect(campaign.content).toBe('Ola clientes');
    expect(campaign.templateName).toBeNull();
    expect(campaign.totalRecipients).toBe(3);
    expect(campaign.sentCount).toBe(0);
    expect(campaign.failedCount).toBe(0);
    expect(campaign.skippedCount).toBe(0);
  });

  test('createCampaign stores template fields for a template campaign', async () => {
    const agent = await makeAgent();
    const channel = await makeChannel();

    const campaign = await createCampaign({
      channelId: channel.id,
      messageType: 'template',
      content: 'Ola Joao, sua fatura vence em 10/09',
      templateName: 'fatura_vencendo',
      templateLanguage: 'pt_BR',
      templateVariables: ['Joao', '10/09'],
      createdBy: agent.id,
      totalRecipients: 1,
    });

    expect(campaign.templateName).toBe('fatura_vencendo');
    expect(campaign.templateLanguage).toBe('pt_BR');
    expect(campaign.templateVariables).toEqual(['Joao', '10/09']);
  });

  test('findCampaignById returns null when not found', async () => {
    const result = await findCampaignById('00000000-0000-0000-0000-000000000000');
    expect(result).toBeNull();
  });

  test('listCampaigns returns campaigns newest first', async () => {
    const agent = await makeAgent();
    const channel = await makeChannel();
    const first = await createCampaign({ channelId: channel.id, messageType: 'text', content: 'a', createdBy: agent.id, totalRecipients: 1 });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const second = await createCampaign({ channelId: channel.id, messageType: 'text', content: 'b', createdBy: agent.id, totalRecipients: 1 });

    const campaigns = await listCampaigns();

    expect(campaigns[0].id).toBe(second.id);
    expect(campaigns[1].id).toBe(first.id);
  });

  test('createCampaignRecipients inserts every recipient with the given status', async () => {
    const agent = await makeAgent();
    const channel = await makeChannel();
    const campaign = await createCampaign({ channelId: channel.id, messageType: 'text', content: 'a', createdBy: agent.id, totalRecipients: 2 });

    const recipients = await createCampaignRecipients(campaign.id, [
      { rawPhoneNumber: '5511999990000', phoneNumber: '5511999990000', displayName: 'Joao', status: 'pending' },
      { rawPhoneNumber: 'abc', phoneNumber: '', displayName: null, status: 'failed', errorMessage: 'Numero invalido' },
    ]);

    expect(recipients).toHaveLength(2);
    expect(recipients[0].status).toBe('pending');
    expect(recipients[0].displayName).toBe('Joao');
    expect(recipients[1].status).toBe('failed');
    expect(recipients[1].errorMessage).toBe('Numero invalido');

    const listed = await listCampaignRecipients(campaign.id);
    expect(listed).toHaveLength(2);
  });

  test('updateCampaignRecipientStatus updates status, error and links', async () => {
    const agent = await makeAgent();
    const channel = await makeChannel();
    const campaign = await createCampaign({ channelId: channel.id, messageType: 'text', content: 'a', createdBy: agent.id, totalRecipients: 1 });
    const [recipient] = await createCampaignRecipients(campaign.id, [
      { rawPhoneNumber: '5511999990000', phoneNumber: '5511999990000', displayName: null },
    ]);

    const updated = await updateCampaignRecipientStatus(recipient.id, {
      status: 'sent',
      contactId: '11111111-1111-1111-1111-111111111111',
      conversationId: '22222222-2222-2222-2222-222222222222',
    });

    expect(updated.status).toBe('sent');
    expect(updated.contactId).toBe('11111111-1111-1111-1111-111111111111');
    expect(updated.conversationId).toBe('22222222-2222-2222-2222-222222222222');
    expect(updated.processedAt).not.toBeNull();
  });

  test('incrementCampaignCounter increments the right counter', async () => {
    const agent = await makeAgent();
    const channel = await makeChannel();
    const campaign = await createCampaign({ channelId: channel.id, messageType: 'text', content: 'a', createdBy: agent.id, totalRecipients: 5 });

    await incrementCampaignCounter(campaign.id, 'sent');
    await incrementCampaignCounter(campaign.id, 'sent');
    await incrementCampaignCounter(campaign.id, 'failed', 3);

    const updated = await findCampaignById(campaign.id);
    expect(updated.sentCount).toBe(2);
    expect(updated.failedCount).toBe(3);
    expect(updated.skippedCount).toBe(0);
  });
});
```

- [ ] **Step 4: Rodar os testes para confirmar que falham**

Run: `npx jest src/campaigns/campaign.repository.test.js`
Expected: FAIL — `Cannot find module './campaign.repository'`.

- [ ] **Step 5: Implementar**

`src/campaigns/campaign.repository.js`:

```js
const { getPool } = require('../db/pool');

const COUNTER_COLUMNS = { sent: 'sent_count', failed: 'failed_count', skipped: 'skipped_count' };

function toCampaign(row) {
  return {
    id: row.id,
    name: row.name,
    channelId: row.channel_id,
    messageType: row.message_type,
    content: row.content,
    templateName: row.template_name,
    templateLanguage: row.template_language,
    templateVariables: row.template_variables,
    createdBy: row.created_by,
    totalRecipients: row.total_recipients,
    sentCount: row.sent_count,
    failedCount: row.failed_count,
    skippedCount: row.skipped_count,
    createdAt: row.created_at,
  };
}

function toRecipient(row) {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    rawPhoneNumber: row.raw_phone_number,
    phoneNumber: row.phone_number,
    displayName: row.display_name,
    status: row.status,
    errorMessage: row.error_message,
    contactId: row.contact_id,
    conversationId: row.conversation_id,
    createdAt: row.created_at,
    processedAt: row.processed_at,
  };
}

const CAMPAIGN_COLUMNS = `id, name, channel_id, message_type, content, template_name, template_language, template_variables, created_by, total_recipients, sent_count, failed_count, skipped_count, created_at`;
const RECIPIENT_COLUMNS = `id, campaign_id, raw_phone_number, phone_number, display_name, status, error_message, contact_id, conversation_id, created_at, processed_at`;

async function createCampaign({ name, channelId, messageType, content, templateName, templateLanguage, templateVariables, createdBy, totalRecipients }) {
  const result = await getPool().query(
    `INSERT INTO campaigns (name, channel_id, message_type, content, template_name, template_language, template_variables, created_by, total_recipients)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING ${CAMPAIGN_COLUMNS}`,
    [
      name || null,
      channelId,
      messageType,
      content,
      templateName || null,
      templateLanguage || null,
      templateVariables ? JSON.stringify(templateVariables) : null,
      createdBy,
      totalRecipients,
    ]
  );
  return toCampaign(result.rows[0]);
}

async function findCampaignById(id) {
  const result = await getPool().query(`SELECT ${CAMPAIGN_COLUMNS} FROM campaigns WHERE id = $1`, [id]);
  if (result.rowCount === 0) return null;
  return toCampaign(result.rows[0]);
}

async function listCampaigns() {
  const result = await getPool().query(`SELECT ${CAMPAIGN_COLUMNS} FROM campaigns ORDER BY created_at DESC`);
  return result.rows.map(toCampaign);
}

async function createCampaignRecipients(campaignId, recipients) {
  const values = [];
  const params = [];
  recipients.forEach((r, i) => {
    const base = i * 6;
    values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`);
    params.push(campaignId, r.rawPhoneNumber, r.phoneNumber, r.displayName || null, r.status || 'pending', r.errorMessage || null);
  });
  const result = await getPool().query(
    `INSERT INTO campaign_recipients (campaign_id, raw_phone_number, phone_number, display_name, status, error_message)
     VALUES ${values.join(', ')}
     RETURNING ${RECIPIENT_COLUMNS}`,
    params
  );
  return result.rows.map(toRecipient);
}

async function listCampaignRecipients(campaignId) {
  const result = await getPool().query(
    `SELECT ${RECIPIENT_COLUMNS} FROM campaign_recipients WHERE campaign_id = $1 ORDER BY created_at ASC`,
    [campaignId]
  );
  return result.rows.map(toRecipient);
}

async function updateCampaignRecipientStatus(id, { status, errorMessage, contactId, conversationId }) {
  const result = await getPool().query(
    `UPDATE campaign_recipients SET status = $2, error_message = $3, contact_id = $4, conversation_id = $5, processed_at = now()
     WHERE id = $1
     RETURNING ${RECIPIENT_COLUMNS}`,
    [id, status, errorMessage || null, contactId || null, conversationId || null]
  );
  if (result.rowCount === 0) return null;
  return toRecipient(result.rows[0]);
}

async function incrementCampaignCounter(campaignId, outcome, amount = 1) {
  const column = COUNTER_COLUMNS[outcome];
  await getPool().query(`UPDATE campaigns SET ${column} = ${column} + $2 WHERE id = $1`, [campaignId, amount]);
}

module.exports = {
  createCampaign,
  findCampaignById,
  listCampaigns,
  createCampaignRecipients,
  listCampaignRecipients,
  updateCampaignRecipientStatus,
  incrementCampaignCounter,
};
```

`COUNTER_COLUMNS` é uma tabela fixa no código (não vem de entrada externa) — a
interpolação de `column` no SQL do `incrementCampaignCounter` está limitada aos 3
valores desse objeto, nunca a texto arbitrário.

- [ ] **Step 6: Rodar os testes para confirmar que passam**

Run: `npx jest src/campaigns/campaign.repository.test.js`
Expected: PASS, todos verdes.

- [ ] **Step 7: Commit**

```bash
git add migrations/1788910000000_create-campaigns-tables.js src/campaigns/campaign.repository.js src/campaigns/campaign.repository.test.js
git commit -m "$(cat <<'EOF'
Add campaigns/campaign_recipients tables and their repository

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Fila de campanha + processador por destinatário

**Files:**
- Create: `src/queue/campaign-queue.js`
- Create: `src/queue/campaign-worker.js`
- Create: `src/campaigns/campaign-processor.js`
- Test: `src/campaigns/campaign-processor.test.js`

**Interfaces:**
- Consumes: `findChannelById` (`src/channels/channel.repository.js`, já existe);
  `findOrCreateContactByPhoneNumber`, `findOpenConversation`, `createConversation`
  (já existem); `enqueueOutboundMessage` (`src/queue/outbound-queue.js`, já existe);
  `baileysManager.resolveWhatsAppJid(channel, phoneNumber)` (já existe — **lança
  exceção** se não houver conexão Baileys ativa para o canal, e retorna `null` se o
  número não estiver no WhatsApp — os dois casos precisam de tratamento distinto);
  `updateCampaignRecipientStatus`, `incrementCampaignCounter` (Task 1).
- Produces: `enqueueCampaignRecipient({recipientId, campaignId, channelId,
  phoneNumber, displayName, content, templateName, templateLanguage,
  templateVariables})` (`campaign-queue.js`) — adiciona um job à fila;
  `startCampaignWorker()` (`campaign-worker.js`) — inicia o processamento; internamente
  chama `processCampaignRecipient(jobData)` (`campaign-processor.js`), exportado para
  ser testado isoladamente. Consumido pela Task 3 (rotas chamam
  `enqueueCampaignRecipient`) e pelo boot do servidor (Task 3 também, chama
  `startCampaignWorker()`).

- [ ] **Step 1: Implementar a fila (`campaign-queue.js`)**

```js
const Queue = require('bull');
const { loadConfig } = require('../config/env');

let queue;

function getCampaignQueue() {
  if (!queue) {
    const config = loadConfig();
    queue = new Queue('campaign-messages', config.redisUrl, {
      limiter: { max: 20, duration: 60000 },
    });
  }
  return queue;
}

function enqueueCampaignRecipient(data) {
  return getCampaignQueue().add(data, { attempts: 1 });
}

function processCampaignQueue(handler) {
  getCampaignQueue().process(async (job) => handler(job.data));
}

async function closeCampaignQueue() {
  if (queue) {
    await queue.close();
    queue = undefined;
  }
}

module.exports = { getCampaignQueue, enqueueCampaignRecipient, processCampaignQueue, closeCampaignQueue };
```

(`attempts: 1`, ao contrário do `outbound-queue.js`: uma falha de destinatário de
campanha é marcada `failed` direto, sem retry automático do Bull — evita reprocessar o
mesmo destinatário duas vezes de forma inconsistente com o contador já incrementado.)

- [ ] **Step 2: Escrever os testes que falham para o processador**

```js
jest.mock('../channels/channel.repository');
jest.mock('../conversations/contact.repository');
jest.mock('../conversations/conversation.repository');
jest.mock('../queue/outbound-queue');
jest.mock('../whatsapp-adapters/baileys.manager');
jest.mock('./campaign.repository');

const { findChannelById } = require('../channels/channel.repository');
const { findOrCreateContactByPhoneNumber } = require('../conversations/contact.repository');
const { findOpenConversation, createConversation } = require('../conversations/conversation.repository');
const { enqueueOutboundMessage } = require('../queue/outbound-queue');
const baileysManager = require('../whatsapp-adapters/baileys.manager');
const { updateCampaignRecipientStatus, incrementCampaignCounter } = require('./campaign.repository');
const { processCampaignRecipient } = require('./campaign-processor');

const BASE_JOB = {
  recipientId: 'recipient-1',
  campaignId: 'campaign-1',
  channelId: 'channel-1',
  phoneNumber: '5511999990000',
  displayName: 'Joao',
  content: 'Ola Joao',
  templateName: null,
  templateLanguage: null,
  templateVariables: null,
};

beforeEach(() => jest.clearAllMocks());

describe('processCampaignRecipient', () => {
  test('marks failed when the channel does not exist', async () => {
    findChannelById.mockResolvedValue(null);

    await processCampaignRecipient(BASE_JOB);

    expect(updateCampaignRecipientStatus).toHaveBeenCalledWith('recipient-1', expect.objectContaining({ status: 'failed', errorMessage: 'Canal não encontrado' }));
    expect(incrementCampaignCounter).toHaveBeenCalledWith('campaign-1', 'failed');
  });

  test('sends via a baileys channel and marks sent', async () => {
    findChannelById.mockResolvedValue({ id: 'channel-1', type: 'baileys' });
    baileysManager.resolveWhatsAppJid.mockResolvedValue('5511999990000');
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-1' });
    findOpenConversation.mockResolvedValue(null);
    createConversation.mockResolvedValue({ id: 'conversation-1' });
    enqueueOutboundMessage.mockResolvedValue({ id: 'message-1' });

    await processCampaignRecipient(BASE_JOB);

    expect(createConversation).toHaveBeenCalledWith('contact-1', 'channel-1');
    expect(enqueueOutboundMessage).toHaveBeenCalledWith({
      conversationId: 'conversation-1',
      channelId: 'channel-1',
      content: 'Ola Joao',
      templateName: undefined,
      templateLanguage: undefined,
      templateVariables: undefined,
    });
    expect(updateCampaignRecipientStatus).toHaveBeenCalledWith('recipient-1', expect.objectContaining({ status: 'sent', contactId: 'contact-1', conversationId: 'conversation-1' }));
    expect(incrementCampaignCounter).toHaveBeenCalledWith('campaign-1', 'sent');
  });

  test('marks failed when a baileys number is not on WhatsApp', async () => {
    findChannelById.mockResolvedValue({ id: 'channel-1', type: 'baileys' });
    baileysManager.resolveWhatsAppJid.mockResolvedValue(null);

    await processCampaignRecipient(BASE_JOB);

    expect(updateCampaignRecipientStatus).toHaveBeenCalledWith('recipient-1', expect.objectContaining({ status: 'failed', errorMessage: 'Número não está no WhatsApp' }));
    expect(incrementCampaignCounter).toHaveBeenCalledWith('campaign-1', 'failed');
    expect(createConversation).not.toHaveBeenCalled();
  });

  test('marks failed when the baileys channel has no active connection', async () => {
    findChannelById.mockResolvedValue({ id: 'channel-1', type: 'baileys' });
    baileysManager.resolveWhatsAppJid.mockRejectedValue(new Error('No active Baileys connection for channel channel-1'));

    await processCampaignRecipient(BASE_JOB);

    expect(updateCampaignRecipientStatus).toHaveBeenCalledWith('recipient-1', expect.objectContaining({ status: 'failed', errorMessage: 'No active Baileys connection for channel channel-1' }));
    expect(incrementCampaignCounter).toHaveBeenCalledWith('campaign-1', 'failed');
  });

  test('marks skipped when the contact already has an open conversation on the channel', async () => {
    findChannelById.mockResolvedValue({ id: 'channel-1', type: 'meta_cloud' });
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-1' });
    findOpenConversation.mockResolvedValue({ id: 'conversation-existing', status: 'assigned' });

    await processCampaignRecipient({ ...BASE_JOB, phoneNumber: '5511999990000' });

    expect(createConversation).not.toHaveBeenCalled();
    expect(enqueueOutboundMessage).not.toHaveBeenCalled();
    expect(updateCampaignRecipientStatus).toHaveBeenCalledWith('recipient-1', expect.objectContaining({ status: 'skipped', contactId: 'contact-1' }));
    expect(incrementCampaignCounter).toHaveBeenCalledWith('campaign-1', 'skipped');
  });

  test('sends a template message via an official channel', async () => {
    findChannelById.mockResolvedValue({ id: 'channel-1', type: 'meta_cloud' });
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-1' });
    findOpenConversation.mockResolvedValue(null);
    createConversation.mockResolvedValue({ id: 'conversation-1' });
    enqueueOutboundMessage.mockResolvedValue({ id: 'message-1' });

    await processCampaignRecipient({
      ...BASE_JOB,
      content: 'Ola Joao, sua fatura vence em 10/09',
      templateName: 'fatura_vencendo',
      templateLanguage: 'pt_BR',
      templateVariables: ['Joao', '10/09'],
    });

    expect(enqueueOutboundMessage).toHaveBeenCalledWith({
      conversationId: 'conversation-1',
      channelId: 'channel-1',
      content: 'Ola Joao, sua fatura vence em 10/09',
      templateName: 'fatura_vencendo',
      templateLanguage: 'pt_BR',
      templateVariables: ['Joao', '10/09'],
    });
  });

  test('marks failed when enqueueOutboundMessage throws', async () => {
    findChannelById.mockResolvedValue({ id: 'channel-1', type: 'meta_cloud' });
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-1' });
    findOpenConversation.mockResolvedValue(null);
    createConversation.mockResolvedValue({ id: 'conversation-1' });
    enqueueOutboundMessage.mockRejectedValue(new Error('boom'));

    await processCampaignRecipient(BASE_JOB);

    expect(updateCampaignRecipientStatus).toHaveBeenCalledWith('recipient-1', expect.objectContaining({ status: 'failed', errorMessage: 'boom', contactId: 'contact-1', conversationId: 'conversation-1' }));
    expect(incrementCampaignCounter).toHaveBeenCalledWith('campaign-1', 'failed');
  });
});
```

- [ ] **Step 3: Rodar os testes para confirmar que falham**

Run: `npx jest src/campaigns/campaign-processor.test.js`
Expected: FAIL — `Cannot find module './campaign-processor'`.

- [ ] **Step 4: Implementar `campaign-processor.js`**

```js
const { findChannelById } = require('../channels/channel.repository');
const { findOrCreateContactByPhoneNumber } = require('../conversations/contact.repository');
const { findOpenConversation, createConversation } = require('../conversations/conversation.repository');
const { enqueueOutboundMessage } = require('../queue/outbound-queue');
const baileysManager = require('../whatsapp-adapters/baileys.manager');
const { updateCampaignRecipientStatus, incrementCampaignCounter } = require('./campaign.repository');

async function markRecipient(recipientId, campaignId, outcome, extra = {}) {
  await updateCampaignRecipientStatus(recipientId, { status: outcome, ...extra });
  await incrementCampaignCounter(campaignId, outcome);
}

async function processCampaignRecipient({ recipientId, campaignId, channelId, phoneNumber, displayName, content, templateName, templateLanguage, templateVariables }) {
  const channel = await findChannelById(channelId);
  if (!channel) {
    return markRecipient(recipientId, campaignId, 'failed', { errorMessage: 'Canal não encontrado' });
  }

  let canonicalPhoneNumber = phoneNumber;
  if (channel.type === 'baileys') {
    try {
      canonicalPhoneNumber = await baileysManager.resolveWhatsAppJid(channel, phoneNumber);
    } catch (err) {
      return markRecipient(recipientId, campaignId, 'failed', { errorMessage: err.message });
    }
    if (!canonicalPhoneNumber) {
      return markRecipient(recipientId, campaignId, 'failed', { errorMessage: 'Número não está no WhatsApp' });
    }
  }

  const contact = await findOrCreateContactByPhoneNumber(canonicalPhoneNumber, displayName || null);

  const existing = await findOpenConversation(contact.id, channel.id);
  if (existing) {
    return markRecipient(recipientId, campaignId, 'skipped', { errorMessage: 'Já existe conversa em andamento', contactId: contact.id });
  }

  const conversation = await createConversation(contact.id, channel.id);

  try {
    await enqueueOutboundMessage({
      conversationId: conversation.id,
      channelId: channel.id,
      content,
      templateName: templateName || undefined,
      templateLanguage: templateLanguage || undefined,
      templateVariables: templateVariables || undefined,
    });
  } catch (err) {
    return markRecipient(recipientId, campaignId, 'failed', { errorMessage: err.message, contactId: contact.id, conversationId: conversation.id });
  }

  return markRecipient(recipientId, campaignId, 'sent', { contactId: contact.id, conversationId: conversation.id });
}

module.exports = { processCampaignRecipient };
```

`createConversation(contact.id, channel.id)` é chamado só com 2 argumentos — os
padrões (`triageState = null, status = 'waiting'`) já fazem a conversa nascer
`'waiting'` sem reivindicar, exatamente como a Global Constraint exige. Não há
`claimConversation`/`sendOpeningMessageIfApplicable` em nenhum caminho deste arquivo.

- [ ] **Step 5: Implementar `campaign-worker.js`**

```js
const { processCampaignQueue } = require('./campaign-queue');
const { processCampaignRecipient } = require('../campaigns/campaign-processor');

function startCampaignWorker() {
  processCampaignQueue(async (data) => {
    await processCampaignRecipient(data);
  });
}

module.exports = { startCampaignWorker };
```

- [ ] **Step 6: Rodar os testes para confirmar que passam**

Run: `npx jest src/campaigns/campaign-processor.test.js`
Expected: PASS, todos verdes.

- [ ] **Step 7: Commit**

```bash
git add src/queue/campaign-queue.js src/queue/campaign-worker.js src/campaigns/campaign-processor.js src/campaigns/campaign-processor.test.js
git commit -m "$(cat <<'EOF'
Add the campaign queue and per-recipient processor

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Rotas `/api/campaigns` + ligar no `server.js`

**Files:**
- Create: `src/api/campaigns.routes.js`
- Test: `src/api/campaigns.routes.test.js`
- Modify: `src/server.js`

**Interfaces:**
- Consumes: `findChannelById`, `findTemplateById`, `substituteVariables`,
  `isOfficialChannelType` (já existem, mesma validação de `POST
  /api/conversations/start`); `createCampaign`, `findCampaignById`, `listCampaigns`,
  `createCampaignRecipients`, `incrementCampaignCounter` (Task 1);
  `enqueueCampaignRecipient` (Task 2); `startCampaignWorker` (Task 2, chamado no boot).
- Produces: `POST /api/campaigns` → `201` com a campanha criada; `GET /api/campaigns` →
  lista; `GET /api/campaigns/:id` → `{...campanha, recipients: [...]}`. Consumido pela
  Task 4 (cliente frontend).

- [ ] **Step 1: Escrever os testes que falham**

```js
jest.mock('../channels/channel.repository');
jest.mock('../templates/template.repository');
jest.mock('../campaigns/campaign.repository');
jest.mock('../queue/campaign-queue');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const { findChannelById } = require('../channels/channel.repository');
const { findTemplateById } = require('../templates/template.repository');
const {
  createCampaign,
  findCampaignById,
  listCampaigns,
  createCampaignRecipients,
  listCampaignRecipients,
  incrementCampaignCounter,
} = require('../campaigns/campaign.repository');
const { enqueueCampaignRecipient } = require('../queue/campaign-queue');
const campaignsRoutes = require('./campaigns.routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/campaigns', campaignsRoutes);
  return app;
}

function tokenFor(agentId, role) {
  return jwt.sign({ agentId, role }, process.env.JWT_SECRET);
}

beforeEach(() => jest.clearAllMocks());

describe('POST /api/campaigns', () => {
  test('creates a text campaign for a baileys channel', async () => {
    findChannelById.mockResolvedValue({ id: 'channel-1', type: 'baileys', config: {} });
    createCampaign.mockResolvedValue({ id: 'campaign-1', totalRecipients: 2 });
    createCampaignRecipients.mockResolvedValue([
      { id: 'r1', phoneNumber: '5511999990000', displayName: null, status: 'pending' },
      { id: 'r2', phoneNumber: '5511999990001', displayName: 'Maria', status: 'pending' },
    ]);

    const res = await request(buildApp())
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ channelId: 'channel-1', content: 'Aviso importante', recipients: '5511999990000\n5511999990001,Maria' });

    expect(res.status).toBe(201);
    expect(createCampaign).toHaveBeenCalledWith(expect.objectContaining({
      channelId: 'channel-1', messageType: 'text', content: 'Aviso importante', createdBy: 'agent-1', totalRecipients: 2,
    }));
    expect(createCampaignRecipients).toHaveBeenCalledWith('campaign-1', [
      { rawPhoneNumber: '5511999990000', phoneNumber: '5511999990000', displayName: null, status: 'pending' },
      { rawPhoneNumber: '5511999990001', phoneNumber: '5511999990001', displayName: 'Maria', status: 'pending' },
    ]);
    expect(enqueueCampaignRecipient).toHaveBeenCalledTimes(2);
  });

  test('creates a template campaign for an official channel, resolving the template once', async () => {
    findChannelById.mockResolvedValue({ id: 'channel-2', type: 'meta_cloud', config: { wabaId: 'waba-1' } });
    findTemplateById.mockResolvedValue({ id: 'tpl-1', name: 'aviso', language: 'pt_BR', status: 'APPROVED', wabaId: 'waba-1', bodyText: 'Ola {{1}}', variableCount: 1 });
    createCampaign.mockResolvedValue({ id: 'campaign-2', totalRecipients: 1 });
    createCampaignRecipients.mockResolvedValue([{ id: 'r1', phoneNumber: '5511999990000', displayName: null, status: 'pending' }]);

    const res = await request(buildApp())
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ channelId: 'channel-2', templateId: 'tpl-1', templateVariables: ['Joao'], recipients: '5511999990000' });

    expect(res.status).toBe(201);
    expect(createCampaign).toHaveBeenCalledWith(expect.objectContaining({
      messageType: 'template', content: 'Ola Joao', templateName: 'aviso', templateLanguage: 'pt_BR', templateVariables: ['Joao'],
    }));
  });

  test('rejects when recipients has no valid line', async () => {
    findChannelById.mockResolvedValue({ id: 'channel-1', type: 'baileys', config: {} });

    const res = await request(buildApp())
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ channelId: 'channel-1', content: 'Oi', recipients: 'abc\n,SemNumero' });

    expect(res.status).toBe(400);
    expect(createCampaign).not.toHaveBeenCalled();
  });

  test('deduplicates repeated phone numbers in the pasted list', async () => {
    findChannelById.mockResolvedValue({ id: 'channel-1', type: 'baileys', config: {} });
    createCampaign.mockResolvedValue({ id: 'campaign-1', totalRecipients: 1 });
    createCampaignRecipients.mockResolvedValue([{ id: 'r1', phoneNumber: '5511999990000', displayName: null, status: 'pending' }]);

    await request(buildApp())
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ channelId: 'channel-1', content: 'Oi', recipients: '5511999990000\n5511999990000' });

    expect(createCampaign).toHaveBeenCalledWith(expect.objectContaining({ totalRecipients: 1 }));
  });

  test('records invalid lines as pre-failed recipients and bumps failedCount, without blocking valid ones', async () => {
    findChannelById.mockResolvedValue({ id: 'channel-1', type: 'baileys', config: {} });
    createCampaign.mockResolvedValue({ id: 'campaign-1', totalRecipients: 2 });
    createCampaignRecipients.mockResolvedValue([
      { id: 'r1', phoneNumber: '', displayName: null, status: 'failed' },
      { id: 'r2', phoneNumber: '5511999990000', displayName: null, status: 'pending' },
    ]);

    const res = await request(buildApp())
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ channelId: 'channel-1', content: 'Oi', recipients: 'abc\n5511999990000' });

    expect(res.status).toBe(201);
    expect(incrementCampaignCounter).toHaveBeenCalledWith('campaign-1', 'failed', 1);
    expect(enqueueCampaignRecipient).toHaveBeenCalledTimes(1);
  });

  test('returns 400 when channelId is missing', async () => {
    const res = await request(buildApp())
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ content: 'Oi', recipients: '5511999990000' });

    expect(res.status).toBe(400);
  });

  test('returns 401 without a token', async () => {
    const res = await request(buildApp()).post('/api/campaigns').send({ channelId: 'channel-1', content: 'Oi', recipients: '5511999990000' });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/campaigns', () => {
  test('lists campaigns', async () => {
    listCampaigns.mockResolvedValue([{ id: 'campaign-1' }]);
    const res = await request(buildApp()).get('/api/campaigns').set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 'campaign-1' }]);
  });
});

describe('GET /api/campaigns/:id', () => {
  test('returns the campaign with its recipients', async () => {
    findCampaignById.mockResolvedValue({ id: 'campaign-1', totalRecipients: 1 });
    listCampaignRecipients.mockResolvedValue([{ id: 'r1', status: 'sent' }]);

    const res = await request(buildApp()).get('/api/campaigns/campaign-1').set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('campaign-1');
    expect(res.body.recipients).toEqual([{ id: 'r1', status: 'sent' }]);
  });

  test('returns 404 when the campaign does not exist', async () => {
    findCampaignById.mockResolvedValue(null);
    const res = await request(buildApp()).get('/api/campaigns/does-not-exist').set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Rodar os testes para confirmar que falham**

Run: `npx jest src/api/campaigns.routes.test.js`
Expected: FAIL — `Cannot find module './campaigns.routes'`.

- [ ] **Step 3: Implementar `src/api/campaigns.routes.js`**

```js
const express = require('express');
const { requireAuth } = require('../auth/auth.middleware');
const { findChannelById } = require('../channels/channel.repository');
const { findTemplateById } = require('../templates/template.repository');
const { substituteVariables } = require('../templates/template-validator');
const { isOfficialChannelType } = require('../channels/channel-types');
const {
  createCampaign,
  findCampaignById,
  listCampaigns,
  createCampaignRecipients,
  listCampaignRecipients,
  incrementCampaignCounter,
} = require('../campaigns/campaign.repository');
const { enqueueCampaignRecipient } = require('../queue/campaign-queue');

const router = express.Router();
router.use(requireAuth);

function parseRecipients(raw) {
  const lines = (raw || '').split('\n').map((line) => line.trim()).filter(Boolean);
  const seen = new Set();
  const parsed = [];
  for (const line of lines) {
    const [phonePart, ...nameParts] = line.split(',');
    const rawPhoneNumber = (phonePart || '').trim();
    const phoneNumber = rawPhoneNumber.replace(/\D/g, '');
    const displayName = nameParts.join(',').trim() || null;
    if (!phoneNumber) {
      parsed.push({ rawPhoneNumber, phoneNumber: '', displayName, status: 'failed', errorMessage: 'Número inválido' });
      continue;
    }
    if (seen.has(phoneNumber)) continue;
    seen.add(phoneNumber);
    parsed.push({ rawPhoneNumber, phoneNumber, displayName, status: 'pending' });
  }
  return parsed;
}

router.post('/', async (req, res) => {
  const { name, channelId, content, templateId, templateVariables, recipients } = req.body || {};
  if (!channelId) {
    return res.status(400).json({ error: 'channelId is required' });
  }

  let channel;
  try {
    channel = await findChannelById(channelId);
  } catch (err) {
    if (err.code === '22P02') {
      return res.status(404).json({ error: 'Channel not found' });
    }
    throw err;
  }
  if (!channel) {
    return res.status(404).json({ error: 'Channel not found' });
  }
  if (channel.type !== 'baileys' && !isOfficialChannelType(channel.type)) {
    return res.status(400).json({ error: 'Unsupported channel type' });
  }

  const parsedRecipients = parseRecipients(recipients);
  if (!parsedRecipients.some((r) => r.status === 'pending')) {
    return res.status(400).json({ error: 'No valid recipient found in the list' });
  }

  let messageType;
  let finalContent;
  let templateName = null;
  let templateLanguage = null;
  let finalTemplateVariables = null;

  if (channel.type === 'baileys') {
    if (!content) {
      return res.status(400).json({ error: 'content is required' });
    }
    messageType = 'text';
    finalContent = content;
  } else {
    if (!templateId) {
      return res.status(400).json({ error: 'templateId is required' });
    }
    const template = await findTemplateById(templateId);
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }
    if (template.status !== 'APPROVED') {
      return res.status(400).json({ error: 'This template is not approved' });
    }
    if (template.wabaId !== channel.config.wabaId) {
      return res.status(400).json({ error: "This template does not belong to this channel's WABA" });
    }
    const variables = Array.isArray(templateVariables) ? templateVariables : [];
    if (variables.length !== template.variableCount) {
      return res.status(400).json({ error: `This template requires exactly ${template.variableCount} variable(s)` });
    }
    if (variables.some((v) => typeof v !== 'string' || !v.trim())) {
      return res.status(400).json({ error: 'Each template variable must be a non-empty string' });
    }
    messageType = 'template';
    finalContent = substituteVariables(template.bodyText, variables);
    templateName = template.name;
    templateLanguage = template.language;
    finalTemplateVariables = variables;
  }

  const campaign = await createCampaign({
    name,
    channelId: channel.id,
    messageType,
    content: finalContent,
    templateName,
    templateLanguage,
    templateVariables: finalTemplateVariables,
    createdBy: req.agent.agentId,
    totalRecipients: parsedRecipients.length,
  });

  const createdRecipients = await createCampaignRecipients(campaign.id, parsedRecipients);

  const preFailedCount = createdRecipients.filter((r) => r.status === 'failed').length;
  if (preFailedCount > 0) {
    await incrementCampaignCounter(campaign.id, 'failed', preFailedCount);
  }

  createdRecipients
    .filter((r) => r.status === 'pending')
    .forEach((r) => {
      enqueueCampaignRecipient({
        recipientId: r.id,
        campaignId: campaign.id,
        channelId: channel.id,
        phoneNumber: r.phoneNumber,
        displayName: r.displayName,
        content: finalContent,
        templateName,
        templateLanguage,
        templateVariables: finalTemplateVariables,
      });
    });

  res.status(201).json(campaign);
});

router.get('/', async (req, res) => {
  const campaigns = await listCampaigns();
  res.json(campaigns);
});

router.get('/:id', async (req, res) => {
  const campaign = await findCampaignById(req.params.id);
  if (!campaign) {
    return res.status(404).json({ error: 'Campaign not found' });
  }
  const recipients = await listCampaignRecipients(campaign.id);
  res.json({ ...campaign, recipients });
});

module.exports = router;
```

- [ ] **Step 4: Ligar a rota e o worker em `src/server.js`**

Adicionar o require perto dos outros requires de rotas (perto da linha 33-35, junto a
`reasonsRoutes`/`sgpQueryRoutes`):
```js
const campaignsRoutes = require('./api/campaigns.routes');
```
Adicionar o mount perto dos outros `app.use('/api/...')` (por exemplo, logo depois de
`app.use('/api/cities', citiesRoutes);`):
```js
app.use('/api/campaigns', campaignsRoutes);
```
Dentro do bloco `if (require.main === module) { ... }` no final do arquivo, adicionar o
require lazy e a chamada junto de onde `startOutboundWorker()` já é chamado:
```js
const { startCampaignWorker } = require('./queue/campaign-worker');
```
e, na mesma sequência de chamadas onde `startOutboundWorker()` já é invocado, adicionar
logo depois:
```js
startCampaignWorker();
```
Não altere mais nada nesse bloco.

- [ ] **Step 5: Rodar os testes para confirmar que passam**

Run: `npx jest src/api/campaigns.routes.test.js`
Expected: PASS, todos verdes.

- [ ] **Step 6: Commit**

```bash
git add src/api/campaigns.routes.js src/api/campaigns.routes.test.js src/server.js
git commit -m "$(cat <<'EOF'
Add POST/GET /api/campaigns and start the campaign worker on boot

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Cliente frontend — `services/api.js`

**Files:**
- Modify: `frontend/src/services/api.js`
- Test: `frontend/src/services/api.test.js`

**Interfaces:**
- Consumes: as rotas da Task 3.
- Produces: `createCampaign(payload, token)`, `listCampaigns(token)`,
  `getCampaign(id, token)`. Consumido pelas Tasks 5, 6 e 7.

- [ ] **Step 1: Escrever os testes que falham**

Adicionar `createCampaign`, `listCampaigns`, `getCampaign` ao bloco de imports
desestruturados no topo de `frontend/src/services/api.test.js`, e ao final do arquivo:

```js
describe('createCampaign', () => {
  test('posts the campaign payload', async () => {
    global.fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('{"id":"campaign-1"}') });
    await createCampaign({ channelId: 'ch-1', content: 'Oi', recipients: '5511999990000' }, 'tok-123');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/campaigns',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ channelId: 'ch-1', content: 'Oi', recipients: '5511999990000' }),
      })
    );
  });
});

describe('listCampaigns', () => {
  test('fetches the campaign list', async () => {
    global.fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('[]') });
    await listCampaigns('tok-123');
    expect(global.fetch).toHaveBeenCalledWith('http://localhost:3000/api/campaigns', expect.objectContaining({ method: 'GET' }));
  });
});

describe('getCampaign', () => {
  test('fetches one campaign by id', async () => {
    global.fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('{}') });
    await getCampaign('campaign-1', 'tok-123');
    expect(global.fetch).toHaveBeenCalledWith('http://localhost:3000/api/campaigns/campaign-1', expect.objectContaining({ method: 'GET' }));
  });
});
```

- [ ] **Step 2: Rodar os testes para confirmar que falham**

Run: `cd frontend && npx vitest run src/services/api.test.js`
Expected: FAIL — `createCampaign`/`listCampaigns`/`getCampaign` não exportados.

- [ ] **Step 3: Implementar**

Adicionar ao final de `frontend/src/services/api.js`:

```js
export function createCampaign(payload, token) {
  return apiFetch('/api/campaigns', { method: 'POST', body: payload, token });
}

export function listCampaigns(token) {
  return apiFetch('/api/campaigns', { token });
}

export function getCampaign(id, token) {
  return apiFetch(`/api/campaigns/${id}`, { token });
}
```

- [ ] **Step 4: Rodar os testes para confirmar que passam**

Run: `cd frontend && npx vitest run src/services/api.test.js`
Expected: PASS, todos verdes.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/api.js frontend/src/services/api.test.js
git commit -m "$(cat <<'EOF'
Add frontend API client functions for campaigns

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `CreateCampaignModal`

**Files:**
- Create: `frontend/src/components/CreateCampaignModal.jsx`
- Test: `frontend/src/components/CreateCampaignModal.test.jsx`

**Interfaces:**
- Consumes: `listChannelsForAgent`, `listTemplatesForChannel`, `createCampaign` (Task
  4, `listChannelsForAgent`/`listTemplatesForChannel` já existem); `isOfficialChannelType`
  (`frontend/src/utils/channelTypes.js`, já existe).
- Produces: `<CreateCampaignModal onClose onCreated />` — `onCreated(campaign)` chamado
  com a campanha recém-criada. Consumido pela Task 6 (`CampaignsPage`).

Este componente espelha `frontend/src/components/StartConversationModal.jsx` quase
inteiramente (mesmo carregamento de canais elegíveis, mesmo fluxo de template com
variáveis) — a única diferença de fluxo é um campo a mais (a lista de destinatários) no
lugar do campo único de telefone.

- [ ] **Step 1: Escrever os testes que falham**

```js
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CreateCampaignModal from './CreateCampaignModal';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
});

describe('CreateCampaignModal', () => {
  test('lists only connected baileys channels and official channels', async () => {
    api.listChannelsForAgent.mockResolvedValue([
      { id: 'ch-1', type: 'baileys', name: 'Berg', status: 'connected' },
      { id: 'ch-2', type: 'baileys', name: 'Desconectado', status: 'awaiting_qr' },
      { id: 'ch-3', type: 'meta_cloud', name: 'Oficial', status: 'connected' },
    ]);
    render(<CreateCampaignModal onClose={vi.fn()} onCreated={vi.fn()} />);

    expect(await screen.findByText('Berg')).toBeInTheDocument();
    expect(screen.getByText('Oficial')).toBeInTheDocument();
    expect(screen.queryByText('Desconectado')).not.toBeInTheDocument();
  });

  test('shows a free-text message field for a baileys channel', async () => {
    api.listChannelsForAgent.mockResolvedValue([{ id: 'ch-1', type: 'baileys', name: 'Berg', status: 'connected' }]);
    render(<CreateCampaignModal onClose={vi.fn()} onCreated={vi.fn()} />);

    expect(await screen.findByLabelText(/mensagem/i)).toBeInTheDocument();
  });

  test('shows a template selector with variable fields for an official channel', async () => {
    api.listChannelsForAgent.mockResolvedValue([{ id: 'ch-2', type: 'meta_cloud', name: 'Oficial', status: 'connected' }]);
    api.listTemplatesForChannel.mockResolvedValue([{ id: 'tpl-1', name: 'aviso', variableCount: 1 }]);
    render(<CreateCampaignModal onClose={vi.fn()} onCreated={vi.fn()} />);

    await screen.findByText('Oficial');
    expect(await screen.findByLabelText(/template/i)).toBeInTheDocument();
    expect(await screen.findByLabelText(/variável 1/i)).toBeInTheDocument();
  });

  test('submits a text campaign with the pasted recipients list', async () => {
    api.listChannelsForAgent.mockResolvedValue([{ id: 'ch-1', type: 'baileys', name: 'Berg', status: 'connected' }]);
    api.createCampaign.mockResolvedValue({ id: 'campaign-1' });
    const onCreated = vi.fn();
    render(<CreateCampaignModal onClose={vi.fn()} onCreated={onCreated} />);

    await screen.findByText('Berg');
    await userEvent.type(screen.getByLabelText(/mensagem/i), 'Aviso importante');
    await userEvent.type(screen.getByLabelText(/destinatários/i), '5511999990000\n5511999990001,Maria');
    await userEvent.click(screen.getByRole('button', { name: /disparar/i }));

    await waitFor(() =>
      expect(api.createCampaign).toHaveBeenCalledWith(
        { channelId: 'ch-1', name: '', content: 'Aviso importante', recipients: '5511999990000\n5511999990001,Maria' },
        'tok-123'
      )
    );
    expect(onCreated).toHaveBeenCalledWith({ id: 'campaign-1' });
  });

  test('shows an error message when creation fails', async () => {
    api.listChannelsForAgent.mockResolvedValue([{ id: 'ch-1', type: 'baileys', name: 'Berg', status: 'connected' }]);
    api.createCampaign.mockRejectedValue({ body: { error: 'No valid recipient found in the list' } });
    render(<CreateCampaignModal onClose={vi.fn()} onCreated={vi.fn()} />);

    await screen.findByText('Berg');
    await userEvent.type(screen.getByLabelText(/mensagem/i), 'Oi');
    await userEvent.type(screen.getByLabelText(/destinatários/i), 'abc');
    await userEvent.click(screen.getByRole('button', { name: /disparar/i }));

    expect(await screen.findByText('No valid recipient found in the list')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Rodar os testes para confirmar que falham**

Run: `cd frontend && npx vitest run src/components/CreateCampaignModal.test.jsx`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

```js
import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { listChannelsForAgent, listTemplatesForChannel, createCampaign } from '../services/api';
import { isOfficialChannelType } from '../utils/channelTypes';
import WaDialog, {
  waInputClass,
  waLabelClass,
  waPrimaryButtonClass,
  waGhostButtonClass,
  waErrorClass,
} from './WaDialog';

function CreateCampaignModal({ onClose, onCreated }) {
  const { token } = useAuth();
  const [channels, setChannels] = useState([]);
  const [channelId, setChannelId] = useState('');
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [recipients, setRecipients] = useState('');
  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState('');
  const [templateVariableValues, setTemplateVariableValues] = useState([]);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    listChannelsForAgent(token)
      .then((data) => {
        const eligible = data.filter(
          (channel) => (channel.type === 'baileys' && channel.status === 'connected') || isOfficialChannelType(channel.type)
        );
        setChannels(eligible);
        if (eligible.length > 0) {
          setChannelId(eligible[0].id);
        }
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, [token]);

  const selectedChannel = channels.find((channel) => channel.id === channelId);
  const isOfficialChannel = selectedChannel && isOfficialChannelType(selectedChannel.type);
  const selectedTemplate = templates.find((tpl) => tpl.id === templateId);

  useEffect(() => {
    if (!isOfficialChannel || !channelId) {
      setTemplates([]);
      setTemplateId('');
      return;
    }
    listTemplatesForChannel(channelId, token).then((data) => {
      setTemplates(data);
      setTemplateId(data[0]?.id || '');
    });
  }, [isOfficialChannel, channelId, token]);

  useEffect(() => {
    setTemplateVariableValues(selectedTemplate ? Array(selectedTemplate.variableCount).fill('') : []);
  }, [selectedTemplate]);

  function handleVariableChange(index, value) {
    setTemplateVariableValues((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const campaign = isOfficialChannel
        ? await createCampaign({ channelId, name, templateId, templateVariables: templateVariableValues, recipients }, token)
        : await createCampaign({ channelId, name, content, recipients }, token);
      onCreated(campaign);
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao criar campanha');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <WaDialog title="Nova campanha" onClose={onClose} size="max-w-sm">
      <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
        <div className="wa-scroll min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-3">
          <div>
            <label htmlFor="campaign-name" className={waLabelClass}>
              Nome (opcional)
            </label>
            <input id="campaign-name" value={name} onChange={(e) => setName(e.target.value)} className={waInputClass} />
          </div>
          <div>
            <label htmlFor="campaign-channel" className={waLabelClass}>
              Canal
            </label>
            {loading ? (
              <p className="text-[14px] text-wa-muted">Carregando canais...</p>
            ) : loadError ? (
              <p className="text-[14px] text-wa-error-text">Não foi possível carregar os canais. Feche e tente novamente.</p>
            ) : channels.length === 0 ? (
              <p className="text-[14px] text-wa-muted">Nenhum canal conectado no momento.</p>
            ) : (
              <select id="campaign-channel" value={channelId} onChange={(e) => setChannelId(e.target.value)} className={waInputClass}>
                {channels.map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    {channel.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          {isOfficialChannel ? (
            <>
              <p className="rounded-[10px] bg-wa-warn-bg px-3 py-2 text-[13.5px] leading-[19px] text-wa-warn-text">
                Este canal requer o uso de template para a campanha!
              </p>
              <div>
                <label htmlFor="campaign-template" className={waLabelClass}>
                  Template
                </label>
                {templates.length === 0 ? (
                  <p className="text-[14px] text-wa-muted">Nenhum template aprovado para este canal.</p>
                ) : (
                  <select id="campaign-template" value={templateId} onChange={(e) => setTemplateId(e.target.value)} className={waInputClass}>
                    {templates.map((tpl) => (
                      <option key={tpl.id} value={tpl.id}>
                        {tpl.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              {templateVariableValues.map((value, index) => (
                <div key={index}>
                  <label htmlFor={`campaign-variable-${index}`} className={waLabelClass}>
                    Variável {index + 1}
                  </label>
                  <input
                    id={`campaign-variable-${index}`}
                    value={value}
                    onChange={(e) => handleVariableChange(index, e.target.value)}
                    className={waInputClass}
                    required
                  />
                </div>
              ))}
            </>
          ) : (
            <div>
              <label htmlFor="campaign-message" className={waLabelClass}>
                Mensagem
              </label>
              <textarea id="campaign-message" value={content} onChange={(e) => setContent(e.target.value)} className={waInputClass} required />
            </div>
          )}
          <div>
            <label htmlFor="campaign-recipients" className={waLabelClass}>
              Destinatários (um por linha: telefone ou telefone,nome)
            </label>
            <textarea
              id="campaign-recipients"
              value={recipients}
              onChange={(e) => setRecipients(e.target.value)}
              className={`${waInputClass} min-h-[120px]`}
              required
            />
          </div>
          {error && <p className={waErrorClass}>{error}</p>}
        </div>
        <div className="flex shrink-0 justify-end gap-2 px-4 py-3">
          <button type="button" onClick={onClose} className={waGhostButtonClass}>
            Cancelar
          </button>
          <button
            type="submit"
            disabled={submitting || loading || loadError || channels.length === 0 || (isOfficialChannel && templates.length === 0)}
            className={waPrimaryButtonClass}
          >
            Disparar
          </button>
        </div>
      </form>
    </WaDialog>
  );
}

export default CreateCampaignModal;
```

- [ ] **Step 4: Rodar os testes para confirmar que passam**

Run: `cd frontend && npx vitest run src/components/CreateCampaignModal.test.jsx`
Expected: PASS, todos verdes.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/CreateCampaignModal.jsx frontend/src/components/CreateCampaignModal.test.jsx
git commit -m "$(cat <<'EOF'
Add CreateCampaignModal, mirroring StartConversationModal

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `CampaignsPage` (lista) + item no `NavRail` + rota

**Files:**
- Modify: `frontend/src/components/icons/WaIcons.jsx`
- Modify: `frontend/src/components/NavRail.jsx`
- Modify: `frontend/src/components/NavRail.test.jsx`
- Create: `frontend/src/pages/CampaignsPage.jsx`
- Test: `frontend/src/pages/CampaignsPage.test.jsx`
- Modify: `frontend/src/App.jsx`

**Interfaces:**
- Consumes: `listCampaigns` (Task 4); `CreateCampaignModal` (Task 5).
- Produces: rota `/campaigns`; `<NavRail>` ganha o item "Campanhas" (visível a
  qualquer atendente, mesmo padrão de "Conversas"/"Relatório" — sem checar
  `agent?.role`).

- [ ] **Step 1: Adicionar o ícone**

Em `frontend/src/components/icons/WaIcons.jsx`, adicionar ao final (mesmo estilo dos
vizinhos, `<Svg>{...props}><path .../></Svg>`):

```js
export function IconMegaphone(props) {
  return (
    <Svg {...props}>
      <path d="M3 10v4a1 1 0 001 1h2l7 4V5L6 9H4a1 1 0 00-1 1zm15.5 2c0-1.9-.8-3.6-2-4.9l-1.1 1.1c.9 1 1.5 2.3 1.5 3.8s-.6 2.8-1.5 3.8l1.1 1.1c1.2-1.3 2-3 2-4.9z" />
    </Svg>
  );
}
```

- [ ] **Step 2: Atualizar o teste do `NavRail` que vai falhar**

Adicionar a `frontend/src/components/NavRail.test.jsx` (mesmo padrão dos testes
existentes de "Conversas"/"Relatório"):

```js
  test('always shows Campanhas', () => {
    renderRail();
    expect(screen.getByLabelText('Campanhas')).toBeInTheDocument();
  });
```

- [ ] **Step 3: Rodar o teste para confirmar que falha**

Run: `cd frontend && npx vitest run src/components/NavRail.test.jsx`
Expected: FAIL — não existe elemento com `aria-label` "Campanhas".

- [ ] **Step 4: Adicionar o item ao `NavRail.jsx`**

Adicionar `IconMegaphone` à lista de ícones importados de `./icons/WaIcons`, e o item
logo depois do `<RailLink to="/metrics" ...>` (antes do bloco `{agent?.role ===
'admin' && (...)}`):

```jsx
        <RailLink to="/campaigns" label="Campanhas" active={active === 'campaigns'}>
          <IconMegaphone size={23} />
        </RailLink>
```

- [ ] **Step 5: Rodar o teste do NavRail para confirmar que passa**

Run: `cd frontend && npx vitest run src/components/NavRail.test.jsx`
Expected: PASS, todos verdes.

- [ ] **Step 6: Escrever os testes que falham para `CampaignsPage`**

```js
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import CampaignsPage from './CampaignsPage';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

function renderPage() {
  return render(
    <MemoryRouter>
      <CampaignsPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'agent-1', name: 'Ana', role: 'agent' }, logout: vi.fn() });
});

describe('CampaignsPage', () => {
  test('lists existing campaigns with their counters', async () => {
    api.listCampaigns.mockResolvedValue([
      { id: 'campaign-1', name: 'Aviso setembro', totalRecipients: 45, sentCount: 42, failedCount: 2, skippedCount: 1, createdAt: '2026-09-11T10:00:00Z' },
    ]);
    renderPage();

    expect(await screen.findByText('Aviso setembro')).toBeInTheDocument();
    expect(screen.getByText(/42/)).toBeInTheDocument();
  });

  test('shows a message when there are no campaigns yet', async () => {
    api.listCampaigns.mockResolvedValue([]);
    renderPage();

    expect(await screen.findByText(/nenhuma campanha/i)).toBeInTheDocument();
  });

  test('opens the create campaign modal', async () => {
    api.listCampaigns.mockResolvedValue([]);
    renderPage();

    await screen.findByText(/nenhuma campanha/i);
    await userEvent.click(screen.getByRole('button', { name: /nova campanha/i }));

    expect(await screen.findByText('Nova campanha')).toBeInTheDocument();
  });

  test('adds the new campaign to the list after creating it', async () => {
    api.listCampaigns.mockResolvedValueOnce([]);
    api.listChannelsForAgent.mockResolvedValue([{ id: 'ch-1', type: 'baileys', name: 'Berg', status: 'connected' }]);
    api.createCampaign.mockResolvedValue({ id: 'campaign-new', name: 'Nova', totalRecipients: 1, sentCount: 0, failedCount: 0, skippedCount: 0, createdAt: '2026-09-11T10:00:00Z' });
    renderPage();

    await screen.findByText(/nenhuma campanha/i);
    await userEvent.click(screen.getByRole('button', { name: /nova campanha/i }));
    await screen.findByText('Berg');
    await userEvent.type(screen.getByLabelText(/mensagem/i), 'Oi');
    await userEvent.type(screen.getByLabelText(/destinatários/i), '5511999990000');
    await userEvent.click(screen.getByRole('button', { name: /disparar/i }));

    await waitFor(() => expect(screen.getByText('Nova')).toBeInTheDocument());
  });
});
```

- [ ] **Step 7: Rodar os testes para confirmar que falham**

Run: `cd frontend && npx vitest run src/pages/CampaignsPage.test.jsx`
Expected: FAIL — módulo não existe.

- [ ] **Step 8: Implementar `CampaignsPage.jsx`**

Mesma casca de página que `frontend/src/pages/MetricsPage.jsx` já usa (`chat-theme`,
`bg-chat-canvas`, os dois "glow blobs", `<NavRail active="campaigns" .../>`), com
`ProfileModal` disponível pelo botão "Meu perfil" do próprio `NavRail`:

```js
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { listCampaigns } from '../services/api';
import NavRail from '../components/NavRail';
import ProfileModal from '../components/ProfileModal';
import CreateCampaignModal from '../components/CreateCampaignModal';

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function CampaignsPage() {
  const { token } = useAuth();
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [profileOpen, setProfileOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(() => {
    setLoading(true);
    return listCampaigns(token)
      .then(setCampaigns)
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="chat-theme relative flex h-dvh overflow-hidden bg-chat-canvas font-sans text-chat-text">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-[36%] -top-[12%] h-[38rem] w-[42rem] rounded-full bg-chat-copper/40 blur-[150px]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-[8%] bottom-[-18%] h-[30rem] w-[32rem] rounded-full bg-chat-copper/25 blur-[150px]"
      />

      <div className="relative z-10 flex min-h-0 min-w-0 flex-1 gap-3 p-3">
        <NavRail active="campaigns" onProfileClick={() => setProfileOpen(true)} />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="flex shrink-0 items-center justify-between px-2 pb-4 pt-2">
            <div>
              <h1 className="font-display text-[26px] font-semibold leading-tight tracking-[-0.01em] text-chat-text">
                Campanhas
              </h1>
              <p className="mt-1.5 text-[14px] text-chat-muted">Disparo em massa para uma lista de clientes</p>
            </div>
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="shrink-0 rounded-full bg-chat-orange px-5 py-2.5 text-[14px] font-medium text-white transition hover:brightness-110"
            >
              Nova campanha
            </button>
          </header>

          <div className="chat-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-4">
            {loading ? (
              <p className="text-[14px] text-chat-muted">Carregando...</p>
            ) : campaigns.length === 0 ? (
              <p className="text-[14px] text-chat-muted">Nenhuma campanha criada ainda.</p>
            ) : (
              <ul className="space-y-2">
                {campaigns.map((campaign) => (
                  <li key={campaign.id}>
                    <a
                      href={`/campaigns/${campaign.id}`}
                      className="block rounded-[16px] border border-white/[0.08] bg-white/[0.04] px-4 py-3 transition hover:bg-white/[0.07]"
                    >
                      <p className="text-[15px] font-medium text-chat-text">{campaign.name || 'Sem nome'}</p>
                      <p className="mt-1 text-[13px] text-chat-muted">
                        {formatDate(campaign.createdAt)} — {campaign.sentCount} enviados, {campaign.failedCount} falharam,{' '}
                        {campaign.skippedCount} pulados de {campaign.totalRecipients}
                      </p>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {profileOpen && <ProfileModal onClose={() => setProfileOpen(false)} />}
      {creating && (
        <CreateCampaignModal
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            refresh();
          }}
        />
      )}
    </div>
  );
}

export default CampaignsPage;
```

(O link usa `<a href>` puro em vez de `<Link>` do React Router deliberadamente — a
Task 7 cria a página de destino `/campaigns/:id`; usar `<a>` aqui já funciona com
navegação de página cheia mesmo antes da Task 7 existir, e continua funcionando depois.
Se preferir client-side routing sem recarregar a página, troque por `<Link>` de
`react-router-dom` — ambos passam nos testes acima, que só checam o texto renderizado.)

- [ ] **Step 9: Adicionar a rota em `App.jsx`**

Adicionar o import:
```js
import CampaignsPage from './pages/CampaignsPage';
```
E a rota, no mesmo padrão de `/metrics` (não-admin):
```jsx
            <Route
              path="/campaigns"
              element={
                <ProtectedRoute>
                  <CampaignsPage />
                </ProtectedRoute>
              }
            />
```

- [ ] **Step 10: Rodar os testes para confirmar que passam**

Run: `cd frontend && npx vitest run src/pages/CampaignsPage.test.jsx src/components/NavRail.test.jsx`
Expected: PASS, todos verdes.

- [ ] **Step 11: Commit**

```bash
git add frontend/src/components/icons/WaIcons.jsx frontend/src/components/NavRail.jsx frontend/src/components/NavRail.test.jsx frontend/src/pages/CampaignsPage.jsx frontend/src/pages/CampaignsPage.test.jsx frontend/src/App.jsx
git commit -m "$(cat <<'EOF'
Add CampaignsPage, the Campanhas nav item, and the /campaigns route

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: `CampaignDetailPage` (progresso ao vivo)

**Files:**
- Create: `frontend/src/pages/CampaignDetailPage.jsx`
- Test: `frontend/src/pages/CampaignDetailPage.test.jsx`
- Modify: `frontend/src/App.jsx`

**Interfaces:**
- Consumes: `getCampaign` (Task 4).
- Produces: rota `/campaigns/:id`.

- [ ] **Step 1: Escrever os testes que falham**

Testar o polling avançando o tempo de verdade com fake timers tende a ser instável
neste tipo de suíte (efeitos assíncronos concorrendo com o avanço do relógio). Em vez
disso, espione `setInterval`/`clearInterval` diretamente — verifica a mesma coisa
(que o polling é armado com o atraso certo só enquanto ainda há destinatário pendente)
sem depender de simular a passagem do tempo:

```js
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import CampaignDetailPage from './CampaignDetailPage';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

function renderPage(id = 'campaign-1') {
  return render(
    <MemoryRouter initialEntries={[`/campaigns/${id}`]}>
      <Routes>
        <Route path="/campaigns/:id" element={<CampaignDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'agent-1', name: 'Ana', role: 'agent' }, logout: vi.fn() });
});

describe('CampaignDetailPage', () => {
  test('shows the counters and the recipient list', async () => {
    api.getCampaign.mockResolvedValue({
      id: 'campaign-1', name: 'Aviso', totalRecipients: 2, sentCount: 1, failedCount: 1, skippedCount: 0,
      recipients: [
        { id: 'r1', phoneNumber: '5511999990000', displayName: 'Joao', status: 'sent', errorMessage: null },
        { id: 'r2', phoneNumber: '5511999990001', displayName: null, status: 'failed', errorMessage: 'Número inválido' },
      ],
    });
    renderPage();

    expect(await screen.findByText('Aviso')).toBeInTheDocument();
    expect(screen.getByText('Joao')).toBeInTheDocument();
    expect(screen.getByText('Número inválido')).toBeInTheDocument();
  });

  test('arms a 3-second poll while the campaign is still processing', async () => {
    api.getCampaign.mockResolvedValue({
      id: 'campaign-1', name: 'Aviso', totalRecipients: 2, sentCount: 0, failedCount: 0, skippedCount: 0, recipients: [],
    });
    const setIntervalSpy = vi.spyOn(global, 'setInterval');
    renderPage();

    await screen.findByText('Aviso');
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 3000);
  });

  test('does not poll once every recipient is already processed', async () => {
    api.getCampaign.mockResolvedValue({
      id: 'campaign-1', name: 'Aviso', totalRecipients: 1, sentCount: 1, failedCount: 0, skippedCount: 0, recipients: [],
    });
    const setIntervalSpy = vi.spyOn(global, 'setInterval');
    renderPage();

    await screen.findByText('Aviso');
    expect(setIntervalSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar os testes para confirmar que falham**

Run: `cd frontend && npx vitest run src/pages/CampaignDetailPage.test.jsx`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

Mesma casca de `CampaignsPage.jsx` (Task 6), trocando o conteúdo pela lista de
destinatários e o polling. Padrão de polling idêntico ao já usado em
`frontend/src/pages/AdminChannelsPage.jsx` (`useEffect` + `setInterval(() =>
refresh(), N)`, limpo no cleanup):

```js
import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getCampaign } from '../services/api';
import NavRail from '../components/NavRail';
import ProfileModal from '../components/ProfileModal';

const STATUS_LABELS = { pending: 'Pendente', sent: 'Enviado', failed: 'Falhou', skipped: 'Pulado' };

function CampaignDetailPage() {
  const { id } = useParams();
  const { token } = useAuth();
  const [campaign, setCampaign] = useState(null);
  const [profileOpen, setProfileOpen] = useState(false);

  const refresh = useCallback(() => {
    return getCampaign(id, token).then(setCampaign);
  }, [id, token]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const processedCount = campaign ? campaign.sentCount + campaign.failedCount + campaign.skippedCount : 0;
  const stillProcessing = campaign ? processedCount < campaign.totalRecipients : false;

  useEffect(() => {
    if (!stillProcessing) return undefined;
    const interval = setInterval(() => refresh(), 3000);
    return () => clearInterval(interval);
  }, [stillProcessing, refresh]);

  if (!campaign) {
    return (
      <div className="chat-theme relative flex h-dvh overflow-hidden bg-chat-canvas font-sans text-chat-text">
        <div className="relative z-10 flex min-h-0 min-w-0 flex-1 gap-3 p-3">
          <NavRail active="campaigns" onProfileClick={() => setProfileOpen(true)} />
          <p className="px-4 py-4 text-[14px] text-chat-muted">Carregando...</p>
        </div>
        {profileOpen && <ProfileModal onClose={() => setProfileOpen(false)} />}
      </div>
    );
  }

  return (
    <div className="chat-theme relative flex h-dvh overflow-hidden bg-chat-canvas font-sans text-chat-text">
      <div className="relative z-10 flex min-h-0 min-w-0 flex-1 gap-3 p-3">
        <NavRail active="campaigns" onProfileClick={() => setProfileOpen(true)} />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="shrink-0 px-2 pb-4 pt-2">
            <h1 className="font-display text-[26px] font-semibold leading-tight tracking-[-0.01em] text-chat-text">
              {campaign.name || 'Sem nome'}
            </h1>
            <p className="mt-1.5 text-[14px] text-chat-muted">
              {campaign.sentCount} enviados, {campaign.failedCount} falharam, {campaign.skippedCount} pulados de{' '}
              {campaign.totalRecipients}
            </p>
          </header>

          <div className="chat-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-4">
            <ul className="space-y-1.5">
              {campaign.recipients.map((recipient) => (
                <li
                  key={recipient.id}
                  className="flex items-center justify-between gap-3 rounded-[12px] border border-white/[0.08] bg-white/[0.04] px-4 py-2.5"
                >
                  <div>
                    <p className="text-[14px] text-chat-text">{recipient.displayName || recipient.phoneNumber}</p>
                    {recipient.errorMessage && <p className="text-[12.5px] text-chat-muted">{recipient.errorMessage}</p>}
                  </div>
                  <span className="shrink-0 text-[12.5px] text-chat-muted">{STATUS_LABELS[recipient.status] || recipient.status}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {profileOpen && <ProfileModal onClose={() => setProfileOpen(false)} />}
    </div>
  );
}

export default CampaignDetailPage;
```

- [ ] **Step 4: Adicionar a rota em `App.jsx`**

Adicionar o import:
```js
import CampaignDetailPage from './pages/CampaignDetailPage';
```
E a rota:
```jsx
            <Route
              path="/campaigns/:id"
              element={
                <ProtectedRoute>
                  <CampaignDetailPage />
                </ProtectedRoute>
              }
            />
```

- [ ] **Step 5: Rodar os testes para confirmar que passam**

Run: `cd frontend && npx vitest run src/pages/CampaignDetailPage.test.jsx`
Expected: PASS, todos verdes.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/CampaignDetailPage.jsx frontend/src/pages/CampaignDetailPage.test.jsx frontend/src/App.jsx
git commit -m "$(cat <<'EOF'
Add CampaignDetailPage with live progress polling

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Final Verification (after all tasks)

Run the full backend and frontend suites clean, in the isolated worktree, before
finishing the branch:

```bash
npm test
cd frontend && npx vitest run
```

Both must be 100% green before proceeding to
`superpowers:finishing-a-development-branch`.

**Nenhuma variável de ambiente nova é necessária.** A migração desta feature (Task 1)
só cria tabelas novas, sem tocar em tabelas/queries já existentes — pode rodar antes ou
depois do deploy sem risco, ao contrário do plano anterior (`2026-09-10-agent-profile.md`).
