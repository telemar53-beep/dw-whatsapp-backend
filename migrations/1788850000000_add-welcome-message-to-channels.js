exports.up = (pgm) => {
  pgm.sql(`ALTER TABLE channels ADD COLUMN IF NOT EXISTS welcome_message TEXT;`);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE channels DROP COLUMN IF EXISTS welcome_message;`);
};
