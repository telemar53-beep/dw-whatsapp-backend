import { describe, test, expect } from 'vitest';
import { formatDuration } from './formatDuration';

describe('formatDuration', () => {
  test('nulo vira travessão', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(undefined)).toBe('—');
  });
  test('menos de uma hora', () => {
    expect(formatDuration(45)).toBe('45 min');
    expect(formatDuration(0.4)).toBe('0 min');
    expect(formatDuration(12.5)).toBe('13 min');
  });
  test('horas e minutos', () => {
    expect(formatDuration(85.3)).toBe('1 h 25 min');
    expect(formatDuration(120)).toBe('2 h');
  });
  test('dias e horas', () => {
    expect(formatDuration(3060)).toBe('2 d 3 h');
    expect(formatDuration(1440)).toBe('1 d');
  });
});
