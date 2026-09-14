// Um comprovante desbloqueia UMA vez. O id da transação lido pela visão é
// único aqui: um comprovante emprestado a outra pessoa bate na restrição e a
// segunda liberação é recusada.
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS ai_receipts_used (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      transaction_id TEXT NOT NULL UNIQUE,
      contact_id     UUID REFERENCES contacts(id),
      contract_id    INTEGER,
      used_at        TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS ai_receipts_used;`);
};
