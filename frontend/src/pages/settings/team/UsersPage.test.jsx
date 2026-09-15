import { describe, test, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import UsersPage from './UsersPage';
import { renderInShell } from '../../../test-utils/renderInShell';
import { useAuth } from '../../../contexts/AuthContext';
import { useAgentsAdmin } from '../../../hooks/useAgentsAdmin';
import { useSectors } from '../../../hooks/useSectors';

vi.mock('../../../contexts/AuthContext');
vi.mock('../../../hooks/useAgentsAdmin');
vi.mock('../../../hooks/useSectors');
vi.mock('../../../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok', agent: { id: 'admin-1', role: 'admin' } });
  useSectors.mockReturnValue({ sectors: [], status: 'ready', refresh: vi.fn() });
});

describe('UsersPage', () => {
  test('em carregamento não mostra "nenhum usuário"', () => {
    useAgentsAdmin.mockReturnValue({ agents: [], status: 'loading', refresh: vi.fn() });
    renderInShell(<UsersPage />, { path: '/configuracoes/equipe/usuarios' });
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText(/nenhum usuário/i)).not.toBeInTheDocument();
  });
  test('a ação do cabeçalho abre o formulário de criação', async () => {
    useAgentsAdmin.mockReturnValue({ agents: [], status: 'ready', refresh: vi.fn() });
    renderInShell(<UsersPage />, { path: '/configuracoes/equipe/usuarios' });
    expect(screen.getByText('Nenhum usuário cadastrado ainda.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /criar usuário/i }));
    expect(screen.getByRole('heading', { name: /cadastrar novo/i })).toBeInTheDocument();
  });
});
