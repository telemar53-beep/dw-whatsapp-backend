// Regra financeira 0 / 1 / 2+, ajuste final de 25/09/2026: a trava do fluxo noturno de 2+ é do
// CONTRATO que entrou nele (com o alvo financeiro dele), não da conversa — cada contrato é analisado
// separadamente, e o fluxo de A não pode bloquear a cobrança legítima de B.
//
// `ai_triage_night_invoices` guarda, por contrato, a fatura reservada:
//   { "<contratoId>": { "faturaId": "<invoice_id>", "alvo": "principal" | "terceiro" } }
// A primeira reserva de cada contrato fica. A coluna de fatura ÚNICA da migração anterior
// (1789290001000, que nunca saiu desta máquina) é retirada: ela travava a conversa inteira, e o valor
// dela não diz de qual contrato era. Tudo aditivo para o código que está no ar (nenhum dos dois é lido
// por ele).
exports.up = (pgm) => {
  pgm.sql('ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ai_triage_night_invoices JSONB;');
  pgm.sql('ALTER TABLE conversations DROP COLUMN IF EXISTS ai_triage_night_invoice;');
};

exports.down = (pgm) => {
  pgm.sql('ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ai_triage_night_invoice TEXT;');
  pgm.sql('ALTER TABLE conversations DROP COLUMN IF EXISTS ai_triage_night_invoices;');
};
