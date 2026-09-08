import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import IntegrationsAdminTab from './IntegrationsAdminTab';
import { useSgpIntegrations } from '../hooks/useSgpIntegrations';
import { useChannels } from '../hooks/useChannels';
import { useTemplates } from '../hooks/useTemplates';
import { useSgpQueryConfig } from '../hooks/useSgpQueryConfig';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../hooks/useSgpIntegrations');
vi.mock('../hooks/useChannels');
vi.mock('../hooks/useTemplates');
vi.mock('../hooks/useSgpQueryConfig');
vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

const BAILEYS_CHANNEL = { id: 'channel-1', type: 'baileys', name: 'Berg' };
const META_CHANNEL = { id: 'channel-2', type: 'meta_cloud', name: 'Oficial' };
const APPROVED_TEMPLATE = { id: 'tpl-1', name: 'aviso_cobranca', status: 'APPROVED' };

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
  useChannels.mockReturnValue({ channels: [BAILEYS_CHANNEL, META_CHANNEL] });
  useTemplates.mockReturnValue({ templates: [APPROVED_TEMPLATE] });
  useSgpQueryConfig.mockReturnValue({ config: { configured: false }, refresh: vi.fn() });
});

describe('IntegrationsAdminTab', () => {
  test('lists existing integrations with their channel name and mode label', () => {
    useSgpIntegrations.mockReturnValue({
      integrations: [{ id: 'int-1', description: 'Baileys principal', channelId: 'channel-1', mode: 'freetext', defaultTemplateId: null, enabled: true, hasApiKey: true }],
      refresh: vi.fn(),
    });
    render(<IntegrationsAdminTab />);
    expect(screen.getByText('Baileys principal')).toBeInTheDocument();
    expect(screen.getByText(/Berg/)).toBeInTheDocument();
    expect(screen.getByText(/Texto livre/)).toBeInTheDocument();
  });

  test('the template selector only appears after choosing a meta_cloud channel', async () => {
    useSgpIntegrations.mockReturnValue({ integrations: [], refresh: vi.fn() });
    render(<IntegrationsAdminTab />);

    expect(screen.queryByLabelText(/template padrão/i)).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText(/^canal$/i), 'channel-2');

    expect(screen.getByLabelText(/template padrão/i)).toBeInTheDocument();
  });

  test('creates a new freetext integration for a baileys channel', async () => {
    const refresh = vi.fn();
    useSgpIntegrations.mockReturnValue({ integrations: [], refresh });
    api.createSgpIntegration.mockResolvedValue({ id: 'int-1', description: 'Baileys', channelId: 'channel-1', mode: 'freetext', defaultTemplateId: null, enabled: true, hasApiKey: false });
    render(<IntegrationsAdminTab />);

    await userEvent.type(screen.getByLabelText(/descrição/i), 'Baileys');
    await userEvent.selectOptions(screen.getByLabelText(/^canal$/i), 'channel-1');
    await userEvent.click(screen.getByRole('button', { name: /cadastrar/i }));

    await waitFor(() =>
      expect(api.createSgpIntegration).toHaveBeenCalledWith({ description: 'Baileys', channelId: 'channel-1', defaultTemplateId: null, enabled: true }, 'tok-123')
    );
    expect(refresh).toHaveBeenCalled();
  });

  test('creates a new template integration for a meta_cloud channel with a chosen default template', async () => {
    const refresh = vi.fn();
    useSgpIntegrations.mockReturnValue({ integrations: [], refresh });
    api.createSgpIntegration.mockResolvedValue({ id: 'int-2', description: 'Oficial', channelId: 'channel-2', mode: 'template', defaultTemplateId: 'tpl-1', enabled: true, hasApiKey: false });
    render(<IntegrationsAdminTab />);

    await userEvent.type(screen.getByLabelText(/descrição/i), 'Oficial');
    await userEvent.selectOptions(screen.getByLabelText(/^canal$/i), 'channel-2');
    await userEvent.selectOptions(screen.getByLabelText(/template padrão/i), 'tpl-1');
    await userEvent.click(screen.getByRole('button', { name: /cadastrar/i }));

    await waitFor(() =>
      expect(api.createSgpIntegration).toHaveBeenCalledWith({ description: 'Oficial', channelId: 'channel-2', defaultTemplateId: 'tpl-1', enabled: true }, 'tok-123')
    );
  });

  test('toggling Ativo on a card calls updateSgpIntegration with that card current values', async () => {
    const refresh = vi.fn();
    useSgpIntegrations.mockReturnValue({
      integrations: [{ id: 'int-1', description: 'Baileys', channelId: 'channel-1', mode: 'freetext', defaultTemplateId: null, enabled: true, hasApiKey: true }],
      refresh,
    });
    api.updateSgpIntegration.mockResolvedValue({});
    render(<IntegrationsAdminTab />);

    await userEvent.click(screen.getByLabelText('Ativo: Baileys'));

    await waitFor(() =>
      expect(api.updateSgpIntegration).toHaveBeenCalledWith('int-1', { description: 'Baileys', channelId: 'channel-1', defaultTemplateId: null, enabled: false }, 'tok-123')
    );
    expect(refresh).toHaveBeenCalled();
  });

  test('clicking Editar reveals the edit fields prefilled with the card current values', async () => {
    useSgpIntegrations.mockReturnValue({
      integrations: [{ id: 'int-2', description: 'Oficial', channelId: 'channel-2', mode: 'template', defaultTemplateId: 'tpl-1', enabled: true, hasApiKey: true }],
      refresh: vi.fn(),
    });
    render(<IntegrationsAdminTab />);

    expect(screen.queryByRole('form', { name: /editar integração/i })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /^editar$/i }));

    const editForm = within(screen.getByRole('form', { name: /editar integração/i }));
    expect(editForm.getByLabelText(/descrição/i)).toHaveValue('Oficial');
    expect(editForm.getByLabelText(/^canal$/i)).toHaveValue('channel-2');
    expect(editForm.getByLabelText(/template padrão/i)).toHaveValue('tpl-1');
  });

  test('saving the edit form sends the edited values and preserves the card Ativo state', async () => {
    const refresh = vi.fn();
    useSgpIntegrations.mockReturnValue({
      integrations: [{ id: 'int-1', description: 'Baileys', channelId: 'channel-1', mode: 'freetext', defaultTemplateId: null, enabled: false, hasApiKey: true }],
      refresh,
    });
    api.updateSgpIntegration.mockResolvedValue({});
    render(<IntegrationsAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /^editar$/i }));
    const editForm = within(screen.getByRole('form', { name: /editar integração/i }));
    await userEvent.clear(editForm.getByLabelText(/descrição/i));
    await userEvent.type(editForm.getByLabelText(/descrição/i), 'SGP Baileys renomeado');
    await userEvent.selectOptions(editForm.getByLabelText(/^canal$/i), 'channel-2');
    await userEvent.selectOptions(editForm.getByLabelText(/template padrão/i), 'tpl-1');
    await userEvent.click(editForm.getByRole('button', { name: /salvar/i }));

    await waitFor(() =>
      expect(api.updateSgpIntegration).toHaveBeenCalledWith(
        'int-1',
        { description: 'SGP Baileys renomeado', channelId: 'channel-2', defaultTemplateId: 'tpl-1', enabled: false },
        'tok-123'
      )
    );
    expect(refresh).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('form', { name: /editar integração/i })).not.toBeInTheDocument());
  });

  test('the edit form template selector follows the edit form own channel selection', async () => {
    useSgpIntegrations.mockReturnValue({
      integrations: [{ id: 'int-1', description: 'Baileys', channelId: 'channel-1', mode: 'freetext', defaultTemplateId: null, enabled: true, hasApiKey: true }],
      refresh: vi.fn(),
    });
    render(<IntegrationsAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /^editar$/i }));
    const editForm = within(screen.getByRole('form', { name: /editar integração/i }));
    expect(editForm.queryByLabelText(/template padrão/i)).not.toBeInTheDocument();

    await userEvent.selectOptions(editForm.getByLabelText(/^canal$/i), 'channel-2');

    expect(editForm.getByLabelText(/template padrão/i)).toBeInTheDocument();
  });

  test('cancelling the edit form closes it without calling the API', async () => {
    useSgpIntegrations.mockReturnValue({
      integrations: [{ id: 'int-1', description: 'Baileys', channelId: 'channel-1', mode: 'freetext', defaultTemplateId: null, enabled: true, hasApiKey: true }],
      refresh: vi.fn(),
    });
    render(<IntegrationsAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /^editar$/i }));
    const editForm = within(screen.getByRole('form', { name: /editar integração/i }));
    await userEvent.type(editForm.getByLabelText(/descrição/i), ' rascunho');
    await userEvent.click(editForm.getByRole('button', { name: /cancelar/i }));

    expect(api.updateSgpIntegration).not.toHaveBeenCalled();
    expect(screen.queryByRole('form', { name: /editar integração/i })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /^editar$/i }));
    expect(within(screen.getByRole('form', { name: /editar integração/i })).getByLabelText(/descrição/i)).toHaveValue('Baileys');
  });

  test('generating a key shows it once', async () => {
    useSgpIntegrations.mockReturnValue({
      integrations: [{ id: 'int-1', description: 'Baileys', channelId: 'channel-1', mode: 'freetext', defaultTemplateId: null, enabled: true, hasApiKey: false }],
      refresh: vi.fn(),
    });
    api.rotateSgpIntegrationKey.mockResolvedValue({ apiKey: 'plain-key-abc' });
    render(<IntegrationsAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /gerar nova chave/i }));

    expect(await screen.findByText('plain-key-abc')).toBeInTheDocument();
  });
});
