exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE conversation_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id UUID NOT NULL REFERENCES conversations(id),
      event_type TEXT NOT NULL CHECK (event_type IN ('assigned', 'transferred', 'closed', 'reopened')),
      from_agent_id UUID REFERENCES agents(id),
      to_agent_id UUID REFERENCES agents(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE conversation_events;');
};
