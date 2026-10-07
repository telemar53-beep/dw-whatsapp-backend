const {
  montarEscopo, escopoValido, paraContexto, comPendenciaDeAlvo, PENDENCIAS_DE_ALVO, MINUTOS_DE_VIDA,
  duvidaSemAutorizacao, CONTEXTO_SEM_AUTORIZACAO, comNovaMarca, esperadoDoEscopo,
} = require('./third-party-scope');
const { AMBIGUIDADE } = require('./financial-target');

const AGORA = new Date('2026-09-17T20:00:00.000Z');

test('monta o escopo com só os ids dos contratos e uma validade de 30 minutos', () => {
  const escopo = montarEscopo('Maria', [{ id: 10, address: 'Rua A', status: 1 }, { id: 11 }], AGORA);
  expect(escopo).toEqual({ nome: 'Maria', contratos: [10, 11], expiraEm: '2026-09-17T20:30:00.000Z', marca: expect.any(String) });
  expect(MINUTOS_DE_VIDA).toBe(30);
});

// Endereco e status do terceiro NUNCA entram no escopo: sao dados cadastrais
// de outra pessoa, e o fluxo de pagamento nao precisa deles.
test('o escopo nunca guarda endereço, status, nome completo nem documento', () => {
  const escopo = montarEscopo('Maria', [{ id: 10, address: 'Rua A', status: 1, document: '52998224725' }], AGORA);
  expect(JSON.stringify(escopo)).not.toMatch(/Rua A|52998224725/);
  expect(Object.keys(escopo).sort()).toEqual(['contratos', 'expiraEm', 'marca', 'nome']);
});

test('o escopo vale até o instante de expirar e não depois', () => {
  const escopo = montarEscopo('Maria', [{ id: 10 }], AGORA);
  expect(escopoValido(escopo, new Date('2026-09-17T20:29:59.000Z'))).toBe(true);
  expect(escopoValido(escopo, new Date(escopo.expiraEm))).toBe(true);
  expect(escopoValido(escopo, new Date('2026-09-17T20:30:01.000Z'))).toBe(false);
});

test('escopo ausente ou malformado nunca é válido', () => {
  for (const ruim of [
    null,
    undefined,
    {},
    { nome: 'Maria' },
    { contratos: [] },
    { contratos: [1], expiraEm: 'xx' },
    { contratos: [1], expiraEm: 12345 },
    { contratos: [1], expiraEm: '12345' },
    { contratos: [1], expiraEm: '2026-09-17' },
    { contratos: 'nao-e-array', expiraEm: '2026-09-17T20:30:00.000Z' },
    { contratos: [1], expiraEm: '2026-99-01T00:00:00.000Z' },
  ]) {
    expect(escopoValido(ruim, AGORA)).toBe(false);
  }
});

test('paraContexto devolve os contratos no formato da checagem de propriedade', () => {
  expect(paraContexto({ nome: 'Maria', contratos: [10, 11], expiraEm: '2026-09-17T20:30:00.000Z' }))
    .toEqual({ nome: 'Maria', contratos: [{ id: 10 }, { id: 11 }] });
  expect(paraContexto(null)).toBeNull();
});

// Caso Fulana/Beltrana (25/09/2026): CPF de terceiro NÃO encontrado vira pedido de terceiro PENDENTE,
// sem contrato nenhum — ele não autoriza nada e bloqueia a cobrança de quem fala nos turnos
// seguintes (sem fallback silencioso), até a intenção explícita, um novo CPF ou o prazo.
test('escopo pendente (documento não encontrado): sem contratos, marcado, válido até expirar', () => {
  const pendente = montarEscopo(null, [], AGORA, { pendente: true });
  expect(pendente).toEqual({ nome: null, contratos: [], expiraEm: '2026-09-17T20:30:00.000Z', pendente: true, marca: expect.any(String) });
  expect(escopoValido(pendente, AGORA)).toBe(true);
  expect(escopoValido(pendente, new Date('2026-09-17T20:30:01.000Z'))).toBe(false);
  expect(paraContexto(pendente)).toEqual({ nome: null, contratos: [], pendente: true });
});

test('lista vazia SEM a marca de pendente continua inválida (falha fechado)', () => {
  expect(escopoValido({ nome: 'X', contratos: [], expiraEm: '2026-09-17T20:30:00.000Z' }, AGORA)).toBe(false);
  expect(escopoValido({ nome: 'X', contratos: [], expiraEm: '2026-09-17T20:30:00.000Z', pendente: 'sim' }, AGORA)).toBe(false);
});

// Revisão da F2 (30/09/2026): a dúvida sobre o alvo fica gravada no próprio escopo (alvoPendente), para não
// depender de a fala que a criou ainda estar nas mensagens lidas. Sem campo novo em tabela e sem
// migração: é uma chave a mais no mesmo JSON, que o código antigo ignora.
describe('dúvida sobre o alvo gravada no escopo', () => {
  const escopo = montarEscopo('Maria', [{ id: 10 }], AGORA);

  test('gravar a dúvida não renova o prazo nem mexe nos contratos', () => {
    const comDuvida = comPendenciaDeAlvo(escopo, 'terceiro_nao_vinculado');
    expect(comDuvida).toEqual({ ...escopo, alvoPendente: 'terceiro_nao_vinculado', marca: expect.any(String) });
    // Gravar a dúvida é uma gravação nova: marca nova.
    expect(comDuvida.marca).not.toBe(escopo.marca);
    expect(comDuvida.expiraEm).toBe(escopo.expiraEm);
    expect(escopoValido(comDuvida, new Date('2026-09-17T20:30:01.000Z'))).toBe(false);
  });

  test('resolver a dúvida tira a chave, e só ela', () => {
    expect(comPendenciaDeAlvo({ ...escopo, alvoPendente: 'dois_lados' }, null)).toEqual({ ...escopo, marca: expect.any(String) });
  });

  test('o contexto do turno recebe a dúvida; escopo sem ela continua como era', () => {
    expect(paraContexto({ ...escopo, alvoPendente: 'dois_lados' })).toEqual({ nome: 'Maria', contratos: [{ id: 10 }], alvoPendente: 'dois_lados' });
    expect(paraContexto(escopo)).toEqual({ nome: 'Maria', contratos: [{ id: 10 }] });
  });

  test('dúvida com valor desconhecido ou corrompido vale como a trava mais forte (falha fechado)', () => {
    for (const ruim of ['qualquer', '', 42, true, { motivo: 'x' }]) {
      expect(paraContexto({ ...escopo, alvoPendente: ruim }).alvoPendente).toBe('terceiro_nao_vinculado');
    }
  });

  test('pendência sem terceiro: escopo pendente, sem contrato, com a dúvida — válido só até o prazo', () => {
    const pendente = comPendenciaDeAlvo(montarEscopo(null, [], AGORA, { pendente: true }), 'outra_pessoa_sem_documento');
    expect(escopoValido(pendente, AGORA)).toBe(true);
    expect(paraContexto(pendente)).toEqual({ nome: null, contratos: [], pendente: true, alvoPendente: 'outra_pessoa_sem_documento' });
  });

  test('as dúvidas gravadas são exatamente os motivos de trava que podem durar mais de um turno', () => {
    expect([...PENDENCIAS_DE_ALVO].sort()).toEqual([
      AMBIGUIDADE.DOIS_LADOS, AMBIGUIDADE.OUTRA_PESSOA_SEM_DOCUMENTO, AMBIGUIDADE.PROPRIO_NAO_AFIRMADO,
      AMBIGUIDADE.REFERENCIA_INCOMPLETA, AMBIGUIDADE.TERCEIRO_NAO_VINCULADO,
      AMBIGUIDADE.ENDERECO_AMBIGUO, AMBIGUIDADE.ENDERECO_DESCONHECIDO,
    ].sort());
  });

  test('a dúvida de endereço gravada volta como ela mesma (não vira a trava mais forte de terceiro)', () => {
    for (const motivo of [AMBIGUIDADE.ENDERECO_AMBIGUO, AMBIGUIDADE.ENDERECO_DESCONHECIDO]) {
      const duvida = comPendenciaDeAlvo(montarEscopo(null, [], AGORA, { pendente: true }), motivo);
      expect(paraContexto(duvida)).toEqual({ nome: null, contratos: [], pendente: true, alvoPendente: motivo });
    }
  });

  // Revisão da v4.1 (07/10/2026, achado B5): o código nunca grava dúvida de endereço num escopo com contrato de terceiro. Se o
  // valor aparecer assim (dado corrompido), vale a trava mais forte — como a produção leria —, não uma dúvida que "o dela" resolve.
  test('dúvida de endereço num escopo com contrato de terceiro (dado corrompido): vale a trava mais forte', () => {
    for (const motivo of [AMBIGUIDADE.ENDERECO_AMBIGUO, AMBIGUIDADE.ENDERECO_DESCONHECIDO]) {
      const escopo = comPendenciaDeAlvo(montarEscopo('Maria', [10], AGORA), motivo);
      expect(paraContexto(escopo).alvoPendente).toBe('terceiro_nao_vinculado');
    }
  });
});

// Terceira revisão da F2 (30/09/2026): expiração encerra autorização, não resolve dúvida. O escopo expirado com
// dúvida continua gravado e é lido como "dúvida sem autorização": nenhum contrato, a mesma conversa, sem prazo
// novo. Sem dúvida, o expirado segue a regra de sempre (é limpo).
describe('escopo expirado com dúvida', () => {
  const DEPOIS = new Date('2026-09-17T20:30:01.000Z');
  const escopo = montarEscopo('Maria', [{ id: 10 }], AGORA);

  test('expirado com dúvida: é dúvida sem autorização (não é válido, e não some)', () => {
    const comDuvida = comPendenciaDeAlvo(escopo, 'terceiro_nao_vinculado');
    expect(escopoValido(comDuvida, DEPOIS)).toBe(false);
    expect(duvidaSemAutorizacao(comDuvida, DEPOIS)).toBe(true);
  });

  test('o contexto da dúvida sem autorização não tem contrato nenhum nem nome', () => {
    expect(CONTEXTO_SEM_AUTORIZACAO).toEqual({ nome: null, contratos: [], pendente: true, alvoPendente: 'terceiro_expirado' });
  });

  test('expirado sem dúvida, ou ainda válido: não é dúvida sem autorização', () => {
    expect(duvidaSemAutorizacao(escopo, DEPOIS)).toBe(false);
    expect(duvidaSemAutorizacao(comPendenciaDeAlvo(escopo, 'dois_lados'), AGORA)).toBe(false);
    expect(duvidaSemAutorizacao(null, DEPOIS)).toBe(false);
  });

  // Decisão gerencial (30/09/2026): o documento de terceiro não localizado também não se resolve pelo prazo.
  test('documento não localizado (pendente, sem dúvida gravada) e vencido: também é dúvida sem autorização', () => {
    const pendente = montarEscopo(null, [], AGORA, { pendente: true });
    expect(duvidaSemAutorizacao(pendente, DEPOIS)).toBe(true);
    expect(duvidaSemAutorizacao(pendente, AGORA)).toBe(false);
  });

  test('JSON corrompido com dúvida também não autoriza nada: vale como dúvida sem autorização', () => {
    expect(duvidaSemAutorizacao({ contratos: 'x', expiraEm: 'y', alvoPendente: 'dois_lados' }, AGORA)).toBe(true);
  });
});

// Persistência do alvo (03/10/2026): a marca de cada gravação e o que a gravação condicional exige.
describe('marca de gravação do escopo', () => {
  test('cada escopo montado tem uma marca única, que não autoriza nada', () => {
    const marcas = new Set(Array.from({ length: 50 }, () => montarEscopo('Maria', [{ id: 10 }], AGORA).marca));
    expect(marcas.size).toBe(50);
    const escopo = montarEscopo('Maria', [{ id: 10 }], AGORA);
    expect(paraContexto(escopo)).toEqual({ nome: 'Maria', contratos: [{ id: 10 }] });
  });

  test('comNovaMarca: o mesmo escopo, com marca nova; null continua null', () => {
    const escopo = montarEscopo('Maria', [{ id: 10 }], AGORA);
    const novo = comNovaMarca(escopo);
    expect({ ...novo, marca: undefined }).toEqual({ ...escopo, marca: undefined });
    expect(novo.marca).not.toBe(escopo.marca);
    expect(comNovaMarca(null)).toBeNull();
  });

  test('esperadoDoEscopo: coluna vazia, a marca, ou o conteúdo de um escopo de antes desta versão', () => {
    const escopo = montarEscopo('Maria', [{ id: 10 }], AGORA);
    expect(esperadoDoEscopo(null)).toEqual({ nulo: true });
    expect(esperadoDoEscopo(escopo)).toEqual({ marca: escopo.marca });
    const antigo = { nome: 'Maria', contratos: [10], expiraEm: '2026-09-17T20:30:00.000Z' };
    expect(esperadoDoEscopo(antigo)).toEqual({ legado: antigo });
  });
});
