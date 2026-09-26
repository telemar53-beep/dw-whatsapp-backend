const modulo = require('./documento-pendente');
const { estadoBase } = require('../estado-de-teste');

// Documento pendente (25/09/2026): o fato "o documento já foi pedido e ainda não veio" entra no
// prompt só quando existe — sem ele, o prompt é o de antes.
const PENDENTE = { alvo: 'principal', assunto: 'suporte', mudouDeAssunto: false, retomou: false, mudancaRelevante: false, irritado: false, mandouOProprioDocumento: false };
const texto = (documento) => modulo.linhas(estadoBase({ documento })).join('\n');

describe('módulo documento-pendente', () => {
  test('sem pendência, não entra', () => {
    expect(modulo.entra(estadoBase())).toBe(false);
    expect(modulo.entra(estadoBase({ documento: PENDENTE }))).toBe(true);
  });

  test('pendente e sem avanço: não pedir de novo, responder ao que ele disse, ação continua bloqueada', () => {
    const t = texto(PENDENTE);
    expect(t).toMatch(/DOCUMENTO JÁ PEDIDO/);
    expect(t).toMatch(/NÃO peça de novo a cada mensagem, nem com outras palavras/);
    expect(t).toMatch(/continua sem poder ser feito/);
    expect(t).toMatch(/identificação pendente/);
  });

  test('mudou de assunto: a última intenção vence', () => {
    expect(texto({ ...PENDENTE, mudouDeAssunto: true })).toMatch(/Ele mudou de assunto depois do pedido: responda ao assunto novo/);
  });

  test('voltou ao assunto que depende da identificação: lembrete curto e natural', () => {
    expect(texto({ ...PENDENTE, retomou: true, mudancaRelevante: true })).toMatch(/lembre do documento numa frase curta e natural/);
  });

  test('irritado: não pedir de novo agora, não discutir', () => {
    expect(texto({ ...PENDENTE, irritado: true })).toMatch(/Ele se incomodou com o pedido: NÃO peça de novo agora, não discuta/);
  });

  // Número recebido != identidade confirmada (ajuste de 25/09/2026).
  test('número recebido, ainda não confirmado: tentar, e pedir para conferir se não localizar não é repetir', () => {
    const t = texto({ ...PENDENTE, documentoRecebido: true, mudancaRelevante: true });
    expect(t).toMatch(/DOCUMENTO RECEBIDO, AINDA NÃO CONFIRMADO/);
    expect(t).toMatch(/a identificação só está feita quando o cadastro for localizado/);
    expect(t).toMatch(/peça para conferir o número, numa frase: isso não é repetir o pedido/);
    expect(t).not.toMatch(/DOCUMENTO JÁ PEDIDO/);
    expect(texto({ ...PENDENTE, alvo: 'terceiro', documentoRecebido: true, mudancaRelevante: true })).toMatch(/titularEOutraPessoa: true/);
  });

  test('terceiro: o documento pendente é o da outra pessoa; o de quem fala não responde', () => {
    const t = texto({ ...PENDENTE, alvo: 'terceiro', mandouOProprioDocumento: true, mudancaRelevante: true });
    expect(t).toMatch(/da OUTRA pessoa/);
    expect(t).toMatch(/o que ele mandou é o dele mesmo/);
  });
});
