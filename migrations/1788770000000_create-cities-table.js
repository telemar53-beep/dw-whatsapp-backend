exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE cities (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    ALTER TABLE contacts ADD COLUMN city_id UUID REFERENCES cities(id) ON DELETE SET NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE contacts DROP COLUMN city_id;
    DROP TABLE cities;
  `);
};
