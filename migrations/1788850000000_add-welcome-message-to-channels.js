exports.up = (pgm) => {
  pgm.sql(`ALTER TABLE channels ADD COLUMN welcome_message TEXT;`);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE channels DROP COLUMN welcome_message;`);
};
