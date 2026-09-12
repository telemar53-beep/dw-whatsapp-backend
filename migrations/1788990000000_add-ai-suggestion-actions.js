exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE ai_suggestions
      ADD COLUMN IF NOT EXISTS acoes_executadas JSONB NOT NULL DEFAULT '[]';
  `);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE ai_suggestions DROP COLUMN IF EXISTS acoes_executadas;`);
};
