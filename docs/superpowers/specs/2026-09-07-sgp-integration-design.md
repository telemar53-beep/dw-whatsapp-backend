# Integração com o SGP — Design

> Estende `docs/superpowers/specs/2026-09-04-whatsapp-attendance-system-design.md`.

## Contexto e objetivo

O SGP (sistema de gestão da DW Telecom) precisa disparar mensagens de
WhatsApp através deste sistema — por exemplo, avisos automáticos de
boleto/cobrança. O SGP não vai ser consumido por este sistema; é o
contrário: o SGP chama um endpoint deste sistema (via webhook configurável
do lado do SGP) sempre que quiser enviar uma mensagem a um cliente.

Este é o primeiro de possivelmente vários integrações externas
("integração com outras plataformas"), por isso a área de admin e o
modelo de dados nascem com um pouco de espaço para outras integrações no
futuro, sem virar uma abstração genérica não usada — seguindo o mesmo
padrão já usado pela tabela `channels` (campo `type`, hoje só `baileys` e
`meta_cloud`).

**Fora de escopo desta spec:** consumir a API do SGP (autenticação
Basic/Token+App documentada em
`https://bookstack.sgp.net.br/books/api/page/autenticacoes-via-api`) —
essa documentação descreve como sistemas terceiros chamam o SGP, não como
o SGP chama terceiros, e não é usada aqui, já que a direção é oposta.
Envio de anexos (ex: PDF do boleto) — só texto por enquanto. Canais Meta
Cloud — exigem template aprovado para contato fora da janela de 24h, o
que não combina com o texto livre que este endpoint aceita; só canais
Baileys podem ser escolhidos na configuração da integração.

## Modelo de dados

### Nova tabela `platform_integrations`

```sql
CREATE TABLE platform_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL CHECK (platform IN ('sgp')),
  channel_id UUID NOT NULL REFERENCES channels(id),
  api_key_hash TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (platform)
);
```

Um registro por `platform` (singleton por enquanto — uma integração SGP
só). O `channel_id` deve apontar para um canal do tipo `baileys` (validado
na rota de admin, não via constraint de banco, já que `channels.type` não
tem índice/constraint parcial hoje e não vale a pena criar um só para
isso). `api_key_hash` é nulável: `NULL` significa "canal escolhido mas
nenhuma chave gerada ainda" (o endpoint do SGP rejeita com 400 nesse
estado, distinto de "integração desativada").

### Nova tabela `sgp_dispatches` (idempotência + log)

```sql
CREATE TABLE sgp_dispatches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_id TEXT NOT NULL UNIQUE,
  conversation_id UUID NOT NULL REFERENCES conversations(id),
  message_id UUID NOT NULL REFERENCES messages(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Toda chamada bem-sucedida do SGP grava uma linha aqui. Se uma nova
chamada chegar com um `reference_id` já existente, o endpoint responde
200 com os ids já gravados, sem reenviar a mensagem — protege contra
retry automático do lado do SGP causando cobrança duplicada.

### Novo valor de status em `conversations`

```sql
ALTER TABLE conversations DROP CONSTRAINT conversations_status_check;
ALTER TABLE conversations ADD CONSTRAINT conversations_status_check
  CHECK (status IN ('waiting', 'assigned', 'closed', 'silent'));
```

Uma conversa criada por um disparo do SGP nasce com `status = 'silent'`.
Esse status funciona como `'waiting'` para tudo (elegível para receber
mensagens, incluída em `findOpenConversation`, pode ser fechada), exceto
que **não aparece em nenhuma lista de fila** — `listWaitingConversations()`
filtra por `status = 'waiting'` e não precisa de nenhuma mudança para
continuar excluindo conversas `silent`.

## Fluxo do endpoint

### `POST /api/integrations/sgp/messages`

Novo arquivo `src/api/integrations-sgp.routes.js`, montado em
`src/server.js` fora do middleware de JWT (`requireAuth`) — usa sua
própria autenticação por API key.

**Autenticação:** header `Authorization: Bearer <api_key>`. Novo
middleware `requireSgpApiKey` busca o registro
`platform_integrations WHERE platform = 'sgp'`, compara o hash (mesmo
esquema de hash já usado para senha de agente — `bcrypt`), e:
- 401 se o header estiver ausente/malformado ou a chave não bater.
- 400 `{error: 'SGP integration is not enabled'}` se existir mas
  `enabled = false`.
- 400 `{error: 'SGP integration is not configured'}` se não existir
  nenhum registro ainda.

**Corpo esperado:**
```json
{
  "phoneNumber": "5598985004187",
  "content": "Seu boleto vence dia 10/09, valor R$ 150,00: https://...",
  "referenceId": "boleto-123456"
}
```

**Passo a passo do handler:**
1. Validar `phoneNumber`, `content`, `referenceId` como strings não
   vazias — 400 se faltar algum.
2. Buscar `sgp_dispatches` pelo `referenceId`. Se existir, responder
   `200 { conversationId, messageId, duplicate: true }` sem fazer mais
   nada.
3. Carregar o canal configurado em `platform_integrations` (join
   `channel_id`); se `channel.status !== 'connected'`, responder
   `400 { error: 'The configured channel is not connected' }`.
4. Normalizar o telefone (mesma lógica de `POST /api/conversations/start`:
   remover não-dígitos) e resolver o JID canônico via
   `baileysManager.resolveWhatsAppJid(channel, normalizedPhoneNumber)` —
   `400 { error: 'This phone number is not on WhatsApp' }` se retornar
   nulo.
5. `findOrCreateContactByPhoneNumber(canonicalPhoneNumber, null)`.
6. `findOpenConversation(contact.id, channel.id)` — se existir (qualquer
   status ≠ `closed`, incluindo `silent`, `waiting` ou `assigned`),
   reusar. Se não existir, criar uma nova como `'silent'`.
   `createConversation` (`conversation.repository.js`) ganha um novo
   parâmetro opcional: `createConversation(contactId, channelId,
   triageState = null, status = 'waiting')` — o `INSERT` passa a incluir
   a coluna `status` explicitamente (hoje ela é omitida e cai no
   `DEFAULT 'waiting'` da tabela). Todas as chamadas existentes
   (inbound normal, início manual de conversa) continuam sem passar esse
   4º argumento, preservando o comportamento atual; só a rota do SGP
   chama `createConversation(contact.id, channel.id, null, 'silent')`.
7. `enqueueOutboundMessage({ conversationId, channelId: channel.id,
   content })` — mesmo caminho (fila Bull) usado por todo envio
   existente.
8. Gravar `sgp_dispatches` com o `referenceId`, `conversationId`,
   `messageId`.
9. Responder `202 { conversationId, messageId }`.

Nenhum evento de socket é emitido neste momento — a conversa `silent`
não deve aparecer para ninguém ainda (ver seção seguinte).

## Visibilidade na fila (transição `silent` → `waiting`)

Em `src/conversations/inbound-message.service.js`, `ingestInboundMessage`
já busca a conversa aberta existente (`findOpenConversation`) antes de
gravar uma mensagem recebida. Ponto de mudança: se a conversa encontrada
tiver `status === 'silent'`, ela é atualizada para `'waiting'`
(`activateConversation(conversationId)`, nova função em
`conversation.repository.js`, um `UPDATE` simples) antes da checagem de
`conversationWithContact.assignedAgentId` que decide entre
`emitToAgent('message:new', ...)` e `broadcast('queue:new', ...)`. Como
uma conversa `silent` nunca tem `assigned_agent_id`, ela sempre cai no
`broadcast('queue:new', ...)` já existente — sem mudança nesse trecho.

Resultado: a primeira resposta do cliente faz a conversa aparecer
normalmente na aba Espera, com a mensagem original do SGP já no
histórico como contexto para o atendente.

## Área de admin

Nova aba "Integrações" em `AdminChannelsPage.jsx` (mesma página das
outras abas — Canais/Atendentes/Respostas rápidas/Setores/Cidades — sem
rota nova, seguindo o padrão já estabelecido no projeto).

Novo componente `IntegrationsAdminTab.jsx` mostra um card fixo "SGP":
- Dropdown de canal, listando só canais com `type === 'baileys'`
  (reaproveita `useChannels`).
- Toggle Ativo/Inativo.
- Botão "Gerar nova chave" — ao clicar, o backend gera uma chave
  aleatória (`crypto.randomBytes(32).toString('hex')`), salva só o hash
  (`bcrypt`), e retorna a chave em texto puro **uma única vez** na
  resposta da chamada. O frontend mostra essa chave com um botão copiar e
  um aviso "Copie agora — esta chave não será mostrada novamente".
  Gerar uma nova chave invalida a anterior (substitui o hash).
- Se nunca configurado, mostra apenas o formulário de criação (escolher
  canal + gerar a primeira chave).

**Novas rotas admin** (`src/api/admin-integrations.routes.js`, admin-only,
mesmo padrão de `admin-channels.routes.js`):
- `GET /api/admin/integrations/sgp` — retorna
  `{ configured, channelId, channelName, enabled }` (nunca o hash nem a
  chave).
- `PUT /api/admin/integrations/sgp` — cria ou atualiza `channel_id`/
  `enabled` (não mexe na chave).
- `POST /api/admin/integrations/sgp/rotate-key` — gera e salva uma nova
  chave, retorna `{ apiKey }` em texto puro (única vez).

## Erros e casos de borda

- Chamada do SGP sem integração configurada: 400, mensagem clara.
- Canal configurado mas desconectado: 400 (o SGP deve tratar como falha
  temporária e re-tentar mais tarde — não é coberto por idempotência,
  já que a mensagem nunca chegou a ser enfileirada).
- `referenceId` repetido: 200, sem reenvio (idempotência).
- Número não está no WhatsApp: 400, mesma mensagem já usada em
  `POST /api/conversations/start`.
- Conversa já `closed` para esse contato+canal: `findOpenConversation`
  não a encontra (mesma regra `status <> 'closed'` de sempre) — uma nova
  conversa `silent` é criada, comportamento correto (uma conversa fechada
  não deve ser reaberta silenciosamente).

## Testes

- `conversation.repository.test.js`: `createConversation` aceita status
  `'silent'`; `findOpenConversation` encontra conversas `'silent'`;
  `listWaitingConversations` NÃO retorna conversas `'silent'`; nova
  função `activateConversation` transiciona `'silent'` → `'waiting'`.
- `inbound-message.service.test.js`: mensagem recebida numa conversa
  `'silent'` a transiciona para `'waiting'` e dispara `broadcast('queue:new', ...)`;
  mensagem recebida numa conversa já `'waiting'`/`'assigned'` continua
  sem mudança (regressão).
- Novo `integrations-sgp.routes.test.js`: chave válida/inválida/ausente,
  integração desativada/não configurada, payload inválido, número fora
  do WhatsApp, canal desconectado, `referenceId` duplicado (idempotência),
  fluxo de sucesso completo (verifica `sgp_dispatches` gravado e mensagem
  enfileirada).
- Novo `admin-integrations.routes.test.js`: GET/PUT/rotate-key, todos
  admin-only (403 para atendente comum), chave nunca aparece em GET.
- Frontend: novo `IntegrationsAdminTab.test.jsx` (criar, editar canal,
  toggle, gerar chave e mostrar aviso de "só uma vez").

## Migração

Duas migrations novas: `platform_integrations` + `sgp_dispatches` (uma
migration), e a alteração do `CHECK` de `conversations.status` (outra,
por mexer numa tabela já existente). **Precisa rodar `npm run migrate --
up` no Render Shell após o deploy** — sem isso, tanto o endpoint do SGP
quanto a aba de admin ficam quebrados.
