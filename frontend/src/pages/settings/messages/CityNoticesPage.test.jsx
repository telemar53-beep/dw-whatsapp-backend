import { describe, test, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderInShell } from '../../../test-utils/renderInShell';
import CityNoticesPage from './CityNoticesPage';
import { useCityNotices } from '../../../hooks/useCityNotices';
import { useAuth } from '../../../contexts/AuthContext';

vi.mock('../../../hooks/useCityNotices');
vi.mock('../../../contexts/AuthContext');
vi.mock('../../../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok', agent: { role: 'admin' } });
});

describe('CityNoticesPage', () => {
  test('mostra a explicação curta e revela o exemplo sob demanda', async () => {
    useCityNotices.mockReturnValue({ cityNotices: [], status: 'ready', refresh: vi.fn() });
    renderInShell(<CityNoticesPage />, { path: '/configuracoes/mensagens/avisos-cidade' });

    expect(screen.getByText(/aviso aos clientes de uma cidade/i)).toBeInTheDocument();
    await userEvent.click(screen.getByText('Ver exemplo'));
    expect(screen.getByText(/nossa rede está passando por uma instabilidade/i)).toBeInTheDocument();
  });

  test('shows a message inviting the admin to register cities when none exist yet, linking to Cadastros › Cidades', () => {
    useCityNotices.mockReturnValue({ cityNotices: [], status: 'ready', refresh: vi.fn() });
    renderInShell(<CityNoticesPage />, { path: '/configuracoes/mensagens/avisos-cidade' });

    expect(screen.getByText(/nenhuma cidade cadastrada ainda/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Cidades' })).toHaveAttribute('href', '/configuracoes/cadastros/cidades');
  });
});
