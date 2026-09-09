import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MessagesAdminTab from './MessagesAdminTab';
import { useQuickReplies } from '../hooks/useQuickReplies';
import { useChannels } from '../hooks/useChannels';
import { useAuth } from '../contexts/AuthContext';
import { useCityNotices } from '../hooks/useCityNotices';
import * as api from '../services/api';

vi.mock('../hooks/useQuickReplies');
vi.mock('../hooks/useChannels');
vi.mock('../contexts/AuthContext');
vi.mock('../hooks/useCityNotices');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
  useChannels.mockReturnValue({ channels: [], loading: false, refresh: vi.fn() });
  useCityNotices.mockReturnValue({ cityNotices: [], loading: false, refresh: vi.fn() });
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

    expect(screen.getByText(/enviada automaticamente para o cliente assim que ele manda/i)).toBeInTheDocument();
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
    const channelRow = screen.getByText('WhatsApp Vendas').closest('.rounded-2xl');
    expect(within(channelRow).queryByRole('textbox')).not.toBeInTheDocument();
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
    const channelRow = screen.getByText('WhatsApp Vendas').closest('.rounded-2xl');
    expect(within(channelRow).queryByRole('textbox')).not.toBeInTheDocument();
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
    await userEvent.click(screen.getByRole('button', { name: /^salvar$/i }));

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
    await userEvent.click(screen.getByRole('button', { name: /^salvar$/i }));

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

  test('shows a help box explaining what city notices are, with an example', () => {
    useCityNotices.mockReturnValue({ cityNotices: [], loading: false, refresh: vi.fn() });
    render(<MessagesAdminTab />);

    expect(screen.getByText(/nesse momento nossa rede está passando/i)).toBeInTheDocument();
  });

  test('a city without a notice shows a create button, not an open textarea', () => {
    useCityNotices.mockReturnValue({
      cityNotices: [{ id: 'city-1', name: 'Maracaçumé', notice: null }],
      loading: false,
      refresh: vi.fn(),
    });
    render(<MessagesAdminTab />);

    expect(screen.getByText('Maracaçumé')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /criar aviso/i })).toBeInTheDocument();
    const cityRow = screen.getByText('Maracaçumé').closest('.rounded-2xl');
    expect(within(cityRow).queryByRole('textbox')).not.toBeInTheDocument();
  });

  test('a city with a notice shows a closed row with status, preview, and edit/delete buttons', () => {
    useCityNotices.mockReturnValue({
      cityNotices: [{ id: 'city-1', name: 'Maracaçumé', notice: { message: 'Instabilidade na rede', enabled: true } }],
      loading: false,
      refresh: vi.fn(),
    });
    render(<MessagesAdminTab />);

    expect(screen.getByText('Maracaçumé')).toBeInTheDocument();
    expect(screen.getByText('Instabilidade na rede')).toBeInTheDocument();
    expect(screen.getByText('Ativo')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^editar$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^excluir$/i })).toBeInTheDocument();
    const cityRow = screen.getByText('Maracaçumé').closest('.rounded-2xl');
    expect(within(cityRow).queryByRole('textbox')).not.toBeInTheDocument();
  });

  test('a disabled notice shows the Inativo status instead of Ativo', () => {
    useCityNotices.mockReturnValue({
      cityNotices: [{ id: 'city-1', name: 'Maracaçumé', notice: { message: 'Instabilidade na rede', enabled: false } }],
      loading: false,
      refresh: vi.fn(),
    });
    render(<MessagesAdminTab />);

    expect(screen.getByText('Inativo')).toBeInTheDocument();
    expect(screen.queryByText('Ativo')).not.toBeInTheDocument();
  });

  test('creating a city notice opens the form, saves with the Ativo checkbox, and refreshes the list', async () => {
    const refresh = vi.fn();
    useCityNotices.mockReturnValue({
      cityNotices: [{ id: 'city-1', name: 'Maracaçumé', notice: null }],
      loading: false,
      refresh,
    });
    api.setCityNotice.mockResolvedValue({ id: 'notice-1', cityId: 'city-1', message: 'Instabilidade', enabled: true });
    render(<MessagesAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /criar aviso/i }));
    const textareas = screen.getAllByRole('textbox');
    const noticeTextarea = textareas.find((ta) => ta.tagName === 'TEXTAREA' && !ta.id);
    await userEvent.type(noticeTextarea, 'Instabilidade');
    await userEvent.click(screen.getByRole('checkbox', { name: /ativo/i }));
    await userEvent.click(screen.getByRole('button', { name: /^salvar$/i }));

    await waitFor(() => expect(api.setCityNotice).toHaveBeenCalledWith('city-1', 'Instabilidade', true, 'tok-123'));
    expect(refresh).toHaveBeenCalled();
  });

  test('editing an existing city notice pre-fills the text and the Ativo checkbox', async () => {
    useCityNotices.mockReturnValue({
      cityNotices: [{ id: 'city-1', name: 'Maracaçumé', notice: { message: 'Texto atual', enabled: true } }],
      loading: false,
      refresh: vi.fn(),
    });
    render(<MessagesAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /^editar$/i }));

    expect(screen.getByDisplayValue('Texto atual')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /ativo/i })).toBeChecked();
  });

  test('canceling a city-notice edit discards unsaved changes and shows the closed row again', async () => {
    useCityNotices.mockReturnValue({
      cityNotices: [{ id: 'city-1', name: 'Maracaçumé', notice: { message: 'Texto atual', enabled: true } }],
      loading: false,
      refresh: vi.fn(),
    });
    render(<MessagesAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /^editar$/i }));
    const textarea = screen.getByDisplayValue('Texto atual');
    await userEvent.clear(textarea);
    await userEvent.type(textarea, 'Rascunho abandonado');
    await userEvent.click(screen.getByRole('button', { name: /cancelar/i }));

    expect(screen.getByText('Texto atual')).toBeInTheDocument();
    expect(screen.queryByText('Rascunho abandonado')).not.toBeInTheDocument();
  });

  test('deleting a city notice asks for confirmation, then removes it and refreshes', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const refresh = vi.fn();
    useCityNotices.mockReturnValue({
      cityNotices: [{ id: 'city-1', name: 'Maracaçumé', notice: { message: 'Texto atual', enabled: true } }],
      loading: false,
      refresh,
    });
    api.deleteCityNotice.mockResolvedValue(undefined);
    render(<MessagesAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /^excluir$/i }));

    await waitFor(() => expect(api.deleteCityNotice).toHaveBeenCalledWith('city-1', 'tok-123'));
    expect(refresh).toHaveBeenCalled();
  });

  test('does not delete a city notice when the confirmation is declined', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    useCityNotices.mockReturnValue({
      cityNotices: [{ id: 'city-1', name: 'Maracaçumé', notice: { message: 'Texto atual', enabled: true } }],
      loading: false,
      refresh: vi.fn(),
    });
    render(<MessagesAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /^excluir$/i }));

    expect(api.deleteCityNotice).not.toHaveBeenCalled();
  });

  test('shows an error message when saving a city notice fails', async () => {
    useCityNotices.mockReturnValue({
      cityNotices: [{ id: 'city-1', name: 'Maracaçumé', notice: null }],
      loading: false,
      refresh: vi.fn(),
    });
    api.setCityNotice.mockRejectedValue({ body: { error: 'Falha ao salvar aviso' } });
    render(<MessagesAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /criar aviso/i }));
    const textareas = screen.getAllByRole('textbox');
    const noticeTextarea = textareas.find((ta) => ta.tagName === 'TEXTAREA' && !ta.id);
    await userEvent.type(noticeTextarea, 'Instabilidade');
    await userEvent.click(screen.getByRole('button', { name: /^salvar$/i }));

    expect(await screen.findByText('Falha ao salvar aviso')).toBeInTheDocument();
  });

  test('shows an error message when deleting a city notice fails', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    useCityNotices.mockReturnValue({
      cityNotices: [{ id: 'city-1', name: 'Maracaçumé', notice: { message: 'Texto atual', enabled: true } }],
      loading: false,
      refresh: vi.fn(),
    });
    api.deleteCityNotice.mockRejectedValue({ body: { error: 'Falha ao excluir aviso' } });
    render(<MessagesAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /^excluir$/i }));

    expect(await screen.findByText('Falha ao excluir aviso')).toBeInTheDocument();
  });
});
