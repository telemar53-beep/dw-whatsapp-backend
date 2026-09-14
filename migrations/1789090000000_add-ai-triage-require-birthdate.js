/**
 * Confirmação por data de nascimento na triagem: OPCIONAL, desligada por padrão.
 *
 * Decisão do dono (2026-09-14): "o dado mais importante é o CPF; no site do SGP
 * o cliente loga só com ele". Com a flag desligada, o CPF digitado já identifica
 * o cliente; ligada, o comportamento antigo (CPF + data de nascimento) volta.
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS triage_require_birthdate BOOLEAN NOT NULL DEFAULT false;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE ai_config DROP COLUMN IF EXISTS triage_require_birthdate;
  `);
};
