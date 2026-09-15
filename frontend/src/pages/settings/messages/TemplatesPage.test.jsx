import { describe, test, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderInShell } from '../../../test-utils/renderInShell';
import TemplatesPage from './TemplatesPage';
import { useChannels } from '../../../hooks/useChannels';
import { useTemplates } from '../../../hooks/useTemplates';
import { useAuth } from '../../../contexts/AuthContext';

vi.mock('../../../hooks/useChannels');
vi.mock('../../../hooks/useTemplates');
vi.mock('../../../contexts/AuthContext');
vi.mock('../../../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123', agent: { role: 'admin' } });
  useTemplates.mockReturnValue({ templates: [], status: 'ready', refresh: vi.fn() });
});

describe('TemplatesPage', () => {
  // Restaura o antigo popup "O que é isso: templates" (SectionHelp) do
  // MessagesAdminTab como um Card sempre visível no topo da página — mesmo
  // texto, sem precisar clicar em nada para revelá-lo.
  test('shows the explanation for the templates feature directly, without a popup', () => {
    useChannels.mockReturnValue({ channels: [{ id: 'ch-1', type: 'meta_cloud', name: 'Oficial', wabaId: 'waba-1' }], status: 'ready', refresh: vi.fn() });
    renderInShell(<TemplatesPage />, { path: '/configuracoes/mensagens/templates' });

    expect(screen.getByText(/templates são mensagens pré-aprovadas pela meta/i)).toBeInTheDocument();
  });

  test('shows the Templates section with its own create button', () => {
    useChannels.mockReturnValue({ channels: [{ id: 'ch-1', type: 'meta_cloud', name: 'Oficial', wabaId: 'waba-1' }], status: 'ready', refresh: vi.fn() });
    renderInShell(<TemplatesPage />, { path: '/configuracoes/mensagens/templates' });

    expect(screen.getByText('Templates')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cadastrar template/i })).toBeInTheDocument();
  });

  // O botão de criar agora fica no cabeçalho da página (como nas outras telas
  // de Configurações), controlando o formulário dentro de TemplatesAdminTab
  // em vez do botão interno "Cadastrar novo template".
  test('clicking the header action opens the create-template form', async () => {
    useChannels.mockReturnValue({ channels: [{ id: 'ch-1', type: 'meta_cloud', name: 'Oficial', wabaId: 'waba-1' }], status: 'ready', refresh: vi.fn() });
    renderInShell(<TemplatesPage />, { path: '/configuracoes/mensagens/templates' });

    expect(screen.queryByRole('form', { name: /cadastrar novo template/i })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /cadastrar template/i }));

    expect(screen.getByRole('form', { name: /cadastrar novo template/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /cadastrar template/i })).not.toBeInTheDocument();
  });

  test('shows a warning when there is no official channel registered', () => {
    useChannels.mockReturnValue({ channels: [{ id: 'ch-1', type: 'baileys', name: 'Não oficial' }], status: 'ready', refresh: vi.fn() });
    renderInShell(<TemplatesPage />, { path: '/configuracoes/mensagens/templates' });

    expect(
      screen.getByText(/templates só existem em canais oficiais \(meta cloud ou 360dialog\)\. nenhum canal oficial cadastrado\./i)
    ).toBeInTheDocument();
  });
});
