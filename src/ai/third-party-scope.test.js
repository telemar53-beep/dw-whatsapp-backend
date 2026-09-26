const { montarEscopo, escopoValido, paraContexto, MINUTOS_DE_VIDA } = require('./third-party-scope');

const AGORA = new Date('2026-09-17T20:00:00.000Z');

test('monta o escopo com só os ids dos contratos e uma validade de 30 minutos', () => {
  const escopo = montarEscopo('Maria', [{ id: 10, address: 'Rua A', status: 1 }, { id: 11 }], AGORA);
  expect(escopo).toEqual({ nome: 'Maria', contratos: [10, 11], expiraEm: '2026-09-17T20:30:00.000Z' });
  expect(MINUTOS_DE_VIDA).toBe(30);
});

// Endereco e status do terceiro NUNCA entram no escopo: sao dados cadastrais
// de outra pessoa, e o fluxo de pagamento nao precisa deles.
test('o escopo nunca guarda endereço, status, nome completo nem documento', () => {
  const escopo = montarEscopo('Maria', [{ id: 10, address: 'Rua A', status: 1, document: '52998224725' }], AGORA);
  expect(JSON.stringify(escopo)).not.toMatch(/Rua A|52998224725/);
  expect(Object.keys(escopo).sort()).toEqual(['contratos', 'expiraEm', 'nome']);
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
  expect(pendente).toEqual({ nome: null, contratos: [], expiraEm: '2026-09-17T20:30:00.000Z', pendente: true });
  expect(escopoValido(pendente, AGORA)).toBe(true);
  expect(escopoValido(pendente, new Date('2026-09-17T20:30:01.000Z'))).toBe(false);
  expect(paraContexto(pendente)).toEqual({ nome: null, contratos: [], pendente: true });
});

test('lista vazia SEM a marca de pendente continua inválida (falha fechado)', () => {
  expect(escopoValido({ nome: 'X', contratos: [], expiraEm: '2026-09-17T20:30:00.000Z' }, AGORA)).toBe(false);
  expect(escopoValido({ nome: 'X', contratos: [], expiraEm: '2026-09-17T20:30:00.000Z', pendente: 'sim' }, AGORA)).toBe(false);
});
