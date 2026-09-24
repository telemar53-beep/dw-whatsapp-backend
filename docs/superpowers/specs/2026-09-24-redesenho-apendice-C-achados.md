# Apêndice C — Achados de comportamento e etapa dona

> Parte do spec `2026-09-24-redesenho-simplicidade-design.md`. Base `e5236da`.
> Os defeitos de cada estado (709 linhas com defeito anotado) estão no Apêndice A, linha a
> linha. Este apêndice junta os de **comportamento** — o que falha, some, corre ou chega cru —, diz
> quem é dono de cada um e marca o que depende de decisão do proprietário ou toca área protegida.

## C.1 Corrigidos e publicados — E1 (`e5236da`, 24/09/2026)

Cinco ocorrências da classe CLASSE-01 ("resposta em trânsito voltando com outra conversa na tela"):
corrida do painel SGP (podia mandar Pix e boleto de um cliente para outro), mesmo contato em dois
canais herdando o "enviado", bolha enviada na conversa errada, envio travado bloqueando o compositor
em todas as conversas, e o "Carregar mensagens anteriores" que nunca funcionou (BUG-006).

## C.2 Corrigidos na E1.1 — branch `fix/e1-1-rolagem-ao-carregar-anteriores`, aguardando autorização

- O clique em "Carregar mensagens anteriores" jogava a linha do tempo para o fim (CV-TL-09).
- Com uma mensagem do socket chegando antes do histórico, a conversa abria no topo.
- Mensagem que chegava com a carga inicial no ar podia **sumir da tela** até reabrir (CLASSE-01, já existia em produção).
- Fotos do trecho carregado empurravam a leitura (Safari, e o Chrome no clique com a lista rolada).
- O pedido de anteriores sem resposta deixava o botão em "Carregando…" para sempre.

## C.3 Graves, abertos

| Ids | O que acontece | Dono | Observação |
|---|---|---|---|
| PRF-12 | Errar a **senha atual** na troca de senha **desloga**: o backend responde 401 e o `apiFetch` trata todo 401 como sessão expirada | E4 | Só frontend (distinguir 401 de sessão de 401 de credencial). Candidato a correção isolada, como a E1 — decisão do proprietário |
| CV-SGP-33 | O dono abre a própria conversa **encerrada** e o painel SGP **manda Pix, QR, código de barras e PDF ao cliente**, sem aviso; só o Link Fatura é recusado | Decisão do proprietário | As rotas do SGP só conferem o dono (`src/api/sgp-query.routes.js:41-52`) e encerrar mantém o dono. A guarda no backend é área protegida. Sem decisão, nada some (restrição 3): a E2 acrescenta no painel o aviso "Atendimento encerrado — a cobrança vai direto ao cliente"; tornar o painel só-leitura exige o ok do proprietário (spec 14.1, item 4) |
| CFG-EQP-USR-26 | A senha gerada para um atendente, que "só aparece essa vez", **some** ao fechar o modal por ESC ou clique fora | E6 | Sem confirmação nem bloqueio |
| ACS-GLB-16 | Se o pacote principal não baixa (deploy novo, rede), a tela fica **branca**: o aviso do `index.html` escuta `error` sem captura, e erro de download de script não borbulha | E3 | Junto com a regra "nunca tela branca" (seção 7) |
| CVM-MOD-10 | No modal de conversa (Supervisão, Encerrados), **ESC** com o painel SGP ou um popover aberto **fecha a conversa inteira** | E2 | O painel desiste do ESC quando existe qualquer `[data-dialog]`, inclusive o próprio modal |
| CFG-AUT-ID-05 | A página de Identificação mostra **sempre** "Triagem com IA desligada": compara com 'triage'/'full', que o backend nunca devolve | E6 | O teste mocka 'triage' e não pega |
| MSG-GRV-11, MSG-CMP-30, MSG-CMP-31, MSG-CMP-32, CV-SGP-31, CV-SGP-32, CV-EDC-13, CV-TPL-15, ATD-TRF-25, ATD-INI-29, CAM-NOV-08 | Membros ainda abertos da **CLASSE-01**: gravação, citação, anexo, envio do SGP, edição de contato, template e transferência cuja resposta volta com outra conversa (ou outro canal) na tela | E4 (+ E2 na tela) | A regra de guarda do Obsidian `Bugs` (CLASSE-01) vale para cada um; "troca de conversa aborta os pedidos da anterior" já está na seção 8 |
| MSG-CMP-25 | (suspeita) Com o canal desconectado, o envio é aceito e só falha depois, no worker; nada no compositor avisa | E2 (aviso) | O aceite no backend é área protegida; o aviso de canal desconectado no compositor é frontend |

## C.4 Famílias

### C.4.1 Frase do servidor sem tradução — 34 estados

Regra comum na **E4**: `descreverErro` nunca devolve texto cru — frase conhecida vira tradução, desconhecida vira a frase genérica da área e o texto original vai para "detalhes". As traduções de cada área entram na etapa dona.

| Etapa | Estados | Ids (detalhe no Apêndice A) |
|---|---|---|
| E2 | 6 | CV-BOL-12, MSG-CMP-08, MSG-CPV-07, MSG-DOC-04, CV-FAL-03, PRF-08 |
| E5 | 1 | SUP-BAR-19 |
| E6 | 26 | CAM-DET-14, CFG-CAN-27, CFG-DET-12, CFG-CON-50, CFG-HOR-16, CFG-MSG-BV-15, CFG-MSG-AE-15, CFG-AUT-MENU-16, CFG-AUT-IA-14, CFG-AUT-IA-20, CFG-MSG-AC-14, CFG-MSG-AC-15, CFG-MSG-RR-12, CFG-MSG-TPL-10, CFG-MSG-TPL-26, CFG-MSG-TPL-52, CFG-MSG-TPL-55, CFG-MSG-TPL-61, CFG-EQP-SET-10, CFG-INT-SGPE-05, CFG-CAD-MOT-12, CFG-CAD-MOT-14, CFG-CAD-CIDF-13, CFG-CAD-PLA-16, CFG-CAD-PLAF-09, CFG-EMP-18 |
| E7 | 1 | ACS-GLB-14 |

### C.4.2 Falha muda (erro engolido, sem aviso) — 69 estados

Regra comum na **E4**: `catch` vazio proibido; toda lista ou carga que falha mostra erro com "Tentar de novo" (o `AsyncState` já tem o slot; 27 de 37 usos não passam `onRetry`, PRM-ASY-03). Cada tela entra na etapa dona.

| Etapa | Estados | Ids (detalhe no Apêndice A) |
|---|---|---|
| E2 | 26 | CAS-BAN-05, CVM-ENC-11, ATD-MESA-13, ATD-ITEM-25, CV-CAB-10, CV-TL-08, CV-ROD-04, MSG-CMP-18, MSG-PRV-15, MSG-TOK-02, CV-IA-14, CV-SGP-19, CV-SGP-27, CV-SGP-31, CV-SGP-32, ATD-TRF-25, ATD-INI-14, CV-HIS-11, CV-EDC-03, CV-EDC-13, CV-TPL-15, ATD-RT-15, CVM-INF-09, PRF-12, PRF-17, PRF-18 |
| E5 | 3 | SUP-BAR-04, SUP-MOD-02, REL-PG-33 |
| E6 | 39 | CAM-LST-05, CAM-LST-06, CAM-LST-21, CAM-DET-07, CAM-NOV-08, CFG-CAN-29, CFG-NOVO-05, CFG-CON-13, CFG-CON-24, CFG-ATE-16, CFG-ATE-17, CFG-HOR-11, CFG-HOR-22, CFG-MSG-BV-23, CFG-MSG-AE-16, CFG-MSG-AE-18, CFG-MSG-AE-19, CFG-MSG-AE-27, CFG-AUT-MENU-20, CFG-AUT-MENU-31, CFG-AUT-IA-04, CFG-AUT-IA-05, CFG-AUT-IA-06, CFG-AUT-IA-14, CFG-AUT-IA-16, CFG-AUT-ID-10, CFG-AUT-FER-12, CFG-MSG-AC-22, CFG-MSG-RR-13, CFG-MSG-TPL-02, CFG-MSG-TPL-78, CFG-EQP-USR-14, CFG-EQP-USR-21, CFG-EQP-USR-28, CFG-INT-HUB-02, CFG-INT-HUB-03, CFG-INT-SGPE-17, CFG-CAD-MOT-10, CFG-EMP-11 |
| E7 | 1 | ACS-GLB-03 |

### C.4.3 Fechar ou cancelar com o envio em curso — 14 estados

Regra no primitivo (**E2**, a base muda lá): com envio em curso, "Cancelar", "×", ESC e clique no fundo ficam bloqueados ou pedem confirmação; o formulário em linha desabilita "Cancelar" enquanto salva. Cada tela entra na etapa dona.

| Etapa | Estados | Ids (detalhe no Apêndice A) |
|---|---|---|
| E2 | 5 | ATD-TRF-25, ATD-ENC-17, ATD-INI-26, CV-EDC-13, CV-TPL-15 |
| E6 | 9 | CFG-NOVO-06, CFG-NOVO-12, CFG-HOR-22, CFG-MSG-BV-23, CFG-MSG-AE-27, CFG-MSG-AC-22, CFG-MSG-RR-29, CFG-MSG-TPL-78, CFG-EMP-12 |

### C.4.4 Perda de dado, rascunho ou lista — 20 estados

Cada item na etapa dona; "recarga que falha apaga a tabela" é regra do `useAsyncResource` (**E4**): falha de recarga mantém o dado anterior e avisa.

| Etapa | Estados | Ids (detalhe no Apêndice A) |
|---|---|---|
| E2 | 13 | ATD-ITEM-07, ATD-AVT-05, CV-TL-20, CV-ROD-14, MSG-CMP-06, MSG-CMP-18, MSG-CMP-32, MSG-RR-03, MSG-PRV-15, ATD-TRF-25, CV-EDC-13, CV-TPL-15, CVM-MOD-10 |
| E6 | 7 | CFG-MSG-BV-22, CFG-EQP-USR-04, CFG-EQP-USR-26, CFG-EQP-SET-04, CFG-CAD-MOT-04, CFG-CAD-CID-04, CFG-CAD-PLA-04 |

### C.4.5 Texto só com espaços aceito — 12 estados

Regra comum (**E6** para Configurações, **E2** para a mesa): aparar antes de validar e de enviar; o backend não é tocado.

| Etapa | Estados | Ids (detalhe no Apêndice A) |
|---|---|---|
| E2 | 2 | ATD-INI-21, PRF-08 |
| E6 | 10 | CFG-NOVO-16, CFG-AUT-MENU-16, CFG-EQP-ADD-02, CFG-EQP-SET-10, CFG-EQP-SETN-02, CFG-INT-SGPE-23, CFG-CAD-MOT-12, CFG-CAD-MOTN-02, CFG-CAD-CIDF-09, CFG-CAD-PLAF-07 |

## C.5 Backend — só registro (área protegida; tocar exige autorização do proprietário)

| Achado | Efeito | Onde |
|---|---|---|
| Chave estrangeira `conversations.ai_triage_sector_id` sem `ON DELETE` | Excluir um setor usado pela triagem da IA dá erro 500 | migração da triagem com IA |
| CFG-MSG-TPL-79 | "Registrar template existente" com categoria AUTHENTICATION estoura o CHECK de `message_templates.category` e dá 500; a tela manda tentar de novo, o que nunca funciona | `src/templates/template.service.js:135` |
| ATD-RT-17 | Trocar o setor pela Supervisão manda `queue:new` de atendimento com dono ou encerrado para **todos** os atendentes, com bipe | `src/api/conversations.routes.js:561-563` |
| SUP-BAR-05, SUP-ENC-12 | "Encerrados hoje" é janela móvel de 24 h; o contador em tempo real só sobe | `src/api/admin-dashboard.routes.js:18-22` |
| CFG-MSG-RR-13 | Respostas rápidas com título repetido são aceitas (sem UNIQUE) | `src/api/admin-quick-replies.routes.js:11-20` |
| CFG-EQP-USR-14 | A lista de atendentes do admin não devolve `avatarPath`: a foto nunca aparece | `src/api/admin-agents.routes.js:12-22` |
| MSG-IMG-12 | (suspeita) "Baixar" imagem navega para a imagem crua: a API está em outra origem e não manda `Content-Disposition` | `src/api/media.routes.js:27` |
| CV-SGP-33 (parte do backend) | Rotas de cobrança do SGP não recusam conversa encerrada | `src/api/sgp-query.routes.js:41-52` |
| MSG-CMP-25 (parte do backend) | Envio aceito com canal desconectado | `src/api/conversations.routes.js:291-380` |
