import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ConversationView from './ConversationView';
import { useAuth } from '../contexts/AuthContext';
import { useConversationMessages } from '../hooks/useConversationMessages';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../hooks/useConversationMessages');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'agent-1', role: 'agent' } });
  useConversationMessages.mockReturnValue({
    messages: [{ id: 'm1', direction: 'inbound', content: 'Oi, preciso de ajuda' }],
    sendMessage: vi.fn(),
  });
});

describe('ConversationView', () => {
  test('renders the message history', () => {
    render(<ConversationView conversation={{ id: 'c1', status: 'waiting', assignedAgentId: null }} onTransferClick={vi.fn()} />);
    expect(screen.getByText('Oi, preciso de ajuda')).toBeInTheDocument();
  });

  test('shows the Assumir button when the conversation is unassigned', () => {
    render(<ConversationView conversation={{ id: 'c1', status: 'waiting', assignedAgentId: null }} onTransferClick={vi.fn()} />);
    expect(screen.getByRole('button', { name: /assumir/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /transferir/i })).not.toBeInTheDocument();
  });

  test('clicking Assumir calls claimConversation', async () => {
    api.claimConversation.mockResolvedValue({});
    render(<ConversationView conversation={{ id: 'c1', status: 'waiting', assignedAgentId: null }} onTransferClick={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /assumir/i }));
    await waitFor(() => expect(api.claimConversation).toHaveBeenCalledWith('c1', 'tok-123'));
  });

  test('shows Transferir and Fechar when assigned to me', () => {
    render(
      <ConversationView
        conversation={{ id: 'c1', status: 'assigned', assignedAgentId: 'agent-1' }}
        onTransferClick={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: /transferir/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /fechar/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /assumir/i })).not.toBeInTheDocument();
  });

  test('clicking Fechar calls closeConversation', async () => {
    api.closeConversation.mockResolvedValue({});
    render(
      <ConversationView
        conversation={{ id: 'c1', status: 'assigned', assignedAgentId: 'agent-1' }}
        onTransferClick={vi.fn()}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: /fechar/i }));
    await waitFor(() => expect(api.closeConversation).toHaveBeenCalledWith('c1', 'tok-123'));
  });

  test('clicking Transferir calls onTransferClick with the conversation id', async () => {
    const onTransferClick = vi.fn();
    render(
      <ConversationView
        conversation={{ id: 'c1', status: 'assigned', assignedAgentId: 'agent-1' }}
        onTransferClick={onTransferClick}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: /transferir/i }));
    expect(onTransferClick).toHaveBeenCalledWith('c1');
  });

  test('shows neither action button when assigned to another agent', () => {
    render(
      <ConversationView
        conversation={{ id: 'c1', status: 'assigned', assignedAgentId: 'agent-OTHER' }}
        onTransferClick={vi.fn()}
      />
    );
    expect(screen.queryByRole('button', { name: /assumir/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /transferir/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /fechar/i })).not.toBeInTheDocument();
  });

  test('does not render the message input when the conversation is assigned to another agent or unassigned', () => {
    const { rerender } = render(
      <ConversationView
        conversation={{ id: 'c1', status: 'assigned', assignedAgentId: 'agent-OTHER' }}
        onTransferClick={vi.fn()}
      />
    );
    expect(screen.queryByPlaceholderText(/digite uma mensagem/i)).not.toBeInTheDocument();

    rerender(
      <ConversationView
        conversation={{ id: 'c1', status: 'waiting', assignedAgentId: null }}
        onTransferClick={vi.fn()}
      />
    );
    expect(screen.queryByPlaceholderText(/digite uma mensagem/i)).not.toBeInTheDocument();
  });

  test('renders the message input when the conversation is assigned to me', () => {
    render(
      <ConversationView
        conversation={{ id: 'c1', status: 'assigned', assignedAgentId: 'agent-1' }}
        onTransferClick={vi.fn()}
      />
    );
    expect(screen.getByPlaceholderText(/digite uma mensagem/i)).toBeInTheDocument();
  });
});
