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
    await waitFor(() => expect(result.current.queue).toEqual([{ id: 'c1', contactDisplayName: 'Carlos' }]));
  });

  test('expõe status loading → ready', async () => {
    api.getQueue.mockResolvedValue([]);
    const { result } = renderHook(() => useQueue());
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
  });

  test('403 vira forbidden', async () => {
    api.getQueue.mockRejectedValue({ status: 403, body: { error: 'Insufficient permissions' } });
    const { result } = renderHook(() => useQueue());
    await waitFor(() => expect(result.current.status).toBe('forbidden'));
  });

  test('queue:new upserts by conversation id instead of appending', async () => {
    api.getQueue.mockResolvedValue([{ id: 'c1', contactDisplayName: 'Carlos' }]);
    const { result } = renderHook(() => useQueue());
    await waitFor(() => expect(result.current.queue).toHaveLength(1));

    act(() => {
      fakeSocket.trigger('queue:new', { conversation: { id: 'c1', contactDisplayName: 'Carlos (atualizado)' } });
    });

    expect(result.current.queue).toEqual([{ id: 'c1', contactDisplayName: 'Carlos (atualizado)' }]);
  });

  test('contact:avatar-updated swaps the avatar of every conversation of that contact', async () => {
    api.getQueue.mockResolvedValue([
      { id: 'c1', contactId: 'ct1', contactAvatarPath: 'old.jpg' },
      { id: 'c2', contactId: 'ct2', contactAvatarPath: null },
    ]);
    const { result } = renderHook(() => useQueue());
    await waitFor(() => expect(result.current.queue).toHaveLength(2));

    act(() => {
      fakeSocket.trigger('contact:avatar-updated', { contactId: 'ct1', avatarPath: 'new.jpg' });
    });

    expect(result.current.queue).toEqual([
      { id: 'c1', contactId: 'ct1', contactAvatarPath: 'new.jpg' },
      { id: 'c2', contactId: 'ct2', contactAvatarPath: null },
    ]);
  });

  test('queue:new adds a new entry for an unseen conversation', async () => {
    api.getQueue.mockResolvedValue([]);
    const { result } = renderHook(() => useQueue());
    await waitFor(() => expect(result.current.queue).toEqual([]));

    act(() => {
      fakeSocket.trigger('queue:new', { conversation: { id: 'c2', contactDisplayName: 'Maria' } });
    });

    expect(result.current.queue).toEqual([{ id: 'c2', contactDisplayName: 'Maria' }]);
  });

  test('queue:removed removes the conversation from the list', async () => {
    api.getQueue.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]);
    const { result } = renderHook(() => useQueue());
    await waitFor(() => expect(result.current.queue).toHaveLength(2));

    act(() => {
      fakeSocket.trigger('queue:removed', { conversationId: 'c1' });
    });

    expect(result.current.queue).toEqual([{ id: 'c2' }]);
  });

  // Caso ER (25/09/2026): a IA encerrou a conversa em triagem e o cliente escreveu de novo.
  // O item encerrado sai da Automação pelo queue:removed que o backend passou a emitir — sem
  // recarregar a página — e só a conversa nova do mesmo cliente fica.
  test('caso ER: conversa encerrada pela IA sai da fila com queue:removed; a nova do mesmo cliente fica', async () => {
    api.getQueue.mockResolvedValue([{ id: 'e8dfaf50', contactId: 'ct-er', triageState: 'pending', status: 'waiting' }]);
    const { result } = renderHook(() => useQueue());
    await waitFor(() => expect(result.current.queue).toHaveLength(1));

    act(() => {
      fakeSocket.trigger('queue:new', { conversation: { id: '9907a142', contactId: 'ct-er', triageState: 'pending', status: 'waiting' } });
    });
    expect(result.current.queue.map((c) => c.id)).toEqual(['e8dfaf50', '9907a142']);

    act(() => {
      fakeSocket.trigger('queue:removed', { conversationId: 'e8dfaf50' });
    });
    expect(result.current.queue.map((c) => c.id)).toEqual(['9907a142']);
  });
  // Print 2026-09-16: em Espera/Automação a prévia parava na mensagem do
  // cliente — a resposta da IA chega como message:new (broadcast, sem
  // atendente) e a fila não escutava.
  test('message:new de conversa da fila troca o item pela conversa atualizada', async () => {
    api.getQueue.mockResolvedValue([{ id: 'c1', lastMessageContent: 'Quero pagar' }]);
    const { result } = renderHook(() => useQueue());
    await waitFor(() => expect(result.current.queue).toHaveLength(1));

    act(() => {
      fakeSocket.trigger('message:new', {
        conversation: { id: 'c1', lastMessageContent: 'Enviei acima o boleto', lastMessageDirection: 'outbound' },
        message: { id: 'm2', content: 'Enviei acima o boleto' },
      });
    });

    expect(result.current.queue).toEqual([{ id: 'c1', lastMessageContent: 'Enviei acima o boleto', lastMessageDirection: 'outbound' }]);
  });

  test('message:new de conversa fora da fila (atribuída a alguém) não entra na fila', async () => {
    api.getQueue.mockResolvedValue([{ id: 'c1' }]);
    const { result } = renderHook(() => useQueue());
    await waitFor(() => expect(result.current.queue).toHaveLength(1));

    act(() => {
      fakeSocket.trigger('message:new', { conversation: { id: 'c7', assignedAgentId: 'a1' }, message: { id: 'm' } });
    });

    expect(result.current.queue).toEqual([{ id: 'c1' }]);
  });
});
