import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminChannelsPage from './AdminChannelsPage';
import { useChannels } from '../hooks/useChannels';
import { useAgentsAdmin } from '../hooks/useAgentsAdmin';
import { useAuth } from '../contexts/AuthContext';

vi.mock('../hooks/useChannels');
vi.mock('../hooks/useAgentsAdmin');
vi.mock('../contexts/AuthContext');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'admin-1', role: 'admin' } });
  useAgentsAdmin.mockReturnValue({ agents: [], refresh: vi.fn() });
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
      agents: [{ id: 'a1', name: 'Ana', email: 'ana@dw.com', role: 'agent', active: true }],
      refresh: vi.fn(),
    });
    render(<AdminChannelsPage />);

    expect(screen.getByText('Berg')).toBeInTheDocument();
    expect(screen.queryByText('Ana')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /atendentes/i }));

    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.queryByText('Berg')).not.toBeInTheDocument();
  });
});
