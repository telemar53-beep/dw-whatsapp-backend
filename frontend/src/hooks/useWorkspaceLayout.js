import { useState, useEffect } from 'react';

// Pisos de cada coluna da mesa, em px. A conversa é a única que nunca cede:
// abaixo de 420px de largura útil a leitura deixa de funcionar.
export const CONVERSA_MINIMA = 420;
export const LISTA_EXPANDIDA = 332;
export const LISTA_RAIL = 72;
export const PAINEL = 268;

// Uma regra só: a conversa tem piso, e o que sobra decide o resto numa ordem
// de sacrifício fixa — primeiro a lista encolhe para rail, depois o painel
// deixa de ser coluna e passa a alternar com a conversa, e por último o rail
// sai. Nada some por cima da conversa em nenhum momento.
export function decidirLayout(largura, painelAberto) {
  if (!largura) return { lista: 'expandida', painel: 'coluna' };
  const painel = painelAberto ? PAINEL : 0;

  if (largura >= LISTA_EXPANDIDA + CONVERSA_MINIMA + painel) {
    return { lista: 'expandida', painel: 'coluna' };
  }
  if (largura >= LISTA_RAIL + CONVERSA_MINIMA + painel) {
    return { lista: 'rail', painel: 'coluna' };
  }
  if (largura >= LISTA_RAIL + CONVERSA_MINIMA) {
    // Não cabem os três: o painel deixa de ser coluna e passa a ocupar a área
    // de trabalho, alternando com a conversa. Sobreposição, nunca.
    return { lista: 'rail', painel: painelAberto ? 'alternado' : 'coluna' };
  }
  // Estreito de verdade: volta a uma coisa por vez, como já era no celular.
  return { lista: 'oculta', painel: painelAberto ? 'alternado' : 'coluna' };
}

// Enquanto o espaço real não foi medido — primeiro render, ou ambiente sem
// ResizeObserver — o palpite é a janela menos o menu. Sem isto o padrão seria
// "cabe tudo", e num celular as duas colunas apareceriam espremidas por um
// instante antes da primeira medição.
function larguraDePalpite() {
  if (typeof window === 'undefined') return 0;
  const MENU_E_RESPIROS = 90;
  return Math.max(0, window.innerWidth - MENU_E_RESPIROS);
}

export function useWorkspaceLayout(ref, painelAberto) {
  const [largura, setLargura] = useState(larguraDePalpite);

  useEffect(() => {
    const alvo = ref.current;
    if (!alvo || typeof ResizeObserver === 'undefined') return undefined;
    // Medir o espaço real, e não a viewport: o menu lateral muda de 196px para
    // 64px sem a janela mudar de tamanho, e media query não enxerga isso.
    const observer = new ResizeObserver((entradas) => {
      const entrada = entradas[0];
      if (entrada) setLargura(entrada.contentRect.width);
    });
    observer.observe(alvo);
    setLargura(alvo.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, [ref]);

  return { largura, ...decidirLayout(largura, painelAberto) };
}
