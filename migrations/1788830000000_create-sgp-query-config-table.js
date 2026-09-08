exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE sgp_query_config (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      base_url TEXT NOT NULL,
      app TEXT NOT NULL,
      token TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE sgp_query_config;`);
};
