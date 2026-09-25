// Verificacao de ponta a ponta da entrega Tabler: SSR de cada export (React real,
// a partir dos arquivos entregues) x SVG do pacote, 16/20/24 px, e folha final.
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { SP } from './familias.mjs';
import { NOME } from './gerar-entrega.mjs';
import { arqTb } from './tabler-escolha.mjs';
const V = SP + 'var/c3-ph-adapt/frontend/ssr-tb/';
fs.mkdirSync(V, { recursive: true });
for (const f of ['IconesEntrada.js', 'IconesTrabalho.js', 'IconesConfig.js']) {
  let s = fs.readFileSync(SP + 'entrega-tabler/' + f, 'utf8');
  s = s.replace("from './IconesEntrada';", "from './IconesEntrada.js';"); // Node exige extensao; o Vite nao
  fs.writeFileSync(V + f, s);
}
fs.writeFileSync(V + 'ssr.mjs', `import fs from 'fs';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const saida = [];
for (const m of ['IconesEntrada.js', 'IconesTrabalho.js', 'IconesConfig.js']) {
  const mod = await import('./' + m);
  for (const [nome, C] of Object.entries(mod)) {
    if (typeof C !== 'function' || nome.startsWith('_')) continue;
    saida.push({ modulo: m, nome, html: renderToStaticMarkup(h(C, { size: 24 })) });
  }
}
fs.writeFileSync('ssr.json', JSON.stringify(saida));
console.log('renderizados', saida.length);
`);
console.log(execFileSync('node', ['ssr.mjs'], { cwd: V }).toString().trim());
const ssr = JSON.parse(fs.readFileSync(V + 'ssr.json', 'utf8'));
const inv = Object.fromEntries(Object.entries(NOME).map(([s, n]) => [n, s]));
inv.IconSpinner = 'carregando';
const pares = ssr.map((r) => {
  const slot = inv[r.nome];
  if (!slot) throw new Error('export sem significado: ' + r.nome);
  const file = slot === 'pix' ? SP + 'pix/package/icons/pix.svg' : arqTb(slot);
  const orig = fs.readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, '').replace(/<title>.*?<\/title>/, '');
  return { id: `${r.modulo}:${r.nome}:${slot}`, a: orig, b: r.html.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"') };
});
const html = `<!doctype html><body><pre id="out">PENDENTE</pre><script>
const pares=${JSON.stringify(pares)};
function prep(svg,N){ return svg.replace(/currentColor/g,'#000').replace(/<svg[^>]*>/,(t)=>t.replace(/\\s(width|height|class)="[^"]*"/g,'').replace('<svg','<svg width="'+N+'" height="'+N+'"')); }
async function ras(svg,N){ const u=URL.createObjectURL(new Blob([prep(svg,N)],{type:'image/svg+xml'})); const img=new Image(); await new Promise((r,j)=>{img.onload=r;img.onerror=()=>j(new Error('load'));img.src=u;}); const c=document.createElement('canvas'); c.width=N;c.height=N; const x=c.getContext('2d'); x.drawImage(img,0,0); return x.getImageData(0,0,N,N).data; }
(async()=>{ const out=[]; for(const p of pares){ const r={id:p.id}; try{ let max=0,n64=0,n32=0,tinta=0; for(const N of [16,20,24]){ const A=await ras(p.a,N),B=await ras(p.b,N); for(let i=3;i<A.length;i+=4){ const d=Math.abs(A[i]-B[i]); if(d>max)max=d; if(d>64)n64++; if(d>32)n32++; tinta+=B[i]; } } Object.assign(r,{max,n64,n32,tinta}); }catch(e){ r.erro=String(e);} out.push(r);} document.getElementById('out').textContent=JSON.stringify(out); })();
</script></body>`;
fs.writeFileSync(SP + 'verif-tabler.html', html);
const dom = execFileSync('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--virtual-time-budget=60000', '--dump-dom', 'file:///' + SP + 'verif-tabler.html'], { maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
const res = JSON.parse(dom.match(/<pre id="out">([\s\S]*?)<\/pre>/)[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
fs.writeFileSync(SP + 'entrega-tabler/verificacao.json', JSON.stringify(res, null, 1));
const ruins = res.filter((r) => r.erro || r.n64 > 0 || !r.tinta);
console.log('verificados', res.length, '| com erro/sem tinta/pixel >64:', ruins.length, ruins.map((r) => r.id + (r.erro ? ' ' + r.erro : '')).join(' '));
console.log('maiores diferencas:', res.slice().sort((a, b) => b.max - a.max).slice(0, 5).map((r) => `${r.id.split(':')[1]} max=${r.max} >32:${r.n32}`).join(' | '));
// folha final renderizada pelo proprio modulo (SSR), 20 px, fundo do produto
const tam = (svg, n) => svg.replace(/<svg[^>]*>/, (t) => t.replace(/\s(width|height|class)="[^"]*"/g, '').replace('<svg', `<svg width="${n}" height="${n}" style="display:block"`));
const vistos = new Set(); let cel = '';
for (const r of ssr) { if (vistos.has(r.nome)) continue; vistos.add(r.nome); cel += `<div class="i"><div>${tam(r.html, 20)}</div><span>${r.nome.replace(/^Icon/, '')}</span><em>${r.modulo.replace('Icones', '').replace('.js', '')}</em></div>`; }
fs.writeFileSync(SP + 'entrega-tabler/prancha/folha-final.html', `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#222a30;color:#eef2f4;font:11px "Segoe UI",sans-serif;padding:12px}h1{font-size:14px;margin:0 0 10px}.g{display:grid;grid-template-columns:repeat(9,104px);gap:6px}.i{height:58px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;background:#ffffff06;border-radius:6px}.i span{font-size:10px;color:#c5cfd6}.i em{font-size:9px;color:#8496a2;font-style:normal}</style><h1>Entrega Tabler 3.48.0 (contorno, stroke 2) + Pix (Simple Icons, CC0): ${vistos.size} exports renderizados pelo proprio modulo via React (SSR), 20 px</h1><div class="g">${cel}</div>`);
console.log('folha com', vistos.size);
