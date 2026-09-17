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

  test('em carregamento não mostra "Nenhum atendimento anterior"', () => {
    api.getConversationHistory.mockReturnValue(new Promise(() => {}));
    render(<ConversationHistoryModal contactId="contact-1" onClose={vi.fn()} />);

    expect(screen.queryByText(/nenhum atendimento anterior/i)).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  test('calls onClose when Fechar is clicked', async () => {
    api.getConversationHistory.mockResolvedValue([]);
    const onClose = vi.fn();
    render(<ConversationHistoryModal contactId="contact-1" onClose={onClose} />);

    await userEvent.click(await screen.findByRole('button', { name: /fechar/i }));
    expect(onClose).toHaveBeenCalled();
  });
});

// A data sozinha não ajuda quem vai retomar o atendimento: quem falou com o
// cliente, quem encerrou e por quê é o que permite continuar de onde parou.
describe('quem atendeu, quem encerrou e por quê', () => {
  function renderComHistorico(conversation) {
    api.getConversationHistory.mockResolvedValue([
      { id: 'conv-1', channelName: 'DW Telcom 1', channelType: 'baileys', updatedAt: '2026-09-17T12:00:00.000Z', ...conversation },
    ]);
    render(<ConversationHistoryModal contactId="contact-1" onClose={vi.fn()} />);
  }

  test('mostra um nome só quando quem atendeu também encerrou', async () => {
    renderComHistorico({ assignedAgentName: 'Tatiane', closedByAgentName: 'Tatiane' });

    expect(await screen.findByText(/DW Telcom 1 · Tatiane/)).toBeInTheDocument();
  });

  test('mostra os dois nomes quando o admin encerrou o atendimento de outra pessoa', async () => {
    renderComHistorico({ assignedAgentName: 'Tatiane', closedByAgentName: 'Willemberg' });

    expect(await screen.findByText(/Atendido por Tatiane, encerrado por Willemberg/)).toBeInTheDocument();
  });

  test('mostra o motivo do encerramento', async () => {
    renderComHistorico({ assignedAgentName: 'Tatiane', closedByAgentName: 'Tatiane', closeReasonName: 'Segunda via de fatura' });

    expect(await screen.findByText(/Segunda via de fatura/)).toBeInTheDocument();
  });

  test('sem atendente, mostra só o canal', async () => {
    renderComHistorico({ assignedAgentName: null, closedByAgentName: null, closeReasonName: null });

    expect(await screen.findByText('DW Telcom 1')).toBeInTheDocument();
  });

  test('encerrado pela IA, sem atendente, ainda mostra o motivo', async () => {
    renderComHistorico({ assignedAgentName: null, closedByAgentName: null, closeReasonName: 'Resolvido pela IA' });

    expect(await screen.findByText(/Resolvido pela IA/)).toBeInTheDocument();
  });
});
