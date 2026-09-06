const { findMatchingOption } = require('./triage-matcher');

describe('findMatchingOption', () => {
  const options = [
    { id: 'opt-1', optionNumber: 1, sectorId: 'sector-1', sectorName: 'Financeiro', keywords: ['financeiro', 'conta', 'fatura', 'boleto'] },
    { id: 'opt-2', optionNumber: 2, sectorId: 'sector-2', sectorName: 'Suporte', keywords: ['suporte', 'internet', 'sem sinal'] },
  ];

  test('matches by exact option number', () => {
    expect(findMatchingOption(options, '1')).toEqual(options[0]);
    expect(findMatchingOption(options, '2')).toEqual(options[1]);
  });

  test('matches by a keyword contained anywhere in the reply, case-insensitively', () => {
    expect(findMatchingOption(options, 'queria saber da minha FATURA')).toEqual(options[0]);
    expect(findMatchingOption(options, 'minha internet caiu')).toEqual(options[1]);
  });

  test('trims whitespace before comparing the option number', () => {
    expect(findMatchingOption(options, '  1  ')).toEqual(options[0]);
  });

  test('returns null when nothing matches', () => {
    expect(findMatchingOption(options, 'não sei o que quero')).toBeNull();
  });

  test('returns null for an empty or missing reply', () => {
    expect(findMatchingOption(options, '')).toBeNull();
    expect(findMatchingOption(options, null)).toBeNull();
    expect(findMatchingOption(options, undefined)).toBeNull();
  });

  test('when multiple options match, the lowest option number wins', () => {
    const overlapping = [
      { id: 'opt-3', optionNumber: 3, sectorId: 'sector-3', sectorName: 'Comercial', keywords: ['ajuda'] },
      { id: 'opt-4', optionNumber: 1, sectorId: 'sector-4', sectorName: 'Geral', keywords: ['ajuda'] },
    ];
    expect(findMatchingOption(overlapping, 'preciso de ajuda')).toEqual(overlapping[1]);
  });

  test('does not depend on the input array already being sorted', () => {
    const reversed = [options[1], options[0]];
    expect(findMatchingOption(reversed, '1')).toEqual(options[0]);
  });
});
