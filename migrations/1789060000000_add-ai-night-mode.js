// Modo noturno com IA: interruptor por canal e janela (início/fim) na
// configuração da IA. Nulos na janela = noturno nunca ativa.
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE channels ADD COLUMN IF NOT EXISTS ai_night_mode_enabled BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE ai_config
      ADD COLUMN IF NOT EXISTS night_start_time TIME NULL,
      ADD COLUMN IF NOT EXISTS night_end_time TIME NULL;
  `);
};
exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE ai_config DROP COLUMN IF EXISTS night_end_time, DROP COLUMN IF EXISTS night_start_time;
    ALTER TABLE channels DROP COLUMN IF EXISTS ai_night_mode_enabled;
  `);
};
