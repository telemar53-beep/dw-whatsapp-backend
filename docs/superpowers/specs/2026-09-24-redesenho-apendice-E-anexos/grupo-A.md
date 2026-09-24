> **Anexo do Apêndice E** — relatório de auditoria (subagente, somente leitura, base `e5236da`), **conferido por amostra** antes de entrar no spec (Apêndice E.0). É material de detalhe para o plano da E2: onde este anexo e o Apêndice E divergirem, **vale o Apêndice E** (a base única e as decisões de E.3/E.4 resolvem os conflitos entre os grupos). A correção de ATD-INI-24/29 que este anexo pede já foi aplicada ao Apêndice A.

# Apêndice E — Grupo A: overlays que se abrem a partir da mesa

> Parte do spec `2026-09-24-redesenho-simplicidade-design.md` (seção 6.6). Base lida: cópia de
> **`e5236da`** (`scratchpad/estados/base-e5236da/frontend/src`), nunca o disco. Auditoria somente
> leitura: nada no repositório foi alterado.
>
> Overlays: **1** Iniciar conversa · **2** Transferir atendimento · **3** Encerrar atendimento
> (motivo) · **4** Confirmação "Finalizar sem motivo" · **5** Enviar template. Mais a **base comum**
> que os cinco herdam (`ui/Dialog.jsx`, `WaDialog.jsx`, `ui/ConfirmDialog.jsx`,
> `hooks/useConfirm.jsx`, `overlays.css`, `ui/dialogStack.js`).
>
> Endereços sem arquivo herdam o arquivo da seção. "Pelo código" = lido no fonte; onde uma regra de
> `overlays.css` (fora de `@layer`) anula um utilitário, isso está dito — a prova final é estilo
> computado no harness (armadilha 13.1).

**Legenda.** **S** = estrutural (posição, tamanho, quantidade, existência). **C** = cosmético (cor,
superfície, raio, sombra, família tipográfica). **B** = comportamento ou conteúdo (defeito de
fluxo, texto errado, acessibilidade) — **não entra na conta S × C**, para a conta não ser inflada
com correção de bug. **DECISÃO** = depende do proprietário (seção 6).

---

## 0. Base comum

### 0.1 Estrutura hoje

| Ponto | Hoje | Onde |
|---|---|---|
| Véu | `--wa-overlay` rgba(13,20,24,.68) + blur 6 px (só na profundidade 0) | ui/Dialog.jsx:283-285 · index.css:120-121 |
| Painel | `bg-wa-panel` = rgba(45,54,60,**.96**) + `backdrop-blur` 28 px: a mesa aparece borrada através | ui/Dialog.jsx:302 · index.css:119, :131 |
| Raio | o Dialog pede 22 px (`rounded-[var(--wa-dialog-radius)]`), mas `.dw-dialog{border-radius:18px}` sem `@layer` vence: **duas fontes, a do token é morta** | ui/Dialog.jsx:302 · overlays.css:2 · index.css:116 |
| Sombra | idem: 3 sombras de overlays.css:2 vencem `--wa-dialog-shadow` | overlays.css:2 |
| Cabeçalho | × absoluto 32 px; slot de **ícone tonal** em ladrilho 34 px com 5 tons; h2 18 px; descrição 12 px (overlays.css:18 vence o `text-[14px]` do Dialog); linha inferior | ui/Dialog.jsx:304-334 · overlays.css:4-17 |
| Corpo/rodapé | `DialogBody`/`DialogFooter` existem, mas no grupo **só o Enviar template usa os dois**; Transferir e Encerrar escrevem `dw-dialog-footer` à mão; Iniciar monta corpo e rodapé próprios; a confirmação põe os botões **dentro do corpo** | ui/Dialog.jsx:131-145 · ui/ConfirmDialog.jsx:30-37 |
| Regras sem `@layer` que anulam utilitários em TODO diálogo | botão 12 px (:22); campo 13 px, raio 7, padding 7×10 (:19); rótulo 12 px (:21); botão de rodapé 7×13 px e raio 7 (:27). A folha só é importada por ui/Dialog.jsx:5 e o próprio comentário dela confirma que está fora de `@layer` (overlays.css:73-77) | overlays.css:19-27 |
| Tipografia | `font-wa` (pilha Segoe UI) no véu | ui/Dialog.jsx:283 |
| Margem lateral | cabeçalho e rodapé 22 px (overlays.css:4, :26); corpo 22 (`DialogBody`, :29), **20** (Transferir `px-5`, Iniciar `px-5`) ou **24** (Encerrar `px-6`, Iniciar `sm:px-6`): a borda do texto do corpo não alinha com a do título; 22 não está na escala de 4 (5.5) | ver cada seção |
| Estado "ocupado" | não existe: nenhum diálogo sabe que há envio em curso; C.4.3 fica a cargo de cada tela | — |

**Consequência medida no código — três geometrias de botão no mesmo grupo, todas em 12 px** (a
escala 5.4 põe botão em 14):

| Onde | Geometria efetiva | Classes mortas |
|---|---|---|
| Transferir, Encerrar, Enviar template (dentro de `.dw-dialog-footer`) | padding 7×13, raio 7, 12 px (overlays.css:22, :27) | `px-5 py-2 rounded-[10px] text-[13.5px]` (TransferModal.jsx:264, :272), `px-7 py-2.5 rounded-[12px] text-[14px]` (CloseReasonModal.jsx:109, :117), `px-3.5 py-2 rounded-[10px] text-[13.5px]` (SendTemplateModal.jsx:150, :158) |
| Iniciar conversa (botões não são filhos diretos do rodapé, :27 não casa) | raio 12, `px-6 py-2`, 12 px | `text-[14px]` de WaDialog.jsx:14-18 |
| Confirmação (`Button md` dentro do corpo) | raio 12, `px-4 py-2.5`, 12 px | `text-[14px]` de ui/Button.jsx:12 |

**Regras mortas do Transferir.** overlays.css:170-171 e o 1º seletor de :172 miram
`[data-dialog=transfer] > div:first-child`, e :173 mira `> div:nth-child(2) label` (a barra de busca
a 36 px). Mas o 1º filho do painel é o botão × (ui/Dialog.jsx:304) e o 2º é o cabeçalho
(:316): **nenhuma das quatro casa** — a barra continua em 42 px.

**Confirmação lida duas vezes.** `useConfirm` não repassa `title` (hooks/useConfirm.jsx:27-35);
sem título o `ConfirmDialog` usa a mensagem como nome (`ariaLabel={message}`,
ui/ConfirmDialog.jsx:21) **e** como descrição (`describedBy={messageId}`, :22). Leitor de tela:
nome + descrição = a mesma frase duas vezes.

**Quatro padrões para "escolha 1 de N"** no grupo: botão `role="radio"` (TransferModal.jsx:84-88),
rádio nativo dentro de cartão (CloseReasonModal.jsx:35-45), botão `aria-pressed`
(SendTemplateModal.jsx:79-83) e `<select>` (StartConversationModal.jsx:197).

### 0.2 O que a base precisa ganhar (habilitadores do grupo)

Estes mecanismos são **pré-requisito** das propostas de cada overlay. A mudança visível que cada um
provoca é contada **na seção do overlay**, não aqui, para não contar duas vezes.

| # | Mecanismo | Por quê |
|---|---|---|
| H1 | **Região de erro fixa** entre corpo e rodapé (`DialogFooter erro=…` → `WaError` de largura total acima das ações, fora do eixo de rolagem) | Nos 4 formulários o erro está no **fim do corpo rolável** (StartConversationModal.jsx:257, TransferModal.jsx:255, CloseReasonModal.jsx:100, SendTemplateModal.jsx:144): com lista longa, o clique falha e nada visível muda |
| H2 | **Nota do rodapé que alterna motivo × consequência**: enquanto a ação principal está desabilitada, a área de nota diz o que falta (e o botão aponta para ela por `aria-describedby`); quando fica disponível, volta a nota de consequência | Resolve "desabilitado sem motivo" (ATD-TRF-19, ATD-ENC-13, CV-TPL-09) **sem elemento novo**: usa o lugar que Transferir e Encerrar já têm (`dw-dialog-nota`, overlays.css:35). A consequência aparece exatamente quando importa: antes do clique |
| H3 | **Estado `ocupado`** no Dialog: × desabilitado, ESC consumido sem fechar, fundo não fecha; a tela desabilita o próprio Cancelar e o conteúdo (`<fieldset disabled>`) e troca o rótulo do botão ("Transferindo…") | C.4.3. **Implementar como uma guarda só no `onClose`** (o `fechar` da pilha lê `fecharRef.current`, ui/Dialog.jsx:176, :182): cobre ESC, × e qualquer caminho futuro de uma vez, e o ESC continua marcado como tratado pela pilha (ui/dialogStack.js:43-49). `closeOnEsc={false}` sozinho deixaria o × e o Cancelar para cada tela lembrar — é exatamente o modo de falha de C.4.3 |
| H4 | **Cabeçalho sem ladrilho tonal**: sai o par `icon`/`tone` (ui/Dialog.jsx:322; overlays.css:6-10) | Decisão revogada em 24/09 (seção 14). Ver DECISÃO D1 |
| H5 | **Confirmação estruturada**: `useConfirm` repassa `title`; com título, nome = título e descrição = mensagem; sai a coluna do ícone (ui/ConfirmDialog.jsx:31; overlays.css:160-162); botões no `DialogFooter`; opção `acao` assíncrona (ocupado + erro dentro do diálogo). API atual (`confirm(message, {danger, confirmLabel, cancelLabel})`) intacta para os 14 chamadores | Overlay 4 |
| H6 | **Lista de escolha única** (linha-rádio): marca à direita (onde Transferir e Encerrar já a põem), texto em 1–2 linhas, hover `--color-hover`, escolhida `--color-selecionado` + barra de 3 px do acento + marca cheia (forma, P8), `role="radiogroup"` | Substitui os 4 padrões acima em Transferir, Encerrar, Enviar template e Iniciar |
| H7 | **Escolha de template** (lista H6 + variáveis + prévia), um componente para Iniciar e Enviar template | A mesma tarefa hoje tem duas telas diferentes (overlays 1 e 5) |

### 0.3 Mudanças visíveis da própria base (valem para todo diálogo do sistema)

| # | Classe | Mudança | Evidência |
|---|---|---|---|
| BA-1 | **S** | Margem lateral única de **24 px** no cabeçalho, corpo e rodapé; corpo e rodapé sempre por `DialogBody`/`DialogFooter` | 22/20/24 px hoje (0.1) |
| BA-2 | **S** | **Uma geometria de botão**: `Button` (altura 36, 14 px) no rodapé; somem as 5 strings de classe à mão e as regras overlays.css:22, :27 | 3 geometrias em 12 px (0.1) |
| BA-3 | **S** | Região de erro fixa (H1) existe na base, antes do rodapé | — |
| BA-4 | **C** | Véu `--color-veu` sólido sem blur; painel `--color-elevado` sólido; uma sombra `--ui-sombra-dialogo`; raio 16 numa fonte só (saem o 18 de overlays.css:2 e o 22 do token); linha do cabeçalho em `--color-linha` | 0.1 |
| BA-5 | **C** | Inter no corpo, Sora 16/600 no título (sai `font-wa`) | ui/Dialog.jsx:283; overlays.css:17 |

---

## 1. Iniciar conversa — `components/StartConversationModal.jsx`

Aberto pelo botão "Nova" do cabeçalho da lista (DashboardPage.jsx:182-190); montado em
DashboardPage.jsx:316-324.

### 1.1 Estrutura hoje

| Medida | Hoje | Onde |
|---|---|---|
| Largura | 768 px (`max-w-3xl`) | :116 |
| Regiões | cabeçalho (× + título; sem descrição, sem ícone) · corpo rolável **próprio** (não `DialogBody`) com dois blocos separados por linha · rodapé **próprio**, com fundo `bg-wa-panel-header` | :116, :118, :119, :179, :259 |
| Controles | Baileys: × + Canal + País + Telefone + Mensagem + Cancelar + Iniciar = **7**. Oficial: × + Canal + País + Telefone + Template + *N* variáveis + Cancelar + Iniciar = **7 + N** | :131, :154, :160, :246 / :197, :233-238, :268, :271 |
| Títulos | **2**: h2 "Iniciar conversa" + h3 da seção ("Template de abertura" :183 ou "Mensagem inicial" :244) | |
| Ícones de cabeçalho | 0 | |
| Camadas sob o texto principal (o telefone digitado) | **3**: véu com blur → painel translúcido com blur → campo `bg-wa-panel-header` (branco 7%) | ui/Dialog.jsx:283, :302 · WaDialog.jsx:10 |
| Cores de destaque | **4 famílias**: acento (botão :274); aviso `#f0b65f` (faixa :184 **e** status do rodapé :266, inclusive no estado normal "Iniciando conversa…"); azul `#53bdeb` (fichas de botão :220); perigo (erros :176, :257) | |
| Ação principal | rodapé, à direita | :271-277 |
| Leitura | grade de 2 colunas por **viewport** (`sm:`): Canal à esquerda, País+Telefone à direita — o olho faz Canal → País → Telefone em zigue-zague; a seção de baixo é travada em 420 px, então ~45% da largura fica vazia sob ela | :119, :186, :232 |

**O que se repete**

- "Canal oficial exige template" **até 3×** com a lista vazia: faixa "Este canal requer o uso de
  template para iniciar o atendimento!" (:184) + "Nenhum template aprovado para este canal." (:191)
  + rodapé "Este canal precisa de um template aprovado para iniciar." (:65-66, :266).
- Estado dos canais **2×** (corpo + rodapé): carregando :125 + :60 — **dois `role="status"` ao
  mesmo tempo** (ATD-INI-02); erro :127 + :62; vazio :129 + :64.
- h3 "Mensagem inicial" (:244) + rótulo "Mensagem" (:245) para **um** campo.
- A mesma tarefa (mandar um template a um cliente) tem duas telas: aqui é `<select>` com o nome e
  **sem o texto** que o cliente vai ler (:197-229); no Enviar template é lista + corpo + prévia
  (SendTemplateModal.jsx:77-140).

**Achados lidos no código, além do inventário**

- **Foco inicial cai em País.** O Dialog foca o primeiro campo no mount (ui/Dialog.jsx:208-215,
  :69-82). No mount os canais ainda carregam e o `<select>` Canal não existe (:124), então o foco
  vai para País (:154) — que quase sempre fica em "Brasil". O campo que sempre precisa ser digitado
  é o Telefone.
- **Durante a carga, o corpo desenha o formulário Baileys.** Sem canal, `isOfficialChannel` é
  falso (:54) e o ramo "Mensagem inicial" + textarea (:243-254) aparece; se o 1º canal for oficial,
  a seção troca de conteúdo e de altura quando a lista chega.
- **A ajuda do nono dígito só vale para Baileys.** "Com ou sem o 9, o sistema confere no WhatsApp
  qual forma existe." (:173) — no backend a conferência (`resolveWhatsAppJid`) só roda no ramo
  Baileys (src/api/conversations.routes.js:152); no oficial o número segue como digitado (:179).
  Em canal oficial a frase promete o que não acontece.
- **Correção ao Apêndice A (ATD-INI-24, ATD-INI-29 e a lista C.4.1).** A frase "This template does
  not belong to this channel's WABA" **tem tradução** em `e5236da`: utils/errorMessages.js:76 →
  "Este template não pertence à WABA deste canal." (apóstrofo ASCII nos dois lados, conferido byte a
  byte). O defeito real de ATD-INI-29 é a **corrida** — e a frase traduzida ainda culpa o atendente
  com jargão ("WABA") por algo que a tela causou —, não frase crua. As duas linhas deveriam sair de
  C.4.1 e ficar só em CLASSE-01.

### 1.2 Problemas

| # | Classe | Problema | Evidência |
|---|---|---|---|
| 1 | S | 768 px para 4–6 campos; 2 colunas por viewport com a seção de baixo travada em 420 px: metade direita vazia | :116, :119, :186, :232 |
| 2 | S | Ordem de leitura em zigue-zague e foco inicial no País | :119-177; ui/Dialog.jsx:69-82 |
| 3 | S | O mesmo estado dito em 2 lugares (3 para "exige template"); 2 `role="status"` simultâneos | :60-67, :125-129, :184, :191, :266 |
| 4 | S | Título h3 + faixa de aviso para uma regra que é o caso **normal** do canal oficial (não é exceção) | :182-185 |
| 5 | S | Template escolhido sem ver o texto; padrão diferente do Enviar template | :197-229 |
| 6 | S | Seção de conteúdo desenhada antes de saber o tipo do canal | :54, :180, :243 |
| 7 | S | Erro no fim do corpo rolável | :257 |
| 8 | S | `<select>` de Canal mesmo com um canal só elegível (controle que não decide nada) | :131-142 |
| 9 | S | h3 + rótulo repetidos no Baileys | :244-245 |
| 10 | S | Validação em dois padrões: telefone em `WaError` (:176), variáveis e mensagem no balão nativo do navegador (`required` :236, :252) | ATD-INI-19, -21 |
| 11 | C | Cor de aviso para estado normal ("Iniciando conversa…") e para a regra do canal | :184, :266 |
| 12 | C | Fichas dos botões em azul `#53bdeb` (4ª família de cor) | :220 |
| 13 | C | Rodapé com fundo próprio (branco 7% sobre painel translúcido) | :259 |
| — | B | Fechar com o envio em curso abre a conversa mesmo assim (ATD-INI-26); corrida de templates (ATD-INI-27, -29: o `.then` de :75 não confere o canal); templates sem "carregando" (ATD-INI-13) e sem erro (ATD-INI-14: promessa sem `catch`, :75-78); canais sem "Tentar de novo" (ATD-INI-03); erro do telefone não some ao corrigir (ATD-INI-10); mensagem só com espaços passa (ATD-INI-21); ajuda do "9" falsa no oficial; sucesso não troca a aba (ATD-MESA-16) | |

### 1.3 Proposta estrutural

```
Iniciar conversa                                          [×]
──────────────────────────────────────────────────────────────
País [Brasil (+55) ▾]   Telefone [                    ]  ← foco inicial
Digite com DDD.  (+ "Com ou sem o 9, conferimos no WhatsApp." só em Baileys)
Número completo: 55 98 98500-4187
Canal [DW Suporte ▾]      — ou texto "DW Suporte" quando há um só
──────────────────────────────────────────────────────────────
Baileys  Mensagem inicial [textarea]
Oficial  Template  · "Canal oficial só inicia conversa com template aprovado." (tinta-2)
         ( ) boas_vindas        Olá {{1}}, tudo bem? …     ← H6/H7
         (•) retorno_contato    Estamos retornando …
         Variável 1 [      ]
         Prévia (bolha de saída + botões)
──────────────────────────────────────────────────────────────
[erro, quando houver]                                      ← H1
                                  [Cancelar] [Iniciar conversa]
```

| # | Classe | Mudança | Resolve |
|---|---|---|---|
| 1 | S | 768 → **576 px**, uma coluna. País e Telefone continuam lado a lado pela regra `@container` que já existe (overlays.css:127-129, limiar 330 px): o invariante fica | P1 |
| 2 | S | Ordem **Telefone → Canal → conteúdo** ("para quem, por onde, o quê"); `data-autofocus` no Telefone | P2 |
| 3 | S | Canal com **uma** opção vira texto (com o mesmo rótulo "Canal" para leitor de tela); com duas ou mais, continua `<select>` | P8 |
| 4 | S | Estado dos canais dito **uma vez**, no lugar do campo Canal: carregando (esqueleto do campo), erro (frase + "Tentar de novo"), vazio (frase). Sai o `<p role="status">` do rodapé; o botão desabilitado aponta para a frase do corpo por `aria-describedby` (o motivo segue acessível, 5.7) | P3 |
| 5 | S | Saem a faixa "Este canal requer…!" e o h3 "Template de abertura"; a regra vira a ajuda do campo Template | P4 |
| 6 | S | Template pela **escolha de template compartilhada** (H7): lista com nome + 1ª linha, variáveis, prévia com botões. Vazio: "Nenhum template de atendimento aprovado neste canal." — a mesma frase do Enviar template, e diz "de atendimento", que é o filtro real (:75) | P5 |
| 7 | S | A seção de conteúdo só aparece depois que os canais chegam | P6 |
| 8 | S | Erro na região fixa (H1) | P7 |
| 9 | S | Baileys: um rótulo só, "Mensagem inicial" (sai o h3 :244) | P9 |
| 10 | S | Validação toda em linha: `noValidate` no form + erro sob cada campo (padrão `Field error`, `role="alert"`); mensagem aparada antes de validar | P10 |
| 11 | C | Rodapé sem fundo próprio | P13 |
| 12 | C | Cor de aviso deixa de pintar estado normal ("Iniciando…" vai para o rótulo do botão) | P11 |
| 13 | C | Fichas de botão em tinta neutra, dentro da prévia | P12 |
| — | B | Ocupado (H3): × / ESC / Cancelar travados, campos em `<fieldset disabled>`, rótulo "Iniciando…". Guarda de canal no `.then` dos templates (descarta resposta de canal que não é mais o escolhido — regra CLASSE-01). Templates com "carregando" e erro + "Tentar de novo". Erro do telefone some ao editar. Ajuda do "9" só em Baileys. No sucesso, a mesa troca para a aba **Atendimento** (o `/start` assume a conversa para o próprio atendente e emite `conversation:assigned` só para ele: src/api/conversations.routes.js:204, :210, :225) — mudança em DashboardPage.jsx:319-323 | |

**Para onde vai o que sai** (formato do Apêndice B)

| Sai | Vai para | Tipo |
|---|---|---|
| Faixa "Este canal requer o uso de template para iniciar o atendimento!" (:184) | Ajuda do campo Template, em tinta-2 | dado |
| h3 "Template de abertura" (:183) | Rótulo "Template" | dado |
| h3 "Mensagem inicial" (:244) | Rótulo do campo | dado |
| Motivo do botão desabilitado no rodapé (:266) | A frase única junto do campo Canal/Template + `aria-describedby` do botão | dado |
| "Iniciando conversa…" no rodapé (:58) | Rótulo do botão durante o envio | dado |
| `<select>` de Canal com uma opção | Texto com o nome do canal | dado |
| `<select>` de Template | Lista de escolha única com prévia (ganha o corpo do template) | ação + dado |
| Fundo próprio do rodapé | Nada: separação por linha | nada |

### 1.4 Ids do Apêndice A

- **Resolve:** ATD-INI-02, -03, -10, -13, -14, -19, -21, -23, -26, -27, -29; ATD-MESA-16.
- **Muda:** ATD-INI-01 (largura), -06 (select → texto com um canal), -08 (ajuda por tipo de canal),
  -11 (continua `@container`, agora em 576 px), -12 (faixa → ajuda), -15 (frase), -16 (select →
  lista), -17/-18 (dentro da prévia), -20 (rótulo único), -22 (motivo muda de lugar), -24 (erro na
  região fixa; ver correção acima), -28.
- **Não toca:** ATD-INI-04, -05, -07, -09 (continuam como estão).

### 1.5 Riscos e testes

- `StartConversationModal.test.jsx` (19 testes): mudam "shows a message when there is no eligible
  channel" (:29, afirma as **duas** frases duplicadas), os que procuram o template por rótulo
  (:149, :162) e "lists only connected Baileys channels" (:18: com um canal só, ele vira texto —
  o teste passa a usar dois).
- Novos: foco inicial no Telefone; canal único vira texto e ainda envia `channelId`; corrida A→B
  entre dois canais oficiais com a resposta de A atrasada; ESC durante o envio não fecha e não chega
  a ouvinte de documento; erro de templates com "Tentar de novo"; mensagem só com espaços dá erro em
  linha; ajuda do "9" só em Baileys; sucesso troca a aba (DashboardPage).
- Harness: template com 3 variáveis cabe em 1366×768 sem rolar? Em 683×384 só o corpo rola,
  cabeçalho e rodapé ficam (teste existente de ui/Dialog.test.jsx:255).

---

## 2. Transferir atendimento — `components/TransferModal.jsx`

Aberto por "Transferir" no cabeçalho da conversa (ConversationView.jsx:641); montado em
DashboardPage.jsx:315 e SupervisionPage.jsx:699 (por cima do modal de conversa: 2 níveis de pilha).

### 2.1 Estrutura hoje

| Medida | Hoje | Onde |
|---|---|---|
| Largura | 760 px | :189 |
| Regiões | cabeçalho (× + ícone + título + descrição) · barra (busca + ordenar) · lista rolável em grupos · rodapé à mão (nota + 2 botões) | :183-190, :192-226, :228-256, :258-278 |
| Controles | × + busca + ordenar + *N* linhas + Cancelar + Transferir = **5 + N** | |
| Cabeçalho | título + descrição + **1 ícone** em ladrilho 34 px no acento (sem `tone` cai no `--color-accent`, overlays.css:6) | :186-188 |
| Linha do atendente | **9 elementos em 2 colunas**: avatar 46, ponto, nome, pílula de carga, divisória vertical, ícone de conversa, "N atendimentos", dica (ou 2ª pílula vermelha), marca de rádio | :91-123 |
| Barra | 42 px; "Ordenar por" empilhado em 2 linhas (11 + 13,5 px) dentro da caixa do select | :193, :206-221 |
| Camadas sob o texto principal (nome) | **3**: véu → painel → linha escolhida (`--color-accent-surface` + contorno, overlays.css:139); sob o texto da pílula, **4** (+ fundo de 15%, :100) | |
| Cores de destaque | **5 famílias + perigo**: acento (ícone, escolha, marca, botão); verde `chat-online`; amarelo `#f5c518`; laranja `chat-orange` (**o mesmo matiz do acento**); vermelho `#ef4444` | :32-46 |
| Ação principal | rodapé, à direita, "Transferir para {primeiro nome}" | :268-276 |

**O que se repete**

- **Carga dita 3–4× na mesma linha:** cor do ponto (:95), rótulo da pílula (:100-102),
  "N atendimentos" (:111), dica (:119). A partir de 10: **duas pílulas vermelhas** com o mesmo
  sentido, "Carga alta" + "Alta carga de atendimentos" (:100, :113-117).
- **Presença dita 3×:** cabeçalho de grupo "Disponíveis/Offline" (:232, :242), pílula "Offline" e
  dica "Não está disponível no momento" (:18).
- **Dica que contradiz o número:** "Disponível" (0 atendimentos) usa "Atendendo normalmente" (:29),
  a mesma dica do nível 1–4 (:27).
- Título "Transferir atendimento" + descrição "Escolha um atendente para transferir esta
  conversa." (:186-187).
- **Um sinal com dois sentidos:** o ponto da foto tem `title` "Online/Offline", mas a **cor** é a da
  carga (`DOT_CLASSES[level.tone]`, :95).
- **Colisão de vocabulário (P5):** "Em atendimento" (nível 1–4, :27) é o nome de um estado de
  conversa; aqui quer dizer "tem de 1 a 4 conversas" — é o amarelo que o diagnóstico §4 já
  apontava. "Disponíveis" (grupo = online, inclusive com 15 conversas) colide com o nível
  "Disponível" (online com zero).

**Achados lidos no código**

- **Escolha invisível:** `escolhidoAgora` sai da lista **filtrada** (:166); a busca esconde o
  escolhido e o botão volta a "Transferir" desabilitado, com a escolha ainda guardada (ATD-TRF-20).
- **Linhas clicáveis durante o envio** (:236, :246 sem `disabled`): o rótulo do botão (:275) passa
  a nomear outra pessoa enquanto a transferência para a primeira ainda está no ar.
- Colunas somem por **viewport** (`sm:`, :104-105), não pelo espaço do diálogo (invariante 9:
  `@container` nos diálogos).
- `refresh` existe em hooks/useAgents.js:12 e o modal não o usa (ATD-TRF-03).
- A borda e o fundo dos `<ul>` (:234, :244) são anulados por overlays.css:174; a barra a 36 px
  nunca pega (regra morta, 0.1).

### 2.2 Problemas

| # | Classe | Problema | Evidência |
|---|---|---|---|
| 1 | S | 760 px para uma lista de nomes; linha de 2 colunas e 9 elementos | :189, :91-123 |
| 2 | S | Carga e presença repetidas na mesma linha (acima) | :95-121, :232, :242 |
| 3 | S | O ponto de presença codifica carga por cor; P8 pede presença por forma | :93-96 |
| 4 | S | Ícone de cabeçalho + descrição que repete o título | :186-188 |
| 5 | S | Barra de 42 px com rótulo empilhado no Ordenar | :193, :206-221 |
| 6 | S | Erro no fim da lista rolável: com 15 atendentes, a falha fica abaixo da dobra | :255 |
| 7 | S | Escolha some com a busca e o botão desabilita sem dizer por quê | :166, :271 |
| 8 | S | Nada diz que falta escolher (botão cinza) | :271 |
| 9 | S | Esqueleto de 3 barras para linhas com avatar | :229 (AsyncState padrão) |
| 10 | C | 5 famílias de cor para carga; laranja de carga = acento | :32-46 |
| 11 | C | Escolha com fundo tingido + contorno + marca radial | overlays.css:139-141 |
| 12 | C | Opção do select com cor fixa `bg-[#30383d] text-white` | :216 |
| — | B | Fechar com envio em curso (ATD-TRF-25); linhas clicáveis no envio; enviando sem indicação (ATD-TRF-22); erro de carga sem "Tentar de novo" (ATD-TRF-03); offline escolhido sem aviso (ATD-TRF-16) | |

### 2.3 Proposta estrutural

```
Transferir atendimento                                    [×]
────────────────────────────────────────────────────────────
[⌕ Buscar atendente…                ]  [Menor carga ▾]      36 px
ONLINE 3
  ● Ana Souza                                          ( )
    3 atendimentos
  ● Pedro Henrique                                     (•)   ← selecionado + barra 3 px
    12 atendimentos · ⚠ Carga alta
OFFLINE 1
  ○ Berg                                               ( )
    0 atendimentos
────────────────────────────────────────────────────────────
[erro]                                                        ← H1
A transferência fica registrada no histórico.  [Cancelar] [Transferir para Pedro]
(antes de escolher: "Escolha quem vai receber o atendimento." — H2)
```

| # | Classe | Mudança | Resolve |
|---|---|---|---|
| 1 | S | 760 → **480 px** | P1 |
| 2 | S | Linha de **2 linhas e 4 elementos** (lista H6): avatar 36 com ponto de presença, nome, "N atendimentos" (+ "· Carga alta" só a partir de 10), marca. Saem pílula, divisória, ícone de conversa, dica e 2ª pílula. Sem colunas, a linha cabe em 320 px e o `sm:` por viewport deixa de existir. **DECISÃO D2** sobre os níveis intermediários | P1, P2 |
| 3 | S | Ponto **por forma**: cheio = online, vazado = offline (P8), em tinta; a carga sai do ponto e fica no número | P3 |
| 4 | S | Sai a descrição | P4 |
| 5 | S | Sai o ícone do cabeçalho (H4, D1) | P4 |
| 6 | S | Barra a 36 px: busca afundada; Ordenar numa linha (valor visível "Menor carga"/"Nome", nome acessível "Ordenar por" mantido) | P5 |
| 7 | S | Erro na região fixa (H1) | P6 |
| 8 | S | A escolha sobrevive à busca: `escolhidoAgora` lido de `allAgents`; se a busca não casa o escolhido, a linha dele fica fixada acima dos grupos, com a marca | P7 |
| 9 | S | Nota do rodapé alterna (H2): sem escolha, "Escolha quem vai receber o atendimento."; com escolha, a nota de consequência; escolhido **offline**, acrescenta "{Nome} está offline agora." em aviso (continua escolhível — regra atual) | P8, ATD-TRF-16 |
| 10 | S | Esqueleto com a forma da linha (círculo + 2 barras) | P9 |
| 11 | C | Sem as 5 famílias: número em tinta-2; "Carga alta" em `--color-aviso` com ícone | P10 |
| 12 | C | Escolha em `--color-selecionado` + barra de 3 px + marca cheia | P11 |
| 13 | C | Opção do select sem cor fixa | P12 |
| — | B | Ocupado (H3) com "Transferindo…" e linhas desabilitadas; `onRetry={refresh}`; grupos renomeados "Online"/"Offline" (sai "Disponíveis", que colidia com o nível) | |

**Para onde vai o que sai**

| Sai | Vai para | Tipo |
|---|---|---|
| Pílula de carga ("Disponível", "Em atendimento", "Movimentado", "Carga alta") | "N atendimentos" na linha 2 + "Carga alta" a partir de 10 + ordem "Menor carga"; o nome acessível da linha leva presença, número e (D2) o nível por extenso | dado |
| Dica ("Atendendo normalmente", "Alto volume no momento", "Não está disponível no momento") | Nada: repetia o nível — e "Atendendo normalmente" com 0 conversas era falso | nada |
| 2ª pílula "Alta carga de atendimentos" | "Carga alta" na linha 2 | dado |
| Cor de carga no ponto | Ponto de presença por forma; a carga fica no número | dado |
| Divisória vertical e ícone de conversa | Nada | nada |
| Rótulo empilhado "Ordenar por" | Nome acessível do select; o valor fica visível | dado |
| Ícone do cabeçalho e descrição | Nada: o título diz a tarefa | nada |
| Nota de consequência sempre visível | Mesmo lugar, visível quando a ação fica disponível; antes disso o lugar diz o que falta | dado |
| Grupo "Disponíveis" | "Online" | dado |

### 2.4 Ids do Apêndice A

- **Resolve:** ATD-TRF-03, -16, -17, -19, -20, -22, -25.
- **Muda:** ATD-TRF-01, -02, -09, -10, -11, -12, -13, -14, -15 (níveis: D2), -18 (`title` do
  ponto → forma + nome acessível), -21, -23 (posição do erro), -26.
- **Não resolve:** ATD-TRF-05 (recarga sem indicação: regra do `useAsyncResource`, E4); ATD-TRF-24
  (sucesso sem confirmação: D5); ATD-TRF-27 (admin transfere a própria conversa e ela fica na lista:
  o backend não emite `conversation:removed` para admin — lista da mesa, E4; nada no overlay
  resolve sem tocar o backend).

### 2.5 Riscos e testes

- `loadLevel` é exportado e testado (TransferModal.test.jsx:146-157); o teste de linha procura
  "Disponível", "Atendendo normalmente", "Carga alta", "Alta carga de atendimentos", "Não está
  disponível no momento" (:79-105) — reescrever junto; D2 decide o que `loadLevel` devolve. Os
  limites 1/5/10 são escolha de produto registrada (memória `project_transfer_modal_visual`).
- O teste de ordenação lê `.truncate` (:120): manter um seletor estável.
- Supervisão: provar pilha de 2 níveis (modal de conversa + Transferir), ESC com ocupado não fecha
  nenhum dos dois, foco volta ao botão "Transferir" do modal de baixo.
- Ouvintes de ESC presos direto no `document` (MessageInput.jsx:190, SideNav.jsx:104,
  SupervisionPage.jsx:78) rodam **independentemente da pilha** — estão no mesmo nó, e o
  `stopPropagation` de ui/dialogStack.js:48 não os detém. Testar ESC com o diálogo ocupado e um
  popover/menu aberto por baixo (vale para os cinco overlays).
- Nome acessível da linha, ex.: "Pedro Henrique, online, 12 atendimentos, carga alta".
- Harness: 480 px com nome longo (corte com reticências) e 20 atendentes em 1366×768 (só o corpo
  rola).

---

## 3. Encerrar atendimento (motivo) — `components/CloseReasonModal.jsx` + `closeReasonCatalog.jsx`

Aberto por "Encerrar" no cabeçalho da conversa (ConversationView.jsx:651); montado em
ConversationView.jsx:979-985 (também dentro do modal de conversa da Supervisão). Remonta a cada
abertura.

### 3.1 Estrutura hoje

| Medida | Hoje | Onde |
|---|---|---|
| Largura | 820 px | :79 |
| Regiões | cabeçalho (× + ícone tonal **perigo** + título + descrição) · corpo rolável com grade de cartões · rodapé à mão (nota + 2 botões) | :72-80, :82-101, :103-123 |
| Controles | × + *N* rádios + Cancelar + Encerrar = **N + 3** | |
| Cartão | 5 elementos: ladrilho 44 px com ícone colorido, nome 15/600, legenda 12,5, rádio desenhado, moldura com fundo e borda; ~68 px de altura | :12-46 |
| Grade | 1 coluna; 2 a partir de `md` (**viewport**) | :88 |
| Camadas sob o nome | **3**: véu → painel → cartão `bg-wa-panel-header`; sob o ícone, **4** (+ ladrilho de 14%) | :14, :20-21 |
| Cores de destaque | vermelho no ícone do cabeçalho (overlays.css:7); acento na escolha e no botão; o catálogo pinta cada motivo: vermelho, verde, azul, violeta, índigo, cinza, laranja (= acento), rosa, neutro — **até 7 famílias na grade ao mesmo tempo** | closeReasonCatalog.jsx:94-104, :106-116 |
| Ação principal | rodapé, à direita, **em acento** (:117) — o vermelho está no ícone de abertura, antes de qualquer decisão, e não no botão que encerra (contra 5.2.2) | :77-78, :113-121 |

**O que se repete**

- **7 das 9 legendas repetem o nome com outras palavras**: Cancelamento → "Solicitação de
  cancelamento", Instalação → "Nova instalação", Reativação → "Reativar serviço", Troca de senha →
  "Alteração de senha do cliente", Mudança de endereço → "Alteração de endereço", Resolvido pela IA
  → "Atendimento finalizado pela IA", Sem resposta → "Cliente não respondeu"
  (closeReasonCatalog.jsx:107-115). Só Financeiro e Suporte técnico acrescentam (:108, :114).
- Descrição "Selecione o motivo principal deste atendimento." (:76) + nome acessível do grupo
  "Motivo do contato" (:88): duas formulações para o mesmo rótulo, uma visível e outra não.
- Cor de motivo colide com cor de sentido: "Cancelamento" no vermelho de perigo, "Suporte técnico"
  no laranja do acento, "Resolvido pela IA" no índigo/lilás que a E2 tira da IA.
- **Autoria omitida:** o cartão sugerido pela IA vem marcado e nada diz que foi a IA (nota de
  deduplicação do Apêndice A, abaixo de ATD-ENC-18).

### 3.2 Problemas

| # | Classe | Problema | Evidência |
|---|---|---|---|
| 1 | S | 820 px e cartões de ~68 px | :79, :12-46 |
| 2 | S | Ladrilho de 44 px por cartão (uma camada e um bloco a mais por motivo) | :18-24 |
| 3 | S | Ícone de cabeçalho | :77 |
| 4 | S | Descrição que é, na verdade, o rótulo do grupo | :76, :88 |
| 5 | S | 2 colunas por viewport (`md:`), não por espaço do diálogo | :88 |
| 6 | S | Pré-seleção da IA sem autoria | :55 |
| 7 | S | Erro no fim do corpo rolável | :100 |
| 8 | S | Nada diz que falta escolher o motivo (botão cinza) | :116 |
| 9 | S | Legendas que só parafraseiam o nome (DECISÃO D3) | closeReasonCatalog.jsx:107-115 |
| 10 | C | Perigo no lugar errado: vermelho na abertura, acento no botão que encerra | :78, :117 |
| 11 | C | 7 famílias do catálogo (P2: cor categórica só em gráfico) | closeReasonCatalog.jsx:94-104 |
| 12 | C | Cartão com fundo e borda | :14-16 |
| — | B | Erro de carga sem "Tentar de novo" (ATD-ENC-03; `refresh` existe em hooks/useReasons.js:8); caminho desatualizado no vazio: "Configurações → Motivos" vs o menu real "Cadastros auxiliares → Motivos de atendimento" (navigation/navItems.js:82-84, ATD-ENC-05); sugestão da IA fora da lista deixa o botão habilitado com um motivo invisível (ATD-ENC-09); fechar no envio (ATD-ENC-14, -17); rádios trocam durante o envio | |

### 3.3 Proposta estrutural

```
Encerrar atendimento                                              [×]
────────────────────────────────────────────────────────────────────
Motivo do contato
  $  Financeiro                     ( )    🔧 Instalação            ( )
     Boletos, pagamentos, faturas            Nova instalação
  🎧 Suporte técnico                (•)    ⌂  Mudança de endereço   ( )
     Dúvidas, problemas técnicos · ✦ Sugerido pela IA
────────────────────────────────────────────────────────────────────
[erro]                                                               ← H1
O cliente recebe a mensagem de encerramento…   [Cancelar] [Encerrar atendimento]  ← perigo
(sem motivo escolhido: "Escolha o motivo do contato." — H2)
```

| # | Classe | Mudança | Resolve |
|---|---|---|---|
| 1 | S | 820 → **640 px** | P1 |
| 2 | S | Cartão vira linha da lista H6: sai o ladrilho, ícone de 20 px, nome 14/600, legenda 13 em tinta-2; altura ~52 px | P1, P2 |
| 3 | S | Sai o ícone do cabeçalho (H4, D1) | P3 |
| 4 | S | Sai a descrição; o grupo ganha a legenda **visível** "Motivo do contato" (o texto que hoje é só `aria-label`, :88) | P4 |
| 5 | S | Duas colunas por `@container` (corpo ≥ 520 px), uma abaixo disso | P5 |
| 6 | S | "Sugerido pela IA" (ícone da IA + texto) na linha 2 do motivo que veio de `suggestedReasonId`, marcado ou não | P6 |
| 7 | S | Erro na região fixa (H1) | P7 |
| 8 | S | Nota do rodapé alterna (H2): sem motivo, "Escolha o motivo do contato."; com motivo, a consequência de hoje | P8 |
| 9 | S | (se D3 = b) legenda só onde acrescenta | P9 |
| 10 | C | Perigo no botão final "Encerrar atendimento" (`Button danger`); o check dentro do botão (:119) sai | P10 |
| 11 | C | Ícones do catálogo em tinta-2: `describeReason` continua achando **ícone e legenda pelo nome** (inclusive apelidos, closeReasonCatalog.jsx:130-146); só `color`/`background` deixam de ser usados | P11 |
| 12 | C | Sem fundo e borda de cartão; escolha por `--color-selecionado` + barra + marca | P12 |
| — | B | Ocupado (H3) com "Encerrando…" e rádios em `<fieldset disabled>`; `onRetry={refresh}`; `suggestedReasonId` só pré-seleciona (e só ganha o selo) se estiver em `reasons`; vazio com o caminho real ("Configurações → Cadastros auxiliares → Motivos de atendimento") | |

**Para onde vai o que sai**

| Sai | Vai para | Tipo |
|---|---|---|
| Ladrilho colorido do ícone | O mesmo desenho, 20 px, em tinta-2, achado pelo nome como hoje | nada (a cor não distinguia nada que o nome não diga) |
| Ícone vermelho do cabeçalho | Perigo no botão final | ação |
| Descrição "Selecione o motivo principal deste atendimento." | Legenda visível "Motivo do contato" | dado |
| Check dentro do botão final | Nada | nada |
| Legendas-paráfrase (só se D3 = b) | O nome do motivo, que já dizia o mesmo | nada |
| Nota de consequência sempre visível | Mesmo lugar, visível quando há motivo escolhido | dado |

### 3.4 Ids do Apêndice A

- **Resolve:** ATD-ENC-03, -05, -09, -13, -14, -17; a nota de deduplicação (autoria da IA).
- **Muda:** ATD-ENC-01, -02, -06, -07, -08 (+ selo), -10, -11, -12 (`@container`), -15 (posição),
  -18.
- **Não resolve:** ATD-ENC-04 (403 sem `role`: primitivo `AsyncState`, E4); ATD-ENC-16 (sucesso sem
  confirmação: D5).

### 3.5 Riscos e testes

- `CloseReasonModal.test.jsx` (12 testes): "mostra a legenda do catálogo só para motivos
  conhecidos" (:113) depende de D3; "the confirm button is disabled until a reason is selected"
  (:29) continua valendo.
- Perigo no botão final **sem** virar foco inicial: o foco inicial é o rádio marcado
  (ui/Dialog.jsx:77-80) ou o primeiro rádio; testar que nunca é o botão.
- A mesma mudança aparece no modal de conversa da Supervisão (admin encerra conversa de outro) —
  o componente é este, a área é da E5.
- Lista vazia trava todo encerramento (memória `project_close_reasons_and_report`): o vazio tem de
  continuar claro e o botão, travado.
- Harness: 12 motivos em 683×384 — só o corpo rola; perigo ≥ 4,5:1 sobre elevado; 2 colunas só
  quando o corpo passa de 520 px.

---

## 4. Confirmação "Finalizar sem motivo" — `ConversationListItem.jsx` + `useConfirm` + `ConfirmDialog`

Gatilho: botão ✓ irmão da linha nas abas Espera e Automação (ConversationListItem.jsx:189-193);
`handleQuickClose` (:88-92) chama `confirm('Finalizar esse atendimento sem informar o motivo?',
{ danger: true, confirmLabel: 'Finalizar' })`. O mesmo item está na Supervisão
(SupervisionPage.jsx:150, :627, :636).

### 4.1 Estrutura hoje

| Medida | Hoje | Onde |
|---|---|---|
| Largura | 480 px (overlays.css:159 vence o `max-w-sm` = 384 px) | ui/ConfirmDialog.jsx:19 |
| Regiões | **sem cabeçalho** (sem título) · corpo em grade (ícone 36 px + texto) · ações **dentro do corpo**, separadas por linha | ui/ConfirmDialog.jsx:30-37 · overlays.css:160-164 |
| Controles | **2**: Cancelar (foco inicial) e Finalizar (perigo); sem × | ui/ConfirmDialog.jsx:25, :35-36 |
| Ícones | **1**: aviso 22 px em ladrilho de 36 px com fundo vermelho-claro | :31 · overlays.css:161-162 |
| Camadas sob a mensagem | 2 (véu → painel) | |
| Cores | 1 família: perigo (ícone + botão) | |
| Dados | **não diz qual atendimento** (nenhum nome) nem a consequência — numa lista que reordena em tempo real | ConversationListItem.jsx:90 |
| Leitor de tela | nome = mensagem e descrição = a mesma mensagem: **lida duas vezes** | ui/ConfirmDialog.jsx:21-22 |
| Onde o diálogo mora | **um `useConfirm` por item** (:46) e o diálogo dentro do `<li>` (:194): uma instância por item da aba; se o item sai da fila com o diálogo aberto (outro atendente assumiu, a triagem mudou de aba, outro finalizou), o `<li>` desmonta e **o diálogo some sem explicação** | ConversationListItem.jsx:46, :194 |
| Depois de confirmar | o diálogo já fechou; `closeConversation(...).catch(() => {})` — sem "enviando", sem erro; o item só some com `queue:removed`; dá para confirmar de novo | DashboardPage.jsx:90-92 |
| Mesmo diálogo, outro comportamento | na Supervisão a falha vira uma linha de erro no topo da página | SupervisionPage.jsx:394-399 |

### 4.2 Problemas

| # | Classe | Problema | Evidência |
|---|---|---|---|
| 1 | S | Sem título; decisão sobre "esse atendimento" sem dizer qual | ui/ConfirmDialog.jsx:16-29; ConversationListItem.jsx:90 |
| 2 | S | Consequência ausente (o que acontece com o cliente e com o Relatório) | ConversationListItem.jsx:90 |
| 3 | S | Ícone em ladrilho que repete o que o botão vermelho já diz (6.6: perigo só no destrutivo) | ui/ConfirmDialog.jsx:31 |
| 4 | S | Nenhum lugar para o erro: o diálogo fecha antes do resultado | DashboardPage.jsx:91 |
| 5 | C | Ladrilho e ícone em vermelhos fixos (`#d97c7210`, `#e7aaa0`) | overlays.css:162 |
| — | B | Falha muda (ATD-ITEM-25); sem "Finalizando…" e confirmação dupla possível (ATD-ITEM-24); leitura dupla no leitor de tela; diálogo preso ao item | |

### 4.3 Proposta estrutural

```
Finalizar sem motivo?
──────────────────────────────────────────────
Maria Souza sai da fila e o atendimento entra
no Relatório como "Sem motivo".
[erro, se houver]                              ← H1
──────────────────────────────────────────────
                      [Cancelar] [Finalizar]   ← perigo; "Finalizando…" no envio
```

| # | Classe | Mudança | Resolve |
|---|---|---|---|
| 1 | S | Título h2 "Finalizar sem motivo?" (H5) e mensagem com **o nome do cliente** (o mesmo `nameLabel` da linha, :51) | P1 |
| 2 | S | Consequência na mensagem. **Verificada no backend:** fechar sem motivo grava `reasonId` nulo (src/api/conversations.routes.js:568-581) e o Relatório tem a fatia "Sem motivo" (5.2.3). **Não prometer** mensagem ao cliente: `sendClosingMessageIfApplicable` só envia com protocolo (src/assignment-messages/assignment-message.service.js:26-27), e conversa de fila em geral não tem | P2 |
| 3 | S | Sai o ícone; o perigo fica no botão final | P3 |
| 4 | S | Região de erro dentro do diálogo (H1): o diálogo **fica aberto até a resposta** | P4 |
| 5 | C | Perigo pelos tokens `--color-perigo`/`-fundo` | P5 |
| — | B | Ação assíncrona pelo `useConfirm({ acao })` (H5): "Finalizando…", botões travados, ESC consumido; fecha no sucesso; mostra o erro traduzido na falha. `quickCloseConversation` da mesa devolve a promessa (sai o `.catch(() => {})`, DashboardPage.jsx:91); na Supervisão sai a linha de erro da página para este caso (SupervisionPage.jsx:397-399), porque o erro passa a aparecer no diálogo | |
| — | B | **Um diálogo por lista, não por item:** a confirmação sobe para quem é dono do `onQuickClose` (DashboardPage/SupervisionPage) e recebe `{ id, nome }`. O diálogo não some mais com o item; se o atendimento saiu da fila no meio, o backend devolve 409 e a tela mostra "Este atendimento não está com você, ou já foi encerrado." (utils/errorMessages.js:33, já traduzido). Sai uma instância de `useConfirm` por item da lista memoizada | |

**Para onde vai o que sai**

| Sai | Vai para | Tipo |
|---|---|---|
| Ícone de aviso em ladrilho | Botão final em perigo + título em forma de pergunta | nada |
| Diálogo dentro de cada `<li>` | Um diálogo no dono da lista (mesa e Supervisão) | ação |

### 4.4 Ids do Apêndice A

- **Resolve:** ATD-ITEM-24, ATD-ITEM-25.
- **Muda:** ATD-ITEM-23 (título, nome, consequência), PRM-CNF-01 (base: título, sem ícone, rodapé,
  ação assíncrona — vale para as 14 confirmações de fora da mesa), SUP-LIN-15 (mesmo diálogo; área
  da E5), ATD-ITP-06 (a variante padrão usa o mesmo caminho, :279-289).
- **Não resolve:** ATD-ITEM-26 e SUP-LIN-18 (sucesso sem confirmação: D5).
- Obs.: ATD-ITP-01 é duplicata de CVM-ENC-08 (seleção no popup Encerrados) e não tem relação com a
  confirmação.

### 4.5 Riscos e testes

- `useConfirm` tem 14 chamadores fora da lista (CitiesAdminTab, PlansAdminTab, ReasonsAdminTab,
  SectorsAdminTab, TemplatesAdminTab, TriageAdminTab, os três `*Row` de messages,
  useChannelActions, useAlert…): `title` e `acao` são opcionais e a API atual não muda, **mas**
  tirar o ícone da base muda todas as confirmações do sistema (6.6: "os demais herdam a pele").
  CFG-CAN-39 ("Reexibir" com `danger`) continua errado até a E6.
- `hooks/useConfirm.test.jsx:78` ("segundo confirm() enquanto o primeiro está pendente resolve
  false"): com `acao`, o pendente dura até a resposta — manter a regra.
- `ConversationListItem.test.jsx:391-493` (confirmação aberta pelo item, Enter/Espaço no ✓ sem
  abrir a conversa): passam a precisar do dono da lista; manter um teste de integração
  lista + confirmação, e o de ConversationListItem.jsx:74-86 (tecla no ✓ não abre a conversa).
- **Memo da lista** (teste "40 → 0/1"): `onQuickClose` continua estável (`useCallback`,
  DashboardPage.jsx:90) e o item deixa de carregar `confirmDialog` — provar que o re-render não
  sobe. Na Supervisão `quickCloseConversation` não é `useCallback` (SupervisionPage.jsx:394):
  estabilizar ao mexer.
- **Foco devolvido:** com o diálogo no dono da lista, ao fechar o foco volta ao ✓ se ele existir; se
  o item saiu, o Dialog procura o topo da pilha (ui/Dialog.jsx:217-231) e, sem pilha, o foco cai no
  `<body>`. Precisa de destino de reserva (o campo de busca da lista) e de teste.

---

## 5. Enviar template — `components/SendTemplateModal.jsx`

Aberto por "Enviar template" nos avisos de janela (ConversationView.jsx:905 — janela fechada;
:932 — indeterminada com recusa 131047); montado em ConversationView.jsx:954-960.

### 5.1 Estrutura hoje

| Medida | Hoje | Onde |
|---|---|---|
| Largura | 864 px (`max-w-[54rem]`) | :58 |
| Regiões | cabeçalho (× + título + descrição de 2 frases) · corpo `DialogBody` em grade de 2 colunas (lista \| variáveis + prévia) · rodapé `DialogFooter` [Cancelar][Enviar] | :56-64, :65-145, :146-162 · overlays.css:85-93 |
| Controles | × + *N* botões de template + *V* variáveis + Cancelar + Enviar | |
| Cabeçalho | título + descrição; 0 ícones | :59-60 |
| **Antes de escolher** | a coluna da direita fica vazia: `.dialog-template-compose:empty{display:none}` esconde o bloco, mas a grade mantém as duas trilhas (.9fr / 1.1fr): a lista ocupa ~45% da largura e o resto do diálogo é vazio | overlays.css:85, :87, :92 |
| Camadas | nome do template: **3** (véu → painel → botão `bg-white/[0.04]` ou escolhido `bg-chat-orange/10`); texto da prévia: **3** (→ `bg-white/[0.06]`) | :83-87, :120 |
| Cores de destaque | **3**: acento (escolha :85, botão :158); azul `#53bdeb` (botões da prévia :129); perigo (erro :144) | |
| Ação principal | rodapé, à direita, "Enviar" / "Enviando…" | :154-161 |

**O que se repete**

- O corpo do template aparece **duas vezes** com o escolhido: no item da lista (SendTemplateModal.jsx:90,
  cortado em 2 linhas por overlays.css:90) e na prévia (SendTemplateModal.jsx:121).
- A descrição "A janela de 24h está fechada. Só template aprovado é entregue até o cliente
  responder." (:60) repete a faixa que abriu o diálogo (ConversationView.jsx:900-902) — e é
  **falsa** quando ele vem do aviso "indeterminada" (ConversationView.jsx:923-932; CV-TPL-01).

**Achados lidos no código**

- Escolha por botão `aria-pressed` (:82): o 4º padrão de "escolha 1 de N" do grupo.
- Carregando/erro/vazio em `<p>` soltos (:67-73), sem `AsyncState`, esqueleto nem "Tentar de novo";
  sem `channelId` fica "Carregando…" para sempre (:25, CV-TPL-02).
- O vazio manda para "Configurações → Templates" (:71); o caminho real é "Configurações → Mensagens
  → Templates WhatsApp" (navigation/navItems.js:58-62), e o filtro é a finalidade
  **atendimento** (:26) — o texto não diz que um template de disparo não serve (memória
  `project_template_purpose`).
- Erro em `<p role="alert">` à mão (:144), não `WaError`.
- Durante o envio a lista segue clicável: `escolher()` zera as variáveis (:34-38) no meio do envio.

### 5.2 Problemas

| # | Classe | Problema | Evidência |
|---|---|---|---|
| 1 | S | 864 px em 2 colunas com a direita vazia até escolher; regra `@media(max-width:680px)` por viewport | :58 · overlays.css:85-93, :207 |
| 2 | S | Texto do template repetido (lista + prévia) | :90, :121 |
| 3 | S | Escolha por `aria-pressed` em vez de grupo de rádio; padrão diferente do Iniciar | :79-83 |
| 4 | S | Nada diz o que falta para enviar (template? qual variável?) | :53, :157 |
| 5 | S | Erro no fim do corpo rolável | :144 |
| 6 | S | Carregando/erro/vazio sem esqueleto nem "Tentar de novo" | :67-73 |
| 7 | C | Escolha em laranja tingido (`border-chat-orange/60 bg-chat-orange/10`) em vez de selecionado + barra | :85 |
| 8 | C | Botões da prévia em azul `#53bdeb` | :129 |
| 9 | C | Itens, campos e prévia em branco translúcido empilhado | :86, :109, :120, :129 |
| — | B | Fechar com envio em curso (CV-TPL-15); descrição fixa (CV-TPL-01); `channelId` ausente (CV-TPL-02); caminho do vazio desatualizado (CV-TPL-04); lista clicável no envio | |

### 5.3 Proposta estrutural

```
Enviar template                                                  [×]
Janela de 24h fechada: só template aprovado é entregue.   ← texto conforme o aviso de origem
────────────────────────────────────────────────────────────────────
Template
  confirmar_visita                                            (•)
  Olá {{1}}, podemos agendar para {{2}}?                    (1 linha)
  aviso_tecnico                                               ( )
  Seu técnico está a caminho.
Variável 1 [ Maria  ]   Variável 2 [          ]
Prévia
  ┌──────────────────────────────────────┐
  │ Olá Maria, podemos agendar para {{2}}? │   ← bolha de saída
  └──────────────────────────────────────┘
  Se o cliente tocar num botão, a resposta chega no chat e reabre a janela de 24h.
────────────────────────────────────────────────────────────────────
[erro]                                                               ← H1
Preencha a Variável 2.                               [Cancelar] [Enviar]   ← H2
```

| # | Classe | Mudança | Resolve |
|---|---|---|---|
| 1 | S | 864 → **576 px**, uma coluna: lista → variáveis → prévia. Acaba a metade vazia e a regra por viewport de overlays.css:207 para este diálogo | P1 |
| 2 | S | Item da lista com **uma** linha do corpo; o texto inteiro fica só na prévia | P2 |
| 3 | S | Escolha de template compartilhada (H7): `role="radiogroup"` com linha-rádio (H6), a mesma do Iniciar conversa | P3 |
| 4 | S | Nota do rodapé com o motivo (H2): "Escolha um template." / "Preencha a Variável 2." — ligado ao botão por `aria-describedby` | P4 |
| 5 | S | Erro na região fixa (H1), em `WaError` | P5 |
| 6 | S | Carregando com esqueleto em forma de linha; erro com "Tentar de novo"; vazio — tudo pelo `AsyncState` | P6 |
| 7 | C | Escolha em `--color-selecionado` + barra + marca | P7 |
| 8 | C | Botões da prévia em tinta neutra | P8 |
| 9 | C | Prévia na cor da bolha de saída (é o que o cliente recebe) e campos em `--color-campo`; sai o branco translúcido | P9 |
| — | B | Descrição conforme a origem: prop `motivo` (`'fechada'` \| `'recusada'`) passada pelos dois avisos (ConversationView.jsx:905, :932). Ocupado (H3) com "Enviando…" e lista/campos travados. Sem `channelId`: erro em vez de carga eterna. Vazio: "Nenhum template de atendimento aprovado neste canal. Cadastre um com a finalidade Atendimento em Configurações → Mensagens → Templates WhatsApp." | |

**Para onde vai o que sai**

| Sai | Vai para | Tipo |
|---|---|---|
| Coluna da direita (variáveis + prévia) | Abaixo da lista, na mesma coluna | dado + ação |
| 2ª linha do corpo no item da lista | A prévia | dado |
| Descrição fixa "A janela de 24h está fechada…" | Descrição conforme o aviso que abriu o diálogo | dado |

### 5.4 Ids do Apêndice A

- **Resolve:** CV-TPL-01, -02, -03, -09, -15.
- **Muda:** CV-TPL-04 (texto), -05 (seleção), -06, -07, -08, -10, -11 (posição do erro), -12, -13,
  -14 (sem `@media`: uma coluna sempre).

### 5.5 Riscos e testes

- `SendTemplateModal.test.jsx` (9 testes) acha os templates por `role: 'button', name:
  /aviso_tecnico/` (:38): passa a `radio`. "titulo e acoes ficam fora do unico eixo de rolagem"
  (:36-53) continua valendo e protege o eixo único; o nome do botão "Enviar" fica.
- **Pré-seleção:** o Iniciar já pré-seleciona o 1º template (StartConversationModal.jsx:77) e o
  Enviar template não (:19). O componente compartilhado recebe isso por prop: não unificar em
  silêncio (mudaria o número de cliques de um lado ou do outro).
- A prévia como bolha **não** pode depender do CSS da conversa (`conversa.css`, 5.8): só tokens.
- O `ConversationView` não remonta na troca de conversa (memória
  `project_chat_state_survives_conversation_switch`): `motivo` é lido na abertura; e se a conversa
  some da mesa com o envio em curso (encerrada por outro), o `ConversationView` desmonta e leva o
  modal — o erro se perde (CLASSE-01, E4).
- Harness: template de 3 botões e 2 variáveis em 1366×768 e 683×384.

---

## 6. Decisões do proprietário

| Id | Pergunta | Opções | Recomendação |
|---|---|---|---|
| **D1** | Ícone no cabeçalho dos diálogos da mesa | **(a)** nenhum: o título diz a tarefa (−1 elemento em Transferir e Encerrar); **(b)** ícone neutro de 20 px sem ladrilho em **todos** (acrescenta em Iniciar e Enviar template, que hoje não têm) | (a) — P4; o ladrilho tonal foi revogado em 24/09 e um ícone neutro só repetiria o título |
| **D2** | Níveis de carga no Transferir (limites 1/5/10 são escolha de produto) | **(a)** linha 2 = "N atendimentos" + "Carga alta" a partir de 10; os níveis 1–4 e 5–9 ficam no número e na ordem "Menor carga"; **(b)** manter os 4 níveis como texto neutro, renomeando "Em atendimento" (colide com o estado de conversa, P5) e "Disponível" (colide com o grupo); **(c)** manter como hoje (viola P2 e P5) | (a) — o número é o dado; o rótulo era a quarta forma de dizê-lo |
| **D3** | Legendas do catálogo de motivos | **(a)** manter as 9, neutras, na linha 2; **(b)** manter só as que acrescentam (Financeiro, Suporte técnico) — 7 são paráfrase do nome | (b), com o catálogo continuando a aceitar legenda para motivo futuro |
| **D5** | Confirmação de sucesso depois que o diálogo fecha (Transferir, Encerrar, Finalizar sem motivo — hoje a conversa só some) | **(a)** nada, como hoje; **(b)** uma linha "Atendimento de Maria transferido para Pedro." (texto + ícone de confirmação em tinta neutra, 5.2.2) na mesa vazia por alguns segundos, no `role="status"` único da mesa | (b) — cobre também o admin que transfere a própria conversa e continua vendo-a (ATD-TRF-27) |

(Não há D4: a pré-seleção de template fica como está em cada tela — ver 5.5.)

---

## 7. Resumo

Contagem das mudanças **propostas** (seções 0.3, 1.3, 2.3, 3.3, 4.3 e 5.3). B fica fora da conta
S × C.

| Overlay | S | C | B (fora da conta) | Ids resolvidos | S domina? |
|---|---|---|---|---|---|
| Base comum (visível em todo diálogo) | 3 | 2 | 1 (ocupado, H3) | — (habilita os de baixo) | sim |
| 1 · Iniciar conversa | 10 | 3 | 6 | 12 | sim |
| 2 · Transferir | 10 | 3 | 3 | 7 | sim |
| 3 · Encerrar (motivo) | 8 (9 com D3 = b) | 3 | 4 | 6 | sim |
| 4 · Finalizar sem motivo | 4 | 1 | 2 | 2 | sim |
| 5 · Enviar template | 6 | 3 | 4 | 5 | sim |
| **Total** | **41** (42) | **15** | **20** | **32** | **S = 73%** |

Em uma linha por overlay:

1. **Iniciar conversa** — de 768 px em duas colunas em zigue-zague para uma coluna de 576 px; o
   estado dos canais dito uma vez; sem faixa nem título para a regra do canal oficial; o template
   escolhido com o texto à vista, pelo mesmo componente do Enviar template; foco no Telefone.
2. **Transferir** — de 9 elementos e 5 cores por linha para 4 elementos em 2 linhas; presença por
   forma, carga por número; a escolha não some com a busca; o rodapé diz o que falta e avisa o
   offline.
3. **Encerrar** — cartões com ladrilho colorido viram linhas-rádio neutras; o vermelho sai da
   abertura e vai para o botão que encerra; a IA assina a sugestão.
4. **Finalizar sem motivo** — ganha título, o nome do cliente e a consequência; fica aberto até a
   resposta e mostra o erro; um diálogo por lista, não por item.
5. **Enviar template** — de 864 px com meia tela vazia para uma coluna de 576 px; o texto do
   template aparece uma vez (na prévia); o rodapé diz o que falta.

**Correção a levar ao Apêndice A:** ATD-INI-24 e ATD-INI-29 afirmam que "This template does not
belong to this channel's WABA" chega **crua**; em `e5236da` ela é traduzida
(utils/errorMessages.js:76). As duas linhas saem de C.4.1 (frase sem tradução) e ficam em CLASSE-01
(corrida).
