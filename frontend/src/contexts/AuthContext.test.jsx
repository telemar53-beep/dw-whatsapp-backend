import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider, useAuth } from './AuthContext';
import * as api from '../services/api';

vi.mock('../services/api');

function TestConsumer() {
  const { token, agent, login, logout } = useAuth();
  return (
    <div>
      <span data-testid="token">{token || 'no-token'}</span>
      <span data-testid="role">{agent ? agent.role : 'no-agent'}</span>
      <button onClick={() => login('a@dw.com', 'secret123')}>Login</button>
      <button onClick={logout}>Logout</button>
    </div>
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe('AuthProvider', () => {
  test('starts with no token when localStorage is empty', () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );
    expect(screen.getByTestId('token')).toHaveTextContent('no-token');
    expect(screen.getByTestId('role')).toHaveTextContent('no-agent');
  });

  test('login stores the token and agent, and updates context', async () => {
    api.login.mockResolvedValue({ token: 'tok-123', agent: { id: 'a1', email: 'a@dw.com', role: 'admin' } });
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    await userEvent.click(screen.getByText('Login'));

    await waitFor(() => expect(screen.getByTestId('token')).toHaveTextContent('tok-123'));
    expect(screen.getByTestId('role')).toHaveTextContent('admin');
    expect(localStorage.getItem('dw_token')).toBe('tok-123');
    expect(JSON.parse(localStorage.getItem('dw_agent'))).toEqual({ id: 'a1', email: 'a@dw.com', role: 'admin' });
  });

  test('logout clears the token, agent, and localStorage', async () => {
    localStorage.setItem('dw_token', 'tok-123');
    localStorage.setItem('dw_agent', JSON.stringify({ id: 'a1', email: 'a@dw.com', role: 'agent' }));
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );
    expect(screen.getByTestId('token')).toHaveTextContent('tok-123');

    await userEvent.click(screen.getByText('Logout'));

    expect(screen.getByTestId('token')).toHaveTextContent('no-token');
    expect(localStorage.getItem('dw_token')).toBeNull();
    expect(localStorage.getItem('dw_agent')).toBeNull();
  });

  test('restores token and agent from localStorage on mount', () => {
    localStorage.setItem('dw_token', 'tok-existing');
    localStorage.setItem('dw_agent', JSON.stringify({ id: 'a2', email: 'b@dw.com', role: 'agent' }));
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );
    expect(screen.getByTestId('token')).toHaveTextContent('tok-existing');
    expect(screen.getByTestId('role')).toHaveTextContent('agent');
  });
});
