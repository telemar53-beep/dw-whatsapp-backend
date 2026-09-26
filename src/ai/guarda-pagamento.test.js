const {
  violacoesDoPagamento, respostaSemAfirmacoes, correcaoDoPagamento, afirmaLiberacaoAmpla,
} = require('./guarda-pagamento');

// Regra financeira 0/1/2+ (25/09/2026): três afirmações só saem com FATO do sistema no turno.
// - pagamento confirmado/compensado/baixado → só com contexto.pagamentoConfirmado (conferir_pagamento
//   releu o MESMO título: statusid 2 + "Pago" + data de pagamento);
// - internet/acesso liberado → só com a releitura do contrato em status 1
//   (contexto.contratoAtivoConfirmado) ou o desbloqueio em confiança com liberado:true
//   (contexto.desbloqueioRealizado);
// - "está conectada/online/voltou" depois de conferir o pagamento → só com a conexão verificada.
const SEM_FATO = {};

describe('pagamento confirmado sem o fato', () => {
  test.each([
    ['37. "pagamento confirmado"', 'Pagamento confirmado! Obrigado, Ana.'],
    ['39. "seu pagamento já compensou"', 'Oi Ana, seu pagamento já compensou.'],
    ['"já baixou"', 'Pronto, já baixou aqui no sistema.'],
    ['"o pagamento foi confirmado"', 'O pagamento foi confirmado com sucesso.'],
    ['"fatura já está paga"', 'Sua fatura já está paga.'],
    ['"consta como paga"', 'A fatura consta como paga no sistema.'],
    ['"recebemos seu pagamento"', 'Recebemos seu pagamento, obrigado!'],
    ['"pagamento compensado"', 'Seu pagamento está compensado.'],
  ])('%s é bloqueado', (_nome, texto) => {
    expect(violacoesDoPagamento(texto, SEM_FATO)).toContain('pagamento_sem_confirmacao');
  });

  test.each([
    'O pagamento ainda não consta como confirmado no sistema.',
    'Assim que o pagamento for confirmado, a equipe dá sequência.',
    'Não consegui confirmar o pagamento agora.',
    'Quando o pagamento for compensado, você recebe o aviso.',
    'Se o boleto já estiver pago, desconsidere.',
    'Seu pagamento ainda não foi confirmado.',
    'Enviei acima o PIX da fatura.',
  ])('não é afirmação: %s', (texto) => {
    expect(violacoesDoPagamento(texto, SEM_FATO)).not.toContain('pagamento_sem_confirmacao');
  });

  test('com o fato do sistema (conferir_pagamento confirmou), a frase passa', () => {
    expect(violacoesDoPagamento('Pagamento confirmado!', { pagamentoConfirmado: true })).toEqual([]);
  });

  test('comprovante lido e "paguei" do cliente NÃO são o fato', () => {
    const contexto = { comprovante: { valido: true }, ultimaFala: 'já paguei' };
    expect(violacoesDoPagamento('Seu pagamento foi confirmado.', contexto)).toContain('pagamento_sem_confirmacao');
  });
});

describe('internet liberada sem o fato', () => {
  test.each([
    ['38. "internet já foi liberada"', 'Recebi seu comprovante! Sua internet já foi liberada.'],
    ['"acesso liberado"', 'Seu acesso está liberado.'],
    ['"já está liberada"', 'Pronto, já está liberada.'],
    ['"liberei seu acesso"', 'Liberei seu acesso agora.'],
    ['"desbloqueio realizado"', 'O desbloqueio foi realizado.'],
    ['"conexão restabelecida"', 'Sua conexão foi restabelecida.'],
    ['"contrato já foi reativado"', 'Seu contrato já foi reativado.'],
  ])('%s é bloqueado', (_nome, texto) => {
    expect(violacoesDoPagamento(texto, SEM_FATO)).toContain('liberacao_sem_fato');
    expect(afirmaLiberacaoAmpla(texto)).toBe(true);
  });

  test.each([
    'A internet ainda não foi liberada.',
    'Assim que o acesso for liberado, te aviso.',
    'Quando a internet estiver liberada, é só reiniciar o roteador.',
    'O acesso será liberado depois da conferência.',
  ])('não é afirmação: %s', (texto) => {
    expect(violacoesDoPagamento(texto, SEM_FATO)).not.toContain('liberacao_sem_fato');
  });

  test('29. com a releitura do contrato ATIVO, "liberado" passa', () => {
    expect(violacoesDoPagamento('Seu contrato foi liberado.', { contratoAtivoConfirmado: true })).toEqual([]);
  });

  test('30. com o desbloqueio em confiança liberado:true, "liberado" passa (regra atual)', () => {
    expect(violacoesDoPagamento('Seu acesso foi liberado.', { desbloqueioRealizado: true })).toEqual([]);
  });

  test('28. pagamento confirmado mas contrato suspenso: "liberada" continua bloqueada', () => {
    const contexto = { pagamentoConfirmado: true, pagamentoConferido: true };
    expect(violacoesDoPagamento('Pagamento confirmado e sua internet já foi liberada!', contexto)).toEqual(['liberacao_sem_fato']);
  });
});

describe('conectada/online depois de conferir o pagamento', () => {
  const conferido = { pagamentoConfirmado: true, pagamentoConferido: true, contratoAtivoConfirmado: true };

  test.each([
    'Sua internet já está online.',
    'Sua conexão já está funcionando.',
    'Pronto, sua internet voltou!',
  ])('29. status 1 não é conexão: "%s" é bloqueado', (texto) => {
    expect(violacoesDoPagamento(texto, conferido)).toContain('conexao_sem_fato');
  });

  test('com a conexão verificada online, passa', () => {
    expect(violacoesDoPagamento('Sua internet já está online.', { ...conferido, conexaoOnline: true })).toEqual([]);
  });

  test('sem conferência de pagamento no turno, a guarda de conexão não se aplica', () => {
    expect(violacoesDoPagamento('Sua internet já está online.', {})).toEqual([]);
  });

  test('"se a internet não voltar" não é afirmação', () => {
    expect(violacoesDoPagamento('Se a internet não voltar em alguns minutos, me avise.', conferido)).toEqual([]);
  });
});

describe('a troca final e a correção', () => {
  test('tira só a frase proibida e mantém o resto', () => {
    const texto = 'Oi Ana! Seu pagamento já compensou. Qualquer dúvida, é só chamar.';
    expect(respostaSemAfirmacoes(texto, ['pagamento_sem_confirmacao'], SEM_FATO))
      .toBe('Oi Ana! Qualquer dúvida, é só chamar.');
  });

  test('se nada sobra, sai a frase segura — sem afirmar pagamento nem liberação', () => {
    const r = respostaSemAfirmacoes('Pagamento confirmado! Sua internet já foi liberada.', ['pagamento_sem_confirmacao', 'liberacao_sem_fato'], SEM_FATO);
    expect(r).toMatch(/ainda não consta como confirmado/);
    expect(violacoesDoPagamento(r, SEM_FATO)).toEqual([]);
  });

  test('a correção ao modelo manda usar conferir_pagamento e não repetir a afirmação', () => {
    expect(correcaoDoPagamento(['pagamento_sem_confirmacao'])).toMatch(/conferir_pagamento/);
    expect(correcaoDoPagamento(['liberacao_sem_fato'])).toMatch(/liberação/);
  });
});

// Ajuste de 25/09/2026: "a liberação é automática quando o pagamento for confirmado" não é garantido
// (com duas ou mais vencidas, pagar uma não libera). A promessa sai SEMPRE — não há fato que a
// autorize. A formulação segura é "assim que o pagamento constar no sistema, vou verificar".
describe('promessa de liberação automática', () => {
  const TODOS_OS_FATOS = { pagamentoConfirmado: true, pagamentoConferido: true, contratoAtivoConfirmado: true, desbloqueioRealizado: true, conexaoOnline: true };

  test.each([
    'Assim que o pagamento for confirmado, o acesso é liberado automaticamente.',
    'Sim — assim que o pagamento for confirmado, a liberação é automática.',
    'Pode ficar tranquila, não se preocupe: a liberação é automática.',
    'Depois do pagamento a internet volta automaticamente.',
    'O desbloqueio será automático após a compensação.',
    'Seu acesso é automaticamente liberado quando o boleto compensar.',
  ])('"%s" é bloqueada, com qualquer fato do turno', (texto) => {
    expect(violacoesDoPagamento(texto, {})).toContain('promessa_de_liberacao');
    expect(violacoesDoPagamento(texto, TODOS_OS_FATOS)).toContain('promessa_de_liberacao');
  });

  test.each([
    'Assim que o pagamento constar no sistema, vou verificar a situação do contrato.',
    'A liberação não é automática: a equipe confere o pagamento.',
    'O acesso não volta automaticamente com uma fatura só.',
  ])('não é promessa: %s', (texto) => {
    expect(violacoesDoPagamento(texto, {})).not.toContain('promessa_de_liberacao');
  });

  test('a troca final tira a promessa; se nada sobra, sai a formulação segura', () => {
    expect(respostaSemAfirmacoes('Recebi seu comprovante. A liberação é automática quando o pagamento for confirmado.', ['promessa_de_liberacao'], {}))
      .toBe('Recebi seu comprovante.');
    expect(respostaSemAfirmacoes('Assim que o pagamento for confirmado, a liberação é automática.', ['promessa_de_liberacao'], {}))
      .toBe('Assim que o pagamento constar no sistema, vou verificar a situação do contrato.');
  });

  test('a correção ao modelo dá a formulação segura', () => {
    expect(correcaoDoPagamento(['promessa_de_liberacao'])).toMatch(/assim que o pagamento constar no sistema/i);
  });
});

// P1-2 da auditoria final (25/09/2026): a ressalva (negação/condição) só vale quando faz parte
// DIRETA da afirmação — colada a ela, na MESMA oração. Palavra solta antes, em outra oração
// ("Não se preocupe, …", "Quando puder, confira: …"), não desfaz a afirmação.
describe('P1-2: a ressalva só vale colada à afirmação', () => {
  const SEM = {};

  test.each([
    'O pagamento ainda não foi confirmado.',
    'Se o pagamento for confirmado, eu verifico o contrato.',
    'Quando o pagamento for confirmado, verificarei a situação.',
    'Ainda não consta como pago.',
    'Não tenho confirmação de que o pagamento foi compensado.',
    'Se o pagamento já foi confirmado, eu verifico o contrato.',
    'Não sei se o pagamento já foi confirmado.',
    'Ainda não tenho a confirmação de que o acesso foi liberado.',
    'Daqui eu não consigo confirmar se a conexão já está online.',
  ])('continua permitida (ressalva colada): %s', (texto) => {
    expect(violacoesDoPagamento(texto, { ...SEM, pagamentoConferido: true })).toEqual([]);
  });

  test.each([
    ['Não se preocupe, seu pagamento foi confirmado.', 'pagamento_sem_confirmacao'],
    ['Não precisa enviar nada, o pagamento já foi confirmado.', 'pagamento_sem_confirmacao'],
    ['Quando puder, confira: o pagamento foi confirmado.', 'pagamento_sem_confirmacao'],
    ['Pode ficar tranquila, não se preocupe: sua internet já foi liberada.', 'liberacao_sem_fato'],
    ['Se precisar de algo, seu pagamento já foi confirmado.', 'pagamento_sem_confirmacao'],
    ['Não precisa se preocupar que seu pagamento já foi confirmado.', 'pagamento_sem_confirmacao'],
    ['Não esqueça: o desbloqueio foi realizado.', 'liberacao_sem_fato'],
  ])('bloqueada sem fato (ressalva de outra oração): %s', (texto, violacao) => {
    expect(violacoesDoPagamento(texto, SEM)).toContain(violacao);
  });

  test('com o fato do sistema, a mesma frase passa (pagamento conferido e desbloqueio liberado)', () => {
    expect(violacoesDoPagamento('Não se preocupe, seu pagamento foi confirmado.', { pagamentoConfirmado: true })).toEqual([]);
    expect(violacoesDoPagamento('Pode ficar tranquila, não se preocupe: sua internet já foi liberada.', { desbloqueioRealizado: true })).toEqual([]);
  });

  test('a troca final tira a frase sem sobrar a afirmação', () => {
    const r = respostaSemAfirmacoes('Oi Ana! Não se preocupe, seu pagamento foi confirmado. Qualquer dúvida, é só chamar.', ['pagamento_sem_confirmacao'], SEM);
    expect(r).toBe('Oi Ana! Qualquer dúvida, é só chamar.');
  });
});

// P2-1 da auditoria final (25/09/2026): o status 1 lido do SGP NESTE turno prova o STATUS DO
// CONTRATO ("consta ativo", "acesso liberado", "não está bloqueado") — nunca a CONEXÃO ("online",
// "funcionando") nem um EVENTO de liberação ("desbloqueio realizado", "foi liberado").
describe('P2-1: contrato ativo lido no turno', () => {
  const ATIVO = { contracts: [{ id: 1, statusCode: 1 }], identidade: { nivel: 'forte' } };
  const SUSPENSO = { contracts: [{ id: 1, statusCode: 4 }], identidade: { nivel: 'forte' } };
  const MISTO = { contracts: [{ id: 1, statusCode: 1 }, { id: 2, statusCode: 4 }], identidade: { nivel: 'forte' } };

  test.each([
    'Seu contrato consta ativo.',
    'Seu acesso não está bloqueado.',
    'Seu acesso está liberado: o contrato consta ativo.',
    'Não, seu contrato está ativo e o acesso está liberado.',
  ])('1/2. status 1 + "%s" → permitido', (texto) => {
    expect(violacoesDoPagamento(texto, ATIVO)).toEqual([]);
  });

  test.each([
    ['3', 'Sua internet está online.'],
    ['4', 'Sua conexão está funcionando normalmente.'],
  ])('%s. status 1 + conexão sem dado de conexão → bloqueado', (_n, texto) => {
    expect(violacoesDoPagamento(texto, ATIVO)).toEqual(['conexao_sem_fato']);
  });

  test('status 1 + conexão COM a verificação da conexão online → permitido', () => {
    expect(violacoesDoPagamento('Sua internet está online.', { ...ATIVO, conexaoOnline: true })).toEqual([]);
  });

  test('status 1 não prova EVENTO de liberação ("desbloqueio realizado", "foi liberado")', () => {
    expect(violacoesDoPagamento('O desbloqueio em confiança foi realizado.', ATIVO)).toEqual(['liberacao_sem_fato']);
    expect(violacoesDoPagamento('Seu acesso foi liberado agora.', ATIVO)).toEqual(['liberacao_sem_fato']);
  });

  test.each([
    'Seu contrato consta ativo.',
    'Seu acesso está liberado.',
  ])('5. contrato suspenso + "%s" → bloqueado', (texto) => {
    expect(violacoesDoPagamento(texto, SUSPENSO)).toEqual(['liberacao_sem_fato']);
  });

  test('um ativo e um suspenso: "seu contrato está ativo" sem dizer qual não passa (nunca mascara a suspensão)', () => {
    expect(violacoesDoPagamento('Seu contrato está ativo.', MISTO)).toEqual(['liberacao_sem_fato']);
  });

  test('com pedido de terceiro em andamento, o status de quem fala não prova o contrato em pauta', () => {
    expect(violacoesDoPagamento('Seu acesso está liberado.', { ...ATIVO, terceiro: { nome: 'Beltrana', contratos: [{ id: 9 }] } })).toEqual(['liberacao_sem_fato']);
  });

  test('a releitura do contrato (conferir_pagamento) que diz "não ativo" vence o status do começo do turno', () => {
    expect(violacoesDoPagamento('Seu acesso está liberado.', { ...ATIVO, contratoAtivoNegado: true })).toEqual(['liberacao_sem_fato']);
  });

  test('"Que bom que sua internet voltou!" reage ao relato do cliente: não é afirmação do sistema', () => {
    expect(violacoesDoPagamento('Que bom que sua internet voltou!', ATIVO)).toEqual([]);
  });

  test('a troca final usa a frase neutra do contrato ativo — nunca uma que sugira bloqueio', () => {
    expect(respostaSemAfirmacoes('Sua internet está online.', ['conexao_sem_fato'], ATIVO))
      .toBe('O contrato consta ativo no sistema, mas ainda preciso verificar o status da conexão.');
  });
});
