exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE agents
      ADD COLUMN name TEXT,
      ADD COLUMN active BOOLEAN NOT NULL DEFAULT true;

    UPDATE agents SET name = split_part(email, '@', 1) WHERE name IS NULL;

    ALTER TABLE agents
      ALTER COLUMN name SET NOT NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE agents
      DROP COLUMN name,
      DROP COLUMN active;
  `);
};
