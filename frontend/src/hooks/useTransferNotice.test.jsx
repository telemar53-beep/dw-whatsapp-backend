import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTransferNotice } from './useTransferNotice';
import { useSocket } from '../contexts/SocketContext';

vi.mock('../contexts/SocketContext');

function createFakeSocket() {
  const handlers = {};
  return {
    on: vi.fn((event, cb) => {
      handlers[event] = cb;
    }),
    off: vi.fn((event) => {
      delete handlers[event];
    }),
    trigger: (event, payload) => handlers[event] && handlers[event](payload),
  };
}

class FakeOscillator {
  constructor() {
    this.frequency = { value: 0 };
    this.connect = vi.fn();
    this.start = vi.fn();
    this.stop = vi.fn();
  }
}

class FakeGain {
  constructor() {
    this.gain = { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() };
    this.connect = vi.fn();
  }
}

class FakeAudioContext {
  constructor() {
    FakeAudioContext.instances.push(this);
    this.currentTime = 0;
    this.destination = {};
  }
  createOscillator() {
    return new FakeOscillator();
  }
  createGain() {
    return new FakeGain();
  }
}
FakeAudioContext.instances = [];

const TRANSFERIDA = {
  conversation: { id: 'conv-1', contactDisplayName: 'Carlos', contactPhoneNumber: '+5511999998888' },
  transferredBy: { id: 'agent-1', name: 'Maria Souza' },
};

let fakeSocket;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  FakeAudioContext.instances = [];
  window.AudioContext = FakeAudioContext;
  fakeSocket = createFakeSocket();
  useSocket.mockReturnValue(fakeSocket);
});

describe('useTransferNotice', () => {
  test('comeca sem aviso nenhum', () => {
    const { result } = renderHook(() => useTransferNotice());
    expect(result.current.notice).toBeNull();
  });

  test('avisa quem transferiu e de qual cliente e o atendimento', () => {
    const { result } = renderHook(() => useTransferNotice());

    act(() => fakeSocket.trigger('conversation:assigned', TRANSFERIDA));

    expect(result.current.notice).toEqual({
      conversationId: 'conv-1',
      contactName: 'Carlos',
      byName: 'Maria Souza',
    });
  });

  test('toca o sino quando a transferencia chega', () => {
    renderHook(() => useTransferNotice());

    act(() => fakeSocket.trigger('conversation:assigned', TRANSFERIDA));

    expect(FakeAudioContext.instances.length).toBe(1);
  });

  // O mesmo evento chega quando o proprio atendente pega uma conversa da fila.
  // Sem `transferredBy` nao houve transferencia: nada de sino nem de aviso.
  test('ignora o evento de assumir uma conversa da fila', () => {
    const { result } = renderHook(() => useTransferNotice());

    act(() => fakeSocket.trigger('conversation:assigned', { conversation: { id: 'conv-9' } }));

    expect(result.current.notice).toBeNull();
    expect(FakeAudioContext.instances.length).toBe(0);
  });

  test('transferencia com transferredBy null ainda avisa, sem nome (ATD-AVT-07)', () => {
    const { result } = renderHook(() => useTransferNotice());
    act(() => fakeSocket.trigger('conversation:assigned', { conversation: { id: 'conv-3', contactDisplayName: 'Maria' }, transferredBy: null }));
    expect(result.current.notice).toEqual({ conversationId: 'conv-3', contactName: 'Maria', byName: null });
  });

  test('usa o telefone quando o contato nao tem nome salvo', () => {
    const { result } = renderHook(() => useTransferNotice());

    act(() =>
      fakeSocket.trigger('conversation:assigned', {
        conversation: { id: 'conv-2', contactDisplayName: null, contactPhoneNumber: '+5511999998888' },
        transferredBy: { id: 'agent-1', name: 'Maria Souza' },
      })
    );

    expect(result.current.notice.contactName).toBe('+5511999998888');
  });

  // Silenciar e sobre barulho, nao sobre esconder informacao: o aviso na tela
  // continua aparecendo.
  test('silenciado nao toca o sino, mas ainda mostra o aviso', () => {
    localStorage.setItem('dw_queue_notification_muted', 'true');
    const { result } = renderHook(() => useTransferNotice());

    act(() => fakeSocket.trigger('conversation:assigned', TRANSFERIDA));

    expect(FakeAudioContext.instances.length).toBe(0);
    expect(result.current.notice).not.toBeNull();
  });

  test('dispensar limpa o aviso', () => {
    const { result } = renderHook(() => useTransferNotice());
    act(() => fakeSocket.trigger('conversation:assigned', TRANSFERIDA));

    act(() => result.current.dismiss());

    expect(result.current.notice).toBeNull();
  });

  test('uma transferencia nova substitui o aviso anterior', () => {
    const { result } = renderHook(() => useTransferNotice());
    act(() => fakeSocket.trigger('conversation:assigned', TRANSFERIDA));

    act(() =>
      fakeSocket.trigger('conversation:assigned', {
        conversation: { id: 'conv-3', contactDisplayName: 'Ana' },
        transferredBy: { id: 'agent-3', name: 'Berg' },
      })
    );

    expect(result.current.notice.conversationId).toBe('conv-3');
    expect(result.current.notice.byName).toBe('Berg');
  });

  test('para de escutar quando a tela e desmontada', () => {
    const { unmount } = renderHook(() => useTransferNotice());
    unmount();
    expect(fakeSocket.off).toHaveBeenCalledWith('conversation:assigned', expect.any(Function));
  });
});
