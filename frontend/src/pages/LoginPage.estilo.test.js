import { describe, test, expect } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

// O jsdom não aplica CSS: aqui o login.css é lido como texto e as regras são
// conferidas uma a uma. É o que prova "sem desfoque", "16 px no celular" e
// "controles de 48 a 52 px" — coisas que um teste de DOM não enxerga.

const AQUI = dirname(fileURLToPath(import.meta.url));
const semComentarios = (texto) => texto.replace(/\/\*[\s\S]*?\*\//g, '');
const CSS = semComentarios(readFileSync(join(AQUI, 'login.css'), 'utf8'));
const JSX = readFileSync(join(AQUI, 'LoginPage.jsx'), 'utf8');
const INDEX_CSS = readFileSync(join(AQUI, '..', 'index.css'), 'utf8');

function declaracoes(corpo) {
  return corpo
    .split(';')
    .map((linha) => linha.trim())
    .filter(Boolean)
    .map((linha) => {
      const i = linha.indexOf(':');
      return [linha.slice(0, i).trim(), linha.slice(i + 1).trim()];
    });
}

// [{ midia, seletor, declaracoes }] — com a pilha de @media de cada regra.
function regras(css) {
  const saida = [];
  const pilha = [];
  let buffer = '';
  for (const c of css) {
    if (c === '{') {
      pilha.push(buffer.trim());
      buffer = '';
    } else if (c === '}') {
      const cabeca = pilha.pop();
      if (cabeca && !cabeca.startsWith('@')) {
        saida.push({ midia: pilha.filter((b) => b.startsWith('@')).join(' '), seletor: cabeca, declaracoes: declaracoes(buffer) });
      }
      buffer = '';
    } else {
      buffer += c;
    }
  }
  return saida;
}

const REGRAS = regras(CSS);
const px = (valor) => Number(String(valor).match(/(-?\d*\.?\d+)px/)?.[1]);
const valoresDe = (propriedade, filtro = () => true) =>
  REGRAS.filter(filtro).flatMap((r) => r.declaracoes.filter(([p]) => p === propriedade).map(([, v]) => ({ ...r, valor: v })));
const regraBase = (seletor) => REGRAS.find((r) => r.seletor === seletor && !r.midia);
const valorBase = (seletor, propriedade) => regraBase(seletor)?.declaracoes.find(([p]) => p === propriedade)?.[1];

function hexParaHsl(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let matiz;
  if (max === r) matiz = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) matiz = (b - r) / d + 2;
  else matiz = (r - g) / d + 4;
  return { h: matiz * 60, s, l };
}

describe('login.css: efeitos e cor', () => {
  test('sem desfoque, backdrop-filter, gradiente, animação ou transição', () => {
    expect(CSS).not.toMatch(/blur\(|backdrop-filter|filter\s*:|gradient\(|@keyframes|animation|transition/);
  });

  test('cores chapadas: nada translúcido fora da sombra curta do módulo', () => {
    const semSombra = CSS.replace(/box-shadow\s*:[^;]*;/g, '');
    // `opacity: 1` só desfaz o placeholder apagado do Firefox; qualquer outro
    // valor é translucidez.
    expect(semSombra).not.toMatch(/rgba\(|hsla\(|transparent|opacity\s*:(?!\s*1\s*;)|color-mix|\/\s*0?\.\d+\s*\)/);
  });

  test('paleta aprovada: índigo sólido, fundo cinza muito claro, sem laranja', () => {
    expect(valorBase('.login', '--login-indigo')).toBe('#4f46e5');
    const fundo = hexParaHsl(valorBase('.login', '--login-fundo'));
    expect(fundo.l).toBeGreaterThan(0.9);
    expect(fundo.s).toBeLessThan(0.4);
    expect(valorBase('.login', 'background')).toBe('var(--login-fundo)');

    for (const hex of CSS.match(/#[0-9a-f]{3,6}\b/gi)) {
      const { h, s, l } = hexParaHsl(hex);
      const laranja = h >= 15 && h <= 45 && s > 0.45 && l > 0.3 && l < 0.8;
      expect(laranja, hex).toBe(false);
    }
  });

  test('círculos e botão em índigo sólido, com desenho e texto brancos', () => {
    expect(valorBase('.login-circulo', 'background')).toBe('var(--login-indigo)');
    expect(valorBase('.login-circulo', 'color')).toBe('#ffffff');
    expect(valorBase('.login-botao', 'background')).toBe('var(--login-indigo)');
    expect(valorBase('.login-botao', 'color')).toBe('#ffffff');
  });

  test('só a Inter, a família da interface nova', () => {
    const familias = valoresDe('font-family').map((d) => d.valor);
    expect(familias.length).toBeGreaterThan(0);
    expect(familias.filter((f) => f !== 'var(--font-sans)')).toEqual([]);
    expect(CSS).not.toMatch(/Sora|font-display/);
  });
});

describe('login.css: módulo', () => {
  test('420–440 px, contorno índigo fino, cantos de 26–28 px e sombra curta', () => {
    const largura = px(valorBase('.login-modulo', 'max-width'));
    expect(largura).toBeGreaterThanOrEqual(420);
    expect(largura).toBeLessThanOrEqual(440);

    const borda = valorBase('.login-modulo', 'border');
    expect(borda).toMatch(/solid var\(--login-indigo\)$/);
    expect(px(borda)).toBeLessThanOrEqual(2);

    for (const { valor } of valoresDe('border-radius', (r) => r.seletor === '.login-modulo')) {
      expect(px(valor)).toBeGreaterThanOrEqual(26);
      expect(px(valor)).toBeLessThanOrEqual(28);
    }

    const sombra = valorBase('.login-modulo', 'box-shadow');
    expect(sombra.split(/,(?![^(]*\))/)).toHaveLength(1);
    // "0 10px 24px -16px rgba(...)": x, y, desfoque, espalhamento.
    const [, deslocamento, desfoque] = sombra
      .replace(/rgba?\([^)]*\)|#[0-9a-f]+/gi, '')
      .trim()
      .split(/\s+/)
      .map((medida) => parseFloat(medida));
    expect(deslocamento).toBeLessThanOrEqual(12);
    expect(desfoque).toBeLessThanOrEqual(24);
  });

  test('nome longo: no máximo duas linhas, quebrando palavra comprida', () => {
    expect(valorBase('.login-empresa', '-webkit-line-clamp')).toBe('2');
    expect(valorBase('.login-empresa', 'overflow')).toBe('hidden');
    expect(valorBase('.login-empresa', 'overflow-wrap')).toBe('anywhere');
  });

  test('esqueleto do nome: barra chapada, sem animação', () => {
    expect(valorBase('.login-esqueleto', 'background')).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe('login.css: celular', () => {
  test('texto dos campos com 16 px ou mais em qualquer tela (o Safari não aproxima)', () => {
    const tamanhos = valoresDe('font-size', (r) => /\binput\b/.test(r.seletor));
    expect(tamanhos.some((d) => !d.midia)).toBe(true);
    for (const { valor, seletor, midia } of tamanhos) {
      expect(px(valor), `${midia} ${seletor}`).toBeGreaterThanOrEqual(16);
    }
  });

  test('campos e botão entre 48 e 52 px em qualquer tela', () => {
    const alturas = valoresDe('--login-controle');
    expect(alturas.length).toBeGreaterThanOrEqual(2);
    for (const { valor, midia } of alturas) {
      expect(px(valor), midia).toBeGreaterThanOrEqual(48);
      expect(px(valor), midia).toBeLessThanOrEqual(52);
    }
    expect(valorBase('.login-campo', 'height')).toBe('var(--login-controle)');
    expect(valorBase('.login-botao', 'height')).toBe('var(--login-controle)');
  });

  // No toque, o :hover gruda depois do toque: o botão ficava escuro como se
  // estivesse enviando (captura de 26/09).
  test('hover só dentro de @media (hover: hover)', () => {
    const comHover = REGRAS.filter((r) => r.seletor.includes(':hover'));
    expect(comHover.length).toBeGreaterThan(0);
    for (const { seletor, midia } of comHover) {
      expect(midia, seletor).toContain('(hover: hover)');
    }
  });

  test('"Mostrar" com alvo de toque de pelo menos 44 px', () => {
    expect(px(valorBase('.login-mostrar', 'min-width'))).toBeGreaterThanOrEqual(44);
    expect(valorBase('.login-mostrar', 'height')).toBe('100%');
  });

  test('margem de 20 px respeitando as áreas seguras', () => {
    const espaco = valorBase('.login', 'padding');
    for (const lado of ['top', 'right', 'bottom', 'left']) {
      expect(espaco).toContain(`env(safe-area-inset-${lado})`);
    }
    const noCelular = valoresDe('padding', (r) => r.seletor === '.login' && /max-width/.test(r.midia));
    for (const { valor } of noCelular) {
      expect(valor).toMatch(/max\(20px, env\(safe-area-inset-(left|right)\)\)/);
    }
  });
});

describe('login.css: isolamento e limpeza', () => {
  test('toda regra começa pela raiz .login', () => {
    for (const { seletor } of REGRAS) {
      for (const parte of seletor.split(',')) {
        expect(parte.trim(), seletor).toMatch(/^\.login(\b|-)/);
      }
    }
  });

  test('a página não usa as classes do visual antigo', () => {
    expect(JSX).not.toMatch(/chat-theme|font-display|animate-|blur|backdrop|shadow-\[|bg-accent|text-accent/);
  });

  test('a animação login-rise saiu do index.css', () => {
    expect(INDEX_CSS).not.toMatch(/login-rise/);
  });
});
