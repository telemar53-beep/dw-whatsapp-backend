import { describe, test, expect, vi, afterEach } from 'vitest';
import { lerLocal, gravarLocal, apagarLocal } from './armazenamentoLocal';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('armazenamentoLocal', () => {
  test('lê, grava e apaga quando o navegador permite', () => {
    expect(gravarLocal('chave', 'valor')).toBe(true);
    expect(lerLocal('chave')).toBe('valor');
    expect(apagarLocal('chave')).toBe(true);
    expect(lerLocal('chave')).toBeNull();
  });

  test('chave inexistente é null, não erro', () => {
    expect(lerLocal('nao-existe')).toBeNull();
  });

  // O caso que derrubava a aplicação: no Safari sem permissão de armazenamento
  // quem lança é o getItem, antes de qualquer gravação.
  test('getItem que lança vira null em vez de derrubar', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    });
    expect(() => lerLocal('dw_token')).not.toThrow();
    expect(lerLocal('dw_token')).toBeNull();
  });

  test('setItem que lança devolve false em vez de derrubar', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError', 'QuotaExceededError');
    });
    expect(() => gravarLocal('dw_token', 'x')).not.toThrow();
    expect(gravarLocal('dw_token', 'x')).toBe(false);
  });

  test('removeItem que lança devolve false em vez de derrubar', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    });
    expect(() => apagarLocal('dw_token')).not.toThrow();
    expect(apagarLocal('dw_token')).toBe(false);
  });
});
