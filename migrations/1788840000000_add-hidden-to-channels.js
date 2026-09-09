exports.up = (pgm) => {
  pgm.sql(`ALTER TABLE channels ADD COLUMN hidden BOOLEAN NOT NULL DEFAULT false;`);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE channels DROP COLUMN hidden;`);
};
