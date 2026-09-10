exports.up = (pgm) => {
  pgm.sql(`CREATE SEQUENCE IF NOT EXISTS assignment_protocol_seq START 1;`);

  pgm.sql(`
    CREATE TABLE IF NOT EXISTS assignment_message_config (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      enabled BOOLEAN NOT NULL DEFAULT false,
      opening_message TEXT NOT NULL DEFAULT '',
      closing_message TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  pgm.sql(`
    CREATE TABLE IF NOT EXISTS assignment_message_agents (
      agent_id UUID PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE
    );
  `);

  pgm.sql(`
    CREATE TABLE IF NOT EXISTS assignment_message_channels (
      channel_id UUID PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE
    );
  `);

  pgm.sql(`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS protocol_number INTEGER;`);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE conversations DROP COLUMN IF EXISTS protocol_number;`);
  pgm.sql(`DROP TABLE IF EXISTS assignment_message_channels;`);
  pgm.sql(`DROP TABLE IF EXISTS assignment_message_agents;`);
  pgm.sql(`DROP TABLE IF EXISTS assignment_message_config;`);
  pgm.sql(`DROP SEQUENCE IF EXISTS assignment_protocol_seq;`);
};
