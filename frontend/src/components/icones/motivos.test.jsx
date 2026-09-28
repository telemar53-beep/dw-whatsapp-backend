import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as Motivos from './motivos';
import * as desenhosDosMotivos from './desenhosMotivos';
import * as desenhosDaFamilia from './desenhos';
import * as desenhosDaSupervisao from './desenhosSupervisao';
import * as Icones from './index';
import * as IconesSgp from './sgp';
import * as IconesSupervisao from './supervisao';
import * as IconesAntigos from '../icons/WaIcons';
import * as IconesAntigosSgp from '../icons/SgpIcons';

// Ícones dos motivos de encerramento (família aprovada em 27/09). Módulo à
// parte da família: só o diálogo Encerrar os importa, e ele chega sob demanda
// (guardas/dialogosSobDemanda.test.jsx).

// Os traços dos ícones do catálogo antigo (closeReasonCatalog.jsx, removido na
// integração), guardados para a prova de que nenhum desenho novo os copia.
const TRACOS_DO_CATALOGO_ANTIGO = [
  'M10 20a2 2 0 0 0 4 0', 'M10.8 12.2L20 3', 'M12 22s7-6.5 7-12a7 7 0 0 0-14 0c0 5.5 7 12 7 12z', 'M12 2v20', 'M12 9V5',
  'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h6', 'M14 3l5 5', 'M14 3v5h5', 'M14.7 6.3L17.5 3l3.5 3.5-3.3 2.8',
  'M14.7 6.3a4.5 4.5 0 0 0 5.9 5.9L11 21.8a2.1 2.1 0 0 1-3-3l9.6-9.6a4.5 4.5 0 0 0-3-2.9z', 'M15 15l5 5M20 15l-5 5',
  'M17 6.5H9.5a3 3 0 0 0 0 6h5a3 3 0 0 1 0 6H6', 'M17 6l2.5 2.5M14.5 8.5L17 11',
  'M18 9h.5A2.5 2.5 0 0 1 21 11.5v4a2.5 2.5 0 0 1-2.5 2.5H18v3l-3.5-3h-3A2.5 2.5 0 0 1 9 15.5', 'M19 19v1a2 2 0 0 1-2 2h-4',
  'M2 14v2M22 14v2', 'M20 12a8 8 0 1 1-2.6-5.9', 'M20 4v5h-5', 'M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9-9-9z', 'M3 3l18 18',
  'M4 14v-3a8 8 0 0 1 16 0v3', 'M4 5.5A2.5 2.5 0 0 1 6.5 3h7A2.5 2.5 0 0 1 16 5.5v4A2.5 2.5 0 0 1 13.5 12H9l-3.5 3v-3H6.5A2.5 2.5 0 0 1 4 9.5z',
  'M6 10v3l-2 3h4', 'M8 7h5M8 9.5h3', 'M8.5 12.5l2.3 2.3 4.7-5', 'M8.6 5.2A6 6 0 0 1 18 10v3l2 3H9', 'M9 9h2M9 13h3', 'M9.5 17h5',
];

// Os 15 motivos cobertos e o genérico, na ordem da prancha.
const MOTIVOS = [
  ['cancelamento', 'IconeMotivoCancelamento', 'Cancelamento'],
  ['financeiro', 'IconeMotivoFinanceiro', 'Financeiro'],
  ['instalacao', 'IconeMotivoInstalacao', 'Instalação'],
  ['mudancaDeEndereco', 'IconeMotivoMudancaDeEndereco', 'Mudança de endereço'],
  ['mudancaDePlano', 'IconeMotivoMudancaDePlano', 'Mudança de plano'],
  ['reativacao', 'IconeMotivoReativacao', 'Reativação'],
  ['resolvidoPelaIa', 'IconeMotivoResolvidoPelaIa', 'Resolvido pela IA'],
  ['semResposta', 'IconeMotivoSemResposta', 'Sem resposta'],
  ['suporteTecnico', 'IconeMotivoSuporteTecnico', 'Suporte técnico'],
  ['trocaDeSenha', 'IconeMotivoTrocaDeSenha', 'Troca de senha'],
  ['informacoesComerciais', 'IconeMotivoInformacoesComerciais', 'Informações comerciais'],
  ['segundaVia', 'IconeMotivoSegundaVia', 'Segunda via'],
  ['semConexao', 'IconeMotivoSemConexao', 'Sem conexão'],
  ['lentidao', 'IconeMotivoLentidao', 'Lentidão'],
  ['negociacaoDeDebito', 'IconeMotivoNegociacaoDeDebito', 'Negociação de débito'],
  ['motivoDesconhecido', 'IconeMotivoDesconhecido', null],
];
const COMPONENTES = MOTIVOS.map(([, componente]) => componente);

const GEOMETRIA = {
  path: ['d'],
  circle: ['cx', 'cy', 'r'],
  line: ['x1', 'y1', 'x2', 'y2'],
  rect: ['x', 'y', 'width', 'height', 'rx'],
};
const MEIO_TRACO = 0.875;
const FONTES = import.meta.glob(['./*.js', './*.jsx', '!./*.test.*'], { query: '?raw', import: 'default', eager: true });

function desenhar(Componente, props = {}) {
  const { container } = render(<Componente {...props} />);
  return container.querySelector('svg');
}

// Percorre um caminho só de comandos absolutos (M L H V A Z) e devolve os
// segmentos: retas com início e fim, e arcos já amostrados em pontos.
function segmentos(d) {
  const partes = [...d.matchAll(/([MLHVAZ])([^MLHVAZ]*)/g)].map(([, cmd, args]) => [cmd, (args.match(/-?\d*\.?\d+/g) || []).map(Number)]);
  const retas = [];
  const pontos = [];
  let atual = null;
  let inicio = null;
  for (const [cmd, n] of partes) {
    if (cmd === 'M') {
      atual = [n[0], n[1]];
      inicio = atual;
      pontos.push(atual);
      for (let i = 2; i < n.length; i += 2) { const p = [n[i], n[i + 1]]; retas.push([atual, p]); atual = p; pontos.push(p); }
    } else if (cmd === 'L') {
      for (let i = 0; i < n.length; i += 2) { const p = [n[i], n[i + 1]]; retas.push([atual, p]); atual = p; pontos.push(p); }
    } else if (cmd === 'H') {
      const p = [n[0], atual[1]]; retas.push([atual, p]); atual = p; pontos.push(p);
    } else if (cmd === 'V') {
      const p = [atual[0], n[0]]; retas.push([atual, p]); atual = p; pontos.push(p);
    } else if (cmd === 'A') {
      const [rx, ry, , grande, sentido, x, y] = n;
      pontos.push(...amostrarArco(atual, [x, y], rx, ry, grande, sentido));
      atual = [x, y];
    } else if (cmd === 'Z') {
      retas.push([atual, inicio]);
      atual = inicio;
    }
  }
  return { retas, pontos };
}

// Arco do SVG (forma de ponto final) para centro e ângulos, amostrado.
function amostrarArco([x1, y1], [x2, y2], rx, ry, grande, sentido) {
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  let r = rx;
  const lambda = (dx * dx + dy * dy) / (r * r);
  if (lambda > 1) r *= Math.sqrt(lambda);
  const fator = (grande === sentido ? -1 : 1) * Math.sqrt(Math.max(0, (r * r * r * r - r * r * dy * dy - r * r * dx * dx) / (r * r * dy * dy + r * r * dx * dx)));
  const cx = fator * dy + (x1 + x2) / 2;
  const cy = -fator * dx + (y1 + y2) / 2;
  const a1 = Math.atan2(y1 - cy, x1 - cx);
  let delta = Math.atan2(y2 - cy, x2 - cx) - a1;
  if (sentido && delta < 0) delta += 2 * Math.PI;
  if (!sentido && delta > 0) delta -= 2 * Math.PI;
  return Array.from({ length: 33 }, (_, i) => [cx + r * Math.cos(a1 + (delta * i) / 32), cy + r * Math.sin(a1 + (delta * i) / 32)]);
}

describe('ícones dos motivos: a moldura da família', () => {
  test('exporta os ícones dos 15 motivos, o genérico e o resolvedor', () => {
    const exportados = Object.keys(Motivos).filter((nome) => nome.startsWith('IconeMotivo'));
    expect(exportados.sort()).toEqual([...COMPONENTES].sort());
    expect(typeof Motivos.IconeDoMotivo).toBe('function');
    expect(typeof Motivos.chaveDoMotivo).toBe('function');
    expect(Object.keys(desenhosDosMotivos).sort()).toEqual(MOTIVOS.map(([chave]) => chave).sort());
  });

  test.each(COMPONENTES)('%s: grade 24, traço 1,75, cor do texto', (nome) => {
    const svg = desenhar(Motivos[nome]);
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg.getAttribute('fill')).toBe('none');
    expect(svg.getAttribute('stroke')).toBe('currentColor');
    expect(svg.getAttribute('stroke-width')).toBe('1.75');
    expect(svg.getAttribute('stroke-linecap')).toBe('round');
    expect(svg.getAttribute('stroke-linejoin')).toBe('round');
  });

  test.each(COMPONENTES)('%s: traços só com geometria, sem cor fixa nem preenchimento', (nome) => {
    const svg = desenhar(Motivos[nome]);
    const tracos = [...svg.children];
    expect(tracos.length).toBeGreaterThan(0);
    tracos.forEach((traco) => {
      const geometria = GEOMETRIA[traco.localName];
      expect(geometria, `<${traco.localName}> não é traço da família`).toBeDefined();
      [...traco.attributes].forEach(({ name }) => expect(geometria, `atributo ${name} em ${nome}`).toContain(name));
    });
    expect(svg.outerHTML).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
  });

  test.each(COMPONENTES)('%s: comandos absolutos, e o desenho inteiro dentro da área útil (2 a 22)', (nome) => {
    const svg = desenhar(Motivos[nome]);
    [...svg.children].forEach((traco) => {
      if (traco.localName === 'path') {
        const d = traco.getAttribute('d');
        expect(d, `comando relativo ou curva fora da família em ${nome}`).toMatch(/^[MLHVAZ\d.\s-]+$/);
        // Arcos amostrados: a curva inteira, não só as pontas.
        segmentos(d).pontos.forEach(([x, y]) => {
          expect(Math.min(x, y) - MEIO_TRACO, `${nome}: ${d}`).toBeGreaterThanOrEqual(1.98);
          expect(Math.max(x, y) + MEIO_TRACO, `${nome}: ${d}`).toBeLessThanOrEqual(22.02);
        });
      }
      if (traco.localName === 'circle') {
        const [cx, cy, r] = ['cx', 'cy', 'r'].map((a) => Number(traco.getAttribute(a)));
        expect(r, `${nome}: ponto pequeno demais para 16 px`).toBeGreaterThanOrEqual(0.75);
        expect(Math.min(cx, cy) - r - MEIO_TRACO).toBeGreaterThanOrEqual(1.98);
        expect(Math.max(cx, cy) + r + MEIO_TRACO).toBeLessThanOrEqual(22.02);
      }
      if (traco.localName === 'rect') {
        const [x, y, w, h] = ['x', 'y', 'width', 'height'].map((a) => Number(traco.getAttribute(a)));
        expect(Math.min(x, y) - MEIO_TRACO).toBeGreaterThanOrEqual(1.98);
        expect(Math.max(x + w, y + h) + MEIO_TRACO).toBeLessThanOrEqual(22.02);
      }
    });
  });

  // A linguagem da família: reta horizontal, vertical ou a 45°.
  test.each(COMPONENTES)('%s: retas só a 0°, 90° ou 45°', (nome) => {
    const svg = desenhar(Motivos[nome]);
    svg.querySelectorAll('path').forEach((traco) => {
      segmentos(traco.getAttribute('d')).retas.forEach(([[x1, y1], [x2, y2]]) => {
        const dx = Math.abs(x2 - x1);
        const dy = Math.abs(y2 - y1);
        const ok = dx < 0.02 || dy < 0.02 || Math.abs(dx - dy) < 0.06;
        expect(ok, `${nome}: reta de (${x1}, ${y1}) a (${x2}, ${y2})`).toBe(true);
      });
    });
  });

  test.each(COMPONENTES)('%s: decorativo por padrão, e com título vira imagem com nome acessível', (nome) => {
    const decorativo = desenhar(Motivos[nome]);
    expect(decorativo.getAttribute('aria-hidden')).toBe('true');
    render(<>{Motivos[nome]({ titulo: `Motivo ${nome}` })}</>);
    expect(screen.getByRole('img', { name: `Motivo ${nome}` }).getAttribute('viewBox')).toBe('0 0 24 24');
  });
});

describe('ícones dos motivos: desenhos inéditos', () => {
  const FAMILIA = { ...Icones, ...IconesSgp, ...IconesSupervisao };
  const daFamilia = Object.entries(FAMILIA).filter(([nome, c]) => nome.startsWith('Icone') && nome !== 'Icone' && typeof c === 'function');

  test('nenhum motivo repete o desenho inteiro de outro, nem de um ícone da família', () => {
    const vistos = new Map(daFamilia.map(([nome, c]) => [desenhar(c).innerHTML, nome]));
    COMPONENTES.forEach((nome) => {
      const desenho = desenhar(Motivos[nome]).innerHTML;
      expect(vistos.get(desenho), `${nome} repete ${vistos.get(desenho)}`).toBeUndefined();
      vistos.set(desenho, nome);
    });
  });

  test('nenhum traço é copiado inteiro de outro ícone, da família ou dos motivos', () => {
    const origem = new Map();
    daFamilia.forEach(([nome, c]) => [...desenhar(c).children].forEach((t) => origem.set(t.outerHTML, nome)));
    COMPONENTES.forEach((nome) => {
      [...desenhar(Motivos[nome]).children].forEach((t) => {
        const dono = origem.get(t.outerHTML);
        expect(dono === undefined || dono === nome, `${nome} copia um traço de ${dono}: ${t.outerHTML}`).toBe(true);
        origem.set(t.outerHTML, nome);
      });
    });
  });

  // Prova a cópia literal; semelhança de desenho se julga na prancha.
  test('nenhum traço repete os ícones antigos nem os do catálogo atual de motivos', () => {
    const antigos = new Set();
    [IconesAntigos, IconesAntigosSgp].forEach((modulo) => Object.values(modulo).forEach((C) => {
      if (typeof C !== 'function') return;
      render(<C />).container.querySelectorAll('path').forEach((t) => antigos.add(t.getAttribute('d')));
    }));
    TRACOS_DO_CATALOGO_ANTIGO.forEach((d) => antigos.add(d));
    expect(antigos.size).toBeGreaterThan(40);
    COMPONENTES.forEach((nome) => {
      desenhar(Motivos[nome]).querySelectorAll('path').forEach((t) => expect(antigos.has(t.getAttribute('d')), nome).toBe(false));
    });
  });
});

describe('ícones dos motivos: do nome ao desenho', () => {
  const desenhoDe = (componente) => desenhar(Motivos[componente]).innerHTML;
  const resolvido = (nome) => desenhar(Motivos.IconeDoMotivo, { nome }).innerHTML;

  test.each(MOTIVOS.filter(([, , nome]) => nome))('"%s" pelo nome exato', (chave, componente, nome) => {
    expect(Motivos.chaveDoMotivo(nome)).toBe(chave);
    expect(resolvido(nome)).toBe(desenhoDe(componente));
  });

  // Nomes que o frontend já reconhecia (apelidos do catálogo atual) e os que
  // aparecem nos testes e fixtures do projeto.
  test.each([
    ['  SUPORTE TÉCNICO ', 'suporteTecnico'],
    ['Suporte', 'suporteTecnico'],
    ['Senha', 'trocaDeSenha'],
    ['Endereço', 'mudancaDeEndereco'],
    ['Boleto atrasado', 'financeiro'],
    ['Comprovante de pagamento', 'financeiro'],
    ['Pagamento - sem conexão', 'financeiro'],
    ['Cobrança', 'financeiro'],
    ['Segunda via de fatura', 'segundaVia'],
    ['Resolvido pela IA (triagem)', 'resolvidoPelaIa'],
    ['Cliente não respondeu', 'semResposta'],
    ['Sem internet', 'semConexao'],
    ['Internet lenta', 'lentidao'],
    ['Cancelamento de contrato', 'cancelamento'],
    ['Acordo de débito', 'negociacaoDeDebito'],
  ])('"%s" → %s', (nome, chave) => {
    expect(Motivos.chaveDoMotivo(nome)).toBe(chave);
  });

  // Motivo diferente não ganha símbolo aproximado: cai no genérico.
  test.each(['Visita comercial', 'Atendente ausente', 'Sem motivo', 'Mudança', 'Plano', 'Dúvida sobre o plano', 'Inteligência artificial', ''])(
    '"%s" → genérico',
    (nome) => {
      expect(Motivos.chaveDoMotivo(nome)).toBe('motivoDesconhecido');
    },
  );

  // Mudança de plano tem desenho e categoria próprios (27/09): no catálogo de
  // hoje ela caía em Mudança de endereço pelo apelido "mudanca". Só nomes
  // estritamente equivalentes entram; "Mudança" sozinha e qualquer mudança de
  // endereço ficam fora.
  test.each([
    'Mudança de plano',
    '  MUDANCA DE PLANO ',
    'Mudança do plano',
    'Troca de plano',
    'Trocar o plano',
    'Alteração de plano',
    'Mudar de plano',
    'Upgrade de plano',
    'Downgrade de plano',
  ])('"%s" → mudancaDePlano', (nome) => {
    expect(Motivos.chaveDoMotivo(nome)).toBe('mudancaDePlano');
    expect(resolvido(nome)).toBe(desenhoDe('IconeMotivoMudancaDePlano'));
  });

  test.each([
    ['Mudança de endereço', 'mudancaDeEndereco'],
    ['Mudança de endereço residencial', 'mudancaDeEndereco'],
    ['Endereço', 'mudancaDeEndereco'],
    ['Mudança', 'motivoDesconhecido'],
  ])('"%s" não vira Mudança de plano (→ %s)', (nome, chave) => {
    expect(Motivos.chaveDoMotivo(nome)).toBe(chave);
  });

  // Decisão de 27/09: o nome começa como motivo financeiro; mudar a
  // classificação sem dados reais seria decisão de negócio.
  test('"Pagamento - sem conexão" continua Financeiro', () => {
    expect(Motivos.chaveDoMotivo('Pagamento - sem conexão')).toBe('financeiro');
    expect(resolvido('Pagamento - sem conexão')).toBe(desenhoDe('IconeMotivoFinanceiro'));
  });

  test('o genérico está sempre disponível, para qualquer entrada', () => {
    [undefined, null, '', '   ', 42, 'x'.repeat(300), 'Motivo que ninguém cadastrou'].forEach((nome) => {
      const svg = desenhar(Motivos.IconeDoMotivo, { nome });
      expect(svg).not.toBeNull();
      expect(svg.children.length).toBeGreaterThan(0);
    });
    expect(resolvido('Motivo que ninguém cadastrou')).toBe(desenhoDe('IconeMotivoDesconhecido'));
  });

  test('o resolvedor repassa tamanho e título à moldura', () => {
    const svg = desenhar(Motivos.IconeDoMotivo, { nome: 'Lentidão', tamanho: 16 });
    expect(svg.getAttribute('width')).toBe('16');
    render(<Motivos.IconeDoMotivo nome="Lentidão" titulo="Lentidão" />);
    expect(screen.getByRole('img', { name: 'Lentidão' })).toBeInTheDocument();
  });
});

// Semelhança medida, não só cópia literal: cada desenho vira tinta numa grade
// de 0,25 (célula pintada quando fica a meio traço de algum traço), e dois
// desenhos se comparam pela sobreposição — interseção sobre união —, a melhor
// com deslocamento de até 1 unidade. Igual = 1.
const PASSO = 0.25;
const LADO = 24 / PASSO;

function reta(a, b) {
  const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.1));
  return Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]);
}

function pontosDoTraco(elemento, g) {
  if (elemento === 'circle') {
    return Array.from({ length: 180 }, (_, i) => [g.cx + g.r * Math.cos((i * Math.PI) / 90), g.cy + g.r * Math.sin((i * Math.PI) / 90)]);
  }
  if (elemento === 'rect') {
    const { x, y, width: w, height: h } = g;
    const r = g.rx || 0;
    const d = `M${x + r} ${y} H${x + w - r} A${r} ${r} 0 0 1 ${x + w} ${y + r} V${y + h - r} A${r} ${r} 0 0 1 ${x + w - r} ${y + h} H${x + r} A${r} ${r} 0 0 1 ${x} ${y + h - r} V${y + r} A${r} ${r} 0 0 1 ${x + r} ${y} Z`;
    return pontosDoTraco('path', { d });
  }
  const pontos = [];
  let atual = null;
  let inicio = null;
  [...g.d.matchAll(/([MLHVAZ])([^MLHVAZ]*)/g)].forEach(([, cmd, args]) => {
    const n = (args.match(/-?\d*\.?\d+/g) || []).map(Number);
    const ate = (p) => { pontos.push(...reta(atual, p)); atual = p; };
    if (cmd === 'M') {
      atual = [n[0], n[1]];
      inicio = atual;
      for (let i = 2; i < n.length; i += 2) ate([n[i], n[i + 1]]);
    } else if (cmd === 'L') {
      for (let i = 0; i < n.length; i += 2) ate([n[i], n[i + 1]]);
    } else if (cmd === 'H') {
      ate([n[0], atual[1]]);
    } else if (cmd === 'V') {
      ate([atual[0], n[0]]);
    } else if (cmd === 'A') {
      // O arco chega amostrado; a densidade vem de ligar amostra a amostra.
      const arco = amostrarArco(atual, [n[5], n[6]], n[0], n[1], n[3], n[4]);
      for (let i = 1; i < arco.length; i += 1) pontos.push(...reta(arco[i - 1], arco[i]));
      atual = [n[5], n[6]];
    } else if (cmd === 'Z') {
      ate(inicio);
    }
  });
  return pontos;
}

function tinta(desenho) {
  const grade = new Uint8Array(LADO * LADO);
  desenho.forEach(([elemento, g]) => pontosDoTraco(elemento, g).forEach(([px, py]) => {
    for (let j = Math.floor((py - MEIO_TRACO) / PASSO); j <= Math.ceil((py + MEIO_TRACO) / PASSO); j += 1) {
      for (let i = Math.floor((px - MEIO_TRACO) / PASSO); i <= Math.ceil((px + MEIO_TRACO) / PASSO); i += 1) {
        if (i < 0 || j < 0 || i >= LADO || j >= LADO) continue;
        if (((i + 0.5) * PASSO - px) ** 2 + ((j + 0.5) * PASSO - py) ** 2 <= MEIO_TRACO ** 2) grade[j * LADO + i] = 1;
      }
    }
  }));
  return grade;
}

const cobertura = (desenho) => tinta(desenho).reduce((soma, v) => soma + v, 0) / (LADO * LADO);

function semelhanca(a, b) {
  const A = tinta(a);
  const B = tinta(b);
  let melhor = 0;
  for (let dy = -4; dy <= 4; dy += 2) {
    for (let dx = -4; dx <= 4; dx += 2) {
      let inter = 0;
      let uniao = 0;
      for (let j = 0; j < LADO; j += 1) {
        for (let i = 0; i < LADO; i += 1) {
          const jj = j + dy;
          const ii = i + dx;
          const temA = A[j * LADO + i];
          const temB = jj >= 0 && ii >= 0 && jj < LADO && ii < LADO ? B[jj * LADO + ii] : 0;
          if (temA && temB) inter += 1;
          if (temA || temB) uniao += 1;
        }
      }
      melhor = Math.max(melhor, inter / uniao);
    }
  }
  return melhor;
}

describe('ícones dos motivos: os três refeitos em 27/09 não se confundem', () => {
  // Os desenhos reprovados, guardados aqui como referência do que não voltar a
  // ser, e a seta circular genérica (Atualizar), que a família não tem.
  const LIGAR_DESLIGAR = [['path', { d: 'M17.3 7.7 A7.5 7.5 0 1 1 6.7 7.7' }], ['path', { d: 'M12 3.5 V11' }]];
  const CHAVE_DE_BOCA = [
    ['path', { d: 'M19.73 8.36 A4.5 4.5 0 1 1 15.64 4.27 L13.87 6.04 L17.96 10.13 Z' }],
    ['path', { d: 'M4.25 19.75 L12.07 11.93' }],
  ];
  const SETA_CIRCULAR = [['path', { d: 'M19 12 A7 7 0 1 1 16.95 7.05' }], ['path', { d: 'M17 3.5 V7.5 H13' }]];

  // Calibrado na família aprovada: pares que se parecem de propósito (a mesma
  // moldura com outro sinal dentro) ficam entre 0,44 e 0,75 — Encerrar × Nova
  // conversa dá 0,75. Os pares pedidos para os três ficam abaixo de 0,32.
  const LIMITE = 0.35;
  const d = desenhosDosMotivos;
  const f = desenhosDaFamilia;

  test('a medida enxerga semelhança: igual dá 1, e a mesma moldura da família passa do limite', () => {
    expect(semelhanca(LIGAR_DESLIGAR, LIGAR_DESLIGAR)).toBe(1);
    expect(semelhanca(f.encerrar, f.novaConversa)).toBeGreaterThan(LIMITE);
    expect(semelhanca(d.semResposta, d.motivoDesconhecido)).toBeGreaterThan(LIMITE);
  });

  test.each([
    ['o ligar/desligar reprovado', LIGAR_DESLIGAR],
    ['Histórico', f.historico],
    ['a seta circular de Atualizar', SETA_CIRCULAR],
    ['Automação', desenhosDaSupervisao.automacao],
  ])('Reativação não se parece com %s', (_, outro) => {
    expect(semelhanca(d.reativacao, outro)).toBeLessThan(LIMITE);
  });

  test.each([
    ['a chave de boca reprovada', CHAVE_DE_BOCA],
    ['Configurações', f.configuracoes],
    ['Atendimento', f.atendimento],
    ['Instalação', d.instalacao],
  ])('Suporte técnico não se parece com %s', (_, outro) => {
    expect(semelhanca(d.suporteTecnico, outro)).toBeLessThan(LIMITE);
  });

  test.each([
    ['Mudança de endereço', d.mudancaDeEndereco],
    ['Transferir', f.transferir],
    ['Reativação', d.reativacao],
    ['Financeiro', d.financeiro],
  ])('Mudança de plano não se parece com %s', (_, outro) => {
    expect(semelhanca(d.mudancaDePlano, outro)).toBeLessThan(LIMITE);
  });

  // Tinta compatível com a família de referência da prancha (os oito ícones
  // centrais). A leitura oficial é a do Chrome, na prancha; esta grade não
  // suaviza bordas e mede de 0 a 12% menos conforme a forma, daí a folga de 5%.
  test.each(['reativacao', 'suporteTecnico', 'mudancaDePlano'])('%s: cobertura dentro da faixa da família', (chave) => {
    const referencia = ['atendimento', 'encerrar', 'transferir', 'buscar', 'informacoes', 'historico', 'dadosCliente', 'consultarSgp'].map((k) => cobertura(f[k]));
    const valor = cobertura(d[chave]);
    expect(valor).toBeGreaterThanOrEqual(Math.min(...referencia) * 0.95);
    expect(valor).toBeLessThanOrEqual(Math.max(...referencia) * 1.05);
  });
});

describe('ícones dos motivos: módulo à parte', () => {
  test('os desenhos são dados puros, e o módulo só importa React, a moldura e os desenhos', () => {
    expect(FONTES['./desenhosMotivos.js']).toBeDefined();
    expect(FONTES['./desenhosMotivos.js']).not.toMatch(/^\s*import\s/m);
    const origens = [...FONTES['./motivos.jsx'].matchAll(/(?:from|import)\s*['"]([^'"]+)['"]/g)].map((a) => a[1]);
    expect(origens.sort()).toEqual(['./Icone', './desenhosMotivos'].sort());
  });

  test('o índice da família não leva os desenhos dos motivos', () => {
    expect(FONTES['./index.jsx']).not.toMatch(/motivos|desenhosMotivos/i);
    expect(FONTES['./desenhos.js']).not.toMatch(/desenhosMotivos|semConexao|lentidao|negociacaoDeDebito/);
  });

  // Integrado em 27/09: o diálogo Encerrar é o único que importa o módulo; os
  // desenhos, só o módulo. Conta import (estático ou dinâmico), não comentário.
  const TELAS = import.meta.glob(['/src/**/*.{js,jsx}', '!/src/**/*.test.*', '!/src/components/icones/**'], {
    query: '?raw',
    import: 'default',
    eager: true,
  });

  test('a leitura das telas funciona (prova de que o glob enxerga os arquivos)', () => {
    expect(Object.keys(TELAS)).toEqual(expect.arrayContaining(['/src/App.jsx', '/src/components/CloseReasonModal.jsx', '/src/components/ConversationView.jsx']));
  });

  const origensDe = (fonte) => {
    const limpa = fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    return [
      ...[...limpa.matchAll(/^\s*import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/gm)].map((m) => m[1]),
      ...[...limpa.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]),
    ];
  };

  test('só o diálogo Encerrar importa o módulo, e ninguém importa os desenhos direto', () => {
    const importamOModulo = Object.entries(TELAS)
      .filter(([, fonte]) => origensDe(fonte).some((o) => /icones\/motivos$/.test(o)))
      .map(([arquivo]) => arquivo);
    expect(importamOModulo).toEqual(['/src/components/CloseReasonModal.jsx']);
    const importamOsDesenhos = Object.entries(TELAS)
      .filter(([, fonte]) => origensDe(fonte).some((o) => /desenhosMotivos/.test(o)))
      .map(([arquivo]) => arquivo);
    expect(importamOsDesenhos).toEqual([]);
  });
});
