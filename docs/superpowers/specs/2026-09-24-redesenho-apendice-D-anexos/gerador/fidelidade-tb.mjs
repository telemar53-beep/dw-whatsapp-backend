// Fidelidade da escolha Tabler (e opcoes de Pix): precisao 0-3 x juntar sim/nao.
import fs from 'fs';
import { execFileSync } from 'child_process';
import { SP } from './familias.mjs';
import { TB, arqTb } from './tabler-escolha.mjs';
import { extrair, compactar, svgDe } from './vendor2.mjs';
const itens = Object.keys(TB).filter((s) => arqTb(s)).map((s) => ({ id: s, fam: 'tb', file: arqTb(s) }));
itens.push({ id: 'pix:simpleicons', fam: 'si', file: SP + 'pix/package/icons/pix.svg' });
itens.push({ id: 'pix:atual', fam: 'si', file: SP + 'pix/pix-atual-SgpIcons.svg' });
const pares = [];
for (const it of itens) for (const prec of [0, 1, 2, 3]) for (const juntar of [true, false]) {
  const orig = fs.readFileSync(it.file, 'utf8').replace(/<!--[\s\S]*?-->/g, '').replace(/<title>.*?<\/title>/, '');
  const c = compactar(extrair(it.file, it.fam, 'reg', prec, juntar), it.fam, 'reg', juntar);
  const b = svgDe(it.fam, 'reg', c);
  pares.push({ id: `${it.id}|${prec}|${juntar ? 'j' : 's'}`, a: orig, b, bytes: JSON.stringify(c.d).length, aviso: c.aviso || '' });
}
const html = `<!doctype html><body><pre id="out">PENDENTE</pre><script>
const pares=${JSON.stringify(pares)};
function prep(svg,N){ return svg.replace(/currentColor/g,'#000').replace(/<svg[^>]*>/,(t)=>t.replace(/\\s(width|height|class)="[^"]*"/g,'').replace('<svg','<svg width="'+N+'" height="'+N+'"')); }
async function ras(svg,N){ const u=URL.createObjectURL(new Blob([prep(svg,N)],{type:'image/svg+xml'})); const img=new Image(); await new Promise((r,j)=>{img.onload=r;img.onerror=()=>j(new Error('load'));img.src=u;}); const c=document.createElement('canvas'); c.width=N;c.height=N; const x=c.getContext('2d'); x.drawImage(img,0,0); URL.revokeObjectURL(u); return x.getImageData(0,0,N,N).data; }
(async()=>{ const out=[]; for(const p of pares){ const r={id:p.id,bytes:p.bytes,aviso:p.aviso}; try{ let max=0,n64=0,tinta=0; for(const N of [16,20,24]){ const A=await ras(p.a,N),B=await ras(p.b,N); for(let i=3;i<A.length;i+=4){ const d=Math.abs(A[i]-B[i]); if(d>max)max=d; if(d>64)n64++; tinta+=B[i]; } } Object.assign(r,{max,n64,tinta}); }catch(e){ r.erro=String(e);} out.push(r);} document.getElementById('out').textContent=JSON.stringify(out); })();
</script></body>`;
fs.writeFileSync(SP + 'fid-tb.html', html);
const dom = execFileSync('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--virtual-time-budget=240000', '--dump-dom', 'file:///' + SP + 'fid-tb.html'], { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'], timeout: 600000 }).toString();
const txt = dom.match(/<pre id="out">([\s\S]*?)<\/pre>/)[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&');
if (txt === 'PENDENTE') throw new Error('nao terminou');
const res = JSON.parse(txt);
fs.writeFileSync(SP + 'fid-tb.json', JSON.stringify(res));
// escolha: menor bytes entre as opcoes com 0 pixel > 64/255 (e com tinta)
const esc = {};
for (const r of res) { if (r.erro || r.n64 > 0 || !r.tinta) continue; const [id, p, j] = r.id.split('|'); if (!esc[id] || r.bytes < esc[id].bytes) esc[id] = { prec: +p, juntar: j === 'j', bytes: r.bytes, max: r.max }; }
const faltam = itens.map((i) => i.id).filter((i) => !esc[i]);
fs.writeFileSync(SP + 'prec-tb-adapt.json', JSON.stringify(esc, null, 1));
const cont = {}; for (const v of Object.values(esc)) { const k = `p${v.prec}${v.juntar ? '+junta' : '+separa'}`; cont[k] = (cont[k] || 0) + 1; }
console.log('pares', res.length, '| erros', res.filter((r) => r.erro).length, '| escolha:', JSON.stringify(cont), '| sem opcao fiel:', faltam.join(' ') || 'nenhum');
console.log('pix:', JSON.stringify({ si: esc['pix:simpleicons'], atual: esc['pix:atual'] }));
