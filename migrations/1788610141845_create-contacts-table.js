exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE contacts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      phone_number TEXT NOT NULL UNIQUE,
      display_name TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE contacts;');
};
