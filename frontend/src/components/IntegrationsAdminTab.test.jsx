import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import IntegrationsAdminTab from './IntegrationsAdminTab';
import { useSgpIntegration } from '../hooks/useSgpIntegration';
import { useChannels } from '../hooks/useChannels';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../hooks/useSgpIntegration');
vi.mock('../hooks/useChannels');
vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

const BAILEYS_CHANNEL = { id: 'channel-1', type: 'baileys', name: 'Berg' };
const META_CHANNEL = { id: 'channel-2', type: 'meta_cloud', name: 'Oficial' };

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
  useChannels.mockReturnValue({ channels: [BAILEYS_CHANNEL, META_CHANNEL] });
});

describe('IntegrationsAdminTab', () => {
  test('only lists Baileys channels in the dropdown', () => {
    useSgpIntegration.mockReturnValue({ integration: { configured: false }, refresh: vi.fn() });
    render(<IntegrationsAdminTab />);

    expect(screen.getByRole('option', { name: 'Berg' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Oficial' })).not.toBeInTheDocument();
  });

  test('saves the chosen channel', async () => {
    const refresh = vi.fn();
    useSgpIntegration.mockReturnValue({ integration: { configured: false }, refresh });
    api.saveSgpIntegration.mockResolvedValue({ configured: true, channelId: 'channel-1', enabled: true, hasApiKey: false });
    render(<IntegrationsAdminTab />);

    await userEvent.selectOptions(screen.getByLabelText(/canal/i), 'channel-1');
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));

    await waitFor(() =>
      expect(api.saveSgpIntegration).toHaveBeenCalledWith({ channelId: 'channel-1', enabled: true }, 'tok-123')
    );
    expect(refresh).toHaveBeenCalled();
  });

  test('shows the generate-key button once configured, and shows the key once after generating', async () => {
    useSgpIntegration.mockReturnValue({
      integration: { configured: true, channelId: 'channel-1', enabled: true, hasApiKey: false },
      refresh: vi.fn(),
    });
    api.rotateSgpIntegrationKey.mockResolvedValue({
      apiKey: 'plain-key-abc',
      configured: true,
      channelId: 'channel-1',
      enabled: true,
      hasApiKey: true,
    });
    render(<IntegrationsAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /gerar nova chave/i }));

    expect(await screen.findByText('plain-key-abc')).toBeInTheDocument();
  });

  test('does not show the key section before the integration is configured', () => {
    useSgpIntegration.mockReturnValue({ integration: { configured: false }, refresh: vi.fn() });
    render(<IntegrationsAdminTab />);

    expect(screen.queryByRole('button', { name: /gerar nova chave/i })).not.toBeInTheDocument();
  });

  test('shows an error message when saving fails', async () => {
    useSgpIntegration.mockReturnValue({ integration: { configured: false }, refresh: vi.fn() });
    api.saveSgpIntegration.mockRejectedValue({ body: { error: 'Falha ao salvar' } });
    render(<IntegrationsAdminTab />);

    await userEvent.selectOptions(screen.getByLabelText(/canal/i), 'channel-1');
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));

    expect(await screen.findByText('Falha ao salvar')).toBeInTheDocument();
  });
});
