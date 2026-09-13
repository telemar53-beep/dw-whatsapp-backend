const { saudacaoDaHora, comecaComSaudacao, garantirSaudacao } = require('./saudacao');

// Instantes em UTC escolhidos para cair nas faixas certas em São Paulo (UTC-3).
const MANHA = new Date('2026-09-13T11:30:00-03:00');
const TARDE = new Date('2026-09-13T12:00:00-03:00');
const NOITE = new Date('2026-09-13T18:00:00-03:00');
const MADRUGADA = new Date('2026-09-13T00:10:00-03:00');

describe('saudacaoDaHora', () => {
  test('segue o horário de São Paulo, não o do servidor', () => {
    expect(saudacaoDaHora(MANHA)).toBe('Bom dia');
    expect(saudacaoDaHora(TARDE)).toBe('Boa tarde');
    expect(saudacaoDaHora(NOITE)).toBe('Boa noite');
    expect(saudacaoDaHora(MADRUGADA)).toBe('Bom dia');
  });
});

describe('comecaComSaudacao', () => {
  test('reconhece as saudações usuais, com emoji ou negrito na frente', () => {
    expect(comecaComSaudacao('Bom dia, João!')).toBe(true);
    expect(comecaComSaudacao('boa TARDE')).toBe(true);
    expect(comecaComSaudacao('Olá! Tudo bem?')).toBe(true);
    expect(comecaComSaudacao('Oi, Maria')).toBe(true);
    expect(comecaComSaudacao('👋 Boa noite')).toBe(true);
    expect(comecaComSaudacao('*Bom dia*, João')).toBe(true);
  });

  test('não confunde palavras parecidas nem texto sem saudação', () => {
    expect(comecaComSaudacao('Oitava fatura em aberto')).toBe(false);
    expect(comecaComSaudacao('Perfeito, Willemberg — vou encaminhar')).toBe(false);
    expect(comecaComSaudacao('')).toBe(false);
    expect(comecaComSaudacao(null)).toBe(false);
  });
});

describe('garantirSaudacao', () => {
  test('prefixa saudação da hora e primeiro nome quando o texto não cumprimenta', () => {
    expect(garantirSaudacao('Enviei o PIX da sua fatura. Precisa de mais alguma coisa?', 'Willemberg', MANHA))
      .toBe('Bom dia, Willemberg! Enviei o PIX da sua fatura. Precisa de mais alguma coisa?');
  });

  test('sem nome, cumprimenta sem nome', () => {
    expect(garantirSaudacao('Para localizar seu cadastro, me informe seu CPF.', null, NOITE))
      .toBe('Boa noite! Para localizar seu cadastro, me informe seu CPF.');
  });

  test('não duplica quando o modelo já cumprimentou', () => {
    expect(garantirSaudacao('Bom dia, Willemberg! Enviei o PIX.', 'Willemberg', MANHA)).toBe('Bom dia, Willemberg! Enviei o PIX.');
    expect(garantirSaudacao('Olá! Como posso ajudar?', 'Ana', TARDE)).toBe('Olá! Como posso ajudar?');
  });

  test('texto vazio volta como veio', () => {
    expect(garantirSaudacao(null, 'Ana', MANHA)).toBeNull();
    expect(garantirSaudacao('', 'Ana', MANHA)).toBe('');
  });
});
