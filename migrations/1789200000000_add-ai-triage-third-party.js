exports.up = (pgm) => {
  // Escopo do pedido de boleto/PIX de OUTRA pessoa, vivo por alguns minutos e
  // só nesta conversa. Guarda ids de contrato e o primeiro nome do titular —
  // NUNCA o CPF dele: depois da primeira consulta, as ferramentas de pagamento
  // operam por contratoId. Lida só por consulta dedicada, então não entra nas
  // enumerações de colunas das outras consultas de conversations.
  pgm.sql(`
    ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ai_triage_third_party JSONB;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE conversations DROP COLUMN IF EXISTS ai_triage_third_party;
  `);
};
