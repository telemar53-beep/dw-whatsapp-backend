exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id UUID NOT NULL REFERENCES conversations(id),
      direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
      content TEXT NOT NULL,
      whatsapp_message_id TEXT,
      status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'delivered', 'read', 'failed', 'received')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE messages;');
};
