import { describe, test, expect } from 'vitest';
import { parseRecipients } from './parseRecipients';

describe('parseRecipients', () => {
  test('mesma regra do backend: trim, só dígitos, dedup, inválidos', () => {
    const result = parseRecipients('5511999990000\n 55 (11) 99999-0000 ,Maria\nabc\n\n5511999990001,João, Silva');
    expect(result.valid).toEqual([
      { phoneNumber: '5511999990000', displayName: null },
      { phoneNumber: '5511999990001', displayName: 'João, Silva' },
    ]);
    expect(result.duplicates).toBe(1);
    expect(result.invalid).toBe(1);
  });
  test('vazio', () => {
    expect(parseRecipients('')).toEqual({ valid: [], duplicates: 0, invalid: 0 });
  });
});
