// Esqueleto: preenchido numa tarefa futura desta mesma entrega. O compositor
// (montar.js) já carrega este módulo; entra() falso não acrescenta nada ao
// prompt até a tarefa que implementa o fluxo "terceiros" substituir este
// arquivo. É este módulo que vai usar estado.terceiro (hoje o construtor
// antigo nem recebe esse parâmetro).
module.exports = {
  nome: 'terceiros',
  entra() { return false; },
  linhas() { return []; },
};
