import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// Duplo do Web Audio com a forma que o playChime usa: contexto com estado e
// relógio próprios, oscilador e ganho com connect/disconnect. `terminar()` faz
// o papel do navegador quando o oscilador chega ao stop agendado: dispara
// `onended` e os ouvintes de 'ended'.
class FakeNode {
  constructor() {
    this.connect = vi.fn();
    this.disconnect = vi.fn();
    this.onended = null;
    this.ouvintes = [];
  }
  addEventListener(tipo, fn) {
    if (tipo === 'ended') this.ouvintes.push(fn);
  }
  removeEventListener(tipo, fn) {
    this.ouvintes = this.ouvintes.filter((f) => f !== fn);
  }
}

class FakeOscillator extends FakeNode {
  constructor() {
    super();
    this.frequency = { value: 0 };
    this.start = vi.fn();
    this.stop = vi.fn();
  }
  terminar() {
    const evento = { target: this };
    if (this.onended) this.onended(evento);
    this.ouvintes.forEach((fn) => fn(evento));
  }
}

class FakeGain extends FakeNode {
  constructor() {
    super();
    this.gain = { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() };
  }
}

class FakeAudioContext {
  constructor() {
    FakeAudioContext.construidos.push(this);
    this.state = FakeAudioContext.estadoInicial;
    this.currentTime = FakeAudioContext.relogioInicial;
    this.destination = { papel: 'destino' };
    this.osciladores = [];
    this.ganhos = [];
    // Função comum, e NÃO vi.fn: o vi.fn do Vitest 2 pendura um `.then` na
    // promessa que o dublê devolve (para `mock.settledResults`), e isso marca
    // a recusa como tratada. Com ele, tirar o `.catch` do playChime passava
    // com a suíte verde — medido por mutação.
    this.retomadas = 0;
    this.resume = () => {
      this.retomadas += 1;
      if (FakeAudioContext.resumeRecusado) return Promise.reject(new Error('sem gesto do usuário'));
      this.state = 'running';
      return Promise.resolve();
    };
    this.close = vi.fn(() => {
      this.state = 'closed';
      return Promise.resolve();
    });
  }
  createOscillator() {
    const oscilador = new FakeOscillator();
    this.osciladores.push(oscilador);
    FakeAudioContext.osciladores.push(oscilador);
    return oscilador;
  }
  createGain() {
    const ganho = new FakeGain();
    this.ganhos.push(ganho);
    FakeAudioContext.ganhos.push(ganho);
    return ganho;
  }
}

let playChime;

beforeEach(async () => {
  FakeAudioContext.construidos = [];
  FakeAudioContext.osciladores = [];
  FakeAudioContext.ganhos = [];
  FakeAudioContext.estadoInicial = 'running';
  FakeAudioContext.relogioInicial = 0;
  FakeAudioContext.resumeRecusado = false;
  window.AudioContext = FakeAudioContext;
  // Módulo novo a cada teste: o contexto compartilhado mora no módulo, e um
  // teste não pode herdar o contexto que o anterior deixou.
  vi.resetModules();
  ({ playChime } = await import('./useNotificationSound'));
});

afterEach(() => {
  delete window.AudioContext;
});

function tocarVezes(n) {
  for (let i = 0; i < n; i += 1) playChime();
}

describe('playChime — um AudioContext por aba', () => {
  test('não cria contexto nenhum antes do primeiro som', () => {
    expect(FakeAudioContext.construidos).toHaveLength(0);
    playChime();
    expect(FakeAudioContext.construidos).toHaveLength(1);
  });

  test('vinte sons constroem um único AudioContext', () => {
    tocarVezes(20);
    expect(FakeAudioContext.construidos).toHaveLength(1);
  });

  test('vinte sons criam e iniciam quarenta osciladores', () => {
    tocarVezes(20);
    const iniciados = FakeAudioContext.osciladores.filter((o) => o.start.mock.calls.length === 1);
    expect(iniciados).toHaveLength(40);
  });

  test('o contexto fechado é trocado por um novo no som seguinte', () => {
    tocarVezes(2);
    expect(FakeAudioContext.construidos).toHaveLength(1);

    FakeAudioContext.construidos[0].state = 'closed';
    playChime();

    expect(FakeAudioContext.construidos).toHaveLength(2);
    expect(FakeAudioContext.construidos[0].osciladores).toHaveLength(4);
    expect(FakeAudioContext.construidos[1].osciladores).toHaveLength(2);
  });

  test('sem window.AudioContext, segue sem lançar erro', () => {
    delete window.AudioContext;
    expect(() => playChime()).not.toThrow();
    expect(FakeAudioContext.construidos).toHaveLength(0);
  });
});

describe('playChime — o som continua o mesmo', () => {
  test('dois tons, 880 e 1320 Hz, cada um no seu ganho ligado à saída', () => {
    playChime();
    const contexto = FakeAudioContext.construidos[0];
    const [grave, agudo] = contexto.osciladores;
    const [ganhoGrave, ganhoAgudo] = contexto.ganhos;

    expect(grave.frequency.value).toBe(880);
    expect(agudo.frequency.value).toBe(1320);
    expect(grave.connect).toHaveBeenCalledWith(ganhoGrave);
    expect(agudo.connect).toHaveBeenCalledWith(ganhoAgudo);
    expect(ganhoGrave.connect).toHaveBeenCalledWith(contexto.destination);
    expect(ganhoAgudo.connect).toHaveBeenCalledWith(contexto.destination);
  });

  test('segundo tom 0,12 s depois; cada tom dura 0,15 s, de 0,2 caindo a 0,001', () => {
    FakeAudioContext.relogioInicial = 5;
    playChime();
    const [grave, agudo] = FakeAudioContext.osciladores;
    const [ganhoGrave, ganhoAgudo] = FakeAudioContext.ganhos;

    expect(grave.start.mock.calls[0][0]).toBeCloseTo(5, 10);
    expect(grave.stop.mock.calls[0][0]).toBeCloseTo(5.15, 10);
    expect(agudo.start.mock.calls[0][0]).toBeCloseTo(5.12, 10);
    expect(agudo.stop.mock.calls[0][0]).toBeCloseTo(5.27, 10);

    expect(ganhoGrave.gain.setValueAtTime.mock.calls[0][0]).toBe(0.2);
    expect(ganhoGrave.gain.setValueAtTime.mock.calls[0][1]).toBeCloseTo(5, 10);
    expect(ganhoGrave.gain.exponentialRampToValueAtTime.mock.calls[0][0]).toBe(0.001);
    expect(ganhoGrave.gain.exponentialRampToValueAtTime.mock.calls[0][1]).toBeCloseTo(5.15, 10);
    expect(ganhoAgudo.gain.setValueAtTime.mock.calls[0][0]).toBe(0.2);
    expect(ganhoAgudo.gain.setValueAtTime.mock.calls[0][1]).toBeCloseTo(5.12, 10);
    expect(ganhoAgudo.gain.exponentialRampToValueAtTime.mock.calls[0][0]).toBe(0.001);
    expect(ganhoAgudo.gain.exponentialRampToValueAtTime.mock.calls[0][1]).toBeCloseTo(5.27, 10);
  });

  // Com o contexto reaproveitado, o relógio dele não volta a zero. Agendar
  // pelo começo do relógio poria o toque no passado: o oscilador pararia no
  // mesmo instante em que começa, e o som sumiria sem erro nenhum.
  test('o som seguinte é agendado pelo relógio atual do contexto compartilhado', () => {
    playChime();
    FakeAudioContext.construidos[0].currentTime = 42;
    playChime();

    const [, , grave, agudo] = FakeAudioContext.osciladores;
    expect(grave.start.mock.calls[0][0]).toBeCloseTo(42, 10);
    expect(grave.stop.mock.calls[0][0]).toBeCloseTo(42.15, 10);
    expect(agudo.start.mock.calls[0][0]).toBeCloseTo(42.12, 10);
    expect(agudo.stop.mock.calls[0][0]).toBeCloseTo(42.27, 10);
  });
});

describe('playChime — contexto suspenso', () => {
  test('contexto suspenso é retomado com resume(), e o toque é agendado', () => {
    FakeAudioContext.estadoInicial = 'suspended';
    playChime();
    const contexto = FakeAudioContext.construidos[0];

    expect(contexto.retomadas).toBe(1);
    expect(contexto.osciladores).toHaveLength(2);

    // Já retomado, o som seguinte não pede resume de novo.
    playChime();
    expect(contexto.retomadas).toBe(1);
  });

  test('resume() recusado não vira erro não tratado', async () => {
    FakeAudioContext.estadoInicial = 'suspended';
    FakeAudioContext.resumeRecusado = true;
    const naoTratadas = [];
    const ouvinte = (motivo) => naoTratadas.push(motivo);
    process.on('unhandledRejection', ouvinte);
    try {
      expect(() => playChime()).not.toThrow();
      // Dá ao Node a volta do laço em que ele acusa promessa recusada sem dono.
      await new Promise((resolver) => setTimeout(resolver, 0));

      expect(FakeAudioContext.construidos[0].retomadas).toBe(1);
      expect(naoTratadas).toHaveLength(0);
    } finally {
      process.off('unhandledRejection', ouvinte);
    }
  });
});

describe('playChime — limpeza de cada toque', () => {
  test('ao terminar, cada oscilador e seu ganho são desconectados; o contexto fica aberto', () => {
    playChime();
    const contexto = FakeAudioContext.construidos[0];
    const [grave, agudo] = contexto.osciladores;
    const [ganhoGrave, ganhoAgudo] = contexto.ganhos;
    expect(grave.connect).toHaveBeenCalledWith(ganhoGrave);
    expect(grave.disconnect).not.toHaveBeenCalled();

    grave.terminar();
    agudo.terminar();

    expect(grave.disconnect).toHaveBeenCalled();
    expect(ganhoGrave.disconnect).toHaveBeenCalled();
    expect(agudo.disconnect).toHaveBeenCalled();
    expect(ganhoAgudo.disconnect).toHaveBeenCalled();
    expect(contexto.close).not.toHaveBeenCalled();
  });

  test('dois sons seguidos tocam juntos no mesmo contexto, e o fim de um não desliga o outro', () => {
    playChime();
    playChime();

    expect(FakeAudioContext.construidos).toHaveLength(1);
    const [primeiroGrave, primeiroAgudo, segundoGrave, segundoAgudo] = FakeAudioContext.osciladores;
    const [, , segundoGanhoGrave, segundoGanhoAgudo] = FakeAudioContext.ganhos;
    const iniciados = FakeAudioContext.osciladores.filter((o) => o.start.mock.calls.length === 1);
    expect(iniciados).toHaveLength(4);

    primeiroGrave.terminar();
    primeiroAgudo.terminar();

    expect(primeiroGrave.disconnect).toHaveBeenCalled();
    expect(segundoGrave.disconnect).not.toHaveBeenCalled();
    expect(segundoAgudo.disconnect).not.toHaveBeenCalled();
    expect(segundoGanhoGrave.disconnect).not.toHaveBeenCalled();
    expect(segundoGanhoAgudo.disconnect).not.toHaveBeenCalled();
  });
});
