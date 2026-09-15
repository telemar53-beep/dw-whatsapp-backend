import { describe, test, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderInShell } from '../../../test-utils/renderInShell';
import WelcomePage from './WelcomePage';
import { useChannels } from '../../../hooks/useChannels';
import { useAuth } from '../../../contexts/AuthContext';

vi.mock('../../../hooks/useChannels');
vi.mock('../../../contexts/AuthContext');
vi.mock('../../../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok', agent: { role: 'admin' } });
});

describe('WelcomePage', () => {
  // Restaura o antigo popup "O que é isso: boas-vindas por canal" (SectionHelp) do
  // MessagesAdminTab como um Card sempre visível no topo da página — mesmo texto
  // e mesmo exemplo, sem precisar clicar em nada para revelá-los.
  test('shows the explanation and example for the welcome-message feature directly, without a popup', () => {
    useChannels.mockReturnValue({ channels: [], status: 'ready', refresh: vi.fn() });
    renderInShell(<WelcomePage />, { path: '/configuracoes/mensagens/boas-vindas' });

    expect(screen.getByText(/enviada automaticamente para o cliente assim que ele manda/i)).toBeInTheDocument();
    expect(screen.getByText(/Bem-vindo à nossa empresa/i)).toBeInTheDocument();
  });

  test('gerente sem a flag vê a boas-vindas mas não pode editar, com a explicação', () => {
    useAuth.mockReturnValue({ token: 'tok', agent: { role: 'manager', canManageIntegrations: false } });
    useChannels.mockReturnValue({ channels: [{ id: 'ch1', name: 'Berg', welcomeMessage: 'Olá!' }], status: 'ready', refresh: vi.fn() });
    renderInShell(<WelcomePage />, { path: '/configuracoes/mensagens/boas-vindas' });
    expect(screen.getByText('Olá!')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /editar/i })).not.toBeInTheDocument();
    expect(screen.getByText(/requer permissão de canais e integrações/i)).toBeInTheDocument();
  });

  test('em carregamento não some a seção nem mostra vazio', () => {
    useAuth.mockReturnValue({ token: 'tok', agent: { role: 'admin' } });
    useChannels.mockReturnValue({ channels: [], status: 'loading', refresh: vi.fn() });
    renderInShell(<WelcomePage />, { path: '/configuracoes/mensagens/boas-vindas' });
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
