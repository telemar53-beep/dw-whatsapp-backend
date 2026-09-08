import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useSgpIntegrations } from './useSgpIntegrations';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
});

describe('useSgpIntegrations', () => {
  test('fetches the list on mount', async () => {
    api.listSgpIntegrations.mockResolvedValue([
      { id: 'int-1', description: 'Baileys', channelId: 'channel-1', mode: 'freetext', defaultTemplateId: null, enabled: true, hasApiKey: true },
    ]);

    const { result } = renderHook(() => useSgpIntegrations());

    await waitFor(() => expect(result.current.integrations).toHaveLength(1));
    expect(api.listSgpIntegrations).toHaveBeenCalledWith('tok-123');
  });

  test('refresh refetches the list', async () => {
    api.listSgpIntegrations.mockResolvedValue([]);
    const { result } = renderHook(() => useSgpIntegrations());
    await waitFor(() => expect(api.listSgpIntegrations).toHaveBeenCalledTimes(1));

    api.listSgpIntegrations.mockResolvedValue([
      { id: 'int-2', description: 'Oficial', channelId: 'channel-2', mode: 'template', defaultTemplateId: null, enabled: true, hasApiKey: false },
    ]);
    await act(() => result.current.refresh());

    expect(result.current.integrations).toHaveLength(1);
  });
});
