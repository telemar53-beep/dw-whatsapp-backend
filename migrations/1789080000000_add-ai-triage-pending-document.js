/**
 * CPF/CNPJ digitado na triagem, ainda não confirmado pela data de nascimento.
 * Apagado ao confirmar (confirmar_nascimento) ou ao esquecer a identificação.
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ai_triage_pending_document TEXT NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE conversations DROP COLUMN IF EXISTS ai_triage_pending_document;
  `);
};
