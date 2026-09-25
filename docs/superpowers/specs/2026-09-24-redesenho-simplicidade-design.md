# Redesenho por simplicidade — sistema inteiro

**Data:** 24/09/2026 · **Estado:** plano aprovado pelo proprietário em 24/09/2026; este spec aguarda revisão.
**Base:** `main` em `e5236da` (= produção, já com a E1). **Escopo:** frontend — visual, estrutura de tela e desempenho.
**Planos de implementação:** `docs/superpowers/plans/2026-09-24-redesenho-e0-prova-e-guardas.md`
(pronto) e o da E2, escrito com as decisões da seção 14.1: plano mestre
`docs/superpowers/plans/2026-09-24-redesenho-e2-mesa-de-atendimento.md` e seis subplanos
(`...-e2-1-fundacao.md`, `...-e2-2-base-de-dialogo.md`, `...-e2-3-moldura-menu-lista.md`,
`...-e2-4-conversa-e-paineis.md`, `...-e2-5-overlays.md`, `...-e2-6-fechamento-e-previa.md`),
aguardando a revisão do proprietário. A E1 e a E1.1 já foram publicadas (ver seção 10). As etapas E3
a E7 ganham plano próprio depois do checkpoint da E2 (seção 11).

---

## 1. Por que este trabalho existe

O proprietário decidiu redesenhar o sistema inteiro com o **WhatsApp Web como referência de
simplicidade** — o princípio, não o layout — e com **desempenho como objetivo de igual peso**.

Na palavra dele, o visual atual "não tem identidade visual, é sem vida, parece site antigo, os ícones
são genéricos e de qualidade questionável, o acabamento é ruim e o menu era desorganizado". As oito
etapas de redesign anteriores e os redesigns de 22/09 foram aprovados **por esgotamento, não por
convicção**: eram o melhor que a ferramenta anterior conseguia entregar. O modo de falha dela foi
**só pintar** — trocar cor sem mexer em estrutura — e **esquecer popups, sub-abas e estados que só
aparecem por interação**, deixando o sistema meio novo e meio velho.

Consequências para quem ler as notas antigas (Obsidian `Design do Chat`, `Direção de design`,
comentários no CSS):

- valem as **decisões técnicas com razão** — a armadilha do `@layer`, o `useWorkspaceLayout`, o
  comportamento de scroll, a pilha de diálogos, os contrastes medidos, os limiares homologados;
- **não valem as escolhas estéticas**. Nenhuma delas é patrimônio.

## 2. Critérios de sucesso

1. **Estrutura domina.** Cada etapa entrega um *registro de mudanças* (seção 12.3) que classifica cada
   mudança como ESTRUTURAL (mudou posição, tamanho, quantidade ou existência) ou COSMÉTICA (cor,
   superfície, raio, sombra). **A etapa é reprovada se as cosméticas forem maioria.**
2. **Nada fica sem ser visitado.** Todo item do inventário (Apêndice A) — tela, modal, popover, aba,
   estado vazio, de erro, de carregamento e estado que só aparece por interação — tem etapa dona e é
   conferido no fim dela.
3. **Desempenho mensurável.** Os orçamentos da seção 12.2 são aceite de etapa, com o harness
   versionado. Os cinco ganhos publicados (code splitting, paginação de 50, memo da lista,
   AgentsContext, fontes locais) ficam protegidos por teste antes de qualquer mudança visual (E0).
4. **Marca é um token.** Ao fim do programa, trocar a cor da marca é trocar **um** valor
   (`--color-accent`) — sem caçar laranja espalhado (seção 5.2.4).
5. **Checkpoint real.** A E2 termina com a mesa de atendimento funcionando, publicável, para o
   proprietário olhar antes de qualquer outra etapa visual (seção 11).
6. **Padrão alto.** Toda escolha visual tem uma razão escrita neste spec. Ícone genérico,
   espaçamento aproximado e hierarquia frouxa não passam.

## 3. Restrições que não se negociam

1. **Escopo frontend.** Backend, IA, prompts, contexto, ai-worker, ai-orchestrator, triagem,
   tool-registry, autorização de tools, OpenAI, transcrição, SGP (lado servidor), Pix/boleto (geração
   e idempotência), desbloqueio, identificação, regras de atendimento, Baileys, Meta Cloud,
   360dialog e janela de 24 h ficam **intocados**. Se alguma tarefa exigir tocar em algo disso,
   **para e pergunta** (ADR-009). Nenhuma rota, payload ou contrato de API muda.
2. **Referência de princípio, nunca de pixel.** Sem reproduzir o layout do WhatsApp traço a traço e
   **sem a paleta verde** dele (marca registrada). A identidade é a da DW, configurável.
3. **Nenhuma funcionalidade some.** O que sai da vista principal tem destino declarado (Apêndice B).
4. **Acessibilidade e responsividade homologadas não regridem** (lista na seção 9).
5. **Os cinco ganhos publicados não regridem** (seção 12.2).
6. **Safari do iPhone rebaixa tudo a cada carga** (não resolvido, fora do alcance). Cada KB no
   caminho crítico custa: nenhuma biblioteca de runtime nova, nenhuma fonte nova, orçamento de
   bytes que só pode cair.
7. **Tipografia:** Sora + Inter auto-hospedadas (commit `ac334af`, OFL conferida, prova pixel a
   pixel) **ficam**. A skill `redesign-existing-projects` recomenda trocar Inter — **não se aplica**.

## 4. Diagnóstico medido (linha de base `ac334af`)

Medido por estilo computado no build de produção, Chrome real por CDP, API simulada (harness da E0).
Tela de Atendimento, 1366×768, conversa aberta.

| Eixo | Hoje |
|---|---|
| Fundos distintos visíveis | 28 (34 com painel); 29 cinzas quase iguais no código, 14 na mesa |
| Famílias de cor de destaque ao mesmo tempo | 5 (laranja em 8–9 tons e ~12 significados, verde-água, lilás, vermelho, âmbar) |
| Mesmo estado em cores diferentes | "Em atendimento": verde no cabeçalho, laranja na lista, amarelo no Transferir |
| Item da lista | 68 px, 3 linhas, 4 tamanhos de letra, mediana 14,5–16 elementos, máximo 22; fichas cortadas ("Financei…") |
| Camadas de fundo sob um texto | máximo 6 (7 com SGP), média 3,35 |
| Repetição | setor 3× na mesma tela; cabeçalho de 3 linhas + barra de contexto |
| Ritmo | 27 tamanhos de fonte, 18 raios, 16 espaçamentos; escalas declaradas com 0 uso |
| Classes com valor arbitrário | 327 distintas = 39,7% do CSS utilitário publicado; ~50 anuladas por `dashboard.css` |
| Esqueleto do Suspense | contraste 1,00:1 (tela inteira `#ffffff`) na casca; 1,28:1 na rota |
| Cascata até a lista | 5 camadas seriais; 1º item em 5.019 ms (Fast 3G) / 17.613 ms (Slow 3G), local |
| `ConversationView` (131 KB) | no caminho crítico de toda rota autenticada, puxado pelo modal "Encerrados" |

Defeitos funcionais encontrados na auditoria (todos com etapa dona — seção 10 e Apêndice C).
**Já corrigidos e publicados na E1:** "Carregar mensagens anteriores" nunca funcionou; corrida do
painel SGP podia enviar Pix/boleto de um cliente para outro; mesmo contato em dois canais herdava o
"enviado" do outro; bolha enviada aparecia na conversa errada; envio travado bloqueava o compositor
em todas as conversas. **Ainda abertos:** `apiFetch` sem timeout; listas sem "Tentar de novo";
token de mídia que trava; chip com o nome do próprio atendente em toda linha da aba Atendimento;
aviso de transferência sem fundo (token inexistente); modal de conversa sem o CSS da mesa fora de
`/`; "Descartar gravação" que não descarta; "×" do SGP que não devolve o foco; ESC que fecha duas
camadas de uma vez; falhas mudas (templates do "Iniciar conversa", mensagens do histórico,
"Finalizar sem motivo"). Os mais graves, achados na conferência do inventário — senha atual errada
desloga; cobrança do SGP a partir de atendimento encerrado; senha gerada que some ao fechar; tela
branca se o pacote principal não baixa — estão no Apêndice C.3, com dono.

## 5. Direção: princípios e sistema visual

### 5.1 Princípios

| # | Princípio | Razão |
|---|---|---|
| P1 | **Três superfícies sólidas** — fundo, painel, elevado. Separação por linha fina ou espaço. Sem gradiente, halo, blur ou branco translúcido empilhado. | 14 cinzas indistinguíveis não comunicam hierarquia; camada de vidro sobre camada é ruído. |
| P2 | **Três funções de cor, que não se misturam** (5.2). O acento é um só e significa "é com você". | Cor demais onde devia haver hierarquia, cor de menos onde devia haver distinção — o erro anterior nas duas direções. |
| P3 | **Duas linhas por conversa.** Nome + hora; uma linha de prévia + um indicador. | O que muda a decisão de abrir a conversa; o resto vive no cabeçalho, no painel e no nome acessível. |
| P4 | **Respiro por subtração, não por encolhimento.** Tirar o que se repete; escalas fixas de espaço, tipo e raio. | O ritmo quebrado vem de excesso de elementos, não de falta de pixel. |
| P5 | **Um vocabulário de estado** (Em atendimento, Em espera, Em automação, Encerrado), definido num módulo e usado em toda tela. | Hoje são 4 mapeamentos diferentes para o mesmo estado. |
| P6 | **Informação sob demanda, em painel, nunca por cima da conversa.** | Invariante homologado; é também o que o WhatsApp faz com os dados do contato. |
| P7 | **Desempenho é critério de aceite de toda etapa.** | Safari rebaixa tudo; a lentidão das máquinas i3 era JavaScript e rede, não pintura (Etapa 5). |
| P8 | **Estado e ação têm forma, não só cor.** Ativo × inativo por **barra de 3 px + fundo selecionado** (o ícone é sempre contorno — decisão 3, seção 14.1); presença por ponto cheio × vazado; lido × entregue por cor **e** rótulo acessível. | Regra de acessibilidade do projeto ("estado nunca só por cor"), hoje violada nos tiques. |
| P9 | **Toda interação responde.** Hover, pressionado (hoje não existe em lugar nenhum), foco e seleção têm estado visível e coerente. | "Sem vida" é, em parte, controle que não reage ao toque. |

### 5.2 Cor — três funções

#### 5.2.1 Marca (acento)
- **Um token de origem:** `--color-accent` (padrão `#f28c45`). Tudo o que é acento deriva dele por
  `color-mix` ou sintaxe de cor relativa: `--color-accent-strong` (hover), `--color-accent-soft`
  (texto e ícone sobre escuro), `--color-accent-surface` (fundo tingido), `--color-on-accent`
  (tinta sobre o acento).
- **`--color-on-accent` é derivada automaticamente:** `oklch(from var(--color-accent) clamp(0, (0.62 - l) * 1000, 1) 0 0)`
  — branco se o acento for escuro, preto se for claro — com o valor fixo `#2a1b12` como
  *fallback* fora de `@supports`. **`--color-accent-soft`** força luminosidade mínima para ler sobre
  o painel: `oklch(from var(--color-accent) max(l, 0.8) c h)`, com *fallback* `#e5a16d`.
- **Uso restrito** a: ação principal (**uma por vista**), seleção (item atual, aba ativa, destino
  atual do menu), não lida, anel de foco, link de ação. Nada mais.

#### 5.2.2 Semântica
- **Perigo** (`--color-perigo`, `--color-perigo-fundo`): erro e ação destrutiva **no momento da
  confirmação**. Botão "Encerrar" deixa de ser vermelho; o vermelho vai para o botão final do
  diálogo de encerramento.
- **Aviso** (`--color-aviso`, `--color-aviso-fundo`): janela de 24 h, confiança baixa, reconexão.
- **Não existe cor de sucesso.** Sucesso é texto + ícone de confirmação em tinta neutra. Sem verde.

#### 5.2.3 Categórica
- Só em **gráfico que distingue categorias** (Relatórios). A paleta validada para daltonismo
  (`reports.css`, seis slots, "Sem setor"/"Sem motivo" neutros) **fica** e vira tokens próprios
  `--color-cat-1..6`, isentos da regra do acento. Nome de pessoa num gráfico **nunca** leva cor de
  marca (o defeito que o proprietário apontou: nomes das atendentes todos em laranja).

#### 5.2.4 Marca pronta para configuração — aceite obrigatório
- **Teste estático** `src/estilo/acentoUnico.test.js`: varre `src/**/*.{css,js,jsx}` (fora testes,
  `assets/`, marcas de terceiros e o arquivo de tokens) e falha se encontrar literal de cor na
  família do acento (OKLCH: matiz 25°–90°, croma > 0,08), `rgba(242,140,69…)` ou classe
  `chat-orange`/`chat-copper`. Uma **lista de pendências por arquivo** começa com os arquivos ainda
  não migrados e **só pode encolher**; chega a zero na E7.
- **Prova no harness:** rodada extra com `--color-accent` trocado por azul `#1a73e8`, amarelo
  `#f5c518` e marinho `#1f3a5f`. Aceite: nenhum pixel na família laranja fora de imagens de conteúdo
  e marcas de terceiros; `on-accent` sobre o acento ≥ 4,5:1 nos três.
- **Ligar o `brandColor` do backend continua fora de escopo.** A preparação é aceite.

### 5.3 Superfícies e tinta (tema grafite, valores iniciais)

Valores **validados por teste** (`src/estilo/contraste.test.js`, seção 5.9). Se um valor falhar o
teste, ajusta-se o valor, nunca o limiar.

| Token | Papel | Valor inicial |
|---|---|---|
| `--color-fundo` | fundo da aplicação e da conversa (S0) | `#1b2227` |
| `--color-painel` | menu, lista, cabeçalhos, compositor, painéis laterais (S1) | `#222a30` |
| `--color-elevado` | diálogo, menu suspenso, popover, dica (S2) | `#2a333a` |
| `--color-campo` | campo de texto e busca (afundado) | `#1b2227` |
| `--color-linha` | divisória e borda | `#343e46` |
| `--color-hover` | hover sobre painel | `#283138` |
| `--color-selecionado` | seleção sobre painel (com barra do acento) | `#2e3840` |
| `--color-tinta` | texto principal | `#eef2f4` |
| `--color-tinta-2` | texto secundário | `#b3bec5` |
| `--color-tinta-3` | metadado, rótulo discreto (**nunca sobre bolha**) | `#939fa8` |
| `--color-bolha-entrada` | mensagem do cliente | `#28323a` |
| `--color-bolha-saida` | mensagem da empresa (atendente e IA) | `color-mix(in oklab, var(--color-accent) 16%, #333b41)` |
| `--color-perigo` / `-fundo` | erro, destrutivo | `#ff8a80` / `color-mix(in oklab, #ff8a80 14%, var(--color-painel))` |
| `--color-aviso` / `-fundo` | aviso | `#f0b65f` / `color-mix(in oklab, #f0b65f 14%, var(--color-painel))` |
| `--color-veu` | véu de diálogo (sólido, sem blur) | `rgba(9, 12, 15, 0.72)` |

A bolha de saída leva uma **tinta leve do acento**: é onde a identidade aparece na conversa, e ela
acompanha a marca quando o token muda. **Dentro de bolha, texto secundário e metadado (hora, autor,
citação) usam `--color-tinta-2`**, nunca `--color-tinta-3`: sobre a bolha de saída a tinta-3 cairia
para ~3:1 — é a mesma razão já registrada em `dashboard.css:158-160` para o autor da bolha.

Conta feita à mão para os valores iniciais (o teste da seção 5.9 é quem decide): tinta sobre bolha
de saída ≈ 7,9:1; tinta-2 sobre bolha de saída ≈ 4,7:1 e sobre a de entrada ≈ 6,9:1; bolha de
saída/entrada ≈ 1,46:1; tinta-3 sobre elevado ≈ 4,75:1; selecionado/painel ≈ 1,22:1;
hover/painel ≈ 1,10:1; linha/painel ≈ 1,33:1; on-accent (preto) sobre `#f28c45` ≈ 8,6:1. A distinção entre bolhas vem de **luminância** (≥ 1,3:1 entre
elas, medido) e de **alinhamento** — o filete de 3 px que existia só porque as bolhas diferiam
1,047:1 deixa de ser necessário, e a razão dele (distinção por luminância) é mantida por teste.

### 5.4 Tipografia
- **Inter** em todo texto de interface, **inclusive** conversa, compositor, painel SGP e diálogos
  (a pilha "Segoe UI" `--font-wa` sai: só existia no Windows e caía em Helvetica no Mac e no iPhone).
- **Sora** só em títulos (página, diálogo, painel) e números grandes.
- **Escala única** (tokens `--ui-text-*` já declarados, até hoje com zero uso): 12 (metadado, hora),
  13 (rótulo, secundário), 14 (**corpo**: prévia, mensagem, campo, botão), 15 (nome na lista),
  16 (título de painel, nome no cabeçalho), 20 (título de página), 26 (número grande).
  **Piso de 12 px** para qualquer texto; meio pixel não existe mais.
- Pesos: Inter 400/500/600; Sora 600. Numerais tabulares em hora, contagem e dinheiro.

### 5.5 Espaço, raio, elevação, movimento
- **Espaço:** escala de 4 (`--ui-space-1..12`: 4, 8, 12, 16, 24, 32, 48). Valor ímpar não existe.
- **Raio:** 4 passos — `--ui-radius-sm` 6 (selo, dica), `--ui-radius-md` 10 (botão, campo, bolha,
  item selecionado), `--ui-radius-lg` 16 (diálogo, popover, painel flutuante), `9999px` (avatar,
  ponto, contagem). Os 18 raios de hoje somem.
- **Elevação:** superfícies S0/S1 não têm sombra. S2 tem **uma** sombra por papel:
  `--ui-sombra-flutuante: 0 8px 24px rgba(0,0,0,.35)` (menu, popover, dica) e
  `--ui-sombra-dialogo: 0 24px 64px rgba(0,0,0,.45)`. As ~17 sombras de hoje somem.
- **Movimento:** `--ui-dur-1` 120 ms (hover, pressionado), `--ui-dur-2` 180 ms (entrada de popover e
  diálogo). **Pressionado:** `transform: translateY(1px)` em botão, fundo `--color-selecionado` em
  linha. Tudo desliga com `prefers-reduced-motion`.

### 5.6 Iconografia
- **Primeiro a arquitetura, depois a família.** Hoje o chunk de entrada (login, "Sem acesso")
  carrega 47 dos 48 ícones sem usar nenhum, por três importações (`App.jsx` e `ProtectedRoute.jsx`
  via `navItems.js`; `AccessDeniedPage.jsx` via `WaIcons`). Separar essas três dá **−4,7 KB gzip no
  login** (medido duas vezes, por caminhos independentes) — com qualquer família.
- **Uma família profissional, vendorizada** como SVG inline, **Tabler 3.48.0, só contorno** (decisão
  3 do proprietário, seção 14.1), só com os ícones usados, em **três módulos gerados por camada** —
  `IconesEntrada.js` (cadeado), `IconesTrabalho.js` (casca + mesa), `IconesConfig.js` (lazy) —, com
  o arquivo de licença ao lado — mesma disciplina das fontes. **Sem dependência npm em runtime.**
  Números e mapeamento completo: Apêndice D (`2026-09-24-redesenho-apendice-D-iconografia.md`).
- **Tamanhos:** 16 (inline em texto), 20 (botões e cabeçalhos), 24 (menu). **Nenhum ícone
  preenchido:** ativo e selecionado se marcam por barra de 3 px + fundo `--color-selecionado`
  (P8); botão de painel aberto, por fundo selecionado + `aria-expanded`.
- **Emoji como ícone sai** (prévia da lista hoje usa "📷 Foto", "🎤 Áudio"…): vira ícone da família
  + texto. Glifos soltos (`✕`, `⚠`, `×`, `←`) viram ícones.
- Marcas de terceiros (WhatsApp `#25D366`, Meta, 360dialog) **não mudam** — SVG inline, nunca
  `mask-image`.

### 5.7 Estados de interação (todos os controles)
Hover (fundo `--color-hover` ou tinta mais forte), **pressionado** (novo), foco (regra atual fora de
`@layer` mantida: `outline` para ação, `box-shadow` para campo, cor `--color-accent-soft`),
selecionado (`--color-selecionado` + barra de 3 px do acento), desabilitado **com motivo** no
`title`/descrição acessível.

### 5.8 Arquitetura de estilo
- Tokens novos declarados em `@theme` (geram utilitários: `bg-painel`, `text-tinta-2`,
  `border-linha`…) no arquivo novo `src/estilo/tokens.css`, importado por `index.css`.
- **CSS de componente mora com o componente.** O que hoje está em `dashboard.css` e é da conversa
  (`.conv-raiz`, `.chat-workspace-*` da conversa) vai para `src/components/conversa.css`, importado
  por `ConversationView` — conserta o modal de conversa fora da mesa e mantém o lazy correto.
- **Valor arbitrário (`-[..]`) é proibido em código novo** fora de medidas de layout que não têm
  token (ex.: `w-[332px]` ligado a `LISTA_EXPANDIDA`). Área migrada sai com contagem zero de
  `text-[`, `rounded-[`, `bg-white/[`, `shadow-[`.
- Tokens antigos (`--chat-*`, `--color-ui-surface-*`, `--color-wa-*` escuros, `--sv-*`, `--rp-*`,
  tema claro do `@theme`) **convivem** até a última área migrar e saem na E7.
- **A armadilha central continua valendo:** CSS sem `@layer` vence `@layer utilities` do Tailwind v4
  independentemente da especificidade. Classe no DOM não prova nada: a prova é estilo computado.

### 5.9 Validação automática de contraste
`src/estilo/contraste.test.js` lê os tokens de `tokens.css` (resolvendo `color-mix` em OKLab) e
exige: tinta ≥ 7:1 sobre fundo, painel, elevado e as duas bolhas; tinta-2 ≥ 4,5:1 sobre painel,
elevado e as duas bolhas; tinta-3 ≥ 4,5:1 sobre fundo, painel e elevado; acento-suave ≥ 4,5:1 sobre painel;
on-accent ≥ 4,5:1 sobre o acento; anel de foco ≥ 3:1 sobre fundo e painel; perigo e aviso ≥ 4,5:1
sobre painel e sobre o próprio fundo tingido; bolha-saída/bolha-entrada ≥ 1,3:1 em luminância;
selecionado/painel ≥ 1,2:1; hover/painel ≥ 1,08:1; linha/painel ≥ 1,3:1.

## 6. A mesa de atendimento (E2) — especificação

### 6.1 Moldura e menu (o que o atendente vê junto)
- **Sem moldura flutuante:** a casca deixa de ter `p-3`, `gap-3`, cantos e halos
  (`AppShell.jsx:90-91`). Menu, lista e conversa encostam, separados por linha de 1 px. Ganho: 36 px
  de largura e 24 px de altura na mesa. *Estrutural.*
- **Menu em trilho único de 64 px** em qualquer rota no desktop, ícone de 24 px, rótulo na dica
  (`DicaFlutuante`) e no nome acessível; no celular continua a gaveta de 216 px **com rótulos**.
  Saem: os três títulos de grupo ("Trabalho", "Acompanhamento", "Administração" — dois deles para um
  item só), o botão "Recolher menu" e o modo expandido de 196 px. *Razão:* com no máximo seis
  destinos, grupo e modo expandido são o que tornava o menu desorganizado.
  **Ordem:** topo — marca (símbolo 32 px), Atendimento, Encerrados (só atendente), Supervisão,
  Campanhas, Relatórios; base — Configurações, Som da fila, indicador "Reconectando…" (quando
  houver), Conta (avatar → Meu perfil, Sair).
  **Ativo:** barra de 3 px do acento à esquerda + fundo `--color-selecionado` + ícone (contorno) na
  cor do acento, com `aria-current="page"` (forma + cor, P8; decisão 3).
- O preferido `useNavCollapsed` deixa de existir para o desktop; `useWorkspaceLayout` continua medindo
  a largura real (o menu passa a ter largura fixa, o que só simplifica).

### 6.2 Coluna da lista (largura 332 px — limiar homologado, não muda)
- **Cabeçalho (56 px):** título "Atendimento" (Sora 20) + botão de ícone "Nova conversa" (neutro,
  36×36, dica e nome acessível). O botão laranja cheio "Nova" sai: iniciar conversa é ação
  ocasional, e o acento é de "é com você". *Estrutural.*
- **Busca (36 px):** campo afundado, placeholder "Buscar nome, telefone, cidade ou setor" — a busca
  já casa esses campos (`DashboardPage.jsx:30-41`), e é por ela que cidade e setor continuam
  encontráveis na lista.
- **Abas da fila (40 px):** sublinhado de 2 px no acento para a ativa, contagem como número em
  tinta-2 ao lado do rótulo ("Espera 14"). Sai a pílula laranja cheia com bolinha branca e brilho
  `#f4531f`. *Estrutural (quantidade de camadas e posição da contagem).*
- **Item (72 px, 2 linhas, avatar 44 px):**
  - Linha 1: nome (15/20, 600, tinta) · hora à direita (12, numerais tabulares, tinta-3; na fila é a
    hora de chegada).
  - Linha 2 conforme a aba:
    - **Atendimento:** tiques (se a última mensagem saiu) + prévia (14, tinta-2).
    - **Espera:** **localidade** (tinta-2, 500) + separador desenhado por CSS + prévia — decisão do
      proprietário (B), porque os atendentes dividem a fila por cidade (`c3118b4`).
    - **Automação:** ícone da IA + estado ("Em triagem" ou o motivo da triagem) + separador + prévia.
  - Fim da linha 2 (um só, por prioridade): botão "Finalizar sem motivo" (Espera/Automação, ícone
    neutro, irmão da linha) → ⚠ de confiança baixa (ícone de aviso com nome acessível) → ponto de não
    lida (10 px, acento).
  - **Não lida:** ponto + hora no acento (duas pistas, uma é forma).
  - **Selecionada:** fundo `--color-selecionado` + barra de 3 px do acento. Hover: `--color-hover`.
  - **Divisória** de 1 px começando depois do avatar.
  - **Saem:** fichas de cidade e setor, texto lilás da IA, chip do responsável (restaura a decisão de
    21/09 — em Atendimento seria sempre o próprio atendente), filete de estado (toda linha de uma
    aba tinha o mesmo filete: zero informação), gradiente e contorno de seleção.
  - **Nome acessível da linha** carrega tudo: nome, hora, localidade, setor, estado da IA, prévia,
    "não lida". Nenhuma informação some para leitor de tela.
  - Prévia de mídia: ícone da família + rótulo ("Foto", "Áudio"…), sem emoji. Pix nunca mostra o
    código (regra existente).
  - Cabem **8 itens** em 1366×768 (medido no fim da etapa; mínimo exigido: 7).
- **Trilho (72 px):** avatar 40 + ponto de não lida; selecionado com barra do acento. Sem mudança
  de comportamento.
- **Estados da lista:** carregando = 6 linhas-esqueleto com a forma do item (círculo + duas barras),
  contraste ≥ 1,5:1; vazio por aba (ícone 32 px + frase); busca sem resultado ("Nada encontrado para
  “termo”" + "Limpar busca"); erro (frase + "Tentar de novo" — ligado na E4).
- **Barra da equipe (44 px):** "Equipe" + "5 online" com ponto cheio (presença, P8), sem verde;
  abre a vista "Nossa equipe" **na própria coluna da lista** ("←" e ESC voltam), com a conversa à
  vista — deixa de ser modal (Apêndice E).

### 6.3 Conversa
- **Cabeçalho em 2 linhas (64 px):** avatar 40 neutro (sai o disco laranja→cobre) · linha 1 nome
  (16, 600) · linha 2 em texto corrido, por prioridade e com `@container`: estado (vocabulário P5) ·
  setor · telefone · protocolo · localidade. **Ações à direita:** Assumir (primário, acento — só sem
  responsável), Transferir (secundário, ícone + rótulo), Encerrar (secundário neutro), divisória,
  e os botões de ícone **Histórico, SGP, Cliente** (SGP e Cliente alternam painel com `aria-expanded`
  e ficam com fundo `--color-selecionado` quando abertos; Histórico abre diálogo, com `aria-haspopup="dialog"`). **A barra de contexto sai** (o setor aparecia nela pela terceira vez). *Estrutural.*
- **Linha do tempo:** fundo `--color-fundo` liso (sai o gradiente). Nota "Este atendimento fica
  registrado…" vira texto de 12 px sem pílula. Separador de dia: pílula pequena neutra.
  "Carregar mensagens anteriores": botão secundário pequeno. Carregando/erro: mantêm texto e papel
  ARIA, restilizados.
- **Bolhas:** entrada `--color-bolha-entrada` à esquerda; saída `--color-bolha-saida` à direita;
  **IA usa a bolha de saída** com o rótulo "Assistente IA" e ícone da IA na meta (sai o lilás e o
  filete). Rótulo do autor na primeira bolha do grupo (mantido). Texto 14/20. Raio 10 com canto de
  4 px no lado do autor na primeira do grupo. Citação: barra em tinta-3 + nome em tinta.
  Selo de hora sobre imagem: fundo escuro sólido, sem blur. Falha: ícone + "Não entregue: motivo"
  em perigo.
- **Tiques:** enviado (1), entregue (2, tinta-3), lido (2, acento-suave) — com `aria-label`
  "Enviada", "Entregue", "Lida", "Falhou" (P8).
- **MessageBubble com `memo`** (decisão do proprietário): o corpo do `timeline.map` vira componente
  memoizado; meta: 1 re-render de bolha por mensagem recebida (hoje 55,5).
- **Compositor (faixa `--color-painel`):** emoji, anexar, respostas rápidas à esquerda dentro do
  campo; campo cresce até o teto homologado (menor entre 320 px e 45% da janela); à direita,
  **microfone quando vazio, Enviar (acento) quando há texto ou anexo** — um só botão ocupa o lugar.
  "Respondendo", prévia de anexo, "Gravando…" e `RecordingPreview` restilizados em S1/S2 sem cobre.
- **Sugestão da IA:** faixa acima do compositor, rótulo "Sugestão da IA" com ícone, texto, ações
  Enviar (acento), Editar e Descartar (secundários) numa linha. Sem lilás.
- **Janela de 24 h (fechada/indeterminada):** faixa de aviso (ícone + texto + "Enviar template"),
  textos atuais preservados.

### 6.4 Painéis (coluna de 268 px ou substituição — regra homologada)
- **Cliente** vira o destino do que saiu da vista: identidade, estado, telefone, canal, protocolo,
  localidade/cidade, setor, atendente, nota interna, triagem por IA (motivo, resumo, confiança
  baixa, resolvido pela IA). Só dados reais. **A edição do cliente acontece aqui** (sai o modal
  "Editar cliente", que cobria a conversa). No modal de conversa (Supervisão, Encerrados) o painel
  Cliente substitui o painel de informações e recebe o que só ele tinha — "Alterar setor", "Encerrado
  em", a confiança da IA em % (Apêndice E).
- **SGP:** uma superfície só (sai o aninhamento de até 4 camadas); seções separadas por linha;
  ações Pix/boleto/PDF/link como linhas de ação com ícone. `qrcode` passa a `import()` sob demanda.
  **Abertura automática lembra a última escolha na sessão** (decisão do proprietário): se o atendente
  fechou o SGP, as próximas conversas abrem sem ele até ele reabrir; guarda em `sessionStorage` pelo
  utilitário protegido `armazenamentoLocal`.

### 6.5 Mesa vazia
Sem o título de 32 px em Sora light: ícone da conversa (48 px, tinta-3), "Selecione um atendimento
na lista" e a nota de registro em 12 px.

### 6.6 Tudo que se abre a partir da mesa
A E2 inclui a **base de diálogo** (`ui/Dialog`, `WaDialog`, `AlertDialog`, `ConfirmDialog`,
`overlays.css`: véu sólido sem blur, painel `--color-elevado` com uma sombra, raio 16, título em
Sora 16, sem ícone de cabeçalho, perigo só no destrutivo; diálogo de ação com rodapé
`[Cancelar][ação principal]` e sem ×, diálogo de consulta com × e sem rodapé; estado "ocupado" que
não deixa fechar com envio em curso; camada leve na pilha para o ESC — regra completa no Apêndice E.1)
e a **reestruturação de cada overlay alcançável da mesa**: Iniciar conversa, Transferir, Encerrar
(motivo), Enviar template, Atendimentos anteriores (lista e detalhe), Editar cliente,
visualizador de imagem, alerta, confirmação de "Finalizar sem motivo", Nossa equipe, Encerrados
+ conversa em modal + painel de informações, Meu perfil, menu da conta, emojis, respostas rápidas,
aviso de transferência, faixa de status do canal, avisos de conexão. Dois deixam de ser diálogo e
viram painel (Editar cliente → painel Cliente; Nossa equipe → coluna da lista); o painel de
informações da conversa em modal se funde no painel Cliente. O que muda em cada um, com a conta
estrutural × cosmético (141 × 49), está no Apêndice E; o detalhe de implementação, no plano da E2. Os demais diálogos do sistema
herdam a pele nova da base na E2 e ganham a reestruturação própria na etapa da área deles.

## 7. Casca e carregamento (E3) — resolve (a), (b), (c)
- **(a) Nunca tela branca:** `<style>` inline mínimo no `index.html` com `html,body{background:#1b2227;color-scheme:dark}`
  (o `index.css` repete via token) e o fallback do `Shell` desenhado como **esqueleto com a forma da
  mesa** (trilho + lista + conversa) em tokens — contraste ≥ 1,5:1 sobre o fundo real.
- **(b)** `ClosedConversationsModal` passa a `lazy` no `SideNav`: a camada da casca cai de 164,6 KB
  para ~25,7 KB (medido em build simulado). A decisão 10 (14.1) manteve Encerrados como **diálogo**
  (mestre-detalhe), então o `lazy` é o caminho — e a E2 já o faz, porque reescreve o diálogo; a E3
  confere o ganho no harness. `DashboardPage` continua importando `ConversationView`
  estaticamente — a primeira conversa abre sem espera.
- **(c)** Plugin de build pequeno injeta no `index.html` um script inline (ES5, `try/catch`) que, **só
  com sessão salva**, adiciona `<link rel="modulepreload">` para os trechos da casca e da rota atual
  (mapa gerado do manifesto). O login não ganha nenhum byte. Meta: 5 → 3 camadas seriais.

## 8. Rede (E4) — resolve (d), (e)
- **(d)** `apiFetch` aceita `signal` e aplica timeout de 20 s nos `GET` (acima do corte de 15 s do
  SGP no backend). **POST nunca é repetido automaticamente**; envio que estoura o tempo vira "sem
  confirmação — conferindo" e relê as mensagens. Erro 502 em HTML vira `ApiError` legível. `GET` sem
  `Content-Type`. Listas ganham "Tentar de novo". Token de mídia com timeout e nova tentativa
  agendada. Troca de conversa aborta os pedidos da anterior.
- **(e)** Conversa não remonta ao assumir (`queue:removed` → `conversation:assigned`); o painel SGP
  guarda a consulta enquanto a conversa estiver aberta ("Atualizar" explícito, invalidação após
  qualquer ação); respostas rápidas pedidas ao abrir o menu; rebusca da conversa aberta e das listas
  na reconexão do socket. **Sem TTL no transporte** (decisão da Etapa 4: fila e mensagens não podem
  envelhecer).
- `ConversationHistoryModal` busca o **detalhe** de um atendimento anterior inteiro, sem limite. A
  rota de mensagens já aceita `limit` e `before` (adição compatível, ADR-010): paginar o detalhe é
  só frontend e entra aqui, na E4. A **lista** de atendimentos anteriores tem `LIMIT 50` fixo no
  backend — registrado, sem correção nesta frente. (Correção de 24/09: a versão anterior deste item
  dizia que paginar exigia backend.)

## 9. Invariantes de acessibilidade e responsividade (não regridem)
Contrastes AA medidos (avatar 7,22:1; autor na bolha ≥ 4,97:1; selo de falha ≥ 4,83:1; contador
ativo 15,6:1); estado nunca só por cor; um anel de foco, validado com Tab real; `ui/Dialog` +
`dialogStack` (foco inicial, trap, ESC por pilha, foco devolvido, clique fora à prova de arrasto,
`inert` embaixo); popover não vira modal (emojis `role="dialog"`, respostas rápidas `role="menu"`);
`conversationOpen` = "a conversa ocupa a tela inteira"; "Abrir menu" sempre alcançável; conversa ≥
420 px e ordem de sacrifício do `useWorkspaceLayout` (limiares 1020/752/760/492 px); painel nunca
cobre as mensagens; teto do compositor relativo à janela; faixas abaixo de 500 px e 683×384
homologadas; `@container` nos diálogos e no cabeçalho; `aria-live` ≠ `role="status"`, um só
`role="status"` por tela; ação da linha e ação do botão são irmãos; `WaError`/`WaSuccess`.

## 10. Etapas

| Etapa | Entrega | Publica sozinha | Resolve |
|---|---|---|---|
| **E1** Correções urgentes — **PUBLICADA** (`e5236da`, 24/09/2026) | Cinco ocorrências da classe "resposta em trânsito voltando com outra conversa na tela": corrida do SGP, mesmo contato em dois canais, "carregar anteriores" que nunca funcionou, bolha na conversa errada, compositor trancado. Registro em Obsidian `Bugs` (CLASSE-01, BUG-006) | publicada | parte de (e) |
| **E1.1** Rolagem ao carregar anteriores — **PUBLICADA** (merge `fee5cc2`, 24/09/2026) | O clique em "carregar anteriores" jogava a linha do tempo para o fim; agora a mensagem do topo fica no lugar (âncora por elemento, segura enquanto fotos carregam, com e sem ancoragem nativa); a carga inicial não apaga mais a mensagem que chegou pelo socket; o pedido de anteriores desiste em 20 s. Duas revisões independentes, tudo provado no Chrome real (Apêndice C.2) | sozinha | parte de (e) |
| **E0** Prova e guardas — plano `docs/superpowers/plans/2026-09-24-redesenho-e0-prova-e-guardas.md` | Harness e verificador do inventário versionados em `ferramentas/` (branch `ferramentas/medicao-e-inventario`, pronta); testes que protegem os cinco ganhos; testes de conteúdo da variante `compact`; as 5 falhas antigas corrigidas (asserções); inventário remapeado para a base nova; linha de base com tempo registrada | sim (sem mudança de runtime) | — |
| **E2** Mesa de atendimento | Seção 6 inteira (com a base de diálogo e os 18 overlays do Apêndice E), tokens, ícones (Apêndice D), Inter única, `MessageBubble` com memo, CSS da conversa com o componente, `qrcode` sob demanda, chip do próprio nome, aviso de transferência | sim — **checkpoint** | — |
| **E3** Casca e carregamento | Seção 7 | sim | (a) (b) (c) |
| **E4** Rede | Seção 8 | sim | (d) (e) |
| **E5** Supervisão e Relatórios | Revogação das decisões de 22/09 (tons de estado, KPIs coloridos, acabamento de cartão); nomes nunca em cor de marca; paleta categórica só onde há categoria; densidade com respiro | sim | — |
| **E6** Configurações e Campanhas | 25 páginas + modais + linhas inline + estados; `SettingsShell`, `DataTable`, `Card`, `Field`; menu de seções | sim | — |
| **E7** Acesso e fechamento | Login, Sem acesso, estados globais restantes; remoção de tokens antigos e do tema claro; lista de pendências do acento = 0; medição final completa; atualização do Obsidian | sim | — |

Ordem aprovada (revista pelo proprietário em 24/09/2026): **E1 → E0** → E2 (checkpoint) → E3 → E4 → E5 → E6 → E7. A E1 subiu para primeiro porque a corrida do SGP podia mandar Pix e boleto de um cliente para o WhatsApp de outro, em produção; foi publicada sozinha, antes de qualquer etapa visual. **Mudança em relação ao plano
aprovado, pela exigência do checkpoint:** a moldura, o menu e os overlays da mesa entram na E2 (antes
estavam em E3 e E5), para a tela avaliada não nascer meio nova e meio velha. A E3 fica com o
carregamento; a antiga E5 (diálogos) deixa de existir como etapa separada — a base muda na E2 e cada
área reestrutura os seus diálogos.

## 11. Checkpoint da E2
Ao fim da E2 a mesa é entregue **funcionando, com dados reais**, antes de qualquer outra etapa
visual. **Mecanismo decidido (decisão 2, seção 14.1): prévia publicada** — site estático separado no
Render construído da branch da E2, com `VITE_API_BASE_URL` apontando para a API de produção e a origem
da prévia acrescentada a `FRONTEND_ORIGIN` (a variável já aceita lista — só configuração, código do
backend intocado). O proprietário entra com a conta dele e usa a mesa de verdade; a produção dos 10
atendentes não muda. Criar o site e mexer na variável do backend são passos no painel do Render que o
proprietário autoriza na hora (o plano da E2 traz o roteiro). Se a direção não for a esperada,
corrige-se a E2 antes de seguir.

## 12. Medição, orçamentos e prova

### 12.1 Harness
Versionado na E0 em **`ferramentas/medicao/`**, na raiz do repositório — **fora de `frontend/`**:
dentro, o Tailwind v4 lê os arquivos do harness e vaza classes para o CSS de produção (medido:
+23 B no CSS de entrada, todos os hashes mudam). O `medir.mjs` recusa rodar se for copiado para
dentro. Mede M1–M9 (prints; superfícies; famílias de cor; item da lista; profundidade; esqueleto;
cascata; requisições repetidas; linha de base) e a rodada de marca alternativa (5.2.4). Roda ao fim
de **cada** etapa.

**Regras do pacote, não recomendações (decisão do proprietário):** medida de tempo (M7, M9) só com
a máquina ociosa — o `medir` amostra a CPU e recusa acima de 15% — e sempre mediana de pelo menos
3 rodadas; o `comparar` só compara tempo entre rodadas que cumpriram as duas, e trata como ruído
a variação dentro da faixa medida de cada métrica (M7 ±5%, boot CPU 4× ±5%, durações do navegador
±20%; contagem de nós do DOM sempre exata). Motivo: numa rodada com a máquina ocupada, o boot com
CPU 4× mediu +24% sem nenhuma mudança de código.

### 12.2 Orçamentos (aceite)

| Métrica | Linha de base | Meta |
|---|---|---|
| JS de entrada | 273,6 KB / 87,7 KB gz | −4,5 KB gz ou mais na E2 (ícones fora da entrada, Apêndice D.4); depois não cresce |
| CSS de entrada | 123,2 KB / 21,7 KB gz | −15% ou mais ao fim; não cresce em nenhuma etapa |
| Camadas seriais até a lista | 5 | 3 (E3) |
| 1º item da lista, Fast 3G / Slow 3G | 5.019 / 17.613 ms | ≤ 3.500 ms / −30% (E3) |
| Login, Fast 3G | 1.844 ms, 1 camada | igual ±2% |
| Esqueleto | 1,00:1 / 1,28:1 | nunca branco; ≥ 1,5:1 (E3) |
| Elementos com conversa aberta | 929 | ≤ 800 (E2) |
| Boot até a lista, CPU 4× | 874 ms | ≤ 874 ms |
| `clientes?cpf` no roteiro fixo | 3 | 2 (E4) |
| Fundos distintos visíveis (mesa) | 28 | ≤ 10 (E2) |
| Famílias de cor ao mesmo tempo (mesa) | 5 | 1 acento + semânticas só quando há exceção (E2) |
| Camadas de fundo sob texto (máx.) | 6 | ≤ 3 (E2) |
| Code splitting | 39 rotas lazy | teste verde |
| Paginação | 50 + sonda | teste verde, incluindo "anteriores" |
| Memo da lista | 40 → 0 / 1 | teste verde |
| AgentsContext | 20 → 8 | teste verde |
| Fontes locais | 0 pedidos a Google | teste verde |

### 12.3 Registro de mudanças (estrutural × cosmético)
Cada etapa termina com `docs/superpowers/specs/2026-09-24-redesenho-registro-E<n>.md`: uma linha por
mudança — elemento, antes, depois, classe **S** (posição, tamanho, quantidade ou existência) ou **C**
(cor, superfície, raio, sombra) — e o total. S > C é condição de aprovação. Números estruturais do
harness (elementos por item, linhas do cabeçalho, controles por barra) sustentam a contagem.

## 13. Armadilhas que já custaram caro (valem em todas as etapas)
1. CSS sem `@layer` vence utilitário do Tailwind — prova é estilo computado.
2. `position: sticky` não reserva espaço.
3. `color-mix` abaixo de ~28% pode não produzir cor perceptível (13% deu croma 0,004).
4. Grade de colunas estoura sem a página rolar — conferir `scrollWidth` por elemento.
5. Override preso a ancestral só vale onde o ancestral existe (o motivo do CSS da conversa mudar de
   casa).
6. O bundler pode quebrar CSS que funciona no dev (`mask-image` com SVG): asset e marca só se
   validam no build de produção.
7. jsdom não calcula layout: sobreposição e corte só se provam no harness.
8. Dois `role="status"` na mesma tela disputam o papel.
9. Alterou o arquivo, roda o teste dele e o dos consumidores.
10. Import não prova montagem: provar pelo efeito.

## 14. Decisões registradas nesta revisão
- **Revogadas (proprietário, 24/09/2026):** os 4 tons de estado da Supervisão, os 4 KPIs coloridos e
  o acabamento de cartão de Relatórios, as abas em pílula laranja cheia, o ícone tonal dos diálogos,
  o "Encerrar" sempre vermelho. Motivo registrado: foram aprovadas por esgotamento, não por escolha.
- **Mantidas por razão técnica:** largura da lista 332 px e limiares; painel nunca por cima;
  teto do compositor; pilha de diálogos; paleta categórica validada; marcas de terceiros em SVG
  inline; fontes locais; "não lida é marca, não contador".
- **Fora de escopo:** ligar o `brandColor` do backend (preparação é aceite); a lista de atendimentos
  anteriores além de 50 (`LIMIT 50` no backend; o detalhe pagina na E4, só frontend); dívida R7 do `Button` (as áreas mudam cor, não tamanho, sem mexer no contrato).

### 14.1 Decisões do proprietário (24/09/2026)

| # | Decisão | Razão (do proprietário) | Onde vale |
|---|---|---|---|
| 1 | **E1.1 publicada** (merge `fee5cc2`) | — | seção 10; Apêndice C.2 |
| 2 | Checkpoint da E2 numa **prévia separada no Render** (site estático próprio, `VITE_API_BASE_URL` da API de produção, a origem da prévia acrescentada a `FRONTEND_ORIGIN` — configuração, código do backend intocado) | 10 atendentes trabalhando e a E2 reescreve a mesa inteira: olhar sem arriscar a operação. Rollback é rede de segurança, não plano | seção 11 |
| 3 | Ícones **Tabler**; item ativo do menu por **barra + fundo**, sem ícone preenchido | o Safari rebaixa tudo a cada carga; 2,8 KB no caminho crítico não se pagam com ícone preenchido, e barra e fundo comunicam o ativo igualmente bem | Apêndice D; seção 6.1 |
| 4 | Cobrança do SGP a partir de atendimento encerrado: **o envio continua**, com o aviso "Atendimento encerrado — a cobrança vai direto ao cliente" no painel | bloquear criaria um caminho novo de falha num fluxo financeiro que hoje funciona | Apêndice C.3 (CV-SGP-33); E2 |
| 5 | "Senha atual errada desloga" (PRF-12) corrigido **já, isolado**, no modelo da E1 | atinge qualquer atendente hoje; esperar a E4 é semanas | Apêndice C.3; branch própria |
| 6 | Menu em **trilho único de 64 px**, sem modo expandido | uma forma só é mais fácil de acertar que duas; o modo expandido era parte da desorganização | seção 6.1; Apêndice B.1 |
| 7 | Transferir: carga como **número + "Carga alta"** a partir de 10 | quatro rótulos são quatro coisas para decorar; número é direto | Apêndice E.2 |
| 8 | Catálogo de motivos: **só as 2 legendas** que acrescentam (Financeiro, Suporte técnico) | legenda que repete o título é ruído | Apêndice E.2 |
| 9 | Resposta rápida sobre texto digitado: **insere no cursor** (campo vazio: preenche) | apagar o que a pessoa escreveu é destruir trabalho sem confirmação | Apêndice E.2 |
| 10 | Encerrados: **diálogo mestre-detalhe** (lista à esquerda, conversa à direita, um diálogo só) | a vista na coluna competiria com a fila ativa, que é o trabalho principal; e o popup de hoje é o que carrega a `ConversationView` pela barra lateral | Apêndice E.2; seção 7(b) |
| 11 | Aviso de transferência: **marca na lista** (não lida + "Transferido por Fulano" na linha, texto na região viva) | aviso fixo na coluna ocupa espaço permanente por um evento pontual | Apêndice E.2 |

## Apêndices
- **A** — Inventário completo de telas e estados, com etapa dona — `2026-09-24-redesenho-apendice-A-inventario.md` (pronto: 1.708 estados, 0 falhas, 0 linhas sem conferência; amostra independente: 0 erro em 58 linhas).
- **B** — Para onde vai o que sai da vista principal — `2026-09-24-redesenho-apendice-B-destinos.md` (pronto para a E2; cada etapa acrescenta a sua tabela antes de implementar).
- **C** — Achados da auditoria e etapa dona — `2026-09-24-redesenho-apendice-C-achados.md` (pronto; listas geradas do inventário verificado).
- **D** — Iconografia: família (Tabler, decisão 3) e mapeamento — `2026-09-24-redesenho-apendice-D-iconografia.md`.
- **E** — Overlays da mesa: mudanças estruturais por item — `2026-09-24-redesenho-apendice-E-overlays.md` (pronto: base única, 18 overlays, 141 S × 49 C; detalhe nos anexos `2026-09-24-redesenho-apendice-E-anexos/`).
