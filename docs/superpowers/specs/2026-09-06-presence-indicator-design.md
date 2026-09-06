# Indicador de presença online/offline (DW Telecom)

**Data:** 2026-09-06
**Status:** Aprovado para planejamento de implementação
**Estende:** [2026-09-04-whatsapp-attendance-system-design.md](2026-09-04-whatsapp-attendance-system-design.md)

## Contexto e motivação

Hoje não existe nenhuma forma de um atendente saber quem mais da equipe está
online no momento. O Socket.io já existe (`src/realtime/socket-server.js`),
com uma conexão autenticada por JWT por atendente logado e uma sala por
agente (`agent:<id>`), mas roda numa única instância em memória, sem adapter
Redis — não existe hoje nenhum conceito de "quem está conectado agora". Este
recurso adiciona um indicador de presença ao vivo, aproveitando exatamente a
conexão de socket que já existe, sem tabela nova no banco.

## Escopo

**Dentro do escopo:**
- Rastreamento de presença em memória, no próprio processo do servidor
  (contador de sockets conectados por atendente — suporta múltiplas
  abas/dispositivos do mesmo atendente).
- Dois novos eventos de socket (`presence:online`, `presence:offline`)
  disparados só na transição 0↔1 conexões.
- `GET /api/agents` (rota já aberta a qualquer atendente autenticado) ganha
  dois campos na resposta: `name` (já existe na tabela `agents`, hoje só não
  é devolvido por essa rota) e `online` (booleano, consultado do módulo de
  presença) — serve de snapshot inicial.
- Um painel "Equipe" na barra lateral do `DashboardPage`, visível para
  qualquer atendente logado, mostrando cada colega com uma bolinha
  verde (online) ou cinza (offline). O próprio atendente logado aparece na
  lista também (como qualquer outro, sem tratamento especial) — serve de
  confirmação visual de que a própria conexão está ativa.

**Fora do escopo (aceito como está, não é um gap a corrigir aqui):**
- Persistência de presença em banco (heartbeat, `last_seen_at`) — resolveria
  um problema de múltiplas instâncias que este projeto não tem hoje.
- Suporte a múltiplas instâncias do servidor (exigiria um adapter Redis para
  o Socket.io, que este projeto não tem e não é o foco deste recurso).
- Decorar o `TransferModal` com a mesma bolinha de status — o usuário optou
  por só o painel da tela principal nesta entrega.
- Filtrar atendentes desativados (`active = false`) da lista — eles não
  conseguem logar mesmo, então sempre aparecerão offline; mesmo
  comportamento que `TransferModal` já tem hoje ao listar todo mundo.

## Decisão de arquitetura

### Rastreamento de presença (backend)

Novo módulo `src/realtime/presence.js`, isolado do resto do
`socket-server.js`, com um `Map<agentId, connectionCount>` em memória:

- `markAgentOnline(agentId)`: incrementa o contador do atendente. Se o
  contador virou 1 (estava 0), retorna `true` (transição real) — quem
  chama decide se dispara o evento.
- `markAgentOffline(agentId)`: decrementa o contador. Se chegou a 0,
  retorna `true` (transição real).
- `isAgentOnline(agentId)` / `getOnlineAgentIds()`: consulta de leitura,
  usada pela rota `GET /api/agents` para montar o snapshot inicial.

`socket-server.js` chama esses helpers dentro do handler de `connection` (ao
conectar) e do handler de `disconnect` do próprio socket (ao desconectar),
disparando `broadcast('presence:online', { agentId })` /
`broadcast('presence:offline', { agentId })` só quando a função de presença
sinalizar uma transição real — assim, se o mesmo atendente tiver duas abas
abertas, fechar uma não dispara `presence:offline` (o contador só chega a 0
quando a última cai).

### Snapshot inicial (backend)

`agent.repository.js`'s `listAgents()` já devolve `name` (usado por outras
rotas) — a única mudança é em `src/api/agents.routes.js`: o `.map()` que
hoje descarta `name` e não inclui presença passa a devolver
`{ id, email, role, name, online }`, com `online` vindo de
`isAgentOnline(agent.id)`.

### Frontend

Novo hook `frontend/src/hooks/usePresence.js`:

```js
usePresence(agents) // agents = array já buscado por useAgents()
```

Na primeira renderização com uma lista não vazia, inicializa um `Set` de ids
online a partir do campo `online` de cada item. A partir daí, só atualiza
via os eventos de socket `presence:online`/`presence:offline` (adiciona ou
remove do Set) — mesmo padrão já usado por `useQueue`: busca uma vez por
REST, atualização ao vivo só por socket, nunca por polling.

Novo componente `frontend/src/components/TeamPanel.jsx`: recebe a lista de
`agents` (de `useAgents()`) e o `Set` de `usePresence()`, renderiza uma
lista compacta (bolinha verde/cinza + nome), ordenada com todos os online
primeiro e depois os offline, e dentro de cada grupo em ordem alfabética
por `name`. Inserido no `DashboardPage.jsx`, na barra lateral esquerda
(`<aside>`), logo abaixo de `MyConversationsList`.

## Testes

- **`presence.test.js`** (novo): contador sobe e desce corretamente por
  atendente; `markAgentOnline` retorna `true` só na transição 0→1 (uma
  segunda aba do mesmo atendente retorna `false`); `markAgentOffline`
  retorna `true` só na transição 1→0; `isAgentOnline`/`getOnlineAgentIds`
  refletem o estado atual.
- **`agents.routes.test.js`** (existente, estendido): `GET /api/agents`
  devolve `name` e `online` corretamente para um atendente conectado e um
  desconectado.
- **`usePresence.test.jsx`** / **`TeamPanel.test.jsx`** (novos): estado
  inicial vem do array de `agents` recebido; um evento `presence:online`/
  `presence:offline` do socket mockado atualiza a lista ao vivo; um
  atendente desativado aparece na lista sempre offline.

## Casos de borda aceitos (não é gap, é comportamento esperado)

- **Reinício do servidor:** todo o estado de presença em memória zera —
  todo mundo aparece offline até reconectar (o `socket.io-client` já
  reconecta automaticamente, exceto após um erro de autenticação por JWT
  expirado, caso já documentado no projeto). Aceitável para o estado efêmero
  que isso é; não precisa de persistência.
- **Latência de detecção de queda de conexão:** uma queda real de rede pode
  levar alguns segundos para o Socket.io detectar (timeout de ping do
  protocolo) — o indicador pode ficar "verde" por poucos segundos após uma
  desconexão abrupta. Latência inerente do protocolo, sem ação necessária.

## Próximos passos

Com o spec aprovado, o próximo passo é usar a skill `writing-plans` para
transformar isso num plano de implementação detalhado.
