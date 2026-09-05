exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE channels (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      type TEXT NOT NULL CHECK (type IN ('meta_cloud', 'baileys')),
      name TEXT NOT NULL,
      config JSONB NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN ('connected', 'disconnected', 'awaiting_qr')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE channels;');
};
