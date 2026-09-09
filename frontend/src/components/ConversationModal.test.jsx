import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ConversationModal from './ConversationModal';
import { useConversationMessages } from '../hooks/useConversationMessages';
import { useQuickReplies } from '../hooks/useQuickReplies';
import { useAuth } from '../contexts/AuthContext';

vi.mock('../hooks/useConversationMessages');
vi.mock('../hooks/useQuickReplies');
vi.mock('../contexts/AuthContext');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'agent-1', role: 'agent' } });
  useConversationMessages.mockReturnValue({ messages: [], sendMessage: vi.fn() });
  useQuickReplies.mockReturnValue({ quickReplies: [], refresh: vi.fn() });
});

describe('ConversationModal', () => {
  test('renders the conversation inside a dialog', () => {
    const conversation = { id: 'c1', contactDisplayName: 'Carlos', assignedAgentId: 'agent-1', status: 'assigned' };
    render(<ConversationModal conversation={conversation} onClose={vi.fn()} onTransferClick={vi.fn()} />);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Carlos')).toBeInTheDocument();
  });

  test('closing via the conversation view\'s back button calls onClose', async () => {
    const onClose = vi.fn();
    const conversation = { id: 'c1', contactDisplayName: 'Carlos', assignedAgentId: 'agent-1', status: 'assigned' };
    render(<ConversationModal conversation={conversation} onClose={onClose} onTransferClick={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /voltar para a lista/i }));

    expect(onClose).toHaveBeenCalled();
  });

  test('clicking the transfer icon calls onTransferClick with the conversation id', async () => {
    const onTransferClick = vi.fn();
    const conversation = { id: 'c1', contactDisplayName: 'Carlos', assignedAgentId: 'agent-1', status: 'assigned' };
    render(<ConversationModal conversation={conversation} onClose={vi.fn()} onTransferClick={onTransferClick} />);

    await userEvent.click(screen.getByRole('button', { name: /transferir atendimento/i }));

    expect(onTransferClick).toHaveBeenCalledWith('c1');
  });
});
