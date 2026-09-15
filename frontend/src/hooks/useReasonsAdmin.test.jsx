import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useReasonsAdmin } from './useReasonsAdmin';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
});

describe('useReasonsAdmin', () => {
  test('fetches all reasons on mount, including inactive ones', async () => {
    api.listReasonsAdmin.mockResolvedValue([
      { id: 'r1', name: 'Ativo', active: true },
      { id: 'r2', name: 'Inativo', active: false },
    ]);

    const { result } = renderHook(() => useReasonsAdmin());

    await waitFor(() => expect(result.current.reasons).toHaveLength(2));
    expect(api.listReasonsAdmin).toHaveBeenCalledWith('tok-123');
  });

  test('refresh refetches the list', async () => {
    api.listReasonsAdmin.mockResolvedValue([]);
    const { result } = renderHook(() => useReasonsAdmin());
    await waitFor(() => expect(api.listReasonsAdmin).toHaveBeenCalledTimes(1));

    api.listReasonsAdmin.mockResolvedValue([{ id: 'r3', name: 'Nova', active: true }]);
    await act(() => result.current.refresh());

    expect(result.current.reasons).toEqual([{ id: 'r3', name: 'Nova', active: true }]);
  });

  test('expõe status loading → ready', async () => {
    api.listReasonsAdmin.mockResolvedValue([]);
    const { result } = renderHook(() => useReasonsAdmin());
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
  });

  test('403 vira forbidden', async () => {
    api.listReasonsAdmin.mockRejectedValue({ status: 403, body: { error: 'Insufficient permissions' } });
    const { result } = renderHook(() => useReasonsAdmin());
    await waitFor(() => expect(result.current.status).toBe('forbidden'));
  });
});
