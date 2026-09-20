import { describe, test, expect } from 'vitest';
import { decidirLayout, CONVERSA_MINIMA, LISTA_EXPANDIDA, LISTA_RAIL, PAINEL } from './useWorkspaceLayout';

describe('regra de layout da mesa', () => {
  test('desktop largo: lista expandida e painel em coluna', () => {
    expect(decidirLayout(LISTA_EXPANDIDA + CONVERSA_MINIMA + PAINEL, true))
      .toEqual({ lista: 'expandida', painel: 'coluna' });
  });

  test('um pixel abaixo do largo, quem cede é a lista — nunca a conversa', () => {
    expect(decidirLayout(LISTA_EXPANDIDA + CONVERSA_MINIMA + PAINEL - 1, true))
      .toEqual({ lista: 'rail', painel: 'coluna' });
  });

  test('sem painel aberto a lista fica expandida por mais tempo', () => {
    const largura = LISTA_EXPANDIDA + CONVERSA_MINIMA;
    expect(decidirLayout(largura, false).lista).toBe('expandida');
    expect(decidirLayout(largura, true).lista).toBe('rail');
  });

  test('quando nem rail + conversa + painel cabem, o painel alterna', () => {
    expect(decidirLayout(LISTA_RAIL + CONVERSA_MINIMA + PAINEL - 1, true))
      .toEqual({ lista: 'rail', painel: 'alternado' });
  });

  test('painel fechado nessa faixa não vira alternado à toa', () => {
    // Com o painel fechado o orçamento é só lista + conversa (332 + 420 = 752),
    // então em 759px ainda cabe a lista inteira.
    expect(decidirLayout(LISTA_RAIL + CONVERSA_MINIMA + PAINEL - 1, false))
      .toEqual({ lista: 'expandida', painel: 'coluna' });
  });

  test('com painel fechado, o rail só aparece abaixo de lista + conversa', () => {
    expect(decidirLayout(LISTA_EXPANDIDA + CONVERSA_MINIMA - 1, false).lista).toBe('rail');
  });

  test('estreito de verdade: uma coisa por vez', () => {
    expect(decidirLayout(LISTA_RAIL + CONVERSA_MINIMA - 1, false).lista).toBe('oculta');
  });

  test('a conversa nunca fica abaixo do piso em nenhuma faixa', () => {
    for (let largura = 300; largura <= 1600; largura += 1) {
      const { lista, painel } = decidirLayout(largura, true);
      const custoLista = lista === 'expandida' ? LISTA_EXPANDIDA : lista === 'rail' ? LISTA_RAIL : 0;
      const custoPainel = painel === 'coluna' ? PAINEL : 0;
      const sobra = largura - custoLista - custoPainel;
      if (lista !== 'oculta' || painel === 'coluna') {
        expect(sobra).toBeGreaterThanOrEqual(painel === 'alternado' ? 0 : CONVERSA_MINIMA);
      }
    }
  });
});
