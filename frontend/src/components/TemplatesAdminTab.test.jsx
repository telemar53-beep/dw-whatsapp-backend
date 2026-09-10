import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TemplatesAdminTab from './TemplatesAdminTab';
import { useTemplates } from '../hooks/useTemplates';
import { useChannels } from '../hooks/useChannels';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../hooks/useTemplates');
vi.mock('../hooks/useChannels');
vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
  useChannels.mockReturnValue({ channels: [{ id: 'ch-1', type: 'meta_cloud', name: 'Oficial', wabaId: 'waba-1' }] });
});

describe('TemplatesAdminTab', () => {
  test('lists templates with their status', async () => {
    useTemplates.mockReturnValue({
      templates: [{ id: 'tpl-1', name: 'fatura_vencida', language: 'pt_BR', category: 'UTILITY', status: 'APPROVED', rejectionReason: null }],
      refresh: vi.fn(),
    });
    render(<TemplatesAdminTab />);
    await userEvent.click(screen.getByRole('button', { name: /ver templates/i }));
    expect(screen.getByText('fatura_vencida')).toBeInTheDocument();
    expect(screen.getByText('APPROVED')).toBeInTheDocument();
  });

  test('shows the rejection reason for a rejected template', async () => {
    useTemplates.mockReturnValue({
      templates: [{ id: 'tpl-1', name: 'x', language: 'pt_BR', category: 'UTILITY', status: 'REJECTED', rejectionReason: 'Invalid format' }],
      refresh: vi.fn(),
    });
    render(<TemplatesAdminTab />);
    await userEvent.click(screen.getByRole('button', { name: /ver templates/i }));
    expect(screen.getByText('Invalid format')).toBeInTheDocument();
  });

  test('creates a new template and calls refresh', async () => {
    const refresh = vi.fn();
    useTemplates.mockReturnValue({ templates: [], refresh });
    api.createTemplateAdmin.mockResolvedValue({ id: 'tpl-2', name: 'boas_vindas', status: 'PENDING' });
    render(<TemplatesAdminTab />);
    await userEvent.click(screen.getByRole('button', { name: /cadastrar novo template/i }));
    const form = within(screen.getByRole('form', { name: /cadastrar novo template/i }));

    await userEvent.selectOptions(form.getByLabelText(/canal/i), 'ch-1');
    await userEvent.type(form.getByLabelText(/^nome$/i), 'boas_vindas');
    await userEvent.selectOptions(form.getByLabelText(/categoria/i), 'UTILITY');
    await userEvent.type(form.getByLabelText(/idioma/i), 'pt_BR');
    await userEvent.type(form.getByLabelText(/corpo/i), 'Olá, bem-vindo!');
    await userEvent.click(form.getByRole('button', { name: /cadastrar/i }));

    await waitFor(() =>
      expect(api.createTemplateAdmin).toHaveBeenCalledWith(
        { channelId: 'ch-1', name: 'boas_vindas', category: 'UTILITY', language: 'pt_BR', bodyText: 'Olá, bem-vindo!' },
        'tok-123'
      )
    );
    expect(refresh).toHaveBeenCalled();
  });

  test('selects the first meta_cloud channel automatically once channels finish loading, without touching the dropdown', async () => {
    const refresh = vi.fn();
    useTemplates.mockReturnValue({ templates: [], refresh });
    useChannels.mockReturnValue({ channels: [] });
    const { rerender } = render(<TemplatesAdminTab />);
    await userEvent.click(screen.getByRole('button', { name: /cadastrar novo template/i }));

    useChannels.mockReturnValue({ channels: [{ id: 'ch-1', type: 'meta_cloud', name: 'Oficial', wabaId: 'waba-1' }] });
    rerender(<TemplatesAdminTab />);
    const form = within(screen.getByRole('form', { name: /cadastrar novo template/i }));

    api.createTemplateAdmin.mockResolvedValue({ id: 'tpl-2', name: 'boas_vindas', status: 'PENDING' });
    await userEvent.type(form.getByLabelText(/^nome$/i), 'boas_vindas');
    await userEvent.type(form.getByLabelText(/idioma/i), 'pt_BR');
    await userEvent.type(form.getByLabelText(/corpo/i), 'Olá, bem-vindo!');
    await userEvent.click(form.getByRole('button', { name: /cadastrar/i }));

    await waitFor(() =>
      expect(api.createTemplateAdmin).toHaveBeenCalledWith(
        { channelId: 'ch-1', name: 'boas_vindas', category: 'UTILITY', language: 'pt_BR', bodyText: 'Olá, bem-vindo!' },
        'tok-123'
      )
    );
  });

  test('offers a 360dialog channel as a selectable option in the create-template channel select', async () => {
    useTemplates.mockReturnValue({ templates: [], refresh: vi.fn() });
    useChannels.mockReturnValue({ channels: [{ id: 'ch-2', type: '360dialog', name: '360 Oficial', wabaId: 'waba-2' }] });
    render(<TemplatesAdminTab />);
    await userEvent.click(screen.getByRole('button', { name: /cadastrar novo template/i }));
    const form = within(screen.getByRole('form', { name: /cadastrar novo template/i }));

    expect(form.getByRole('option', { name: '360 Oficial' })).toBeInTheDocument();
  });

  test('offers a 360dialog channel as a selectable option in the register-existing-template channel select', async () => {
    useTemplates.mockReturnValue({ templates: [], refresh: vi.fn() });
    useChannels.mockReturnValue({ channels: [{ id: 'ch-2', type: '360dialog', name: '360 Oficial', wabaId: 'waba-2' }] });
    render(<TemplatesAdminTab />);
    await userEvent.click(screen.getByRole('button', { name: /registrar template existente/i }));
    const form = within(screen.getByRole('form', { name: /registrar template existente/i }));

    expect(form.getByRole('option', { name: '360 Oficial' })).toBeInTheDocument();
  });

  test('shows the Meta error message when creation fails', async () => {
    useTemplates.mockReturnValue({ templates: [], refresh: vi.fn() });
    api.createTemplateAdmin.mockRejectedValue({ body: { error: 'Invalid parameter' } });
    render(<TemplatesAdminTab />);
    await userEvent.click(screen.getByRole('button', { name: /cadastrar novo template/i }));
    const form = within(screen.getByRole('form', { name: /cadastrar novo template/i }));

    await userEvent.selectOptions(form.getByLabelText(/canal/i), 'ch-1');
    await userEvent.type(form.getByLabelText(/^nome$/i), 'x');
    await userEvent.selectOptions(form.getByLabelText(/categoria/i), 'UTILITY');
    await userEvent.type(form.getByLabelText(/idioma/i), 'pt_BR');
    await userEvent.type(form.getByLabelText(/corpo/i), 'Y');
    await userEvent.click(form.getByRole('button', { name: /cadastrar/i }));

    await waitFor(() => expect(screen.getByText('Invalid parameter')).toBeInTheDocument());
  });

  test('deletes a template after confirmation', async () => {
    const refresh = vi.fn();
    useTemplates.mockReturnValue({
      templates: [{ id: 'tpl-1', name: 'x', language: 'pt_BR', category: 'UTILITY', status: 'APPROVED', rejectionReason: null }],
      refresh,
    });
    api.deleteTemplateAdmin.mockResolvedValue(undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<TemplatesAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /ver templates/i }));
    await userEvent.click(screen.getByRole('button', { name: /excluir/i }));

    await waitFor(() => expect(api.deleteTemplateAdmin).toHaveBeenCalledWith('tpl-1', 'tok-123'));
    expect(refresh).toHaveBeenCalled();
  });

  test('syncs templates for a WABA and calls refresh', async () => {
    const refresh = vi.fn();
    useTemplates.mockReturnValue({
      templates: [{ id: 'tpl-1', name: 'x', language: 'pt_BR', category: 'UTILITY', status: 'PENDING', rejectionReason: null }],
      refresh,
    });
    api.syncTemplatesAdmin.mockResolvedValue([]);
    render(<TemplatesAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /sincronizar agora/i }));

    await waitFor(() => expect(api.syncTemplatesAdmin).toHaveBeenCalledWith('waba-1', 'tok-123'));
    expect(refresh).toHaveBeenCalled();
  });

  test('registers an existing template by name and language', async () => {
    const refresh = vi.fn();
    useTemplates.mockReturnValue({ templates: [], refresh });
    api.registerExistingTemplateAdmin.mockResolvedValue({ id: 'tpl-3', name: 'aviso_cobranca' });
    render(<TemplatesAdminTab />);
    await userEvent.click(screen.getByRole('button', { name: /registrar template existente/i }));
    const form = within(screen.getByRole('form', { name: /registrar template existente/i }));

    await userEvent.selectOptions(form.getByLabelText(/canal/i), 'ch-1');
    await userEvent.type(form.getByLabelText(/nome exato na meta/i), 'aviso_cobranca');
    await userEvent.type(form.getByLabelText(/idioma/i), 'pt_BR');
    await userEvent.selectOptions(form.getByLabelText(/cabeçalho/i), 'document');
    await userEvent.click(form.getByRole('button', { name: /^registrar$/i }));

    await waitFor(() =>
      expect(api.registerExistingTemplateAdmin).toHaveBeenCalledWith(
        { channelId: 'ch-1', name: 'aviso_cobranca', language: 'pt_BR', headerType: 'document' },
        'tok-123'
      )
    );
    expect(refresh).toHaveBeenCalled();
  });

  test('shows an error message when registering an existing template fails', async () => {
    useTemplates.mockReturnValue({ templates: [], refresh: vi.fn() });
    api.registerExistingTemplateAdmin.mockRejectedValue({ body: { error: 'No template found' } });
    render(<TemplatesAdminTab />);
    await userEvent.click(screen.getByRole('button', { name: /registrar template existente/i }));
    const form = within(screen.getByRole('form', { name: /registrar template existente/i }));

    await userEvent.selectOptions(form.getByLabelText(/canal/i), 'ch-1');
    await userEvent.type(form.getByLabelText(/nome exato na meta/i), 'x');
    await userEvent.type(form.getByLabelText(/idioma/i), 'pt_BR');
    await userEvent.click(form.getByRole('button', { name: /^registrar$/i }));

    await waitFor(() => expect(screen.getByText('No template found')).toBeInTheDocument());
  });

  test('does not show the template list, create form, or register form until their buttons are clicked', () => {
    useTemplates.mockReturnValue({
      templates: [{ id: 'tpl-1', name: 'fatura_vencida', language: 'pt_BR', category: 'UTILITY', status: 'APPROVED', rejectionReason: null }],
      refresh: vi.fn(),
    });
    render(<TemplatesAdminTab />);

    expect(screen.queryByText('fatura_vencida')).not.toBeInTheDocument();
    expect(screen.queryByRole('form', { name: /cadastrar novo template/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('form', { name: /registrar template existente/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ver templates \(1\)/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cadastrar novo template/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /registrar template existente/i })).toBeInTheDocument();
  });

  test('clicking Ver templates shows the status of every template', async () => {
    useTemplates.mockReturnValue({
      templates: [
        { id: 'tpl-1', name: 'fatura_vencida', language: 'pt_BR', category: 'UTILITY', status: 'APPROVED', rejectionReason: null },
        { id: 'tpl-2', name: 'promocao', language: 'pt_BR', category: 'MARKETING', status: 'REJECTED', rejectionReason: 'Formato inválido' },
      ],
      refresh: vi.fn(),
    });
    render(<TemplatesAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /ver templates/i }));

    expect(screen.getByText('fatura_vencida')).toBeInTheDocument();
    expect(screen.getByText('APPROVED')).toBeInTheDocument();
    expect(screen.getByText('promocao')).toBeInTheDocument();
    expect(screen.getByText('REJECTED')).toBeInTheDocument();
    expect(screen.getByText('Formato inválido')).toBeInTheDocument();
  });

  test('canceling the create-template form hides it without creating anything', async () => {
    useTemplates.mockReturnValue({ templates: [], refresh: vi.fn() });
    render(<TemplatesAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /cadastrar novo template/i }));
    expect(screen.getByRole('form', { name: /cadastrar novo template/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /^cancelar$/i }));

    expect(screen.queryByRole('form', { name: /cadastrar novo template/i })).not.toBeInTheDocument();
    expect(api.createTemplateAdmin).not.toHaveBeenCalled();
  });

  test('canceling the register-existing-template form hides it without registering anything', async () => {
    useTemplates.mockReturnValue({ templates: [], refresh: vi.fn() });
    render(<TemplatesAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /registrar template existente/i }));
    expect(screen.getByRole('form', { name: /registrar template existente/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /^cancelar$/i }));

    expect(screen.queryByRole('form', { name: /registrar template existente/i })).not.toBeInTheDocument();
    expect(api.registerExistingTemplateAdmin).not.toHaveBeenCalled();
  });

  test('creating a template closes the create form afterward', async () => {
    const refresh = vi.fn();
    useTemplates.mockReturnValue({ templates: [], refresh });
    api.createTemplateAdmin.mockResolvedValue({ id: 'tpl-2', name: 'boas_vindas', status: 'PENDING' });
    render(<TemplatesAdminTab />);
    await userEvent.click(screen.getByRole('button', { name: /cadastrar novo template/i }));
    const form = within(screen.getByRole('form', { name: /cadastrar novo template/i }));

    await userEvent.selectOptions(form.getByLabelText(/canal/i), 'ch-1');
    await userEvent.type(form.getByLabelText(/^nome$/i), 'boas_vindas');
    await userEvent.selectOptions(form.getByLabelText(/categoria/i), 'UTILITY');
    await userEvent.type(form.getByLabelText(/idioma/i), 'pt_BR');
    await userEvent.type(form.getByLabelText(/corpo/i), 'Olá, bem-vindo!');
    await userEvent.click(form.getByRole('button', { name: /^cadastrar$/i }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(screen.queryByRole('form', { name: /cadastrar novo template/i })).not.toBeInTheDocument();
  });
});
