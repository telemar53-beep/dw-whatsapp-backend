import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import AdminChannelsPage from './AdminChannelsPage';
import { useChannels } from '../hooks/useChannels';
import { useAgentsAdmin } from '../hooks/useAgentsAdmin';
import { useAssignmentMessageConfig } from '../hooks/useAssignmentMessageConfig';
import { useQuickReplies } from '../hooks/useQuickReplies';
import { useSectors } from '../hooks/useSectors';
import { useCities } from '../hooks/useCities';
import { useTriage } from '../hooks/useTriage';
import { useTemplates } from '../hooks/useTemplates';
import { useCityNotices } from '../hooks/useCityNotices';
import { useAuth } from '../contexts/AuthContext';
import { setChannelTriageEnabled, setChannelWabaId, reconnectChannel, setChannelHidden, deleteChannel } from '../services/api';

vi.mock('../hooks/useChannels');
vi.mock('../hooks/useAgentsAdmin');
vi.mock('../hooks/useAssignmentMessageConfig');
vi.mock('../hooks/useQuickReplies');
vi.mock('../hooks/useSectors');
vi.mock('../hooks/useCities');
vi.mock('../hooks/useTriage');
vi.mock('../hooks/useTemplates');
vi.mock('../hooks/useCityNotices');
vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'admin-1', role: 'admin' } });
  useAgentsAdmin.mockReturnValue({ agents: [], refresh: vi.fn() });
  useAssignmentMessageConfig.mockReturnValue({
    config: { id: null, enabled: false, openingMessage: '', closingMessage: '', agentIds: [], channelIds: [] },
    loading: false,
    refresh: vi.fn(),
  });
  useQuickReplies.mockReturnValue({ quickReplies: [], refresh: vi.fn() });
  useSectors.mockReturnValue({ sectors: [], refresh: vi.fn() });
  useCities.mockReturnValue({ cities: [], refresh: vi.fn() });
  useTriage.mockReturnValue({ config: { questionText: 'Q', confirmationText: 'C', maxAttempts: 2 }, options: [], refresh: vi.fn() });
  useTemplates.mockReturnValue({ templates: [], refresh: vi.fn() });
  useCityNotices.mockReturnValue({ cityNotices: [], loading: false, refresh: vi.fn() });
});

describe('AdminChannelsPage', () => {
  test('lists every channel with its status', () => {
    useChannels.mockReturnValue({
      channels: [
        { id: 'ch1', type: 'baileys', name: 'Berg', phoneNumber: '+5598985004187', status: 'connected' },
        { id: 'ch2', type: 'meta_cloud', name: 'Suporte', phoneNumber: '+5511999990000', status: 'connected' },
      ],
      loading: false,
      refresh: vi.fn(),
    });
    render(
      <MemoryRouter>
        <AdminChannelsPage />
      </MemoryRouter>
    );
    expect(screen.getByText('Berg')).toBeInTheDocument();
    expect(screen.getByText('Suporte')).toBeInTheDocument();
  });

  test('shows the QR view for a channel awaiting_qr', () => {
    useChannels.mockReturnValue({
      channels: [{ id: 'ch1', type: 'baileys', name: 'Berg', phoneNumber: '+5598985004187', status: 'awaiting_qr' }],
      loading: false,
      refresh: vi.fn(),
    });
    render(
      <MemoryRouter>
        <AdminChannelsPage />
      </MemoryRouter>
    );
    expect(screen.getByText(/Escaneie o QR code/)).toBeInTheDocument();
  });

  test('shows a button to create a new channel', () => {
    useChannels.mockReturnValue({ channels: [], loading: false, refresh: vi.fn() });
    render(
      <MemoryRouter>
        <AdminChannelsPage />
      </MemoryRouter>
    );
    expect(screen.getByRole('button', { name: /criar canal/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/^nome/i)).not.toBeInTheDocument();
  });

  test('switches to the Atendentes tab and shows the agents list instead of channels', async () => {
    useChannels.mockReturnValue({
      channels: [{ id: 'ch1', type: 'baileys', name: 'Berg', phoneNumber: '+5598985004187', status: 'connected' }],
      loading: false,
      refresh: vi.fn(),
    });
    useAgentsAdmin.mockReturnValue({
      agents: [{ id: 'a1', name: 'Ana', email: 'ana@dw.com', role: 'agent', active: true, sectors: [] }],
      refresh: vi.fn(),
    });
    render(
      <MemoryRouter>
        <AdminChannelsPage />
      </MemoryRouter>
    );

    expect(screen.getByText('Berg')).toBeInTheDocument();
    expect(screen.queryByText('Ana')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /atendentes/i }));

    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.queryByText('Berg')).not.toBeInTheDocument();
  });

  test('switches to the Setores tab and shows the sector management UI', async () => {
    useChannels.mockReturnValue({
      channels: [{ id: 'ch1', type: 'baileys', name: 'Berg', phoneNumber: '+5598985004187', status: 'connected' }],
      loading: false,
      refresh: vi.fn(),
    });
    useSectors.mockReturnValue({
      sectors: [{ id: 'sector-1', name: 'Financeiro' }],
      refresh: vi.fn(),
    });
    render(
      <MemoryRouter>
        <AdminChannelsPage />
      </MemoryRouter>
    );

    expect(screen.getByText('Berg')).toBeInTheDocument();
    expect(screen.queryByText('Financeiro')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /setores/i }));

    expect(screen.getByText('Financeiro')).toBeInTheDocument();
    expect(screen.queryByText('Berg')).not.toBeInTheDocument();
  });

  test('switches to the Cidades tab and shows the city management UI', async () => {
    useChannels.mockReturnValue({
      channels: [{ id: 'ch1', type: 'baileys', name: 'Berg', phoneNumber: '+5598985004187', status: 'connected' }],
      loading: false,
      refresh: vi.fn(),
    });
    useCities.mockReturnValue({
      cities: [{ id: 'city-1', name: 'Bahia' }],
      refresh: vi.fn(),
    });
    render(
      <MemoryRouter>
        <AdminChannelsPage />
      </MemoryRouter>
    );

    expect(screen.getByText('Berg')).toBeInTheDocument();
    expect(screen.queryByText('Bahia')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /cidades/i }));

    expect(screen.getByText('Bahia')).toBeInTheDocument();
    expect(screen.queryByText('Berg')).not.toBeInTheDocument();
  });

  test('switches to the Mensagens tab and shows quick replies and per-channel welcome messages', async () => {
    useChannels.mockReturnValue({
      channels: [{ id: 'ch1', type: 'baileys', name: 'Berg', phoneNumber: '+5598985004187', status: 'connected', welcomeMessage: null }],
      loading: false,
      refresh: vi.fn(),
    });
    useQuickReplies.mockReturnValue({
      quickReplies: [{ id: 'qr1', title: 'Boas-vindas', content: 'Olá!' }],
      refresh: vi.fn(),
    });
    render(
      <MemoryRouter>
        <AdminChannelsPage />
      </MemoryRouter>
    );

    expect(screen.getByText('Conectado')).toBeInTheDocument();
    expect(screen.queryByText('Boas-vindas')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /mensagens/i }));

    expect(screen.getByText('Berg')).toBeInTheDocument();
    expect(screen.queryByText('Conectado')).not.toBeInTheDocument();

    // Quick replies are now hidden behind the "Ver mensagens" button
    await userEvent.click(screen.getByRole('button', { name: /ver mensagens/i }));

    expect(screen.getByText('Boas-vindas')).toBeInTheDocument();
  });

  test('switches to the Triagem tab and shows the triage configuration UI', async () => {
    useChannels.mockReturnValue({
      channels: [{ id: 'ch1', type: 'baileys', name: 'Berg', phoneNumber: '+5598985004187', status: 'connected', triageEnabled: false }],
      loading: false,
      refresh: vi.fn(),
    });
    render(
      <MemoryRouter>
        <AdminChannelsPage />
      </MemoryRouter>
    );

    expect(screen.getByText('Berg')).toBeInTheDocument();
    expect(screen.queryByText(/pergunta de triagem/i)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /triagem/i }));

    expect(screen.getByText(/pergunta de triagem/i)).toBeInTheDocument();
    expect(screen.queryByText('Berg')).not.toBeInTheDocument();
  });

  test('shows a checkbox per channel to toggle automatic triage', () => {
    useChannels.mockReturnValue({
      channels: [{ id: 'ch1', type: 'baileys', name: 'Berg', phoneNumber: '+5598985004187', status: 'connected', triageEnabled: true }],
      loading: false,
      refresh: vi.fn(),
    });
    render(
      <MemoryRouter>
        <AdminChannelsPage />
      </MemoryRouter>
    );
    expect(screen.getByRole('checkbox', { name: /usar triagem automática/i })).toBeChecked();
  });

  test('shows an error message when toggling triage fails', async () => {
    useChannels.mockReturnValue({
      channels: [{ id: 'ch1', type: 'baileys', name: 'Berg', phoneNumber: '+5598985004187', status: 'connected', triageEnabled: false }],
      loading: false,
      refresh: vi.fn(),
    });
    setChannelTriageEnabled.mockRejectedValue({ body: { error: 'Canal não encontrado' } });
    render(
      <MemoryRouter>
        <AdminChannelsPage />
      </MemoryRouter>
    );

    await userEvent.click(screen.getByRole('checkbox', { name: /usar triagem automática/i }));

    expect(await screen.findByText('Canal não encontrado')).toBeInTheDocument();
  });

  test('lets an admin edit the WABA ID of a meta_cloud channel', async () => {
    useChannels.mockReturnValue({
      channels: [{ id: 'ch1', type: 'meta_cloud', name: 'Oficial', phoneNumber: '+5511999990000', status: 'disconnected', triageEnabled: false, wabaId: 'old-waba' }],
      loading: false,
      refresh: vi.fn(),
    });
    setChannelWabaId.mockResolvedValue({});
    render(
      <MemoryRouter>
        <AdminChannelsPage />
      </MemoryRouter>
    );

    const input = screen.getByLabelText(/waba id/i);
    await userEvent.clear(input);
    await userEvent.type(input, 'new-waba');
    await userEvent.click(screen.getByRole('button', { name: /salvar waba id/i }));

    await waitFor(() => expect(setChannelWabaId).toHaveBeenCalledWith('ch1', 'new-waba', 'tok-123'));
  });

  test('lets an admin edit the WABA ID of a 360dialog channel', async () => {
    useChannels.mockReturnValue({
      channels: [{ id: 'ch1', type: '360dialog', name: 'Oficial 360', phoneNumber: '+5511999990000', status: 'disconnected', triageEnabled: false, wabaId: 'old-waba' }],
      loading: false,
      refresh: vi.fn(),
    });
    setChannelWabaId.mockResolvedValue({});
    render(
      <MemoryRouter>
        <AdminChannelsPage />
      </MemoryRouter>
    );

    const input = screen.getByLabelText(/waba id/i);
    await userEvent.clear(input);
    await userEvent.type(input, 'new-waba');
    await userEvent.click(screen.getByRole('button', { name: /salvar waba id/i }));

    await waitFor(() => expect(setChannelWabaId).toHaveBeenCalledWith('ch1', 'new-waba', 'tok-123'));
  });

  test('labels a meta_cloud channel as Meta Cloud (oficial) and a 360dialog channel as 360dialog (oficial)', () => {
    useChannels.mockReturnValue({
      channels: [
        { id: 'ch1', type: 'meta_cloud', name: 'Meta', phoneNumber: '+5511999990000', status: 'connected' },
        { id: 'ch2', type: '360dialog', name: '360', phoneNumber: '+5511999990001', status: 'connected' },
      ],
      loading: false,
      refresh: vi.fn(),
    });
    render(
      <MemoryRouter>
        <AdminChannelsPage />
      </MemoryRouter>
    );
    expect(screen.getByText(/Meta Cloud \(oficial\)/)).toBeInTheDocument();
    expect(screen.getByText(/360dialog \(oficial\)/)).toBeInTheDocument();
  });

  test('does not show a WABA ID field for a baileys channel', () => {
    useChannels.mockReturnValue({
      channels: [{ id: 'ch1', type: 'baileys', name: 'Berg', phoneNumber: '+5598985004187', status: 'connected' }],
      loading: false,
      refresh: vi.fn(),
    });
    render(
      <MemoryRouter>
        <AdminChannelsPage />
      </MemoryRouter>
    );
    expect(screen.queryByLabelText(/waba id/i)).not.toBeInTheDocument();
  });

  test('clicking Reconectar asks the backend for a fresh QR code and refreshes the list', async () => {
    const refresh = vi.fn();
    useChannels.mockReturnValue({
      channels: [{ id: 'ch1', type: 'baileys', name: 'Berg', phoneNumber: '+5598985004187', status: 'disconnected' }],
      loading: false,
      refresh,
    });
    reconnectChannel.mockResolvedValue({ id: 'ch1', status: 'awaiting_qr' });
    render(
      <MemoryRouter>
        <AdminChannelsPage />
      </MemoryRouter>
    );

    await userEvent.click(screen.getByRole('button', { name: /reconectar/i }));

    await waitFor(() => expect(reconnectChannel).toHaveBeenCalledWith('ch1', 'tok-123'));
    expect(refresh).toHaveBeenCalled();
  });

  test('does not offer Reconectar for a meta_cloud channel, which has no QR code', () => {
    useChannels.mockReturnValue({
      channels: [{ id: 'ch1', type: 'meta_cloud', name: 'Oficial', phoneNumber: '+5511999990000', status: 'connected' }],
      loading: false,
      refresh: vi.fn(),
    });
    render(
      <MemoryRouter>
        <AdminChannelsPage />
      </MemoryRouter>
    );
    expect(screen.queryByRole('button', { name: /reconectar/i })).not.toBeInTheDocument();
  });

  test('asks for confirmation before reconnecting a channel that is currently connected', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    useChannels.mockReturnValue({
      channels: [{ id: 'ch1', type: 'baileys', name: 'Berg', phoneNumber: '+5598985004187', status: 'connected' }],
      loading: false,
      refresh: vi.fn(),
    });
    render(
      <MemoryRouter>
        <AdminChannelsPage />
      </MemoryRouter>
    );

    await userEvent.click(screen.getByRole('button', { name: /reconectar/i }));

    expect(confirmSpy).toHaveBeenCalled();
    expect(reconnectChannel).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  test('clicking Ocultar hides the channel after confirmation', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const refresh = vi.fn();
    useChannels.mockReturnValue({
      channels: [{ id: 'ch1', type: 'baileys', name: 'Berg', phoneNumber: '+5598985004187', status: 'disconnected' }],
      loading: false,
      refresh,
    });
    setChannelHidden.mockResolvedValue({});
    render(
      <MemoryRouter>
        <AdminChannelsPage />
      </MemoryRouter>
    );

    await userEvent.click(screen.getByRole('button', { name: /ocultar/i }));

    await waitFor(() => expect(setChannelHidden).toHaveBeenCalledWith('ch1', true, 'tok-123'));
    expect(refresh).toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  test('clicking Excluir deletes the channel after confirmation', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const refresh = vi.fn();
    useChannels.mockReturnValue({
      channels: [{ id: 'ch1', type: 'baileys', name: 'Berg', phoneNumber: '+5598985004187', status: 'disconnected' }],
      loading: false,
      refresh,
    });
    deleteChannel.mockResolvedValue(undefined);
    render(
      <MemoryRouter>
        <AdminChannelsPage />
      </MemoryRouter>
    );

    await userEvent.click(screen.getByRole('button', { name: /excluir/i }));

    await waitFor(() => expect(deleteChannel).toHaveBeenCalledWith('ch1', 'tok-123'));
    expect(refresh).toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  test('shows the backend message when a channel cannot be deleted because it has history', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    useChannels.mockReturnValue({
      channels: [{ id: 'ch1', type: 'baileys', name: 'Berg', phoneNumber: '+5598985004187', status: 'disconnected' }],
      loading: false,
      refresh: vi.fn(),
    });
    deleteChannel.mockRejectedValue({ body: { error: 'This channel already has conversations' } });
    render(
      <MemoryRouter>
        <AdminChannelsPage />
      </MemoryRouter>
    );

    await userEvent.click(screen.getByRole('button', { name: /excluir/i }));

    expect(await screen.findByText(/this channel already has conversations/i)).toBeInTheDocument();
    confirmSpy.mockRestore();
  });

  test('the "mostrar canais ocultos" toggle asks the hook for hidden channels too', async () => {
    useChannels.mockReturnValue({ channels: [], loading: false, refresh: vi.fn() });
    render(
      <MemoryRouter>
        <AdminChannelsPage />
      </MemoryRouter>
    );

    await userEvent.click(screen.getByLabelText(/mostrar canais ocultos/i));

    expect(useChannels).toHaveBeenLastCalledWith(true, true);
  });

  test('a hidden channel is shown with a Reexibir button instead of Ocultar', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const refresh = vi.fn();
    useChannels.mockReturnValue({
      channels: [{ id: 'ch1', type: 'baileys', name: 'Antigo', phoneNumber: '+5598985004187', status: 'disconnected', hidden: true }],
      loading: false,
      refresh,
    });
    setChannelHidden.mockResolvedValue({});
    render(
      <MemoryRouter>
        <AdminChannelsPage />
      </MemoryRouter>
    );

    expect(screen.queryByRole('button', { name: /^ocultar$/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /reexibir/i }));

    await waitFor(() => expect(setChannelHidden).toHaveBeenCalledWith('ch1', false, 'tok-123'));
    confirmSpy.mockRestore();
  });

});
