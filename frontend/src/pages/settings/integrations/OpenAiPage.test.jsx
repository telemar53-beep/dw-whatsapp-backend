import { describe, test, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderInShell } from '../../../test-utils/renderInShell';
import OpenAiPage from './OpenAiPage';
import { useAiConfig } from '../../../hooks/useAiConfig';
import { useAuth } from '../../../contexts/AuthContext';

vi.mock('../../../hooks/useAiConfig');
vi.mock('../../../contexts/AuthContext');

const PATH = '/configuracoes/integracoes/openai';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('OpenAiPage', () => {
  test('mostra o cartão da OpenAI e os atalhos para quem usa a conexão', () => {
    useAuth.mockReturnValue({ token: 'tok', agent: { role: 'admin' } });
    useAiConfig.mockReturnValue({ config: { configured: true, mode: 'assistant', model: 'gpt' }, status: 'ready', loading: false, refresh: vi.fn() });
    renderInShell(<OpenAiPage />, { path: PATH });
    expect(screen.getByRole('heading', { name: /conexão e modelo/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /salvar openai/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /atendimento e triagem com ia/i })).toHaveAttribute('href', '/configuracoes/automacao/ia');
  });

  test('gerente sem a flag vê acesso negado', () => {
    useAuth.mockReturnValue({ token: 'tok', agent: { role: 'manager', canManageIntegrations: false } });
    useAiConfig.mockReturnValue({ config: { configured: false, mode: 'disabled', model: '' }, status: 'ready', loading: false, refresh: vi.fn() });
    renderInShell(<OpenAiPage />, { path: PATH });
    expect(screen.getByRole('heading', { name: /sem acesso a openai/i })).toBeInTheDocument();
  });
});
