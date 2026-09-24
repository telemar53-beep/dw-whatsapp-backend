import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

const LINHA = '[data-mensagem-id]';

// A primeira mensagem que aparece na tela, e a que distância do topo do
// contêiner ela está.
function primeiraVisivel(linhaDoTempo) {
  const topo = linhaDoTempo.getBoundingClientRect().top;
  const linha = [...linhaDoTempo.querySelectorAll(LINHA)].find((el) => el.getBoundingClientRect().bottom > topo);
  return linha ? { id: linha.getAttribute('data-mensagem-id'), distancia: linha.getBoundingClientRect().top - topo } : null;
}

// Rola o que for preciso para a âncora voltar à distância guardada. Comparação
// direta do atributo, e não seletor com o id dentro: id nenhum precisa ser
// escapado (e o jsdom nem tem CSS.escape).
function reporAncora(linhaDoTempo, ancora) {
  const alvo = [...linhaDoTempo.querySelectorAll(LINHA)].find((el) => el.getAttribute('data-mensagem-id') === ancora.id);
  if (!alvo) return false;
  const sobra = alvo.getBoundingClientRect().top - linhaDoTempo.getBoundingClientRect().top - ancora.distancia;
  if (Math.abs(sobra) >= 0.5) linhaDoTempo.scrollTop += sobra;
  return true;
}

/**
 * Onde a linha do tempo fica depois que a lista de mensagens muda.
 *
 * - Conversa nova, ou mensagem nova no FIM: vai para o fim (o homologado).
 * - Mensagens ANTERIORES entrando por cima, PEDIDAS pelo "Carregar mensagens
 *   anteriores": a mensagem que estava no topo da tela volta para o mesmo lugar.
 * - A primeira mensagem mudou SEM pedido (a carga inicial chegou depois de uma
 *   mensagem do socket e trouxe o histórico por cima dela): vai para o fim —
 *   para quem acabou de abrir a conversa, o lugar certo é a última mensagem.
 * - Mensagem atualizada no lugar (tique, transcrição): não mexe.
 *
 * POR QUE ÂNCORA POR ELEMENTO, e não "somar ao scrollTop o quanto o conteúdo
 * cresceu": a altura guardada envelhece. Medido no Chrome real: uma foto que
 * termina de carregar depois da abertura muda a altura sem mudar a lista, e a
 * conta por diferença errava exatamente a altura da foto (214 px). A âncora é a
 * primeira mensagem visível (cada linha leva `data-mensagem-id`), medida no
 * clique (`memorizarPosicao`) e de novo a cada rolagem enquanto o pedido está
 * no ar — quem rola esperando não é puxado de volta para onde clicou.
 *
 * DEPOIS de ancorar, a âncora continua SEGURA enquanto o conteúdo acima dela
 * cresce (foto e vídeo do trecho novo não reservam altura e carregam depois),
 * até o usuário rolar ou tocar. O Chrome faz isso sozinho (overflow-anchor); o
 * Safari não tem ancoragem nativa, e sem isto a leitura escorregava a cada foto.
 *
 * useLayoutEffect, e não useEffect: a correção da posição tem de acontecer
 * antes da pintura, senão o conteúdo pisca deslocado por um quadro.
 */
export function useRolagemDaLinhaDoTempo({ linhaDoTempoRef, fimRef, messages, conversationId, carregandoAnteriores = false }) {
  const anteriorRef = useRef(null);
  // "Carregar anteriores" no ar: { conversationId, ancora } — ancora pode ser
  // null (nada visível para medir), e ainda assim o pedido conta.
  const pedidoRef = useRef(null);
  // Âncora já reposta, segurada até o usuário mexer: { ancora, scrollTop, observador }.
  const seguraRef = useRef(null);

  const soltar = useCallback(() => {
    const segura = seguraRef.current;
    seguraRef.current = null;
    if (segura && segura.observador) segura.observador.disconnect();
  }, []);

  const segurar = useCallback(
    (linhaDoTempo, ancora) => {
      soltar();
      const segura = { ancora, scrollTop: linhaDoTempo.scrollTop, observador: null };
      seguraRef.current = segura;
      if (typeof ResizeObserver === 'undefined') return;
      // Chega depois do layout e antes da pintura: a correção não pisca.
      segura.observador = new ResizeObserver(() => {
        if (seguraRef.current !== segura) return;
        reporAncora(linhaDoTempo, ancora);
        segura.scrollTop = linhaDoTempo.scrollTop;
      });
      // Só o que está acima da âncora empurra a âncora.
      for (const linha of linhaDoTempo.querySelectorAll(LINHA)) {
        if (linha.getAttribute('data-mensagem-id') === ancora.id) break;
        segura.observador.observe(linha);
      }
    },
    [soltar]
  );

  // Chamado no clique de "Carregar mensagens anteriores", antes do pedido sair.
  const memorizarPosicao = useCallback(() => {
    soltar();
    const linhaDoTempo = linhaDoTempoRef.current;
    pedidoRef.current = {
      conversationId,
      ancora: linhaDoTempo && linhaDoTempo.querySelectorAll ? primeiraVisivel(linhaDoTempo) : null,
    };
  }, [linhaDoTempoRef, conversationId, soltar]);

  useEffect(() => {
    const linhaDoTempo = linhaDoTempoRef.current;
    if (!linhaDoTempo || !linhaDoTempo.addEventListener) return undefined;
    const aoRolar = () => {
      // Rolagem que não foi a nossa correção = o usuário assumiu.
      const segura = seguraRef.current;
      if (segura && Math.abs(linhaDoTempo.scrollTop - segura.scrollTop) > 1) soltar();
      const pedido = pedidoRef.current;
      if (pedido) pedido.ancora = primeiraVisivel(linhaDoTempo);
    };
    // Tocar ou girar a roda também é assumir — e, no iOS, corrigir scrollTop
    // durante a inércia do dedo corta o gesto.
    const aoMexer = () => soltar();
    linhaDoTempo.addEventListener('scroll', aoRolar, { passive: true });
    linhaDoTempo.addEventListener('wheel', aoMexer, { passive: true });
    linhaDoTempo.addEventListener('touchstart', aoMexer, { passive: true });
    return () => {
      linhaDoTempo.removeEventListener('scroll', aoRolar);
      linhaDoTempo.removeEventListener('wheel', aoMexer);
      linhaDoTempo.removeEventListener('touchstart', aoMexer);
      soltar();
    };
  }, [linhaDoTempoRef, soltar]);

  useLayoutEffect(() => {
    const linhaDoTempo = linhaDoTempoRef.current;
    const primeiro = messages.length ? messages[0].id : null;
    const ultimo = messages.length ? messages[messages.length - 1].id : null;
    const antes = anteriorRef.current;
    const mesmaConversa = Boolean(antes) && antes.conversationId === conversationId;
    const irAoFim = () => {
      soltar();
      const fim = fimRef.current;
      if (fim && fim.scrollIntoView) fim.scrollIntoView({ block: 'end' });
    };

    if (!mesmaConversa) {
      pedidoRef.current = null;
      irAoFim();
    } else if (antes.ultimo !== ultimo) {
      irAoFim();
    } else if (antes.primeiro !== primeiro) {
      const pedido = pedidoRef.current;
      if (pedido && pedido.conversationId === conversationId) {
        pedidoRef.current = null;
        if (linhaDoTempo && pedido.ancora && reporAncora(linhaDoTempo, pedido.ancora)) segurar(linhaDoTempo, pedido.ancora);
      } else {
        irAoFim();
      }
    }

    // Pedido que terminou sem trazer nada (falhou, ou o lote já estava todo na
    // tela): não fica pendurado medindo a cada rolagem.
    if (!carregandoAnteriores) pedidoRef.current = null;
    anteriorRef.current = { conversationId, primeiro, ultimo };
  }, [messages, conversationId, carregandoAnteriores, linhaDoTempoRef, fimRef, soltar, segurar]);

  return { memorizarPosicao };
}
