import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useAiSuggestion } from './useAiSuggestion';
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

describe('useAiSuggestion', () => {
  test('fetches any pending suggestion on mount', async () => {
    api.getAiSuggestion.mockResolvedValue({ suggestion: { id: 's-1', content: 'Seu plano é 600MB.' } });
    const { result } = renderHook(() => useAiSuggestion('conv-1'));

    await waitFor(() => expect(result.current.suggestion).toEqual({ id: 's-1', content: 'Seu plano é 600MB.' }));
    expect(api.getAiSuggestion).toHaveBeenCalledWith('conv-1', 'tok-123');
  });

  test('starts with no suggestion when the backend has none pending', async () => {
    api.getAiSuggestion.mockResolvedValue({ suggestion: null });
    const { result } = renderHook(() => useAiSuggestion('conv-1'));

    await waitFor(() => expect(api.getAiSuggestion).toHaveBeenCalled());
    expect(result.current.suggestion).toBeNull();
  });

  test('ai:suggestion for this conversation updates the suggestion', async () => {
    api.getAiSuggestion.mockResolvedValue({ suggestion: null });
    const { result } = renderHook(() => useAiSuggestion('conv-1'));
    await waitFor(() => expect(api.getAiSuggestion).toHaveBeenCalled());

    act(() => {
      fakeSocket.trigger('ai:suggestion', {
        conversationId: 'conv-1',
        suggestion: { id: 's-2', content: 'Resposta sugerida' },
      });
    });

    expect(result.current.suggestion).toEqual({ id: 's-2', content: 'Resposta sugerida' });
  });

  test('ai:suggestion for a different conversation is ignored', async () => {
    api.getAiSuggestion.mockResolvedValue({ suggestion: null });
    const { result } = renderHook(() => useAiSuggestion('conv-1'));
    await waitFor(() => expect(api.getAiSuggestion).toHaveBeenCalled());

    act(() => {
      fakeSocket.trigger('ai:suggestion', {
        conversationId: 'conv-OTHER',
        suggestion: { id: 's-3', content: 'Não é desta conversa' },
      });
    });

    expect(result.current.suggestion).toBeNull();
  });

  test('send calls the API with the suggestion id and clears the suggestion immediately', async () => {
    api.getAiSuggestion.mockResolvedValue({ suggestion: { id: 's-1', content: 'Seu plano é 600MB.' } });
    api.sendAiSuggestion.mockResolvedValue({});
    const { result } = renderHook(() => useAiSuggestion('conv-1'));
    await waitFor(() => expect(result.current.suggestion).not.toBeNull());

    await act(async () => {
      await result.current.send({ id: 's-1', content: 'Seu plano é 600MB.' });
    });

    expect(api.sendAiSuggestion).toHaveBeenCalledWith('conv-1', 's-1', undefined, 'tok-123');
    expect(result.current.suggestion).toBeNull();
  });

  test('discard calls the API with the suggestion id and clears the suggestion immediately', async () => {
    api.getAiSuggestion.mockResolvedValue({ suggestion: { id: 's-1', content: 'Seu plano é 600MB.' } });
    api.discardAiSuggestion.mockResolvedValue({});
    const { result } = renderHook(() => useAiSuggestion('conv-1'));
    await waitFor(() => expect(result.current.suggestion).not.toBeNull());

    await act(async () => {
      await result.current.discard({ id: 's-1', content: 'Seu plano é 600MB.' });
    });

    expect(api.discardAiSuggestion).toHaveBeenCalledWith('conv-1', 's-1', 'tok-123');
    expect(result.current.suggestion).toBeNull();
  });

  test('edit returns the suggested text, clears the suggestion, and never touches the API', async () => {
    api.getAiSuggestion.mockResolvedValue({ suggestion: { id: 's-1', content: 'Linha 1\nLinha 2' } });
    const { result } = renderHook(() => useAiSuggestion('conv-1'));
    await waitFor(() => expect(result.current.suggestion).not.toBeNull());

    let returned;
    act(() => {
      returned = result.current.edit({ id: 's-1', content: 'Linha 1\nLinha 2' });
    });

    expect(returned).toBe('Linha 1\nLinha 2');
    expect(result.current.suggestion).toBeNull();
    expect(api.sendAiSuggestion).not.toHaveBeenCalled();
    expect(api.discardAiSuggestion).not.toHaveBeenCalled();
  });

  test('fetches again and can show a suggestion after a remount, as if the page had been refreshed', async () => {
    api.getAiSuggestion.mockResolvedValue({ suggestion: { id: 's-9', content: 'Ainda pendente' } });
    const { result, unmount } = renderHook(() => useAiSuggestion('conv-1'));
    await waitFor(() => expect(result.current.suggestion).not.toBeNull());
    unmount();

    const { result: secondResult } = renderHook(() => useAiSuggestion('conv-1'));

    await waitFor(() => expect(secondResult.current.suggestion).toEqual({ id: 's-9', content: 'Ainda pendente' }));
  });
});
