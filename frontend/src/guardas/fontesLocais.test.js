import { describe, test, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

// Guarda das fontes auto-hospedadas.
//
// A folha do fonts.googleapis.com era <link rel="stylesheet"> de terceiro no
// <head> e BLOQUEAVA a primeira pintura: medido na tela de login de produção,
// 20 s de atraso nesse terceiro viravam 20,7 s de tela montada e invisível.
// Sora e Inter passaram a sair deste domínio (src/fontes.css + src/assets/
// fontes). Um redesenho que "só troque a fonte" colando o <link> que o Google
// sugere desfaz isso sem quebrar nada visível — por isso a guarda.
//
// Comentários são removidos antes da busca: o index.html e o fontes.css
// EXPLICAM por que o Google saiu, e citar o nome do host não é pedir a fonte.

const SRC = dirname(dirname(fileURLToPath(import.meta.url)));
const FRONTEND = dirname(SRC);
const HOSTS_DO_GOOGLE = /fonts\.(googleapis|gstatic)\.com/;

function ler(caminho) {
  return readFileSync(caminho, 'utf8');
}

function semComentarios(texto) {
  return texto
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // Só comentário de linha INTEIRA: cortar `//` no meio da linha comeria o
    // `https://` de uma URL de verdade e esconderia justamente a regressão.
    .replace(/^\s*\/\/.*$/gm, '');
}

function arquivosDeProducao(pasta) {
  return readdirSync(pasta).flatMap((nome) => {
    const caminho = join(pasta, nome);
    if (statSync(caminho).isDirectory()) return arquivosDeProducao(caminho);
    if (!/\.(js|jsx|css|html)$/.test(nome) || /\.test\.(js|jsx)$/.test(nome)) return [];
    return [caminho];
  });
}

const FONTES_CSS = semComentarios(ler(join(SRC, 'fontes.css')));
const BLOCOS = [...FONTES_CSS.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]);
const URLS = BLOCOS.flatMap((bloco) => [...bloco.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)].map((m) => m[1]));

describe('fontes auto-hospedadas', () => {
  test('o index.html não carrega folha nem fonte do Google', () => {
    const html = semComentarios(ler(join(FRONTEND, 'index.html')));
    expect(html).not.toMatch(HOSTS_DO_GOOGLE);
  });

  test('o index.html não tem folha de estilo de terceiro no <head>', () => {
    const html = semComentarios(ler(join(FRONTEND, 'index.html')));
    const folhasExternas = [...html.matchAll(/<link[^>]*rel=["']?stylesheet[^>]*>/gi)]
      .map((m) => m[0])
      .filter((tag) => /href=["']?(https?:)?\/\//i.test(tag));
    expect(folhasExternas).toEqual([]);
  });

  test('nenhum arquivo de produção em src pede fonte ao Google', () => {
    const culpados = arquivosDeProducao(SRC)
      .filter((caminho) => HOSTS_DO_GOOGLE.test(semComentarios(ler(caminho))))
      .map((caminho) => caminho.slice(SRC.length + 1).replace(/\\/g, '/'));
    expect(culpados).toEqual([]);
  });

  test('o fontes.css declara os 29 @font-face, todos com arquivo local woff2', () => {
    expect(BLOCOS).toHaveLength(29);
    expect(URLS).toHaveLength(29);
    expect(URLS.filter((url) => !/^\.\/assets\/fontes\/[\w-]+\.woff2$/.test(url))).toEqual([]);
  });

  test('todo @font-face usa font-display: swap (texto aparece antes da fonte chegar)', () => {
    expect(BLOCOS.filter((bloco) => !/font-display:\s*swap/.test(bloco))).toEqual([]);
  });

  test('os arquivos citados existem, e são exatamente os 9 woff2 da pasta', () => {
    const citados = [...new Set(URLS.map((url) => resolve(SRC, url)))];
    expect(citados.filter((caminho) => !existsSync(caminho))).toEqual([]);

    const naPasta = readdirSync(join(SRC, 'assets', 'fontes')).filter((nome) => nome.endsWith('.woff2')).sort();
    expect(naPasta).toHaveLength(9);
    expect(citados.map((caminho) => caminho.split(/[\\/]/).pop()).sort()).toEqual(naPasta);
  });

  test('a licença OFL das duas famílias acompanha os arquivos', () => {
    for (const nome of ['OFL-Sora.txt', 'OFL-Inter.txt']) {
      const caminho = join(SRC, 'assets', 'fontes', nome);
      expect(existsSync(caminho), nome).toBe(true);
      expect(ler(caminho)).toMatch(/SIL OPEN FONT LICENSE/i);
    }
  });

  // Se o redesenho TROCAR a tipografia, a regra continua: a família nova
  // precisa de @font-face local. É o que este teste cobra, e não o nome Sora.
  test('a família principal de cada token de fonte tem @font-face local', () => {
    const tokens = ler(join(SRC, 'index.css'));
    const familiasDosTokens = ['--font-display', '--font-sans'].map((token) => {
      const valor = tokens.match(new RegExp(`${token}:\\s*([^;]+);`));
      expect(valor, token).not.toBeNull();
      return valor[1].split(',')[0].trim().replace(/^["']|["']$/g, '');
    });
    const declaradas = new Set(BLOCOS.map((bloco) => bloco.match(/font-family:\s*['"]?([^'";]+)['"]?/)[1]));
    expect(familiasDosTokens.filter((familia) => !declaradas.has(familia))).toEqual([]);
  });

  // Sem este import o CSS local simplesmente não entra, e a tela cai em
  // silêncio para a fonte do sistema.
  test('o ponto de entrada importa o fontes.css', () => {
    expect(semComentarios(ler(join(SRC, 'main.jsx')))).toMatch(/import\s+['"]\.\/fontes\.css['"]/);
  });
});
