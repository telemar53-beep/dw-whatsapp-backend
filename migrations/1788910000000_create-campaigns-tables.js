exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT,
      channel_id UUID NOT NULL REFERENCES channels(id),
      message_type TEXT NOT NULL CHECK (message_type IN ('text', 'template')),
      content TEXT NOT NULL,
      template_name TEXT,
      template_language TEXT,
      template_variables JSONB,
      created_by UUID NOT NULL REFERENCES agents(id),
      total_recipients INT NOT NULL DEFAULT 0,
      sent_count INT NOT NULL DEFAULT 0,
      failed_count INT NOT NULL DEFAULT 0,
      skipped_count INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS campaign_recipients (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      raw_phone_number TEXT NOT NULL,
      phone_number TEXT NOT NULL,
      display_name TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
      error_message TEXT,
      contact_id UUID REFERENCES contacts(id),
      conversation_id UUID REFERENCES conversations(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      processed_at TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS campaign_recipients_campaign_id_idx ON campaign_recipients(campaign_id);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS campaign_recipients;
    DROP TABLE IF EXISTS campaigns;
  `);
};
