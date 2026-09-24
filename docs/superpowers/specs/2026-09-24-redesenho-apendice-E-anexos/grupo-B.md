> **Anexo do Apêndice E** — relatório de auditoria (subagente, somente leitura, base `e5236da`), **conferido por amostra** antes de entrar no spec (Apêndice E.0). É material de detalhe para o plano da E2: onde este anexo e o Apêndice E divergirem, **vale o Apêndice E** (a base única e as decisões de E.3/E.4 resolvem os conflitos entre os grupos). A correção de ATD-INI-24/29 que este anexo pede já foi aplicada ao Apêndice A.

# Apêndice E — Grupo B: overlays e popovers abertos de dentro da conversa

> Auditoria somente leitura, 24/09/2026. **Código lido:** cópia de `e5236da` em
> `scratchpad/estados/base-e5236da/frontend/src` (endereços abaixo são relativos a essa pasta).
> Backend consultado só para confirmar fatos, por `git show e5236da:` — nenhuma proposta toca nele.
> Ids do Apêndice A citados como estão no inventário verificado.

## Convenções desta auditoria

- **S** — estrutural: muda **posição, tamanho, quantidade ou existência** de algo visível (região,
  controle, informação).
- **C** — cosmético: **cor, superfície, raio, sombra**. Tamanho de letra que só normaliza a escala
  do 5.4 é contado como **C·tipo**, por prudência (não inflar S com tipografia).
- **B** — comportamento: defeito do Apêndice A/C (estado AUSENTE, falha muda, corrida). **Fica fora da
  conta S×C**, mas é listado e contado à parte — é trabalho real que não é pintura.
- **Regra de contagem:** pele herdada da base (`ui/Dialog`, `WaDialog`, `overlays.css`, e o novo
  Popover da seção 0) é contada **uma vez, na seção 0**, e não repetida em cada item. Mudança visível
  que só acontece num item é contada no item, mesmo quando o mecanismo mora na base.
- "Camadas de fundo" = fundos pintados na cadeia de ancestrais sob o texto principal até o primeiro
  opaco. Translúcido deixa a mesa transparecer; é por isso que a conta passa do diálogo.
- **DECISÃO-n** = precisa de escolha do proprietário; opções e recomendação no próprio item e
  consolidadas na seção 7.

---

## 0. Base comum (o que os seis itens herdam)

### 0.1 Estrutura hoje

- **Montagem do diálogo** (`components/ui/Dialog.jsx`): véu (283-291) → painel (292-303) → **×
  absoluto** fora do fluxo (304-315, posicionado por `overlays.css:14`, com `padding-right:56px` no
  cabeçalho para não colidir, `overlays.css:16`) → cabeçalho `[ícone tonal opcional][título +
  descrição]` (316-334) → filhos.
- **Rodapé não é região da base.** `DialogFooter` existe (`Dialog.jsx:139-145`), mas cada tela faz de
  um jeito: Histórico monta `dw-dialog-footer` à mão (`ConversationHistoryModal.jsx:162-169`); Editar
  cliente usa um `<div>` que só vira rodapé por seletor estrutural
  (`.dw-dialog form > div:last-child:has(> button)`, `overlays.css:26-27`); Alerta e Confirmação põem
  a linha de ação **dentro do corpo**, numa grade (`AlertDialog.jsx:30-32`, `overlays.css:160-164`).
- **Pele:** véu `rgba(13,20,24,.68)` + `blur 6px` no nível 0 (`Dialog.jsx:283-285`,
  `index.css:120-121`); painel `bg-wa-panel` = `rgba(45,54,60,.96)` + borda + `backdrop-blur 28px`
  (`Dialog.jsx:302`, `index.css:117-119,131`); raio **18** (`overlays.css:2`, sem camada, vence o
  token de 22 de `index.css:116`); sombra de 3 camadas com brilho interno (`overlays.css:2`); ícone
  tonal em ladrilho **34×34** com **5 tons** — acento, perigo `#e05a48`, azul `#5aa2e8`, verde
  `#5fb89b`, lilás `#9b7ae8` (`overlays.css:6-10`); × em círculo com borda e fundo próprios
  (`overlays.css:14`).
- **Tipo forçado dentro de qualquer diálogo** (`overlays.css:17-22`, sem camada): título 18,
  descrição **12** (vence o `text-[14px]` de `Dialog.jsx:328`), campo 13, rótulo 12, **botão 12** —
  tudo abaixo do corpo 14 do 5.4.
- **Popovers não têm base.** Cada um tem pele própria: `.dialog-emoji-picker` raio 10
  (`overlays.css:204`), `.dialog-quick-replies` 340 px e raio 10 (`:200`), `.dialog-context-menu` raio 8
  (`:194`), `.dialog-filter-options` raio 9 (`:208`); fundo `bg-ui-surface-overlay/95` +
  `backdrop-blur-xl` + sombra própria escritos em cada tela (`MessageInput.jsx:534`, `:562`).
- **Envio em curso:** a base não sabe que há envio; ×, ESC, clique no fundo e "Cancelar" fecham no
  meio do POST (família C.4.3).
- **ESC:** a pilha escuta no `document` e já respeita evento com `defaultPrevented`
  (`dialogStack.js:42-50`, a checagem está em `:43`). Os popovers do compositor escutam ESC no mesmo
  `document` sem `preventDefault` (`MessageInput.jsx:189-196`). Registrado depois, o ouvinte deles roda
  depois do da pilha.

### 0.2 Problemas

| # | Classe | Problema | Evidência |
|---|---|---|---|
| 0-P1 | S | Rodapé em três formas; a posição da ação principal muda de diálogo para diálogo (dentro do corpo no Alerta, por seletor no Editar, à mão no Histórico) | `AlertDialog.jsx:30`; `overlays.css:26-27`; `ConversationHistoryModal.jsx:162` |
| 0-P2 | S | Dois jeitos de sair lado a lado (× + "Fechar"/"Cancelar"). A própria base já registra a razão contra isso e a aplica só à Confirmação e ao Alerta | `ConfirmDialog.jsx:23-24`, `AlertDialog.jsx:23-24` × `ConversationHistoryModal.jsx:165`, `EditContactModal.jsx:139` |
| 0-P3 | S | Ícone de cabeçalho ocupa uma coluna de 34×34 | `overlays.css:6` |
| 0-P4 | C | Véu com desfoque (P1 proíbe blur) | `Dialog.jsx:284`, `index.css:121` |
| 0-P5 | C | Painel translúcido 96 % + blur 28 px: a mesa transparece sob todo diálogo | `Dialog.jsx:302`, `index.css:119,131` |
| 0-P6 | C | Sombra de 3 camadas + brilho interno (5.5: uma sombra por papel) | `overlays.css:2` |
| 0-P7 | C | Raio 18 (e token 22 que nunca vale) | `overlays.css:2`, `index.css:116` |
| 0-P8 | C | Ícone tonal em 5 famílias de cor — decisão revogada em 24/09 (spec 14) | `overlays.css:6-10`, `Dialog.jsx:318-322` |
| 0-P9 | C·tipo | Botão 12, campo 13, rótulo 12, descrição 12 dentro de diálogo | `overlays.css:18-22` |
| 0-P10 | C | Cada popover com pele própria (4 raios, 2 sombras, fundo translúcido + blur) | `overlays.css:194,200,204,208`; `MessageInput.jsx:534,562` |
| 0-P11 | B | Fechar com envio em curso (C.4.3) | `EditContactModal.jsx:139` (e demais formulários) |
| 0-P12 | B | ESC com popover aberto dentro do modal de conversa fecha o **modal** (CVM-MOD-10) | `dialogStack.js:42-50`; `MessageInput.jsx:189-196` |

### 0.3 Proposta estrutural (base)

1. **Rodapé é região da base.** `DialogFooter` passa a ser a única forma: `[nota opcional à esquerda]
   … [Cancelar][ação principal]`. Alerta e Confirmação tiram a ação de dentro do corpo (a mudança
   visível é contada no item 4). O seletor `overlays.css:26-27` **fica** para os diálogos de
   Configurações que ainda dependem dele (`overlays.css:156`: users, city, sector, reason) até a E6,
   sem uso novo.
2. **Cabeçalho numa linha:** `[ícone 20 px neutro, opcional] título (Sora 16) + descrição (13,
   tinta-2) … [×]`. O ícone sai do ladrilho de 34×34 (**S**, tamanho) e perde o tom (**C**). Perigo só no
   destrutivo (6.6).
3. **Regra do × — DECISÃO-1.** (a) *Recomendada:* × só em diálogo **sem** `[Cancelar]` (leitura:
   Histórico, conversa em modal); com `[Cancelar]`, as saídas são Cancelar + ESC — é a regra que
   Confirmação e Alerta já seguem. (b) × em todos, como hoje. A contagem de S nos itens 1 e 2 assume (a).
4. **`busy` na base (B):** com envio em curso, ESC, ×, clique no fundo e "Cancelar" ficam
   bloqueados; o botão principal troca o rótulo ("Salvando…"). Resolve a regra de primitivo de C.4.3.
5. **Popover base (novo componente, não camada da pilha):** superfície `--color-elevado`,
   `--ui-sombra-flutuante`, raio 16; **âncora no próprio gatilho**; **altura máxima = espaço livre
   acima do gatilho** (com rolagem interna); clique fora = fora do popover **e** do gatilho; ESC
   tratado no `onKeyDown` do próprio popover e do campo com `preventDefault()` — a pilha já ignora
   evento marcado (`dialogStack.js:43`), então o 1º ESC fecha o popover e o 2º o modal. **Não entra
   na pilha**: entrar tornaria `inert` o modal de baixo (`Dialog.jsx:288`), e o popover mora dentro
   dele. `role` continua sendo de cada popover (emojis `dialog`, respostas `menu` — invariante 9).
6. **Pele (C):** véu `--color-veu` sólido; painel `--color-elevado` sólido com borda `--color-linha`;
   `--ui-sombra-dialogo`; raio 16; escala de tipo 16/13/14/13/14 (título, descrição, campo, rótulo,
   botão); campo (`waInputClass`, `WaDialog.jsx:10`) em `--color-campo` afundado.

### 0.4 Destinos (formato do Apêndice B)

| Sai | Vai para | Tipo |
|---|---|---|
| × em diálogo que tem `[Cancelar]` | "Cancelar" no rodapé + ESC (DECISÃO-1 a) | ação |
| Ladrilho colorido do ícone de cabeçalho | Ícone neutro de 20 px na linha do título; perigo só no destrutivo | nada |
| Desfoque do véu, do painel e dos popovers | Nada: superfícies sólidas (P1) | nada |
| Pele própria de cada popover | Popover base, uma vez | nada |

### 0.5 Riscos e testes (base)

- A pele muda em **todos** os diálogos de uma vez (22 usos de `WaDialog` + `Dialog` direto,
  `WaDialog.jsx:4-5`), inclusive em Configurações — é o que 6.6 pede, mas o print de cada um entra
  no registro da E2.
- `busy`: testar que ESC, × e fundo não fecham durante o envio, que o foco não escapa, e que ao
  terminar com sucesso o diálogo fecha sozinho; ao terminar com erro, o formulário continua com os
  dados.
- Popover: teste de ESC dentro de `ConversationModal` (1º ESC fecha só o popover; 2º fecha o
  modal); teste de clique fora; **harness a 683×384 com o campo no teto** (ver achado N7). A ordem
  "popover antes da pilha" depende de o React 18 escutar no contêiner da raiz/portal, abaixo do
  `document` onde a pilha escuta — provar no Chrome real, não só no jsdom (armadilha 13.7/13.10).
- Foco inicial nunca em ação destrutiva (`Dialog.jsx:68-74`, `Button.jsx:30`) — mantido.

---

## 1. Atendimentos anteriores — lista e detalhe (`components/ConversationHistoryModal.jsx`)

Gatilho: ícone "Ver atendimentos anteriores" (`ConversationView.jsx:617-619` no modal,
`:668-670` na mesa). Diálogo `variant="history"`, 640 px, fecha no fundo
(`ConversationHistoryModal.jsx:96`).

### 1.1 Estrutura hoje

**Vista lista — 3 regiões:** cabeçalho (ícone tonal azul + "Atendimentos anteriores" + "{n}
atendimentos encerrados", `:88-96`) · resultados (`:135-160`) · rodapé ("Somente leitura." +
"Fechar", `:162-169`).
- **Controles:** × (`Dialog.jsx:304-315`) + N itens (`:140`) + "Fechar" (`:165`) → **2 controles
  que fazem a mesma coisa** + os itens.
- **Títulos/ícones de cabeçalho:** 1 título, 1 descrição, 1 ícone tonal (`tone="info"`, `:96`).
- **Item (cartão):** borda + fundo `#ffffff05` + raio 11 + 6 px entre cartões (`overlays.css:110-111`);
  dentro: **bloco de data** em coluna de 50 px (dia 15 px negrito + mês 9,5 px caixa-alta,
  `:146-149`, `overlays.css:114-116`) · motivo 13,5/600 (`:151`, `overlays.css:118`) · **linha de
  apoio** 11,5 com 5 pedaços: `data completa · hora · quem atendeu · canal · "Finalizado"` (`:37-41`,
  `:152`) · glifo "›" (`:154`).
- **Camadas sob o motivo:** cartão `#ffffff05` → painel 96 % + blur → véu 68 % + blur → mesa.
  **3 próprias, todas translúcidas.**
- **Cores de destaque:** 1 (azul do ícone tonal, `overlays.css:8`).
- **Ação principal:** não há (leitura). O lugar dela (rodapé à direita) é ocupado por "Fechar".
- **Tipos na vista:** título 18, dia 15, glifo 15, motivo 13,5, descrição 12, botão 12, apoio 11,5,
  nota 11,5, mês 9,5 → **6 tamanhos distintos**, 3 textos abaixo do piso de 12.

**Vista detalhe — 5 regiões:** cabeçalho ("{motivo} · {data} · {hora}" + "{quem atendeu} ·
{canal}", `:88-93`) · **migalha** "← Atendimentos anteriores" em faixa própria com borda
(`:99-104`, `overlays.css:121-122`) · **resumo** `dl` com Responsável / Status / Encerrado por /
Motivo em faixa com borda e fundo `#ffffff02` (`:105-110`, `overlays.css:147-149`) · mensagens sobre
papel de parede (`:111-132`, `overlays.css:150`) · rodapé.
- **Controles fixos:** × + Voltar + Fechar → **3, dois deles fecham**.
- **O que se repete (medido no próprio teste,** `ConversationHistoryModal.test.jsx:152`, comentário
  "'Ana Clara' aparece na descrição do diálogo e na ficha Responsável"):
  motivo no título **e** no resumo; quem atendeu na descrição **e** em "Responsável"; quem encerrou
  na descrição (`:15-16`) **e** em "Encerrado por"; "Status" = sempre "Finalizado" — a consulta só
  devolve encerrados (`WHERE c.status = 'closed'`, `src/conversations/conversation.repository.js:796`
  em `e5236da`). **O resumo inteiro é redundante.**
- **Bolhas próprias** (`:113-130`): borda + fundo `rgba(255,255,255,.14/.12)`, raio 14, hora 11 px
  — sem separador de dia, sem autor/"IA", sem citação, sem "Não entregue"; Pix mostra o código como
  texto solto (`:122`) contra a regra de `ConversationView.jsx:753-755`.
- **Camadas sob o texto da bolha:** bolha → papel de parede `#293136` (opaco) = 2. Sob o resumo: 3.
- **Cores de destaque:** 2 — azul do ícone + laranja do "voltar" (`--color-wa-link` `#ffb078`,
  `overlays.css:122`, `index.css:160`).

### 1.2 Problemas

| # | Classe | Problema | Evidência |
|---|---|---|---|
| 1-P1 | S | Rodapé inteiro sem ação: "Fechar" duplica o ×; "Somente leitura." ocupa uma faixa | `:162-169` |
| 1-P2 | S | Data **duas vezes** no mesmo item (bloco + início da linha de apoio) | `:146-149` × `:38` |
| 1-P3 | S | "Finalizado" em todo item e "Status: Finalizado" no resumo: constante, zero informação | `:38`, `:44`, `:107`; repositório `:796` |
| 1-P4 | S | Migalha em faixa própria só para um botão Voltar | `:99-104` |
| 1-P5 | S | Faixa de resumo 100 % redundante com título e descrição | `:105-110` × `:88-93` |
| 1-P6 | S | Detalhe usa bolha própria: faltam separador de dia, autor/IA, citação e falha (CV-HIS-14) | `:113-130` |
| 1-P7 | C | Cartão por item (borda + fundo + raio) em vez de linha (P1) | `overlays.css:111` |
| 1-P8 | C | Papel de parede no detalhe (6.3: fundo liso) | `:111`, `overlays.css:150` |
| 1-P9 | C | Glifo "›" (5.6: glifo solto vira ícone) | `:154` |
| 1-P10 | C·tipo | 9,5 e 11,5 px (piso é 12) | `overlays.css:116,119`, `:35` |
| 1-P11 | C | "Voltar" em laranja de link | `overlays.css:122` |
| 1-P12 | B | Subtítulo diz "0 atendimentos encerrados" carregando e com erro (CV-HIS-01/03) | `:93` |
| 1-P13 | B | Erro da lista sem "Tentar de novo" (CV-HIS-03) | `:136` (sem `onRetry`) |
| 1-P14 | B | Detalhe sem carregando, erro mudo, vazio em branco (CV-HIS-10/11/12) | `:73-78` (`.catch(() => {})`) |
| 1-P15 | B | Mensagens do atendimento anterior ficam até a nova resposta; resposta atrasada cobre a seguinte (CV-HIS-10, CLASSE-01) | `:74-76` (não zera, não confere id) |
| 1-P16 | B | **Novo (N1):** ao "Voltar", o botão focado desmonta e o foco cai no `<body>`; como a mesa não fica `inert` com diálogo no nível 0 (`Dialog.jsx:288` só marca níveis de baixo) e o trap é `onKeyDown` do painel (`Dialog.jsx:301`), o Tab seguinte sai do diálogo *(suspeita, deduzida do código)* | `:84-86`, `:100` |
| 1-P17 | B | **Novo (N3):** a lista vem com `LIMIT 50` (`conversation.repository.js:798`) e o subtítulo diz "50 atendimentos encerrados" mesmo havendo mais *(suspeita)* | `:93` |

### 1.3 Proposta estrutural

**Lista (2 regiões: cabeçalho + lista; sem rodapé).**
- Cabeçalho: ícone neutro 20 px + "Atendimentos anteriores" + descrição **só quando a lista está
  pronta**: "{n} encerrados" (ou "Últimos 50 encerrados" quando vierem 50). × à direita (DECISÃO-1 a).
- Item vira **linha de 2 linhas** (P3), altura fixa, divisória de 1 px:
  - linha 1: **motivo** (14/600, tinta; "Sem motivo registrado" em tinta-2) · **data** à direita
    (12, numerais tabulares, tinta-3; "Início não informado" quando faltar — CV-HIS-08);
  - linha 2: **hora · quem atendeu (ou "Atendido por X, encerrado por Y") · canal** (13, tinta-2,
    reticências);
  - ícone de seta da família à direita. Hover, pressionado e foco da base (P9).
  - Nome acessível da linha carrega tudo, inclusive a data completa.
- Estados: carregando com esqueleto na forma da linha; erro com "Tentar de novo"; vazio atual.

**Detalhe (3 regiões: cabeçalho + mensagens; sem migalha, sem resumo, sem rodapé).**
- Cabeçalho: o **Voltar ocupa o lugar do ícone** (botão de ícone 20 px, nome acessível atual
  "Voltar para atendimentos anteriores") · título "{motivo ou 'Sem motivo registrado'} · {data} ·
  {hora}" · descrição "{quem atendeu/encerrou} · {canal} · somente leitura" · ×.
- Mensagens com a **mesma bolha da conversa** (`MessageBubble` do 6.3, em modo leitura: sem
  Responder, sem Analisar comprovante), sobre `--color-fundo` liso, com separador de dia, autor/"Assistente
  IA", citação, "Não entregue" e a regra do Pix.
- Estados do detalhe: esqueleto; erro com "Tentar de novo"; vazio "Nenhuma mensagem neste
  atendimento.". Ao abrir outro atendimento, as mensagens zeram e a resposta que chegar de um
  atendimento que não é mais o selecionado é descartada.
- Ao voltar, o foco vai para a linha que estava aberta.
- **Mesma moldura nas duas vistas** (640 px, `overlays.css:103-108`) — mantida.

### 1.4 Destinos

| Sai | Vai para | Tipo |
|---|---|---|
| Botão "Fechar" do rodapé | × do cabeçalho, ESC e clique no fundo (já existentes, CV-HIS-17) | ação |
| Nota "Somente leitura." | Descrição do detalhe ("… · somente leitura"); na lista não há campo, a leitura é evidente | dado |
| Bloco de data (dia + mês) | Fim da linha 1 do item (data curta, tabular) e nome acessível (data completa) | dado |
| Data completa na linha de apoio | Fim da linha 1 (data) + começo da linha 2 (hora) | dado |
| "Finalizado" em cada item | Nada: a consulta só devolve encerrados e o subtítulo já diz "encerrados" | nada |
| Faixa da migalha "← Atendimentos anteriores" | Botão de ícone Voltar no lugar do ícone do cabeçalho, mesmo nome acessível | ação |
| Resumo "Responsável" | Descrição do detalhe (`quemAtendeu`, `:13-19`) | dado |
| Resumo "Encerrado por" | Descrição do detalhe ("Atendido por X, encerrado por Y", `:15-16`) | dado |
| Resumo "Motivo" | Título do detalhe (`:89`) | dado |
| Resumo "Status" | Nada: sempre "Finalizado" | nada |
| Papel de parede do detalhe | Fundo liso `--color-fundo`, como a conversa (6.3) | nada |
| Bolha própria do detalhe | `MessageBubble` da conversa em modo leitura | dado |
| Ícone tonal azul | Ícone neutro (base) | nada |

### 1.5 Ids do Apêndice A

Resolve: **CV-HIS-01, CV-HIS-03, CV-HIS-10, CV-HIS-11, CV-HIS-12, CV-HIS-14** (e CV-HIS-15 no
retorno do foco). Muda: CV-HIS-05 (subtítulo só quando pronto), CV-HIS-06 (item em 2 linhas),
CV-HIS-07 (vai para a linha 2), CV-HIS-08 ("--" some com o bloco; "Início não informado" fica),
CV-HIS-09 (título unificado + "somente leitura"), CV-HIS-13 (sai), CV-HIS-16 (sai), CV-HIS-18
(o `@media 680` de `overlays.css:207` perde o objeto: a linha já tem 2 linhas em qualquer largura).
Mantém: CV-HIS-02, CV-HIS-04, CV-HIS-17. Relacionado: MSG-ANX-07 (anexo no histórico continua sem
"Analisar comprovante" — é leitura).

### 1.6 Riscos e testes

- `MessageBubble` em modo leitura depende da extração do 6.3 (memo). Sem ela, o item cai para uma
  bolha própria **com** separador de dia e regra do Pix — não pode voltar a mostrar o código Pix.
- Testes que mudam: `ConversationHistoryModal.test.jsx` "calls onClose when Fechar is clicked"
  (o botão some; fechar pelo ×) e o que afirma `'Responsável'` e `'Finalizado'` na tela.
- Testes novos: subtítulo ausente em carregando/erro; "Tentar de novo" nas duas vistas; troca rápida
  entre dois atendimentos com promessas atrasadas (a primeira não pode cobrir a segunda); foco na
  linha ao voltar; visor de imagem aberto a partir do detalhe (pilha com 2 níveis) segue fechando só
  o visor com ESC.
- Conferir no harness: 8 linhas visíveis a 1366×768; nada cortado a 683×384.

---

## 2. Editar cliente (`components/EditContactModal.jsx`)

Gatilho: clique no bloco avatar + nome do cabeçalho (`ConversationView.jsx:573-576`, CV-CAB-03).

### 2.1 Estrutura hoje

- **3 regiões:** cabeçalho só com título "Editar cliente" (`:71`) · campos (`:73-137`) · rodapé
  `[Cancelar][Salvar]` (`:138-145`, rodapé por seletor, `overlays.css:26-27`).
- **Controles:** × + Nome + Município + Localidade + Nota interna + Cancelar + Salvar = **7**, dos
  quais × e Cancelar fazem o mesmo.
- **Títulos/ícones:** 1 título, 0 ícone, 0 descrição — **nada diz de quem é o contato** (o nome é
  justamente o que está sendo editado, e pode estar vazio).
- **Grade** (`overlays.css:53-54`): 2 colunas; filhos 3+ em linha inteira. Resultado:
  **Nome | Município** na 1ª linha, **Localidade sozinha** em linha inteira na 2ª, Nota na 3ª. O par
  que depende um do outro (Município → Localidade, `:29-32`, `:113`) fica **separado**; o par sem
  relação (Nome, Município) fica junto.
- **Largura:** `max-w-2xl` = 672 px para 4 campos (`:71`).
- **Ajuda da nota** só como placeholder "Visível só para os atendentes" (`:132`): some assim que há
  nota — que é justamente o caso de quem está editando uma.
- **Camadas sob o texto do campo:** campo `rgba(255,255,255,.07)` (`WaDialog.jsx:10`,
  `index.css:132`) → painel 96 % + blur → véu → mesa = **3 próprias**.
- **Cores de destaque:** 1 (Salvar, `WaDialog.jsx:14-15`). **Ação principal:** Salvar, rodapé à
  direita (certo).
- **Tipos:** título 18, rótulo 12, campo 13, botão 12 (todos forçados por `overlays.css:17-22`).
- **Ponto de entrada:** o texto de reserva da 2ª linha do cabeçalho diz "clique aqui para **ver** os
  dados do contato" (`ConversationView.jsx:595`, CV-CAB-13), e o clique abre um formulário de
  **edição** (`:574`). *(Achado N5.)*

### 2.2 Problemas

| # | Classe | Problema | Evidência |
|---|---|---|---|
| 2-P1 | S | Par dependente Município → Localidade separado; Nome ocupa meia linha ao lado de algo sem relação | `overlays.css:53-54`; `:85-122` |
| 2-P2 | S | 672 px para 4 campos | `:71` |
| 2-P3 | S | Nenhuma âncora de identidade (telefone) no cabeçalho | `:71` |
| 2-P4 | S | Ajuda da nota em placeholder (some com conteúdo) | `:132` |
| 2-P5 | S | × e Cancelar (0-P2) | `Dialog.jsx:304`, `:139` |
| 2-P6 | S | Empilhamento por `@media (max-width:600px)` da **janela**, não do diálogo — contra o invariante "`@container` nos diálogos" | `overlays.css:55` |
| 2-P7 | S | Clique que promete "ver dados" abre edição (N5) | `ConversationView.jsx:595` × `:574` |
| 2-P8 | B | Falha ao carregar municípios é muda: o select mostra só "Nenhum" (CV-EDC-03) | `:10` (não pega `refresh`), `:96` |
| 2-P9 | B | Localidade desabilitada sem motivo (CV-EDC-04); município sem localidades sem aviso (CV-EDC-05) | `:113`, `:115` |
| 2-P10 | B | "Salvar" desabilitado sem "Salvando…" (CV-EDC-09) | `:142` |
| 2-P11 | B | Cancelar/×/ESC com o POST em curso; se der certo depois da troca de conversa, `onSaved` grava o nome e a cidade de A no cabeçalho de B (CV-EDC-13, CLASSE-01) | `:52-60`; `ConversationView.jsx:372-373`, `:976` |
| 2-P12 | B | A nota salva não acompanha o override: reabrir mostra a antiga e salvar de novo **apaga** a nova; o painel Cliente também mostra a antiga (CV-EDC-11, CV-CLI-03) | `ConversationView.jsx:967-974`, `:222-227` |
| 2-P13 | B | Nome só com espaços é enviado (CV-EDC-08, regra comum de C.4.5) | `:42` |

### 2.3 Proposta estrutural — DECISÃO-2 (onde se edita)

**(A) Recomendada — editar no painel Cliente, sem modal (P6).** O clique no bloco nome/avatar do
cabeçalho abre o **painel Cliente** (é o que o texto da 2ª linha já promete e o que a referência faz com
os dados do contato); o cabeçalho do painel ganha o botão de ícone **"Editar cliente"**; o corpo do
painel alterna para o formulário em **1 coluna de 268 px** (Nome · Município · Localidade · Nota
interna com ajuda fixa), com `[Cancelar][Salvar]` fixos no pé do painel. A conversa **continua
visível** ao lado: o cliente costuma escrever o nome e a cidade na própria conversa, e o modal cobria
exatamente isso. No modal de conversa (Encerrados/Supervisão), onde não existe painel Cliente
(CV-PNL-07), o mesmo "Editar" entra no `ConversationInfoPanel` — coordenar com o dono desse item.
Na largura em que o painel substitui a conversa, o comportamento é o da regra homologada (6.4).

**(B) Alternativa — manter o modal, reestruturado:**
- Grade: **Nome** (linha inteira) / **Município | Localidade** (par, dependência da esquerda para a
  direita) / **Nota interna** (linha inteira, ajuda fixa "Visível só para os atendentes." sob o
  rótulo, ligada por `aria-describedby`).
- Largura 672 → **480 px**; o par empilha por `@container` do diálogo (não por `@media` da janela).
- Descrição do cabeçalho: **telefone formatado** do contato.
- Sem × (DECISÃO-1 a): saídas "Cancelar" e ESC.
- O ponto de entrada continua sendo o cabeçalho, com o texto de reserva corrigido para "Editar dados
  do cliente" (texto do cabeçalho é do outro grupo; aqui só a coerência).

**Em ambas (B):** erro de municípios com "Tentar de novo" (`usePlaces().refresh`); ajuda "Escolha o
município primeiro" na Localidade desabilitada; "Nenhuma localidade cadastrada neste município";
"Salvando…" + `busy` (nada fecha no meio do POST); `onSaved` só aplica se o `contactId` da resposta
for o da conversa na tela; o override passa a carregar `internalNote` para o formulário e para o
painel Cliente; nome aparado antes de enviar (vazio continua valendo como hoje — sem regra nova).

### 2.4 Destinos

| Sai | Vai para | Tipo |
|---|---|---|
| (A) Modal "Editar cliente" | Modo edição do painel Cliente (mesmos 4 campos, mesma rota `updateContact`) | ação |
| (A) Clique no cabeçalho abrindo o formulário | Clique no cabeçalho abre o painel Cliente; "Editar cliente" no cabeçalho do painel | ação |
| (B) × do cabeçalho | "Cancelar" + ESC | ação |
| Placeholder "Visível só para os atendentes" | Texto de ajuda fixo sob "Nota interna" | dado |
| Par Nome \| Município | Nome em linha inteira; Município \| Localidade em par | nada (reordenação) |

### 2.5 Ids do Apêndice A

Resolve: **CV-EDC-03, CV-EDC-04, CV-EDC-05, CV-EDC-09, CV-EDC-11, CV-EDC-13**, CV-EDC-08 (só
aparar), CV-CLI-03. Muda: CV-EDC-01 (ganha descrição com telefone em B; vira título de modo do
painel em A), CV-EDC-07 (placeholder → ajuda), CV-EDC-12 (`@container`), CV-CAB-03 e CV-CAB-13
(ponto de entrada). Mantém: CV-EDC-02, CV-EDC-06, CV-EDC-10 (`WaError`).

### 2.6 Riscos e testes

- **(A)** O estado do chat sobrevive à troca de conversa (`ConversationView` não remonta — ver o
  efeito de `ConversationView.jsx:371-383`): o modo edição e o rascunho dos campos **têm de zerar**
  em `conversation.id`, senão o formulário de A aparece aberto em B. Teste obrigatório.
- **(A)** ESC dentro do painel em edição: cancelar a edição, **sem** fechar o modal de conversa por
  baixo (mesma família de CVM-MOD-10); o painel hoje não entra na pilha.
- **(A)** Testes que mudam: `ConversationView.test.jsx` "clicking the contact name/avatar opens the
  edit-contact modal" e "the edit-contact trigger's accessible name includes the contact name".
- Guarda do `onSaved`: teste com salvar lento + troca de conversa → B não recebe nome/cidade de A.
- Nota no override: salvar nota → reabrir → a nova aparece; salvar de novo não apaga.
- `busy`: ESC durante o POST não fecha; erro mantém o que foi digitado.

---

## 3. Visualizador de imagem (`components/MessageAttachment.jsx`, `ImageBubble`, portal `:415-500`)

Por decisão registrada, o visor entra na pilha (`useDialogLayer`, `:328`) sem herdar a moldura do
Dialog (`Dialog.jsx:84-86`). A proposta mantém isso.

### 3.1 Estrutura hoje

- **3 regiões, duas flutuando sobre a imagem:** palco em tela cheia (`:416-435`) · ✕ solto no canto
  superior direito (`absolute right-5 top-4`, `:436-443`) · barra de zoom flutuante no rodapé central
  (`absolute bottom-5`, `:465-497`).
- **Controles:** ✕, −, +, Ajustar, Baixar = **5** (+ leitura "{n}%", `:475`); em 100 % o "−" está
  desabilitado e "Ajustar" não faz nada — **2 dos 5 inertes no estado inicial**.
- **Títulos:** 0 visíveis; nome acessível genérico "Visualizar imagem" (`:421`); `alt` = nome do
  arquivo (`:765`). **Nada diz de quem é a imagem nem quando chegou.** A legenda da mensagem não
  aparece no visor.
- **Duas zonas de controle nos cantos opostos:** fechar em cima à direita, o resto embaixo no centro.
- **A imagem fica por baixo dos controles:** `max-h-full` no palco com `p-4` (`:434`, `:462`), e barra
  e ✕ são `absolute` por cima — o pé de um comprovante alto (o caso que motivou o zoom, `:282-285`)
  fica atrás da barra em 100 %.
- **Camadas sob "100%":** barra preto 70 % + blur (`:470`) → fundo `#0b141a` a 95 % (`:434`) → imagem
  ou mesa = 2 próprias + o que estiver embaixo.
- **Cores de destaque:** 0. O fundo `#0b141a` é literal da paleta do WhatsApp (restrição 3.2).
- **Tipos:** 18 (✕, forçado por `overlays.css:206`; −/+ `:513`), 13 (%, Ajustar, Baixar).

### 3.2 Problemas

| # | Classe | Problema | Evidência |
|---|---|---|---|
| 3-P1 | S | Controles em 2 zonas nos cantos opostos | `:436-443` × `:465-497` |
| 3-P2 | S | Controles cobrem a imagem (nenhum espaço reservado) | `:434`, `:440`, `:470` |
| 3-P3 | S | Nenhum contexto (autor, data/hora) | `:419-421` |
| 3-P4 | S | Legenda da mensagem ausente no visor | `:307` (`ImageBubble` só recebe `hasCaption`) |
| 3-P5 | S | "Ajustar" visível e inerte em 100 % | `:481-487` |
| 3-P6 | C | Fundo com cor literal do WhatsApp, translúcido | `:434` |
| 3-P7 | C | Barra preto 70 % + blur + borda + raio 18 (P1) | `:470` |
| 3-P8 | C | Glifos ✕ − + (5.6) | `:442`, `:473`, `:479` |
| 3-P9 | C | ✕ com borda e raio 8 vindos de `overlays.css` sem camada | `overlays.css:206` |
| 3-P10 | B | Cursor "zoom-in" em 100 %, mas clique simples não amplia; % sem `aria-live` (MSG-IMG-08) | `:450`, `:460`, `:475` |
| 3-P11 | B | Arrasto só com mouse; sem toque nem setas (MSG-IMG-10) | `:452-457`, `:371-390` |
| 3-P12 | B | "Baixar" pode navegar a aba para a imagem crua (MSG-IMG-12): `download` é ignorado entre origens e a rota não manda `Content-Disposition` para imagem (`src/api/media.routes.js` em `e5236da`: só `document` ganha o cabeçalho) | `:488-496` |

### 3.3 Proposta estrutural

- **Uma barra só, no topo, que reserva espaço** (56 px, superfície de painel sólida): à esquerda,
  **autor** — o mesmo rótulo da bolha: nome do contato na entrada, "Atendente" ou "Assistente IA" na
  saída (`ConversationView.jsx:802-803`) — + **data e hora** da mensagem (12, tinta-2); à direita, na
  ordem: Diminuir · {n}% · Aumentar · **Ajustar (só com zoom > 100 %)** · Baixar · divisória ·
  **Fechar**. Sai a barra flutuante do rodapé e o ✕ solto. O foco inicial continua no Fechar (marcado
  com `data-autofocus`), mesmo ele passando a ser o último da barra.
- **Palco reservado:** a imagem ocupa o espaço **abaixo** da barra (e acima da legenda) e nunca fica
  coberta por controle em 100 %.
- **Legenda** da mensagem, quando existir, embaixo do palco, até 3 linhas com rolagem própria,
  mesmo espaço reservado.
- Nome acessível do diálogo passa a ser "Imagem de {autor}, {data}"; `alt` continua o nome do
  arquivo (conteúdo).
- Comportamento (B): clique simples em 100 % amplia 2× **no ponto clicado** (o cursor já promete
  isso); em > 100 % o clique simples não faz nada (arrasto), duplo clique continua voltando;
  `aria-live="polite"` no percentual (sem `role="status"`, invariante 9); arrasto por
  `pointer events` (toque) e setas do teclado com zoom > 100 %; **Baixar** busca o arquivo com
  `urlAgora()` e salva por `blob:` + `a[download]` (mesma origem, funciona); se a busca falhar, abre em
  **nova aba** — a aba do app nunca navega. Sem mudança de backend: o CORS já é global
  (`src/server.js:70` em `e5236da`) e o token de mídia vai na query.
- **DECISÃO-3:** (i) **Girar** 90° (MSG-IMG-15) — recomendo incluir: comprovante fotografado de lado
  é comum e o custo é um `rotate()` no mesmo `transform`; (ii) **galeria** anterior/próxima
  (MSG-IMG-16) — recomendo **não** na E2 (precisa da lista de imagens da conversa e muda a pilha).

### 3.4 Destinos

| Sai | Vai para | Tipo |
|---|---|---|
| ✕ solto no canto superior direito | "Fechar", último botão da barra do topo; ESC e clique no palco fora da imagem continuam | ação |
| Barra flutuante do rodapé (−, %, +, Ajustar, Baixar) | Barra do topo, à direita, mesma ordem | ação |
| "Ajustar" sempre visível | Aparece com zoom > 100 %; tecla 0 e duplo clique continuam ajustando | ação |
| Fundo `#0b141a` a 95 % | `--color-fundo` sólido | nada |
| Desfoque e borda da barra | Nada (P1) | nada |

### 3.5 Ids do Apêndice A

Resolve: **MSG-IMG-08, MSG-IMG-10, MSG-IMG-12** (a parte que o frontend alcança), MSG-IMG-15 (se
DECISÃO-3 i). Muda: MSG-IMG-06 (nome acessível com autor e data; foco inicial segue no Fechar, agora
marcado explicitamente), MSG-IMG-07 (o fechar muda de lugar), MSG-IMG-09, MSG-IMG-11 (Ajustar
condicional), MSG-IMG-14 (abaixo de ~360 px o contexto sai da barra — continua no nome acessível — e
a barra pode quebrar em duas linhas, que continuam **reservadas**, sem cobrir a imagem). Mantém:
MSG-IMG-13, MSG-IMG-17 ("Diminuir zoom"/"Aumentar zoom"). Fica AUSENTE por decisão: MSG-IMG-16.
Coordenação (não conta aqui): MSG-IMG-02/03 são da **miniatura** na bolha (6.3), não do visor.

### 3.6 Riscos e testes

- Autor e data não chegam hoje ao `ImageBubble` (`:307`, `:761-769`): `MessageAttachment` precisa de
  uma prop nova com o rótulo do autor (a conversa e o histórico a passam); sem ela, o contexto cai
  para só a data.
- O palco reservado reduz a área da imagem em 100 % (barra + legenda); comprovante alto fica menor
  → conferir no harness a 1366×768 e 683×384 que a imagem ocupa ≥ 70 % da altura sem legenda.
- Clique simples que amplia não pode quebrar a guarda de arrasto que impede fechar ao soltar fora
  (`draggedRef`, `:424-429`); testes de `MessageAttachment.test.jsx` (ESC pela pilha, botões de zoom,
  "100%") seguem valendo.
- `blob:` guarda a imagem inteira na memória: revogar a URL logo após o clique; Safari do iPhone abre
  a prévia em vez de salvar — aceitável (não sai do app).
- Setas só com zoom > 100 % e só quando o visor é o topo da pilha (hoje o ouvinte de `+ − 0` não
  confere o topo, `:356-367`).

---

## 4. Alerta (`components/ui/AlertDialog.jsx`, via `hooks/useAlert.jsx`)

Usos na mesa: 3, todos em `ConversationView.jsx` — falha ao **assumir** (`:521`), ao **enviar** e ao
**descartar** sugestão da IA (`:534`, `:547`). Nenhum passa `title`.

### 4.1 Estrutura hoje

- **3 faixas, 2 filetes:** cabeçalho com "Aviso" (padrão, `:10`; filete `overlays.css:4`) · corpo em
  grade `[ícone 36×36 | mensagem]` (`:27-29`, `overlays.css:160-163`) · **linha de ação dentro do
  corpo**, com filete próprio (`:30-32`, `overlays.css:164`).
- **Controles:** 1 ("Entendi", primário, foco inicial, `:31`). Sem × e sem fundo — correto para
  reconhecimento (`:23-25`).
- **Títulos/ícones:** 1 título **genérico** + 1 ícone de aviso — os dois dizem só "isto é um aviso";
  o conteúdo está inteiro na mensagem.
- **Camadas:** mensagem sobre painel 96 % → véu = 2; ícone sobre ladrilho `#d97c7210`
  (`overlays.css:162`) = 3.
- **Cores de destaque:** 2 para uma frase — perigo no ícone (`data-danger="true"` fixo, `:28`) e
  acento no "Entendi" (`Button.jsx:17`).
- **Largura:** 480 px (`overlays.css:159`, sem camada, vence o `max-w-sm` de `:19`).
- **Ação principal:** "Entendi", à direita, mas dentro do corpo.

### 4.2 Problemas

| # | Classe | Problema | Evidência |
|---|---|---|---|
| 4-P1 | S | Faixa de título que não informa ("Aviso") + faixa de corpo só para ícone e frase: 3 faixas para uma frase | `:10`, `:27-29` |
| 4-P2 | S | Ação dentro do corpo, fora do rodapé da base | `:30-32`, `overlays.css:164` |
| 4-P3 | S | **Novo (N9):** sem contexto de conversa; o estado do alerta não zera na troca (`ConversationView.jsx:371-383` não toca em `useAlert.jsx:8`), então "Não foi possível assumir este atendimento." pode aparecer com **outra** conversa na tela *(suspeita, família CLASSE-01)* | `:521` |
| 4-P4 | C | Ladrilho vermelho sob o ícone | `overlays.css:162` |
| 4-P5 | C | Dois filetes para separar três faixas | `overlays.css:4`, `:164` |

### 4.3 Proposta estrutural

- **2 regiões:** cabeçalho `[ícone de aviso 20 px, tinta de perigo — é erro, 5.2.2][título][descrição]`
  + rodapé `[Entendi]`. O corpo em grade deixa de existir.
- **Título diz o que falhou e com quem:** "Não foi possível assumir o atendimento de {nome ou
  telefone}" / "… enviar a sugestão da IA" / "… descartar a sugestão da IA". **Descrição = o porquê**
  (`descreverErro`), só quando for diferente do título (quando `descreverErro` devolve o próprio
  fallback, não repete).
- `useAlert().avisar(motivo, { title })` já aceita `title` (`useAlert.jsx:10-12`): muda só nos 3
  chamadores.
- Mantidos por razão registrada: modal, `role="alertdialog"`, sem ×, sem fechar no fundo, foco no
  "Entendi" (`AlertDialog.jsx:6-9`, `:23-25`).

### 4.4 Destinos

| Sai | Vai para | Tipo |
|---|---|---|
| Título genérico "Aviso" | Título com o que falhou e com quem; "aviso" continua dito pelo ícone e pelo `role="alertdialog"` | dado |
| Coluna de ícone 36×36 no corpo | Ícone 20 px na linha do título | nada |
| Linha de ação dentro do corpo | Rodapé da base (`DialogFooter`) | ação |
| Ladrilho vermelho e os dois filetes | Nada: separação por espaço (P1) | nada |

### 4.5 Ids do Apêndice A

Muda: **PRM-ALR-01** (título e estrutura). Relacionado: PRM-DLG-02 (slot de ícone sai do ladrilho).
Nenhum id de defeito existia; N9 é achado novo.

### 4.6 Riscos e testes

- Não há teste de `AlertDialog` na base (nenhum teste procura "Aviso" ou "Entendi"): criar — título
  informativo, descrição só quando difere, foco no "Entendi", ESC fecha, clique no fundo não fecha.
- Teste de troca de conversa com `claimConversation` rejeitando depois da troca: o alerta traz o
  nome de A.

---

## 5. Emojis (popover do compositor, `components/MessageInput.jsx:528-551`)

### 5.1 Estrutura hoje

- **2 regiões:** cabeçalho visível "Emojis" com filete (`:536`, `aria-hidden`, `overlays.css:199`) ·
  grade 8×7 de **56** botões (`:537-549`, lista em `:41-49`).
- **Papel:** `role="dialog"` não modal, nome "Emojis" (`:531-532`) — invariante 9, mantido.
- **Títulos:** 1 visível que repete o nome do gatilho (`:500`) e o `aria-label` (`:532`).
- **Âncora:** `bottom-full left-0` do **contêiner do campo inteiro** (`:476-479`, `:534`), não do
  gatilho — hoje "Emojis" é o 3º botão (`:483-511`); no 6.3 passa a ser o 1º.
- **Altura fixa** (~270 px: `p-2` + cabeçalho + 7 linhas de 28 px + vãos), acima de um campo que cresce
  até 45 % da janela (`:22`).
- **Camadas sob o emoji:** hover `white/10` (`:544`) → popover `#30383d` a 95 % + `backdrop-blur-xl`
  (`:534`, `index.css:185`) → linha do tempo = 2.
- **Cores de destaque:** 0. **Ação principal:** não há (escolha).
- **Comportamento:** escolher cola **no fim** do texto (`:344-347`), devolve o foco ao campo e deixa o
  popover aberto; ESC e clique fora no `document` (`:181-201`).

### 5.2 Problemas

| # | Classe | Problema | Evidência |
|---|---|---|---|
| 5-P1 | S | Cabeçalho visível que repete o gatilho e custa uma faixa | `:536` |
| 5-P2 | S | Âncora na borda do campo, não no gatilho | `:534` |
| 5-P3 | S | **Novo (N7):** altura fixa acima de um campo que cresce: a 683×384 com o campo no teto (173 px) o topo do popover fica ~90 px acima da janela e é cortado pela casca `h-dvh overflow-hidden` (`AppShell.jsx:64`) *(suspeita — conta no código; conferir no harness)* | `:22`, `:534` |
| 5-P4 | B | Insere no fim, não no cursor (MSG-EMO-03) | `:345` |
| 5-P5 | B | **Novo (N6):** escolher pelo teclado (Enter) leva o foco ao campo (`:346`); o Enter seguinte, dado para escolher outro emoji, **envia a mensagem** (`:380-384`) *(suspeita)* | `:346`, `:380-384` |
| 5-P6 | B | ESC dentro do modal de conversa fecha o modal (CVM-MOD-10) | `:189-196`; `dialogStack.js:42-50` |
| 5-P7 | B | Trocar de conversa pelo teclado não fecha o popover (MSG-CMP-23) | `:233-251` |

### 5.3 Proposta estrutural

- **Sem cabeçalho visível:** a grade começa no topo do popover; o nome continua no `aria-label` e na
  dica do gatilho.
- **Âncora no gatilho** (Popover base), borda esquerda alinhada ao botão, presa à janela.
- **Altura limitada ao espaço livre acima do gatilho**, com rolagem interna da grade (as setas já
  rolam o foco para a vista).
- Comportamento (B): inserir **na posição do cursor** (substituindo a seleção) e recolocar o cursor
  depois do emoji; **clique** devolve o foco ao campo (como hoje), **Enter/Espaço** mantêm o foco na
  grade (dá para escolher vários pelo teclado, e o Enter nunca cai no campo); clicar no campo **não**
  fecha o seletor (para posicionar o cursor e continuar escolhendo); ESC com `preventDefault` (base);
  fecha na troca de conversa.
- Busca (MSG-EMO-05): **não** — 56 itens cabem numa vista; fica AUSENTE com razão.

### 5.4 Destinos

| Sai | Vai para | Tipo |
|---|---|---|
| Cabeçalho visível "Emojis" | Nome acessível do diálogo (`:532`) e dica do gatilho (`:72`) | dado |

### 5.5 Ids do Apêndice A

Resolve: **MSG-EMO-03**, CVM-MOD-10 (parte do popover), MSG-CMP-23 (parte do popover). Muda:
MSG-EMO-01 (sem cabeçalho, âncora), MSG-EMO-02 (Enter não sai da grade), MSG-EMO-04 (ESC não
atravessa o modal). Mantém AUSENTE com razão: MSG-EMO-05.

### 5.6 Riscos e testes

- Campo controlado pelo React: a posição do cursor tem de ser restaurada **depois** do render
  (`useLayoutEffect`), senão ela pula para o fim; emoji com seletor de variação (`✌️`, `❤️`) tem 2+
  unidades UTF-16 — a conta usa `selectionStart` do próprio campo, que é UTF-16, e fica coerente.
- Testes: "ab", cursor em 1, escolher → "a😀b" com cursor depois do emoji; Enter no emoji não envia;
  ESC dentro de `ConversationModal` fecha só o popover; troca de conversa fecha.
- Harness: popover inteiro dentro da janela a 683×384 com o campo no teto.

---

## 6. Respostas rápidas (popover do compositor, `components/MessageInput.jsx:556-593`)

### 6.1 Estrutura hoje

- **2 regiões:** cabeçalho visível "Respostas rápidas" (`:564`, `aria-hidden`) · lista ou estado do
  `AsyncState` (`:565-591`).
- **Papel:** `role="menu"` com itens `menuitem` (`:559`, `:577`) — invariante 9, mantido.
- **Controles:** N itens; **nenhum** "Tentar de novo" (`onRetry` não chega: `ConversationView.jsx:269`
  descarta o `refresh` e `:942-951` não repassa `error`).
- **Item:** título + prévia de 1 linha (`:585-586`). O `text-[14.5px] px-3.5 py-2.5` do item (`:583`)
  perde para `overlays.css:202` (12 px, `9px 12px`) e a prévia é 11 px (`:203`) — **2 tamanhos abaixo
  do piso**. Separador `#ffffff08` entre itens (`:201`).
- **Tamanho:** 340 px (`overlays.css:200` vence o `w-72`) × até 288 px (`max-h-72`); com o cabeçalho,
  cabem **~4 itens** (estimativa pelo código: 288 − 12 de respiro − ~35 de cabeçalho, itens de ~56
  px); sem ele, ~5.
- **Âncora e altura:** as mesmas do seletor de emoji (5-P2, 5-P3).
- **Estados dentro do menu:** esqueleto com `role="status"` (`AsyncState.jsx:5`), erro com
  `role="alert"` (`:21`), vazio em `<p>` (`:31`) — todos **dentro de `role="menu"`**, e o menu fica
  sem nenhum `menuitem`: o foco inicial não acha item (`MessageInput.jsx:145`) e fica no gatilho.
- **Camadas:** hover `white/.06` → popover 95 % + blur → linha do tempo = 2. **Destaque:** 0.
- **Escolher substitui** o texto do campo (`:579`).

### 6.2 Problemas

| # | Classe | Problema | Evidência |
|---|---|---|---|
| 6-P1 | S | Cabeçalho visível que repete o gatilho: 1 item a menos na altura disponível | `:564` |
| 6-P2 | S | Âncora na borda do campo, não no gatilho | `:562` |
| 6-P3 | S | Altura fixa cortada a 683×384 com o campo no teto (~100 px acima da janela) (N7) *(suspeita)* | `:562`, `:22` |
| 6-P4 | C·tipo | Título 12 e prévia 11 (abaixo do piso) por CSS sem camada | `overlays.css:202-203` |
| 6-P5 | C | Filete entre itens | `overlays.css:201` |
| 6-P6 | B | Erro sem "Tentar de novo" e sem o motivo real (MSG-RR-03) | `:565-570`; `ConversationView.jsx:269` |
| 6-P7 | B | **Novo (N8):** estados dentro de `role="menu"` sem `menuitem` (ESC e setas sem alvo); o esqueleto soma um `role="status"` à tela, que já tem o de `ConversationView.jsx:691` (invariante 9: um só) | `:565-570`; `AsyncState.jsx:5,21` |
| 6-P8 | B | Lista não se atualiza enquanto a mesa está aberta (MSG-RR-06) | `hooks/useQuickReplies.js:7` |
| 6-P9 | B | Clicar no próprio campo não fecha o menu (MSG-RR-09) | `:477`, `:184` |
| 6-P10 | B | Escolher **apaga** o rascunho (MSG-RR-10) | `:579` |
| 6-P11 | B | Sem forma de achar pelo teclado além de rolar (MSG-RR-11) | `:161-170` |
| 6-P12 | B | ESC atravessa para o modal (CVM-MOD-10); não fecha na troca de conversa (MSG-CMP-23) | `:189-196`, `:233-251` |

### 6.3 Proposta estrutural

- **Sem cabeçalho visível**; nome no `aria-label` e na dica do gatilho. Ganha-se ~1 item na altura.
- **Âncora no gatilho** e **altura limitada ao espaço livre** (Popover base), largura 340 mantida.
- **Item:** título 14/500 (tinta) + prévia 13 (tinta-2), 1 linha com reticências; separação por
  hover/foco, sem filete.
- **Estados como linhas do próprio menu** (B): carregando = `menuitem` desabilitado "Carregando…" com
  `aria-busy` no menu (sem `role="status"`); vazio = `menuitem` desabilitado "Nenhuma resposta rápida
  cadastrada."; erro = `menuitem` desabilitado com o motivo (`error` repassado) + **`menuitem` "Tentar
  de novo"** (`refresh` repassado por `ConversationView`). O menu nunca fica sem item focável.
- Comportamento (B): **type-ahead** — digitar uma letra com o menu aberto leva ao próximo título que
  começa com ela (padrão de menu da WAI-ARIA, não muda o papel); clicar no campo fecha o menu; ESC com
  `preventDefault`; fecha na troca de conversa; **recarregar ao abrir** fica com a E4 (seção 8 do spec
  já lista "respostas rápidas pedidas ao abrir o menu") — a E2 só entrega a prop.
- **DECISÃO-4 (MSG-RR-10, substituir o rascunho):** (a) manter substituir — o teste
  `MessageInput.test.jsx` "selecting a quick reply fills the message field, replacing what was typed"
  trava isso hoje; (b) *recomendada:* campo vazio → preenche (o caso comum fica igual); campo com texto
  → insere **no cursor**, substituindo só a seleção; (c) substituir com "Desfazer" por alguns segundos.
- **DECISÃO-5 (MSG-RR-11, atalho "/" no campo):** exige combobox + listbox no campo, o que **troca o
  papel** `menu` protegido pelo invariante 9. Recomendo não fazer na E2; o type-ahead cobre o teclado.

### 6.4 Destinos

| Sai | Vai para | Tipo |
|---|---|---|
| Cabeçalho visível "Respostas rápidas" | Nome acessível do menu (`:560`) e dica do gatilho (`:72`) | dado |
| Filete entre itens | Nada: hover e foco separam | nada |
| Esqueleto/erro/vazio fora de `menuitem` | Linhas desabilitadas do próprio menu + "Tentar de novo" como item | dado + ação |

### 6.5 Ids do Apêndice A

Resolve: **MSG-RR-03, MSG-RR-09**, MSG-RR-11 (por type-ahead), MSG-RR-10 (se DECISÃO-4 b ou c),
CVM-MOD-10 e MSG-CMP-23 (parte do popover); MSG-RR-06 com a E4. Muda: MSG-RR-01 (sem cabeçalho),
MSG-RR-02 (o esqueleto sem padding vira linha do menu — some o defeito de encostar na borda), MSG-RR-05,
MSG-RR-07 (tipos), MSG-RR-12 (altura ligada ao espaço). Mantém: MSG-RR-04, MSG-RR-08.

### 6.6 Riscos e testes

- `MessageInput.test.jsx` "em carregamento não mostra 'Nenhuma resposta rápida cadastrada'" exige
  `getByRole('status')` — muda para `aria-busy` no menu.
- Type-ahead não pode roubar letras do campo: só vale com o foco **dentro** do menu.
- Testes novos: erro → "Tentar de novo" chama `refresh`; menu vazio recebe foco e ESC; clique no campo
  fecha; ESC dentro de `ConversationModal`; a regra escolhida na DECISÃO-4.

---

## 7. Decisões pendentes

| # | Assunto | Opções | Recomendação |
|---|---|---|---|
| DECISÃO-1 | × nos diálogos com `[Cancelar]` | (a) só sem Cancelar · (b) em todos | (a): já é a regra de Confirmação e Alerta; afeta os 22 usos de `WaDialog` |
| DECISÃO-2 | Onde se edita o cliente | (A) no painel Cliente, sem modal · (B) modal reestruturado | (A): P6, e a conversa fica visível enquanto se copia nome/cidade que o cliente escreveu |
| DECISÃO-3 | Visor: girar / galeria | incluir girar · incluir galeria | Girar sim; galeria fora da E2 |
| DECISÃO-4 | Resposta rápida sobre rascunho | substituir · preencher-ou-inserir no cursor · substituir com Desfazer | Preencher se vazio, inserir no cursor se não |
| DECISÃO-5 | Atalho "/" | combobox (troca o papel `menu`) · só type-ahead | Só type-ahead na E2 |
| DECISÃO-6 | Texto do 6.3 do spec: "Histórico, SGP, Cliente (alternância com `aria-expanded`)" | Histórico abre **diálogo** (`aria-haspopup="dialog"`, sem `aria-expanded`) · Histórico vira **painel** | Diálogo: o detalhe precisa de largura para bolhas (640 px contra 268 px do painel). Corrigir a frase do spec: `aria-expanded` em botão que abre modal é semântica errada |
| DECISÃO-7 | Paginar as mensagens do detalhe do histórico | E2 · E4 · não paginar | E4. **Correção de premissa:** a rota **já** aceita `limit`/`before` (`src/api/conversations.routes.js:244-256` em `e5236da`; `services/api.js:58-66`) — paginar o detalhe é só frontend. O que não tem parâmetro é a **lista** (`LIMIT 50` fixo) |

## 8. Achados novos (não estavam no Apêndice A)

| # | Item | Achado | Evidência | Conferência |
|---|---|---|---|---|
| N1 | Histórico | Foco cai no `<body>` ao "Voltar" e o Tab seguinte sai do diálogo | `ConversationHistoryModal.jsx:84-86`, `:100`; `Dialog.jsx:288`, `:301` | suspeita, deduzida do código |
| N2 | Histórico | "Finalizado"/"Status" é constante | `conversation.repository.js:796` (`e5236da`) | fato |
| N3 | Histórico | Lista cortada em 50 sem aviso no subtítulo | `conversation.repository.js:798`; `ConversationHistoryModal.jsx:93` | suspeita |
| N4 | Histórico | Paginação do detalhe não exige backend (DECISÃO-7) | `conversations.routes.js:244-256` | fato |
| N5 | Editar cliente | Texto "clique aqui para ver os dados" abre edição | `ConversationView.jsx:595`, `:574` | fato |
| N6 | Emojis | Enter no emoji leva o foco ao campo; o Enter seguinte envia | `MessageInput.jsx:346`, `:380-384` | suspeita |
| N7 | Emojis e Respostas | Popover de altura fixa cortado acima da janela a 683×384 com o campo no teto | `MessageInput.jsx:22`, `:534`, `:562`; `AppShell.jsx:64` | suspeita (conta) |
| N8 | Respostas | Estados dentro de `role="menu"` sem `menuitem`; 2º `role="status"` na tela | `MessageInput.jsx:559-570`; `AsyncState.jsx:5`; `ConversationView.jsx:691` | fato (código) |
| N9 | Alerta | Alerta sem contexto e não zerado na troca de conversa | `ConversationView.jsx:371-383`, `:521`; `useAlert.jsx:8` | suspeita |
| N10 | Visor | Barra e ✕ cobrem a imagem | `MessageAttachment.jsx:434`, `:440`, `:470` | fato (código) |

## 9. Tabela-resumo

Contagem conforme as convenções do topo (pele herdada contada só na base; B fora da conta S×C).

| Item | S | C | B (à parte) | Decisões | S domina? |
|---|---|---|---|---|---|
| 0. Base comum | 1 (ícone 34→20 na linha do título) | 8 (véu, painel, sombra, raio, tom do ícone, tipo, pele de popover, pele de campo) | 2 (`busy`, ESC de popover) | DECISÃO-1 | **não** — a base é pele por definição; por isso o grupo só passa se os itens trouxerem estrutura |
| 1. Atendimentos anteriores | 7 (rodapé sai; bloco de data sai; data repetida sai; "Finalizado"/"Status" saem; migalha → cabeçalho; resumo sai; bolha da conversa no detalhe) | 5 (cartão → linha; papel de parede; glifo; tipo; cor do voltar) | 7 | DECISÃO-6, 7 | sim |
| 2. Editar cliente — opção (B) modal | 6 (grade; 672→480; telefone na descrição; ajuda da nota; × sai; `@container`) | 0 | 7 | DECISÃO-2 | sim |
| 2. Editar cliente — opção (A) painel | 6 (modal sai; edição no painel; "Editar" no painel; cabeçalho → painel; 1 coluna; ajuda da nota) | 0 | 7 | DECISÃO-2 | sim |
| 3. Visualizador de imagem | 5 (+1 se girar) (barra única; palco reservado; contexto; legenda; Ajustar condicional) | 4 (fundo; barra; glifos; ✕ com borda) | 4 | DECISÃO-3 | sim |
| 4. Alerta | 3 (3 faixas → 2; ação vai ao rodapé; contexto no título) | 2 (ladrilho; filetes) | 0 | — | sim |
| 5. Emojis | 3 (cabeçalho sai; âncora no gatilho; altura pelo espaço) | 0 | 4 | — | sim |
| 6. Respostas rápidas | 3 (cabeçalho sai; âncora no gatilho; altura pelo espaço) | 2 (tipo; filete) | 7 | DECISÃO-4, 5 | sim |
| **Total do grupo** (com a opção B no item 2) | **28** | **21** | **31** | 7 | **sim (28 × 21)** |

Leitura honesta da tabela: sem a base, os itens somam **27 S × 13 C**. A base soma 8 C e só 1 S —
é a troca de pele que o 6.6 pede, e ela precisa dos itens para a etapa não virar "só pintar". Se o
proprietário escolher (b) na DECISÃO-1, sai 1 S (item 2: o × fica no Editar cliente; no Histórico o
que sai é o "Fechar" do rodapé, e ele sai de qualquer jeito) e o total fica **27 × 21** — ainda S.
Com a opção (A) no item 2 a conta não muda (6 S nas duas). O "+1 se girar" do item 3 levaria a
**29 × 21**. Os 31 B são defeitos de comportamento que a E2 resolve **na tela** (C.4.2,
C.4.3, C.4.4 e CLASSE-01); não entram na conta, mas são a parte que o atendente mais sente.
