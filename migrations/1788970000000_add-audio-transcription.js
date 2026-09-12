const VOCABULARIO_PADRAO =
  'DW Telecom, SGP, PPPoE, ONU, ONT, OLT, Wi-Fi, boleto, PIX, segunda via, ' +
  'fibra, roteador, conexão, plano, Mbps, mega, cliente, contrato, fatura, financeiro';

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE messages
      ADD COLUMN IF NOT EXISTS transcription          TEXT,
      ADD COLUMN IF NOT EXISTS transcription_status   TEXT,
      ADD COLUMN IF NOT EXISTS transcription_detail   TEXT,
      ADD COLUMN IF NOT EXISTS transcription_model    TEXT,
      ADD COLUMN IF NOT EXISTS transcription_ms       INTEGER,
      ADD COLUMN IF NOT EXISTS audio_duration_seconds INTEGER;

    ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_transcription_status_check;
    ALTER TABLE messages ADD CONSTRAINT messages_transcription_status_check
      CHECK (transcription_status IS NULL OR transcription_status IN
        ('pending', 'processing', 'completed', 'failed', 'skipped'));

    ALTER TABLE ai_config
      ADD COLUMN IF NOT EXISTS transcription_enabled     BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS transcription_model       TEXT    NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS transcription_max_seconds INTEGER NOT NULL DEFAULT 300,
      ADD COLUMN IF NOT EXISTS transcription_max_bytes   INTEGER NOT NULL DEFAULT 26214400,
      ADD COLUMN IF NOT EXISTS transcription_prompt      TEXT    NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS transcription_feed_ai     BOOLEAN NOT NULL DEFAULT true;
  `);

  pgm.sql(`UPDATE ai_config SET transcription_prompt = $SEED$${VOCABULARIO_PADRAO}$SEED$ WHERE id = 1 AND transcription_prompt = '';`);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE ai_config
      DROP COLUMN IF EXISTS transcription_feed_ai,
      DROP COLUMN IF EXISTS transcription_prompt,
      DROP COLUMN IF EXISTS transcription_max_bytes,
      DROP COLUMN IF EXISTS transcription_max_seconds,
      DROP COLUMN IF EXISTS transcription_model,
      DROP COLUMN IF EXISTS transcription_enabled;

    ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_transcription_status_check;
    ALTER TABLE messages
      DROP COLUMN IF EXISTS audio_duration_seconds,
      DROP COLUMN IF EXISTS transcription_ms,
      DROP COLUMN IF EXISTS transcription_model,
      DROP COLUMN IF EXISTS transcription_detail,
      DROP COLUMN IF EXISTS transcription_status,
      DROP COLUMN IF EXISTS transcription;
  `);
};
