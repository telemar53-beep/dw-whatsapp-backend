# Sistema próprio de atendimento via WhatsApp (DW Telecom)

**Data:** 2026-09-04
**Status:** Aprovado para planejamento de implementação

## Contexto e motivação

A DW Telecom usa o SGP para gestão de clientes, e a maior parte do atendimento
acontece via WhatsApp, em 3 números:

- 2 números com API oficial (Meta Cloud API, contratada diretamente).
- 1 número com WhatsApp "normal", conectado hoje via QR code (estilo WhatsApp
  Web).

Atualmente os três números são conectados através do serviço de terceiros
Chat Mix, que também fornece as telas de atendimento usadas pelos atendentes.
Esse serviço está apresentando problemas frequentes. O objetivo deste projeto
é substituir completamente o Chat Mix por um sistema próprio: conexão com os
3 números **e** interface de atendimento multi-atendente.

Já existe um repositório inicial (`dw-whatsapp-backend`), hospedado no Render
(plano Starter, 0.5 CPU / 512 MB RAM), com um servidor Express mínimo (health
check) e dependências já escolhidas: `express`, `pg`, `ioredis`, `bull`,
`axios`, `cors`.

### Infraestrutura: estado atual e pendências

Confirmado a partir da documentação técnica gerada em 05/09/2026:

- Render: serviço `dw-whatsapp-backend`, plano Starter (0.5 CPU / 512 MB RAM),
  deploy automático a cada push na branch `main`. **Ainda sem** Persistent
  Disk anexado, sem instância de Postgres e sem instância de Redis
  provisionadas — isso precisa ser feito antes de implementar persistência de
  conversas, a fila de envio (Bull) e a sessão do Baileys.
- **Decisão confirmada:** o terceiro número (não oficial) usa **Baileys**,
  não Selenium/WhatsApp Web automatizado por navegador. Motivo: o plano
  Starter tem apenas 512 MB de RAM, e rodar um Chromium via Selenium nesse
  limite (concorrendo com o resto do backend) traria risco alto de estourar
  memória e derrubar a sessão constantemente. Baileys fala o protocolo do
  WhatsApp diretamente em JavaScript, sem navegador, e é compatível com esse
  ambiente.

Não há pressão de prazo — prioridade é construir algo robusto desde o início,
mesmo que leve mais tempo.

## Escopo da v1

**Dentro do escopo:**
- Conexão com os 2 números oficiais via Meta Cloud API (webhook + envio).
- Conexão com o número não oficial via Baileys (QR code), com sessão
  persistida em disco.
- Interface web para atendentes: fila de conversas, atribuição, transferência
  entre atendentes, histórico de mensagens.
- Fila/distribuição de conversas entre múltiplos atendentes (equipe é maior
  que poucos atendentes — fila importa).
- Autenticação de atendentes (login, papéis `agent`/`admin`).

**Fora do escopo (v1):**
- Integração com a API do SGP (puxar dados de cliente/contrato). Atendente
  consulta o SGP separadamente por enquanto.
- Métricas/relatórios de atendimento.
- Distribuição automática por regra complexa (ex: por assunto, por
  habilidade) — a v1 usa fila visível + "assumir" manual e transferência
  manual.

## Decisão arquitetural: monólito modular

Um único serviço Node.js/Express rodando no Render (evolução direta do que já
existe), organizado internamente em módulos desacoplados por responsabilidade.
Alternativa considerada e descartada por ora: separar já em dois serviços
(gateway WhatsApp + API de atendimento) comunicando via Redis pub/sub — mais
resiliente e escalável, mas overhead operacional desnecessário para o tamanho
de equipe atual. Os módulos abaixo são desenhados para permitir essa divisão
no futuro sem reescrita, caso a operação justifique.

### Módulos

- **`whatsapp-adapters/`** — um adaptador por canal, todos implementando a
  mesma interface (`sendMessage(conversation, content)`,
  evento `onMessageReceived`, evento `onStatusUpdate`):
  - `meta-cloud`: reutilizado para os 2 números oficiais, parametrizado por
    `phone_number_id` e `access_token` de cada canal.
  - `baileys`: para o número não oficial. Sessão de autenticação persistida
    no disco do Render (`creds.update` grava a cada mudança). Reconecta
    automaticamente em queda de conexão; em logout definitivo, gera novo QR
    code e o expõe numa tela de admin do próprio sistema (não há terminal
    interativo no Render para escanear).
- **`conversations/`** — regra de negócio: cria/atualiza `conversation` a
  partir de mensagem recebida, gerencia fila de espera, atribuição a
  atendente (operação atômica, evita dois atendentes assumindo a mesma
  conversa), transferência entre atendentes, fechamento de conversa.
- **`outbound-queue/`** — fila baseada em Bull (Redis), uma fila por canal.
  Serializa e limita a taxa de envio por canal, com retry automático (backoff
  exponencial) em falha de envio (rate limit, timeout).
- **`realtime/`** — Socket.io. Emite eventos para os clientes conectados:
  nova mensagem, conversa entrou na fila, conversa atribuída/transferida,
  atualização de status de canal (ex: Baileys caiu). Implementado (v1):
  conexão autenticada por JWT, uma sala por atendente (`agent:<agentId>`).
  Sete eventos: `message:new`, `queue:new`, `queue:removed`,
  `conversation:assigned`, `conversation:removed`, `conversation:closed`,
  `message:updated`. **Contrato que o frontend precisa respeitar** (definido
  na revisão final do plano de tempo real):
  - `queue:new` é um *upsert* por `conversation.id`, não um "append". Uma
    conversa ainda sem atendente pode gerar `queue:new` mais de uma vez (uma
    por mensagem recebida enquanto estiver na fila) — o frontend deve
    atualizar/substituir a entrada existente daquela conversa na lista, não
    duplicá-la.
  - `message:updated` pode chegar para uma conversa que já foi fechada
    (o fechamento não limpa o atendente designado, então uma mensagem de
    saída ainda em trânsito na fila continua notificando o último
    atendente). O frontend deve ignorar silenciosamente eventos referentes a
    uma conversa que não está mais na tela.
  - Uma desconexão por token expirado (JWT de 12h) **não** reconecta
    sozinha — o `socket.io-client` não tenta reconectar após uma rejeição do
    middleware de autenticação. O frontend precisa tratar `connect_error`
    obtendo um token novo (via login silencioso ou refresh) e chamando
    `socket.connect()` manualmente.
  - Emissão de eventos é *best-effort*: uma falha ao emitir nunca deve
    impedir a operação de negócio correspondente (assumir, enviar, etc.) de
    ser confirmada ao cliente HTTP.
  - Escalonamento horizontal: a implementação atual usa o adaptador em
    memória padrão do Socket.io (sem Redis pub/sub entre instâncias). Isso é
    adequado enquanto o serviço rodar numa única instância Render (conforme
    a decisão de monólito modular abaixo). Se a operação algum dia justificar
    mais de uma instância, os eventos deixariam de alcançar clientes
    conectados a outra instância **silenciosamente** (sem erro) — resolver
    isso então com `@socket.io/redis-adapter` (o Redis já usado pelo Bull
    pode ser reaproveitado).
- **`api/`** — REST usado pelo frontend: login, listar conversas (fila +
  minhas conversas), obter histórico, enviar mensagem, assumir/transferir
  conversa.
- **`db/`** — Postgres. Models e migrations.

## Modelo de dados (Postgres)

- **`channels`** — os 3 números. Campos: `type` (`meta_cloud` | `baileys`),
  identificador do número, credenciais/config (para `meta_cloud`:
  `phone_number_id` + `access_token`; para `baileys`: apenas path da sessão),
  `status` (conectado/desconectado/aguardando QR).
- **`contacts`** — clientes que escrevem. Telefone (E.164) e nome exibido no
  WhatsApp.
- **`conversations`** — uma conversa aberta por par (`contact_id`,
  `channel_id`). Campos: `status` (`waiting` | `assigned` | `closed`),
  `assigned_agent_id` (nullable), `queue`/departamento (opcional, pode ser
  fixo em v1), timestamps de criação/último evento.
- **`messages`** — histórico completo. Direção (`inbound`/`outbound`),
  conteúdo (texto ou referência a mídia), `whatsapp_message_id` (para
  correlacionar status), `status` (`sent` | `delivered` | `read` | `failed`),
  timestamp.
- **`agents`** — atendentes. Login (email/senha com hash), `role`
  (`agent`/`admin`).
- **`conversation_events`** — log de auditoria: atribuição, transferência
  (de/para qual atendente), fechamento. Útil desde já para debugging e para
  métricas futuras, mesmo que não exibido na v1.

## Fluxo de mensagens

**Entrada (cliente → atendente):**
1. Meta Cloud API envia webhook (assinatura validada), ou o adaptador Baileys
   emite evento de mensagem recebida.
2. O adaptador normaliza a mensagem para um formato interno único
   (independente do canal de origem).
3. Mensagem é salva em `messages`.
4. `conversations` localiza a conversa aberta para (contato, canal) ou cria
   uma nova.
5. Se a conversa não tem atendente (`waiting`): evento de fila é emitido via
   Socket.io para todos os atendentes conectados (ou ao departamento, se
   houver).
6. Se já tem atendente (`assigned`): evento é emitido só para aquele
   atendente.

**Saída (atendente → cliente):**
1. Frontend chama `POST /api/conversations/:id/messages`.
2. Mensagem é validada e enfileirada na fila Bull do canal correspondente.
3. Worker consome a fila, chama o adaptador certo (`meta-cloud` ou
   `baileys`) para enviar.
4. Status da mensagem é atualizado (`sent` → `delivered`/`failed` conforme
   confirmações do canal).
5. Atualização é empurrada ao frontend via Socket.io.

**Fila e distribuição:**
- Conversas sem atendente ficam visíveis a todos os atendentes (ou ao
  departamento, se departamentos existirem).
- "Assumir" é uma atualização atômica no banco (`UPDATE ... WHERE
  assigned_agent_id IS NULL`), evitando condição de corrida entre dois
  atendentes.
- Transferência troca `assigned_agent_id` e registra evento em
  `conversation_events`.

## Frontend (tela de atendimento)

**Stack:** React + Vite, com `socket.io-client` para tempo real. Justificativa:
ferramenta interna (SEO/SSR irrelevante), ecossistema maduro para UI reativa
de chat, mais simples de manter no médio prazo do que HTML/JS puro dado o
volume de estado (fila, conversas, mensagens em tempo real).

**Telas principais:**
- Login.
- Painel com duas listas: fila de espera (conversas sem atendente) e "minhas
  conversas" (atribuídas ao atendente logado).
- Visualização de conversa: histórico de mensagens + campo de envio.
- Indicador de status por canal (visível a admins): mostra se o número
  Baileys caiu e precisa de novo QR code (exibido na própria tela, já que não
  há acesso a terminal no Render para escanear).

## Autenticação e confiabilidade

- **Auth:** login com JWT, papéis `agent` e `admin`. Senhas com hash
  (bcrypt).
- **Baileys:** reconexão automática em queda de conexão; credenciais gravadas
  em disco a cada `creds.update`. Logout definitivo gera novo QR code exposto
  na tela de admin.
- **Meta Cloud API:** validação de assinatura do webhook (`X-Hub-Signature`);
  credenciais armazenadas por canal (tabela `channels`); alerta quando o
  token de acesso estiver próximo da expiração.
- **Retry de envio:** Bull re-tenta com backoff exponencial em falhas
  transitórias (rate limit, timeout de rede).

## Testes

- Testes unitários para: normalização de mensagens (cada adaptador →
  formato interno) e regra de fila/atribuição/transferência (a lógica de
  negócio com mais risco de bug).
- Adaptadores de WhatsApp testados com mocks — não é viável automatizar
  contra o WhatsApp real.
- Teste manual ponta a ponta (números de teste) antes de qualquer mudança ir
  para os números de produção.

## Próximos passos

Este documento cobre a v1. Com o spec aprovado, o próximo passo é usar a
skill `writing-plans` para transformar isso num plano de implementação
detalhado, provavelmente dividido em fases (ex: fundação de dados +
adaptador Meta primeiro, depois Baileys, depois frontend e fila/distribuição).
