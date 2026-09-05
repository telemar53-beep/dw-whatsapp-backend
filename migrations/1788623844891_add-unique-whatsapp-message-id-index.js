exports.up = (pgm) => {
  pgm.sql(`
    CREATE UNIQUE INDEX messages_whatsapp_message_id_unique
      ON messages (whatsapp_message_id)
      WHERE whatsapp_message_id IS NOT NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql('DROP INDEX messages_whatsapp_message_id_unique;');
};
