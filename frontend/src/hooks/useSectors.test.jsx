import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useSectors } from './useSectors';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
});

describe('useSectors', () => {
  test('fetches sectors on mount', async () => {
    api.listSectors.mockResolvedValue([{ id: 'sector-1', name: 'Financeiro' }]);

    const { result } = renderHook(() => useSectors());

    await waitFor(() => expect(result.current.sectors).toEqual([{ id: 'sector-1', name: 'Financeiro' }]));
    expect(api.listSectors).toHaveBeenCalledWith('tok-123');
  });

  test('refresh refetches the list', async () => {
    api.listSectors.mockResolvedValue([]);
    const { result } = renderHook(() => useSectors());
    await waitFor(() => expect(api.listSectors).toHaveBeenCalledTimes(1));

    api.listSectors.mockResolvedValue([{ id: 'sector-2', name: 'Nova' }]);
    await act(() => result.current.refresh());

    expect(result.current.sectors).toEqual([{ id: 'sector-2', name: 'Nova' }]);
  });
});
