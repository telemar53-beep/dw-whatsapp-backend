import { describe, test, expect } from 'vitest';
import { shortenAgentNames, agentInitial } from './agentDisplayName';

describe('shortenAgentNames', () => {
  test('mostra só o primeiro nome quando não há repetição', () => {
    expect(shortenAgentNames(['Gabriela Reis Menezes', 'Íris Santana'])).toEqual(['Gabriela', 'Íris']);
  });

  test('desempata pela inicial do sobrenome quando o primeiro nome repete', () => {
    expect(shortenAgentNames(['Ana Paula Pereira', 'Ana Carolina Souza'])).toEqual(['Ana P.', 'Ana S.']);
  });

  test('só quem repete é desempatado', () => {
    expect(shortenAgentNames(['Ana Pereira', 'Ana Souza', 'Carlos Lima'])).toEqual(['Ana P.', 'Ana S.', 'Carlos']);
  });

  test('vai para o sobrenome inteiro quando a inicial ainda empata', () => {
    expect(shortenAgentNames(['Ana Paula Silva', 'Ana Beatriz Souza'])).toEqual(['Ana Silva', 'Ana Souza']);
  });

  test('cai no nome completo quando nem o sobrenome inteiro desempata', () => {
    expect(shortenAgentNames(['Ana Paula Silva', 'Ana Beatriz Silva'])).toEqual([
      'Ana Paula Silva',
      'Ana Beatriz Silva',
    ]);
  });

  test('nome de uma palavra só não tem o que acrescentar e não trava', () => {
    expect(shortenAgentNames(['Ana', 'Ana Souza'])).toEqual(['Ana', 'Ana S.']);
    expect(shortenAgentNames(['Ana', 'Ana'])).toEqual(['Ana', 'Ana']);
  });

  test('homônimos exatos não entram em laço infinito', () => {
    expect(shortenAgentNames(['Ana Silva', 'Ana Silva'])).toEqual(['Ana Silva', 'Ana Silva']);
  });

  test('ignora espaços extras e trata nome ausente', () => {
    expect(shortenAgentNames(['  Marcos   Vinícius  ', '', null])).toEqual(['Marcos', 'Sem nome', 'Sem nome']);
  });

  test('preserva a ordem da lista recebida', () => {
    expect(shortenAgentNames(['Zeca Alves', 'Ana Souza', 'Ana Pereira'])).toEqual(['Zeca', 'Ana S.', 'Ana P.']);
  });
});

describe('agentInitial', () => {
  test('usa a primeira letra do rótulo mostrado', () => {
    expect(agentInitial('Gabriela')).toBe('G');
    expect(agentInitial('íris')).toBe('Í');
  });

  test('não quebra sem rótulo', () => {
    expect(agentInitial('')).toBe('?');
    expect(agentInitial(undefined)).toBe('?');
  });
});
