# Frontend de atendimento (DW Telecom)

**Data:** 2026-09-05
**Status:** Aprovado para planejamento de implementação
**Estende:** [2026-09-04-whatsapp-attendance-system-design.md](2026-09-04-whatsapp-attendance-system-design.md)

## Contexto e motivação

O backend do sistema de atendimento via WhatsApp está completo e validado: autenticação JWT, fila de conversas, atribuição/transferência/fechamento, histórico de mensagens, eventos em tempo real via Socket.io, API de administração de canais (Meta Cloud e múltiplos números Baileys), e o ciclo completo de envio/recebimento foi testado manualmente contra o WhatsApp real. O sistema já está implantado em produção no Render.

O que falta é a interface que os atendentes de fato usam no dia a dia — hoje só existem chamadas de API diretas e uma página HTML simples para escanear o QR code do Baileys. Este documento cobre a construção dessa interface: um frontend React que substitui completamente a necessidade de usar o Chat Mix (ou qualquer ferramenta de terceiros) para o atendimento propriamente dito.

## Escopo

**Dentro do escopo:**
- Tela de login.
- Painel principal do atendente: fila de espera e conversas atribuídas visíveis ao mesmo tempo, visualização de conversa com histórico e envio de mensagens, ações de assumir/transferir/fechar.
- Indicador de status de canal (visível a admins) quando um canal Baileys precisa de atenção (desconectado/aguardando QR).
- Tela de administração de canais (visível a admins): listar, cadastrar (Meta Cloud ou Baileys) e visualizar o QR code — substitui a necessidade de usar a página HTML simples ou chamadas diretas de API.
- Dois ajustes no backend, necessários para o frontend funcionar corretamente: um endpoint para listar atendentes (usado no seletor de transferência) e um allowlist real de CORS restrito à origem do frontend.

**Fora do escopo:**
- Testes end-to-end automatizados (navegador real) — fora de escopo por agora; o teste manual já validou o backend ponta a ponta.
- Métricas, relatórios ou dashboards de atendimento.
- Refresh token / renovação automática de sessão — ao expirar o JWT (12h), o atendente simplesmente faz login de novo.
- Notificação por push do navegador (fora do escopo original do spec do backend também).

## Decisão arquitetural

### Localização e stack

O código do frontend fica no mesmo repositório, na pasta `frontend/` (monorepo simples) — um `package.json` independente do backend, mas versionado junto, o que mantém mudanças de API e de tela sincronizadas no mesmo commit/PR quando fizer sentido.

**Stack:** React 18 + Vite (build rápido, ecossistema maduro para SPAs), React Router (navegação entre login/painel/admin), Tailwind CSS (estilização rápida sem biblioteca de componentes pesada), `socket.io-client` (tempo real, já decidido no spec original).

**Hospedagem:** Render Static Site — mesma plataforma já usada para o backend, deploy automático a cada push, sem conta/serviço adicional para gerenciar.

### Gerenciamento de estado

Sem biblioteca de estado externa (Redux, Zustand, etc.) — o volume de dados (fila de conversas de uma equipe pequena/média, não milhares de itens) e o padrão de atualização (a maioria dos dados chega via eventos de socket empurrados pelo servidor, não via polling) não justificam essa complexidade adicional.

- **`AuthContext`**: guarda o token JWT (persistido em `localStorage`) e os dados do atendente logado (`agentId`, `role`). Expõe `login()`, `logout()`.
- **`SocketContext`**: mantém uma única conexão Socket.io autenticada com o token atual, criada quando o `AuthContext` tem um token válido e destruída no logout. Expõe a instância do socket para os hooks de domínio se inscreverem em eventos.
- **Hooks de domínio** (`useQueue`, `useMyConversations`, `useConversationMessages`, `useChannels`): cada um busca seu estado inicial via chamada REST ao montar, e depois se atualiza reagindo aos eventos de socket relevantes — nunca re-busca via API a cada mudança. Isso respeita o contrato de eventos já documentado no spec original (`realtime/` section): `queue:new` é tratado como upsert por `conversation.id`, nunca como append; `message:updated` chegando para uma conversa não mais visível na tela é ignorado silenciosamente.

Ações do atendente (assumir, enviar, transferir, fechar) chamam a API REST correspondente e **não fazem atualização otimista** — a lista/conversa só reflete a mudança quando o evento de socket correspondente chega. Isso mantém o servidor como única fonte de verdade e evita estados dessincronizados entre múltiplos atendentes vendo a mesma fila; o evento chega rápido o suficiente (mesmo processo, WebSocket) para não haver percepção de lentidão.

### Estrutura de pastas

```
frontend/
  src/
    contexts/
      AuthContext.jsx
      SocketContext.jsx
    hooks/
      useQueue.js
      useMyConversations.js
      useConversationMessages.js
      useChannels.js
      useAgents.js
    pages/
      LoginPage.jsx
      DashboardPage.jsx
      AdminChannelsPage.jsx
    components/
      QueueList.jsx
      MyConversationsList.jsx
      ConversationView.jsx
      MessageInput.jsx
      TransferModal.jsx
      ChannelStatusBanner.jsx
      CreateChannelForm.jsx
      QrCodeView.jsx
      ProtectedRoute.jsx
    services/
      api.js
    App.jsx
    main.jsx
  index.html
  vite.config.js
  tailwind.config.js
  package.json
```

### Telas

- **Login** (`LoginPage`): formulário de email/senha, chama `POST /api/auth/login`, guarda o token e redireciona para o painel.
- **Painel** (`DashboardPage`, rota protegida): duas listas lado a lado — **Fila de espera** (`useQueue`) e **Minhas conversas** (`useMyConversations`). Clicar numa conversa de qualquer lista abre `ConversationView` com o histórico (`useConversationMessages`) e `MessageInput`; os botões Assumir/Transferir/Fechar aparecem conforme o estado da conversa (`waiting`/`assigned`/atribuída a mim ou a outro). Um `ChannelStatusBanner` no topo (visível só para `role: admin`) avisa quando algum canal Baileys está `disconnected` ou `awaiting_qr`, com um link para a tela de administração.
- **Administração de Canais** (`AdminChannelsPage`, rota protegida, só `role: admin`): lista de canais com status (`useChannels`), formulário `CreateChannelForm` para cadastrar Meta Cloud ou Baileys, e `QrCodeView` exibindo a imagem do QR (com botão de atualizar manual — o backend não emite evento de socket quando o QR muda, então não há atualização automática aqui).

### Autenticação e tratamento de erros

- Rotas do painel e da administração são protegidas por `ProtectedRoute` (redireciona para login se não houver token válido; a rota de admin adicionalmente verifica `role === 'admin'`).
- Ao detectar `connect_error` no socket (rejeição de autenticação — token expirado) ou um `401` em qualquer chamada de API, o `AuthContext` desloga o usuário e redireciona para o login. Não há renovação automática de sessão (sem refresh token implementado) — login manual de novo é o caminho esperado após 12h.
- Erros de API (400/403/404/409/500) são exibidos como mensagens simples próximas à ação que falhou (ex: um 409 ao tentar assumir uma conversa já assumida por outro atendente mostra "Conversa já foi assumida por outro atendente").

### Ajustes necessários no backend

1. **`GET /api/agents`** — novo endpoint, protegido por `requireAuth` (qualquer atendente autenticado pode ver a lista, não só admins — é necessário para o seletor de transferência estar disponível a todos). Retorna `[{ id, email, role }]` de todos os agentes cadastrados, sem dados sensíveis (sem hash de senha).
2. **Allowlist de CORS** — hoje `cors()` (Express) e a configuração do Socket.io aceitam qualquer origem. Passam a aceitar apenas a origem do frontend em produção (a URL do Render Static Site, definida via uma nova variável de ambiente `FRONTEND_ORIGIN`) mais `http://localhost:5173` (porta padrão do Vite) durante desenvolvimento — sempre incluindo o `localhost` independente do ambiente, já que não há custo/risco nisso e simplifica o desenvolvimento local.

## Testes

- **Frontend:** Vitest + React Testing Library. Hooks de domínio testados com um socket mockado (emitindo eventos manualmente e verificando o estado resultante) e chamadas de API mockadas (`fetch`/`api.js` mockado). Componentes principais testados por renderização condicional (ex: `ConversationView` mostra o botão certo conforme o status da conversa) e interação básica (clicar em Assumir chama a API certa).
- **Backend:** `GET /api/agents` e o ajuste de CORS seguem o padrão TDD já estabelecido no projeto (Jest + Supertest).
- Sem end-to-end automatizado (fora de escopo, ver acima).

## Próximos passos

Com o spec aprovado, o próximo passo é usar a skill `writing-plans` para transformar isso num plano de implementação detalhado.
