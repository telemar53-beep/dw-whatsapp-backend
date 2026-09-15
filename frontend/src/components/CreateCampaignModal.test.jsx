import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CreateCampaignModal from './CreateCampaignModal';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
});

describe('CreateCampaignModal', () => {
  test('lists only connected baileys channels and official channels', async () => {
    api.listChannelsForAgent.mockResolvedValue([
      { id: 'ch-1', type: 'baileys', name: 'Berg', status: 'connected' },
      { id: 'ch-2', type: 'baileys', name: 'Desconectado', status: 'awaiting_qr' },
      { id: 'ch-3', type: 'meta_cloud', name: 'Oficial', status: 'connected' },
    ]);
    render(<CreateCampaignModal onClose={vi.fn()} onCreated={vi.fn()} />);

    expect(await screen.findByText('Berg')).toBeInTheDocument();
    expect(screen.getByText('Oficial')).toBeInTheDocument();
    expect(screen.queryByText('Desconectado')).not.toBeInTheDocument();
  });

  test('shows a free-text message field for a baileys channel', async () => {
    api.listChannelsForAgent.mockResolvedValue([{ id: 'ch-1', type: 'baileys', name: 'Berg', status: 'connected' }]);
    render(<CreateCampaignModal onClose={vi.fn()} onCreated={vi.fn()} />);

    expect(await screen.findByLabelText(/mensagem/i)).toBeInTheDocument();
  });

  test('shows a template selector with variable fields for an official channel', async () => {
    api.listChannelsForAgent.mockResolvedValue([{ id: 'ch-2', type: 'meta_cloud', name: 'Oficial', status: 'connected' }]);
    api.listTemplatesForChannel.mockResolvedValue([{ id: 'tpl-1', name: 'aviso', variableCount: 1 }]);
    render(<CreateCampaignModal onClose={vi.fn()} onCreated={vi.fn()} />);

    await screen.findByText('Oficial');
    expect(await screen.findByLabelText(/template/i)).toBeInTheDocument();
    expect(await screen.findByLabelText(/variável 1/i)).toBeInTheDocument();
  });

  test('submits a text campaign with the pasted recipients list', async () => {
    api.listChannelsForAgent.mockResolvedValue([{ id: 'ch-1', type: 'baileys', name: 'Berg', status: 'connected' }]);
    api.createCampaign.mockResolvedValue({ id: 'campaign-1' });
    const onCreated = vi.fn();
    render(<CreateCampaignModal onClose={vi.fn()} onCreated={onCreated} />);

    await screen.findByText('Berg');
    await userEvent.type(screen.getByLabelText(/mensagem/i), 'Aviso importante');
    await userEvent.type(screen.getByLabelText(/destinatários/i), '5511999990000\n5511999990001,Maria');
    await userEvent.click(screen.getByRole('button', { name: /revisar/i }));
    await userEvent.click(screen.getByRole('button', { name: /confirmar e disparar/i }));

    await waitFor(() =>
      expect(api.createCampaign).toHaveBeenCalledWith(
        { channelId: 'ch-1', name: '', content: 'Aviso importante', recipients: '5511999990000\n5511999990001,Maria' },
        'tok-123'
      )
    );
    expect(onCreated).toHaveBeenCalledWith({ id: 'campaign-1' });
  });

  test('shows an error message when creation fails', async () => {
    api.listChannelsForAgent.mockResolvedValue([{ id: 'ch-1', type: 'baileys', name: 'Berg', status: 'connected' }]);
    api.createCampaign.mockRejectedValue({ body: { error: 'No valid recipient found in the list' } });
    render(<CreateCampaignModal onClose={vi.fn()} onCreated={vi.fn()} />);

    await screen.findByText('Berg');
    await userEvent.type(screen.getByLabelText(/mensagem/i), 'Oi');
    await userEvent.type(screen.getByLabelText(/destinatários/i), 'abc');
    await userEvent.click(screen.getByRole('button', { name: /revisar/i }));
    await userEvent.click(screen.getByRole('button', { name: /confirmar e disparar/i }));

    expect(await screen.findByText('No valid recipient found in the list')).toBeInTheDocument();
  });

  test('não chama a API e mostra erro por campo quando a mensagem está em branco', async () => {
    api.listChannelsForAgent.mockResolvedValue([{ id: 'ch-1', type: 'baileys', name: 'Berg', status: 'connected' }]);
    render(<CreateCampaignModal onClose={vi.fn()} onCreated={vi.fn()} />);
    await screen.findByText('Berg');
    await userEvent.type(screen.getByLabelText(/mensagem/i), '   ');
    await userEvent.type(screen.getByLabelText(/destinatários/i), '5511999990000');
    await userEvent.click(screen.getByRole('button', { name: /revisar/i }));
    expect(screen.getByText('Escreva a mensagem que será enviada.')).toBeInTheDocument();
    expect(screen.getByLabelText(/mensagem/i)).toHaveAttribute('aria-invalid', 'true');
    expect(api.createCampaign).not.toHaveBeenCalled();
  });

  test('mostra erro quando a lista de destinatários está vazia', async () => {
    api.listChannelsForAgent.mockResolvedValue([{ id: 'ch-1', type: 'baileys', name: 'Berg', status: 'connected' }]);
    render(<CreateCampaignModal onClose={vi.fn()} onCreated={vi.fn()} />);
    await screen.findByText('Berg');
    await userEvent.type(screen.getByLabelText(/mensagem/i), 'Oi');
    await userEvent.click(screen.getByRole('button', { name: /revisar/i }));
    expect(screen.getByText('Informe ao menos um destinatário.')).toBeInTheDocument();
  });

  test('canal oficial exige template selecionado (placeholder não conta)', async () => {
    api.listChannelsForAgent.mockResolvedValue([{ id: 'ch-2', type: 'meta_cloud', name: 'Oficial', status: 'connected' }]);
    api.listTemplatesForChannel.mockResolvedValue([{ id: 'tpl-1', name: 'aviso', variableCount: 1 }]);
    render(<CreateCampaignModal onClose={vi.fn()} onCreated={vi.fn()} />);
    await userEvent.selectOptions(await screen.findByLabelText(/template/i), '');
    await userEvent.type(screen.getByLabelText(/destinatários/i), '5511999990000');
    await userEvent.click(screen.getByRole('button', { name: /revisar/i }));
    expect(screen.getByText('Selecione um template aprovado.')).toBeInTheDocument();
    expect(screen.getByLabelText(/template/i)).toHaveAttribute('aria-invalid', 'true');
    expect(api.createCampaign).not.toHaveBeenCalled();
  });

  test('canal oficial exige template e variáveis preenchidas', async () => {
    api.listChannelsForAgent.mockResolvedValue([{ id: 'ch-2', type: 'meta_cloud', name: 'Oficial', status: 'connected' }]);
    api.listTemplatesForChannel.mockResolvedValue([{ id: 'tpl-1', name: 'aviso', variableCount: 1 }]);
    render(<CreateCampaignModal onClose={vi.fn()} onCreated={vi.fn()} />);
    await screen.findByLabelText(/variável 1/i);
    await userEvent.type(screen.getByLabelText(/destinatários/i), '5511999990000');
    await userEvent.click(screen.getByRole('button', { name: /revisar/i }));
    expect(screen.getByText('Preencha a variável 1.')).toBeInTheDocument();
  });

  test('a revisão mostra canal, contagem de destinatários e prévia, sem chamar a API', async () => {
    api.listChannelsForAgent.mockResolvedValue([{ id: 'ch-1', type: 'baileys', name: 'Berg', status: 'connected' }]);
    render(<CreateCampaignModal onClose={vi.fn()} onCreated={vi.fn()} />);
    await screen.findByText('Berg');
    await userEvent.type(screen.getByLabelText(/mensagem/i), 'Aviso importante');
    await userEvent.type(screen.getByLabelText(/destinatários/i), '5511999990000\n55 11 99999-0000\nabc');
    await userEvent.click(screen.getByRole('button', { name: /revisar/i }));
    expect(screen.getByRole('heading', { name: /revisar campanha/i })).toBeInTheDocument();
    expect(screen.getByText(/Berg/)).toBeInTheDocument();
    expect(screen.getByText(/Baileys/)).toBeInTheDocument();
    expect(screen.getByText('1 destinatário válido')).toBeInTheDocument();
    expect(screen.getByText('1 duplicado ignorado')).toBeInTheDocument();
    expect(screen.getByText('1 linha inválida')).toBeInTheDocument();
    expect(screen.getByText('Aviso importante')).toBeInTheDocument();
    expect(api.createCampaign).not.toHaveBeenCalled();
  });

  test('só dispara em "Confirmar e disparar", com o mesmo payload de antes', async () => {
    api.listChannelsForAgent.mockResolvedValue([{ id: 'ch-1', type: 'baileys', name: 'Berg', status: 'connected' }]);
    api.createCampaign.mockResolvedValue({ id: 'campaign-1' });
    const onCreated = vi.fn();
    render(<CreateCampaignModal onClose={vi.fn()} onCreated={onCreated} />);
    await screen.findByText('Berg');
    await userEvent.type(screen.getByLabelText(/mensagem/i), 'Aviso importante');
    await userEvent.type(screen.getByLabelText(/destinatários/i), '5511999990000\n5511999990001,Maria');
    await userEvent.click(screen.getByRole('button', { name: /revisar/i }));
    await userEvent.click(screen.getByRole('button', { name: /confirmar e disparar/i }));
    await waitFor(() =>
      expect(api.createCampaign).toHaveBeenCalledWith(
        { channelId: 'ch-1', name: '', content: 'Aviso importante', recipients: '5511999990000\n5511999990001,Maria' },
        'tok-123'
      )
    );
    expect(onCreated).toHaveBeenCalledWith({ id: 'campaign-1' });
  });

  test('Voltar retorna ao formulário com os campos preservados', async () => {
    api.listChannelsForAgent.mockResolvedValue([{ id: 'ch-1', type: 'baileys', name: 'Berg', status: 'connected' }]);
    render(<CreateCampaignModal onClose={vi.fn()} onCreated={vi.fn()} />);
    await screen.findByText('Berg');
    await userEvent.type(screen.getByLabelText(/mensagem/i), 'Oi');
    await userEvent.type(screen.getByLabelText(/destinatários/i), '5511999990000');
    await userEvent.click(screen.getByRole('button', { name: /revisar/i }));
    await userEvent.click(screen.getByRole('button', { name: /voltar/i }));
    expect(screen.getByLabelText(/mensagem/i)).toHaveValue('Oi');
  });

  test('revisão de canal oficial mostra o template e as variáveis', async () => {
    api.listChannelsForAgent.mockResolvedValue([{ id: 'ch-2', type: 'meta_cloud', name: 'Oficial', status: 'connected' }]);
    api.listTemplatesForChannel.mockResolvedValue([{ id: 'tpl-1', name: 'aviso', variableCount: 1 }]);
    render(<CreateCampaignModal onClose={vi.fn()} onCreated={vi.fn()} />);
    await userEvent.type(await screen.findByLabelText(/variável 1/i), 'Maria');
    await userEvent.type(screen.getByLabelText(/destinatários/i), '5511999990000');
    await userEvent.click(screen.getByRole('button', { name: /revisar/i }));
    expect(screen.getByText(/template: aviso/i)).toBeInTheDocument();
    expect(screen.getByText(/variável 1: Maria/i)).toBeInTheDocument();
  });
});
