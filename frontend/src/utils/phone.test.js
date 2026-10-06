import { describe, test, expect } from 'vitest';
import { formatPhone } from './phone';

describe('formatPhone', () => {
  test('formata celular com nono dígito', () => {
    expect(formatPhone('5598999991002')).toBe('+55 (98) 99999-1002');
  });

  test('formata fixo de oito dígitos', () => {
    expect(formatPhone('552099984546')).toBe('+55 (20) 9998-4546');
  });

  // Um 0800 não tem DDD: o prefixo tem três dígitos, e a regra de DDD cortava
  // no lugar errado — o canal do 0800 999 0338 aparecia como "+55 (80) 0999-0338".
  test('formata 0800 sem inventar DDD', () => {
    expect(formatPhone('558009990338')).toBe('0800 999 0338');
  });

  test('formata os outros prefixos não geográficos', () => {
    expect(formatPhone('553009990338')).toBe('0300 999 0338');
    expect(formatPhone('555009990338')).toBe('0500 999 0338');
    expect(formatPhone('559009990338')).toBe('0900 999 0338');
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
