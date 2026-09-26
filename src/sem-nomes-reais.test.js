const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// P1-3 da auditoria final (25/09/2026): nomes de clientes reais de casos de produção não podem
// chegar a este repositório (ele é público). Os casos usados nos testes são de regressão SINTÉTICOS
// (a titular Fulana e a terceira Beltrana). Esta varredura guarda só HASHES das palavras proibidas —
// o nome nunca aparece aqui — e compara com cada palavra dos fontes do backend e do frontend,
// normalizada (minúsculas, sem acento).
const PROIBIDAS = new Set([
  'b23d3ffb1d24fdb42b68b0010fb3769010270f9aeb876e0d5be25ffad8d74192',
  '1b1dd21d63046036df6c5556ca557cd2cda6b97394f7af0d7809acdaf2d5a128',
]);

const RAIZ = path.join(__dirname, '..');
const PASTAS = ['src', 'migrations', path.join('frontend', 'src')];
const EXTENSOES = new Set(['.js', '.jsx', '.ts', '.tsx', '.json', '.md', '.css', '.html']);

function arquivos(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const caminho = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : arquivos(caminho);
    return EXTENSOES.has(path.extname(e.name)) ? [caminho] : [];
  });
}

const normalizar = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const hash = (t) => crypto.createHash('sha256').update(t).digest('hex');

test('nenhum nome de cliente real de caso de produção nos fontes', () => {
  const achados = [];
  for (const pasta of PASTAS) {
    for (const arquivo of arquivos(path.join(RAIZ, pasta))) {
      // Palavras (letras, com acento), e também os pedaços de identificadores camelCase/SNAKE_CASE.
      const texto = fs.readFileSync(arquivo, 'utf8').replace(/([a-zà-ÿ])([A-ZÀ-Ý])/g, '$1 $2');
      const palavras = new Set((normalizar(texto).match(/[a-z]+/g) || []));
      for (const palavra of palavras) {
        if (PROIBIDAS.has(hash(palavra))) achados.push(path.relative(RAIZ, arquivo));
      }
    }
  }
  expect(achados).toEqual([]);
});
