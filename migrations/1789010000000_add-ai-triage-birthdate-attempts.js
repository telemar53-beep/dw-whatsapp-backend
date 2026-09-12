exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ai_triage_birthdate_attempts INTEGER NOT NULL DEFAULT 0;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE conversations DROP COLUMN IF EXISTS ai_triage_birthdate_attempts;
  `);
};
