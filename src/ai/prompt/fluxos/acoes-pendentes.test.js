// Conclusão do atendimento (04/10/2026): o bloco do encaminhamento tentado e não concluído.
const fluxo = require('./acoes-pendentes');

describe('fluxo acoes-pendentes', () => {
  test('só entra com tentativa sem confirmação registrada', () => {
    expect(fluxo.entra({})).toBe(false);
    expect(fluxo.entra({ acoesPendentes: null })).toBe(false);
    expect(fluxo.entra({ acoesPendentes: { encaminhamento: { tentativas: 0 } } })).toBe(false);
    expect(fluxo.entra({ acoesPendentes: { encaminhamento: { tentativas: 1 } } })).toBe(true);
  });

  test('diz o fato, que nada foi agendado, e que só o pedido renovado autoriza nova tentativa', () => {
    const t = fluxo.linhas({ acoesPendentes: { encaminhamento: { tentativas: 2 } } }).join('\n');
    expect(t).toMatch(/ENCAMINHAMENTO TENTADO E NÃO CONCLUÍDO \(fato do sistema\)/);
    expect(t).toMatch(/tentado 2 vezes e não foi concluído/);
    expect(t).toMatch(/não entrou na fila e continua aqui/);
    expect(t).toMatch(/Nada foi agendado: não há nova tentativa automática, retorno nem acompanhamento/);
    expect(t).toMatch(/Não pergunte se ele quer um atendente/);
    expect(t).toMatch(/pedidoRenovadoNaMensagemAtual/);
    expect(t).toMatch(/clientePediuAtendente não basta/);
    expect(t).toMatch(/Agradecimento, desistência ou outro assunto não renovam o pedido/);
    // Não afirma o que o sistema não sabe: a equipe pode ver a conversa na triagem.
    expect(t).not.toMatch(/ninguém da equipe/);
  });

  test('singular com uma tentativa', () => {
    expect(fluxo.linhas({ acoesPendentes: { encaminhamento: { tentativas: 1 } } }).join('\n')).toMatch(/tentado 1 vez e/);
  });
});
