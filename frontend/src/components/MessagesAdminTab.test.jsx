import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MessagesAdminTab from './MessagesAdminTab';
import { useQuickReplies } from '../hooks/useQuickReplies';
import { useChannels } from '../hooks/useChannels';
import { useAuth } from '../contexts/AuthContext';
import { useCityNotices } from '../hooks/useCityNotices';
import { useAgentsAdmin } from '../hooks/useAgentsAdmin';
import { useAssignmentMessageConfig } from '../hooks/useAssignmentMessageConfig';
import { useBusinessHoursConfig } from '../hooks/useBusinessHoursConfig';
import { useTemplates } from '../hooks/useTemplates';
import * as api from '../services/api';

vi.mock('../hooks/useQuickReplies');
vi.mock('../hooks/useChannels');
vi.mock('../contexts/AuthContext');
vi.mock('../hooks/useCityNotices');
vi.mock('../hooks/useAgentsAdmin');
vi.mock('../hooks/useAssignmentMessageConfig');
vi.mock('../hooks/useBusinessHoursConfig');
vi.mock('../hooks/useTemplates');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
  useChannels.mockReturnValue({ channels: [], loading: false, refresh: vi.fn() });
  useCityNotices.mockReturnValue({ cityNotices: [], loading: false, refresh: vi.fn() });
  useAgentsAdmin.mockReturnValue({ agents: [], loading: false, refresh: vi.fn() });
  useTemplates.mockReturnValue({ templates: [], loading: false, refresh: vi.fn() });
  useAssignmentMessageConfig.mockReturnValue({
    config: { id: null, enabled: false, openingMessage: '', closingMessage: '', agentIds: [], channelIds: [] },
    loading: false,
    refresh: vi.fn(),
  });
  useBusinessHoursConfig.mockReturnValue({
    config: { id: null, enabled: false, startTime: '08:00', endTime: '18:00', message: '' },
    loading: false,
    refresh: vi.fn(),
  });
});

describe('MessagesAdminTab', () => {
  test('shows the Templates section with its own create button', () => {
    useQuickReplies.mockReturnValue({ quickReplies: [], refresh: vi.fn() });
    render(<MessagesAdminTab />);

    expect(screen.getByText('Templates')).toBeInTheDocument();
    expect(screen.getByText(/cadastrar novo template/i)).toBeInTheDocument();
  });

  test('lists existing quick replies inside the Ver mensagens popup', async () => {
    useQuickReplies.mockReturnValue({
      quickReplies: [{ id: 'qr-1', title: 'Boas-vindas', content: 'Olá!' }],
      refresh: vi.fn(),
    });
    render(<MessagesAdminTab />);

    expect(screen.queryByText('Boas-vindas')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /ver mensagens \(1\)/i }));

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

    await userEvent.click(screen.getByRole('button', { name: /ver mensagens/i }));
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

    await userEvent.click(screen.getByRole('button', { name: /ver mensagens/i }));
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

    await userEvent.click(screen.getByRole('button', { name: /ver mensagens/i }));
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

    await userEvent.click(screen.getByRole('button', { name: /ver mensagens/i }));
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

    await userEvent.click(screen.getByRole('button', { name: /ver mensagens/i }));
    await userEvent.click(screen.getByRole('button', { name: /excluir/i }));

    expect(await screen.findByText('Falha ao excluir')).toBeInTheDocument();
  });

  test('shows a help popup for the welcome-message section when its button is clicked', async () => {
    useChannels.mockReturnValue({
      channels: [],
      loading: false,
      refresh: vi.fn(),
    });
    useQuickReplies.mockReturnValue({ quickReplies: [], refresh: vi.fn() });
    render(<MessagesAdminTab />);

    expect(screen.queryByText(/enviada automaticamente para o cliente assim que ele manda/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /o que é isso: boas-vindas por canal/i }));

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

  test('shows a help popup for the city-notice section when its button is clicked', async () => {
    useCityNotices.mockReturnValue({
      cityNotices: [{ id: 'city-1', name: 'Maracaçumé', notice: null }],
      loading: false,
      refresh: vi.fn(),
    });
    render(<MessagesAdminTab />);

    expect(screen.queryByText(/nesse momento nossa rede está passando/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /o que é isso: avisos por cidade/i }));

    expect(screen.getByText(/nesse momento nossa rede está passando/i)).toBeInTheDocument();
  });

  test('shows a message inviting the admin to register cities when none exist yet', () => {
    useCityNotices.mockReturnValue({ cityNotices: [], loading: false, refresh: vi.fn() });
    render(<MessagesAdminTab />);

    expect(screen.getByText(/nenhuma cidade cadastrada/i)).toBeInTheDocument();
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

  test('does not show the quick-reply create form until its button is clicked', () => {
    useQuickReplies.mockReturnValue({ quickReplies: [], refresh: vi.fn() });
    render(<MessagesAdminTab />);

    expect(screen.queryByText(/cadastrar nova resposta rápida/i)).not.toBeInTheDocument();
  });

  test('creating a quick reply opens the form, saves, refreshes, and closes the form', async () => {
    const refresh = vi.fn();
    useQuickReplies.mockReturnValue({ quickReplies: [], refresh });
    api.createQuickReply.mockResolvedValue({ id: 'qr-2', title: 'Nova', content: 'Texto' });
    render(<MessagesAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /criar resposta rápida/i }));
    await userEvent.type(screen.getByLabelText(/título/i), 'Nova');
    await userEvent.type(screen.getByLabelText(/mensagem/i), 'Texto');
    await userEvent.click(screen.getByRole('button', { name: /^cadastrar$/i }));

    await waitFor(() => expect(api.createQuickReply).toHaveBeenCalledWith({ title: 'Nova', content: 'Texto' }, 'tok-123'));
    expect(refresh).toHaveBeenCalled();
    expect(screen.queryByText(/cadastrar nova resposta rápida/i)).not.toBeInTheDocument();
  });

  test('canceling the create form hides it without creating anything', async () => {
    useQuickReplies.mockReturnValue({ quickReplies: [], refresh: vi.fn() });
    render(<MessagesAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /criar resposta rápida/i }));
    expect(screen.getByText(/cadastrar nova resposta rápida/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /^cancelar$/i }));

    expect(screen.queryByText(/cadastrar nova resposta rápida/i)).not.toBeInTheDocument();
    expect(api.createQuickReply).not.toHaveBeenCalled();
  });
});

describe('Atribuir um atendimento', () => {
  beforeEach(() => {
    useAgentsAdmin.mockReturnValue({
      agents: [
        { id: 'agent-1', name: 'Geovanna Silva', email: 'geovanna@dw.com' },
        { id: 'agent-2', name: 'Carlos Souza', email: 'carlos@dw.com' },
      ],
      loading: false,
      refresh: vi.fn(),
    });
  });

  test('shows a "Criar atribuição" button when no config exists yet', () => {
    useAssignmentMessageConfig.mockReturnValue({
      config: { id: null, enabled: false, openingMessage: '', closingMessage: '', agentIds: [], channelIds: [] },
      loading: false,
      refresh: vi.fn(),
    });
    render(<MessagesAdminTab />);
    expect(screen.getByRole('button', { name: 'Criar atribuição' })).toBeInTheDocument();
  });

  test('fills the form, saves and shows the closed summary', async () => {
    const refresh = vi.fn();
    useAssignmentMessageConfig.mockReturnValue({
      config: { id: null, enabled: false, openingMessage: '', closingMessage: '', agentIds: [], channelIds: [] },
      loading: false,
      refresh,
    });
    api.updateAssignmentMessageConfig.mockResolvedValue({
      id: 'config-1',
      enabled: false,
      openingMessage: 'Olá @chat_atendente',
      closingMessage: 'Tchau @chat_protocolo',
      agentIds: ['agent-1'],
      channelIds: [],
    });
    render(<MessagesAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: 'Criar atribuição' }));
    await userEvent.type(screen.getByLabelText(/mensagem de abertura/i), 'Olá @chat_atendente');
    await userEvent.type(screen.getByLabelText(/mensagem de encerramento/i), 'Tchau @chat_protocolo');
    await userEvent.click(screen.getByLabelText('Geovanna Silva'));
    await userEvent.click(screen.getByRole('button', { name: /^salvar$/i }));

    await waitFor(() =>
      expect(api.updateAssignmentMessageConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          openingMessage: 'Olá @chat_atendente',
          closingMessage: 'Tchau @chat_protocolo',
          agentIds: ['agent-1'],
        }),
        'tok-123'
      )
    );
    expect(refresh).toHaveBeenCalled();

    // The closed summary must reflect the saved config immediately, without depending
    // on refresh()'s network round-trip (which silently swallows its own errors).
    expect(screen.getByText(/1 atendentes, 0 canais/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Criar atribuição' })).not.toBeInTheDocument();
  });

  test('checking an already-checked agent unchecks it', async () => {
    useAssignmentMessageConfig.mockReturnValue({
      config: { id: null, enabled: false, openingMessage: '', closingMessage: '', agentIds: [], channelIds: [] },
      loading: false,
      refresh: vi.fn(),
    });
    render(<MessagesAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: 'Criar atribuição' }));
    const agentCheckbox = screen.getByLabelText('Geovanna Silva');
    await userEvent.click(agentCheckbox);
    expect(agentCheckbox).toBeChecked();
    await userEvent.click(agentCheckbox);
    expect(agentCheckbox).not.toBeChecked();
  });

  test('canceling while creating does not leave a stale draft on reopen', async () => {
    useAssignmentMessageConfig.mockReturnValue({
      config: { id: null, enabled: false, openingMessage: '', closingMessage: '', agentIds: [], channelIds: [] },
      loading: false,
      refresh: vi.fn(),
    });
    render(<MessagesAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: 'Criar atribuição' }));
    await userEvent.type(screen.getByLabelText(/mensagem de abertura/i), 'rascunho descartado');
    await userEvent.click(screen.getByRole('button', { name: /^cancelar$/i }));

    await userEvent.click(screen.getByRole('button', { name: 'Criar atribuição' }));
    expect(screen.getByLabelText(/mensagem de abertura/i)).toHaveValue('');
  });

  test('shows the closed-state summary with counts when a config already exists', () => {
    useAssignmentMessageConfig.mockReturnValue({
      config: {
        id: 'config-1',
        enabled: true,
        openingMessage: 'abertura',
        closingMessage: 'fechamento',
        agentIds: ['agent-1', 'agent-2'],
        channelIds: [],
      },
      loading: false,
      refresh: vi.fn(),
    });
    render(<MessagesAdminTab />);
    expect(screen.getByText(/2 atendentes/i)).toBeInTheDocument();
  });

  test('editing an existing config pre-fills the form fields', async () => {
    useAssignmentMessageConfig.mockReturnValue({
      config: {
        id: 'config-1',
        enabled: true,
        openingMessage: 'Texto de abertura',
        closingMessage: 'Texto de encerramento',
        agentIds: ['agent-1'],
        channelIds: [],
      },
      loading: false,
      refresh: vi.fn(),
    });
    render(<MessagesAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /^editar$/i }));

    expect(screen.getByLabelText(/mensagem de abertura/i)).toHaveValue('Texto de abertura');
    expect(screen.getByLabelText(/mensagem de encerramento/i)).toHaveValue('Texto de encerramento');
    expect(screen.getByLabelText('Geovanna Silva')).toBeChecked();
  });

  test('shows a help popup for the assignment-message section when its button is clicked', async () => {
    useAssignmentMessageConfig.mockReturnValue({
      config: { id: null, enabled: false, openingMessage: '', closingMessage: '', agentIds: [], channelIds: [] },
      loading: false,
      refresh: vi.fn(),
    });
    render(<MessagesAdminTab />);

    expect(screen.queryByText(/enviada automaticamente para o cliente quando um atendente assume/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /o que é isso: atribuir um atendimento/i }));

    expect(screen.getByText(/enviada automaticamente para o cliente quando um atendente assume/i)).toBeInTheDocument();
  });
});

describe('Horário de atendimento', () => {
  test('shows a "Criar" button when no config exists yet', () => {
    useBusinessHoursConfig.mockReturnValue({
      config: { id: null, enabled: false, startTime: '08:00', endTime: '18:00', message: '' },
      loading: false,
      refresh: vi.fn(),
    });
    render(<MessagesAdminTab />);
    expect(screen.getByRole('button', { name: 'Criar horário de atendimento' })).toBeInTheDocument();
  });

  test('fills the form, saves and shows the closed summary', async () => {
    const refresh = vi.fn();
    useBusinessHoursConfig.mockReturnValue({
      config: { id: null, enabled: false, startTime: '08:00', endTime: '18:00', message: '' },
      loading: false,
      refresh,
    });
    api.updateBusinessHoursConfig.mockResolvedValue({
      id: 'config-1',
      enabled: true,
      startTime: '09:00',
      endTime: '17:00',
      message: 'Atendemos de seg a sex, das 09:00 às 17:00.',
    });
    render(<MessagesAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: 'Criar horário de atendimento' }));
    await userEvent.click(screen.getByLabelText(/ativo/i));
    fireEvent.change(screen.getByLabelText(/hora de início/i), { target: { value: '09:00' } });
    fireEvent.change(screen.getByLabelText(/hora de fim/i), { target: { value: '17:00' } });
    await userEvent.type(screen.getByLabelText(/mensagem/i), 'Atendemos de seg a sex, das 09:00 às 17:00.');
    await userEvent.click(screen.getByRole('button', { name: /^salvar$/i }));

    await waitFor(() =>
      expect(api.updateBusinessHoursConfig).toHaveBeenCalledWith(
        { enabled: true, startTime: '09:00', endTime: '17:00', message: 'Atendemos de seg a sex, das 09:00 às 17:00.' },
        'tok-123'
      )
    );
    expect(refresh).toHaveBeenCalled();
    expect(screen.getByText(/09:00.*17:00/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Criar horário de atendimento' })).not.toBeInTheDocument();
  });

  test('canceling while creating does not leave a stale draft on reopen', async () => {
    useBusinessHoursConfig.mockReturnValue({
      config: { id: null, enabled: false, startTime: '08:00', endTime: '18:00', message: '' },
      loading: false,
      refresh: vi.fn(),
    });
    render(<MessagesAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: 'Criar horário de atendimento' }));
    await userEvent.type(screen.getByLabelText(/mensagem/i), 'rascunho descartado');
    await userEvent.click(screen.getByRole('button', { name: /^cancelar$/i }));

    await userEvent.click(screen.getByRole('button', { name: 'Criar horário de atendimento' }));
    expect(screen.getByLabelText(/mensagem/i)).toHaveValue('');
  });

  test('shows the closed-state summary with the configured window when a config already exists', () => {
    useBusinessHoursConfig.mockReturnValue({
      config: { id: 'config-1', enabled: true, startTime: '08:00', endTime: '18:00', message: 'aviso' },
      loading: false,
      refresh: vi.fn(),
    });
    render(<MessagesAdminTab />);
    expect(screen.getByText(/08:00.*18:00/)).toBeInTheDocument();
  });

  test('editing an existing config pre-fills the form fields', async () => {
    useBusinessHoursConfig.mockReturnValue({
      config: { id: 'config-1', enabled: true, startTime: '09:00', endTime: '17:00', message: 'Texto do aviso' },
      loading: false,
      refresh: vi.fn(),
    });
    render(<MessagesAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /^editar$/i }));

    expect(screen.getByLabelText(/hora de início/i)).toHaveValue('09:00');
    expect(screen.getByLabelText(/hora de fim/i)).toHaveValue('17:00');
    expect(screen.getByLabelText(/mensagem/i)).toHaveValue('Texto do aviso');
  });
});
