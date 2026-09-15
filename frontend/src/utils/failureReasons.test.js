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

  test('um motivo do 360dialog (código sem mapeamento) passa direto', () => {
    expect(descreverFalha('(403) some text')).toBe('(403) some text');
  });

  test('uma mensagem simples, sem prefixo de código, passa direto', () => {
    expect(descreverFalha('network error')).toBe('network error');
  });

  test('um motivo do 360dialog por falta de pagamento vira explicação em português, com a frase original entre parênteses', () => {
    expect(descreverFalha('This number is blocked due to lack of payment on client side.')).toBe(
      'Número bloqueado no 360dialog por falta de pagamento — regularize a cobrança no Hub do 360dialog (This number is blocked due to lack of payment on client side.)'
    );
  });

  test('nulo ou vazio devolve nulo', () => {
    expect(descreverFalha(null)).toBeNull();
    expect(descreverFalha(undefined)).toBeNull();
    expect(descreverFalha('')).toBeNull();
  });
});
