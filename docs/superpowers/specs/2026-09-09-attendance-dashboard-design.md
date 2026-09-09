# Dashboard de atendimento — Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement the plan derived from this spec.

## Contexto e objetivo

O usuário pediu uma visão operacional de todos os atendimentos em andamento
(de todos os atendentes, não só o próprio), agrupados em colunas — "Em
andamento", "Em espera", "Na automação" e "Encerrados hoje" — inspirada numa
tela equivalente do Chat Mix (screenshot de referência mostrado durante o
brainstorm). Hoje não existe nenhuma visão assim: cada atendente só vê sua
própria fila (`useMyConversations`) e a fila compartilhada
(`useQueue`/"Em espera"); não há como um admin ver o quadro completo de
uma vez.

**Decisões já tomadas durante o brainstorm (não reabrir):**
- Só admin vê essa tela (não é uma visão pra atendente comum).
- Sem filtro por Tags por enquanto (não existe conceito de Tags no sistema
  hoje).
- Clicar num card abre a conversa (mesmo comportamento de navegação já
  usado no resto do sistema).
- "Encerrados hoje" é uma lista paginada ("carregar mais"), não só uma
  contagem.
- Atualização em tempo real de verdade (evento novo dedicado), não
  polling.

## Modelo de dados — nenhuma tabela nova

As 4 colunas são derivadas dos campos que `conversations` já tem
(`status`: `waiting` | `assigned` | `closed` | `silent`; `triage_state`:
`null` | `pending` | `completed`):

| Coluna | Condição |
|---|---|
| Em andamento | `status = 'assigned'` |
| Em espera | `status = 'waiting'` AND `triage_state IS DISTINCT FROM 'pending'` |
| Na automação | `triage_state = 'pending'` |
| Encerrados hoje | evento `conversation_events.event_type = 'closed'` nas últimas 24h |

`status = 'silent'` (conversa criada só por um disparo do SGP, cliente
ainda não respondeu) fica fora das 4 colunas — não é um atendimento em
curso.

**"Hoje" = últimas 24 horas, não dia de calendário** — mesma convenção já
usada pelo botão "Hoje" da Dashboard de Métricas existente (decisão
deliberada documentada lá: evita complexidade de fuso horário). O rótulo
na UI continua "Encerrados hoje" (é o que o usuário pediu), mas o cálculo
por trás é `now() - 24h`, igual ao resto do sistema.

**Fonte de verdade para "quando fechou":** `conversation_events` (evento
`closed`, já gravado por `closeConversation`), não
`conversations.updated_at` — mesmo padrão já usado por
`metrics.repository.js`. Mais robusto: não depende de nenhum outro campo
deixar de tocar a linha depois do fechamento.

## Backend

### Novas funções em `src/conversations/conversation.repository.js`

Reaproveitam a mesma query/shape de `getConversationWithContact`/
`listWaitingConversations` (join com `contacts`, `sectors`, `cities`,
última mensagem via `LATERAL`) — mesmo formato de retorno
(`toConversationSummary`), só a cláusula `WHERE` muda:

- `listInProgressConversations()` — `WHERE c.status = 'assigned'`, `ORDER BY c.updated_at DESC`.
- `listWaitingForAgentConversations()` — `WHERE c.status = 'waiting' AND c.triage_state IS DISTINCT FROM 'pending'`, `ORDER BY c.created_at ASC` (mesma ordem de `listWaitingConversations` hoje).
- `listInAutomationConversations()` — `WHERE c.triage_state = 'pending'`, `ORDER BY c.created_at ASC`.
- `countClosedSince(since)` — `SELECT COUNT(*)::int FROM conversation_events WHERE event_type = 'closed' AND created_at >= $1`.
- `listClosedSince(since, { limit, offset })` — join `conversation_events` (evento `closed`) → `conversations` → `contacts`/`sectors`/`cities`/última mensagem, mesmo shape de `toConversationSummary` acrescido de `closedAt` (o `created_at` do evento). `ORDER BY ce.created_at DESC`, `LIMIT`/`OFFSET`.

Nenhuma função existente muda de comportamento — são consultas novas ao
lado das que já existem.

### Novo endpoint: `GET /api/conversations/:id`

Descoberto como uma lacuna real ao verificar como "abrir a conversa" (já
decidido no brainstorm) funcionaria de fato: hoje `DashboardPage` guarda a
conversa selecionada como estado local (`selectedId`/`useState`, não uma
rota `/conversation/:id`), construído a partir de listas que só contêm as
conversas do próprio atendente (`useQueue`/`useMyConversations`) — não
existe hoje nenhuma forma de buscar uma conversa arbitrária (de outro
atendente) pelo id. `requireAuth` apenas (mesma regra de
`GET /:id/messages`, que já não tem checagem de dono nenhuma — qualquer
atendente autenticado já pode ler o histórico de qualquer conversa hoje).
Retorna `getConversationWithContact(id)` (404 se não existir) — o mesmo
shape que `ConversationView` já espera.

### Novo endpoint: `GET /api/admin/dashboard/conversations`

`requireAuth`, `requireRole('admin')`. Sem parâmetros. Retorna o snapshot
completo das 3 colunas "vivas" (o volume simultâneo de conversas ativas é
pequeno — sem paginação) mais só a contagem de encerrados:

```json
{
  "inProgress": [ConversationSummary, ...],
  "waiting": [ConversationSummary, ...],
  "inAutomation": [ConversationSummary, ...],
  "closedTodayCount": 12
}
```

`ConversationSummary` = exatamente o shape que `toConversationSummary` já
produz hoje (mesmos campos usados por `useQueue`/`useMyConversations`) —
nenhum campo novo, incluindo `assignedAgentId`/`channelId` crus (não
nomes) para o frontend resolver via `useAgents()`/`useChannels()`, mesmo
padrão já usado por `TransferModal` hoje.

### Novo endpoint: `GET /api/admin/dashboard/conversations/closed-today`

`requireAuth`, `requireRole('admin')`. Query params `limit` (padrão 20,
máximo 50) e `offset` (padrão 0) — paginação simples por offset, não
existe nenhum padrão de cursor neste projeto ainda e o volume (fechados
em 24h) não justifica um. Retorna:

```json
{ "items": [ConversationSummary + closedAt, ...], "hasMore": true }
```

`hasMore` = `offset + items.length < countClosedSince(since)` (uma
segunda query de contagem, já existe como `countClosedSince`).

## Tempo real

### Sala dedicada `dashboard` no Socket.io

Em `src/realtime/socket-server.js`, no handler de `connection`: se
`socket.agent.role === 'admin'` (já vem no payload do JWT — confirmado em
`auth.service.js`, nenhuma mudança necessária ali), `socket.join('dashboard')`
além da sala `agent:<id>` que já existe.

Nova função `broadcastToDashboard(event, payload)` em `socket-server.js`,
mesmo padrão de `emitToAgent`/`broadcast`: `io.to('dashboard').emit(event, payload)`,
no-op silencioso se `io` não estiver inicializado (mesma regra das duas
funções existentes).

### Evento único: `dashboard:conversation`

Em vez de um evento por tipo de mutação, um evento genérico carregando o
`ConversationSummary` atualizado — o frontend decide em qual coluna ele
entra (ou sai de todas, se virou `closed`/`silent`) só olhando
`status`/`triageState`, sem precisar saber qual ação client-side causou a
mudança. Isso é a Approach A já escolhida no brainstorm (contra a
alternativa de o frontend escutar todos os eventos já existentes
`message:new`/`queue:new`/`conversation:assigned`/etc. e replicar a lógica
de agrupamento em cada um — mais frágil, mais lugares pra esquecer de
atualizar).

Disparado (via `broadcastToDashboard('dashboard:conversation', { conversation })`)
nos mesmos pontos que já mudam `status`/`triage_state` hoje:
- `ingestInboundMessage` (nova conversa criada, ou reativada de `silent`)
- `claimConversation`, `transferConversation`, `closeConversation`
  (`conversation.repository.js` — os *callers* dessas funções em
  `conversations.routes.js` já buscam o resultado; adicionar a chamada de
  broadcast logo depois de cada uma, ao lado do `emitToAgent`/`broadcast`
  que já existe ali)
- `processTriageReply`/o ponto em `triage.service.js` que muda
  `triage_state` de `pending` para `completed`

Um fechamento também precisa levar `closedAt` no payload (para o
frontend poder inserir no topo da lista "Encerrados hoje" sem esperar um
refetch) — usa `new Date().toISOString()` no momento do broadcast (o
evento `conversation_events` já foi gravado nesse ponto, mas buscar seu
`created_at` de volta só pra isso é desnecessário — o timestamp do broadcast
é preciso o suficiente para exibição).

## Frontend

### Nova página `frontend/src/pages/AttendanceDashboardPage.jsx`

Rota nova (`/dashboard/atendimento` ou similar — só acessível a admin,
mesmo guard já usado por `AdminChannelsPage`). Novo hook
`useAttendanceDashboard()`:
- Busca o snapshot inicial via `GET /api/admin/dashboard/conversations`.
- Assina `dashboard:conversation` no socket já existente
  (`useSocket()`); a cada evento, recalcula em qual das 3 listas "vivas"
  a conversa pertence (remove das outras duas se estava lá, insere/atualiza
  na certa; remove de todas se `status` virou `closed`/`silent`) — mesmo
  padrão de "upsert" que `queue:new` já segue hoje no `useQueue`.
  Se o evento trouxer `closedAt` (ou seja, é um fechamento), também soma 1
  em `closedTodayCount` local (a lista paginada em si só é
  recarregada quando o admin abre/expande "Encerrados hoje", não em
  tempo real — YAGNI: manter uma lista paginada 100% sincronizada em
  tempo real com o resto é complexidade sem valor real aqui).

Componente de coluna genérico (`DashboardColumn`) reaproveitado pelas 4
colunas — título, contador, lista de cards. Card mostra: nome/telefone do
contato, canal, setor, atendente (se houver), preview da última mensagem
— mesmos dados já usados pelos cards de `useQueue`/`useMyConversations`
hoje, então reaproveita o componente de card já existente se o shape
bater (`ConversationCard` ou equivalente — confirmar nome exato ao
escrever o plano).

**Filtros (Canais, Atendentes, Departamentos — sem Tags):** três
dropdowns multi-seleção acima das colunas, aplicados client-side sobre os
dados já carregados/atualizados via socket (nenhuma chamada extra ao
servidor por mudança de filtro) — usam as listas já existentes de
`useChannels()`/`useAgents()`/`useSectors()`, cruzando por
`channelId`/`assignedAgentId`/`sectorId` de cada conversa.

**Clique no card:** `DashboardPage` ganha suporte a abrir uma conversa que
não está em `useQueue`/`useMyConversations` — ao navegar pra `/` com
`location.state.openConversationId` (via `useNavigate(..., { state })`),
um novo efeito busca `GET /api/conversations/:id` e usa o resultado como
`selectedConversation` (em vez de depender de achá-la nas listas locais)
se o id não estiver em nenhuma delas. Mesmo `ConversationView` de sempre é
reaproveitado sem mudança — se a conversa pertence a outro atendente, o
histórico é visível (rota de mensagens já não tem checagem de dono), mas
tentar enviar uma mensagem recebe o 403 que `POST /:id/messages` já
retorna hoje pra quem não é o atendente responsável (comportamento
existente, não uma lacuna nova desta feature — visão do admin é
"olhar", não "assumir").

**"Encerrados hoje":** botão "Carregar mais" no fim da coluna, chama
`GET /api/admin/dashboard/conversations/closed-today?offset=N` (N = itens
já carregados), acrescenta ao final.

## Erros e casos de borda

- Um admin sem nenhum agente/canal/setor cadastrado ainda vê o dashboard
  vazio normalmente (sem erro) — mesmo comportamento de qualquer outra
  tela deste sistema com listas vazias.
- Uma conversa que muda de estado entre o fetch do snapshot inicial e a
  assinatura do socket (janela de corrida pequena, mesma classe de
  problema que `useQueue`/`usePresence` já têm e já aceitam como
  não-crítico neste projeto) pode ficar temporariamente na coluna errada
  até o próximo evento relevante daquela conversa — não é diferente do
  que já é aceito hoje em outras telas deste projeto.
- `broadcastToDashboard` sendo um no-op silencioso quando `io` não está
  inicializado é a mesma regra de segurança já usada por
  `emitToAgent`/`broadcast` (nunca transformar uma mutação bem-sucedida
  em erro 500 por causa de um problema de push em tempo real).

## Testes

- `conversation.repository.test.js`: as 4 novas funções (`listInProgressConversations`,
  `listWaitingForAgentConversations`, `listInAutomationConversations`,
  `countClosedSince`, `listClosedSince`), casos com e sem dados, e o caso
  específico de uma conversa `triage_state = 'pending'` não aparecer em
  `listWaitingForAgentConversations`.
- Novo `src/api/admin-dashboard.routes.test.js`: os 2 endpoints, 403 pra
  não-admin, shape da resposta, paginação (`hasMore` true/false).
- `conversations.routes.test.js`: novo `GET /:id` — 200 com o shape certo,
  404 pra id inexistente, acessível por qualquer atendente autenticado
  (sem checagem de dono, mesma regra de `GET /:id/messages`).
- `socket-server.test.js`: admin entra na sala `dashboard` ao conectar,
  atendente comum não entra; `broadcastToDashboard` emite só pra quem
  está na sala.
- Pontos de broadcast (`conversations.routes.js`, `inbound-message.service.js`,
  `triage.service.js`): teste que `dashboard:conversation` é emitido com o
  payload certo em cada mutação relevante — mesmo padrão dos testes já
  existentes para `message:new`/`queue:new` nesses mesmos arquivos.
- Frontend: novo `useAttendanceDashboard.test.jsx` (fetch inicial,
  upsert/remoção via evento de socket, incremento de `closedTodayCount`)
  e `AttendanceDashboardPage.test.jsx` (renderização das 4 colunas,
  filtros, clique navega, "carregar mais").
- `DashboardPage.test.jsx`: novo caso — chegando em `/` com
  `location.state.openConversationId` de uma conversa que não está em
  `queue`/`mine`, busca via `GET /api/conversations/:id` e abre.

## Migração

Nenhuma — não há tabela/coluna nova.

## Fora de escopo

- Filtro por Tags (não existe o conceito no sistema).
- Atualização em tempo real da lista paginada "Encerrados hoje" em si
  (só o contador atualiza ao vivo; a lista recarrega quando o admin a
  abre/pede mais).
- Qualquer ação em massa a partir do dashboard (fechar/transferir várias
  de uma vez) — é só visão, não um painel de ações.
- Métricas/gráficos (já existem na Dashboard de Métricas separada) — este
  dashboard é sobre o estado atual das conversas, não histórico agregado.
