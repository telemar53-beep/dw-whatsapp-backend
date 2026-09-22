// A whitelist do update parcial de triagem, num módulo só dela.
//
// Ela é usada em dois lugares: a rota, para recusar campo que não pode ser
// escrito, e o repositório, para montar o SET. Morar num dos dois faria o
// outro depender de um módulo que o teste mocka — e o automock do Jest
// esvazia arrays e objetos, o que transformaria a whitelist em lista vazia
// dentro do teste sem ninguém perceber: a rota passaria a recusar tudo, ou a
// aceitar tudo, dependendo do lado. Aqui não há o que mockar.
//
// A lista é fechada de propósito. `api_key`, `system_prompt`, `model`,
// `mode`, as colunas de transcrição e as permissões de ferramenta NÃO estão
// aqui: cada uma tem regra própria na rota que já a escreve, e um segundo
// caminho de escrita passaria por cima dessas regras.
const COLUNAS_ATUALIZAVEIS = {
  triageConfidenceThreshold: 'triage_confidence_threshold',
  triageMaxQuestions: 'triage_max_questions',
  triageTimeoutMinutes: 'triage_timeout_minutes',
  triageExtraInstructions: 'triage_extra_instructions',
  triageResolvedReasonId: 'triage_resolved_reason_id',
  nightStartTime: 'night_start_time',
  nightEndTime: 'night_end_time',
  triageReadReceiptsDaytime: 'triage_read_receipts_daytime',
};

const CAMPOS_ATUALIZAVEIS = Object.keys(COLUNAS_ATUALIZAVEIS);

module.exports = { COLUNAS_ATUALIZAVEIS, CAMPOS_ATUALIZAVEIS };
