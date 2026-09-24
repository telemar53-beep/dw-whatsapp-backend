# Apêndice D — Iconografia: família, arquitetura e mapeamento

> Parte do spec `2026-09-24-redesenho-simplicidade-design.md` (seção 5.6). Base medida: `e5236da`.
> Fonte: auditoria de iconografia de 24/09/2026 (relatório e pranchas no pacote de trabalho da E2),
> **conferida de forma independente** antes de entrar aqui — ver D.7.

## D.1 Decisão recomendada, em uma frase

**Corrigir primeiro a arquitetura dos ícones (vale para qualquer família) e vendorizar a Phosphor 2.1.1,
peso regular, em três módulos por camada.** O único ponto que ainda depende do proprietário está em D.3.

## D.2 A tensão qualidade × bytes, com os números reais

A estimativa anterior ("~5 KB a mais que a Lucide") estava errada: misturava conjuntos diferentes
(8 preenchidos numa família, 5 noutra, nenhum na terceira) e não separava camadas. Medido em build
real, migração completa, arquitetura corrigida, em relação a hoje:

| Variante | Login (gzip) | "/" (gzip) |
|---|---|---|
| Só a arquitetura, ícones atuais | **−4.694 B** | +492 B |
| **Phosphor, precisão por ícone** | **−4.595 B** | **+2.364 B** |
| Tabler | −4.617 B | −457 B |
| Lucide | −4.635 B | −1.186 B |
| Heroicons | −4.604 B | +1.790 B |

- **No login a família não pesa nada** — todas ficam em −4,6 KB, porque o ganho vem da arquitetura.
- **Em "/"** a Phosphor custa **+2,8 KB sobre a Tabler** e **+3,5 KB sobre a Lucide** (≈14–18 ms por
  carga a 1,6 Mbit/s). Não são 5 KB.
- **Trocar de família sem corrigir a arquitetura piora o login** (Phosphor: +2.745 B), porque hoje o
  módulo inteiro de ícones está no chunk de entrada.

**Phosphor × Lucide — a diferença justifica, e não por gosto:** a Lucide não tem nenhum ícone
preenchido (não cumpre P8 no menu), não tem Pix nem PDF, e é o visual padrão de Feather/shadcn — o
"genérico" de que o proprietário se queixa. A comparação real é com a Tabler.

**Phosphor × Tabler — margem estreita, e é honesto dizer onde a Tabler ganha:**

| | Phosphor 2.1.1 | Tabler 3.48.0 |
|---|---|---|
| Bytes em "/" | +2,8 KB | referência |
| Legibilidade a 16 px | traço de 1 px — **mais fina**; detalhes pequenos somem (o check de "assumir", as lentes do binóculo) | traço de 1,33 px — **mais legível** |
| Preenchido nos 5 itens do menu | 5/5 | 3/5 — sem megafone preenchido (Campanhas); barras sem preenchido (Relatórios; `chart-pie` teria, mudando a metáfora) |
| Cobertura dos 83 significados | 83/83 | 49/83 com preenchido; sem Pix |
| Pix | `pix-logo` | não tem — ficaria o SVG próprio de hoje |
| Identidade | a mais distinta das quatro | "admin template" |

Compensação da legibilidade da Phosphor: 18–20 px no menu e nos cabeçalhos (onde já estão); 16 px só
para ícone ao lado de texto.

## D.3 O ponto que é do proprietário

P8 diz "ativo × inativo por peso de ícone (preenchido × contorno)". No menu, porém, **a barra de 3 px
do acento já dá a forma** que a acessibilidade exige; o preenchido é reforço visual, não requisito.

- **Mantém o preenchido no item ativo** → Phosphor (+2,8 KB em "/"). **É a recomendação.**
- **Aceita ativo só por barra + fundo** → a Tabler passa a ser a escolha racional: 2,8 KB a menos por
  carga e traço mais legível a 16 px, ao preço de um Pix próprio e de um visual mais comum.

Sem resposta, a E2 segue com a Phosphor.

## D.4 Arquitetura (entra na E2, independe da família)

Hoje o chunk de entrada — baixado no login e na tela "Sem acesso" — carrega 47 dos 48 ícones de
`WaIcons` (2.842 B gzip marginais) sem usar nenhum. As três causas:

1. `App.jsx` importa `LEGACY_REDIRECTS` de `navigation/navItems.js`, que importa 12 ícones;
2. `ProtectedRoute.jsx` importa `hasLevel` do mesmo arquivo;
3. `AccessDeniedPage.jsx` importa `IconLock` de `WaIcons`.

Correção: `hasLevel`, `SETTINGS_BASE` e `LEGACY_REDIRECTS` vão para `navigation/rotas.js` (sem ícone);
o cadeado da "Sem acesso" vem de um módulo só dele; os ícones de grupo em `navItems` viram booleano
(o desenho real já vem de `SettingsVisuals`). **Resultado medido: login −4,7 KB gzip, "/" +0,5 KB.**

Módulos da família (gerados a partir do pacote, nunca editados à mão):

| Módulo | Conteúdo | gzip isolado | Onde carrega |
|---|---|---|---|
| `IconesEntrada.js` | cadeado | 368 B | entrada (Sem acesso) |
| `IconesTrabalho.js` | 62 contornos + 5 preenchidos do menu + spinner | 6.869 B (6.543 B no build) | casca + mesa ("/") |
| `IconesConfig.js` | 19 ícones só de Configurações | 2.426 B (1.622 B no build) | lazy, com Configurações |

Precisão dos caminhos ajustada por ícone: a menor que não muda nenhum pixel acima de 64/255 a
16/20/24 px (−0,99 KB contra precisão fixa). Os 89 exports foram renderizados e comparados pixel a
pixel com o SVG do pacote: 0 falhas.

**Cuidados:** os preenchidos de `x`, `plus`, `checks` e `caret` são quadrado cheio ou triângulo —
**nunca** usar como estado ativo; preenchido existe só nos 5 do menu. O traço da Phosphor é fixo
(1,5 na grade 24): a convenção de traço 1,75 do `WaIcons` deixa de valer.

## D.5 Defeitos do conjunto atual que a troca resolve

- Seis espessuras de traço convivendo (1,75 a 2,1), mais preenchidos.
- Um significado com vários desenhos: "fechar" com 5 formas (2 SVGs, `✕` ×2, `×`); "abrir" com 6;
  "check" com 6.
- Um desenho com vários significados: `IconTeam` é Supervisão, Equipe e Usuários; `IconCheckCircle`
  tem 5 significados; `IconHistory` é quase igual a `IconClock`.
- Desenhos com defeito: `IconMegaphone` (Campanhas) é o ícone de volume; `IconTransfer` com pontas
  invadindo a haste; `IconSettings` 1 unidade fora do centro; `IconClaim` (Assumir) é um "✓" solto;
  `IconPdfFile` com `#fff` fixo, ilegível a 16 px.
- Emoji na prévia da lista (📷 🎤 🎥 📄 😀 📍 💠): o desenho muda por sistema e ignora o tema.
- Glifos como ícone: `⚠` ×2, `×`, `✕` ×2, `!`, `−`/`+` do zoom, `⌄`, `›` ×2, `←` ×2.
- **Licença:** `IconClose` é cópia literal do "close" do Material Icons (Apache-2.0), e Refresh, Edit,
  Search, ArrowLeft, Send e Mic derivam dele — o repositório não tem a licença nem NOTICE. A troca
  elimina a pendência.

## D.6 Licença

Phosphor Icons é MIT, © 2023 Phosphor Icons: manter o aviso e a permissão junto de toda cópia; não
exige atribuição na interface; permite uso comercial e white-label. Arquivo
`frontend/src/components/icons/LICENSE-Phosphor.txt` (mesmo padrão de `OFL-Inter.txt`) e comentário
`/** @license Phosphor Icons 2.1.1 — MIT — (c) 2023 Phosphor Icons */` nos módulos gerados (o build
preserva `@license`; ~80 B).

## D.7 O que foi conferido de forma independente (e como)

Regra do projeto desde 24/09: saída de subagente não entra em documento sem conferência.

| Afirmação | Conferência | Resultado |
|---|---|---|
| Ícones no chunk de entrada | busca dos caminhos SVG de 6 ícones no `index-*.js` do build `e5236da` | 6/6 presentes |
| Três importações causam isso | leitura de `App.jsx`, `ProtectedRoute.jsx`, `AccessDeniedPage.jsx`, `navItems.js` | confirmado |
| Arquitetura dá −4,7 KB no login | build próprio numa cópia do `e5236da` só com as três mudanças | 87.534 → 82.862 B = **−4.672 B** (relatório: −4.694) |
| Tamanho dos módulos | minificação própria (esbuild) + gzip-9 | 382 / 6.936 / 2.467 B (relatório, com terser: 368 / 6.869 / 2.426) |
| `IconClose` = Material "close" | comparação do caminho com o do Material | idêntico |
| Cobertura das famílias | listagem dos pacotes | Phosphor com `megaphone`, `chart-bar`, `pix-logo`, `file-pdf`, `binoculars` em regular e fill; Tabler sem `speakerphone` e sem `chart-bar` preenchidos, e sem Pix; Lucide sem nenhum preenchido e sem Pix |
| Legibilidade a 16 px | leitura própria da folha de 16 px ampliada | Phosphor visivelmente mais fina que Tabler e Lucide |

Não reproduzido por mim: a medição por família em "/" (D.2) e a comparação de pixels dos 89 exports.

## D.8 Mapeamento completo (atual → Phosphor)

"Módulo" diz em qual dos três módulos o ícone entra. "—" = fica como está (marcas de terceiros,
ilustração de vazio, miniatura de documento, marca do login).

| Atual | Significado | Contorno | Preenchido | Export | Módulo |
|---|---|---|---|---|---|
| WaIcons.IconSearch | busca | `magnifying-glass` |  | IconSearch | Trabalho |
| WaIcons.IconNewChat | adicionar | `plus` |  | IconNewChat | Trabalho |
| WaIcons.IconChevronDown | chevron-baixo | `caret-down` |  | IconChevronDown | Trabalho |
| WaIcons.IconArrowLeft | voltar | `arrow-left` |  | IconArrowLeft | Trabalho |
| WaIcons.IconHistory | historico | `clock-counter-clockwise` |  | IconHistory | Trabalho |
| WaIcons.IconTransfer | transferir | `arrows-left-right` |  | IconTransfer | Trabalho |
| WaIcons.IconCheckCircle | encerrar (ConversationListItem, ConversationView, ChannelsTable) | `check-circle` |  | IconCheckCircle | Trabalho |
| WaIcons.IconCheckCircle | encerrados (SideNav) | `archive` |  | IconArchive | Trabalho |
| WaIcons.IconClaim | assumir | `user-check` |  | IconClaim | Trabalho |
| WaIcons.IconClose | fechar | `x` |  | IconClose | Trabalho |
| WaIcons.IconAttach | anexo | `paperclip` |  | IconAttach | Trabalho |
| WaIcons.IconEmoji | emoji | `smiley` |  | IconEmoji | Trabalho |
| WaIcons.IconQuickReply | resposta-rapida | `lightning` |  | IconQuickReply | Trabalho |
| WaIcons.IconMic | microfone | `microphone` |  | IconMic | Trabalho |
| WaIcons.IconSend | enviar | `paper-plane-right` |  | IconSend | Trabalho |
| WaIcons.IconTrash | lixeira | `trash` |  | IconTrash | Trabalho |
| WaIcons.IconStop | parar | `stop` |  | IconStop | Trabalho |
| WaIcons.IconPlay | play | `play` |  | IconPlay | Trabalho |
| WaIcons.IconPause | pause | `pause` |  | IconPause | Trabalho |
| WaIcons.IconDownload | download | `download-simple` |  | IconDownload | Trabalho |
| WaIcons.IconPin | local | `map-pin` |  | IconPin | Trabalho |
| WaIcons.IconLock | cadeado | `lock-simple` |  | IconLock | Entrada |
| WaIcons.IconBellOn | sino | `bell` |  | IconBellOn | Trabalho |
| WaIcons.IconBellOff | sino-mudo | `bell-slash` |  | IconBellOff | Trabalho |
| WaIcons.IconChart | relatorio | `chart-bar` | `chart-bar-fill` | IconChart / IconChartFill | Trabalho |
| WaIcons.IconSettings | configuracoes | `gear-six` | `gear-six-fill` | IconSettings / IconSettingsFill | Trabalho |
| WaIcons.IconLogout | sair | `sign-out` |  | IconLogout | Trabalho |
| WaIcons.IconTeam | equipe (TeamModal, TeamPanel, navItems) | `users` |  | IconTeam | Trabalho |
| WaIcons.IconTeam | supervisao (navItems) | `binoculars` | `binoculars-fill` | IconSupervision / IconSupervisionFill | Trabalho |
| WaIcons.IconWarning | alerta | `warning` |  | IconWarning | Trabalho |
| WaIcons.IconEmptyChat | — (fica como está) | — | — | — | — |
| WaIcons.IconChats | atendimento | `chats-circle` | `chats-circle-fill` | IconChats / IconChatsFill | Trabalho |
| WaIcons.IconUser | cliente | `user` |  | IconUser | Trabalho |
| WaIcons.IconMegaphone | campanha | `megaphone` | `megaphone-fill` | IconMegaphone / IconMegaphoneFill | Trabalho |
| WaIcons.IconChannel | canal | `device-mobile` |  | IconChannel | Config |
| WaIcons.IconSpark | ia | `sparkle` |  | IconSpark | Config |
| WaIcons.IconRules | regras | `list-checks` |  | IconRules | Config |
| WaIcons.IconPlug | integracoes | `plugs` |  | IconPlug | Config |
| WaIcons.IconTags | tag | `tag` |  | IconTag | Trabalho |
| WaIcons.IconBuilding | empresa | `buildings` |  | IconBuilding | Config |
| WaIcons.IconUserPlus | adicionar-usuario | `user-plus` |  | IconUserPlus | Config |
| WaIcons.IconMore | mais-v (TemplatesAdminTab) | `dots-three-vertical` |  | IconMoreVertical | Config |
| WaIcons.IconMore | mais-h (DataTable, ChannelsTable) | `dots-three` |  | IconMore | Config |
| WaIcons.IconRefresh | atualizar | `arrow-clockwise` |  | IconRefresh | Trabalho |
| WaIcons.IconInfo | info | `info` |  | IconInfo | Trabalho |
| WaIcons.IconFile | template (TemplatesAdminTab, SettingsVisuals) | `file-text` |  | IconFileText | Config |
| WaIcons.IconFile | arquivo (SgpQueryPage) | `file` |  | IconDocument | Trabalho |
| WaIcons.IconClock | relogio | `clock` |  | IconClock | Trabalho |
| WaIcons.IconServer | servidor | `hard-drives` |  | IconServer | Config |
| WaIcons.IconBrain | ia-cerebro | `brain` |  | IconBrain | Config |
| WaIcons.IconEdit | editar | `pencil-simple` |  | IconEdit | Config |
| SgpIcons.IconPix | pix | `pix-logo` |  | IconPix | Trabalho |
| SgpIcons.IconBarcode | codigo-barras | `barcode` |  | IconBarcode | Trabalho |
| SgpIcons.IconQrCode | qr | `qr-code` |  | IconQrCode | Trabalho |
| SgpIcons.IconPdfFile | pdf | `file-pdf` |  | IconPdfFile | Trabalho |
| SgpIcons.IconInvoiceLink | link | `link` |  | IconInvoiceLink | Trabalho |
| SgpIcons.IconIdCard | documento-cpf | `identification-card` |  | IconIdCard | Trabalho |
| SgpIcons.IconClose | fechar | `x` |  | IconClose | Trabalho |
| SgpIcons.IconSpinner | carregando | `circle-notch` |  | IconSpinnerGlyph | Trabalho |
| SgpIcons.IconCheck | check | `check` |  | IconCheck | Trabalho |
| SettingsVisuals.BranchIcon | triagem (SettingsVisuals) | `tree-structure` |  | IconTree | Config |
| SettingsVisuals.BranchIcon | setores (SettingsVisuals) | `stack` |  | IconStack | Config |
| SettingsVisuals.MoonIcon | noturno | `moon-stars` |  | IconMoon | Config |
| SettingsVisuals.PlaceIcon | local | `map-pin` |  | IconPin | Trabalho |
| Reports.IconConversationCheck | encerrar | `check-circle` |  | IconCheckCircle | Trabalho |
| Reports.IconClock | relogio | `clock` |  | IconClock | Trabalho |
| Reports.IconReply | responder | `arrow-bend-up-left` |  | IconReply | Config |
| Reports.IconUsers | equipe | `users` |  | IconTeam | Trabalho |
| Reports.IconLayers | setores | `stack` |  | IconStack | Config |
| Reports.IconInbox | caixa-entrada | `tray` |  | IconInbox | Config |
| Reports.IconAlert | alerta | `warning` |  | IconWarning | Trabalho |
| Reports.IconDownload | download | `download-simple` |  | IconDownload | Trabalho |
| Reports.IconTag | tag | `tag` |  | IconTag | Trabalho |
| Reports.IconCalendar | calendario | `calendar-blank` |  | IconCalendar | Config |
| Reports.IconChevron | chevron-baixo | `caret-down` |  | IconChevronDown | Trabalho |
| TransferModal.IconArrowRight | seta-direita | `arrow-right` |  | IconArrowRight | Trabalho |
| TransferModal.IconBars | carga | `cell-signal-high` |  | IconSignal | Trabalho |
| ChannelVisuals.QrStatusIcon | qr | `qr-code` |  | IconQrCode | Trabalho |
| ChannelVisuals.VisibilityIcon | exibir | `eye` |  | IconEye | Config |
| ChannelVisuals.MarcaWhatsApp | — (fica como está) | — | — | — | — |
| ChannelVisuals.MarcaMeta | — (fica como está) | — | — | — | — |
| Campaigns.atualizar | atualizar | `arrow-clockwise` |  | IconRefresh | Trabalho |
| Campaigns.nova | adicionar | `plus` |  | IconNewChat | Trabalho |
| Supervision.chevron | chevron-baixo | `caret-down` |  | IconChevronDown | Trabalho |
| Ticks.Tick (enviado) | check | `check` |  | IconCheck | Trabalho |
| Ticks.Tick x2 (entregue/lido) | lido-entregue | `checks` |  | IconChecks | Trabalho |
| Login.SignalMark | — (fica como está) | — | — | — | — |
| closeReason.cancel | cancelamento | `x-circle` |  | IconCancel | Trabalho |
| closeReason.dollar | financeiro | `money` |  | IconMoney | Trabalho |
| closeReason.wrench | instalacao | `wrench` |  | IconWrench | Trabalho |
| closeReason.pin | local | `map-pin` |  | IconPin | Trabalho |
| closeReason.refresh | reativacao | `power` |  | IconPower | Trabalho |
| closeReason.robot | robo | `robot` |  | IconRobot | Trabalho |
| closeReason.bellOff | sem-resposta | `chat-circle-slash` |  | IconChatSlash | Trabalho |
| closeReason.headset | suporte | `headset` |  | IconHeadset | Trabalho |
| closeReason.key | senha | `key` |  | IconKey | Trabalho |
| closeReason.tag | tag | `tag` |  | IconTag | Trabalho |
| closeReason.header | atendimento | `chats-circle` | `chats-circle-fill` | IconChats / IconChatsFill | Trabalho |
| closeReason.checkCircle | encerrar | `check-circle` |  | IconCheckCircle | Trabalho |
| MessageAttachment.miniaturaDoc | — (fica como está) | — | — | — | — |
| emoji 📷 | foto | `image` |  | IconImage | Trabalho |
| emoji 🎤 | microfone | `microphone` |  | IconMic | Trabalho |
| emoji 🎥 | video | `video-camera` |  | IconVideo | Trabalho |
| emoji 📄 | arquivo | `file` |  | IconDocument | Trabalho |
| emoji 😀 | figurinha | `sticker` |  | IconSticker | Trabalho |
| emoji 📍 | local | `map-pin` |  | IconPin | Trabalho |
| emoji 💠 | pix | `pix-logo` |  | IconPix | Trabalho |
| glifo ⚠ | alerta | `warning` |  | IconWarning | Trabalho |
| glifo × | fechar | `x` |  | IconClose | Trabalho |
| glifo ✕ | fechar | `x` |  | IconClose | Trabalho |
| glifo ! | falha | `warning-circle` |  | IconWarningCircle | Trabalho |
| glifo − | zoom-menos | `magnifying-glass-minus` |  | IconZoomOut | Trabalho |
| glifo + | zoom-mais | `magnifying-glass-plus` |  | IconZoomIn | Trabalho |
| glifo ⌄ | chevron-baixo | `caret-down` |  | IconChevronDown | Trabalho |
| glifo › | chevron-direita | `caret-right` |  | IconChevronRight | Trabalho |
| glifo ← | voltar | `arrow-left` |  | IconArrowLeft | Trabalho |