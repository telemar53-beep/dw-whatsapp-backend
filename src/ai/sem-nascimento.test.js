const fs = require('fs');
const path = require('path');

// Regra: o sistema PODE proibir a data de nascimento (a frase de proibição no
// prompt da triagem fica, de propósito); ele nunca pode PEDI-la. O pedido em
// produção voltou duas vezes por caminhos diferentes (a flag do painel,
// depois um ramo morto do prompt) — esta é a rede permanente que impede a
// terceira. Varre o código de produção, não os testes.
const RAIZ = path.join(__dirname, '..');
const IGNORAR = /\.test\.js$|[\\/]node_modules[\\/]/;

function arquivosJs(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return arquivosJs(p);
    return e.isFile() && p.endsWith('.js') && !IGNORAR.test(p) ? [p] : [];
  });
}

// Teste A — mecanismos: os nomes concretos do que foi removido (a ferramenta,
// a coluna espelhada em código, a flag do painel). Zero ocorrências, sem
// exceção — nem em comentário: se voltou, é porque o mecanismo voltou.
const MECANISMOS = /confirmar_nascimento|dataNascimento|birthdate|birth_date|triageRequireBirthdate/i;

test('nenhum arquivo de produção menciona os mecanismos removidos de data de nascimento', () => {
  const culpados = arquivosJs(RAIZ)
    .filter((p) => MECANISMOS.test(fs.readFileSync(p, 'utf8')))
    .map((p) => path.relative(RAIZ, p));
  expect(culpados).toEqual([]);
});

// Teste B — semântica: a palavra "nascimento" sozinha pode aparecer em
// produção só em dois casos legítimos — um comentário (contexto histórico)
// ou a própria frase de proibição ("nunca peça"/"não peça"). Qualquer outra
// ocorrência é um pedido de data de nascimento escrito na frente do cliente.
const MENCIONA_NASCIMENTO = /nascimento/i;
const E_COMENTARIO = /^(\/\/|\*)/;
const E_PROIBICAO = /nunca peça|não peça/i;

test('toda menção a "nascimento" em produção é comentário ou proibição, nunca um pedido', () => {
  const culpadas = [];
  for (const arquivo of arquivosJs(RAIZ)) {
    const linhas = fs.readFileSync(arquivo, 'utf8').split('\n');
    linhas.forEach((linha, indice) => {
      if (!MENCIONA_NASCIMENTO.test(linha)) return;
      const semEspacos = linha.replace(/^\s+/, '');
      if (E_COMENTARIO.test(semEspacos) || E_PROIBICAO.test(linha)) return;
      culpadas.push(`${path.relative(RAIZ, arquivo)}:${indice + 1}: ${linha.trim()}`);
    });
  }
  expect(culpadas).toEqual([]);
});
