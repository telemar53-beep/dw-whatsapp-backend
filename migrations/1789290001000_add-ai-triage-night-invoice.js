// Regra financeira 0 / 1 / 2+, ajuste de 25/09/2026: a conversa que entrou no fluxo noturno de
// 2+ vencidas trata SÓ a fatura vencida mais antiga escolhida nele. Esta coluna guarda o
// invoice_id dessa fatura — o primeiro fica, e nenhuma outra cobrança sai automaticamente nesta
// conversa depois (nem com a primeira paga, nem com a contagem caindo). O reenvio da MESMA fatura
// continua com a idempotência de ai_billing_deliveries.
//
// É FATO do sistema (a reserva é atômica, antes da entrega), não texto da IA. Aditiva e nula:
// conversa antiga não entrou nesse fluxo.
exports.up = (pgm) => {
  pgm.sql('ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ai_triage_night_invoice TEXT;');
};

exports.down = (pgm) => {
  pgm.sql('ALTER TABLE conversations DROP COLUMN IF EXISTS ai_triage_night_invoice;');
};
