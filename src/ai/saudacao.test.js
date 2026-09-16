const { saudacaoDaHora, comecaComSaudacao, garantirSaudacao, corrigirPeriodoDaSaudacao, removerSaudacao } = require('./saudacao');

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

  // Print 2026-09-16: "Boa tarde, Agnieska! Agnieska, vou encaminhar..." — o
  // modelo começou chamando pelo nome e a saudação foi prefixada por cima.
  test('não duplica o nome quando o modelo já começou chamando a pessoa', () => {
    expect(garantirSaudacao('Agnieska, vou verificar isso para você.', 'Agnieska', MANHA))
      .toBe('Bom dia, Agnieska! Vou verificar isso para você.');
    expect(garantirSaudacao('Willemberg, seu contrato está ativo.', 'Willemberg', NOITE))
      .toBe('Boa noite, Willemberg! Seu contrato está ativo.');
    // Nome diferente do começo do texto não é tocado.
    expect(garantirSaudacao('Maria pediu o boleto.', 'Ana', MANHA))
      .toBe('Bom dia, Ana! Maria pediu o boleto.');
  });

  test('texto vazio volta como veio', () => {
    expect(garantirSaudacao(null, 'Ana', MANHA)).toBeNull();
    expect(garantirSaudacao('', 'Ana', MANHA)).toBe('');
  });
});

describe('corrigirPeriodoDaSaudacao', () => {
  test('troca a saudação do período errado pela certa, preservando o resto', () => {
    // Teste real: "Bom dia, Willemberg!" às 14:56.
    expect(corrigirPeriodoDaSaudacao('Bom dia, Willemberg! Verifiquei aqui que sua conexão está offline.', TARDE))
      .toBe('Boa tarde, Willemberg! Verifiquei aqui que sua conexão está offline.');
    expect(corrigirPeriodoDaSaudacao('boa noite, tudo bem?', MANHA)).toBe('bom dia, tudo bem?');
    expect(corrigirPeriodoDaSaudacao('👋 Boa tarde!', NOITE)).toBe('👋 Boa noite!');
  });

  test('não mexe quando o período está certo, nem em Olá/Oi, nem no meio do texto', () => {
    expect(corrigirPeriodoDaSaudacao('Boa tarde, Ana!', TARDE)).toBe('Boa tarde, Ana!');
    expect(corrigirPeriodoDaSaudacao('Olá! Bom dia para você também.', TARDE)).toBe('Olá! Bom dia para você também.');
    expect(corrigirPeriodoDaSaudacao('Tenha um bom dia!', TARDE)).toBe('Tenha um bom dia!');
    expect(corrigirPeriodoDaSaudacao(null, TARDE)).toBeNull();
  });
});

// Print 2026-09-16: "Bom dia! Como posso ajudar você hoje?" três vezes na
// mesma conversa — o modelo cumprimenta de novo a cada resposta. Da segunda
// resposta em diante o worker tira a saudação de período do começo.
describe('removerSaudacao', () => {
  test('tira a saudação de período do começo, com ou sem nome, e recapitaliza', () => {
    expect(removerSaudacao('Bom dia! Como posso ajudar você hoje?')).toBe('Como posso ajudar você hoje?');
    expect(removerSaudacao('Boa noite, Willemberg! Verifiquei seu contrato.')).toBe('Verifiquei seu contrato.');
    expect(removerSaudacao('😊 Boa tarde, Ana! tudo certo por aqui.')).toBe('Tudo certo por aqui.');
  });

  test('não mexe em Olá/Oi, em saudação no meio do texto, nem deixa o texto vazio', () => {
    expect(removerSaudacao('Olá! Como posso ajudar?')).toBe('Olá! Como posso ajudar?');
    expect(removerSaudacao('Tenha um bom dia!')).toBe('Tenha um bom dia!');
    expect(removerSaudacao('Bom dia!')).toBe('Bom dia!');
    expect(removerSaudacao(null)).toBeNull();
  });
});
