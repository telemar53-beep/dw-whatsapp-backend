import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { SocketProvider, useSocket } from './SocketContext';
import { useAuth } from './AuthContext';
import { io } from 'socket.io-client';

vi.mock('./AuthContext');
vi.mock('socket.io-client');

function TestConsumer() {
  const socket = useSocket();
  return <span data-testid="socket">{socket ? 'connected' : 'no-socket'}</span>;
}

let fakeSocket;

beforeEach(() => {
  vi.clearAllMocks();
  fakeSocket = { on: vi.fn(), off: vi.fn(), close: vi.fn() };
  io.mockReturnValue(fakeSocket);
});

describe('SocketProvider', () => {
  test('does not connect when there is no token', () => {
    useAuth.mockReturnValue({ token: null, logout: vi.fn() });
    render(
      <SocketProvider>
        <TestConsumer />
      </SocketProvider>
    );
    expect(io).not.toHaveBeenCalled();
    expect(screen.getByTestId('socket')).toHaveTextContent('no-socket');
  });

  test('connects with the token in auth options when a token is present', async () => {
    useAuth.mockReturnValue({ token: 'tok-123', logout: vi.fn() });
    render(
      <SocketProvider>
        <TestConsumer />
      </SocketProvider>
    );
    await waitFor(() => expect(screen.getByTestId('socket')).toHaveTextContent('connected'));
    expect(io).toHaveBeenCalledWith('http://localhost:3000', { auth: { token: 'tok-123' } });
  });

  test('logs out when the socket reports a connect_error', () => {
    const logout = vi.fn();
    useAuth.mockReturnValue({ token: 'tok-123', logout });
    render(
      <SocketProvider>
        <TestConsumer />
      </SocketProvider>
    );
    const errorHandler = fakeSocket.on.mock.calls.find(([event]) => event === 'connect_error')[1];
    errorHandler(new Error('Unauthorized'));
    expect(logout).toHaveBeenCalled();
  });

  test('closes the socket when the token becomes null', () => {
    const { rerender } = render(<div />);
    useAuth.mockReturnValue({ token: 'tok-123', logout: vi.fn() });
    rerender(
      <SocketProvider>
        <TestConsumer />
      </SocketProvider>
    );
    useAuth.mockReturnValue({ token: null, logout: vi.fn() });
    rerender(
      <SocketProvider>
        <TestConsumer />
      </SocketProvider>
    );
    expect(fakeSocket.close).toHaveBeenCalled();
  });
});
