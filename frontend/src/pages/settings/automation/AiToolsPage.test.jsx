import { describe, test, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderInShell } from '../../../test-utils/renderInShell';
import AiToolsPage from './AiToolsPage';
import { useAuth } from '../../../contexts/AuthContext';
import { useAiConfig } from '../../../hooks/useAiConfig';
import { useAiTools } from '../../../hooks/useAiTools';
import * as api from '../../../services/api';

vi.mock('../../../contexts/AuthContext');
vi.mock('../../../hooks/useAiConfig');
vi.mock('../../../hooks/useAiTools');
vi.mock('../../../services/api');

const PATH = '/configuracoes/automacao/ferramentas';

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 't', agent: { role: 'admin' } });
  useAiConfig.mockReturnValue({ config: { triageResolvedReasonId: null }, status: 'ready', loading: false, refresh: vi.fn() });
});

describe('AiToolsPage', () => {
  test('groups the tools by category', () => {
    useAiTools.mockReturnValue({
      tools: [
        { nome: 'consultar_plano', categoria: 'CONSULTA', descricao: 'd', enabled: true },
        { nome: 'gerar_pix', categoria: 'ACAO_SENSIVEL', descricao: 'd', enabled: false },
      ],
      status: 'ready',
      refresh: vi.fn(),
    });
    renderInShell(<AiToolsPage />, { path: PATH });
    expect(screen.getByText('Consulta')).toBeInTheDocument();
    expect(screen.getByText('Ação sensível')).toBeInTheDocument();
  });

  test('toggling a tool saves it', async () => {
    useAiTools.mockReturnValue({
      tools: [
        { nome: 'consultar_plano', categoria: 'CONSULTA', descricao: 'd', enabled: true },
        { nome: 'gerar_pix', categoria: 'ACAO_SENSIVEL', descricao: 'd', enabled: false },
      ],
      status: 'ready',
      refresh: vi.fn(),
    });
    api.setAiToolEnabled.mockResolvedValue({ toolName: 'gerar_pix', enabled: true });
    renderInShell(<AiToolsPage />, { path: PATH });

    const toggle = screen.getByRole('checkbox', { name: /gerar código pix/i });
    await userEvent.click(toggle);

    expect(api.setAiToolEnabled).toHaveBeenCalledWith('gerar_pix', true, 't');
  });

  test('mostra nome legível, descrição e identificador técnico', () => {
    useAiTools.mockReturnValue({
      tools: [{ nome: 'consultar_status_conexao', categoria: 'CONSULTA', descricao: 'Verifica em tempo real...', enabled: true }],
      status: 'ready',
      refresh: vi.fn(),
    });
    renderInShell(<AiToolsPage />, { path: PATH });
    expect(screen.getByRole('checkbox', { name: /consultar conexão de internet/i })).toBeChecked();
    expect(screen.getByText('consultar_status_conexao')).toBeInTheDocument();
    expect(screen.getByText(/verifica em tempo real/i)).toBeInTheDocument();
  });

  test('avisa quando encerrar sozinha está configurado mas a ferramenta está desligada', () => {
    useAiConfig.mockReturnValue({ config: { triageResolvedReasonId: 'r1' }, status: 'ready', loading: false, refresh: vi.fn() });
    useAiTools.mockReturnValue({
      tools: [{ nome: 'encerrar_atendimento', categoria: 'ACAO', descricao: '...', enabled: false }],
      status: 'ready',
      refresh: vi.fn(),
    });
    renderInShell(<AiToolsPage />, { path: PATH });
    expect(screen.getByText(/ferramenta encerrar atendimento sozinha está desligada/i)).toBeInTheDocument();
  });

  test('não avisa quando a ferramenta encerrar sozinha já está ligada', () => {
    useAiConfig.mockReturnValue({ config: { triageResolvedReasonId: 'r1' }, status: 'ready', loading: false, refresh: vi.fn() });
    useAiTools.mockReturnValue({
      tools: [{ nome: 'encerrar_atendimento', categoria: 'ACAO', descricao: '...', enabled: true }],
      status: 'ready',
      refresh: vi.fn(),
    });
    renderInShell(<AiToolsPage />, { path: PATH });
    expect(screen.queryByText(/está desligada/i)).not.toBeInTheDocument();
  });
});
