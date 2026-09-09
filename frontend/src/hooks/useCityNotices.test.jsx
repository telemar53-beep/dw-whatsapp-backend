import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useCityNotices } from './useCityNotices';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
});

describe('useCityNotices', () => {
  test('fetches city notices on mount', async () => {
    api.listCityNotices.mockResolvedValue([{ id: 'city-1', name: 'Maracaçumé', notice: null }]);

    const { result } = renderHook(() => useCityNotices());

    await waitFor(() => expect(result.current.cityNotices).toEqual([{ id: 'city-1', name: 'Maracaçumé', notice: null }]));
    expect(api.listCityNotices).toHaveBeenCalledWith('tok-123');
  });

  test('refresh refetches the list', async () => {
    api.listCityNotices.mockResolvedValue([]);
    const { result } = renderHook(() => useCityNotices());
    await waitFor(() => expect(api.listCityNotices).toHaveBeenCalledTimes(1));

    api.listCityNotices.mockResolvedValue([{ id: 'city-2', name: 'Nova', notice: null }]);
    await act(() => result.current.refresh());

    expect(result.current.cityNotices).toEqual([{ id: 'city-2', name: 'Nova', notice: null }]);
  });
});
