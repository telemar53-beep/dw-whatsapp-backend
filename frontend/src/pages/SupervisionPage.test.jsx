import { describe, test, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderInShell } from '../test-utils/renderInShell';
import SupervisionPage from './SupervisionPage';
import { useAttendanceDashboard } from '../hooks/useAttendanceDashboard';
import { useChannels } from '../hooks/useChannels';
import { useAgents } from '../hooks/useAgents';
import { useSectors } from '../hooks/useSectors';
import { useAuth } from '../contexts/AuthContext';
import {
  getDashboardClosedToday,
  getDashboardConversationByProtocol,
  getDashboardConversationsByPhone,
  closeConversation,
  getPublicCompany,
} from '../services/api';
import { useConversationMessages } from '../hooks/useConversationMessages';
import { useQuickReplies } from '../hooks/useQuickReplies';
import { useAiSuggestion } from '../hooks/useAiSuggestion';

vi.mock('../hooks/useAttendanceDashboard');
vi.mock('../hooks/useChannels');
vi.mock('../hooks/useAgents');
vi.mock('../hooks/useSectors');
vi.mock('../contexts/AuthContext');
vi.mock('../services/api');
vi.mock('../hooks/useConversationMessages');
vi.mock('../hooks/useQuickReplies');
vi.mock('../hooks/useAiSuggestion');

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

function renderPage() {
  return renderInShell(<SupervisionPage />, { path: '/supervisao' });
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'agent-1', role: 'agent' } });
  useChannels.mockReturnValue({ channels: [{ id: 'chan-1', name: 'WhatsApp Vendas' }], loading: false, refresh: vi.fn() });
  useAgents.mockReturnValue({ agents: [{ id: 'agent-1', name: 'Ana', email: 'ana@dw.com' }], status: 'ready' });
  useSectors.mockReturnValue({ sectors: [{ id: 'sector-1', name: 'Financeiro' }], loading: false, refresh: vi.fn() });
  getDashboardClosedToday.mockResolvedValue({ items: [], hasMore: false });
  // O aviso do topo do chat (aberto no popup) cita a empresa cadastrada.
  getPublicCompany.mockResolvedValue({ name: '' });
  closeConversation.mockResolvedValue({ id: 'c2', status: 'closed' });
  useConversationMessages.mockReturnValue({ messages: [], sendMessage: vi.fn() });
  useQuickReplies.mockReturnValue({ quickReplies: [], refresh: vi.fn() });
  useAiSuggestion.mockReturnValue({ suggestion: null, send: vi.fn(), edit: vi.fn(), discard: vi.fn() });
  useAttendanceDashboard.mockReturnValue({
    inProgress: [{ id: 'c1', contactDisplayName: 'Carlos', channelId: 'chan-1', assignedAgentId: 'agent-1', sectorId: 'sector-1' }],
    waiting: [{ id: 'c2', contactDisplayName: 'Maria', channelId: 'chan-1', assignedAgentId: null, sectorId: null }],
    inAutomation: [{ id: 'c3', contactDisplayName: 'Joao', channelId: 'chan-1', assignedAgentId: null, sectorId: null }],
    closedTodayCount: 0,
    loading: false,
    refresh: vi.fn(),
  });
});

describe('SupervisionPage', () => {
  test('shows the "Todos atendimentos" tab active by default, with the three operation groups', async () => {
    renderPage();
    expect(screen.getByRole('tab', { name: /todos atendimentos/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /encerrados hoje/i })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('heading', { name: 'Em andamento', exact: true })).toBeInTheDocument();
    expect(await screen.findByText('Carlos')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Em espera', exact: true })).toBeInTheDocument();
    expect(screen.getByText('Maria')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Em automação', exact: true })).toBeInTheDocument();
    expect(screen.getByText('Joao')).toBeInTheDocument();
  });

  test('the "Todos atendimentos" tab badge sums the 3 live columns', async () => {
    renderPage();
    expect(await screen.findByText('Carlos')).toBeInTheDocument();
    expect(within(screen.getByRole('tab', { name: /todos/i })).getByText('3')).toBeInTheDocument();
  });

  test('quick-closes a conversation from the "Em espera" column without asking for a reason', async () => {
    renderPage();
    expect(await screen.findByText('Maria')).toBeInTheDocument();

    const waitingColumn = screen.getByRole('heading', { name: 'Em espera', exact: true }).closest('div').parentElement;
    await userEvent.click(within(waitingColumn).getByRole('button', { name: /finalizar/i }));
    await userEvent.click(await screen.findByRole('button', { name: 'Finalizar' }));

    expect(closeConversation).toHaveBeenCalledWith('c2', null, 'tok-123');
  });

  test('quick-closes a conversation from the "Em automação" column without asking for a reason', async () => {
    renderPage();
    expect(await screen.findByText('Joao')).toBeInTheDocument();

    const automationColumn = screen.getByRole('heading', { name: 'Em automação', exact: true }).closest('div').parentElement;
    await userEvent.click(within(automationColumn).getByRole('button', { name: /finalizar/i }));
    await userEvent.click(await screen.findByRole('button', { name: 'Finalizar' }));

    expect(closeConversation).toHaveBeenCalledWith('c3', null, 'tok-123');
  });

  test('does not show a quick-close button in the "Em andamento" column', async () => {
    renderPage();
    expect(await screen.findByText('Carlos')).toBeInTheDocument();

    const inProgressColumn = screen.getByRole('heading', { name: 'Em andamento', exact: true }).closest('div').parentElement;
    expect(within(inProgressColumn).queryByRole('button', { name: /finalizar/i })).not.toBeInTheDocument();
  });

  test('clicking the "Encerrados hoje" tab hides the 3 live columns and shows the closed list instead', async () => {
    getDashboardClosedToday.mockResolvedValue({
      items: [{ id: 'c9', contactDisplayName: 'Rita', channelId: 'chan-1' }],
      hasMore: false,
    });
    renderPage();
    expect(await screen.findByText('Carlos')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: /encerrados hoje/i }));

    expect(screen.queryByText('Em andamento')).not.toBeInTheDocument();
    expect(screen.queryByText('Carlos')).not.toBeInTheDocument();
    expect(await screen.findByText('Rita')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /encerrados hoje/i })).toHaveAttribute('aria-selected', 'true');
  });

  test('shows the assigned agent name in the operation row', async () => {
    renderPage();
    expect(await screen.findByText('Carlos')).toBeInTheDocument();
    expect(within(screen.getByRole('main', { name: 'Operação' })).getByText('Ana')).toBeInTheDocument();
  });

  test('clicking a card opens the conversation in a popup, without navigating away', async () => {
    renderPage();
    await userEvent.click(await screen.findByText('Carlos'));

    expect(mockNavigate).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getAllByText('Carlos').length).toBeGreaterThan(0);
    expect(within(dialog).getByText('Ana')).toBeInTheDocument();
  });

  test('closing the conversation popup returns to the dashboard view', async () => {
    renderPage();
    await userEvent.click(await screen.findByText('Carlos'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /voltar para a lista/i }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('clicking transfer inside the conversation popup opens the transfer modal', async () => {
    renderPage();
    await userEvent.click(await screen.findByText('Carlos'));

    await userEvent.click(screen.getByRole('button', { name: /transferir atendimento/i }));

    expect(screen.getByRole('heading', { name: 'Transferir atendimento' })).toBeInTheDocument();
  });

  test('opening a closed conversation from the Encerrados hoje tab also uses the popup, not navigation', async () => {
    getDashboardClosedToday.mockResolvedValue({
      items: [{ id: 'c9', contactDisplayName: 'Rita', channelId: 'chan-1', status: 'closed', assignedAgentId: 'agent-1' }],
      hasMore: false,
    });
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: /encerrados hoje/i }));
    await userEvent.click(await screen.findByText('Rita'));

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  test('filtering by channel hides conversations from other channels', async () => {
    useChannels.mockReturnValue({
      channels: [
        { id: 'chan-1', name: 'WhatsApp Vendas' },
        { id: 'chan-2', name: 'WhatsApp Suporte' },
      ],
      loading: false,
      refresh: vi.fn(),
    });
    renderPage();
    expect(screen.getByText('Carlos')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /canais/i }));
    await userEvent.click(screen.getByLabelText('WhatsApp Suporte'));

    expect(screen.queryByText('Carlos')).not.toBeInTheDocument();
  });

  test('o filtro de Atendentes tem a opção IA, que mostra o que a IA encerrou ou está triando', async () => {
    useAttendanceDashboard.mockReturnValue({
      inProgress: [{ id: 'c1', contactDisplayName: 'Carlos', channelId: 'chan-1', assignedAgentId: 'agent-1', sectorId: 'sector-1' }],
      waiting: [{ id: 'c2', contactDisplayName: 'Maria', channelId: 'chan-1', assignedAgentId: null, sectorId: null, aiTriageCompletedAt: '2026-09-13T15:00:00Z' }],
      inAutomation: [{ id: 'c3', contactDisplayName: 'Joao', channelId: 'chan-1', assignedAgentId: null, sectorId: null, triageState: 'pending' }],
      closedTodayCount: 2,
    });
    getDashboardClosedToday.mockResolvedValue({
      items: [
        { id: 'c4', contactDisplayName: 'Pedro', channelId: 'chan-1', assignedAgentId: null, sectorId: null, status: 'closed', aiTriageResolvedByAi: true, aiTriageCompletedAt: '2026-09-13T15:10:00Z' },
        { id: 'c5', contactDisplayName: 'Lucia', channelId: 'chan-1', assignedAgentId: 'agent-1', sectorId: null, status: 'closed', aiTriageResolvedByAi: true },
      ],
      hasMore: false,
    });
    renderPage();
    expect(await screen.findByText('Carlos')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /atendentes/i }));
    await userEvent.click(screen.getByLabelText('IA'));

    // Ativas: Carlos é da Ana (some); Maria (concluída pela IA para a fila) e
    // Joao (em triagem) ficam.
    expect(screen.queryByText('Carlos')).not.toBeInTheDocument();
    expect(screen.getByText('Maria')).toBeInTheDocument();
    expect(screen.getByText('Joao')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: /encerrad/i }));
    // Encerrados: Pedro foi encerrado pela IA (fica); Lucia foi encerrada pela
    // Ana depois de a IA entregar o boleto (some).
    expect(await screen.findByText('Pedro')).toBeInTheDocument();
    expect(screen.queryByText('Lucia')).not.toBeInTheDocument();
  });

  test('opening a filter dropdown closes any other one that was already open', async () => {
    renderPage();
    expect(screen.getByText('Carlos')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /canais/i }));
    expect(screen.getByLabelText('WhatsApp Vendas')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /atendentes/i }));
    expect(screen.queryByLabelText('WhatsApp Vendas')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Ana')).toBeInTheDocument();
  });

  test('clicking outside an open filter dropdown closes it', async () => {
    renderPage();
    expect(screen.getByText('Carlos')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /canais/i }));
    expect(screen.getByLabelText('WhatsApp Vendas')).toBeInTheDocument();

    await userEvent.click(screen.getByText('Carlos'));
    expect(screen.queryByLabelText('WhatsApp Vendas')).not.toBeInTheDocument();
  });

  test('shows a "Carregar mais" button on the Encerrados hoje tab when there are more pages, and loads the next page on click', async () => {
    getDashboardClosedToday
      .mockResolvedValueOnce({ items: [{ id: 'c10', contactDisplayName: 'Pedro', channelId: 'chan-1' }], hasMore: true })
      .mockResolvedValueOnce({ items: [{ id: 'c11', contactDisplayName: 'Rita', channelId: 'chan-1' }], hasMore: false });

    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: /encerrados hoje/i }));
    expect(await screen.findByText('Pedro')).toBeInTheDocument();
    const loadMore = screen.getByRole('button', { name: /carregar mais/i });

    await userEvent.click(loadMore);

    expect(await screen.findByText('Rita')).toBeInTheDocument();
    expect(getDashboardClosedToday).toHaveBeenCalledWith({ offset: 1, limit: 20 }, 'tok-123');
    expect(screen.queryByRole('button', { name: /carregar mais/i })).not.toBeInTheDocument();
  });

  test('shows the true live closedTodayCount on the tab badge when no filter is active, even if fewer items are loaded', async () => {
    useAttendanceDashboard.mockReturnValue({
      inProgress: [],
      waiting: [],
      inAutomation: [],
      closedTodayCount: 57,
      loading: false,
      refresh: vi.fn(),
    });
    getDashboardClosedToday.mockResolvedValue({
      items: [{ id: 'c1', contactDisplayName: 'Ana', channelId: 'chan-1' }],
      hasMore: true,
    });

    renderPage();

    await waitFor(() => {
      expect(within(screen.getByRole('tab', { name: /encerrados hoje/i })).getByText('57')).toBeInTheDocument();
    });
  });

  test('shows the filtered visible count on the tab badge when a filter is active', async () => {
    useAttendanceDashboard.mockReturnValue({
      inProgress: [],
      waiting: [],
      inAutomation: [],
      closedTodayCount: 57,
      loading: false,
      refresh: vi.fn(),
    });
    getDashboardClosedToday.mockResolvedValue({
      items: [
        { id: 'c1', contactDisplayName: 'Ana', channelId: 'chan-1' },
        { id: 'c2', contactDisplayName: 'Beto', channelId: 'chan-2' },
      ],
      hasMore: false,
    });
    useChannels.mockReturnValue({
      channels: [
        { id: 'chan-1', name: 'WhatsApp Vendas' },
        { id: 'chan-2', name: 'WhatsApp Suporte' },
      ],
      loading: false,
      refresh: vi.fn(),
    });

    renderPage();
    await waitFor(() => expect(getDashboardClosedToday).toHaveBeenCalled());

    await userEvent.click(screen.getByRole('button', { name: /canais/i }));
    await userEvent.click(screen.getByLabelText('WhatsApp Vendas'));

    await waitFor(() => {
      expect(within(screen.getByRole('tab', { name: /encerrados hoje/i })).getByText('1')).toBeInTheDocument();
    });
  });

  test('lê os filtros da URL e escreve de volta ao mudar', async () => {
    useChannels.mockReturnValue({ channels: [{ id: 'ch1', name: 'Berg' }, { id: 'ch2', name: 'Suporte' }], loading: false });
    useSectors.mockReturnValue({ sectors: [{ id: 's1', name: 'Financeiro' }], loading: false });
    renderInShell(<SupervisionPage />, { path: '/supervisao', initialEntries: ['/supervisao?canal=ch1&aba=encerrados'] });
    expect(await screen.findByRole('tab', { name: /encerrados hoje/i })).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(screen.getByRole('button', { name: /^canais/i }));
    expect(screen.getByRole('checkbox', { name: 'Berg' })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: /^setores/i }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Financeiro' }));
    expect(screen.getByTestId('location-search')).toHaveTextContent('canal=ch1');
    expect(screen.getByTestId('location-search')).toHaveTextContent('setor=s1');
  });

  test('searching by protocol number opens the matching conversation', async () => {
    getDashboardConversationByProtocol.mockResolvedValue({
      id: 'conv-found',
      status: 'closed',
      protocolNumber: 1042,
      contactDisplayName: 'Cliente Antigo',
      assignedAgentId: 'agent-1',
    });
    renderPage();

    await userEvent.type(screen.getByLabelText(/buscar por protocolo/i), '1042{Enter}');

    expect(getDashboardConversationByProtocol).toHaveBeenCalledWith('1042', 'tok-123');
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  test('searching by the new AAAAMMDD-XXXX protocol format opens the matching conversation', async () => {
    getDashboardConversationByProtocol.mockResolvedValue({
      id: 'conv-found-2',
      status: 'closed',
      protocolNumber: '20260911-0001',
      contactDisplayName: 'Cliente Novo',
      assignedAgentId: 'agent-1',
    });
    renderPage();

    await userEvent.type(screen.getByLabelText(/buscar por protocolo/i), '20260911-0001{Enter}');

    expect(getDashboardConversationByProtocol).toHaveBeenCalledWith('20260911-0001', 'tok-123');
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  test('shows an error when the protocol number is not found', async () => {
    getDashboardConversationByProtocol.mockRejectedValue({ body: { error: 'No conversation found with that protocol number' } });
    renderPage();

    await userEvent.type(screen.getByLabelText(/buscar por protocolo/i), '999999');
    await userEvent.type(screen.getByLabelText(/buscar por protocolo/i), '{Enter}');

    expect(await screen.findByText('Nenhum atendimento encontrado com esse protocolo.')).toBeInTheDocument();
  });

  test('searching by phone number shows the matching contact\'s conversations', async () => {
    getDashboardConversationsByPhone.mockResolvedValue({
      contact: { id: 'contact-1', phoneNumber: '+5511999990000', displayName: 'Maria Cliente' },
      conversations: [
        { id: 'conv-old-1', status: 'closed', contactDisplayName: 'Maria Cliente', channelId: 'chan-1' },
        { id: 'conv-old-2', status: 'waiting', contactDisplayName: 'Maria Cliente', channelId: 'chan-1' },
      ],
    });
    renderPage();

    await userEvent.type(screen.getByLabelText(/buscar por telefone/i), '+5511999990000{Enter}');

    expect(getDashboardConversationsByPhone).toHaveBeenCalledWith('+5511999990000', 'tok-123');
    expect(await screen.findByText(/2 atendimento/i)).toBeInTheDocument();
    expect(screen.getAllByText('Maria Cliente')).toHaveLength(2);
  });

  test('clicking a phone-search result opens it in the conversation modal', async () => {
    getDashboardConversationsByPhone.mockResolvedValue({
      contact: { id: 'contact-1', phoneNumber: '+5511999990000', displayName: 'Maria Cliente' },
      conversations: [{ id: 'conv-old-1', status: 'closed', contactDisplayName: 'Maria Cliente', channelId: 'chan-1' }],
    });
    renderPage();

    await userEvent.type(screen.getByLabelText(/buscar por telefone/i), '+5511999990000{Enter}');
    await userEvent.click(await screen.findByText('Maria Cliente'));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  test('shows an error when the phone number matches no contact', async () => {
    getDashboardConversationsByPhone.mockRejectedValue({ body: { error: 'No contact found with that phone number' } });
    renderPage();

    await userEvent.type(screen.getByLabelText(/buscar por telefone/i), '+5511900000000{Enter}');

    expect(await screen.findByText('Nenhum cliente encontrado com esse telefone.')).toBeInTheDocument();
  });

  test('clearing the phone search returns to the normal tabs', async () => {
    getDashboardConversationsByPhone.mockResolvedValue({
      contact: { id: 'contact-1', phoneNumber: '+5511999990000', displayName: 'Maria Cliente' },
      conversations: [{ id: 'conv-old-1', status: 'closed', contactDisplayName: 'Maria Cliente', channelId: 'chan-1' }],
    });
    renderPage();

    await userEvent.type(screen.getByLabelText(/buscar por telefone/i), '+5511999990000{Enter}');
    await screen.findByText(/1 atendimento/i);

    await userEvent.click(screen.getByRole('button', { name: /limpar busca/i }));

    expect(screen.queryByText(/atendimento\(s\) de/i)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Em andamento', exact: true })).toBeInTheDocument();
  });
});


test('team selection reuses the agent filter and operation navigation keeps the same conversations', async () => {
  renderPage();
  await screen.findByText('Carlos');
  const team = screen.getByRole('complementary', { name: 'Equipe e carga' });
  expect(within(team).getByText('1')).toBeInTheDocument();
  const agent = within(team).getByRole('button', { name: /Ana/ });
  await userEvent.click(agent);
  expect(agent).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByText('Carlos')).toBeInTheDocument();
  expect(screen.queryByText('Maria')).not.toBeInTheDocument();
  await userEvent.click(agent);
  const states = screen.getByRole('navigation', { name: 'Estados dos atendimentos' });
  await userEvent.click(within(states).getByRole('button', { name: /Espera/ }));
  expect(screen.getByText('Maria')).toBeInTheDocument();
  expect(screen.queryByText('Carlos')).not.toBeInTheDocument();
});

describe('estados de carregamento da central de operação', () => {
  test('carregando não é apresentado como operação vazia', () => {
    useAttendanceDashboard.mockReturnValue({
      inProgress: [], waiting: [], inAutomation: [], closedTodayCount: 0,
      status: 'loading', loading: true, refresh: vi.fn(),
    });
    renderPage();

    expect(screen.getByRole('status')).toHaveTextContent(/carregando atendimentos/i);
    expect(screen.queryByText('Nenhum atendimento em andamento.')).not.toBeInTheDocument();
  });

  test('falha na carga mostra erro com tentar de novo, e não "nenhum atendimento"', async () => {
    const refresh = vi.fn();
    useAttendanceDashboard.mockReturnValue({
      inProgress: [], waiting: [], inAutomation: [], closedTodayCount: 0,
      status: 'error', loading: false, refresh,
    });
    renderPage();

    expect(screen.getByRole('alert')).toHaveTextContent(/não foi possível carregar os atendimentos/i);
    expect(screen.queryByText('Nenhum atendimento em espera.')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /tentar de novo/i }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test('operação realmente vazia continua dizendo que não há atendimentos', () => {
    useAttendanceDashboard.mockReturnValue({
      inProgress: [], waiting: [], inAutomation: [], closedTodayCount: 0,
      status: 'ready', loading: false, refresh: vi.fn(),
    });
    renderPage();

    expect(screen.getByText('Nenhum atendimento em andamento.')).toBeInTheDocument();
    expect(screen.queryByText(/não foi possível carregar os atendimentos/i)).not.toBeInTheDocument();
  });
});

describe('contadores confiáveis', () => {
  test('em erro, os contadores mostram — em vez de 0', () => {
    useAttendanceDashboard.mockReturnValue({
      inProgress: [], waiting: [], inAutomation: [], closedTodayCount: 0,
      status: 'error', loading: false, refresh: vi.fn(),
    });
    renderPage();

    // Nenhum zero pode aparecer como se fosse confirmado.
    const estados = screen.getByRole('navigation', { name: /estados dos atendimentos/i });
    // "Visão geral" não carrega mais contador: ele repetia, encostado, o mesmo
    // número da aba "Todos atendimentos", que continua respondendo por ele.
    ['Andamento', 'Espera', 'Automação'].forEach((rotulo) => {
      const botao = within(estados).getByRole('button', { name: new RegExp(rotulo, 'i') });
      expect(botao).toHaveTextContent('—');
      expect(botao).not.toHaveTextContent('0');
    });
    expect(within(estados).getByRole('button', { name: /visão geral/i })).toHaveTextContent(/^Visão geral$/);

    expect(screen.getByRole('tab', { name: /todos atendimentos/i })).toHaveTextContent('—');
    expect(screen.getByRole('tab', { name: /encerrados hoje/i })).toHaveTextContent('—');

    // A carga da equipe vem da mesma requisição que falhou.
    const equipe = screen.getByRole('complementary', { name: /equipe e carga/i });
    expect(within(equipe).getAllByText('—').length).toBeGreaterThan(0);
    expect(within(equipe).queryByText(/sem atendimentos/i)).not.toBeInTheDocument();
  });

  test('em carregamento, os contadores também mostram —', () => {
    useAttendanceDashboard.mockReturnValue({
      inProgress: [], waiting: [], inAutomation: [], closedTodayCount: 0,
      status: 'loading', loading: true, refresh: vi.fn(),
    });
    renderPage();

    expect(screen.getByRole('tab', { name: /todos atendimentos/i })).toHaveTextContent('—');
  });

  test('zero confirmado continua sendo 0', () => {
    useAttendanceDashboard.mockReturnValue({
      inProgress: [], waiting: [], inAutomation: [], closedTodayCount: 0,
      status: 'ready', loading: false, refresh: vi.fn(),
    });
    renderPage();

    const estados = screen.getByRole('navigation', { name: /estados dos atendimentos/i });
    const andamento = within(estados).getByRole('button', { name: /andamento/i });
    expect(andamento).toHaveTextContent('0');
    expect(andamento).not.toHaveTextContent('—');
    // A presença é "Online" + a atividade num <em> separado (o "·" é
    // decoração de CSS), então a asserção olha o bloco inteiro.
    expect(screen.getByText('Livre').closest('.supervision-presence')).toHaveTextContent(/online/i);
  });
});

// Etapa 6.1 — o painel de Encerrados nao pode apresentar falha como fila vazia,
// e a contagem filtrada nao pode se passar por total quando so ha uma pagina
// carregada. Nao existe endpoint que devolva o total filtrado.
describe('encerrados: falha visivel e contagem honesta', () => {
  function doisCanais() {
    useChannels.mockReturnValue({
      channels: [
        { id: 'chan-1', name: 'WhatsApp Vendas' },
        { id: 'chan-2', name: 'WhatsApp Suporte' },
      ],
      loading: false,
      refresh: vi.fn(),
    });
  }

  async function abrirEncerrados() {
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: /encerrados hoje/i }));
  }

  async function filtrarPorVendas() {
    await userEvent.click(screen.getByRole('button', { name: /canais/i }));
    await userEvent.click(screen.getByLabelText('WhatsApp Vendas'));
  }

  test('falha na carga inicial vira alerta, e nao "nenhum atendimento encerrado hoje"', async () => {
    getDashboardClosedToday.mockRejectedValue(new Error('offline'));
    await abrirEncerrados();

    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent(/não foi possível carregar os atendimentos encerrados hoje/i);
    expect(within(alerta).getByRole('button', { name: /tentar de novo/i })).toBeInTheDocument();
    expect(screen.queryByText(/nenhum atendimento encerrado hoje/i)).not.toBeInTheDocument();
  });

  test('"tentar de novo" depois da falha inicial busca a primeira pagina outra vez', async () => {
    getDashboardClosedToday
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ items: [{ id: 'c9', contactDisplayName: 'Selma', channelId: 'chan-1' }], hasMore: false });
    await abrirEncerrados();

    await userEvent.click(await screen.findByRole('button', { name: /tentar de novo/i }));

    expect(await screen.findByText('Selma')).toBeInTheDocument();
    expect(getDashboardClosedToday).toHaveBeenLastCalledWith({ offset: 0, limit: 20 }, 'tok-123');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('falha no "carregar mais" preserva a lista ja carregada', async () => {
    getDashboardClosedToday
      .mockResolvedValueOnce({ items: [{ id: 'c10', contactDisplayName: 'Pedro', channelId: 'chan-1' }], hasMore: true })
      .mockRejectedValueOnce(new Error('offline'));
    await abrirEncerrados();
    expect(await screen.findByText('Pedro')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /carregar mais/i }));

    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent(/não foi possível carregar mais atendimentos encerrados/i);
    // O que ja estava na tela continua la: uma pagina adicional que falha nao
    // invalida os encerrados que o supervisor ja esta lendo.
    expect(screen.getByText('Pedro')).toBeInTheDocument();
  });

  test('"tentar de novo" depois de falhar o "carregar mais" repete a mesma pagina, sem recomecar', async () => {
    getDashboardClosedToday
      .mockResolvedValueOnce({ items: [{ id: 'c10', contactDisplayName: 'Pedro', channelId: 'chan-1' }], hasMore: true })
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ items: [{ id: 'c11', contactDisplayName: 'Rita', channelId: 'chan-1' }], hasMore: false });
    await abrirEncerrados();
    await screen.findByText('Pedro');
    await userEvent.click(screen.getByRole('button', { name: /carregar mais/i }));
    await screen.findByRole('alert');

    await userEvent.click(screen.getByRole('button', { name: /tentar de novo/i }));

    expect(await screen.findByText('Rita')).toBeInTheDocument();
    expect(screen.getByText('Pedro')).toBeInTheDocument();
    expect(getDashboardClosedToday).toHaveBeenLastCalledWith({ offset: 1, limit: 20 }, 'tok-123');
  });

  test('com filtro e mais paginas, o contador diz que o numero e so do que foi carregado', async () => {
    doisCanais();
    getDashboardClosedToday.mockResolvedValue({
      items: [
        { id: 'c1', contactDisplayName: 'Ana', channelId: 'chan-1' },
        { id: 'c2', contactDisplayName: 'Beto', channelId: 'chan-2' },
      ],
      hasMore: true,
    });
    await abrirEncerrados();
    await filtrarPorVendas();

    const aba = screen.getByRole('tab', { name: /encerrados hoje/i });
    await waitFor(() => expect(aba).toHaveTextContent(/1 carregados/i));
    // O numero cru sozinho afirmaria um total que ninguem mediu.
    expect(within(aba).queryByText('1', { selector: 'span' })).not.toBeInTheDocument();
    expect(
      screen.getByText(/1 correspondência entre 2 encerrados carregados\. Há mais resultados disponíveis/i)
    ).toBeInTheDocument();
  });

  test('com filtro e sem mais paginas, o numero filtrado e o total e aparece normalmente', async () => {
    doisCanais();
    getDashboardClosedToday.mockResolvedValue({
      items: [
        { id: 'c1', contactDisplayName: 'Ana', channelId: 'chan-1' },
        { id: 'c2', contactDisplayName: 'Beto', channelId: 'chan-2' },
      ],
      hasMore: false,
    });
    await abrirEncerrados();
    await filtrarPorVendas();

    const aba = screen.getByRole('tab', { name: /encerrados hoje/i });
    await waitFor(() => expect(within(aba).getByText('1')).toBeInTheDocument());
    expect(aba).not.toHaveTextContent(/carregados/i);
    expect(screen.getByText(/1 de 2 encerrados de hoje correspondem aos filtros/i)).toBeInTheDocument();
  });

  test('vazio por filtro se distingue de nao haver encerrado nenhum', async () => {
    doisCanais();
    getDashboardClosedToday.mockResolvedValue({
      items: [{ id: 'c2', contactDisplayName: 'Beto', channelId: 'chan-2' }],
      hasMore: false,
    });
    await abrirEncerrados();
    await filtrarPorVendas();

    expect(await screen.findByText(/nenhum atendimento encerrado hoje com os filtros atuais/i)).toBeInTheDocument();
  });
});

// Etapa 6.2 — filtro que esconde tudo nao pode parecer operacao vazia, e
// rotulo de coluna nao pode pairar sobre tela que nao tem coluna nenhuma.
describe('filtros e rotulos de coluna', () => {
  function doisCanais() {
    useChannels.mockReturnValue({
      channels: [
        { id: 'chan-1', name: 'WhatsApp Vendas' },
        { id: 'chan-2', name: 'WhatsApp Suporte' },
      ],
      loading: false,
      refresh: vi.fn(),
    });
  }

  test('sem filtro, as colunas vazias continuam dizendo que nao ha atendimento', () => {
    useAttendanceDashboard.mockReturnValue({
      inProgress: [], waiting: [], inAutomation: [], closedTodayCount: 0,
      status: 'ready', loading: false, refresh: vi.fn(),
    });
    renderPage();

    expect(screen.getByText('Nenhum atendimento em andamento.')).toBeInTheDocument();
    expect(screen.queryByText(/com os filtros atuais/i)).not.toBeInTheDocument();
  });

  test('com filtro que esconde tudo, o vazio diz que a causa sao os filtros', async () => {
    doisCanais();
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: /canais/i }));
    await userEvent.click(screen.getByLabelText('WhatsApp Suporte'));

    expect(await screen.findByText('Nenhum atendimento em andamento com os filtros atuais.')).toBeInTheDocument();
    expect(screen.getByText('Nenhum atendimento em espera com os filtros atuais.')).toBeInTheDocument();
    expect(screen.getByText('Nenhum atendimento em automação com os filtros atuais.')).toBeInTheDocument();
  });

  test('"limpar filtros" so aparece com filtro e apaga canal, atendente e setor', async () => {
    doisCanais();
    renderPage();
    expect(screen.queryByRole('button', { name: /limpar filtros/i })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /canais/i }));
    await userEvent.click(screen.getByLabelText('WhatsApp Suporte'));
    await userEvent.click(screen.getByRole('button', { name: /setores/i }));
    await userEvent.click(screen.getByLabelText('Financeiro'));

    await userEvent.click(await screen.findByRole('button', { name: /limpar filtros/i }));

    // Os tres atendimentos do painel voltam, e o botao some junto com o filtro.
    expect(await screen.findByText('Carlos')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /limpar filtros/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/com os filtros atuais/i)).not.toBeInTheDocument();
  });

  test('"limpar filtros" preserva a aba ativa na URL', async () => {
    doisCanais();
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /canais/i }));
    await userEvent.click(screen.getByLabelText('WhatsApp Suporte'));
    await userEvent.click(screen.getByRole('tab', { name: /encerrados hoje/i }));

    await userEvent.click(screen.getByRole('button', { name: /limpar filtros/i }));

    expect(screen.getByRole('tab', { name: /encerrados hoje/i })).toHaveAttribute('aria-selected', 'true');
  });

  test('os rotulos de coluna somem quando nao ha linha para rotular', async () => {
    const rotulo = /cliente \/ última mensagem/i;
    renderPage();
    expect(screen.getByText(rotulo)).toBeInTheDocument();

    // Encerrados tem outra composicao; o rotulo das colunas ao vivo nao vai junto.
    await userEvent.click(screen.getByRole('tab', { name: /encerrados hoje/i }));
    expect(screen.queryByText(rotulo)).not.toBeInTheDocument();
  });

  test('os rotulos de coluna nao pairam sobre carregando nem sobre erro', () => {
    const rotulo = /cliente \/ última mensagem/i;
    useAttendanceDashboard.mockReturnValue({
      inProgress: [], waiting: [], inAutomation: [], closedTodayCount: 0,
      status: 'loading', loading: true, refresh: vi.fn(),
    });
    const { unmount } = renderPage();
    expect(screen.queryByText(rotulo)).not.toBeInTheDocument();
    unmount();

    useAttendanceDashboard.mockReturnValue({
      inProgress: [], waiting: [], inAutomation: [], closedTodayCount: 0,
      status: 'error', loading: false, refresh: vi.fn(),
    });
    renderPage();
    expect(screen.queryByText(rotulo)).not.toBeInTheDocument();
  });

  test('os rotulos de coluna somem na busca por telefone', async () => {
    const rotulo = /cliente \/ última mensagem/i;
    getDashboardConversationsByPhone.mockResolvedValue({
      contact: { displayName: 'Ana', phoneNumber: '5511999999999' },
      conversations: [{ id: 'h1', contactDisplayName: 'Ana', status: 'closed' }],
    });
    renderPage();

    await userEvent.type(screen.getByLabelText(/buscar por telefone/i), '5511999999999{Enter}');

    expect(await screen.findByText(/1 atendimento\(s\) de Ana/i)).toBeInTheDocument();
    expect(screen.queryByText(rotulo)).not.toBeInTheDocument();
  });
});
