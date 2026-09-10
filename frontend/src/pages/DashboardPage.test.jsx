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
import { useUnreadMyConversations } from '../hooks/useUnreadMyConversations';

vi.mock('../contexts/AuthContext');
vi.mock('../hooks/useQueue');
vi.mock('../hooks/useMyConversations');
vi.mock('../hooks/useChannels');
vi.mock('../hooks/useAgents', () => ({ useAgents: () => [] }));
vi.mock('../hooks/usePresence', () => ({ usePresence: () => new Set() }));
vi.mock('../hooks/useConversationMessages');
vi.mock('../hooks/useQuickReplies');
vi.mock('../hooks/useQueueNotificationSound');
vi.mock('../hooks/useUnreadMyConversations');
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
  useConversationMessages.mockReturnValue({ messages: [], sendMessage: vi.fn() });
  useQuickReplies.mockReturnValue({ quickReplies: [], refresh: vi.fn() });
  useQueueNotificationSound.mockReturnValue({ muted: false, toggleMuted: vi.fn() });
  useUnreadMyConversations.mockReturnValue({ unreadIds: new Set(), clearUnread: vi.fn() });
});

function renderDashboard() {
  return render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>
  );
}

describe('DashboardPage', () => {
  test('shows my conversations in the Andamento tab by default', () => {
    useQueue.mockReturnValue([{ id: 'c1', contactDisplayName: 'Carlos' }]);
    useMyConversations.mockReturnValue([{ id: 'c2', contactDisplayName: 'Maria' }]);
    renderDashboard();
    expect(screen.getByText('Maria')).toBeInTheDocument();
    expect(screen.queryByText('Carlos')).not.toBeInTheDocument();
  });

  test('exposes the tab strip as an ARIA tablist with the active tab marked aria-selected', async () => {
    useQueue.mockReturnValue([]);
    useMyConversations.mockReturnValue([]);
    renderDashboard();

    expect(screen.getByRole('tablist')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /andamento/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /espera/i })).toHaveAttribute('aria-selected', 'false');

    await userEvent.click(screen.getByRole('tab', { name: /espera/i }));

    expect(screen.getByRole('tab', { name: /andamento/i })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tab', { name: /espera/i })).toHaveAttribute('aria-selected', 'true');
  });

  test('exposes the active tab\'s content as an ARIA tabpanel labelled by that tab', () => {
    useQueue.mockReturnValue([]);
    useMyConversations.mockReturnValue([]);
    renderDashboard();

    const tab = screen.getByRole('tab', { name: /andamento/i });
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveAttribute('aria-labelledby', tab.id);
  });

  test('shows an unread indicator on a my-conversations item the hook reports as unread', () => {
    useQueue.mockReturnValue([]);
    useMyConversations.mockReturnValue([{ id: 'c2', contactDisplayName: 'Maria' }]);
    useUnreadMyConversations.mockReturnValue({ unreadIds: new Set(['c2']), clearUnread: vi.fn() });
    renderDashboard();
    expect(screen.getByTitle('Mensagem não lida')).toBeInTheDocument();
  });

  test('clears the unread flag when the attendant selects that conversation', async () => {
    const clearUnread = vi.fn();
    useQueue.mockReturnValue([]);
    useMyConversations.mockReturnValue([{ id: 'c2', contactDisplayName: 'Maria' }]);
    useUnreadMyConversations.mockReturnValue({ unreadIds: new Set(['c2']), clearUnread });
    renderDashboard();

    await userEvent.click(screen.getByText('Maria'));

    expect(clearUnread).toHaveBeenCalledWith('c2');
  });

  test('shows the queue in the Espera tab after clicking it', async () => {
    useQueue.mockReturnValue([{ id: 'c1', contactDisplayName: 'Carlos' }]);
    useMyConversations.mockReturnValue([{ id: 'c2', contactDisplayName: 'Maria' }]);
    renderDashboard();

    await userEvent.click(screen.getByRole('tab', { name: /espera/i }));

    expect(screen.getByText('Carlos')).toBeInTheDocument();
    expect(screen.queryByText('Maria')).not.toBeInTheDocument();
  });

  test('separates conversations still in automatic triage into the Automação tab', async () => {
    useQueue.mockReturnValue([
      { id: 'c1', contactDisplayName: 'Aguardando', triageState: null },
      { id: 'c2', contactDisplayName: 'Em Triagem', triageState: 'pending' },
    ]);
    useMyConversations.mockReturnValue([]);
    renderDashboard();

    await userEvent.click(screen.getByRole('tab', { name: /espera/i }));
    expect(screen.getByText('Aguardando')).toBeInTheDocument();
    expect(screen.queryByText('Em Triagem')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: /automação/i }));
    expect(screen.getByText('Em Triagem')).toBeInTheDocument();
    expect(screen.queryByText('Aguardando')).not.toBeInTheDocument();
  });

  test('shows a badge with the count on each tab', () => {
    useQueue.mockReturnValue([
      { id: 'c1', contactDisplayName: 'Aguardando', triageState: null },
      { id: 'c2', contactDisplayName: 'Em Triagem', triageState: 'pending' },
    ]);
    useMyConversations.mockReturnValue([{ id: 'c3', contactDisplayName: 'Minha' }]);
    renderDashboard();

    expect(screen.getByRole('tab', { name: /andamento/i }).textContent).toContain('1');
    expect(screen.getByRole('tab', { name: /espera/i }).textContent).toContain('1');
    expect(screen.getByRole('tab', { name: /automação/i }).textContent).toContain('1');
  });

  test('does not show a badge on a tab with no items', () => {
    useQueue.mockReturnValue([]);
    useMyConversations.mockReturnValue([]);
    renderDashboard();

    const inProgressButton = screen.getByRole('tab', { name: /andamento/i });
    expect(inProgressButton.querySelector('span')).not.toBeInTheDocument();
  });

  test('selecting a conversation from the Espera tab opens the conversation view', async () => {
    useQueue.mockReturnValue([{ id: 'c1', contactDisplayName: 'Carlos', status: 'waiting', assignedAgentId: null }]);
    useMyConversations.mockReturnValue([]);
    renderDashboard();
    await userEvent.click(screen.getByRole('tab', { name: /espera/i }));
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

  test('opens the profile modal from the header', async () => {
    useQueue.mockReturnValue([]);
    useMyConversations.mockReturnValue([]);
    renderDashboard();

    expect(screen.queryByText(/meu perfil/i)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /^meu perfil$/i }));

    expect(screen.getByText(/meu perfil/i)).toBeInTheDocument();
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

    useMyConversations.mockReturnValue([
      { id: 'conv-new', contactPhoneNumber: '5598999990000', assignedAgentId: 'agent-1', status: 'assigned' },
    ]);
    rerender(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );
    expect(screen.getByRole('button', { name: /transferir/i })).toBeInTheDocument();

    useMyConversations.mockReturnValue([]);
    rerender(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );
    expect(screen.queryByRole('button', { name: /transferir/i })).not.toBeInTheDocument();
    expect(screen.getByText(/selecione uma conversa/i)).toBeInTheDocument();
  });

  test('shows a Relatório link for any attendant', () => {
    useQueue.mockReturnValue([]);
    useMyConversations.mockReturnValue([]);
    renderDashboard();
    expect(screen.getByRole('link', { name: /relatório/i })).toBeInTheDocument();
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
    await userEvent.click(screen.getByRole('tab', { name: /espera/i }));
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
    await userEvent.click(screen.getByRole('tab', { name: /espera/i }));
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
    await userEvent.click(screen.getByRole('tab', { name: /espera/i }));
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

  test('shows a link to the attendance dashboard for an admin, and not for a regular agent', () => {
    useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'agent-1', role: 'admin' }, logout: vi.fn() });
    useQueue.mockReturnValue([]);
    useMyConversations.mockReturnValue([]);
    renderDashboard();
    expect(screen.getByLabelText('Dashboard de atendimento')).toBeInTheDocument();
  });

  test('does not show the attendance dashboard link for a non-admin agent', () => {
    useQueue.mockReturnValue([]);
    useMyConversations.mockReturnValue([]);
    renderDashboard();
    expect(screen.queryByLabelText('Dashboard de atendimento')).not.toBeInTheDocument();
  });

  test('opens a conversation passed in via location.state.pendingConversation, even when not in queue or myConversations', () => {
    useQueue.mockReturnValue([]);
    useMyConversations.mockReturnValue([]);
    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: '/',
            state: {
              pendingConversation: {
                id: 'conv-other-agent',
                contactDisplayName: 'Cliente de Outro Atendente',
                assignedAgentId: 'agent-2',
                status: 'assigned',
              },
            },
          },
        ]}
      >
        <DashboardPage />
      </MemoryRouter>
    );
    expect(screen.getByText('Cliente de Outro Atendente')).toBeInTheDocument();
  });
});
