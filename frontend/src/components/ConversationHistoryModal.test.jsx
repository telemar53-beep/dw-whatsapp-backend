import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ConversationHistoryModal from './ConversationHistoryModal';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
});

describe('ConversationHistoryModal', () => {
  test('lists previous closed conversations for the contact', async () => {
    api.getConversationHistory.mockResolvedValue([
      { id: 'conv-old', channelName: 'Berg', channelType: 'baileys', updatedAt: '2026-08-01T12:00:00.000Z' },
    ]);
    render(<ConversationHistoryModal contactId="contact-1" onClose={vi.fn()} />);

    expect(await screen.findByText('Berg')).toBeInTheDocument();
    expect(api.getConversationHistory).toHaveBeenCalledWith('contact-1', 'tok-123');
  });

  test('shows a message when there is no previous history', async () => {
    api.getConversationHistory.mockResolvedValue([]);
    render(<ConversationHistoryModal contactId="contact-1" onClose={vi.fn()} />);

    expect(await screen.findByText(/nenhum atendimento anterior/i)).toBeInTheDocument();
  });

  test('opens a previous conversation and shows its messages read-only', async () => {
    api.getConversationHistory.mockResolvedValue([
      { id: 'conv-old', channelName: 'Berg', channelType: 'baileys', updatedAt: '2026-08-01T12:00:00.000Z' },
    ]);
    api.getMessages.mockResolvedValue([
      { id: 'm1', direction: 'inbound', content: 'Problema resolvido semana passada', messageType: 'text' },
    ]);
    render(<ConversationHistoryModal contactId="contact-1" onClose={vi.fn()} />);

    await userEvent.click(await screen.findByText('Berg'));

    await waitFor(() => expect(api.getMessages).toHaveBeenCalledWith('conv-old', 'tok-123'));
    expect(await screen.findByText('Problema resolvido semana passada')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/digite uma mensagem/i)).not.toBeInTheDocument();
  });

  test('goes back to the list from a conversation view', async () => {
    api.getConversationHistory.mockResolvedValue([
      { id: 'conv-old', channelName: 'Berg', channelType: 'baileys', updatedAt: '2026-08-01T12:00:00.000Z' },
    ]);
    api.getMessages.mockResolvedValue([]);
    render(<ConversationHistoryModal contactId="contact-1" onClose={vi.fn()} />);

    await userEvent.click(await screen.findByText('Berg'));
    await waitFor(() => expect(screen.getByRole('button', { name: /voltar/i })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /voltar/i }));

    expect(screen.getByText('Atendimentos anteriores')).toBeInTheDocument();
  });

  test('calls onClose when Fechar is clicked', async () => {
    api.getConversationHistory.mockResolvedValue([]);
    const onClose = vi.fn();
    render(<ConversationHistoryModal contactId="contact-1" onClose={onClose} />);

    await userEvent.click(await screen.findByRole('button', { name: /fechar/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
