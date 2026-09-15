# INVENTÁRIO FUNCIONAL — dw-whatsapp-backend (frontend + backend)

Levantado em 2026-09-15 por leitura do código (sem alterações). Base: commit 27982e2.

Legenda de perfis (backend real, `src/auth/auth.middleware.js`):

| Guard | Quem passa |
|---|---|
| `requireAuth` | qualquer autenticado: **agent, manager, admin** |
| `requireRole('admin')` | `ADMIN_LEVEL_ROLES = ['admin','manager']` → **admin + manager** (inclusive manager sem `canManageIntegrations`) |
| `requireIntegrationsAccess` | **admin**, ou **manager com `canManageIntegrations === true`** |
| `hasAdminLevelAccess(agent)` | admin+manager (usado *dentro* de rotas: transfer, sector, close, metrics, sala `dashboard` do socket) |
| sem guard | `GET /api/public/company`; rotas com token na query (`/api/media/:id`, `/api/contacts/:id/avatar`, `/api/agents/:id/avatar`, `/api/admin/channels/:id/qr`) |

Rotas do frontend (`frontend/src/App.jsx`): `/login` (livre), `/` (ProtectedRoute), `/metrics`, `/campaigns`, `/campaigns/:id` (ProtectedRoute), `/admin/channels` e `/admin/dashboard` (`ProtectedRoute requireAdmin` → `role === 'admin' || 'manager'`).

---

## 1. Navegação global (NavRail.jsx — presente em todas as páginas internas)

| Função | Página/aba atual | Componente (arquivo) | Rota atual | Perfis (frontend / backend) | Escopo | Leitura | Gravação | Dependências |
|---|---|---|---|---|---|---|---|---|
| Logo com iniciais da empresa | todas | `components/NavRail.jsx` (`iniciaisDaEmpresa`) | todas | todos / rota pública | global | `GET /api/public/company` | — | Nome cadastrado em Administração→Integrações→Empresa; sem nome cai no ícone de chats |
| "Conversas" | todas | NavRail | `/` (ou reset de `selectedId` no Dashboard) | todos / — | por usuário | — | — | — |
| "Relatório" | todas | NavRail | `/metrics` | todos / `requireAuth` | por usuário ou global | `GET /api/metrics` | — | — |
| "Campanhas" | todas | NavRail | `/campaigns` | todos / `requireAuth` | global | `GET /api/campaigns` | — | — |
| "Dashboard de atendimento" | todas | NavRail (`role === 'admin' \|\| 'manager'`) | `/admin/dashboard` | admin+manager / `requireRole('admin')` | global | `GET /api/admin/dashboard/conversations` | — | — |
| "Administração" | todas | NavRail (mesmo teste) | `/admin/channels` | admin+manager / vários | global | — | — | — |
| Som ativado / **Som desativado** (sino) | todas | NavRail + `hooks/useQueueNotificationSound.js` + `useNotificationSound.js` | todas | todos / — | **por usuário (localStorage `dw_queue_notification_muted`)** | — | **nenhum endpoint** — só localStorage | WebAudio (`window.AudioContext`); toca em `queue:new` via socket |
| "Atendimentos encerrados" (só para quem **não** é admin/manager) | todas | NavRail → `ClosedConversationsModal.jsx` → `ClosedConversationsList.jsx` | todas | agent (admin/manager não veem o botão) / `requireAuth` | por usuário | `GET /api/conversations/mine/closed?offset&limit` | — | Paginação 20 em 20 ("Carregar mais") |
| "Meu perfil" | todas | NavRail → `ProfileModal.jsx` | todas | todos / `requireAuth` | por usuário | `GET /api/agents/me` | `PATCH /api/agents/me`, `POST/DELETE /api/agents/me/avatar`, `PUT /api/auth/password` | — |
| "Sair" (logout) | todas | NavRail → `contexts/AuthContext` | todas | todos / — | por usuário | — | limpa token local | — |
| Foto do próprio atendente (avatar quadrado no rodapé) | todas | `AgentAvatar.jsx` | todas | todos / token na query | por usuário | `GET /api/agents/:id/avatar?token=` | — | Ter avatar enviado |
| Faixa de canal com problema ("Canal X está desconectado / aguardando QR — ver na administração de canais") | Atendimento (topo) | `ChannelStatusBanner.jsx` | `/` | **admin ou manager com canManageIntegrations** (`canSeeBanner`) / `GET` é `requireRole('admin')` | global | `GET /api/admin/channels` | — | Ignora canais oficiais (`isOfficialChannelType`); só mostra `status !== 'connected'` |

---

## 2. Atendimento / chat (`pages/DashboardPage.jsx`, rota `/`)

| Função | Página/aba atual | Componente | Rota | Perfis (frontend / backend) | Escopo | Leitura | Gravação | Dependências |
|---|---|---|---|---|---|---|---|---|
| Busca "Pesquisar uma conversa" (nome, telefone, cidade, setor, última msg) | Atendimento | `DashboardPage.jsx` (`matchesSearch`) | `/` | todos / — | por usuário | — (filtro local) | — | Filtra só o que já está em memória |
| Aba **Andamento** (contador) | Atendimento | DashboardPage + `MyConversationsList.jsx` | `/` | todos / `requireAuth` | por usuário | `GET /api/conversations/mine` + socket `conversation:assigned/removed/closed` | — | — |
| Aba **Espera** (fila, `triageState !== 'pending'`) | Atendimento | `QueueList.jsx` | `/` | todos / `requireAuth` | global | `GET /api/conversations/queue` + socket `queue:new/queue:removed` | — | — |
| Aba **Automação** (fila com `triageState === 'pending'`) | Atendimento | `QueueList.jsx` | `/` | todos / `requireAuth` | global | mesma fila | — | Só existe se triagem (numérica ou IA) estiver ligada em algum canal |
| Botão "Finalizar sem motivo" (ícone ✓ no item da fila) | Atendimento (Espera/Automação) e Dashboard de atendimento | `ConversationListItem.jsx` (`onQuickClose`) | `/`, `/admin/dashboard` | todos / `requireAuth` (+`hasAdminLevelAccess` decide `adminCloseConversation`) | por conversa | — | `POST /api/conversations/:id/close` body `{ reasonId: null }` | `window.confirm`; atendente comum só fecha conversa **atribuída a ele** (409 caso contrário); admin/manager fecham qualquer uma |
| Marcador de não-lida + som por mensagem nova | Atendimento | `hooks/useUnreadMyConversations.js` | `/` | todos / — | por usuário | socket `message:new` | — | Respeita o mute do NavRail |
| "Iniciar conversa" (+) | Atendimento | `StartConversationModal.jsx` | `/` | todos / `requireAuth` | global | `GET /api/channels`, `GET /api/templates?channelId=` | `POST /api/conversations/start` | Baileys precisa `status === 'connected'`; **canal oficial exige template aprovado** (botão desabilitado sem template) |
| Painel "Equipe" (online/offline, recolhível) | Atendimento | `TeamPanel.jsx` + `hooks/usePresence.js` | `/` | todos / `requireAuth` | global | `GET /api/agents` + socket `presence:online/offline` | — | — |
| Avatares de contato nas listas | Atendimento / Dashboard | `ContactAvatar.jsx` | `/`, `/admin/dashboard` | todos / token na query | por contato | `GET /api/contacts/:id/avatar?token=&v=avatarPath` | — | — |
| Selo "Triagem IA · motivo", "confiança baixa", "resolvido pela IA" no item da lista | Atendimento / Dashboard | `ConversationListItem.jsx` | `/`, `/admin/dashboard` | todos / — | por conversa | campos `aiTriage*` da conversa | — | Triagem com IA ter rodado |

### 2.1 Conversa aberta (`ConversationView.jsx`)

| Função | Página/aba | Componente | Rota | Perfis (frontend / backend) | Escopo | Leitura | Gravação | Dependências |
|---|---|---|---|---|---|---|---|---|
| Cabeçalho clicável "Editar cliente" (nome · cidade · setor) | Atendimento / modal do Dashboard | `ConversationView.jsx` → `EditContactModal.jsx` | `/`, `/admin/dashboard` | todos / `requireAuth` (**sem checagem de posse**) | por contato | `GET /api/cities` | `PATCH /api/contacts/:id` `{ displayName, cityId, internalNote }` | Cidades cadastradas para o select |
| Botão **Assumir** (só quando não atribuída) | Atendimento | ConversationView | `/` | todos / `requireAuth` | por conversa | — | `POST /api/conversations/:id/claim` | 409 se já atribuída/fechada; dispara "mensagem de abertura" se o atendente+canal estiverem marcados na config de atribuição |
| "Ver atendimentos anteriores" (histórico do contato) | Atendimento | `ConversationHistoryModal.jsx` | `/` | todos / `requireAuth` (**qualquer agente lê qualquer contato**) | por contato | `GET /api/conversations/contacts/:contactId/history`, `GET /api/conversations/:id/messages` | — | — |
| "Consultar SGP" (abre painel lateral) | Atendimento | `SgpLookupPanel.jsx` | `/` | todos / `requireAuth` | por conversa | `GET /api/sgp/clientes?cpf=` | — | **SGP de consulta configurado e Ativo** (senão 400 "SGP integration is not configured/enabled"); abre sozinho se a conversa já tem `contactSgpDocument` |
| "Transferir atendimento" | Atendimento / modal do Dashboard | `TransferModal.jsx` | `/`, `/admin/dashboard` | dono, não-atribuída ou admin/manager (`isMine \|\| isUnassigned \|\| isAdmin`) / `requireAuth` + `hasAdminLevelAccess` escolhe `adminTransferConversation` | por conversa | `GET /api/agents` | `POST /api/conversations/:id/transfer` `{ toAgentId }` | Existir outro atendente |
| "Fechar atendimento" (com motivo) | Atendimento / modal do Dashboard | `CloseReasonModal.jsx` | `/`, `/admin/dashboard` | idem acima / `requireAuth` (+admin-level) | por conversa | `GET /api/reasons` (só ativos) | `POST /api/conversations/:id/close` `{ reasonId }` | **Precisa de ao menos um motivo ativo**; pré-seleciona `conversation.suggestedReasonId` (motivo sugerido pela IA); `reasonId` inválido/inativo = 400 |
| Enviar texto | Atendimento | `MessageInput.jsx` | `/` | **só o atendente dono** (`isMine`) / `requireAuth` + "Only the assigned agent can send messages" | por conversa | — | `POST /api/conversations/:id/messages` `{ content }` | Conversa não fechada e atribuída a você |
| Anexar arquivo | Atendimento | MessageInput | `/` | dono / idem | por conversa | — | mesmo endpoint, `FormData{ content?, file }` | Limite 100 MB (multer) / limites por tipo (image/audio/video 16 MB, document 100 MB) |
| **Gravar áudio / nota de voz** (mic, parar, descartar, cronômetro) | Atendimento | MessageInput (`MediaRecorder`) | `/` | dono / idem | por conversa | — | `FormData{ file: gravacao.webm, voiceNote: 'true' }` | Permissão de microfone; `MediaRecorder` com opus |
| **Resposta citada** (hover na bolha → responder; prévia cancelável) | Atendimento | ConversationView + MessageInput | `/` | dono / idem | por mensagem | — | `{ content, repliedToMessageId }` | Só mensagens **com texto** e **já entregues** (`whatsappMessageId`), da mesma conversa |
| Emojis (grade de 56) | Atendimento | MessageInput | `/` | dono / — | — | — | — (insere no campo) | — |
| Respostas rápidas (popover) | Atendimento | MessageInput | `/` | dono / `requireAuth` | global | `GET /api/quick-replies` | — | Cadastro em Administração→Mensagens; vazio mostra "Nenhuma resposta cadastrada" |
| Player de áudio (play/pause, +15s, velocidade) e transcrição ("Transcrevendo…") | Atendimento | `MessageAttachment.jsx` | `/` | todos / token na query | por mensagem | `GET /api/media/:messageId?token=` + socket `message:transcription` | — | Transcrição exige canal com IA ligada + transcrição habilitada + modelo |
| Imagem em tela cheia, figurinha, documento, localização | Atendimento | `MessageAttachment.jsx` | `/` | todos / token | por mensagem | `GET /api/media/:messageId` | — | — |
| Cartão **Pix** na conversa ("Pix da fatura" / "Pix enviado como texto" + motivo do fallback) | Atendimento | `PixCardMessage.jsx` | `/` | todos / — | por mensagem | `message.metadata` | — | Envio pelo painel SGP; `metadata.fallbackTextoEnviado`/`motivoTexto` |
| Selo "IA" na bolha enviada (`sentBy === 'ai'`) e ticks de status | Atendimento | ConversationView + `MessageStatusTicks.jsx` | `/` | todos / — | por mensagem | — | — | — |
| Aviso fixo "Este atendimento fica registrado no sistema da {empresa}" | Atendimento | ConversationView | `/` | todos / rota pública | global | `GET /api/public/company` | — | — |

### 2.2 Cartão de sugestão da IA (`AiSuggestionCard.jsx`)

| Função | Página/aba | Componente | Rota | Perfis (frontend / backend) | Escopo | Leitura | Gravação | Dependências |
|---|---|---|---|---|---|---|---|---|
| Ver sugestão da IA (texto + avisos "Liberação em confiança executada no SGP", "Código PIX gerado", "Segunda via gerada", "Atendimento transferido de setor", "Motivo registrado") | Atendimento | `AiSuggestionCard.jsx` + `hooks/useAiSuggestion.js` | `/` | **só o dono** (`isMine` evita 403) / `requireAuth` + `loadOwnedConversation` (403 se não for o dono) | por conversa | `GET /api/conversations/:id/ai-suggestion` + socket `ai:suggestion` | — | OpenAI configurada (`mode !== 'disabled'`, apiKey, model) + canal com `aiEnabled` |
| "Enviar" a sugestão | Atendimento | AiSuggestionCard | `/` | dono / idem | por conversa | — | `POST /api/conversations/:id/ai-suggestion/:sid/send` `{ content }` | — |
| "Editar" (carrega no campo; o envio seguinte vira `edited`) | Atendimento | ConversationView (`editedSuggestion`) + MessageInput (`draftContent`/`draftKey`) | `/` | dono / idem | por conversa | — | mesmo endpoint `/send` com o texto alterado | Se o atendente anexar arquivo em vez de texto, a sugestão é **descartada** automaticamente |
| "Descartar" | Atendimento | AiSuggestionCard | `/` | dono / idem | por conversa | — | `POST /api/conversations/:id/ai-suggestion/:sid/discard` | — |

### 2.3 Painel SGP dentro da conversa (`SgpLookupPanel.jsx`)

| Função | Página/aba | Componente | Rota | Perfis (frontend / backend) | Escopo | Leitura | Gravação | Dependências |
|---|---|---|---|---|---|---|---|---|
| Buscar cliente por CPF/CNPJ | Atendimento (painel) | SgpLookupPanel + `hooks/useSgpLookup.js` | `/` | todos / `requireAuth` (**sem checagem de posse**) | global | `GET /api/sgp/clientes?cpf=` | — | SGP de consulta configurado + `enabled` |
| Escolher contrato (select) / ver plano, status, telefones, e-mails | Atendimento | SgpLookupPanel | `/` | todos / — | por contrato | resposta do lookup | — | Cliente com contratos |
| "Consultar fatura em aberto" | Atendimento | `FinanceiroSection` | `/` | todos / `requireAuth` | por contrato | `POST /api/sgp/contratos/:contratoId/boleto` | — | Fatura em aberto; senão "Nenhuma fatura em aberto" |
| Enviar **Cód Pix** | Atendimento | FinanceiroSection | `/` | todos / `requireAuth` + **só o atendente dono da conversa** | por conversa | — | `POST /api/sgp/contratos/:id/pix` `{ conversationId, pixCode, value, dueDate, faturaId }` | Fatura com `pixCode`; código sem `\n` e ≤600 chars |
| Enviar **QR do Pix** (imagem) | Atendimento | FinanceiroSection | `/` | idem | por conversa | — | `POST /api/sgp/contratos/:id/pix-qr` `{ conversationId, pixCode, value, dueDate }` | idem |
| Enviar **Cód Barras** | Atendimento | FinanceiroSection | `/` | idem | por conversa | — | `POST /api/sgp/contratos/:id/barcode` `{ conversationId, barCode, value, dueDate }` | Fatura com `barCode` |
| Enviar **Link da fatura** | Atendimento | FinanceiroSection | `/` | dono / `requireAuth` + posse | por conversa | — | `POST /api/conversations/:id/messages` `{ content: boletoLink }` | Fatura com `boletoLink` |
| Enviar **PDF da fatura** (boleto) | Atendimento | FinanceiroSection | `/` | dono / `requireAuth` + posse | por conversa | — | `POST /api/sgp/contratos/:id/boleto-pdf` `{ conversationId, boletoLink }` | Baixa o PDF do SGP; 502 se o SGP não responder |
| "Ver QR" (prévia local, não envia) | Atendimento | FinanceiroSection (`qrcode`) | `/` | todos / — | local | — | — | — |

---

## 3. Dashboard de atendimento (`pages/AttendanceDashboardPage.jsx`, `/admin/dashboard`)

| Função | Página/aba | Componente | Rota | Perfis (frontend / backend) | Escopo | Leitura | Gravação | Dependências |
|---|---|---|---|---|---|---|---|---|
| Aba "Todos atendimentos" (colunas **Em andamento / Em espera / Na automação**) | Dashboard | AttendanceDashboardPage + `hooks/useAttendanceDashboard.js` | `/admin/dashboard` | admin+manager / `requireRole('admin')` | global | `GET /api/admin/dashboard/conversations` + socket `dashboard:conversation` (sala `dashboard` só para `hasAdminLevelAccess`) | — | — |
| Aba "Encerrados hoje" + "Carregar mais" | Dashboard | AttendanceDashboardPage | `/admin/dashboard` | admin+manager / `requireRole('admin')` | global | `GET /api/admin/dashboard/conversations/closed-today?offset&limit` | — | Paginação 20 |
| Filtro **Canais** (multi) | Dashboard | `FilterDropdown` | `/admin/dashboard` | admin+manager / `requireRole('admin')` | global | `GET /api/admin/channels` | — | — |
| Filtro **Atendentes** (multi) **com a opção sintética "IA"** (`AI_AGENT_FILTER = 'ai'`) | Dashboard | `FilterDropdown` + `isHandledByAi()` | `/admin/dashboard` | admin+manager / `requireAuth` (lista de agentes) | global | `GET /api/agents` | — | "IA" casa conversas sem `assignedAgentId` com `aiTriageResolvedByAi` ou `aiTriageCompletedAt` ou `triageState === 'pending'`; encerradas pela IA aparecem com atendente **"IA"** |
| Filtro **Departamentos** (rótulo da UI para setores) | Dashboard | `FilterDropdown` | `/admin/dashboard` | admin+manager / `requireAuth` | global | `GET /api/sectors` | — | Setores cadastrados |
| Busca **por protocolo** | Dashboard | AttendanceDashboardPage | `/admin/dashboard` | admin+manager / `requireRole('admin')` | global | `GET /api/admin/dashboard/conversations/by-protocol/:protocolNumber` | — | Abre a conversa no modal |
| Busca **por telefone do cliente** (+ "Limpar busca") | Dashboard | AttendanceDashboardPage | `/admin/dashboard` | admin+manager / `requireRole('admin')` | global | `GET /api/admin/dashboard/conversations/by-phone?phone=` | — | Lista todos os atendimentos do contato |
| Abrir conversa em modal (chat + painel de informações) | Dashboard | `ConversationModal.jsx` → `ConversationView` + `ConversationInfoPanel.jsx` | `/admin/dashboard` | admin+manager / `requireAuth` | por conversa | `GET /api/conversations/:id/messages` | ações do chat (transferir/fechar) | — |
| Painel de informações: status (**Encerrado / Na automação / Em espera / Em andamento**), nota interna, cidade, setor, atendente, protocolo, encerrado em | Dashboard (modal) e Encerrados | `ConversationInfoPanel.jsx` | `/admin/dashboard` | todos que abrirem o modal / — | por conversa | dados da conversa | — | — |
| **Alterar setor** (select no painel) | Dashboard (modal) | `ConversationInfoPanel.jsx` | `/admin/dashboard` | `role admin\|manager` **ou** ser o dono (`canEditSector`) / `requireAuth` + `hasAdminLevelAccess` ou posse | por conversa | `GET /api/sectors` | `PUT /api/conversations/:id/sector` `{ sectorId }` | `sectorId` tem que existir (400 "Unknown sectorId"); erro é engolido no `catch(() => {})` |
| Bloco "Triagem por IA" (setor da IA, motivo, identificação — memória/telefone/CPF/CPF+nascimento —, confiança %, resumo) | Dashboard (modal) | `ConversationInfoPanel.jsx` | `/admin/dashboard` | idem / — | por conversa | campos `aiTriage*` | — | `aiTriageCompletedAt` preenchido |
| "Finalizar sem motivo" nas colunas Em espera / Na automação | Dashboard | `ConversationListItem` | `/admin/dashboard` | admin+manager / `requireAuth` (+admin-level fecha qualquer uma) | por conversa | — | `POST /api/conversations/:id/close` `{ reasonId: null }` | `window.confirm` |

---

## 4. Relatório (`pages/MetricsPage.jsx`, `/metrics`) — o menu chama "Relatório"; o título da página é "Relatório"

| Função | Página/aba | Componente | Rota | Perfis (frontend / backend) | Escopo | Leitura | Gravação | Dependências |
|---|---|---|---|---|---|---|---|---|
| Períodos "Últimas 24 horas / 7 dias / 30 dias" | Relatório | MetricsPage | `/metrics` | todos / `requireAuth` | por usuário ou global | `GET /api/metrics?period=` | — | — |
| "Personalizado" + campo "Últimos N dias" + "Aplicar" | Relatório | MetricsPage | `/metrics` | todos / `requireAuth` | idem | `GET /api/metrics?period=custom&days=N` | — | N inteiro 1..365 (validado nos dois lados) |
| Indicadores: Atendimentos fechados, Tempo médio de atendimento, Tempo médio de primeira resposta | Relatório | `StatTile` | `/metrics` | agent vê só o próprio (`scope: 'agent'`) / `hasAdminLevelAccess` decide | por usuário / global | mesmo endpoint | — | — |
| Gráficos "Atendimentos por atendente", "Atendimentos por setor", "Motivos de contato", "Tempo médio por atendente" | Relatório | `ChartCard` + recharts | `/metrics` | **só admin+manager** (`scope: 'admin'`) / `hasAdminLevelAccess` | global | `byAgent`, `bySector`, `byReason` | — | Motivos cadastrados/atribuídos ao fechar |
| **Exportar CSV** (`relatorio-<period>-<data>.csv`, com BOM) | Relatório | MetricsPage + `utils/exportMetricsCsv.js` | `/metrics` | todos (desabilitado sem dados) / — | local | — | download no browser | Precisa de `data` carregado |

---

## 5. Campanhas (`/campaigns`, `/campaigns/:id`)

| Função | Página/aba | Componente | Rota | Perfis (frontend / backend) | Escopo | Leitura | Gravação | Dependências |
|---|---|---|---|---|---|---|---|---|
| Listar campanhas (enviados/falharam/pulados de N) | Campanhas | `pages/CampaignsPage.jsx` | `/campaigns` | todos / `router.use(requireAuth)` | global | `GET /api/campaigns` | — | — |
| "Nova campanha" / "Disparar" | Campanhas | `CreateCampaignModal.jsx` | `/campaigns` | todos / `requireAuth` | global | `GET /api/channels`, `GET /api/templates?channelId=` | `POST /api/campaigns` | Baileys conectado **ou** canal oficial; canal oficial **exige template aprovado**; destinatários "telefone" ou "telefone,nome" por linha |
| Detalhe da campanha + status por destinatário (Pendente/Enviado/Falhou/Pulado) | Campanha | `pages/CampaignDetailPage.jsx` | `/campaigns/:id` | todos / `requireAuth` | global | `GET /api/campaigns/:id` (polling 5 s enquanto processa) | — | — |

---

## 6. Administração (`pages/AdminChannelsPage.jsx`, `/admin/channels`) — abas de `SECTION_GROUPS`

Regra de visibilidade no frontend: `hasIntegrationsAccess = role==='admin' || (role==='manager' && canManageIntegrations)`. Quem não tem: **some a aba "Canais" e o grupo inteiro "Integrações"**.

### 6.1 Aba **Canais** (grupo "Canais")

| Função | Página/aba | Componente | Rota | Perfis (frontend / backend) | Escopo | Leitura | Gravação | Dependências |
|---|---|---|---|---|---|---|---|---|
| Listar canais (nome, tipo, telefone, status **Conectado / Aguardando QR code / Desconectado / "Oficial · API"**) | Admin→Canais | AdminChannelsPage + `hooks/useChannels.js` | `/admin/channels` | integrations / **`GET` é `requireRole('admin')`** (manager sem flag também lê) | global | `GET /api/admin/channels[?includeHidden=true]` | — | — |
| Checkbox **"Mostrar canais ocultos"** | Admin→Canais | AdminChannelsPage | `/admin/channels` | integrations / idem | global | refaz o GET com `includeHidden=true` | — | — |
| Checkbox "Usar triagem automática" | Admin→Canais | `ChannelCard` | `/admin/channels` | integrations / **`requireIntegrationsAccess`** | por canal | — | `PATCH /api/admin/channels/:id` `{ triageEnabled }` | Sem opções de triagem cadastradas a triagem não roda (aviso na aba Triagem) |
| Checkbox "Usar atendimento por IA" | Admin→Canais | ChannelCard (`handleToggleAi`) | `/admin/channels` | integrations / `requireIntegrationsAccess` | por canal | — | `PATCH … { aiEnabled }` **+ ao ligar, segundo PATCH `{ triageEnabled: false }`** | OpenAI configurada para ter efeito real |
| Checkbox "Triagem com IA" (`disabled` sem aiEnabled) | Admin→Canais | ChannelCard | `/admin/channels` | integrations / `requireIntegrationsAccess` | por canal | — | `PATCH … { aiTriageEnabled }` | 400 `aiTriageEnabled requires aiEnabled` |
| Checkbox "Atendimento noturno com IA" (`disabled` sem aiTriageEnabled) | Admin→Canais | ChannelCard | `/admin/channels` | integrations / `requireIntegrationsAccess` | por canal | — | `PATCH … { aiNightModeEnabled }` | Exige aiEnabled+aiTriageEnabled **e janela `nightStartTime`/`nightEndTime` salva** no cartão "Triagem com IA" |
| Campo **WABA ID** + "Salvar WABA ID" (só canal oficial) | Admin→Canais | ChannelCard | `/admin/channels` | integrations / `requireIntegrationsAccess` | por canal | — | `PATCH … { wabaId }` | `isOfficialChannelType` (meta_cloud/360dialog); string não vazia |
| **QR code** (iframe) + "Atualizar" | Admin→Canais | `QrCodeView.jsx` | `/admin/channels` | integrations / `authenticateQrRoute` (token na query + `hasIntegrationsAccess`) | por canal | `GET /api/admin/channels/:id/qr?token=` | — | Só baileys com `status === 'awaiting_qr'`; página faz polling de 5 s |
| "Reconectar" (só baileys) | Admin→Canais | ChannelCard | `/admin/channels` | integrations / `requireIntegrationsAccess` | por canal | — | `POST /api/admin/channels/:id/reconnect` | `window.confirm` se já conectado ("derruba a sessão atual") |
| **"Ocultar" / "Reexibir"** | Admin→Canais | ChannelCard | `/admin/channels` | integrations / `requireIntegrationsAccess` | por canal | — | `PATCH … { hidden }` | Ocultar encerra a sessão baileys (`stopBaileysChannel`); histórico preservado |
| "Excluir" canal | Admin→Canais | ChannelCard | `/admin/channels` | integrations / `requireIntegrationsAccess` | por canal | — | `DELETE /api/admin/channels/:id` | 409 se já teve conversas ou tem integração SGP ("Use Ocultar") |
| "Criar canal" (Baileys / Meta Cloud / 360dialog) | Admin→Canais | `CreateChannelModal.jsx` + `CreateChannelForm.jsx` | `/admin/channels` | integrations / `requireIntegrationsAccess` | global | — | `POST /api/admin/channels` | meta_cloud: `phoneNumberId`+`accessToken`+`wabaId`; 360dialog: `apiKey`+`wabaId` (registra webhook, e apaga o canal se falhar); 409 telefone duplicado |

### 6.2 Aba **Triagem** (grupo "Canais")

| Função | Página/aba | Componente | Rota | Perfis | Escopo | Leitura | Gravação | Dependências |
|---|---|---|---|---|---|---|---|---|
| Aviso "Nenhuma opção cadastrada — a triagem não será executada em nenhum canal, mesmo com o **toggle** ligado" | Admin→Triagem | `TriageAdminTab.jsx` | `/admin/channels` | admin+manager / `requireRole('admin')` | global | `GET /api/admin/triage` | — | `options.length === 0` |
| Formulário "Pergunta de triagem" (pergunta, confirmação, tentativas) | Admin→Triagem | `TriageConfigForm.jsx` | `/admin/channels` | admin+manager / `requireRole('admin')` | global | `GET /api/admin/triage` | `PUT /api/admin/triage/config` `{ questionText, confirmationText, maxAttempts }` | — |
| "Criar opção" (número, setor, frases-gatilho) | Admin→Triagem | `CreateTriageOptionForm.jsx` | `/admin/channels` | admin+manager / `requireRole('admin')` | global | `GET /api/sectors` | `POST /api/admin/triage/options` `{ optionNumber, sectorId, keywords[] }` | **Precisa de setores cadastrados** |
| Editar opção / Excluir opção | Admin→Triagem | `TriageOptionRow` | `/admin/channels` | admin+manager / `requireRole('admin')` | por opção | — | `PATCH /api/admin/triage/options/:id`, `DELETE …/:id` | `window.confirm` na exclusão |
| Ajuda "Triagem" (SectionHelp) | Admin→Triagem | `SectionHelp.jsx` | `/admin/channels` | — | — | — | — | — |

### 6.3 Aba **Atendentes** (grupo "Equipe") — o cadastro se chama "Atendentes"

| Função | Página/aba | Componente | Rota | Perfis (frontend / backend) | Escopo | Leitura | Gravação | Dependências |
|---|---|---|---|---|---|---|---|---|
| Lista de atendentes (nome, email, **Administrador/Gerente/Atendente**, setores, **Ativo/Desativado**) | Admin→Atendentes | `AgentsAdminTab.jsx` | `/admin/channels` | admin+manager / `requireRole('admin')` | global | `GET /api/admin/agents` | — | — |
| "Editar setores" (checkboxes) + Salvar/Cancelar | Admin→Atendentes | `AgentRow` | `/admin/channels` | admin+manager / `requireRole('admin')` **+ manager só mexe em conta `agent`** | por usuário | `GET /api/sectors` | `PUT /api/admin/agents/:id/sectors` `{ sectorIds: [] }` | Setores cadastrados |
| "Gerar nova senha" (modal com a senha + Copiar) | Admin→Atendentes | AgentRow | `/admin/channels` | admin+manager (oculto para si mesmo) / `requireRole('admin')` + 400 na própria conta + manager só em `agent` | por usuário | — | `PUT /api/admin/agents/:id/password` | `navigator.clipboard` para copiar |
| "Desativar" / "Reativar" | Admin→Atendentes | AgentsAdminTab | `/admin/channels` | admin+manager (oculto para si) / `requireRole('admin')`; 400 desativar a própria conta; manager só `agent` | por usuário | — | `PATCH /api/admin/agents/:id` `{ active }` | — |
| "Criar atendente" | Admin→Atendentes | `CreateAgentForm.jsx` | `/admin/channels` | admin+manager / `requireRole('admin')`; **manager só cria role `agent`** (403) | global | — | `POST /api/admin/agents` `{ name, email, password, role, canManageIntegrations? }` | 409 e-mail duplicado |
| Checkbox **"Pode gerenciar Canais e Integrações"** (só quando Tipo = Gerente) | Admin→Atendentes | CreateAgentForm | `/admin/channels` | admin / backend grava só se `role === 'manager'`, senão força `false` | por usuário | — | mesmo POST, campo `canManageIntegrations` | Entra no JWT (`auth.service.js`) — só vale no próximo login |

### 6.4 Aba **Setores** (grupo "Equipe")

| Função | Página/aba | Componente | Rota | Perfis | Escopo | Leitura | Gravação | Dependências |
|---|---|---|---|---|---|---|---|---|
| Listar setores | Admin→Setores | `SectorsAdminTab.jsx` | `/admin/channels` | admin+manager / `GET /api/sectors` é `requireAuth` | global | `GET /api/sectors` | — | — |
| "Editar": nome + **"Orientação para a IA"** (`aiHint`) | Admin→Setores | `SectorRow` | `/admin/channels` | admin+manager / `requireRole('admin')` | por setor | — | `PATCH /api/admin/sectors/:id` `{ name, aiHint }` | `aiHint` só é gravado se vier string |
| "Excluir" setor | Admin→Setores | SectorRow | `/admin/channels` | admin+manager / `requireRole('admin')` | por setor | — | `DELETE /api/admin/sectors/:id` | `window.confirm` |
| "Cadastrar novo setor" | Admin→Setores | `CreateSectorForm.jsx` | `/admin/channels` | admin+manager / `requireRole('admin')` | global | — | `POST /api/admin/sectors` `{ name }` | — |

### 6.5 Aba **Mensagens** (`quickReplies`, grupo "Atendimento") — `MessagesAdminTab.jsx`

| Função | Página/aba | Componente | Rota | Perfis (frontend / backend) | Escopo | Leitura | Gravação | Dependências |
|---|---|---|---|---|---|---|---|---|
| **Boas-vindas por canal** — "Criar boas-vindas"/"Editar" | Admin→Mensagens | `ChannelWelcomeMessageRow` | `/admin/channels` | admin+manager (aba visível) / **`PATCH /api/admin/channels/:id` = `requireIntegrationsAccess`** — manager sem a flag vê a seção e toma 403 | por canal | `GET /api/admin/channels` | `PATCH /api/admin/channels/:id` `{ welcomeMessage }` | ≤4096 chars |
| Boas-vindas — "Excluir" | Admin→Mensagens | ChannelWelcomeMessageRow | `/admin/channels` | idem | por canal | — | mesmo PATCH com `welcomeMessage: ''` (vira `null`) | `window.confirm` |
| **Avisos por cidade** — "Criar aviso"/"Editar" + checkbox **Ativo** | Admin→Mensagens | `CityNoticeRow` | `/admin/channels` | admin+manager / `requireRole('admin')` | por cidade | `GET /api/admin/cities/notices` | `PATCH /api/admin/cities/:cityId/notice` `{ message, enabled }` | **Precisa de cidades**: sem elas, aviso "Nenhuma cidade cadastrada ainda…"; msg ≤4096 |
| Avisos por cidade — "Excluir" | Admin→Mensagens | CityNoticeRow | `/admin/channels` | admin+manager / `requireRole('admin')` | por cidade | — | `DELETE /api/admin/cities/:cityId/notice` | `window.confirm` |
| **Atribuir um atendimento** (mensagem de abertura/encerramento) | Admin→Mensagens | `AssignmentMessageSection` | `/admin/channels` | admin+manager / `requireRole('admin')` | global (com listas de atendentes e canais) | `GET /api/admin/assignment-message`, `GET /api/admin/agents`, `GET /api/admin/channels` | `PUT /api/admin/assignment-message` | Placeholders `@chat_saudacao_maiusculo`, `@chat_atendente`, `@chat_protocolo`; abertura e encerramento **obrigatórios** |
| **Horário de atendimento** | Admin→Mensagens | `BusinessHoursSection` | `/admin/channels` | admin+manager / `requireRole('admin')` | global | `GET /api/admin/business-hours` | `PUT /api/admin/business-hours` | `HH:MM`, fim > início, mensagem obrigatória; vale seg–sex (sáb/dom sempre fora) |
| **Respostas rápidas** — "Criar resposta rápida" | Admin→Mensagens | `CreateQuickReplyForm.jsx` | `/admin/channels` | admin+manager / `requireRole('admin')` | global | — | `POST /api/admin/quick-replies` `{ title, content }` | — |
| Respostas rápidas — "Ver mensagens (N)" → Editar / Excluir | Admin→Mensagens | `QuickRepliesModal`/`QuickReplyRow` | `/admin/channels` | admin+manager / `requireRole('admin')` | por item | `GET /api/quick-replies` | `PATCH /api/admin/quick-replies/:id`, `DELETE …/:id` | `window.confirm` na exclusão |
| **Templates** (bloco embutido) | Admin→Mensagens | `TemplatesAdminTab.jsx` | `/admin/channels` | admin+manager / `requireRole('admin')` | global | `GET /api/admin/templates`, `GET /api/admin/channels` | ver abaixo | **Só canais oficiais** |
| Templates — "Sincronizar agora (WABA_ID)" | Admin→Mensagens | TemplatesAdminTab | `/admin/channels` | admin+manager / `requireRole('admin')` | por WABA | — | `POST /api/admin/templates/sync` `{ wabaId }` | Canal oficial com `wabaId` preenchido |
| Templates — "Ver templates (N)" / Excluir | Admin→Mensagens | `TemplatesModal`/`TemplateRow` | `/admin/channels` | admin+manager / `requireRole('admin')` | por template | `GET /api/admin/templates` | `DELETE /api/admin/templates/:id` | `window.confirm` |
| Templates — "Cadastrar novo template" | Admin→Mensagens | TemplatesAdminTab | `/admin/channels` | admin+manager / `requireRole('admin')` | global | — | `POST /api/admin/templates` `{ channelId, name, category, language, bodyText }` | Canal oficial; categoria UTILITY/MARKETING |
| Templates — "Registrar template existente" | Admin→Mensagens | `RegisterExistingTemplateForm` | `/admin/channels` | admin+manager / `requireRole('admin')` | global | — | `POST /api/admin/templates/register-existing` `{ channelId, name, language, headerType }` | Template já aprovado na Meta |

### 6.6 Aba **Motivos** (grupo "Atendimento")

| Função | Página/aba | Componente | Rota | Perfis | Escopo | Leitura | Gravação | Dependências |
|---|---|---|---|---|---|---|---|---|
| Listar motivos | Admin→Motivos | `ReasonsAdminTab.jsx` | `/admin/channels` | admin+manager / `requireRole('admin')` | global | `GET /api/admin/reasons` (todos, ativos e inativos) | — | — |
| "Criar motivo" | Admin→Motivos | `CreateReasonForm.jsx` | `/admin/channels` | admin+manager / `requireRole('admin')` | global | — | `POST /api/admin/reasons` `{ name }` | — |
| "Editar" nome | Admin→Motivos | `ReasonRow` | `/admin/channels` | admin+manager / `requireRole('admin')` | por motivo | — | `PATCH /api/admin/reasons/:id` `{ name }` | — |
| "Desativar" / "Ativar" | Admin→Motivos | ReasonRow | `/admin/channels` | admin+manager / `requireRole('admin')` | por motivo | — | `PATCH /api/admin/reasons/:id` `{ active }` | Motivo inativo não aparece no fechamento nem pode ser usado (400) |
| Ajuda "Motivos de contato" (menciona o **Relatório** → "Motivos de Contato") | Admin→Motivos | `SectionHelp.jsx` | `/admin/channels` | — | — | — | — | — |

### 6.7 Aba **Cidades** (grupo "Atendimento")

| Função | Página/aba | Componente | Rota | Perfis | Escopo | Leitura | Gravação | Dependências |
|---|---|---|---|---|---|---|---|---|
| Etiquetas de cidades | Admin→Cidades | `CitiesAdminTab.jsx` | `/admin/channels` | admin+manager / `GET /api/cities` é `requireAuth` | global | `GET /api/cities` | — | — |
| Excluir cidade (✕ na etiqueta) | Admin→Cidades | `CityChip` | `/admin/channels` | admin+manager / `requireRole('admin')` | por cidade | — | `DELETE /api/admin/cities/:id` | `window.confirm` |
| "Cadastrar nova cidade" | Admin→Cidades | `CreateCityForm.jsx` | `/admin/channels` | admin+manager / `requireRole('admin')` | global | — | `POST /api/admin/cities` `{ name }` | Cidades alimentam Editar cliente e Avisos por cidade |

### 6.8 Aba **Integrações** (grupo "Integrações") — `IntegrationsAdminTab.jsx`

| Função | Página/aba | Componente | Rota | Perfis (frontend / backend) | Escopo | Leitura | Gravação | Dependências |
|---|---|---|---|---|---|---|---|---|
| Cartão **Empresa** (nome + nomes aceitos no comprovante) | Admin→Integrações | `CompanyConfigCard.jsx` | `/admin/channels` | integrations (UI) / **`requireRole('admin')`** (manager sem flag também passaria no backend) | global | `GET /api/admin/company` | `PUT /api/admin/company` `{ name, acceptedPayeeNames[] }` | Nome ≤80 chars; ≤20 nomes; sem nomes **nenhum comprovante confere** |
| Cartão **Consulta ao SGP (cliente/boleto)** | Admin→Integrações | `SgpQueryConfigCard.jsx` | `/admin/channels` | integrations / `requireIntegrationsAccess` | global | `GET /api/admin/integrations/sgp-query-config` | `PUT …/sgp-query-config` | Token obrigatório na 1ª vez; "Trocar token" para substituir; `enabled` controla o painel SGP na conversa |
| Cartão **Integração com OpenAI** (selo Desativada/Não configurada/Conectada/Erro) | Admin→Integrações | `OpenAiConfigCard.jsx` | `/admin/channels` | integrations / `GET` `requireRole('admin')`, `PUT` `requireIntegrationsAccess` | global | `GET /api/admin/ai/config` | `PUT /api/admin/ai/config` | Modo "Automático" **bloqueado** (400); chave obrigatória se modo ≠ disabled |
| Botão "Testar conexão" (lista modelos) | Admin→Integrações | OpenAiConfigCard | `/admin/channels` | integrations / `POST /api/admin/ai/test-connection` = `requireIntegrationsAccess` | global | — | `POST …/test-connection` `{ apiKey? }` | Sem chave: `{ ok:false }` |
| Cartão **Transcrição de áudio** | Admin→Integrações | `AudioTranscriptionConfigCard.jsx` | `/admin/channels` | integrations (UI) / **`PUT /api/admin/ai/transcription` = `requireRole('admin')`** | global | `GET /api/admin/ai/config` | `PUT /api/admin/ai/transcription` | Modelo obrigatório se ligado; só roda em canal com `aiEnabled` |
| Botão "Buscar modelos" | Admin→Integrações | AudioTranscriptionConfigCard | `/admin/channels` | integrations / `requireIntegrationsAccess` | global | `POST /api/admin/ai/test-connection` (sem chave: usa a salva) | — | Chave já salva |
| Cartão **Triagem com IA** | Admin→Integrações | `AiTriageConfigCard.jsx` | `/admin/channels` | integrations (UI) / **`PUT /api/admin/ai/triage` = `requireRole('admin')`** | global | `GET /api/admin/ai/config`, `GET /api/reasons` | `PUT /api/admin/ai/triage` | Motivo de encerramento precisa ser **ativo**; janela noturna exige início **e** fim |
| Cartão **Permissões de ferramentas da IA** (Consulta / Ação / Ação sensível) | Admin→Integrações | `AiToolPermissionsCard.jsx` | `/admin/channels` | integrations (UI) / **`requireRole('admin')`** | por ferramenta (global) | `GET /api/admin/ai/tools` | `PUT /api/admin/ai/tools/:nome` `{ enabled }` | Ferramenta tem que existir no registry (404) |
| Lista de gateways SGP (descrição, canal, modo **Texto livre (Baileys) / Template (oficial)**, "Uma chave já foi gerada") | Admin→Integrações | `IntegrationCard` | `/admin/channels` | integrations / `requireIntegrationsAccess` | por canal | `GET /api/admin/integrations/sgp` | — | — |
| Checkbox **Ativo** do gateway SGP | Admin→Integrações | IntegrationCard (`handleToggleEnabled`) | `/admin/channels` | integrations / `requireIntegrationsAccess` | por integração | — | `PUT /api/admin/integrations/sgp/:id` reenviando `{ description, channelId, defaultTemplateId, enabled }` | — |
| "Gerar nova chave" (mostra uma única vez) | Admin→Integrações | IntegrationCard | `/admin/channels` | integrations / `requireIntegrationsAccess` | por integração | — | `POST /api/admin/integrations/sgp/:id/rotate-key` | — |
| "Editar" gateway (descrição, canal, template padrão) | Admin→Integrações | IntegrationCard | `/admin/channels` | integrations / `requireIntegrationsAccess` | por integração | `GET /api/admin/templates` | `PUT /api/admin/integrations/sgp/:id` (repassa `enabled` inalterado de propósito) | Template padrão só aparece em canal oficial |
| "Nova integração SGP" | Admin→Integrações | IntegrationsAdminTab | `/admin/channels` | integrations / `requireIntegrationsAccess` | global | `GET /api/admin/channels`, `GET /api/admin/templates` | `POST /api/admin/integrations/sgp` | **Um gateway por canal** (canais já integrados somem do select); só templates `APPROVED` |

---

## 7. Login

| Função | Página | Componente | Rota | Perfis | Escopo | Leitura | Gravação | Dependências |
|---|---|---|---|---|---|---|---|---|
| Entrar (email + senha) | Login | `pages/LoginPage.jsx` + `contexts/AuthContext` | `/login` | público / sem guard | — | `GET /api/public/company` (nome/rodapé) | `POST /api/auth/login` | Conta ativa; o JWT carrega `role` e `canManageIntegrations` |

---

# ANEXO 1 — Todos os checkboxes / toggles e o que gravam

| Controle (rótulo) | Componente | Endpoint | Campo gravado | Observação |
|---|---|---|---|---|
| "Usar triagem automática" | AdminChannelsPage/ChannelCard | `PATCH /api/admin/channels/:id` | `triageEnabled` | — |
| "Usar atendimento por IA" | ChannelCard | `PATCH /api/admin/channels/:id` (×2 ao ligar) | `aiEnabled` **+** `triageEnabled:false` | 2ª chamada só no frontend |
| "Triagem com IA" | ChannelCard | `PATCH …/:id` | `aiTriageEnabled` | desabilitado sem `aiEnabled` |
| "Atendimento noturno com IA" | ChannelCard | `PATCH …/:id` | `aiNightModeEnabled` | desabilitado sem `aiTriageEnabled` |
| "Mostrar canais ocultos" | AdminChannelsPage | — | **nada** (só `?includeHidden=true` no GET) | estado local |
| Checkboxes de setor por atendente | AgentsAdminTab/AgentRow | `PUT /api/admin/agents/:id/sectors` | `sectorIds[]` | grava só ao clicar Salvar |
| "Pode gerenciar Canais e Integrações" | CreateAgentForm | `POST /api/admin/agents` | `canManageIntegrations` | só quando `role === 'manager'` |
| "Ativo" (aviso de cidade) | MessagesAdminTab/CityNoticeRow | `PATCH /api/admin/cities/:id/notice` | `enabled` (junto com `message`) | só ao Salvar |
| "Ativo" (Atribuir um atendimento) | AssignmentMessageSection | `PUT /api/admin/assignment-message` | `enabled` | junto com o formulário inteiro |
| Checkbox por **atendente** (atribuição) | AssignmentMessageSection | idem | `agentIds[]` | idem |
| Checkbox por **canal** (atribuição) | AssignmentMessageSection | idem | `channelIds[]` | idem |
| "Ativo" (Horário de atendimento) | BusinessHoursSection | `PUT /api/admin/business-hours` | `enabled` | junto com o formulário |
| "Transcrever áudios automaticamente" | AudioTranscriptionConfigCard | `PUT /api/admin/ai/transcription` | `transcriptionEnabled` | só ao Salvar |
| "Enviar transcrição para a IA" | AudioTranscriptionConfigCard | idem | `transcriptionFeedAi` | idem |
| "Exigir data de nascimento depois do CPF" | AiTriageConfigCard | `PUT /api/admin/ai/triage` | `triageRequireBirthdate` | padrão desmarcado |
| "Ler comprovantes também de dia (sem desbloqueio)" | AiTriageConfigCard | idem | `triageReadReceiptsDaytime` | padrão desmarcado; custa visão da OpenAI |
| "Ativo" (Consulta ao SGP) | SgpQueryConfigCard | `PUT /api/admin/integrations/sgp-query-config` | `enabled` | junto com URL/app/token |
| "Ativo" (gateway SGP, no cartão) | IntegrationsAdminTab/IntegrationCard | `PUT /api/admin/integrations/sgp/:id` | `enabled` | **grava na hora** (onChange) |
| "Ativo" (novo gateway SGP) | IntegrationsAdminTab (form) | `POST /api/admin/integrations/sgp` | `enabled` | só ao Cadastrar |
| Checkbox por ferramenta da IA | AiToolPermissionsCard | `PUT /api/admin/ai/tools/:nome` | `enabled` | **grava na hora** |
| Filtros Canais/Atendentes/Departamentos (checkbox) | AttendanceDashboardPage/FilterDropdown | — | **nada** (filtro local) | inclui o valor sintético `'ai'` |
| Radio de motivo (fechar atendimento) | CloseReasonModal | `POST /api/conversations/:id/close` | `reasonId` | — |
| Sino de som (botão-toggle) | NavRail | — | `localStorage.dw_queue_notification_muted` | nunca vai ao servidor |
| "Equipe" (expandir/recolher) | TeamPanel | — | estado local | — |
| Botão "Ver QR" (aria-pressed) | SgpLookupPanel/SendAction | — | estado local | prévia, não envia |

---

# ANEXO 2 — Formulários e o payload exato do Salvar

Legenda das duas colunas novas (revisão final, Task 21): **Destino proposto** é a página nova (spec seção 4); todas as linhas continuam gravando no mesmo endpoint com o mesmo payload — só a casca muda. **Como verificar** aponta `arquivo:linha` do teste que renderiza o formulário novo, preenche os campos, clica em Salvar e afirma `expect(api.fn).toHaveBeenCalledWith({...payload exato...}, token)`; caminhos são relativos a `frontend/src/`. Três formulários não tinham esse teste e ganharam um nesta revisão (marcados **[novo]**); um teste existente foi apertado de `objectContaining` para o payload exato (marcado **[reforçado]**).

| Formulário | Componente | Endpoint | Payload exato | Destino proposto | Como verificar |
|---|---|---|---|---|---|
| Login | LoginPage | `POST /api/auth/login` | `{ email, password }` | Login (`/login`, sem mudança) | `pages/LoginPage.test.jsx:84` |
| Meu perfil | ProfileModal | `PATCH /api/agents/me` | `{ name, phone }` | Rodapé do menu › Meu perfil (modal atual, sem mudança) | `components/ProfileModal.test.jsx:37` |
| Foto de perfil | ProfileModal | `POST /api/agents/me/avatar` / `DELETE` | `FormData{ file }` (jpeg/png/webp/gif, 5 MB) | Rodapé do menu › Meu perfil | `components/ProfileModal.test.jsx:50` (upload) e `:62` (excluir) |
| Trocar senha | ProfileModal | `PUT /api/auth/password` | `{ currentPassword, newPassword }` (confirmação só validada no cliente) | Rodapé do menu › Meu perfil | `components/ProfileModal.test.jsx:81` |
| Editar cliente | EditContactModal | `PATCH /api/contacts/:contactId` | `{ displayName, cityId: cityId \|\| null, internalNote: internalNote \|\| null }` | Atendimento `/` (sem mudança) | `components/EditContactModal.test.jsx:77` |
| Iniciar conversa | StartConversationModal | `POST /api/conversations/start` | oficial: `{ channelId, phoneNumber, templateId, templateVariables[] }` · baileys: `{ channelId, phoneNumber, content }` | Atendimento `/` (sem mudança) | `components/StartConversationModal.test.jsx:49` (baileys); variante oficial em `:136` |
| Nova campanha | CreateCampaignModal | `POST /api/campaigns` | oficial: `{ channelId, name, templateId, templateVariables[], recipients }` · baileys: `{ channelId, name, content, recipients }` | Campanhas `/campanhas` | `components/CreateCampaignModal.test.jsx:60` (Revisar → Confirmar e disparar) e `:153` (paridade de payload) |
| Enviar mensagem | MessageInput → ConversationView | `POST /api/conversations/:id/messages` | texto: `{ content }` ou `{ content, repliedToMessageId }` · arquivo: `FormData{ content?, file, voiceNote?, repliedToMessageId? }` | Atendimento `/` (sem mudança) | `hooks/useConversationMessages.test.jsx:129,144,155`; UI: `components/ConversationView.test.jsx:380,575` |
| Fechar atendimento | CloseReasonModal | `POST /api/conversations/:id/close` | `{ reasonId }` (ou `{ reasonId: null }` no "Finalizar sem motivo") | Atendimento `/` e Supervisão `/supervisao` (modal da conversa) | `components/ConversationView.test.jsx:208,306`; "sem motivo": `pages/DashboardPage.test.jsx:186`, `pages/SupervisionPage.test.jsx:92` |
| Transferir | TransferModal | `POST /api/conversations/:id/transfer` | `{ toAgentId }` | Atendimento `/` e Supervisão `/supervisao` | `components/TransferModal.test.jsx:39` |
| Alterar setor | ConversationInfoPanel | `PUT /api/conversations/:id/sector` | `{ sectorId }` (ou `null`) | Supervisão `/supervisao` (painel da conversa) | `components/ConversationInfoPanel.test.jsx:112` |
| Criar canal | CreateChannelForm | `POST /api/admin/channels` | baileys: `{ type, name, phoneNumber }` · meta_cloud: `{ type, name, phoneNumber, phoneNumberId, accessToken, wabaId }` · 360dialog: `{ type, name, phoneNumber, apiKey, wabaId }` | Configurações › Canais WhatsApp › Lista | `components/CreateChannelForm.test.jsx:28` (baileys), `:56` (meta_cloud), `:89` (360dialog) |
| WABA ID | AdminChannelsPage → useChannelActions | `PATCH /api/admin/channels/:id` | `{ wabaId }` | Configurações › Canais WhatsApp › Detalhe · Conexão | `pages/settings/channels/useChannelActions.test.jsx:160` |
| Boas-vindas do canal | ChannelWelcomeMessageRow | `PATCH /api/admin/channels/:id` | `{ welcomeMessage }` (Excluir manda `''`) | Configurações › Mensagens e templates › Boas-vindas | `components/messages/ChannelWelcomeMessageRow.test.jsx:54` (salvar), `:87` (excluir) |
| Criar atendente | CreateAgentForm | `POST /api/admin/agents` | `{ name, email, password, role }` **+ `canManageIntegrations`** só se `role === 'manager'` | Configurações › Equipe e acesso › Usuários | `components/CreateAgentForm.test.jsx:28` (padrão), `:47` (admin), `:77` (manager com flag), `:95` (manager sem flag) |
| Setores do atendente | AgentsAdminTab | `PUT /api/admin/agents/:id/sectors` | `{ sectorIds: [] }` | Configurações › Equipe e acesso › Usuários | `components/AgentsAdminTab.test.jsx:220` (marca), `:246` (desmarca tudo) |
| Criar/editar setor | CreateSectorForm / SectorRow | `POST /api/admin/sectors` / `PATCH /api/admin/sectors/:id` | `{ name }` / **`{ name, aiHint }` (dois campos juntos)** | Configurações › Equipe e acesso › Setores | `components/CreateSectorForm.test.jsx:25` (criar); `components/SectorsAdminTab.test.jsx:38,69` (editar) |
| Criar/editar motivo | CreateReasonForm / ReasonRow | `POST /api/admin/reasons` / `PATCH …/:id` | `{ name }` / `{ name }` ou `{ active }` | Configurações › Cadastros auxiliares › Motivos de atendimento | `components/ReasonsAdminTab.test.jsx:38` (criar), `:53` (ativo/inativo), `:96` (nome) |
| Criar cidade | CreateCityForm | `POST /api/admin/cities` | `{ name }` | Configurações › Cadastros auxiliares › Cidades | `components/CreateCityForm.test.jsx:25` |
| Aviso de cidade | CityNoticeRow | `PATCH /api/admin/cities/:cityId/notice` | **`{ message, enabled }` (juntos)** | Configurações › Mensagens e templates › Avisos por cidade | `components/messages/CityNoticeRow.test.jsx:67` |
| Resposta rápida | CreateQuickReplyForm / QuickReplyRow | `POST /api/admin/quick-replies` / `PATCH …/:id` | `{ title, content }` | Configurações › Mensagens e templates › Respostas rápidas | `components/CreateQuickReplyForm.test.jsx:27` (criar); `components/messages/QuickReplyRow.test.jsx:29` (editar) |
| **Atribuir um atendimento** | AssignmentMessageSection | `PUT /api/admin/assignment-message` | **`{ enabled, openingMessage, closingMessage, agentIds, channelIds }` — 5 campos num Salvar só** | Configurações › Regras de atendimento › Atribuição | `pages/settings/rules/AssignmentPage.test.jsx:81` **[reforçado — era `objectContaining`, faltavam `enabled`/`channelIds`; agora é o objeto exato]** |
| **Horário de atendimento** | BusinessHoursSection | `PUT /api/admin/business-hours` | **`{ enabled, startTime, endTime, message }` — 4 campos juntos** | Configurações › Regras de atendimento › Horário de atendimento | `pages/settings/rules/BusinessHoursPage.test.jsx:64` |
| Config. de triagem numérica | TriageConfigForm | `PUT /api/admin/triage/config` | **`{ questionText, confirmationText, maxAttempts: Number }`** | Configurações › Automação e IA › Triagem por menu | `pages/settings/automation/MenuTriagePage.test.jsx:61` (página); componente: `components/TriageAdminTab.test.jsx:58` |
| Opção de triagem | CreateTriageOptionForm / TriageOptionRow | `POST /api/admin/triage/options` / `PATCH …/:id` | `{ optionNumber: Number, sectorId, keywords: string[] }` (keywords vêm de um campo separado por vírgula) | Configurações › Automação e IA › Triagem por menu | criar: `pages/settings/automation/MenuTriagePage.test.jsx:105`; editar: `components/TriageAdminTab.test.jsx:101` **[novo — "edits an existing option and calls onSaved"; só existia um teste de unidade de `api.js`, não de formulário]** |
| Template novo | TemplatesAdminTab | `POST /api/admin/templates` | `{ channelId, name, category, language, bodyText }` | Configurações › Mensagens e templates › Templates WhatsApp | `components/TemplatesAdminTab.test.jsx:61,87` |
| Template existente | RegisterExistingTemplateForm | `POST /api/admin/templates/register-existing` | `{ channelId, name, language, headerType: headerType \|\| null }` | Configurações › Mensagens e templates › Templates WhatsApp | `components/TemplatesAdminTab.test.jsx:180` |
| Sincronizar templates | TemplatesAdminTab | `POST /api/admin/templates/sync` | `{ wabaId }` | Configurações › Mensagens e templates › Templates WhatsApp | `components/TemplatesAdminTab.test.jsx:161` |
| **Empresa** | CompanyConfigCard | `PUT /api/admin/company` | **`{ name: name.trim(), acceptedPayeeNames: [uma linha = um nome] }`** | Configurações › Empresa | `components/CompanyConfigCard.test.jsx:67` |
| **Consulta ao SGP** | SgpQueryConfigCard | `PUT /api/admin/integrations/sgp-query-config` | **`{ baseUrl, app, token: newToken \|\| undefined, enabled }`** — token omitido preserva o atual | Configurações › Integrações › Consulta ao SGP | `components/SgpQueryConfigCard.test.jsx:78` |
| **OpenAI** | OpenAiConfigCard | `PUT /api/admin/ai/config` | **`{ apiKey: (só se o campo estiver visível e preenchido), model, mode }`** | Configurações › Integrações › OpenAI | `components/OpenAiConfigCard.test.jsx:91` |
| **Transcrição de áudio** | AudioTranscriptionConfigCard | `PUT /api/admin/ai/transcription` | **`{ transcriptionEnabled, transcriptionModel, transcriptionMaxSeconds: minutos*60, transcriptionMaxBytes: mb*1048576, transcriptionPrompt, transcriptionFeedAi }` — 6 campos juntos** | Configurações › Automação e IA › Transcrição de áudio | `components/AudioTranscriptionConfigCard.test.jsx:63` |
| **Triagem com IA** (regra 8 da spec: as 3 páginas abaixo enviam sempre os 9 campos) | AiTriageConfigCard → dividido em 3 páginas | `PUT /api/admin/ai/triage` | **`{ triageConfidenceThreshold: percent/100, triageMaxQuestions, triageTimeoutMinutes, triageExtraInstructions, triageResolvedReasonId: id \|\| null, nightStartTime: \|\| null, nightEndTime: \|\| null, triageRequireBirthdate, triageReadReceiptsDaytime }` — 9 campos num Salvar só** | Configurações › Automação e IA › Atendimento e triagem com IA / Identificação e comprovantes / Atendimento noturno | Atendimento e triagem com IA: `pages/settings/automation/AiTriagePage.test.jsx:64`. Identificação e comprovantes: `pages/settings/automation/IdentificationPage.test.jsx:42` **[novo — só havia `objectContaining` de um campo por teste; adicionado o teste de contrato dos 9 campos]**. Atendimento noturno: `pages/settings/automation/NightModePage.test.jsx:45` **[novo — mesma lacuna]** |
| Gateway SGP (novo) | IntegrationsAdminTab | `POST /api/admin/integrations/sgp` | `{ description, channelId, defaultTemplateId: (só canal oficial) \|\| null, enabled }` | Configurações › Integrações › SGP por canal | `pages/settings/integrations/SgpChannelPage.test.jsx:94` (baileys), `:112` (oficial, com template padrão) |
| Gateway SGP (editar) | IntegrationCard | `PUT /api/admin/integrations/sgp/:id` | `{ description, channelId, defaultTemplateId, enabled: integration.enabled }` (Ativo nunca muda ao editar) | Configurações › Integrações › SGP por canal | `pages/settings/integrations/SgpChannelPage.test.jsx:129,171` |

---

# ANEXO 3 — Dependências entre os toggles de canal (frontend × backend)

### Frontend (`AdminChannelsPage.jsx`)
1. **"Usar atendimento por IA" (`handleToggleAi`)** — ao **ligar**: `PATCH { aiEnabled: true }` e, em seguida, `PATCH { triageEnabled: false }`. A ordem é deliberada (comentário no código): a IA é ligada primeiro; se a segunda chamada falhar o canal fica com IA ligada e `triage_enabled` ainda `true` no banco, o que é seguro porque o backend já ignora a triagem numérica quando `aiEnabled`. O `refresh()` roda no `finally` (sucesso **ou** erro).
2. **"Triagem com IA"** — `disabled={!channel.aiEnabled}`.
3. **"Atendimento noturno com IA"** — `disabled={!channel.aiTriageEnabled}`.
4. "Usar triagem automática" nunca é desabilitado visualmente — mesmo com IA ligada o admin ainda pode marcá-lo (e ele fica inerte).

### Backend (`src/api/admin-channels.routes.js`, PATCH `/:id`, todo sob `requireIntegrationsAccess`)
- `aiEnabled: false` → **cascata**: grava `aiTriageEnabled = false` **e** `aiNightModeEnabled = false`.
- `aiTriageEnabled: true` → exige `existing.aiEnabled`, senão **400 `aiTriageEnabled requires aiEnabled`**.
- `aiTriageEnabled: false` → **cascata**: `aiNightModeEnabled = false`.
- `aiNightModeEnabled: true` → exige `aiEnabled && aiTriageEnabled` (**400 `aiNightModeEnabled requires aiTriageEnabled`**) **e** exige janela salva: `getAiConfig()` com `nightStartTime` **e** `nightEndTime` (**400 … requires the night window**).
- **O backend NÃO desliga `triageEnabled` quando `aiEnabled` é ligado** — essa regra ("ligar IA desliga triagem") existe **só no frontend**, como segunda chamada. Um cliente de API que mande apenas `{ aiEnabled: true }` deixa `triage_enabled = true` no banco.

### Precedência real em execução
- `src/triage/triage.service.js#shouldStartTriage`: `false` se `!channel.triageEnabled`, **`false` se `channel.aiEnabled`** (comentário "Um robô por vez"), e `false` se não houver opções de triagem cadastradas. → é isso que torna o `triage_enabled` órfão inofensivo.
- `src/ai/ai.service.js#shouldStartAiTriage`: exige `aiEnabled && aiTriageEnabled` **e** `shouldRunAi` (config da OpenAI com `mode !== 'disabled'`, `apiKey` e `model`).
- `src/conversations/inbound-message.service.js` (conversa nova):
  1. `aiTriage = await shouldStartAiTriage(channelId)`
  2. `startTriage = !aiTriage && !outsideBusinessHours && await shouldStartTriage(channelId)`
  → **triagem por IA tem prioridade sobre a triagem numérica**; a triagem numérica ainda é bloqueada de duas formas (pelo `!aiTriage` e pelo `channel.aiEnabled` dentro de `shouldStartTriage`), e **não inicia fora do horário comercial**.
  3. Boas-vindas do canal são enviadas antes de qualquer automação (`justCreated && channel.welcomeMessage`).
  4. Aviso de cidade sempre é tentado.
  5. Aviso de "fora do horário" só sai se `outsideBusinessHours && !noturnoAtivo && !businessHoursNoticeSentAt && !assignedAgentId` — **modo noturno da IA vence o aviso de horário**.
  6. Resposta: `if (triagemIa) scheduleAiTriage(...) else if (shouldRunAi) scheduleAiReply(...)` → com IA ligada mas triagem de IA desligada, o canal gera **sugestão para o atendente** (modo assistant), não resposta automática.
- `shouldTranscribe` exige `channel.aiEnabled` + `transcriptionEnabled` + `transcriptionModel`; `src/queue/transcription-worker.js:46` só reenfileira o turno de IA se `aiEnabled && aiTriageEnabled`; `src/queue/ai-worker.js:124` e `src/ai/night-mode.js:29` repetem a mesma exigência tripla para o modo noturno.

---

# ANEXO 4 — Onde a tela mostra "nenhum cadastrado"/"desativado"/valor padrão antes da consulta terminar

Todos os hooks abaixo **expõem** `loading`, mas os componentes listados **não o usam** (ou o hook nem tem estado de carregamento).

| Hook (estado inicial) | Componente que não distingue carregamento | O que aparece indevidamente |
|---|---|---|
| `useAgents()` → `[]` (**sem `loading`**) | `TeamPanel.jsx` | "Nenhum atendente cadastrado." |
| `useAgents()` → `[]` | `TransferModal.jsx` | "Nenhum outro atendente disponível." |
| `useAgents()` → `[]` | `AttendanceDashboardPage.jsx` (filtro Atendentes) | "Nenhuma opção" (só "IA" na lista) |
| `useAgentsAdmin()` → `[]` | `AgentsAdminTab.jsx` | "Nenhum atendente cadastrado ainda." |
| `useAgentsAdmin(true)` → `[]` | `AssignmentMessageSection` (MessagesAdminTab) | lista de "Atendentes" vazia no formulário |
| `useSectors()` → `[]` | `SectorsAdminTab.jsx` | lista em branco, sem mensagem nenhuma |
| `useSectors()` → `[]` | `CreateTriageOptionForm`, `TriageOptionRow`, `ConversationInfoPanel`, `AgentsAdminTab` (checkboxes), filtro **Departamentos** | selects/checkboxes vazios; "Nenhuma opção" no filtro |
| `useCities()` → `[]` | `CitiesAdminTab.jsx` | "Nenhuma cidade cadastrada ainda." |
| `useCities()` → `[]` | `EditContactModal.jsx` | select de cidade só com "Nenhuma" |
| `useCityNotices()` → `[]` | `MessagesAdminTab.jsx` (Avisos por cidade) | aviso amarelo "Nenhuma cidade cadastrada ainda. Cadastre cidades na aba Cidades…" |
| `useQuickReplies()` → `[]` | `MessageInput.jsx` (popover) | "Nenhuma resposta cadastrada" |
| `useQuickReplies()` → `[]` | `MessagesAdminTab` / `QuickRepliesModal` | "Ver mensagens (0)" / "Nenhuma resposta rápida cadastrada ainda." |
| `useReasons()` → `[]` | `CloseReasonModal.jsx` | "Nenhum motivo de contato cadastrado ainda. Peça a um administrador…" e botão Confirmar travado |
| `useReasons()` → `[]` | `AiTriageConfigCard.jsx` | select "Encerrar sozinha…" só com a opção padrão |
| `useReasonsAdmin()` → `[]` | `ReasonsAdminTab.jsx` | lista vazia sem mensagem |
| `useChannels()` → `[]` | `AdminChannelsPage.jsx` | nenhum cartão de canal (nem "carregando", nem "nenhum canal") |
| `useChannels(true)` → `[]` | `MessagesAdminTab` (Boas-vindas), `AssignmentMessageSection` (lista de Canais) | seção de boas-vindas some; lista de canais vazia |
| `useChannels()` → `[]` | `TemplatesAdminTab.jsx`, `IntegrationsAdminTab.jsx` | nenhum botão "Sincronizar agora", select de canal vazio |
| `useTemplates()` → `[]` | `TemplatesAdminTab` / `TemplatesModal` | "Ver templates (0)" / "Nenhum template cadastrado ainda." |
| `useSgpIntegrations()` → `[]` | `IntegrationsAdminTab.jsx` | nenhum cartão de gateway; só "Nova integração SGP" |
| `useSgpQueryConfig()` → `{ configured: false }` | `SgpQueryConfigCard.jsx` | cartão como se **nunca tivesse sido configurado** ("Criar integração") |
| `useAiConfig()` → `{ configured:false, mode:'disabled', model:'' }` | `OpenAiConfigCard.jsx` | selo **"Desativada"** e modo "Desativado" antes do GET terminar (o botão Salvar **não** é travado aqui) |
| `useAiConfig()` (defaults 80%/2/3min/20:00-08:00) | `AiTriageConfigCard.jsx`, `AudioTranscriptionConfigCard.jsx` | mostram valores padrão; **usam `loading` para desabilitar o Salvar** (mitigado, mas os campos mostram valor falso) |
| `useAiTools()` → `[]` | `AiToolPermissionsCard.jsx` | cartão sem nenhum grupo/ferramenta |
| `useCompanyConfig()` → `{ name:'', acceptedPayeeNames: [] }` | `CompanyConfigCard.jsx` | "Empresa não cadastrada" e "Nomes aceitos no comprovante: **nenhum**" |
| `useCompanyName()` → `''` (**sem `loading`**) | `LoginPage`, `NavRail`, `DashboardPage`, `ConversationView` | título genérico "Atendimento", logo sem iniciais, "sistema da **empresa**" |
| `useAssignmentMessageConfig()` → `{ id:null, enabled:false, … }` | `AssignmentMessageSection` | "Nenhuma configuração criada ainda." + "Criar atribuição" |
| `useBusinessHoursConfig()` → `{ id:null, enabled:false, '08:00','18:00' }` | `BusinessHoursSection` | "Nenhum horário configurado ainda." + "Criar horário de atendimento" |
| `useQueue()` → `[]` (**sem `loading`**) | `QueueList.jsx` | "Nenhuma conversa aguardando." / "Nenhuma conversa em triagem automática." |
| `useMyConversations()` → `[]` (**sem `loading`**) | `MyConversationsList.jsx` | "Nenhuma conversa atribuída." |
| `useMyClosedConversations()` → `items: []` | `ClosedConversationsList.jsx` | "Nenhum atendimento encerrado ainda." |
| `useAttendanceDashboard()` → `[] [] []`, `closedTodayCount: 0` | `AttendanceDashboardPage.jsx` (`DashboardColumn`) | "Nenhum atendimento em andamento." / "Nenhuma conversa aguardando." / "Nenhuma conversa em triagem automática." e contadores zerados |
| `useState([])` de `closedItems` | `AttendanceDashboardPage` (aba Encerrados hoje) | "Nenhum atendimento encerrado nas últimas 24 horas." |
| `useState([])` de `history` | `ConversationHistoryModal.jsx` | "Nenhum atendimento anterior encontrado." |
| `useConversationMessages()` → `[]` | `ConversationView.jsx` | conversa aparece vazia antes do GET |
| `ConversationInfoPanel` (campos ausentes) | `ConversationInfoPanel.jsx` | "Não informada" (cidade), "Não definido" (setor), "Não atribuído" (atendente) |

**Componentes que distinguem corretamente:** `MetricsPage` ("Carregando indicadores..."), `ProfileModal` ("Carregando..."), `TriageAdminTab` (`if (!config) return 'Carregando...'`), `CampaignsPage`/`CampaignDetailPage` ("Carregando..."), `StartConversationModal` e `CreateCampaignModal` ("Carregando canais..." / erro de carga), `SgpLookupPanel` ("Buscando no SGP..." / "Consultando o SGP..."), `MessageAttachment` ("Transcrevendo…").

---

# ANEXO 5 — Textos de interface citados

**"toggle"** (palavra visível ao usuário) — 1 ocorrência:
- `TriageAdminTab.jsx:161` — "Nenhuma opção cadastrada — a triagem não será executada em nenhum canal, mesmo com o **toggle** ligado."
- (Nos demais lugares "toggle" é só nome de função/handler.)

**"Departamento(s)"** — 1 ocorrência, e é o rótulo do filtro de **setores**:
- `AttendanceDashboardPage.jsx:343` — `<FilterDropdown label="Departamentos" options={sectors…} />`
- Conflita com o resto do produto, que chama a mesma entidade de **"Setores"**.

**"Atendentes"** (nome do cadastro e afins):
- `AdminChannelsPage.jsx:40` — aba **"Atendentes"** ("Quem entra no painel e responde os clientes.")
- `AttendanceDashboardPage.jsx:335` — filtro **"Atendentes"** (com a opção sintética "IA")
- `MessagesAdminTab.jsx:531` — cabeçalho **"Atendentes"** dentro de "Atribuir um atendimento"
- `AgentsAdminTab.jsx:71,192` — rótulo de papel **"Atendente"** e "Nenhum **atendente** cadastrado ainda."; `AgentsAdminTab.jsx:214` "Criar atendente"
- `CreateAgentForm.jsx` — "Cadastrar novo atendente", opção de Tipo "Atendente"
- `ConversationInfoPanel.jsx:121` — InfoRow **"Atendente"**; `TeamPanel.jsx:447` "Nenhum atendente cadastrado."; `TransferModal` "Nenhum outro atendente disponível."; `NavRail` title fallback "Atendente"

**"Métricas"** — não existe mais como texto de interface. Vestígio: `MetricsPage.jsx:213` → `setError('Falha ao carregar métricas')` e o nome do arquivo/rota `/metrics`. O rótulo visível é sempre "Relatório".

**"Relatório"**:
- `NavRail.jsx:108` — item de menu **"Relatório"**
- `MetricsPage.jsx:265` — `<h1>Relatório</h1>` + subtítulo "Indicadores de atendimento da equipe"
- `MetricsPage.jsx:232` — nome do arquivo exportado `relatorio-<period>-<data>.csv`
- `ReasonsAdminTab.jsx:129` — ajuda: "…aparece agrupado no **Relatório**, em 'Motivos de Contato'."

**Variações de Andamento / Espera / Automação / Encerrados** (três vocabulários diferentes para os mesmos estados):

| Lugar | Textos |
|---|---|
| `DashboardPage.jsx:21-23` (abas do chat) | **"Andamento"**, **"Espera"**, **"Automação"** |
| `AttendanceDashboardPage.jsx:410,417,425` (colunas) | **"Em andamento"**, **"Em espera"**, **"Na automação"** |
| `ConversationInfoPanel.jsx:17-29` (selo de status) | **"Encerrado"**, **"Na automação"**, **"Em espera"**, **"Em andamento"**, fallback "Conversa" |
| `AttendanceDashboardPage.jsx:293,314` (abas) | "Todos atendimentos", **"Encerrados hoje"** |
| `NavRail.jsx:132` / `ClosedConversationsModal.jsx:534` | **"Atendimentos encerrados"** |
| Vazios correlatos | "Nenhuma conversa aguardando." (Espera), "Nenhuma conversa em triagem automática." (Automação), "Nenhum atendimento em andamento.", "Nenhum atendimento encerrado nas últimas 24 horas." (aba diz **"hoje"**), "Nenhum atendimento encerrado ainda.", "Nenhuma conversa atribuída." |
| `ConversationInfoPanel.jsx:123` | InfoRow **"Encerrado em"** |
| `AdminChannelsPage.jsx:134` | checkbox "Usar **triagem automática**" (o mesmo conceito que a aba chama de "Automação") |

---

# ANEXO 6 — Divergências frontend × backend que o inventário revelou

1. **Boas-vindas por canal** (Admin→Mensagens, aba visível a todo admin/manager) grava via `PATCH /api/admin/channels/:id`, que é `requireIntegrationsAccess` → um **manager sem `canManageIntegrations` vê o formulário e recebe 403 ("Falha ao salvar")**.
2. `GET /api/admin/channels` é `requireRole('admin')` (admin+manager), embora a aba "Canais" seja escondida de managers sem a flag — a **leitura** dos canais continua disponível a esse perfil por outras telas (Mensagens, Atribuir atendimento, filtro do Dashboard).
3. `PUT /api/admin/ai/transcription`, `PUT /api/admin/ai/triage`, `GET/PUT /api/admin/ai/tools/*` e `GET /api/admin/ai/config` são `requireRole('admin')` — **um manager sem `canManageIntegrations` pode chamá-los por API**, apesar de a aba "Integrações" estar oculta para ele. Já `PUT /api/admin/ai/config` e `POST /api/admin/ai/test-connection` são `requireIntegrationsAccess`.
4. `PATCH /api/contacts/:id` (Editar cliente: nome, cidade, **nota interna**) é só `requireAuth`, **sem checagem de posse da conversa/contato**.
5. `GET /api/conversations/:id/messages`, `/contacts/:contactId/history`, `GET /api/sgp/clientes` e `POST /api/sgp/contratos/:id/boleto` também são só `requireAuth`, sem posse — a posse só é exigida nos endpoints que **enviam** algo ao cliente.
6. "Ligar IA desliga triagem" existe **apenas no frontend** (segunda chamada de `handleToggleAi`); o backend não faz essa cascata (embora `shouldStartTriage` neutralize o efeito).
7. `canManageIntegrations` viaja no JWT (`auth.service.js:44`) — alterar a flag de um gerente **só passa a valer no próximo login**.
