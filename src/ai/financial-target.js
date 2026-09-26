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

const PROPRIO = [
  'minha fatura', 'minhas faturas', 'meu boleto', 'meus boletos', 'meu pix', 'minha conta', 'minha cobranca',
  'minha segunda via', 'minha mensalidade', 'o meu', 'a minha', 'os meus', 'as minhas',
  'meu proprio', 'minha propria', 'pra mim', 'para mim',
];
const PARENTES = [
  'marido', 'esposo', 'esposa', 'mulher', 'mae', 'pai', 'filho', 'filha', 'irmao', 'irma', 'avo', 'tio', 'tia',
  'sogro', 'sogra', 'vizinho', 'vizinha', 'amigo', 'amiga', 'namorado', 'namorada', 'primo', 'prima', 'patrao', 'patroa',
];
const TERCEIRO = [
  'dela', 'dele', 'da outra', 'do outro', 'outra pessoa', 'dessa pessoa', 'desta pessoa', 'da minha', 'do meu',
  ...PARENTES.flatMap((p) => [`meu ${p}`, `minha ${p}`]),
];

const contem = (texto, frase) => ` ${texto} `.includes(` ${frase} `);

/**
 * 'proprio' | 'terceiro' | 'ambiguo' | null (sem alvo explícito).
 * `nomeDoTerceiro`: o primeiro nome do terceiro em andamento — citar o nome é apontar para ele.
 */
function intencaoDeAlvo(texto, nomeDoTerceiro = null) {
  const t = normalizar(texto);
  if (!t) return null;
  const nome = normalizar(nomeDoTerceiro);
  const proprio = PROPRIO.some((f) => contem(t, f));
  const terceiro = TERCEIRO.some((f) => contem(t, f)) || Boolean(nome && contem(t, nome));
  if (proprio && terceiro) return 'ambiguo';
  if (proprio) return 'proprio';
  if (terceiro) return 'terceiro';
  return null;
}

/**
 * O alvo financeiro no começo do turno, a partir do escopo de terceiro carregado e da mensagem
 * do cliente. Pura: quem chama (o worker) limpa a persistência quando `voltarAoTitular`.
 * - terceiro ativo (inclusive pendente, de CPF não encontrado):
 *   intenção própria → volta ao titular (sem pedir CPF: ele já está identificado);
 *   dos dois lados → nenhuma cobrança até esclarecer; qualquer outra → continua o terceiro.
 * - sem terceiro: cliente falando de outra pessoa (ou dos dois lados) sem CPF → nenhuma cobrança
 *   do titular até esclarecer; senão, segue o titular.
 */
function resolverAlvoDoTurno({ terceiro, texto }) {
  const intencao = intencaoDeAlvo(texto, terceiro && terceiro.nome);
  if (terceiro) {
    if (intencao === 'proprio') return { terceiro: null, voltarAoTitular: true, alvoAmbiguo: false };
    return { terceiro, voltarAoTitular: false, alvoAmbiguo: intencao === 'ambiguo' };
  }
  return { terceiro: null, voltarAoTitular: false, alvoAmbiguo: intencao === 'terceiro' || intencao === 'ambiguo' };
}

/** Volta ao principal (o titular da conversa foi identificado de novo pelo próprio documento). */
function liberarAlvoTerceiro(contexto) {
  if (contexto) contexto.alvoTerceiro = null;
}

module.exports = {
  FERRAMENTAS_DE_COBRANCA, alvoFinanceiro, ehAlvoTerceiro, contratoNoAlvo, fixarAlvoTerceiro, liberarAlvoTerceiro,
  intencaoDeAlvo, resolverAlvoDoTurno,
};
