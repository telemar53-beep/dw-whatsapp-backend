exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS business_hours_config (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      enabled BOOLEAN NOT NULL DEFAULT false,
      start_time TIME NOT NULL DEFAULT '08:00',
      end_time TIME NOT NULL DEFAULT '18:00',
      message TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  pgm.sql(`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS business_hours_notice_sent_at TIMESTAMPTZ;`);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE conversations DROP COLUMN IF EXISTS business_hours_notice_sent_at;`);
  pgm.sql(`DROP TABLE IF EXISTS business_hours_config;`);
};
