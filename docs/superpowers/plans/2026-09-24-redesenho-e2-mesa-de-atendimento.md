# E2 — Mesa de atendimento — Plano mestre

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Este é o plano mestre: as tarefas estão nos seis subplanos, executados em ordem.

**Goal:** Entregar a mesa de atendimento redesenhada — moldura, menu, lista, conversa, painéis e os overlays que se abrem dela — funcionando com dados reais numa prévia publicada, para o proprietário aprovar a direção antes de qualquer outra etapa visual.

**Architecture:** Seis subplanos em sequência, cada um terminando com a suíte verde e um commit por tarefa, numa branch só (`redesenho/e2-mesa`). A fundação (tokens com origem única do acento, cor por fórmula, ícones Tabler em três módulos por camada) vem primeiro; depois a base de diálogo (pilha com camada leve, `Dialog` em tokens, primitivas); depois a moldura e a lista; a conversa e os painéis; os overlays; e o fechamento com o harness, o inventário e a prévia. Nada de backend.

**Tech Stack:** React 18.3.1, Vite 5.4, Tailwind 4.3.3, Vitest 2.1.9 + Testing Library + user-event 14.6.7 (jsdom 25), harness por CDP em `ferramentas/medicao/` (Node 22, Chrome), Render.

**Spec:** `docs/superpowers/specs/2026-09-24-redesenho-simplicidade-design.md` e apêndices A (inventário), B (destinos), C (achados), D (iconografia), E (overlays).

## Subplanos

| # | Plano | Entrega | Tarefas | Prova antes da aprovação |
|---|---|---|---|---|
| E2.1 | `2026-09-24-redesenho-e2-1-fundacao.md` | tokens (`estilo/tokens.css`), acento de origem única, contraste por teste (inclusive marca alternativa), guarda do acento com pendências, Inter única, rotas de entrada sem ícone, ícones Tabler por camada, `Button` em tokens | 7 | provada numa cópia descartável |
| E2.2 | `2026-09-24-redesenho-e2-2-base-de-dialogo.md` | camada leve na pilha, `Dialog` em tokens com `ocupado` e `legado`, `DialogFooter` (erro fixo, nota que diz o que falta), `ConfirmDialog`/`useConfirm` com ação assíncrona, `AlertDialog`, `Popover`, `ListaDeEscolha`, `FaixaDeAviso` | 8 | provada numa cópia descartável |
| E2.3 | `2026-09-24-redesenho-e2-3-moldura-menu-lista.md` | casca sem moldura e região viva única, trilho de 64 px, faixa do canal, transferência como marca na lista, linha da lista em 2 linhas, coluna da lista, "Finalizar sem motivo" por lista, "Nossa equipe" na coluna, mesa vazia com confirmação | 10 | provada numa cópia descartável |
| E2.4 | `2026-09-24-redesenho-e2-4-conversa-e-paineis.md` | vocabulário único de estado, layout do painel em utilitário, `MessageBubble` com `memo`, painel Cliente (dados + edição + setor), cabeçalho em 2 linhas e o modal sem o painel de informações, SGP numa superfície com QR sob demanda e aviso de encerrado, compositor com popovers e inserção no cursor, faixas acima do compositor | 8 | provada numa cópia descartável e de novo em cadeia com a E2.5 |
| E2.5 | `2026-09-24-redesenho-e2-5-overlays.md` | Encerrar, Transferir, escolha de template compartilhada + Enviar template, Iniciar conversa, Atendimentos anteriores, visualizador, Encerrados mestre-detalhe, Meu perfil | 9 | provada em cadeia (E2.3 → E2.4 → E2.5) numa cópia descartável |
| E2.6 | `2026-09-24-redesenho-e2-6-fechamento-e-previa.md` | ganchos do harness, um `role="status"` por tela, rodada de marca alternativa, medição e orçamentos, conferência do inventário, registro S × C, prévia no Render, entrega | 7 | roda no fim, sobre a E2 inteira |

## Pré-requisitos

1. **E0 publicada** (`2026-09-24-redesenho-e0-prova-e-guardas.md`): o harness e o verificador em `ferramentas/`, os testes que guardam os cinco ganhos, as 5 falhas antigas corrigidas, o inventário remapeado e a linha de base com tempo. A E2 é comparada contra ela, e as guardas precisam estar verdes antes da primeira mudança visual.
2. **PRF-12 na `main`** (branch `fix/senha-atual-errada-desloga`, commits `ed48336`, `af3c6ef`, `175c40c`): a E2.5 (Task 8) supõe a troca de senha e o login que não derrubam a sessão com senha errada. Se o PRF-12 não estiver publicado quando a E2 começar, a Task 8 da E2.5 espera por ele.
3. **Branch:** `redesenho/e2-mesa`, criada da `main` depois de 1 e 2. Nada vai à `main` antes do "ok" do proprietário na prévia.

## Global Constraints

Valem para todas as tarefas de todos os subplanos (cada subplano repete as que mais pesam nele):

- **Escopo frontend.** Ficam intocados: backend, IA, prompts, contexto, ai-worker, ai-orchestrator, triagem, tool-registry, autorização de tools, OpenAI, transcrição, SGP (servidor), Pix/boleto, idempotência, desbloqueio, identificação, regras de atendimento, Baileys, Meta Cloud, 360dialog e janela de 24 h. Nenhuma rota, payload ou contrato de API muda. **Se uma tarefa exigir tocar em algo disso: parar e perguntar (ADR-009).**
- **Nenhuma funcionalidade some.** O que sai da vista tem destino no Apêndice B; o que o plano tira de um lugar, põe em outro, com teste.
- **Acessibilidade e responsividade homologadas não regridem** (spec 9): contrastes AA; estado nunca só por cor; um anel de foco; `ui/Dialog` + `dialogStack` (foco inicial, trap, ESC por pilha, foco devolvido, clique fora à prova de arrasto, `inert` embaixo); popover não vira modal; `conversationOpen` = "a conversa ocupa a tela inteira"; "Abrir menu" sempre alcançável; conversa ≥ 420 px e a ordem de sacrifício do `useWorkspaceLayout` (1020/752/760/492); painel nunca cobre as mensagens; teto do compositor relativo à janela; `@container` nos diálogos e no cabeçalho; `aria-live` ≠ `role="status"`, um só `role="status"` por tela; ação da linha e ação do botão são irmãos; `WaError`/`WaSuccess` (ou o erro fixo do `DialogFooter`, mesmo contrato `role="alert"`).
- **Os cinco ganhos publicados não regridem**: code splitting (39 rotas `lazy`), paginação 50 + sonda (inclusive "anteriores"), memo da lista, `AgentsContext`, fontes locais — as guardas da E0 ficam verdes em toda tarefa.
- **Safari:** nenhuma biblioteca de runtime nova, nenhuma fonte nova; o CSS de entrada não cresce em nenhum subplano (o Tailwind gera ali todo utilitário novo — cada fechamento de subplano mede).
- **Estrutura domina:** cada subplano registra as mudanças S × C; subplano com C na maioria está errado.
- **O estado do chat sobrevive à troca de conversa** (`ConversationView` e `MessageInput` não remontam): todo estado novo zera na troca de `conversation.id`, com teste — é a CLASSE-01.
- **Resposta que chega depois da troca** não vale para a conversa nova (CLASSE-01): toda busca nova compara o id do pedido com o atual por `ref`, nunca pelo valor preso no fechamento.
- **Armadilhas do spec 13:** CSS sem `@layer` vence utilitário (e CSS **em** camada perde para ele — a regra que esconde algo com `display:none` sobre um elemento com `flex` não pode morar em `@layer components`); `sticky` não reserva espaço; jsdom não calcula layout; dois `role="status"` disputam o papel; alterou o arquivo, roda o teste dele e o dos consumidores; import não prova montagem.
- **Contrato do harness:** mudar nome acessível usado por gancho de `ferramentas/medicao/lib/ganchos.mjs` exige mudar o gancho no mesmo commit.
- **Saída de subagente não é confiável sem verificação independente** (memória `feedback_verificar_saida_de_subagente`): subagentes auditam e revisam; a escrita de cada tarefa tem um responsável; toda afirmação de "passou" é conferida rodando.
- **Pendências do acento em toda tarefa:** o passo de verificação roda também `src/estilo`, e arquivo que ficou limpo sai de `PENDENCIAS` na mesma tarefa (o teste "a lista só encolhe" falha enquanto um arquivo limpo continua na lista). Os passos de "pendências" dos fechamentos de subplano viram conferência.
- **Commit e push só com autorização** do proprietário; cada tarefa termina num commit na branch `redesenho/e2-mesa`.

## Decisões do proprietário que a E2 aplica (spec 14.1, 24/09/2026)

| # | Decisão | Onde |
|---|---|---|
| 2 | Checkpoint numa **prévia separada no Render** | E2.6 Task 6 |
| 3 | Ícones **Tabler**, só contorno; item ativo do menu por **barra de 3 px + fundo** | E2.1 Task 6; E2.3 Task 2 |
| 4 | Cobrança do SGP em atendimento **encerrado**: o envio continua, com **aviso no painel** | E2.4 Task 5 |
| 6 | Menu em **trilho único de 64 px** | E2.3 Task 2 |
| 7 | Transferir: **número + "Carga alta"** a partir de 10 | E2.5 Task 2 |
| 8 | Só **2 legendas** no catálogo de motivos | E2.5 Task 1 |
| 9 | Resposta rápida **insere no cursor** (campo vazio: preenche) | E2.4 Task 6 |
| 10 | Encerrados como **diálogo mestre-detalhe** | E2.5 Task 7 |
| 11 | Aviso de transferência como **marca na lista** | E2.3 Task 4 |

(5 — PRF-12 corrigido isolado — é pré-requisito; 1 — E1.1 — já publicada.)

## Decisões de desenho tomadas nos subplanos (reversíveis, registradas)

- **Painel Cliente fechado por padrão no modal de conversa** (Supervisão, Encerrados): o supervisor abre com um clique pelo botão do cabeçalho (antes o painel de informações era fixo e sumia abaixo de 768 px). E2.4 Task 4.
- **"Resolvido pela IA"** sai da linha da lista para o nome acessível do item e para o painel Cliente (seção "Triagem por IA"). E2.3 Task 5; E2.4 Task 3.
- **O ouvinte de transferência mora na casca** (`TransferenciasProvider`), não na mesa: a marca e o anúncio valem em qualquer rota. E2.3 Task 4.
- **`silent` (campanha sem resposta) → "Em espera"** no vocabulário único. E2.4 Task 1.
- **A região viva da casca não serve dentro de modal** (com `aria-modal`, o leitor ignora o resto da página): o painel SGP anuncia no próprio `aria-live`; a conversa mantém o seu `role="status"`. E2.4 Task 5.
- **O layout do painel (coluna de 268 px ou substituição) é utilitário escolhido pelo estado do React**, não folha de estilo: a regra de esconder a conversa perderia para o `flex` dentro de `@layer`. E2.4 Task 1.
- **O ouvinte de ESC dos filtros da Supervisão** (`SupervisionPage.jsx:84`) fica para a E5 (é da Supervisão); os outros quatro saem na E2 (E2.3 Task 2; E2.4 Tasks 4 e 6).
- **Galeria anterior/próxima no visualizador** fica fora da E2 (muda a pilha); **Girar** entra. E2.5 Task 6.

## Interfaces entre subplanos

| Produz | Em | Consome |
|---|---|---|
| tokens `--color-*`, `--text-*`, `--radius-ui-*`, `--shadow-*`; utilitários `bg-fundo`, `bg-painel`, `bg-elevado`, `bg-campo`, `bg-hover`, `bg-selecionado`, `bg-bolha-entrada/saida`, `text-tinta/-2/-3`, `text-perigo`, `text-aviso`, `text-accent-soft`, `bg-accent`, `text-on-accent`, `border-linha` | E2.1 T1 | todos |
| `components/icons/IconesEntrada.js`, `IconesTrabalho.js` (reexporta `IconLock`), `IconesConfig.js` | E2.1 T6 | todos |
| `Button` (`primary`/`secondary`/`danger`/`ghost`, `sm`/`md`, `loading`) | E2.1 T7 | todos |
| `useCamadaLeve(aberta, aoFechar)`; `Dialog` (`ocupado`, `dismissible`, `legado`, `inicioDoCabecalho` — este na E2.5 T5); `DialogFooter({ nota, motivo, motivoId, erro })`; `useConfirm() → { confirm, confirmDialog }`, `confirm(msg, { title, danger, confirmLabel, cancelLabel, acao })`; `AlertDialog`; `Popover`; `ListaDeEscolha`; `FaixaDeAviso({ texto, titulo, acao, multilinha })` (`multilinha` na E2.4 T7) | E2.2 | E2.3–E2.5 |
| `useAnunciar()`, `useEstadoDaConexao()`, `useTransferencias()`; `avisarNaMesa(frase)` na `DashboardPage`; `AsyncState` com `esqueleto="linhas"`; `previaDe` (exportado na E2.5 T7) | E2.3 | E2.4, E2.5 |
| `estadoDaConversa`, `estaEncerrada`; `MessageBubble`; `PainelCliente`; `CabecalhoDaConversa`; `ConversationView` com `onEncerrado`, `onFechar`; `useAlert() → { avisar, fechar, alertDialog }`; `lerSessao`/`gravarSessao` | E2.4 | E2.5 |
| `EscolhaDeTemplate` + `faltaParaEnviar`; `buildTimeline` em `utils/linhaDoTempo.js`; `dataCurta`; `descreverCarga` | E2.5 | — |
| ganchos novos; `papeis.mjs`; etapa `marca`; `conferir-etapa.cjs` | E2.6 | E3–E7 |

## Review Focus (o que atravessa os subplanos)

- **CLASSE-01 em cada estado novo.** Rascunho, painel aberto, popover, modo edição, alerta, histórico, envio de template: todo estado que a E2 cria na conversa zera na troca, e toda resposta atrasada é descartada por `ref`. Cada subplano tem o seu teste; o fechamento de cada um roda `ConversationView.trocaDeConversa.test.jsx`.
- **ESC com camadas misturadas.** Diálogo modal + painel lateral + popover + gaveta: o topo fecha primeiro, uma camada por tecla, e o foco volta a quem abriu. Testes na E2.2 (mecanismo), E2.3 (gaveta + perfil), E2.4 (painel no modal da Supervisão) e E2.5 (confirmação sobre o perfil).
- **Nome acessível que o harness usa.** "Consultar SGP", "Fechar consulta SGP", "Dados do cliente", "Fechar dados do cliente", região "Consulta SGP", lista "Atendimentos", "Navegação principal", abas "Atendimento/Espera/Automação": nenhum subplano os troca; a E2.6 prova os ganchos contra o build.
- **CSS de entrada.** Cada subplano mede no fechamento; utilitário arbitrário vira passo de escala.
- **Pix nunca mostra o código** fora do cartão: bolha (E2.4), histórico (E2.5), prévia da lista (E2.3).

## Estado das provas (antes da aprovação)

- **E2.1 e E2.2:** provadas numa cópia descartável do frontend (código dos planos aplicado; suíte com 1.679 passando + as falhas antigas; Chrome real para o acento e o contraste; pesos medidos).
- **E2.4:** provada numa cópia descartável com a E2.1 e a E2.2 aplicadas; os desvios foram conferidos contra o código e corrigidos no plano (nota no topo da E2.4) — entre eles a ordem de duas tarefas.
- **E2.3:** provada numa cópia descartável com a E2.1 e a E2.2 aplicadas; os desvios foram conferidos contra o código e corrigidos no plano (nota no topo da E2.3) — entre eles uma confirmação que sumia entre duas tarefas.
- **E2.4 e E2.5 em cadeia (24/09/2026):** E2.1 T4/T7, E2.4 e E2.5 foram aplicadas numa cópia que já tinha a E2.2 e a E2.3. Foram 18 tarefas: nenhuma deixou de passar no fim, mas cinco só passaram com correção, e apareceu um defeito real sem teste (o override parcial do contato). As correções entraram nos planos marcadas **[Prova na cópia, 24/09/2026]** e rodaram numa cópia de verificação: 1.780 testes passando, só as 3 falhas antigas de `api.qr`; build ok; 11 mutações pegas. O relatório original e a classificação por tarefa estão em `D:\dw-redesenho-arquivo\2026-09-24\auditorias\`.
- **E2.6:** roda sobre a E2 inteira; os scripts do harness são curtos e são provados por mutação dentro da própria tarefa (Task 2 Step 2).

## Números de linha nos subplanos

Os `arquivo:linha` dos subplanos referem-se à `main` de 24/09/2026 (antes da E2.1). Cada subplano desloca as linhas dos seguintes — a prova em cópia viu `DashboardPage.jsx` +2, `ConversationView.jsx` −9, `SgpLookupPanel.jsx` −10 e `overlays.css` −21 depois da E2.1 e da E2.2. **Localizar sempre pelo conteúdo citado** (o nome da função, a classe, o texto); o número é só o ponto de partida.

## Execução

Subagent-driven (instrução permanente do proprietário): uma tarefa por vez, um implementador por tarefa, revisão independente antes da seguinte, e uma revisão final da branch inteira antes da prévia (as duas últimas revisões de branch deste projeto acharam defeitos que as revisões por tarefa não viram). Ao fim de cada subplano: suíte inteira, build, pesos (`ferramentas/medicao/pesos.mjs`) e a seção do registro S × C.

Falhas conhecidas da suíte: depois da E0, nenhuma. Se a E0 ainda não tiver corrigido as 5 antigas (`ConversationView` e `api.qr`, entre elas) quando a E2 começar, elas são listadas pelo nome no fechamento de cada subplano, e nada novo pode falhar. O `App.routes` tem um tempo esgotado intermitente na suíte cheia que passa 3 de 3 sozinho — rodar isolado antes de tratar como regressão.

## Checkpoint

A E2 termina na E2.6: harness e orçamentos verdes, inventário conferido, registro com S > C, prévia no ar com a conta do proprietário. **Nenhuma outra etapa visual começa antes do "ok" dele** (spec 11). Com o "ok", a `redesenho/e2-mesa` vai à `main` (publicação, com autorização) e a prévia é desligada.
