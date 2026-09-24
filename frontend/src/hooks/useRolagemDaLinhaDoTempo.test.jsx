import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useRolagemDaLinhaDoTempo } from './useRolagemDaLinhaDoTempo';

// O jsdom não calcula layout, então a linha do tempo é um objeto que faz a conta
// de um contêiner rolável de verdade: cada mensagem tem uma posição no conteúdo,
// e a posição dela NA TELA é essa menos o scrollTop. É o suficiente para provar
// a REGRA; que o navegador de fato segura a posição se prova no diagnóstico do
// harness de medição (rolagem-anteriores.mjs), no build real, com e sem a
// ancoragem nativa do Chrome.
const TOPO_DA_LISTA = 40; // aviso de registro e botão de anteriores, acima da 1ª mensagem
const ALTURA = 60;
const ALTURA_DA_TELA = 500;

// O jsdom também não tem ResizeObserver. Este guarda quem está observando e
// deixa o teste dizer quando algo mudou de tamanho.
class ObservadorFalso {
  static ativos = new Set();

  constructor(aoMudar) {
    this.aoMudar = aoMudar;
  }

  observe() {
    ObservadorFalso.ativos.add(this);
  }

  disconnect() {
    ObservadorFalso.ativos.delete(this);
  }
}

beforeEach(() => {
  ObservadorFalso.ativos.clear();
  vi.stubGlobal('ResizeObserver', ObservadorFalso);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function cenario() {
  const ouvintes = { scroll: new Set(), wheel: new Set(), touchstart: new Set(), pointerdown: new Set(), keydown: new Set() };
  const alturas = {};
  let ids = [];
  let scrollTop = 0;
  let ecoPendente = false;
  let semCaixa = false;
  const linhaDoTempo = {
    style: {},
    linhas: [], // [{ id, topo, altura }] no sistema de coordenadas do conteúdo
    getClientRects: () => (semCaixa ? [] : [{}]),
    // Sem caixa, o navegador mede tudo como zero.
    getBoundingClientRect: () => (semCaixa ? { top: 0, bottom: 0 } : { top: 0, bottom: ALTURA_DA_TELA }),
    querySelectorAll: vi.fn(() => linhaDoTempo.linhas.map(elemento)),
    addEventListener: (tipo, fn) => ouvintes[tipo].add(fn),
    removeEventListener: (tipo, fn) => ouvintes[tipo].delete(fn),
  };
  // Como no navegador: toda escrita de scrollTop gera um `scroll` depois (aqui,
  // quando o teste chama `ecoar`).
  Object.defineProperty(linhaDoTempo, 'scrollTop', {
    get: () => scrollTop,
    set: (valor) => {
      scrollTop = valor;
      ecoPendente = true;
    },
  });
  function elemento(linha) {
    return {
      getAttribute: () => linha.id,
      getBoundingClientRect: () => (semCaixa ? { top: 0, bottom: 0 } : { top: linha.topo - scrollTop, bottom: linha.topo + linha.altura - scrollTop }),
    };
  }
  // O que o navegador faz ao desenhar a lista: uma linha embaixo da outra.
  function desenhar(novos) {
    ids = novos;
    let topo = TOPO_DA_LISTA;
    linhaDoTempo.linhas = ids.map((id) => {
      const linha = { id, topo, altura: alturas[id] ?? ALTURA };
      topo += linha.altura;
      return linha;
    });
  }
  // Sem evento, o alvo é a própria linha do tempo (roda, toque, barra de rolagem).
  const disparar = (tipo, evento = { target: linhaDoTempo }) => ouvintes[tipo].forEach((fn) => fn(evento));
  // O fim de verdade: a última linha encostada embaixo da tela.
  const fim = {
    scrollIntoView: vi.fn(() => {
      const ultima = linhaDoTempo.linhas[linhaDoTempo.linhas.length - 1];
      linhaDoTempo.scrollTop = ultima ? Math.max(0, ultima.topo + ultima.altura - ALTURA_DA_TELA) : 0;
    }),
  };
  return {
    linhaDoTempo,
    fim,
    linhaDoTempoRef: { current: linhaDoTempo },
    fimRef: { current: fim },
    desenhar,
    // Uma linha muda de altura sem a lista mudar (foto que terminou de
    // carregar), e o navegador avisa quem observa.
    crescer(id, px) {
      alturas[id] = (alturas[id] ?? ALTURA) + px;
      desenhar(ids);
      ObservadorFalso.ativos.forEach((o) => o.aoMudar([]));
    },
    // Rolagem do usuário: muda o scrollTop e dispara o evento na hora.
    rolar(para) {
      scrollTop = para;
      ecoPendente = false;
      disparar('scroll');
    },
    // O `scroll` que o navegador dispara depois de uma escrita do próprio hook.
    ecoar() {
      if (!ecoPendente) return;
      ecoPendente = false;
      disparar('scroll');
    },
    esconder: (sim) => { semCaixa = sim; },
    disparar,
    naTela: (id) => linhaDoTempo.linhas.find((l) => l.id === id).topo - scrollTop,
    visivel: (id) => {
      const topo = linhaDoTempo.linhas.find((l) => l.id === id).topo - scrollTop;
      return topo >= 0 && topo + ALTURA <= ALTURA_DA_TELA;
    },
  };
}

const msgs = (...ids) => ids.map((id) => ({ id, content: `texto ${id}` }));
const serie = (de, ate) => Array.from({ length: ate - de + 1 }, (_, i) => `m${de + i}`);

function montar(c, { messages, conversationId }) {
  c.desenhar(messages.map((m) => m.id));
  const r = renderHook(
    (props) => useRolagemDaLinhaDoTempo({ linhaDoTempoRef: c.linhaDoTempoRef, fimRef: c.fimRef, ...props }),
    { initialProps: { messages, conversationId, carregandoAnteriores: false } }
  );
  c.ecoar();
  let atual = { messages, conversationId, carregandoAnteriores: false };
  const mostrar = (mudanca) => {
    atual = { ...atual, ...mudanca };
    c.desenhar(atual.messages.map((m) => m.id));
    r.rerender(atual);
  };
  return {
    ...r,
    mostrar,
    // Como a tela faz: mede a posição no clique e o botão vira "Carregando…".
    clicarEmAnteriores() {
      act(() => r.result.current.memorizarPosicao());
      mostrar({ carregandoAnteriores: true });
    },
    // A resposta chega: lista nova e fim do carregamento no mesmo desenho.
    chegaram: (messages) => mostrar({ messages, carregandoAnteriores: false }),
  };
}

describe('useRolagemDaLinhaDoTempo', () => {
  test('abrir a conversa leva a linha do tempo ao fim', () => {
    const c = cenario();
    montar(c, { messages: msgs('m1', 'm2'), conversationId: 'A' });
    expect(c.fim.scrollIntoView).toHaveBeenCalledWith({ block: 'end' });
  });

  test('mensagem nova no fim leva ao fim', () => {
    const c = cenario();
    const { mostrar } = montar(c, { messages: msgs('m1', 'm2'), conversationId: 'A' });
    c.fim.scrollIntoView.mockClear();

    mostrar({ messages: msgs('m1', 'm2', 'm3') });

    expect(c.fim.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  // O defeito que a E1 expôs: o efeito antigo rolava para o fim sempre que o
  // NÚMERO de mensagens mudava. Com "Carregar mensagens anteriores" funcionando,
  // quem clicava no topo era jogado para o fim sem ver o que carregou.
  test('anteriores pedidas NÃO levam ao fim e seguram a posição de leitura', () => {
    const c = cenario();
    const t = montar(c, { messages: msgs('m3', 'm4'), conversationId: 'A' });
    c.fim.scrollIntoView.mockClear();
    c.rolar(0);
    const m3Antes = c.naTela('m3');

    t.clicarEmAnteriores();
    t.chegaram(msgs('m1', 'm2', 'm3', 'm4'));

    expect(c.fim.scrollIntoView).not.toHaveBeenCalled();
    expect(c.naTela('m3')).toBe(m3Antes);
  });

  // A regressão que a revisão da E1.1 achou: a carga inicial SUBSTITUI a lista.
  // Se uma mensagem do socket chega antes dela, a lista vai de [x] para
  // [m1, m2, x] — a primeira muda e a última não, como num "anteriores". Sem
  // pedido, isso é abertura de conversa: o lugar certo é o fim.
  test('primeira mensagem trocada SEM pedido (carga inicial depois do socket) vai ao fim', () => {
    const c = cenario();
    const { mostrar } = montar(c, { messages: [], conversationId: 'A' });
    mostrar({ messages: msgs('x') });
    c.fim.scrollIntoView.mockClear();

    mostrar({ messages: msgs('m1', 'm2', 'x') });

    expect(c.fim.scrollIntoView).toHaveBeenCalledWith({ block: 'end' });
  });

  // O que a primeira versão desta correção errou no Chrome real: guardava a
  // medida no último desenho. Uma foto que termina de carregar depois disso, e
  // a rolagem do usuário, deixam essa medida velha; a âncora vale a do clique.
  test('a âncora é medida no clique, e não no último desenho', () => {
    const c = cenario();
    const t = montar(c, { messages: msgs('m2', 'm3', 'm4'), conversationId: 'A' });
    c.rolar(0);
    // Depois do último desenho: a foto de m2 carregou e o atendente rolou até m3.
    c.crescer('m2', 214);
    c.rolar(TOPO_DA_LISTA + ALTURA + 214);
    const m3Antes = c.naTela('m3');

    t.clicarEmAnteriores();
    t.chegaram(msgs('m1', 'm2', 'm3', 'm4'));

    expect(c.naTela('m3')).toBe(m3Antes);
  });

  // Foto e vídeo não reservam altura e o endereço da mídia chega depois (token
  // de mídia): as do trecho novo crescem DEPOIS do ajuste. O Chrome compensa
  // sozinho; o Safari, não.
  test('foto do trecho novo que carrega DEPOIS do ajuste não empurra a leitura', () => {
    const c = cenario();
    const t = montar(c, { messages: msgs('m3', 'm4'), conversationId: 'A' });
    c.rolar(0);
    const m3Antes = c.naTela('m3');
    t.clicarEmAnteriores();
    t.chegaram(msgs('m1', 'm2', 'm3', 'm4'));

    c.crescer('m1', 214);
    c.crescer('m2', 150);

    expect(c.naTela('m3')).toBe(m3Antes);
  });

  // O navegador SEMPRE dispara `scroll` depois de uma escrita programática de
  // scrollTop. Se o hook tomasse o eco da própria correção pelo usuário, soltaria
  // a âncora no primeiro quadro — e o Safari voltaria a escorregar.
  test('o eco da própria correção não solta a âncora', () => {
    const c = cenario();
    const t = montar(c, { messages: msgs('m3', 'm4'), conversationId: 'A' });
    c.rolar(0);
    const m3Antes = c.naTela('m3');
    t.clicarEmAnteriores();
    t.chegaram(msgs('m1', 'm2', 'm3', 'm4'));
    c.ecoar(); // eco do ajuste feito no desenho

    c.crescer('m1', 214);
    c.ecoar(); // eco da correção do ResizeObserver
    c.crescer('m2', 150);
    c.ecoar();

    expect(c.naTela('m3')).toBe(m3Antes);
    expect(c.linhaDoTempo.style.overflowAnchor).toBe('none');
  });

  test('depois que o usuário rola, a âncora é solta', () => {
    const c = cenario();
    const t = montar(c, { messages: msgs('m3', 'm4'), conversationId: 'A' });
    c.rolar(0);
    t.clicarEmAnteriores();
    t.chegaram(msgs('m1', 'm2', 'm3', 'm4'));

    c.rolar(c.linhaDoTempo.scrollTop - 50);
    const scrollTopDoUsuario = c.linhaDoTempo.scrollTop;
    c.crescer('m1', 214);

    expect(c.linhaDoTempo.scrollTop).toBe(scrollTopDoUsuario);
  });

  // Um alvo dentro de uma bolha: um botão (tocar áudio, Responder) ou um texto.
  const noConteudo = (tag = 'button') => ({ tagName: tag, closest: (sel) => (sel.includes(tag) ? {} : null) });

  test.each([
    ['a roda', 'wheel', undefined],
    ['o toque', 'touchstart', undefined],
    ['o clique na barra de rolagem', 'pointerdown', undefined],
    ['PageDown', 'keydown', { key: 'PageDown', target: { closest: () => null } }],
    ['a seta para cima', 'keydown', { key: 'ArrowUp', target: { closest: () => null } }],
    ['o Espaço fora de botão e campo', 'keydown', { key: ' ', target: { closest: () => null } }],
  ])('%s solta a âncora', (_, tipo, evento) => {
    const c = cenario();
    const t = montar(c, { messages: msgs('m3', 'm4'), conversationId: 'A' });
    c.rolar(0);
    t.clicarEmAnteriores();
    t.chegaram(msgs('m1', 'm2', 'm3', 'm4'));

    if (evento) c.disparar(tipo, evento);
    else c.disparar(tipo);
    const scrollTop = c.linhaDoTempo.scrollTop;
    c.crescer('m1', 214);

    expect(c.linhaDoTempo.scrollTop).toBe(scrollTop);
    expect(c.linhaDoTempo.style.overflowAnchor).toBe('');
  });

  // 3ª revisão, medido no Chrome imitando o Safari: soltar em QUALQUER clique ou
  // tecla deixava a foto que ainda carregava acima empurrar a leitura 214 px
  // quando o atendente tocava um áudio, abria uma foto ou clicava em Responder.
  test.each([
    ['o clique num botão de uma bolha', 'pointerdown', { target: noConteudo('button') }],
    ['o clique num texto de uma bolha', 'pointerdown', { target: noConteudo('p') }],
    ['uma tecla que não rola (Ctrl+C)', 'keydown', { key: 'c', ctrlKey: true, target: { closest: () => null } }],
    ['o Espaço num botão', 'keydown', { key: ' ', target: noConteudo('button') }],
  ])('%s NÃO solta a âncora', (_, tipo, evento) => {
    const c = cenario();
    const t = montar(c, { messages: msgs('m3', 'm4'), conversationId: 'A' });
    c.rolar(0);
    const m3Antes = c.naTela('m3');
    t.clicarEmAnteriores();
    t.chegaram(msgs('m1', 'm2', 'm3', 'm4'));

    c.disparar(tipo, evento);
    c.crescer('m1', 214);

    expect(c.naTela('m3')).toBe(m3Antes);
    expect(c.linhaDoTempo.style.overflowAnchor).toBe('none');
  });

  // 3ª revisão: no modo alternado a conversa fica escondida enquanto o painel
  // ocupa a coluna. Se o trecho chega assim, a correção fica para quando ela
  // voltar — medido no Chrome real: sem isto, a leitura pulava 1102 px.
  test('o trecho que chega com a linha do tempo escondida volta ao lugar quando ela reaparece', () => {
    const c = cenario();
    const t = montar(c, { messages: msgs('m3', 'm4'), conversationId: 'A' });
    c.rolar(30);
    const m3Antes = c.naTela('m3');
    t.clicarEmAnteriores();

    c.esconder(true);
    c.rolar(0); // escondida, o scrollTop lido é 0
    t.chegaram(msgs('m1', 'm2', 'm3', 'm4'));
    c.esconder(false);
    // Ao mostrar, o navegador pode restaurar a posição com um `scroll` antes de
    // o ResizeObserver agir: não é o usuário, e não pode soltar a âncora.
    c.linhaDoTempo.scrollTop = 30;
    c.ecoar();
    c.crescer('m1', 0); // as linhas voltam a ter tamanho: o navegador avisa quem observa

    expect(c.naTela('m3')).toBe(m3Antes);
  });

  // Medido no Chrome real pela 2ª revisão: na troca de layout da mesa (janela
  // estreitada com o painel aberto) a linha do tempo fica sem caixa por um
  // quadro, o scrollTop lido vira 0 e o navegador dispara `scroll`.
  test('rolagem de quando a linha do tempo está sem caixa não solta a âncora', () => {
    const c = cenario();
    const t = montar(c, { messages: msgs('m3', 'm4'), conversationId: 'A' });
    c.rolar(0);
    const m3Antes = c.naTela('m3');
    t.clicarEmAnteriores();
    t.chegaram(msgs('m1', 'm2', 'm3', 'm4'));
    c.ecoar();
    const scrollTopAntes = c.linhaDoTempo.scrollTop;

    c.esconder(true);
    c.rolar(0); // o navegador zera ao esconder
    c.esconder(false);
    c.rolar(scrollTopAntes); // e restaura ao mostrar
    c.crescer('m1', 214);

    expect(c.naTela('m3')).toBe(m3Antes);
  });

  test('sem caixa com o pedido no ar, a medida do clique não é apagada', () => {
    const c = cenario();
    const t = montar(c, { messages: msgs('m3', 'm4'), conversationId: 'A' });
    c.rolar(0);
    const m3Antes = c.naTela('m3');
    t.clicarEmAnteriores();

    c.esconder(true);
    c.rolar(0);
    c.esconder(false);
    t.chegaram(msgs('m1', 'm2', 'm3', 'm4'));

    expect(c.naTela('m3')).toBe(m3Antes);
  });

  // 2ª revisão: com o pedido no ar, uma mensagem nova leva ao fim; o evento que
  // diria "agora a leitura é o fim" só chega no quadro seguinte. Se o trecho
  // chegasse antes dele, a âncora do clique puxaria a tela de volta ao topo e a
  // mensagem nova ficaria fora da tela.
  test('mensagem nova com o pedido no ar: o trecho que chega depois não tira a mensagem nova da tela', () => {
    const c = cenario();
    const t = montar(c, { messages: msgs(...serie(3, 20)), conversationId: 'A' });
    c.rolar(0);
    t.clicarEmAnteriores();

    t.mostrar({ messages: msgs(...serie(3, 21)) }); // m21 chegou pelo socket
    t.chegaram(msgs(...serie(1, 21))); // o trecho chega antes do eco

    expect(c.visivel('m21')).toBe(true);
  });

  test('mensagem nova no fim com a âncora segura vai ao fim e solta a âncora', () => {
    const c = cenario();
    const t = montar(c, { messages: msgs('m3', 'm4'), conversationId: 'A' });
    c.rolar(0);
    t.clicarEmAnteriores();
    t.chegaram(msgs('m1', 'm2', 'm3', 'm4'));
    c.fim.scrollIntoView.mockClear();

    t.mostrar({ messages: msgs('m1', 'm2', 'm3', 'm4', 'm5') });

    expect(c.fim.scrollIntoView).toHaveBeenCalledWith({ block: 'end' });
    expect(ObservadorFalso.ativos.size).toBe(0);
  });

  test('quem rola enquanto as anteriores carregam fica onde rolou, e não onde clicou', () => {
    const c = cenario();
    const t = montar(c, { messages: msgs('m3', 'm4', 'm5'), conversationId: 'A' });
    c.rolar(0);
    t.clicarEmAnteriores();

    // Rolou um pouco para baixo antes da resposta chegar.
    c.rolar(70);
    const m4Antes = c.naTela('m4');
    t.chegaram(msgs('m1', 'm2', 'm3', 'm4', 'm5'));

    expect(c.naTela('m4')).toBe(m4Antes);
  });

  // Pedido que falha (ou volta com tudo repetido) terminava sem consumir a
  // âncora, e toda rolagem daí em diante media a lista inteira.
  test('pedido que termina sem trazer nada é descartado', () => {
    const c = cenario();
    const t = montar(c, { messages: msgs('m3', 'm4'), conversationId: 'A' });
    t.clicarEmAnteriores();
    t.mostrar({ carregandoAnteriores: false }); // falhou: a lista não mudou

    const medidasAntes = c.linhaDoTempo.querySelectorAll.mock.calls.length;
    c.rolar(10);
    c.rolar(20);
    expect(c.linhaDoTempo.querySelectorAll.mock.calls.length).toBe(medidasAntes);

    // E um trecho que chegue depois, sem pedido, é tratado como abertura.
    c.fim.scrollIntoView.mockClear();
    t.mostrar({ messages: msgs('m1', 'm2', 'm3', 'm4') });
    expect(c.fim.scrollIntoView).toHaveBeenCalledWith({ block: 'end' });
  });

  // Medido no Chrome real: a ancoragem nativa escolhia como âncora a foto
  // parcialmente visível acima da leitura; ao carregar, ela crescia para baixo
  // e empurrava a leitura 214 px, brigando com a nossa correção. Desligada só
  // enquanto a nossa trabalha.
  test('a ancoragem nativa fica desligada do clique até o usuário assumir, e volta depois', () => {
    const c = cenario();
    const t = montar(c, { messages: msgs('m3', 'm4'), conversationId: 'A' });
    expect(c.linhaDoTempo.style.overflowAnchor).toBe('');

    t.clicarEmAnteriores();
    expect(c.linhaDoTempo.style.overflowAnchor).toBe('none');
    t.chegaram(msgs('m1', 'm2', 'm3', 'm4'));
    expect(c.linhaDoTempo.style.overflowAnchor).toBe('none');

    c.rolar(c.linhaDoTempo.scrollTop - 30);
    expect(c.linhaDoTempo.style.overflowAnchor).toBe('');
  });

  test('pedido que falha devolve a ancoragem nativa', () => {
    const c = cenario();
    const t = montar(c, { messages: msgs('m3', 'm4'), conversationId: 'A' });
    t.clicarEmAnteriores();
    t.mostrar({ carregandoAnteriores: false });
    expect(c.linhaDoTempo.style.overflowAnchor).toBe('');
  });

  test('trocar de conversa no meio devolve a ancoragem nativa', () => {
    const c = cenario();
    const t = montar(c, { messages: msgs('a3', 'a4'), conversationId: 'A' });
    t.clicarEmAnteriores();
    t.mostrar({ messages: msgs('b1'), conversationId: 'B', carregandoAnteriores: false });
    expect(c.linhaDoTempo.style.overflowAnchor).toBe('');
  });

  test('mensagem atualizada no lugar (tique, transcrição) não mexe na rolagem', () => {
    const c = cenario();
    const { mostrar } = montar(c, { messages: msgs('m1', 'm2'), conversationId: 'A' });
    c.fim.scrollIntoView.mockClear();
    c.rolar(250);

    mostrar({ messages: [{ id: 'm1', content: 'texto m1' }, { id: 'm2', content: 'texto m2', status: 'read' }] });

    expect(c.fim.scrollIntoView).not.toHaveBeenCalled();
    expect(c.linhaDoTempo.scrollTop).toBe(250);
  });

  test('trocar de conversa leva ao fim da nova e descarta pedido e âncora de A', () => {
    const c = cenario();
    const t = montar(c, { messages: msgs('a3', 'a4'), conversationId: 'A' });
    t.clicarEmAnteriores();
    c.fim.scrollIntoView.mockClear();

    t.mostrar({ messages: msgs('b1'), conversationId: 'B', carregandoAnteriores: false });
    expect(c.fim.scrollIntoView).toHaveBeenCalledWith({ block: 'end' });

    // Um trecho de B sem clique em B: nada do pedido de A é usado.
    c.fim.scrollIntoView.mockClear();
    t.mostrar({ messages: msgs('b0', 'b1') });
    expect(c.fim.scrollIntoView).toHaveBeenCalledWith({ block: 'end' });
  });

  test('carregar anteriores depois de voltar para a conversa também segura a posição', () => {
    const c = cenario();
    const t = montar(c, { messages: msgs('a3', 'a4'), conversationId: 'A' });
    t.mostrar({ messages: msgs('b1'), conversationId: 'B' });
    t.mostrar({ messages: msgs('a3', 'a4'), conversationId: 'A' });
    c.fim.scrollIntoView.mockClear();
    c.rolar(0);
    const a3Antes = c.naTela('a3');

    t.clicarEmAnteriores();
    t.chegaram(msgs('a1', 'a2', 'a3', 'a4'));

    expect(c.fim.scrollIntoView).not.toHaveBeenCalled();
    expect(c.naTela('a3')).toBe(a3Antes);
  });

  test('sem as referências montadas não quebra', () => {
    const { result } = renderHook(() =>
      useRolagemDaLinhaDoTempo({ linhaDoTempoRef: { current: null }, fimRef: { current: null }, messages: msgs('m1'), conversationId: 'A' })
    );
    expect(() => act(() => result.current.memorizarPosicao())).not.toThrow();
  });

  test('sem ResizeObserver (navegador antigo) ainda ancora, só não segura depois', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const c = cenario();
    const t = montar(c, { messages: msgs('m3', 'm4'), conversationId: 'A' });
    c.rolar(0);
    const m3Antes = c.naTela('m3');

    t.clicarEmAnteriores();
    t.chegaram(msgs('m1', 'm2', 'm3', 'm4'));

    expect(c.naTela('m3')).toBe(m3Antes);
  });
});
