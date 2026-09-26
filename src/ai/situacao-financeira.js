// Situação financeira de UM contrato (25/09/2026) — a regra 0 / 1 / 2+ vencidas, com a semântica
// REAL do SGP da DW, auditada em produção (só leitura):
// - contratoStatus 1 Ativo, 3 Cancelado, 4 Suspenso (os três vistos em resposta real);
// - título statusid 1 + "Gerado" + sem data_pagamento = não pago; statusid 2 + "Pago" + com
//   data_pagamento = pago;
// - `central/titulos` traz pagas, atuais e o carnê futuro INTEIRO — contar "Gerado" não é contar
//   atraso, e `contratoTitulosAReceber` também não;
// - o SGP troca o `vencimento_atualizado` do título atrasado pela data corrente (e a 2ª via manda
//   essa data): atraso se conta SÓ pelo vencimento ORIGINAL.
//
// Módulo puro: sem SGP, sem banco, sem IA. "Hoje" é o dia de America/Sao_Paulo (o processo roda em
// UTC). Qualquer dado fora do que foi provado deixa a análise INDETERMINADA — nunca adivinhar.

const FUSO = 'America/Sao_Paulo';
const formatoDia = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' });

/** 'AAAA-MM-DD' do dia em São Paulo. */
function hojeEmSaoPaulo(agora = new Date()) {
  return formatoDia.format(agora);
}

// Só os três códigos vistos em resposta real. O resto da tabela da documentação (2, 5, 6, 7) não
// foi provado nesta instalação: vira indeterminado.
const STATUS_CONTRATO = { 1: 'ativo', 3: 'cancelado', 4: 'suspenso' };

/** 'AAAA-MM-DD' de 'AAAA-MM-DD[...]' ou 'DD/MM/AAAA', ou null. */
function diaISO(valor) {
  const texto = String(valor || '');
  const iso = texto.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = texto.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  return null;
}

const texto = (v) => String(v == null ? '' : v).trim().toLowerCase();
const codigo = (v) => String(v == null ? '' : v).trim();

/**
 * Classe de UM título normalizado (sgp-normalizer.normalizeInvoices): 'vencida' | 'do_dia' |
 * 'futura' | 'paga' | 'indeterminado' (com o motivo). A data que conta é SEMPRE vencimentoOriginal.
 */
function classificarTitulo(titulo, hoje) {
  const t = titulo || {};
  const pagoPeloStatus = codigo(t.statusCode) === '2' && texto(t.status) === 'pago';
  const geradoPeloStatus = codigo(t.statusCode) === '1' && texto(t.status) === 'gerado';
  const temPagamento = Boolean(t.dataPagamento);
  if (pagoPeloStatus && temPagamento) return { classe: 'paga' };
  if (!geradoPeloStatus || temPagamento) return { classe: 'indeterminado', motivo: 'status_do_titulo_nao_reconhecido' };
  const vencimento = diaISO(t.vencimentoOriginal);
  if (!vencimento) return { classe: 'indeterminado', motivo: 'vencimento_ilegivel' };
  if (vencimento < hoje) return { classe: 'vencida' };
  if (vencimento === hoje) return { classe: 'do_dia' };
  return { classe: 'futura' };
}

// Mais antiga primeiro: menor vencimento ORIGINAL; empate, menor id — nunca a ordem da API.
function porAntiguidade(a, b) {
  const va = diaISO(a.vencimentoOriginal);
  const vb = diaISO(b.vencimentoOriginal);
  if (va !== vb) return va < vb ? -1 : 1;
  const ia = Number(a.faturaId);
  const ib = Number(b.faturaId);
  if (Number.isFinite(ia) && Number.isFinite(ib) && ia !== ib) return ia - ib;
  return String(a.faturaId).localeCompare(String(b.faturaId));
}

/**
 * @param contrato { id, statusCode? } — statusCode ausente (contrato de terceiro: o escopo guarda só
 *   o id) não é "desconhecido": vale só a regra dos títulos.
 * @param titulos títulos normalizados do contrato (todas as páginas).
 * @param hoje 'AAAA-MM-DD' em São Paulo.
 * @param leituraCompleta false quando a paginação não provou que leu tudo.
 */
function analisarSituacaoFinanceiraContrato({ contrato, titulos, hoje, leituraCompleta }) {
  const c = contrato || {};
  const temStatus = c.statusCode !== undefined && c.statusCode !== null && codigo(c.statusCode) !== '';
  const contratoStatus = temStatus ? (STATUS_CONTRATO[codigo(c.statusCode)] || 'desconhecido') : null;
  const base = {
    contratoId: c.id, contratoStatus, cancelado: contratoStatus === 'cancelado',
    vencidas: [], quantidadeVencidas: 0, maisAntiga: null, doDia: [], futuras: [], pagas: [],
    indeterminado: false, motivoIndeterminado: null,
  };
  // Cancelado decide sozinho (Reativação), com ou sem os títulos.
  if (base.cancelado) return base;
  const indeterminado = (motivo) => ({ ...base, indeterminado: true, motivoIndeterminado: motivo });
  if (contratoStatus === 'desconhecido') return indeterminado('status_do_contrato_nao_confirmado');
  if (leituraCompleta !== true) return indeterminado('leitura_incompleta');
  if (!Array.isArray(titulos)) return indeterminado('leitura_incompleta');

  const grupos = { vencida: [], do_dia: [], futura: [], paga: [] };
  for (const titulo of titulos) {
    const { classe } = classificarTitulo(titulo, hoje);
    if (classe === 'indeterminado') return indeterminado('titulo_indeterminado');
    grupos[classe].push(titulo);
  }
  const vencidas = grupos.vencida.slice().sort(porAntiguidade);
  return {
    ...base,
    vencidas,
    quantidadeVencidas: vencidas.length,
    maisAntiga: vencidas[0] || null,
    doDia: grupos.do_dia,
    futuras: grupos.futura,
    pagas: grupos.paga,
  };
}

/**
 * O que a IA pode fazer com a cobrança DESTE contrato.
 * - indeterminado → 'humano' (sem entrega automática);
 * - cancelado → 'reativacao';
 * - 0 vencidas → 'fluxo_normal' (a regra não se aplica);
 * - 1 vencida → 'entregar' só ela;
 * - 2+ vencidas: de dia (e fora do expediente sem o noturno com autoatendimento) → 'reativacao';
 *   com o noturno com autoatendimento → 'entregar' só a MAIS ANTIGA, com Reativação depois.
 */
function decidirCobranca(analise, { noturnoAutoatendimento = false } = {}) {
  if (analise.cancelado) return { acao: 'reativacao', motivo: 'contrato_cancelado' };
  if (analise.indeterminado) return { acao: 'humano', motivo: analise.motivoIndeterminado };
  if (analise.quantidadeVencidas === 0) return { acao: 'fluxo_normal' };
  if (analise.quantidadeVencidas === 1) {
    return { acao: 'entregar', faturaPermitida: analise.maisAntiga.faturaId, reativacaoDepois: false };
  }
  if (noturnoAutoatendimento === true) {
    return { acao: 'entregar', faturaPermitida: analise.maisAntiga.faturaId, reativacaoDepois: true, quantidadeVencidas: analise.quantidadeVencidas };
  }
  return { acao: 'reativacao', motivo: 'multiplas_vencidas', quantidadeVencidas: analise.quantidadeVencidas };
}

/** O MESMO título relido: pago só com statusid 2, status "Pago" e data de pagamento. */
function pagamentoConfirmadoDoTitulo(titulo) {
  if (!titulo) return false;
  return codigo(titulo.statusCode) === '2' && texto(titulo.status) === 'pago' && Boolean(titulo.dataPagamento);
}

// Por que a conversa vai para a reativação, em texto para o resumo do atendente (e para a instrução
// ao modelo — por isso sem nome de setor com maiúscula: o setor vem do painel).
const MOTIVOS_REATIVACAO = {
  contrato_cancelado: 'contrato cancelado; a IA não enviou cobrança',
  multiplas_vencidas: 'duas ou mais faturas vencidas; a IA não enviou cobrança',
  multiplas_vencidas_noturno: 'duas ou mais faturas vencidas; no modo noturno a IA tratou só a mais antiga e as demais seguem em aberto',
};

function descreverReativacao(motivo) {
  return MOTIVOS_REATIVACAO[motivo] || 'situação financeira que exige a equipe de reativação';
}

module.exports = {
  hojeEmSaoPaulo, diaISO, classificarTitulo, analisarSituacaoFinanceiraContrato, decidirCobranca, pagamentoConfirmadoDoTitulo,
  descreverReativacao, STATUS_CONTRATO,
};
