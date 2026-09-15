import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useAgentChannels } from './useAgentChannels';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
});

describe('useAgentChannels', () => {
  test('expõe status loading → ready e usa o endpoint de atendente', async () => {
    api.listChannelsForAgent.mockResolvedValue([{ id: 'ch1', name: 'Berg', type: 'baileys' }]);
    const { result } = renderHook(() => useAgentChannels());
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.channels).toEqual([{ id: 'ch1', name: 'Berg', type: 'baileys' }]);
    expect(api.listChannelsForAgent).toHaveBeenCalledWith('tok-123');
    expect(api.listChannels).not.toHaveBeenCalled();
  });

  test('403 vira forbidden', async () => {
    api.listChannelsForAgent.mockRejectedValue({ status: 403, body: { error: 'Insufficient permissions' } });
    const { result } = renderHook(() => useAgentChannels());
    await waitFor(() => expect(result.current.status).toBe('forbidden'));
  });
});
