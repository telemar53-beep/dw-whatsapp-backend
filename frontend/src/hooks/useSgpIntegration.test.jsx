import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useSgpIntegration } from './useSgpIntegration';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
});

describe('useSgpIntegration', () => {
  test('fetches the integration on mount', async () => {
    api.getSgpIntegration.mockResolvedValue({ configured: true, channelId: 'channel-1', enabled: true, hasApiKey: true });

    const { result } = renderHook(() => useSgpIntegration());

    await waitFor(() =>
      expect(result.current.integration).toEqual({ configured: true, channelId: 'channel-1', enabled: true, hasApiKey: true })
    );
    expect(api.getSgpIntegration).toHaveBeenCalledWith('tok-123');
  });

  test('refresh refetches the integration', async () => {
    api.getSgpIntegration.mockResolvedValue({ configured: false });
    const { result } = renderHook(() => useSgpIntegration());
    await waitFor(() => expect(api.getSgpIntegration).toHaveBeenCalledTimes(1));

    api.getSgpIntegration.mockResolvedValue({ configured: true, channelId: 'channel-2', enabled: false, hasApiKey: false });
    await act(() => result.current.refresh());

    expect(result.current.integration).toEqual({ configured: true, channelId: 'channel-2', enabled: false, hasApiKey: false });
  });
});
