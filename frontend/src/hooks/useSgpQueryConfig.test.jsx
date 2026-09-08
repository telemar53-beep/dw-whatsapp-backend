import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useSgpQueryConfig } from './useSgpQueryConfig';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
});

describe('useSgpQueryConfig', () => {
  test('fetches the config on mount', async () => {
    api.getSgpQueryConfig.mockResolvedValue({ configured: true, baseUrl: 'https://x.example', app: 'chatmix', tokenLast4: '5c7a', enabled: true });

    const { result } = renderHook(() => useSgpQueryConfig());

    await waitFor(() => expect(result.current.config.configured).toBe(true));
    expect(api.getSgpQueryConfig).toHaveBeenCalledWith('tok-123');
  });

  test('starts with configured: false before the fetch resolves', () => {
    api.getSgpQueryConfig.mockResolvedValue({ configured: false });
    const { result } = renderHook(() => useSgpQueryConfig());
    expect(result.current.config).toEqual({ configured: false });
  });

  test('refresh refetches the config', async () => {
    api.getSgpQueryConfig.mockResolvedValue({ configured: false });
    const { result } = renderHook(() => useSgpQueryConfig());
    await waitFor(() => expect(api.getSgpQueryConfig).toHaveBeenCalledTimes(1));

    api.getSgpQueryConfig.mockResolvedValue({ configured: true, baseUrl: 'https://y.example', app: 'chatmix', tokenLast4: '1234', enabled: true });
    await act(() => result.current.refresh());

    expect(result.current.config.baseUrl).toBe('https://y.example');
  });
});
