exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE platform_integrations
      DROP CONSTRAINT platform_integrations_platform_key,
      ADD COLUMN description TEXT NOT NULL DEFAULT '',
      ADD COLUMN mode TEXT NOT NULL DEFAULT 'freetext' CHECK (mode IN ('freetext', 'template')),
      ADD COLUMN default_template_id UUID REFERENCES message_templates(id) ON DELETE SET NULL;
  `);
  // The pre-existing production row lands on the `DEFAULT ''` above. An empty description makes
  // PUT /api/admin/integrations/sgp/:id reject every update (including the Ativo toggle), so give
  // the already-live Baileys gateway a real name here instead of leaving it unmanageable.
  pgm.sql(`UPDATE platform_integrations SET description = 'SGP (Baileys)' WHERE platform = 'sgp' AND description = ''`);
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
