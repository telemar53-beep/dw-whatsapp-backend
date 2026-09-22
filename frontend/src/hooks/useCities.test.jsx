import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useCities, usePlaces } from './useCities';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
});

describe('useCities e usePlaces', () => {
  test('useCities pede so os municipios, sem a flag', async () => {
    api.listCities.mockResolvedValue([{ id: 'm1', name: 'Municipio', kind: 'city' }]);

    const { result } = renderHook(() => useCities());

    await waitFor(() => expect(result.current.cities).toHaveLength(1));
    expect(api.listCities).toHaveBeenCalledWith('tok-123', undefined);
  });

  test('usePlaces pede a hierarquia completa', async () => {
    api.listCities.mockResolvedValue([]);

    const { result } = renderHook(() => usePlaces());

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(api.listCities).toHaveBeenCalledWith('tok-123', { includeLocalities: true });
  });

  test('usePlaces devolve a lista em `places`', async () => {
    api.listCities.mockResolvedValue([
      { id: 'm1', name: 'Municipio', kind: 'city', parentId: null },
      { id: 'p1', name: 'Povoado', kind: 'locality', parentId: 'm1' },
    ]);

    const { result } = renderHook(() => usePlaces());

    await waitFor(() => expect(result.current.places).toHaveLength(2));
    expect(result.current.places[1].kind).toBe('locality');
  });
});
