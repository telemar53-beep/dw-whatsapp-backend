import { describe, test, expect } from 'vitest';
import { nomeDoLocal } from './place';

describe('nomeDoLocal', () => {
  test('com localidade, mostra a localidade e o municipio', () => {
    expect(nomeDoLocal('Barão de Tromaí', 'Cândido Mendes')).toBe('Barão de Tromaí · Cândido Mendes');
  });

  test('sem localidade, mostra so o municipio', () => {
    expect(nomeDoLocal(null, 'Cândido Mendes')).toBe('Cândido Mendes');
    expect(nomeDoLocal('', 'Cândido Mendes')).toBe('Cândido Mendes');
    expect(nomeDoLocal(undefined, 'Cândido Mendes')).toBe('Cândido Mendes');
  });

  test('sem nada, devolve nulo para quem chama decidir o vazio', () => {
    expect(nomeDoLocal(null, null)).toBeNull();
    expect(nomeDoLocal('', '')).toBeNull();
  });

  // Nao deveria acontecer (a invariante exige municipio quando ha localidade),
  // mas a tela nao pode sumir com a informacao se acontecer.
  test('localidade sem municipio mostra a localidade', () => {
    expect(nomeDoLocal('Barão de Tromaí', null)).toBe('Barão de Tromaí');
  });

  test('localidade igual ao municipio nao repete', () => {
    expect(nomeDoLocal('Cândido Mendes', 'Cândido Mendes')).toBe('Cândido Mendes');
  });
});
