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

vi.mock('../contexts/AuthContext');
vi.mock('../hooks/useQueue');
vi.mock('../hooks/useMyConversations');
vi.mock('../hooks/useChannels');
vi.mock('../hooks/useAgents', () => ({ useAgents: () => [] }));
vi.mock('../hooks/useConversationMessages');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'agent-1', role: 'agent' }, logout: vi.fn() });
  useChannels.mockReturnValue({ channels: [], loading: false, refresh: vi.fn() });
  // DashboardPage's own wiring is what this file tests — ConversationView's
  // internals (already covered by Task 7's ConversationView.test.jsx) are
  // stubbed out here so selecting a conversation doesn't trigger a real,
  // unmocked fetch via the real useConversationMessages/services/api.
  useConversationMessages.mockReturnValue({ messages: [], sendMessage: vi.fn() });
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
});
