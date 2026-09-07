exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE platform_integrations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      platform TEXT NOT NULL CHECK (platform IN ('sgp')),
      channel_id UUID NOT NULL REFERENCES channels(id),
      api_key_hash TEXT,
      enabled BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (platform)
    );

    CREATE TABLE sgp_dispatches (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      reference_id TEXT NOT NULL UNIQUE,
      conversation_id UUID NOT NULL REFERENCES conversations(id),
      message_id UUID NOT NULL REFERENCES messages(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE sgp_dispatches;
    DROP TABLE platform_integrations;
  `);
};
