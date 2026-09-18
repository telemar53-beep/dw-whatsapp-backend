// Setores, motivos e as instruções adicionais da operação — o conteúdo que
// vem do painel administrativo (banco), não do código. O cabeçalho das
// instruções cita "vale o princípio acima" para amarrar com a hierarquia de
// principios.js: fora de preço/planos/cobertura/política comercial, quem
// manda é a PRIORIDADE, não o texto da operação.
//
// Rodada de correção 3 (dono, 2026-09-18): a frase de fallback (sem
// instruções adicionais) dizia "são sempre com o setor comercial" — nome de
// setor fixo, violando a Restrição Global ("nomes de setor e motivo nunca
// aparecem como string literal"). Numa operação sem um setor chamado
// "Comercial" a frase afirmaria algo que não está na lista real (a lista de
// estado.setores, injetada acima, é a única fonte). Agora ela aponta para
// "o setor da lista acima", sem nomear nenhum.
module.exports = {
  nome: 'painel',
  entra() { return true; },
  linhas(estado) {
    const l = ['', 'Setores (use o id exato em concluir_triagem):'];
    for (const s of estado.setores) l.push(`- ${s.id} = ${s.name}${s.aiHint ? ` — ${s.aiHint}` : ''}`);
    l.push('', 'Motivos (use o id exato, ou null se nenhum se aplica):');
    for (const m of estado.motivos) l.push(`- ${m.id} = ${m.name}`);
    if (estado.config.triageExtraInstructions) {
      l.push(
        '',
        'INSTRUÇÕES ADICIONAIS DA OPERAÇÃO — única fonte de preço, planos, cobertura, promoções e documentação. Elas mandam nesses assuntos; no que for segurança, privacidade, fato de ferramenta ou regra do sistema, vale o princípio acima.',
        estado.config.triageExtraInstructions
      );
    } else {
      l.push('', 'Não há instruções adicionais da operação: preço, planos e cobertura você não tem como confirmar sozinha — encaminhe para o setor da lista acima que cuidar de vendas e contratação.');
    }
    return l;
  },
};
