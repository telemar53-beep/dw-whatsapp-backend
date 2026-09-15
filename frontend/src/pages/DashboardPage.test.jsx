import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom';
import { renderInShell } from '../test-utils/renderInShell';
import DashboardPage from './DashboardPage';
import { useAuth } from '../contexts/AuthContext';
import { useQueue } from '../hooks/useQueue';
import { useMyConversations } from '../hooks/useMyConversations';
import { useChannels } from '../hooks/useChannels';
import { useConversationMessages } from '../hooks/useConversationMessages';
import { useQuickReplies } from '../hooks/useQuickReplies';
import { useQueueNotificationSound } from '../hooks/useQueueNotificationSound';
import { useUnreadMyConversations } from '../hooks/useUnreadMyConversations';
import { closeConversation } from '../services/api';
import { useCompanyName } from '../hooks/useCompanyName';

vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal()),
  closeConversation: vi.fn(),
}));
vi.mock('../contexts/AuthContext');
vi.mock('../hooks/useQueue');
vi.mock('../hooks/useMyConversations');
vi.mock('../hooks/useChannels');
vi.mock('../hooks/useAgents', () => ({ useAgents: () => ({ agents: [], status: 'ready' }) }));
vi.mock('../hooks/usePresence', () => ({ usePresence: () => new Set() }));
vi.mock('../hooks/useConversationMessages');
vi.mock('../hooks/useQuickReplies');
vi.mock('../hooks/useQueueNotificationSound');
vi.mock('../hooks/useUnreadMyConversations');
vi.mock('../hooks/useCompanyName');
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
  closeConversation.mockResolvedValue({ id: 'c1', status: 'closed' });
  useCompanyName.mockReturnValue({ name: 'Net Fibra', status: 'ready' });
});

function renderDashboard() {
  return renderInShell(<DashboardPage />);
}

describe('DashboardPage', () => {
  // A tela vazia dizia "DW Telecom Atendimento": nome de provedor nenhum fica
  // no código.
  test('a tela sem conversa selecionada cita a empresa cadastrada', () => {
    useQueue.mockReturnValue({ queue: [], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [], status: 'ready' });
    renderDashboard();
    expect(screen.getByText('Net Fibra · Atendimento')).toBeInTheDocument();
  });

  test('sem empresa cadastrada, a tela vazia mostra só Atendimento', () => {
    useCompanyName.mockReturnValue({ name: '', status: 'ready' });
    useQueue.mockReturnValue({ queue: [], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [], status: 'ready' });
    renderDashboard();
    expect(screen.getByText('Atendimento')).toBeInTheDocument();
  });

  test('shows my conversations in the Andamento tab by default', () => {
    useQueue.mockReturnValue({ queue: [{ id: 'c1', contactDisplayName: 'Carlos' }], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [{ id: 'c2', contactDisplayName: 'Maria' }], status: 'ready' });
    renderDashboard();
    expect(screen.getByText('Maria')).toBeInTheDocument();
    expect(screen.queryByText('Carlos')).not.toBeInTheDocument();
  });

  test('exposes the tab strip as an ARIA tablist with the active tab marked aria-selected', async () => {
    useQueue.mockReturnValue({ queue: [], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [], status: 'ready' });
    renderDashboard();

    expect(screen.getByRole('tablist')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /andamento/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /espera/i })).toHaveAttribute('aria-selected', 'false');

    await userEvent.click(screen.getByRole('tab', { name: /espera/i }));

    expect(screen.getByRole('tab', { name: /andamento/i })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tab', { name: /espera/i })).toHaveAttribute('aria-selected', 'true');
  });

  test('exposes the active tab\'s content as an ARIA tabpanel labelled by that tab', () => {
    useQueue.mockReturnValue({ queue: [], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [], status: 'ready' });
    renderDashboard();

    const tab = screen.getByRole('tab', { name: /andamento/i });
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveAttribute('aria-labelledby', tab.id);
  });

  test('shows an unread indicator on a my-conversations item the hook reports as unread', () => {
    useQueue.mockReturnValue({ queue: [], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [{ id: 'c2', contactDisplayName: 'Maria' }], status: 'ready' });
    useUnreadMyConversations.mockReturnValue({ unreadIds: new Set(['c2']), clearUnread: vi.fn() });
    renderDashboard();
    expect(screen.getByTitle('Mensagem não lida')).toBeInTheDocument();
  });

  test('clears the unread flag when the attendant selects that conversation', async () => {
    const clearUnread = vi.fn();
    useQueue.mockReturnValue({ queue: [], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [{ id: 'c2', contactDisplayName: 'Maria' }], status: 'ready' });
    useUnreadMyConversations.mockReturnValue({ unreadIds: new Set(['c2']), clearUnread });
    renderDashboard();

    await userEvent.click(screen.getByText('Maria'));

    expect(clearUnread).toHaveBeenCalledWith('c2');
  });

  test('abre "Meu perfil" pelo contexto do shell e avisa quando uma conversa está aberta', async () => {
    useQueue.mockReturnValue({ queue: [], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [{ id: 'c1', contactDisplayName: 'Ana', status: 'assigned', channelId: 'ch1' }], status: 'ready' });
    const { ctx } = renderInShell(<DashboardPage />);
    await userEvent.click(await screen.findByText('Ana'));
    expect(ctx.setConversationOpen).toHaveBeenLastCalledWith(true);
  });

  test('shows the queue in the Espera tab after clicking it', async () => {
    useQueue.mockReturnValue({ queue: [{ id: 'c1', contactDisplayName: 'Carlos' }], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [{ id: 'c2', contactDisplayName: 'Maria' }], status: 'ready' });
    renderDashboard();

    await userEvent.click(screen.getByRole('tab', { name: /espera/i }));

    expect(screen.getByText('Carlos')).toBeInTheDocument();
    expect(screen.queryByText('Maria')).not.toBeInTheDocument();
  });

  test('separates conversations still in automatic triage into the Automação tab', async () => {
    useQueue.mockReturnValue({ queue: [
      { id: 'c1', contactDisplayName: 'Aguardando', triageState: null },
      { id: 'c2', contactDisplayName: 'Em Triagem', triageState: 'pending' },
    ], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [], status: 'ready' });
    renderDashboard();

    await userEvent.click(screen.getByRole('tab', { name: /espera/i }));
    expect(screen.getByText('Aguardando')).toBeInTheDocument();
    expect(screen.queryByText('Em Triagem')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: /automação/i }));
    expect(screen.getByText('Em Triagem')).toBeInTheDocument();
    expect(screen.queryByText('Aguardando')).not.toBeInTheDocument();
  });

  test('quick-closes a conversation from the Espera tab without asking for a reason', async () => {
    useQueue.mockReturnValue({ queue: [{ id: 'c1', contactDisplayName: 'Carlos', status: 'waiting', assignedAgentId: null }], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [], status: 'ready' });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderDashboard();

    await userEvent.click(screen.getByRole('tab', { name: /espera/i }));
    await userEvent.click(screen.getByRole('button', { name: /finalizar/i }));

    expect(closeConversation).toHaveBeenCalledWith('c1', null, 'tok-123');
    window.confirm.mockRestore();
  });

  test('quick-closes a conversation from the Automação tab without asking for a reason', async () => {
    useQueue.mockReturnValue({ queue: [{ id: 'c2', contactDisplayName: 'Em Triagem', triageState: 'pending', assignedAgentId: null }], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [], status: 'ready' });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderDashboard();

    await userEvent.click(screen.getByRole('tab', { name: /automação/i }));
    await userEvent.click(screen.getByRole('button', { name: /finalizar/i }));

    expect(closeConversation).toHaveBeenCalledWith('c2', null, 'tok-123');
    window.confirm.mockRestore();
  });

  test('does not show a quick-close button in the Andamento tab', () => {
    useQueue.mockReturnValue({ queue: [], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [{ id: 'c3', contactDisplayName: 'Minha' }], status: 'ready' });
    renderDashboard();

    expect(screen.queryByRole('button', { name: /finalizar/i })).not.toBeInTheDocument();
  });

  test('shows a badge with the count on each tab', () => {
    useQueue.mockReturnValue({ queue: [
      { id: 'c1', contactDisplayName: 'Aguardando', triageState: null },
      { id: 'c2', contactDisplayName: 'Em Triagem', triageState: 'pending' },
    ], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [{ id: 'c3', contactDisplayName: 'Minha' }], status: 'ready' });
    renderDashboard();

    expect(screen.getByRole('tab', { name: /andamento/i }).textContent).toContain('1');
    expect(screen.getByRole('tab', { name: /espera/i }).textContent).toContain('1');
    expect(screen.getByRole('tab', { name: /automação/i }).textContent).toContain('1');
  });

  test('does not show a badge on a tab with no items', () => {
    useQueue.mockReturnValue({ queue: [], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [], status: 'ready' });
    renderDashboard();

    const inProgressButton = screen.getByRole('tab', { name: /andamento/i });
    expect(inProgressButton.querySelector('span')).not.toBeInTheDocument();
  });

  test('selecting a conversation from the Espera tab opens the conversation view', async () => {
    useQueue.mockReturnValue({ queue: [{ id: 'c1', contactDisplayName: 'Carlos', status: 'waiting', assignedAgentId: null }], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [], status: 'ready' });
    renderDashboard();
    await userEvent.click(screen.getByRole('tab', { name: /espera/i }));
    await userEvent.click(screen.getByText('Carlos'));
    expect(screen.getByRole('button', { name: /assumir/i })).toBeInTheDocument();
  });

  test('shows a placeholder when no conversation is selected', () => {
    useQueue.mockReturnValue({ queue: [], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [], status: 'ready' });
    renderDashboard();
    expect(screen.getByText(/selecione uma conversa/i)).toBeInTheDocument();
  });

  // O link "Administração" era do NavRail próprio da página; agora mora só no
  // SideNav do AppShell (label "Configurações", coberto em SideNav.test.jsx).
  // NavRail some de vez na Task 18 — não há substituto dentro de DashboardPage.
  test.skip('shows an Administração link for an admin agent', () => {
    useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'agent-1', role: 'admin' }, logout: vi.fn() });
    useQueue.mockReturnValue({ queue: [], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [], status: 'ready' });
    renderDashboard();
    expect(screen.getByRole('link', { name: /administração/i })).toBeInTheDocument();
  });

  // Mesmo motivo do teste acima: o link só existia no NavRail da própria página.
  test.skip('hides the Administração link for a non-admin agent', () => {
    useQueue.mockReturnValue({ queue: [], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [], status: 'ready' });
    renderDashboard();
    expect(screen.queryByRole('link', { name: /administração/i })).not.toBeInTheDocument();
  });

  // Equivalente real: SideNav.test.jsx > 'clica em "Meu perfil" chama onProfileClick'.
  test.skip('opens the profile modal from the header', async () => {
    useQueue.mockReturnValue({ queue: [], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [], status: 'ready' });
    renderDashboard();

    expect(screen.queryByText(/meu perfil/i)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /^meu perfil$/i }));

    expect(screen.getByText(/meu perfil/i)).toBeInTheDocument();
  });

  test('shows an Iniciar conversa button for any attendant', () => {
    useQueue.mockReturnValue({ queue: [], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [], status: 'ready' });
    renderDashboard();
    expect(screen.getByRole('button', { name: /iniciar conversa/i })).toBeInTheDocument();
  });

  test('starting a conversation opens it immediately, even before it appears in myConversations', async () => {
    useQueue.mockReturnValue({ queue: [], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [], status: 'ready' });
    renderDashboard();

    await userEvent.click(screen.getByRole('button', { name: /iniciar conversa/i }));
    await userEvent.click(screen.getByText('Mock Start Conversation'));

    expect(screen.getByRole('button', { name: /transferir/i })).toBeInTheDocument();
  });

  test('clears the pending conversation once it appears in myConversations, so a later close is not masked by stale state', async () => {
    useQueue.mockReturnValue({ queue: [], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [], status: 'ready' });
    // rerender precisa da mesma casca de Outlet+context usada por renderInShell;
    // como o teste remonta a árvore inteira a cada rerender (já era assim antes
    // desta task, com um MemoryRouter novo por chamada), montamos a árvore aqui.
    const ctx = { openProfile: vi.fn(), closeMobileNav: vi.fn(), profileVersion: 0, setConversationOpen: vi.fn() };
    const shellTree = () => (
      <MemoryRouter>
        <Routes>
          <Route element={<Outlet context={ctx} />}>
            <Route path="/" element={<DashboardPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );
    const { rerender } = render(shellTree());

    await userEvent.click(screen.getByRole('button', { name: /iniciar conversa/i }));
    await userEvent.click(screen.getByText('Mock Start Conversation'));
    expect(screen.getByRole('button', { name: /transferir/i })).toBeInTheDocument();

    useMyConversations.mockReturnValue({ conversations: [
      { id: 'conv-new', contactPhoneNumber: '5598999990000', assignedAgentId: 'agent-1', status: 'assigned' },
    ], status: 'ready' });
    rerender(shellTree());
    expect(screen.getByRole('button', { name: /transferir/i })).toBeInTheDocument();

    useMyConversations.mockReturnValue({ conversations: [], status: 'ready' });
    rerender(shellTree());
    expect(screen.queryByRole('button', { name: /transferir/i })).not.toBeInTheDocument();
    expect(screen.getByText(/selecione uma conversa/i)).toBeInTheDocument();
  });

  // O link "Relatório" era do NavRail próprio da página; agora mora só no
  // SideNav do AppShell (label "Relatórios", coberto em SideNav.test.jsx).
  // NavRail some de vez na Task 18 — não há substituto dentro de DashboardPage.
  test.skip('shows a Relatório link for any attendant', () => {
    useQueue.mockReturnValue({ queue: [], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [], status: 'ready' });
    renderDashboard();
    expect(screen.getByRole('link', { name: /relatório/i })).toBeInTheDocument();
  });

  test('shows the list and hides the conversation panel on mobile when nothing is selected', () => {
    useQueue.mockReturnValue({ queue: [], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [], status: 'ready' });
    const { container } = renderDashboard();
    const aside = container.querySelector('aside');
    const main = container.querySelector('main');
    expect(aside.className).not.toMatch(/\bhidden\b/);
    expect(main.className).toMatch(/\bhidden\b/);
  });

  test('shows the conversation panel and hides the list on mobile when a conversation is selected', async () => {
    useQueue.mockReturnValue({ queue: [{ id: 'c1', contactDisplayName: 'Carlos', status: 'waiting', assignedAgentId: null }], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [], status: 'ready' });
    const { container } = renderDashboard();
    await userEvent.click(screen.getByRole('tab', { name: /espera/i }));
    await userEvent.click(screen.getByText('Carlos'));

    const aside = container.querySelector('aside');
    const main = container.querySelector('main');
    expect(main.className).not.toMatch(/\bhidden\b/);
    expect(aside.className).toMatch(/\bhidden\b/);
  });

  test('clicking the back button in the conversation view returns to the list', async () => {
    useQueue.mockReturnValue({ queue: [{ id: 'c1', contactDisplayName: 'Carlos', status: 'waiting', assignedAgentId: null }], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [], status: 'ready' });
    const { container } = renderDashboard();
    await userEvent.click(screen.getByRole('tab', { name: /espera/i }));
    await userEvent.click(screen.getByText('Carlos'));
    expect(container.querySelector('main').className).not.toMatch(/\bhidden\b/);

    await userEvent.click(screen.getByRole('button', { name: /voltar para a lista/i }));

    expect(container.querySelector('main').className).toMatch(/\bhidden\b/);
    expect(container.querySelector('aside').className).not.toMatch(/\bhidden\b/);
  });

  test('hides the conversation list and the channel banner on mobile when a conversation is selected', async () => {
    useQueue.mockReturnValue({ queue: [{ id: 'c1', contactDisplayName: 'Carlos', status: 'waiting', assignedAgentId: null }], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [], status: 'ready' });
    const { container } = renderDashboard();
    await userEvent.click(screen.getByRole('tab', { name: /espera/i }));
    await userEvent.click(screen.getByText('Carlos'));

    expect(container.querySelector('aside').className).toMatch(/\bhidden\b/);
    expect(container.querySelector('[data-testid="channel-banner-wrapper"]').className).toMatch(/\bhidden\b/);
  });

  // Equivalente real: AppShell.test.jsx > 'a raiz usa h-dvh para a altura da viewport'.
  test.skip('uses the dynamic viewport height unit so mobile browser chrome cannot cover the composer', () => {
    useQueue.mockReturnValue({ queue: [], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [], status: 'ready' });
    const { container } = renderDashboard();
    expect(container.firstChild.className).toContain('h-dvh');
  });

  test('renders the team panel', () => {
    useQueue.mockReturnValue({ queue: [], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [], status: 'ready' });
    renderDashboard();
    expect(screen.getByText('Equipe')).toBeInTheDocument();
    expect(screen.getByText(/nenhum atendente cadastrado/i)).toBeInTheDocument();
  });

  test('em carregamento não mostra "Nenhum atendimento em andamento"', () => {
    useQueue.mockReturnValue({ queue: [], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [], status: 'loading' });
    renderDashboard();
    expect(screen.queryByText(/nenhum atendimento em andamento/i)).not.toBeInTheDocument();
  });

  test('em carregamento não mostra "Nenhum atendimento em espera"', async () => {
    useQueue.mockReturnValue({ queue: [], status: 'loading' });
    useMyConversations.mockReturnValue({ conversations: [], status: 'ready' });
    renderDashboard();
    await userEvent.click(screen.getByRole('tab', { name: /espera/i }));
    expect(screen.queryByText(/nenhum atendimento em espera/i)).not.toBeInTheDocument();
  });

  // Equivalente real: SideNav.test.jsx > 'mostra as iniciais da empresa e o botão de som'.
  test.skip('shows the sound toggle button reflecting the unmuted state', () => {
    useQueue.mockReturnValue({ queue: [], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [], status: 'ready' });
    renderDashboard();
    expect(screen.getByRole('button', { name: /som ativado/i })).toBeInTheDocument();
  });

  // Equivalente real: SideNav.test.jsx > 'com o som mutado, o botão vira "Som desativado"'.
  test.skip('shows the sound toggle button reflecting the muted state', () => {
    useQueue.mockReturnValue({ queue: [], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [], status: 'ready' });
    useQueueNotificationSound.mockReturnValue({ muted: true, toggleMuted: vi.fn() });
    renderDashboard();
    expect(screen.getByRole('button', { name: /som desativado/i })).toBeInTheDocument();
  });

  // Equivalente real: SideNav.test.jsx > 'clicar no botão de som chama toggleMuted'.
  test.skip('clicking the sound toggle button calls toggleMuted', async () => {
    useQueue.mockReturnValue({ queue: [], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [], status: 'ready' });
    const toggleMuted = vi.fn();
    useQueueNotificationSound.mockReturnValue({ muted: false, toggleMuted });
    renderDashboard();

    await userEvent.click(screen.getByRole('button', { name: /som ativado/i }));

    expect(toggleMuted).toHaveBeenCalledTimes(1);
  });

  // O link "Dashboard de atendimento" era do NavRail próprio da página; agora
  // mora só no SideNav do AppShell (coberto em SideNav.test.jsx). NavRail
  // some de vez na Task 18 — não há substituto dentro de DashboardPage.
  test.skip('shows a link to the attendance dashboard for an admin, and not for a regular agent', () => {
    useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'agent-1', role: 'admin' }, logout: vi.fn() });
    useQueue.mockReturnValue({ queue: [], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [], status: 'ready' });
    renderDashboard();
    expect(screen.getByLabelText('Dashboard de atendimento')).toBeInTheDocument();
  });

  test.skip('does not show the attendance dashboard link for a non-admin agent', () => {
    useQueue.mockReturnValue({ queue: [], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [], status: 'ready' });
    renderDashboard();
    expect(screen.queryByLabelText('Dashboard de atendimento')).not.toBeInTheDocument();
  });

  test('opens a conversation passed in via location.state.pendingConversation, even when not in queue or myConversations', () => {
    useQueue.mockReturnValue({ queue: [], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [], status: 'ready' });
    renderInShell(<DashboardPage />, {
      initialEntries: [
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
      ],
    });
    expect(screen.getByText('Cliente de Outro Atendente')).toBeInTheDocument();
  });
});
