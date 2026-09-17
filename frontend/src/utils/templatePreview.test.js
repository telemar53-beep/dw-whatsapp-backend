import { describe, test, expect } from 'vitest';
import { substituirVariaveis } from './templatePreview';

describe('substituirVariaveis', () => {
  test('troca a variável pelo que foi digitado', () => {
    expect(substituirVariaveis('Olá {{1}}, tudo bem?', ['Maria'])).toBe('Olá Maria, tudo bem?');
  });

  test('troca mais de uma', () => {
    expect(substituirVariaveis('{{1}}, sua fatura de {{2}} venceu.', ['Ana', 'setembro'])).toBe('Ana, sua fatura de setembro venceu.');
  });

  // Deixar o marcador é o que mostra ao atendente o que ainda falta; virar
  // buraco no texto esconderia o problema até a mensagem já ter saído.
  test('variável não preenchida continua aparecendo como marcador', () => {
    expect(substituirVariaveis('Olá {{1}}!', [''])).toBe('Olá {{1}}!');
    expect(substituirVariaveis('Olá {{1}}!', [])).toBe('Olá {{1}}!');
    expect(substituirVariaveis('Olá {{1}}!', ['   '])).toBe('Olá {{1}}!');
  });

  test('texto sem variável passa igual', () => {
    expect(substituirVariaveis('Bom dia!', [])).toBe('Bom dia!');
  });

  test('não quebra sem texto', () => {
    expect(substituirVariaveis(null, [])).toBe('');
  });
});
