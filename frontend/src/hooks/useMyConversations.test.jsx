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

// O "Editar cliente" salvou: a lista guarda o que voltou do servidor, para a
// conversa reaberta (e a linha) não voltarem com o contato antigo. O contato é
// a identidade: toda conversa dele recebe os dados; as outras não mudam de
// referência, senão a lista inteira redesenharia (A2).
describe('useMyConversations — contato salvo na edição', () => {
  const A1 = { id: 'c1', contactId: 'contato-A', contactDisplayName: 'Contato A', contactCityId: null, contactInternalNote: 'Nota antiga' };
  const A2 = { id: 'c2', contactId: 'contato-A', contactDisplayName: 'Contato A', contactCityId: null, contactInternalNote: 'Nota antiga' };
  const B = { id: 'c3', contactId: 'contato-B', contactDisplayName: 'Contato B', contactCityId: null, contactInternalNote: 'Nota de B' };
  const SALVO = {
    conversationId: 'c1',
    contactId: 'contato-A',
    displayName: 'Contato A editado',
    cityId: 'mun-1',
    cityName: 'Município Um',
    localityId: 'loc-1',
    localityName: 'Localidade Um',
    internalNote: 'Nota nova',
  };

  async function carregar() {
    api.getMyConversations.mockResolvedValue([A1, A2, B]);
    const hook = renderHook(() => useMyConversations());
    await waitFor(() => expect(hook.result.current.conversations).toHaveLength(3));
    return hook;
  }

  test('as duas conversas do mesmo contato recebem nome, município, localidade e nota', async () => {
    const { result } = await carregar();
    act(() => result.current.aplicarContatoSalvo(SALVO));

    for (const id of ['c1', 'c2']) {
      expect(result.current.conversations.find((c) => c.id === id)).toMatchObject({
        contactDisplayName: 'Contato A editado',
        contactCityId: 'mun-1',
        contactCityName: 'Município Um',
        contactLocalityId: 'loc-1',
        contactLocalityName: 'Localidade Um',
        contactInternalNote: 'Nota nova',
      });
    }
    // Objeto novo, nunca o antigo mudado no lugar.
    expect(A1.contactInternalNote).toBe('Nota antiga');
  });

  test('a conversa de outro contato continua sendo o mesmo objeto', async () => {
    const { result } = await carregar();
    act(() => result.current.aplicarContatoSalvo(SALVO));
    expect(result.current.conversations.find((c) => c.id === 'c3')).toBe(B);
  });

  test('outro contato não muda: salvar um contato que não está na lista não troca nem o array', async () => {
    const { result } = await carregar();
    const antes = result.current.conversations;
    act(() => result.current.aplicarContatoSalvo({ ...SALVO, conversationId: 'c9', contactId: 'contato-Z' }));
    expect(result.current.conversations).toBe(antes);
    expect(result.current.conversations.find((c) => c.id === 'c3')).toEqual(B);
  });

  test('salvar de novo os mesmos valores não troca o array', async () => {
    const { result } = await carregar();
    act(() => result.current.aplicarContatoSalvo(SALVO));
    const depois = result.current.conversations;
    act(() => result.current.aplicarContatoSalvo(SALVO));
    expect(result.current.conversations).toBe(depois);
  });

  // O conversation.id é a origem da operação: um salvo que diz vir de uma
  // conversa da lista, mas com outro contato, está errado e não entra.
  test('origem que não bate com o contato não altera nada', async () => {
    const { result } = await carregar();
    const antes = result.current.conversations;
    act(() => result.current.aplicarContatoSalvo({ ...SALVO, conversationId: 'c3' }));
    expect(result.current.conversations).toBe(antes);
  });
});
