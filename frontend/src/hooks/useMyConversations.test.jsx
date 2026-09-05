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
    await waitFor(() => expect(result.current).toEqual([{ id: 'c1' }]));
  });

  test('conversation:assigned adds the conversation to the list', async () => {
    api.getMyConversations.mockResolvedValue([]);
    const { result } = renderHook(() => useMyConversations());
    await waitFor(() => expect(result.current).toEqual([]));

    act(() => {
      fakeSocket.trigger('conversation:assigned', { conversation: { id: 'c1' } });
    });

    expect(result.current).toEqual([{ id: 'c1' }]);
  });

  test('conversation:removed removes the conversation from the list', async () => {
    api.getMyConversations.mockResolvedValue([{ id: 'c1' }]);
    const { result } = renderHook(() => useMyConversations());
    await waitFor(() => expect(result.current).toHaveLength(1));

    act(() => {
      fakeSocket.trigger('conversation:removed', { conversationId: 'c1' });
    });

    expect(result.current).toEqual([]);
  });

  test('conversation:closed removes the conversation from the list', async () => {
    api.getMyConversations.mockResolvedValue([{ id: 'c1' }]);
    const { result } = renderHook(() => useMyConversations());
    await waitFor(() => expect(result.current).toHaveLength(1));

    act(() => {
      fakeSocket.trigger('conversation:closed', { conversationId: 'c1' });
    });

    expect(result.current).toEqual([]);
  });
});
