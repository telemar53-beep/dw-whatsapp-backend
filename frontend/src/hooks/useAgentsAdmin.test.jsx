import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useAgentsAdmin } from './useAgentsAdmin';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
});

describe('useAgentsAdmin', () => {
  test('fetches agents when enabled', async () => {
    api.listAgentsAdmin.mockResolvedValue([{ id: 'a1', name: 'Ana', active: true }]);
    const { result } = renderHook(() => useAgentsAdmin(true));
    await waitFor(() => expect(result.current.agents).toEqual([{ id: 'a1', name: 'Ana', active: true }]));
  });

  test('does not fetch when disabled', async () => {
    const { result } = renderHook(() => useAgentsAdmin(false));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(api.listAgentsAdmin).not.toHaveBeenCalled();
    expect(result.current.agents).toEqual([]);
  });

  test('refresh re-fetches the agent list', async () => {
    api.listAgentsAdmin.mockResolvedValue([]);
    const { result } = renderHook(() => useAgentsAdmin(true));
    await waitFor(() => expect(api.listAgentsAdmin).toHaveBeenCalledTimes(1));
    await act(() => result.current.refresh());
    expect(api.listAgentsAdmin).toHaveBeenCalledTimes(2);
  });

  test('sets loading to false and does not throw when the fetch fails', async () => {
    api.listAgentsAdmin.mockRejectedValue(new Error('network error'));
    const { result } = renderHook(() => useAgentsAdmin(true));
    await waitFor(() => expect(result.current.loading).toBe(false));
  });
});
