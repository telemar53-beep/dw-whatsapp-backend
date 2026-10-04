// Ações pendentes: o FATO do sistema de que o encaminhamento já foi tentado e NÃO foi concluído nesta conversa
// (conclusão do atendimento, 04/10/2026; base: condução após falha de 30/09, com a redação ajustada).
//
// Os resultados de ferramenta de turnos anteriores não voltam ao histórico. No turno seguinte a um encaminhamento que
// falhou, o modelo só via o próprio texto anterior: voltou a oferecer o atendente (micropiloto 2, E3) e tentou de novo
// a quem só agradeceu ou desistiu (avaliação de 01/10, falha 4). O orquestrador lê as tentativas sem confirmação do
// registro das interações; como a conversa ainda está na triagem, nenhuma concluiu. Este bloco diz o fato e o que é
// permitido; quem barra a nova tentativa sem pedido renovado é concluir_triagem. Não decide nada.
module.exports = {
  nome: 'acoes-pendentes',
  entra(estado) {
    const e = estado && estado.acoesPendentes && estado.acoesPendentes.encaminhamento;
    return Boolean(e && e.tentativas > 0);
  },
  linhas(estado) {
    const n = estado.acoesPendentes.encaminhamento.tentativas;
    return [
      '',
      `ENCAMINHAMENTO TENTADO E NÃO CONCLUÍDO (fato do sistema): nesta conversa o encaminhamento para a equipe já foi tentado ${n} ${n === 1 ? 'vez' : 'vezes'} e não foi concluído — o atendimento não entrou na fila e continua aqui com você. Nada foi agendado: não há nova tentativa automática, retorno nem acompanhamento.`,
      'Não pergunte se ele quer um atendente. Só tente de novo se a mensagem ATUAL dele pedir de novo para falar com um atendente: chame concluir_triagem com pedidoRenovadoNaMensagemAtual igual ao trecho exato dessa mensagem (clientePediuAtendente não basta) e diga o resultado real. Agradecimento, desistência ou outro assunto não renovam o pedido: responda ao que ele disse agora, sem nova tentativa.',
    ];
  },
};
