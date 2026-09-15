import { describe, test, expect } from 'vitest';
import { descreverFalha } from './failureReasons';

describe('descreverFalha', () => {
  test('troca um código conhecido pela explicação em português, mantendo o código visível', () => {
    expect(descreverFalha('(131049) Marketing message limit reached')).toBe(
      'A Meta limitou mensagens de marketing para este contato (baixo engajamento). Tente um template de utilidade ou espere o cliente responder (código 131049)'
    );
  });

  test('um código sem mapeamento passa o motivo original adiante', () => {
    expect(descreverFalha('(999999) Erro desconhecido da Meta')).toBe('(999999) Erro desconhecido da Meta');
  });

  test('uma mensagem simples, sem prefixo de código, passa direto', () => {
    expect(descreverFalha('network error')).toBe('network error');
  });

  test('nulo ou vazio devolve nulo', () => {
    expect(descreverFalha(null)).toBeNull();
    expect(descreverFalha(undefined)).toBeNull();
    expect(descreverFalha('')).toBeNull();
  });
});
