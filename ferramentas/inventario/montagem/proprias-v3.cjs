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
