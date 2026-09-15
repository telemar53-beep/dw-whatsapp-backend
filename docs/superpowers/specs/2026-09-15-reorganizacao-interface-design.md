# Reorganização da interface — design

Data: 2026-09-15. Base: `main` em `27982e2`. Documento anexo: `2026-09-15-inventario-funcional.md` (inventário completo, levantado por leitura do código).

## 1. Objetivo

Reorganizar menus, páginas, configurações, nomenclatura e fluxos do frontend (`frontend/src`) para que atendentes achem suas conversas rápido e administradores achem cada configuração pelo assunto. Tudo o que existe hoje continua existindo, gravando o mesmo payload no mesmo endpoint, com as mesmas permissões.

Decisões tomadas com o usuário nesta sessão:

- Um trabalho só: reorganização + investigações da seção 10 do pedido (relatório por setor, durações, motivo "Resolvido pela IA", campanhas).
- Menu principal com escolha expandido/compacto salva no navegador, válida em todas as páginas; no celular vira painel deslizante que fecha ao escolher um item.
- Visual: padronizar **e** refinar (opção B). Identidade mantida: tema escuro, laranja, vidro fumê. O chat em si não muda de cara.
- Arquitetura: shell compartilhado + rotas aninhadas do react-router v6 (abordagem 1). Os componentes de aba atuais viram corpo das páginas novas.

## 2. Regras que valem para toda a implementação

1. Nenhum endpoint, payload, identificador, relacionamento ou configuração persistida muda. A única alteração de backend é a consulta SQL do relatório por setor e por motivo (seção 9.1), que é só de leitura.
2. Nenhuma tela grava nada ao abrir. Nenhuma tela substitui valor carregado por padrão.
3. Nenhum canal, IA, ferramenta, integração ou usuário é ligado ou desligado automaticamente. Dependências não satisfeitas geram aviso com atalho, nunca correção.
4. Baileys, Meta Cloud e 360dialog mantêm suas particularidades (QR e reconectar só Baileys; WABA ID, templates e modo template só oficiais).
5. Dados cadastrados pelo cliente (cidades, canais, motivos, setores, templates) não são renomeados.
6. Nenhum teste envia mensagem, campanha, cobrança, desbloqueio ou altera produção. Testes rodam contra o banco local em Docker ou com API mockada.
7. Nada é publicado em produção como parte deste trabalho.
8. O `AiTriageConfigCard` salva nove campos num único `PUT /api/admin/ai/triage`, e o backend trata os cinco opcionais como "ausente = desligado" (`src/api/admin-ai.routes.js:115-170`). As três páginas que passam a dividir esses campos enviam **sempre os nove**, com os valores já carregados dos que não são delas. Teste de contrato obrigatório para cada uma.
9. O `OpenAiConfigCard` envia `{ apiKey?, model, mode }` e o backend grava `systemPrompt: null` quando o campo não vem. Esse comportamento é preservado como está (não é escopo desta entrega).

## 3. Mapa de navegação

### 3.1 Menu principal

| Item | Rota canônica | Quem vê | Ícone |
|---|---|---|---|
| Atendimento | `/` | todos | balões de conversa |
| Supervisão | `/supervisao` | admin, gerente | equipe |
| Campanhas | `/campanhas`, `/campanhas/:id` | todos | megafone |
| Relatórios | `/relatorios` | todos | gráfico |
| Configurações | `/configuracoes/...` | admin, gerente | engrenagem |

Rodapé do menu, mesma ordem em todas as páginas: som (ativado/desativado), atendimentos encerrados (só perfil atendente, abre o modal atual), meu perfil (abre o modal atual), sair, avatar.

Três modos do menu: **expandido** (ícone + nome, 232 px), **compacto** (só ícone, nome no `title` e em tooltip acessível, 72 px), **painel** (celular: botão no topo abre um painel lateral com o menu expandido; fecha ao escolher item, ao tocar fora ou com Esc). A preferência expandido/compacto fica em `localStorage` (`dw_nav_collapsed`), mesmo mecanismo do som. Na página de Atendimento em celular, o menu continua oculto quando uma conversa está aberta (comportamento atual de `mobileHidden`).

### 3.2 Configurações (segundo nível)

Prefixo `/configuracoes/<grupo>/<pagina>`. `/configuracoes` redireciona para a primeira página que o perfil pode ver.

| Grupo | Página | Rota | Componente reaproveitado |
|---|---|---|---|
| Canais WhatsApp | Lista | `/configuracoes/canais` | `ChannelCard` (reduzido a resumo) + `CreateChannelModal` |
| Canais WhatsApp | Detalhe · Conexão | `/configuracoes/canais/:id/conexao` | `QrCodeView`, WABA ID, ações de `ChannelCard` |
| Canais WhatsApp | Detalhe · Atendimento | `/configuracoes/canais/:id/atendimento` | os 4 interruptores de `ChannelCard` |
| Automação e IA | Triagem por menu | `/configuracoes/automacao/triagem-menu` | `TriageAdminTab` |
| Automação e IA | Atendimento e triagem com IA | `/configuracoes/automacao/ia` | parte de `AiTriageConfigCard` (confiança, perguntas, tempo limite, instruções, motivo ao encerrar) |
| Automação e IA | Identificação e comprovantes | `/configuracoes/automacao/identificacao` | parte de `AiTriageConfigCard` (nascimento, comprovantes de dia) |
| Automação e IA | Transcrição de áudio | `/configuracoes/automacao/transcricao` | `AudioTranscriptionConfigCard` |
| Automação e IA | Atendimento noturno | `/configuracoes/automacao/noturno` | parte de `AiTriageConfigCard` (janela) |
| Automação e IA | Ferramentas autorizadas | `/configuracoes/automacao/ferramentas` | `AiToolPermissionsCard` |
| Regras de atendimento | Atribuição | `/configuracoes/regras/atribuicao` | `AssignmentMessageSection` (extraída de `MessagesAdminTab`) |
| Regras de atendimento | Horário de atendimento | `/configuracoes/regras/horario` | `BusinessHoursSection` (extraída) |
| Mensagens e templates | Boas-vindas | `/configuracoes/mensagens/boas-vindas` | `ChannelWelcomeMessageRow` (extraída) |
| Mensagens e templates | Avisos por cidade | `/configuracoes/mensagens/avisos-cidade` | `CityNoticeRow` (extraída) |
| Mensagens e templates | Respostas rápidas | `/configuracoes/mensagens/respostas-rapidas` | `QuickReplyRow`, `CreateQuickReplyForm` (extraídas) |
| Mensagens e templates | Templates WhatsApp | `/configuracoes/mensagens/templates` | `TemplatesAdminTab` |
| Equipe e acesso | Usuários | `/configuracoes/equipe/usuarios` | `AgentsAdminTab`, `CreateAgentForm` |
| Equipe e acesso | Setores | `/configuracoes/equipe/setores` | `SectorsAdminTab`, `CreateSectorForm` |
| Equipe e acesso | Perfis de acesso | `/configuracoes/equipe/perfis` | novo, só informativo (seção 5.3) |
| Integrações | Consulta ao SGP | `/configuracoes/integracoes/sgp-consulta` | `SgpQueryConfigCard` |
| Integrações | SGP por canal | `/configuracoes/integracoes/sgp-canal` | `IntegrationCard` + formulário de `IntegrationsAdminTab` |
| Integrações | OpenAI | `/configuracoes/integracoes/openai` | `OpenAiConfigCard` |
| Cadastros auxiliares | Motivos de atendimento | `/configuracoes/cadastros/motivos` | `ReasonsAdminTab`, `CreateReasonForm` |
| Cadastros auxiliares | Cidades | `/configuracoes/cadastros/cidades` | `CitiesAdminTab`, `CreateCityForm` |
| Empresa | Empresa | `/configuracoes/empresa` | `CompanyConfigCard` |

Nomes finais das integrações SGP, confirmados no código:

- **Consulta ao SGP**: o chat consulta o SGP (cliente, contrato, fatura, PIX). Config global em `sgp_query_config`. Usada pelo painel na conversa e pelas ferramentas da IA.
- **SGP por canal**: o SGP chama o chat (`GET /api/integrations/sgp/messages` com chave de API) para disparar mensagens por um canal. Uma chave por canal.

### 3.3 Rotas antigas (compatibilidade)

| Rota antiga | Destino | Tipo |
|---|---|---|
| `/admin/dashboard` | `/supervisao` | `Navigate replace`, preserva query string |
| `/admin/channels` | `/configuracoes/canais` | `Navigate replace` |
| `/metrics` | `/relatorios` | `Navigate replace`, preserva query string |
| `/campaigns` | `/campanhas` | `Navigate replace` |
| `/campaigns/:id` | `/campanhas/:id` | `Navigate replace` |

As rotas antigas ficam no `App.jsx` permanentemente (não são removidas depois).

### 3.4 Filtros na URL

- Supervisão: `?canal=<id>&canal=<id>&atendente=<id|ia>&setor=<id>&aba=todos|encerrados`. Lidos via `useSearchParams`; mudar filtro faz `replace`.
- Relatórios: `?periodo=today|7d|30d|custom&dias=N`.
- Canais: `?ocultos=1` para "Mostrar canais ocultos".

## 4. Tabela de localização: antiga → nova

| Função | Onde estava | Onde fica |
|---|---|---|
| Conversas, abas, busca, equipe, conversa aberta, SGP, sugestão IA | `/` | `/` (só a casca muda) |
| Dashboard de atendimento (colunas, filtros, buscas, encerrados hoje) | `/admin/dashboard` | Supervisão `/supervisao` |
| Relatório (períodos, indicadores, gráficos, CSV) | `/metrics` | Relatórios `/relatorios` |
| Campanhas (lista, criar, detalhe) | `/campaigns` | `/campanhas` |
| Canais (lista, criar, interruptores, WABA ID, QR, reconectar, ocultar, excluir, ocultos) | Administração › Canais | Configurações › Canais WhatsApp (lista + detalhe em duas abas) |
| Triagem (pergunta, confirmação, tentativas, opções) | Administração › Triagem | Configurações › Automação e IA › Triagem por menu |
| Atendentes (lista, criar, setores, senha, ativar) | Administração › Atendentes | Configurações › Equipe e acesso › Usuários |
| Setores | Administração › Setores | Configurações › Equipe e acesso › Setores |
| Boas-vindas por canal | Administração › Mensagens | Configurações › Mensagens e templates › Boas-vindas |
| Avisos por cidade | Administração › Mensagens | Configurações › Mensagens e templates › Avisos por cidade |
| Atribuir um atendimento | Administração › Mensagens | Configurações › Regras de atendimento › Atribuição |
| Horário de atendimento | Administração › Mensagens | Configurações › Regras de atendimento › Horário de atendimento |
| Respostas rápidas | Administração › Mensagens | Configurações › Mensagens e templates › Respostas rápidas |
| Templates | Administração › Mensagens | Configurações › Mensagens e templates › Templates WhatsApp |
| Motivos | Administração › Motivos | Configurações › Cadastros auxiliares › Motivos de atendimento |
| Cidades | Administração › Cidades | Configurações › Cadastros auxiliares › Cidades |
| Empresa | Administração › Integrações | Configurações › Empresa |
| Consulta ao SGP | Administração › Integrações | Configurações › Integrações › Consulta ao SGP |
| Integração com OpenAI (+ testar conexão) | Administração › Integrações | Configurações › Integrações › OpenAI |
| Transcrição de áudio (+ buscar modelos) | Administração › Integrações | Configurações › Automação e IA › Transcrição de áudio |
| Triagem com IA: confiança, perguntas, tempo limite, instruções, motivo ao encerrar | Administração › Integrações | Configurações › Automação e IA › Atendimento e triagem com IA |
| Triagem com IA: exigir nascimento, ler comprovantes de dia | Administração › Integrações | Configurações › Automação e IA › Identificação e comprovantes |
| Triagem com IA: janela noturna | Administração › Integrações | Configurações › Automação e IA › Atendimento noturno |
| Permissões de ferramentas da IA | Administração › Integrações | Configurações › Automação e IA › Ferramentas autorizadas |
| Gateways SGP por canal (+ gerar chave) | Administração › Integrações | Configurações › Integrações › SGP por canal |
| Meu perfil, som, sair, atendimentos encerrados | NavRail | Rodapé do menu novo, mesma ordem em todas as páginas |

## 5. Controle de acesso

### 5.1 Níveis

Três níveis, espelhando `src/auth/auth.middleware.js`:

| Nível | Regra | Backend equivalente |
|---|---|---|
| `auth` | token válido | `requireAuth` |
| `admin` | `role in ['admin','manager']` | `requireRole('admin')` |
| `integrations` | `role === 'admin'` ou `manager && canManageIntegrations` | `requireIntegrationsAccess` |

`ProtectedRoute` recebe `level` (`'auth' | 'admin' | 'integrations'`). Sem token → `/login`. Com token e sem nível → renderiza `AccessDeniedPage` **dentro do shell** (não redireciona): nome da área, quem tem acesso, link para Atendimento.

Uma lista única `NAV_ITEMS` / `SETTINGS_SECTIONS` (em `frontend/src/navigation/`) declara rota, rótulo, ícone, grupo e `level` de cada página. O menu, as rotas do `App.jsx`, o redirecionamento de `/configuracoes` e a página Perfis leem dessa lista. Assim menu e guarda nunca divergem.

### 5.2 Nível por página

| Nível | Páginas |
|---|---|
| `auth` | Atendimento, Campanhas, Relatórios, Meu perfil |
| `admin` | Supervisão; Configurações: Canais (lista e detalhe **em leitura**), Automação e IA (todas), Regras, Mensagens, Equipe, Cadastros, Empresa |
| `integrations` | Integrações › Consulta ao SGP, SGP por canal, OpenAI; e, dentro de Canais: criar, WABA ID, reconectar, ocultar, excluir, os 4 interruptores; dentro de Boas-vindas: salvar/excluir |

Quando o perfil é `admin` mas não `integrations`, os controles de credencial aparecem desabilitados com a linha "Requer permissão de Canais e Integrações (marcada na conta pelo administrador)". Isso substitui o erro 403 que Boas-vindas dá hoje ao gerente sem a flag (inventário, anexo 6.1) e expõe corretamente Transcrição/Triagem/Ferramentas ao gerente, que o backend já autoriza (anexo 6.3).

### 5.3 Página "Perfis de acesso"

Tabela gerada a partir de `SETTINGS_SECTIONS` e `NAV_ITEMS` (coluna por perfil: Atendente, Gerente, Gerente com credenciais, Administrador; linha por página/ação). Inclui as regras que não são de rota e vêm do backend, escritas como texto fixo com referência ao arquivo: gerente só cria/edita conta de atendente; ninguém desativa ou troca a própria senha por esta tela; atendente só envia mensagem na conversa dele; admin/gerente transferem e encerram qualquer conversa. Não cria permissão nova.

## 6. Componentes compartilhados

Pasta `frontend/src/components/ui/`:

| Componente | Responsabilidade |
|---|---|
| `AppShell` | menu lateral + `<Outlet>`; fundo decorativo com intensidade por página (`dense` reduz os brilhos para 40%) |
| `SideNav` | itens de `NAV_ITEMS`, três modos, item ativo por `useMatch`, rodapé fixo |
| `PageHeader` | título, descrição de uma linha, ação principal à direita, breadcrumb opcional (Configurações › Grupo) |
| `SettingsLayout` | menu de segundo nível por grupo + `<Outlet>`; em celular vira `<select>`/lista recolhível |
| `Card` | `title`, `description`, `scope` (ScopeBadge), `footer` para o botão Salvar com texto "Salvar <o que salva>" |
| `Field` | rótulo ligado por `htmlFor`, ajuda, erro com `aria-describedby`/`aria-invalid` |
| `Button` | `variant: primary | secondary | danger | ghost`, `loading` |
| `Tabs` | `role=tablist`, setas do teclado, controlado por rota quando `to` é passado |
| `Toggle` | checkbox atual com rótulo, descrição e `disabledReason` (texto obrigatório quando `disabled`) |
| `ScopeBadge` | "Toda a operação" · "Este canal" · "Herdado de …" · "Depende de …" |
| `AsyncState` | recebe `status`, `error`, `empty`, `forbidden`; renderiza esqueleto / vazio / erro com "Tentar de novo" / sem permissão |
| `DangerZone` | bloco separado no fim da página para excluir, desativar, reconectar, gerar credencial |
| `ConfirmDialog` | substitui `window.confirm` com os **mesmos textos**; foco preso, Esc fecha, foco volta ao botão de origem |

Nenhum componente de formulário existente é reescrito: eles são movidos para as páginas novas e passam a usar `Card`/`Field`/`Button` no lugar das strings de classe repetidas (`inputClass`, `cardClass`, `primaryButtonClass`).

## 7. Estados de carregamento

Padrão único para os hooks de listagem/config (lista no inventário, anexo 4):

```js
// antes
const [items, setItems] = useState([]);
// depois
const [state, setState] = useState({ status: 'loading', items: [], error: null });
// status: 'loading' | 'ready' | 'error' | 'forbidden'  (403 → forbidden)
```

O hook continua devolvendo `items` (compatível com quem já usa) e passa a devolver `status` e `error`. Componentes que hoje testam `length === 0` passam a renderizar `<AsyncState status={status} …>` e só mostram "Nenhum … cadastrado" com `status === 'ready'`. Formulários de config (`useAiConfig`, `useCompanyConfig`, `useSgpQueryConfig`, `useAssignmentMessageConfig`, `useBusinessHoursConfig`, `useTriage`) não renderizam campos até `ready`; mostram esqueleto. Hooks sem `loading` hoje (`useAgents`, `useQueue`, `useMyConversations`, `useCompanyName`) ganham `status` também; no chat, listas em `loading` mostram esqueleto de três linhas em vez do texto de vazio.

`useCompanyName` em `loading` deixa o logo e o título sem texto (não "Atendimento" genérico) até resolver.

## 8. Página por página

### 8.1 Atendimento (`/`)
Só a casca muda para `AppShell`. Abas renomeadas: "Em andamento", "Em espera", "Em automação". Textos de vazio alinhados: "Nenhum atendimento em andamento.", "Nenhum atendimento em espera.", "Nenhum atendimento em automação.". Nada mais muda.

### 8.2 Supervisão (`/supervisao`)
`AttendanceDashboardPage` com filtros na URL (3.4), rótulo "Setores" no lugar de "Departamentos", colunas "Em andamento / Em espera / Em automação", aba "Encerrados hoje" mantida. Em celular, colunas viram uma pilha com abas; cada item mantém atendente, setor e protocolo. Opção "IA" no filtro de atendentes mantida.

### 8.3 Campanhas (`/campanhas`)
`CreateCampaignModal` ganha dois passos. Passo 1: formulário com validação por campo (`fieldErrors`): "Selecione um canal para a campanha.", "Escreva a mensagem que será enviada." (`trim()`), "Selecione um template aprovado.", "Preencha a variável N.", "Informe ao menos um destinatário.". Botão "Revisar". Passo 2: canal + provedor (`channelTypeLabel`), contagem de válidos / duplicados / inválidos por `frontend/src/utils/parseRecipients.js` (mesma regra de `src/api/campaigns.routes.js:31-49`, com teste de paridade), prévia do texto ou nome do template + variáveis, aviso do limite de 2000, botões "Voltar" e "Confirmar e disparar". Só o segundo chama `createCampaign` com o payload atual, sem alteração. Lista e detalhe mostram nome do canal. Backend: `if (!content || !content.trim())` em `campaigns.routes.js:91`, mesma resposta 400 e mesma mensagem, com teste próprio; entra nesta entrega como tarefa separada. Não muda contrato.

### 8.4 Relatórios (`/relatorios`)
- Período na URL (3.4).
- Tempos legíveis: nova `formatDuration(minutes)` → "45 min", "1 h 25 min", "2 d 3 h"; `null` → "—". Título do indicador sem "(min)". CSV inalterado (minutos, vírgula decimal, BOM).
- Ajuda contextual (ícone "?" ao lado dos indicadores) com o critério real: início = criação da conversa; fim = evento de encerramento; inclui fila, triagem, IA e transferências; primeira resposta = primeira mensagem do atendente após a atribuição, contada desde a criação; conversas sem resposta do atendente não entram na média de primeira resposta; média global ponderada pelo total de fechados por atendente.
- Gráfico por setor e por motivo: seção 9.1.

### 8.5 Configurações › Canais
Lista: cartão por canal com nome, provedor, número, situação (ponto + texto), resumo das automações em chips ("Triagem por menu", "IA", "Triagem IA", "Noturno") e avisos de dependência. "Criar canal" no `PageHeader`. "Mostrar canais ocultos" na barra de filtro (`?ocultos=1`).
Detalhe › Conexão: situação, QR (`QrCodeView`), WABA ID (oficiais), `DangerZone` com Reconectar (Baileys), Ocultar/Reexibir, Excluir.
Detalhe › Atendimento: os quatro `Toggle` com `disabledReason` e a explicação da precedência ("Ligar a IA desliga a triagem por menu neste canal", "Triagem com IA precisa da IA ligada", "Noturno precisa da triagem com IA e da janela noturna definida"). Abaixo, "Configurações globais que valem para este canal": triagem por menu (n opções, ou aviso "sem opções"), boas-vindas (texto ou "não definida"), horário, janela noturna, OpenAI (situação), cada uma com link. Nada é armazenado em duplicidade.
Os handlers (`handleToggleAi` com a segunda chamada, `handleToggleTriage`, etc.) são movidos sem alteração para `frontend/src/pages/settings/channels/useChannelActions.js`.

### 8.6 Configurações › Automação e IA
- **Atendimento e triagem com IA**: cabeçalho com situação da OpenAI ("Conectada" / "Não configurada" + link para Integrações › OpenAI) e lista de canais com IA ligada. Campos: confiança, máximo de perguntas, tempo limite, instruções adicionais, motivo ao encerrar sozinha (com aviso se o motivo apontado estiver inativo/inexistente). Botão "Salvar triagem com IA" envia os nove campos.
- **Identificação e comprovantes**: exigir nascimento, ler comprovantes de dia; texto explicando que a identificação por CPF é sempre ativa quando a triagem com IA roda, e que os nomes aceitos no comprovante ficam em Empresa (link). Botão "Salvar identificação" envia os nove campos.
- **Atendimento noturno**: janela início/fim; aviso "Nenhum canal com noturno ligado" ou lista; distinção explícita: "Horário de atendimento (Regras) define quando há atendente humano; esta janela define quando a IA atende sozinha à noite". Botão "Salvar janela noturna" envia os nove campos.
- **Transcrição de áudio**: `AudioTranscriptionConfigCard` inteiro; "Buscar modelos" fica desabilitado com razão quando não há chave salva.
- **Ferramentas autorizadas**: três grupos mantidos (Consulta, Ação, Ação sensível). Cada linha: nome legível, descrição atual, identificador técnico em `<details>`/texto pequeno, interruptor que grava na hora (comportamento atual). Aviso quando uma automação ligada depende de ferramenta desligada (ex.: encerrar sozinha exige `encerrar_atendimento`).
- **Triagem por menu**: `TriageAdminTab`; texto do aviso troca "toggle" por "interruptor".

### 8.7 Demais páginas de Configurações
Movimentação direta dos componentes listados em 3.2, com `PageHeader`, `Card` e `AsyncState`. Em **Motivos**, selo "Usado pela IA ao encerrar" no motivo apontado por `ai_config.triage_resolved_reason_id` (lido de `GET /api/admin/ai/config`) e `ConfirmDialog` ao desativá-lo: "A IA vai parar de encerrar sozinha até outro motivo ser escolhido." Em **Usuários**, o cadastro se chama "Usuários"; o papel individual continua "Atendente / Gerente / Administrador". Em **Empresa**, aviso "Sem nomes aceitos, nenhum comprovante confere" quando a lista está vazia.

## 9. Correções investigadas (seção 10 do pedido)

### 9.1 Relatório por setor e por motivo (backend, só leitura)
Causa confirmada: `getMetricsBySector` (`src/metrics/metrics.repository.js:87-107`) agrupa pelos setores **do atendente** (`JOIN agent_sectors`), com dois INNER JOIN. Atendente sem setor some do gráfico; atendente em N setores é contado N vezes. `getMetricsByReason` (`:109-128`) filtra `reason_id IS NOT NULL`, escondendo os encerramentos feitos direto da fila.

Correção:
- `getMetricsBySector`: mesmo conjunto `closed` de `getMetricsForAllAgents`, `LEFT JOIN sectors s ON s.id = c.sector_id`, `COALESCE(s.name, 'Sem setor')`, `sectorId` `null` na barra "Sem setor". `SUM(closedCount)` passa a ser igual ao total.
- `getMetricsByReason`: `LEFT JOIN contact_reasons`, sem o filtro `IS NOT NULL`, `COALESCE(r.name, 'Sem motivo')`.
- Frontend: barras "Sem setor"/"Sem motivo" em cinza, nota "Conversas encerradas sem setor/motivo definido". CSV recebe as linhas automaticamente.
- Testes: `metrics.repository.test.js:200-220` e `:222-238` trocam de expectativa; novo teste para "Sem motivo".
- Nenhum setor ou motivo é atribuído retroativamente.

### 9.2 Durações
Sem mudança de cálculo. Ver 8.4.

### 9.3 Motivo "Resolvido pela IA"
Não é do sistema: é um motivo comum apontado em `ai_config.triage_resolved_reason_id`. A IA grava flag na conversa **e** evento `closed` com esse motivo e `from_agent_id NULL`. Entrega desta vez: 8.7 (selo + aviso). Separação motivo × resultado fica como pendência (seção 12), com o mapa de impacto no inventário.

### 9.4 Campanhas
Ver 8.3.

## 10. Nomenclatura

| Antes | Depois | Onde |
|---|---|---|
| Departamentos | Setores | filtro da Supervisão |
| Atendentes (nome do cadastro) | Usuários | menu de Configurações e título da página |
| Relatório | Relatórios | menu e título |
| Dashboard de atendimento | Supervisão | menu e título |
| Administração | Configurações | menu e título |
| Triagem / triagem automática | Triagem por menu | Configurações, detalhe do canal |
| Andamento / Espera / Automação / Na automação / triagem automática | Em andamento / Em espera / Em automação | chat, Supervisão, painel da conversa, textos de vazio |
| Atendimentos encerrados / Encerrados hoje | Encerrados (título) · "hoje" só na aba da Supervisão | modal do atendente, Supervisão |
| toggle | interruptor | aviso da triagem por menu |
| Usar triagem automática / Usar atendimento por IA | Triagem por menu / Atendimento com IA | interruptores do canal |

Rótulo do papel individual ("Atendente", "Gerente", "Administrador") não muda.

## 11. Testes e evidências

- **Contrato de gravação**: um teste por formulário do inventário (anexo 2) afirmando o payload exato e o endpoint. Inclui os três testes das páginas que dividem o `PUT /triage` (nove campos sempre).
- **Rotas**: cada rota nova renderiza pela URL direta; cada rota antiga redireciona; `/configuracoes` cai na primeira página permitida; voltar/avançar mantém a seção; item ativo do menu bate com a rota.
- **Acesso**: para cada página, três perfis (atendente, gerente sem flag, gerente com flag) + admin: quem vê, quem recebe `AccessDeniedPage`, quais controles ficam desabilitados com razão.
- **Estados**: `AsyncState` em loading não mostra texto de vazio; erro mostra "Tentar de novo"; 403 mostra sem permissão.
- **Campanhas**: os 11 testes listados na investigação (validação por campo, revisão, mesmo payload, paridade do parser).
- **Relatório**: testes de repositório (9.1) e `MetricsPage.test.jsx` com "Sem setor"/"Sem motivo" e `formatDuration`.
- **Visual**: Chrome headless em 390, 820 e 1440 px para cada página, prints em `output/reorganizacao/`. Verificação manual de foco/teclado no menu, abas e `ConfirmDialog`.
- **Suíte inteira** (`npm test` na raiz e em `frontend/`) verde antes de cada merge de tarefa.
- Nenhum teste toca produção nem envia nada.

## 12. Limitações e pendências (fora deste trabalho)

1. Separar "motivo de contato" de "resultado" (migração + 3 pontos de escrita + relatório + CSV; ver inventário).
2. Guardas do backend onde UI e API divergem: `PATCH /api/contacts/:id` sem posse; leituras de mensagens/histórico/SGP sem posse. Decisão de permissão, não de reorganização.
3. Paginação dos destinatários no detalhe da campanha e na lista de campanhas.
4. `canManageIntegrations` só passa a valer no próximo login (JWT).
5. Publicação em produção.

## 13. Reversão

Todo o trabalho fica em um branch (`reorganizacao-interface`). Não há migração de banco. Reverter = `git revert` do merge (ou não fazer o merge) e `npm run build` do frontend. A mudança de SQL do relatório volta junto. As rotas antigas nunca deixam de existir, então links salvos funcionam antes, durante e depois.

## 14. Ordem de implementação

1. Lista de navegação (`NAV_ITEMS`, `SETTINGS_SECTIONS`) + `ProtectedRoute` com níveis + `AccessDeniedPage`.
2. `AppShell`, `SideNav` (3 modos), `PageHeader`, componentes `ui/`, `AsyncState`, `ConfirmDialog`.
3. `App.jsx` com rotas novas, aninhadas, e redirecionamentos.
4. Atendimento, Campanhas, Relatórios, Supervisão sobre o shell (sem mudar corpo), filtros na URL.
5. `SettingsLayout` + migração grupo a grupo: Equipe, Cadastros, Empresa, Mensagens (divisão do arquivo), Regras, Integrações, Automação e IA (divisão do cartão), Canais (lista + detalhe).
6. Padrão `status` nos hooks + `AsyncState` nos consumidores.
7. Campanhas (validação + revisão), Relatórios (SQL, durações, ajuda), Motivos (selo).
8. Nomenclatura e textos de vazio.
9. Passe de design (skill frontend-design) nas telas densas; verificação visual em 3 larguras; acessibilidade.
10. Revisão do branch inteiro contra o inventário e os critérios de aceite.
