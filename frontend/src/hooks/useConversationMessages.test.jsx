import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useConversationMessages } from './useConversationMessages';
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

describe('useConversationMessages', () => {
  test('fetches the message history for the given conversation', async () => {
    api.getMessages.mockResolvedValue([{ id: 'm1', content: 'Oi' }]);
    const { result } = renderHook(() => useConversationMessages('conv-1'));
    await waitFor(() => expect(result.current.messages).toEqual([{ id: 'm1', content: 'Oi' }]));
    expect(api.getMessages).toHaveBeenCalledWith('conv-1', 'tok-123');
  });

  test('message:new appends a message for this conversation', async () => {
    api.getMessages.mockResolvedValue([]);
    const { result } = renderHook(() => useConversationMessages('conv-1'));
    await waitFor(() => expect(result.current.messages).toEqual([]));

    act(() => {
      fakeSocket.trigger('message:new', {
        conversation: { id: 'conv-1' },
        message: { id: 'm1', content: 'Oi' },
      });
    });

    expect(result.current.messages).toEqual([{ id: 'm1', content: 'Oi' }]);
  });

  test('message:new for a different conversation is ignored', async () => {
    api.getMessages.mockResolvedValue([]);
    const { result } = renderHook(() => useConversationMessages('conv-1'));
    await waitFor(() => expect(result.current.messages).toEqual([]));

    act(() => {
      fakeSocket.trigger('message:new', {
        conversation: { id: 'conv-OTHER' },
        message: { id: 'm1', content: 'Oi' },
      });
    });

    expect(result.current.messages).toEqual([]);
  });

  test('message:updated merges into the existing message by id', async () => {
    api.getMessages.mockResolvedValue([{ id: 'm1', content: 'Resposta', status: 'sent' }]);
    const { result } = renderHook(() => useConversationMessages('conv-1'));
    await waitFor(() => expect(result.current.messages).toHaveLength(1));

    act(() => {
      fakeSocket.trigger('message:updated', {
        conversationId: 'conv-1',
        message: { id: 'm1', content: 'Resposta', status: 'failed' },
      });
    });

    expect(result.current.messages).toEqual([{ id: 'm1', content: 'Resposta', status: 'failed' }]);
  });

  test('message:updated for a different conversation is ignored', async () => {
    api.getMessages.mockResolvedValue([{ id: 'm1', status: 'sent' }]);
    const { result } = renderHook(() => useConversationMessages('conv-1'));
    await waitFor(() => expect(result.current.messages).toHaveLength(1));

    act(() => {
      fakeSocket.trigger('message:updated', {
        conversationId: 'conv-OTHER',
        message: { id: 'm1', status: 'failed' },
      });
    });

    expect(result.current.messages).toEqual([{ id: 'm1', status: 'sent' }]);
  });

  test('sendMessage posts to the API and appends the created message immediately', async () => {
    api.getMessages.mockResolvedValue([]);
    api.sendMessage.mockResolvedValue({ id: 'm2', content: 'Ola cliente', status: 'sent' });
    const { result } = renderHook(() => useConversationMessages('conv-1'));
    await waitFor(() => expect(result.current.messages).toEqual([]));

    await act(async () => {
      await result.current.sendMessage('Ola cliente');
    });

    expect(api.sendMessage).toHaveBeenCalledWith('conv-1', 'Ola cliente', 'tok-123');
    expect(result.current.messages).toEqual([{ id: 'm2', content: 'Ola cliente', status: 'sent' }]);
  });

  test('resets the message list when the conversationId changes', async () => {
    api.getMessages.mockResolvedValueOnce([{ id: 'm1' }]).mockResolvedValueOnce([{ id: 'm2' }]);
    const { result, rerender } = renderHook(({ id }) => useConversationMessages(id), {
      initialProps: { id: 'conv-1' },
    });
    await waitFor(() => expect(result.current.messages).toEqual([{ id: 'm1' }]));

    rerender({ id: 'conv-2' });

    await waitFor(() => expect(result.current.messages).toEqual([{ id: 'm2' }]));
  });
});
