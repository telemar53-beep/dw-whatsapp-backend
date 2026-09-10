exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE agents ADD COLUMN IF NOT EXISTS phone TEXT;
    ALTER TABLE agents ADD COLUMN IF NOT EXISTS avatar_path TEXT;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE agents DROP COLUMN IF EXISTS phone;
    ALTER TABLE agents DROP COLUMN IF EXISTS avatar_path;
  `);
};
