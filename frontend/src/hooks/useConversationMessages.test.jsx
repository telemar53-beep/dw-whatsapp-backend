import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useConversationMessages } from './useConversationMessages';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../contexts/SocketContext');
vi.mock('../services/api');

function createFakeSocket() {
  const handlers = {};
  return {
    on: vi.fn((event, cb) => {
      handlers[event] = cb;
    }),
    off: vi.fn(),
    trigger: (event, payload) => handlers[event] && handlers[event](payload),
  };
}

let fakeSocket;

beforeEach(() => {
  vi.clearAllMocks();
  fakeSocket = createFakeSocket();
  useAuth.mockReturnValue({ token: 'tok-123' });
  useSocket.mockReturnValue(fakeSocket);
});

describe('useConversationMessages', () => {
  test('fetches the message history for the given conversation', async () => {
    api.getMessages.mockResolvedValue([{ id: 'm1', content: 'Oi' }]);
    const { result } = renderHook(() => useConversationMessages('conv-1'));
    await waitFor(() => expect(result.current.messages).toEqual([{ id: 'm1', content: 'Oi' }]));
    // Pede 51 e não o histórico inteiro: 50 por página, mais uma de sonda para
    // saber se existe trecho anterior sem mudar o formato da resposta.
    expect(api.getMessages).toHaveBeenCalledWith('conv-1', 'tok-123', { limit: 51 });
  });

  test('message:new appends a message for this conversation', async () => {
    api.getMessages.mockResolvedValue([]);
    const { result } = renderHook(() => useConversationMessages('conv-1'));
    await waitFor(() => expect(result.current.messages).toEqual([]));

    act(() => {
      fakeSocket.trigger('message:new', {
        conversation: { id: 'conv-1' },
        message: { id: 'm1', content: 'Oi' },
      });
    });

    expect(result.current.messages).toEqual([{ id: 'm1', content: 'Oi' }]);
  });

  // Teste real 2026-09-15: em Automação/Espera (sem atendente) a mensagem do
  // cliente chega só como queue:new — a lista atualizava e o som tocava, mas
  // a conversa aberta só mostrava a bolha no F5.
  test('queue:new with a message for this conversation appends it', async () => {
    api.getMessages.mockResolvedValue([]);
    const { result } = renderHook(() => useConversationMessages('conv-1'));
    await waitFor(() => expect(result.current.messages).toEqual([]));

    act(() => {
      fakeSocket.trigger('queue:new', {
        conversation: { id: 'conv-1' },
        message: { id: 'm1', content: 'Tem carutapera?' },
      });
    });

    expect(result.current.messages).toEqual([{ id: 'm1', content: 'Tem carutapera?' }]);
  });

  test('queue:new without a message, or for another conversation, changes nothing', async () => {
    api.getMessages.mockResolvedValue([{ id: 'm0', content: 'Oi' }]);
    const { result } = renderHook(() => useConversationMessages('conv-1'));
    await waitFor(() => expect(result.current.messages).toEqual([{ id: 'm0', content: 'Oi' }]));

    act(() => {
      fakeSocket.trigger('queue:new', { conversation: { id: 'conv-1' }, message: null });
      fakeSocket.trigger('queue:new', { conversation: { id: 'conv-2' }, message: { id: 'm9', content: 'Outra' } });
    });

    expect(result.current.messages).toEqual([{ id: 'm0', content: 'Oi' }]);
  });

  // A mesma mensagem pode chegar duas vezes (o próprio envio pelo GET e o
  // message:new do servidor, ou queue:new + message:new): nunca duplica.
  test('message:new with an id already on screen merges instead of duplicating', async () => {
    api.getMessages.mockResolvedValue([{ id: 'm1', content: 'Oi', status: 'sent' }]);
    const { result } = renderHook(() => useConversationMessages('conv-1'));
    await waitFor(() => expect(result.current.messages).toHaveLength(1));

    act(() => {
      fakeSocket.trigger('message:new', {
        conversation: { id: 'conv-1' },
        message: { id: 'm1', content: 'Oi', whatsappMessageId: 'wamid.1' },
      });
    });

    expect(result.current.messages).toEqual([{ id: 'm1', content: 'Oi', status: 'sent', whatsappMessageId: 'wamid.1' }]);
  });

  test('message:new for a different conversation is ignored', async () => {
    api.getMessages.mockResolvedValue([]);
    const { result } = renderHook(() => useConversationMessages('conv-1'));
    await waitFor(() => expect(result.current.messages).toEqual([]));

    act(() => {
      fakeSocket.trigger('message:new', {
        conversation: { id: 'conv-OTHER' },
        message: { id: 'm1', content: 'Oi' },
      });
    });

    expect(result.current.messages).toEqual([]);
  });

  test('message:updated merges into the existing message by id', async () => {
    api.getMessages.mockResolvedValue([{ id: 'm1', content: 'Resposta', status: 'sent' }]);
    const { result } = renderHook(() => useConversationMessages('conv-1'));
    await waitFor(() => expect(result.current.messages).toHaveLength(1));

    act(() => {
      fakeSocket.trigger('message:updated', {
        conversationId: 'conv-1',
        message: { id: 'm1', content: 'Resposta', status: 'failed' },
      });
    });

    expect(result.current.messages).toEqual([{ id: 'm1', content: 'Resposta', status: 'failed' }]);
  });

  test('message:updated for a different conversation is ignored', async () => {
    api.getMessages.mockResolvedValue([{ id: 'm1', status: 'sent' }]);
    const { result } = renderHook(() => useConversationMessages('conv-1'));
    await waitFor(() => expect(result.current.messages).toHaveLength(1));

    act(() => {
      fakeSocket.trigger('message:updated', {
        conversationId: 'conv-OTHER',
        message: { id: 'm1', status: 'failed' },
      });
    });

    expect(result.current.messages).toEqual([{ id: 'm1', status: 'sent' }]);
  });

  test('a message:updated event merges into the existing message instead of replacing it, preserving fields the update does not carry', async () => {
    // seed a message that already has a repliedToPreview (as if loaded from the initial GET)
    api.getMessages.mockResolvedValue([
      { id: 'm1', content: 'R$150,00', status: 'sent', repliedToPreview: { content: 'Qual o valor?', direction: 'inbound' } },
    ]);
    const { result } = renderHook(() => useConversationMessages('conv-1'));
    await waitFor(() => expect(result.current.messages).toHaveLength(1));

    act(() => {
      fakeSocket.trigger('message:updated', {
        conversationId: 'conv-1',
        message: { id: 'm1', content: 'R$150,00', status: 'delivered' },
      });
    });

    expect(result.current.messages[0].status).toBe('delivered');
    expect(result.current.messages[0].repliedToPreview).toEqual({ content: 'Qual o valor?', direction: 'inbound' });
  });

  test('sendMessage posts to the API and appends the created message immediately', async () => {
    api.getMessages.mockResolvedValue([]);
    api.sendMessage.mockResolvedValue({ id: 'm2', content: 'Ola cliente', status: 'sent' });
    const { result } = renderHook(() => useConversationMessages('conv-1'));
    await waitFor(() => expect(result.current.messages).toEqual([]));

    await act(async () => {
      await result.current.sendMessage('Ola cliente');
    });

    expect(api.sendMessage).toHaveBeenCalledWith('conv-1', 'Ola cliente', 'tok-123', undefined, undefined, undefined);
    expect(result.current.messages).toEqual([{ id: 'm2', content: 'Ola cliente', status: 'sent' }]);
  });

  test('sendMessage forwards the file argument to the api call', async () => {
    api.getMessages.mockResolvedValue([]);
    api.sendMessage.mockResolvedValue({ id: 'm3', messageType: 'image' });
    const { result } = renderHook(() => useConversationMessages('conv-1'));
    await waitFor(() => expect(result.current.messages).toEqual([]));
    const fakeFile = new File(['bytes'], 'foto.jpg', { type: 'image/jpeg' });

    await act(async () => {
      await result.current.sendMessage('Legenda', fakeFile);
    });

    expect(api.sendMessage).toHaveBeenCalledWith('conv-1', 'Legenda', 'tok-123', fakeFile, undefined, undefined);
  });

  test('sendMessage forwards the repliedToMessageId argument to the api call', async () => {
    const { result } = renderHook(() => useConversationMessages('conv-1'));
    api.sendMessage.mockResolvedValue({ id: 'm4', content: 'R$150,00', status: 'sent' });

    await act(async () => {
      await result.current.sendMessage('R$150,00', undefined, 'msg-original');
    });

    expect(api.sendMessage).toHaveBeenCalledWith('conv-1', 'R$150,00', 'tok-123', undefined, 'msg-original', undefined);
  });

  test('appendMessage adds a message to the local list without calling the API', async () => {
    api.getMessages.mockResolvedValue([]);
    const { result } = renderHook(() => useConversationMessages('conv-1'));
    await waitFor(() => expect(result.current.messages).toEqual([]));

    act(() => {
      result.current.appendMessage({ id: 'm5', messageType: 'document', mediaPath: 'abc.pdf' });
    });

    expect(result.current.messages).toEqual([{ id: 'm5', messageType: 'document', mediaPath: 'abc.pdf' }]);
    expect(api.sendMessage).not.toHaveBeenCalled();
  });

  test('resets the message list when the conversationId changes', async () => {
    api.getMessages.mockResolvedValueOnce([{ id: 'm1' }]).mockResolvedValueOnce([{ id: 'm2' }]);
    const { result, rerender } = renderHook(({ id }) => useConversationMessages(id), {
      initialProps: { id: 'conv-1' },
    });
    await waitFor(() => expect(result.current.messages).toEqual([{ id: 'm1' }]));

    rerender({ id: 'conv-2' });

    await waitFor(() => expect(result.current.messages).toEqual([{ id: 'm2' }]));
  });

  test('message:transcription preenche a transcrição da mensagem', async () => {
    api.getMessages.mockResolvedValue([{ id: 'm1', messageType: 'audio', transcriptionStatus: 'pending' }]);
    const { result } = renderHook(() => useConversationMessages('conv-1'));
    await waitFor(() => expect(result.current.messages).toHaveLength(1));

    act(() => {
      fakeSocket.trigger('message:transcription', {
        conversationId: 'conv-1',
        messageId: 'm1',
        transcription: 'minha internet caiu',
        transcriptionStatus: 'completed',
        transcriptionDetail: null,
      });
    });

    expect(result.current.messages[0].transcription).toBe('minha internet caiu');
    expect(result.current.messages[0].transcriptionStatus).toBe('completed');
    expect(result.current.messages[0].messageType).toBe('audio');
  });

  test('message:transcription atualiza só a mensagem alvo, deixando as outras da mesma conversa intocadas', async () => {
    api.getMessages.mockResolvedValue([
      { id: 'm1', messageType: 'audio', transcriptionStatus: 'pending' },
      { id: 'm2', messageType: 'audio', transcriptionStatus: 'pending' },
    ]);
    const { result } = renderHook(() => useConversationMessages('conv-1'));
    await waitFor(() => expect(result.current.messages).toHaveLength(2));

    act(() => {
      fakeSocket.trigger('message:transcription', {
        conversationId: 'conv-1',
        messageId: 'm2',
        transcription: 'minha internet caiu',
        transcriptionStatus: 'completed',
        transcriptionDetail: null,
      });
    });

    expect(result.current.messages).toHaveLength(2);
    const m1 = result.current.messages.find((m) => m.id === 'm1');
    const m2 = result.current.messages.find((m) => m.id === 'm2');
    expect(m2.transcription).toBe('minha internet caiu');
    expect(m2.transcriptionStatus).toBe('completed');
    expect(m1.transcription).toBeUndefined();
    expect(m1.transcriptionStatus).toBe('pending');
  });

  test('message:transcription de outra conversa é ignorado', async () => {
    api.getMessages.mockResolvedValue([{ id: 'm1', messageType: 'audio', transcriptionStatus: 'pending' }]);
    const { result } = renderHook(() => useConversationMessages('conv-1'));
    await waitFor(() => expect(result.current.messages).toHaveLength(1));

    act(() => {
      fakeSocket.trigger('message:transcription', {
        conversationId: 'conv-2', messageId: 'm1',
        transcription: 'texto errado', transcriptionStatus: 'completed', transcriptionDetail: null,
      });
    });

    expect(result.current.messages[0].transcription).toBeUndefined();
  });

  test('message:transcription para mensagem desconhecida não quebra a lista', async () => {
    api.getMessages.mockResolvedValue([{ id: 'm1', messageType: 'audio' }]);
    const { result } = renderHook(() => useConversationMessages('conv-1'));
    await waitFor(() => expect(result.current.messages).toHaveLength(1));

    act(() => {
      fakeSocket.trigger('message:transcription', {
        conversationId: 'conv-1', messageId: 'm-inexistente',
        transcription: 'x', transcriptionStatus: 'completed', transcriptionDetail: null,
      });
    });

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].id).toBe('m1');
    expect(result.current.messages[0].transcription).toBeUndefined();
  });
});

// Uma promessa que o teste resolve na hora que quiser: é assim que se monta a
// corrida "a resposta chegou depois de o atendente trocar de conversa".
function adiado() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const lote = (prefixo, n) => Array.from({ length: n }, (_, i) => ({ id: `${prefixo}${i + 1}` }));

describe('carregar mensagens anteriores', () => {
  // O cursor era lido de dentro de um updater de setMessages, logo depois de
  // setCarregandoAnteriores(true). Com uma atualização já pendente na fibra, o
  // React 18 não executa o updater na hora: o cursor saía undefined, o
  // getMessages descartava o `before` e a chamada repetia a da abertura
  // (?limit=51). O botão existia e não trazia nada.
  test('pede o trecho anterior à mensagem mais antiga que está na tela', async () => {
    api.getMessages.mockResolvedValueOnce(lote('a', 51)).mockResolvedValueOnce(lote('o', 51));
    const { result } = renderHook(() => useConversationMessages('conv-1'));
    await waitFor(() => expect(result.current.messages).toHaveLength(50));
    expect(result.current.messages[0].id).toBe('a2');
    expect(result.current.temAnteriores).toBe(true);

    await act(() => result.current.carregarAnteriores());

    expect(api.getMessages).toHaveBeenLastCalledWith('conv-1', 'tok-123', { limit: 51, before: 'a2' });
    expect(result.current.messages).toHaveLength(100);
    expect(result.current.messages[0].id).toBe('o2');
    expect(result.current.messages[50].id).toBe('a2');
    expect(result.current.temAnteriores).toBe(true);
    expect(result.current.carregandoAnteriores).toBe(false);
  });

  test('trocar de conversa com o pedido pendente não deixa a nova em "Carregando…"', async () => {
    const anterioresDeA = adiado();
    api.getMessages
      .mockResolvedValueOnce(lote('a', 51))
      .mockReturnValueOnce(anterioresDeA.promise)
      .mockResolvedValueOnce(lote('b', 51));
    const { result, rerender } = renderHook(({ id }) => useConversationMessages(id), {
      initialProps: { id: 'conv-A' },
    });
    await waitFor(() => expect(result.current.messages).toHaveLength(50));

    let pedido;
    act(() => {
      pedido = result.current.carregarAnteriores();
    });
    expect(result.current.carregandoAnteriores).toBe(true);

    rerender({ id: 'conv-B' });
    await waitFor(() => expect(result.current.messages[0] && result.current.messages[0].id).toBe('b2'));

    // O botão de B não pode nascer desabilitado pelo pedido de A.
    expect(result.current.carregandoAnteriores).toBe(false);

    await act(async () => {
      anterioresDeA.resolve(lote('velhaDeA', 51));
      await pedido;
    });
    expect(result.current.carregandoAnteriores).toBe(false);
  });

  test('a resposta atrasada de A não entra na lista de B nem acende o botão de B', async () => {
    const anterioresDeA = adiado();
    api.getMessages
      .mockResolvedValueOnce(lote('a', 51))
      .mockReturnValueOnce(anterioresDeA.promise)
      .mockResolvedValueOnce(lote('b', 3));
    const { result, rerender } = renderHook(({ id }) => useConversationMessages(id), {
      initialProps: { id: 'conv-A' },
    });
    await waitFor(() => expect(result.current.messages).toHaveLength(50));

    let pedido;
    act(() => {
      pedido = result.current.carregarAnteriores();
    });
    rerender({ id: 'conv-B' });
    await waitFor(() => expect(result.current.messages.map((m) => m.id)).toEqual(['b1', 'b2', 'b3']));
    expect(result.current.temAnteriores).toBe(false);

    await act(async () => {
      anterioresDeA.resolve(lote('velhaDeA', 51));
      await pedido;
    });

    expect(result.current.messages.map((m) => m.id)).toEqual(['b1', 'b2', 'b3']);
    expect(result.current.temAnteriores).toBe(false);
  });

  // Ir para B e voltar para A recarrega A: o pedido feito na visita anterior
  // foi calculado sobre uma lista que não existe mais, e juntá-lo à nova abriria
  // um buraco na timeline se chegou mensagem no meio.
  test('o pedido feito numa visita anterior não entra na conversa reaberta', async () => {
    const anterioresDaPrimeiraVisita = adiado();
    api.getMessages
      .mockResolvedValueOnce(lote('a', 51))
      .mockReturnValueOnce(anterioresDaPrimeiraVisita.promise)
      .mockResolvedValueOnce(lote('b', 3))
      .mockResolvedValueOnce(lote('a', 51));
    const { result, rerender } = renderHook(({ id }) => useConversationMessages(id), {
      initialProps: { id: 'conv-A' },
    });
    await waitFor(() => expect(result.current.messages).toHaveLength(50));

    let pedido;
    act(() => {
      pedido = result.current.carregarAnteriores();
    });
    rerender({ id: 'conv-B' });
    await waitFor(() => expect(result.current.messages).toHaveLength(3));
    rerender({ id: 'conv-A' });
    await waitFor(() => expect(result.current.messages).toHaveLength(50));

    await act(async () => {
      anterioresDaPrimeiraVisita.resolve(lote('velha', 51));
      await pedido;
    });

    expect(result.current.messages).toHaveLength(50);
    expect(result.current.messages[0].id).toBe('a2');
  });
});

describe('envio que termina com outra conversa aberta', () => {
  test('a resposta do envio de A não vira bolha na conversa B', async () => {
    const envio = adiado();
    api.getMessages
      .mockResolvedValueOnce([{ id: 'a1', conversationId: 'conv-A' }])
      .mockResolvedValueOnce([{ id: 'b1', conversationId: 'conv-B' }]);
    api.sendMessage.mockReturnValueOnce(envio.promise);
    const { result, rerender } = renderHook(({ id }) => useConversationMessages(id), {
      initialProps: { id: 'conv-A' },
    });
    await waitFor(() => expect(result.current.messages).toHaveLength(1));

    let enviando;
    act(() => {
      enviando = result.current.sendMessage('texto para A');
    });
    rerender({ id: 'conv-B' });
    await waitFor(() => expect(result.current.messages.map((m) => m.id)).toEqual(['b1']));

    let criada;
    await act(async () => {
      envio.resolve({ id: 'enviada-em-A', conversationId: 'conv-A', content: 'texto para A' });
      criada = await enviando;
    });

    // Continua enviada para A (é o certo) e quem chamou recebe a mensagem...
    expect(api.sendMessage).toHaveBeenCalledWith('conv-A', 'texto para A', 'tok-123', undefined, undefined, undefined);
    expect(criada).toEqual({ id: 'enviada-em-A', conversationId: 'conv-A', content: 'texto para A' });
    // ...mas a bolha não aparece em B.
    expect(result.current.messages.map((m) => m.id)).toEqual(['b1']);
  });

  test('appendMessage ignora uma mensagem que pertence a outra conversa', async () => {
    api.getMessages.mockResolvedValue([{ id: 'b1', conversationId: 'conv-B' }]);
    const { result } = renderHook(() => useConversationMessages('conv-B'));
    await waitFor(() => expect(result.current.messages).toHaveLength(1));

    act(() => {
      result.current.appendMessage({ id: 'pix-de-A', conversationId: 'conv-A', messageType: 'pix' });
    });

    expect(result.current.messages.map((m) => m.id)).toEqual(['b1']);
  });

  // Guarda de regressão: a trava é pela conversa, não pela "visita". Quem sai e
  // volta para A antes de o envio terminar tem de ver a bolha em A.
  test('o envio de A que termina depois de voltar para A aparece em A', async () => {
    const envio = adiado();
    api.getMessages
      .mockResolvedValueOnce([{ id: 'a1', conversationId: 'conv-A' }])
      .mockResolvedValueOnce([{ id: 'b1', conversationId: 'conv-B' }])
      .mockResolvedValueOnce([{ id: 'a1', conversationId: 'conv-A' }]);
    api.sendMessage.mockReturnValueOnce(envio.promise);
    const { result, rerender } = renderHook(({ id }) => useConversationMessages(id), {
      initialProps: { id: 'conv-A' },
    });
    await waitFor(() => expect(result.current.messages).toHaveLength(1));

    let enviando;
    act(() => {
      enviando = result.current.sendMessage('texto para A');
    });
    rerender({ id: 'conv-B' });
    await waitFor(() => expect(result.current.messages.map((m) => m.id)).toEqual(['b1']));
    rerender({ id: 'conv-A' });
    await waitFor(() => expect(result.current.messages.map((m) => m.id)).toEqual(['a1']));

    await act(async () => {
      envio.resolve({ id: 'enviada-em-A', conversationId: 'conv-A', content: 'texto para A' });
      await enviando;
    });

    expect(result.current.messages.map((m) => m.id)).toEqual(['a1', 'enviada-em-A']);
  });
});
