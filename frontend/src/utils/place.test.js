import { describe, test, expect } from 'vitest';
import { nomeDoLocal, localMaisEspecifico } from './place';

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

// A fila de espera usa o lugar MAIS ESPECÍFICO, sem o município junto: o
// atendente bate o olho para reconhecer o atendimento.
describe('localMaisEspecifico', () => {
  test('com localidade, devolve SÓ a localidade', () => {
    expect(localMaisEspecifico('Barão de Tromaí', 'Cândido Mendes')).toBe('Barão de Tromaí');
    expect(localMaisEspecifico('Aurizona', 'Godofredo Viana')).toBe('Aurizona');
  });

  test('sem localidade, cai para o município', () => {
    expect(localMaisEspecifico(null, 'Cândido Mendes')).toBe('Cândido Mendes');
    expect(localMaisEspecifico(undefined, 'Cândido Mendes')).toBe('Cândido Mendes');
    expect(localMaisEspecifico('', 'Cândido Mendes')).toBe('Cândido Mendes');
    expect(localMaisEspecifico('   ', 'Cândido Mendes')).toBe('Cândido Mendes');
  });

  test('sem nada, devolve null', () => {
    expect(localMaisEspecifico(null, null)).toBeNull();
    expect(localMaisEspecifico('', '')).toBeNull();
  });

  test('NUNCA junta os dois com o ponto', () => {
    expect(localMaisEspecifico('Barão de Tromaí', 'Cândido Mendes')).not.toContain('·');
  });

  // A outra regra continua existindo e continua diferente: o painel da conversa
  // e a Supervisão mostram os dois de propósito.
  test('nomeDoLocal segue mostrando os dois', () => {
    expect(nomeDoLocal('Barão de Tromaí', 'Cândido Mendes')).toBe('Barão de Tromaí · Cândido Mendes');
  });
});
