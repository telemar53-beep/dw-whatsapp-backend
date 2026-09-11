# Auto-resposta por horário de atendimento

**Status:** Aprovado (aguardando revisão final do usuário antes do plano de implementação)
**Data:** 2026-09-11

## 1. Problema e objetivo

Hoje, quando um cliente manda mensagem fora do horário de expediente, ele não recebe
nenhum aviso — fica sem resposta até um atendente ver na volta. O usuário quer um aviso
automático informando o horário de funcionamento, 3ª das 4 features levantadas na mesma
conversa (`[[project_bulk_campaign]]`, `[[project_contact_internal_note]]`).

Decisões já confirmadas pelo usuário durante o brainstorming:

1. Horário **único pra empresa toda** (não por canal).
2. **Mesmo horário todo dia útil** (segunda-sexta); sábado/domingo sempre fora do
   expediente — sem grade por dia da semana.
3. O aviso dispara **no máximo 1x por atendimento** (não repete a cada mensagem na mesma
   conversa).
4. Fuso horário **fixo em América/São_Paulo**, sem campo de configuração.
5. Se uma conversa **nova** chega fora do horário e a triagem automática (bot de menu)
   está ativa pro canal, dispara **só o aviso de horário**, não inicia a triagem.
6. Se uma conversa **já existente** está no meio da triagem e uma mensagem chega fora do
   horário, a triagem **continua normalmente** — o aviso só é acrescentado, sem
   interromper.
7. O texto do aviso é **editável pelo admin** (texto livre, não gerado automaticamente).

## 2. Modelo de dados

Migração nova (idempotente, `IF NOT EXISTS`/`IF EXISTS`, mesmo padrão já estabelecido
nesta sessão):

```sql
CREATE TABLE IF NOT EXISTS business_hours_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enabled BOOLEAN NOT NULL DEFAULT false,
  start_time TIME NOT NULL DEFAULT '08:00',
  end_time TIME NOT NULL DEFAULT '18:00',
  message TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS business_hours_notice_sent_at TIMESTAMPTZ;
```

Notas de design:

- `business_hours_config` é **singleton** — mesmo padrão de `assignment_message_config`
  (`[[project_assignment_message]]`) e `sgp_query_config`: 0 ou 1 linha, lida com `ORDER
  BY created_at ASC LIMIT 1`. Sem tabelas de agentes/canais associadas — o horário é
  global.
- `start_time`/`end_time` são `TIME` (sem timezone) — sempre interpretados no fuso fixo
  América/São_Paulo pela aplicação, nunca pelo Postgres. Formato usado em toda a stack
  (banco, API, frontend): string `"HH:MM"` (o input HTML `type="time"` já produz esse
  formato; o Postgres aceita `"HH:MM"` num `TIME` mesmo sem segundos).
- `business_hours_notice_sent_at` fica em `conversations` (não numa tabela separada) —
  mesmo padrão de `protocol_number`: um campo por conversa que, uma vez preenchido,
  nunca mais dispara o efeito de novo naquele atendimento. `NULL` = ainda não avisado.
- **Fora de escopo (YAGNI), confirmado no brainstorming:** grade por dia da semana,
  múltiplos intervalos no mesmo dia, horário por canal, timezone configurável, janela
  que cruza a meia-noite (ex: 22:00–06:00) — `end_time` sempre assumido depois de
  `start_time` no mesmo dia.

## 3. Lógica de horário (fuso fixo, sem nova dependência)

O projeto não tem nenhuma biblioteca de data/timezone (`date-fns`/`luxon`/`dayjs`) — em
vez de adicionar uma, usa `Intl.DateTimeFormat` nativo do Node, mesmo princípio já usado
em `[[project_assignment_message]]`'s `greetingForNow` (mas aquele usa hora do servidor;
aqui precisamos do fuso fixo de Brasília independente de onde o servidor roda).

**`src/business-hours/business-hours.service.js`:**

```js
const TIMEZONE = 'America/Sao_Paulo';

function getSaoPauloParts(date) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const weekday = parts.find((p) => p.type === 'weekday').value; // 'Mon'..'Sun'
  let hour = Number(parts.find((p) => p.type === 'hour').value);
  const minute = Number(parts.find((p) => p.type === 'minute').value);
  // Node's ICU formats midnight as "24" with hour12:false, not "00" — normalize it.
  if (hour === 24) hour = 0;
  return { weekday, hour, minute };
}

function timeStringToMinutes(timeString) {
  const [hours, minutes] = timeString.split(':').map(Number);
  return hours * 60 + minutes;
}

function isOutsideBusinessHours(config, now = new Date()) {
  const { weekday, hour, minute } = getSaoPauloParts(now);
  if (weekday === 'Sat' || weekday === 'Sun') return true;
  const nowMinutes = hour * 60 + minute;
  return nowMinutes < timeStringToMinutes(config.startTime) || nowMinutes >= timeStringToMinutes(config.endTime);
}

module.exports = { isOutsideBusinessHours };
```

**Pegadinha real a evitar** (motivo do `if (hour === 24) hour = 0`): com
`hour12: false`, o `Intl.DateTimeFormat` do Node formata meia-noite como `"24"` em vez de
`"00"` — sem essa normalização, `nowMinutes` viraria `1440` à meia-noite exata,
`>= endMinutes` seria `true` (correto por acidente) mas `< startMinutes` nunca seria
avaliado corretamente em comparações futuras que dependam do valor cru. Testado
explicitamente (seção 6).

`isOutsideBusinessHours` é uma função pura (recebe `now` como parâmetro, default
`new Date()`) — fácil de testar determinística sem mockar relógio do sistema.

## 4. Integração em `inbound-message.service.js`

Ponto de integração único: `src/conversations/inbound-message.service.js`, a mesma
função (`ingestInboundMessage`) que já orquestra boas-vindas
(`[[project_channel_welcome_message]]`) e aviso por cidade (`[[project_city_notice]]`).

Duas mudanças, nesta ordem dentro da função:

**a) Antes de decidir se inicia a triagem** (controla a decisão 5 do brainstorming — não
iniciar triagem numa conversa nova fora do horário):

```js
const businessHoursConfig = await getBusinessHoursConfig();
const outsideBusinessHours = businessHoursConfig.enabled && isOutsideBusinessHours(businessHoursConfig);

let conversation = await findOpenConversation(contact.id, channelId);
if (conversation && conversation.status === 'silent') {
  conversation = await activateConversation(conversation.id);
}
let justCreated = false;
if (!conversation) {
  const startTriage = !outsideBusinessHours && (await shouldStartTriage(channelId));
  try {
    conversation = await createConversation(contact.id, channelId, startTriage ? 'pending' : null);
    justCreated = true;
  } catch (err) {
    if (err.code !== UNIQUE_VIOLATION) throw err;
    conversation = await findOpenConversation(contact.id, channelId);
  }
}
```

**b) Depois da mensagem de boas-vindas e do aviso por cidade, antes do bloco de
triagem** (controla a decisão 6 — não interrompe triagem já em andamento, só acrescenta
o aviso):

```js
if (outsideBusinessHours && !conversation.businessHoursNoticeSentAt) {
  try {
    await enqueueOutboundMessage({ conversationId: conversation.id, channelId, content: businessHoursConfig.message });
    conversation = await markBusinessHoursNoticeSent(conversation.id);
  } catch (err) {
    console.error(`Failed to send business hours notice for conversation ${conversation.id}`, err);
  }
}

if (justCreated) {
  try {
    if (conversation.triageState === 'pending') {
      await sendTriageQuestion(conversation.id, channelId);
    }
  } catch (err) { ... }
} else if (!justCreated && conversation.triageState === 'pending') {
  conversation = await processTriageReply(conversation, channelId, content);
}
```

Notas de design:

- `businessHoursConfig` é buscado **uma única vez** no início da função e reaproveitado
  nos dois pontos — evita duas idas ao banco pra mesma config.
- Ordem das mensagens automáticas quando várias se aplicam à mesma conversa nova fora do
  horário: boas-vindas → aviso por cidade → aviso de horário → (sem triagem). A
  saudação genérica vem primeiro, o aviso operacional por último — mesma lógica de
  "mais específico por último" já usada nas duas features anteriores.
- Igual ao padrão já estabelecido pras outras duas mensagens automáticas: erro dentro do
  bloco é só capturado e logado (`console.error`), nunca propaga — uma falha ao enviar o
  aviso de horário não pode impedir a mensagem do cliente de ser processada/persistida.
- `outsideBusinessHours` não depende de `conversation` — é calculado antes de qualquer
  lookup/criação de conversa, então pode ser usado tanto na decisão de triagem quanto,
  depois, na decisão de disparo do aviso.

## 5. Mudanças em `conversation.repository.js`

Mesmo princípio do `protocol_number` em `[[project_assignment_message]]`: só as funções
que `inbound-message.service.js` efetivamente consome ganham a coluna nova — não é
necessário tocar as funções de listagem/fila (nada ali usa esse campo).

- `toConversation(row)` ganha `businessHoursNoticeSentAt: row.business_hours_notice_sent_at`.
- `findOpenConversation`, `createConversation`, `activateConversation` — as três funções
  que alimentam a variável `conversation` dentro de `ingestInboundMessage` — ganham
  `business_hours_notice_sent_at` na lista de colunas do `SELECT`/`RETURNING`.
- Função nova `markBusinessHoursNoticeSent(conversationId)`:

```js
async function markBusinessHoursNoticeSent(conversationId) {
  const result = await getPool().query(
    `UPDATE conversations SET business_hours_notice_sent_at = now() WHERE id = $1
     RETURNING id, contact_id, channel_id, status, assigned_agent_id, sector_id, triage_state, triage_attempts, business_hours_notice_sent_at, created_at, updated_at`,
    [conversationId]
  );
  return toConversation(result.rows[0]);
}
```

## 6. Backend — repositório de configuração

**`src/business-hours/business-hours.repository.js`** (mirror do padrão singleton de
`assignment-message.repository.js`, sem as tabelas de agentes/canais):

```js
function toConfig(row) {
  return {
    id: row.id,
    enabled: row.enabled,
    startTime: row.start_time.slice(0, 5), // Postgres TIME retorna "08:00:00"
    endTime: row.end_time.slice(0, 5),
    message: row.message,
  };
}

async function getBusinessHoursConfig() {
  const result = await getPool().query('SELECT * FROM business_hours_config ORDER BY created_at ASC LIMIT 1');
  if (result.rowCount === 0) {
    return { id: null, enabled: false, startTime: '08:00', endTime: '18:00', message: '' };
  }
  return toConfig(result.rows[0]);
}

async function upsertBusinessHoursConfig({ enabled, startTime, endTime, message }) {
  const existing = await getPool().query('SELECT id FROM business_hours_config ORDER BY created_at ASC LIMIT 1');
  if (existing.rowCount === 0) {
    const inserted = await getPool().query(
      `INSERT INTO business_hours_config (enabled, start_time, end_time, message)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [enabled, startTime, endTime, message]
    );
    return toConfig(inserted.rows[0]);
  }
  const updated = await getPool().query(
    `UPDATE business_hours_config SET enabled = $2, start_time = $3, end_time = $4, message = $5, updated_at = now()
     WHERE id = $1 RETURNING *`,
    [existing.rows[0].id, enabled, startTime, endTime, message]
  );
  return toConfig(updated.rows[0]);
}

module.exports = { getBusinessHoursConfig, upsertBusinessHoursConfig };
```

Sem `withTransaction` aqui (diferente de `assignment-message.repository.js`) — não há
tabelas associadas pra manter consistentes, um único `INSERT`/`UPDATE` já é atômico.

## 7. Backend — rota de administração

Novo arquivo `src/api/admin-business-hours.routes.js`, montado em
`/api/admin/business-hours` em `src/server.js`, protegido por `requireAuth` +
`requireRole('admin')` — mesmo padrão exato de `admin-assignment-messages.routes.js`:

- `GET /` → `{ enabled, startTime, endTime, message }`.
- `PUT /` → body `{ enabled, startTime, endTime, message }`. Validação:
  - `startTime`/`endTime` devem bater `/^([01]\d|2[0-3]):[0-5]\d$/` (HH:MM, 24h) → 400
    `{ error: 'startTime must be in HH:MM format' }` (mesma mensagem pro `endTime`).
  - `endTime` deve ser estritamente depois de `startTime` (em minutos) → 400
    `{ error: 'endTime must be after startTime' }` — sem suporte a janela que cruza a
    meia-noite (seção 2).
  - `message` deve ser string não-vazia depois de `.trim()` → 400 (sempre obrigatório,
    igual `openingMessage`/`closingMessage` em `[[project_assignment_message]]` —
    não faz sentido ter `enabled=true` com texto vazio).
  - `enabled` é coagido com `Boolean(enabled)`, sem validação de tipo (mesmo padrão do
    `assignment-message` existente).

## 8. Frontend

- **`frontend/src/services/api.js`** — duas funções novas: `getBusinessHoursConfig(token)`
  e `setBusinessHoursConfig(config, token)`.
- **`frontend/src/hooks/useBusinessHoursConfig.js`** — mirror exato de
  `useAssignmentMessageConfig.js`: `{ config, loading, refresh }`.
- **`frontend/src/components/MessagesAdminTab.jsx`** — nova seção "Horário de
  atendimento", adicionada ao final da aba (depois de "Atribuir um atendimento") —
  posição escolhida por ser a adição mais simples, sem reordenar seções existentes.
  Mesmo padrão visual de card fechado/formulário das outras seções desta sessão:
  - Título + `SectionHelp` explicando o que a feature faz e a regra "1x por
    atendimento".
  - **Estado fechado** (config existe): resumo — "Ativo"/"Inativo" + "das HH:MM às
    HH:MM, seg-sex" — botão "Editar".
  - **Estado "nunca configurado"**: card só com o botão "Criar" (mesmo padrão de
    `ChannelWelcomeMessageRow`/`CityNoticeRow`).
  - **Estado editando**: checkbox "Ativo", dois `<input type="time">` (início/fim),
    textarea "Mensagem", Salvar/Cancelar. `handleCancel` reseta os campos pro valor
    salvo em **todos** os casos, inclusive sem config prévia (regressão já documentada
    em `[[project_admin_ui_declutter]]`).

## 9. Testes

Backend (Jest + `supertest`):

- `business-hours.repository.test.js` — singleton get/upsert (config ausente, criar,
  atualizar).
- `business-hours.service.test.js` — `isOutsideBusinessHours`: dentro do horário
  (dia útil), antes do início, depois do fim, exatamente no início (dentro — inclusive),
  exatamente no fim (fora — exclusive), sábado, domingo, e o caso da pegadinha da meia-
  noite (`new Date('2026-09-14T03:00:00.000Z')` ≈ meia-noite em São Paulo, UTC-3).
- `admin-business-hours.routes.test.js` — `GET`/`PUT`, validação de formato HH:MM,
  validação `endTime > startTime`, validação de mensagem vazia, 403 pra não-admin.
- `inbound-message.service.test.js` (arquivo existente) — casos novos: conversa nova
  fora do horário dispara só o aviso (não a pergunta de triagem); conversa nova DENTRO
  do horário com triagem ativa dispara a pergunta normalmente (regressão); segunda
  mensagem na mesma conversa fora do horário NÃO repete o aviso; conversa existente com
  `triage_state='pending'` fora do horário dispara o aviso E processa a resposta de
  triagem normalmente; config com `enabled=false` nunca dispara nada.
- `conversation.repository.test.js` (arquivo existente) — `markBusinessHoursNoticeSent`
  marca o campo; `findOpenConversation`/`createConversation`/`activateConversation`
  retornam `businessHoursNoticeSentAt`.

Frontend (Vitest + Testing Library):

- `useBusinessHoursConfig.test.js` — mirror de `useAssignmentMessageConfig.test.js`.
- `MessagesAdminTab.test.jsx` (arquivo existente) — casos novos pra seção "Horário de
  atendimento": estado sem config (botão Criar), preencher e salvar, cancelar durante
  criação não deixa rascunho, estado fechado mostra o resumo correto.

## 10. Fora de escopo (YAGNI)

- Horário por canal — usuário confirmou único pra empresa toda.
- Grade por dia da semana / múltiplos intervalos / feriados — usuário confirmou mesmo
  horário todo dia útil, fim de semana sempre fechado.
- Timezone configurável — fixo em América/São_Paulo.
- Janela que cruza a meia-noite (plantão noturno) — `endTime` sempre exigido depois de
  `startTime` no mesmo dia.
- Repetir o aviso mais de 1x por atendimento, ou por outro critério (ex: 1x por dia) —
  usuário confirmou 1x por atendimento.
- Qualquer alteração no comportamento da triagem em si (`triage.service.js`) além de não
  iniciar uma nova — a lógica de perguntas/tentativas/confirmação não muda.
