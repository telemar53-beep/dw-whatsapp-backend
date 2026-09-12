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

  test('a message:updated event merges into the existing message instead of replacing it, preserving fields the update does not carry', async () => {
    // seed a message that already has a repliedToPreview (as if loaded from the initial GET)
    api.getMessages.mockResolvedValue([
      { id: 'm1', content: 'R$150,00', status: 'sent', repliedToPreview: { content: 'Qual o valor?', direction: 'inbound' } },
    ]);
    const { result } = renderHook(() => useConversationMessages('conv-1'));
    await waitFor(() => expect(result.current.messages).toHaveLength(1));

    act(() => {
      fakeSocket.trigger('message:updated', {
        conversationId: 'conv-1',
        message: { id: 'm1', content: 'R$150,00', status: 'delivered' },
      });
    });

    expect(result.current.messages[0].status).toBe('delivered');
    expect(result.current.messages[0].repliedToPreview).toEqual({ content: 'Qual o valor?', direction: 'inbound' });
  });

  test('sendMessage posts to the API and appends the created message immediately', async () => {
    api.getMessages.mockResolvedValue([]);
    api.sendMessage.mockResolvedValue({ id: 'm2', content: 'Ola cliente', status: 'sent' });
    const { result } = renderHook(() => useConversationMessages('conv-1'));
    await waitFor(() => expect(result.current.messages).toEqual([]));

    await act(async () => {
      await result.current.sendMessage('Ola cliente');
    });

    expect(api.sendMessage).toHaveBeenCalledWith('conv-1', 'Ola cliente', 'tok-123', undefined, undefined, undefined);
    expect(result.current.messages).toEqual([{ id: 'm2', content: 'Ola cliente', status: 'sent' }]);
  });

  test('sendMessage forwards the file argument to the api call', async () => {
    api.getMessages.mockResolvedValue([]);
    api.sendMessage.mockResolvedValue({ id: 'm3', messageType: 'image' });
    const { result } = renderHook(() => useConversationMessages('conv-1'));
    await waitFor(() => expect(result.current.messages).toEqual([]));
    const fakeFile = new File(['bytes'], 'foto.jpg', { type: 'image/jpeg' });

    await act(async () => {
      await result.current.sendMessage('Legenda', fakeFile);
    });

    expect(api.sendMessage).toHaveBeenCalledWith('conv-1', 'Legenda', 'tok-123', fakeFile, undefined, undefined);
  });

  test('sendMessage forwards the repliedToMessageId argument to the api call', async () => {
    const { result } = renderHook(() => useConversationMessages('conv-1'));
    api.sendMessage.mockResolvedValue({ id: 'm4', content: 'R$150,00', status: 'sent' });

    await act(async () => {
      await result.current.sendMessage('R$150,00', undefined, 'msg-original');
    });

    expect(api.sendMessage).toHaveBeenCalledWith('conv-1', 'R$150,00', 'tok-123', undefined, 'msg-original', undefined);
  });

  test('appendMessage adds a message to the local list without calling the API', async () => {
    api.getMessages.mockResolvedValue([]);
    const { result } = renderHook(() => useConversationMessages('conv-1'));
    await waitFor(() => expect(result.current.messages).toEqual([]));

    act(() => {
      result.current.appendMessage({ id: 'm5', messageType: 'document', mediaPath: 'abc.pdf' });
    });

    expect(result.current.messages).toEqual([{ id: 'm5', messageType: 'document', mediaPath: 'abc.pdf' }]);
    expect(api.sendMessage).not.toHaveBeenCalled();
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

  test('message:transcription preenche a transcrição da mensagem', async () => {
    api.getMessages.mockResolvedValue([{ id: 'm1', messageType: 'audio', transcriptionStatus: 'pending' }]);
    const { result } = renderHook(() => useConversationMessages('conv-1'));
    await waitFor(() => expect(result.current.messages).toHaveLength(1));

    act(() => {
      fakeSocket.trigger('message:transcription', {
        conversationId: 'conv-1',
        messageId: 'm1',
        transcription: 'minha internet caiu',
        transcriptionStatus: 'completed',
        transcriptionDetail: null,
      });
    });

    expect(result.current.messages[0].transcription).toBe('minha internet caiu');
    expect(result.current.messages[0].transcriptionStatus).toBe('completed');
    expect(result.current.messages[0].messageType).toBe('audio');
  });

  test('message:transcription de outra conversa é ignorado', async () => {
    api.getMessages.mockResolvedValue([{ id: 'm1', messageType: 'audio', transcriptionStatus: 'pending' }]);
    const { result } = renderHook(() => useConversationMessages('conv-1'));
    await waitFor(() => expect(result.current.messages).toHaveLength(1));

    act(() => {
      fakeSocket.trigger('message:transcription', {
        conversationId: 'conv-2', messageId: 'm1',
        transcription: 'texto errado', transcriptionStatus: 'completed', transcriptionDetail: null,
      });
    });

    expect(result.current.messages[0].transcription).toBeUndefined();
  });

  test('message:transcription para mensagem desconhecida não quebra a lista', async () => {
    api.getMessages.mockResolvedValue([{ id: 'm1', messageType: 'audio' }]);
    const { result } = renderHook(() => useConversationMessages('conv-1'));
    await waitFor(() => expect(result.current.messages).toHaveLength(1));

    act(() => {
      fakeSocket.trigger('message:transcription', {
        conversationId: 'conv-1', messageId: 'm-inexistente',
        transcription: 'x', transcriptionStatus: 'completed', transcriptionDetail: null,
      });
    });

    expect(result.current.messages).toHaveLength(1);
  });
});
