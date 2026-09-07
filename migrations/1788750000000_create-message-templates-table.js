exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE message_templates (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      waba_id TEXT NOT NULL,
      meta_template_id TEXT NOT NULL,
      name TEXT NOT NULL,
      language TEXT NOT NULL,
      category TEXT NOT NULL CHECK (category IN ('MARKETING', 'UTILITY')),
      body_text TEXT NOT NULL,
      variable_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'PAUSED', 'DISABLED')),
      rejection_reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (waba_id, name, language)
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE message_templates;
  `);
};
