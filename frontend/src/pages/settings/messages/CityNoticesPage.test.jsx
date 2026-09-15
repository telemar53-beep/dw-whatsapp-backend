import { describe, test, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
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
  // Restaura o antigo popup "O que é isso: avisos por cidade" (SectionHelp) do
  // MessagesAdminTab como um Card sempre visível no topo da página — mesmo texto
  // e mesmo exemplo, sem precisar clicar em nada para revelá-los.
  test('shows the explanation and example for the city-notice feature directly, without a popup', () => {
    useCityNotices.mockReturnValue({ cityNotices: [], status: 'ready', refresh: vi.fn() });
    renderInShell(<CityNoticesPage />, { path: '/configuracoes/mensagens/avisos-cidade' });

    expect(screen.getByText(/enviado automaticamente para clientes daquela cidade/i)).toBeInTheDocument();
    expect(screen.getByText(/nossa rede está passando por uma instabilidade/i)).toBeInTheDocument();
  });

  test('shows a message inviting the admin to register cities when none exist yet, linking to Cadastros › Cidades', () => {
    useCityNotices.mockReturnValue({ cityNotices: [], status: 'ready', refresh: vi.fn() });
    renderInShell(<CityNoticesPage />, { path: '/configuracoes/mensagens/avisos-cidade' });

    expect(screen.getByText(/nenhuma cidade cadastrada ainda/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /cadastros › cidades/i })).toHaveAttribute('href', '/configuracoes/cadastros/cidades');
  });
});
