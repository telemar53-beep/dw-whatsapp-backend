import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import DashboardPage from './DashboardPage';
import { useAuth } from '../contexts/AuthContext';
import { useQueue } from '../hooks/useQueue';
import { useMyConversations } from '../hooks/useMyConversations';
import { useChannels } from '../hooks/useChannels';
import { useConversationMessages } from '../hooks/useConversationMessages';
import { useQuickReplies } from '../hooks/useQuickReplies';
import { useQueueNotificationSound } from '../hooks/useQueueNotificationSound';

vi.mock('../contexts/AuthContext');
vi.mock('../hooks/useQueue');
vi.mock('../hooks/useMyConversations');
vi.mock('../hooks/useChannels');
vi.mock('../hooks/useAgents', () => ({ useAgents: () => [] }));
vi.mock('../hooks/usePresence', () => ({ usePresence: () => new Set() }));
vi.mock('../hooks/useConversationMessages');
vi.mock('../hooks/useQuickReplies');
vi.mock('../hooks/useQueueNotificationSound');
vi.mock('../components/StartConversationModal', () => ({
  default: ({ onCreated }) => (
    <button
      onClick={() =>
        onCreated({ id: 'conv-new', contactPhoneNumber: '5598999990000', assignedAgentId: 'agent-1', status: 'assigned' })
      }
    >
      Mock Start Conversation
    </button>
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'agent-1', role: 'agent' }, logout: vi.fn() });
  useChannels.mockReturnValue({ channels: [], loading: false, refresh: vi.fn() });
  // DashboardPage's own wiring is what this file tests — ConversationView's
  // internals (already covered by Task 7's ConversationView.test.jsx) are
  // stubbed out here so selecting a conversation doesn't trigger a real,
  // unmocked fetch via the real useConversationMessages/services/api.
  useConversationMessages.mockReturnValue({ messages: [], sendMessage: vi.fn() });
  useQuickReplies.mockReturnValue({ quickReplies: [], refresh: vi.fn() });
  useQueueNotificationSound.mockReturnValue({ muted: false, toggleMuted: vi.fn() });
});

function renderDashboard() {
  return render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>
  );
}

describe('DashboardPage', () => {
  test('renders both the queue and my-conversations lists', () => {
    useQueue.mockReturnValue([{ id: 'c1', contactDisplayName: 'Carlos' }]);
    useMyConversations.mockReturnValue([{ id: 'c2', contactDisplayName: 'Maria' }]);
    renderDashboard();
    expect(screen.getByText('Carlos')).toBeInTheDocument();
    expect(screen.getByText('Maria')).toBeInTheDocument();
  });

  test('selecting a conversation from the queue opens the conversation view', async () => {
    useQueue.mockReturnValue([{ id: 'c1', contactDisplayName: 'Carlos', status: 'waiting', assignedAgentId: null }]);
    useMyConversations.mockReturnValue([]);
    renderDashboard();
    await userEvent.click(screen.getByText('Carlos'));
    expect(screen.getByRole('button', { name: /assumir/i })).toBeInTheDocument();
  });

  test('shows a placeholder when no conversation is selected', () => {
    useQueue.mockReturnValue([]);
    useMyConversations.mockReturnValue([]);
    renderDashboard();
    expect(screen.getByText(/selecione uma conversa/i)).toBeInTheDocument();
  });

  test('shows an Administração link for an admin agent', () => {
    useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'agent-1', role: 'admin' }, logout: vi.fn() });
    useQueue.mockReturnValue([]);
    useMyConversations.mockReturnValue([]);
    renderDashboard();
    expect(screen.getByRole('link', { name: /administração/i })).toBeInTheDocument();
  });

  test('hides the Administração link for a non-admin agent', () => {
    useQueue.mockReturnValue([]);
    useMyConversations.mockReturnValue([]);
    renderDashboard();
    expect(screen.queryByRole('link', { name: /administração/i })).not.toBeInTheDocument();
  });

  test('opens the change-password modal from the header', async () => {
    useQueue.mockReturnValue([]);
    useMyConversations.mockReturnValue([]);
    renderDashboard();

    expect(screen.queryByText(/trocar minha senha/i)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /^trocar senha$/i }));

    expect(screen.getByText(/trocar minha senha/i)).toBeInTheDocument();
  });

  test('shows an Iniciar conversa button for any attendant', () => {
    useQueue.mockReturnValue([]);
    useMyConversations.mockReturnValue([]);
    renderDashboard();
    expect(screen.getByRole('button', { name: /iniciar conversa/i })).toBeInTheDocument();
  });

  test('starting a conversation opens it immediately, even before it appears in myConversations', async () => {
    useQueue.mockReturnValue([]);
    useMyConversations.mockReturnValue([]);
    renderDashboard();

    await userEvent.click(screen.getByRole('button', { name: /iniciar conversa/i }));
    await userEvent.click(screen.getByText('Mock Start Conversation'));

    expect(screen.getByRole('button', { name: /transferir/i })).toBeInTheDocument();
  });

  test('clears the pending conversation once it appears in myConversations, so a later close is not masked by stale state', async () => {
    useQueue.mockReturnValue([]);
    useMyConversations.mockReturnValue([]);
    const { rerender } = renderDashboard();

    await userEvent.click(screen.getByRole('button', { name: /iniciar conversa/i }));
    await userEvent.click(screen.getByText('Mock Start Conversation'));
    expect(screen.getByRole('button', { name: /transferir/i })).toBeInTheDocument();

    // The real conversation:assigned socket event lands — myConversations now has it.
    useMyConversations.mockReturnValue([
      { id: 'conv-new', contactPhoneNumber: '5598999990000', assignedAgentId: 'agent-1', status: 'assigned' },
    ]);
    rerender(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );
    expect(screen.getByRole('button', { name: /transferir/i })).toBeInTheDocument();

    // The conversation is later closed for real — it drops out of myConversations.
    useMyConversations.mockReturnValue([]);
    rerender(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );
    expect(screen.queryByRole('button', { name: /transferir/i })).not.toBeInTheDocument();
    expect(screen.getByText(/selecione uma conversa/i)).toBeInTheDocument();
  });

  test('shows a Métricas link for any attendant', () => {
    useQueue.mockReturnValue([]);
    useMyConversations.mockReturnValue([]);
    renderDashboard();
    expect(screen.getByRole('link', { name: /métricas/i })).toBeInTheDocument();
  });

  test('shows the list and hides the conversation panel on mobile when nothing is selected', () => {
    useQueue.mockReturnValue([]);
    useMyConversations.mockReturnValue([]);
    const { container } = renderDashboard();
    const aside = container.querySelector('aside');
    const main = container.querySelector('main');
    expect(aside.className).not.toMatch(/\bhidden\b/);
    expect(main.className).toMatch(/\bhidden\b/);
  });

  test('shows the conversation panel and hides the list on mobile when a conversation is selected', async () => {
    useQueue.mockReturnValue([{ id: 'c1', contactDisplayName: 'Carlos', status: 'waiting', assignedAgentId: null }]);
    useMyConversations.mockReturnValue([]);
    const { container } = renderDashboard();
    await userEvent.click(screen.getByText('Carlos'));

    const aside = container.querySelector('aside');
    const main = container.querySelector('main');
    expect(main.className).not.toMatch(/\bhidden\b/);
    expect(aside.className).toMatch(/\bhidden\b/);
  });

  test('clicking the back button in the conversation view returns to the list', async () => {
    useQueue.mockReturnValue([{ id: 'c1', contactDisplayName: 'Carlos', status: 'waiting', assignedAgentId: null }]);
    useMyConversations.mockReturnValue([]);
    const { container } = renderDashboard();
    await userEvent.click(screen.getByText('Carlos'));
    expect(container.querySelector('main').className).not.toMatch(/\bhidden\b/);

    await userEvent.click(screen.getByRole('button', { name: /voltar para a lista/i }));

    expect(container.querySelector('main').className).toMatch(/\bhidden\b/);
    expect(container.querySelector('aside').className).not.toMatch(/\bhidden\b/);
  });

  test('hides the dashboard header on mobile when a conversation is selected', async () => {
    useQueue.mockReturnValue([{ id: 'c1', contactDisplayName: 'Carlos', status: 'waiting', assignedAgentId: null }]);
    useMyConversations.mockReturnValue([]);
    const { container } = renderDashboard();
    await userEvent.click(screen.getByText('Carlos'));

    expect(container.querySelector('header').className).toMatch(/\bhidden\b/);
    expect(container.querySelector('[data-testid="channel-banner-wrapper"]').className).toMatch(/\bhidden\b/);
  });

  test('uses the dynamic viewport height unit so mobile browser chrome cannot cover the composer', () => {
    useQueue.mockReturnValue([]);
    useMyConversations.mockReturnValue([]);
    const { container } = renderDashboard();
    expect(container.firstChild.className).toContain('h-dvh');
  });

  test('renders the team panel', () => {
    useQueue.mockReturnValue([]);
    useMyConversations.mockReturnValue([]);
    renderDashboard();
    expect(screen.getByText('Equipe')).toBeInTheDocument();
    expect(screen.getByText(/nenhum atendente cadastrado/i)).toBeInTheDocument();
  });

  test('shows the sound toggle button reflecting the unmuted state', () => {
    useQueue.mockReturnValue([]);
    useMyConversations.mockReturnValue([]);
    renderDashboard();
    expect(screen.getByRole('button', { name: /som ativado/i })).toBeInTheDocument();
  });

  test('shows the sound toggle button reflecting the muted state', () => {
    useQueue.mockReturnValue([]);
    useMyConversations.mockReturnValue([]);
    useQueueNotificationSound.mockReturnValue({ muted: true, toggleMuted: vi.fn() });
    renderDashboard();
    expect(screen.getByRole('button', { name: /som mutado/i })).toBeInTheDocument();
  });

  test('clicking the sound toggle button calls toggleMuted', async () => {
    useQueue.mockReturnValue([]);
    useMyConversations.mockReturnValue([]);
    const toggleMuted = vi.fn();
    useQueueNotificationSound.mockReturnValue({ muted: false, toggleMuted });
    renderDashboard();

    await userEvent.click(screen.getByRole('button', { name: /som ativado/i }));

    expect(toggleMuted).toHaveBeenCalledTimes(1);
  });
});
