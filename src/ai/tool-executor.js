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

// Nunca loga o objeto de erro inteiro: para chamadas ao SGP, err.cause carrega
// a config do axios (token, cpf/cnpj) e o console imprime a cadeia de causa
// inteira. Mesma disciplina já usada em sgp-client.js (só {status} ou {message}).
function logFalha(nome, err) {
  const causa = err && err.cause && err.cause.message;
  console.error(`AI tool ${nome} failed: ${err && err.message}${causa ? ` (cause: ${causa})` : ''}`);
}

/**
 * A ordem destas verificações é parte do design:
 * existe → habilitada → argumentos válidos → o contrato é deste contato →
 * executa com timeout. Nada toca o SGP antes da quarta verificação passar.
 *
 * Tudo fica dentro do try: uma recusa nunca é uma exceção, então qualquer
 * falha inesperada em qualquer um destes passos (inclusive um erro transitório
 * de isToolEnabled, ou um contexto malformado) também vira execution_error
 * em vez de escapar como uma promise rejeitada.
 */
async function executeTool(nome, args, contexto, { timeoutMs = TIMEOUT_PADRAO_MS } = {}) {
  try {
    const tool = findTool(nome);
    if (!tool) return recusa('unknown_tool', nome);

    if (!(await isToolEnabled(nome))) return recusa('tool_disabled', nome);

    const validacao = tool.validar(args);
    if (!validacao.ok) return recusa('invalid_args', validacao.erro);
    const argsValidados = validacao.args;

    if (nome === 'buscar_cliente') {
      // Exceção deliberada, e só para esta ferramenta por nome: é o passo que
      // estabelece a identificação, então não há contrato para conferir. Em
      // troca, trocar de cliente no meio da conversa é proibido — isso exige
      // um atendente humano.
      const jaIdentificado = contexto.contact && contexto.contact.sgpDocument;
      if (jaIdentificado && jaIdentificado !== argsValidados.cpf) {
        return recusa('client_already_identified', null);
      }
    } else if (!tool.isentoDeProprietario) {
      // O padrão é fechado: uma ferramenta só escapa da checagem de propriedade
      // se declarar isentoDeProprietario explicitamente (definir_motivo_atendimento
      // e transferir_atendimento, que só usam contexto.conversationId, nunca um
      // valor vindo do modelo). Uma ferramenta que não declarar nem
      // chaveProprietario nem isentoDeProprietario é recusada — provavelmente um
      // registro incompleto, não uma decisão de segurança que alguém tomou.
      if (typeof tool.chaveProprietario !== 'string') return recusa('tool_misconfigured', nome);
      const valor = argsValidados[tool.chaveProprietario];
      const pertence = (contexto.contracts || []).some((c) => c.id === valor);
      if (!pertence) return recusa('contract_not_owned', valor);
    }

    const resultado = await comTimeout(tool.executar(argsValidados, contexto), timeoutMs);
    if (resultado === Symbol.for('timeout')) return recusa('timeout', nome);
    if (resultado && resultado.ok === false) return recusa('execution_error', resultado.erro);
    return { ok: true, resultado };
  } catch (err) {
    logFalha(nome, err);
    return recusa('execution_error', err && err.message);
  }
}

module.exports = { executeTool };
