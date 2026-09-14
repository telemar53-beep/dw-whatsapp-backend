exports.up = (pgm) => {
  pgm.sql(`ALTER TABLE agents DROP CONSTRAINT IF EXISTS agents_role_check;`);
  pgm.sql(`ALTER TABLE agents ADD CONSTRAINT agents_role_check CHECK (role IN ('agent', 'admin', 'manager'));`);
  pgm.sql(`ALTER TABLE agents ADD COLUMN IF NOT EXISTS can_manage_integrations BOOLEAN NOT NULL DEFAULT false;`);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE agents DROP COLUMN IF EXISTS can_manage_integrations;`);
  pgm.sql(`ALTER TABLE agents DROP CONSTRAINT IF EXISTS agents_role_check;`);
  pgm.sql(`ALTER TABLE agents ADD CONSTRAINT agents_role_check CHECK (role IN ('agent', 'admin'));`);
};
