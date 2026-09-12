exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE channels ADD COLUMN IF NOT EXISTS ai_triage_enabled BOOLEAN NOT NULL DEFAULT false;

    ALTER TABLE sectors ADD COLUMN IF NOT EXISTS ai_hint TEXT NOT NULL DEFAULT '';

    ALTER TABLE conversations
      ADD COLUMN IF NOT EXISTS ai_triage_sector_id      UUID REFERENCES sectors(id),
      ADD COLUMN IF NOT EXISTS ai_triage_reason_id      UUID REFERENCES contact_reasons(id),
      ADD COLUMN IF NOT EXISTS ai_triage_confidence     NUMERIC(4,3),
      ADD COLUMN IF NOT EXISTS ai_triage_summary        TEXT,
      ADD COLUMN IF NOT EXISTS ai_triage_identified_by  TEXT,
      ADD COLUMN IF NOT EXISTS ai_triage_low_confidence BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS ai_triage_resolved_by_ai BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS ai_triage_completed_at   TIMESTAMPTZ;
    ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_ai_triage_identified_by_check;
    ALTER TABLE conversations ADD CONSTRAINT conversations_ai_triage_identified_by_check
      CHECK (ai_triage_identified_by IS NULL OR ai_triage_identified_by IN ('memory','phone','cpf','cpf_confirmed','none'));

    ALTER TABLE ai_config
      ADD COLUMN IF NOT EXISTS triage_confidence_threshold NUMERIC(4,3) NOT NULL DEFAULT 0.800,
      ADD COLUMN IF NOT EXISTS triage_max_questions        INTEGER NOT NULL DEFAULT 2,
      ADD COLUMN IF NOT EXISTS triage_timeout_minutes      INTEGER NOT NULL DEFAULT 3,
      ADD COLUMN IF NOT EXISTS triage_extra_instructions   TEXT NOT NULL DEFAULT '';
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE ai_config
      DROP COLUMN IF EXISTS triage_extra_instructions, DROP COLUMN IF EXISTS triage_timeout_minutes,
      DROP COLUMN IF EXISTS triage_max_questions, DROP COLUMN IF EXISTS triage_confidence_threshold;
    ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_ai_triage_identified_by_check;
    ALTER TABLE conversations
      DROP COLUMN IF EXISTS ai_triage_completed_at, DROP COLUMN IF EXISTS ai_triage_resolved_by_ai,
      DROP COLUMN IF EXISTS ai_triage_low_confidence, DROP COLUMN IF EXISTS ai_triage_identified_by,
      DROP COLUMN IF EXISTS ai_triage_summary, DROP COLUMN IF EXISTS ai_triage_confidence,
      DROP COLUMN IF EXISTS ai_triage_reason_id, DROP COLUMN IF EXISTS ai_triage_sector_id;
    ALTER TABLE sectors DROP COLUMN IF EXISTS ai_hint;
    ALTER TABLE channels DROP COLUMN IF EXISTS ai_triage_enabled;
  `);
};
