import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ChannelStatusBanner from './ChannelStatusBanner';
import { useAuth } from '../contexts/AuthContext';
import { useChannels } from '../hooks/useChannels';

vi.mock('../contexts/AuthContext');
vi.mock('../hooks/useChannels');

beforeEach(() => {
  vi.clearAllMocks();
});

function renderBanner() {
  return render(
    <MemoryRouter>
      <ChannelStatusBanner />
    </MemoryRouter>
  );
}

describe('ChannelStatusBanner', () => {
  test('renders nothing for a non-admin agent', () => {
    useAuth.mockReturnValue({ agent: { role: 'agent' } });
    useChannels.mockReturnValue({ channels: [{ id: 'ch1', name: 'Berg', status: 'disconnected' }], loading: false });
    const { container } = renderBanner();
    expect(container).toBeEmptyDOMElement();
  });

  test('renders nothing for an admin when every channel is connected', () => {
    useAuth.mockReturnValue({ agent: { role: 'admin' } });
    useChannels.mockReturnValue({ channels: [{ id: 'ch1', name: 'Berg', status: 'connected' }], loading: false });
    const { container } = renderBanner();
    expect(container).toBeEmptyDOMElement();
  });

  test('warns an admin about a disconnected channel', () => {
    useAuth.mockReturnValue({ agent: { role: 'admin' } });
    useChannels.mockReturnValue({
      channels: [{ id: 'ch1', name: 'Berg', status: 'disconnected' }],
      loading: false,
    });
    renderBanner();
    expect(screen.getByText(/Berg/)).toBeInTheDocument();
    expect(screen.getByText(/desconectado/i)).toBeInTheDocument();
  });

  test('warns an admin about a channel awaiting QR', () => {
    useAuth.mockReturnValue({ agent: { role: 'admin' } });
    useChannels.mockReturnValue({
      channels: [{ id: 'ch1', name: 'Berg', status: 'awaiting_qr' }],
      loading: false,
    });
    renderBanner();
    expect(screen.getByText(/QR/)).toBeInTheDocument();
  });

  test('nunca avisa sobre um canal oficial, qualquer que seja o status guardado', () => {
    useAuth.mockReturnValue({ agent: { role: 'admin' } });
    useChannels.mockReturnValue({
      channels: [
        { id: 'ch1', type: 'meta_cloud', name: 'Oficial Meta', status: 'disconnected' },
        { id: 'ch2', type: '360dialog', name: 'Oficial BSP', status: 'disconnected' },
      ],
      loading: false,
    });
    const { container } = renderBanner();
    expect(container).toBeEmptyDOMElement();
  });

  test('ainda avisa sobre um canal baileys desconectado', () => {
    useAuth.mockReturnValue({ agent: { role: 'admin' } });
    useChannels.mockReturnValue({
      channels: [{ id: 'ch1', type: 'baileys', name: 'Berg', status: 'disconnected' }],
      loading: false,
    });
    renderBanner();
    expect(screen.getByText(/Berg/)).toBeInTheDocument();
    expect(screen.getByText(/desconectado/i)).toBeInTheDocument();
  });

  test('warns a manager with canManageIntegrations about a disconnected channel', () => {
    useAuth.mockReturnValue({ agent: { role: 'manager', canManageIntegrations: true } });
    useChannels.mockReturnValue({
      channels: [{ id: 'ch1', name: 'Berg', status: 'disconnected' }],
      loading: false,
    });
    renderBanner();
    expect(screen.getByText(/Berg/)).toBeInTheDocument();
    expect(screen.getByText(/desconectado/i)).toBeInTheDocument();
  });

  test('renders nothing for a manager without canManageIntegrations', () => {
    useAuth.mockReturnValue({ agent: { role: 'manager', canManageIntegrations: false } });
    useChannels.mockReturnValue({
      channels: [{ id: 'ch1', name: 'Berg', status: 'disconnected' }],
      loading: false,
    });
    const { container } = renderBanner();
    expect(container).toBeEmptyDOMElement();
  });
});
