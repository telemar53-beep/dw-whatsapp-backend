import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
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
    await userEvent.type(screen.getByLabelText(/telefone/i), '98 91234-5678');

    expect(screen.getByText('Número completo: 5598912345678')).toBeInTheDocument();
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

  test('o título é o do botão que abre: "Nova conversa"', async () => {
    api.listChannelsForAgent.mockResolvedValue([{ id: 'ch-1', type: 'baileys', name: 'Berg', status: 'connected' }]);
    render(<StartConversationModal onClose={vi.fn()} onCreated={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Nova conversa' })).toHaveClass('mc');
    await screen.findByText('Berg');
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

function largura(px) {
  vi.stubGlobal('matchMedia', (consulta) => {
    const max = /max-width:\s*(\d+)px/.exec(consulta);
    return { matches: Boolean(max) && px <= Number(max[1]), media: consulta, addEventListener() {}, removeEventListener() {} };
  });
}

// A1-6: a seção de conteúdo (mensagem ou template) só aparece depois de saber
// o tipo do canal — antes, o campo de mensagem aparecia e trocava pelo template.
// A1-7: o erro do envio fica fixo entre o corpo e o rodapé.
describe('Nova conversa: conteúdo só com o tipo do canal, erro fixo', () => {
  afterEach(() => vi.unstubAllGlobals());
  const OFICIAL = [{ id: 'ch-1', type: 'meta_cloud', name: 'Oficial', status: 'connected' }];

  test('carregando os canais: nem mensagem nem template (A1-6)', () => {
    api.listChannelsForAgent.mockReturnValue(new Promise(() => {}));
    render(<StartConversationModal onClose={vi.fn()} onCreated={vi.fn()} />);
    expect(screen.queryByLabelText(/mensagem/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^template$/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/telefone/i)).toBeInTheDocument();
  });

  test('canal oficial: nunca mostra o campo de mensagem, nem enquanto os templates chegam (A1-6)', async () => {
    let entregar;
    api.listChannelsForAgent.mockResolvedValue(OFICIAL);
    api.listTemplatesForChannel.mockReturnValue(new Promise((r) => { entregar = r; }));
    render(<StartConversationModal onClose={vi.fn()} onCreated={vi.fn()} />);
    expect(await screen.findByText('Carregando templates…')).toBeInTheDocument();
    expect(screen.queryByLabelText(/mensagem/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Nenhum template aprovado para este canal.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Iniciar conversa' })).toBeDisabled();
    expect(screen.getByText('Aguarde a lista de templates.')).toBeInTheDocument();
    await act(async () => { entregar([{ id: 'tpl-1', name: 'fatura_vencida', variableCount: 0 }]); });
    expect(screen.getByLabelText(/^template$/i)).toHaveValue('tpl-1');
  });

  test('falha nos templates: diz, oferece "Tentar de novo" e não finge lista vazia', async () => {
    api.listChannelsForAgent.mockResolvedValue(OFICIAL);
    api.listTemplatesForChannel
      .mockRejectedValueOnce(new Error('rede'))
      .mockResolvedValueOnce([{ id: 'tpl-1', name: 'fatura_vencida', variableCount: 0 }]);
    render(<StartConversationModal onClose={vi.fn()} onCreated={vi.fn()} />);
    expect(await screen.findByText('Não foi possível carregar os templates.')).toBeInTheDocument();
    expect(screen.queryByText('Nenhum template aprovado para este canal.')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByLabelText(/^template$/i)).toHaveValue('tpl-1');
    expect(api.listTemplatesForChannel).toHaveBeenCalledTimes(2);
  });

  test('resposta atrasada de outro canal não vira a lista do canal escolhido', async () => {
    const pedidos = {};
    api.listChannelsForAgent.mockResolvedValue([
      { id: 'ch-a', type: 'meta_cloud', name: 'Oficial A', status: 'connected' },
      { id: 'ch-b', type: 'meta_cloud', name: 'Oficial B', status: 'connected' },
    ]);
    api.listTemplatesForChannel.mockImplementation((canal) => new Promise((r) => { pedidos[canal] = r; }));
    render(<StartConversationModal onClose={vi.fn()} onCreated={vi.fn()} />);
    await screen.findByRole('option', { name: 'Oficial B' });
    await userEvent.selectOptions(screen.getByLabelText('Canal'), 'ch-b');
    await act(async () => { pedidos['ch-b']([{ id: 'tpl-b', name: 'do_b', variableCount: 0 }]); });
    await act(async () => { pedidos['ch-a']([{ id: 'tpl-a', name: 'do_a', variableCount: 0 }]); });
    expect(screen.getByLabelText(/^template$/i)).toHaveValue('tpl-b');
    expect(screen.queryByRole('option', { name: 'do_a' })).not.toBeInTheDocument();
  });

  test('erro do envio: fixo acima do rodapé, fora do corpo que rola (A1-7); um envio por clique', async () => {
    api.listChannelsForAgent.mockResolvedValue([{ id: 'ch-1', type: 'baileys', name: 'Berg', status: 'connected' }]);
    let recusar;
    api.startConversation.mockReturnValue(new Promise((_, r) => { recusar = r; }));
    render(<StartConversationModal onClose={vi.fn()} onCreated={vi.fn()} />);
    await screen.findByText('Berg');
    await userEvent.type(screen.getByLabelText(/telefone/i), '98999990000');
    await userEvent.type(screen.getByLabelText(/mensagem/i), 'Oi');
    const iniciar = screen.getByRole('button', { name: 'Iniciar conversa' });
    await userEvent.click(iniciar);
    await userEvent.click(iniciar);
    expect(api.startConversation).toHaveBeenCalledTimes(1);
    await act(async () => { recusar({ body: { error: 'There is already an open conversation with this contact on this channel' } }); });
    const erro = screen.getByRole('alert');
    expect(erro).toHaveTextContent('Já existe um atendimento aberto com este cliente neste canal.');
    expect(erro).toHaveClass('mc-erro');
    expect(erro.closest('.mc-corpo')).toBeNull();
  });

  test('celular: tela cheia, só a seta de voltar; campos com a classe de 16 px', async () => {
    largura(390);
    const onClose = vi.fn();
    api.listChannelsForAgent.mockResolvedValue([{ id: 'ch-1', type: 'baileys', name: 'Berg', status: 'connected' }]);
    render(<StartConversationModal onClose={onClose} onCreated={vi.fn()} />);
    await screen.findByText('Berg');
    const dialogo = screen.getByRole('dialog', { name: 'Nova conversa' });
    expect(dialogo).toHaveClass('is-celular');
    expect(screen.queryByRole('button', { name: 'Fechar' })).not.toBeInTheDocument();
    for (const campo of [screen.getByLabelText(/telefone/i), screen.getByLabelText(/país/i), screen.getByLabelText(/mensagem/i)]) {
      expect(campo).toHaveClass('mc-entrada');
    }
    // No celular o teclado não sobe sozinho: o foco começa no diálogo.
    expect(dialogo).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('desktop: "Fechar" no cabeçalho e Escape fecham; sem "×"', async () => {
    const onClose = vi.fn();
    api.listChannelsForAgent.mockResolvedValue([]);
    render(<StartConversationModal onClose={onClose} onCreated={vi.fn()} />);
    await screen.findByText(/nenhum canal conectado/i);
    expect(document.querySelector('[data-dialog-close]')).toBeNull();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
