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
  // Print 2026-09-16: a lista de Andamento só mudava no F5 — a prévia e o
  // horário do item não acompanhavam as mensagens. O servidor manda a conversa
  // inteira (com lastMessage*) em message:new; message:updated traz só a
  // mensagem (a do próprio atendente, quando sai).
  describe('prévia ao vivo', () => {
    test('message:new de uma conversa da lista troca o item pela conversa atualizada', async () => {
      api.getMyConversations.mockResolvedValue([{ id: 'c1', lastMessageContent: 'Bom dia', lastMessageAt: '2026-09-16T08:34:00Z' }]);
      const { result } = renderHook(() => useMyConversations());
      await waitFor(() => expect(result.current.conversations).toHaveLength(1));

      act(() => {
        fakeSocket.trigger('message:new', {
          conversation: { id: 'c1', lastMessageContent: 'Oi', lastMessageDirection: 'inbound', lastMessageAt: '2026-09-16T08:40:00Z' },
          message: { id: 'm2', content: 'Oi', direction: 'inbound' },
        });
      });

      expect(result.current.conversations).toEqual([
        { id: 'c1', lastMessageContent: 'Oi', lastMessageDirection: 'inbound', lastMessageAt: '2026-09-16T08:40:00Z' },
      ]);
    });

    test('message:new de conversa fora da lista não acrescenta nada', async () => {
      api.getMyConversations.mockResolvedValue([{ id: 'c1' }]);
      const { result } = renderHook(() => useMyConversations());
      await waitFor(() => expect(result.current.conversations).toHaveLength(1));

      act(() => {
        fakeSocket.trigger('message:new', { conversation: { id: 'c9', lastMessageContent: 'x' }, message: { id: 'm', content: 'x' } });
      });

      expect(result.current.conversations).toEqual([{ id: 'c1' }]);
    });

    test('message:updated com mensagem mais nova atualiza a prévia; mais antiga não', async () => {
      api.getMyConversations.mockResolvedValue([{ id: 'c1', lastMessageContent: 'Bom dia', lastMessageAt: '2026-09-16T08:34:00Z' }]);
      const { result } = renderHook(() => useMyConversations());
      await waitFor(() => expect(result.current.conversations).toHaveLength(1));

      act(() => {
        fakeSocket.trigger('message:updated', {
          conversationId: 'c1',
          message: { id: 'm2', content: 'Posso ajudar em algo mais?', messageType: 'text', direction: 'outbound', status: 'sent', createdAt: '2026-09-16T08:37:00Z' },
        });
      });
      expect(result.current.conversations[0]).toMatchObject({
        lastMessageContent: 'Posso ajudar em algo mais?', lastMessageType: 'text', lastMessageDirection: 'outbound', lastMessageStatus: 'sent', lastMessageAt: '2026-09-16T08:37:00Z',
      });

      act(() => {
        fakeSocket.trigger('message:updated', {
          conversationId: 'c1',
          message: { id: 'm1', content: 'Bom dia', messageType: 'text', direction: 'outbound', status: 'delivered', createdAt: '2026-09-16T08:34:00Z' },
        });
      });
      expect(result.current.conversations[0].lastMessageContent).toBe('Posso ajudar em algo mais?');
    });
  });
});
