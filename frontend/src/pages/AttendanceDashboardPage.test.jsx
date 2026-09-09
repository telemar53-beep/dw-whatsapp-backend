import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import AttendanceDashboardPage from './AttendanceDashboardPage';
import { useAttendanceDashboard } from '../hooks/useAttendanceDashboard';
import { useChannels } from '../hooks/useChannels';
import { useAgents } from '../hooks/useAgents';
import { useSectors } from '../hooks/useSectors';
import { useAuth } from '../contexts/AuthContext';
import { getDashboardClosedToday } from '../services/api';

vi.mock('../hooks/useAttendanceDashboard');
vi.mock('../hooks/useChannels');
vi.mock('../hooks/useAgents');
vi.mock('../hooks/useSectors');
vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

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
  useAuth.mockReturnValue({ token: 'tok-123' });
  useChannels.mockReturnValue({ channels: [{ id: 'chan-1', name: 'WhatsApp Vendas' }], loading: false, refresh: vi.fn() });
  useAgents.mockReturnValue([{ id: 'agent-1', name: 'Ana', email: 'ana@dw.com' }]);
  useSectors.mockReturnValue({ sectors: [{ id: 'sector-1', name: 'Financeiro' }], loading: false, refresh: vi.fn() });
  getDashboardClosedToday.mockResolvedValue({ items: [], hasMore: false });
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
  test('renders the 4 columns with their conversations', async () => {
    renderPage();
    expect(screen.getByText('Em andamento')).toBeInTheDocument();
    expect(await screen.findByText('Carlos')).toBeInTheDocument();
    expect(screen.getByText('Em espera')).toBeInTheDocument();
    expect(screen.getByText('Maria')).toBeInTheDocument();
    expect(screen.getByText('Na automação')).toBeInTheDocument();
    expect(screen.getByText('Joao')).toBeInTheDocument();
    expect(screen.getByText('Encerrados hoje')).toBeInTheDocument();
  });

  test('shows the assigned agent name on a card', async () => {
    renderPage();
    expect(await screen.findByText('Carlos')).toBeInTheDocument();
    expect(screen.getByText('Ana')).toBeInTheDocument();
  });

  test('clicking a card navigates to / with the conversation as pendingConversation state', async () => {
    renderPage();
    await userEvent.click(screen.getByText('Carlos'));
    expect(mockNavigate).toHaveBeenCalledWith('/', {
      state: {
        pendingConversation: { id: 'c1', contactDisplayName: 'Carlos', channelId: 'chan-1', assignedAgentId: 'agent-1', sectorId: 'sector-1' },
      },
    });
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

  test('shows a "Carregar mais" button for Encerrados hoje when there are more pages, and loads the next page on click', async () => {
    getDashboardClosedToday
      .mockResolvedValueOnce({ items: [{ id: 'c10', contactDisplayName: 'Pedro', channelId: 'chan-1' }], hasMore: true })
      .mockResolvedValueOnce({ items: [{ id: 'c11', contactDisplayName: 'Rita', channelId: 'chan-1' }], hasMore: false });

    renderPage();
    expect(await screen.findByText('Pedro')).toBeInTheDocument();
    const loadMore = screen.getByRole('button', { name: /carregar mais/i });

    await userEvent.click(loadMore);

    expect(await screen.findByText('Rita')).toBeInTheDocument();
    expect(getDashboardClosedToday).toHaveBeenCalledWith({ offset: 1, limit: 20 }, 'tok-123');
    expect(screen.queryByRole('button', { name: /carregar mais/i })).not.toBeInTheDocument();
  });

  test('shows the true live closedTodayCount on the badge when no filter is active, even if fewer items are loaded', async () => {
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
    await screen.findByText('Ana');

    expect(screen.getByText('57')).toBeInTheDocument();
  });

  test('shows the filtered visible count on the badge when a filter is active', async () => {
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
    await screen.findByText('Ana');

    await userEvent.click(screen.getByRole('button', { name: /canais/i }));
    await userEvent.click(screen.getByLabelText('WhatsApp Vendas'));

    // Two "1" badges exist once the channel filter is active (the "Canais" dropdown's own
    // selected-count badge, and the "Encerrados hoje" count badge), so scope the query to the
    // Encerrados hoje column's badge rather than an ambiguous screen.findByText('1').
    const closedHeading = screen.getByText('Encerrados hoje');
    const badge = closedHeading.parentElement.querySelector('span');
    expect(badge).toHaveTextContent('1');
    expect(screen.queryByText('57')).not.toBeInTheDocument();
  });
});
