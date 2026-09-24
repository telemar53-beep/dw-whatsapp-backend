// Agrupa os defeitos de comportamento do inventário por família (para o Apêndice C).
// Uso: node familias-defeito.cjs [familia]  → sem argumento, só as contagens
const m = require('./finalizar-apendice-a.cjs');
const SEP = /(?<!\\)\|/;
const L = m.final.filter((l) => /^\| [A-Z][A-Z0-9-]+-\d/.test(l)).map((l) => l.split(SEP).map((c) => c.trim()));
const FAMILIAS = {
  crua: /sem tradução|em inglês|chega cru|chega crua|texto técnico cru|cru em inglês/i,
  muda: /silencios|engole|o erro se perde|erro some|perde o erro|nunca aparece|sem aviso|calad/i,
  corrida: /CLASSE-01|trocou de conversa|troca de conversa|outra conversa|atrasad|em trânsito/i,
  cancelar: /Cancelar.{0,40}(curso|salvar|envio)|fecha na hora|requisição continua|segue: sucesso/i,
  perda: /rascunho perdido|perde o rascunho|apaga|some da tela|se perde\b|descartad[ao] sem aviso/i,
  backend: /src\/(api|templates|conversations|integrations|metrics|auth)\//i,
};
const alvo = process.argv[2];
for (const [nome, re] of Object.entries(FAMILIAS)) {
  const achados = L.filter((c) => c[6] && c[6] !== '—' && !c[6].startsWith('— (') && re.test(c[6]));
  if (!alvo) { console.log(nome.padEnd(10), achados.length); continue; }
  if (nome !== alvo) continue;
  for (const c of achados) console.log(`${c[1]}\t${c[2]}\t${c[6].slice(0, 260)}`);
}
