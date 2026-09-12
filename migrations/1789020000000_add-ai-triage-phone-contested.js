exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ai_triage_phone_contested BOOLEAN NOT NULL DEFAULT false;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE conversations DROP COLUMN IF EXISTS ai_triage_phone_contested;
  `);
};
