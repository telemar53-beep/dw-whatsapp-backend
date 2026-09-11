exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS protocol_counters (
      day DATE PRIMARY KEY,
      last_seq INTEGER NOT NULL DEFAULT 0
    );
  `);
  pgm.sql(`ALTER TABLE conversations ALTER COLUMN protocol_number TYPE TEXT USING protocol_number::TEXT;`);
};

exports.down = (pgm) => {
  // Best-effort revert: fails if any row already holds a non-numeric "AAAAMMDD-XXXX"
  // value, which is expected and acceptable once the new format is in production use.
  pgm.sql(`ALTER TABLE conversations ALTER COLUMN protocol_number TYPE INTEGER USING protocol_number::INTEGER;`);
  pgm.sql(`DROP TABLE IF EXISTS protocol_counters;`);
};
