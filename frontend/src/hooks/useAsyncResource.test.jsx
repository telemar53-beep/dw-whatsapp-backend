import { describe, test, expect, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useAsyncResource } from './useAsyncResource';

describe('useAsyncResource', () => {
  test('começa em loading e vai para ready com os dados', async () => {
    const fetcher = vi.fn().mockResolvedValue([1, 2]);
    const { result } = renderHook(() => useAsyncResource(fetcher, [], { initial: [] }));
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.data).toEqual([1, 2]);
  });
  test('erro genérico vira status error com a mensagem', async () => {
    const fetcher = vi.fn().mockRejectedValue({ status: 500, body: { error: 'quebrou' } });
    const { result } = renderHook(() => useAsyncResource(fetcher, [], { initial: [] }));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBe('quebrou');
  });
  test('403 vira forbidden', async () => {
    const fetcher = vi.fn().mockRejectedValue({ status: 403, body: { error: 'Insufficient permissions' } });
    const { result } = renderHook(() => useAsyncResource(fetcher, [], { initial: [] }));
    await waitFor(() => expect(result.current.status).toBe('forbidden'));
  });
  test('refresh depois de pronto não volta ao esqueleto', async () => {
    const fetcher = vi.fn().mockResolvedValue([1]);
    const { result } = renderHook(() => useAsyncResource(fetcher, [], { initial: [] }));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => { result.current.refresh(); });
    expect(result.current.status).toBe('ready');
    expect(result.current.reloading).toBe(true);
    await waitFor(() => expect(result.current.reloading).toBe(false));
  });
  test('enabled=false fica pronto sem chamar o fetcher', () => {
    const fetcher = vi.fn();
    const { result } = renderHook(() => useAsyncResource(fetcher, [], { initial: [], enabled: false }));
    expect(fetcher).not.toHaveBeenCalled();
    expect(result.current.status).toBe('ready');
  });
});
