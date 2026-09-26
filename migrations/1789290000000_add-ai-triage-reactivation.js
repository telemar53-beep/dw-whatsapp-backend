// Regra financeira 0 / 1 / 2+ (25/09/2026): o motivo pelo qual a triagem precisa ir para a
// Reativação — contrato cancelado, 2+ vencidas de dia, ou 2+ vencidas à noite depois de a IA tratar
// só a mais antiga. É FATO do sistema (a decisão do código sobre os títulos do SGP), não texto da IA,
// e precisa valer nos turnos seguintes e no timeout: com ele, a conclusão vai para a Reativação e o
// atendimento nunca fecha como "Resolvido pela IA".
//
// Aditiva e nula: conversa antiga não tem motivo, que é a verdade sobre ela.
exports.up = (pgm) => {
  pgm.sql('ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ai_triage_reactivation TEXT;');
};

exports.down = (pgm) => {
  pgm.sql('ALTER TABLE conversations DROP COLUMN IF EXISTS ai_triage_reactivation;');
};
