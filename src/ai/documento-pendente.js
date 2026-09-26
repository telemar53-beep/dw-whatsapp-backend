// Documento pendente (25/09/2026). Caso real: a IA pediu o CPF três vezes seguidas enquanto o
// cliente, por texto e por áudio, só explicava o problema. Por que acontecia:
// - o prompt de identificação (fluxos/identificacao.js) manda pedir o CPF A CADA turno enquanto a
//   identidade for 'none', com frase-modelo; o princípio "nunca repita" só cobria pergunta JÁ
//   RESPONDIDA;
// - nada, entre um turno e outro, dizia que o documento JÁ tinha sido pedido;
// - a recusa de ferramenta por identidade (tool-executor.js) instrui "Peça o CPF ou CNPJ";
// - a guarda anti-repetição do worker só barra texto IDÊNTICO — o mesmo pedido com outras
//   palavras passava.
//
// O registro é o próprio pedido: quando a resposta da IA pede o documento, o worker grava na
// metadata dessa mensagem DE QUEM é o documento pedido (o de quem fala, ou o de outra pessoa —
// caso Fulana/Beltrana). Nada novo no banco além disso. A pendência é derivada, a cada turno, do
// histórico DESTA conversa: o último pedido marcado e o que o cliente disse depois dele. Conversa
// nova, histórico novo — nada vaza para o próximo atendimento.
//
// NÚMERO RECEBIDO != IDENTIDADE CONFIRMADA (ajuste de 25/09/2026): 11 ou 14 dígitos podem ser um
// telefone, um número errado ou um documento que não existe. O número recebido deixa a pendência
// "respondida, não validada" — é tentado com buscar_cliente, e pedir para conferir é avanço —, mas
// ela só termina com a confirmação do fluxo existente: quem fala identificado (pedido do próprio),
// ou o terceiro LOCALIZADO depois do pedido.
//
// IDENTIDADE CONFIRMADA É FATO DO SISTEMA, não texto da IA: a localização do terceiro vem do escopo
// que buscar_cliente PERSISTE antes de devolver (conversations.ai_triage_third_party — falha
// fechado, sem documento, nunca renovado; a hora sai de expiraEm menos a vida do escopo). No
// próprio turno, vale a trava contexto.alvoTerceiro, que só ganha contrato depois dessa gravação.
// Resposta descartada, vazia ou substituída não apaga o fato.
//
// O CÓDIGO decide quando pedir de novo é repetição; a IA continua conduzindo a conversa. Tudo aqui
// é puro; o orquestrador aplica (prompt + correção no laço + troca final) e o worker marca.

const { intencaoDeAlvo } = require('./financial-target');
const { escopoValido, MINUTOS_DE_VIDA } = require('./third-party-scope');

const normalizar = (texto) => String(texto || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9\s]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const soDigitos = (valor) => String(valor || '').replace(/\D/g, '');
const algum = (lista, texto) => lista.some((r) => r.test(texto));

// ------------------------------------------------------------------------------------------------
// O pedido do documento, frase a frase (a pontuação final diz se a frase pergunta).
const frasesDe = (texto) => String(texto || '').split(/(?<=[.!?\n])\s*/).map((f) => f.trim()).filter(Boolean);
const DOCUMENTO = /\b(?:cpf|cnpj|documento)\b/;
const PEDIDO = /\b(?:informe|me informa|me informe|envie|me envia|me envie|mande|me manda|me mande|passe|me passa|me passe|me passar|me informar|me enviar|me mandar|digite|confirme|me confirma|me confirme|diga|me diz|me diga|me fala|pode me (?:dizer|informar|passar|enviar|mandar|confirmar)|preciso (?:da|do|de|que)|precisamos (?:da|do|de|que))\b/;

function pedeNaFrase(frase) {
  const f = normalizar(frase);
  return DOCUMENTO.test(f) && (/\?\s*$/.test(frase) || PEDIDO.test(f));
}

function pedeDocumento(texto) {
  return frasesDe(texto).some(pedeNaFrase);
}

// O documento DE QUEM ESTÁ FALANDO, pedido com todas as letras.
const DE_QUEM_FALA = /\bseu (?:cpf|cnpj|documento|cadastro)\b|\bseus dados\b|\bsua identificacao\b/;
// O documento de outra pessoa: "CPF dela", "CPF da Beltrana", "CPF da sua mãe" (e não "do titular").
const DE_OUTRA_PESSOA = /\b(?:cpf|cnpj|documento)(?: ou (?:cpf|cnpj))? (?:dela|dele)\b|\b(?:cpf|cnpj|documento)(?: ou (?:cpf|cnpj))? d[ao] (?!(?:titular|cadastro|contrato|cliente|responsavel)\b)\w+/;

const identificado = (contexto) => Boolean(contexto && contexto.identidade
  && contexto.identidade.nivel === 'forte' && !contexto.identidade.contestado);

/**
 * De quem é o documento que a resposta está pedindo, com o contexto do fim do turno. Quem fala já
 * identificado nunca tem o próprio documento pedido — então é o de outra pessoa.
 */
function alvoDoPedido(contexto, texto) {
  const c = contexto || {};
  if (identificado(c)) return 'terceiro';
  if (c.terceiro || c.alvoTerceiro || c.alvoAmbiguo) return 'terceiro';
  if (frasesDe(texto).some((f) => pedeNaFrase(f) && DE_OUTRA_PESSOA.test(normalizar(f)))) return 'terceiro';
  return 'principal';
}

// Número com cara de CPF (11 dígitos) ou CNPJ (14), com ou sem pontuação. É só NÚMERO RECEBIDO: pode
// ser telefone, erro de digitação ou documento que não existe. Sem checksum de propósito — quem diz
// se é o documento certo é buscar_cliente (o SGP), não esta leitura.
function documentosNoTexto(texto) {
  return (String(texto || '').match(/\d(?:[\d.\-/]|\s(?=\d))*\d/g) || [])
    .map(soDigitos)
    .filter((d) => d.length === 11 || d.length === 14);
}

// ------------------------------------------------------------------------------------------------
// O que o cliente disse depois do pedido.
const ASSUNTO_FINANCEIRO = /\b(?:boleto|pix|fatura|segunda via|pagar|pagamento|paguei|mensalidade|debito|desbloque\w*|liberar|comprovante|cobranca)\b/;
const ASSUNTO_SUPORTE = /\b(?:internet|net|sinal|conexao|lent[ao]|lentidao|caiu|caindo|oscila\w*|travando|roteador|modem|onu|wifi|wi fi|sem acesso|nao funciona|nao conecta|queimou)\b/;
function assunto(t) {
  if (ASSUNTO_FINANCEIRO.test(t)) return 'financeiro';
  if (ASSUNTO_SUPORTE.test(t)) return 'suporte';
  return null;
}
// O assunto mudou para algo que não depende do cadastro, ou o próprio pedido perdeu a razão.
const MUDANCA_DE_ASSUNTO = [
  /\bvoces atendem\b/, /\batendem (?:no|na|o|a|meu|minha|aqui|ai|em)\b/, /\btem cobertura\b/, /\bcobertura\b/, /\bchega (?:ai|aqui|no|na)\b/,
  /\bquais (?:os |sao os )?planos\b/, /\bquanto custa\b/, /\bvalor do plano\b/, /\bcontratar\b/, /\binstalacao\b/,
  /\bna verdade (?:so )?(?:queria|quero|era)\b/, /\bdeixa (?:pra|para) la\b/, /\besquece\b/, /\bnao precisa mais\b/,
  /\bja (?:voltou|normalizou|resolveu|resolvi)\b/, /\b(?:voltou|normalizou) a internet\b/,
];
const IRRITACAO = /\bja (?:te )?(?:falei|disse|informei|mandei|passei|respondi|expliquei)\b|\bpar[ae] de (?:me )?(?:pedir|perguntar)\b|\bso sabem? pedir\b|\bquantas vezes\b|\bque saco\b|\binsuportavel\b|\bnao aguento\b/;
const PARENTES = 'mae|pai|filho|filha|irmao|irma|avo|tio|tia|sogro|sogra|vizinho|vizinha|amigo|amiga|namorado|namorada|primo|prima|patrao|patroa|marido|esposo|esposa|mulher|cunhado|cunhada';
// Uma pessoa NOVA (parente, "outra pessoa"); "dela"/"dele" apontam para quem já está no pedido.
const NOVO_TERCEIRO = new RegExp(`\\b(?:d[aoe]|pr[ao]|para [ao]) (?:minha |meu |sua |seu )?(?:${PARENTES})\\b|\\boutra pessoa\\b|\\boutr[oa] cliente\\b`);

const falaDoCliente = (m) => m && m.direction === 'inbound' && !(m.metadata && m.metadata.autorrespostaProvavel === true);
const textoDaFala = (m) => (m.messageType === 'audio' ? m.transcription : m.content) || '';

// O alvo mudou de lado desde o pedido? (a intenção dita pelo cliente, lida sem OpenAI)
function mudouOAlvo(alvo, texto) {
  const intencao = intencaoDeAlvo(texto);
  if (intencao === 'ambiguo') return true;
  if (alvo === 'principal') return intencao === 'terceiro';
  return intencao === 'proprio' || NOVO_TERCEIRO.test(normalizar(texto));
}

/**
 * A pendência do documento neste turno, ou null. Nasce no último pedido marcado da conversa e só
 * termina com a identificação CONFIRMADA: quem fala identificado (pedido do próprio), ou o terceiro
 * localizado depois do pedido (resposta marcada `documentoConfirmado: 'terceiro'`). Número recebido
 * deixa `documentoRecebido: true` — "respondida, não validada". `mudancaRelevante`: desde o pedido,
 * algo mudou a ponto de pedir de novo não ser repetição — número NOVO recebido (pedir para conferir
 * é avanço), o próprio documento mandado no lugar do da outra pessoa, alvo novo, pedido novo que
 * também depende do cadastro, ou volta ao assunto depois de mudar.
 */
function estadoDoDocumento(historico, { identidade = null, documentoDeQuemFala = null, terceiroLocalizadoEm = null } = {}) {
  const lista = Array.isArray(historico) ? historico : [];
  let indice = -1;
  for (let i = lista.length - 1; i >= 0; i -= 1) {
    const m = lista[i];
    if (m && m.direction === 'outbound' && m.sentBy === 'ai' && m.metadata && m.metadata.pedidoDeDocumento) { indice = i; break; }
  }
  if (indice < 0) return null;
  const alvo = lista[indice].metadata.pedidoDeDocumento.alvo === 'terceiro' ? 'terceiro' : 'principal';
  if (alvo === 'principal' && identificado({ identidade })) return null;
  // Terceiro localizado DEPOIS deste pedido (o escopo persistido diz quando). Localização anterior —
  // de outro terceiro, antes de um pedido novo — não encerra. Pedido sem hora (legado): sem prova.
  const pedidoEm = lista[indice].createdAt ? new Date(lista[indice].createdAt).getTime() : NaN;
  const localizadoDepois = terceiroLocalizadoEm != null && Number.isFinite(pedidoEm)
    && new Date(terceiroLocalizadoEm).getTime() > pedidoEm;
  if (alvo === 'terceiro' && localizadoDepois) return null;

  const antes = lista.slice(0, indice).filter(falaDoCliente).map(textoDaFala).filter(Boolean);
  const anterior = antes[antes.length - 1];
  const assuntoDoPedido = anterior ? assunto(normalizar(anterior)) : null;
  // O número que o cliente já tinha mandado antes deste pedido (e não localizou) não é novidade.
  const jaTentados = new Set(antes.flatMap(documentosNoTexto));
  const depois = lista.slice(indice + 1).filter(falaDoCliente).map(textoDaFala).filter(Boolean);
  const proprio = soDigitos(documentoDeQuemFala);

  let mudou = false;
  let retomou = false;
  let relevante = false;
  let recebido = false;
  let mandouOProprio = false;
  for (const texto of depois) {
    const documentos = documentosNoTexto(texto);
    const deQuemFala = alvo === 'terceiro' && proprio ? documentos.filter((d) => d === proprio) : [];
    const novos = documentos.filter((d) => !deQuemFala.includes(d) && !jaTentados.has(d));
    if (novos.length > 0) { recebido = true; relevante = true; }
    if (deQuemFala.length > 0) { mandouOProprio = true; relevante = true; }
    if (mudouOAlvo(alvo, texto)) relevante = true;
    const t = normalizar(texto);
    if (algum(MUDANCA_DE_ASSUNTO, t)) { mudou = true; continue; }
    const deAgora = assunto(t);
    if (deAgora && mudou) { retomou = true; relevante = true; }
    else if (deAgora && assuntoDoPedido && deAgora !== assuntoDoPedido) relevante = true;
  }
  const ultima = depois[depois.length - 1];
  return {
    alvo,
    assunto: assuntoDoPedido,
    mudouDeAssunto: mudou && !retomou,
    retomou,
    mudancaRelevante: relevante,
    irritado: Boolean(ultima && IRRITACAO.test(normalizar(ultima))),
    mandouOProprioDocumento: mandouOProprio,
    documentoRecebido: recebido,
  };
}

/**
 * Quando o terceiro foi localizado, pelo escopo que buscar_cliente persistiu: só com contrato, escopo
 * válido e não pendente. O escopo nasce com expiraEm = localização + MINUTOS_DE_VIDA e nunca é
 * renovado — a conta é exata. O worker chama isto a cada turno, com o escopo recém-lido do banco.
 */
function localizacaoDoTerceiro(escopo, agora = new Date()) {
  if (!escopoValido(escopo, agora) || escopo.contratos.length === 0) return null;
  return new Date(Date.parse(escopo.expiraEm) - MINUTOS_DE_VIDA * 60 * 1000);
}

/**
 * O terceiro foi LOCALIZADO neste turno? A trava do turno (contexto.alvoTerceiro) nasce na consulta
 * do documento de outra pessoa e só ganha contrato DEPOIS de o escopo ter sido gravado; vazia, não
 * achou. Nos turnos seguintes, quem diz é o escopo persistido (localizacaoDoTerceiro).
 */
function documentoConfirmadoNoTurno(contexto) {
  const trava = contexto && contexto.alvoTerceiro;
  return trava && Array.isArray(trava.contratos) && trava.contratos.length > 0 ? 'terceiro' : null;
}

// A pendência ainda aberta AGORA: buscar_cliente pode ter confirmado a identificação no meio do turno
// (quem fala identificado, ou o terceiro localizado).
function pendenteAgora(contexto) {
  const pendente = contexto && contexto.documento;
  if (!pendente) return null;
  if (pendente.alvo === 'principal' && identificado(contexto)) return null;
  if (pendente.alvo === 'terceiro' && documentoConfirmadoNoTurno(contexto)) return null;
  return pendente;
}

function terceiroLocalizado(contexto) {
  const t = contexto && contexto.terceiro;
  return Boolean(t && Array.isArray(t.contratos) && t.contratos.length > 0);
}

/** O que a resposta NÃO pode pedir neste turno. */
function violacoesDoDocumento(texto, contexto) {
  if (!pedeDocumento(texto)) return [];
  const c = contexto || {};
  if (c.triagemConcluida || c.atendimentoEncerrado) return ['documento_apos_encaminhar'];
  const pedidos = frasesDe(texto).filter(pedeNaFrase).map(normalizar);
  // "Esse é o seu CPF, preciso do CPF da Beltrana" pede o de OUTRA pessoa: não é pedir o dele.
  const pedeODeQuemFala = pedidos.some((f) => DE_QUEM_FALA.test(f) && !DE_OUTRA_PESSOA.test(f));
  if (identificado(c) && pedeODeQuemFala) return ['documento_ja_identificado'];
  const pendente = pendenteAgora(c);
  if (pendente && (pendente.irritado || !pendente.mudancaRelevante)) return ['documento_repetido'];
  if (!pendente && terceiroLocalizado(c) && !pedeODeQuemFala
      && !NOVO_TERCEIRO.test(normalizar(c.ultimaFala))) {
    return ['documento_terceiro_localizado'];
  }
  return [];
}

/** O texto da correção no laço (uma vez por turno). */
function correcaoDoDocumento(violacoes, contexto) {
  const c = contexto || {};
  const partes = [];
  if (violacoes.includes('documento_apos_encaminhar')) {
    partes.push('O atendimento já foi encaminhado: NÃO peça documento nenhum. Responda em uma frase.');
  }
  if (violacoes.includes('documento_ja_identificado')) {
    partes.push('Quem está falando JÁ está identificado: NÃO peça o CPF ou CNPJ dele. Siga com o que ele pediu usando o cadastro que você já tem.');
  }
  if (violacoes.includes('documento_terceiro_localizado')) {
    partes.push('O cadastro da outra pessoa JÁ foi localizado com o documento informado: NÃO peça o documento dela de novo. Siga com o que ele pediu.');
  }
  if (violacoes.includes('documento_repetido')) {
    const pendente = c.documento || {};
    const deQuem = pendente.alvo === 'terceiro' ? 'o CPF ou CNPJ da OUTRA pessoa (o de quem fala não serve)' : 'o CPF ou CNPJ';
    partes.push(`Você já pediu ${deQuem} e ele ainda não informou: NÃO peça de novo nesta resposta, nem com outras palavras. Responda ao que ele disse agora; o que depende da identificação continua sem poder ser feito.`);
    if (pendente.mudouDeAssunto) partes.push('Ele mudou de assunto: responda ao assunto novo.');
    if (pendente.irritado) {
      partes.push('Ele se incomodou com o pedido: não discuta nem se justifique. Se não der para seguir sem o cadastro, encaminhe com concluir_triagem, com "identificação pendente" no resumo.');
    }
  }
  return partes.join(' ');
}

// Mesma redação da frase de encaminhamento de contencoes-operacionais.js (não exportada lá).
function fraseDoEncaminhamento(contexto) {
  const setor = contexto.triagemConcluida && contexto.triagemConcluida.setor;
  if (!setor) return null;
  const noturno = contexto.triagem && contexto.triagem.noturno;
  return noturno && noturno.ativo
    ? `Seu atendimento ficou registrado para o setor ${setor} e nossa equipe dá continuidade a partir das ${noturno.retornoAs}.`
    : `Seu atendimento vai para o setor ${setor} e um atendente continua daqui.`;
}

/** Se o modelo insistir: a resposta perde só a(s) frase(s) do pedido; sem nada útil, uma frase curta. */
function respostaSemRepetirDocumento(texto, violacoes, contexto) {
  const c = contexto || {};
  const resto = frasesDe(texto).filter((f) => !pedeNaFrase(f)).join(' ').trim();
  if (resto) return resto;
  if (violacoes.includes('documento_apos_encaminhar') && fraseDoEncaminhamento(c)) return fraseDoEncaminhamento(c);
  if (c.documento && c.documento.irritado) return 'Entendi, desculpe a insistência.';
  return 'Entendi.';
}

module.exports = {
  pedeDocumento, alvoDoPedido, documentosNoTexto, estadoDoDocumento, violacoesDoDocumento, correcaoDoDocumento,
  respostaSemRepetirDocumento, documentoConfirmadoNoTurno, localizacaoDoTerceiro,
};
