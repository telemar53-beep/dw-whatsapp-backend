# Apêndice E — Overlays da mesa: mudanças estruturais por item

> Parte do spec `2026-09-24-redesenho-simplicidade-design.md` (seção 6.6). Base: `e5236da`.
> Detalhe por overlay — estrutura medida, problemas S/C com arquivo:linha, esboço, destinos, testes —
> nos anexos `2026-09-24-redesenho-apendice-E-anexos/grupo-{A,B,C}.md`. **Onde anexo e apêndice
> divergirem, vale este apêndice.**

## E.0 De onde vem e como foi conferido

Três auditorias em paralelo, somente leitura, cada uma com um grupo de overlays: **A** — fluxos de
atendimento (Iniciar conversa, Transferir, Encerrar, "Finalizar sem motivo", Enviar template); **B** —
de dentro da conversa (Atendimentos anteriores, Editar cliente, visualizador de imagem, Alerta,
Emojis, Respostas rápidas); **C** — moldura e equipe (Nossa equipe, Encerrados + conversa em modal +
painel de informações, Meu perfil, menu da conta, aviso de transferência, faixa do canal, avisos de
conexão).

Conferi por conta própria, no código de `e5236da`, 12 afirmações que mudam o desenho (4 por grupo):
`overlays.css` fora de `@layer` e só importado pelo `Dialog`; regras mortas do Transferir; confirmação
lida duas vezes pelo leitor de tela; ajuda do nono dígito falsa em canal oficial; rota de mensagens
já paginável; histórico só de encerrados; pilha ignora ESC marcado; "Em atendimento" × "Em andamento"
na mesma tela; o painel de informações é o único lugar que troca o setor; `transferredBy` objeto ou
`null`. **12 de 12 certas.** As auditorias também pegaram dois erros **meus** — a frase da WABA que eu
tinha dado como crua (Apêndice A.2) e a premissa da seção 8 de que paginar o histórico exigia backend
— ambos corrigidos (E.7).

## E.1 Base única (vale para todo diálogo e popover do sistema)

Os três grupos auditaram a mesma base e divergiram em três pontos (ícone de cabeçalho, ×, ESC). A
regra única:

| # | Regra | Classe |
|---|---|---|
| 1 | **Sem ícone de cabeçalho decorativo.** O título diz a tarefa. Ícone só quando é controle (o "←" do detalhe do Histórico). Sai o ladrilho tonal (revogado em 24/09). | S |
| 2 | **Diálogo de ação:** sem ×; rodapé `[Cancelar][ação principal]` pelo `DialogFooter`, perigo só no botão destrutivo final. **Diálogo de consulta** (Histórico, conversa em modal): × no fluxo do cabeçalho, sem rodapé; fecha por ×, ESC e clique fora. É a regra que Confirmação e Alerta já seguem. | S |
| 3 | **Margem única de 24 px** no cabeçalho, corpo e rodapé (hoje 20/22/24). | S |
| 4 | **Uma geometria de botão** (`Button`, altura 36, 14 px). Saem as regras por descendente de `overlays.css:19-27`, que anulam os utilitários em todo diálogo **e vazam para o compositor da conversa em modal**; os diálogos de Configurações passam a uma classe opt-in que mantém o visual deles até a E6. | S |
| 5 | **Região de erro fixa** entre corpo e rodapé (hoje o erro fica no fim do corpo rolável, abaixo da dobra em lista longa). | S |
| 6 | **Nota do rodapé alterna motivo × consequência:** com a ação desabilitada, diz o que falta ("Escolha quem vai receber o atendimento.") e o botão aponta para ela por `aria-describedby`; disponível, volta a consequência. | S |
| 7 | **Estado "ocupado"**, uma guarda única no `onClose` do `Dialog`: com envio em curso, ×, ESC, clique fora e Cancelar não fecham; o botão diz "Transferindo…". Resolve a família C.4.3. | S (comportamento) |
| 8 | **Uma largura por diálogo** em todos os estados (carregando, erro, vazio, pronto). | S |
| 9 | **Camada leve na pilha** (`dialogStack`): painel lateral, popover do compositor, menu da conta e gaveta entram como camadas **não modais** — só participam da ordem do ESC (o topo fecha primeiro); `inert` e foco devolvido olham só as modais. Saem os 4 ouvintes avulsos de ESC (`MessageInput`, `SideNav`, `SupervisionPage`, painel da conversa). Resolve CVM-MOD-10 (ESC fechava a conversa inteira). | S |
| 10 | **Popover base:** âncora no gatilho, altura limitada ao espaço livre (hoje cortado a 683×384), clique fora = fora do popover e do gatilho; o papel de cada um fica (emojis `dialog`, respostas `menu` — invariante 9). | S |
| 11 | **Confirmação estruturada:** título, o nome do objeto ("Maria Souza"), a consequência, e ação assíncrona (fica aberta até a resposta, mostra o erro). A API `confirm(message, opções)` dos 14 chamadores não muda. | S |
| 12 | **Lista de escolha única** (linha-rádio com marca à direita, `role="radiogroup"`) no lugar dos 4 padrões de hoje; e **escolha de template compartilhada** (lista + variáveis + prévia) entre Iniciar conversa e Enviar template. | S |
| 13 | **Faixa de aviso** (ícone + texto + ação, 1 linha, `--color-aviso`): uma primitiva para conexão no celular e canal desconectado. | S |
| 14 | Pele: véu `--color-veu` sólido sem blur; painel `--color-elevado`; raio 16; uma sombra; título Sora 16; Inter no resto. | C (5 mudanças) |

## E.2 Por overlay

Largura em px. **S/C** = mudanças estruturais/cosméticas propostas (defeitos de comportamento fora
da conta). "Resolve" = ids do Apêndice A que deixam de ser defeito.

| Overlay | Largura | Mudanças estruturais principais | Resolve | S/C |
|---|---|---|---|---|
| **Iniciar conversa** | 768 → 576 | uma coluna; ordem Telefone → Canal → conteúdo, foco no Telefone; canal único vira texto; estado dos canais dito uma vez (sai o 2º `role="status"`); sai a faixa "exige template" (dita até 3×); template pela escolha compartilhada, com o texto à vista; conteúdo só depois de saber o tipo do canal; validação em linha; ajuda do "9" só em Baileys | ATD-INI-02, -03, -10, -13, -14, -19, -21, -23, -26, -27, -29; ATD-MESA-16 | 10/3 |
| **Transferir** | 760 → 480 | linha de 9 elementos e 5 cores → 4 elementos em 2 linhas; presença por forma (cheio/vazado), carga como **número + "Carga alta" a partir de 10** (decisão 7; saem "Disponível", "Em atendimento" e "Movimentado"); sai a descrição; barra de 36 px; a escolha sobrevive à busca; nota diz o que falta e avisa escolhido offline; esqueleto com a forma da linha | ATD-TRF-03, -16, -17, -19, -20, -22, -25 | 10/3 |
| **Encerrar (motivo)** | 820 → 640 | cartão com ladrilho → linha-rádio; legenda visível "Motivo do contato"; **só 2 legendas de motivo** (Financeiro, Suporte técnico — decisão 8); 2 colunas por `@container`; **"Sugerido pela IA"** na linha do motivo sugerido; vermelho sai da abertura e vai para o botão que encerra | ATD-ENC-03, -05, -09, -13, -14, -17 | 8/3 |
| **"Finalizar sem motivo"** | 480 | título, nome do cliente e consequência ("entra no Relatório como Sem motivo" — conferido no backend; **não** promete mensagem ao cliente); fica aberto até a resposta e mostra o erro; **um diálogo por lista**, não um por item | ATD-ITEM-24, -25 | 4/1 |
| **Enviar template** | 864 → 576 | uma coluna (acaba a metade vazia); texto do template uma vez (na prévia, como bolha de saída); descrição conforme o aviso que abriu (fechada × recusada); nota diz o que falta | CV-TPL-01, -02, -03, -09, -15 | 6/3 |
| **Atendimentos anteriores** | 640 | lista: linha de 2 linhas (motivo · data / hora · quem · canal), sai "Finalizado" (constante: só vêm encerrados) e a data repetida; detalhe: "←" no cabeçalho, sai a migalha e o resumo (repetia título e descrição), **a mesma bolha da conversa** em modo leitura; sem rodapé (consulta) | CV-HIS-* (ver anexo B) | 7/5 |
| **Editar cliente** | modal 672 → **painel Cliente** | a edição acontece no painel Cliente, em 1 coluna, com `[Cancelar][Salvar]` no pé do painel — a conversa fica visível enquanto o atendente copia o nome ou a cidade que o cliente escreveu (P6); no modal de conversa, no painel Cliente do modal (abaixo) | CV-EDC-03, -13 e família | 6/0 |
| **Visualizador de imagem** | tela cheia | uma barra no topo que reserva espaço (autor · data · zoom · Ajustar · **Girar** · Baixar · Fechar); a imagem nunca coberta a 100%; legenda embaixo; "Baixar" salva por `blob:` e a aba nunca sai do app | MSG-IMG-12, -15, N10 | 6/4 |
| **Alerta** | 480 | 3 faixas → 2; título diz o que falhou e com quem ("Não foi possível assumir o atendimento de Maria") | PRM-ALR-*, N9 | 3/2 |
| **Emojis** | popover | sem cabeçalho visível; âncora no gatilho; altura pelo espaço; insere no cursor; Enter/Espaço mantêm o foco na grade (o Enter seguinte não envia a mensagem) | N6, N7 | 3/0 |
| **Respostas rápidas** | popover 340 | sem cabeçalho visível; âncora e altura; **campo vazio → preenche, com texto → insere no cursor** (decisão 9); estados como itens do menu (o menu nunca fica sem item focável; sai o 2º `role="status"`); busca por letra (padrão WAI-ARIA, o papel `menu` fica) | MSG-RR-03, N7, N8 | 3/2 |
| **Nossa equipe** | modal → **painel na coluna da lista** | a coluna troca o conteúdo por "← Nossa equipe"; a conversa continua à vista (P6); saem as 4 fichas de filtro (as três seções já são as partições, com a contagem no cabeçalho); linha de 2 linhas com presença por forma; barra "● 5 online" com vaga fixa | ATD-EQM-*, ATD-EQP-* (anexo C) | 14/6 |
| **Conversa em modal + painel de informações** | — | o × vira o último botão do cabeçalho ("Fechar conversa"); **sai o painel de informações**: o modal usa o painel Cliente da própria conversa, que recebe o que só ele tinha — **"Alterar setor"** (única tela que troca o setor; mesma regra de quem pode), "Encerrado em", confiança da IA em %; estado no vocabulário único (hoje "Em atendimento" e "Em andamento" na mesma tela); rodapé "Atendimento encerrado em … · somente leitura" no lugar do compositor vazio | CVM-MOD-*, CVM-INF-*, CVM-MOD-10 | parte de 17/2 |
| **Encerrados** | popup 520–1500 → **diálogo mestre-detalhe** (decisão 10) | um diálogo só: lista à esquerda com **data** de encerramento (hoje só HH:mm numa lista que atravessa dias), a conversa encerrada à direita em modo leitura, com o painel Cliente — sai o modal empilhado sobre o popup; em largura estreita, lista → detalhe com "←" (como o Histórico); sai a ficha do próprio atendente; "Carregar mais" com erro e "Tentar de novo"; o diálogo é `lazy` no menu (spec 7(b)) | CVM-ENC-11, -14 e família | parte de 17/2 |
| **Meu perfil** | ~520, uma coluna | duas vistas no mesmo envelope: "Meu perfil" (foto, nome, telefone, e-mail só leitura, "Trocar senha ›") e "Trocar senha" — cada uma com **uma** ação principal (hoje "Salvar alterações" não salva a senha preenchida e nada avisa); erro de senha no campo; "Descartar alterações?" ao fechar com edição | PRF-12 (com a correção do 401), PRF-17 e família | 15/3 |
| **Menu da conta** | popover | gatilho só o avatar; cabeçalho com nome e papel; "Meu perfil" · divisória · "Sair" (sem confirmação, como hoje) | CAS do menu | 3/2 |
| **Aviso de transferência** | toast 9 s → **marca na lista** (decisão 11) | gatilho pela chave `transferredBy` (resolve a transferência sem nome, ATD-AVT-07); sai o toast e o prazo de 9 s: a conversa transferida entra na lista com a marca de não lida e "Transferido por Fulano" na linha 2 até ser aberta, e a frase vai para a região viva da casca; nunca sobre o compositor | ATD-AVT-05, -07 | 7/2 |
| **Faixa do canal** | faixa | uma linha: um canal → "Canal Loja desconectado · Conectar"; dois ou mais → "2 canais sem conexão · Ver canais"; falha ao buscar → "Não foi possível conferir os canais · Tentar de novo" (hoje parece "tudo conectado"); rebusca na volta do socket e da aba | CAS-BAN-05 e família | 5/2 |
| **Avisos de conexão** | trilho / faixa | um indicador só: no desktop na base do trilho, persistente enquanto reconecta, "Conectado" por 3 s; no celular faixa de 1 linha (hoje some em 3 s); uma região viva na casca (hoje até 3 `role="status"` juntos) | CAS de conexão | 6/1 |

## E.3 Decisões tomadas no desenho (dentro da direção aprovada; reversíveis)

| Decisão | Por quê |
|---|---|
| Sem ícone de cabeçalho (E.1-1) | P4; o ladrilho tonal foi revogado e um ícone neutro só repetiria o título |
| × só em diálogo de consulta (E.1-2) | "Dois jeitos de dizer não" — a regra que Confirmação e Alerta já seguem |
| Camada leve na pilha para o ESC (E.1-9) | Corrige CVM-MOD-10 para todas as camadas de uma vez, em vez de cada popover tratar o próprio ESC |
| Editar cliente no painel Cliente | P6: o modal cobria a conversa, de onde o atendente copia o nome e a cidade |
| Nossa equipe como painel na coluna da lista, sem fichas de filtro | P6: consultar quem está livre olhando a conversa que se pensa transferir |
| Painel de informações da conversa em modal consolidado no painel Cliente | Uma fonte por dado; "Alterar setor" muda de lugar, não some |
| Visualizador ganha "Girar"; galeria fica fora da E2 | Comprovante fotografado de lado é comum; galeria muda a pilha |
| Confirmação de sucesso na mesa vazia depois de transferir, encerrar ou finalizar ("Atendimento de Maria transferido para Pedro.") | Hoje a conversa só some; cobre também o admin que transfere a própria conversa e continua vendo-a (ATD-TRF-27) |
| Mantidos como hoje: "Sair" sem confirmação; a regra de quem troca o setor; a faixa do canal sem busca periódica (só na volta do socket e da aba) | Sem motivo registrado para mudar |

## E.4 Decisões do proprietário (24/09/2026 — seção 14.1 do spec)

| # | Pergunta | Decidido | Razão do proprietário |
|---|---|---|---|
| 7 | Níveis de carga no Transferir | **número + "Carga alta"** a partir de 10; saem "Disponível", "Em atendimento" (colidia com o estado da conversa) e "Movimentado" | quatro rótulos são quatro coisas para decorar; número é direto |
| 8 | Legendas do catálogo de motivos | **só as 2 que acrescentam** (Financeiro, Suporte técnico); as outras 7 repetiam o nome | legenda que repete o título é ruído |
| 9 | Resposta rápida sobre texto já digitado | **insere no cursor** (campo vazio: preenche); o teste que travava "substitui" muda junto | apagar o que a pessoa escreveu é destruir trabalho sem confirmação |
| 10 | Forma do Encerrados | **(B) diálogo mestre-detalhe** — não a (A), que eu tinha recomendado | a vista na coluna competiria com a fila ativa, que é o trabalho principal; e o popup de hoje é o que carrega a `ConversationView` pela barra lateral |
| 11 | Forma do aviso de transferência | **(A) marca na lista** | aviso fixo na coluna ocupa espaço permanente por um evento pontual |

## E.5 Conta estrutural × cosmético (critério de reprovação)

Base contada uma vez: **8 S / 5 C**. Itens: grupo A **38 S / 13 C**; grupo B **28 S / 13 C**; grupo C
**67 S / 18 C**. **Total: 141 S × 49 C — 74% estrutural.** As decisões 7 a 11 (E.4) trocam a forma de itens já contados
(o Encerrados deixa de empilhar modal; o aviso deixa de ser toast) e não mudam a conta: S continua
dominando em todos os itens. A recontagem com o desenho final entra no registro da E2 (spec 12.3). Os defeitos de comportamento que a E2
resolve na tela (famílias C.4.2 a C.4.4 e membros da CLASSE-01, dezenas nos três grupos) ficam fora
da conta — são a parte que o atendente mais sente, e não podem inflar o número estrutural.

## E.6 Achados novos das auditorias — já no Apêndice A

Conferidos um a um no código de `e5236da` e **incorporados ao inventário** (regra do projeto: tudo que
o subagente escreve de novo eu confiro inteiro): **18 estados novos** (ATD-INI-30, -31; ATD-ITEM-27;
PRM-CNF-02; CV-HIS-19, -20; MSG-EMO-06, -07; MSG-RR-13; PRM-ALR-02; MSG-IMG-18; CVM-MOD-11; CVM-INF-15;
CVM-ENC-15; PRF-18; ATD-AVT-08; CAS-SHL-09, -10) e **3 correções** (ATD-INI-08, CV-HIS-13, CV-CAB-13). O
verificador segue em 0 falhas e 0 linhas sem conferência (1.708 estados). Os que já tinham linha
(escolha do Transferir que some com a busca, linhas clicáveis no envio, ESC engolido, rodapé de
conversa encerrada vazio, descrição falsa do Enviar template) não viraram linha nova. Ficaram fora,
por não serem estado de tela: regras mortas de CSS do Transferir, largura do Encerrados declarada 3×
e o portal redundante do `TeamPanel` — estão nas mudanças da E.2. A lista original:

- Grupo A: foco inicial do Iniciar conversa cai no País; durante a carga o corpo desenha o formulário
  Baileys; ajuda do "9" falsa em canal oficial; "exige template" dito até 3×; regras mortas do
  Transferir; escolha do Transferir some com a busca; linhas do Transferir clicáveis durante o envio;
  confirmação lida duas vezes; confirmação presa ao item da lista (some quando o item sai da fila);
  Enviar template com descrição falsa quando vem do aviso "indeterminada".
- Grupo B: N1–N10 (anexo B, seção 8) — entre eles: Enter no emoji envia a mensagem seguinte (N6);
  popovers cortados a 683×384 (N7); menu de respostas sem item focável (N8); visor coberto pela barra
  (N10).
- Grupo C: `overlays.css` vaza para o compositor da conversa em modal; "Em atendimento" × "Em
  andamento" na mesma tela; Encerrados sem data; largura do Encerrados declarada 3×; rodapé de
  conversa encerrada vazio; Meu perfil com dois botões de envio; ESC engolido pela ordem dos
  ouvintes; aviso de transferência sobre o compositor (por cálculo, a medir); sinal de queda do
  socket some no celular; até 3 `role="status"` na queda; portal redundante do `TeamPanel`.

## E.7 Correções que as auditorias trouxeram

| Onde | Estava | Fica |
|---|---|---|
| Apêndice A (ATD-INI-24, -29) e C.4.1 | a frase "…does not belong to this channel's WABA" chegava crua | é traduzida (`utils/errorMessages.js:76`); o defeito de ATD-INI-29 é a corrida. Erro do meu script de conferência (cortava a frase no apóstrofo) |
| Spec, seção 8 | "`ConversationHistoryModal` busca o histórico inteiro; paginar exige backend (protegido)" | a rota de mensagens já aceita `limit` e `before` (adição compatível, ADR-010): paginar o **detalhe** é só frontend (E4); a **lista** tem `LIMIT 50` fixo no backend (registrado) |
| Spec, seção 6.3 | Histórico, SGP e Cliente "alternância com `aria-expanded`" | SGP e Cliente alternam painel (`aria-expanded`); Histórico abre diálogo (`aria-haspopup="dialog"`) |
| Spec, seção 6.6 | "ícone de cabeçalho neutro" | sem ícone de cabeçalho (E.1-1) |
| Spec, seção 7(b) | `ClosedConversationsModal` passa a `lazy` no `SideNav` | vale: a decisão 10 ficou em (B), diálogo mestre-detalhe; o `lazy` entra na E2 junto com o diálogo novo |
