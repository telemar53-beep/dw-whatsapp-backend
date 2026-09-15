import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useMyConversations } from './useMyConversations';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../contexts/SocketContext');
vi.mock('../services/api');

function createFakeSocket() {
  const handlers = {};
  return {
    on: vi.fn((event, cb) => {
      handlers[event] = cb;
    }),
    off: vi.fn(),
    trigger: (event, payload) => handlers[event] && handlers[event](payload),
  };
}

let fakeSocket;

beforeEach(() => {
  vi.clearAllMocks();
  fakeSocket = createFakeSocket();
  useAuth.mockReturnValue({ token: 'tok-123' });
  useSocket.mockReturnValue(fakeSocket);
});

describe('useMyConversations', () => {
  test('fetches the initial list on mount', async () => {
    api.getMyConversations.mockResolvedValue([{ id: 'c1' }]);
    const { result } = renderHook(() => useMyConversations());
    await waitFor(() => expect(result.current.conversations).toEqual([{ id: 'c1' }]));
  });

  test('expõe status loading → ready', async () => {
    api.getMyConversations.mockResolvedValue([]);
    const { result } = renderHook(() => useMyConversations());
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
  });

  test('403 vira forbidden', async () => {
    api.getMyConversations.mockRejectedValue({ status: 403, body: { error: 'Insufficient permissions' } });
    const { result } = renderHook(() => useMyConversations());
    await waitFor(() => expect(result.current.status).toBe('forbidden'));
  });

  test('conversation:assigned adds the conversation to the list', async () => {
    api.getMyConversations.mockResolvedValue([]);
    const { result } = renderHook(() => useMyConversations());
    await waitFor(() => expect(result.current.conversations).toEqual([]));

    act(() => {
      fakeSocket.trigger('conversation:assigned', { conversation: { id: 'c1' } });
    });

    expect(result.current.conversations).toEqual([{ id: 'c1' }]);
  });

  test('contact:avatar-updated swaps the avatar of the matching conversations', async () => {
    api.getMyConversations.mockResolvedValue([{ id: 'c1', contactId: 'ct1', contactAvatarPath: 'old.jpg' }]);
    const { result } = renderHook(() => useMyConversations());
    await waitFor(() => expect(result.current.conversations).toHaveLength(1));

    act(() => {
      fakeSocket.trigger('contact:avatar-updated', { contactId: 'ct1', avatarPath: null });
    });

    expect(result.current.conversations).toEqual([{ id: 'c1', contactId: 'ct1', contactAvatarPath: null }]);
  });

  test('conversation:removed removes the conversation from the list', async () => {
    api.getMyConversations.mockResolvedValue([{ id: 'c1' }]);
    const { result } = renderHook(() => useMyConversations());
    await waitFor(() => expect(result.current.conversations).toHaveLength(1));

    act(() => {
      fakeSocket.trigger('conversation:removed', { conversationId: 'c1' });
    });

    expect(result.current.conversations).toEqual([]);
  });

  test('conversation:closed removes the conversation from the list', async () => {
    api.getMyConversations.mockResolvedValue([{ id: 'c1' }]);
    const { result } = renderHook(() => useMyConversations());
    await waitFor(() => expect(result.current.conversations).toHaveLength(1));

    act(() => {
      fakeSocket.trigger('conversation:closed', { conversationId: 'c1' });
    });

    expect(result.current.conversations).toEqual([]);
  });
});
