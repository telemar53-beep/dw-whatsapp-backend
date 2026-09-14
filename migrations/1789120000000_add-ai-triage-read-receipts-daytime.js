/**
 * Leitura de comprovante TAMBÉM de dia: OPCIONAL, desligada por padrão.
 *
 * Decisão do dono (2026-09-14): de dia a triagem nem abre a imagem, então um
 * comprovante já usado à noite pode ser reenviado por outro cliente sem que
 * ninguém perceba. Com a flag ligada, a triagem lê a imagem e avisa a
 * atendente — mas NUNCA libera nada de dia.
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS triage_read_receipts_daytime BOOLEAN NOT NULL DEFAULT false;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE ai_config DROP COLUMN IF EXISTS triage_read_receipts_daytime;
  `);
};
