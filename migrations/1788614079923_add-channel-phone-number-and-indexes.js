exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE channels ADD COLUMN phone_number TEXT;
    CREATE UNIQUE INDEX channels_phone_number_unique ON channels (phone_number) WHERE phone_number IS NOT NULL;
    CREATE INDEX messages_conversation_id_created_at_idx ON messages (conversation_id, created_at);
    CREATE INDEX conversations_status_idx ON conversations (status);
    CREATE INDEX conversations_assigned_agent_id_idx ON conversations (assigned_agent_id);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX conversations_assigned_agent_id_idx;
    DROP INDEX conversations_status_idx;
    DROP INDEX messages_conversation_id_created_at_idx;
    DROP INDEX channels_phone_number_unique;
    ALTER TABLE channels DROP COLUMN phone_number;
  `);
};
