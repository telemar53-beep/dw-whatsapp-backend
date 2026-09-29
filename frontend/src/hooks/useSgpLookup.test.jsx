import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useSgpLookup } from './useSgpLookup';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';
import { ApiError } from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../services/api', async () => {
  const actual = await vi.importActual('../services/api');
  return { ...actual, lookupSgpClient: vi.fn(), generateSgpDuplicateInvoice: vi.fn() };
});

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
});

describe('useSgpLookup', () => {
  test('search populates client and contracts on success', async () => {
    api.lookupSgpClient.mockResolvedValue({ client: { id: 1, name: 'Cliente X', document: '000' }, contracts: [{ id: 17402, status: 'Ativo' }] });
    const { result } = renderHook(() => useSgpLookup());

    await act(() => result.current.search('03666811337'));

    expect(api.lookupSgpClient).toHaveBeenCalledWith('03666811337', 'tok-123');
    expect(result.current.client.name).toBe('Cliente X');
    expect(result.current.contracts).toHaveLength(1);
    expect(result.current.loading).toBe(false);
  });

  test('search sets error "not_found" on a 404', async () => {
    api.lookupSgpClient.mockRejectedValue(new ApiError(404, { error: 'Client not found' }));
    const { result } = renderHook(() => useSgpLookup());

    await act(() => result.current.search('00000000000'));

    expect(result.current.error).toBe('not_found');
    expect(result.current.client).toBeNull();
  });

  test('search sets error "error" on any other failure', async () => {
    api.lookupSgpClient.mockRejectedValue(new ApiError(502, { error: 'Failed to reach SGP' }));
    const { result } = renderHook(() => useSgpLookup());

    await act(() => result.current.search('03666811337'));

    expect(result.current.error).toBe('error');
  });

  test('search surfaces the backend\'s real error message for a non-404 failure', async () => {
    api.lookupSgpClient.mockRejectedValue(new ApiError(400, { error: 'SGP integration is not configured' }));
    const { result } = renderHook(() => useSgpLookup());

    await act(() => result.current.search('03666811337'));

    expect(result.current.error).toBe('error');
    expect(result.current.errorMessage).toBe('SGP integration is not configured');
  });

  test('fetchDuplicate stores the result keyed by contratoId', async () => {
    api.generateSgpDuplicateInvoice.mockResolvedValue({ hasOpenInvoice: true, duplicates: [{ id: '999' }] });
    const { result } = renderHook(() => useSgpLookup());

    await act(() => result.current.fetchDuplicate(17402));

    expect(api.generateSgpDuplicateInvoice).toHaveBeenCalledWith(17402, 'tok-123');
    expect(result.current.duplicateState[17402]).toEqual({ loading: false, error: null, hasOpenInvoice: true, duplicates: [{ id: '999' }] });
  });

  test('fetchDuplicate stores a loading state per contratoId while pending', () => {
    api.generateSgpDuplicateInvoice.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useSgpLookup());

    act(() => {
      result.current.fetchDuplicate(17402);
    });

    expect(result.current.duplicateState[17402]).toEqual({ loading: true, error: null });
  });
});

function adiado() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const RESPOSTA_A = { client: { id: 1, name: 'Ana Souza', document: '111' }, contracts: [{ id: 1001, status: 'Ativo' }] };
const RESPOSTA_B = { client: { id: 2, name: 'Bruno Lima', document: '222' }, contracts: [{ id: 2002, status: 'Ativo' }] };

// O painel do SGP não remonta ao trocar de conversa, e a busca de um cliente
// pode demorar mais que a do seguinte. Sem descartar a resposta velha, os dados
// de A apareciam com B aberta — e os botões de Pix/boleto mandavam o contrato
// de A para a conversa de B.
describe('useSgpLookup — só a busca mais recente vale', () => {
  test('a resposta atrasada de uma busca substituída é descartada', async () => {
    const buscaA = adiado();
    const buscaB = adiado();
    api.lookupSgpClient.mockReturnValueOnce(buscaA.promise).mockReturnValueOnce(buscaB.promise);
    const { result } = renderHook(() => useSgpLookup());

    let pedidoA;
    let pedidoB;
    act(() => {
      pedidoA = result.current.search('111');
    });
    act(() => {
      pedidoB = result.current.search('222');
    });

    await act(async () => {
      buscaB.resolve(RESPOSTA_B);
      await pedidoB;
    });
    expect(result.current.client.name).toBe('Bruno Lima');

    await act(async () => {
      buscaA.resolve(RESPOSTA_A);
      await pedidoA;
    });
    expect(result.current.client.name).toBe('Bruno Lima');
    expect(result.current.contracts).toEqual(RESPOSTA_B.contracts);
    expect(result.current.loading).toBe(false);
  });

  test('a busca velha que termina antes da nova não tira o "Buscando…" da nova', async () => {
    const buscaA = adiado();
    const buscaB = adiado();
    api.lookupSgpClient.mockReturnValueOnce(buscaA.promise).mockReturnValueOnce(buscaB.promise);
    const { result } = renderHook(() => useSgpLookup());

    let pedidoA;
    act(() => {
      pedidoA = result.current.search('111');
    });
    act(() => {
      result.current.search('222');
    });

    await act(async () => {
      buscaA.resolve(RESPOSTA_A);
      await pedidoA;
    });

    expect(result.current.client).toBeNull();
    expect(result.current.loading).toBe(true);
  });

  test('a falha atrasada de uma busca substituída não vira erro na nova', async () => {
    const buscaA = adiado();
    const buscaB = adiado();
    api.lookupSgpClient.mockReturnValueOnce(buscaA.promise).mockReturnValueOnce(buscaB.promise);
    const { result } = renderHook(() => useSgpLookup());

    let pedidoA;
    let pedidoB;
    act(() => {
      pedidoA = result.current.search('111');
    });
    act(() => {
      pedidoB = result.current.search('222');
    });
    await act(async () => {
      buscaB.resolve(RESPOSTA_B);
      await pedidoB;
    });

    await act(async () => {
      buscaA.reject(new ApiError(502, { error: 'Failed to reach SGP' }));
      await pedidoA;
    });

    expect(result.current.error).toBeNull();
    expect(result.current.client.name).toBe('Bruno Lima');
  });

  test('a segunda via pedida para o cliente anterior não aparece depois de uma nova busca', async () => {
    const segundaViaDeA = adiado();
    api.lookupSgpClient.mockResolvedValueOnce(RESPOSTA_A).mockResolvedValueOnce(RESPOSTA_B);
    api.generateSgpDuplicateInvoice.mockReturnValueOnce(segundaViaDeA.promise);
    const { result } = renderHook(() => useSgpLookup());

    await act(() => result.current.search('111'));
    let pedidoSegundaVia;
    act(() => {
      pedidoSegundaVia = result.current.fetchDuplicate(1001);
    });
    await act(() => result.current.search('222'));
    expect(result.current.duplicateState).toEqual({});

    await act(async () => {
      segundaViaDeA.resolve({ hasOpenInvoice: true, duplicates: [{ id: 'fat-A', pixCode: 'PIX-DE-A' }] });
      await pedidoSegundaVia;
    });

    expect(result.current.duplicateState).toEqual({});
  });

  // A conferência dos títulos chega na mesma resposta da 2ª via: pertence à mesma busca, e o
  // total de A não pode aparecer com B aberta.
  test('a conferência de A que chega atrasada não aparece com B aberta; a de B fica só no contrato de B', async () => {
    const segundaViaDeA = adiado();
    const CONFERENCIA_DE_B = { estado: 'completa', vencidas: [{ faturaId: 7, vencimentoOriginal: '2026-09-15', valor: 50 }], venceHoje: [], totalVencidas: 50 };
    api.lookupSgpClient.mockResolvedValueOnce(RESPOSTA_A).mockResolvedValueOnce(RESPOSTA_B);
    api.generateSgpDuplicateInvoice
      .mockReturnValueOnce(segundaViaDeA.promise)
      .mockResolvedValueOnce({ hasOpenInvoice: false, duplicates: [], conferencia: CONFERENCIA_DE_B });
    const { result } = renderHook(() => useSgpLookup());

    await act(() => result.current.search('111'));
    let pedidoDeA;
    act(() => {
      pedidoDeA = result.current.fetchDuplicate(1001);
    });
    await act(() => result.current.search('222'));
    await act(() => result.current.fetchDuplicate(2002));
    await act(async () => {
      segundaViaDeA.resolve({ hasOpenInvoice: true, duplicates: [{ id: 'fat-A' }], conferencia: { estado: 'completa', vencidas: [], venceHoje: [], totalVencidas: 200 } });
      await pedidoDeA;
    });

    expect(result.current.duplicateState).toEqual({
      2002: { loading: false, error: null, hasOpenInvoice: false, duplicates: [], conferencia: CONFERENCIA_DE_B },
    });
  });
});

// Dois cliques antes da resposta viravam duas chamadas ao SGP — e a 2ª via
// pode gerar Pix lá. O mesmo pedido em andamento não sai de novo; terminado,
// pode ser feito outra vez (sem cache: a informação vem sempre do SGP).
describe('useSgpLookup — pedido igual em andamento não sai de novo', () => {
  test('a mesma busca, repetida antes da resposta, chama o SGP uma vez só', async () => {
    const consulta = adiado();
    api.lookupSgpClient.mockReturnValue(consulta.promise);
    const { result } = renderHook(() => useSgpLookup());

    act(() => {
      result.current.search('00011122233');
      result.current.search('00011122233');
    });
    expect(api.lookupSgpClient).toHaveBeenCalledTimes(1);

    await act(async () => {
      consulta.resolve(RESPOSTA_A);
    });
    api.lookupSgpClient.mockResolvedValue(RESPOSTA_A);
    await act(() => result.current.search('00011122233'));
    expect(api.lookupSgpClient).toHaveBeenCalledTimes(2);
  });

  test('a mesma 2ª via, pedida de novo antes da resposta, chama o SGP uma vez só', async () => {
    const segundaVia = adiado();
    api.generateSgpDuplicateInvoice.mockReturnValue(segundaVia.promise);
    const { result } = renderHook(() => useSgpLookup());

    act(() => {
      result.current.fetchDuplicate(17402);
      result.current.fetchDuplicate(17402);
    });
    expect(api.generateSgpDuplicateInvoice).toHaveBeenCalledTimes(1);

    await act(async () => {
      segundaVia.resolve({ hasOpenInvoice: false, duplicates: [] });
    });
    api.generateSgpDuplicateInvoice.mockResolvedValue({ hasOpenInvoice: false, duplicates: [] });
    await act(() => result.current.fetchDuplicate(17402));
    expect(api.generateSgpDuplicateInvoice).toHaveBeenCalledTimes(2);
  });
});
