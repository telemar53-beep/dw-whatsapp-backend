exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE messages
      ALTER COLUMN content DROP NOT NULL,
      ADD COLUMN message_type TEXT NOT NULL DEFAULT 'text'
        CHECK (message_type IN ('text', 'image', 'document', 'audio', 'video', 'sticker', 'location')),
      ADD COLUMN media_path TEXT,
      ADD COLUMN media_mime_type TEXT,
      ADD COLUMN media_filename TEXT,
      ADD COLUMN location_latitude DOUBLE PRECISION,
      ADD COLUMN location_longitude DOUBLE PRECISION;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE messages
      DROP COLUMN message_type,
      DROP COLUMN media_path,
      DROP COLUMN media_mime_type,
      DROP COLUMN media_filename,
      DROP COLUMN location_latitude,
      DROP COLUMN location_longitude,
      ALTER COLUMN content SET NOT NULL;
  `);
};
