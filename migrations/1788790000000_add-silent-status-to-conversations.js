exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE conversations DROP CONSTRAINT conversations_status_check;
    ALTER TABLE conversations ADD CONSTRAINT conversations_status_check
      CHECK (status IN ('waiting', 'assigned', 'closed', 'silent'));
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE conversations DROP CONSTRAINT conversations_status_check;
    ALTER TABLE conversations ADD CONSTRAINT conversations_status_check
      CHECK (status IN ('waiting', 'assigned', 'closed'));
  `);
};
