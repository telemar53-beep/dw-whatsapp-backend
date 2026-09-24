// Correções minhas sobre o v3, depois da amostra independente (24/09/2026).
// Idempotente: pode rodar de novo depois de um `node montar-v3.cjs`.
const fs = require('fs');
const path = require('path');
const arq = path.join(__dirname, '_corpo-v3.md');
const linhas = fs.readFileSync(arq, 'utf8').split('\n');
const SEP = /(?<!\\)\|/;

function trocarColuna(id, indice, valor) {
  const i = linhas.findIndex((l) => l.startsWith(`| ${id} |`));
  if (i < 0) throw new Error('sem ' + id);
  const cols = linhas[i].split(SEP);
  cols[indice] = ` ${valor} `;
  linhas[i] = cols.join('|');
}
function inserirDepois(idAnterior, linha) {
  const id = linha.split(SEP)[1].trim();
  if (linhas.some((l) => l.startsWith(`| ${id} |`))) return;
  const i = linhas.findIndex((l) => l.startsWith(`| ${idAnterior} |`));
  if (i < 0) throw new Error('sem ' + idAnterior);
  linhas.splice(i + 1, 0, linha);
}

// colunas: 1 id · 2 tipo · 3 gatilho · 4 onde · 5 texto · 6 defeito
trocarColuna('ACS-LOG-05', 4, 'pages/LoginPage.jsx:120 (form `aria-busy` :103)');
// ATD-INI-24 fica como a conferência deixou (sem defeito): a frase da WABA É
// traduzida (utils/errorMessages.js:76). Eu tinha escrito o contrário — o meu
// script de conferência cortava a frase do backend no apóstrofo de "channel's".
// Correção pega pela auditoria dos overlays (grupo A), 24/09/2026.
inserirDepois(
  'ATD-INI-28',
  '| ATD-INI-29 | variante | trocar de canal entre dois canais oficiais antes de os templates do primeiro chegarem | components/StartConversationModal.jsx:75-77, :197-200 | (a lista e o template escolhido ficam os do canal anterior) | (suspeita) o .then da 75 não confere se o canal ainda é o mesmo: a resposta atrasada sobrescreve a do canal atual (classe CLASSE-01); "Iniciar conversa" é recusado com "Este template não pertence à WABA deste canal." (src/api/conversations.routes.js:169-171, traduzida em utils/errorMessages.js:76) |'
);

// Achados novos das auditorias dos overlays (Apêndice E.6), conferidos um a um
// contra e5236da antes de entrar (24/09/2026).
trocarColuna('ATD-INI-08', 6, 'em canal oficial a frase promete o que não acontece: a conferência do 9 só roda no Baileys (src/api/conversations.routes.js:152); no oficial o número segue como digitado (:179)');
trocarColuna('CV-HIS-13', 6, '"Status" é sempre "Finalizado": a lista só traz encerrados (src/conversations/conversation.repository.js:796); a linha não informa nada');
trocarColuna('CV-CAB-13', 6, 'o texto promete "ver os dados", mas o clique abre a EDIÇÃO do cliente (:574)');
const novos = [
  ['ATD-INI-29', '| ATD-INI-30 | interação:abrir modal | abrir "Iniciar conversa" com os canais ainda carregando | components/StartConversationModal.jsx:154 (texto em components/StartConversationModal.jsx:8-16) | (o foco inicial vai para "País", quase sempre "Brasil"; o campo que sempre se digita é o Telefone) | o Dialog foca o 1º campo habilitado na abertura (components/ui/Dialog.jsx:69-82) e o select "Canal" ainda não existe (:124-131); nenhum data-autofocus no modal |'],
  ['ATD-INI-30', '| ATD-INI-31 | carregando | canais ainda carregando | components/StartConversationModal.jsx:243-245 | "Mensagem inicial" · "Mensagem" (o formulário do Baileys aparece antes de se saber o tipo do canal) | sem canal escolhido o canal não é oficial (:54); se o 1º canal for oficial, a seção troca de conteúdo e de altura quando a lista chega |'],
  ['ATD-ITEM-26', '| ATD-ITEM-27 | variante | o item sai da fila com a confirmação de "Finalizar sem motivo" aberta (outro atendente assumiu, a triagem mudou de aba) | components/ConversationListItem.jsx:194 | AUSENTE (a confirmação some sem explicação) | um useConfirm por item (:46) e o diálogo dentro do li (:194): o item desmonta e leva o diálogo |'],
  ['PRM-CNF-01', '| PRM-CNF-02 | variante | confirmação sem título (useConfirm não repassa title) | components/ui/ConfirmDialog.jsx:21-22 | ({message} como nome e como descrição do diálogo) | o leitor de tela lê a mesma frase duas vezes: ariaLabel = mensagem e describedBy = a mesma mensagem; useConfirm não repassa title (hooks/useConfirm.jsx:25-35) |'],
  ['CV-HIS-18', '| CV-HIS-19 | interação:voltar | "Voltar" do detalhe para a lista | components/ConversationHistoryModal.jsx:100 | AUSENTE (nenhum elemento recebe o foco) | (suspeita) o Voltar desmonta ao voltar para a lista e nada recebe o foco (o efeito :85 só foca o Voltar ao abrir um detalhe): o foco cai no body e o Tab seguinte pode sair do diálogo |'],
  ['CV-HIS-19', '| CV-HIS-20 | variante | cliente com mais de 50 atendimentos encerrados | components/ConversationHistoryModal.jsx:91-93 | AUSENTE (nada diz que a lista parou em 50) | a consulta tem LIMIT 50 fixo (src/conversations/conversation.repository.js:798) e a descrição só conta o que veio |'],
  ['MSG-EMO-05', '| MSG-EMO-06 | interação:navegação por teclado | escolher um emoji com Enter ou Espaço | components/MessageInput.jsx:344-347 | (o foco volta para o campo de mensagem) | (suspeita) appendEmoji devolve o foco ao campo também pelo teclado (:346); o Enter seguinte, dado para escolher outro emoji, envia a mensagem (:380-384) |'],
  ['MSG-EMO-06', '| MSG-EMO-07 | responsivo | janela 683×384 com o campo no teto | components/MessageInput.jsx:534 | (popover de emojis cortado acima da janela) | (suspeita, por conta; medir no harness) popover de altura fixa acima de um campo que já ocupa o teto de 45% da janela (:22): cerca de 100 px ficam fora; vale também para as respostas rápidas (:562) |'],
  ['MSG-RR-12', '| MSG-RR-13 | carregando | abrir "Respostas rápidas" com a lista carregando, com erro ou vazia | components/MessageInput.jsx:559-570 | (esqueleto, erro ou vazio dentro do menu) | os estados ficam dentro de role="menu" sem nenhum menuitem (o menu fica sem item focável) e o esqueleto soma um segundo role="status" na tela (components/ui/AsyncState.jsx:5; o da conversa em components/ConversationView.jsx:691) |'],
  ['PRM-ALR-01', '| PRM-ALR-02 | variante | alerta de falha ao assumir ou na sugestão da IA | components/ConversationView.jsx:521 (texto em components/ui/AlertDialog.jsx:10) | "Aviso" · "{erro traduzido}" · "Entendi" | (suspeita) o título é o genérico "Aviso" e a frase diz "este atendimento" sem dizer qual; o aviso não é zerado na troca de conversa (hooks/useAlert.jsx:8; o efeito de troca em components/ConversationView.jsx:371-383 não o limpa) |'],
  ['MSG-IMG-17', '| MSG-IMG-18 | variante | imagem que ocupa a tela no visualizador (100%) | components/MessageAttachment.jsx:434-441, :470 | ("✕" no canto de cima e a barra de zoom embaixo, por cima da imagem) | os controles são absolutos sobre o palco (absolute right-5 top-4; absolute bottom-5): nenhum espaço reservado, a imagem fica coberta |'],
  ['CVM-MOD-10', '| CVM-MOD-11 | variante | conversa aberta no modal (Supervisão, Encerrados) | components/ConversationModal.jsx:25 | (o compositor ganha letra 13 px, raio 7, padding 7/10 e alça de redimensionar; os botões da conversa, 12 px) | (suspeita pelo mecanismo; medir por estilo computado) as regras por descendente de .dw-dialog (components/overlays.css:19-22), fora de @layer, vencem os utilitários do compositor (components/MessageInput.jsx:522) |'],
  ['CVM-INF-14', '| CVM-INF-15 | variante | conversa atribuída no modal | components/ConversationInfoPanel.jsx:25-27 (texto em components/ConversationView.jsx:150) | "Em andamento" (o cabeçalho da mesma tela diz "Em atendimento") | o mesmo estado com dois nomes e duas cores na mesma tela (components/ConversationView.jsx:150, verde; aqui laranja): quebra P5 |'],
  ['CVM-ENC-14', '| CVM-ENC-15 | variante | lista de encerrados que atravessa dias | components/ConversationListItem.jsx:222-226 (texto em components/ConversationListItem.jsx:38-41) | ({HH:mm da última mensagem}, sem data) | nada diz o dia do encerramento; só a hora da última mensagem |'],
  ['PRF-17', '| PRF-18 | variante | preencher a senha e clicar em "Salvar alterações" | components/ProfileModal.jsx:201 | "Salvar alterações" (salva só nome e telefone) | dois formulários na mesma vista (:154 e :177): "Salvar alterações" envia só o do perfil e a senha preenchida é ignorada sem aviso |'],
  ['ATD-AVT-07', '| ATD-AVT-08 | variante | aviso de transferência numa tela de 1366 px | components/TransferNotice.jsx:24-26 | (o cartão fica sobre a área da conversa, perto do compositor) | (suspeita, por conta; medir no harness) cartão de 416 px centralizado na janela: ocupa x ≈ 475–891, e a conversa começa em ≈ 420 |'],
  ['CAS-SHL-08', '| CAS-SHL-09 | tempo-real | socket caiu com uma conversa aberta | components/AppShell.jsx:72-75 | (até três anúncios de estado ao mesmo tempo) | a faixa (components/AppShell.jsx:74), o indicador do menu (components/SideNav.jsx:146) e o da conversa (components/ConversationView.jsx:691) são role="status"; o spec pede um por tela |'],
  ['CAS-SHL-09', '| CAS-SHL-10 | responsivo | celular (< 768 px) com o socket caído há mais de 3 s | components/AppShell.jsx:72-75 | AUSENTE (nenhum sinal de que a conexão continua caída) | a faixa some em 3 s (:29-31) e o indicador persistente mora no menu, escondido nessa largura (components/side-nav.css:9) |'],
];
for (const [depois, linha] of novos) inserirDepois(depois, linha);

// Um tipo por linha: o caso dominante do primitivo (27 de 37 usos sem onRetry)
// é "erro"; a variante com "Tentar de novo" está descrita no texto.
trocarColuna('PRM-ASY-03', 2, 'erro');

// Intervalos largos demais para a checagem valer: estreitados para as linhas
// que desenham o estado (conferido à mão contra e5236da).
trocarColuna('MSG-IMG-06', 4, 'components/MessageAttachment.jsx:415-421, :439');
trocarColuna('MSG-AUD-01', 4, 'components/MessageAttachment.jsx:137-145, :14');
trocarColuna('CAM-NOV-17', 4, 'components/CreateCampaignModal.jsx:87-91, :111-116, :163-164');

fs.writeFileSync(arq, linhas.join('\n'));
console.log('ok');
