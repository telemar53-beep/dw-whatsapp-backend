import { describe, test, expect, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useRolagemDaLinhaDoTempo } from './useRolagemDaLinhaDoTempo';

// O jsdom não calcula layout, então a linha do tempo é um objeto que faz a conta
// de um contêiner rolável de verdade: cada mensagem tem uma posição no conteúdo,
// e a posição dela NA TELA é essa menos o scrollTop. É o suficiente para provar
// a REGRA; que o navegador de fato segura a posição se prova no harness de
// medição (ferramentas/medicao/diagnostico/rolagem-anteriores.mjs), no build real.
const TOPO_DA_LISTA = 40; // aviso de registro e botão de anteriores, acima da 1ª mensagem
const ALTURA = 60;

function cenario() {
  const ouvintes = new Set();
  const linhaDoTempo = {
    scrollTop: 0,
    linhas: [], // [{ id, topo, altura }] no sistema de coordenadas do conteúdo
    getBoundingClientRect: () => ({ top: 0, bottom: 500 }),
    querySelectorAll: () => linhaDoTempo.linhas.map(elemento),
    addEventListener: (tipo, fn) => ouvintes.add(fn),
    removeEventListener: (tipo, fn) => ouvintes.delete(fn),
  };
  function elemento(linha) {
    return {
      getAttribute: () => linha.id,
      getBoundingClientRect: () => ({ top: linha.topo - linhaDoTempo.scrollTop, bottom: linha.topo + linha.altura - linhaDoTempo.scrollTop }),
    };
  }
  const fim = { scrollIntoView: vi.fn() };
  return {
    linhaDoTempo,
    fim,
    linhaDoTempoRef: { current: linhaDoTempo },
    fimRef: { current: fim },
    // O que o React faria no DOM ao desenhar a lista: uma linha embaixo da outra.
    desenhar(ids, alturas = {}) {
      let topo = TOPO_DA_LISTA;
      linhaDoTempo.linhas = ids.map((id) => {
        const linha = { id, topo, altura: alturas[id] ?? ALTURA };
        topo += linha.altura;
        return linha;
      });
    },
    rolar(para) {
      linhaDoTempo.scrollTop = para;
      ouvintes.forEach((fn) => fn());
    },
    naTela: (id) => linhaDoTempo.linhas.find((l) => l.id === id).topo - linhaDoTempo.scrollTop,
  };
}

const msgs = (...ids) => ids.map((id) => ({ id, content: `texto ${id}` }));

function montar(c, props) {
  c.desenhar(props.messages.map((m) => m.id));
  const r = renderHook(
    ({ messages, conversationId }) => useRolagemDaLinhaDoTempo({ linhaDoTempoRef: c.linhaDoTempoRef, fimRef: c.fimRef, messages, conversationId }),
    { initialProps: props }
  );
  const trocar = (novas, alturas) => {
    c.desenhar(novas.messages.map((m) => m.id), alturas);
    r.rerender(novas);
  };
  return { ...r, trocar };
}

describe('useRolagemDaLinhaDoTempo', () => {
  test('abrir a conversa leva a linha do tempo ao fim', () => {
    const c = cenario();
    montar(c, { messages: msgs('m1', 'm2'), conversationId: 'A' });
    expect(c.fim.scrollIntoView).toHaveBeenCalledWith({ block: 'end' });
  });

  test('mensagem nova no fim leva ao fim', () => {
    const c = cenario();
    const { trocar } = montar(c, { messages: msgs('m1', 'm2'), conversationId: 'A' });
    c.fim.scrollIntoView.mockClear();

    trocar({ messages: msgs('m1', 'm2', 'm3'), conversationId: 'A' });

    expect(c.fim.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  // O defeito que a E1 expôs: o efeito antigo rolava para o fim sempre que o
  // NÚMERO de mensagens mudava. Com "Carregar mensagens anteriores" funcionando,
  // quem clicava no topo era jogado para o fim sem ver o que carregou.
  test('mensagens anteriores entrando por cima NÃO levam ao fim e seguram a posição de leitura', () => {
    const c = cenario();
    const { result, trocar } = montar(c, { messages: msgs('m3', 'm4'), conversationId: 'A' });
    c.fim.scrollIntoView.mockClear();

    // O atendente rolou até o topo e clicou.
    c.rolar(0);
    const m3Antes = c.naTela('m3');
    act(() => result.current.memorizarPosicao());
    trocar({ messages: msgs('m1', 'm2', 'm3', 'm4'), conversationId: 'A' });

    expect(c.fim.scrollIntoView).not.toHaveBeenCalled();
    // A mensagem que estava no topo continua no mesmo lugar da tela.
    expect(c.naTela('m3')).toBe(m3Antes);
  });

  // O que a primeira versão desta correção errou no Chrome real: guardava a
  // altura do conteúdo no último desenho e somava a diferença. Uma foto que
  // termina de carregar depois disso cresce sem mudar a lista, e a conta errava
  // exatamente a altura da foto (214 px).
  test('conteúdo que cresce depois de desenhado (foto carregando) não desloca a âncora', () => {
    const c = cenario();
    const { result, trocar } = montar(c, { messages: msgs('m3', 'm4'), conversationId: 'A' });
    // A foto de m4 carrega: a linha cresce 214 px, sem nenhuma mudança na lista.
    c.desenhar(['m3', 'm4'], { m4: ALTURA + 214 });

    c.rolar(0);
    const m3Antes = c.naTela('m3');
    act(() => result.current.memorizarPosicao());
    trocar({ messages: msgs('m1', 'm2', 'm3', 'm4'), conversationId: 'A' }, { m4: ALTURA + 214 });

    expect(c.naTela('m3')).toBe(m3Antes);
  });

  test('quem rola enquanto as anteriores carregam fica onde rolou, e não onde clicou', () => {
    const c = cenario();
    const { result, trocar } = montar(c, { messages: msgs('m3', 'm4', 'm5'), conversationId: 'A' });
    c.rolar(0);
    act(() => result.current.memorizarPosicao());

    // Rolou um pouco para baixo antes da resposta chegar.
    c.rolar(70);
    const m4Antes = c.naTela('m4');
    trocar({ messages: msgs('m1', 'm2', 'm3', 'm4', 'm5'), conversationId: 'A' });

    expect(c.naTela('m4')).toBe(m4Antes);
  });

  test('anteriores sem pedido registrado não mexem na rolagem nem vão ao fim', () => {
    const c = cenario();
    const { trocar } = montar(c, { messages: msgs('m3', 'm4'), conversationId: 'A' });
    c.fim.scrollIntoView.mockClear();
    c.rolar(25);

    trocar({ messages: msgs('m1', 'm2', 'm3', 'm4'), conversationId: 'A' });

    expect(c.fim.scrollIntoView).not.toHaveBeenCalled();
    expect(c.linhaDoTempo.scrollTop).toBe(25);
  });

  test('mensagem atualizada no lugar (tique, transcrição) não mexe na rolagem', () => {
    const c = cenario();
    const { trocar } = montar(c, { messages: msgs('m1', 'm2'), conversationId: 'A' });
    c.fim.scrollIntoView.mockClear();
    c.rolar(250);

    trocar({ messages: [{ id: 'm1', content: 'texto m1' }, { id: 'm2', content: 'texto m2', status: 'read' }], conversationId: 'A' });

    expect(c.fim.scrollIntoView).not.toHaveBeenCalled();
    expect(c.linhaDoTempo.scrollTop).toBe(250);
  });

  test('trocar de conversa leva ao fim da nova e descarta a âncora da anterior', () => {
    const c = cenario();
    const { result, trocar } = montar(c, { messages: msgs('a3', 'a4'), conversationId: 'A' });
    act(() => result.current.memorizarPosicao());
    c.fim.scrollIntoView.mockClear();

    trocar({ messages: msgs('b1'), conversationId: 'B' });
    expect(c.fim.scrollIntoView).toHaveBeenCalledWith({ block: 'end' });

    // Um trecho anterior de B sem clique em B: nada da âncora de A é usado.
    c.rolar(10);
    trocar({ messages: msgs('b0', 'b1'), conversationId: 'B' });
    expect(c.linhaDoTempo.scrollTop).toBe(10);
  });

  test('carregar anteriores depois de voltar para a conversa também segura a posição', () => {
    const c = cenario();
    const { result, trocar } = montar(c, { messages: msgs('a3', 'a4'), conversationId: 'A' });
    trocar({ messages: msgs('b1'), conversationId: 'B' });
    trocar({ messages: msgs('a3', 'a4'), conversationId: 'A' });
    c.fim.scrollIntoView.mockClear();
    c.rolar(0);
    const a3Antes = c.naTela('a3');
    act(() => result.current.memorizarPosicao());

    trocar({ messages: msgs('a1', 'a2', 'a3', 'a4'), conversationId: 'A' });

    expect(c.fim.scrollIntoView).not.toHaveBeenCalled();
    expect(c.naTela('a3')).toBe(a3Antes);
  });

  test('sem as referências montadas não quebra', () => {
    const { result } = renderHook(() =>
      useRolagemDaLinhaDoTempo({ linhaDoTempoRef: { current: null }, fimRef: { current: null }, messages: msgs('m1'), conversationId: 'A' })
    );
    expect(() => act(() => result.current.memorizarPosicao())).not.toThrow();
  });
});
