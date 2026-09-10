exports.up = (pgm) => {
  pgm.sql(`ALTER TABLE channels DROP CONSTRAINT IF EXISTS channels_type_check;`);
  pgm.sql(`ALTER TABLE channels ADD CONSTRAINT channels_type_check CHECK (type IN ('meta_cloud', 'baileys', '360dialog'));`);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE channels DROP CONSTRAINT IF EXISTS channels_type_check;`);
  pgm.sql(`ALTER TABLE channels ADD CONSTRAINT channels_type_check CHECK (type IN ('meta_cloud', 'baileys'));`);
};
