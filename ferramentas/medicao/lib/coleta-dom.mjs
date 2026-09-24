// Funcoes que rodam DENTRO da pagina (Runtime.evaluate). Precisam ser
// autocontidas: sao serializadas com Function.prototype.toString().

// Coleta estilos computados dos elementos VISIVEIS (caixa > 0, dentro da janela
// e nao recortados por ancestral com overflow, nem sr-only, nem opacidade 0).
export function coletarEstilos(opts) {
  const VW = window.innerWidth;
  const VH = window.innerHeight;
  const artefatos = opts.artefatos || [];
  const cache = new Map();
  const cs = (el) => {
    let v = cache.get(el);
    if (!v) {
      v = getComputedStyle(el);
      cache.set(el, v);
    }
    return v;
  };
  const alfa = (cor) => {
    if (!cor || cor === 'transparent') return 0;
    let m = cor.match(/\/\s*([\d.]+%?)\s*\)$/);
    if (m) return m[1].endsWith('%') ? parseFloat(m[1]) / 100 : parseFloat(m[1]);
    m = cor.match(/^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\s*\)$/);
    if (m) return parseFloat(m[1]);
    return 1;
  };
  const SEMANTICO = /^(chat-|worknav|conv-|dialog-|sgp|wa-|is-)/;
  const sel = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    const cls = (typeof el.className === 'string' ? el.className : el.getAttribute('class') || '').split(/\s+/).filter(Boolean);
    const sem = cls.filter((c) => SEMANTICO.test(c));
    const resto = cls.filter((c) => !SEMANTICO.test(c));
    const usar = [...sem, ...resto].slice(0, 3);
    if (usar.length) s += '.' + usar.join('.');
    if (cls.length > 3) s += '…';
    const role = el.getAttribute('role');
    if (role) s += `[role=${role}]`;
    const al = el.getAttribute('aria-label');
    if (al) s += `[aria-label="${al.slice(0, 32)}"]`;
    return s;
  };
  const contexto = (el) => {
    for (let a = el; a && a.nodeType === 1; a = a.parentElement) {
      const cls = (typeof a.className === 'string' ? a.className : a.getAttribute('class') || '').split(/\s+/);
      const c = cls.find((x) => /^(chat-|worknav|conv-|dialog-)/.test(x));
      if (c) return c;
      if (a.tagName === 'ASIDE' || a.tagName === 'NAV' || a.tagName === 'MAIN' || a.tagName === 'HEADER') return a.tagName.toLowerCase();
    }
    return 'body';
  };
  // Artefato = dentro de um elemento com o papel dado cujo nome acessivel ou
  // texto contem o texto dado (ver ARTEFATOS em lib/ganchos.mjs).
  const raizesArtefato = [];
  for (const a of artefatos) {
    for (const e of document.querySelectorAll(`[role=${a.role}]`)) {
      if (((e.getAttribute('aria-label') || '') + ' ' + e.textContent).includes(a.texto)) raizesArtefato.push(e);
    }
  }
  const ehArtefato = (el) => raizesArtefato.some((r) => r.contains(el));
  const recorte = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    const s = cs(el);
    if (s.visibility !== 'visible') return null;
    if (s.clipPath && s.clipPath.startsWith('inset(50%')) return null;
    let x0 = Math.max(0, r.left);
    let y0 = Math.max(0, r.top);
    let x1 = Math.min(VW, r.right);
    let y1 = Math.min(VH, r.bottom);
    let op = parseFloat(s.opacity);
    let fixo = s.position === 'fixed';
    for (let a = el.parentElement; a; a = a.parentElement) {
      const sa = cs(a);
      op *= parseFloat(sa.opacity);
      if (sa.clipPath && sa.clipPath.startsWith('inset(50%')) return null;
      if (!fixo && a !== document.documentElement && a !== document.body && (sa.overflowX !== 'visible' || sa.overflowY !== 'visible')) {
        const ar = a.getBoundingClientRect();
        x0 = Math.max(x0, ar.left);
        y0 = Math.max(y0, ar.top);
        x1 = Math.min(x1, ar.right);
        y1 = Math.min(y1, ar.bottom);
      }
      if (sa.position === 'fixed') fixo = true;
    }
    if (op <= 0.001) return null;
    if (x1 - x0 < 1 || y1 - y0 < 1) return null;
    return { x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0), op: +op.toFixed(3) };
  };
  const fundosAcima = (el) => {
    const out = [];
    for (let a = el; a && a.nodeType === 1; a = a.parentElement) {
      const s = cs(a);
      out.push({ bg: s.backgroundColor, img: s.backgroundImage !== 'none' ? s.backgroundImage.slice(0, 160) : null, sel: sel(a) });
    }
    return out; // do proprio elemento ate o html
  };
  const bordas = (s) => {
    const out = [];
    for (const lado of ['Top', 'Right', 'Bottom', 'Left']) {
      const w = parseFloat(s[`border${lado}Width`]);
      const st = s[`border${lado}Style`];
      const c = s[`border${lado}Color`];
      if (w > 0 && st !== 'none' && st !== 'hidden' && alfa(c) > 0) out.push({ lado: lado.toLowerCase(), cor: c, w });
    }
    return out;
  };
  const raio = (s) => {
    const v = [s.borderTopLeftRadius, s.borderTopRightRadius, s.borderBottomRightRadius, s.borderBottomLeftRadius];
    return v.every((x) => x === v[0]) ? v[0] : v.join(' ');
  };
  const temTextoProprio = (el) => {
    for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim()) return true;
    return false;
  };
  const SHAPES = new Set(['path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse', 'text', 'use']);

  const elementos = [];
  const todos = document.querySelectorAll('*');
  for (const el of todos) {
    if (['SCRIPT', 'STYLE', 'HEAD', 'META', 'LINK', 'TITLE', 'NOSCRIPT', 'BR'].includes(el.tagName)) continue;
    const rc = recorte(el);
    if (!rc) continue;
    const s = cs(el);
    const ehSvg = el instanceof SVGElement;
    const item = {
      sel: sel(el),
      ctx: contexto(el),
      tag: el.tagName.toLowerCase(),
      pseudo: null,
      artefato: ehArtefato(el),
      r: rc,
      bg: alfa(s.backgroundColor) > 0 ? s.backgroundColor : null,
      bgImg: s.backgroundImage !== 'none' ? s.backgroundImage : null,
      backdrop: s.backdropFilter && s.backdropFilter !== 'none' ? s.backdropFilter : null,
      filtro: s.filter && s.filter !== 'none' ? s.filter : null,
      sombra: s.boxShadow !== 'none' ? s.boxShadow : null,
      raio: raio(s),
      bordas: bordas(s),
      cor: !ehSvg && temTextoProprio(el) ? s.color : null,
      fill: ehSvg && SHAPES.has(el.tagName.toLowerCase()) && s.fill !== 'none' ? s.fill : null,
      stroke: ehSvg && SHAPES.has(el.tagName.toLowerCase()) && s.stroke !== 'none' ? s.stroke : null,
      svgRaiz: el.tagName.toLowerCase() === 'svg',
      img: el.tagName === 'IMG' ? (el.getAttribute('src') || '').replace(/\?.*$/, '').slice(-60) : null,
      z: s.zIndex,
      pos: s.position,
      fundos: fundosAcima(el.parentElement || el).map((f) => f.bg),
    };
    elementos.push(item);
    // Pseudo-elementos pintados (ex.: o filete de estado da lista)
    for (const pseudo of ['::before', '::after']) {
      const ps = getComputedStyle(el, pseudo);
      if (!ps.content || ps.content === 'none' || ps.content === 'normal') continue;
      const w = parseFloat(ps.width);
      const h = parseFloat(ps.height);
      if (!(w > 0 && h > 0)) continue;
      if (ps.display === 'none' || ps.visibility !== 'visible' || parseFloat(ps.opacity) === 0) continue;
      elementos.push({
        sel: item.sel + pseudo,
        ctx: item.ctx,
        tag: item.tag,
        pseudo,
        artefato: item.artefato,
        r: { ...rc, w: Math.round(w), h: Math.round(h), op: +(rc.op * parseFloat(ps.opacity)).toFixed(3) },
        bg: alfa(ps.backgroundColor) > 0 ? ps.backgroundColor : null,
        bgImg: ps.backgroundImage !== 'none' ? ps.backgroundImage : null,
        backdrop: ps.backdropFilter && ps.backdropFilter !== 'none' ? ps.backdropFilter : null,
        filtro: ps.filter && ps.filter !== 'none' ? ps.filter : null,
        sombra: ps.boxShadow !== 'none' ? ps.boxShadow : null,
        raio: raio(ps),
        bordas: bordas(ps),
        cor: null,
        fill: null,
        stroke: null,
        svgRaiz: false,
        img: null,
        z: ps.zIndex,
        pos: ps.position,
        fundos: fundosAcima(el).map((f) => f.bg),
      });
    }
  }

  // Textos visiveis e as camadas de superficie sob cada um.
  const textos = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.textContent.replace(/\s+/g, ' ').trim();
    if (!t) continue;
    const pai = n.parentElement;
    if (!pai || ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TITLE'].includes(pai.tagName)) continue;
    const rc = recorte(pai);
    if (!rc) continue;
    range.selectNodeContents(n);
    const tr = range.getBoundingClientRect();
    const ix0 = Math.max(rc.x, tr.left);
    const iy0 = Math.max(rc.y, tr.top);
    const ix1 = Math.min(rc.x + rc.w, tr.right);
    const iy1 = Math.min(rc.y + rc.h, tr.bottom);
    if (ix1 - ix0 < 1 || iy1 - iy0 < 1) continue;
    const cadeia = fundosAcima(pai);
    const camadas = cadeia.filter((f) => alfa(f.bg) > 0 || f.img);
    textos.push({
      texto: t.slice(0, 48),
      sel: sel(pai),
      ctx: contexto(pai),
      artefato: ehArtefato(pai),
      camadas: camadas.length,
      cadeia: camadas.map((f) => ({ sel: f.sel, bg: alfa(f.bg) > 0 ? f.bg : null, img: f.img })),
      cor: cs(pai).color,
      fundos: cadeia.map((f) => f.bg),
    });
  }

  // z-index em uso (todos os elementos, visiveis ou nao).
  const zs = [];
  for (const el of todos) {
    const s = cs(el);
    if (s.zIndex !== 'auto') zs.push({ z: s.zIndex, pos: s.position, sel: sel(el), visivel: Boolean(recorte(el)) });
  }

  return {
    viewport: { w: VW, h: VH },
    url: location.pathname,
    totalElementos: document.querySelectorAll('*').length,
    totalNos: (() => {
      let c = 0;
      const w = document.createTreeWalker(document, NodeFilter.SHOW_ALL);
      while (w.nextNode()) c++;
      return c;
    })(),
    elementos,
    textos,
    zs,
  };
}

// Itens da lista de conversas: todo <li> do painel da aba ativa (role=tabpanel).
// Os NUMEROS (elementos, pecas, altura, linhas) nao dependem de classe; so o
// rotulo `tipos` usa as classes atuais do ConversationListItem, e cai para
// "outro texto" quando elas mudarem (atualize tipoDaPeca junto com o redesenho).
export function coletarItens() {
  const cs = (el) => getComputedStyle(el);
  const escondido = (el) => {
    for (let a = el; a && a.nodeType === 1; a = a.parentElement) {
      const s = cs(a);
      if (s.display === 'none' || s.visibility !== 'visible') return true;
      if (s.clipPath && s.clipPath.startsWith('inset(50%')) return true;
    }
    const r = el.getBoundingClientRect();
    return r.width <= 0 || r.height <= 0;
  };
  const tipoDaPeca = (no, el) => {
    const cls = (a) => (typeof a.className === 'string' ? a.className : a.getAttribute('class') || '');
    if (no && no.nodeName === 'IMG') return 'foto (img)';
    if (no && no.nodeName.toLowerCase() === 'svg') {
      if (el.closest('button[aria-label="Finalizar sem motivo"]')) return 'ícone finalizar (svg)';
      if (el.closest('[title="Lido"],[title="Entregue"],[title="Enviado"]')) return 'tique de status (svg)';
      return 'ícone (svg)';
    }
    for (let a = el; a && !a.matches('li'); a = a.parentElement) {
      const c = cls(a);
      if (a.getAttribute('aria-label') === 'Triagem com confiança baixa') return 'alerta ⚠ (confiança baixa)';
      if (c.includes('chat-conversation-name')) return 'nome';
      if (c.includes('chat-conversation-time')) return 'hora';
      if (c.includes('chat-conversation-snippet')) return 'prévia';
      if (c.includes('chat-conversation-ai')) return 'texto IA';
      if (c.includes('chat-conversation-chip') && c.includes('is-dono')) return 'responsável';
      if (c.includes('chat-conversation-chip')) return 'ficha (cidade/setor)';
      if (c.includes('chat-conversation-figure') || c.includes('rounded-full')) return 'iniciais do avatar';
    }
    return 'outro texto';
  };
  const itens = [...document.querySelectorAll('[role=tabpanel] li')];
  return itens.map((li) => {
    const pecas = [];
    const walker = document.createTreeWalker(li, NodeFilter.SHOW_TEXT);
    const linhas = [];
    const range = document.createRange();
    let nosTexto = 0;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      nosTexto++;
      if (!n.textContent.trim()) continue;
      const pai = n.parentElement;
      if (escondido(pai)) continue;
      pecas.push({ tipo: tipoDaPeca(null, pai), texto: n.textContent.trim().slice(0, 40) });
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) if (r.width > 0 && r.height > 0) linhas.push(r.top + r.height / 2);
    }
    for (const el of li.querySelectorAll('svg, img')) {
      if (escondido(el)) continue;
      pecas.push({ tipo: tipoDaPeca(el, el) });
    }
    linhas.sort((a, b) => a - b);
    const faixas = [];
    for (const y of linhas) if (!faixas.length || y - faixas[faixas.length - 1] > 5) faixas.push(y);
    // A linha clicavel (role=button); o nome e so rotulo: aria-label (rail) ou o
    // primeiro [title] do item (o nome do contato), senao o comeco do texto.
    const linha = li.querySelector('[role=button]') || li;
    const titulo = li.querySelector('[title]');
    const nome = linha.getAttribute('aria-label') || (titulo && titulo.getAttribute('title')) || li.textContent.trim();
    return {
      nome: nome.trim().slice(0, 40),
      estado: linha.getAttribute('data-estado'),
      elementos: li.querySelectorAll('*').length + 1,
      nosTexto,
      nosTotal: li.querySelectorAll('*').length + 1 + nosTexto,
      pecas: pecas.length,
      tipos: pecas.map((p) => p.tipo),
      altura: +li.getBoundingClientRect().height.toFixed(1),
      alturaLinha: +linha.getBoundingClientRect().height.toFixed(1),
      linhasVisuais: faixas.length,
    };
  });
}

export function comoExpressao(fn, arg) {
  return `(${fn.toString()})(${JSON.stringify(arg === undefined ? {} : arg)})`;
}
