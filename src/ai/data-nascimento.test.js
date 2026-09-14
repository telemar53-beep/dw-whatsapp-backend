const { normalizarDataNascimento } = require('./data-nascimento');

describe('normalizarDataNascimento', () => {
  test('AAAA-MM-DD passa intacta', () => {
    expect(normalizarDataNascimento('1990-05-20')).toBe('1990-05-20');
  });

  test('DD/MM/AAAA e D/M/AA viram AAAA-MM-DD', () => {
    expect(normalizarDataNascimento('20/05/1990')).toBe('1990-05-20');
    expect(normalizarDataNascimento('20/5/90')).toBe('1990-05-20');
    expect(normalizarDataNascimento('5/1/2001')).toBe('2001-01-05');
  });

  test('DD-MM-AAAA e DD.MM.AAAA também', () => {
    expect(normalizarDataNascimento('10-05-2001')).toBe('2001-05-10');
    expect(normalizarDataNascimento('10.05.2001')).toBe('2001-05-10');
  });

  // Defeito B: o SGP devolve a data com hora em alguns cadastros; sem cortar
  // no T, findClientRecord virava null e confirmar_nascimento respondia "não
  // há data de nascimento no cadastro".
  test('AAAA-MM-DD com hora (ISO) corta no T', () => {
    expect(normalizarDataNascimento('2001-05-10T00:00:00')).toBe('2001-05-10');
    expect(normalizarDataNascimento('2001-05-10T03:00:00.000Z')).toBe('2001-05-10');
  });

  test('espaços em volta não atrapalham', () => {
    expect(normalizarDataNascimento(' 20/05/1990 ')).toBe('1990-05-20');
  });

  test('qualquer outra coisa vira null', () => {
    expect(normalizarDataNascimento('abc')).toBeNull();
    expect(normalizarDataNascimento('')).toBeNull();
    expect(normalizarDataNascimento(null)).toBeNull();
    expect(normalizarDataNascimento(undefined)).toBeNull();
    expect(normalizarDataNascimento('20/05')).toBeNull();
    expect(normalizarDataNascimento(12345)).toBeNull();
  });
});
