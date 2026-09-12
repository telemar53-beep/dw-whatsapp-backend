const { findTool } = require('./tool-registry');
const { isToolEnabled } = require('./ai-config.repository');

const TIMEOUT_PADRAO_MS = 15000;

function recusa(motivo, detalhe) {
  return { ok: false, motivo, detalhe: detalhe === undefined ? null : detalhe };
}

function comTimeout(promise, ms) {
  let timer;
  const estouro = new Promise((resolve) => {
    timer = setTimeout(() => resolve(Symbol.for('timeout')), ms);
  });
  return Promise.race([promise, estouro]).finally(() => clearTimeout(timer));
}

/**
 * A ordem destas verificações é parte do design:
 * existe → habilitada → argumentos válidos → o contrato é deste contato →
 * executa com timeout. Nada toca o SGP antes da quarta verificação passar.
 */
async function executeTool(nome, args, contexto, { timeoutMs = TIMEOUT_PADRAO_MS } = {}) {
  const tool = findTool(nome);
  if (!tool) return recusa('unknown_tool', nome);

  if (!(await isToolEnabled(nome))) return recusa('tool_disabled', nome);

  const validacao = tool.validar(args);
  if (!validacao.ok) return recusa('invalid_args', validacao.erro);
  const argsValidados = validacao.args;

  if (nome === 'buscar_cliente') {
    // Exceção deliberada: é o passo que estabelece a identificação, então não há
    // contrato para conferir. Em troca, trocar de cliente no meio da conversa é
    // proibido — isso exige um atendente humano.
    const jaIdentificado = contexto.contact && contexto.contact.sgpDocument;
    if (jaIdentificado && jaIdentificado !== argsValidados.cpf) {
      return recusa('client_already_identified', null);
    }
  } else if (argsValidados.contratoId !== undefined) {
    const pertence = (contexto.contracts || []).some((c) => c.id === argsValidados.contratoId);
    if (!pertence) return recusa('contract_not_owned', argsValidados.contratoId);
  }

  try {
    const resultado = await comTimeout(tool.executar(argsValidados, contexto), timeoutMs);
    if (resultado === Symbol.for('timeout')) return recusa('timeout', nome);
    if (resultado && resultado.ok === false) return recusa('execution_error', resultado.erro);
    return { ok: true, resultado };
  } catch (err) {
    console.error(`AI tool ${nome} failed`, err);
    return recusa('execution_error', err.message);
  }
}

module.exports = { executeTool };
