// Cada fatura sai UMA vez por pedido do cliente. Quem garante isso é a
// restrição UNIQUE daqui, e não uma consulta antes do INSERT: entre o SELECT e
// o INSERT caberia a segunda entrega, e dois workers concorrentes passariam
// juntos. O claim é `INSERT ... ON CONFLICT DO NOTHING RETURNING` — é o banco
// decidindo quem ganhou, sem corrida possível (mesmo idioma de
// ai_receipts_used).
//
// request_key é o que separa "a mesma entrega pedida duas vezes" de "o cliente
// pediu o reenvio": 'initial' na primeira, 'resend:<messageId>' quando o
// cliente pediu de novo com todas as letras. O messageId é o da mensagem
// inbound do turno, então um pedido novo abre uma chave nova e dois disparos da
// MESMA mensagem caem na mesma.
//
// claimed_at sem sent_at é uma entrega que começou e não confirmou: bloqueia a
// repetição, mas NÃO autoriza ninguém a dizer que o cliente recebeu.
//
// MINIMIZAÇÃO (Fase 3): só ids. Nenhum valor, nenhuma linha digitável, nenhum
// código PIX, nenhum dado pessoal — nada aqui descreve a fatura, só a aponta.
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS ai_billing_deliveries (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id UUID    NOT NULL,
      tool            TEXT    NOT NULL,
      contract_id     INTEGER NOT NULL,
      invoice_id      TEXT    NOT NULL,
      request_key     TEXT    NOT NULL,
      claimed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      sent_at         TIMESTAMPTZ,
      UNIQUE (conversation_id, tool, contract_id, invoice_id, request_key)
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS ai_billing_deliveries;`);
};
