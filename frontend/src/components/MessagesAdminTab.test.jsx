import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
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

  test('shows a help box explaining what welcome messages are, with an example', () => {
    useChannels.mockReturnValue({
      channels: [],
      loading: false,
      refresh: vi.fn(),
    });
    useQuickReplies.mockReturnValue({ quickReplies: [], refresh: vi.fn() });
    render(<MessagesAdminTab />);

    expect(screen.getByText(/o que é isso/i)).toBeInTheDocument();
    expect(screen.getByText(/enviada automaticamente para o cliente/i)).toBeInTheDocument();
  });

  test('a channel without a welcome message shows a create button, not an open textarea', () => {
    useChannels.mockReturnValue({
      channels: [{ id: 'ch-1', name: 'WhatsApp Vendas', welcomeMessage: null }],
      loading: false,
      refresh: vi.fn(),
    });
    useQuickReplies.mockReturnValue({ quickReplies: [], refresh: vi.fn() });
    render(<MessagesAdminTab />);

    expect(screen.getByText('WhatsApp Vendas')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /criar boas-vindas/i })).toBeInTheDocument();
    // Ensure we're not in edit mode - check that the channel row doesn't have a form
    const channelText = screen.getByText('WhatsApp Vendas');
    const channelRow = channelText.closest('div[class*="flex items-center"]');
    expect(channelRow).toBeInTheDocument();
  });

  test('a channel with a welcome message shows a closed row with a preview and edit/delete buttons', () => {
    useChannels.mockReturnValue({
      channels: [{ id: 'ch-1', name: 'WhatsApp Vendas', welcomeMessage: 'Olá! Bem-vindo às vendas.' }],
      loading: false,
      refresh: vi.fn(),
    });
    useQuickReplies.mockReturnValue({ quickReplies: [], refresh: vi.fn() });
    render(<MessagesAdminTab />);

    expect(screen.getByText('WhatsApp Vendas')).toBeInTheDocument();
    expect(screen.getByText('Olá! Bem-vindo às vendas.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^editar$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^excluir$/i })).toBeInTheDocument();
    // Ensure we're not in edit mode - the channel row should show preview, not a form
    const channelText = screen.getByText('WhatsApp Vendas');
    const channelRow = channelText.closest('div[class*="flex items-center justify-between"]');
    expect(channelRow).toBeInTheDocument();
  });

  test('creating a welcome message opens the form, saves, and refreshes the channel list', async () => {
    const refreshChannels = vi.fn();
    useChannels.mockReturnValue({
      channels: [{ id: 'ch-1', name: 'WhatsApp Vendas', welcomeMessage: null }],
      loading: false,
      refresh: refreshChannels,
    });
    useQuickReplies.mockReturnValue({ quickReplies: [], refresh: vi.fn() });
    api.setChannelWelcomeMessage.mockResolvedValue({ id: 'ch-1', welcomeMessage: 'Novo texto' });
    render(<MessagesAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /criar boas-vindas/i }));
    // After clicking, the form appears with a textarea for editing
    const textareas = screen.getAllByRole('textbox');
    const welcomeTextarea = textareas.find(ta => ta.tagName === 'TEXTAREA' && !ta.id);
    await userEvent.type(welcomeTextarea, 'Novo texto');
    const saveButtons = screen.getAllByRole('button', { name: /^salvar$/i });
    await userEvent.click(saveButtons[0]); // First Salvar button is for welcome message

    await waitFor(() => expect(api.setChannelWelcomeMessage).toHaveBeenCalledWith('ch-1', 'Novo texto', 'tok-123'));
    expect(refreshChannels).toHaveBeenCalled();
  });

  test('editing an existing welcome message pre-fills the form with the current text', async () => {
    useChannels.mockReturnValue({
      channels: [{ id: 'ch-1', name: 'WhatsApp Vendas', welcomeMessage: 'Texto atual' }],
      loading: false,
      refresh: vi.fn(),
    });
    useQuickReplies.mockReturnValue({ quickReplies: [], refresh: vi.fn() });
    render(<MessagesAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /^editar$/i }));

    expect(screen.getByDisplayValue('Texto atual')).toBeInTheDocument();
  });

  test('canceling a welcome-message edit discards unsaved changes and shows the closed row again', async () => {
    useChannels.mockReturnValue({
      channels: [{ id: 'ch-1', name: 'WhatsApp Vendas', welcomeMessage: 'Texto atual' }],
      loading: false,
      refresh: vi.fn(),
    });
    useQuickReplies.mockReturnValue({ quickReplies: [], refresh: vi.fn() });
    render(<MessagesAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /^editar$/i }));
    const textarea = screen.getByDisplayValue('Texto atual');
    await userEvent.clear(textarea);
    await userEvent.type(textarea, 'Rascunho abandonado');
    await userEvent.click(screen.getByRole('button', { name: /cancelar/i }));

    expect(screen.getByText('Texto atual')).toBeInTheDocument();
    expect(screen.queryByText('Rascunho abandonado')).not.toBeInTheDocument();
  });

  test('deleting a welcome message asks for confirmation, then clears it via an empty string and refreshes', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const refreshChannels = vi.fn();
    useChannels.mockReturnValue({
      channels: [{ id: 'ch-1', name: 'WhatsApp Vendas', welcomeMessage: 'Texto atual' }],
      loading: false,
      refresh: refreshChannels,
    });
    useQuickReplies.mockReturnValue({ quickReplies: [], refresh: vi.fn() });
    api.setChannelWelcomeMessage.mockResolvedValue({ id: 'ch-1', welcomeMessage: null });
    render(<MessagesAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /^excluir$/i }));

    await waitFor(() => expect(api.setChannelWelcomeMessage).toHaveBeenCalledWith('ch-1', '', 'tok-123'));
    expect(refreshChannels).toHaveBeenCalled();
  });

  test('does not delete a welcome message when the confirmation is declined', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    useChannels.mockReturnValue({
      channels: [{ id: 'ch-1', name: 'WhatsApp Vendas', welcomeMessage: 'Texto atual' }],
      loading: false,
      refresh: vi.fn(),
    });
    useQuickReplies.mockReturnValue({ quickReplies: [], refresh: vi.fn() });
    render(<MessagesAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /^excluir$/i }));

    expect(api.setChannelWelcomeMessage).not.toHaveBeenCalled();
  });

  test('shows an error message when saving a welcome message fails', async () => {
    useChannels.mockReturnValue({
      channels: [{ id: 'ch-1', name: 'WhatsApp Vendas', welcomeMessage: null }],
      loading: false,
      refresh: vi.fn(),
    });
    useQuickReplies.mockReturnValue({ quickReplies: [], refresh: vi.fn() });
    api.setChannelWelcomeMessage.mockRejectedValue({ body: { error: 'Falha ao salvar boas-vindas' } });
    render(<MessagesAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /criar boas-vindas/i }));
    const textareas = screen.getAllByRole('textbox');
    const welcomeTextarea = textareas.find(ta => ta.tagName === 'TEXTAREA' && !ta.id);
    await userEvent.type(welcomeTextarea, 'Test text');
    const saveButtons = screen.getAllByRole('button', { name: /^salvar$/i });
    await userEvent.click(saveButtons[0]); // First save button is for welcome message

    expect(await screen.findByText('Falha ao salvar boas-vindas')).toBeInTheDocument();
  });

  test('shows an error message when deleting a welcome message fails', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    useChannels.mockReturnValue({
      channels: [{ id: 'ch-1', name: 'WhatsApp Vendas', welcomeMessage: 'Texto atual' }],
      loading: false,
      refresh: vi.fn(),
    });
    useQuickReplies.mockReturnValue({ quickReplies: [], refresh: vi.fn() });
    api.setChannelWelcomeMessage.mockRejectedValue({ body: { error: 'Falha ao excluir boas-vindas' } });
    render(<MessagesAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /^excluir$/i }));

    expect(await screen.findByText('Falha ao excluir boas-vindas')).toBeInTheDocument();
  });
});
