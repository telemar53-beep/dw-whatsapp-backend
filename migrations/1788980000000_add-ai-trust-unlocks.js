exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS ai_trust_unlocks (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      contact_id    UUID REFERENCES contacts(id),
      contract_id   INTEGER NOT NULL,
      protocolo     TEXT,
      liberado_dias INTEGER,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS ai_trust_unlocks_contract
      ON ai_trust_unlocks (contract_id, created_at DESC);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS ai_trust_unlocks;`);
};
