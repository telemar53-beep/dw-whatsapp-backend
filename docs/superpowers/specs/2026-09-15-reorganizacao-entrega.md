# Entrega: reorganização da interface

Data: 2026-09-15. Branch: `reorganizacao-interface` (não publicado, não mesclado em `main`).

Este documento é o resumo da entrega para quem toca a operação, sem precisar ler código. Ele reúne o que foi prometido, o que foi entregue, como conferir, e o que ainda falta.

---

## 1. Inventário

Antes de mexer em qualquer tela, o sistema inteiro foi lido e listado em um documento à parte:

`docs/superpowers/specs/2026-09-15-inventario-funcional.md`

Esse inventário lista cada botão, cada formulário e cada tela do sistema como ela era antes desta reorganização: quem pode usar, o que ela lê, o que ela grava e em qual endereço.

Nesta revisão final, o Anexo 2 do inventário (a lista de formulários) ganhou duas colunas novas:

- **Destino proposto**: para onde aquele formulário foi, na tela nova.
- **Como verificar**: o arquivo e a linha do teste automático que prova que o formulário novo grava exatamente o mesmo dado, no mesmo endereço, que gravava antes. Qualquer pessoa da equipe técnica consegue abrir esse arquivo e ver a prova.

Três formulários não tinham esse teste ainda e ganharam um nesta revisão (a edição de uma opção de triagem por menu, e as páginas "Identificação e comprovantes" e "Atendimento noturno", que dividem uma mesma gravação em três telas). Um teste que já existia foi apertado para conferir o dado completo, em vez de só um pedaço dele.

---

## 2. Mapa da navegação

### 2.1 Menu principal

O menu lateral agora tem cinco itens, iguais para todo mundo (o que muda é quem enxerga cada um):

- **Atendimento** (`/`) — todos. As conversas do dia a dia, igual era antes.
- **Supervisão** (`/supervisao`) — administrador e gerente. Era "Dashboard de atendimento".
- **Campanhas** (`/campanhas`) — todos.
- **Relatórios** (`/relatorios`) — todos. Era "Relatório".
- **Configurações** (`/configuracoes/...`) — administrador e gerente. Era "Administração".

No rodapé do menu, em todas as páginas, na mesma ordem: som (ligado/desligado), atendimentos encerrados (só para quem atende), meu perfil, sair, foto do usuário.

O menu tem três formatos: expandido (ícone + nome), compacto (só ícone, com dica ao passar o mouse) e, no celular, um painel que desliza e fecha sozinho ao escolher um item. A escolha entre expandido e compacto fica salva no navegador.

### 2.2 Configurações (segundo nível)

"Configurações" abre direto na primeira página que a pessoa pode ver, organizada em sete grupos:

- **Canais WhatsApp** — Lista de canais · Detalhe de um canal (Conexão · Atendimento)
- **Automação e IA** — Triagem por menu · Atendimento e triagem com IA · Identificação e comprovantes · Transcrição de áudio · Atendimento noturno · Ferramentas autorizadas
- **Regras de atendimento** — Atribuição · Horário de atendimento
- **Mensagens e templates** — Boas-vindas · Avisos por cidade · Respostas rápidas · Templates WhatsApp
- **Equipe e acesso** — Usuários · Setores · Perfis de acesso (novo, só para consulta)
- **Integrações** — Consulta ao SGP · SGP por canal · OpenAI
- **Empresa** — Empresa

Toda tela antiga de "Administração" foi distribuída entre esses sete grupos, pelo assunto.

### 2.3 Endereços antigos continuam funcionando

Quem tiver um link salvo do sistema antigo (`/admin/dashboard`, `/admin/channels`, `/metrics`, `/campaigns`, `/campaigns/:id`) é levado direto para o endereço novo correspondente, sem dar erro. Esses redirecionamentos ficam no sistema para sempre — não são removidos depois.

---

## 3. Tabela antiga → nova

| Função | Onde estava | Onde fica agora |
|---|---|---|
| Conversas, abas, busca, equipe, SGP, sugestão da IA | `/` | `/` (só a moldura muda) |
| Dashboard de atendimento | `/admin/dashboard` | Supervisão `/supervisao` |
| Relatório | `/metrics` | Relatórios `/relatorios` |
| Campanhas | `/campaigns` | `/campanhas` |
| Canais | Administração › Canais | Configurações › Canais WhatsApp |
| Triagem por menu | Administração › Triagem | Configurações › Automação e IA › Triagem por menu |
| Atendentes | Administração › Atendentes | Configurações › Equipe e acesso › Usuários |
| Setores | Administração › Setores | Configurações › Equipe e acesso › Setores |
| Boas-vindas por canal | Administração › Mensagens | Configurações › Mensagens e templates › Boas-vindas |
| Avisos por cidade | Administração › Mensagens | Configurações › Mensagens e templates › Avisos por cidade |
| Atribuir um atendimento | Administração › Mensagens | Configurações › Regras de atendimento › Atribuição |
| Horário de atendimento | Administração › Mensagens | Configurações › Regras de atendimento › Horário de atendimento |
| Respostas rápidas | Administração › Mensagens | Configurações › Mensagens e templates › Respostas rápidas |
| Templates | Administração › Mensagens | Configurações › Mensagens e templates › Templates WhatsApp |
| Motivos de atendimento | Administração › Motivos | Configurações › Cadastros auxiliares › Motivos de atendimento |
| Cidades | Administração › Cidades | Configurações › Cadastros auxiliares › Cidades |
| Empresa | Administração › Integrações | Configurações › Empresa |
| Consulta ao SGP | Administração › Integrações | Configurações › Integrações › Consulta ao SGP |
| OpenAI | Administração › Integrações | Configurações › Integrações › OpenAI |
| Transcrição de áudio | Administração › Integrações | Configurações › Automação e IA › Transcrição de áudio |
| Triagem com IA (confiança, perguntas, tempo, instruções, motivo) | Administração › Integrações | Configurações › Automação e IA › Atendimento e triagem com IA |
| Triagem com IA (nascimento, comprovantes de dia) | Administração › Integrações | Configurações › Automação e IA › Identificação e comprovantes |
| Triagem com IA (janela noturna) | Administração › Integrações | Configurações › Automação e IA › Atendimento noturno |
| Permissões de ferramentas da IA | Administração › Integrações | Configurações › Automação e IA › Ferramentas autorizadas |
| Gateways SGP por canal | Administração › Integrações | Configurações › Integrações › SGP por canal |
| Meu perfil, som, sair, atendimentos encerrados | Menu lateral antigo | Rodapé do menu novo, em todas as páginas |

Nenhuma dessas mudanças troca o que o botão grava: mesmo endereço, mesmo dado, mesma permissão de antes — só o lugar na tela mudou. É essa promessa que a coluna "Como verificar" do inventário (seção 1) prova, formulário por formulário.

---

## 4. Implementação

O trabalho foi dividido em 21 tarefas, cada uma revisada antes da próxima começar. Commits do branch, do primeiro ao último, agrupados por tarefa:

**Tarefa 1 — Lista de navegação e controle de acesso**
- `3b744e3` Add the navigation registry with access levels and legacy redirects

**Tarefa 2 — Rotas protegidas por nível de acesso**
- `125bb9a` Guard routes by access level and show an access-denied page instead of a silent redirect

**Tarefa 3 — Componentes visuais compartilhados**
- `40c0395` Add the shared UI primitives for the reorganized screens
- `b910584` Fix duplicate IDs in multiple DangerZone instances

**Tarefa 4 — Estado de carregamento e caixa de confirmação**
- `e565175` Add AsyncState, useAsyncResource and a focus-restoring confirm dialog
- `7955013` Fix concurrent confirm() calls blocking first promise resolution

**Tarefa 5 — Menu lateral novo**
- `8e5082b` Add the three-mode SideNav and the AppShell layout

**Tarefa 6 — Rotas novas ligadas ao aplicativo**
- `4fb739e` Route the app through AppShell with the new paths and legacy redirects

**Tarefa 7 — Atendimento sobre a moldura nova**
- `a8255e4` Render Atendimento inside AppShell and align the tab names
- `a4516e2` Cover Meu perfil, sound toggle, and h-dvh moved out of DashboardPage

**Tarefa 8 — Supervisão**
- `1f2b943` Turn the attendance dashboard into Supervisão with URL filters and Setores

**Tarefa 9 — Relatórios**
- `97b8f7d` Turn Relatório into Relatórios with URL period, readable durations and criteria help

**Tarefa 10 — Correção do gráfico por setor e por motivo**
- `6e4e806` Group the sector report by the conversation's sector and surface closes without sector or reason

**Tarefa 11 — Campanhas em dois passos**
- `9d0a134` Validate campaign fields and add a review step before sending
- `3d21549` Show the template field error and add a placeholder option to select it

**Tarefa 12 — Menu de Configurações**
- `3804d6b` Add the settings layout with the grouped second-level menu
- `734d6a7` Fix the mobile settings select to highlight the section on sub-routes

**Tarefa 13 — Equipe, Cadastros e Empresa**
- `c21722c` Add the Equipe, Cadastros and Empresa settings pages
- `b0f9a9d` Fix round 1: restore Cancel on the create-reason form and add it to Sectors/Cities

**Tarefa 14 — Mensagens e Regras**
- `b717163` Extract MessagesAdminTab pieces into messages/ components and pages
- `33736c0` Retire MessagesAdminTab now that Mensagens/Regras own its content
- `f461707` Fix round 1: restore the contextual help cards, wire Templates' create button

**Tarefa 15 — Integrações**
- `2cb8a72` Extract the SGP gateway card and create form out of IntegrationsAdminTab
- `2b9a71f` Add the Integrações settings pages and split the SGP gateway card out

**Tarefa 16 — Divisão da Triagem com IA em três páginas**
- `c20bfa9` Add useAiTriageForm and split the AI triage card into three pages
- `773b7c8` Add the remaining Automação e IA pages and retire the old AI cards

**Tarefa 17 — Canais (lista e detalhe)**
- `870b018` Add channelSummary and useChannelActions for the new channel detail page
- `4d7fb63` Add ChannelsListPage and ChannelDetailPage with its Conexão/Atendimento tabs
- `82e7266` Wire the channel routes into App.jsx and fix leftover links to the old page
- `cfc506a` Fix round 1: cover reconnect/toggleHidden and two cheap minors

**Tarefa 18 — Padrão de carregamento em todas as listas**
- `bc2c499` Give every data hook a status (loading/ready/error/forbidden)
- `80187e5` Wire status into the chat-list consumers of the hooks
- `272e2dc` Remove the status||loading fallback now that hooks expose real status
- `6a23074` Wire status into modals, the composer popover and config cards
- `fdc6a35` Wire status into TriageAdminTab, TemplatesAdminTab and the company name
- `38a0502` Fix a stale comment referencing the loading var AsyncState replaced

**Tarefa 19 — Nomes de tela alinhados**
- `85927f5` Align user-facing names: Setores, Usuários, Em automação, interruptor

**Tarefa 20 — Passe de design e acessibilidade**
- `b929d5c` Refine the dense screens' visual hierarchy
- `bbe3607` Close the accessibility gaps found in the review
- `38bbde2` Record the three-width visual check and the accessibility report

**Tarefa 21 — Esta revisão final** (inventário, testes de contrato que faltavam, limpeza e este documento)

Todas as 21 tarefas passaram por uma revisão dedicada antes de a próxima começar; rodadas de correção ficam registradas nos commits "Fix round 1" listados acima.

---

## 5. Testes e evidências

### 5.1 Contagem de testes

| Suíte | Antes da reorganização | Depois (agora) |
|---|---|---|
| Frontend (`frontend/src`) | 83 arquivos, 799 testes | 114 arquivos, 969 testes (961 passando, 8 propositalmente pulados — cobertos por um teste equivalente em outro arquivo, com o comentário explicando onde) |
| Backend (`src`, raiz do projeto) | não fazia parte desta reorganização (só uma consulta de leitura mudou, seção 9.1 da spec) | 116 suítes, 2259 testes, todos passando |

As duas suítes completas (`npx vitest run` no frontend e `npm test` na raiz) rodaram limpas ao final desta revisão.

### 5.2 Conferência visual

Cada tela nova foi fotografada em três larguras de tela — celular (520 px), tablet (820 px) e computador (1440 px) — usando um navegador sem interface gráfica, contra as páginas reais com dados inventados (nenhuma senha, nome ou telefone real). Os 49 prints ficam em:

`output/reorganizacao/` (lista e descrição de cada um em `output/reorganizacao/README.md`)

### 5.3 Acessibilidade

A conferência de acessibilidade — navegação só com teclado, o que a tela lê para quem usa leitor de tela, contraste de cor — está em:

`output/reorganizacao/a11y.md`

Resumo: dez itens verificados, todos aprovados após duas correções (anel de foco visível em vários controles que não tinham, e troca de duas cores de texto que não tinham contraste suficiente contra o fundo). Duas decisões ficaram registradas como escolha deliberada, não pendência: as abas que são links de rota continuam como links (não como abas ARIA, porque isso tiraria a navegação por link que já funciona bem), e a caixa de confirmação não prende o foco dentro dela (Tab consegue sair, mas Esc, clique fora e o botão Cancelar continuam funcionando).

### 5.4 Nenhum teste tocou produção

Nenhum teste automático, nem a conferência visual, enviou mensagem de WhatsApp, disparou campanha, gerou cobrança ou mudou qualquer dado de produção. Os testes rodam contra o banco local (Docker, na própria máquina) ou com respostas de API inventadas.

---

## 6. Limitações e pendências (fora desta entrega)

Estes pontos foram identificados durante o trabalho, mas ficaram combinados como fora do escopo. Nenhum é um problema novo criado por esta reorganização — são coisas que já existiam ou que foram descobertas e adiadas de propósito.

1. **Motivo de contato misturado com resultado.** Hoje um único campo serve tanto para "por que o cliente entrou em contato" quanto para "o que a IA resolveu". Separar os dois exige mudar o banco de dados, o relatório e o CSV exportado — é um projeto à parte.
2. **Algumas checagens do backend não conferem se a pessoa é dona da conversa.** Editar o cadastro do cliente, ler o histórico de mensagens e consultar o SGP hoje só exigem estar logado, não exigem ser o atendente daquela conversa específica. Isso é assim desde antes desta reorganização; é uma decisão de segurança, não de organização de tela, e fica para outra rodada.
3. **Lista de destinatários de uma campanha não pagina.** Campanhas com uma lista muito grande de destinatários mostram tudo de uma vez, sem "próxima página".
4. **A permissão "Pode gerenciar Canais e Integrações" de um gerente só vale a partir do próximo login dele.** Isso é uma característica de como o sistema guarda a permissão (dentro do token de acesso), não um bug desta entrega.
5. **Esta reorganização não foi publicada em produção.** Ela existe só neste branch, aguardando aprovação para ir ao ar.

Outros detalhes menores, encontrados e registrados durante as revisões de cada tarefa, sem efeito no dia a dia:

- Em uma tela muito estreita (por volta de 380 px), a faixa de abas do chat ("Em andamento" / "Em espera" / "Em automação") ganha uma rolagem lateral em vez de encolher o texto.
- No menu lateral, o rótulo "Atendimentos encerrados" corta em telas de tablet (820 px) — isso já acontecia antes desta reorganização.
- Em telas grandes (1440 px), um dos gráficos do Relatório deixa um espaço vazio de sobra — só estética, não afeta os dados.
- A caixa de confirmação (usada para excluir, desativar etc.) não impede o Tab de sair dela enquanto está aberta; Esc, clique fora e os botões continuam funcionando normalmente.

---

## 7. Reversão

Todo o trabalho está em um único branch, `reorganizacao-interface`, que ainda não foi juntado ao `main`. Não existe nenhuma migração de banco de dados pendente desta reorganização — a única mudança no banco foi a maneira de *ler* o relatório por setor e por motivo (nenhum dado foi alterado, só a consulta).

Para reverter, duas opções, sem diferença de resultado:

- Simplesmente não juntar este branch ao `main`. Nada muda no sistema em produção.
- Se já tiver sido juntado, desfazer com um `git revert` do commit de junção, seguido de `npm run build` do frontend.

Como os endereços antigos (`/admin/dashboard`, `/admin/channels`, `/metrics`, `/campaigns`) nunca deixam de existir, qualquer link salvo por um usuário continua funcionando antes, durante e depois de qualquer decisão sobre publicar ou reverter esta entrega.

---

*Gerado na revisão final (Task 21) desta reorganização, em 2026-09-15.*
