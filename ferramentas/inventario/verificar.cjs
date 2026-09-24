// Verificador 5 do inventário de estados. Mesmas regras do 4, mais:
//  - roda contra uma CÓPIA da base (git archive), nunca contra o disco, que
//    pode estar noutra branch;
//  - intervalo "arq:n-m" vale inteiro: janela de n−10 até m+10 (a linha
//    aponta o bloco que desenha o estado); intervalo com mais de 60 linhas é
//    marcado "intervalo-largo" para conferência, porque ali a regra fica fraca;
//  - referência que não existe no frontend é procurada no backend (src/…);
//  - cruza com a conferência humana: toda linha sem prova por script (falha,
//    sem-literal, intervalo-largo) precisa estar conferida, e toda linha nova
//    também (as da conferência de 24/09 e as minhas).
// Uso: node verificar5.cjs <corpo.md> <raiz-da-base> [conferencia.tsv ...]
//      → grava _verificacao5.tsv e imprime o resumo
const fs = require('fs');
const path = require('path');

const [corpoArq, raiz, ...conferencias] = process.argv.slice(2);
const FRONT = path.join(raiz, 'frontend', 'src');
const BACK = path.join(raiz, 'src');
const JANELA = 10;
const LARGO = 60;
const barra = (p) => p.split(path.sep).join('/');

function listar(dir, filtro) {
  const out = [];
  (function andar(d) {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n);
      if (fs.statSync(p).isDirectory()) { if (n !== 'node_modules') andar(p); }
      else if (filtro(n)) out.push(p);
    }
  })(dir);
  return out;
}
const frontais = listar(FRONT, (n) => /\.(jsx?|css)$/.test(n) && !/\.test\./.test(n));
frontais.push(path.join(raiz, 'frontend', 'index.html'));
const traseiros = listar(BACK, (n) => /\.js$/.test(n) && !/\.test\./.test(n));
const conteudo = {};
for (const p of [...frontais, ...traseiros]) conteudo[p] = fs.readFileSync(p, 'utf8').split(/\r?\n/);

function resolver(rel) {
  if (!rel) return null;
  if (rel === 'CV') rel = 'ConversationView.jsx';
  const limpo = rel.replace(/^frontend\/src\//, '');
  const tentar = (lista, r) => {
    const direto = lista.find((p) => barra(p).endsWith('/' + r));
    if (direto) return direto;
    const cands = lista.filter((p) => path.basename(p) === r.split('/').pop());
    return cands.length === 1 ? cands[0] : null;
  };
  return tentar(frontais, limpo.replace(/^src\//, '')) || tentar(traseiros, limpo.replace(/^src\//, '')) || null;
}
// ":n" sem arquivo vale para o último arquivo citado na mesma célula
// ("DashboardPage.jsx:160, :175-178" = as duas no DashboardPage); sem nenhum
// citado antes, para o arquivo da seção.
const refs = (txt, secao) => {
  let ultimo = null;
  return [...txt.matchAll(/([\w./-]+\.(?:jsx|js|html|css))?:(\d+)(?:-(\d+))?/g)].map((m) => {
    if (m[1]) ultimo = m[1];
    return {
      arq: resolver(m[1] || ultimo || secao),
      n: Number(m[2]),
      fim: m[3] ? Number(m[3]) : Number(m[2]),
      bruto: m[0],
    };
  });
};
function perto(r, alvo) {
  if (!r.arq || !conteudo[r.arq] || r.n > conteudo[r.arq].length) return false;
  return conteudo[r.arq].slice(Math.max(0, r.n - 1 - JANELA), r.fim + JANELA).join('\n').includes(alvo);
}
function literais(texto) {
  const out = [];
  for (const m of texto.matchAll(/"((?:[^"\\]|\\.)+)"/g)) {
    const bruto = m[1].replace(/\\"/g, '"');
    for (const trecho of bruto.split(/\{[^}]*\}/)) {
      const t = trecho.trim();
      if (t.length >= 6) out.push(t.slice(0, 40));
    }
  }
  return out;
}

const conferidos = new Map();
for (const c of conferencias) {
  const ls = fs.readFileSync(c, 'utf8').split(/\r?\n/).filter(Boolean);
  ls.shift();
  for (const l of ls) {
    const [id, status] = l.split('\t');
    conferidos.set(id, status);
  }
}

const corpo = fs.readFileSync(corpoArq, 'utf8').split(/\r?\n/);
let secao = null;
const res = { total: 0, ok: 0, 'ok-origem-anotada': 0, 'sem-literal': 0, ausente: 0, 'intervalo-largo': 0, falha: 0, conferidas: 0, semProvaESemConferencia: 0 };
const linhas = ['id\tsituacao\tconferencia\tdetalhe'];
const ids = new Set();
const repetidos = [];
for (const l of corpo) {
  const sec = l.match(/^#{3,4} .*?`([^`]+\.(?:jsx|js|html|css))`/);
  if (sec) { secao = sec[1]; continue; }
  if (!/^\| [A-Z][A-Z0-9-]+-\d/.test(l)) continue;
  res.total++;
  const cols = l.split(/(?<!\\)\|/).map((c) => c.trim());
  const id = cols[1];
  if (ids.has(id)) repetidos.push(id);
  ids.add(id);
  const onde = cols[4] || '';
  const texto = cols[5] || '';
  const [principal, ...secundarias] = refs(onde.replace(/\(texto em [^)]*\)/g, ''), secao);
  const anotadas = [...onde.matchAll(/\(texto em ([^)]*)\)/g)].flatMap((m) => refs(m[1], secao));
  let situacao;
  let detalhe = '';
  const valida = principal && principal.arq && principal.n <= conteudo[principal.arq].length && principal.fim <= conteudo[principal.arq].length;
  if (!valida) {
    situacao = 'falha';
    detalhe = `referência principal inválida: ${onde}`;
  } else if (/^AUSENTE/.test(texto)) {
    situacao = 'ausente';
  } else {
    const lits = literais(texto);
    const todas = [principal, ...secundarias];
    if (!lits.length) {
      situacao = 'sem-literal';
    } else {
      const faltando = lits.filter((a) => !todas.some((r) => perto(r, a)) && !anotadas.some((r) => perto(r, a)));
      if (faltando.length) {
        situacao = 'falha';
        detalhe = `literal fora da janela: ${faltando.map((f) => `"${f}"`).join(' · ')}`;
      } else {
        situacao = lits.every((a) => !todas.some((r) => perto(r, a))) ? 'ok-origem-anotada' : 'ok';
        const largo = [...todas, ...anotadas].find((r) => r.fim - r.n > LARGO);
        if (largo) { situacao = 'intervalo-largo'; detalhe = largo.bruto; }
      }
    }
  }
  res[situacao]++;
  const conf = conferidos.get(id) || '';
  if (conf) res.conferidas++;
  // Precisa de olho humano: tudo que o script não prova. "ausente" com linha
  // válida só prova que o arquivo e a linha existem — também precisa.
  const precisa = ['falha', 'sem-literal', 'intervalo-largo', 'ausente'].includes(situacao);
  if (precisa && !conf) res.semProvaESemConferencia++;
  linhas.push(`${id}\t${situacao}\t${conf}\t${detalhe}`);
}
fs.writeFileSync(path.join(__dirname, '_verificacao5.tsv'), linhas.join('\n') + '\n');
console.log(JSON.stringify(res, null, 1));
if (repetidos.length) console.log('IDS REPETIDOS:', repetidos.join(', '));
