import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ClosedConversationsModal from './ClosedConversationsModal';
import { useMyClosedConversations } from '../hooks/useMyClosedConversations';
import { useConversationMessages } from '../hooks/useConversationMessages';
import { useQuickReplies } from '../hooks/useQuickReplies';
import { useAuth } from '../contexts/AuthContext';

vi.mock('../hooks/useMyClosedConversations');
vi.mock('../hooks/useConversationMessages');
vi.mock('../hooks/useQuickReplies');
vi.mock('../contexts/AuthContext');

const CLOSED_CONVERSATION = {
  id: 'c-old',
  contactDisplayName: 'Ana Encerrada',
  status: 'closed',
  assignedAgentId: 'agent-1',
};

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'agent-1', role: 'agent' } });
  useConversationMessages.mockReturnValue({ messages: [], sendMessage: vi.fn() });
  useQuickReplies.mockReturnValue({ quickReplies: [], refresh: vi.fn() });
  useMyClosedConversations.mockReturnValue({
    items: [CLOSED_CONVERSATION],
    hasMore: false,
    loading: false,
    loadMore: vi.fn(),
    refresh: vi.fn(),
  });
});

describe('ClosedConversationsModal', () => {
  test('shows the agent\'s closed conversations', () => {
    render(<ClosedConversationsModal onClose={vi.fn()} />);
    expect(screen.getByText('Ana Encerrada')).toBeInTheDocument();
  });

  test('closing the dialog calls onClose', async () => {
    const onClose = vi.fn();
    render(<ClosedConversationsModal onClose={onClose} />);

    await userEvent.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalled();
  });

  test('selecting a closed conversation opens it read-only, without message input or action buttons', async () => {
    render(<ClosedConversationsModal onClose={vi.fn()} />);

    await userEvent.click(screen.getByText('Ana Encerrada'));

    expect(screen.queryByRole('button', { name: /transferir/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /fechar atendimento/i })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/mensagem/i)).not.toBeInTheDocument();
  });

  test('clicking Carregar mais calls loadMore', async () => {
    const loadMore = vi.fn();
    useMyClosedConversations.mockReturnValue({
      items: [CLOSED_CONVERSATION],
      hasMore: true,
      loading: false,
      loadMore,
      refresh: vi.fn(),
    });
    render(<ClosedConversationsModal onClose={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /carregar mais/i }));

    expect(loadMore).toHaveBeenCalled();
  });
});
