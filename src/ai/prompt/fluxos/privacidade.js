// Seleção pronta, conteúdo ainda esqueleto (rodada de correção 1, dono,
// 2026-09-18): privacidade vale em QUALQUER estado de identidade — não
// identificado ou identificado, tanto faz —, então entra() já é true. O texto
// ("DADOS DE OUTRA PESSOA" etc.) é da Task 13: migra de ai-orchestrator.js
// trocando os nomes reais de cliente do texto original ("Laureny",
// "Jureildson") por marcador, e sem duplicar o que fatos.js já cobre.
module.exports = {
  nome: 'privacidade',
  entra() { return true; },
  linhas() { return []; },
};
