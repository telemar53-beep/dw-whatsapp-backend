// Linha de formatação do WhatsApp. No construtor antigo ela aparecia duas
// vezes (uma por cenário de systemContent); aqui é uma única fonte.
module.exports = {
  nome: 'formato',
  entra() { return true; },
  linhas() {
    return ['', 'Formatação: WhatsApp. Negrito com *um asterisco*. Nunca markdown. Responda uma vez só: nunca repita uma frase ou parágrafo que você já escreveu.'];
  },
};
