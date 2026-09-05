import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useChannels } from './useChannels';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
});

describe('useChannels', () => {
  test('fetches channels when enabled', async () => {
    api.listChannels.mockResolvedValue([{ id: 'ch1', status: 'connected' }]);
    const { result } = renderHook(() => useChannels(true));
    await waitFor(() => expect(result.current.channels).toEqual([{ id: 'ch1', status: 'connected' }]));
  });

  test('does not fetch when disabled', async () => {
    const { result } = renderHook(() => useChannels(false));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(api.listChannels).not.toHaveBeenCalled();
    expect(result.current.channels).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  test('defaults to enabled when no argument is given', async () => {
    api.listChannels.mockResolvedValue([]);
    renderHook(() => useChannels());
    await waitFor(() => expect(api.listChannels).toHaveBeenCalled());
  });

  test('sets loading to false and does not throw when the fetch fails', async () => {
    api.listChannels.mockRejectedValue(new Error('network error'));
    const { result } = renderHook(() => useChannels(true));
    await waitFor(() => expect(result.current.loading).toBe(false));
  });
});
