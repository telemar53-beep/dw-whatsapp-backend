exports.up = (pgm) => {
  pgm.sql(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS internal_note TEXT;`);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE contacts DROP COLUMN IF EXISTS internal_note;`);
};
