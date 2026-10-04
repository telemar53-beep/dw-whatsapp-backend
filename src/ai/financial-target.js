// PARA QUEM é a operação financeira deste turno (caso de regressão sintético, 25/09/2026: a titular Fulana, identificada,
// pediu o PIX da Beltrana com o CPF dela, e saiu o PIX da própria Fulana — o executor preenchia
// o contrato único DA FULANA quando o modelo não mandava contrato, e nada sabia que o pedido
// era de outra pessoa).
//
// Dois alvos, decididos pelo CÓDIGO, nunca pela frase do modelo:
// - principal: quem está falando (contexto.contracts);
// - terceiro: o titular de um CPF/CNPJ informado para boleto/PIX/segunda via. Os contratos
//   são os que o SGP devolveu PARA ESSE DOCUMENTO — e só eles.
//
// O alvo terceiro vale enquanto houver pedido de terceiro: o escopo persistido
// (contexto.terceiro, carregado a cada turno) ou a trava do turno (contexto.alvoTerceiro),
// que nasce na consulta do documento — antes da resposta do SGP, para um CPF não encontrado
// também travar — e sobrevive até o fim do turno, mesmo depois de o pedido ser encerrado na
// persistência. Um novo terceiro SUBSTITUI o anterior; nunca soma.
//
// A identidade de quem fala não muda em nada disto.

// As ferramentas que entregam cobrança. Com alvo terceiro, só agem em contrato do terceiro.
const FERRAMENTAS_DE_COBRANCA = ['enviar_boleto', 'gerar_pix', 'gerar_segunda_via'];

function alvoFinanceiro(contexto) {
  const c = contexto || {};
  if (c.alvoTerceiro) return { tipo: 'terceiro', contratos: [...c.alvoTerceiro.contratos] };
  if (c.terceiro && Array.isArray(c.terceiro.contratos)) {
    return { tipo: 'terceiro', contratos: c.terceiro.contratos.map((x) => x.id) };
  }
  return { tipo: 'principal', contratos: (c.contracts || []).map((x) => x.id) };
}

function ehAlvoTerceiro(contexto) {
  return alvoFinanceiro(contexto).tipo === 'terceiro';
}

/** O contrato está no alvo financeiro atual? */
function contratoNoAlvo(contexto, contratoId) {
  return alvoFinanceiro(contexto).contratos.includes(contratoId);
}

/**
 * Trava o turno no terceiro com exatamente estes contratos (vazio = documento não encontrado).
 * Um terceiro consultado agora é alvo EXPLÍCITO: resolve a ambiguidade do turno.
 */
function fixarAlvoTerceiro(contexto, contratos) {
  contexto.alvoTerceiro = { contratos: (contratos || []).map((c) => (typeof c === 'object' ? c.id : c)) };
  contexto.alvoAmbiguo = false;
}

// ---------------------------------------------------------------------------------------------
// Intenção de alvo na mensagem do cliente (decisão do dono, 25/09/2026): o alvo de TERCEIRO é
// "grudento" — depois de definido, os pedidos financeiros sem alvo explícito continuam sendo
// dele. Só muda por intenção EXPLÍCITA, lida aqui em código, por palavras inteiras (nunca
// pedaço: "da minha mãe" não é "a minha"), sem OpenAI.
const normalizar = (texto) => String(texto || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9\s]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

// F2 (30/09/2026; casos C01 e C08 do diagnóstico de 29/09): "da minha" e "do meu" contavam como
// terceiro fosse qual fosse o complemento — "o boleto da minha internet" travava a cobrança do próprio
// cliente e levava ao pedido do "CPF do titular". Quem decide é o que vem DEPOIS do possessivo.
//
// Revisão gerencial da F2 (30/09/2026):
// - voltar ao próprio exige dizer, afirmativamente, que a COBRANÇA pedida é dele: possessivo + cobrança
//   ("minha fatura", "o meu pix"), possessivo + serviço dele num pedido ("pagar o boleto da minha
//   internet"), ou o pronome elíptico ("agora o meu"). Cadastro citado ("no meu nome", "meu cpf") ou
//   serviço citado sem pedido ("minha internet caiu") é menção — não decide o alvo;
// - meio de pagamento ("com o meu cartão", "pela minha conta") e quem paga ("a minha mãe vai pagar") não
//   são o titular da cobrança: saem da leitura;
// - pessoa diferente — por relação ("minha mãe") ou sem relação ("de outra pessoa") — não continua o
//   terceiro registrado; "dela" e o nome dele continuam.
//
// Segunda revisão gerencial (30/09/2026):
// - a grafia não decide: depois de cobrança, artigo ou "é" + "da/do", uma palavra que não é o nome do
//   terceiro registrado nem complemento conhecido da cobrança (mês, vencimento, valor, segunda via…) é uma
//   referência de titularidade não resolvida — trava, com ou sem maiúscula;
// - a negação vale para a referência negada, dentro da oração: "não é da Fulana" nega o terceiro (não o
//   reafirma); "não, quero a minha fatura" é interjeição + afirmação; "quero a minha, não a dela" corrige.
// As listas são do vocabulário do serviço e da gramática (preposições, artigos, negação), não de frases de
// atendimentos.
const POSSESSIVOS = new Set(['meu', 'minha', 'meus', 'minhas']);
const OUTRO = new Set(['outro', 'outra', 'outros', 'outras']);
const ARTIGOS = new Set(['o', 'a', 'os', 'as']);
const PREPOSICOES_DE_POSSE = new Set(['da', 'do', 'das', 'dos', 'de']);
const COBRANCAS = new Set([
  'fatura', 'faturas', 'boleto', 'boletos', 'pix', 'conta', 'contas', 'cobranca', 'cobrancas', 'mensalidade',
  'mensalidades', 'segunda', 'carne', 'parcela', 'parcelas', 'debito', 'debitos',
]);
const SERVICO_PROPRIO = new Set([
  'internet', 'net', 'conexao', 'sinal', 'wifi', 'rede', 'fibra', 'linha', 'plano', 'planos', 'servico', 'acesso',
  'roteador', 'modem', 'aparelho', 'contrato', 'contratos', 'casa', 'residencia', 'endereco', 'apartamento', 'apto',
]);
// Dizer que o nome, o CPF ou o cadastro é dele não diz de quem é a cobrança pedida.
const CADASTRO = new Set(['nome', 'cpf', 'cnpj', 'documento', 'cadastro', 'titularidade', 'dados']);
// O que transforma "minha internet" em pedido da própria cobrança (e não só menção).
const PEDIDO = new Set([...COBRANCAS, 'pagar', 'pago', 'paga', 'pagamento', 'liberacao', 'liberar', 'desbloqueio', 'desbloquear', 'religacao', 'religar']);
const REFORCO = new Set(['proprio', 'propria']);
// Meio de pagamento: "com o meu cartão", "pelo app", "pela minha conta do banco".
const MEIOS = new Set(['com', 'pelo', 'pela', 'via', 'usando', 'atraves']);
const VERBOS_DE_PAGAR = new Set(['pagar', 'paga', 'pago', 'pagou', 'pagando', 'pagaria', 'pagam', 'transferir', 'transfere', 'transferiu', 'depositar', 'deposita']);
const LIGACAO = new Set(['e', 'eh', 'sera', 'foi']);
// Depois do pronome elíptico ("e a minha também?", "o meu por favor"): só palavra gramatical.
const DEPOIS_DO_PRONOME = new Set(['tambem', 'tb', 'tbm', 'e', 'ou', 'por', 'pfv', 'pf', 'favor', 'agora', 'entao', 'ai', 'aqui', 'ja', 'so', 'mesmo', 'primeiro', 'depois', 'que', 'ok', 'sim', 'hoje', 'logo']);
const NEGACAO = new Set(['nao', 'nunca', 'nem', 'jamais']);
// Começam oração nova dentro da mesma mensagem (além da pontuação): a negação de antes não passa delas.
const NOVA_ORACAO = new Set(['mas', 'porem', 'contudo', 'entretanto']);
const PARENTES = [
  'marido', 'esposo', 'esposa', 'mulher', 'mae', 'pai', 'filho', 'filha', 'irmao', 'irma', 'avo', 'tio', 'tia',
  'sogro', 'sogra', 'vizinho', 'vizinha', 'amigo', 'amiga', 'namorado', 'namorada', 'primo', 'prima', 'patrao', 'patroa',
  'cunhado', 'cunhada', 'neto', 'neta', 'sobrinho', 'sobrinha', 'genro', 'nora', 'noivo', 'noiva', 'companheiro',
  'companheira', 'inquilino', 'inquilina', 'filhos', 'filhas', 'pais', 'irmaos', 'irmas',
];
const PESSOAS = new Set([...PARENTES, 'pessoa', 'pessoas', 'cliente', 'titular']);
const ANAFORA = new Set(['dela', 'dele', 'delas', 'deles']);
const MESES = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
// Complementos da cobrança que não indicam pessoa: "o boleto do mês", "de setembro", "do vencimento".
const COMPLEMENTOS_DA_COBRANCA = new Set([
  ...MESES, 'mes', 'meses', 'vencimento', 'vencimentos', 'vencida', 'vencido', 'vencidas', 'vencidos', 'dia', 'dias',
  'semana', 'semanas', 'hoje', 'ontem', 'amanha', 'passado', 'passada', 'atual', 'anterior', 'proximo', 'proxima',
  'ultimo', 'ultima', 'valor', 'valores', 'total', 'juros', 'multa', 'atraso', 'atrasado', 'atrasada', 'novo', 'nova',
  'codigo', 'barras', 'digitavel', 'qr', 'copia', 'cola', 'referencia', 'periodo', 'competencia', 'numero', 'reais',
  'real', 'centavos', 'mesmo', 'mesma', 'costume', 'sempre', 'volta', 'agora',
]);
// Antes de "da/do" + referência, o que faz dela a dona da cobrança: a cobrança, o artigo elíptico ou "é".
const POSSE_ANTES_DA_REFERENCIA = new Set([...COBRANCAS, ...ARTIGOS, ...LIGACAO]);
// Palavras conhecidas: depois de "da/do", nenhuma delas é referência de titularidade não resolvida.
const CONHECIDAS = new Set([
  ...COBRANCAS, ...SERVICO_PROPRIO, ...CADASTRO, ...PESSOAS, ...COMPLEMENTOS_DA_COBRANCA, ...DEPOIS_DO_PRONOME,
  ...ARTIGOS, ...POSSESSIVOS, ...OUTRO, ...REFORCO, ...ANAFORA, ...PREPOSICOES_DE_POSSE,
]);

/** As palavras da mensagem, normalizadas, com a oração em que estão (pontuação e "mas" abrem outra). */
function palavrasDe(texto) {
  const palavras = [];
  let oracao = 0;
  for (const pedaco of String(texto || '').match(/[\p{L}\p{N}]+|[,.;:!?\n]/gu) || []) {
    const p = normalizar(pedaco);
    if (!p) { oracao += 1; continue; }
    const anterior = palavras.length ? palavras[palavras.length - 1] : null;
    if (NOVA_ORACAO.has(p) || (p === 'sim' && anterior && anterior.p === 'e')) oracao += 1;
    palavras.push({ p, oracao });
  }
  return palavras;
}

/** Índices dentro de um meio de pagamento ("com o cartão da minha mãe", "pela minha conta do banco"). */
function meiosDePagamento(p) {
  const fora = new Set();
  for (let i = 0; i < p.length; i += 1) {
    if (!MEIOS.has(p[i])) continue;
    let j = i;
    const marca = () => { fora.add(j); j += 1; };
    marca();
    if (ARTIGOS.has(p[j])) marca();
    if (POSSESSIVOS.has(p[j])) marca();
    if (j < p.length) marca();
    for (let segmento = 0; segmento < 2 && j < p.length; segmento += 1) {
      if (ANAFORA.has(p[j])) { marca(); break; }
      if (!PREPOSICOES_DE_POSSE.has(p[j])) break;
      marca();
      if (ARTIGOS.has(p[j])) marca();
      if (POSSESSIVOS.has(p[j])) marca();
      if (j < p.length) marca();
    }
  }
  return fora;
}

/** A pessoa em `i` (possessivo) é quem PAGA, não de quem é a cobrança? */
function quemPaga(p, i) {
  if (PREPOSICOES_DE_POSSE.has(p[i - 1])) return false; // "o boleto da minha mãe": é de quem é
  // "a minha mãe vai pagar": o verbo vem logo depois, sem cobrança no meio.
  for (let k = i + 2; k <= i + 4 && k < p.length; k += 1) {
    if (COBRANCAS.has(p[k])) break;
    if (VERBOS_DE_PAGAR.has(p[k])) return true;
  }
  // "quem vai pagar é a minha mãe".
  let k = i - 1;
  if (ARTIGOS.has(p[k])) k -= 1;
  if (!LIGACAO.has(p[k])) return false;
  for (let m = k - 1; m >= Math.max(0, k - 3); m -= 1) if (VERBOS_DE_PAGAR.has(p[m])) return true;
  return false;
}

/**
 * O que a mensagem diz sobre o alvo, em sinais separados (nunca autorização). Afirmativos:
 * - proprio: a cobrança pedida é do próprio cliente; mencao: o próprio citado sem essa afirmação;
 * - pessoaNova ("minha mãe"), outraPessoa ("de outra pessoa"), desconhecida (referência de titularidade não
 *   resolvida: "o boleto da beltrana", qualquer grafia);
 * - anafora ("dela"), nome (o do terceiro registrado);
 * - incompleto: possessivo depois de "da/do" sem complemento que decida ("manda o da minha").
 * Negados (na oração, depois de "não/nunca/nem"): negaAlvo (anáfora ou nome do terceiro), negaOutra (outra
 * referência). A própria cobrança negada vira menção.
 */
function lerAlvo(texto, nomeDoTerceiro = null, empresa = null) {
  const sinais = {
    proprio: false, mencao: false, pessoaNova: false, outraPessoa: false, desconhecida: false, anafora: false, nome: false,
    incompleto: false, negaAlvo: false, negaOutra: false,
  };
  const palavras = palavrasDe(texto);
  if (palavras.length === 0) return sinais;
  const p = palavras.map((x) => x.p);
  const negado = palavras.map((x, i) => palavras.slice(0, i).some((y) => y.oracao === x.oracao && NEGACAO.has(y.p)));
  const fora = meiosDePagamento(p);
  const dentro = (i) => !fora.has(i);
  const nome = normalizar(nomeDoTerceiro);
  const conhecidas = new Set([...CONHECIDAS, ...palavrasDe(empresa).map((x) => x.p)]);
  const pedido = p.some((w, i) => dentro(i) && PEDIDO.has(w));
  let afirmaProprio = false;
  let negaProprio = false;
  const outraReferencia = (i) => { if (negado[i]) sinais.negaOutra = true; return !negado[i]; };
  p.forEach((w, i) => {
    if (!dentro(i)) return;
    const antes = p[i - 1];
    const apontaTerceiro = ANAFORA.has(w) || (w === 'pessoa' && (antes === 'dessa' || antes === 'desta')) || (nome && w === nome);
    if (apontaTerceiro) {
      if (negado[i]) sinais.negaAlvo = true;
      else if (nome && w === nome) sinais.nome = true;
      else sinais.anafora = true;
      return;
    }
    if (POSSESSIVOS.has(w)) {
      const depois = REFORCO.has(p[i + 1]) ? p[i + 2] : p[i + 1];
      const afirma = () => { if (negado[i]) negaProprio = true; else afirmaProprio = true; };
      if (PESSOAS.has(depois)) {
        if (!quemPaga(p, i) && outraReferencia(i)) sinais.pessoaNova = true;
      } else if (COBRANCAS.has(depois)) afirma();
      else if (SERVICO_PROPRIO.has(depois)) {
        // "o boleto da minha internet", ou o elíptico "o da minha internet": é a cobrança dele.
        const cobrancaAntes = PREPOSICOES_DE_POSSE.has(antes) && (COBRANCAS.has(p[i - 2]) || ARTIGOS.has(p[i - 2]));
        if (pedido || cobrancaAntes) afirma();
        else sinais.mencao = true;
      } else if (CADASTRO.has(depois)) sinais.mencao = true;
      else if (ARTIGOS.has(antes) && (depois === undefined || DEPOIS_DO_PRONOME.has(depois))) afirma();
      else if (PREPOSICOES_DE_POSSE.has(antes)) { if (outraReferencia(i)) sinais.incompleto = true; }
      else if (ARTIGOS.has(antes)) sinais.mencao = true; // "o meu cartão foi recusado"
      return;
    }
    if (OUTRO.has(w)) {
      const depois = p[i + 1];
      if (PESSOAS.has(depois)) { if (outraReferencia(i)) sinais.outraPessoa = true; }
      else if (COBRANCAS.has(depois) || SERVICO_PROPRIO.has(depois)) {
        // "o outro boleto", "do outro contrato": não diz de quem é — com terceiro, pode ser o outro DELE.
      } else if (depois === undefined && PREPOSICOES_DE_POSSE.has(antes)) { if (outraReferencia(i)) sinais.outraPessoa = true; } // "a da outra"
      else if (PREPOSICOES_DE_POSSE.has(antes)) { if (outraReferencia(i)) sinais.incompleto = true; }
      return;
    }
    // Referência de titularidade não resolvida: "o boleto da beltrana", "o da Beltrana", "é da beltrana",
    // "o boleto atrasado do sicrano". A grafia não conta; o que conta é a posição e a palavra não ser conhecida.
    // Depois de um nome ("Fulana de Tal", "é Maria da Silva"), "de/da" é partícula de sobrenome.
    const donoAntes = POSSE_ANTES_DA_REFERENCIA.has(p[i - 2]) || COBRANCAS.has(p[i - 3]);
    if (PREPOSICOES_DE_POSSE.has(antes) && donoAntes && !conhecidas.has(w) && !/^\d+$/.test(w)) {
      if (outraReferencia(i)) sinais.desconhecida = true;
    }
  });
  if (afirmaProprio) sinais.proprio = true;
  else if (negaProprio) sinais.mencao = true;
  return sinais;
}

const pessoaDiferente = (s) => s.pessoaNova || s.outraPessoa || s.desconhecida;
const apontaOTerceiro = (s) => s.anafora || s.nome;

function intencaoDosSinais(s) {
  const outro = pessoaDiferente(s) || apontaOTerceiro(s);
  if ((s.proprio || s.mencao) && outro) return 'ambiguo';
  if (s.proprio && s.incompleto) return 'ambiguo';
  if (s.proprio) return 'proprio';
  if (outro) return 'terceiro';
  if (s.incompleto || s.mencao || s.negaAlvo || s.negaOutra) return 'indefinido';
  return null;
}

/**
 * 'proprio' | 'terceiro' | 'ambiguo' | 'indefinido' | null (sem alvo explícito).
 * `nomeDoTerceiro`: o primeiro nome do terceiro em andamento — citar o nome é apontar para ele.
 * 'indefinido': possessivo sem complemento que decida, menção ao próprio sem afirmar a cobrança, ou uma
 * referência negada — não muda alvo nenhum.
 */
function intencaoDeAlvo(texto, nomeDoTerceiro = null) {
  return intencaoDosSinais(lerAlvo(texto, nomeDoTerceiro));
}

// Por que a cobrança do turno trava. O valor de alvoAmbiguo é o motivo (verdadeiro), ou false: o
// executor escolhe a instrução por ele, e o contexto não muda de forma. Os dois últimos são do worker.
const AMBIGUIDADE = {
  DOIS_LADOS: 'dois_lados',
  OUTRA_PESSOA_SEM_DOCUMENTO: 'outra_pessoa_sem_documento',
  REFERENCIA_INCOMPLETA: 'referencia_incompleta',
  TERCEIRO_NAO_VINCULADO: 'terceiro_nao_vinculado',
  PROPRIO_NAO_AFIRMADO: 'proprio_nao_afirmado',
  ESCOPO_NAO_LIDO: 'escopo_nao_lido',
  TRANSICAO_NAO_GRAVADA: 'transicao_nao_gravada',
  // Terceira revisão: o escopo venceu com uma dúvida gravada (third-party-scope.js, CONTEXTO_SEM_AUTORIZACAO).
  TERCEIRO_EXPIRADO: 'terceiro_expirado',
};
// Dúvidas que só um documento consultado ou a volta explícita ao próprio resolvem (o prazo não resolve:
// terceira revisão da F2, 30/09/2026).
const DUVIDAS_FORTES = new Set([AMBIGUIDADE.TERCEIRO_NAO_VINCULADO, AMBIGUIDADE.OUTRA_PESSOA_SEM_DOCUMENTO, AMBIGUIDADE.TERCEIRO_EXPIRADO]);

/**
 * O alvo financeiro de UMA mensagem, a partir do escopo de terceiro (com a dúvida gravada,
 * `terceiro.alvoPendente`). Pura. Devolve também `alvoPendente`: a dúvida que deve ficar gravada (null =
 * nenhuma). É a tabela de transições do relatório da F2 (seção 12.1):
 * - sem terceiro: pessoa diferente ou "dela" trava e grava (escopo pendente sem contrato); dos dois lados,
 *   complemento incompleto ou referência negada sem afirmação travam só o turno; senão, segue o titular.
 * - com terceiro (inclusive pendente): pessoa diferente, referência desconhecida ou negação do próprio
 *   terceiro → dúvida forte; afirmação da própria cobrança (mesmo corrigindo na mesma mensagem) → volta ao
 *   titular; próprio e terceiro juntos, complemento incompleto, menção ao próprio sem afirmação ou outra
 *   referência negada → dúvida fraca, que se resolve quando ele aponta para o terceiro sem negar; o resto
 *   continua o terceiro, ou a dúvida já gravada.
 */
function resolverAlvoDoTurno({ terceiro, texto, empresa = null }) {
  const s = lerAlvo(texto, terceiro && terceiro.nome, empresa);
  const diferente = pessoaDiferente(s);
  const aponta = apontaOTerceiro(s);
  const resultado = (alvoAmbiguo, alvoPendente, t = terceiro) => ({ terceiro: t, voltarAoTitular: false, alvoAmbiguo, alvoPendente });
  if (!terceiro) {
    if (s.proprio && (diferente || aponta || s.incompleto)) return resultado(AMBIGUIDADE.DOIS_LADOS, null);
    if (diferente || aponta) return resultado(AMBIGUIDADE.OUTRA_PESSOA_SEM_DOCUMENTO, AMBIGUIDADE.OUTRA_PESSOA_SEM_DOCUMENTO);
    if (s.incompleto) return resultado(AMBIGUIDADE.REFERENCIA_INCOMPLETA, null);
    if (!s.proprio && (s.negaOutra || s.negaAlvo)) return resultado(AMBIGUIDADE.REFERENCIA_INCOMPLETA, null);
    return resultado(false, null);
  }
  const pendente = terceiro.alvoPendente || null;
  // Uma dúvida forte já gravada não é trocada: nem rebaixada por uma fraca, nem substituída por outra forte
  // (reaplicar a mesma fala tem de dar o mesmo resultado; e o pendente sem contrato continua pedindo o
  // documento da outra pessoa, não "o mesmo já informado").
  const trava = (motivo) => {
    const efetivo = DUVIDAS_FORTES.has(pendente) ? pendente : motivo;
    return resultado(efetivo, efetivo);
  };
  if (diferente) return trava(AMBIGUIDADE.TERCEIRO_NAO_VINCULADO);
  if (s.proprio && (aponta || s.incompleto)) return trava(AMBIGUIDADE.DOIS_LADOS);
  if (s.proprio) return { terceiro: null, voltarAoTitular: true, alvoAmbiguo: false, alvoPendente: null };
  if (s.negaAlvo) return trava(AMBIGUIDADE.TERCEIRO_NAO_VINCULADO);
  if (s.incompleto) return trava(AMBIGUIDADE.REFERENCIA_INCOMPLETA);
  if (s.mencao && !aponta) return trava(AMBIGUIDADE.PROPRIO_NAO_AFIRMADO);
  if (s.negaOutra && !aponta) return trava(AMBIGUIDADE.REFERENCIA_INCOMPLETA);
  if (pendente && (DUVIDAS_FORTES.has(pendente) || !aponta)) return resultado(pendente, pendente);
  return resultado(false, null);
}

/**
 * Reaplica, em ordem, as mensagens do cliente ainda não confirmadas sobre o escopo gravado (segunda revisão
 * da F2). Pura. É o que garante a recuperação entre turnos: se a gravação de uma transição falhou, a
 * mensagem continua não confirmada e volta aqui no turno seguinte. Reaplicar uma mensagem já aplicada não
 * muda o resultado. `gravar`: o que o worker precisa persistir em relação ao escopo inicial —
 * 'limpar' (volta ao titular), 'criar' (escopo pendente novo, sem contrato), 'pendencia' (a dúvida do mesmo
 * escopo mudou) ou null (nada). `alvoAmbiguo` é o da última mensagem, já sobre o estado reaplicado (sem
 * mensagem nenhuma, a dúvida gravada).
 */
function resolverAlvoDasMensagens({ terceiro, textos, empresa = null, documentos = [] }) {
  let atual = terceiro || null;
  let criado = false;
  // Sem fala nenhuma a reaplicar (a entrada do job já processada, ou um áudio sem transcrição), vale a dúvida
  // já gravada — nunca "sem dúvida" (terceira revisão da F2).
  let alvoAmbiguo = (atual && atual.alvoPendente) || false;
  for (let i = 0; i < textos.length; i += 1) {
    const texto = textos[i];
    // Persistência do alvo (03/10/2026, bloqueadores 1 e 2): `documentos[i]` diz se uma entrada ANTERIOR à do
    // job, ainda não confirmada, trouxe CPF/CNPJ válido (`algum`) e se ele é de outra pessoa (`deOutro`: difere
    // do documento conhecido de quem fala). O turno daquela entrada pode ter consultado e não conseguido gravar
    // nada — e o banco ainda teria o titular ou o terceiro anterior. Então ela vale como a consulta não
    // concluída: o pendente sem contrato, o mesmo que buscar_cliente grava antes de consultar. Só restringe:
    // troca um estado que autoriza (titular, ou terceiro localizado) pelo pendente; pendente e dúvida ficam
    // como estão. Com o titular valendo, só o documento de outra pessoa pesa; com um terceiro localizado,
    // qualquer documento (inclusive a volta pelo próprio, que pode não ter sido gravada). Quem resolve continua
    // o mesmo: a própria cobrança afirmada, ou uma consulta concluída e gravada.
    const doc = documentos[i] || null;
    const autoriza = !atual || (Array.isArray(atual.contratos) && atual.contratos.length > 0);
    if (doc && autoriza && (doc.deOutro || (doc.algum && atual))) {
      atual = { nome: null, contratos: [], pendente: true, alvoPendente: null };
      criado = true;
      alvoAmbiguo = false;
    }
    if (!texto) continue;
    const r = resolverAlvoDoTurno({ terceiro: atual, texto, empresa });
    alvoAmbiguo = r.alvoAmbiguo;
    if (r.voltarAoTitular) { atual = null; criado = false; continue; }
    const pendenteAtual = (atual && atual.alvoPendente) || null;
    if (r.alvoPendente === pendenteAtual) continue;
    if (atual) {
      const { alvoPendente, ...resto } = atual;
      atual = r.alvoPendente ? { ...resto, alvoPendente: r.alvoPendente } : resto;
    } else {
      atual = { nome: null, contratos: [], pendente: true, alvoPendente: r.alvoPendente };
      criado = true;
    }
  }
  let gravar = null;
  if (criado) gravar = 'criar';
  else if (terceiro && !atual) gravar = 'limpar';
  else if (terceiro && ((terceiro.alvoPendente || null) !== (atual.alvoPendente || null))) gravar = 'pendencia';
  return { terceiro: atual, alvoAmbiguo, gravar };
}

/** Volta ao principal (o titular da conversa foi identificado de novo pelo próprio documento). */
function liberarAlvoTerceiro(contexto) {
  if (contexto) contexto.alvoTerceiro = null;
}

// Persistência do alvo (03/10/2026): CPF ou CNPJ com os dígitos verificadores corretos. Um telefone de 11
// dígitos não vira documento por acidente (ainda pode coincidir, perto de 1 em 100: o efeito é só restritivo).
const todosIguais = (d) => /^(\d)\1+$/.test(d);
function digitoVerificador(base, pesos) {
  const soma = pesos.reduce((s, p, i) => s + Number(base[i]) * p, 0);
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}
function cpfValido(d) {
  if (d.length !== 11 || todosIguais(d)) return false;
  const dv1 = digitoVerificador(d, [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const dv2 = digitoVerificador(d, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return dv1 === Number(d[9]) && dv2 === Number(d[10]);
}
function cnpjValido(d) {
  if (d.length !== 14 || todosIguais(d)) return false;
  const dv1 = digitoVerificador(d, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const dv2 = digitoVerificador(d, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return dv1 === Number(d[12]) && dv2 === Number(d[13]);
}
/** Os CPFs e CNPJs válidos de um texto, só os dígitos. O documento nunca vai a log. */
function documentosValidos(texto) {
  const t = String(texto || '');
  // Com e sem os espaços entre grupos de dígitos: "390 533 447 05" junta; "390.533.447-05 2ª via" não pode juntar.
  const candidatos = [...(t.match(/\d(?:[\d.\-/]|\s(?=\d))*\d/g) || []), ...(t.match(/\d[\d.\-/]*\d/g) || [])];
  return [...new Set(candidatos.map((c) => c.replace(/\D/g, '')).filter((d) => cpfValido(d) || cnpjValido(d)))];
}

module.exports = {
  FERRAMENTAS_DE_COBRANCA, alvoFinanceiro, ehAlvoTerceiro, contratoNoAlvo, fixarAlvoTerceiro, liberarAlvoTerceiro,
  intencaoDeAlvo, resolverAlvoDoTurno, resolverAlvoDasMensagens, AMBIGUIDADE, documentosValidos,
};
