import { describe, test, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderInShell } from '../../../test-utils/renderInShell';
import SgpQueryPage from './SgpQueryPage';
import { useSgpQueryConfig } from '../../../hooks/useSgpQueryConfig';
import { useAuth } from '../../../contexts/AuthContext';

vi.mock('../../../hooks/useSgpQueryConfig');
vi.mock('../../../contexts/AuthContext');

const PATH = '/configuracoes/integracoes/sgp-consulta';

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123', agent: { role: 'admin' } });
});

describe('SgpQueryPage', () => {
  test('renderiza o cartão com o botão Salvar consulta ao SGP', async () => {
    useSgpQueryConfig.mockReturnValue({ config: { configured: false }, refresh: vi.fn() });
    renderInShell(<SgpQueryPage />, { path: PATH });

    await userEvent.click(screen.getByRole('button', { name: /criar integração/i }));

    expect(screen.getByRole('button', { name: /salvar consulta ao sgp/i })).toBeInTheDocument();
  });

  test('gerente sem a flag vê acesso negado', () => {
    useSgpQueryConfig.mockReturnValue({ config: { configured: false }, refresh: vi.fn() });
    useAuth.mockReturnValue({ token: 'tok', agent: { role: 'manager', canManageIntegrations: false } });
    renderInShell(<SgpQueryPage />, { path: PATH });

    expect(screen.getByRole('heading', { name: /sem acesso a consulta ao sgp/i })).toBeInTheDocument();
  });
});
