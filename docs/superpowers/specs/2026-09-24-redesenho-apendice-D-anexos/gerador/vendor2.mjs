// Vendoring v2: SVG do pacote -> dados minimos (atributo d) + fabrica unica.
// Cada icone otimizado e reconstruido como SVG para conferir fidelidade contra
// o original (rasterizado no Chrome). Exporta funcoes usadas pelos medidores.
import fs from 'fs';
import zlib from 'zlib';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';
import { SP, SLOTS, arquivo } from './familias.mjs';
const require = createRequire(import.meta.url);
const { optimize } = require(SP + 'tools/node_modules/svgo');
const ESBUILD = 'D:/dw-whatsapp-backend/frontend/node_modules/esbuild/bin/esbuild';

export const RAIZ = {
  ph: { vb: '0 0 256 256', reg: { fill: 'currentColor' }, fill: { fill: 'currentColor' } },
  tb: { vb: '0 0 24 24', reg: { fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, fill: { fill: 'currentColor' } },
  hi: { vb: '0 0 24 24', reg: { fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, fill: { fill: 'currentColor' } },
  lu: { vb: '0 0 24 24', reg: { fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' } },
  // marca preenchida na grade 24 (Pix: Simple Icons, ou o desenho atual do SgpIcons)
  si: { vb: '0 0 24 24', reg: { fill: 'currentColor' } },
};

function limpar(s) {
  return s.replace(/<!--[\s\S]*?-->/g, '').replace(/<\?xml[^>]*>/, '')
    .replace(/<path stroke="none" d="M0 0h24v24H0z" fill="none"\s*\/>/g, '');
}
// Otimiza e devolve { paths:[{d, attrs}], outros:n }
export function extrair(file, fam, variante, prec, juntar = !process.env.SEM_JUNTAR) {
  const raiz = RAIZ[fam][variante];
  const o = optimize(limpar(fs.readFileSync(file, 'utf8')), {
    multipass: true,
    plugins: [
      { name: 'preset-default', params: { floatPrecision: prec, overrides: { removeViewBox: false, ...(!juntar ? { mergePaths: false } : {}), convertPathData: { floatPrecision: prec, removeUseless: false }, convertShapeToPath: { convertArcs: true, floatPrecision: prec } } } },
      { name: 'removeAttrs', params: { attrs: ['class', 'data-slot', 'aria-hidden', 'xmlns', 'svg:width', 'svg:height'] } },
    ],
  }).data;
  const corpo = o.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
  const svgTag = o.match(/^<svg[^>]*>/)[0];
  const paths = []; let outros = 0;
  const r = (v) => +(+v).toFixed(prec);
  for (const m of corpo.matchAll(/<(\w+)([^>]*?)\/?>/g)) {
    const [, tag, rest] = m;
    const attrs = Object.fromEntries([...rest.matchAll(/([\w-]+)="([^"]*)"/g)].map((a) => [a[1], a[2]]));
    if (tag === 'rect') {
      // retangulo de cantos arredondados (o SVGO so converte rect sem rx)
      const x = +(attrs.x || 0), y = +(attrs.y || 0), w = +attrs.width, h = +attrs.height;
      let rx = attrs.rx !== undefined ? +attrs.rx : attrs.ry !== undefined ? +attrs.ry : 0;
      let ry = attrs.ry !== undefined ? +attrs.ry : rx;
      rx = Math.min(rx, w / 2); ry = Math.min(ry, h / 2);
      attrs.d = rx || ry
        ? `M${r(x + rx)} ${r(y)}h${r(w - 2 * rx)}a${r(rx)} ${r(ry)} 0 0 1 ${r(rx)} ${r(ry)}v${r(h - 2 * ry)}a${r(rx)} ${r(ry)} 0 0 1 ${r(-rx)} ${r(ry)}h${r(-(w - 2 * rx))}a${r(rx)} ${r(ry)} 0 0 1 ${r(-rx)} ${r(-ry)}v${r(-(h - 2 * ry))}a${r(rx)} ${r(ry)} 0 0 1 ${r(rx)} ${r(-ry)}z`
        : `M${r(x)} ${r(y)}h${r(w)}v${r(h)}h${r(-w)}z`;
      for (const k of ['x', 'y', 'width', 'height', 'rx', 'ry']) delete attrs[k];
    } else if (tag === 'circle' || tag === 'ellipse') {
      const cx = +(attrs.cx || 0), cy = +(attrs.cy || 0), rx = +(attrs.r ?? attrs.rx), ry = +(attrs.r ?? attrs.ry);
      attrs.d = `M${r(cx - rx)} ${r(cy)}a${r(rx)} ${r(ry)} 0 1 0 ${r(2 * rx)} 0a${r(rx)} ${r(ry)} 0 1 0 ${r(-2 * rx)} 0z`;
      for (const k of ['cx', 'cy', 'r', 'rx', 'ry']) delete attrs[k];
    } else if (tag !== 'path') { outros++; continue; }
    const d = attrs.d; delete attrs.d;
    // atributos iguais aos da raiz nao precisam ir por elemento; clip-rule sem clipPath nao faz nada
    for (const [k, v] of Object.entries(attrs)) if (raiz[k] === v || k === 'clip-rule') delete attrs[k];
    paths.push({ d, attrs });
  }
  // atributos que a raiz do arquivo declara e que diferem da nossa raiz padrao
  const raizArq = Object.fromEntries([...svgTag.matchAll(/([\w-]+)="([^"]*)"/g)].map((a) => [a[1], a[2]]));
  const difRaiz = {};
  for (const k of ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'fill-rule']) if (raizArq[k] !== undefined && raizArq[k] !== raiz[k]) difRaiz[k] = raizArq[k];
  return { paths, outros, difRaiz };
}
// O primeiro "m" de um <path> e absoluto; colado atras de outro path ele
// passaria a ser relativo ao ponto final do anterior. Troca por "M" e, se o
// comando trazia mais pares (lineto implicito RELATIVO), insere um "l".
export function inicioAbsoluto(d) {
  const N = '(-?(?:\\d+\\.?\\d*|\\.\\d+)(?:e[-+]?\\d+)?)';
  const m = d.match(new RegExp('^m\\s*' + N + '[\\s,]*' + N, 'i'));
  if (!m) throw new Error('path sem moveto: ' + d.slice(0, 30));
  if (d[0] === 'M') return d;
  const resto = d.slice(m[0].length);
  const extra = /^[\s,]*[-\d.]/.test(resto) ? 'l' + resto.replace(/^[\s,]*/, '') : resto;
  return `M${m[1]} ${m[2]}${extra}`;
}
// Junta em um so d quando e seguro: familia de traco (fill none) sem atributos
// por elemento. Em preenchidos, so se o SVGO ja deixou um path so.
export function compactar(x, fam, variante, juntar = !process.env.SEM_JUNTAR) {
  const traco = RAIZ[fam][variante].fill === 'none';
  const semAttrs = x.paths.every((p) => Object.keys(p.attrs).length === 0);
  if (x.outros === 0 && semAttrs && ((traco && juntar) || x.paths.length === 1)) return { d: x.paths.map((p, i) => (i === 0 ? p.d : inicioAbsoluto(p.d))).join(''), extra: x.difRaiz };
  // preenchidos com varios paths: se todos tem o mesmo attrs (ex. evenodd), sobe o attr para a raiz
  const a0 = JSON.stringify(x.paths[0]?.attrs || {});
  if (x.outros === 0 && x.paths.every((p) => JSON.stringify(p.attrs) === a0)) return { d: x.paths.map((p) => p.d), extra: { ...x.difRaiz, ...x.paths[0].attrs } };
  return { d: x.paths.map((p) => p.d), extra: x.difRaiz, porElemento: x.paths.map((p) => p.attrs), aviso: x.outros ? 'elementos nao-path' : 'attrs por elemento' };
}
export function svgDe(fam, variante, c, size = 24) {
  const raiz = { ...RAIZ[fam][variante], ...c.extra };
  const at = Object.entries(raiz).map(([k, v]) => ` ${k}="${v}"`).join('');
  const ds = Array.isArray(c.d) ? c.d : [c.d];
  const els = ds.map((d, i) => `<path d="${d}"${c.porElemento ? Object.entries(c.porElemento[i]).map(([k, v]) => ` ${k}="${v}"`).join('') : ''}/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${RAIZ[fam].vb}"${at}>${els}</svg>`;
}
const camelo = (k) => k.replace(/-(\w)/g, (m, c) => c.toUpperCase());
// Gera o modulo JS (sem JSX) com uma fabrica por (familia, variante).
export function modulo(fam, itens, prec) {
  // itens: [{ nome, slot, variante }]
  const fabs = new Set(itens.map((i) => i.variante));
  let s = `import{jsx as j}from'react/jsx-runtime';\n`;
  s += `const f=(v,r)=>(d,x)=>function({size=24,...p}){return j('svg',{width:size,height:size,viewBox:v,...r,'aria-hidden':'true',focusable:'false',...x,...p,children:Array.isArray(d)?d.map((d,k)=>j('path',{d},k)):j('path',{d})})};\n`;
  for (const v of fabs) {
    const r = Object.fromEntries(Object.entries(RAIZ[fam][v]).map(([k, val]) => [camelo(k), val]));
    s += `const ${v === 'reg' ? 'R' : 'F'}=f(${JSON.stringify(RAIZ[fam].vb)},${JSON.stringify(r)});\n`;
  }
  const avisos = [];
  for (const it of itens) {
    const file = it.file || arquivo(fam, it.slot, it.variante === 'fill');
    if (!file) { avisos.push(`${it.slot}${it.variante === 'fill' ? '(fill)' : ''} ausente`); continue; }
    const pv = typeof prec === 'function' ? prec(it.slot, it.variante) : prec;
    const [p, jn] = typeof pv === 'object' ? [pv.prec, pv.juntar] : [pv, !process.env.SEM_JUNTAR];
    const c = compactar(extrair(file, fam, it.variante, p, jn), fam, it.variante, jn);
    if (c.porElemento) avisos.push(`${it.slot}: ${c.aviso}`);
    const extra = Object.keys(c.extra).length ? ',' + JSON.stringify(Object.fromEntries(Object.entries(c.extra).map(([k, v]) => [camelo(k), v]))) : '';
    s += `export const ${it.nome}=${it.variante === 'reg' ? 'R' : 'F'}(${JSON.stringify(c.d)}${extra});\n`;
  }
  return { src: s, avisos };
}
export const gz = (b) => zlib.gzipSync(b, { level: 9 }).length;
export const br11 = (b) => zlib.brotliCompressSync(b, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }).length;
export const br4 = (b) => zlib.brotliCompressSync(b, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } }).length;
export function minificar(src, nome) {
  const f = SP + 'medir/' + nome + '.js';
  fs.mkdirSync(SP + 'medir', { recursive: true });
  fs.writeFileSync(f, src);
  const out = f.replace(/\.js$/, '.min.js');
  execFileSync('node', [ESBUILD, f, '--format=esm', '--minify', `--outfile=${out}`], { stdio: 'pipe' });
  const b = fs.readFileSync(out);
  return { min: b.length, gzip: gz(b), br11: br11(b), br4: br4(b), arquivo: out };
}
