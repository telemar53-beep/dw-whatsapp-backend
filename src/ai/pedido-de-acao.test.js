const { estadoDoPedido, pedidoDepoisDe } = require('./pedido-de-acao');

// Rodada 10 (08/10/2026; ordem, item 1): o pedido de ação lido das mensagens gravadas da janela, na ordem.
const cliente = (id, texto) => ({ id, de: 'cliente', texto });
const ia = (id, texto) => ({ id, de: 'ia', texto });

describe('estadoDoPedido', () => {
  test('o último ato dele sobre a cobrança decide: a desistência depois do pedido vale até um pedido novo', () => {
    expect(estadoDoPedido([cliente('m1', 'Oi, manda o pix.')])).toBe('pedido');
    expect(estadoDoPedido([cliente('m1', 'Oi, manda o pix.'), ia('a1', 'Um instante.'), cliente('m2', 'esquece o PIX')])).toBe('desistencia');
    expect(estadoDoPedido([
      cliente('m1', 'Oi, manda o pix.'), cliente('m2', 'esquece o PIX'), ia('a1', 'Tudo bem!'), cliente('m3', 'ok'),
    ])).toBe('desistencia');
    expect(estadoDoPedido([
      cliente('m1', 'Oi, manda o pix.'), cliente('m2', 'esquece o PIX'), ia('a1', 'Tudo bem!'), cliente('m3', 'pode mandar o pix sim'),
    ])).toBe('pedido');
  });
  test('a resposta afirmativa só reabre depois de uma pergunta da IA sobre a cobrança (a última fala da IA antes dela)', () => {
    const base = [cliente('m1', 'manda o pix'), cliente('m2', 'esquece')];
    expect(estadoDoPedido([...base, ia('a1', 'Tudo bem. Você ainda quer o PIX?'), cliente('m3', 'sim')])).toBe('pedido');
    expect(estadoDoPedido([...base, ia('a1', 'Tudo bem! Posso ajudar em algo mais?'), cliente('m3', 'sim')])).toBe('desistencia');
    // A pergunta antiga não vale para a segunda fala seguida dele.
    expect(estadoDoPedido([...base, ia('a1', 'Você ainda quer o PIX?'), cliente('m3', 'obrigado'), cliente('m4', 'sim')])).toBe('desistencia');
  });
  test('sem pedido nem desistência na janela: null', () => {
    expect(estadoDoPedido([cliente('m1', 'oi'), ia('a1', 'Olá!'), cliente('m2', 'tudo bem?')])).toBe(null);
    expect(estadoDoPedido([])).toBe(null);
  });
  test('"não precisa ter pressa" não desiste', () => {
    expect(estadoDoPedido([cliente('m1', 'manda o pix'), cliente('m2', 'não precisa ter pressa')])).toBe('pedido');
  });
});

describe('pedidoDepoisDe', () => {
  const janela = [
    cliente('m1', 'Oi, manda o boleto.'), ia('a1', ''), ia('a2', 'Prontinho! Enviei acima o boleto.'), cliente('m2', 'obrigado'),
  ];
  test('o reenvio só com pedido dele DEPOIS da mensagem que pediu a entrega anterior', () => {
    expect(pedidoDepoisDe(janela, 'm1')).toBe(false);
    expect(pedidoDepoisDe([...janela, cliente('m3', 'não chegou, manda de novo')], 'm1')).toBe(true);
    expect(pedidoDepoisDe([...janela, cliente('m3', 'não chegou')], 'm1')).toBe(false);
    expect(pedidoDepoisDe([...janela, cliente('m3', 'não chegou'), ia('a3', 'Quer que eu reenvie o boleto?'), cliente('m4', 'sim')], 'm1')).toBe(true);
  });
  test('a entrega pedida pela mensagem atual (o mesmo turno): nada depois dela', () => {
    expect(pedidoDepoisDe([cliente('m1', 'Oi, manda o boleto.')], 'm1')).toBe(false);
  });
  test('o pedido seguido de desistência não autoriza', () => {
    expect(pedidoDepoisDe([...janela, cliente('m3', 'manda de novo'), cliente('m4', 'esquece, achei aqui')], 'm1')).toBe(false);
  });
  test('a mensagem da entrega anterior fora da janela: toda a janela veio depois dela', () => {
    expect(pedidoDepoisDe([cliente('m7', 'manda de novo')], 'm1')).toBe(true);
    expect(pedidoDepoisDe([cliente('m7', 'obrigado')], 'm1')).toBe(false);
  });
});

// Revisão da rodada 10 (A1-1): o cenário da revisão — a pergunta da recusa respondida com a negação posposta.
describe('negação posposta na janela (revisão da rodada 10)', () => {
  test('"precisa mandar não" depois da pergunta mantém a desistência; "manda mais não" não autoriza reenvio', () => {
    expect(estadoDoPedido([cliente('m1', 'oi, manda o pix'), cliente('m2', 'esquece o pix'), ia('a1', 'Tudo bem. Você ainda quer a cobrança?'), cliente('m3', 'precisa mandar não')])).toBe('desistencia');
    expect(pedidoDepoisDe([cliente('m1', 'manda o boleto'), ia('a1', 'Enviei acima o boleto.'), cliente('m2', 'manda mais não, obrigado')], 'm1')).toBe(false);
  });
});
