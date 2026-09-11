import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import AttendanceDashboardPage from './AttendanceDashboardPage';
import { useAttendanceDashboard } from '../hooks/useAttendanceDashboard';
import { useChannels } from '../hooks/useChannels';
import { useAgents } from '../hooks/useAgents';
import { useSectors } from '../hooks/useSectors';
import { useAuth } from '../contexts/AuthContext';
import { getDashboardClosedToday, getDashboardConversationByProtocol, getDashboardConversationsByPhone } from '../services/api';
import { useConversationMessages } from '../hooks/useConversationMessages';
import { useQuickReplies } from '../hooks/useQuickReplies';

vi.mock('../hooks/useAttendanceDashboard');
vi.mock('../hooks/useChannels');
vi.mock('../hooks/useAgents');
vi.mock('../hooks/useSectors');
vi.mock('../contexts/AuthContext');
vi.mock('../services/api');
vi.mock('../hooks/useConversationMessages');
vi.mock('../hooks/useQuickReplies');

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

function renderPage() {
  return render(
    <MemoryRouter>
      <AttendanceDashboardPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'agent-1', role: 'agent' } });
  useChannels.mockReturnValue({ channels: [{ id: 'chan-1', name: 'WhatsApp Vendas' }], loading: false, refresh: vi.fn() });
  useAgents.mockReturnValue([{ id: 'agent-1', name: 'Ana', email: 'ana@dw.com' }]);
  useSectors.mockReturnValue({ sectors: [{ id: 'sector-1', name: 'Financeiro' }], loading: false, refresh: vi.fn() });
  getDashboardClosedToday.mockResolvedValue({ items: [], hasMore: false });
  useConversationMessages.mockReturnValue({ messages: [], sendMessage: vi.fn() });
  useQuickReplies.mockReturnValue({ quickReplies: [], refresh: vi.fn() });
  useAttendanceDashboard.mockReturnValue({
    inProgress: [{ id: 'c1', contactDisplayName: 'Carlos', channelId: 'chan-1', assignedAgentId: 'agent-1', sectorId: 'sector-1' }],
    waiting: [{ id: 'c2', contactDisplayName: 'Maria', channelId: 'chan-1', assignedAgentId: null, sectorId: null }],
    inAutomation: [{ id: 'c3', contactDisplayName: 'Joao', channelId: 'chan-1', assignedAgentId: null, sectorId: null }],
    closedTodayCount: 0,
    loading: false,
    refresh: vi.fn(),
  });
});

describe('AttendanceDashboardPage', () => {
  test('shows the "Todos atendimentos" tab active by default, with the 3 live columns', async () => {
    renderPage();
    expect(screen.getByRole('tab', { name: /todos atendimentos/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /encerrados hoje/i })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByText('Em andamento')).toBeInTheDocument();
    expect(await screen.findByText('Carlos')).toBeInTheDocument();
    expect(screen.getByText('Em espera')).toBeInTheDocument();
    expect(screen.getByText('Maria')).toBeInTheDocument();
    expect(screen.getByText('Na automação')).toBeInTheDocument();
    expect(screen.getByText('Joao')).toBeInTheDocument();
  });

  test('the "Todos atendimentos" tab badge sums the 3 live columns', async () => {
    renderPage();
    expect(await screen.findByText('Carlos')).toBeInTheDocument();
    expect(screen.getByTestId('tab-count-all')).toHaveTextContent('3');
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

  test('shows the assigned agent name on a card', async () => {
    renderPage();
    expect(await screen.findByText('Carlos')).toBeInTheDocument();
    expect(screen.getByText('Ana')).toBeInTheDocument();
  });

  test('clicking a card opens the conversation in a popup, without navigating away', async () => {
    renderPage();
    await userEvent.click(await screen.findByText('Carlos'));

    expect(mockNavigate).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getAllByText('Carlos').length).toBeGreaterThan(0);
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

    expect(screen.getByText('Transferir para')).toBeInTheDocument();
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
    await screen.findByTestId('tab-count-closed');

    expect(screen.getByTestId('tab-count-closed')).toHaveTextContent('57');
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

    await waitFor(() => expect(screen.getByTestId('tab-count-closed')).toHaveTextContent('1'));
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

    expect(await screen.findByText('No conversation found with that protocol number')).toBeInTheDocument();
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

    expect(await screen.findByText('No contact found with that phone number')).toBeInTheDocument();
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
    expect(screen.getByText('Em andamento')).toBeInTheDocument();
  });
});
