import { describe, test, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useNavCollapsed } from './useNavCollapsed';

beforeEach(() => localStorage.clear());

describe('useNavCollapsed', () => {
  test('começa expandido e persiste a escolha', () => {
    const { result } = renderHook(() => useNavCollapsed());
    expect(result.current.collapsed).toBe(false);
    act(() => result.current.toggle());
    expect(result.current.collapsed).toBe(true);
    expect(localStorage.getItem('dw_nav_collapsed')).toBe('1');
  });
  test('lê a escolha salva', () => {
    localStorage.setItem('dw_nav_collapsed', '1');
    const { result } = renderHook(() => useNavCollapsed());
    expect(result.current.collapsed).toBe(true);
  });
});
