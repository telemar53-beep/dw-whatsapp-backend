import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminChannelsPage from './AdminChannelsPage';
import { useChannels } from '../hooks/useChannels';
import { useAgentsAdmin } from '../hooks/useAgentsAdmin';
import { useQuickReplies } from '../hooks/useQuickReplies';
import { useSectors } from '../hooks/useSectors';
import { useTriage } from '../hooks/useTriage';
import { useAuth } from '../contexts/AuthContext';
import { setChannelTriageEnabled } from '../services/api';

vi.mock('../hooks/useChannels');
vi.mock('../hooks/useAgentsAdmin');
vi.mock('../hooks/useQuickReplies');
vi.mock('../hooks/useSectors');
vi.mock('../hooks/useTriage');
vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'admin-1', role: 'admin' } });
  useAgentsAdmin.mockReturnValue({ agents: [], refresh: vi.fn() });
  useQuickReplies.mockReturnValue({ quickReplies: [], refresh: vi.fn() });
  useSectors.mockReturnValue({ sectors: [], refresh: vi.fn() });
  useTriage.mockReturnValue({ config: { questionText: 'Q', confirmationText: 'C', maxAttempts: 2 }, options: [], refresh: vi.fn() });
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
    render(<AdminChannelsPage />);
    expect(screen.getByText('Berg')).toBeInTheDocument();
    expect(screen.getByText('Suporte')).toBeInTheDocument();
  });

  test('shows the QR view for a channel awaiting_qr', () => {
    useChannels.mockReturnValue({
      channels: [{ id: 'ch1', type: 'baileys', name: 'Berg', phoneNumber: '+5598985004187', status: 'awaiting_qr' }],
      loading: false,
      refresh: vi.fn(),
    });
    render(<AdminChannelsPage />);
    expect(screen.getByText(/Escaneie o QR code/)).toBeInTheDocument();
  });

  test('renders the create-channel form', () => {
    useChannels.mockReturnValue({ channels: [], loading: false, refresh: vi.fn() });
    render(<AdminChannelsPage />);
    expect(screen.getByText(/Cadastrar novo canal/)).toBeInTheDocument();
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
    render(<AdminChannelsPage />);

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
    render(<AdminChannelsPage />);

    expect(screen.getByText('Berg')).toBeInTheDocument();
    expect(screen.queryByText('Financeiro')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /setores/i }));

    expect(screen.getByText('Financeiro')).toBeInTheDocument();
    expect(screen.queryByText('Berg')).not.toBeInTheDocument();
  });

  test('switches to the Respostas rápidas tab and shows the quick-reply management UI', async () => {
    useChannels.mockReturnValue({
      channels: [{ id: 'ch1', type: 'baileys', name: 'Berg', phoneNumber: '+5598985004187', status: 'connected' }],
      loading: false,
      refresh: vi.fn(),
    });
    useQuickReplies.mockReturnValue({
      quickReplies: [{ id: 'qr1', title: 'Boas-vindas', content: 'Olá!' }],
      refresh: vi.fn(),
    });
    render(<AdminChannelsPage />);

    expect(screen.getByText('Berg')).toBeInTheDocument();
    expect(screen.queryByText('Boas-vindas')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /respostas rápidas/i }));

    expect(screen.getByText('Boas-vindas')).toBeInTheDocument();
    expect(screen.queryByText('Berg')).not.toBeInTheDocument();
  });

  test('switches to the Triagem tab and shows the triage configuration UI', async () => {
    useChannels.mockReturnValue({
      channels: [{ id: 'ch1', type: 'baileys', name: 'Berg', phoneNumber: '+5598985004187', status: 'connected', triageEnabled: false }],
      loading: false,
      refresh: vi.fn(),
    });
    render(<AdminChannelsPage />);

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
    render(<AdminChannelsPage />);
    expect(screen.getByRole('checkbox', { name: /usar triagem automática/i })).toBeChecked();
  });

  test('shows an error message when toggling triage fails', async () => {
    useChannels.mockReturnValue({
      channels: [{ id: 'ch1', type: 'baileys', name: 'Berg', phoneNumber: '+5598985004187', status: 'connected', triageEnabled: false }],
      loading: false,
      refresh: vi.fn(),
    });
    setChannelTriageEnabled.mockRejectedValue({ body: { error: 'Canal não encontrado' } });
    render(<AdminChannelsPage />);

    await userEvent.click(screen.getByRole('checkbox', { name: /usar triagem automática/i }));

    expect(await screen.findByText('Canal não encontrado')).toBeInTheDocument();
  });
});
