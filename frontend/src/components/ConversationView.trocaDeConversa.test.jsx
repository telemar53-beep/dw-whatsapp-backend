import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ConversationView from './ConversationView';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import { useQuickReplies } from '../hooks/useQuickReplies';
import { useAiSuggestion } from '../hooks/useAiSuggestion';
import * as api from '../services/api';

// Diferente do ConversationView.test.jsx, aqui useConversationMessages e
// useSgpLookup são os REAIS. As corridas deste arquivo vivem justamente entre
// eles e a tela: o ConversationView, o MessageInput e o painel do SGP não
// remontam ao trocar de conversa, e uma resposta ainda no caminho volta com
// outra conversa aberta.
vi.mock('../contexts/AuthContext');
vi.mock('../contexts/SocketContext');
vi.mock('../hooks/useQuickReplies');
vi.mock('../hooks/useAiSuggestion');
vi.mock('../services/api');

function adiado() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const CPF_A = '11111111111';
const CPF_B = '22222222222';

const CONVERSA_A = { id: 'conv-A', status: 'assigned', assignedAgentId: 'agent-1', contactDisplayName: 'Contato A', contactSgpDocument: CPF_A };
const CONVERSA_B = { id: 'conv-B', status: 'assigned', assignedAgentId: 'agent-1', contactDisplayName: 'Contato B', contactSgpDocument: CPF_B };
const A_SEM_SGP = { ...CONVERSA_A, contactSgpDocument: null };
const B_SEM_SGP = { ...CONVERSA_B, contactSgpDocument: null };

const CLIENTE = {
  [CPF_A]: { client: { id: 1, name: 'Ana Souza', document: '111.111.111-11' }, contracts: [{ id: 1001, status: 'Ativo' }] },
  [CPF_B]: { client: { id: 2, name: 'Bruno Lima', document: '222.222.222-22' }, contracts: [{ id: 2002, status: 'Ativo' }] },
};
const FATURA = {
  1001: { hasOpenInvoice: true, duplicates: [{ id: 'fat-A', dueDate: '2026-10-05', value: 99.9, pixCode: 'PIX-DE-A' }] },
  2002: { hasOpenInvoice: true, duplicates: [{ id: 'fat-B', dueDate: '2026-10-10', value: 120, pixCode: 'PIX-DE-B' }] },
};

// Cada consulta ao SGP fica pendente até o teste decidir quando ela volta.
let consultas;

function mostrar(conversa) {
  return <ConversationView conversation={conversa} onTransferClick={vi.fn()} onBack={vi.fn()} />;
}

async function responderConsulta(cpf) {
  await waitFor(() => expect(consultas[cpf]).toBeDefined());
  await act(async () => {
    consultas[cpf].resolve(CLIENTE[cpf]);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'agent-1', role: 'agent' } });
  useSocket.mockReturnValue(null);
  useQuickReplies.mockReturnValue({ quickReplies: [], status: 'ready', refresh: vi.fn() });
  useAiSuggestion.mockReturnValue({ suggestion: null, send: vi.fn(), edit: vi.fn(), discard: vi.fn() });
  api.getPublicCompany.mockResolvedValue({ name: 'Provedor X' });
  api.getMessages.mockImplementation((id) =>
    Promise.resolve([{ id: `${id}-m1`, conversationId: id, direction: 'inbound', content: `Mensagem de ${id}` }])
  );
  consultas = {};
  api.lookupSgpClient.mockImplementation((cpf) => {
    consultas[cpf] = adiado();
    return consultas[cpf].promise;
  });
  api.generateSgpDuplicateInvoice.mockImplementation((contratoId) => Promise.resolve(FATURA[contratoId]));
});

describe('carregar mensagens anteriores pela tela', () => {
  test('o clique pede o trecho antes da mensagem mais antiga e mostra as anteriores', async () => {
    const lote = (prefixo, n) =>
      Array.from({ length: n }, (_, i) => ({ id: `${prefixo}${i + 1}`, conversationId: 'conv-A', direction: 'inbound', content: `${prefixo} ${i + 1}` }));
    api.getMessages.mockResolvedValueOnce(lote('nova', 51)).mockResolvedValueOnce(lote('velha', 51));
    render(mostrar(A_SEM_SGP));

    await userEvent.click(await screen.findByRole('button', { name: 'Carregar mensagens anteriores' }));

    await waitFor(() => expect(api.getMessages).toHaveBeenCalledTimes(2));
    expect(api.getMessages).toHaveBeenLastCalledWith('conv-A', 'tok-123', { limit: 51, before: 'nova2' });
    expect(await screen.findByText('velha 2')).toBeInTheDocument();
  });

  // Defeito que a E1 expôs: a linha do tempo rolava para o fim sempre que o
  // NÚMERO de mensagens mudava. Com o "carregar anteriores" funcionando, quem
  // clicava no topo era jogado para o fim no mesmo instante em que as
  // anteriores entravam, sem ver o que carregou.
  test('as anteriores entram sem jogar a linha do tempo para o fim', async () => {
    const lote = (prefixo, n) =>
      Array.from({ length: n }, (_, i) => ({ id: `${prefixo}${i + 1}`, conversationId: 'conv-A', direction: 'inbound', content: `${prefixo} ${i + 1}` }));
    api.getMessages.mockResolvedValueOnce(lote('nova', 51)).mockResolvedValueOnce(lote('velha', 51));
    const rolarAteOFim = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = rolarAteOFim;
    try {
      render(mostrar(A_SEM_SGP));
      const botao = await screen.findByRole('button', { name: 'Carregar mensagens anteriores' });
      const chamadasAntesDoClique = rolarAteOFim.mock.calls.length;

      await userEvent.click(botao);
      expect(await screen.findByText('velha 2')).toBeInTheDocument();

      expect(rolarAteOFim.mock.calls.length).toBe(chamadasAntesDoClique);
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });
});

describe('trocar de conversa com a consulta do SGP no caminho', () => {
  test('a consulta atrasada do cliente de A não aparece com a conversa de B aberta', async () => {
    const { rerender } = render(mostrar(CONVERSA_A));
    await waitFor(() => expect(consultas[CPF_A]).toBeDefined());

    rerender(mostrar(CONVERSA_B));
    await responderConsulta(CPF_B);
    expect(await screen.findByText('Bruno Lima')).toBeInTheDocument();

    // A consulta de A, mais lenta, volta só agora.
    await act(async () => {
      consultas[CPF_A].resolve(CLIENTE[CPF_A]);
    });

    const painel = screen.getByRole('region', { name: 'Consulta SGP' });
    expect(within(painel).queryByText('Ana Souza')).not.toBeInTheDocument();
    expect(within(painel).getByText('Bruno Lima')).toBeInTheDocument();
  });

  test('nenhum envio de Pix sai com o contrato de A para a conversa de B', async () => {
    api.sendSgpPix.mockResolvedValue([]);
    const { rerender } = render(mostrar(CONVERSA_A));
    await waitFor(() => expect(consultas[CPF_A]).toBeDefined());
    rerender(mostrar(CONVERSA_B));
    await responderConsulta(CPF_B);
    await act(async () => {
      consultas[CPF_A].resolve(CLIENTE[CPF_A]);
    });

    // O atendente, com B aberta, usa o que o painel mostra.
    await userEvent.click(await screen.findByRole('button', { name: 'Consultar fatura em aberto' }));
    await userEvent.click(await screen.findByRole('button', { name: /cód pix/i }));

    await waitFor(() => expect(api.sendSgpPix).toHaveBeenCalledTimes(1));
    expect(api.sendSgpPix).toHaveBeenCalledWith(
      2002,
      'conv-B',
      { pixCode: 'PIX-DE-B', value: 120, dueDate: '2026-10-10', faturaId: 'fat-B' },
      'tok-123'
    );
    expect(api.generateSgpDuplicateInvoice).not.toHaveBeenCalledWith(1001, expect.anything());
  });

  // O mesmo contato pode ter duas conversas com o mesmo atendente (dois canais).
  // Com o mesmo CPF o initialCpf não muda, o painel não buscava de novo e B
  // herdava tudo de A — inclusive o aviso de que o Pix já tinha sido enviado.
  test('o painel recomeça em cada conversa: o "enviado" de A não aparece em B', async () => {
    api.sendSgpPix.mockResolvedValue([]);
    const MESMO_CONTATO_EM_B = { ...CONVERSA_B, contactSgpDocument: CPF_A };
    const { rerender } = render(mostrar(CONVERSA_A));
    await responderConsulta(CPF_A);
    await userEvent.click(await screen.findByRole('button', { name: 'Consultar fatura em aberto' }));
    await userEvent.click(await screen.findByRole('button', { name: /cód pix/i }));
    expect(await screen.findByText('Cód Pix enviado para o cliente')).toBeInTheDocument();

    rerender(mostrar(MESMO_CONTATO_EM_B));

    // Nada foi enviado em B: o painel não pode dizer que foi.
    expect(screen.queryByText('Cód Pix enviado para o cliente')).not.toBeInTheDocument();
    expect(api.sendSgpPix).toHaveBeenCalledTimes(1);
    expect(api.sendSgpPix).toHaveBeenCalledWith(1001, 'conv-A', expect.anything(), 'tok-123');
  });
});

describe('envio que termina com outra conversa aberta', () => {
  test('o texto enviado em A não aparece na timeline de B', async () => {
    const envio = adiado();
    api.sendMessage.mockReturnValueOnce(envio.promise);
    const { rerender } = render(mostrar(A_SEM_SGP));
    await screen.findByText('Mensagem de conv-A');
    await userEvent.type(screen.getByPlaceholderText('Digite uma mensagem…'), 'Olá, cliente A{Enter}');
    await waitFor(() => expect(api.sendMessage).toHaveBeenCalledTimes(1));

    rerender(mostrar(B_SEM_SGP));
    await screen.findByText('Mensagem de conv-B');
    await act(async () => {
      envio.resolve({ id: 'env-A', conversationId: 'conv-A', direction: 'outbound', content: 'Olá, cliente A', status: 'sent' });
    });

    // Foi para A, como devia; só não pode aparecer em B.
    expect(api.sendMessage).toHaveBeenCalledWith('conv-A', 'Olá, cliente A', 'tok-123', null, null, false);
    expect(screen.queryByText('Olá, cliente A')).not.toBeInTheDocument();
  });

  test('o Pix enviado em A não aparece na timeline de B', async () => {
    const envioPix = adiado();
    api.sendSgpPix.mockReturnValueOnce(envioPix.promise);
    const { rerender } = render(mostrar(CONVERSA_A));
    await responderConsulta(CPF_A);
    await userEvent.click(await screen.findByRole('button', { name: 'Consultar fatura em aberto' }));
    await userEvent.click(await screen.findByRole('button', { name: /cód pix/i }));
    await waitFor(() => expect(api.sendSgpPix).toHaveBeenCalledTimes(1));

    rerender(mostrar(B_SEM_SGP));
    await screen.findByText('Mensagem de conv-B');
    await act(async () => {
      envioPix.resolve([
        { id: 'pix-A', conversationId: 'conv-A', direction: 'outbound', messageType: 'text', content: 'Pix de A: PIX-DE-A' },
      ]);
    });

    expect(api.sendSgpPix).toHaveBeenCalledWith(1001, 'conv-A', expect.objectContaining({ pixCode: 'PIX-DE-A' }), 'tok-123');
    expect(screen.queryByText('Pix de A: PIX-DE-A')).not.toBeInTheDocument();
  });

  test('um envio lento em A não tranca o campo de B', async () => {
    const envioA = adiado();
    api.sendMessage
      .mockReturnValueOnce(envioA.promise)
      .mockResolvedValueOnce({ id: 'env-B', conversationId: 'conv-B', direction: 'outbound', content: 'Olá, cliente B', status: 'sent' });
    const { rerender } = render(mostrar(A_SEM_SGP));
    await screen.findByText('Mensagem de conv-A');
    await userEvent.type(screen.getByPlaceholderText('Digite uma mensagem…'), 'Olá, cliente A{Enter}');
    await waitFor(() => expect(api.sendMessage).toHaveBeenCalledTimes(1));

    rerender(mostrar(B_SEM_SGP));
    await screen.findByText('Mensagem de conv-B');
    await userEvent.type(screen.getByPlaceholderText('Digite uma mensagem…'), 'Olá, cliente B{Enter}');

    await waitFor(() => expect(api.sendMessage).toHaveBeenCalledTimes(2));
    expect(api.sendMessage).toHaveBeenLastCalledWith('conv-B', 'Olá, cliente B', 'tok-123', null, null, false);
    expect(await screen.findByText('Olá, cliente B')).toBeInTheDocument();

    await act(async () => {
      envioA.resolve({ id: 'env-A', conversationId: 'conv-A', direction: 'outbound', content: 'Olá, cliente A', status: 'sent' });
    });
    // Nada foi repetido: um envio por conversa.
    expect(api.sendMessage).toHaveBeenCalledTimes(2);
  });
});
