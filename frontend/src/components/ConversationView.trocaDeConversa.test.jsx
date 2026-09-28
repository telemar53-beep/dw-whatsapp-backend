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

// O painel do SGP abre só pelo botão (e chega sob demanda).
async function abrirSgp() {
  await userEvent.click(screen.getByLabelText('Consultar SGP'));
  await screen.findByRole('region', { name: 'Consulta SGP' });
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
  // clearAllMocks não esvazia a fila de mockResolvedValueOnce: um teste que
  // falha antes de consumir a dele entregaria a resposta ao teste seguinte.
  api.getMessages.mockReset();
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

  // O jsdom mede tudo como zero, então sozinho ele não prova que a tela liga a
  // âncora (o `data-mensagem-id` de cada linha e a ref na linha do tempo). Aqui
  // cada linha de mensagem ganha uma posição de verdade: 60 px de altura, uma
  // embaixo da outra, deslocadas pelo scrollTop da linha do tempo.
  test('a mensagem que estava no topo continua no mesmo lugar depois do clique', async () => {
    const lote = (prefixo, n) =>
      Array.from({ length: n }, (_, i) => ({ id: `${prefixo}${i + 1}`, conversationId: 'conv-A', direction: 'inbound', content: `${prefixo} ${i + 1}` }));
    api.getMessages.mockResolvedValueOnce(lote('nova', 51)).mockResolvedValueOnce(lote('velha', 51));
    render(mostrar(A_SEM_SGP));
    const botao = await screen.findByRole('button', { name: 'Carregar mensagens anteriores' });

    const linhaDoTempo = document.querySelector('.chat-workspace-timeline');
    const medidas = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function medir() {
      if (this === linhaDoTempo) return { top: 0, bottom: 500, height: 500 };
      if (this.hasAttribute('data-mensagem-id') && linhaDoTempo.contains(this)) {
        const posicao = [...linhaDoTempo.querySelectorAll('[data-mensagem-id]')].indexOf(this);
        const topo = 40 + posicao * 60 - linhaDoTempo.scrollTop;
        return { top: topo, bottom: topo + 60, height: 60 };
      }
      return { top: 0, bottom: 0, height: 0 };
    });
    // O jsdom devolve lista vazia em getClientRects (não há layout); o hook lê
    // isso como "linha do tempo sem caixa" e não mede nada.
    const caixas = vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(function caixa() {
      return this === linhaDoTempo ? [{ top: 0, bottom: 500 }] : [];
    });
    try {
      linhaDoTempo.scrollTop = 0;
      const naTela = (texto) => screen.getByText(texto).closest('[data-mensagem-id]').getBoundingClientRect().top;
      const antes = naTela('nova 2'); // a primeira da tela (a extra, nova 1, é a sonda)

      await userEvent.click(botao);
      expect(await screen.findByText('velha 2')).toBeInTheDocument();

      expect(naTela('nova 2')).toBe(antes);
    } finally {
      medidas.mockRestore();
      caixas.mockRestore();
    }
  });
});

// Regressão achada na revisão da E1.1: a carga inicial SUBSTITUI a lista. Uma
// mensagem do socket que chega antes dela vira a lista inteira ([x]); a carga
// traz o histórico por cima ([..., x]) — a primeira muda e a última não, igual a
// um "anteriores". A conversa abria no topo em vez de na última mensagem.
describe('mensagem do socket durante a carga inicial', () => {
  function socketFalso() {
    const ouvintes = {};
    return {
      on: (evento, fn) => (ouvintes[evento] ||= new Set()).add(fn),
      off: (evento, fn) => ouvintes[evento] && ouvintes[evento].delete(fn),
      emitir: (evento, dados) => ouvintes[evento] && ouvintes[evento].forEach((fn) => fn(dados)),
    };
  }

  test('a conversa abre no fim mesmo quando a mensagem nova chega antes do histórico', async () => {
    const socket = socketFalso();
    useSocket.mockReturnValue(socket);
    const carga = adiado();
    api.getMessages.mockReturnValueOnce(carga.promise);
    const x = { id: 'x', conversationId: 'conv-A', direction: 'inbound', content: 'chegou agora' };
    const rolarAteOFim = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = rolarAteOFim;
    try {
      render(mostrar(A_SEM_SGP));
      await waitFor(() => expect(api.getMessages).toHaveBeenCalledTimes(1));

      act(() => socket.emitir('message:new', { conversation: { id: 'conv-A' }, message: x }));
      expect(await screen.findByText('chegou agora')).toBeInTheDocument();
      rolarAteOFim.mockClear();

      await act(async () => {
        carga.resolve([
          { id: 'h1', conversationId: 'conv-A', direction: 'inbound', content: 'histórico 1' },
          { id: 'h2', conversationId: 'conv-A', direction: 'outbound', content: 'histórico 2' },
          x,
        ]);
      });
      expect(await screen.findByText('histórico 1')).toBeInTheDocument();

      expect(rolarAteOFim).toHaveBeenCalled();
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });
});

describe('trocar de conversa com a consulta do SGP no caminho', () => {
  test('a consulta atrasada do cliente de A não aparece com a conversa de B aberta', async () => {
    const { rerender } = render(mostrar(CONVERSA_A));
    await abrirSgp();
    await waitFor(() => expect(consultas[CPF_A]).toBeDefined());

    rerender(mostrar(CONVERSA_B));
    await abrirSgp();
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
    await abrirSgp();
    await waitFor(() => expect(consultas[CPF_A]).toBeDefined());
    rerender(mostrar(CONVERSA_B));
    await abrirSgp();
    await responderConsulta(CPF_B);
    await act(async () => {
      consultas[CPF_A].resolve(CLIENTE[CPF_A]);
    });

    // O atendente, com B aberta, usa o que o painel mostra.
    await userEvent.click(await screen.findByRole('button', { name: 'Consultar 2ª via' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Código Pix' }));

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
    await abrirSgp();
    await responderConsulta(CPF_A);
    await userEvent.click(await screen.findByRole('button', { name: 'Consultar 2ª via' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Código Pix' }));
    expect(await screen.findByText('Código Pix enviado para o cliente')).toBeInTheDocument();

    rerender(mostrar(MESMO_CONTATO_EM_B));

    // Nada foi enviado em B: o painel não pode dizer que foi.
    expect(screen.queryByText('Código Pix enviado para o cliente')).not.toBeInTheDocument();
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
    await abrirSgp();
    await responderConsulta(CPF_A);
    await userEvent.click(await screen.findByRole('button', { name: 'Consultar 2ª via' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Código Pix' }));
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

// "Editar cliente" com o salvamento ainda no caminho quando a conversa troca.
// A resposta pertence à conversa (e ao contato) de onde saiu: nunca pode
// renomear o cliente seguinte, nem fechar a edição que estiver aberta nele.
describe('edição do contato: a resposta volta para a conversa de onde saiu', () => {
  const A = { ...A_SEM_SGP, contactId: 'contato-A', contactInternalNote: 'Nota de A' };
  const B = { ...B_SEM_SGP, contactId: 'contato-B', contactInternalNote: 'Nota de B' };

  const naMesa = (conversa) => <ConversationView conversation={conversa} onTransferClick={vi.fn()} onBack={vi.fn()} workspace />;
  const painel = () => screen.getByRole('complementary', { name: 'Dados do cliente' });
  const edicao = () => screen.getByRole('dialog', { name: 'Editar cliente' });
  // O modal de edição chega sob demanda.
  async function abrirEdicao(nome) {
    await userEvent.click(screen.getByRole('button', { name: `Editar cliente: ${nome}` }));
    return screen.findByRole('dialog', { name: 'Editar cliente' });
  }
  // O painel só existe aberto, e trocar de conversa o fecha.
  const abrirPainel = () => userEvent.click(screen.getByRole('button', { name: 'Dados do cliente' }));
  async function escrever(dialogo, rotulo, texto) {
    const campo = within(dialogo).getByLabelText(rotulo);
    await userEvent.clear(campo);
    await userEvent.type(campo, texto);
  }

  beforeEach(() => {
    // clearAllMocks não esvazia a fila de mockResolvedValueOnce: a resposta
    // que um teste não consumiu iria para o seguinte.
    api.updateContact.mockReset();
    api.listCities.mockResolvedValue([]);
  });

  test('salvar em A, trocar para B e só então A responder não muda nada em B', async () => {
    const salvarA = adiado();
    api.updateContact.mockReturnValueOnce(salvarA.promise);
    const { rerender } = render(naMesa(A));
    await screen.findByText('Mensagem de conv-A');

    const dialogoA = await abrirEdicao('Contato A');
    await escrever(dialogoA, 'Nome', 'Contato A editado');
    await escrever(dialogoA, 'Nota interna', 'Nota de A editada');
    await userEvent.click(within(dialogoA).getByRole('button', { name: 'Salvar alterações' }));
    expect(api.updateContact).toHaveBeenCalledWith('contato-A', expect.objectContaining({ displayName: 'Contato A editado' }), 'tok-123');

    rerender(naMesa(B));
    await screen.findByText('Mensagem de conv-B');
    await abrirPainel();
    // A edição de B já está aberta quando a resposta de A chega.
    const dialogoB = await abrirEdicao('Contato B');

    await act(async () => {
      salvarA.resolve({ id: 'contato-A', displayName: 'Contato A editado', cityId: null, localityId: null, internalNote: 'Nota de A editada' });
    });

    expect(screen.getByRole('dialog', { name: 'Editar cliente' })).toBe(dialogoB);
    expect(within(dialogoB).getByLabelText('Nome')).toHaveValue('Contato B');
    expect(within(dialogoB).getByLabelText('Nota interna')).toHaveValue('Nota de B');
    expect(screen.getByRole('button', { name: 'Editar cliente: Contato B' })).toBeInTheDocument();
    expect(within(painel()).getByText('Contato B')).toBeInTheDocument();
    expect(within(painel()).getByText('Nota de B')).toBeInTheDocument();
    expect(screen.queryByText('Contato A editado')).not.toBeInTheDocument();
    expect(screen.queryByText('Nota de A editada')).not.toBeInTheDocument();
  });

  test('voltar para A depois de salvar em B não traz nada de B', async () => {
    api.updateContact.mockResolvedValueOnce({ id: 'contato-B', displayName: 'Contato B editado', cityId: null, localityId: null, internalNote: 'Nota de B editada' });
    const { rerender } = render(naMesa(A));
    await screen.findByText('Mensagem de conv-A');
    rerender(naMesa(B));
    await screen.findByText('Mensagem de conv-B');
    await abrirPainel();

    const dialogoB = await abrirEdicao('Contato B');
    await escrever(dialogoB, 'Nome', 'Contato B editado');
    await escrever(dialogoB, 'Nota interna', 'Nota de B editada');
    await userEvent.click(within(dialogoB).getByRole('button', { name: 'Salvar alterações' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Editar cliente' })).not.toBeInTheDocument());
    expect(within(painel()).getByText('Nota de B editada')).toBeInTheDocument();

    rerender(naMesa(A));
    await screen.findByText('Mensagem de conv-A');
    await abrirPainel();

    expect(screen.getByRole('button', { name: 'Editar cliente: Contato A' })).toBeInTheDocument();
    expect(within(painel()).getByText('Contato A')).toBeInTheDocument();
    expect(within(painel()).getByText('Nota de A')).toBeInTheDocument();
    expect(screen.queryByText('Contato B editado')).not.toBeInTheDocument();
    expect(screen.queryByText('Nota de B editada')).not.toBeInTheDocument();
    const dialogoA = await abrirEdicao('Contato A');
    expect(within(dialogoA).getByLabelText('Nome')).toHaveValue('Contato A');
    expect(within(dialogoA).getByLabelText('Nota interna')).toHaveValue('Nota de A');
  });
});
