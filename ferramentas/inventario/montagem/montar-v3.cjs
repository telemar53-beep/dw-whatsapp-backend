// Monta o inventário v3: corpo v2 + conferência humana das 1.055 linhas
// (conferencia-v2.tsv) + os 34 estados novos da conferência (rasc-novos.md).
// Uso: node montar-v3.cjs → grava _corpo-v3.md e _v3-duplicatas.tsv
const fs = require('fs');
const path = require('path');
const aqui = (n) => path.join(__dirname, n);

const corpo = fs.readFileSync(aqui('_corpo-v2.md'), 'utf8').split(/\r?\n/);
const conf = new Map();
const tsv = fs.readFileSync(aqui('conferencia-v2.tsv'), 'utf8').split(/\r?\n/).filter(Boolean);
tsv.shift();
for (const l of tsv) {
  const [id, status, onde, texto, tipo, defeito, evidencia] = l.split('\t');
  conf.set(id, { status, onde, texto, tipo, defeito, evidencia });
}

const celula = (s) => (s || '').replace(/(?<!\\)\|/g, '\\|').trim();
const ehLinha = (l) => /^\| [A-Z][A-Z0-9-]+-\d/.test(l);
const colunas = (l) => l.split(/(?<!\\)\|/).map((c) => c.trim());

const saida = [];
const duplicatas = ['id\taponta_para\tevidencia'];
const aplicadas = { confere: 0, corrigida: 0, 'errada-no-merito': 0, duplicata: 0 };
const vistos = new Set();
for (const l of corpo) {
  if (!ehLinha(l)) { saida.push(l); continue; }
  const cols = colunas(l);
  const id = cols[1];
  vistos.add(id);
  const c = conf.get(id);
  if (!c) { saida.push(l); continue; }
  aplicadas[c.status]++;
  if (c.status === 'duplicata') {
    const citados = [...c.evidencia.matchAll(/\b([A-Z]{2,}(?:-[A-Z]+)*-\d+(?:\/\d+)?)\b/g)].map((m) => m[1]).filter((x) => x !== id);
    const alvo = (c.evidencia.match(/mesmo estado d[eoa]s? ([A-Z][A-Z0-9-]+-\d+[\w/-]*)/) || [])[1] || citados[0] || '';
    duplicatas.push(`${id}\t${alvo}\t${c.evidencia}`);
    continue;
  }
  const gatilho = cols[3];
  saida.push(`| ${id} | ${celula(c.tipo)} | ${gatilho} | ${celula(c.onde)} | ${celula(c.texto)} | ${celula(c.defeito)} |`);
}
const naoAchados = [...conf.keys()].filter((id) => !vistos.has(id));
if (naoAchados.length) throw new Error('conferidos que não estão no corpo: ' + naoAchados.join(', '));

// Estados novos: cada um entra logo depois da última linha com o mesmo prefixo
// de id (CV-SGP-, CFG-MSG-TPL-…); sem prefixo igual, depois do prefixo pai.
const chave = (id) => id.replace(/-(\d+)$/, (_, n) => '-' + n.padStart(4, '0'));
const novos = fs.readFileSync(aqui('rasc-novos.md'), 'utf8').split(/\r?\n/).filter((l) => ehLinha(l))
  .sort((x, y) => chave(colunas(x)[1]).localeCompare(chave(colunas(y)[1])));
const idsExistentes = new Set(saida.filter(ehLinha).map((l) => colunas(l)[1]));
const colocados = [];
for (const linha of novos) {
  const id = colunas(linha)[1];
  if (idsExistentes.has(id)) throw new Error('id novo já existe: ' + id);
  const partes = id.split('-').slice(0, -1);
  let pos = -1;
  for (let n = partes.length; n >= 1 && pos < 0; n--) {
    const prefixo = partes.slice(0, n).join('-') + '-';
    for (let i = saida.length - 1; i >= 0; i--) {
      if (ehLinha(saida[i]) && colunas(saida[i])[1].startsWith(prefixo)) { pos = i; break; }
    }
  }
  if (pos < 0) throw new Error('sem lugar para ' + id);
  saida.splice(pos + 1, 0, linha);
  idsExistentes.add(id);
  colocados.push(`${id} depois de ${colunas(saida[pos])[1]}`);
}

fs.writeFileSync(aqui('_corpo-v3.md'), saida.join('\n'), 'utf8');
fs.writeFileSync(aqui('_v3-duplicatas.tsv'), duplicatas.join('\n') + '\n', 'utf8');
console.log('aplicadas', aplicadas);
console.log('linhas de estado no v3:', saida.filter(ehLinha).length);
console.log('novos colocados:', colocados.length);
colocados.forEach((c) => console.log('  ', c));
console.log('duplicatas sem alvo reconhecido:', duplicatas.slice(1).filter((d) => !d.split('\t')[1]).map((d) => d.split('\t')[0]).join(', ') || 'nenhuma');
