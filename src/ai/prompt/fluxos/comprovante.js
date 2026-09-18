// Comprovante — leitura de comprovante de pagamento: o cliente pode mandar
// uma imagem a qualquer momento, com ou sem a ferramenta analisar_comprovante
// disponível no turno; e o caso de cliente ainda não identificado que manda
// um comprovante. Migração de ai-orchestrator.js — âncoras (números reais,
// conferidos por grep; os do brief/plano estavam desatualizados, mesmo
// padrão avisado pelas Tasks 13-16):
// - "COMPROVANTE À NOITE" — linha 342, dentro do bloco `if (triagem.noturno.ativo)`.
// - "COMPROVANTE:" (o diurno, com a ferramenta) — linha 439, metade IF do
//   ternário `config.triageReadReceiptsDaytime && !noturno`.
// - a metade ELSE do MESMO ternário — linha 440, "Se o cliente enviou uma
//   imagem, pergunte se é um comprovante...".
// - "COMPROVANTE DE CLIENTE NÃO IDENTIFICADO" — linha 444, incondicional.
//
// ==========================================================================
// CORREÇÃO (Rodada de correção 1, coordenador, 2026-09-18) — entra() estava
// errada, e o defeito era do PLANO, não deste implementador
// ==========================================================================
// A interface original da Task 17 (despacho e plano) dava
// `comprovante.entra() = estado.ferramentas.includes('analisar_comprovante')`
// — condição ESTRUTURALMENTE OPOSTA ao original, que é um TERNÁRIO: SEMPRE
// emite um dos dois textos (linha 439 OU 440), nunca nenhum. Gateando por
// entra(), o ramo ELSE (linha 440) nunca chegava a ser migrado: como a
// leitura de comprovante de dia sai DESLIGADA por padrão
// (triageReadReceiptsDaytime, ver ai-config.repository.test.js:139), um
// cliente identificado que mandasse uma foto de dia, no padrão de fábrica,
// perdia a orientação inteira. O coordenador mediu essa regressão comparando
// o construtor antigo com o compositor novo no mesmo estado (identificado,
// de dia, sem a ferramenta) e corrigiu o plano (commit a76fe73).
//
// Condição corrigida: entra() = **true sempre**. O cliente pode mandar
// imagem a qualquer momento, independente do que as ferramentas do turno
// permitem. O que muda é o CONTEÚDO: com a ferramenta presente, manda
// analisar_comprovante — e aí sim o texto distingue noite de dia, porque só
// à noite existe desbloqueio em confiança; sem a ferramenta, manda apenas
// perguntar se é comprovante e classificar, sem confirmar pagamento — o
// ramo que estava sumindo.
// ==========================================================================
//
// ==========================================================================
// PENDÊNCIA (Rodada de correção 3, revisão formal da Task 17, 2026-09-18) —
// diferença de comportamento À NOITE entre o construtor antigo e este módulo
// ==========================================================================
// No construtor antigo (ai-orchestrator.js), o bloco "COMPROVANTE À NOITE"
// (linha 342) fica dentro do `if (triagem.noturno.ativo)` que fecha na linha
// 348. Bem mais abaixo, de forma inteiramente separada, um outro
// `linhas.push(...)` INCONDICIONAL (abre na linha 407, roda sempre,
// independente de noturno) contém o ternário `config.triageReadReceiptsDaytime
// && !noturno` (linha 438): IF (linha 439) é o "COMPROVANTE:" diurno; ELSE
// (linha 440) é "Se o cliente enviou uma imagem, pergunte se é um
// comprovante... sem confirmar pagamento."
//
// Consequência: À NOITE, `!noturno` é false, então o ternário SEMPRE cai no
// ELSE (linha 440) — e como esse push é incondicional, o texto sai JUNTO com
// o bloco COMPROVANTE À NOITE (linha 342). O construtor antigo emite os DOIS
// textos ao mesmo tempo, de noite: "chame analisar_comprovante (sem perguntar
// nada antes)" (COMPROVANTE À NOITE) E "pergunte se é um comprovante..., sem
// confirmar pagamento" (o ELSE) — na mesma resposta de sistema.
//
// Este módulo ramifica por PRESENÇA DA FERRAMENTA antes de perguntar se é
// noite (`if (!temFerramenta) ... else if (noturno) ... else ...`): com a
// ferramenta presente a única saída à noite é o ramo `noturno` (COMPROVANTE À
// NOITE) — o texto "pergunte se é comprovante..., sem confirmar pagamento"
// (que aqui só existe no ramo `!temFerramenta`) deixa de coexistir com ele.
//
// Na prática é uma MELHORA, não uma perda: aquele texto contradizia "chame
// analisar_comprovante (sem perguntar nada antes)" do próprio bloco noturno —
// o prompt antigo mandava simultaneamente perguntar primeiro E não perguntar
// nada antes. Mas essa diferença não está registrada em lugar nenhum fora
// deste comentário, e a Task 18 (comparação dos dois construtores lado a
// lado, ~260 asserts) vai esbarrar nela sem contexto: se aparecer lá, é este
// achado, não uma regressão desta tarefa.
// ==========================================================================
//
// Nomes de setor e motivo (Restrição Global do plano — "o setor da lista
// acima que cuidar de X" / "o motivo da lista acima que falar de X, se
// houver", mesmo idioma de fatos.js/financeiro.js/suporte-diagnostico.js):
// "conclua para o Financeiro" (3× no bloco noturno, 1× no diurno) virou "o
// setor da lista acima que cuidar do financeiro", sempre por extenso — sem
// pronome ("esse setor"/"esse mesmo setor") mesmo quando repetido na mesma
// frase, porque a Rodada de correção 1 da Task 16 (reativacao.js) já achou
// um pronome que virou ambíguo depois da genericização; repetir por extenso
// é o padrão mais seguro e é o que financeiro.js já faz em todo o módulo.
// "(motivo "Comprovante" se existir)" e "classifique Financeiro / Comprovante"
// — nome de SETOR e de MOTIVO juntos, como rótulo — viraram "classifique como
// o setor da lista acima que cuidar do financeiro (use o motivo da lista
// acima que falar de comprovante, se houver um)", mesma convenção já usada
// por suporte-diagnostico.js (Task 15) para a mesma situação de motivo.
//
// O "EXATAMENTE" do bloco noturno ("responda EXATAMENTE com a frase que ela
// devolver") NÃO foi removido: é a exceção legítima desta fase (frase
// pós-execução, devolvida por desbloqueio_confianca — não um texto fixo do
// prompt). Mesmo padrão já preservado por financeiro.js para
// enviar_boleto/gerar_pix.
module.exports = {
  nome: 'comprovante',
  entra() {
    return true;
  },
  linhas(estado) {
    const temFerramenta = (estado.ferramentas || []).includes('analisar_comprovante');
    const triagem = estado.triagem || {};
    const noturno = Boolean(triagem.noturno && triagem.noturno.ativo);
    const l = [
      '',
      'COMPROVANTE DE CLIENTE NÃO IDENTIFICADO: peça o CPF ou CNPJ primeiro, nunca outro dado. Sem o cadastro localizado não há o que conferir.',
    ];
    if (!temFerramenta) {
      // Sem a ferramenta na lista do turno (padrão de fábrica, de dia): não
      // dá para conferir nada — só reconhecer a imagem e classificar para a
      // equipe olhar depois.
      l.push('Se o cliente enviou uma imagem, pergunte se é um comprovante e, se for, classifique como o setor da lista acima que cuidar do financeiro (use o motivo da lista acima que falar de comprovante, se houver um), sem confirmar pagamento.');
    } else if (noturno) {
      l.push('COMPROVANTE À NOITE: se o cliente enviar uma imagem e disser (ou parecer) que é o pagamento, chame analisar_comprovante (sem perguntar nada antes). Se conferir e o contrato estiver SUSPENSO, chame desbloqueio_confianca do contrato indicado — a ferramenta já avisa o cliente antes de executar; depois responda EXATAMENTE com a frase que ela devolver e conclua para o setor da lista acima que cuidar do financeiro na mesma resposta. Se o comprovante não conferir, ou o contrato estiver ativo, não desbloqueie: agradeça, diga que a equipe confere a partir do horário de retorno e conclua para o setor da lista acima que cuidar do financeiro (use o motivo da lista acima que falar de comprovante, se houver um). Se ele pedir liberação SEM comprovante ("paguei, libera"), chame desbloqueio_confianca direto: a regra da casa decide. NUNCA diga "pagamento confirmado" nem "acesso liberado" sem a ferramenta ter devolvido liberado: true. Se a ferramenta devolver jaUtilizado: true, NÃO diga isso ao cliente nem cite outro contrato: responda o mesmo acolhimento (comprovante registrado para a equipe conferir a partir do horário de retorno) e conclua para o setor da lista acima que cuidar do financeiro.');
    } else {
      l.push('COMPROVANTE: se o cliente enviar uma imagem e disser (ou parecer) que é o pagamento, chame analisar_comprovante (sem perguntar nada antes). Qualquer que seja o resultado, NÃO confirme pagamento nem prometa liberação: agradeça, diga que a equipe confere e dá baixa, e conclua para o setor da lista acima que cuidar do financeiro (use o motivo da lista acima que falar de comprovante, se houver um). Se a ferramenta disser que o comprovante já foi utilizado, NÃO diga isso ao cliente: responda o mesmo acolhimento e conclua — a equipe trata.');
    }
    return l;
  },
};
