import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import NavRail, { iniciaisDaEmpresa } from './NavRail';
import { useCompanyName } from '../hooks/useCompanyName';
import { useAuth } from '../contexts/AuthContext';
import { useQueueNotificationSound } from '../hooks/useQueueNotificationSound';
import { useMyClosedConversations } from '../hooks/useMyClosedConversations';

vi.mock('../contexts/AuthContext');
vi.mock('../hooks/useQueueNotificationSound');
vi.mock('../hooks/useMyClosedConversations');
vi.mock('../hooks/useCompanyName');

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
  useCompanyName.mockReturnValue({ name: 'Net Fibra Ltda' });
});

// O logo era o texto fixo "DW": o sistema roda em mais de um provedor.
describe('iniciaisDaEmpresa', () => {
  test('pega a primeira letra de até duas palavras, em maiúsculas', () => {
    expect(iniciaisDaEmpresa('Net Fibra Ltda')).toBe('NF');
    expect(iniciaisDaEmpresa('provedor')).toBe('P');
  });

  // Nome que já começa por sigla ("DW Telecom") mantém a sigla: pela regra
  // crua das iniciais viraria "DT", que não é o logo de ninguém.
  test('nome que começa por sigla mantém a sigla', () => {
    expect(iniciaisDaEmpresa('DW Telecom')).toBe('DW');
    expect(iniciaisDaEmpresa('MG Fibra Ltda')).toBe('MG');
  });

  test('espaços sobrando não viram inicial vazia', () => {
    expect(iniciaisDaEmpresa('  Net   Fibra  ')).toBe('NF');
  });

  test('sem nome não há iniciais', () => {
    expect(iniciaisDaEmpresa('')).toBe('');
    expect(iniciaisDaEmpresa(null)).toBe('');
    expect(iniciaisDaEmpresa(undefined)).toBe('');
    expect(iniciaisDaEmpresa('   ')).toBe('');
  });
});

describe('NavRail', () => {
  test('o logo mostra as iniciais da empresa cadastrada', () => {
    renderRail();
    expect(screen.getByText('NF')).toBeInTheDocument();
  });

  test('sem empresa cadastrada, o logo não inventa iniciais', () => {
    useCompanyName.mockReturnValue({ name: '' });
    renderRail();
    expect(screen.queryByText('NF')).not.toBeInTheDocument();
    expect(screen.queryByText('DW')).not.toBeInTheDocument();
  });

  test('always shows Conversas and Relatório', () => {
    renderRail();
    expect(screen.getByLabelText('Conversas')).toBeInTheDocument();
    expect(screen.getByLabelText('Relatório')).toBeInTheDocument();
  });

  test('always shows Campanhas', () => {
    renderRail();
    expect(screen.getByLabelText('Campanhas')).toBeInTheDocument();
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

  test('shows the admin-only links for a manager', () => {
    useAuth.mockReturnValue({ agent: { id: 'manager-1', name: 'Marcia', role: 'manager' }, logout: vi.fn() });
    renderRail();
    expect(screen.getByLabelText('Dashboard de atendimento')).toBeInTheDocument();
    expect(screen.getByLabelText('Administração')).toBeInTheDocument();
  });

  test('hides Atendimentos encerrados for a manager (they use the Attendance Dashboard instead)', () => {
    useAuth.mockReturnValue({ agent: { id: 'manager-1', name: 'Marcia', role: 'manager' }, logout: vi.fn() });
    renderRail();
    expect(screen.queryByLabelText('Atendimentos encerrados')).not.toBeInTheDocument();
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

  test('calls onProfileClick when Meu perfil is clicked', async () => {
    const onProfileClick = vi.fn();
    renderRail({ onProfileClick });
    await userEvent.click(screen.getByLabelText('Meu perfil'));
    expect(onProfileClick).toHaveBeenCalled();
  });

  test('calls toggleMuted when the sound icon is clicked', async () => {
    const toggleMuted = vi.fn();
    useQueueNotificationSound.mockReturnValue({ muted: false, toggleMuted });
    renderRail();
    await userEvent.click(screen.getByLabelText('Som ativado'));
    expect(toggleMuted).toHaveBeenCalled();
  });

  test('shows "Som desativado" when muted is true', () => {
    useQueueNotificationSound.mockReturnValue({ muted: true, toggleMuted: vi.fn() });
    renderRail();
    expect(screen.getByLabelText('Som desativado')).toBeInTheDocument();
  });

  test('hides Atendimentos encerrados for an admin agent (they already see this via the Attendance Dashboard)', () => {
    useAuth.mockReturnValue({ agent: { id: 'admin-1', name: 'Ana', role: 'admin' }, logout: vi.fn() });
    renderRail();
    expect(screen.queryByLabelText('Atendimentos encerrados')).not.toBeInTheDocument();
  });

  test('shows Atendimentos encerrados for a regular agent', () => {
    renderRail();
    expect(screen.getByLabelText('Atendimentos encerrados')).toBeInTheDocument();
  });

  test('clicking Atendimentos encerrados opens a popup with the agent\'s closed conversations', async () => {
    useMyClosedConversations.mockReturnValue({
      items: [{ id: 'c-old', contactDisplayName: 'Ana Encerrada', status: 'closed', assignedAgentId: 'agent-1' }],
      hasMore: false,
      loading: false,
      loadMore: vi.fn(),
      refresh: vi.fn(),
    });
    renderRail();

    expect(screen.queryByText('Ana Encerrada')).not.toBeInTheDocument();

    await userEvent.click(screen.getByLabelText('Atendimentos encerrados'));

    expect(screen.getByText('Ana Encerrada')).toBeInTheDocument();
  });
});
