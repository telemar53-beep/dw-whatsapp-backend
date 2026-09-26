// Requisito de minimização: o que a IA recebe de um contrato de OUTRA pessoa é
// só o necessário ao fluxo de pagamento. Nunca o payload do SGP, nunca dado
// cadastral. Cada ferramenta nomeia os campos que passam — mesma disciplina de
// allowlist de sgp-normalizer.js, e pelo mesmo motivo: um campo novo da API não
// pode vazar por acaso.
const PROJECOES = {
  consultar_faturas: (r) => ({
    // normalizeInvoices (sgp-normalizer.js) devolve faturaId e
    // vencimentoOriginal/vencimentoAtualizado — nunca "id"/"vencimento"
    // soltos. Regra financeira 0/1/2+ (25/09/2026, decisão do dono, que
    // substitui a anterior "a atualizada prevalece"): o SGP troca o
    // vencimento_atualizado da fatura ATRASADA pela data de hoje (auditado em
    // produção), e a IA passava a ver a fatura vencida como "vence hoje". A
    // data exposta é SEMPRE a original; a atualizada não sai.
    faturas: (r.faturas || []).map((f) => ({
      id: f.faturaId,
      vencimento: f.vencimentoOriginal,
      status: f.status,
    })),
  }),
  enviar_boleto: (r) => ({
    enviado: r.enviado === true,
    ...(r.linhaDigitavelEnviada !== undefined ? { linhaDigitavelEnviada: r.linhaDigitavelEnviada } : {}),
    ...(r.instrucao ? { instrucao: r.instrucao } : {}),
  }),
  gerar_pix: (r) => ({
    enviado: r.enviado === true,
    ...(r.instrucao ? { instrucao: r.instrucao } : {}),
  }),
  gerar_segunda_via: (r) => ({
    // gerado nasce do resultado real (temFaturaAberta), nunca de uma
    // constante: é a mesma classe do defeito real de 2026-09-15 (a IA dizia
    // "enviei o boleto" sem ter enviado) — a confirmação não pode ser um
    // literal solto, tem que vir de um campo que reflete o que aconteceu.
    gerado: r.temFaturaAberta === true,
    ...(r.instrucao ? { instrucao: r.instrucao } : {}),
  }),
};

/** Falha fechado: sem projeção, devolve o mínimo em vez do payload inteiro. */
function minimizarParaTerceiro(nome, resultado) {
  const projecao = PROJECOES[nome];
  if (!projecao) return { ok: true };
  return projecao(resultado || {});
}

module.exports = { minimizarParaTerceiro, PROJECOES };
