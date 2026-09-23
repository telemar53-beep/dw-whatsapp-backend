const { loadConfig } = require('./env');

// A origem do Vite em desenvolvimento entra sempre: sem ela, ninguém consegue
// rodar o frontend local contra um backend que já exista.
const ORIGEM_DE_DESENVOLVIMENTO = 'http://localhost:5173';

/**
 * `FRONTEND_ORIGIN` aceita VÁRIAS origens separadas por vírgula. Uma origem só
 * continua valendo exatamente como antes — a lista é aditiva.
 *
 * Ela existe para a troca de domínio: com uma origem única, trocar a variável
 * faz o domínio ANTIGO parar de responder no mesmo instante em que o novo passa
 * a valer, e entre o restart do backend e o rebuild do frontend (que é de build
 * time) sobra uma janela sem CORS e sem socket — em cima do atendimento. Com os
 * dois valendo ao mesmo tempo, a migração não tem degrau, e o antigo sai depois,
 * com calma.
 *
 * Espaço em volta e vírgula sobrando são erro de digitação em painel, não
 * configuração inválida: aparar e descartar vazio custa menos do que uma origem
 * fantasma, que só se manifesta como CORS recusado em produção. Repetida também
 * é aparada — colar a lista duas vezes é o acidente natural de um campo assim.
 */
function separarOrigens(bruto) {
  if (typeof bruto !== 'string') return [];
  return bruto
    .split(',')
    .map((origem) => origem.trim())
    .filter(Boolean);
}

function getAllowedOrigins() {
  const { frontendOrigin } = loadConfig();
  return [...new Set([ORIGEM_DE_DESENVOLVIMENTO, ...separarOrigens(frontendOrigin)])];
}

module.exports = { getAllowedOrigins };
