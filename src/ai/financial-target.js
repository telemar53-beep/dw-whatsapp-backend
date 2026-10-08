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
// Pedido por endereço (06/10/2026, noite; autorizado pelo proprietário). A rua só é lida quando a MENSAGEM INTEIRA é o
// pedido simples da cobrança de um endereço dele: "manda o pix da Rua de Teste", "quero o boleto da Avenida de Teste, 30, por
// favor" — saudação, pedido, cobrança e artigo antes; "da/do" + a rua de um contrato JÁ CONFIRMADO do cliente
// (identidade.contracts, passados pelo worker); o número do cadastro e a cortesia depois. Com qualquer outra palavra na
// mensagem (pessoa, "dela", "não", "menos", "outro", um complemento, um número que não é o do cadastro, uma rua que não é de
// contrato dele), a rua não é lida e vale a leitura de sempre, inteira. As listas abaixo só RESTRINGEM quando a rua é lida:
// nenhuma identifica alvo nem autoriza cobrança. Três versões anteriores foram reprovadas na revisão.
// Dúvida de endereço (07/10/2026, autorizada pelo proprietário): rua que não é de contrato dele, número que não é o do
// cadastro, logradouro sem o tipo citado sem número e mais de um contrato possível não escolhem nada nem viram outra pessoa:
// viram a dúvida de endereço, gravada entre turnos, até o contrato ser identificado ou o alvo esclarecido.
const MARCAS_DE_NUMERO = new Set(['n', 'no', 'numero', 'num', 'casa']);
// O tipo do logradouro. A rua do cadastro SEM o tipo ("FULANO DE TESTE, 523") não se distingue de um nome de pessoa: só
// escolhe o contrato com o número junto; sem o número, é dúvida de endereço. E só o tipo ("Rua", "Avenida"; mesmo que nenhum
// contrato dele o tenha) faz de "Rua Nova" ou "Avenida Getulio Vargas" uma rua que não é dele.
const TIPOS_DE_LOGRADOURO = new Set([
  'rua', 'r', 'avenida', 'av', 'travessa', 'tv', 'estrada', 'rodovia', 'rod', 'alameda', 'praca', 'largo', 'beco', 'viela',
  'servidao', 'passagem', 'ladeira',
]);
const SAUDACAO_E_PEDIDO = new Set([
  'oi', 'ola', 'bom', 'boa', 'dia', 'tarde', 'noite', 'manda', 'mande', 'mandar', 'envia', 'envie', 'enviar', 'gera', 'gere',
  'gerar', 'emite', 'emita', 'emitir', 'passa', 'passe', 'quero', 'queria', 'preciso', 'precisava', 'gostaria', 'pode',
  'poderia', 'consegue', 'me', 'mim', 'agora', 'via', 'pagar',
]);
const CORTESIA = new Set(['por', 'favor', 'pf', 'pfv', 'pfvr', 'obrigado', 'obrigada', 'obg', 'grato', 'grata']);
const ANTES_DA_RUA = new Set([...SAUDACAO_E_PEDIDO, ...CORTESIA, ...ARTIGOS, ...COBRANCAS, ...POSSESSIVOS, ...REFORCO]);
// Com a dúvida de endereço gravada, a resposta à pergunta do endereço também vale sem "da/do": "é a Rua de Teste", "Rua de
// Teste, 300", "na Avenida de Teste".
const ANTES_DA_RESPOSTA = new Set([...ANTES_DA_RUA, ...PREPOSICOES_DE_POSSE, 'e', 'eh', 'na', 'no', 'nas', 'nos', 'sim', 'isso', 'essa', 'esse', 'ser', 'seria']);
// Revisão da v4.1 (achado B1): depois da resposta à dúvida de endereço, só uma fala NEUTRA (pedido, cortesia, confirmação)
// mantém a limitação ao contrato identificado; qualquer outra palavra devolve a dúvida. A lista só decide quando MANTER: o que
// estiver fora dela vai para o lado seguro.
const CONFIRMACAO = new Set([
  'e', 'eh', 'ok', 'okay', 'blz', 'beleza', 'sim', 'isso', 'certo', 'certinho', 'valeu', 'vlw', 'perfeito', 'show', 'ta', 'combinado',
  'entendi', 'aguardo', 'aguardando', 'fico', 'no', 'tudo', 'bem', 'essa', 'esse', 'esta', 'este', 'mesmo', 'mesma', 'pronto', 'otimo',
  // Rodada 9 (N4-C): "pode ser" é confirmação.
  'ser',
]);
// "segunda" só é neutra em "segunda via" (revisão da v4.2, achado C1): sozinha, pode ser a escolha do segundo endereço.
const FALA_NEUTRA = new Set([...ANTES_DA_RUA, ...CONFIRMACAO].filter((w) => w !== 'segunda'));
// Revisão da rodada 7 (P1-1): o "via" tem de vir logo depois e na MESMA oração ("a segunda, via pix" é escolha + meio).
const falaNeutra = (texto) => {
  const q = palavrasDe(texto);
  return q.every((x, i) => FALA_NEUTRA.has(x.p) || (x.p === 'segunda' && q[i + 1] && q[i + 1].p === 'via' && q[i + 1].oracao === x.oracao));
};

// Rodada 8 (N2, avaliação real do endereço: 3 de 3 conversas): "Ops, me enganei, é o da Avenida de Teste" não era o pedido
// simples (a interjeição está fora das listas), e "da Avenida de Teste" era lido como o nome de outra pessoa — o código pedia o
// documento de um terceiro que não existe. Um prefixo de correção desta lista FECHADA (uma ou mais, em sequência) sai da frente
// e o RESTO é lido como sempre: só a forma estrita do pedido simples, com os contratos conhecidos dele. A interjeição não
// identifica nem autoriza nada: com terceiro ou dúvida forte, o resto segue a leitura de sempre. "não" fica FORA da lista: "não,
// é o da …" continua fora do pedido simples, como decidido e revisado na v4 (e "não é o da …" é negação).
// Revisão da rodada 8 (achado 9): só os marcadores INEQUÍVOCOS (FORTES) dizem que ele desdisse o que pediu — substituem o
// contrato escolhido e, sem outro, criam a dúvida. Os de duplo sentido ("opa, obrigado", "desculpa a demora", "pera, pode
// mandar") só saem da frente para a rua ser lida; a escolha de antes continua como na produção.
const CORRECOES_FORTES = [
  ['eu', 'me', 'enganei'], ['me', 'enganei'], ['enganei'], ['eu', 'errei'], ['errei'], ['ops'], ['oops'], ['na', 'verdade'],
  ['quer', 'dizer'], ['quis', 'dizer'], ['corrigindo'],
];
const CORRECOES = [
  ...CORRECOES_FORTES,
  ['opa'], ['opps'], ['epa'], ['desculpa'], ['desculpe'], ['foi', 'mal'], ['pera'], ['perai'],
];
// O tamanho do prefixo de correção (uma ou mais, em sequência) e se ele tem um marcador forte.
function lerPrefixoDeCorrecao(palavras) {
  let k = 0;
  let forte = false;
  for (;;) {
    const m = CORRECOES.find((c) => c.every((w, j) => palavras[k + j] && palavras[k + j].p === w));
    if (!m) break;
    if (CORRECOES_FORTES.includes(m)) forte = true;
    k += m.length;
  }
  return { k, forte };
}
const prefixoDeCorrecao = (palavras) => lerPrefixoDeCorrecao(palavras).k;
const ehCorrecao = (texto) => lerPrefixoDeCorrecao(palavrasDe(texto)).forte;
// Rodada 9 (N4-C; opção C autorizada; revisão da rodada 9, achados 1, 2 e 6): depois do pedido pela rua, a fala sem nova
// escolha nunca libera os outros contratos nem força o pedido antigo. Só a fala NEUTRA (ou sem texto) mantém exatamente o
// contrato pedido. DESISTÊNCIA: depois de um pedido de cobrança no mesmo lote — nenhuma autorização para entregar no turno. O
// resto, que o código não classifica com segurança (inclusive outra rua dele fora da forma estrita: "troca pra Avenida…"), vira
// a dúvida de endereço (rodada 10: gravada). Com um contrato só não há o que ampliar: mantém.
//
// Rodada 10 (08/10/2026; ordem, item 1): o PEDIDO DE AÇÃO é lido à parte da identidade e do alvo. A desistência é lida pela
// FORMA — o marcador (lista fechada) e o que ele cancela na mesma oração —, não pela ausência de palavra de cobrança: "esquece o
// PIX" e "cancela o boleto" desistem (antes, a palavra "pix" fazia deles pedido e, com um contrato só, a cobrança cancelada
// continuava autorizada). Não é desistência o marcador seguido de outro verbo no infinitivo, sem cobrança na oração ("não
// precisa ter pressa", "não quero ficar sem internet"), nem "deixa eu …" ("deixa eu ver"). O pedido de envio fora do marcador
// ("esquece o pix, manda o boleto"; "não quero boleto, quero pix") faz da fala um pedido.
const DESISTENCIAS = [
  ['deixa'], ['deixe'], ['esquece'], ['esqueca'], ['cancela'], ['cancele'], ['cancelar'], ['desisti'], ['desisto'],
  ['nao', 'precisa'], ['nao', 'quero'], ['nao', 'manda'], ['nao', 'mande'], ['nao', 'envia'], ['nao', 'envie'],
  ['depois', 'eu', 'vejo'], ['depois', 'vejo'],
];
// Os marcadores que pedem complemento: "não precisa" e "não quero" só desistem do que vem depois deles.
const DESISTENCIAS_COM_COMPLEMENTO = new Set(['nao precisa', 'nao quero']);
const VERBOS_DE_ENVIO = new Set([
  'manda', 'mande', 'mandar', 'envia', 'envie', 'enviar', 'reenvia', 'reenvie', 'reenviar', 'gera', 'gere', 'gerar', 'emite', 'emita',
  'emitir', 'passa', 'passe', 'passar',
]);
// Os verbos cujo objeto é a própria cobrança: depois de "não precisa"/"não quero", mantêm a desistência ("não quero pagar agora").
const VERBOS_DA_COBRANCA = new Set([...VERBOS_DE_ENVIO, 'pagar', 'quitar', 'receber', 'fazer', 'tirar']);
const VERBOS_DE_DESEJO = new Set(['quero', 'queria', 'preciso', 'precisava', 'gostaria']);
const PRONOMES_OBLIQUOS = new Set(['se', 'me', 'te', 'lhe', 'nos']);
// A forma de infinitivo (terminação -ar/-er/-ir/-or); "por" e "favor" ficam de fora ("não precisa, por favor").
const ehInfinitivo = (p) => /(ar|er|ir|or)$/.test(p) && p.length >= 3 && p !== 'por' && p !== 'favor';
// Só gramática e confirmação: sobra a cobrança ("o boleto", "e o pix?").
const SO_A_COBRANCA = new Set([...FALA_NEUTRA, 'so', 'tambem', 'entao', 'ai', 'mais']);
const AFIRMATIVOS = new Set(['sim', 's', 'ss', 'quero', 'pode', 'claro', 'isso', 'ok', 'okay', 'blz', 'beleza', 'certo', 'uhum', 'aham', 'ser', 'manda', 'mande']);
const REPETICAO = [['de', 'novo'], ['novamente'], ['outra', 'vez']];
// Revisão da rodada 10 (A1-1): "para de mandar", "chega de mandar".
const PARAR = new Set(['para', 'pare', 'parar', 'chega']);
// Revisão da rodada 10 (A1-6): a recusa curta à pergunta da IA sobre a cobrança ("não, obrigado", "agora não").
const NEGATIVOS = new Set(['nao', 'n', 'agora', 'ainda', 'precisa', 'mais', 'nada', 'obrigado', 'obrigada', 'obg', 'valeu', 'vlw', 'por', 'favor']);

const oracoesDe = (texto) => {
  const porOracao = [];
  for (const x of palavrasDe(texto)) {
    // "… e manda o boleto": o "e" seguido de verbo de envio ou de desejo abre outra oração.
    const ultima = porOracao.length ? porOracao[porOracao.length - 1] : null;
    if (!ultima || ultima.oracao !== x.oracao) porOracao.push({ oracao: x.oracao, p: [] });
    porOracao[porOracao.length - 1].p.push(x.p);
  }
  const saida = [];
  for (const { p } of porOracao) {
    let atual = [];
    p.forEach((w, i) => {
      if (w === 'e' && (VERBOS_DE_ENVIO.has(p[i + 1]) || VERBOS_DE_DESEJO.has(p[i + 1])) && atual.length) {
        saida.push(atual);
        atual = [];
        return;
      }
      atual.push(w);
    });
    if (atual.length) saida.push(atual);
  }
  return saida;
};
// "não" antes, na mesma oração (sem "e" no meio): "não manda", "não me manda", "não quero que mande". Revisão da rodada 10
// (A1-1): também "nem" ("nem precisa mandar") e "para de"/"chega de" ("para de mandar boleto").
// Revisão do incremento (R1): só perto do verbo, com palavras auxiliares no meio ("não chegou, manda de novo" sem vírgula e
// "nem recebi o boleto manda de novo" continuam pedido).
const ENTRE_NEGACAO_E_VERBO = new Set(['me', 'te', 'lhe', 'nos', 'precisa', 'precisar', 'pode', 'quero', 'queria', 'que', 'vai', 'mais', 'se']);
const negadoAntes = (q, i) => {
  for (let k = i - 1; k >= 0 && k >= i - 4; k -= 1) {
    if (q[k] === 'nao' || q[k] === 'nem') return true;
    if (q[k] === 'de' && PARAR.has(q[k - 1])) return true;
    if (!ENTRE_NEGACAO_E_VERBO.has(q[k])) return false;
  }
  return false;
};
// Revisão da rodada 10 (A1-1): a negação POSPOSTA, na mesma oração ("manda não", "precisa mandar não", "manda mais não", "de
// novo não") — o "não" depois do verbo, sem cobrança depois dele ("manda o boleto não o pix" continua pedido do boleto).
// Revisão do incremento (R1): o "não" de uma oração subordinada ("manda de novo que não chegou", "porque o boleto não abre") não
// nega o envio.
const SUBORDINANTES = new Set(['que', 'porque', 'pois', 'como', 'se', 'quando']);
const negadoDepois = (q, i) => {
  for (let j = i + 1; j < q.length; j += 1) {
    if (SUBORDINANTES.has(q[j])) return false;
    if (q[j] === 'nao') return !q.slice(j + 1).some((x) => COBRANCAS.has(x));
  }
  return false;
};
const repeticaoEm = (q, i) => REPETICAO.some((r) => r.every((w, j) => q[i + j] === w));
// A desistência que a oração traz (o marcador e o que ele cancela).
function desisteNaOracao(q) {
  // Revisão da rodada 10 (A1-1): o envio ou a repetição negados (antes ou depois) também desistem.
  if (q.some((w, i) => (VERBOS_DE_ENVIO.has(w) || repeticaoEm(q, i)) && (negadoDepois(q, i) || (negadoAntes(q, i) && q[i - 1] !== 'quero')))) return true;
  for (let i = 0; i < q.length; i += 1) {
    const d = DESISTENCIAS.find((m) => m.every((w, j) => q[i + j] === w));
    if (!d) continue;
    const fim = i + d.length;
    if ((d[0] === 'deixa' || d[0] === 'deixe') && d.length === 1 && (q[fim] === 'eu' || q[fim] === 'me')) continue;
    if (DESISTENCIAS_COM_COMPLEMENTO.has(d.join(' '))) {
      const resto = q.slice(fim);
      const k = PRONOMES_OBLIQUOS.has(resto[0]) ? 1 : 0;
      const proximo = resto[k];
      if (proximo && !resto.some((w) => COBRANCAS.has(w)) && ehInfinitivo(proximo) && !VERBOS_DA_COBRANCA.has(proximo)) continue;
    }
    return true;
  }
  return false;
}
// O pedido de envio que a oração traz: verbo de envio não negado; desejo não negado com a cobrança ("quero o pix", "quero pagar");
// repetição não negada ("de novo"); ou só a cobrança ("o boleto").
function pedeNaOracao(q) {
  const negado = (i) => negadoAntes(q, i) || negadoDepois(q, i);
  if (q.some((w, i) => VERBOS_DE_ENVIO.has(w) && !negado(i))) return true;
  if (q.some((w, i) => VERBOS_DE_DESEJO.has(w) && !negado(i) && q.slice(i + 1).some((x) => COBRANCAS.has(x) || x === 'pagar' || x === 'quitar'))) return true;
  if (q.some((_, i) => repeticaoEm(q, i) && !negado(i))) return true;
  return q.some((w) => COBRANCAS.has(w)) && q.every((w) => SO_A_COBRANCA.has(w));
}
// O meio que a oração cita (para a desistência de OUTRO meio não desfazer o pedido da mesma mensagem).
const meioDaOracao = (q) => (q.includes('pix') ? 'pix' : (q.some((w) => w === 'boleto' || w === 'boletos') ? 'boleto' : null));
// A fala da IA pergunta sobre a cobrança ou o envio: uma frase com "?" que cita a cobrança ou um verbo de envio. Revisão do
// incremento: e que OFERECE ("Quer que eu reenvie?", "Você prefere boleto ou PIX?", "Posso enviar?") — "Você recebeu o boleto?"
// não oferece, e o "sim"/"ainda não" dele não é pedido nem desistência.
const OFERTA = new Set(['quer', 'queria', 'quiser', 'deseja', 'posso', 'pode', 'prefere', 'gostaria', 'devo', 'mando', 'envio', 'reenvio', 'gero',
  'mandar', 'enviar', 'reenviar', 'gerar', 'emitir', 'envie', 'mande', 'reenvie', 'gere']);
function perguntaSobreACobranca(falaDaIa) {
  return String(falaDaIa || '').split(/(?<=[.!?])\s+|\n+/).some((frase) => {
    if (!/\?\s*$/.test(frase.trim())) return false;
    const q = palavrasDe(frase).map((x) => x.p);
    return q.some((w) => COBRANCAS.has(w) || /^(envi|reenvi|mand|ger[ae]|emit)/.test(w)) && q.some((w) => OFERTA.has(w));
  });
}
/**
 * O pedido de ação de UMA fala do cliente: 'pedido' (pede a cobrança ou o envio), 'desistencia' (desiste dela, sem pedir outra
 * coisa) ou null (nenhum dos dois: "ok", "obrigado", "não chegou"). `falaDaIa`: a resposta da IA antes desta fala — a resposta
 * afirmativa curta ("sim", "quero", "pode") só é pedido depois de uma pergunta dela sobre a cobrança. Pura.
 */
//
// Revisão da rodada 10 (A1-2): dentro da MESMA mensagem também vale o último ato ("manda o boleto. Ah não, esquece, já paguei" é
// desistência), salvo a desistência de OUTRO meio depois do pedido ("me manda o pix, depois eu vejo o boleto" continua pedido do
// PIX). (A1-6): a recusa curta ("não, obrigado", "agora não") depois de uma pergunta da IA sobre a cobrança é desistência.
function classificarPedido(texto, { falaDaIa = null } = {}) {
  let ato = null;
  const meiosPedidos = new Set();
  for (const q of oracoesDe(texto)) {
    if (pedeNaOracao(q)) {
      ato = 'pedido';
      const meio = meioDaOracao(q);
      if (meio) meiosPedidos.add(meio);
    } else if (desisteNaOracao(q)) {
      const meio = meioDaOracao(q);
      if (!(ato === 'pedido' && meio && meiosPedidos.size > 0 && !meiosPedidos.has(meio))) ato = 'desistencia';
    }
  }
  if (ato) return ato;
  const q = palavrasDe(texto).map((x) => x.p);
  if (q.length && q.some((w) => AFIRMATIVOS.has(w)) && q.every((w) => AFIRMATIVOS.has(w) || CORTESIA.has(w)) && perguntaSobreACobranca(falaDaIa)) return 'pedido';
  if (q.length && q.some((w) => w === 'nao' || w === 'n') && q.every((w) => NEGATIVOS.has(w) || CORTESIA.has(w)) && perguntaSobreACobranca(falaDaIa)) return 'desistencia';
  return null;
}
const temPedidoDeCobranca = (texto) => palavrasDe(texto).some((x) => COBRANCAS.has(x.p) || VERBOS_DE_PAGAR.has(x.p));
// O marcador de duplo sentido seguido de fala neutra ("opa, obrigado", "pera, pode mandar") também é neutro (decisão do N2).
const falaNeutraDepoisDoPrefixo = (texto) => {
  const q = palavrasDe(texto);
  const resto = q.slice(prefixoDeCorrecao(q));
  return resto.every((x, i) => FALA_NEUTRA.has(x.p) || (x.p === 'segunda' && resto[i + 1] && resto[i + 1].p === 'via' && resto[i + 1].oracao === x.oracao));
};
// Revisão do incremento (achado A): QUALQUER marcador, forte ou de duplo sentido, seguido de outra rua dele corrige — "desculpa,
// é o da Avenida" substitui o contrato escolhido antes. (Sem o acento, "é o da" e "e o da" são a mesma leitura: "opa, e o da
// Avenida" também substitui — uma pergunta a mais, nunca uma cobrança a mais.)
const temMarcadorDeCorrecao = (texto) => prefixoDeCorrecao(palavrasDe(texto)) > 0;

/** As ruas dos contratos confirmados: a rua (antes da vírgula; sem vírgula, antes de " - "), com duas palavras ou mais, se tem o tipo do logradouro, e o número. */
function ruasDosContratos(enderecos) {
  return (Array.isArray(enderecos) ? enderecos : []).map((c) => {
    const bruto = String((c && (c.address || c.endereco)) || '');
    const virgula = bruto.indexOf(',');
    const rua = virgula >= 0 ? bruto.slice(0, virgula) : bruto.split(' - ')[0];
    const numero = virgula >= 0 ? ((bruto.slice(virgula + 1).match(/\d+/) || [])[0] || null) : null;
    const palavras = palavrasDe(rua).map((x) => x.p);
    return { id: c && c.id != null ? String(c.id) : null, palavras, numero, tipada: TIPOS_DE_LOGRADOURO.has(palavras[0]) };
  }).filter((r) => r.id && r.palavras.length >= 2);
}

/** O número escrito numa palavra: "300", ou "n 300" (de "nº300"); senão null (ilegível: "300a", "n300"). */
function numeroDaPalavra(w) {
  const m = /^(?:([a-z]+) )?(\d+)$/.exec(w || '');
  return m && (!m[1] || MARCAS_DE_NUMERO.has(m[1])) ? m[2] : null;
}

/**
 * A rua da mensagem, se ela for o pedido simples: { de, ate, ids } (os contratos dele que batem com a rua e o número),
 * { de, ate, desconhecido } (rua que não é dele, número que não bate, logradouro sem o tipo citado sem número), ou null (não
 * é o pedido simples: a rua não é lida). `de`..`ate` (exclusivo): as palavras da rua e do número. Com `resposta` (a dúvida de
 * endereço gravada), a rua vale também sem "da/do" antes ("é a Rua de Teste"). Sem `desconhecida` (terceiro no contexto), só
 * a rua de um contrato dele é lida, como na produção: a que não é dele, a do número divergente e a sem o tipo não são.
 * - antes de "da/do": só saudação, pedido, cortesia, artigo, cobrança e possessivo ("e" só como primeira palavra), e logo
 *   antes de "da/do", a cobrança ou o artigo ("o pix da", "e o da");
 * - a rua: a do cadastro inteira; ou o tipo do logradouro, "da/do" opcional logo depois dele e de UM a TRÊS nomes ("Rua
 *   Nova", "Rua da Paz", "Avenida Getulio Vargas": rua que não é dele — nome é palavra sem dígito que a leitura não conhece,
 *   ou um complemento como "nova"; nunca pessoa, "dela", preposição, negação, pedido, cortesia ou o nome do terceiro), os
 *   nomes na mesma oração ("Rua Nova, menos esse" lê só "Rua Nova" e o resto não é cortesia: não é lida; "Av. Brasil" é).
 *   "da/do" depois de um nome é dono: "Rua Nova do Fulano" e "Rua Sete de Setembro" não são lidas;
 * - o número, opcional: uma palavra com dígito, com ou sem marca antes ("300", "nº 300", "casa 300"); outro que não o do
 *   cadastro, ou ilegível ("300A"), é rua que não é dele;
 * - depois, só cortesia.
 * Cada rua do cadastro que começa ali é conferida com o próprio fim e o próprio número: com "Rua das Flores, 100" e "Rua das
 * Flores 100, casa 5" no cadastro, "o pix da Rua das Flores, 100" bate com as duas e fica ambíguo (nunca a mais longa). E a
 * rua que bate leva junto as ruas do cadastro que são ela seguida de um número (o logradouro digitado com o número dentro):
 * "o pix da Rua das Flores", sem número ou com o 100, também fica ambíguo — o "Rua das Flores 100" está na mesma rua.
 */
function ruaDoPedidoSimples(p, ruas, { resposta = false, nome = '', conhecidas = CONHECIDAS, oracoes = p.map(() => 0), desconhecida = true } = {}) {
  if (ruas.length === 0) return null;
  const ehNome = (w) => w !== undefined && (!conhecidas.has(w) || COMPLEMENTOS_DA_COBRANCA.has(w)) && !NEGACAO.has(w)
    && !CORTESIA.has(w) && !SAUDACAO_E_PEDIDO.has(w) && !/\d/.test(w) && !(nome && w === nome);
  // O número (opcional) e a cortesia depois da rua: { numero, ate } — numero undefined (sem número), null (ilegível) ou o
  // número —, ou null quando vem qualquer outra coisa.
  const depois = (fim) => {
    let ate = fim;
    let numero;
    if (MARCAS_DE_NUMERO.has(p[ate]) && /\d/.test(p[ate + 1] || '')) ate += 1;
    if (/\d/.test(p[ate] || '')) { numero = numeroDaPalavra(p[ate]); ate += 1; }
    return p.slice(ate).every((w) => CORTESIA.has(w)) ? { numero, ate } : null;
  };
  for (let i = 0; i < p.length; i += 1) {
    const pedido = i >= 2 && PREPOSICOES_DE_POSSE.has(p[i - 1]) && (COBRANCAS.has(p[i - 2]) || ARTIGOS.has(p[i - 2]))
      && p.slice(0, i - 1).every((w, k) => ANTES_DA_RUA.has(w) || (k === 0 && w === 'e'));
    if (!pedido && !(resposta && p.slice(0, i).every((w) => ANTES_DA_RESPOSTA.has(w)))) continue;
    const iguais = ruas.filter((r) => r.palavras.every((w, k) => p[i + k] === w));
    if (iguais.length === 0) {
      // Rua que não é de contrato dele: o tipo do logradouro, "da/do" opcional logo depois dele e de um a três nomes. "da/do"
      // depois de um nome é dono ("Rua Nova do Fulano"): a rua não é lida.
      if (!desconhecida || !TIPOS_DE_LOGRADOURO.has(p[i])) continue;
      const inicio = PREPOSICOES_DE_POSSE.has(p[i + 1]) ? i + 2 : i + 1;
      let fim = inicio;
      while (fim - inicio < 3 && ehNome(p[fim]) && oracoes[fim] === oracoes[inicio]) fim += 1;
      if (fim === inicio) continue;
      const d = depois(fim);
      return d ? { de: i, ate: d.ate, desconhecido: true } : null;
    }
    const batem = [];
    const extras = [];
    let ateMax = i;
    let algumaRua = false;
    let pessoaOuRua = false;
    for (const r of iguais) {
      const d = depois(i + r.palavras.length);
      if (!d) continue;
      algumaRua = true;
      ateMax = Math.max(ateMax, d.ate);
      if (d.numero !== undefined && (!d.numero || r.numero !== d.numero)) continue;
      // Logradouro sem o tipo, citado sem o número: tanto pode ser o endereço dele quanto o nome de uma pessoa.
      if (!r.tipada && d.numero === undefined) { pessoaOuRua = true; continue; }
      batem.push(r);
      for (const r2 of ruas) {
        const seguinte = r2.palavras[r.palavras.length];
        if (r2.palavras.length > r.palavras.length && r.palavras.every((w, k) => r2.palavras[k] === w)
          && /^\d+$/.test(seguinte || '') && (d.numero === undefined || seguinte === d.numero)) extras.push(r2);
      }
    }
    if (!algumaRua) return null;
    batem.push(...extras.filter((x) => !batem.includes(x)));
    if (batem.length === 0 || pessoaOuRua) return desconhecida ? { de: i, ate: ateMax, desconhecido: true } : null;
    return { de: i, ate: ateMax, ids: [...new Set(batem.map((r) => r.id))] };
  }
  return null;
}

function lerAlvo(texto, nomeDoTerceiro = null, empresa = null, enderecos = [], { resposta = false, desconhecida = true } = {}) {
  const sinais = {
    proprio: false, mencao: false, pessoaNova: false, outraPessoa: false, desconhecida: false, anafora: false, nome: false,
    incompleto: false, negaAlvo: false, negaOutra: false,
    // Pedido por endereço: os contratos dele que batem com a rua do pedido simples (null: nenhuma rua lida), ou a rua que
    // não se liga com segurança a um contrato dele.
    contratosDaRua: null, enderecoDesconhecido: false,
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
  // Pedido por endereço: a rua do pedido simples (ou nenhuma); as palavras dela não são lidas como referência abaixo.
  const ruas = ruasDosContratos(enderecos).filter((r) => desconhecida || r.tipada);
  const oracoes = palavras.map((x) => x.oracao);
  let rua = ruaDoPedidoSimples(p, ruas, { resposta, nome, conhecidas, oracoes, desconhecida });
  // Rodada 8 (N2): com um prefixo de correção, o resto pode ser o pedido simples; o prefixo não é lido como referência.
  const correcao = prefixoDeCorrecao(palavras);
  let prefixo = 0;
  if (!rua && correcao > 0 && correcao < p.length) {
    const resto = ruaDoPedidoSimples(p.slice(correcao), ruas, { resposta, nome, conhecidas, oracoes: oracoes.slice(correcao), desconhecida });
    if (resto) { rua = { ...resto, de: resto.de + correcao, ate: resto.ate + correcao }; prefixo = correcao; }
  }
  if (rua && rua.ids) sinais.contratosDaRua = rua.ids;
  else if (rua) sinais.enderecoDesconhecido = true;
  const daRua = (i) => (Boolean(rua) && i >= rua.de && i < rua.ate) || i < prefixo;
  p.forEach((w, i) => {
    if (!dentro(i) || daRua(i)) return;
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
  // Dúvida de endereço (06 e 07/10/2026): a rua bate com mais de um contrato dele (todos dele), ou não se liga com
  // segurança a nenhum. Não é dúvida sobre outra pessoa e não pede documento; fica gravada até o contrato ser identificado
  // ou o alvo esclarecido.
  ENDERECO_AMBIGUO: 'endereco_ambiguo',
  ENDERECO_DESCONHECIDO: 'endereco_desconhecido',
  // Rodada 9 (N4-C): ele desistiu do pedido no lote. Só do turno (não se grava): nenhuma cobrança sai até ele pedir de novo.
  DESISTENCIA: 'desistencia',
};
const DUVIDAS_DE_ENDERECO = new Set([AMBIGUIDADE.ENDERECO_AMBIGUO, AMBIGUIDADE.ENDERECO_DESCONHECIDO]);
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
function resolverAlvoDoTurno({ terceiro, texto, empresa = null, enderecos = [], duvidaDoLote = false, leitura = null }) {
  const pendente = (terceiro && terceiro.alvoPendente) || null;
  // A dúvida de endereço gravada (escopo pendente sem contrato de terceiro): a resposta à pergunta do endereço também conta.
  const duvidaDeEndereco = Boolean(terceiro) && DUVIDAS_DE_ENDERECO.has(pendente) && (terceiro.contratos || []).length === 0;
  // Revisão do v4 (07/10/2026, achado A3): com terceiro no contexto, só a rua de um contrato dele é lida, como na produção.
  // Ler "rua do João" como endereço trocava a dúvida forte pela fraca, e "o dele" liberava o terceiro registrado.
  const s = lerAlvo(texto, terceiro && terceiro.nome, empresa, enderecos, { resposta: duvidaDeEndereco, desconhecida: !terceiro || duvidaDeEndereco });
  // Para o lote (resolverAlvoDasMensagens): se esta entrada citou um endereço que a regra leu.
  if (leitura) leitura.citouEndereco = Boolean(s.contratosDaRua) || s.enderecoDesconhecido;
  const diferente = pessoaDiferente(s);
  const aponta = apontaOTerceiro(s);
  const resultado = (alvoAmbiguo, alvoPendente, t = terceiro) => ({ terceiro: t, voltarAoTitular: false, alvoAmbiguo, alvoPendente });
  // Pedido por endereço: a rua do pedido simples escolhe o contrato quando bate com um só contrato dele.
  const enderecoAmbiguo = Boolean(s.contratosDaRua) && s.contratosDaRua.length > 1;
  const escolhido = s.contratosDaRua && s.contratosDaRua.length === 1 ? s.contratosDaRua[0] : null;
  const comEscolha = (r) => (escolhido ? { ...r, contratoEscolhido: escolhido } : r);
  const voltar = { terceiro: null, voltarAoTitular: true, alvoAmbiguo: false, alvoPendente: null };
  const duvida = (motivo) => resultado(motivo, motivo);
  if (!terceiro) {
    if (s.proprio && (diferente || aponta || s.incompleto)) return resultado(AMBIGUIDADE.DOIS_LADOS, null);
    if (diferente || aponta) return duvida(AMBIGUIDADE.OUTRA_PESSOA_SEM_DOCUMENTO);
    if (s.incompleto) return resultado(AMBIGUIDADE.REFERENCIA_INCOMPLETA, null);
    if (!s.proprio && (s.negaOutra || s.negaAlvo)) return resultado(AMBIGUIDADE.REFERENCIA_INCOMPLETA, null);
    if (enderecoAmbiguo) return duvida(AMBIGUIDADE.ENDERECO_AMBIGUO);
    if (s.enderecoDesconhecido) return duvida(AMBIGUIDADE.ENDERECO_DESCONHECIDO);
    return comEscolha(resultado(false, null));
  }
  if (duvidaDeEndereco) {
    // Dúvida de endereço gravada: só termina com o contrato identificado ou com o alvo esclarecido. "Pode mandar",
    // agradecimento ou reprocessamento não a tiram, e ela nunca volta sozinha ao titular. Esclarecido que é de outra
    // pessoa, seguem as regras de terceiro (a dúvida forte, que pede o documento dela).
    if (diferente || aponta) return duvida(AMBIGUIDADE.OUTRA_PESSOA_SEM_DOCUMENTO);
    // Revisão do v4 (achado A1): a dúvida de um endereço citado neste mesmo lote não termina nele — ninguém perguntou nada
    // ainda, e a fala seguinte é outro pedido, não resposta.
    if (duvidaDoLote) return duvida(pendente);
    if (s.incompleto || s.negaOutra || s.negaAlvo) return duvida(pendente);
    if (escolhido) return { ...voltar, contratoEscolhido: escolhido };
    if (enderecoAmbiguo) return duvida(AMBIGUIDADE.ENDERECO_AMBIGUO);
    if (s.enderecoDesconhecido) return duvida(AMBIGUIDADE.ENDERECO_DESCONHECIDO);
    if (s.proprio) {
      // "É a minha": com um contrato só, é ele; com mais de um, a dúvida passa a ser qual.
      const meus = [...new Set((enderecos || []).map((c) => (c && c.id != null ? String(c.id) : null)).filter(Boolean))];
      if (meus.length === 1) return { ...voltar, contratoEscolhido: meus[0] };
      return duvida(AMBIGUIDADE.ENDERECO_AMBIGUO);
    }
    return duvida(pendente);
  }
  // Uma dúvida forte já gravada não é trocada: nem rebaixada por uma fraca, nem substituída por outra forte
  // (reaplicar a mesma fala tem de dar o mesmo resultado; e o pendente sem contrato continua pedindo o
  // documento da outra pessoa, não "o mesmo já informado").
  const trava = (motivo) => {
    const efetivo = DUVIDAS_FORTES.has(pendente) ? pendente : motivo;
    return resultado(efetivo, efetivo);
  };
  if (diferente) return trava(AMBIGUIDADE.TERCEIRO_NAO_VINCULADO);
  if (s.proprio && (aponta || s.incompleto)) return trava(AMBIGUIDADE.DOIS_LADOS);
  if (s.proprio) {
    // A volta explícita ao titular, com a rua dele: o contrato dela; com mais de um possível, a dúvida de qual, gravada sobre
    // o titular. (Com terceiro no contexto, a rua que não é dele não é lida: achado A3 da revisão do v4.)
    if (enderecoAmbiguo) return { ...voltar, alvoAmbiguo: AMBIGUIDADE.ENDERECO_AMBIGUO, alvoPendente: AMBIGUIDADE.ENDERECO_AMBIGUO };
    return comEscolha(voltar);
  }
  if (s.negaAlvo) return trava(AMBIGUIDADE.TERCEIRO_NAO_VINCULADO);
  // Com terceiro, a rua de um contrato dele no pedido simples, sem afirmar a própria cobrança, é dúvida fraca entre o próprio
  // e o terceiro (como na produção): nada sai de nenhum dos dois, e não se pede documento; "o dela" esclarece pelo terceiro já
  // autorizado, "a minha" pelo titular.
  if (s.contratosDaRua) return trava(AMBIGUIDADE.PROPRIO_NAO_AFIRMADO);
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
function resolverAlvoDasMensagens({ terceiro, textos, empresa = null, documentos = [], enderecos = [] }) {
  let atual = terceiro || null;
  let criado = false;
  // Pedido por endereço: os contratos escolhidos pela rua nas últimas entradas seguidas que escolheram. Duas falas com
  // contratos diferentes valem as duas (nenhuma substitui a outra: a cobrança fica limitada aos dois); uma entrada sem
  // escolha depois ("pode mandar", "ops, é a outra casa", um áudio sem transcrição) desfaz a escolha.
  let escolha = null;
  // Rodada 9 (N4-C): ele desistiu do pedido neste lote (vale até um pedido novo pela rua); houve pedido de cobrança no lote; e a
  // fala não classificada depois do pedido pela rua deixou a dúvida de endereço do turno (até uma nova escolha).
  let desistiu = false;
  let pedidoNoLote = false;
  const variosContratos = Array.isArray(enderecos) && enderecos.length > 1;
  // Revisão do v4 (07/10/2026). A1: uma entrada deste lote citou um endereço que deu dúvida de endereço — o resto do lote não
  // a encerra. A2: a dúvida gravada foi respondida com o contrato — o resto do lote não desfaz essa limitação (só soma
  // outro pedido simples, ou volta a uma dúvida).
  let duvidaDoLote = false;
  let respondida = false;
  // Revisão da v4.1 (achado B1): a dúvida que a resposta encerrou neste lote, para devolvê-la se vier uma correção.
  let duvidaRespondida = null;
  let criadoAntesDaResposta = false;
  // Rodada 7 (ressalva C3): a dúvida devolvida neste lote é REGRAVADA (marca nova), mesmo com o mesmo motivo — a limpeza
  // adiada de outro processamento, condicional à marca antiga, não passa por cima dela.
  let devolvida = false;
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
    // Rodada 9 (N4-C): a entrada sem texto (imagem, áudio sem transcrição) não muda o alvo nem a escolha — antes desfazia a
    // escolha e liberava os outros contratos.
    if (!texto) continue;
    const eraDuvidaDeEndereco = Boolean(atual) && DUVIDAS_DE_ENDERECO.has(atual.alvoPendente) && (atual.contratos || []).length === 0;
    const leitura = {};
    const r = resolverAlvoDoTurno({ terceiro: atual, texto, empresa, enderecos, duvidaDoLote, leitura });
    if (leitura.citouEndereco && DUVIDAS_DE_ENDERECO.has(r.alvoPendente)) duvidaDoLote = true;
    if (eraDuvidaDeEndereco && r.voltarAoTitular && r.contratoEscolhido) {
      respondida = true;
      duvidaRespondida = atual;
      criadoAntesDaResposta = criado;
    }
    // Revisão da v4.1 (achado B1): depois da resposta, uma fala que não é neutra, não escolhe outro contrato e não leva a uma
    // dúvida que se grava (uma correção, outra rua sem "da/do", uma negação) devolve a dúvida, que não termina mais neste lote.
    // A cobrança não fica presa a um contrato que ele pode ter acabado de desdizer, e a dúvida não sai do banco.
    if (respondida && !r.contratoEscolhido && !r.alvoPendente && !falaNeutra(texto)) {
      atual = duvidaRespondida;
      criado = criadoAntesDaResposta;
      alvoAmbiguo = atual.alvoPendente;
      escolha = null;
      respondida = false;
      duvidaDoLote = true;
      devolvida = true;
      continue;
    }
    // Rodada 8 (N2): a correção que não identifica outro contrato dele, depois de uma escolha neste lote (a da dúvida respondida
    // volta pela regra acima), não deixa o contrato desdito como destino — nem a cobrança livre: vira a dúvida de endereço, que
    // a fala seguinte dele, no mesmo lote, ainda pode responder.
    // Rodada 9 (N4-C): a desistência (sem nova escolha, sem pedido de cobrança na fala, depois de um pedido no lote) tira a
    // autorização do turno, até um pedido novo pela rua.
    const pedidoAntes = pedidoNoLote;
    pedidoNoLote = pedidoNoLote || temPedidoDeCobranca(texto) || Boolean(r.contratoEscolhido);
    if (pedidoAntes && !r.contratoEscolhido && !r.alvoPendente && !r.voltarAoTitular && classificarPedido(texto) === 'desistencia') {
      desistiu = true;
      escolha = null;
      alvoAmbiguo = r.alvoAmbiguo;
      continue;
    }
    const correcao = ehCorrecao(texto);
    if (correcao && escolha && !respondida && !r.contratoEscolhido && !r.alvoPendente && !r.alvoAmbiguo && !r.voltarAoTitular) {
      atual = { nome: null, contratos: [], pendente: true, alvoPendente: AMBIGUIDADE.ENDERECO_DESCONHECIDO };
      criado = true;
      alvoAmbiguo = AMBIGUIDADE.ENDERECO_DESCONHECIDO;
      escolha = null;
      continue;
    }
    // Revisão da rodada 9 (achados 1 e 6): depois do pedido pela rua, com mais de um contrato, a fala que não é neutra nem traz
    // nova escolha vira a dúvida de endereço — nem o contrato pedido fica forçado (a fala pode ser a troca para outra rua dele),
    // nem os outros liberados. Rodada 10 (ordem, item 1): a dúvida é GRAVADA, pelo mesmo mecanismo da correção (N2): só na
    // memória do turno, o "pode mandar" seguinte (ou o reprocessamento) deixava o contrato desdito passar sem esclarecimento.
    if (variosContratos && escolha && !respondida && !r.contratoEscolhido && !r.alvoPendente && !r.alvoAmbiguo && !r.voltarAoTitular && !falaNeutraDepoisDoPrefixo(texto)) {
      atual = { nome: null, contratos: [], pendente: true, alvoPendente: AMBIGUIDADE.ENDERECO_DESCONHECIDO };
      criado = true;
      alvoAmbiguo = AMBIGUIDADE.ENDERECO_DESCONHECIDO;
      escolha = null;
      continue;
    }
    alvoAmbiguo = r.alvoAmbiguo;
    // A correção que escolhe outro contrato SUBSTITUI o desdito; sem correção, duas falas com contratos diferentes valem as duas.
    // Rodada 9 (N4-C): sem nova escolha, a fala que não leva a dúvida, pendência ou volta ao titular mantém a escolha (antes,
    // só depois da dúvida respondida).
    if (r.contratoEscolhido) desistiu = false;
    escolha = r.contratoEscolhido
      ? (temMarcadorDeCorrecao(texto) ? [r.contratoEscolhido] : [...new Set([...(escolha || []), r.contratoEscolhido])])
      : (!r.alvoAmbiguo && !r.alvoPendente && !r.voltarAoTitular ? escolha : null);
    if (r.voltarAoTitular) {
      // A volta ao titular com a dúvida de endereço: o titular, com a dúvida gravada (escopo pendente sem contrato).
      atual = r.alvoPendente ? { nome: null, contratos: [], pendente: true, alvoPendente: r.alvoPendente } : null;
      criado = Boolean(r.alvoPendente);
      continue;
    }
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
  // Rodada 9 (N4-C): a desistência vale como dúvida do turno (trava a cobrança), salvo outra dúvida, que já trava.
  if (desistiu && !alvoAmbiguo) alvoAmbiguo = AMBIGUIDADE.DESISTENCIA;
  let gravar = null;
  if (criado) gravar = 'criar';
  else if (terceiro && !atual) gravar = 'limpar';
  else if (terceiro && ((terceiro.alvoPendente || null) !== (atual.alvoPendente || null))) gravar = 'pendencia';
  else if (terceiro && atual && devolvida) gravar = 'pendencia';
  return {
    terceiro: atual, alvoAmbiguo, gravar,
    ...(escolha ? { contratosEscolhidos: escolha } : {}),
    ...(escolha && escolha.length === 1 ? { contratoEscolhido: escolha[0] } : {}),
  };
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
  intencaoDeAlvo, resolverAlvoDoTurno, resolverAlvoDasMensagens, AMBIGUIDADE, documentosValidos, classificarPedido,
};
