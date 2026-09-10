import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import NavRail from './NavRail';
import { useAuth } from '../contexts/AuthContext';
import { useQueueNotificationSound } from '../hooks/useQueueNotificationSound';

vi.mock('../contexts/AuthContext');
vi.mock('../hooks/useQueueNotificationSound');

function renderRail(props = {}) {
  return render(
    <MemoryRouter>
      <NavRail {...props} />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ agent: { id: 'agent-1', name: 'Ana', role: 'agent' }, logout: vi.fn() });
  useQueueNotificationSound.mockReturnValue({ muted: false, toggleMuted: vi.fn() });
});

describe('NavRail', () => {
  test('always shows Conversas and Relatório', () => {
    renderRail();
    expect(screen.getByLabelText('Conversas')).toBeInTheDocument();
    expect(screen.getByLabelText('Relatório')).toBeInTheDocument();
  });

  test('shows the admin-only links for an admin agent', () => {
    useAuth.mockReturnValue({ agent: { id: 'admin-1', name: 'Ana', role: 'admin' }, logout: vi.fn() });
    renderRail();
    expect(screen.getByLabelText('Dashboard de atendimento')).toBeInTheDocument();
    expect(screen.getByLabelText('Administração')).toBeInTheDocument();
  });

  test('hides the admin-only links for a regular agent', () => {
    renderRail();
    expect(screen.queryByLabelText('Dashboard de atendimento')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Administração')).not.toBeInTheDocument();
  });

  test('renders Conversas as a link to / when no onConversasClick is given', () => {
    renderRail();
    expect(screen.getByLabelText('Conversas')).toHaveAttribute('href', '/');
  });

  test('renders Conversas as a button and calls onConversasClick when given', async () => {
    const onConversasClick = vi.fn();
    renderRail({ onConversasClick });
    const conversasControl = screen.getByLabelText('Conversas');
    expect(conversasControl).not.toHaveAttribute('href');
    await userEvent.click(conversasControl);
    expect(onConversasClick).toHaveBeenCalled();
  });

  test('calls logout when Sair is clicked', async () => {
    const logout = vi.fn();
    useAuth.mockReturnValue({ agent: { id: 'agent-1', name: 'Ana', role: 'agent' }, logout });
    renderRail();
    await userEvent.click(screen.getByLabelText('Sair'));
    expect(logout).toHaveBeenCalled();
  });

  test('calls onChangePasswordClick when Trocar senha is clicked', async () => {
    const onChangePasswordClick = vi.fn();
    renderRail({ onChangePasswordClick });
    await userEvent.click(screen.getByLabelText('Trocar senha'));
    expect(onChangePasswordClick).toHaveBeenCalled();
  });

  test('calls toggleMuted when the sound icon is clicked', async () => {
    const toggleMuted = vi.fn();
    useQueueNotificationSound.mockReturnValue({ muted: false, toggleMuted });
    renderRail();
    await userEvent.click(screen.getByLabelText('Som ativado'));
    expect(toggleMuted).toHaveBeenCalled();
  });

  test('shows "Som mutado" when muted is true', () => {
    useQueueNotificationSound.mockReturnValue({ muted: true, toggleMuted: vi.fn() });
    renderRail();
    expect(screen.getByLabelText('Som mutado')).toBeInTheDocument();
  });
});
