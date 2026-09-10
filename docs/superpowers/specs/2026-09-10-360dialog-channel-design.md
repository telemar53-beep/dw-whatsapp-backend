# Canal 360dialog (terceira opção de canal WhatsApp)

**Status:** Aprovado (aguardando revisão final do usuário antes do plano de implementação)
**Data:** 2026-09-10

## 1. Problema e objetivo

Hoje o sistema tem dois tipos de canal: `baileys` (WhatsApp normal via QR code, não oficial)
e `meta_cloud` (API oficial, conectada direto pela Meta). O usuário quer uma terceira
opção: conectar um número via **360dialog** (https://360dialog.com/br/), um BSP
(Business Solution Provider) oficial que hospeda a WhatsApp Cloud API — motivado pelo
site de developer da própria Meta estar com problema no momento, impedindo criar canais
`meta_cloud` diretamente por lá.

Confirmado com o usuário: ainda não há uma conta/API key real da 360dialog disponível
para teste ponta a ponta agora — esta entrega prepara a estrutura; a validação com
credenciais reais fica para quando o usuário tiver uma conta. O canal 360dialog deve se
comportar **identicamente** ao `meta_cloud` em toda regra de negócio (janela de 24h,
exigência de template para iniciar conversa nova, integração SGP em modo template,
liberação de criação/edição de templates) — só a chamada técnica de envio/recebimento
muda por baixo.

## 2. Fatos técnicos confirmados na documentação oficial da 360dialog

Pesquisados diretamente em docs.360dialog.com antes de desenhar qualquer coisa — nenhum
foi assumido:

- **Envio de mensagem:** `POST https://waba-v2.360dialog.io/messages`, autenticação via
  header `D360-API-KEY: <chave>` (chave própria da 360dialog — não é o Bearer token da
  Meta). O corpo da mensagem usa os mesmos campos da WhatsApp Cloud API
  (`messaging_product`, `to`, `type`, `text.body`, `template.name/language/components`),
  mas **sem** Phone Number ID nem WABA ID na URL — a chave já identifica o número.
- **Templates:** `POST/GET/DELETE https://waba-v2.360dialog.io/message_templates`, mesma
  autenticação, mesmo formato de corpo (`name`, `language`, `category`, `components`) da
  Meta.
- **Webhook (payload recebido):** estruturalmente idêntico ao formato da Meta —
  `entry[].changes[].value.{messages, statuses, contacts, metadata}` — confirmado via
  busca cruzando a documentação oficial da 360dialog.
- **Webhook (autenticidade):** a 360dialog **não** usa assinatura HMAC como a Meta
  (`X-Hub-Signature-256`). A URL de webhook é registrada via chamada de API própria
  (`POST /v1/configs/webhook`, corpo `{"url": "..."}`), não por um fluxo de
  `hub.challenge` como o da Meta.

**Suposição não 100% confirmada, sinalizada para quem for testar com conta real:** o
endpoint de registro de webhook (`/v1/configs/webhook`) provavelmente vive na mesma base
`waba-v2.360dialog.io` e usa a mesma autenticação `D360-API-KEY` que os outros
endpoints, já que aparece na mesma seção de documentação — mas isso não veio como uma
afirmação literal isolada na doc. A implementação deve reportar claramente o erro se
essa chamada retornar formato inesperado, para depurar rápido no primeiro teste real.

## 3. Modelo de dados

Migração nova (idempotente, `IF NOT EXISTS`/`IF EXISTS` em tudo):

```sql
ALTER TABLE channels DROP CONSTRAINT IF EXISTS channels_type_check;
ALTER TABLE channels ADD CONSTRAINT channels_type_check CHECK (type IN ('meta_cloud', 'baileys', '360dialog'));
```

O node-pg-migrate padrão do Postgres nomeia a constraint `channels_type_check`
automaticamente (`<tabela>_<coluna>_check`) — confirmar esse nome batendo com a
migração original (`migrations/1788610140627_create-channels-table.js`) antes de
escrever o `down`. Nenhuma tabela nova: canais `360dialog` usam a mesma coluna `config`
(JSONB) já existente, guardando:

```json
{ "apiKey": "a-chave-d360-api-key", "wabaId": "id-da-conta-comercial", "webhookToken": "gerado-automaticamente-na-criação" }
```

`webhookToken` é uma string aleatória (ex: `crypto.randomBytes(24).toString('hex')`),
única por canal, usada só para identificar de qual canal é cada webhook recebido — não
é secreta no sentido de "só o admin vê" (o admin nunca precisa digitá-la), é gerada e
gerenciada inteiramente pelo backend.

**Por que `wabaId` também é necessário aqui, mesmo não sendo exigido pelas chamadas de
API da 360dialog (seção 2):** o sistema já armazena templates associados a um `wabaId`
(`template.repository.js`, ver seção 7) — é assim que `findChannelByWabaId` liga um
template de volta ao canal certo para editar/excluir. Em vez de inventar um segundo
conceito de identificador só para canais `360dialog`, o admin informa o WABA ID (visível
tanto no painel da 360dialog quanto no Business Manager da Meta — é um identificador do
Meta, não específico de nenhum BSP) na hora de criar o canal, e ele é usado exatamente
como já é para `meta_cloud`.

## 4. Configuração de ambiente

O registro automático do webhook (seção 6) precisa que o backend saiba sua própria URL
pública, algo que hoje não existe — o webhook do `meta_cloud` é configurado manualmente
pelo admin no painel da Meta, então o backend nunca precisou se conhecer.

`src/config/env.js` ganha uma nova variável obrigatória:

```js
function loadConfig() {
  const required = [
    'DATABASE_URL',
    'JWT_SECRET',
    'REDIS_URL',
    'META_VERIFY_TOKEN',
    'META_APP_SECRET',
    'BAILEYS_SESSIONS_DIR',
    'MEDIA_STORAGE_DIR',
    'PUBLIC_BASE_URL',
  ];
  // ...
  return {
    // ...campos existentes...
    publicBaseUrl: process.env.PUBLIC_BASE_URL,
  };
}
```

`PUBLIC_BASE_URL` é a URL pública onde o backend está hospedado (ex:
`https://dw-whatsapp-backend.onrender.com`), sem barra no final. Precisa estar
configurada no `.env`/`.env.test` locais e nas variáveis de ambiente do Render antes do
deploy desta feature — mesma disciplina de "migração antes do deploy" já usada em
features anteriores desta sessão.

## 5. Adapter da 360dialog

Novo módulo `src/whatsapp-adapters/three-sixty-dialog.adapter.js`, mesmo contrato do
`meta-cloud.adapter.js` (mesmas funções exportadas, mesma assinatura), para que
`outbound-worker.js` e `template.service.js` consigam trocar de adapter sem saber qual é
qual:

```js
const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');
const { getMediaFilePath } = require('../media/media-storage');
const {
  parseInboundMessages,
  parseStatusUpdates,
  parseTemplateStatusUpdates,
} = require('./meta-cloud.adapter');

const BASE_URL = 'https://waba-v2.360dialog.io';

function authHeaders(channel) {
  return { 'D360-API-KEY': channel.config.apiKey };
}

async function sendTextMessage(channel, toPhoneNumber, content, { repliedToWhatsappMessageId } = {}) {
  const body = {
    messaging_product: 'whatsapp',
    to: toPhoneNumber,
    type: 'text',
    text: { body: content },
  };
  if (repliedToWhatsappMessageId) {
    body.context = { message_id: repliedToWhatsappMessageId };
  }
  const response = await axios.post(`${BASE_URL}/messages`, body, { headers: authHeaders(channel) });
  return { whatsappMessageId: response.data.messages[0].id };
}

async function sendMediaMessage(channel, toPhoneNumber, { messageType, mediaPath, mediaMimeType, mediaFilename, caption, repliedToWhatsappMessageId }) {
  const buffer = await fs.promises.readFile(getMediaFilePath(mediaPath));

  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('file', buffer, { filename: mediaFilename || 'file', contentType: mediaMimeType });
  const uploadResponse = await axios.post(`${BASE_URL}/media`, form, {
    headers: { ...form.getHeaders(), ...authHeaders(channel) },
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
  const response = await axios.post(`${BASE_URL}/messages`, messagePayload, { headers: authHeaders(channel) });
  return { whatsappMessageId: response.data.messages[0].id };
}

async function sendTemplateMessage(channel, toPhoneNumber, { name, language, variables, headerType, headerLink }) {
  const components = [];
  if (headerType && headerLink) {
    components.push({ type: 'header', parameters: [{ type: headerType, [headerType]: { link: headerLink } }] });
  }
  if (variables.length > 0) {
    components.push({ type: 'body', parameters: variables.map((v) => ({ type: 'text', text: v })) });
  }
  const response = await axios.post(
    `${BASE_URL}/messages`,
    { messaging_product: 'whatsapp', to: toPhoneNumber, type: 'template', template: { name, language: { code: language }, components } },
    { headers: authHeaders(channel) }
  );
  return { whatsappMessageId: response.data.messages[0].id };
}

async function downloadMedia(mediaId, channel) {
  const metaResponse = await axios.get(`${BASE_URL}/${mediaId}`, { headers: authHeaders(channel) });
  const fileResponse = await axios.get(metaResponse.data.url, {
    headers: authHeaders(channel),
    responseType: 'arraybuffer',
  });
  return Buffer.from(fileResponse.data);
}

async function createMetaTemplate(channel, { name, category, language, bodyText }) {
  const response = await axios.post(
    `${BASE_URL}/message_templates`,
    { name, category, language, components: [{ type: 'BODY', text: bodyText }] },
    { headers: authHeaders(channel) }
  );
  return { metaTemplateId: response.data.id, status: response.data.status };
}

async function listMetaTemplates(channel) {
  const response = await axios.get(`${BASE_URL}/message_templates`, { headers: authHeaders(channel) });
  return response.data.data || response.data;
}

async function deleteMetaTemplate(channel, { name, metaTemplateId }) {
  await axios.delete(`${BASE_URL}/message_templates`, {
    headers: authHeaders(channel),
    params: { name, hsm_id: metaTemplateId },
  });
}

async function registerWebhook(channel, webhookUrl) {
  await axios.post(`${BASE_URL}/v1/configs/webhook`, { url: webhookUrl }, { headers: authHeaders(channel) });
}

module.exports = {
  sendTextMessage,
  sendMediaMessage,
  sendTemplateMessage,
  downloadMedia,
  createMetaTemplate,
  listMetaTemplates,
  deleteMetaTemplate,
  registerWebhook,
  // Reaproveitados do adapter da Meta — o payload de webhook tem o mesmo formato.
  parseInboundMessages,
  parseStatusUpdates,
  parseTemplateStatusUpdates,
};
```

Note que `downloadMedia` (baixar mídia recebida) usa uma assinatura ligeiramente
diferente de `downloadMetaMedia` do adapter da Meta (recebe `channel` inteiro em vez de
só `accessToken`, porque a autenticação por header é diferente) — quem chama essa
função (a nova rota de webhook, seção 6) precisa passar `channel`, não só a chave.

**Sobre a URL de download de mídia** (`GET ${BASE_URL}/${mediaId}`): a Meta usa esse
mesmo padrão (`graph.facebook.com/v20.0/{mediaId}`) para obter a URL temporária do
arquivo antes de baixar — mantendo consistência com o que já existe, assumindo que a
360dialog espelha esse comportamento por trás do mesmo proxy da Cloud API (mesma classe
de suposição sinalizada na seção 2, a confirmar no primeiro teste real).

## 6. Webhook — rota, roteamento por token, registro automático

**Rota nova**, `src/whatsapp-adapters/three-sixty-dialog.routes.js`:

```js
const express = require('express');
const threeSixtyDialogAdapter = require('./three-sixty-dialog.adapter');
const { findChannelByWebhookToken } = require('../channels/channel.repository');
const { ingestInboundMessage } = require('../conversations/inbound-message.service');
const { applyTemplateStatusUpdates } = require('../templates/template.service');
const { applyMessageStatusUpdates } = require('../conversations/message-status.service');
const { saveMediaFile, extensionForMimeType } = require('../media/media-storage');

const router = express.Router();

router.post('/360dialog/:webhookToken', async (req, res) => {
  const channel = await findChannelByWebhookToken(req.params.webhookToken);
  if (!channel || channel.hidden) {
    return res.sendStatus(404);
  }

  const inboundMessages = threeSixtyDialogAdapter.parseInboundMessages(req.body);
  for (const inboundMessage of inboundMessages) {
    try {
      let mediaPath;
      if (inboundMessage.mediaId) {
        const buffer = await threeSixtyDialogAdapter.downloadMedia(inboundMessage.mediaId, channel);
        mediaPath = await saveMediaFile(buffer, extensionForMimeType(inboundMessage.mediaMimeType));
      }
      await ingestInboundMessage({
        channelId: channel.id,
        fromPhoneNumber: inboundMessage.fromPhoneNumber,
        contactDisplayName: inboundMessage.contactDisplayName,
        whatsappMessageId: inboundMessage.whatsappMessageId,
        messageType: inboundMessage.messageType,
        content: inboundMessage.content,
        mediaPath,
        mediaMimeType: inboundMessage.mediaMimeType,
        mediaFilename: inboundMessage.mediaFilename,
        locationLatitude: inboundMessage.latitude,
        locationLongitude: inboundMessage.longitude,
      });
    } catch (err) {
      console.error('Failed to process inbound 360dialog message', err);
    }
  }
  try {
    await applyTemplateStatusUpdates(req.body);
  } catch (err) {
    console.error('Failed to process 360dialog template status update webhook', err);
  }
  try {
    await applyMessageStatusUpdates(req.body);
  } catch (err) {
    console.error('Failed to process 360dialog message status update webhook', err);
  }
  res.sendStatus(200);
});

module.exports = router;
```

Montada em `src/server.js` junto com a rota da Meta:
```js
app.use('/webhooks', threeSixtyDialogRoutes);
```
(o path completo fica `/webhooks/360dialog/:webhookToken`, ao lado de `/webhooks/meta`
já existente).

Não precisa de verificação de assinatura — o `webhookToken` na própria URL já cumpre
esse papel (só quem tem a URL exata, que só nós e a 360dialog conhecemos, consegue
mandar um webhook válido). Não existe endpoint `GET` de verificação tipo
`hub.challenge` para esse provedor (confirmado na seção 2), então essa rota só precisa
do `POST`.

**`src/channels/channel.repository.js`** ganha a função de busca por token:
```js
async function findChannelByWebhookToken(webhookToken) {
  const result = await getPool().query(
    `SELECT id, type, name, phone_number, config, status, triage_enabled, hidden, welcome_message, created_at FROM channels
     WHERE type = '360dialog' AND config->>'webhookToken' = $1`,
    [webhookToken]
  );
  if (result.rowCount === 0) return null;
  return toChannel(result.rows[0]);
}
```

**Registro automático na criação do canal** — `src/api/admin-channels.routes.js`,
dentro do `POST /` (mesmo handler que já trata `meta_cloud`/`baileys`):
```js
if (type === '360dialog') {
  const { apiKey, wabaId } = req.body;
  if (!apiKey || !wabaId) {
    return res.status(400).json({ error: 'apiKey and wabaId are required for 360dialog channels' });
  }
  const webhookToken = crypto.randomBytes(24).toString('hex');
  const config = { apiKey, wabaId, webhookToken };
  const webhookUrl = `${loadConfig().publicBaseUrl}/webhooks/360dialog/${webhookToken}`;
  try {
    await threeSixtyDialogAdapter.registerWebhook({ config }, webhookUrl);
  } catch (err) {
    return res.status(400).json({ error: 'Não foi possível registrar o webhook na 360dialog — confira a API Key' });
  }
  const channel = await createChannel({ type, name, phoneNumber, config });
  return res.status(201).json(channel);
}
```
(`crypto` precisa ser importado no topo do arquivo; `loadConfig`/`threeSixtyDialogAdapter`
também.) Se o registro do webhook falhar, o canal **não** é criado — falha atômica, o
admin vê o erro na hora e pode corrigir a API Key antes de tentar de novo.

## 7. Generalizar as regras de negócio de "canal oficial"

Hoje várias partes do código checam `channel.type === 'meta_cloud'` para decisões que
são sobre **ser um canal oficial** (não sobre a chamada técnica específica). Isso vira
uma constante compartilhada:

`src/channels/channel.repository.js` (ou um novo arquivo pequeno
`src/channels/channel-types.js`, para não criar dependência circular):
```js
const OFFICIAL_CHANNEL_TYPES = ['meta_cloud', '360dialog'];

function isOfficialChannelType(type) {
  return OFFICIAL_CHANNEL_TYPES.includes(type);
}

module.exports = { OFFICIAL_CHANNEL_TYPES, isOfficialChannelType };
```

Pontos que passam a usar `isOfficialChannelType(channel.type)` em vez de
`channel.type === 'meta_cloud'` — `src/api/conversations.routes.js` tem **três** pontos
distintos, não um só (confirmado lendo o handler `/start` completo, linhas 85-173):

- Linha 85, o gate geral do tipo de canal:
  `if (channel.type !== 'baileys' && channel.type !== 'meta_cloud') { return 400 'Unsupported channel type' }`
  vira `if (channel.type !== 'baileys' && !isOfficialChannelType(channel.type))`.
- Linha 122, `template.wabaId !== channel.config.wabaId` — **não muda**, já funciona
  para `360dialog` sem nenhuma alteração, porque a seção 3 já garante que canais
  `360dialog` guardam `wabaId` no `config` exatamente como `meta_cloud`.
- Linha 166, o disparo da mensagem de abertura da feature "Atribuir um atendimento":
  `if (channel.type !== 'meta_cloud') { await sendOpeningMessageIfApplicable(...) }` —
  aqui a lógica é invertida (pula o disparo justamente PARA `meta_cloud`, porque a
  mensagem de abertura é texto livre e `meta_cloud` está fora da janela de 24h nesse
  fluxo — ver `docs/superpowers/specs/2026-09-10-assignment-message-design.md`, a
  correção feita na revisão final daquela feature). Canais `360dialog` têm exatamente a
  mesma restrição de janela de 24h num `/start`, então essa condição vira
  `if (!isOfficialChannelType(channel.type))` — pula o disparo pra `meta_cloud` E
  `360dialog` igualmente, dispara só pra `baileys`.

Fora desse arquivo:
- `src/api/admin-integrations.routes.js`, `modeForChannel` (decide modo `'template'` vs
  `'freetext'` da integração SGP) — troca `channel.type === 'meta_cloud' ? 'template' : 'freetext'`
  por `isOfficialChannelType(channel.type) ? 'template' : 'freetext'`.
- `src/templates/template.service.js`, os dois pontos que hoje travam
  `channel.type !== 'meta_cloud'` em `createTemplate`/`registerExistingTemplate` viram
  `!isOfficialChannelType(channel.type)`.

**`src/templates/template.service.js`** também para de fixar `metaCloudAdapter`
diretamente e passa a escolher o adapter certo pelo tipo do canal, no mesmo espírito do
mapa que `outbound-worker.js` já usa:
```js
const metaCloudAdapter = require('../whatsapp-adapters/meta-cloud.adapter');
const threeSixtyDialogAdapter = require('../whatsapp-adapters/three-sixty-dialog.adapter');

const ADAPTERS_BY_CHANNEL_TYPE = {
  meta_cloud: metaCloudAdapter,
  '360dialog': threeSixtyDialogAdapter,
};
```
Toda chamada que hoje é `metaCloudAdapter.createMetaTemplate(channel, ...)` (e as
outras três: `listMetaTemplates`, `deleteMetaTemplate`, e o uso em
`applyTemplateStatusUpdates`/`syncTemplatesForWaba`) vira
`ADAPTERS_BY_CHANNEL_TYPE[channel.type].createMetaTemplate(channel, ...)`. A única
exceção é `applyTemplateStatusUpdates(webhookBody)`, que hoje chama
`metaCloudAdapter.parseTemplateStatusUpdates` sem saber de qual canal veio o webhook —
como a seção 5 reaproveita a MESMA função de parsing do adapter da Meta para o adapter
da 360dialog (são literalmente a mesma implementação, re-exportada), essa chamada
continua funcionando sem mudança nenhuma nessa função especificamente.

**`src/queue/outbound-worker.js`** ganha uma linha no mapa que já existe:
```js
const threeSixtyDialogAdapter = require('../whatsapp-adapters/three-sixty-dialog.adapter');

const ADAPTERS_BY_CHANNEL_TYPE = {
  meta_cloud: metaCloudAdapter,
  baileys: baileysManager,
  '360dialog': threeSixtyDialogAdapter,
};
```

**`src/channels/channel.repository.js`**, `findChannelByWabaId` hoje filtra
`WHERE type = 'meta_cloud'` — precisa virar type-agnóstico (`WHERE config->>'wabaId' = $1`,
sem filtrar por `type`), já que agora tanto `meta_cloud` quanto `360dialog` guardam
`wabaId` no `config` e um WABA ID pertence exatamente a uma conta, então não há
ambiguidade em remover o filtro de tipo:
```js
async function findChannelByWabaId(wabaId) {
  const result = await getPool().query(
    `SELECT id, type, name, phone_number, config, status, triage_enabled, hidden, welcome_message, created_at FROM channels
     WHERE config->>'wabaId' = $1
     LIMIT 1`,
    [wabaId]
  );
  if (result.rowCount === 0) return null;
  return toChannel(result.rows[0]);
}
```

**`src/channels/channel.repository.js`**, `updateChannelWabaId` hoje só permite editar
o WABA ID de canais `meta_cloud` (`WHERE id = $1 AND type = 'meta_cloud'`) — como
canais `360dialog` também guardam `wabaId`, o `WHERE` vira
`WHERE id = $1 AND type IN ('meta_cloud', '360dialog')` (lista literal, igual à da
constraint do banco — mais simples que passar um array pelo driver do Postgres só pra
isso).

**`src/api/admin-channels.routes.js`**, a função `toChannelResponse` que hoje só expõe
`wabaId` para `meta_cloud` (`channel.type === 'meta_cloud' ? channel.config.wabaId :
undefined`) passa a usar `isOfficialChannelType(channel.type)` no lugar da comparação
direta, para expor `wabaId` também em canais `360dialog`; a mensagem de erro genérica no
fim do handler `POST /` (`'type must be meta_cloud or baileys'`) vira
`'type must be meta_cloud, baileys, or 360dialog'`.

## 8. Frontend

**`frontend/src/components/CreateChannelModal.jsx`** — terceiro item em `TYPE_OPTIONS`:
```js
{
  value: '360dialog',
  label: '360dialog (oficial via BSP)',
  description: 'API oficial via 360dialog — precisa só da API Key (D360-API-KEY).',
},
```

**`frontend/src/components/CreateChannelForm.jsx`** — novos campos condicionais por
tipo, substituindo os campos de `meta_cloud` quando `type === '360dialog'` (reaproveita
o mesmo `useState` de `wabaId` que `meta_cloud` já usa, já que o significado é o
mesmo — só ganha um novo `useState` para `apiKey`):
```jsx
{type === '360dialog' && (
  <>
    <div>
      <label htmlFor="apiKey" className={labelClass}>
        API Key (D360-API-KEY)
      </label>
      <input id="apiKey" value={apiKey} onChange={(e) => setApiKey(e.target.value)} className={inputClass} required />
    </div>
    <div>
      <label htmlFor="wabaId360" className={labelClass}>
        WABA ID
      </label>
      <input id="wabaId360" value={wabaId} onChange={(e) => setWabaId(e.target.value)} className={inputClass} required />
    </div>
  </>
)}
```
O `payload` montado em `handleSubmit` passa a ter três ramos:
```js
const payload =
  type === 'meta_cloud'
    ? { type, name, phoneNumber, phoneNumberId, accessToken, wabaId }
    : type === '360dialog'
      ? { type, name, phoneNumber, apiKey, wabaId }
      : { type, name, phoneNumber };
```
(o `id` do segundo campo é `wabaId360`, diferente do `wabaId` usado pelos campos de
`meta_cloud`, só para não colidir — os dois nunca aparecem juntos na tela, mas os `id`s
de elementos DOM precisam ser únicos por página.)

**`frontend/src/services/api.js`** — `createChannel` já aceita um payload genérico
(`{type, name, phoneNumber, ...}`), não precisa de mudança.

## 9. Testes

Backend (Jest):

- `three-sixty-dialog.adapter.test.js` — mirror do `meta-cloud.adapter.test.js` pras
  funções próprias (`sendTextMessage`, `sendMediaMessage`, `sendTemplateMessage`,
  `createMetaTemplate`, `listMetaTemplates`, `deleteMetaTemplate`, `registerWebhook`),
  mockando `axios` e conferindo a URL base (`waba-v2.360dialog.io`) e o header
  `D360-API-KEY` em cada chamada — não precisa reescrever teste pras funções
  reaproveitadas (`parseInboundMessages` etc.), já cobertas em `meta-cloud.adapter.test.js`.
- `channel.repository.test.js` — `findChannelByWebhookToken` (integração real-Postgres,
  mesmo padrão dos outros finders).
- `admin-channels.routes.test.js` — criação de canal `360dialog` com sucesso (mocka
  `registerWebhook`), 400 sem `apiKey`, 400 sem `wabaId`, 400 quando `registerWebhook`
  falha (e confirma que `createChannel` não foi chamado nesse caso — falha atômica).
- `three-sixty-dialog.routes.test.js` — mirror de `meta-cloud.routes.test.js`: webhook
  válido processa mensagem, token inexistente retorna 404, canal oculto retorna 404.
- `outbound-worker.test.js` — canal `360dialog` usa o adapter certo (mesmo padrão dos
  testes existentes pra `meta_cloud`/`baileys`).
- `template.service.test.js` (se existir com esse nome — confirmar) — `createTemplate`/
  `registerExistingTemplate`/etc. funcionam para canal `360dialog` chamando o adapter
  certo, e continuam rejeitando canal `baileys`.
- `conversations.routes.test.js` — três casos: `/start` exige template para canal
  `360dialog` (mesmo teste que já existe pra `meta_cloud`, variação de tipo); `/start`
  aceita canal `360dialog` no gate geral de tipo (não cai mais em "Unsupported channel
  type"); `/start` NÃO dispara `sendOpeningMessageIfApplicable` para canal `360dialog`
  (mesmo comportamento já testado para `meta_cloud`).
- `admin-integrations.routes.test.js` — `modeForChannel` retorna `'template'` para
  canal `360dialog`.

Frontend (Vitest):

- `CreateChannelModal.test.jsx` — terceiro cartão aparece e leva ao formulário certo.
- `CreateChannelForm.test.jsx` — campo `apiKey` aparece só para `type === '360dialog'`,
  payload montado correto pros três tipos.

## 10. Fora de escopo (YAGNI)

- Fluxo de onboarding assistido (a 360dialog tem um fluxo de "connect" com verificação
  facilitada da Meta) — o admin cria a conta e obtém a API Key diretamente no painel da
  360dialog, fora do nosso sistema; nosso sistema só consome a chave já pronta.
- Migração automática de um canal `meta_cloud` existente para `360dialog` ou vice-versa
  — não pedido.
- Suporte a múltiplos webhooks por canal (`multi_webhook` da 360dialog) — um webhook por
  canal já cobre o caso de uso.
- Validar a API Key de forma síncrona sem de fato registrar o webhook (ex: uma chamada
  de "ping") — o próprio registro do webhook já serve como validação da chave.
