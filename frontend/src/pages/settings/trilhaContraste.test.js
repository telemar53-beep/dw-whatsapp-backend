import { describe, test, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

// Contraste da trilha de Configurações ("Configurações › Área › Página").
//
// A trilha da S1 tinha o texto em #777d8d (4,12:1 sobre o branco da página) e
// o separador "›" em #a0a5b1 (2,47:1), e a página atual tinha a mesma cor do
// caminho. Este teste lê as regras reais de settings.css, resolve os tokens
// --cfg-* da casca e calcula o contraste contra o fundo da área
// (.settings-stage): texto ≥ 4,5:1, separador ≥ 3:1 e mais claro que o texto,
// página atual mais evidente que o caminho. E prende o resto: os tokens da
// casca, o tamanho e o espaçamento da trilha, e a classe usada só por ela.

const PASTA = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(join(PASTA, 'settings.css'), 'utf8').replace(/\r\n/g, '\n');

function regra(seletor) {
  const escapado = seletor.replace(/[.*+?^${}()|[\]\\>:]/g, '\\$&');
  const achadas = [...CSS.matchAll(new RegExp(`^${escapado}\\s*\\{([^}]*)\\}`, 'gm'))];
  expect(achadas, `regra "${seletor}" em settings.css`).toHaveLength(1);
  return Object.fromEntries(
    achadas[0][1].split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
      const i = d.indexOf(':');
      return [d.slice(0, i).trim(), d.slice(i + 1).trim()];
    })
  );
}

const TOKENS = Object.fromEntries([...CSS.matchAll(/^\s*(--cfg-[a-z-]+):\s*(#[0-9a-f]{6});/gim)].map((m) => [m[1], m[2].toLowerCase()]));
function cor(valor) {
  const token = /^var\((--cfg-[a-z-]+)\)$/.exec(valor);
  const hex = token ? TOKENS[token[1]] : valor;
  expect(hex, `cor "${valor}"`).toMatch(/^#[0-9a-f]{6}$/i);
  return hex.toLowerCase();
}
function luminancia(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contraste(a, b) {
  const [x, y] = [luminancia(a), luminancia(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

// Lidas dentro de cada teste: uma regra ausente falha só o teste dela.
const fundo = () => cor(regra('.settings-stage').background);
const texto = () => cor(regra('.cfg-trilha').color);
const separador = () => cor(regra('.cfg-trilha-sep').color);
const atual = () => cor(regra('.cfg-trilha > :last-child > :first-child').color);

describe('Trilha de Configurações: contraste', () => {
  test('o fundo da trilha é o papel branco da área', () => {
    expect(fundo()).toBe('#ffffff');
  });

  test('o texto do caminho passa de 4,5:1', () => {
    expect(contraste(texto(), fundo())).toBeGreaterThanOrEqual(4.5);
  });

  test('os links do caminho herdam a cor do texto', () => {
    expect(regra('.cfg-trilha a').color).toBe('inherit');
  });

  test('o separador "›" passa de 3:1 e continua mais claro que o texto', () => {
    expect(contraste(separador(), fundo())).toBeGreaterThanOrEqual(3);
    expect(contraste(separador(), fundo())).toBeLessThan(contraste(texto(), fundo()));
  });

  test('a página atual (último passo) é mais evidente que o caminho anterior', () => {
    expect(contraste(atual(), fundo())).toBeGreaterThan(contraste(texto(), fundo()));
  });
});

describe('Trilha de Configurações: a mudança fica na trilha', () => {
  test('os tokens da casca continuam com os valores de antes', () => {
    expect(TOKENS).toMatchObject({
      '--cfg-tinta': '#171927',
      '--cfg-apoio': '#62697a',
      '--cfg-fraco': '#8a8f9d',
      '--cfg-papel': '#ffffff',
    });
  });

  test('tamanho, espaçamento e tipografia da trilha não mudam', () => {
    expect(regra('.cfg-trilha')).toMatchObject({
      display: 'flex', 'flex-wrap': 'wrap', 'align-items': 'center', gap: '6px', 'margin-bottom': '14px', 'font-size': '12px', 'line-height': '16px',
    });
    expect(regra('.cfg-trilha-sep')['margin-left']).toBe('6px');
    expect(Object.keys(regra('.cfg-trilha > :last-child > :first-child'))).toEqual(['color']);
  });

  test('a classe da trilha só é usada pela trilha do SettingsShell', () => {
    const SRC = dirname(dirname(PASTA));
    const usos = [];
    const varrer = (pasta) => readdirSync(pasta).forEach((nome) => {
      const caminho = join(pasta, nome);
      if (statSync(caminho).isDirectory()) return varrer(caminho);
      if (/\.(jsx?|css)$/.test(nome) && !/\.test\./.test(nome) && /cfg-trilha/.test(readFileSync(caminho, 'utf8'))) usos.push(caminho.slice(SRC.length + 1).replace(/\\/g, '/'));
      return undefined;
    });
    varrer(SRC);
    expect(usos.sort()).toEqual(['pages/settings/SettingsShell.jsx', 'pages/settings/settings.css']);
  });
});
