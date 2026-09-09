import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MessagesAdminTab from './MessagesAdminTab';
import { useQuickReplies } from '../hooks/useQuickReplies';
import { useChannels } from '../hooks/useChannels';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../hooks/useQuickReplies');
vi.mock('../hooks/useChannels');
vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
  useChannels.mockReturnValue({ channels: [], loading: false, refresh: vi.fn() });
});

describe('MessagesAdminTab', () => {
  test('lists existing quick replies', () => {
    useQuickReplies.mockReturnValue({
      quickReplies: [{ id: 'qr-1', title: 'Boas-vindas', content: 'Olá!' }],
      refresh: vi.fn(),
    });
    render(<MessagesAdminTab />);

    expect(screen.getByText('Boas-vindas')).toBeInTheDocument();
    expect(screen.getByText('Olá!')).toBeInTheDocument();
  });

  test('editing a quick reply calls updateQuickReply and refreshes', async () => {
    const refresh = vi.fn();
    useQuickReplies.mockReturnValue({
      quickReplies: [{ id: 'qr-1', title: 'Boas-vindas', content: 'Olá!' }],
      refresh,
    });
    api.updateQuickReply.mockResolvedValue({ id: 'qr-1', title: 'Editado', content: 'Novo texto' });
    render(<MessagesAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /editar/i }));
    const titleInput = screen.getByDisplayValue('Boas-vindas');
    await userEvent.clear(titleInput);
    await userEvent.type(titleInput, 'Editado');
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));

    await waitFor(() =>
      expect(api.updateQuickReply).toHaveBeenCalledWith('qr-1', { title: 'Editado', content: 'Olá!' }, 'tok-123')
    );
    expect(refresh).toHaveBeenCalled();
  });

  test('canceling an edit discards unsaved changes', async () => {
    useQuickReplies.mockReturnValue({
      quickReplies: [{ id: 'qr-1', title: 'Boas-vindas', content: 'Olá!' }],
      refresh: vi.fn(),
    });
    render(<MessagesAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /editar/i }));
    const titleInput = screen.getByDisplayValue('Boas-vindas');
    await userEvent.clear(titleInput);
    await userEvent.type(titleInput, 'Rascunho abandonado');
    await userEvent.click(screen.getByRole('button', { name: /cancelar/i }));

    await userEvent.click(screen.getByRole('button', { name: /editar/i }));
    expect(screen.getByDisplayValue('Boas-vindas')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Rascunho abandonado')).not.toBeInTheDocument();
  });

  test('deleting a quick reply calls deleteQuickReply and refreshes', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const refresh = vi.fn();
    useQuickReplies.mockReturnValue({
      quickReplies: [{ id: 'qr-1', title: 'Boas-vindas', content: 'Olá!' }],
      refresh,
    });
    api.deleteQuickReply.mockResolvedValue(undefined);
    render(<MessagesAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /excluir/i }));

    await waitFor(() => expect(api.deleteQuickReply).toHaveBeenCalledWith('qr-1', 'tok-123'));
    expect(refresh).toHaveBeenCalled();
  });

  test('does not delete when the confirmation is declined', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    useQuickReplies.mockReturnValue({
      quickReplies: [{ id: 'qr-1', title: 'Boas-vindas', content: 'Olá!' }],
      refresh: vi.fn(),
    });
    render(<MessagesAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /excluir/i }));

    expect(api.deleteQuickReply).not.toHaveBeenCalled();
  });

  test('shows an error message when deleting fails', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    useQuickReplies.mockReturnValue({
      quickReplies: [{ id: 'qr-1', title: 'Boas-vindas', content: 'Olá!' }],
      refresh: vi.fn(),
    });
    api.deleteQuickReply.mockRejectedValue({ body: { error: 'Falha ao excluir' } });
    render(<MessagesAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /excluir/i }));

    expect(await screen.findByText('Falha ao excluir')).toBeInTheDocument();
  });

  test('lists a card per channel with an editable welcome message', () => {
    useChannels.mockReturnValue({
      channels: [
        { id: 'ch-1', name: 'WhatsApp Vendas', welcomeMessage: 'Olá! Bem-vindo às vendas.' },
        { id: 'ch-2', name: 'WhatsApp Suporte', welcomeMessage: null },
      ],
      loading: false,
      refresh: vi.fn(),
    });
    useQuickReplies.mockReturnValue({ quickReplies: [], refresh: vi.fn() });
    render(<MessagesAdminTab />);

    expect(screen.getByText('WhatsApp Vendas')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Olá! Bem-vindo às vendas.')).toBeInTheDocument();
    expect(screen.getByText('WhatsApp Suporte')).toBeInTheDocument();
  });

  test('saving a welcome message calls setChannelWelcomeMessage and refreshes the channel list', async () => {
    const refreshChannels = vi.fn();
    useChannels.mockReturnValue({
      channels: [{ id: 'ch-1', name: 'WhatsApp Vendas', welcomeMessage: '' }],
      loading: false,
      refresh: refreshChannels,
    });
    useQuickReplies.mockReturnValue({ quickReplies: [], refresh: vi.fn() });
    api.setChannelWelcomeMessage.mockResolvedValue({ id: 'ch-1', welcomeMessage: 'Novo texto' });
    render(<MessagesAdminTab />);

    const textarea = screen.getByPlaceholderText(/sem boas-vindas configurada/i);
    await userEvent.type(textarea, 'Novo texto');
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));

    await waitFor(() => expect(api.setChannelWelcomeMessage).toHaveBeenCalledWith('ch-1', 'Novo texto', 'tok-123'));
    expect(refreshChannels).toHaveBeenCalled();
  });

  test('shows an error message when saving a welcome message fails', async () => {
    useChannels.mockReturnValue({
      channels: [{ id: 'ch-1', name: 'WhatsApp Vendas', welcomeMessage: '' }],
      loading: false,
      refresh: vi.fn(),
    });
    useQuickReplies.mockReturnValue({ quickReplies: [], refresh: vi.fn() });
    api.setChannelWelcomeMessage.mockRejectedValue({ body: { error: 'Falha ao salvar boas-vindas' } });
    render(<MessagesAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));

    expect(await screen.findByText('Falha ao salvar boas-vindas')).toBeInTheDocument();
  });
});
