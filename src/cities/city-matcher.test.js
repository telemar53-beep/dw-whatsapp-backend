const { encontrarCidade, normalizar, distancia } = require('./city-matcher');

const CIDADES = [
  { id: 1, name: 'Cândido Mendes' },
  { id: 2, name: 'Centro do Guilherme' },
  { id: 3, name: 'Centro Novo do Maranhão' },
  { id: 4, name: 'Godofredo Viana' },
];

describe('normalizar', () => {
  test('tira acento, caixa e espaço sobrando', () => {
    expect(normalizar('  CÂNDIDO  MENDES ')).toBe('candido mendes');
    expect(normalizar('Centro Novo do Maranhão')).toBe('centro novo do maranhao');
  });

  test('aceita vazio, null e undefined', () => {
    expect(normalizar('')).toBe('');
    expect(normalizar(null)).toBe('');
    expect(normalizar(undefined)).toBe('');
  });
});

describe('distancia', () => {
  test('conta as edições entre duas palavras', () => {
    expect(distancia('candido', 'candido')).toBe(0);
    expect(distancia('candido', 'candid')).toBe(1);
    expect(distancia('candido', 'candidz')).toBe(1);
    expect(distancia('candido', '')).toBe(7);
  });
});

describe('encontrarCidade', () => {
  test('casa sem acento', () => {
    expect(encontrarCidade('Candido Mendes', CIDADES)).toEqual(CIDADES[0]);
  });

  test('casa com caixa alta e espaço duplicado', () => {
    expect(encontrarCidade('CÂNDIDO  MENDES', CIDADES)).toEqual(CIDADES[0]);
  });

  test('casa com uma letra faltando', () => {
    expect(encontrarCidade('Cândido Mende', CIDADES)).toEqual(CIDADES[0]);
  });

  test('casa com letra trocada', () => {
    expect(encontrarCidade('Candido Mendez', CIDADES)).toEqual(CIDADES[0]);
  });

  test('não chuta quando a diferença passa da tolerância', () => {
    expect(encontrarCidade('Godofredo', CIDADES)).toBeNull();
  });

  test('não chuta quando duas cidades cadastradas ficam parecidas', () => {
    // Par sintético: com 'Vila Nova' e 'Vila Nova 2' cadastradas, um nome
    // vizinho fica dentro da tolerância das duas — em dúvida, não preenche.
    const ambiguas = [
      { id: 10, name: 'Vila Nova' },
      { id: 11, name: 'Vila Nova 2' },
    ];
    expect(encontrarCidade('Vila Nova 3', ambiguas)).toBeNull();
  });

  test('a cidade exata ganha da ambiguidade por aproximação', () => {
    const ambiguas = [
      { id: 10, name: 'Vila Nova' },
      { id: 11, name: 'Vila Nova 2' },
    ];
    expect(encontrarCidade('VILA NOVA', ambiguas)).toEqual(ambiguas[0]);
  });

  test('devolve null para nome vazio, null ou lista vazia', () => {
    expect(encontrarCidade('', CIDADES)).toBeNull();
    expect(encontrarCidade(null, CIDADES)).toBeNull();
    expect(encontrarCidade('   ', CIDADES)).toBeNull();
    expect(encontrarCidade('Cândido Mendes', [])).toBeNull();
  });
});
