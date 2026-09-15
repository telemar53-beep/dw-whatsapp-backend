import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useReasons } from './useReasons';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
});

describe('useReasons', () => {
  test('fetches active reasons on mount', async () => {
    api.listReasons.mockResolvedValue([{ id: 'r1', name: 'Troca de senha', active: true }]);

    const { result } = renderHook(() => useReasons());

    await waitFor(() => expect(result.current.reasons).toEqual([{ id: 'r1', name: 'Troca de senha', active: true }]));
    expect(api.listReasons).toHaveBeenCalledWith('tok-123');
  });

  test('refresh refetches the list', async () => {
    api.listReasons.mockResolvedValue([]);
    const { result } = renderHook(() => useReasons());
    await waitFor(() => expect(api.listReasons).toHaveBeenCalledTimes(1));

    api.listReasons.mockResolvedValue([{ id: 'r2', name: 'Pagamento', active: true }]);
    await act(() => result.current.refresh());

    expect(result.current.reasons).toEqual([{ id: 'r2', name: 'Pagamento', active: true }]);
  });

  test('expõe status loading → ready', async () => {
    api.listReasons.mockResolvedValue([]);
    const { result } = renderHook(() => useReasons());
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
  });

  test('403 vira forbidden', async () => {
    api.listReasons.mockRejectedValue({ status: 403, body: { error: 'Insufficient permissions' } });
    const { result } = renderHook(() => useReasons());
    await waitFor(() => expect(result.current.status).toBe('forbidden'));
  });
});
