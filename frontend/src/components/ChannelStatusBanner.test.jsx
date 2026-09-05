import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import ChannelStatusBanner from './ChannelStatusBanner';
import { useAuth } from '../contexts/AuthContext';
import { useChannels } from '../hooks/useChannels';

vi.mock('../contexts/AuthContext');
vi.mock('../hooks/useChannels');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ChannelStatusBanner', () => {
  test('renders nothing for a non-admin agent', () => {
    useAuth.mockReturnValue({ agent: { role: 'agent' } });
    useChannels.mockReturnValue({ channels: [{ id: 'ch1', name: 'Berg', status: 'disconnected' }], loading: false });
    const { container } = render(<ChannelStatusBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  test('renders nothing for an admin when every channel is connected', () => {
    useAuth.mockReturnValue({ agent: { role: 'admin' } });
    useChannels.mockReturnValue({ channels: [{ id: 'ch1', name: 'Berg', status: 'connected' }], loading: false });
    const { container } = render(<ChannelStatusBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  test('warns an admin about a disconnected channel', () => {
    useAuth.mockReturnValue({ agent: { role: 'admin' } });
    useChannels.mockReturnValue({
      channels: [{ id: 'ch1', name: 'Berg', status: 'disconnected' }],
      loading: false,
    });
    render(<ChannelStatusBanner />);
    expect(screen.getByText(/Berg/)).toBeInTheDocument();
    expect(screen.getByText(/desconectado/i)).toBeInTheDocument();
  });

  test('warns an admin about a channel awaiting QR', () => {
    useAuth.mockReturnValue({ agent: { role: 'admin' } });
    useChannels.mockReturnValue({
      channels: [{ id: 'ch1', name: 'Berg', status: 'awaiting_qr' }],
      loading: false,
    });
    render(<ChannelStatusBanner />);
    expect(screen.getByText(/QR/)).toBeInTheDocument();
  });
});
