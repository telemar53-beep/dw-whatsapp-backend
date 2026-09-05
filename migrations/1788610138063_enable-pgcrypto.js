exports.up = (pgm) => {
  pgm.sql('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
};

exports.down = (pgm) => {
  pgm.sql('DROP EXTENSION IF EXISTS pgcrypto;');
};
