exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE platform_integrations
      DROP CONSTRAINT platform_integrations_platform_key,
      ADD COLUMN description TEXT NOT NULL DEFAULT '',
      ADD COLUMN mode TEXT NOT NULL DEFAULT 'freetext' CHECK (mode IN ('freetext', 'template')),
      ADD COLUMN default_template_id UUID REFERENCES message_templates(id) ON DELETE SET NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE platform_integrations
      DROP COLUMN default_template_id,
      DROP COLUMN mode,
      DROP COLUMN description,
      ADD CONSTRAINT platform_integrations_platform_key UNIQUE (platform);
  `);
};
