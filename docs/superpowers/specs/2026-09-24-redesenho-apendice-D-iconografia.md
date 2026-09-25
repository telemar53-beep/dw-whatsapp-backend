# Apêndice D — Iconografia: família, arquitetura e mapeamento

> Parte do spec `2026-09-24-redesenho-simplicidade-design.md` (seção 5.6). Base medida: `e5236da`.
> **Família decidida pelo proprietário em 24/09/2026 (decisão 3, seção 14.1): Tabler 3.48.0, só
> contorno, com o item ativo marcado por barra de 3 px + fundo.** A entrega (módulos, licença,
> mapeamento e pranchas) foi feita por subagente e **conferida de forma independente** — ver D.8.

## D.1 A decisão, em uma frase

**Corrigir a arquitetura dos ícones (vale para qualquer família) e vendorizar a Tabler 3.48.0, contorno
de traço 2, em três módulos por camada, sem nenhum ícone preenchido.** Razão do proprietário: o Safari
rebaixa tudo a cada carga, e 2,8 KB no caminho crítico não se pagam com ícone preenchido — barra e
fundo comunicam o ativo igualmente bem.

## D.2 Os números (build real, migração completa, arquitetura corrigida, contra hoje)

| Variante | Login (gzip) | "/" (gzip) |
|---|---|---|
| Só a arquitetura, ícones atuais | −4.694 B | +492 B |
| **Tabler, entrega final (contorno, Pix da Simple Icons)** | **−4.506 B** | **−879 B** |
| Phosphor, entrega com preenchidos (não escolhida) | −4.576 B | +2.429 B |

- **No login a família quase não pesa** — o ganho vem da arquitetura (D.4).
- **Em "/" a Tabler final economiza 3,3 KB contra a Phosphor** com preenchidos e fica 879 B abaixo de
  hoje: trocar todos os ícones do produto **reduz** o que a mesa baixa.
- Traço 2 na grade 24: a 16 px dá ~1,33 px, mais legível que o de 1 px da Phosphor; nos usos de
  12–13 px fica ~1,1 px e continua legível (prancha `tamanho-de-uso-zoom4x.png`).

## D.3 O estado ativo sem preenchido

P8 exige forma além de cor. No menu a forma é a **barra de 3 px do acento** + o fundo
`--color-selecionado` + `aria-current="page"`; o ícone continua contorno, na cor do acento. Nos
botões que alternam painel (SGP, Cliente) a forma é o fundo selecionado + `aria-expanded`. **Não
existe `*Fill` em nenhum módulo.**

## D.4 Arquitetura (entra na E2, independe da família)

Hoje o chunk de entrada — baixado no login e na tela "Sem acesso" — carrega 47 dos 48 ícones de
`WaIcons` (2.842 B gzip marginais) sem usar nenhum. As três causas:

1. `App.jsx` importa `LEGACY_REDIRECTS` de `navigation/navItems.js`, que importa 12 ícones;
2. `ProtectedRoute.jsx` importa `hasLevel` do mesmo arquivo;
3. `AccessDeniedPage.jsx` importa `IconLock` de `WaIcons`.

Correção: `hasLevel`, `SETTINGS_BASE` e `LEGACY_REDIRECTS` vão para `navigation/rotas.js` (sem ícone);
o cadeado da "Sem acesso" vem de `IconesEntrada.js`; os ícones de grupo em `navItems` viram booleano
(o desenho real já vem de `SettingsVisuals`). **Medido: login −4,7 KB gzip.**

Módulos (gerados a partir do pacote, **nunca editados à mão**; o cabeçalho de cada um diz como
regenerar):

| Módulo | Conteúdo | gzip (minificado, no build) | Onde carrega |
|---|---|---|---|
| `IconesEntrada.js` | cadeado | dentro da entrada | entrada (Sem acesso) |
| `IconesTrabalho.js` | 65 ícones da casca e da mesa (reexporta o cadeado) + spinner | ~3,3 KB | casca + mesa ("/") |
| `IconesConfig.js` | 18 ícones só de Configurações | ~0,85 KB | lazy, com Configurações |

**Ajuste de 24/09, depois da entrega:** o `IconSpark` (ícone da IA) saiu de `IconesConfig` para `IconesTrabalho` — a E2 o usa em quatro pontos da mesa (linha da Automação, sugestão da IA, bolha "Assistente IA", "Sugerido pela IA"), e importá-lo de Configurações puxaria esse módulo inteiro para "/". As duas fábricas de caminho são idênticas: a linha mudou de arquivo sem mudar um byte do desenho; a verificação de pixels foi repetida (84 exports, 0 falhas) e os hashes de `SHA256SUMS` são os novos. Os pesos da tabela acima eram de antes do ajuste (≈60 B passam de um módulo ao outro).

Precisão dos caminhos ajustada por ícone: a menor que não muda nenhum pixel acima de 64/255 a
16/20/24 px (82 ícones: 32 com 0 casas, 39 com 1, 8 com 2, 3 com 3; 16 com traços em caminhos
separados). Os 84 exports foram renderizados pelo próprio módulo e comparados pixel a pixel com o SVG
do pacote: **0 falhas**.

**Onde os módulos moram:** `frontend/src/components/icons/` (`IconesEntrada.js`, `IconesTrabalho.js`,
`IconesConfig.js`, `LICENSE-Tabler.txt`); a marca Pix em `frontend/src/assets/brands/pix.svg`, com uma
linha no README de marcas, igual ao WhatsApp. `WaIcons.jsx` e `SgpIcons.jsx` deixam de desenhar: na
E2 viram reexportações finas dos módulos (os 100+ pontos de import não mudam de uma vez) e somem na
E7, quando o último import for trocado.

## D.5 Lacunas e onde a Tabler fica pior que hoje

- **Pix — a única lacuna dos 83 significados.** O `IconPix` de hoje é um desenho próprio em
  `SgpIcons.jsx`, sem procedência: 4 quadrados girados, que **imitam** o símbolo do Pix. Opções
  medidas (acréscimo no módulo de trabalho): manter a imitação +48 B; `currency-real` da Tabler +55 B
  (diz "dinheiro", não Pix); `pix-logo` da Phosphor +139 B (traço 1,5 e segunda licença); **marca Pix
  da Simple Icons 16.0.0, +233 B, forma oficial, CC0** (conferida contra o pacote do npm, sha512
  igual). **Escolhida a Simple Icons:** é a política das outras marcas de terceiros (forma oficial,
  preenchida, como WhatsApp e Meta) e custa 185 B a mais que a imitação. *Não verificado:* se o
  manual da marca Pix do Banco Central aceita a versão monocromática em `currentColor`; se exigir a
  cor oficial, é `fill="#32BCAD"` nesse ícone (isento da regra do acento, como toda marca).
- **Código de barras (pior que hoje):** o `barcode` da Tabler é um quadro de leitura; a 16 px, no
  painel SGP, lê como "escanear". `file-barcode`, `receipt` e `file-invoice` não são melhores. Fica o
  `barcode` porque continua distinto de PDF e QR na mesma fileira, e o rótulo "Boleto" vai ao lado.
- **Robô (leve):** a 16 px fica mais carregado; a 20–22 px, onde é usado, está bom.
- **Entregue/lido (leve):** `checks` é mais largo que os tiques de hoje; `aria-label` e cor (spec 6.3)
  seguem distinguindo.
- **Trocas dentro da Tabler, por legibilidade na prancha:** Atendimento `messages` → `message-circle`
  (os dois balões se fundem a 16 px); Supervisão `binoculars` → `device-desktop-analytics` (some a
  19 px); Carga `antenna-bars-5` → `gauge` (quase some a 13 px); Enviar `send` → `send-2` (horizontal,
  como hoje). Os exports `IconSupervision` e `IconSignal` mantêm o nome.
- **Contorno em geral:** a interface fica mais leve que com os preenchidos de hoje — consequência da
  decisão, mais visível no botão Enviar (que continua no acento, spec 6.3).

## D.6 Defeitos do conjunto atual que a troca resolve

- Seis espessuras de traço convivendo (1,75 a 2,1), mais preenchidos.
- Um significado com vários desenhos: "fechar" com 5 formas (2 SVGs, `✕` ×2, `×`); "abrir" com 6;
  "check" com 6.
- Um desenho com vários significados: `IconTeam` é Supervisão, Equipe e Usuários; `IconCheckCircle`
  tem 5 significados; `IconHistory` é quase igual a `IconClock`.
- Desenhos com defeito: `IconMegaphone` (Campanhas) é o ícone de volume; `IconTransfer` com pontas
  invadindo a haste; `IconSettings` 1 unidade fora do centro; `IconClaim` (Assumir) é um "✓" solto;
  `IconPdfFile` com `#fff` fixo, ilegível a 16 px; **`IconLogout` desenha a seta entrando na porta**
  (é o ícone de "entrar").
- Emoji na prévia da lista (📷 🎤 🎥 📄 😀 📍 💠): o desenho muda por sistema e ignora o tema.
- Glifos como ícone: `⚠` ×2, `×`, `✕` ×2, `!`, `−`/`+` do zoom, `⌄`, `›` ×2, `←` ×2.
- **Licença:** `IconClose` é cópia literal do "close" do Material Icons (Apache-2.0), e Refresh, Edit,
  Search, ArrowLeft, Send e Mic derivam dele — o repositório não tem a licença nem NOTICE. A troca
  elimina a pendência.

## D.7 Licença

Tabler Icons é MIT, © 2020-2026 Paweł Kuna: manter o aviso e a permissão junto de toda cópia; não
exige atribuição na interface; permite uso comercial e white-label. Arquivo
`frontend/src/components/icons/LICENSE-Tabler.txt` (mesmo padrão de `OFL-Inter.txt`) e o comentário
`/** @license Tabler Icons 3.48.0 | MIT | … */` nos três módulos (conferido: sobrevive à minificação).
A marca Pix da Simple Icons é CC0 (sem obrigação) e é registrada no README de marcas.

## D.8 O que foi conferido de forma independente (e como)

Regra do projeto desde 24/09: saída de subagente não entra em documento sem conferência.

| Afirmação | Conferência | Resultado |
|---|---|---|
| Ícones no chunk de entrada | busca dos caminhos SVG de 6 ícones no `index-*.js` do build `e5236da` | 6/6 presentes |
| Três importações causam isso | leitura de `App.jsx`, `ProtectedRoute.jsx`, `AccessDeniedPage.jsx`, `navItems.js` | confirmado |
| Arquitetura dá −4,7 KB no login | build próprio numa cópia do `e5236da` só com as três mudanças | 87.534 → 82.862 B = **−4.672 B** (relatório: −4.694) |
| 0 falhas de pixel nos 84 exports | rodei de novo o `verif-tabler.mjs` (SSR de cada export a partir dos arquivos entregues × SVG do pacote, 16/20/24 px) | 84 verificados, 0 acima de 64/255; maior desvio 64 (IconChart) |
| Login −4.506 B e "/" −879 B | conta sobre os resultados do mesmo pipeline (linha de base `v-atual5`: login 87.534, "/" 158.284; Tabler final: 83.028 e 157.405) | confirmado |
| Mapeamento coerente com os módulos | exports dos três módulos × coluna "Export" da tabela D.9 | todos presentes |
| Folha final e tamanhos de uso | leitura própria de `folha-final-2x.png` e `tamanho-de-uso-zoom4x.png` | traço único, nenhum preenchido fora do Pix; as trocas da D.5 se justificam na prancha |

Não reproduzido por mim: o build de cada família (usei os resultados do pipeline) e o sha512 do pacote
da Simple Icons.

## D.9 Mapeamento completo (atual → Tabler)

"Módulo" diz em qual dos três módulos o ícone entra. "—" = fica como está (marcas de terceiros,
ilustração de vazio, miniatura de documento, marca do login). Contorno = `icons/outline/<nome>.svg`
do pacote `@tabler/icons` 3.48.0, traço 2.

| Atual | Significado | Contorno Tabler | Export | Módulo |
|---|---|---|---|---|
| IconSearch | busca | `search` | IconSearch | Trabalho |
| IconNewChat | adicionar | `plus` | IconNewChat | Trabalho |
| IconChevronDown | chevron-baixo | `chevron-down` | IconChevronDown | Trabalho |
| IconArrowLeft | voltar | `arrow-left` | IconArrowLeft | Trabalho |
| IconHistory | historico | `history` | IconHistory | Trabalho |
| IconTransfer | transferir | `arrows-left-right` | IconTransfer | Trabalho |
| IconCheckCircle (ConversationListItem.jsx, ConversationView.jsx, ChannelsTable.jsx) | encerrar | `circle-check` | IconCheckCircle | Trabalho |
| IconCheckCircle (SideNav.jsx) | encerrados | `archive` | IconArchive | Trabalho |
| IconClaim | assumir | `user-check` | IconClaim | Trabalho |
| IconClose | fechar | `x` | IconClose | Trabalho |
| IconAttach | anexo | `paperclip` | IconAttach | Trabalho |
| IconEmoji | emoji | `mood-smile` | IconEmoji | Trabalho |
| IconQuickReply | resposta-rapida | `bolt` | IconQuickReply | Trabalho |
| IconMic | microfone | `microphone` | IconMic | Trabalho |
| IconSend | enviar | `send-2` (trocado) | IconSend | Trabalho |
| IconTrash | lixeira | `trash` | IconTrash | Trabalho |
| IconStop | parar | `player-stop` | IconStop | Trabalho |
| IconPlay | play | `player-play` | IconPlay | Trabalho |
| IconPause | pause | `player-pause` | IconPause | Trabalho |
| IconDownload | download | `download` | IconDownload | Trabalho |
| IconPin | local | `map-pin` | IconPin | Trabalho |
| IconLock | cadeado | `lock` | IconLock | Entrada (reexportado em Trabalho) |
| IconBellOn | sino | `bell` | IconBellOn | Trabalho |
| IconBellOff | sino-mudo | `bell-off` | IconBellOff | Trabalho |
| IconChart | relatorio | `chart-bar` | IconChart | Trabalho |
| IconSettings | configuracoes | `settings` | IconSettings | Trabalho |
| IconLogout | sair | `logout` | IconLogout | Trabalho |
| IconTeam (TeamModal.jsx, TeamPanel.jsx, navItems.js) | equipe | `users` | IconTeam | Trabalho |
| IconTeam (navItems.js) | supervisao | `device-desktop-analytics` (trocado) | IconSupervision | Trabalho |
| IconWarning | alerta | `alert-triangle` | IconWarning | Trabalho |
| IconEmptyChat | — | — (fica como está) | — | — |
| IconChats | atendimento | `message-circle` (trocado) | IconChats | Trabalho |
| IconUser | cliente | `user` | IconUser | Trabalho |
| IconMegaphone | campanha | `speakerphone` | IconMegaphone | Trabalho |
| IconChannel | canal | `device-mobile` | IconChannel | Config |
| IconSpark | ia | `sparkles` | IconSpark | Trabalho |
| IconRules | regras | `list-check` | IconRules | Config |
| IconPlug | integracoes | `plug` | IconPlug | Config |
| IconTags | tag | `tag` | IconTag | Trabalho |
| IconBuilding | empresa | `building` | IconBuilding | Config |
| IconUserPlus | adicionar-usuario | `user-plus` | IconUserPlus | Config |
| IconMore (TemplatesAdminTab.jsx) | mais-v | `dots-vertical` | IconMoreVertical | Config |
| IconMore (DataTable.jsx, ChannelsTable.jsx) | mais-h | `dots` | IconMore | Config |
| IconRefresh | atualizar | `refresh` | IconRefresh | Trabalho |
| IconInfo | info | `info-circle` | IconInfo | Trabalho |
| IconFile (TemplatesAdminTab.jsx, SettingsVisuals.jsx) | template | `file-text` | IconFileText | Config |
| IconFile (SgpQueryPage.jsx) | arquivo | `file` | IconDocument | Trabalho |
| IconClock | relogio | `clock` | IconClock | Trabalho |
| IconServer | servidor | `server` | IconServer | Config |
| IconBrain | ia-cerebro | `brain` | IconBrain | Config |
| IconEdit | editar | `pencil` | IconEdit | Config |
| Sgp.IconPix | pix | — (a Tabler não tem) → marca Pix da Simple Icons 16.0.0, `icons/pix.svg`, CC0, preenchida | IconPix | Trabalho |
| Sgp.IconBarcode | codigo-barras | `barcode` | IconBarcode | Trabalho |
| Sgp.IconQrCode | qr | `qrcode` | IconQrCode | Trabalho |
| Sgp.IconPdfFile | pdf | `file-type-pdf` | IconPdfFile | Trabalho |
| Sgp.IconInvoiceLink | link | `link` | IconInvoiceLink | Trabalho |
| Sgp.IconIdCard | documento-cpf | `id` | IconIdCard | Trabalho |
| Sgp.IconClose | fechar | `x` | IconClose | Trabalho |
| Sgp.IconSpinner | carregando | `loader-2` | IconSpinner | Trabalho |
| Sgp.IconCheck | check | `check` | IconCheck | Trabalho |
| SettingsVisuals.BranchIcon (SettingsVisuals.jsx) | triagem | `hierarchy` | IconTree | Config |
| SettingsVisuals.MoonIcon | noturno | `moon-stars` | IconMoon | Config |
| SettingsVisuals.BranchIcon (SettingsVisuals.jsx) | setores | `stack-2` | IconStack | Config |
| SettingsVisuals.PlaceIcon | local | `map-pin` | IconPin | Trabalho |
| Reports.IconConversationCheck | encerrar | `circle-check` | IconCheckCircle | Trabalho |
| Reports.IconClock | relogio | `clock` | IconClock | Trabalho |
| Reports.IconReply | responder | `arrow-back-up` | IconReply | Config |
| Reports.IconUsers | equipe | `users` | IconTeam | Trabalho |
| Reports.IconLayers | setores | `stack-2` | IconStack | Config |
| Reports.IconInbox | caixa-entrada | `inbox` | IconInbox | Config |
| Reports.IconAlert | alerta | `alert-triangle` | IconWarning | Trabalho |
| Reports.IconDownload | download | `download` | IconDownload | Trabalho |
| Reports.IconTag | tag | `tag` | IconTag | Trabalho |
| Reports.IconCalendar | calendario | `calendar` | IconCalendar | Config |
| Reports.IconChevron | chevron-baixo | `chevron-down` | IconChevronDown | Trabalho |
| TransferModal.IconArrowRight | seta-direita | `arrow-right` | IconArrowRight | Trabalho |
| TransferModal.IconBars | carga | `gauge` (trocado) | IconSignal | Trabalho |
| ChannelVisuals.QrStatusIcon | qr | `qrcode` | IconQrCode | Trabalho |
| ChannelVisuals.VisibilityIcon | exibir | `eye` | IconEye | Config |
| ChannelVisuals.MarcaWhatsApp | — | — (fica como está) | — | — |
| ChannelVisuals.MarcaMeta | — | — (fica como está) | — | — |
| Campaigns.atualizar | atualizar | `refresh` | IconRefresh | Trabalho |
| Campaigns.nova | adicionar | `plus` | IconNewChat | Trabalho |
| Supervision.chevron | chevron-baixo | `chevron-down` | IconChevronDown | Trabalho |
| Ticks.Tick (enviado) | check | `check` | IconCheck | Trabalho |
| Ticks.Tick x2 (entregue/lido) | lido-entregue | `checks` | IconChecks | Trabalho |
| Login.SignalMark | — | — (fica como está) | — | — |
| closeReason.cancel | cancelamento | `circle-x` | IconCancel | Trabalho |
| closeReason.dollar | financeiro | `cash` | IconMoney | Trabalho |
| closeReason.wrench | instalacao | `tool` | IconWrench | Trabalho |
| closeReason.pin | local | `map-pin` | IconPin | Trabalho |
| closeReason.refresh | reativacao | `power` | IconPower | Trabalho |
| closeReason.robot | robo | `robot` | IconRobot | Trabalho |
| closeReason.bellOff | sem-resposta | `message-circle-off` | IconChatSlash | Trabalho |
| closeReason.headset | suporte | `headset` | IconHeadset | Trabalho |
| closeReason.key | senha | `key` | IconKey | Trabalho |
| closeReason.tag | tag | `tag` | IconTag | Trabalho |
| closeReason.header | atendimento | `message-circle` (trocado) | IconChats | Trabalho |
| closeReason.checkCircle | encerrar | `circle-check` | IconCheckCircle | Trabalho |
| MessageAttachment.miniaturaDoc | — | — (fica como está) | — | — |
| emoji 📷 | foto | `photo` | IconImage | Trabalho |
| emoji 🎤 | microfone | `microphone` | IconMic | Trabalho |
| emoji 🎥 | video | `video` | IconVideo | Trabalho |
| emoji 📄 | arquivo | `file` | IconDocument | Trabalho |
| emoji 😀 | figurinha | `sticker` | IconSticker | Trabalho |
| emoji 📍 | local | `map-pin` | IconPin | Trabalho |
| emoji 💠 | pix | — (a Tabler não tem) → marca Pix da Simple Icons 16.0.0, `icons/pix.svg`, CC0, preenchida | IconPix | Trabalho |
| glifo ⚠ | alerta | `alert-triangle` | IconWarning | Trabalho |
| glifo × | fechar | `x` | IconClose | Trabalho |
| glifo ✕ | fechar | `x` | IconClose | Trabalho |
| glifo ! | falha | `alert-circle` | IconWarningCircle | Trabalho |
| glifo − | zoom-menos | `zoom-out` | IconZoomOut | Trabalho |
| glifo + | zoom-mais | `zoom-in` | IconZoomIn | Trabalho |
| glifo ⌄ | chevron-baixo | `chevron-down` | IconChevronDown | Trabalho |
| glifo › | chevron-direita | `chevron-right` | IconChevronRight | Trabalho |
| glifo ← | voltar | `arrow-left` | IconArrowLeft | Trabalho |
