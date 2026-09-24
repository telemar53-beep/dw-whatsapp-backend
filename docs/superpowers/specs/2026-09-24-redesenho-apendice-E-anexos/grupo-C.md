> **Anexo do Apêndice E** — relatório de auditoria (subagente, somente leitura, base `e5236da`), **conferido por amostra** antes de entrar no spec (Apêndice E.0). É material de detalhe para o plano da E2: onde este anexo e o Apêndice E divergirem, **vale o Apêndice E** (a base única e as decisões de E.3/E.4 resolvem os conflitos entre os grupos). A correção de ATD-INI-24/29 que este anexo pede já foi aplicada ao Apêndice A.

# Apêndice E — Grupo C: overlays da moldura e da equipe

> Auditoria somente leitura. **Código lido:** cópia de `e5236da` em
> `scratchpad/estados/base-e5236da/frontend/src` (todas as referências `arquivo:linha` abaixo são
> relativas a essa pasta). **Régua:** spec `2026-09-24-redesenho-simplicidade-design.md` §5 (P1–P9),
> §6.1, §6.2, §6.6 e §9; formato de destino do Apêndice B; ids do Apêndice A.
>
> Convenções: **S** = estrutural (posição, tamanho, quantidade, existência); **C** = cosmético (cor,
> superfície, raio, sombra). Tipografia (tamanho de letra) foi contada como **C** para não inflar S.
> Mudança que depende de uma regra da base e aparece em mais de um item é **contada uma vez só**, na
> base (§0), e citada no item como "via B-S*n*". **DECISÃO** = precisa do proprietário (lista
> consolidada no §8). "(suspeita)" = mecanismo conferido no código, efeito ainda não medido em
> navegador (jsdom não calcula layout nem cascata — armadilhas 1 e 7 do spec).
>
> Nenhuma proposta toca backend, rota, payload ou regra de negócio. Onde o backend foi lido, foi só
> para saber o que ele já entrega.

---

## 0. Base comum — `ui/Dialog.jsx`, `WaDialog.jsx`, `overlays.css`, `ui/dialogStack.js`

### 0.1 Estrutura hoje

| Aspecto | Hoje | Onde |
|---|---|---|
| Véu | `rgba(13,20,24,.68)` + `backdrop-blur` 6 px no nível 0 | `ui/Dialog.jsx:283-285`, `index.css:120-121` |
| Painel | `bg-wa-panel` = `rgba(45,54,60,.96)` translúcido + `backdrop-blur` 28 px | `ui/Dialog.jsx:302`, `index.css:119,131` |
| Raio do painel | **três valores** declarados: 22 px no JSX (`--wa-dialog-radius`), 18 px em `overlays.css:2` (vence, fora de `@layer`), 14 px no modal de conversa (`overlays.css:227`) | idem |
| Sombra | três sombras + brilho interno em `overlays.css:2`, sobrepondo a do JSX (`ui/Dialog.jsx:302`) | |
| Cabeçalho | slot de ícone **tonal** (laranja, vermelho, azul, verde, roxo) + h2 18 px + descrição | `ui/Dialog.jsx:316-333`, `overlays.css:4-10,17-18` |
| Botão "×" | **absoluto** no canto (`right:12px; top:12px`); só reserva espaço se houver `.dw-dialog-heading` | `overlays.css:14-16`, `ui/Dialog.jsx:304-315` |
| Rodapé | detectado por **heurística de seletor**: `form > div:last-child:has(> button)` e `.dw-dialog > div:last-child:has(> button)`, além da classe `.dw-dialog-footer` | `overlays.css:26-27,33-36` |
| Regras por descendente | `.dw-dialog button {font-size:12px}`, `.dw-dialog label {12px}`, `.dw-dialog :is(input,select,textarea) {13px; raio 7; padding 7/10}`, `.dw-dialog textarea {resize:vertical}` — valem para **tudo** que estiver dentro do diálogo | `overlays.css:19-22` |
| ESC | um ouvinte da pilha no `document` (`dialogStack.js:42-60`) + **quatro ouvintes próprios** de ESC fora da pilha no alcance deste grupo: painel da conversa (`ConversationView.jsx:330-340`), popovers do compositor (`MessageInput.jsx:181-201`), gaveta do menu (`SideNav.jsx:91-93`), menu da conta (`SideNav.jsx:103-107`). (Há mais três fora do grupo — `ui/DataTable.jsx:88`, `settings/channels/ChannelsTable.jsx:135`, `SupervisionPage.jsx:78` — que herdam a regra na etapa de cada área.) | |

### 0.2 Problemas

- **S** — ESC sem ordem entre modal e não-modal. O ouvinte da pilha é registrado quando o modal abre
  e roda **antes** dos ouvintes que vêm depois (painel, popover); ele fecha o modal
  (`dialogStack.js:44-49`) e o `stopPropagation` não impede os outros ouvintes do mesmo `document`.
  O painel ainda desiste de propósito quando existe qualquer `[data-dialog]`
  (`ConversationView.jsx:334`) — inclusive o próprio modal que o contém. Resultado: CVM-MOD-10 (o
  "ESC que fecha duas camadas" da §4 do spec).
- **S** — "×" absoluto sobre o conteúdo quando o diálogo não tem título: no modal de conversa não há
  `.dw-dialog-heading`, então nada reserva o canto e o botão fica sobre o cabeçalho da conversa
  (abaixo de 768 px) ou sobre o painel de informações (≥ 768 px) — (suspeita; medir no harness).
- **S** — Regras por descendente vazam para conteúdo embutido: dentro do `ConversationModal` a
  conversa inteira herda botões de 12 px e o compositor herda 13 px, raio 7, padding 7/10 e **alça de
  redimensionar** (`resize:vertical`), contra `resize-none rounded-[24px] px-[18px] py-[13px]
  text-[15px]` do `MessageInput.jsx:522` (utilitário em `@layer`, perde) — (suspeita pelo mecanismo;
  provar por estilo computado).
- **S** — Rodapé por heurística de `:has()`: qualquer último `div` com botão vira "rodapé" (é assim
  que o rodapé do `ProfileModal.jsx:199` ganha borda e padding), e o mesmo diálogo acaba com botões de
  duas geometrias (ver §3).
- **S** — Largura trocada por estado em dois diálogos do grupo (§2 e §3): o diálogo "pula" quando o
  dado chega.
- **C** — véu com blur; painel translúcido com blur; três raios; sombra tripla; ícone tonal (decisão
  revogada em 24/09, spec §14); título 18 px.

### 0.3 Proposta estrutural

- **B-S1 (S) Camada leve na pilha.** `dialogStack` ganha entradas **não modais** (`modal:false`) para
  painel lateral, popover do compositor, menu da conta e gaveta do menu: participam **só da ordem do
  ESC** (o topo da pilha inteira fecha primeiro), não recebem `inert`, não travam o fundo, não
  prendem o Tab. O `topo` que decide o `inert` (`ui/Dialog.jsx:288`) e o foco devolvido
  (`ui/Dialog.jsx:226`) passa a olhar **só as entradas modais**. Os quatro ouvintes próprios de ESC
  saem; fica um só (o da pilha).
- **B-S2 (S) "×" no fluxo do cabeçalho**, nunca absoluto. Diálogo sem título (conversa) recebe a vaga
  de quem desenha o cabeçalho (ver EN-S13).
- **B-S3 (S) Diálogo de consulta não tem rodapé** — fecha por "×", ESC e clique fora. Rodapé só existe
  quando há ação: `[Cancelar][ação principal]` (§6.6). **DECISÃO D10** (é regra de base, vale para
  todos os diálogos de leitura).
- **B-S4 (S) CSS da base só nos encaixes do diálogo**: cabeçalho, `DialogBody`, `DialogFooter`
  explícito e uma classe opt-in para formulário. Saem as regras por descendente de
  `overlays.css:19-22` e a detecção de rodapé de `overlays.css:26-27`. Os diálogos de Configurações
  que dependem delas (`overlays.css:152-157,234`) passam a usar a classe opt-in — **sem mudar o
  visual deles nesta etapa** (a reestruturação deles é da E6).
- **B-S5 (S) Uma largura por diálogo em todos os estados** (carregando, erro, vazio, pronto).
- B-C1 véu sólido `--color-veu`, sem blur · B-C2 painel `--color-elevado` sólido, raio 16, uma sombra
  `--ui-sombra-dialogo` · B-C3 ícone de cabeçalho neutro · B-C4 título Sora 16.

### 0.4 Ids

PRM-DLG-01 (mantido; `inert` passa a contar só camadas modais), PRM-DLG-02 (muda: sem tom; "×" no
fluxo), PRM-DLG-03 (mantido), PRM-WAE-01 (sucesso ganha ícone de confirmação em tinta neutra, sem
verde), **CVM-MOD-10 (resolve)**.

### 0.5 Riscos e testes

- **B-S1 é a mudança mais sensível do grupo**: toca a pilha de todos os diálogos. Teste novo: painel
  aberto dentro de um modal → ESC fecha o painel e o modal continua; segundo ESC fecha o modal; o
  modal **não** fica `inert` enquanto o painel está no topo; foco volta ao gatilho do painel. Todos os
  testes atuais da pilha continuam verdes. Tab real no navegador (invariante §9).
- B-S4: rodar os 22 usos de `WaDialog` no harness (prints antes/depois) — o risco é um diálogo de
  Configurações perder espaçamento; por isso a classe opt-in e não a remoção seca.
- Invariantes §9 conferidos: foco inicial, trap, ESC por pilha, foco devolvido, clique fora à prova
  de arrasto, `inert` embaixo, popover não vira modal (a camada leve não prende Tab nem aplica
  `inert`).

---

## 1. Nossa equipe — `TeamPanel.jsx` (barra) + `TeamModal.jsx` (popup)

### 1.1 Estrutura hoje

**Barra (rodapé da lista), `TeamPanel.jsx:49-69`**
- 1 controle (a barra inteira), 4 elementos: ícone 20 px (`:57-59`), "Equipe" 15 px (`:60`), pílula
  "{n} online" com borda, fundo `white/0.05` e texto **verde** `chat-online` (`:61-65`), chevron girado
  180° apontando para cima (`:66-68`).
- Altura ≈ 50 px (`py-3.5` + ícone de 20 px, `:55`) contra 44 px da §6.2.
- A pílula **some** com 0 (`:61`) — a linha muda de composição.
- Camadas sob "5 online": coluna da lista → (hover `white/0.05`) → pílula = 2 (3 no hover).
- Abre o popup por um `createPortal` próprio para um `div.chat-theme` (`:70-76`), mas o `Dialog` já
  faz portal para o `body` com `chat-theme` (`ui/Dialog.jsx:281-283`): o `div` do `TeamPanel` fica
  **vazio** no `body`.
- Recarrega a lista de atendentes a cada `conversation:assigned/closed`, `queue:removed`,
  `dashboard:conversation` (`:20,34-39`) — nota de desempenho para a E4, não mexida aqui.

**Popup, `TeamModal.jsx`**
- **4 regiões**: cabeçalho (título, descrição, ícone tonal **verde** `tone="ok"`, `:111-114`), barra
  de ferramentas (busca + 4 fichas de filtro, `:118-168`), corpo com até 3 grupos em caixa
  (`:170-194`, `overlays.css:132-133`), rodapé com nota + "Fechar" (`:196-207`); mais o "×" da base.
- **Títulos:** 1 h2 + 3 h3 de grupo, cada h3 com ponto colorido, pílula de contagem e **frase-resumo**
  (`:62-69`; frases em `:177,182,187`).
- **Controles:** "×", busca, 4 fichas, "Fechar" = **7**. Dois botões de fechar para um diálogo sem
  ação.
- **Linha de pessoa** (`:31-53`): avatar 34 + ponto de presença (só `title`, `:34-37`) + nome + linha
  "Online · Em atendimento" / "Online · Disponível para atender" / "Última: …" (`:44`) + ficha "N
  ativos" (`:48-53`) = 5–6 elementos.
- **Repetição medida:**
  - a mesma partição aparece **duas vezes**: fichas Todos/Online/Offline/Em atendimento
    (`:12-17,133-166`) e grupos Em atendimento/Disponíveis/Offline (`:176-190`). "Em atendimento" e
    "Offline" são literalmente a mesma coisa nas duas; "Online" = dois grupos;
  - cada contagem aparece 2–3×: subtítulo "{k} online agora" (`:112`), ficha "Online {n}" (`:161`),
    pílula do grupo (`:66`), barra "N online" (`TeamPanel.jsx:63`);
  - "está ocupado" é dito **4×** por pessoa: grupo, texto "Online · Em atendimento", ficha laranja "N
    ativos", ponto âmbar do grupo;
  - a nota do rodapé ("A carga vem dos atendimentos ativos de cada um.", `:197`) existe só para
    explicar a ficha.
- **Cores de destaque:** verde (`chat-online` na presença, no grupo Disponíveis e na ficha de livre;
  `#5fb89b` no ícone tonal, `overlays.css:9`), âmbar `#f5a524` literal (`:16,59`), laranja
  `chat-orange` (ficha ativa `:144`, bolha de contagem `:158`, ficha "ativos" `:50` com `#ff9a6e`) =
  **3 famílias** + borda literal `#30383d` (`:36`).
- **Camadas sob texto:** contagem da ficha ativa = painel → botão `chat-orange/15` → bolha
  `chat-orange` = **3**; busca = painel → `white/0.05` = 2.
- **Ação principal:** não há (diálogo de consulta). O rodapé tem só "Fechar" com estilo de secundário.

### 1.2 Problemas

| # | Classe | Problema | Evidência |
|---|---|---|---|
| 1 | S | Duas partições do mesmo conjunto (fichas + grupos) | `TeamModal.jsx:133-166` × `:176-190` |
| 2 | S | Contagens repetidas 2–3× na mesma tela | `:66,112,161`; `TeamPanel.jsx:63` |
| 3 | S | "Ocupado" dito 4× por pessoa; ficha só existe para repetir o grupo | `:44,48-53,59,177` |
| 4 | S | Frase-resumo repete o título de cada grupo | `:68,177,182,187` |
| 5 | S | Rodapé sem ação: "Fechar" duplica o "×"; a nota só explica a ficha | `:196-207`, `ui/Dialog.jsx:304-315` |
| 6 | S | Carregando ou erro: subtítulo e fichas afirmam "0 integrantes · 0 online" (ATD-EQM-01/07) | `:81-86,112,161` |
| 7 | S | Erro sem "Tentar de novo" (o `refresh` existe e não é passado) | `:171`; `TeamPanel.jsx:28` |
| 8 | S | Busca com `min-w-[220px]` quebra acima das fichas em diálogo estreito (ATD-EQM-23) | `:120` |
| 9 | S | Mesma frase para busca e filtro vazios, sem ação de saída (ATD-EQM-09) | `:173` |
| 10 | S | Barra: chevron para cima promete expansão; a barra abre um diálogo central (o próprio comentário diz "nada se expande aqui", `TeamPanel.jsx:22-23`) | `TeamPanel.jsx:66-68` |
| 11 | S | Barra: 50 px contra 44; contagem some com 0 e a linha pula | `TeamPanel.jsx:55,61` |
| 12 | S | Barra: carregando e erro invisíveis (ATD-EQP-03/04) | `TeamPanel.jsx:50-69` |
| 13 | S | Portal redundante cria um `div` vazio no `body` | `TeamPanel.jsx:70-76` |
| 14 | S | O popup cobre a conversa com véu para uma consulta de leitura (P6) | `TeamModal.jsx:107-116` |
| 15 | S | Dica "Última atividade: …" repete o que a linha já mostra (ATD-EQM-19) | `:41` |
| 16 | C | Presença por cor (verde × cinza), ambos cheios; P8 pede cheio × vazado, sem verde | `:34-37`; `TeamPanel.jsx:62` |
| 17 | C | Ícone de cabeçalho verde (tom revogado) | `:113-114`; `overlays.css:9` |
| 18 | C | Âmbar e laranja literais nos grupos, fichas e contagens | `:16,50,59,144,158` |
| 19 | C | Grupos em caixa com borda e raio 12; camadas `white/[0.04..0.12]` | `overlays.css:132-133`; `:66,145,157` |

### 1.3 Proposta estrutural

**Barra (44 px):** `[ícone] Equipe · ● 5 online`, ponto **cheio** em tinta-2 + texto, sem pílula, sem
chevron. A contagem tem **vaga fixa**: enquanto carrega, a vaga fica vazia do mesmo tamanho; com erro,
mostra "não carregou" em tinta-3. Clicar abre a vista da equipe. O portal próprio sai.

**Vista "Nossa equipe" — DECISÃO D1:**
- **A (recomendada): painel na coluna da lista.** A coluna de 332 px troca o conteúdo por
  `← Nossa equipe`; "←" e ESC (camada leve, B-S1) voltam para a lista e devolvem o foco à barra. Não
  é modal: a conversa à direita continua visível e utilizável — o atendente consulta quem está livre
  **olhando** a conversa que pensa transferir. Mesmo princípio do WhatsApp com perfil/contatos (sem
  copiar layout). A barra só existe fora do trilho (ATD da barra), então nada muda no modo trilho.
- **B: continua diálogo**, com a mesma reestruturação interna abaixo e sem rodapé (B-S3).

**Conteúdo (vale para A e B):**
1. Linha de contexto sob o título: "12 integrantes · 5 online" — **só com dado pronto**.
2. Busca de largura total ("Buscar integrante").
3. **Sem fichas de filtro** (DECISÃO D2). Três seções, na ordem Em atendimento → Disponíveis →
   Offline, cabeçalho de uma linha "Em atendimento 3" (rótulo 13 px + número tabular), separadas por
   linha; seção vazia **sempre** some.
4. Linha da pessoa (2 linhas, avatar 32): ponto de presença **cheio (online) × vazado (offline)** com
   "online"/"offline" no nome acessível · linha 1 nome · linha 2 **uma** frase: "2 atendimentos
   ativos" / "Disponível" / "Visto por último {quando}" (+ " · 1 atendimento ativo" se offline com
   ativos, o caso que hoje a ficha laranja sinaliza em `:50`).
5. Estados: carregando = 4 linhas-esqueleto com a forma da linha (círculo + duas barras); erro =
   frase + "Tentar de novo" (`refresh`); busca sem resultado = "Nada encontrado para “termo”" +
   "Limpar busca".
6. Sem rodapé; em B fecha por "×", ESC, clique fora (hoje `closeOnBackdrop` já é `true`, `:110`).

**Destinos (formato do Apêndice B)**

| Sai | Vai para | Tipo |
|---|---|---|
| 4 fichas de filtro com contagem | As três seções (são as mesmas partições), com a contagem no cabeçalho de cada uma; "Online" = Em atendimento + Disponíveis; a busca continua | dado |
| Frase-resumo de cada grupo | Nada: repetia o título do grupo | nada |
| Ficha colorida "N ativos" | Linha 2 da pessoa, em texto ("2 atendimentos ativos"), e o nome acessível | dado |
| "Online · Em atendimento" / "Online · Disponível para atender" | Seção + ponto de presença + linha 2 | dado |
| `title` "Última atividade: …" | Linha 2 "Visto por último …" (já estava visível) | nada |
| Nota do rodapé "A carga vem dos atendimentos ativos de cada um." | A linha 2 diz a carga com a própria unidade ("atendimentos ativos") | dado |
| Botão "Fechar" | "←" e ESC (A) / "×", ESC e clique fora (B) | ação |
| Ícone tonal verde | Nenhum ícone (A) / ícone neutro (B) | nada |
| Chevron da barra | Nada: a barra abre uma vista, não expande | nada |
| Pílula verde "N online" | "● N online" em texto na mesma barra | dado |
| Portal do `TeamPanel` | O portal do próprio `Dialog` (B) / nenhum (A) | nada |

### 1.4 Ids do Apêndice A

ATD-EQP-01 (muda: texto com ponto), ATD-EQP-02 (muda: vaga fixa), **ATD-EQP-03 e -04 (resolve)**,
ATD-EQP-05 (em A o `aria-expanded` passa a descrever de fato uma vista que se abre no lugar), -06
(mantido), -07 (hover por token). **ATD-EQM-01 (resolve)**, -02 (esqueleto com a forma da linha),
-03 (recarga silenciosa **fica**, por decisão: o dado já é atualizado por evento a cada atribuição, e
um "Atualizando…" piscaria o tempo todo — `AgentsContext` não precisa expor `reloading`), **-04
(resolve)**, -05 e -06 (mantidos), **-07 (sai)**, -08 (placeholder novo), **-09 (resolve)**, -10 e
-11 (saem com as fichas), -12 (vira regra única), -13/-14/-15 (sem frase-resumo), -16/-17/-18 (linha 2
nova), **-19 (sai)**, -20 (presença por forma + texto acessível), **-21 (sai)**, -22 (muda), **-23
(resolve)**.

### 1.5 Riscos e testes

- `TeamPanel.test.jsx` muda em três casos: "os filtros mostram a contagem…" (`:159`), "Fechar e o X"
  (`:181`), "online dot / offline dot" (`:196`). Casos novos: contagens ausentes com `status`
  carregando/erro; "Tentar de novo" chama `refresh`; barra sem chevron; em A, "←"/ESC devolvem o foco
  à barra e a conversa continua operável (Tab alcança o compositor com a vista aberta).
- **Não regredir o ganho do AgentsContext (20 → 8)**: a vista usa o mesmo `useAgents`; nenhum
  pedido novo.
- A: a vista ocupa a coluna — conferir no harness a 1366×768 e a 683×384 que nada sobrepõe a
  conversa (invariante "painel nunca cobre as mensagens") e que a ordem de sacrifício do
  `useWorkspaceLayout` não muda (a vista vive dentro da coluna, com a largura dela).
- Contraste do ponto vazado (≥ 3:1 de elemento gráfico sobre `--color-painel`).

---

## 2. Encerrados do atendente + conversa em modal + painel de informações

`ClosedConversationsModal.jsx`, `ClosedConversationsList.jsx`, `ConversationModal.jsx`,
`ConversationInfoPanel.jsx` (e a variante "padrão" de `ConversationListItem.jsx`, usada só aqui).

### 2.1 Estrutura hoje

**Popup "Encerrados"**
- Aberto pelo item "Encerrados" do menu (`SideNav.jsx:138`), que **importa o modal de forma estática**
  (`SideNav.jsx:8,172`) — é esse import que põe o `ConversationView` (131 KB) no trecho da casca de
  toda rota (spec §4, §7b).
- **Três larguras declaradas:** `max-w-[1500px]` no JSX (`ClosedConversationsModal.jsx:13`), 1100 px
  (`overlays.css:96`, vence) e 520 px enquanto não há lista (`overlays.css:97`) — o diálogo salta de
  520 para 1100 quando a primeira página chega (CVM-ENC-14).
- Cabeçalho: "Encerrados" + contagem "{n}" ou "{n}+" cujo sentido só aparece no `title`
  (`ClosedConversationsModal.jsx:13`). Sem rodapé.
- Corpo: **grade de 1 a 4 colunas** de cartões (`ClosedConversationsList.jsx:13`) + "Carregar mais" de
  largura total (`:24-33`).
- **Cartão** (variante padrão, `ConversationListItem.jsx:199-294`): avatar 52 + nome 16 + hora
  (`formatMessageTime` = só **HH:mm da última mensagem**, `:38-41,222-226`) + tiques + prévia 14 +
  fichas local / **dono** / setor (`:236-251`) + linha "Triagem IA · motivo" com subfichas
  "confiança baixa" (âmbar) e "resolvido pela IA" (`wa-chip`, **verde**) (`:267-276`) = **7 a 10
  elementos em 2–3 linhas**. A ficha do dono é **sempre o próprio atendente** (a lista é
  `/mine/closed`).
- **Camadas sob o texto de uma ficha: 4** — painel (translúcido com blur) → `li` `white/0.08`
  (`ClosedConversationsList.jsx:13`) → `div` hover/selecionado `white/0.04–0.08`
  (`ConversationListItem.jsx:208`) → ficha `white/0.05` (`:238`). É o máximo do grupo.
- Clicar num cartão abre o `ConversationModal` **por cima** (`ClosedConversationsModal.jsx:26-32`):
  dois véus, e a seleção do cartão (CVM-ENC-08) só existe atrás do segundo modal; fechar a conversa
  desfaz a seleção (`:29`). Ler 5 atendimentos = 10 cliques (abre/fecha).
- Ação principal: nenhuma.

**Modal de conversa (`ConversationModal.jsx`) — usado aqui e na Supervisão (`SupervisionPage.jsx:693`)**
- Diálogo em linha: `[ConversationView][ConversationInfoPanel 272 px]` (`ConversationModal.jsx:27-30`),
  sem título (`ariaLabel`), "×" absoluto da base (`:20-21`).
- Controles de fechar: "×" + seta "Voltar para a lista" abaixo de 768 px
  (`ConversationView.jsx:566-572`, `md:hidden` fora da mesa) — **dois** para a mesma ação.
- Cabeçalho da conversa no modal: grupo Histórico/SGP em caixa própria (`ConversationView.jsx:616-630`)
  — **não existe botão "Cliente"** fora da mesa (o comentário em `:624-627` registra isso).
- O SGP abre sozinho quando há CPF (`ConversationView.jsx:375`) e, com o painel de informações fixo,
  a conversa fica com 3 colunas: a 1024 px de janela, 992 − 272 = 720 ≥ 268 + 420, então o SGP entra
  **ao lado** e a conversa fica com ~452 px.

**Painel de informações (`ConversationInfoPanel.jsx`)**
- Coluna fixa de 272 px, escondida abaixo de 768 px (`:70`, CVM-MOD-03).
- Conteúdo: avatar (88 no JSX, **44 com `!important`** em `overlays.css:182` — JSX e CSS dizem coisas
  diferentes, e o anel `ring-4 ring-accent/25` do `:72` é anulado por `box-shadow:none` em
  `overlays.css:181`), nome (h2), telefone **cru** (`:82-84`), ficha de estado (`:85`), caixa "Nota
  interna" (`:88-95`), divisória, linhas Cidade/Setor/[select]/Atendente/Protocolo/Encerrado em
  (`:99-123`), divisória, bloco "Triagem por IA" com 4 linhas + `<pre>` (`:125-137`).
- **Repetição com o cabeçalho da mesma tela:** nome, telefone, estado, protocolo, cidade, setor e
  avatar aparecem **duas vezes** (cabeçalho `ConversationView.jsx:578-610` × painel `:73-121`).
- **Mesmo estado, dois nomes e duas cores na mesma tela:** o cabeçalho diz "Em atendimento" com ponto
  verde (`ConversationView.jsx:150`); o painel diz "**Em andamento**" em `wa-link` laranja
  (`ConversationInfoPanel.jsx:25-27`) — violação direta de P5.
- É o **único** lugar do produto que troca o setor (`setConversationSector` só é chamado em
  `ConversationInfoPanel.jsx:60`), com `catch(() => {})` e sem desfazer.
- Camadas sob a nota interna: painel → `aside` `white/0.04` → caixa `white/0.12` = 3.

### 2.2 Problemas

| # | Classe | Problema | Evidência |
|---|---|---|---|
| 1 | S | Menu com um item que abre modal no meio de destinos (P4; §6.1 põe "Encerrados" entre os destinos) | `SideNav.jsx:138,172` |
| 2 | S | Modal empilhado sobre modal para ler um atendimento; seleção invisível; abrir/fechar por item | `ClosedConversationsModal.jsx:26-32` |
| 3 | S | Grade de cartões para uma lista cronológica: a ordem de leitura em 4 colunas é ambígua; 3 linhas por item contra as 2 da P3 | `ClosedConversationsList.jsx:13` |
| 4 | S | **Sem data**: só HH:mm da última mensagem numa lista que atravessa dias | `ConversationListItem.jsx:38-41,222-226` |
| 5 | S | Ficha com o nome do próprio atendente em todo cartão (o mesmo defeito do "chip do próprio nome" da §4 do spec) | `ConversationListItem.jsx:242-246` |
| 6 | S | Três larguras declaradas; salto 520 → 1100 (CVM-ENC-14) | `ClosedConversationsModal.jsx:13`; `overlays.css:96-97` |
| 7 | S | "Carregar mais" que falha volta calado (CVM-ENC-11) | `hooks/useMyClosedConversations.js:40-42` |
| 8 | S | Erro da 1ª carga sem "Tentar de novo" (o hook tem `refresh`) | `ClosedConversationsList.jsx:11` |
| 9 | S | Sentido do "+" só no `title` (CVM-ENC-03) | `ClosedConversationsModal.jsx:13` |
| 10 | S | Import estático do modal traz o `ConversationView` para a casca | `SideNav.jsx:8` |
| 11 | S | Conversa encerrada sem nenhum aviso no rodapé: o rodapé só existe com `isMine` | `ConversationView.jsx:883` |
| 12 | S | Dois controles de fechar no modal (< 768 px), um deles sobreposto ao cabeçalho | `ConversationView.jsx:566-572`; `overlays.css:14` |
| 13 | S | Painel de informações fixo de 272 px duplica 7 dados do cabeçalho e some abaixo de 768 px (CVM-MOD-03) | `ConversationInfoPanel.jsx:70-121` |
| 14 | S | O painel "Cliente" da mesa não existe no modal; o modal tem um painel paralelo com outra lista de campos | `ConversationView.jsx:616-630,1009-1013` |
| 15 | S | Troca de setor sem salvando, erro mudo, `select` fica com o valor não salvo, linha "Setor" fica velha (CVM-INF-08/09/10) | `ConversationInfoPanel.jsx:57-61,101` |
| 16 | S | ESC com SGP/popover aberto fecha a conversa inteira (CVM-MOD-10) | ver §0.2 |
| 17 | S | Composer do modal herda 13 px, raio 7 e alça de redimensionar | ver §0.2 |
| 18 | C | 4 camadas translúcidas no cartão; raios 18/16 | `ClosedConversationsList.jsx:13,29`; `ConversationListItem.jsx:207` |
| 19 | C | "resolvido pela IA" em verde; "Em andamento" em laranja | `ConversationListItem.jsx:274`; `ConversationInfoPanel.jsx:26` |

### 2.3 Proposta estrutural

**Encerrados — DECISÃO D3**
- **A (recomendada): "Encerrados" vira vista da coluna da lista** (o princípio de "Arquivadas" do
  WhatsApp, sem copiar o desenho). O item do menu é um **destino** (com `aria-current` quando ativo):
  leva à mesa com a coluna em `← Encerrados`, lista de uma coluna no formato de item da mesa, e a
  conversa encerrada abre **na área da conversa**, somente leitura, com os mesmos botões de
  cabeçalho (Histórico, SGP, Cliente). Sem diálogo, sem modal empilhado. De Relatórios (a outra rota
  do atendente), o clique navega para a mesa.
  Efeito colateral bom: o `SideNav` deixa de importar o modal, e o ganho da §7(b) do spec (casca de
  164,6 KB → ~25,7 KB) acontece **por estrutura**, sem `lazy` no menu.
- **B: um diálogo só, mestre-detalhe**, largura fixa: lista de 332 px à esquerda, conversa à
  direita; abaixo de 1020 px, lista → detalhe no mesmo envelope com "← Encerrados" (o padrão que o
  Histórico já usa, `overlays.css:103-107`). Sem segundo modal.
- **C (mínimo):** mantém o modal e o empilhamento; troca a grade por lista de uma coluna e fixa a
  largura.

**Em qualquer opção:**
- Item de 2 linhas (P3): linha 1 nome + **data de encerramento** à direita ("14:32" se hoje, "ontem",
  "12/09") — o dado `closedAt` já chega (é o que o painel usa em `ConversationInfoPanel.jsx:51-53`);
  linha 2 prévia. Localidade, setor e triagem vão para o nome acessível e para o painel Cliente; a
  ficha do dono sai.
- A variante "padrão" do `ConversationListItem` (`:199-294`) deixa de ter uso e sai (ATD-ITP-07 já
  registra o fio morto dela).
- Rodapé de conversa encerrada: uma linha "Atendimento encerrado em {data} · somente leitura" no lugar
  do compositor (hoje o espaço fica vazio, `ConversationView.jsx:883`).
- "Carregar mais" no fim da lista; falha → frase + "Tentar de novo" (sem apagar o que já está na
  tela). Erro da 1ª carga → "Tentar de novo" (`refresh`). A contagem "{n}+" sai: "Carregar mais" já diz
  que há mais.
- Dependência registrada: o SGP abre sozinho em conversa com CPF (`ConversationView.jsx:375`) e, numa
  conversa **encerrada** do próprio atendente, envia cobrança ao cliente (CV-SGP-33, Apêndice C.3).
  Em A e B a conversa encerrada fica mais à mão — ver DECISÃO D11.

**Modal de conversa (Supervisão; e Encerrados se a escolha for C)**
- "×" sai do canto e vira o **último botão do cabeçalho da conversa** ("Fechar conversa", depois da
  divisória); o `Dialog` roda com `dismissible={false}`; a seta "Voltar para a lista" não aparece no
  modal. Um controle de fechar, no fluxo, sem sobreposição.
- **O `ConversationInfoPanel` sai.** O modal usa o painel **Cliente** da própria conversa (o mesmo da
  mesa, §6.4), aberto pelo botão "Cliente" do cabeçalho — coluna ou substituição pela regra
  homologada, e **disponível também abaixo de 768 px** (resolve CVM-MOD-03). A conversa ganha 272 px.
- O painel Cliente recebe o que só o painel de informações tinha: estado no vocabulário único (P5),
  telefone formatado, canal, "Encerrado em", **"Alterar setor"** na linha Setor (mesma regra
  `canEditSector`, `ConversationInfoPanel.jsx:55`), e na triagem: setor da IA, identificação,
  confiança em % (hoje o painel da mesa só diz "Confiança baixa", `ConversationView.jsx:239`), resumo
  **só se existir** (sem `<pre>` vazio) e "Não definido" com a mesma caixa.
- Troca de setor: `select` desabilitado com "Carregando setores…" enquanto chegam (CVM-INF-07);
  "Salvando…"; falha → volta ao valor anterior + `WaError`; sucesso → a linha "Setor" mostra o nome
  novo na hora (CVM-INF-10).
- ESC: via B-S1. Vazamento de CSS no compositor: via B-S4.

**Destinos (formato do Apêndice B)**

| Sai | Vai para | Tipo |
|---|---|---|
| Popup "Encerrados" (diálogo) | A: vista `← Encerrados` na coluna da lista, aberta pelo mesmo item do menu / B: diálogo único mestre-detalhe | ação |
| Modal de conversa empilhado (Encerrados) | A: área da conversa da mesa / B: coluna direita do mesmo diálogo | dado + ação |
| Grade de cartões | Lista de uma coluna, item de 2 linhas | dado |
| Hora HH:mm sem data | Data de encerramento na linha 1 | dado |
| Ficha do dono (o próprio atendente) | Nada na lista (é sempre ele); segue no painel Cliente ("Atendente") | dado |
| Fichas de localidade e setor, linha "Triagem IA" | Nome acessível do item · painel Cliente · linha 2 do cabeçalho da conversa (§6.3) | dado |
| Contagem "{n}"/"{n}+" com sentido no `title` | "Carregar mais" no fim da lista | dado |
| Coluna fixa "painel de informações" (272 px) | Painel **Cliente** da própria conversa, pelo botão "Cliente" do cabeçalho | dado |
| `select` "Alterar setor" | Linha "Setor" do painel Cliente, com a mesma regra de quem pode | ação |
| "Setor da IA", "Identificação", "Confiança {n}%" | Seção "Triagem por IA" do painel Cliente | dado |
| "Encerrado em" | Seção "Atendimento" do painel Cliente **e** o rodapé "Atendimento encerrado em …" | dado |
| "×" flutuante do modal | Último botão do cabeçalho da conversa, "Fechar conversa" | ação |
| Seta "Voltar para a lista" no modal | O mesmo "Fechar conversa" | ação |
| Variante "padrão" do `ConversationListItem` | Nada: o único uso era o popup | nada |

### 2.4 Ids do Apêndice A

CVM-ENC-01 (muda: vista/diálogo único), **-02 e -03 (saem)**, -04 (esqueleto com a forma do item),
**-05 (resolve)**, -06 e -07 (mantidos), **-08 (resolve: seleção visível)**, -09/-10 (mantidos),
**-11 (resolve)**, **-12 (sai: grade)**, **-13 (sai em A/B)**, **-14 (resolve)**. ATD-ITP-02 a -07
(saem com a variante; -03 e -05 migram para o item da mesa). CVM-MOD-01 (muda: fechar no cabeçalho),
-02 (mantido: não fecha pelo fundo), **-03 (resolve)**, -05 (mantido), **-07 (resolve o vazamento de
CSS no compositor)**, -09 (mantido), **-10 (resolve, via B-S1)**. CVM-INF-01 (**resolve**: vocabulário
único), **-02 (resolve)**, -03 a -05 (migram), -06 (**DECISÃO D5**), **-07, -08, -09, -10
(resolvem)**, -11 a -13 (migram), **-14 (resolve)**. Vizinhos: CV-SGP-33 (D11), CV-ROD-03 (o caso
"encerrada" ganha o aviso aqui; o caso "conversa de outro atendente" é do grupo da conversa).

### 2.5 Riscos e testes

- **A mexe na `DashboardPage`**: a conversa selecionada hoje sai de `queue + myConversations +
  pending` (`DashboardPage.jsx:115-117`); A precisa de uma terceira origem (encerrada selecionada)
  sem quebrar `conversaOcupaTudo` (`:125`, invariante `conversationOpen`) nem o memo da lista.
  Coordenar com o grupo da lista (§6.2). Enquanto a coluna mostra Encerrados, as abas somem da vista:
  o som e a região viva da fila (`:218-220`) continuam; conferir que o atendente não fica "preso" sem
  ver a fila (o "←" é o primeiro controle).
- A muda o plano da E3 (§7b): o `lazy` no `SideNav` deixa de ser necessário. **Medir** a casca no
  harness antes/depois.
- Remover o `ConversationInfoPanel` afeta a **Supervisão** (E5): o supervisor passa a abrir o painel
  com um clique (DECISÃO D4). Os 11 casos de `ConversationInfoPanel.test.jsx` migram para testes do
  painel Cliente (setor para dono/admin/gerente, escondido para os outros, mapa de identificação).
- `ClosedConversationsModal.test.jsx:96` ("a conversa abre numa camada acima") deixa de valer em A/B;
  `:52` (somente leitura, sem compositor nem ações) **tem de continuar valendo** na nova vista.
  `ConversationModal.test.jsx:32` e `:45` mudam (fechar no cabeçalho; sem seta no modal).
- Harness: modal a 683×384 e < 768 px sem sobreposição do fechar; estilo computado do compositor no
  modal (15 px, raio do token, sem `resize`).

---

## 3. Meu perfil — `ProfileModal.jsx`

### 3.1 Estrutura hoje

- **Duas larguras:** `max-w-md` carregando/erro (`:114`) e `max-w-4xl` (896 px) pronto (`:128`) — para
  3 campos.
- **Regiões (pronto):** cartão de identidade (`:130-147`: avatar 68, nome, "E-mail · {email}",
  "Alterar foto", "Remover foto" em vermelho) · erro da foto (`:148`) · seção "Dados pessoais" com h3
  + frase (`:151-153`) e formulário em **3 colunas** (Nome, Telefone, E-mail somente leitura,
  `:154-167`) · `<details>` "Trocar senha" com frase, glifo "⌄" e **formulário próprio com submit
  próprio** (`:172-196`) · rodapé `[Cancelar][Salvar alterações]` (`:199-202`).
- **Títulos:** h2 "Meu perfil" + h3 "Dados pessoais" + `summary` "Trocar senha" = 3, mais 2 frases de
  apoio (`:153,174`).
- **Controles:** "×", Alterar foto, Remover foto, Nome, Telefone, `summary`, Senha atual, Nova,
  Confirmar, "Trocar senha" (submit), Cancelar, Salvar = **12**. **Duas ações de envio** na mesma
  vista (`:193` e `:201`), e a do rodapé **não** salva a senha: quem preenche a senha e clica
  "Salvar alterações" não troca a senha e nada avisa.
- **Repetição:** e-mail 2× (`:134` e `:163-166`); nome 2× (`:133` e o campo `:157`); "Trocar senha" 2×
  (`:174` e `:193`).
- **Camadas sob o texto da senha:** painel → `details` `wa-panel-header` (`white/0.07`) → campo
  `wa-panel-header` (`white/0.07`, `WaDialog.jsx:10`) = **3**, branco translúcido sobre branco
  translúcido (P1). "Alterar foto": painel → cartão → rótulo `bg-wa-panel` = 3.
- **Cores:** acento no "Salvar" (certo: uma por vista) + **perigo fora de confirmação** no "Remover
  foto" (`:142`).
- **Geometria de botão dupla:** o rodapé pega raio 7 / padding 7-13 pela heurística de
  `overlays.css:26-27`; o "Trocar senha" dentro do `details` fica com raio 12 / `px-6` do
  `waGhostButtonClass` (`WaDialog.jsx:17-18`).

### 3.2 Problemas

| # | Classe | Problema | Evidência |
|---|---|---|---|
| 1 | S | Largura salta md → 4xl ao carregar (PRF-01) | `:114`, `:128` |
| 2 | S | Carregando é só texto; erro sem "Tentar de novo" (PRF-01/02) | `:115-121` |
| 3 | S | Duas ações de envio numa vista; "Salvar alterações" ignora a senha preenchida | `:177,193,201` |
| 4 | S | E-mail duas vezes; nome duas vezes | `:133-134`, `:157`, `:163-166` |
| 5 | S | Título "Dados pessoais" + frase dentro de um diálogo que já se chama "Meu perfil" | `:152-153` |
| 6 | S | 3 colunas para 3 campos num diálogo de 896 px | `:154`, `:177` |
| 7 | S | Envio de foto invisível: `disabled` no input `sr-only` (PRF-04) | `:137-140` |
| 8 | S | Botões não mudam de rótulo ao salvar (PRF-07/13) | `:193`, `:201` |
| 9 | S | Sucesso nunca some (PRF-09) | `:169`, `:191` |
| 10 | S | Fechar com edição perde tudo sem perguntar (PRF-17) | `:200`; `onClose` do diálogo |
| 11 | S | Nome só com espaços passa pelo `required` nativo e volta com o nome técnico do campo (PRF-06/08) | `:157`; `utils/errorMessages.js:133` |
| 12 | S | **Senha atual errada desloga** (PRF-12): o backend responde 401 e `apiFetch` chama o logout em todo 401 | `services/api.js:34-35` |
| 13 | S | E-mail travado sem dizer por quê (PRF-16) | `:163-166` |
| 14 | C | "Remover foto" em vermelho sem ser confirmação destrutiva (§5.2.2) | `:142` |
| 15 | C | Superfícies translúcidas empilhadas (cartão, `details`, campos, caixa do e-mail, rodapé) | `:130,165,172,199`; `WaDialog.jsx:10` |
| 16 | C | Duas geometrias de botão no mesmo diálogo | `WaDialog.jsx:15-18`; `overlays.css:27` |

### 3.3 Proposta estrutural

Um diálogo de **largura única (~520 px), uma coluna**, com **duas vistas no mesmo envelope** — cada
uma com uma ação principal:

- **Vista "Meu perfil"**
  - Linha do avatar: foto 64 + "Alterar foto" e "Remover foto" como botões secundários neutros ao
    lado (remoção imediata, como hoje — é reversível). Enviando: o avatar mostra progresso e o botão
    diz "Enviando foto…".
  - Campos empilhados: Nome, Telefone. Nome validado pelo `Field` (aparado; "Informe o nome.").
  - Linha "E-mail  ana@… — é o seu acesso; não muda por aqui." (uma vez só).
  - Linha "Senha  ›  Trocar senha" que abre a segunda vista.
  - Rodapé `[Cancelar][Salvar]`; "Salvando…" enquanto salva; "Perfil salvo." com ícone de
    confirmação em tinta neutra, que some na próxima edição.
- **Vista "Trocar senha"** (troca de conteúdo, não de moldura): "← Meu perfil" no topo; Senha atual,
  Nova, Confirmar empilhadas; "As senhas não coincidem" **no campo Confirmar**; senha atual errada →
  "A senha atual está incorreta." **no campo Senha atual**, sem deslogar; rodapé
  `[Voltar][Trocar senha]` ("Trocando…"); sucesso volta à vista principal com "Senha alterada." no
  mesmo lugar do status.
- **Carregando:** o mesmo envelope com esqueleto na forma da vista (círculo + dois campos). **Erro:**
  frase + "Tentar de novo" + rodapé `[Fechar]`.
- **Fechar com edição** (Cancelar, "×", ESC) com nome/telefone alterados ou algum campo de senha
  preenchido → confirmação "Descartar alterações?" `[Continuar editando][Descartar]` (perigo só no
  "Descartar", que é a ação destrutiva no momento da confirmação).
- PRF-12 exige que a troca de senha não passe pelo logout do 401 — só frontend (ex.: opção no
  `apiFetch` para esta rota; a tradução "Current password is incorrect" já existe em
  `utils/errorMessages.js:17`). **DECISÃO D6** sobre quando entra.

**Destinos (formato do Apêndice B)**

| Sai | Vai para | Tipo |
|---|---|---|
| Cartão de identidade (moldura com fundo) | Linha do avatar, sem moldura | nada |
| Nome em destaque no cartão | Campo "Nome" (mesmo valor) e o cabeçalho do menu da conta (§4) | dado |
| "E-mail · x" no cartão + caixa "E-mail" no formulário | Uma linha "E-mail", somente leitura, com o porquê | dado |
| Título "Dados pessoais" + "Informações exibidas no seu perfil de atendimento." | Nada: o diálogo inteiro é "Meu perfil" | nada |
| `<details>` "Trocar senha" + "Atualize sua senha de acesso." + glifo "⌄" | Linha "Senha › Trocar senha", que abre a vista de senha no mesmo envelope | ação |
| Botão "Trocar senha" dentro do bloco | Ação principal do rodapé da vista de senha | ação |
| Grade de 3 colunas | Uma coluna | nada |
| Vermelho do "Remover foto" | Botão secundário neutro | ação |

### 3.4 Ids do Apêndice A

**PRF-01, -02 (resolvem)**, -03 (mantido), **-04 (resolve)**, -05 (mantido, na linha do avatar),
**-06 (resolve)**, **-07 (resolve)**, **-08 (resolve pelo aparo antes de enviar)**, **-09 (resolve)**,
-10 (muda: vira linha + vista), **-11 (muda de lugar: no campo)**, **-12 (resolve — D6)**, **-13
(resolve)**, -14 (mantido), -15 (muda: uma coluna), **-16 (resolve)**, **-17 (resolve)**. CAS-SHL-08
(mantido: o menu da conta continua abrindo o perfil).

### 3.5 Riscos e testes

- `ProfileModal.test.jsx:71` ("troca a senha pela seção embutida") passa a navegar para a vista de
  senha; `:108` ganha "Tentar de novo". Casos novos: largura igual carregando/pronto; confirmação ao
  fechar com edição (e **sem** confirmação quando nada mudou); senha atual errada mostra erro no
  campo e **não chama o logout** (mock de 401 na rota de senha); rótulos "Salvando…"/"Trocando…".
- PRF-12: a exceção do 401 tem de ser **só** desta rota; um 401 de sessão expirada em qualquer outra
  continua deslogando. Teste dos dois lados.
- A confirmação "Descartar alterações?" é um diálogo empilhado: pilha, foco devolvido e ESC (fecha só
  a confirmação) conferidos.
- `WaError`/`WaSuccess` continuam sendo o canal da mensagem (invariante §9).

---

## 4. Menu da conta — `SideNav.jsx:155-169` + `side-nav.css:7`

### 4.1 Estrutura hoje

- **Gatilho** (`SideNav.jsx:165-168`): avatar 30 + (no modo expandido) nome + "Minha conta" + chevron
  **para baixo** — e o menu abre **para cima** (`side-nav.css:7`, `bottom: calc(100% + 6px)`). No
  trilho de 64 px sobra só o avatar; o nome existe apenas no `aria-label`/`title`.
- **Menu** (`:161-164`): `ul` com 2 botões, "Meu perfil" e "Sair", sem cabeçalho e sem separação entre
  navegar e encerrar a sessão. "Sair" desloga sem confirmação (CAS-NAV-13).
- Superfície própria: `--color-ui-surface-overlay`, borda `#ffffff21`, raio 8, sombra `#0005`
  (`side-nav.css:7`); hover `#ffffff09`.
- ESC e clique fora por ouvintes próprios (`SideNav.jsx:103-107`); foco no primeiro item ao abrir
  (`:101-102`).
- `aria-controls="worknav-account-actions"` aponta para um id que não existe com o menu fechado
  (`:161` só monta aberto; `:165` aponta sempre) — nota de acessibilidade, sem classe S/C.
- Controles: 1 gatilho + 2 itens. Cores de destaque: nenhuma. Camadas sob o texto do item: 1 (2 no
  hover).

### 4.2 Problemas

| # | Classe | Problema | Evidência |
|---|---|---|---|
| 1 | S | Com o trilho único da §6.1, **quem está logado deixa de aparecer em qualquer lugar visível** (o nome só existia no modo expandido, que sai pela B.1) | `SideNav.jsx:167`; Apêndice B.1 |
| 2 | S | "Meu perfil" e "Sair" sem separação | `:162-163` |
| 3 | S | Chevron para baixo num menu que abre para cima; nome + "Minha conta" + chevron só no modo que sai | `:167`; `side-nav.css:7` |
| 4 | C | Superfície, borda, raio 8 e sombra próprios, fora da escala | `side-nav.css:7` |
| 5 | C | Hover por literal `#ffffff09`, sem pressionado | `side-nav.css:7` |

### 4.3 Proposta estrutural

- Gatilho: **só o avatar** (32 px) na base do trilho, com a dica flutuante "Conta: {nome}" e o mesmo
  nome acessível de hoje.
- Menu (popover S2): **cabeçalho não interativo** com nome (Inter 14/600) e papel em tinta-2
  ("Atendente", "Gerente", "Administrador" — os rótulos já existem em `AgentsAdminTab.jsx:13`; movê-los
  para um módulo comum para não puxar uma aba de Configurações para a casca) · "Meu perfil" ·
  **divisória** · "Sair".
- ESC e clique fora pela camada leve (via B-S1); foco no primeiro item e devolvido ao avatar
  (comportamento de hoje, mantido); `aria-controls` só com o menu aberto.
- **DECISÃO D7:** "Sair" continua sem confirmação (recomendado: é reversível — basta entrar de novo)
  × confirmar sempre × confirmar só quando houver envio em curso.

**Destinos (formato do Apêndice B)**

| Sai | Vai para | Tipo |
|---|---|---|
| Nome e "Minha conta" no gatilho (modo expandido) | Cabeçalho do menu da conta (nome + papel) e dica/nome acessível do avatar | dado |
| Chevron do gatilho | Nada: aponta para o lado errado e o modo que o tinha sai | nada |

### 4.4 Ids do Apêndice A

CAS-NAV-13 (muda: cabeçalho + divisória; **D7**), CAS-NAV-14 (muda: "Atendente" como nome de reserva
no cabeçalho; "Minha conta" sai), CAS-NAV-01 (o modo expandido sai — já coberto pela B.1),
CAS-SHL-08 (mantido).

### 4.5 Riscos e testes

- `SideNav.test.jsx`: menu com cabeçalho (nome e papel), divisória, ESC devolve o foco ao avatar,
  clique fora fecha. Harness: o popover aberto do trilho de 64 px não é cortado pela borda nem pela
  coluna da lista (ele passa por cima da lista, que é o esperado de um popover).
- Nome longo no cabeçalho: truncar com o nome inteiro no `title`.

---

## 5. Aviso de transferência — `TransferNotice.jsx` + `hooks/useTransferNotice.js`

### 5.1 Estrutura hoje

- **Posição:** `fixed bottom-5`, centralizado na **janela** (`TransferNotice.jsx:24`), largura até
  416 px, com `pointer-events-auto` no cartão (`:26`). A 1366 px ele ocupa x ≈ 475–891 e a conversa
  começa em ≈ 420 (casca `md:p-3` 12 + trilho 64 + `gap-3` 12 + lista 332, `AppShell.jsx:92`): o
  aviso fica **sobre o compositor** por 9 s e bloqueia o clique no campo por baixo (o comentário de
  `AppShell.jsx:65-71` registra que o rodapé central é dele) — (suspeita de sobreposição; confirmar no
  harness).
- **Fundo:** `bg-chat-panel` — **o token não existe** (nenhum `--color-chat-panel` no CSS): o cartão é
  transparente e o texto fica sobre o que estiver embaixo (bolhas, compositor). `overlays.css:205`
  sobrescreve o raio (10) e acrescenta filete cobre de 3 px.
- **Elementos:** ícone cobre (`:27-29`) + botão com 2 linhas — "**Fulano** transferiu o atendimento de
  **Cliente** para você." + "Clique para abrir" (`:30-41`) + "×" (`:42-49`). 2 controles.
- **Tempo:** some em 9 s sem pausa por ponteiro ou foco (`:7,12-16`), levando a ação junto
  (ATD-AVT-02).
- **Quantidade:** um aviso por vez; o segundo **substitui** o primeiro (`useTransferNotice.js:21`,
  ATD-AVT-05).
- **Transferência sem nome:** descartada (`useTransferNotice.js:20`). O backend distingue os casos
  pela **presença da chave**: a transferência sempre manda `transferredBy` (objeto ou `null`,
  `src/api/conversations.routes.js:518-521`); o "assumir" não manda a chave (`:225`) — ATD-AVT-07.
- **Anúncio:** `role="status"` montado **junto** com o texto (`:18-23`) — mesma suspeita de anúncio
  perdido de CAS-SHL-01 — e é mais um `role="status"` na mesa (a conversa já tem o seu,
  `ConversationView.jsx:691`).
- **Montagem:** só na mesa (`DashboardPage.jsx:57,326`): transferência recebida em Relatórios não
  toca nem avisa.
- Cores: 1 família (cobre). Camadas próprias sob o texto: **0** (fundo inexistente).

### 5.2 Problemas

| # | Classe | Problema | Evidência |
|---|---|---|---|
| 1 | S | Flutua sobre o compositor e bloqueia o clique por baixo (P6) | `TransferNotice.jsx:24-26` |
| 2 | S | Some em 9 s sem pausa, com a ação junto | `:7,12-16` |
| 3 | S | Segunda transferência apaga a primeira | `useTransferNotice.js:21` |
| 4 | S | Transferência com `transferredBy: null` não avisa | `useTransferNotice.js:20` |
| 5 | S | Linha "Clique para abrir" repete o que o botão já é | `:40` |
| 6 | S | `role="status"` montado com o texto; segundo `role="status"` na mesa | `:18-23`; `ConversationView.jsx:691` |
| 7 | C | Sem fundo (token inexistente) | `:26` |
| 8 | C | Cobre no ícone e no filete | `:27`; `overlays.css:205` |

### 5.3 Proposta estrutural — DECISÃO D8

- **A (recomendada): a chegada vira marca na lista, sem aviso flutuante.** Ao receber a
  transferência: a conversa entra em "Atendimento" com a **marca de não lida** (ponto do acento, a
  mesma do §6.2) e a linha 2 começa por "Transferido por {nome}" (ou "Transferido para você" quando
  `transferredBy` for `null`) até ser aberta; a aba "Atendimento" mostra a marca quando outra aba
  está ativa; o som continua; o texto completo ("{Fulano} transferiu o atendimento de {Cliente} para
  você.") vai para a **região viva única da casca** (§7). Sem prazo, sem perda: cada transferência
  marca a sua conversa. Coordenar com o grupo da lista (a marca na aba é mudança da §6.2).
- **B:** aviso **fixo** (sem prazo) no topo da **coluna da lista**, nunca sobre a conversa: uma linha
  "Fulano transferiu Cliente para você · Abrir · ×", empilhando como "Fulano e mais 2 transferiram
  atendimentos · Ver"; superfície S2 real.
- Em A e B: o gatilho passa a ser "a chave `transferredBy` existe" (não "tem nome"); o prazo de 9 s e
  a linha "Clique para abrir" saem. Sub-decisão de D8: montar o ouvinte na casca (avisa também fora
  da mesa) × manter na mesa.

**Destinos (formato do Apêndice B) — opção A**

| Sai | Vai para | Tipo |
|---|---|---|
| Aviso flutuante no rodapé central | Item da conversa em "Atendimento": marca de não lida + "Transferido por {nome}" na linha 2 até abrir; marca na aba "Atendimento" | dado + ação |
| "Clique para abrir" | O próprio item (clicar abre) | ação |
| "×" "Fechar aviso" | Abrir a conversa limpa a marca (a marca é o estado "ainda não vista", não precisa ser dispensada) | ação |
| `role="status"` do aviso | Região viva única da casca, com a mesma frase | dado |
| Ícone e filete cobre | Nada | nada |

### 5.4 Ids do Apêndice A

ATD-AVT-01 (muda), **-02 (resolve)**, -03 (muda: o item abre), -04 (sai em A / mantido em B), **-05
(resolve)**, -06 (mantido: assumir sozinho não avisa), **-07 (resolve)**.

### 5.5 Riscos e testes

- A: **atenção** — sem o aviso na cara, a percepção depende da marca na aba e do som (com o som
  mudo, só da marca). No celular com a conversa ocupando a tela, a marca só aparece ao voltar para a
  lista — hoje o aviso aparecia por cima. Registrar como risco aceito ou escolher B.
- `TransferNotice.test.jsx` (`:58`, `:68` — prazo) sai; `useTransferNotice.test.jsx:139` ("substitui o
  anterior") inverte para "acumula"; `:96` ("ignora o assumir") **fica** (chave ausente). Casos novos:
  `transferredBy: null` avisa com a frase genérica; abrir limpa a marca; a região viva recebe a frase.
- A marca de transferência não pode quebrar o `memo` do item (a prop nova tem de ser estável).

---

## 6. Faixa de status do canal — `ChannelStatusBanner.jsx`

### 6.1 Estrutura hoje

- Faixa de largura total **acima das colunas da mesa** (`DashboardPage.jsx:151-153`), escondida abaixo
  de `lg` quando há conversa selecionada; só para quem tem nível de integrações
  (`ChannelStatusBanner.jsx:10-13`).
- **Uma linha por canal com problema, sem teto** (`:24-41`), cada uma com ícone de aviso **no laranja
  do acento** (`:32`), frase "Canal **{nome}** está {desconectado | aguardando leitura do QR code}" e
  **o mesmo link** "ver em Configurações › Canais" (`:37-39`) → N controles para um só destino, que
  é a lista e não o canal — embora a rota `canais/:id` exista (`App.jsx:164`, abas
  `…/conexao` e `…/atendimento`).
- Sem `role` nem região viva (CAS-BAN-01); falha em `listChannels` = faixa some (CAS-BAN-05);
  buscada uma vez na montagem, sem nenhuma atualização (`hooks/useChannels.js`; o backend não emite
  evento de status de canal) — CAS-BAN-06.
- Cores: acento usado como aviso (P2). Camadas: 1 (`bg-chat-canvas`).

### 6.2 Problemas

| # | Classe | Problema | Evidência |
|---|---|---|---|
| 1 | S | N linhas sem teto; N links iguais | `:24-41` |
| 2 | S | Link para a lista, não para o canal; rótulo é um caminho, não uma ação | `:37-39`; `App.jsx:164` |
| 3 | S | Aviso mudo para leitor de tela | `:23` |
| 4 | S | Erro silencioso parece "tudo conectado" | `:11,20` |
| 5 | S | Não se atualiza no turno | `hooks/useChannels.js` |
| 6 | C | Ícone e hover no laranja do acento | `:32,37` |
| 7 | C | `font-wa` (Segoe UI) — sai pela §5.4 | `:23` |

### 6.3 Proposta estrutural

- **Uma linha no total**, na primitiva "faixa de aviso" (CX-S6): um canal → "⚠ Canal **Loja**
  desconectado · **Conectar**" (ou "aguardando leitura do QR code · **Ler QR code**"), link para
  `/configuracoes/canais/{id}/conexao`; dois ou mais → "⚠ 2 canais sem conexão: Loja, Suporte · **Ver
  canais**", link para `/configuracoes/canais`. Texto que não cabe trunca, com a frase inteira no nome
  acessível.
- Contêiner com `aria-live="polite"` **sempre montado** (sem `role="status"`, para não disputar com o
  da conversa — §9).
- Falha ao buscar → "Não foi possível conferir os canais · Tentar de novo".
- Rebusca quando o socket volta de `reconnecting` e quando a aba volta a ficar visível. Rebusca
  periódica = **DECISÃO D9** (custo de rede por admin conectado; P7).
- A regra de esconder abaixo de `lg` com conversa aberta **fica** (não é regressão; mexer seria
  decisão de produto).

**Destinos (formato do Apêndice B)**

| Sai | Vai para | Tipo |
|---|---|---|
| Uma linha por canal | Uma linha que nomeia todos os canais afetados (nome acessível com a lista inteira) | dado |
| N links "ver em Configurações › Canais" | Um link com verbo: "Conectar"/"Ler QR code" (aba Conexão do canal) ou "Ver canais" | ação |

### 6.4 Ids do Apêndice A

**CAS-BAN-01 (resolve)**, CAS-BAN-02 (**resolve** o destino do link; a suspeita "status desconhecido
vira desconectado" fica como está — o texto não inventa um estado que o backend não dá), **CAS-BAN-03
(resolve)**, CAS-BAN-04 (mantido), **CAS-BAN-05 (resolve)**, **CAS-BAN-06 (resolve em parte**:
reconexão e visibilidade; o resto depende de D9).

### 6.5 Riscos e testes

- `ChannelStatusBanner.test.jsx:51` (link para a lista) muda: com um canal, o link vai para a aba de
  conexão dele. Casos novos: dois canais = uma linha; erro com "Tentar de novo"; rebusca na
  reconexão. Os casos de permissão (`:24,96,107`) e de canal oficial (`:72`) continuam.
- Uma linha a mais não pode empurrar a mesa abaixo dos limiares homologados (683×384): medir no
  harness.

---

## 7. Avisos de conexão / reconexão do socket — `AppShell.jsx` + `SideNav.jsx`

### 7.1 Estrutura hoje

- **Dois indicadores para o mesmo evento:**
  1. faixa flutuante no **canto inferior direito** (`AppShell.jsx:72-89`, `bottom-24 right-5`, sobre a
     conversa, perto do botão de enviar): "Reconectando… as mensagens novas podem demorar a aparecer."
     (âmbar) ou "Conexão restabelecida." (**verde**, `chat-online`), com blur e sombra, **3 s** nos
     dois casos (`:29-38`);
  2. indicador persistente na base do menu (`SideNav.jsx:145-151`): "⚠ Reconectando…", com dica
     própria em CSS que só aparece por hover/foco no modo recolhido (`side-nav.css:28-33`).
- **Três `role="status"`** podem coexistir na mesa durante a queda: a faixa (`AppShell.jsx:74`), o
  indicador do menu (`SideNav.jsx:146`, ainda com `tabIndex=0`) e o da conversa
  (`ConversationView.jsx:691`). Os dois primeiros são montados **junto** com o texto (suspeita de
  anúncio perdido, CAS-SHL-01/02). O spec exige um `role="status"` por tela (§9, armadilha 8).
- **No celular** (< 768 px) o menu some (`side-nav.css:9`): passados 3 s a faixa sai e **não resta
  sinal nenhum** de que a conexão continua caída.
- Cores: âmbar (literais `#f2a93c14`, `#f0b65f` em `side-nav.css:28`) + verde = 2 famílias.

### 7.2 Problemas

| # | Classe | Problema | Evidência |
|---|---|---|---|
| 1 | S | Dois indicadores para um estado; a faixa cobre a conversa | `AppShell.jsx:72-89`; `SideNav.jsx:145-151` |
| 2 | S | No celular, nenhum sinal persistente da queda | `AppShell.jsx:31`; `side-nav.css:9` |
| 3 | S | Até três `role="status"` simultâneos; montados junto com o texto | `AppShell.jsx:74`; `SideNav.jsx:146`; `ConversationView.jsx:691` |
| 4 | S | "Conexão restabelecida" é um segundo elemento, noutro lugar, para o fim do mesmo estado | `AppShell.jsx:82-86` |
| 5 | S | Dica do indicador por mecanismo próprio (CSS) que o toque não revela (CAS-NAV-11), diferente da `DicaFlutuante` do resto do trilho | `side-nav.css:31-33` |
| 6 | C | Verde de "sucesso" e âmbar literal | `AppShell.jsx:83-84`; `side-nav.css:28` |

### 7.3 Proposta estrutural

- **Um indicador só**, dono do estado:
  - desktop: na base do trilho (§6.1), persistente enquanto `reconnecting`; ao voltar, o **mesmo**
    indicador troca para "Conectado" com ícone de confirmação em tinta neutra por 3 s e some;
  - celular: o mesmo componente vira **faixa de 1 linha no topo do conteúdo**, persistente enquanto
    reconecta (texto inteiro visível — o toque não precisa revelar nada), e "Conectado" por 3 s.
- **Uma região viva** (`aria-live="polite"`, sem `role="status"`, sempre montada) na casca recebe
  "Reconectando… as mensagens novas podem demorar a aparecer." e "Conexão restabelecida." — o mesmo
  canal que recebe o aviso de transferência (§5, opção A).
- A faixa flutuante sai. O indicador do trilho perde `role="status"`; continua focável, com a dica
  pela `DicaFlutuante` (a mesma dos outros itens do trilho) e o nome acessível completo.
- **Primitiva "faixa de aviso"** (ícone de aviso + texto + ação opcional, 1 linha, `--color-aviso`):
  a mesma para a conexão no celular e para a faixa do canal (§6) — uma forma, dois usos.

**Destinos (formato do Apêndice B)**

| Sai | Vai para | Tipo |
|---|---|---|
| Faixa flutuante "Reconectando…" (3 s, canto inferior direito) | Indicador persistente do trilho (desktop) · faixa de 1 linha no topo do conteúdo (celular) · região viva da casca | dado |
| Pílula verde "Conexão restabelecida." | O mesmo indicador em "Conectado" por 3 s, com ícone neutro · região viva | dado |
| `role="status"` + `tabIndex` do indicador do menu | Região viva única; o indicador continua focável para a dica | dado |
| Dica própria em CSS do indicador | `DicaFlutuante` do trilho | dado |

### 7.4 Ids do Apêndice A

**CAS-SHL-01 e -02 (resolvem)**, CAS-NAV-10 (muda: vira o único indicador, com dois estados), **CAS-NAV-11
(resolve: no celular o texto fica visível; no desktop a dica é a do trilho)**, CAS-NAV-15 (o celular
passa a ter sinal persistente de queda).

### 7.5 Riscos e testes

- `AppShell.connection.test.jsx` (3 casos) é reescrito: sem faixa flutuante; a região viva recebe as
  duas frases; no celular a faixa fica enquanto `reconnecting`. `SideNav.connection.test.jsx` (3
  casos): o indicador continua aparecendo e sumindo, agora sem `role="status"`, e mostra "Conectado"
  por 3 s ao voltar.
- A faixa do celular não pode esconder o botão "Abrir menu" (invariante §9) nem empurrar a conversa
  abaixo das faixas homologadas (< 500 px, 683×384): medir no harness.
- Contar `role="status"` por tela no harness (meta: 1).

---

## 8. Decisões pendentes do proprietário (consolidado)

| # | Decisão | Opções | Recomendação |
|---|---|---|---|
| D1 | Onde abre "Nossa equipe" | A: painel na coluna da lista (não modal) · B: diálogo reestruturado | A |
| D2 | Fichas de filtro da equipe | Remover (as três seções são a mesma partição) · manter um segmentado Todos/Online/Offline sem contagem | Remover |
| D3 | Onde vivem os Encerrados | A: vista da coluna da lista + conversa na área principal · B: diálogo único mestre-detalhe · C: mínimo (modal empilhado mantido) | A (muda a §7b da E3: o `lazy` no menu deixa de ser necessário) |
| D4 | Painel Cliente no modal da Supervisão | Fechado por padrão (a linha 2 do cabeçalho já traz estado, setor, telefone, protocolo, localidade) · aberto por padrão quando cabe ao lado | Fechado |
| D5 | "Alterar setor" em conversa **encerrada** (CVM-INF-06) | Manter visível (regra atual) · esconder quando encerrada | Sem recomendação: é regra de uso, o backend aceita |
| D6 | Quando corrigir PRF-12 (senha atual errada desloga) | Na E2, junto com a vista de senha · correção isolada antes (como a E1) · E4 | E2 ou isolada; não esperar a E4 |
| D7 | "Sair" sem confirmação | Manter · confirmar sempre · confirmar só com envio em curso | Manter |
| D8 | Aviso de transferência | A: marca na lista + aba + região viva · B: aviso fixo no topo da coluna da lista; sub-decisão: ouvinte na casca ou só na mesa | A, com o ouvinte na casca |
| D9 | Rebusca periódica do status dos canais | Só na reconexão e na volta da aba · também a cada N min | Só reconexão + volta da aba |
| D10 | Regra de base: diálogo de consulta sem rodapé | Sem rodapé (fecha por "×", ESC, clique fora) · rodapé com "Fechar" | Sem rodapé |
| D11 | SGP em conversa encerrada (CV-SGP-33, já em C.3) — pesa mais com D3 A/B, que deixam a conversa encerrada à mão | Não abrir o SGP sozinho e esconder os envios em conversa encerrada · manter | Não abrir sozinho + sem envios (só frontend) |

---

## 9. Tabela-resumo

Contagem das mudanças **propostas** (S = estrutural, C = cosmético). As regras de base citadas
dentro dos itens ("via B-S1", "via B-S4") estão contadas só na linha da base.

| Item | Mudanças S | Mudanças C | Ids do Apêndice A resolvidos (principais) |
|---|---:|---:|---|
| 0. Base comum (Dialog, WaDialog, overlays.css, dialogStack) | 5 | 4 | CVM-MOD-10, PRM-DLG-02, PRM-WAE-01 |
| 1. Nossa equipe (barra + vista) | 14 | 6 | ATD-EQP-03/04, ATD-EQM-01/04/07/09/19/21/23 |
| 2. Encerrados + modal de conversa + painel de informações | 17 | 2 | CVM-ENC-02/03/05/08/11/12/13/14, CVM-MOD-03/07, CVM-INF-01/02/07/08/09/10/14 |
| 3. Meu perfil | 15 | 3 | PRF-01/02/04/06/07/08/09/11/12/13/16/17 |
| 4. Menu da conta | 3 | 2 | CAS-NAV-13 (+D7), CAS-NAV-14 |
| 5. Aviso de transferência | 7 | 2 | ATD-AVT-02/05/07 |
| 6. Faixa de status do canal | 5 | 2 | CAS-BAN-01/02/03/05/06 |
| 7. Avisos de conexão | 6 | 1 | CAS-SHL-01/02, CAS-NAV-11/15 |
| **Total** | **72** | **22** | |

**Como as contagens se compõem**

- **Base:** S — B-S1 camada leve; B-S2 "×" no fluxo; B-S3 consulta sem rodapé; B-S4 CSS só nos
  encaixes; B-S5 largura única por diálogo. C — véu, painel/raio/sombra, ícone neutro, título.
- **1:** S — chevron sai; barra 44 px; vaga fixa da contagem; estados da barra; portal redundante sai;
  vista na coluna (D1); fichas de filtro saem; frases-resumo saem; ficha "ativos" + "Online · …" viram
  uma linha 2; rodapé sai; contagens só com dado pronto; "Tentar de novo"; busca vazia com "Limpar
  busca"; dica redundante sai. C — presença cheio×vazado sem verde; ícone neutro/nenhum; âmbar e
  laranja saem; pílula vira texto; grupos sem caixa; busca afundada.
- **2:** S — Encerrados vira vista (D3); conversa encerrada fora do modal empilhado; grade → lista;
  data de encerramento; fichas saem do item; variante "padrão" sai; largura estável; "Carregar mais"
  com erro e nova tentativa; erro da 1ª carga com nova tentativa; contagem "+" sai; import estático sai
  do menu; aviso "encerrado · somente leitura" no rodapé; fechar no cabeçalho; seta "Voltar" sai do
  modal; painel de informações sai; painel Cliente no modal com os campos que faltavam; troca de setor
  com salvando/erro/desfazer. C — superfícies do cartão; verde/laranja de estado.
- **3:** S — largura única; esqueleto; nova tentativa; cartão sai; e-mail uma vez com o porquê; título
  "Dados pessoais" sai; uma coluna; `<details>` vira vista com ação própria; envio de foto visível;
  rótulos de progresso; sucesso que some; confirmação ao fechar com edição; nome pelo `Field`; senha
  atual errada no campo sem deslogar; erro de confirmação no campo. C — "Remover foto" neutro;
  superfícies; geometria de botão.
- **4:** S — cabeçalho com nome e papel; divisória antes de "Sair"; gatilho só avatar. C — superfície
  do popover; hover/pressionado.
- **5:** S — sai de cima do compositor; sem prazo; nenhuma transferência se perde; `null` avisa;
  "Clique para abrir" sai; região viva única; marca na aba (A). C — cobre sai; superfície real (B).
- **6:** S — uma linha; um link com destino e verbo; região viva; erro com nova tentativa; rebusca na
  reconexão/visibilidade. C — acento → aviso; `font-wa` sai.
- **7:** S — faixa flutuante sai; "Conectado" no mesmo indicador; faixa persistente no celular; região
  viva única; dica pela `DicaFlutuante`; primitiva "faixa de aviso" compartilhada. C — verde e âmbar
  literais → tokens.

Resultado: **72 S × 22 C** — as estruturais são 77% do grupo e dominam em todos os itens.
