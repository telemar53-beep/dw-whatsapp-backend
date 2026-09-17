import { describe, test, expect } from 'vitest';
import { formatPhone } from './phone';

describe('formatPhone', () => {
  test('formata celular com nono dígito', () => {
    expect(formatPhone('5598999991002')).toBe('+55 (98) 99999-1002');
  });

  test('formata fixo de oito dígitos', () => {
    expect(formatPhone('559884454546')).toBe('+55 (98) 8445-4546');
  });

  // Um 0800 não tem DDD: o prefixo tem três dígitos, e a regra de DDD cortava
  // no lugar errado — o canal do 0800 445 4546 aparecia como "+55 (80) 0445-4546".
  test('formata 0800 sem inventar DDD', () => {
    expect(formatPhone('558004454546')).toBe('0800 445 4546');
  });

  test('formata os outros prefixos não geográficos', () => {
    expect(formatPhone('553004454546')).toBe('0300 445 4546');
    expect(formatPhone('555004454546')).toBe('0500 445 4546');
    expect(formatPhone('559004454546')).toBe('0900 445 4546');
  });

  test('número fora do padrão brasileiro sai como veio', () => {
    expect(formatPhone('123')).toBe('123');
    expect(formatPhone('12025550100')).toBe('12025550100');
  });

  test('não quebra com valor vazio', () => {
    expect(formatPhone(null)).toBe(null);
    expect(formatPhone('')).toBe('');
  });
});
