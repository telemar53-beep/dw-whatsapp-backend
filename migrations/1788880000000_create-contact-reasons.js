exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS contact_reasons (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  pgm.sql(`ALTER TABLE conversation_events ADD COLUMN IF NOT EXISTS reason_id UUID REFERENCES contact_reasons(id);`);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE conversation_events DROP COLUMN IF EXISTS reason_id;`);
  pgm.sql(`DROP TABLE IF EXISTS contact_reasons;`);
};
