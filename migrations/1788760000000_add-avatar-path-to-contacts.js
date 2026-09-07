exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE contacts ADD COLUMN avatar_path TEXT;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE contacts DROP COLUMN avatar_path;
  `);
};
