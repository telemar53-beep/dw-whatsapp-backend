exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE sectors (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE agent_sectors (
      agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      sector_id UUID NOT NULL REFERENCES sectors(id) ON DELETE CASCADE,
      PRIMARY KEY (agent_id, sector_id)
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE agent_sectors;
    DROP TABLE sectors;
  `);
};
