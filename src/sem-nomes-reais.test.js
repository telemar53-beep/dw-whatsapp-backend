const fs = require('fs');
const path = require('path');
const { contemNomeReal, contemNumeroReal, palavrasDe, hash, criarDetector } = require('./test-support/dados-reais');

// P1-3 da auditoria final (25/09/2026): nomes de clientes reais de casos de produção não podem chegar a este repositório
// (ele é público). Os casos usados nos testes são de regressão SINTÉTICOS. Esta varredura compara só HASHES das palavras
// proibidas (src/test-support/dados-reais.js) — o nome nunca aparece aqui — com cada palavra dos fontes do backend, do
// frontend e dos documentos, normalizada (minúsculas, sem acento). Comportamento da IA (05/10/2026): também os
// documentos e o telefone real que aparecia em testes e planos.
const RAIZ = path.join(__dirname, '..');
const PASTAS = ['src', 'migrations', path.join('frontend', 'src'), 'docs'];
const EXTENSOES = new Set(['.js', '.jsx', '.ts', '.tsx', '.json', '.md', '.css', '.html']);

function arquivos(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const caminho = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : arquivos(caminho);
    return EXTENSOES.has(path.extname(e.name)) ? [caminho] : [];
  });
}

const todos = () => PASTAS.flatMap((pasta) => arquivos(path.join(RAIZ, pasta)));

test('nenhum nome real (cliente ou proprietário) nos fontes, testes e documentos', () => {
  const achados = todos().filter((arquivo) => contemNomeReal(fs.readFileSync(arquivo, 'utf8'))).map((a) => path.relative(RAIZ, a));
  expect(achados).toEqual([]);
});

test('nenhum telefone real nos fontes, testes e documentos', () => {
  const achados = todos().filter((arquivo) => contemNumeroReal(fs.readFileSync(arquivo, 'utf8'))).map((a) => path.relative(RAIZ, a));
  expect(achados).toEqual([]);
});

test('o detector acha a palavra pelo hash, com acento, maiúscula e dentro de identificador camelCase', () => {
  expect(palavrasDe('Boa tarde, Ândrea! clienteFulano')).toEqual(new Set(['boa', 'tarde', 'andrea', 'cliente', 'fulano']));
  expect(hash('fulano')).toMatch(/^[0-9a-f]{64}$/);
  expect(contemNomeReal('Boa tarde, Fulano!')).toBe(false);
  expect(contemNumeroReal('telefone 98 91234-5678')).toBe(false);
});

// Os hashes reais não podem ser provados aqui sem o dado; a mesma regra com uma lista SINTÉTICA prova que a palavra e o
// número listados são achados (com maiúscula, camelCase, DDI/DDD e separadores) e os outros não.
test('o detector acha a palavra e o número que estão na lista de hashes (lista sintética)', () => {
  const { contemNome, contemNumero } = criarDetector([hash('fulano')], [hash('912345678')]);
  expect(contemNome('Boa tarde, FULANO!')).toBe(true);
  expect(contemNome('const clienteFulano = 1;')).toBe(true);
  expect(contemNome('Boa tarde, Beltrano!')).toBe(false);
  expect(contemNumero('ligue (11) 91234-5678')).toBe(true);
  expect(contemNumero('+55 11 91234 5678')).toBe(true);
  expect(contemNumero('ligue (11) 91234-0000')).toBe(false);
});
