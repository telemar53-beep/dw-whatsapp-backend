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
//
// O julgamento é por ORAÇÃO, não pela linha inteira: as frases deste arquivo
// (ai-orchestrator.js) juntam três ou quatro orações numa linha só, e testar
// a linha inteira contra E_PROIBICAO deixa passar coisa como 'não peça CPF de
// novo, mas pergunte a data de nascimento do titular' — o "não peça" ali é
// sobre CPF, não sobre nascimento; o pedido de nascimento passaria batido.
const MENCIONA_NASCIMENTO = /nascimento/i;
const E_COMENTARIO = /^(\/\/|\*)/;
const E_PROIBICAO = /nunca peça|não peça/i;
// Fronteiras de oração: ponto final, ponto e vírgula, travessão e dois-pontos
// (as frases daqui usam muito os dois últimos) — e também vírgula, porque
// "não peça X, mas peça Y" são duas orações independentes ligadas por
// conjunção, não uma só; sem quebrar aí, a proibição da primeira oração
// "perdoa" um pedido de verdade escondido na segunda.
const FRONTEIRA_DE_ORACAO = /[.,;—:]/;

/**
 * Uma linha só é permitida se TODA oração dela que mencione "nascimento" for,
 * sozinha, um comentário (começa com // ou *) ou a própria proibição. Linha
 * sem menção nenhuma a "nascimento" é sempre permitida (o filter abaixo fica
 * vazio e .every() de array vazio é true). Função pura: só olha a string que
 * recebe, sem tocar em disco — é o que faz dela testável por si mesma, e não
 * só através da varredura de arquivos.
 */
function linhaPermitida(linha) {
  // Uma linha que É COMENTÁRIO inteira (começa com // ou *, já sem espaços à
  // esquerda) é sempre aprovada — checagem sobre a LINHA INTEIRA, antes de
  // quebrar em orações. Achado real (Task 14, 2026-09-18): quebrar primeiro
  // e só depois checar o prefixo de CADA oração deixava passar batido um
  // comentário de VERDADE quando ele tem pontuação antes de "nascimento"
  // (":", "," etc.) — a oração que sobra depois do corte já não começa mais
  // com "//", mesmo a linha inteira sendo comentário
  // (terceiros.js:39: '// Cuidado ao editar: NÃO escreva "parentesco",
  // "nascimento"...' reprovava por causa disso). A quebra em orações só faz
  // sentido para linha que NÃO é comentário — é ali que mora o risco real
  // (uma instrução pedindo a data escondida no meio de uma frase).
  const semEspacosLinha = linha.replace(/^\s+/, '');
  if (E_COMENTARIO.test(semEspacosLinha)) return true;
  return linha
    .split(FRONTEIRA_DE_ORACAO)
    .filter((oracao) => MENCIONA_NASCIMENTO.test(oracao))
    .every((oracao) => {
      const semEspacos = oracao.replace(/^\s+/, '');
      return E_COMENTARIO.test(semEspacos) || E_PROIBICAO.test(oracao);
    });
}

test('toda menção a "nascimento" em produção é comentário ou proibição, nunca um pedido', () => {
  const culpadas = [];
  for (const arquivo of arquivosJs(RAIZ)) {
    const linhas = fs.readFileSync(arquivo, 'utf8').split('\n');
    linhas.forEach((linha, indice) => {
      if (linhaPermitida(linha)) return;
      culpadas.push(`${path.relative(RAIZ, arquivo)}:${indice + 1}: ${linha.trim()}`);
    });
  }
  expect(culpadas).toEqual([]);
});

// A função de julgamento testada por si mesma, com frases fabricadas — não
// basta a varredura passar em cima do código atual (ela passaria mesmo
// quebrada, se nada em produção acionasse o defeito). Estes quatro casos
// prendem o comportamento da função, não só o estado do código hoje.
describe('linhaPermitida', () => {
  test('proibição de CPF não perdoa um pedido de nascimento na mesma linha', () => {
    expect(linhaPermitida(
      'Identidade JÁ confirmada: não peça CPF de novo, mas pergunte a data de nascimento do titular.'
    )).toBe(false);
  });

  test('a proibição de verdade é aprovada', () => {
    expect(linhaPermitida('NUNCA peça data de nascimento ao cliente')).toBe(true);
  });

  test('comentário é aprovado, qualquer que seja o conteúdo', () => {
    expect(linhaPermitida('// a data de nascimento saiu do fluxo em 2026-09-17')).toBe(true);
  });

  test('pedido disfarçado de instrução é reprovado', () => {
    expect(linhaPermitida('Pergunte a data de nascimento e chame confirmar_nascimento')).toBe(false);
  });

  // Achado real (Task 14, 2026-09-18): terceiros.js:39 é comentário de
  // verdade, mas tem ":" e "," antes de "nascimento" — a oração que sobra
  // depois do corte por pontuação não começa mais com "//", e a versão
  // antiga da função reprovava a linha inteira. A checagem de "linha inteira
  // é comentário" ANTES do split (acima) é o que resolve isto.
  test('comentário de verdade com pontuação antes de "nascimento" continua aprovado', () => {
    expect(linhaPermitida(
      '// Cuidado ao editar: NÃO escreva "parentesco", "nascimento" nem "nome da mãe".'
    )).toBe(true);
  });
});

module.exports = { linhaPermitida };
