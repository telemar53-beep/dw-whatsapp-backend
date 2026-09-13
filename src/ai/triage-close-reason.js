const { getAiConfig } = require('./ai-config.repository');
const { findReasonById } = require('../reasons/reason.repository');

/**
 * O motivo com que a IA pode encerrar o atendimento sozinha, ou null quando
 * ela NÃO pode — e "não pode" tem três formas: o admin não escolheu motivo
 * nenhum, o motivo escolhido não existe mais, ou ele foi DESATIVADO.
 *
 * A coluna ai_config.triage_resolved_reason_id de propósito não tem chave
 * estrangeira (ver a migração 1789040000000), então a garantia de que o id
 * ainda aponta para um motivo válido é feita aqui, a cada leitura — e é a
 * única que cobre o caso real, a desativação, que FK nenhuma pegaria.
 *
 * Quem só monta texto para o prompt não precisa passar por aqui: lá o pior
 * caso é uma frase a mais, não um encerramento indevido.
 */
async function motivoDeEncerramentoAtivo() {
  const config = await getAiConfig();
  if (!config || !config.triageResolvedReasonId) return null;
  const motivo = await findReasonById(config.triageResolvedReasonId);
  if (!motivo || !motivo.active) return null;
  return motivo.id;
}

module.exports = { motivoDeEncerramentoAtivo };
