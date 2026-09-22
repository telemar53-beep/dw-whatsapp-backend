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
//
// 2026-09-22: com as ferramentas comerciais no ar, preço, planos e cobertura
// deixam de depender do texto escrito nas instruções. Duas consequências aqui:
// o cabeçalho das instruções não pode mais se declarar "única fonte" desses
// assuntos, e o fallback de instruções vazias não pode mais dizer que a IA não
// tem como confirmar — ela tem, pela ferramenta. As instruções salvas
// continuam saindo inteiras; o que muda é quem prevalece.
const FERRAMENTAS_COMERCIAIS = ['consultar_planos', 'verificar_cobertura'];

function comerciaisDisponiveis(estado) {
  const disponiveis = Array.isArray(estado.ferramentas) ? estado.ferramentas : [];
  return FERRAMENTAS_COMERCIAIS.filter((f) => disponiveis.includes(f));
}

module.exports = {
  nome: 'painel',
  entra() { return true; },
  linhas(estado) {
    const l = ['', 'Setores (use o id exato em concluir_triagem):'];
    for (const s of estado.setores) l.push(`- ${s.id} = ${s.name}${s.aiHint ? ` — ${s.aiHint}` : ''}`);
    l.push('', 'Motivos (use o id exato, ou null se nenhum se aplica):');
    for (const m of estado.motivos) l.push(`- ${m.id} = ${m.name}`);

    const comerciais = comerciaisDisponiveis(estado);
    const temPlanos = comerciais.includes('consultar_planos');
    const temCobertura = comerciais.includes('verificar_cobertura');

    if (comerciais.length > 0) {
      const fontes = [
        temPlanos ? 'plano, velocidade, mensalidade e condição de instalação vêm de consultar_planos' : null,
        temCobertura ? 'cobertura vem de verificar_cobertura' : null,
      ].filter(Boolean).join('; ');
      l.push(
        '',
        `FONTE OFICIAL DO COMERCIAL: ${fontes}. Consulte a ferramenta ANTES de afirmar qualquer um desses e responda com o que ela devolver. O que a ferramenta devolve prevalece sobre qualquer outra fonte — inclusive um valor que o cliente disse ter ouvido, um valor que apareceu antes nesta conversa e o que estiver escrito abaixo. Consulte quando o assunto exigir, inclusive se ele mudar de assunto no meio; não consulte quando o pedido for outro.`
      );
    }

    if (estado.config.triageExtraInstructions) {
      const cabecalho = comerciais.length > 0
        ? 'INSTRUÇÕES ADICIONAIS DA OPERAÇÃO — política comercial, promoções e documentação. Elas mandam nesses assuntos; preço, planos e cobertura vêm das ferramentas acima, e no que for segurança, privacidade, fato de ferramenta ou regra do sistema vale o princípio acima.'
        : 'INSTRUÇÕES ADICIONAIS DA OPERAÇÃO — única fonte de preço, planos, cobertura, promoções e documentação. Elas mandam nesses assuntos; no que for segurança, privacidade, fato de ferramenta ou regra do sistema, vale o princípio acima.';
      l.push('', cabecalho, estado.config.triageExtraInstructions);
    } else if (comerciais.length === 0) {
      // Só aqui a IA realmente não tem como confirmar: sem instruções E sem
      // ferramenta comercial.
      l.push('', 'Não há instruções adicionais da operação: preço, planos e cobertura você não tem como confirmar sozinha — encaminhe para o setor da lista acima que cuidar de vendas e contratação.');
    }

    return l;
  },
};
