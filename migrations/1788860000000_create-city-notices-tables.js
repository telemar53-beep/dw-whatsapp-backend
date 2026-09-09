exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS city_notices (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      city_id UUID NOT NULL UNIQUE REFERENCES cities(id) ON DELETE CASCADE,
      message TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT false,
      activated_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS city_notice_deliveries (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      city_notice_id UUID NOT NULL REFERENCES city_notices(id) ON DELETE CASCADE,
      contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (city_notice_id, contact_id)
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS city_notice_deliveries;`);
  pgm.sql(`DROP TABLE IF EXISTS city_notices;`);
};
