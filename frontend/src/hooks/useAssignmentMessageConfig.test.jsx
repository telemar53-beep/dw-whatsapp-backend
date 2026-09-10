import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useAssignmentMessageConfig } from './useAssignmentMessageConfig';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
});

describe('useAssignmentMessageConfig', () => {
  test('fetches the config on mount', async () => {
    api.getAssignmentMessageConfig.mockResolvedValue({
      enabled: true,
      openingMessage: 'abertura',
      closingMessage: 'fechamento',
      agentIds: ['agent-1'],
      channelIds: ['channel-1'],
    });

    const { result } = renderHook(() => useAssignmentMessageConfig());

    await waitFor(() => expect(result.current.config.enabled).toBe(true));
    expect(api.getAssignmentMessageConfig).toHaveBeenCalledWith('tok-123');
  });

  test('starts with the empty default before the fetch resolves', () => {
    api.getAssignmentMessageConfig.mockResolvedValue({ id: null, enabled: false, openingMessage: '', closingMessage: '', agentIds: [], channelIds: [] });
    const { result } = renderHook(() => useAssignmentMessageConfig());
    expect(result.current.config).toEqual({ id: null, enabled: false, openingMessage: '', closingMessage: '', agentIds: [], channelIds: [] });
  });

  test('refresh refetches the config', async () => {
    api.getAssignmentMessageConfig.mockResolvedValue({ enabled: false, openingMessage: '', closingMessage: '', agentIds: [], channelIds: [] });
    const { result } = renderHook(() => useAssignmentMessageConfig());
    await waitFor(() => expect(api.getAssignmentMessageConfig).toHaveBeenCalledTimes(1));

    api.getAssignmentMessageConfig.mockResolvedValue({ enabled: true, openingMessage: 'nova', closingMessage: 'y', agentIds: [], channelIds: [] });
    await act(() => result.current.refresh());

    expect(result.current.config.openingMessage).toBe('nova');
  });
});
