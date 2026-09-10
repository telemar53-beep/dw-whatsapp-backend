# Atribuir um atendimento — mensagens automáticas de abertura e encerramento

**Status:** Aprovado (aguardando revisão final do usuário antes do plano de implementação)
**Data:** 2026-09-10

## 1. Problema e objetivo

Hoje, quando um atendente assume uma conversa (fila ou nova), o cliente não recebe
nenhuma confirmação automática de que alguém começou a atendê-lo, nem um número de
protocolo para referenciar aquele atendimento depois. O usuário quer:

1. Uma mensagem automática de **abertura**, disparada quando o atendente assume o
   atendimento, contendo saudação por horário + primeiro nome do atendente + um número
   de protocolo sequencial.
2. Uma mensagem automática de **encerramento**, disparada quando o atendimento é
   fechado.
3. Um painel de administração (dentro da aba "Mensagens") para ativar/desativar a
   funcionalidade, editar o texto das duas mensagens, e escolher **quais atendentes** e
   **quais canais** disparam essas mensagens — não é global.

Exemplo literal dado pelo usuário para a mensagem de abertura:
> "Bom dia, meu nome é Geovanna. Irei iniciar seu atendimento, como posso te ajudar? O
> protocolo do seu atendimento é 1042"

Exemplo para a mensagem de encerramento:
> "Estou encerrando seu atendimento! Qualquer dúvida coloco-me prontamente à disposição."

## 2. Escopo do disparo (quando dispara)

- **Abertura:** dispara depois que `claimConversation` (`src/conversations/conversation.repository.js`)
  tem sucesso — isso cobre as duas rotas que a chamam hoje: `POST /:id/claim`
  ("Assumir da fila") e `POST /start` ("Iniciar conversa nova", que internamente chama
  `claimConversation` depois de criar/adotar a conversa).
- **Encerramento:** dispara depois que `closeConversation` tem sucesso (`POST
  /:id/close`).
- **`POST /:id/transfer` NÃO dispara nada** — transferência não é "iniciar" nem
  "encerrar" um atendimento, é a mesma conversa mudando de dono.
- A **abertura** só dispara se **todas** as condições forem verdadeiras: `enabled =
  true` na configuração E o atendente que assumiu está marcado E o canal da conversa
  está marcado (E lógico entre atendente e canal). O **encerramento** tem uma regra
  diferente e mais simples — ver seção 5.

## 3. Modelo de dados

Uma migração nova (idempotente, seguindo o padrão já estabelecido nesta sessão —
`IF NOT EXISTS`/`IF EXISTS` em tudo, porque migrações antigas desse projeto já
precisaram ser pré-aplicadas manualmente em produção antes do deploy):

```sql
CREATE SEQUENCE IF NOT EXISTS assignment_protocol_seq START 1;

CREATE TABLE IF NOT EXISTS assignment_message_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enabled BOOLEAN NOT NULL DEFAULT false,
  opening_message TEXT NOT NULL DEFAULT '',
  closing_message TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS assignment_message_agents (
  agent_id UUID PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS assignment_message_channels (
  channel_id UUID PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE
);

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS protocol_number INTEGER;
```

Notas de design:

- `assignment_message_config` é **singleton** (mesmo padrão de `sgp_query_config`,
  `src/integrations/sgp-query-config.repository.js`): 0 ou 1 linha, lida com `ORDER BY
  created_at ASC LIMIT 1`.
- `assignment_message_agents`/`assignment_message_channels` são listas simples de
  seleção — sem coluna `config_id`, porque só existe uma config no sistema. `ON DELETE
  CASCADE` garante que excluir um atendente ou canal não deixa lixo nessas tabelas.
- `protocol_number` não tem `UNIQUE` — o `SEQUENCE` já garante unicidade dos valores
  gerados, e várias linhas com `NULL` (conversas que nunca dispararam a mensagem) são
  esperadas e não violam nada.
- O protocolo é **sequencial simples, nunca reseta** (não é por dia nem por cidade) —
  decisão já confirmada pelo usuário.

## 4. Geração do protocolo (concorrência)

A lição da feature de aviso por cidade (`[[project_city_notice]]`, corrigiu uma corrida
real de check-then-act) se aplica aqui: gerar o protocolo precisa ser atômico, porque
dois atendentes podem, em teoria, tentar assumir a mesma fila quase ao mesmo tempo.

```sql
UPDATE conversations
SET protocol_number = COALESCE(protocol_number, nextval('assignment_protocol_seq'))
WHERE id = $1
RETURNING protocol_number
```

Isso é seguro por dois motivos:

1. `COALESCE` faz curto-circuito em Postgres (avalia argumentos em ordem e para no
   primeiro não-nulo) — se `protocol_number` já estiver preenchido, `nextval()` **não é
   chamado**, então reexecutar essa query numa conversa que já tem protocolo não
   desperdiça número da sequência nem gera um segundo.
2. O `UPDATE` num `id` específico pega lock de linha — mesmo sob concorrência, duas
   chamadas simultâneas pra essa mesma conversa serializam naturalmente.

Essa função vive no repositório novo (`claimProtocolNumber`, seção 6) e é chamada tanto
na abertura (gera, se ainda não existe) quanto — implicitamente, via o valor já salvo —
reaproveitada no encerramento (ver seção 5).

## 5. Regra de acoplamento abertura/encerramento

Decisão de design: a mensagem de encerramento dispara **sempre que a conversa já tem um
`protocol_number` preenchido** (ou seja, a mensagem de abertura já rodou pra essa
conversa em algum momento) — **independente do estado atual da configuração**
(atendente/canal podem ter sido desmarcados entre a abertura e o encerramento).

Por quê: se a configuração checasse de novo no encerramento, um admin editando a lista
de atendentes/canais no meio de um atendimento em andamento deixaria o par
abertura/encerramento incompleto (cliente recebe a abertura com "vou te avisar quando
encerrar" implícito, mas nunca recebe a mensagem de fechamento) — comportamento confuso
e difícil de depurar. Amarrar a decisão ao `protocol_number` já existente mantém o par
sempre consistente.

Consequência direta: se a abertura **nunca** disparou pra essa conversa (config estava
desligada, ou atendente/canal não bateam no momento do `claim`), o encerramento também
não dispara — não faz sentido mostrar um protocolo que o cliente nunca viu.

## 6. Placeholders (engine de substituição)

Mecanismo **novo e independente** do sistema de templates oficiais da Meta
(`src/templates/template-validator.js`, placeholders numerados `{{1}}`/`{{2}}` —
mecanismo totalmente diferente, usado só para templates aprovados pela Meta). Aqui os
placeholders são nomeados, aplicados em texto livre editável pelo admin:

| Placeholder | Valor |
|---|---|
| `@chat_saudacao_maiusculo` | `Bom dia` / `Boa tarde` / `Boa noite`, automático pelo horário do servidor (capitalização normal de início de frase, não caixa alta total — bate com o exemplo literal do usuário: "Bom dia, meu nome é Geovanna") |
| `@chat_atendente` | Primeiro nome do atendente que assumiu (extraído do campo `name` de `agents`, que é texto livre — `name.trim().split(/\s+/)[0]`) |
| `@chat_protocolo` | O número de protocolo daquele atendimento, como texto simples (ex: `"1042"`) |

Faixas de horário (confirmado pelo usuário):

- `00:00`–`11:59` → Bom dia
- `12:00`–`17:59` → Boa tarde
- `18:00`–`23:59` → Boa noite

Usa o horário local do servidor (`new Date()`) — o projeto não tem nenhuma configuração
de timezone em nenhum outro lugar do código, então não introduzimos uma aqui.

A mensagem de encerramento também suporta os três placeholders (mesma engine,
consistência com a abertura) — na prática só `@chat_atendente` e `@chat_protocolo` fazem
sentido nela, mas nada impede o admin de usar `@chat_saudacao_maiusculo` também se
quiser.

Novo módulo `src/assignment-messages/message-placeholders.js`:

```js
function greetingForNow(date = new Date()) {
  const hour = date.getHours();
  if (hour < 12) return 'Bom dia';
  if (hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

function firstNameOf(fullName) {
  return fullName.trim().split(/\s+/)[0];
}

function substituteAssignmentPlaceholders(template, { agentName, protocolNumber }) {
  return template
    .split('@chat_saudacao_maiusculo').join(greetingForNow())
    .split('@chat_atendente').join(firstNameOf(agentName))
    .split('@chat_protocolo').join(String(protocolNumber));
}

module.exports = { greetingForNow, firstNameOf, substituteAssignmentPlaceholders };
```

## 7. Backend — repositório e serviço

**`src/assignment-messages/assignment-message.repository.js`** (mirror do padrão
singleton de `sgp-query-config.repository.js`):

```js
async function getAssignmentMessageConfig() {
  // SELECT config singleton + agent_id de assignment_message_agents
  // + channel_id de assignment_message_channels
  // retorna { id, enabled, openingMessage, closingMessage, agentIds: [...], channelIds: [...] }
  // (config ausente -> { enabled: false, openingMessage: '', closingMessage: '', agentIds: [], channelIds: [] })
}

async function upsertAssignmentMessageConfig({ enabled, openingMessage, closingMessage, agentIds, channelIds }) {
  // dentro de withTransaction:
  // 1. INSERT se não existe linha / UPDATE se existe (igual upsertSgpQueryConfig)
  // 2. DELETE FROM assignment_message_agents; INSERT novo conjunto de agentIds
  // 3. DELETE FROM assignment_message_channels; INSERT novo conjunto de channelIds
  // retorna o mesmo shape de getAssignmentMessageConfig()
}

async function claimProtocolNumber(conversationId) {
  // UPDATE...COALESCE...RETURNING protocol_number (seção 4)
  // retorna o número (novo ou já existente)
}

module.exports = { getAssignmentMessageConfig, upsertAssignmentMessageConfig, claimProtocolNumber };
```

**`src/assignment-messages/assignment-message.service.js`** — a lógica de gating e
disparo, chamada pelas rotas de conversas:

```js
async function sendOpeningMessageIfApplicable(conversation, agentId) {
  const config = await getAssignmentMessageConfig();
  if (!config.enabled) return;
  if (!config.agentIds.includes(agentId)) return;
  if (!config.channelIds.includes(conversation.channelId)) return;

  const agent = await findAgentById(agentId);
  const protocolNumber = await claimProtocolNumber(conversation.id);
  const content = substituteAssignmentPlaceholders(config.openingMessage, {
    agentName: agent.name,
    protocolNumber,
  });
  await enqueueOutboundMessage({ conversationId: conversation.id, channelId: conversation.channelId, content });
}

async function sendClosingMessageIfApplicable(conversation, agentId) {
  if (!conversation.protocolNumber) return; // seção 5: sem abertura, sem encerramento
  const config = await getAssignmentMessageConfig();
  const agent = await findAgentById(agentId);
  const content = substituteAssignmentPlaceholders(config.closingMessage, {
    agentName: agent.name,
    protocolNumber: conversation.protocolNumber,
  });
  await enqueueOutboundMessage({ conversationId: conversation.id, channelId: conversation.channelId, content });
}

module.exports = { sendOpeningMessageIfApplicable, sendClosingMessageIfApplicable };
```

Notas:

- `sendClosingMessageIfApplicable` **não** repete a checagem de `enabled`/atendente/canal
  — só depende de `protocol_number` já existir (seção 5). O `config.closingMessage`
  ainda precisa ser lido do banco (pode ter sido editado depois da abertura — usa o
  texto atual, não um texto "congelado").
- Erros dentro dessas funções (enqueue falhar, agente não encontrado, etc.) devem ser
  capturados nas rotas com `try/catch` e apenas logados — igual ao padrão já usado pra
  boas-vindas/aviso por cidade em `inbound-message.service.js` — nunca podem derrubar a
  resposta HTTP de `claim`/`start`/`close`, que já fizeram a mudança de estado real
  (assumir/encerrar) com sucesso antes desse passo extra.

**`src/conversations/conversation.repository.js`** — mudanças mínimas: `toConversation()`
ganha `protocolNumber: row.protocol_number`; **apenas** `claimConversation` e
`closeConversation` (as duas únicas funções que o serviço novo consome) ganham
`protocol_number` na lista de colunas do `RETURNING`. As funções de listagem
(`listWaitingConversations`, `listInProgressConversations`, etc.) não mudam — nada
nesta feature as consome, então não há necessidade de tocá-las (YAGNI).

**`src/api/conversations.routes.js`** — três pontos de chamada, cada um dentro de
`try/catch` isolado, **depois** que a resposta de sucesso já foi determinada (não altera
os status codes existentes):

- `POST /:id/claim`, depois de `claimConversation` ter sucesso: `await
  sendOpeningMessageIfApplicable(conversation, req.agent.agentId)`.
- `POST /start`, depois de `claimed` ter sucesso (mesmo ponto onde já dispara o
  `enqueueOutboundMessage` do conteúdo digitado pelo atendente — a mensagem de
  atribuição dispara **antes** dessa, pra soar como uma saudação natural seguida do
  conteúdo real).
- `POST /:id/close`, depois de `closeConversation` ter sucesso: `await
  sendClosingMessageIfApplicable(conversation, req.agent.agentId)`.

## 8. Backend — rotas de administração

Novo arquivo `src/api/admin-assignment-messages.routes.js`, montado em
`/api/admin/assignment-message` (mesmo padrão de montagem dos outros —
`app.use('/api/admin/assignment-message', adminAssignmentMessagesRoutes)` em
`src/server.js`), protegido por `requireAuth` + `requireRole('admin')`:

- `GET /` → retorna `{ enabled, openingMessage, closingMessage, agentIds, channelIds }`.
- `PUT /` → body `{ enabled, openingMessage, closingMessage, agentIds, channelIds }`.
  Validação: `agentIds`/`channelIds` devem ser arrays (mesmo padrão de `PUT
  /:id/sectors` em `admin-agents.routes.js` — `Array.isArray`, 400 se não for);
  `openingMessage`/`closingMessage` devem ser strings não-vazias depois de `.trim()`
  (sempre, não só quando `enabled=true` — não faz sentido ter texto vazio configurado).
  Não exige que `agentIds`/`channelIds` tenham pelo menos 1 item — uma config ativa sem
  ninguém marcado é um estado válido (só não dispara pra ninguém ainda).

## 9. Frontend

**`frontend/src/services/api.js`** — duas funções novas: `getAssignmentMessageConfig(token)`
e `setAssignmentMessageConfig(config, token)`.

**`frontend/src/hooks/useAssignmentMessageConfig.js`** — mirror exato de
`useSgpQueryConfig.js`: `{ config, loading, refresh }`.

**`frontend/src/components/MessagesAdminTab.jsx`** — nova seção "Atribuir um
atendimento", posicionada depois de "Avisos por cidade" e antes de "Respostas rápidas".
Segue o mesmo padrão visual de card fechado/formulário que todas as outras seções desta
sessão:

- Título + `SectionHelp` ("O que é isso?") explicando os três placeholders com o exemplo
  literal do usuário.
- **Estado fechado** (config existe): resumo em uma linha — "Ativo"/"Inativo" (reusa
  `CityStatusDot`), quantos atendentes e quantos canais marcados (ex: "3 atendentes, 2
  canais") — botão "Editar".
- **Estado "nunca configurado"**: card com só o botão "Criar" (mesmo padrão de
  `ChannelWelcomeMessageRow`/`CityNoticeRow` quando não há config ainda).
- **Estado editando** (formulário): campos, nesta ordem —
  1. Checkbox "Ativo"
  2. Textarea "Mensagem de abertura" (placeholder de exemplo com os três tokens)
  3. Textarea "Mensagem de encerramento" (placeholder de exemplo)
  4. Lista de checkboxes "Atendentes" — usa `useAgentsAdmin(true)` (hook já existente),
     mesmo padrão de toggle usado em `AgentRow` (`AgentsAdminTab.jsx`, função
     `toggleSector`, adaptada para `toggleAgent`)
  5. Lista de checkboxes "Canais" — usa `useChannels(true)` (hook já existente), mesmo
     padrão de toggle
  6. Salvar / Cancelar

O componente novo (`AssignmentMessageSection`, local ao arquivo, mesmo padrão dos
outros) troca esses 3 estados numa única instância montada — então, como já corrigido no
bug do `SgpQueryConfigCard` (`[[project_admin_ui_declutter]]`), o `handleCancel` precisa
resetar os campos pro valor salvo em **todos** os casos, inclusive quando ainda não
havia config salva (reset pra vazio/desmarcado nesse caso), não só quando `config.id`
existe.

## 10. Testes

Backend (Jest + `supertest`, seguindo os arquivos `*.test.js` já existentes ao lado de
cada arquivo novo):

- `assignment-message.repository.test.js` — singleton get/upsert (config ausente,
  criar, atualizar, substituir listas de agentIds/channelIds), `claimProtocolNumber`
  (gera na primeira chamada, reaproveita em chamadas seguintes, não desperdiça valores
  da sequência).
- `message-placeholders.test.js` — `greetingForNow` nos 3 limites de horário (11:59,
  12:00, 17:59, 18:00, 23:59, 00:00), `firstNameOf` com nome de uma palavra/várias
  palavras/espaços extras, `substituteAssignmentPlaceholders` com os três tokens
  presentes/ausentes/repetidos no mesmo texto.
- `assignment-message.service.test.js` — `sendOpeningMessageIfApplicable`: não dispara
  se `enabled=false`, não dispara se atendente fora da lista, não dispara se canal fora
  da lista, dispara e chama `enqueueOutboundMessage` com o texto substituído quando as 3
  condições batem. `sendClosingMessageIfApplicable`: não dispara se
  `protocolNumber` é `null`, dispara reaproveitando o protocolo existente mesmo que a
  config atual não bata mais com o atendente/canal (trava da seção 5).
- `admin-assignment-messages.routes.test.js` — `GET`/`PUT`, validação de array,
  validação de mensagens vazias, 403 para não-admin.
- `conversations.routes.test.js` (arquivo existente) — casos novos: `/claim` chama
  `sendOpeningMessageIfApplicable`; `/start` idem; `/close` chama
  `sendClosingMessageIfApplicable`; `/transfer` **não** chama nenhuma das duas; falha
  dentro dessas funções não derruba a resposta 200/201 da rota.

Frontend (Vitest + Testing Library):

- `useAssignmentMessageConfig.test.js` — mirror de `useSgpQueryConfig.test.jsx`.
- `MessagesAdminTab.test.jsx` (arquivo existente) — casos novos pra seção "Atribuir um
  atendimento": estado sem config (botão Criar), preencher formulário e salvar, cancelar
  durante criação não deixa rascunho (regressão do mesmo bug da seção 9), toggle de
  atendentes/canais marca/desmarca corretamente, estado fechado mostra o resumo
  correto.
- Checar `AdminChannelsPage.test.jsx` (arquivo existente) — padrão recorrente já
  documentado em `[[project_admin_ui_declutter]]`: esse arquivo renderiza os
  componentes filhos de verdade na troca de aba, então pode precisar de um ajuste
  mínimo se alguma asserção dependia do conteúdo antigo da aba Mensagens.

## 11. Fora de escopo (YAGNI)

- Protocolo por dia/reset periódico — usuário confirmou sequencial simples, sem reset.
- Placeholder de nome completo do atendente (só primeiro nome, confirmado).
- Disparo em transferência — explicitamente excluído (seção 2).
- Qualquer alteração no sistema de templates oficiais da Meta — mecanismo totalmente
  separado, não tocado por esta feature.
