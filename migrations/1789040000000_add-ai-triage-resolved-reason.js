exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE ai_config
      ADD COLUMN IF NOT EXISTS triage_resolved_reason_id UUID NULL REFERENCES contact_reasons(id) ON DELETE SET NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE ai_config DROP COLUMN IF EXISTS triage_resolved_reason_id;
  `);
};
