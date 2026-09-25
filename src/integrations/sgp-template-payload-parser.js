class SgpTemplatePayloadError extends Error {}

function parseSgpTemplatePayload(raw) {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new SgpTemplatePayloadError('content is required');
  }
  const segments = raw.split('||');
  const variablesSegment = segments[0];
  if (!variablesSegment.startsWith('variables=')) {
    throw new SgpTemplatePayloadError('content must start with "variables="');
  }
  const variablesRaw = variablesSegment.slice('variables='.length);
  const variables = variablesRaw.length > 0 ? variablesRaw.split('|') : [];

  const fields = {};
  for (const segment of segments.slice(1)) {
    const eqIndex = segment.indexOf('=');
    if (eqIndex === -1) {
      throw new SgpTemplatePayloadError(`Malformed segment "${segment}" — expected key=value`);
    }
    const key = segment.slice(0, eqIndex);
    const value = segment.slice(eqIndex + 1);
    fields[key] = value;
  }

  if (!fields.template) {
    throw new SgpTemplatePayloadError('content must include "template=<name>"');
  }
  const hasHeaderLink = fields.header_link !== undefined;
  const hasHeaderType = fields.header_type !== undefined;
  if (hasHeaderLink !== hasHeaderType) {
    throw new SgpTemplatePayloadError('header_link and header_type must both be present or both be absent');
  }

  return {
    variables,
    templateName: fields.template,
    headerLink: hasHeaderLink ? fields.header_link : null,
    headerType: hasHeaderType ? fields.header_type : null,
  };
}

// Fase 1B (25/09/2026): blocos OPCIONAIS e aditivos que a regra do SGP pode acrescentar à
// mensagem, depois de `template=` — `||tipo=...||vencimento=...||fatura=...||contrato=...`.
// Nunca derrubam um disparo: bloco inválido é descartado sozinho, chave desconhecida é
// ignorada, e parseSgpTemplatePayload continua devolvendo exatamente o mesmo de antes.
//
// A semântica vem SÓ dos blocos nomeados. As variáveis do template são posicionais e o
// significado de cada posição é da regra do SGP, não do sistema: sem `vencimento=`, nenhuma
// "terceira variável" vira vencimento.
//
// Lista fechada: só entra o tipo confirmado como regra ativa no SGP (D7). Ampliar aqui quando
// outra regra for confirmada; qualquer outro valor, ou a ausência, é 'desconhecido'.
const TIPOS_DE_DISPARO = ['fatura_disponivel'];
const TIPO_DESCONHECIDO = 'desconhecido';

function dataValida(dia, mes, ano) {
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  return d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
}

/** 'DD/MM/AAAA' ou 'AAAA-MM-DD' de uma data que existe → 'DD/MM/AAAA'; qualquer outra coisa → null. */
function normalizarVencimento(valor) {
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(valor);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor);
  const [dia, mes, ano] = br ? [br[1], br[2], br[3]] : iso ? [iso[3], iso[2], iso[1]] : [];
  if (!dia || !dataValida(Number(dia), Number(mes), Number(ano))) return null;
  return `${dia}/${mes}/${ano}`;
}

function extrairCamposDoDisparo(raw) {
  const campos = { tipo: TIPO_DESCONHECIDO };
  if (typeof raw !== 'string') return campos;
  for (const segmento of raw.split('||').slice(1)) {
    const eq = segmento.indexOf('=');
    if (eq === -1) continue;
    const chave = segmento.slice(0, eq).trim();
    const valor = segmento.slice(eq + 1).trim();
    if (chave === 'tipo') {
      const tipo = valor.toLowerCase();
      if (TIPOS_DE_DISPARO.includes(tipo)) campos.tipo = tipo;
    } else if (chave === 'vencimento') {
      const vencimento = normalizarVencimento(valor);
      if (vencimento) campos.vencimento = vencimento;
    } else if (chave === 'fatura' && /^\d{1,20}$/.test(valor)) {
      campos.faturaId = valor;
    } else if (chave === 'contrato' && /^\d{1,20}$/.test(valor)) {
      campos.contratoId = valor;
    }
  }
  return campos;
}

module.exports = { parseSgpTemplatePayload, SgpTemplatePayloadError, extrairCamposDoDisparo, TIPOS_DE_DISPARO, TIPO_DESCONHECIDO };
