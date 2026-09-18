// Seleção pronta, conteúdo ainda esqueleto (rodada de correção 1, dono,
// 2026-09-18): a exceção de fatura/boleto/PIX de outra pessoa vale em
// QUALQUER estado de identidade, então entra() já é true. É este módulo que
// vai usar estado.terceiro (hoje o construtor antigo nem recebe esse
// parâmetro). O texto é da Task 13: migra de ai-orchestrator.js trocando os
// nomes reais de cliente do texto original ("Laureny", "Jureildson") por
// marcador.
module.exports = {
  nome: 'terceiros',
  entra() { return true; },
  linhas() { return []; },
};
