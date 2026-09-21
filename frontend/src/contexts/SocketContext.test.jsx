import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { SocketProvider, useSocket, useSocketConnection } from './SocketContext';
import { useAuth } from './AuthContext';
import { io } from 'socket.io-client';

vi.mock('./AuthContext');
vi.mock('socket.io-client');

function TestConsumer() {
  const socket = useSocket();
  const connection = useSocketConnection();
  return (
    <>
      <span data-testid="socket">{socket ? 'connected' : 'no-socket'}</span>
      <span data-testid="estado">{connection}</span>
    </>
  );
}

let fakeSocket;

// `active` é declarado SEMPRE e de propósito: ele é a condição que decide
// logout. Um dublê sem essa propriedade faria `!undefined` valer true e o
// teste passaria por acidente, afirmando a regra errada.
function criarSocket({ active }) {
  return { on: vi.fn(), off: vi.fn(), close: vi.fn(), active };
}

function handlerDe(evento) {
  const chamada = fakeSocket.on.mock.calls.find(([nome]) => nome === evento);
  if (!chamada) throw new Error(`o provider não registrou handler para "${evento}"`);
  return chamada[1];
}

function renderProvider() {
  return render(
    <SocketProvider>
      <TestConsumer />
    </SocketProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  fakeSocket = criarSocket({ active: true });
  io.mockReturnValue(fakeSocket);
});

describe('SocketProvider', () => {
  test('does not connect when there is no token', () => {
    useAuth.mockReturnValue({ token: null, logout: vi.fn() });
    renderProvider();
    expect(io).not.toHaveBeenCalled();
    expect(screen.getByTestId('socket')).toHaveTextContent('no-socket');
  });

  test('connects with the token in auth options when a token is present', async () => {
    useAuth.mockReturnValue({ token: 'tok-123', logout: vi.fn() });
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('socket')).toHaveTextContent('connected'));
    expect(io).toHaveBeenCalledWith('http://localhost:3000', { auth: { token: 'tok-123' } });
  });

  test('closes the socket when the token becomes null', () => {
    const { rerender } = render(<div />);
    useAuth.mockReturnValue({ token: 'tok-123', logout: vi.fn() });
    rerender(<SocketProvider><TestConsumer /></SocketProvider>);
    useAuth.mockReturnValue({ token: null, logout: vi.fn() });
    rerender(<SocketProvider><TestConsumer /></SocketProvider>);
    expect(fakeSocket.close).toHaveBeenCalled();
  });
});

// Substitui o antigo "logs out when the socket reports a connect_error", que
// deslogava em qualquer erro: um restart de backend derrubava a sessão em
// ~1,2s. A regra agora é a do protocolo.
describe('erro fatal x erro recuperável na conexão', () => {
  test('connect_error com active false é recusa da credencial: desloga', () => {
    const logout = vi.fn();
    useAuth.mockReturnValue({ token: 'tok-invalido', logout });
    fakeSocket = criarSocket({ active: false });
    io.mockReturnValue(fakeSocket);
    renderProvider();

    act(() => { handlerDe('connect_error')(new Error('Unauthorized')); });

    expect(logout).toHaveBeenCalledTimes(1);
  });

  test('connect_error com active true é falha de transporte: mantém a sessão', () => {
    const logout = vi.fn();
    useAuth.mockReturnValue({ token: 'tok-123', logout });
    renderProvider();

    act(() => { handlerDe('connect_error')(new Error('xhr poll error')); });

    expect(logout).not.toHaveBeenCalled();
    expect(screen.getByTestId('estado')).toHaveTextContent('reconnecting');
  });

  test('o mesmo texto de erro não muda a decisão: só active decide', () => {
    const logout = vi.fn();
    useAuth.mockReturnValue({ token: 'tok-123', logout });
    renderProvider();

    // Mensagem idêntica à da recusa do middleware, mas socket ainda ativo.
    act(() => { handlerDe('connect_error')(new Error('Unauthorized')); });

    expect(logout).not.toHaveBeenCalled();
    expect(screen.getByTestId('estado')).toHaveTextContent('reconnecting');
  });

  test('depois de um erro recuperável, reconectar volta o estado para connected', () => {
    const logout = vi.fn();
    useAuth.mockReturnValue({ token: 'tok-123', logout });
    renderProvider();

    act(() => { handlerDe('connect_error')(new Error('xhr poll error')); });
    expect(screen.getByTestId('estado')).toHaveTextContent('reconnecting');

    act(() => { handlerDe('connect')(); });

    expect(screen.getByTestId('estado')).toHaveTextContent('connected');
    expect(logout).not.toHaveBeenCalled();
  });

  test('disconnect de transporte vira aviso de reconexão', () => {
    useAuth.mockReturnValue({ token: 'tok-123', logout: vi.fn() });
    renderProvider();

    act(() => { handlerDe('disconnect')('transport close'); });

    expect(screen.getByTestId('estado')).toHaveTextContent('reconnecting');
  });

  test('saída iniciada pelo próprio cliente não vira falso aviso', () => {
    useAuth.mockReturnValue({ token: 'tok-123', logout: vi.fn() });
    renderProvider();

    act(() => { handlerDe('disconnect')('io client disconnect'); });

    expect(screen.getByTestId('estado')).not.toHaveTextContent('reconnecting');
    expect(screen.getByTestId('estado')).toHaveTextContent('idle');
  });
});
