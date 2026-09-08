exports.up = (pgm) => {
  pgm.sql(`ALTER TABLE messages ADD COLUMN replied_to_message_id UUID REFERENCES messages(id) ON DELETE SET NULL;`);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE messages DROP COLUMN replied_to_message_id;`);
};
