import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TransferModal from './TransferModal';
import { useAuth } from '../contexts/AuthContext';
import { useAgents } from '../hooks/useAgents';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../hooks/useAgents');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'agent-1' } });
  useAgents.mockReturnValue([
    { id: 'agent-1', email: 'me@dw.com', role: 'agent' },
    { id: 'agent-2', email: 'other@dw.com', role: 'agent' },
  ]);
});

describe('TransferModal', () => {
  test('lists every agent except myself', () => {
    render(<TransferModal conversationId="c1" onClose={vi.fn()} />);
    expect(screen.queryByText('me@dw.com')).not.toBeInTheDocument();
    expect(screen.getByText('other@dw.com')).toBeInTheDocument();
  });

  test('selecting an agent transfers the conversation and closes the modal', async () => {
    api.transferConversation.mockResolvedValue({});
    const onClose = vi.fn();
    render(<TransferModal conversationId="c1" onClose={onClose} />);

    await userEvent.click(screen.getByText('other@dw.com'));

    await waitFor(() => expect(api.transferConversation).toHaveBeenCalledWith('c1', 'agent-2', 'tok-123'));
    expect(onClose).toHaveBeenCalled();
  });

  test('clicking the cancel button closes the modal without transferring', async () => {
    const onClose = vi.fn();
    render(<TransferModal conversationId="c1" onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: /cancelar/i }));
    expect(onClose).toHaveBeenCalled();
    expect(api.transferConversation).not.toHaveBeenCalled();
  });
});
