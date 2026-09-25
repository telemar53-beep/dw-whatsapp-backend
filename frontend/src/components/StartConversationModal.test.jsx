import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StartConversationModal from './StartConversationModal';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';
import { listChannelsForAgent, startConversation, listTemplatesForChannel } from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
});

describe('StartConversationModal', () => {
  test('lists only connected Baileys channels', async () => {
    api.listChannelsForAgent.mockResolvedValue([
      { id: 'ch-1', type: 'baileys', name: 'Berg', status: 'connected' },
      { id: 'ch-2', type: 'baileys', name: 'Desconectado', status: 'awaiting_qr' },
    ]);
    render(<StartConversationModal onClose={vi.fn()} onCreated={vi.fn()} />);

    expect(await screen.findByText('Berg')).toBeInTheDocument();
    expect(screen.queryByText('Desconectado')).not.toBeInTheDocument();
  });

  test('shows a message when there is no eligible channel', async () => {
    api.listChannelsForAgent.mockResolvedValue([]);
    render(<StartConversationModal onClose={vi.fn()} onCreated={vi.fn()} />);

    expect(await screen.findByText(/nenhum canal conectado/i)).toBeInTheDocument();
    expect(screen.getByText('Nenhum canal disponível para iniciar.')).toBeInTheDocument();
  });

  test('submits the form and calls onCreated with the new conversation', async () => {
    api.listChannelsForAgent.mockResolvedValue([{ id: 'ch-1', type: 'baileys', name: 'Berg', status: 'connected' }]);
    api.startConversation.mockResolvedValue({ id: 'conv-new' });
    const onCreated = vi.fn();
    render(<StartConversationModal onClose={vi.fn()} onCreated={onCreated} />);

    await screen.findByText('Berg');
    await userEvent.type(screen.getByLabelText(/telefone/i), '98999990000');
    await userEvent.type(screen.getByLabelText(/mensagem/i), 'Oi, tudo bem?');
    await userEvent.click(screen.getByRole('button', { name: /iniciar/i }));

    await waitFor(() =>
      expect(api.startConversation).toHaveBeenCalledWith(
        { channelId: 'ch-1', phoneNumber: '5598999990000', content: 'Oi, tudo bem?' },
        'tok-123'
      )
    );
    expect(onCreated).toHaveBeenCalledWith({ id: 'conv-new' });
  });

  test('pre-fills the country select with Brazil and leaves the phone field empty', async () => {
    api.listChannelsForAgent.mockResolvedValue([{ id: 'ch-1', type: 'baileys', name: 'Berg', status: 'connected' }]);
    render(<StartConversationModal onClose={vi.fn()} onCreated={vi.fn()} />);

    expect(screen.getByLabelText(/país/i)).toHaveValue('55');
    expect(screen.getByText('Brasil (+55)')).toBeInTheDocument();
    expect(screen.getByLabelText(/telefone/i)).toHaveValue('');
  });

  test('shows a live preview of the full phone number as it is typed', async () => {
    api.listChannelsForAgent.mockResolvedValue([{ id: 'ch-1', type: 'baileys', name: 'Berg', status: 'connected' }]);
    render(<StartConversationModal onClose={vi.fn()} onCreated={vi.fn()} />);

    await screen.findByText('Berg');
    await userEvent.type(screen.getByLabelText(/telefone/i), '98 98500-4187');

    expect(screen.getByText('Número completo: 5598985004187')).toBeInTheDocument();
  });

  test('builds the phone number with the selected country code', async () => {
    api.listChannelsForAgent.mockResolvedValue([{ id: 'ch-1', type: 'baileys', name: 'Berg', status: 'connected' }]);
    api.startConversation.mockResolvedValue({ id: 'conv-new' });
    render(<StartConversationModal onClose={vi.fn()} onCreated={vi.fn()} />);

    await screen.findByText('Berg');
    await userEvent.selectOptions(screen.getByLabelText(/país/i), '351');
    await userEvent.type(screen.getByLabelText(/telefone/i), '912345678');
    await userEvent.type(screen.getByLabelText(/mensagem/i), 'Oi');
    await userEvent.click(screen.getByRole('button', { name: /iniciar/i }));

    await waitFor(() =>
      expect(api.startConversation).toHaveBeenCalledWith(
        { channelId: 'ch-1', phoneNumber: '351912345678', content: 'Oi' },
        'tok-123'
      )
    );
  });

  test('shows a field error and does not call the API when the phone is left empty', async () => {
    api.listChannelsForAgent.mockResolvedValue([{ id: 'ch-1', type: 'baileys', name: 'Berg', status: 'connected' }]);
    render(<StartConversationModal onClose={vi.fn()} onCreated={vi.fn()} />);

    await screen.findByText('Berg');
    await userEvent.type(screen.getByLabelText(/mensagem/i), 'Oi');
    await userEvent.click(screen.getByRole('button', { name: /iniciar/i }));

    expect(await screen.findByText('Informe o telefone com DDD.')).toBeInTheDocument();
    expect(api.startConversation).not.toHaveBeenCalled();
  });

  test('shows an error and keeps the modal open when the API rejects', async () => {
    api.listChannelsForAgent.mockResolvedValue([{ id: 'ch-1', type: 'baileys', name: 'Berg', status: 'connected' }]);
    api.startConversation.mockRejectedValue({ body: { error: 'Já existe um atendimento em andamento' } });
    const onClose = vi.fn();
    render(<StartConversationModal onClose={onClose} onCreated={vi.fn()} />);

    await screen.findByText('Berg');
    await userEvent.type(screen.getByLabelText(/telefone/i), '98999990000');
    await userEvent.type(screen.getByLabelText(/mensagem/i), 'Oi');
    await userEvent.click(screen.getByRole('button', { name: /iniciar/i }));

    expect(await screen.findByText('Já existe um atendimento em andamento')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  test('calls onClose when Cancelar is clicked', async () => {
    api.listChannelsForAgent.mockResolvedValue([]);
    const onClose = vi.fn();
    render(<StartConversationModal onClose={onClose} onCreated={vi.fn()} />);

    await userEvent.click(await screen.findByRole('button', { name: /cancelar/i }));
    expect(onClose).toHaveBeenCalled();
  });

  test('shows a loading message before the channel fetch resolves', () => {
    let resolvePromise;
    api.listChannelsForAgent.mockReturnValue(new Promise((resolve) => { resolvePromise = resolve; }));
    render(<StartConversationModal onClose={vi.fn()} onCreated={vi.fn()} />);

    expect(screen.getByText(/carregando canais/i)).toBeInTheDocument();
    resolvePromise([]);
  });

  test('shows a distinct error message when the channel fetch fails, not the empty-list message', async () => {
    api.listChannelsForAgent.mockRejectedValue(new Error('network error'));
    render(<StartConversationModal onClose={vi.fn()} onCreated={vi.fn()} />);

    expect(await screen.findByText(/não foi possível carregar os canais/i)).toBeInTheDocument();
    expect(screen.queryByText(/nenhum canal baileys conectado/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /iniciar/i })).toBeDisabled();
  });

  test('shows the template banner and dropdown for a meta_cloud channel', async () => {
    listChannelsForAgent.mockResolvedValue([
      { id: 'ch-1', type: 'meta_cloud', name: 'Oficial', status: 'disconnected' },
    ]);
    listTemplatesForChannel.mockResolvedValue([
      { id: 'tpl-1', name: 'fatura_vencida', variableCount: 2 },
    ]);
    render(<StartConversationModal onClose={vi.fn()} onCreated={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(/requer o uso de template/i)).toBeInTheDocument());
    expect(screen.getByLabelText(/template/i)).toBeInTheDocument();
  });

  test('renders one input per template variable and submits them with the template id', async () => {
    const onCreated = vi.fn();
    listChannelsForAgent.mockResolvedValue([{ id: 'ch-1', type: 'meta_cloud', name: 'Oficial', status: 'disconnected' }]);
    listTemplatesForChannel.mockResolvedValue([{ id: 'tpl-1', name: 'fatura_vencida', variableCount: 2 }]);
    startConversation.mockResolvedValue({ id: 'conv-1' });
    render(<StartConversationModal onClose={vi.fn()} onCreated={onCreated} />);

    await waitFor(() => expect(screen.getByLabelText(/template/i)).toBeInTheDocument());
    const variableInputs = screen.getAllByLabelText(/variável/i);
    expect(variableInputs).toHaveLength(2);
    await userEvent.type(variableInputs[0], 'João');
    await userEvent.type(variableInputs[1], 'R$150,00');
    await userEvent.type(screen.getByLabelText(/telefone/i), '11999990000');
    await userEvent.click(screen.getByRole('button', { name: /iniciar/i }));

    await waitFor(() =>
      expect(startConversation).toHaveBeenCalledWith(
        { channelId: 'ch-1', phoneNumber: '5511999990000', templateId: 'tpl-1', templateVariables: ['João', 'R$150,00'] },
        'tok-123'
      )
    );
    expect(onCreated).toHaveBeenCalledWith({ id: 'conv-1' });
  });

  test('lists both baileys and meta_cloud channels together', async () => {
    listChannelsForAgent.mockResolvedValue([
      { id: 'ch-1', type: 'baileys', name: 'Berg', status: 'connected' },
      { id: 'ch-2', type: 'meta_cloud', name: 'Oficial', status: 'disconnected' },
    ]);
    listTemplatesForChannel.mockResolvedValue([]);
    render(<StartConversationModal onClose={vi.fn()} onCreated={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole('option', { name: 'Berg' })).toBeInTheDocument());
    expect(screen.getByRole('option', { name: 'Oficial' })).toBeInTheDocument();
  });

  test('excludes a disconnected baileys channel but still includes a disconnected meta_cloud one', async () => {
    listChannelsForAgent.mockResolvedValue([
      { id: 'ch-1', type: 'baileys', name: 'Berg', status: 'disconnected' },
      { id: 'ch-2', type: 'meta_cloud', name: 'Oficial', status: 'disconnected' },
    ]);
    listTemplatesForChannel.mockResolvedValue([]);
    render(<StartConversationModal onClose={vi.fn()} onCreated={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole('option', { name: 'Oficial' })).toBeInTheDocument());
    expect(screen.queryByRole('option', { name: 'Berg' })).not.toBeInTheDocument();
    expect(screen.getByText('Este canal precisa de um template aprovado para iniciar.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Iniciar conversa' })).toBeDisabled();
  });
});

// Template de disparo (o que o SGP usa) não é para aparecer aqui: o atendente
// escolhe só os escritos para conversa individual.
describe('StartConversationModal — finalidade dos templates', () => {
  test('pede à API só os templates de atendimento', async () => {
    api.listChannelsForAgent.mockResolvedValue([{ id: 'ch-1', name: 'Oficial', type: 'meta_cloud', status: 'connected' }]);
    api.listTemplatesForChannel.mockResolvedValue([]);

    render(<StartConversationModal onClose={vi.fn()} onCreated={vi.fn()} />);

    await waitFor(() => expect(api.listTemplatesForChannel).toHaveBeenCalledWith('ch-1', 'tok-123', 'atendimento'));
  });
});

// A dor real: iniciar a conversa entrega o template e para ali. A janela de 24h
// não abre com o template — só com a resposta do cliente. O atendente tem que
// saber disso ANTES de escolher, porque a escolha decide se vai dar para
// combinar o agendamento ou se a mensagem morre sem resposta.
describe('StartConversationModal — o que acontece depois do template', () => {
  const CANAL = [{ id: 'ch-1', type: 'meta_cloud', name: 'Oficial', status: 'connected' }];

  test('mostra os botões do template escolhido', async () => {
    api.listChannelsForAgent.mockResolvedValue(CANAL);
    api.listTemplatesForChannel.mockResolvedValue([
      { id: 'tpl-1', name: 'agendar_instalacao', bodyText: 'Podemos agendar?', variableCount: 0, buttons: ['Sim, pode agendar', 'Prefiro outro dia'] },
    ]);
    render(<StartConversationModal onClose={vi.fn()} onCreated={vi.fn()} />);

    expect(await screen.findByText('Sim, pode agendar')).toBeInTheDocument();
    expect(screen.getByText('Prefiro outro dia')).toBeInTheDocument();
  });

  test('avisa que sem botão a conversa só continua quando o cliente responder', async () => {
    api.listChannelsForAgent.mockResolvedValue(CANAL);
    api.listTemplatesForChannel.mockResolvedValue([
      { id: 'tpl-1', name: 'aviso', bodyText: 'Aviso', variableCount: 0, buttons: [] },
    ]);
    render(<StartConversationModal onClose={vi.fn()} onCreated={vi.fn()} />);

    expect(await screen.findByText(/só continua depois que o cliente responder/i)).toBeInTheDocument();
  });

  test('com botão, o aviso é o de que a resposta abre a conversa', async () => {
    api.listChannelsForAgent.mockResolvedValue(CANAL);
    api.listTemplatesForChannel.mockResolvedValue([
      { id: 'tpl-1', name: 'agendar', bodyText: 'Podemos agendar?', variableCount: 0, buttons: ['Sim'] },
    ]);
    render(<StartConversationModal onClose={vi.fn()} onCreated={vi.fn()} />);

    expect(await screen.findByText(/um toque/i)).toBeInTheDocument();
    expect(screen.queryByText(/só continua depois que o cliente responder/i)).not.toBeInTheDocument();
  });

  test('o foco começa no Telefone (A1-2)', async () => {
    api.listChannelsForAgent.mockResolvedValue([{ id: 'ch-1', type: 'baileys', name: 'Berg', status: 'connected' }]);
    render(<StartConversationModal onClose={vi.fn()} onCreated={vi.fn()} />);
    await screen.findByText('Berg');
    await waitFor(() => expect(screen.getByLabelText(/telefone/i)).toHaveFocus());
  });

  test('mensagem vazia: erro na tela junto do campo, como o do telefone, e nada é enviado (A1-10)', async () => {
    api.listChannelsForAgent.mockResolvedValue([{ id: 'ch-1', type: 'baileys', name: 'Berg', status: 'connected' }]);
    render(<StartConversationModal onClose={vi.fn()} onCreated={vi.fn()} />);
    await screen.findByText('Berg');
    await userEvent.type(screen.getByLabelText(/telefone/i), '98999990000');
    await userEvent.click(screen.getByRole('button', { name: /iniciar/i }));
    expect(await screen.findByText('Escreva a mensagem inicial.')).toBeInTheDocument();
    expect(screen.getByLabelText(/mensagem/i)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText(/mensagem/i)).not.toBeRequired();
    expect(api.startConversation).not.toHaveBeenCalled();
  });
});
