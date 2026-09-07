exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE message_templates
      ADD COLUMN header_type TEXT CHECK (header_type IN ('document', 'image', 'video'));
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE message_templates
      DROP COLUMN header_type;
  `);
};
