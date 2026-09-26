const { intencaoDeAlvo, resolverAlvoDoTurno, fixarAlvoTerceiro } = require('./financial-target');

// Caso Fulana/Beltrana (25/09/2026): o alvo de TERCEIRO é "grudento". Só uma intenção EXPLÍCITA na
// mensagem do cliente muda o alvo — lida em código, por palavras inteiras, sem OpenAI.
describe('intencaoDeAlvo', () => {
  test.each([
    'agora quero minha fatura', 'manda o meu pix', 'meu boleto', 'agora o meu', 'e a minha também?',
    'Agora manda o MEU PIX!', 'quero a minha segunda via', 'pra mim também',
  ])('própria: "%s"', (texto) => {
    expect(intencaoDeAlvo(texto, 'Beltrana')).toBe('proprio');
  });

  test.each([
    'manda o dela', 'o boleto dele', 'manda o pix da Beltrana', 'o da beltrana também', 'a fatura do meu marido',
    'o boleto da minha mãe', 'da outra pessoa',
  ])('de terceiro: "%s"', (texto) => {
    expect(intencaoDeAlvo(texto, 'Beltrana')).toBe('terceiro');
  });

  test.each([
    'manda o meu e o dela', 'o meu marido quer o boleto dele e o meu', 'a minha e a da Beltrana',
  ])('ambígua (os dois lados): "%s"', (texto) => {
    expect(intencaoDeAlvo(texto, 'Beltrana')).toBe('ambiguo');
  });

  test.each(['manda o pix', 'manda o boleto também', 'pode mandar', 'ok', 'obrigada', '', null])('sem alvo explícito: %p', (texto) => {
    expect(intencaoDeAlvo(texto, 'Beltrana')).toBeNull();
  });

  test('"da minha mãe" não é "a minha": palavra inteira, não pedaço', () => {
    expect(intencaoDeAlvo('manda o boleto da minha mãe', null)).toBe('terceiro');
  });
});

describe('resolverAlvoDoTurno', () => {
  const BELTRANA = { nome: 'Beltrana', contratos: [{ id: 2002 }] };

  test('terceiro ativo + pedido sem alvo explícito: continua o terceiro (grudento)', () => {
    expect(resolverAlvoDoTurno({ terceiro: BELTRANA, texto: 'manda o boleto também' }))
      .toEqual({ terceiro: BELTRANA, voltarAoTitular: false, alvoAmbiguo: false });
  });

  test('terceiro ativo + "agora quero minha fatura": volta ao titular, sem pedir CPF', () => {
    expect(resolverAlvoDoTurno({ terceiro: BELTRANA, texto: 'agora quero minha fatura' }))
      .toEqual({ terceiro: null, voltarAoTitular: true, alvoAmbiguo: false });
  });

  test('terceiro ativo + intenção dos dois lados: nada de cobrança até esclarecer', () => {
    expect(resolverAlvoDoTurno({ terceiro: BELTRANA, texto: 'manda o meu e o dela' }))
      .toEqual({ terceiro: BELTRANA, voltarAoTitular: false, alvoAmbiguo: true });
  });

  test('sem terceiro + cliente fala de outra pessoa sem CPF: nada de cobrança do titular até esclarecer', () => {
    expect(resolverAlvoDoTurno({ terceiro: null, texto: 'manda o boleto da minha mãe' }))
      .toEqual({ terceiro: null, voltarAoTitular: false, alvoAmbiguo: true });
  });

  test('sem terceiro + pedido do próprio ou sem alvo: segue o titular', () => {
    expect(resolverAlvoDoTurno({ terceiro: null, texto: 'manda o pix' })).toEqual({ terceiro: null, voltarAoTitular: false, alvoAmbiguo: false });
    expect(resolverAlvoDoTurno({ terceiro: null, texto: 'meu boleto' })).toEqual({ terceiro: null, voltarAoTitular: false, alvoAmbiguo: false });
  });

  test('terceiro PENDENTE (CPF não encontrado) + "manda o pix": continua pendente, não volta ao titular', () => {
    const pendente = { nome: null, contratos: [], pendente: true };
    expect(resolverAlvoDoTurno({ terceiro: pendente, texto: 'manda o pix' }))
      .toEqual({ terceiro: pendente, voltarAoTitular: false, alvoAmbiguo: false });
  });
});

test('um terceiro consultado resolve a ambiguidade do turno', () => {
  const contexto = { alvoAmbiguo: true };
  fixarAlvoTerceiro(contexto, [{ id: 2002 }]);
  expect(contexto.alvoAmbiguo).toBe(false);
  expect(contexto.alvoTerceiro).toEqual({ contratos: [2002] });
});
