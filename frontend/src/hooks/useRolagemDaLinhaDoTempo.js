import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

/**
 * Onde a linha do tempo fica depois que a lista de mensagens muda.
 *
 * - Conversa nova, ou mensagem nova no FIM: vai para o fim (o homologado).
 * - Mensagens ANTERIORES entrando por cima ("Carregar mensagens anteriores"):
 *   NÃO vai para o fim — a mensagem que estava no topo da tela quando o pedido
 *   saiu volta para o mesmo lugar. Quem clicou vê o trecho anterior aparecer
 *   em cima do que estava lendo.
 * - Mensagem atualizada no lugar (tique, transcrição): não mexe.
 *
 * Antes a regra era "rolar para o fim sempre que o NÚMERO de mensagens mudar".
 * Enquanto o "carregar anteriores" não funcionava, ninguém via o defeito; com
 * ele funcionando, o clique jogava a tela para o fim no mesmo instante em que as
 * anteriores entravam.
 *
 * POR QUE ÂNCORA POR ELEMENTO, e não "somar ao scrollTop o quanto o conteúdo
 * cresceu": a altura guardada envelhece. Medido no Chrome real: uma foto que
 * termina de carregar depois da abertura muda a altura sem mudar a lista, e a
 * conta por diferença de altura errava exatamente a altura da foto (214 px).
 * A âncora é a primeira mensagem visível (cada linha leva `data-mensagem-id`),
 * medida no clique (`memorizarPosicao`) e de novo a cada rolagem enquanto o
 * pedido está no ar — quem rola esperando não é puxado de volta para onde clicou.
 *
 * useLayoutEffect, e não useEffect: a correção da posição tem de acontecer
 * antes da pintura, senão o conteúdo pisca deslocado por um quadro.
 */
export function useRolagemDaLinhaDoTempo({ linhaDoTempoRef, fimRef, messages, conversationId }) {
  const anteriorRef = useRef(null);
  // Com valor = há um "carregar anteriores" no ar esperando para ser ancorado.
  const ancoraRef = useRef(null);

  const medirAncora = useCallback(() => {
    const linhaDoTempo = linhaDoTempoRef.current;
    if (!linhaDoTempo || !linhaDoTempo.querySelectorAll) return;
    const topo = linhaDoTempo.getBoundingClientRect().top;
    const primeiraVisivel = [...linhaDoTempo.querySelectorAll('[data-mensagem-id]')].find((el) => el.getBoundingClientRect().bottom > topo);
    ancoraRef.current = primeiraVisivel
      ? { id: primeiraVisivel.getAttribute('data-mensagem-id'), distancia: primeiraVisivel.getBoundingClientRect().top - topo, conversationId }
      : null;
  }, [linhaDoTempoRef, conversationId]);

  useEffect(() => {
    const linhaDoTempo = linhaDoTempoRef.current;
    if (!linhaDoTempo || !linhaDoTempo.addEventListener) return undefined;
    const aoRolar = () => {
      if (ancoraRef.current) medirAncora();
    };
    linhaDoTempo.addEventListener('scroll', aoRolar, { passive: true });
    return () => linhaDoTempo.removeEventListener('scroll', aoRolar);
  }, [linhaDoTempoRef, medirAncora]);

  useLayoutEffect(() => {
    const linhaDoTempo = linhaDoTempoRef.current;
    const primeiro = messages.length ? messages[0].id : null;
    const ultimo = messages.length ? messages[messages.length - 1].id : null;
    const antes = anteriorRef.current;
    const mesmaConversa = Boolean(antes) && antes.conversationId === conversationId;
    const entrouAntes = mesmaConversa && antes.ultimo === ultimo && antes.primeiro !== null && primeiro !== antes.primeiro;

    if (entrouAntes) {
      const ancora = ancoraRef.current;
      ancoraRef.current = null;
      if (linhaDoTempo && ancora && ancora.conversationId === conversationId) {
        // Comparação direta, e não seletor com o id dentro: id nenhum precisa
        // ser escapado (e o jsdom nem tem CSS.escape).
        const alvo = [...linhaDoTempo.querySelectorAll('[data-mensagem-id]')].find((el) => el.getAttribute('data-mensagem-id') === ancora.id);
        if (alvo) {
          const distanciaAgora = alvo.getBoundingClientRect().top - linhaDoTempo.getBoundingClientRect().top;
          linhaDoTempo.scrollTop += distanciaAgora - ancora.distancia;
        }
      }
    } else if (!mesmaConversa || antes.ultimo !== ultimo) {
      const fim = fimRef.current;
      if (fim && fim.scrollIntoView) fim.scrollIntoView({ block: 'end' });
    }

    if (!mesmaConversa) ancoraRef.current = null;
    anteriorRef.current = { conversationId, primeiro, ultimo };
  }, [messages, conversationId, linhaDoTempoRef, fimRef]);

  // Chamado no clique de "Carregar mensagens anteriores", antes do pedido sair.
  return { memorizarPosicao: medirAncora };
}
