import { describe, test, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
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
  useTemplates.mockReturnValue({ templates: [], refresh: vi.fn() });
});

describe('TemplatesPage', () => {
  test('shows the Templates section with its own create button', () => {
    useChannels.mockReturnValue({ channels: [{ id: 'ch-1', type: 'meta_cloud', name: 'Oficial', wabaId: 'waba-1' }], loading: false, refresh: vi.fn() });
    renderInShell(<TemplatesPage />, { path: '/configuracoes/mensagens/templates' });

    expect(screen.getByText('Templates')).toBeInTheDocument();
    expect(screen.getByText(/cadastrar novo template/i)).toBeInTheDocument();
  });

  test('shows a warning when there is no official channel registered', () => {
    useChannels.mockReturnValue({ channels: [{ id: 'ch-1', type: 'baileys', name: 'Não oficial' }], loading: false, refresh: vi.fn() });
    renderInShell(<TemplatesPage />, { path: '/configuracoes/mensagens/templates' });

    expect(
      screen.getByText(/templates só existem em canais oficiais \(meta cloud ou 360dialog\)\. nenhum canal oficial cadastrado\./i)
    ).toBeInTheDocument();
  });
});
