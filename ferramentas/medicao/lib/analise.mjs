// Analises feitas no Node sobre o que a pagina devolveu.
import { lerCor, paraOklch, hex, familiaDe, FAMILIAS, LIMIAR_CROMA, coresDentroDe, fundoEfetivo, compor } from './cores.mjs';
import { decodePng, pixelAt } from './png.mjs';

function topN(mapa, n = 15, extra = () => ({})) {
  return [...mapa.entries()]
    .sort((a, b) => b[1].n - a[1].n)
    .slice(0, n)
    .map(([valor, v]) => ({ valor, n: v.n, exemplos: [...v.ex].slice(0, 3), ...extra(valor) }));
}
function contar(mapa, chave, exemplo) {
  if (!mapa.has(chave)) mapa.set(chave, { n: 0, ex: new Set() });
  const v = mapa.get(chave);
  v.n++;
  if (v.ex.size < 3) v.ex.add(exemplo);
}
const descreverCor = (valor) => {
  const c = lerCor(valor);
  if (!c) return { hex: null };
  const o = paraOklch(c);
  return { hex: hex(c), alpha: +c.alpha.toFixed(3), oklch: o, familia: o.C > LIMIAR_CROMA ? familiaDe(o.H) : 'acromático' };
};

export function mediana(v) {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
export function resumo(v) {
  return { n: v.length, min: v.length ? Math.min(...v) : null, mediana: mediana(v), max: v.length ? Math.max(...v) : null };
}

// Camadas de box-shadow separadas por virgula de nivel zero (as de rgba() ficam).
function camadasDeSombra(v) {
  const out = [];
  let prof = 0;
  let atual = '';
  for (const ch of v) {
    if (ch === '(') prof++;
    if (ch === ')') prof--;
    if (ch === ',' && prof === 0) {
      out.push(atual.trim());
      atual = '';
    } else atual += ch;
  }
  if (atual.trim()) out.push(atual.trim());
  return out;
}
// O Tailwind v4 compoe ring + shadow: sobram camadas "rgba(0,0,0,0) 0 0 0 0".
// Camada de cor transparente nao pinta nada e sai da conta.
export function normalizarSombra(v) {
  if (!v || v === 'none') return null;
  const vivas = camadasDeSombra(v).filter((c) => {
    const cor = coresDentroDe(c)[0];
    const lida = cor ? lerCor(cor) : null;
    return !lida || lida.alpha > 0;
  });
  return vivas.length ? vivas.join(', ') : null;
}
// rounded-full do Tailwind v4 = calc(infinity * 1px) -> 3.35544e+07px.
export function normalizarRaio(v) {
  return v.replace(/[\d.]+e\+\d+px/g, '∞(rounded-full)');
}

// ---------------- M2: superficies ----------------
export function analisarSuperficies(coleta, { semArtefatos = false } = {}) {
  const els = coleta.elementos.filter((e) => !(semArtefatos && e.artefato));
  const bg = new Map();
  const bgImg = new Map();
  const sombras = new Map();
  const raios = new Map();
  const bordas = new Map();
  const backdrop = [];
  const filtros = new Map();
  let comSuperficie = 0;
  for (const e of els) {
    const ex = `${e.sel} @${e.ctx}`;
    if (e.bg) contar(bg, e.bg, ex);
    if (e.bgImg) contar(bgImg, e.bgImg, ex);
    if (e.bg || e.bgImg) comSuperficie++;
    const sombra = normalizarSombra(e.sombra);
    if (sombra) contar(sombras, sombra, ex);
    if (e.raio && !/^0px( 0px)*$/.test(e.raio)) contar(raios, normalizarRaio(e.raio), ex);
    for (const b of e.bordas) contar(bordas, b.cor, `${ex} (${b.lado} ${b.w}px)`);
    if (e.backdrop) backdrop.push({ sel: e.sel, ctx: e.ctx, valor: e.backdrop, area: e.r.w * e.r.h });
    if (e.filtro) contar(filtros, e.filtro, ex);
  }
  return {
    elementosVisiveis: els.filter((e) => !e.pseudo).length,
    pseudoElementosVisiveis: els.filter((e) => e.pseudo).length,
    comSuperficie,
    backgroundColor: { distintos: bg.size, top15: topN(bg, 15, descreverCor) },
    backgroundImage: { distintos: bgImg.size, top15: topN(bgImg, 15) },
    backdropFilter: { elementos: backdrop.length, distintos: new Set(backdrop.map((b) => b.valor)).size, lista: backdrop },
    boxShadow: { distintos: sombras.size, top15: topN(sombras) },
    borderRadius: { distintos: raios.size, top15: topN(raios) },
    borderColor: { distintos: bordas.size, top15: topN(bordas, 15, descreverCor) },
    filter: { distintos: filtros.size, top15: topN(filtros) },
  };
}

// ---------------- M3: cores de destaque ----------------
function amostras(coleta, { semArtefatos, estendido }) {
  const out = [];
  for (const e of coleta.elementos) {
    if (semArtefatos && e.artefato) continue;
    const base = { sel: e.sel, ctx: e.ctx, pseudo: e.pseudo, artefato: e.artefato };
    const fundoDoProprio = e.bg ? [e.bg, ...e.fundos] : e.fundos;
    if (e.cor) out.push({ ...base, prop: 'color', valor: e.cor, sob: fundoDoProprio });
    if (e.bg) out.push({ ...base, prop: 'background-color', valor: e.bg, sob: e.fundos });
    for (const b of e.bordas) out.push({ ...base, prop: `border-${b.lado}-color`, valor: b.cor, sob: fundoDoProprio });
    if (e.fill) out.push({ ...base, prop: 'fill', valor: e.fill, sob: e.fundos });
    if (e.stroke) out.push({ ...base, prop: 'stroke', valor: e.stroke, sob: e.fundos });
    if (estendido) {
      for (const c of coresDentroDe(e.bgImg)) out.push({ ...base, prop: 'background-image (parada)', valor: c, sob: e.fundos });
      for (const c of coresDentroDe(e.sombra)) out.push({ ...base, prop: 'box-shadow', valor: c, sob: e.fundos });
    }
  }
  return out;
}

export function analisarCores(coleta, { semArtefatos = false, estendido = false } = {}) {
  const lista = amostras(coleta, { semArtefatos, estendido });
  const naoLidas = new Set();
  const fam = Object.fromEntries(FAMILIAS.map((f) => [f.chave, { nome: f.nome, amostras: 0, valores: new Map(), elementos: new Map() }]));
  const famEfetiva = Object.fromEntries(FAMILIAS.map((f) => [f.chave, { nome: f.nome, amostras: 0, elementos: new Map() }]));
  let cromaticas = 0;
  let acromaticas = 0;
  for (const a of lista) {
    const c = lerCor(a.valor);
    if (!c) {
      naoLidas.add(a.valor);
      continue;
    }
    if (c.alpha === 0) continue;
    const o = paraOklch(c);
    // Cor como declarada (alfa ignorado na classificacao, reportado a parte).
    if (o.C > LIMIAR_CROMA) {
      cromaticas++;
      const f = familiaDe(o.H);
      const alvo = fam[f];
      alvo.amostras++;
      const chave = `${a.valor}`;
      if (!alvo.valores.has(chave)) alvo.valores.set(chave, { n: 0, hex: hex(c), alpha: +c.alpha.toFixed(3), oklch: o, props: new Set() });
      const v = alvo.valores.get(chave);
      v.n++;
      v.props.add(a.prop);
      const ek = `${a.sel} @${a.ctx}`;
      if (!alvo.elementos.has(ek)) alvo.elementos.set(ek, new Set());
      alvo.elementos.get(ek).add(`${a.prop}: ${hex(c)}${c.alpha < 1 ? ` α${c.alpha.toFixed(2)}` : ''}`);
    } else acromaticas++;
    // Cor efetiva: composta sobre o fundo real embaixo dela.
    const baixo = fundoEfetivo([...(a.sob || [])].reverse());
    const ef = c.alpha < 1 ? compor(c, baixo) : c;
    const oe = paraOklch(ef);
    if (oe.C > LIMIAR_CROMA) {
      const f = familiaDe(oe.H);
      famEfetiva[f].amostras++;
      const ek = `${a.sel} @${a.ctx}`;
      if (!famEfetiva[f].elementos.has(ek)) famEfetiva[f].elementos.set(ek, new Set());
      famEfetiva[f].elementos.get(ek).add(`${a.prop}: ${hex(ef)} (efetiva)`);
    }
  }
  const fechar = (obj, comValores) =>
    Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [
        k,
        {
          nome: v.nome,
          amostras: v.amostras,
          elementosDistintos: v.elementos.size,
          ...(comValores
            ? {
                valoresDistintos: v.valores.size,
                valores: [...v.valores.entries()]
                  .sort((a, b) => b[1].n - a[1].n)
                  .map(([valor, x]) => ({ valor, hex: x.hex, alpha: x.alpha, oklch: x.oklch, n: x.n, props: [...x.props] })),
              }
            : {}),
          exemplos: [...v.elementos.entries()].slice(0, 8).map(([el, props]) => ({ elemento: el, cores: [...props] })),
        },
      ])
    );
  const familias = fechar(fam, true);
  const efetivas = fechar(famEfetiva, false);
  const visiveis = Object.entries(familias).filter(([, v]) => v.amostras > 0).map(([k]) => k);
  const visiveisEfetivas = Object.entries(efetivas).filter(([, v]) => v.amostras > 0).map(([k]) => k);
  return {
    amostras: lista.length,
    cromaticas,
    acromaticas,
    limiarCroma: LIMIAR_CROMA,
    familiasVisiveis: visiveis.length,
    quais: visiveis,
    familiasVisiveisEfetivas: visiveisEfetivas.length,
    quaisEfetivas: visiveisEfetivas,
    familias,
    efetivas,
    formatosNaoLidos: [...naoLidas],
  };
}

// Cores dominantes das <img> visiveis, lidas dos pixels do print (extra ao M3).
export function coresDasImagens(coleta, pngBuf) {
  const img = decodePng(pngBuf);
  const out = [];
  for (const e of coleta.elementos) {
    if (!e.img) continue;
    const cont = new Map();
    let total = 0;
    for (let y = e.r.y; y < e.r.y + e.r.h; y += 2)
      for (let x = e.r.x; x < e.r.x + e.r.w; x += 2) {
        const [r, g, b] = pixelAt(img, Math.min(x, img.width - 1), Math.min(y, img.height - 1));
        const o = paraOklch(lerCor(`rgb(${r}, ${g}, ${b})`));
        total++;
        if (o.C > LIMIAR_CROMA) {
          const f = familiaDe(o.H);
          cont.set(f, (cont.get(f) || 0) + 1);
        }
      }
    out.push({
      sel: e.sel,
      src: e.img,
      caixa: e.r,
      familias: Object.fromEntries([...cont.entries()].filter(([, n]) => n / total >= 0.02).map(([f, n]) => [f, +(n / total).toFixed(3)])),
    });
  }
  return out;
}

// ---------------- M5: profundidade ----------------
export function analisarProfundidade(coleta, { semArtefatos = false } = {}) {
  const ts = coleta.textos.filter((t) => !(semArtefatos && t.artefato));
  const hist = {};
  for (const t of ts) hist[t.camadas] = (hist[t.camadas] || 0) + 1;
  const max = ts.reduce((m, t) => Math.max(m, t.camadas), 0);
  const piores = ts.filter((t) => t.camadas === max);
  const zmap = new Map();
  for (const z of coleta.zs) {
    const k = z.z;
    if (!zmap.has(k)) zmap.set(k, { z: k, n: 0, visiveis: 0, exemplos: [] });
    const v = zmap.get(k);
    v.n++;
    if (z.visivel) v.visiveis++;
    if (v.exemplos.length < 4) v.exemplos.push(`${z.sel} (${z.pos})`);
  }
  return {
    textosVisiveis: ts.length,
    distribuicao: hist,
    media: +(ts.reduce((s, t) => s + t.camadas, 0) / (ts.length || 1)).toFixed(2),
    mediana: mediana(ts.map((t) => t.camadas)),
    maximo: max,
    textosNoMaximo: piores.length,
    piorCaso: piores.slice(0, 3).map((t) => ({ texto: t.texto, elemento: t.sel, ctx: t.ctx, camadas: t.cadeia })),
    zIndex: [...zmap.values()].sort((a, b) => Number(a.z) - Number(b.z)),
  };
}

// ---------------- M4: itens da lista ----------------
export function analisarItens(itens) {
  const tipos = {};
  for (const it of itens) for (const t of it.tipos) tipos[t] = (tipos[t] || 0) + 1;
  return {
    itens: itens.length,
    elementosDOM: resumo(itens.map((i) => i.elementos)),
    nosDOMcomTexto: resumo(itens.map((i) => i.nosTotal)),
    pecasVisiveis: resumo(itens.map((i) => i.pecas)),
    alturaPx: resumo(itens.map((i) => i.altura)),
    linhasVisuais: resumo(itens.map((i) => i.linhasVisuais)),
    tiposDePeca: Object.fromEntries(Object.entries(tipos).sort((a, b) => b[1] - a[1])),
    porItem: itens,
  };
}
