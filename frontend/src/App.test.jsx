import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import * as api from './services/api';
import { io } from 'socket.io-client';

vi.mock('./services/api');
vi.mock('socket.io-client');

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  io.mockReturnValue({ on: vi.fn(), off: vi.fn(), close: vi.fn() });
});

describe('App', () => {
  test('redirects an unauthenticated visitor to the login page', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: /entrar/i })).toBeInTheDocument();
  });

  test('logs in and reaches the dashboard', async () => {
    api.login.mockResolvedValue({ token: 'tok-123', agent: { id: 'agent-1', email: 'a@dw.com', role: 'agent' } });
    api.getQueue.mockResolvedValue([]);
    api.getMyConversations.mockResolvedValue([]);
    api.listChannels.mockResolvedValue([]);

    render(<App />);

    await userEvent.type(screen.getByLabelText(/email/i), 'a@dw.com');
    await userEvent.type(screen.getByLabelText(/senha/i), 'secret123');
    await userEvent.click(screen.getByRole('button', { name: /entrar/i }));

    expect(await screen.findByText(/DW Telecom - Atendimento/)).toBeInTheDocument();
  });

  test('an already-authenticated non-admin visiting /admin/channels is redirected to the dashboard', async () => {
    localStorage.setItem('dw_token', 'tok-123');
    localStorage.setItem('dw_agent', JSON.stringify({ id: 'agent-1', email: 'a@dw.com', role: 'agent' }));
    window.history.pushState({}, '', '/admin/channels');
    api.getQueue.mockResolvedValue([]);
    api.getMyConversations.mockResolvedValue([]);
    api.listChannels.mockResolvedValue([]);

    render(<App />);

    await waitFor(() => expect(screen.getByText(/DW Telecom - Atendimento/)).toBeInTheDocument());
    expect(screen.queryByText(/Administração de Canais/)).not.toBeInTheDocument();
  });

  test('an authenticated non-admin can reach /metrics', async () => {
    localStorage.setItem('dw_token', 'tok-123');
    localStorage.setItem('dw_agent', JSON.stringify({ id: 'agent-1', email: 'a@dw.com', role: 'agent' }));
    window.history.pushState({}, '', '/metrics');
    api.getQueue.mockResolvedValue([]);
    api.getMyConversations.mockResolvedValue([]);
    api.listChannels.mockResolvedValue([]);
    api.getMetrics.mockResolvedValue({
      period: 'today',
      scope: 'agent',
      own: { closedCount: 0, avgResolutionMinutes: null, avgFirstResponseMinutes: null },
    });

    render(<App />);

    expect(await screen.findByRole('heading', { name: /métricas/i })).toBeInTheDocument();
  });
});
