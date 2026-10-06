const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { palavrasDe, hash, criarDetector, listaLocal, nomesEmModelosDeFrase } = require('./test-support/detector-de-dados');

// P1-3 da auditoria final (25/09/2026): nomes e telefones de pessoas reais não podem chegar a este repositório (ele é
// público). D9 (06/10/2026): a lista de hashes desses dados saiu do repositório — hash de nome se inverte por dicionário
// e de número por força bruta, então no repositório o hash funcionava como o próprio dado. A cobertura aqui é SINTÉTICA:
// o detector acha a palavra e o número de uma lista sintética, e a varredura dos fontes acha os arquivos plantados. A
// varredura com a lista real só roda onde houver o arquivo local FORA do repositório (DADOS_PROIBIDOS_ARQUIVO).
const RAIZ = path.join(__dirname, '..');
const ESTE_ARQUIVO = path.join('src', 'sem-nomes-reais.test.js');
const PASTAS = ['src', 'migrations', path.join('frontend', 'src'), 'docs', 'scripts'];
const EXTENSOES = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.json', '.md', '.css', '.html', '.sql', '.yml', '.yaml', '.txt', '.sh', '.py']);

function arquivosDaPasta(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const caminho = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' || e.name === '.git' ? [] : arquivosDaPasta(caminho);
    return [caminho];
  });
}
// Os arquivos do repositório: os versionados e os novos ainda não ignorados (git ls-files); sem git, as pastas acima.
function arquivosDe(raiz) {
  let lista = null;
  try {
    const saida = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: raiz, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    lista = saida.split('\0').filter(Boolean).map((a) => path.join(raiz, a));
  } catch (_err) {
    lista = null;
  }
  if (!lista || lista.length === 0 || path.resolve(raiz) !== path.resolve(RAIZ)) {
    lista = PASTAS.flatMap((p) => arquivosDaPasta(path.join(raiz, p)));
  }
  return lista.filter((a) => EXTENSOES.has(path.extname(a)) && fs.existsSync(a));
}
// Arquivo temporário de ferramenta (ex.: vite.config.js.timestamp-*.mjs) pode sumir entre a lista e a leitura.
const ler = (a) => {
  try {
    return fs.readFileSync(a, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return '';
    throw err;
  }
};
const varrer = (raiz, detector) => arquivosDe(raiz)
  .filter((a) => {
    const t = ler(a);
    return detector.contemNome(t) || detector.contemNumero(t);
  })
  .map((a) => path.relative(raiz, a));

test('o detector acha a palavra pelo hash, com acento, maiúscula e dentro de identificador camelCase', () => {
  expect(palavrasDe('Boa tarde, Ândrea! clienteFulano')).toEqual(new Set(['boa', 'tarde', 'andrea', 'cliente', 'fulano']));
  expect(hash('fulano')).toMatch(/^[0-9a-f]{64}$/);
});

test('o detector acha a palavra e o número que estão na lista de hashes (lista sintética)', () => {
  const { contemNome, contemNumero } = criarDetector([hash('fulano')], [hash('912345678')]);
  expect(contemNome('Boa tarde, FULANO!')).toBe(true);
  expect(contemNome('const clienteFulano = 1;')).toBe(true);
  expect(contemNome('Boa tarde, Beltrano!')).toBe(false);
  expect(contemNumero('ligue (11) 91234-5678')).toBe(true);
  expect(contemNumero('+55 11 91234 5678')).toBe(true);
  expect(contemNumero('ligue (11) 91234-0000')).toBe(false);
});

// Revisão da privacidade (06/10/2026): o número aparece em qualquer janela do trecho de dígitos (com DDI, com DDD, só o
// local) e o celular escrito sem o nono dígito também é achado.
test('o detector acha o número em qualquer forma: com DDI, só com DDD, sem o nono dígito, colado em outros dígitos', () => {
  const { contemNumero } = criarDetector([], [hash('999917777')]);
  expect(contemNumero('+55 20 99991-7777')).toBe(true);
  expect(contemNumero('(20) 99991-7777')).toBe(true);
  expect(contemNumero('+55 20 9991-7777')).toBe(true);
  expect(contemNumero('20 9991-7777')).toBe(true);
  expect(contemNumero('id 0099991777700')).toBe(true);
  expect(contemNumero('+55 20 9991-7778')).toBe(false);
});

// A guarda estrutural dos textos do prompt (sem dado nenhum): nome próprio no lugar do marcador [nome].
test('a guarda estrutural acha nome próprio em modelo de frase e aceita o marcador (sintético)', () => {
  expect(nomesEmModelosDeFrase('Boa tarde, Zebrovaldo! Quero a fatura da cliente Zebrovalda. Imagina, [nome]!')).toEqual(['Zebrovaldo', 'Zebrovalda']);
  expect(nomesEmModelosDeFrase('Bom dia, [nome]! Vou te ajudar com o boleto.')).toEqual([]);
});

test('a guarda estrutural pega sem vírgula, em maiúsculas, na despedida, no PIX, na segunda via e no "em nome de"', () => {
  expect(nomesEmModelosDeFrase('Bom dia Zebrovaldo, tudo bem?')).toEqual(['Zebrovaldo']);
  expect(nomesEmModelosDeFrase('Boa noite, ZEBROVALDO!')).toEqual(['ZEBROVALDO']);
  expect(nomesEmModelosDeFrase('Tchau, Zebrovaldo! Disponha, Zebrovalda.')).toEqual(['Zebrovaldo', 'Zebrovalda']);
  expect(nomesEmModelosDeFrase('Quero o pix do Zebrovaldo e a segunda via da Zebrovalda.')).toEqual(['Zebrovaldo', 'Zebrovalda']);
  expect(nomesEmModelosDeFrase('As faturas da titular Zebrovalda estão em nome de Zebrovaldo.')).toEqual(['Zebrovalda', 'Zebrovaldo']);
});

test('a guarda estrutural não confunde palavra comum com nome', () => {
  expect(nomesEmModelosDeFrase('Claro Vou verificar. Certo, Você pode pagar pelo boleto do MESMO contrato.')).toEqual([]);
});

test('a guarda estrutural pega o nome inteiro, com acento no meio ou no fim', () => {
  expect(nomesEmModelosDeFrase('Boa tarde, Zebrovão! Obrigado, Zebrové. Tchau, Ândreia.')).toEqual(['Zebrovão', 'Zebrové', 'Ândreia']);
});

test('a varredura dos fontes acha o dado sintético plantado e não acha nada no repositório (lista sintética)', () => {
  const sintetico = criarDetector([hash('zebrovaldo')], [hash('999917777')]);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'varredura-'));
  try {
    const plantar = (rel, conteudo) => {
      fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true });
      fs.writeFileSync(path.join(tmp, rel), conteudo);
    };
    plantar(path.join('docs', 'plano.md'), 'Exemplo: "Boa tarde, Zebrovaldo!"');
    plantar(path.join('src', 'x.test.js'), "const telefone = '+55 20 99991-7777';");
    plantar(path.join('migrations', '1_x.sql'), "-- contato: 20 9991-7777");
    plantar(path.join('frontend', 'src', 'Tela.jsx'), 'const nome = "Zebrovaldo";');
    plantar(path.join('src', 'limpo.js'), 'module.exports = 1;');
    expect(varrer(tmp, sintetico).sort()).toEqual([
      path.join('docs', 'plano.md'), path.join('frontend', 'src', 'Tela.jsx'), path.join('migrations', '1_x.sql'), path.join('src', 'x.test.js'),
    ].sort());
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  // Este próprio arquivo planta os dados sintéticos; o resto do repositório não pode ter nenhum.
  expect(varrer(RAIZ, sintetico).filter((a) => a !== ESTE_ARQUIVO)).toEqual([]);
});

test('a varredura do repositório usa os arquivos do git: entram também os da raiz, fora das pastas conhecidas', () => {
  expect(arquivosDe(RAIZ).map((a) => path.relative(RAIZ, a))).toContain('package.json');
});

// A lista local definida mas quebrada é erro (não vira pulo silencioso).
describe('a lista local (DADOS_PROIBIDOS_ARQUIVO)', () => {
  const antes = process.env.DADOS_PROIBIDOS_ARQUIVO;
  afterEach(() => {
    if (antes === undefined) delete process.env.DADOS_PROIBIDOS_ARQUIVO;
    else process.env.DADOS_PROIBIDOS_ARQUIVO = antes;
  });
  const comArquivo = (conteudo, fn) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lista-'));
    try {
      const arquivo = path.join(tmp, 'lista.json');
      fs.writeFileSync(arquivo, JSON.stringify(conteudo));
      process.env.DADOS_PROIBIDOS_ARQUIVO = arquivo;
      fn();
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  };

  test('sem a variável: null', () => {
    delete process.env.DADOS_PROIBIDOS_ARQUIVO;
    expect(listaLocal()).toBeNull();
  });
  test('a variável aponta para arquivo que não existe: erro', () => {
    process.env.DADOS_PROIBIDOS_ARQUIVO = path.join(os.tmpdir(), 'nao-existe-lista-dados.json');
    expect(() => listaLocal()).toThrow(/não existe/);
  });
  test('a variável aponta para dentro do repositório: erro', () => {
    process.env.DADOS_PROIBIDOS_ARQUIVO = path.join(RAIZ, 'package.json');
    expect(() => listaLocal()).toThrow(/dentro do repositório/);
  });
  test('lista vazia ou com entrada que não é hash: erro', () => {
    comArquivo({ palavras: [], numeros: [] }, () => expect(() => listaLocal()).toThrow(/nenhum hash/));
    comArquivo({ palavras: ['fulano'], numeros: [] }, () => expect(() => listaLocal()).toThrow(/não é hash/));
  });
  test('lista válida: as duas listas', () => {
    comArquivo({ palavras: [hash('zebrovaldo')], numeros: [] }, () => expect(listaLocal()).toEqual({ palavras: [hash('zebrovaldo')], numeros: [] }));
  });
});

// Com o arquivo local (fora do repositório), a varredura com a lista real; sem a variável, o teste é pulado e o título diz por quê.
const local = listaLocal();
const TITULO = 'nenhum nome nem telefone da lista local nos fontes, testes e documentos';
(local ? test : test.skip)(local ? TITULO : `${TITULO} (pulado: DADOS_PROIBIDOS_ARQUIVO não definida)`, () => {
  expect(varrer(RAIZ, criarDetector(local.palavras, local.numeros))).toEqual([]);
});
