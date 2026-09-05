exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE conversations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      contact_id UUID NOT NULL REFERENCES contacts(id),
      channel_id UUID NOT NULL REFERENCES channels(id),
      status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'assigned', 'closed')),
      assigned_agent_id UUID REFERENCES agents(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE UNIQUE INDEX conversations_open_per_contact_channel
      ON conversations (contact_id, channel_id)
      WHERE status <> 'closed';
  `);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE conversations;');
};
