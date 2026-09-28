import { describe, test, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

// O jsdom não aplica CSS: o supervisao.css é lido como texto e as regras são
// conferidas uma a uma. É o que prova "sem desfoque", "equipe fora da tela no
// celular", "16 px na busca" e "alvos de 44 px" — coisas que um teste de DOM
// não enxerga.

const AQUI = dirname(fileURLToPath(import.meta.url));
const semComentarios = (texto) => texto.replace(/\/\*[\s\S]*?\*\//g, '');
const CSS = semComentarios(readFileSync(join(AQUI, 'supervisao.css'), 'utf8'));
const JSX = readFileSync(join(AQUI, 'SupervisionPage.jsx'), 'utf8');

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
const doSeletor = (trecho, midia = (m) => m === '') =>
  REGRAS.filter((r) => r.seletor.split(',').some((s) => s.trim() === trecho) && midia(r.midia));
const valor = (trecho, propriedade, midia) =>
  doSeletor(trecho, midia).flatMap((r) => r.declaracoes).filter(([p]) => p === propriedade).map(([, v]) => v).at(-1);
const CELULAR = (m) => /max-width:\s*767/.test(m);
const ESTREITO = (m) => /max-width:\s*1199/.test(m);
const LARGO = (m) => /min-width:\s*1200/.test(m);

describe('supervisao.css: o custo fica baixo', () => {
  test('a folha antiga, escura e com laranja, saiu', () => {
    expect(existsSync(join(AQUI, 'supervision.css'))).toBe(false);
    expect(JSX).toMatch(/import '\.\/supervisao\.css';/);
    expect(JSX).not.toMatch(/supervision\.css/);
  });

  test('a regex do desfoque pega o caso real e deixa passar o "none"', () => {
    expect('a { backdrop-filter: blur(6px); }').toMatch(/backdrop-filter:\s*(?!none)[^\s;]/);
    expect('a { backdrop-filter: none; }').not.toMatch(/backdrop-filter:\s*(?!none)[^\s;]/);
  });

  test('sem desfoque, filtro, gradiente, animação contínua nem sombra grande', () => {
    expect(CSS).not.toMatch(/backdrop-filter:\s*(?!none)[^\s;]/);
    expect(CSS).not.toMatch(/(^|[^-])filter:\s*(?!none)[^\s;]/m);
    expect(CSS).not.toMatch(/gradient\(/);
    expect(CSS).not.toMatch(/animation:\s*(?!none)[^\s;]/);
    expect(CSS).not.toMatch(/@keyframes/);
    for (const [, sombra] of REGRAS.flatMap((r) => r.declaracoes).filter(([p]) => p === 'box-shadow')) {
      if (sombra === 'none') continue;
      // x, y e desfoque (o zero pode vir sem unidade).
      const desfoques = [...sombra.matchAll(/(-?\d+(?:\.\d+)?)(?:px)?\s+(-?\d+(?:\.\d+)?)(?:px)?\s+(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[3]));
      expect(desfoques.length, sombra).toBeGreaterThan(0);
      desfoques.forEach((d) => expect(d, sombra).toBeLessThanOrEqual(24));
    }
  });

  test('transição só de cor, nunca "all"', () => {
    const transicoes = REGRAS.flatMap((r) => r.declaracoes).filter(([p]) => p === 'transition').map(([, v]) => v);
    transicoes.forEach((t) => {
      expect(t).not.toMatch(/\ball\b/);
      t.split(',').forEach((parte) => expect(parte.trim().split(/\s+/)[0]).toMatch(/^(color|background-color|border-color|opacity|none)$/));
    });
  });

  test('sem o laranja herdado', () => {
    expect(CSS).not.toMatch(/#d99055|#e8833a|chat-orange|chat-copper|copper/i);
  });

  test('o diálogo da equipe não desfoca o fundo nem anima', () => {
    const fundo = doSeletor(".chat-theme:has(> [data-dialog='supervisao-equipe'])");
    expect(fundo.flatMap((r) => r.declaracoes)).toEqual(expect.arrayContaining([['backdrop-filter', 'none']]));
    expect(valor("[data-dialog='supervisao-equipe'].dw-dialog", 'animation')).toBe('none');
    expect(valor("[data-dialog='supervisao-equipe'].dw-dialog", 'backdrop-filter')).toBe('none');
  });
});

describe('supervisao.css: celular', () => {
  test('uma rolagem só: a página rola, a lista e os grupos não', () => {
    expect(valor('.sv', 'overflow-y')).toBe('auto');
    const rolagens = REGRAS.filter((r) => r.declaracoes.some(([p, v]) => /^overflow(-y)?$/.test(p) && /auto|scroll/.test(v)));
    const foraDoLargo = rolagens.filter((r) => !LARGO(r.midia)).map((r) => r.seletor);
    // A página, o popover de filtros (camada por cima) e o corpo da folha da equipe.
    expect(foraDoLargo.sort()).toEqual(['.sv', '.sv-equipe-folha .sv-equipe-lista', '.sv-filtros-painel'].sort());
  });

  test('o painel da equipe não aparece junto da lista: abaixo de 1200 px ele sai e fica o botão', () => {
    expect(valor('.sv-equipe-lateral', 'display', ESTREITO)).toBe('none');
    expect(valor('.sv-equipe-botao', 'display')).toBe('none');
    expect(valor('.sv-equipe-botao', 'display', ESTREITO)).toBe('inline-flex');
    // O indicador "Equipe online" leva ao painel lateral: sem ele, sai também.
    expect(valor('.sv-indicador[data-indicador="equipe"]', 'display', ESTREITO)).toBe('none');
  });

  test('a busca tem 16 px no celular (o Safari não dá zoom)', () => {
    expect(px(valor('.sv-busca input', 'font-size', CELULAR) ?? valor('.sv-busca input', 'font-size'))).toBeGreaterThanOrEqual(16);
  });

  test.each([
    ['.sv-linha'],
    ['.sv-filtros-botao'],
    ['.sv-aba'],
    ['.sv-indicador'],
    ['.sv-chip-remover'],
    ['.sv-equipe-botao'],
    ['.sv-busca input'],
    ['.sv-botao-texto'],
    ['.sv-botao-secundario'],
    ['.sv-filtros-opcao'],
  ])('%s tem alvo de toque de 44 px de altura no celular', (seletor) => {
    const altura = px(valor(seletor, 'min-height', CELULAR) ?? valor(seletor, 'min-height'));
    expect(altura).toBeGreaterThanOrEqual(44);
  });

  // O único alvo estreito por natureza: o × do chip. O desenho continua
  // pequeno; a caixa do botão cresce para fora do chip.
  test('o × do chip tem 44 × 44 px no celular', () => {
    expect(px(valor('.sv-chip-remover', 'min-width', CELULAR))).toBeGreaterThanOrEqual(44);
    expect(px(valor('.sv-chip-remover', 'min-height', CELULAR))).toBeGreaterThanOrEqual(44);
  });

  test('o botão do menu da casca entra no cabeçalho da Supervisão, só nela', () => {
    const regra = REGRAS.find((r) => r.seletor.includes("[data-encaixe='trilho'] + div:has(> .sv) > button[aria-controls='sidenav']"));
    expect(regra).toBeDefined();
    expect(regra.declaracoes).toEqual(expect.arrayContaining([['position', 'absolute']]));
  });
});

describe('supervisao.css: nome longo contido', () => {
  test('nome, prévia e responsável cortam com reticências dentro da célula', () => {
    for (const seletor of ['.sv-linha-nome', '.sv-linha-previa', '.sv-responsavel-nome', '.sv-equipe-nome']) {
      expect(valor(seletor, 'overflow'), seletor).toBe('hidden');
      expect(valor(seletor, 'text-overflow'), seletor).toBe('ellipsis');
      expect(valor(seletor, 'white-space'), seletor).toBe('nowrap');
    }
    expect(valor('.sv-linha-cliente', 'min-width')).toBe('0');
  });

  test('as colunas da grade encolhem em vez de estourar a lista', () => {
    const colunas = valor('.sv-linha', 'grid-template-columns', (m) => /min-width:\s*768/.test(m));
    expect(colunas).toMatch(/minmax\(0,/);
    expect(colunas).not.toMatch(/minmax\((?!0,)\d/);
  });
});

describe('supervisao.css: cor com moderação', () => {
  test('o violeta da IA fica só na marca "IA"; o motivo usa a cor da linha', () => {
    expect(valor('.sv-linha-ia', 'color')).toBe('inherit');
    expect(valor('.sv-linha-ia-marca', 'color')).toBe('var(--sv-automacao)');
  });

  test('valor desconhecido ("—") sai em cinza, sem a cor de confirmado', () => {
    for (const seletor of ['.sv-equipe-online[data-desconhecido]', '.sv-atendente-carga[data-desconhecido]', '.sv-indicador-valor[data-desconhecido]']) {
      expect(valor(seletor, 'color'), seletor).toBe('var(--sv-texto-3)');
    }
  });

  test('o fundo do popover cobre a tela em todo tamanho, transparente, para o clique "fora" não cair na linha', () => {
    expect(valor('.sv-filtros-fundo', 'position')).toBe('fixed');
    expect(valor('.sv-filtros-fundo', 'inset')).toBe('0');
    expect(valor('.sv-filtros-fundo', 'background')).toBe('transparent');
    expect(REGRAS.filter((r) => r.seletor.includes('.sv-filtros-fundo') && r.declaracoes.some(([p, v]) => p === 'display' && v === 'none'))).toEqual([]);
  });

  // Tablet com toque (768–1199 px) também precisa de 44 px: a regra vale
  // para ponteiro grosso, qualquer que seja a largura.
  test.each(['.sv-chip-remover', '.sv-botao-texto', '.sv-aba', '.sv-filtros-botao', '.sv-equipe-botao'])(
    '%s tem 44 px com ponteiro de toque em qualquer largura',
    (seletor) => {
      expect(px(valor(seletor, 'min-height', (m) => /pointer:\s*coarse/.test(m)))).toBeGreaterThanOrEqual(44);
    }
  );
});
