import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useQueue } from './useQueue';
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

describe('useQueue', () => {
  test('fetches the initial queue on mount', async () => {
    api.getQueue.mockResolvedValue([{ id: 'c1', contactDisplayName: 'Carlos' }]);
    const { result } = renderHook(() => useQueue());
    await waitFor(() => expect(result.current).toEqual([{ id: 'c1', contactDisplayName: 'Carlos' }]));
  });

  test('queue:new upserts by conversation id instead of appending', async () => {
    api.getQueue.mockResolvedValue([{ id: 'c1', contactDisplayName: 'Carlos' }]);
    const { result } = renderHook(() => useQueue());
    await waitFor(() => expect(result.current).toHaveLength(1));

    act(() => {
      fakeSocket.trigger('queue:new', { conversation: { id: 'c1', contactDisplayName: 'Carlos (atualizado)' } });
    });

    expect(result.current).toEqual([{ id: 'c1', contactDisplayName: 'Carlos (atualizado)' }]);
  });

  test('contact:avatar-updated swaps the avatar of every conversation of that contact', async () => {
    api.getQueue.mockResolvedValue([
      { id: 'c1', contactId: 'ct1', contactAvatarPath: 'old.jpg' },
      { id: 'c2', contactId: 'ct2', contactAvatarPath: null },
    ]);
    const { result } = renderHook(() => useQueue());
    await waitFor(() => expect(result.current).toHaveLength(2));

    act(() => {
      fakeSocket.trigger('contact:avatar-updated', { contactId: 'ct1', avatarPath: 'new.jpg' });
    });

    expect(result.current).toEqual([
      { id: 'c1', contactId: 'ct1', contactAvatarPath: 'new.jpg' },
      { id: 'c2', contactId: 'ct2', contactAvatarPath: null },
    ]);
  });

  test('queue:new adds a new entry for an unseen conversation', async () => {
    api.getQueue.mockResolvedValue([]);
    const { result } = renderHook(() => useQueue());
    await waitFor(() => expect(result.current).toEqual([]));

    act(() => {
      fakeSocket.trigger('queue:new', { conversation: { id: 'c2', contactDisplayName: 'Maria' } });
    });

    expect(result.current).toEqual([{ id: 'c2', contactDisplayName: 'Maria' }]);
  });

  test('queue:removed removes the conversation from the list', async () => {
    api.getQueue.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]);
    const { result } = renderHook(() => useQueue());
    await waitFor(() => expect(result.current).toHaveLength(2));

    act(() => {
      fakeSocket.trigger('queue:removed', { conversationId: 'c1' });
    });

    expect(result.current).toEqual([{ id: 'c2' }]);
  });
});
