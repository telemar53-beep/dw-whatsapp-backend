// Gera o Apêndice A do spec a partir do inventário v3 verificado.
//  - move os estados da seção "acrescentados" para a seção da tela deles;
//  - marca a etapa dona de cada seção (e subseção, onde a seção se divide);
//  - resolve as duplicatas até a linha que sobrevive;
//  - calcula os números do cabeçalho a partir do próprio corpo.
// Uso: node finalizar-apendice-a.cjs <saida.md>
const fs = require('fs');
const path = require('path');
const aqui = (n) => path.join(__dirname, n);
const SEP = /(?<!\\)\|/;
const ehLinha = (l) => /^\| [A-Z][A-Z0-9-]+-\d/.test(l);
const idDe = (l) => l.split(SEP)[1].trim();
const chave = (id) => id.replace(/-(\d+)$/, (_, n) => '-' + n.padStart(4, '0'));

let corpo = fs.readFileSync(aqui('_corpo-v3.md'), 'utf8').split(/\r?\n/);

// 1. Estados acrescentados → seção da tela.
const inicio = corpo.findIndex((l) => l.startsWith('## Estados acrescentados'));
const acrescentados = corpo.slice(inicio).filter(ehLinha).sort((a, b) => chave(idDe(a)).localeCompare(chave(idDe(b))));
corpo = corpo.slice(0, inicio);
while (corpo.length && corpo[corpo.length - 1].trim() === '') corpo.pop();
const movidos = [];
for (const linha of acrescentados) {
  const partes = idDe(linha).split('-').slice(0, -1);
  let pos = -1;
  for (let n = partes.length; n >= 1 && pos < 0; n--) {
    const prefixo = partes.slice(0, n).join('-') + '-';
    for (let i = corpo.length - 1; i >= 0; i--) if (ehLinha(corpo[i]) && idDe(corpo[i]).startsWith(prefixo)) { pos = i; break; }
  }
  if (pos < 0) throw new Error('sem lugar para ' + idDe(linha));
  corpo.splice(pos + 1, 0, linha);
  movidos.push(`${idDe(linha)} → depois de ${idDe(corpo[pos])}`);
}

// 2. Etapa dona.
const DONA_SECAO = {
  '## 2.': 'E2 (moldura e menu da mesa; o carregamento sob demanda do popup "Encerrados" é da E3)',
  '## 3.': 'E2',
  '## 4.': 'E5',
  '## 5.': 'E5',
  '## 6.': 'E6',
  '## 7.': 'E6',
  '## 8.': 'E2 (o popup abre do menu da conta, que é parte da moldura da mesa)',
  '## Apêndice — Primitivos': 'E2 (a base muda na E2; cada área reestrutura os seus usos)',
};
const DONA_SUBSECAO = {
  '### Rede de segurança do index.html': 'E3',
  '### ErrorBoundary da raiz': 'E7',
  '### Carregamento sob demanda de rotas': 'E3',
  '### Rota protegida / sem acesso': 'E7',
  '### Tela de entrada': 'E7',
};
const final = [];
for (const l of corpo) {
  final.push(l);
  const secao = Object.keys(DONA_SECAO).find((k) => l.startsWith(k));
  if (secao) final.push('', `**Etapa dona:** ${DONA_SECAO[secao]}`);
  if (l.startsWith('## 1.')) final.push('', '**Etapa dona:** por subseção (abaixo).');
  const sub = Object.keys(DONA_SUBSECAO).find((k) => l.startsWith(k));
  if (sub) final.push('', `**Etapa dona:** ${DONA_SUBSECAO[sub]}`);
}

// 3. Números.
const linhas = final.filter(ehLinha);
const cols = linhas.map((l) => l.split(SEP).map((c) => c.trim()));
const porTipo = {};
for (const c of cols) porTipo[c[2]] = (porTipo[c[2]] || 0) + 1;
const comDefeito = cols.filter((c) => c[6] && c[6] !== '—' && !c[6].startsWith('—'));
const suspeitas = comDefeito.filter((c) => /\(suspeita/.test(c[6]));
const ausentes = cols.filter((c) => /^AUSENTE/.test(c[5]));
const porSecao = [];
let atual = null;
for (const l of final) {
  if (l.startsWith('## ')) { atual = { nome: l.replace(/^## /, ''), n: 0 }; porSecao.push(atual); }
  if (ehLinha(l) && atual) atual.n++;
}

// 4. Duplicatas → linha que sobrevive.
const dup = new Map();
for (const l of fs.readFileSync(aqui('_v3-duplicatas.tsv'), 'utf8').split(/\r?\n/).slice(1).filter(Boolean)) {
  const [id, alvo] = l.split('\t');
  dup.set(id, alvo);
}
const vivos = new Set(cols.map((c) => c[1]));
const resolver = (id) => {
  let x = dup.get(id);
  const vistos = new Set();
  while (x && !vivos.has(x) && dup.has(x) && !vistos.has(x)) { vistos.add(x); x = dup.get(x); }
  return x;
};
const semAlvoVivo = [...dup.keys()].filter((id) => !vivos.has(resolver(id)));
if (semAlvoVivo.length) throw new Error('duplicata sem linha viva: ' + semAlvoVivo.join(', '));

module.exports = { final, movidos, porTipo, comDefeito, suspeitas, ausentes, porSecao, dup, resolver, total: linhas.length };

if (require.main === module) {
  console.log('estados:', linhas.length, '| com defeito:', comDefeito.length, '| suspeitas:', suspeitas.length, '| AUSENTE:', ausentes.length);
  console.log('por seção:', porSecao.map((s) => `${s.nome.slice(0, 22)}=${s.n}`).join(' · '));
  console.log('tipos:', Object.keys(porTipo).length);
  console.log('movidos:', movidos.length);
  console.log('duplicatas resolvidas:', [...dup.keys()].map((id) => `${id}→${resolver(id)}`).join(' '));
}
