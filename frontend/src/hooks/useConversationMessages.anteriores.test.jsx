import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useConversationMessages } from './useConversationMessages';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../contexts/SocketContext');
vi.mock('../services/api');

// "Carregar mensagens anteriores" (cursor `before`), com o SEGUNDO clique.
//
// Este botão foi publicado quebrado e ficou assim até a E1 (24/09/2026, BUG-006
// no Obsidian): `carregarAnteriores` lia o cursor de dentro de um updater de
// setMessages, logo depois de outro setState. Com uma atualização já pendente na
// fibra, o React 18 não executa esse updater na hora; o cursor saía `undefined`,
// a requisição ia sem `before`, voltavam as 51 mais novas, o merge por id
// descartava tudo — e o botão ficava na tela sem trazer nada. O que faltou na
// época foi exatamente isto: um teste que clica duas vezes e confere que a
// conversa inteira chega, na ordem, e que o botão some no fim.

// Servidor falso com 120 mensagens, m001 (a mais antiga) a m120. Responde como
// a rota real: sem `before`, as `limit` mais novas; com `before`, as `limit`
// imediatamente anteriores ao id dado. Sempre em ordem crescente.
const HISTORICO = Array.from({ length: 120 }, (_, i) => ({
  id: `m${String(i + 1).padStart(3, '0')}`,
  content: `mensagem ${i + 1}`,
}));

function servidorFalso(_conversationId, _token, { limit, before } = {}) {
  const fim = before ? HISTORICO.findIndex((m) => m.id === before) : HISTORICO.length;
  return Promise.resolve(HISTORICO.slice(Math.max(0, fim - limit), fim));
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
  useSocket.mockReturnValue({ on: vi.fn(), off: vi.fn() });
  api.getMessages.mockImplementation(servidorFalso);
});

async function abrirConversa() {
  const hook = renderHook(() => useConversationMessages('conv-1'));
  await waitFor(() => expect(hook.result.current.messages).toHaveLength(50));
  return hook;
}

describe('useConversationMessages: carregar mensagens anteriores', () => {
  // Pré-condição, e passa hoje: é o ponto de partida dos testes abaixo.
  test('a conversa abre com as 50 mais novas e sabe que existe trecho anterior', async () => {
    const { result } = await abrirConversa();

    expect(result.current.messages[0].id).toBe('m071');
    expect(result.current.messages[49].id).toBe('m120');
    expect(result.current.temAnteriores).toBe(true);
    expect(api.getMessages).toHaveBeenCalledWith('conv-1', 'tok-123', { limit: 51 });
  });

  test('pede o trecho ANTES da mensagem mais antiga da tela (cursor before)', async () => {
    const { result } = await abrirConversa();

    await act(async () => {
      await result.current.carregarAnteriores();
    });

    expect(api.getMessages).toHaveBeenCalledTimes(2);
    expect(api.getMessages).toHaveBeenLastCalledWith('conv-1', 'tok-123', { limit: 51, before: 'm071' });
  });

  test('o trecho anterior entra antes do que já estava, até o começo da conversa', async () => {
    const { result } = await abrirConversa();

    await act(async () => {
      await result.current.carregarAnteriores();
    });
    expect(result.current.messages).toHaveLength(100);
    expect(result.current.messages[0].id).toBe('m021');
    expect(result.current.messages[99].id).toBe('m120');
    expect(result.current.temAnteriores).toBe(true);

    await act(async () => {
      await result.current.carregarAnteriores();
    });
    expect(result.current.messages).toHaveLength(120);
    expect(result.current.messages.map((m) => m.id)).toEqual(HISTORICO.map((m) => m.id));
    // A sonda não veio: acabou o histórico, o botão some.
    expect(result.current.temAnteriores).toBe(false);
    expect(result.current.carregandoAnteriores).toBe(false);
  });
});
