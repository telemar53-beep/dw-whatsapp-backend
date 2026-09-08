import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useSgpLookup } from './useSgpLookup';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';
import { ApiError } from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../services/api', async () => {
  const actual = await vi.importActual('../services/api');
  return { ...actual, lookupSgpClient: vi.fn(), generateSgpDuplicateInvoice: vi.fn() };
});

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
});

describe('useSgpLookup', () => {
  test('search populates client and contracts on success', async () => {
    api.lookupSgpClient.mockResolvedValue({ client: { id: 1, name: 'Cliente X', document: '000' }, contracts: [{ id: 17402, status: 'Ativo' }] });
    const { result } = renderHook(() => useSgpLookup());

    await act(() => result.current.search('03666811337'));

    expect(api.lookupSgpClient).toHaveBeenCalledWith('03666811337', 'tok-123');
    expect(result.current.client.name).toBe('Cliente X');
    expect(result.current.contracts).toHaveLength(1);
    expect(result.current.loading).toBe(false);
  });

  test('search sets error "not_found" on a 404', async () => {
    api.lookupSgpClient.mockRejectedValue(new ApiError(404, { error: 'Client not found' }));
    const { result } = renderHook(() => useSgpLookup());

    await act(() => result.current.search('00000000000'));

    expect(result.current.error).toBe('not_found');
    expect(result.current.client).toBeNull();
  });

  test('search sets error "error" on any other failure', async () => {
    api.lookupSgpClient.mockRejectedValue(new ApiError(502, { error: 'Failed to reach SGP' }));
    const { result } = renderHook(() => useSgpLookup());

    await act(() => result.current.search('03666811337'));

    expect(result.current.error).toBe('error');
  });

  test('search surfaces the backend\'s real error message for a non-404 failure', async () => {
    api.lookupSgpClient.mockRejectedValue(new ApiError(400, { error: 'SGP integration is not configured' }));
    const { result } = renderHook(() => useSgpLookup());

    await act(() => result.current.search('03666811337'));

    expect(result.current.error).toBe('error');
    expect(result.current.errorMessage).toBe('SGP integration is not configured');
  });

  test('fetchDuplicate stores the result keyed by contratoId', async () => {
    api.generateSgpDuplicateInvoice.mockResolvedValue({ hasOpenInvoice: true, duplicates: [{ id: '999' }] });
    const { result } = renderHook(() => useSgpLookup());

    await act(() => result.current.fetchDuplicate(17402));

    expect(api.generateSgpDuplicateInvoice).toHaveBeenCalledWith(17402, 'tok-123');
    expect(result.current.duplicateState[17402]).toEqual({ loading: false, error: null, hasOpenInvoice: true, duplicates: [{ id: '999' }] });
  });

  test('fetchDuplicate stores a loading state per contratoId while pending', () => {
    api.generateSgpDuplicateInvoice.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useSgpLookup());

    act(() => {
      result.current.fetchDuplicate(17402);
    });

    expect(result.current.duplicateState[17402]).toEqual({ loading: true, error: null });
  });
});
