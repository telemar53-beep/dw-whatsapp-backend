exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE channels
      ADD COLUMN triage_enabled BOOLEAN NOT NULL DEFAULT false;

    ALTER TABLE conversations
      ADD COLUMN sector_id UUID REFERENCES sectors(id) ON DELETE SET NULL,
      ADD COLUMN triage_state TEXT CHECK (triage_state IN ('pending', 'completed')),
      ADD COLUMN triage_attempts INTEGER NOT NULL DEFAULT 0;

    CREATE TABLE triage_config (
      id INTEGER PRIMARY KEY DEFAULT 1,
      question_text TEXT NOT NULL,
      confirmation_text TEXT NOT NULL,
      max_attempts INTEGER NOT NULL DEFAULT 2,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    INSERT INTO triage_config (id, question_text, confirmation_text, max_attempts) VALUES (
      1,
      'Para agilizar seu atendimento, escolha uma opção digitando o número correspondente:',
      'Obrigado! Você será atendido em breve.',
      2
    );

    CREATE TABLE triage_options (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      option_number INTEGER NOT NULL UNIQUE,
      sector_id UUID NOT NULL REFERENCES sectors(id) ON DELETE CASCADE,
      keywords TEXT[] NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE triage_options;
    DROP TABLE triage_config;

    ALTER TABLE conversations
      DROP COLUMN sector_id,
      DROP COLUMN triage_state,
      DROP COLUMN triage_attempts;

    ALTER TABLE channels
      DROP COLUMN triage_enabled;
  `);
};
