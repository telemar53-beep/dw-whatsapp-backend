// Cores: leitura dos valores computados do Chrome (rgb, oklab, oklch, color()),
// conversao para OKLCH, composicao alfa, familias de matiz e contraste WCAG.

const gammaDecode = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const gammaEncode = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

function num(t, escala = 1) {
  t = t.trim();
  if (t === 'none') return 0;
  if (t.endsWith('%')) return (parseFloat(t) / 100) * escala;
  return parseFloat(t);
}

function linearSrgbParaOklab([r, g, b]) {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);
  return [
    0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  ];
}

function oklabParaLinearSrgb([L, a, b]) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const P3_PARA_SRGB = [
  [1.2249401, -0.2249404, 0],
  [-0.0420569, 1.0420571, 0],
  [-0.0196376, -0.0786361, 1.0982735],
];

// Devolve { lin: [r,g,b] linear sRGB (pode sair do gamut), alpha } ou null.
export function lerCor(str) {
  if (!str) return null;
  const s = str.trim().toLowerCase();
  if (s === 'transparent') return { lin: [0, 0, 0], alpha: 0 };
  let m;
  if ((m = s.match(/^rgba?\(([^)]+)\)$/))) {
    const partes = m[1].includes(',') ? m[1].split(',') : m[1].replace('/', ' / ').split(/\s+/).filter((x) => x && x !== '/');
    const [r, g, b] = partes.slice(0, 3).map((p) => num(p, 255) / 255);
    const alpha = partes[3] !== undefined ? num(partes[3], 1) : 1;
    return { lin: [gammaDecode(r), gammaDecode(g), gammaDecode(b)], alpha };
  }
  if ((m = s.match(/^(oklch|oklab)\(([^)]+)\)$/))) {
    const [corpo, alfaTxt] = m[2].split('/');
    const p = corpo.trim().split(/\s+/);
    const L = num(p[0], 1);
    let lab;
    if (m[1] === 'oklch') {
      const C = num(p[1], 0.4);
      const H = p[2] === 'none' ? 0 : parseFloat(p[2]);
      lab = [L, C * Math.cos((H * Math.PI) / 180), C * Math.sin((H * Math.PI) / 180)];
    } else {
      lab = [L, num(p[1], 0.4), num(p[2], 0.4)];
    }
    return { lin: oklabParaLinearSrgb(lab), alpha: alfaTxt !== undefined ? num(alfaTxt, 1) : 1, oklabOriginal: lab };
  }
  if ((m = s.match(/^color\(([a-z0-9-]+)\s+([^)]+)\)$/))) {
    const [corpo, alfaTxt] = m[2].split('/');
    const v = corpo.trim().split(/\s+/).map((x) => num(x, 1));
    const alpha = alfaTxt !== undefined ? num(alfaTxt, 1) : 1;
    if (m[1] === 'srgb') return { lin: v.map(gammaDecode), alpha };
    if (m[1] === 'srgb-linear') return { lin: v, alpha };
    if (m[1] === 'display-p3') {
      const l = v.map(gammaDecode);
      return { lin: P3_PARA_SRGB.map((row) => row[0] * l[0] + row[1] * l[1] + row[2] * l[2]), alpha };
    }
    return null;
  }
  if ((m = s.match(/^#([0-9a-f]{3,8})$/))) {
    let h = m[1];
    if (h.length <= 4) h = [...h].map((c) => c + c).join('');
    const r = parseInt(h.slice(0, 2), 16) / 255;
    const g = parseInt(h.slice(2, 4), 16) / 255;
    const b = parseInt(h.slice(4, 6), 16) / 255;
    const alpha = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return { lin: [gammaDecode(r), gammaDecode(g), gammaDecode(b)], alpha };
  }
  return null;
}

export function paraOklch(cor) {
  const [L, a, b] = cor.oklabOriginal || linearSrgbParaOklab(cor.lin);
  const C = Math.hypot(a, b);
  let H = (Math.atan2(b, a) * 180) / Math.PI;
  if (H < 0) H += 360;
  return { L: +L.toFixed(4), C: +C.toFixed(4), H: +H.toFixed(1) };
}

export function srgb8(cor) {
  return cor.lin.map((c) => Math.round(Math.max(0, Math.min(1, gammaEncode(Math.max(0, Math.min(1, c))))) * 255));
}

export function hex(cor) {
  return '#' + srgb8(cor).map((v) => v.toString(16).padStart(2, '0')).join('');
}

// Composicao "source-over" no espaco sRGB codificado (como o navegador pinta).
export function compor(frente, fundo) {
  const a = frente.alpha;
  const f = frente.lin.map((c) => gammaEncode(Math.max(0, Math.min(1, c))));
  const b = fundo.lin.map((c) => gammaEncode(Math.max(0, Math.min(1, c))));
  const out = f.map((c, i) => a * c + (1 - a) * b[i]);
  return { lin: out.map(gammaDecode), alpha: 1 };
}

export const BRANCO = { lin: [1, 1, 1], alpha: 1 };

// Fundo efetivo: lista de fundos do mais externo (html) ao mais interno.
export function fundoEfetivo(camadas) {
  let atual = BRANCO; // canvas do navegador
  for (const c of camadas) {
    const cor = typeof c === 'string' ? lerCor(c) : c;
    if (!cor || cor.alpha === 0) continue;
    atual = compor(cor, atual);
  }
  return atual;
}

export function luminancia(cor) {
  const [r, g, b] = cor.lin.map((c) => Math.max(0, Math.min(1, c)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contraste(a, b) {
  const la = luminancia(a);
  const lb = luminancia(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

// Familias por matiz OKLCH (graus). Calibradas com os tokens do produto
// (ver resultados/calibracao-familias.json).
export const FAMILIAS = [
  { chave: 'vermelho-rosa', nome: 'vermelho/rosa', de: 345, ate: 45 },
  { chave: 'laranja-cobre', nome: 'laranja/cobre', de: 45, ate: 72 },
  { chave: 'ambar-amarelo', nome: 'âmbar/amarelo', de: 72, ate: 115 },
  { chave: 'verde-agua', nome: 'verde/verde-água', de: 115, ate: 200 },
  { chave: 'azul', nome: 'azul', de: 200, ate: 268 },
  { chave: 'roxo-lilas', nome: 'roxo/lilás', de: 268, ate: 345 },
];

export function familiaDe(H) {
  for (const f of FAMILIAS) {
    if (f.de < f.ate ? H >= f.de && H < f.ate : H >= f.de || H < f.ate) return f.chave;
  }
  return null;
}

export const LIMIAR_CROMA = 0.04;

// Extrai tokens de cor de um valor composto (gradiente, sombra).
export function coresDentroDe(valor) {
  if (!valor || valor === 'none') return [];
  const re = /(rgba?\([^)]*\)|oklch\([^)]*\)|oklab\([^)]*\)|color\([^)]*\)|#[0-9a-fA-F]{3,8}\b)/g;
  return valor.match(re) || [];
}
