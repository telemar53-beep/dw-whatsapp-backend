import { describe, test, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderInShell } from '../../../test-utils/renderInShell';
import AssignmentPage from './AssignmentPage';
import { useAssignmentMessageConfig } from '../../../hooks/useAssignmentMessageConfig';
import { useAgentsAdmin } from '../../../hooks/useAgentsAdmin';
import { useChannels } from '../../../hooks/useChannels';
import { useAuth } from '../../../contexts/AuthContext';
import * as api from '../../../services/api';

vi.mock('../../../hooks/useAssignmentMessageConfig');
vi.mock('../../../hooks/useAgentsAdmin');
vi.mock('../../../hooks/useChannels');
vi.mock('../../../contexts/AuthContext');
vi.mock('../../../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123', agent: { role: 'admin' } });
  useChannels.mockReturnValue({ channels: [], loading: false, refresh: vi.fn() });
  useAgentsAdmin.mockReturnValue({
    agents: [
      { id: 'agent-1', name: 'Geovanna Silva', email: 'geovanna@dw.com' },
      { id: 'agent-2', name: 'Carlos Souza', email: 'carlos@dw.com' },
    ],
    loading: false,
    refresh: vi.fn(),
  });
});

describe('AssignmentPage', () => {
  test('mostra a explicação curta da mensagem automática', () => {
    useAssignmentMessageConfig.mockReturnValue({
      config: { id: null, enabled: false, openingMessage: '', closingMessage: '', agentIds: [], channelIds: [] }, status: 'ready',
      loading: false,
      refresh: vi.fn(),
    });
    renderInShell(<AssignmentPage />, { path: '/configuracoes/regras/atribuicao' });

    expect(screen.getByText(/mensagens enviadas ao assumir e ao encerrar/i)).toBeInTheDocument();
  });

  test('mostra o botão de configurar mensagens quando não há configuração', () => {
    useAssignmentMessageConfig.mockReturnValue({
      config: { id: null, enabled: false, openingMessage: '', closingMessage: '', agentIds: [], channelIds: [] }, status: 'ready',
      loading: false,
      refresh: vi.fn(),
    });
    renderInShell(<AssignmentPage />, { path: '/configuracoes/regras/atribuicao' });
    expect(screen.getByRole('button', { name: 'Configurar mensagens' })).toBeInTheDocument();
  });

  test('fills the form, saves and shows the closed summary', async () => {
    const refresh = vi.fn();
    useAssignmentMessageConfig.mockReturnValue({
      config: { id: null, enabled: false, openingMessage: '', closingMessage: '', agentIds: [], channelIds: [] }, status: 'ready',
      loading: false,
      refresh,
    });
    api.updateAssignmentMessageConfig.mockResolvedValue({
      id: 'config-1',
      enabled: false,
      openingMessage: 'Olá @chat_atendente',
      closingMessage: 'Tchau @chat_protocolo',
      agentIds: ['agent-1'],
      channelIds: [],
    });
    renderInShell(<AssignmentPage />, { path: '/configuracoes/regras/atribuicao' });

    await userEvent.click(screen.getByRole('button', { name: 'Configurar mensagens' }));
    await userEvent.type(screen.getByLabelText(/mensagem de abertura/i), 'Olá @chat_atendente');
    await userEvent.type(screen.getByLabelText(/mensagem de encerramento/i), 'Tchau @chat_protocolo');
    await userEvent.click(screen.getByLabelText('Geovanna Silva'));
    await userEvent.click(screen.getByRole('button', { name: /^salvar$/i }));

    await waitFor(() =>
      expect(api.updateAssignmentMessageConfig).toHaveBeenCalledWith(
        {
          enabled: false,
          openingMessage: 'Olá @chat_atendente',
          closingMessage: 'Tchau @chat_protocolo',
          agentIds: ['agent-1'],
          channelIds: [],
        },
        'tok-123'
      )
    );
    expect(refresh).toHaveBeenCalled();

    // The closed summary must reflect the saved config immediately, without depending
    // on refresh()'s network round-trip (which silently swallows its own errors).
    expect(screen.getByText(/1 atendentes, 0 canais/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Configurar mensagens' })).not.toBeInTheDocument();
  });

  test('checking an already-checked agent unchecks it', async () => {
    useAssignmentMessageConfig.mockReturnValue({
      config: { id: null, enabled: false, openingMessage: '', closingMessage: '', agentIds: [], channelIds: [] }, status: 'ready',
      loading: false,
      refresh: vi.fn(),
    });
    renderInShell(<AssignmentPage />, { path: '/configuracoes/regras/atribuicao' });

    await userEvent.click(screen.getByRole('button', { name: 'Configurar mensagens' }));
    const agentCheckbox = screen.getByLabelText('Geovanna Silva');
    await userEvent.click(agentCheckbox);
    expect(agentCheckbox).toBeChecked();
    await userEvent.click(agentCheckbox);
    expect(agentCheckbox).not.toBeChecked();
  });

  test('canceling while creating does not leave a stale draft on reopen', async () => {
    useAssignmentMessageConfig.mockReturnValue({
      config: { id: null, enabled: false, openingMessage: '', closingMessage: '', agentIds: [], channelIds: [] }, status: 'ready',
      loading: false,
      refresh: vi.fn(),
    });
    renderInShell(<AssignmentPage />, { path: '/configuracoes/regras/atribuicao' });

    await userEvent.click(screen.getByRole('button', { name: 'Configurar mensagens' }));
    await userEvent.type(screen.getByLabelText(/mensagem de abertura/i), 'rascunho descartado');
    await userEvent.click(screen.getByRole('button', { name: /^cancelar$/i }));

    await userEvent.click(screen.getByRole('button', { name: 'Configurar mensagens' }));
    expect(screen.getByLabelText(/mensagem de abertura/i)).toHaveValue('');
  });

  test('shows the closed-state summary with counts when a config already exists', () => {
    useAssignmentMessageConfig.mockReturnValue({
      config: {
        id: 'config-1',
        enabled: true,
        openingMessage: 'abertura',
        closingMessage: 'fechamento',
        agentIds: ['agent-1', 'agent-2'],
        channelIds: [],
      }, status: 'ready',
      loading: false,
      refresh: vi.fn(),
    });
    renderInShell(<AssignmentPage />, { path: '/configuracoes/regras/atribuicao' });
    expect(screen.getByText(/2 atendentes/i)).toBeInTheDocument();
  });

  test('editing an existing config pre-fills the form fields', async () => {
    useAssignmentMessageConfig.mockReturnValue({
      config: {
        id: 'config-1',
        enabled: true,
        openingMessage: 'Texto de abertura',
        closingMessage: 'Texto de encerramento',
        agentIds: ['agent-1'],
        channelIds: [],
      }, status: 'ready',
      loading: false,
      refresh: vi.fn(),
    });
    renderInShell(<AssignmentPage />, { path: '/configuracoes/regras/atribuicao' });

    await userEvent.click(screen.getByRole('button', { name: /^editar$/i }));

    expect(screen.getByLabelText(/mensagem de abertura/i)).toHaveValue('Texto de abertura');
    expect(screen.getByLabelText(/mensagem de encerramento/i)).toHaveValue('Texto de encerramento');
    expect(screen.getByLabelText('Geovanna Silva')).toBeChecked();
  });

  test('em carregamento não mostra "Nenhuma configuração criada ainda"', () => {
    useAssignmentMessageConfig.mockReturnValue({
      config: { id: null, enabled: false, openingMessage: '', closingMessage: '', agentIds: [], channelIds: [] },
      status: 'loading',
      loading: true,
      refresh: vi.fn(),
    });
    renderInShell(<AssignmentPage />, { path: '/configuracoes/regras/atribuicao' });

    expect(screen.queryByRole('button', { name: 'Configurar mensagens' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
