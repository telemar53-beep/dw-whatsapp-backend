import { describe, test, expect } from 'vitest';
import { formatLastSeen } from './formatLastSeen';

const now = new Date(2026, 8, 16, 10, 0); // 16/09/2026 10:00 local

describe('formatLastSeen', () => {
  test('mesmo dia vira "hoje às HH:MM"', () => {
    expect(formatLastSeen(new Date(2026, 8, 16, 8, 37), now)).toBe('hoje às 08:37');
  });

  test('dia anterior vira "ontem às HH:MM"', () => {
    expect(formatLastSeen(new Date(2026, 8, 15, 21, 14), now)).toBe('ontem às 21:14');
  });

  test('mais antigo vira "dd/mm às HH:MM"', () => {
    expect(formatLastSeen(new Date(2026, 8, 2, 9, 5), now)).toBe('02/09 às 09:05');
  });

  test('aceita string ISO', () => {
    const iso = new Date(2026, 8, 16, 8, 37).toISOString();
    expect(formatLastSeen(iso, now)).toBe('hoje às 08:37');
  });

  test('sem registro ou data inválida devolve null', () => {
    expect(formatLastSeen(null, now)).toBeNull();
    expect(formatLastSeen('não é data', now)).toBeNull();
  });
});
