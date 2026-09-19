// IDENTIDADE PELA MENSAGEM, PERMISSÃO PELO `reenviar`
//
// Cada fatura sai UMA vez por mensagem do cliente, e uma vez só no total
// enquanto ninguém pedir o reenvio com todas as letras. Quem garante isso são
// as DUAS restrições daqui, e não uma consulta antes do INSERT: entre o SELECT
// e o INSERT caberia a segunda entrega, e dois workers concorrentes passariam
// juntos. O claim é `INSERT ... ON CONFLICT DO NOTHING RETURNING` — é o banco
// decidindo quem ganhou, sem corrida possível (mesmo idioma de
// ai_receipts_used).
//
// O desenho anterior punha a INTENÇÃO na identidade (request_key 'initial' vs
// 'resend:<messageId>'), e isso abria um buraco medido em banco real: na MESMA
// mensagem do cliente, uma tool call sem `reenviar` e outra com `reenviar: true`
// geravam duas chaves diferentes e entregavam DUAS vezes. A identidade é a
// mensagem inbound (message_id); `reenviar` (is_resend) é só a permissão de
// abrir uma entrega nova.
//
// 1) UNIQUE (conversa, ferramenta, contrato, fatura, message_id)
//    Uma entrega por mensagem do cliente, INDEPENDENTE de `reenviar`. É esta
//    que fecha o buraco acima: as duas tool calls da mesma mensagem colidem.
// 2) índice parcial único WHERE is_resend = false
//    Um único envio INICIAL, para sempre. É esta que bloqueia uma mensagem
//    NOVA que não pediu reenvio ("pode mandar" no turno seguinte).
//
// claimed_at sem enqueued_at é uma entrega que começou e não confirmou:
// bloqueia a repetição, mas NÃO autoriza ninguém a dizer que o cliente
// recebeu. enqueued_at (e não sent_at) porque é o que a ferramenta sabe de
// fato: ela ENFILEIRA a mensagem; quem entrega ao WhatsApp é o worker.
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
      message_id      TEXT    NOT NULL,
      is_resend       BOOLEAN NOT NULL DEFAULT false,
      claimed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      enqueued_at     TIMESTAMPTZ,
      CONSTRAINT ai_billing_deliveries_por_mensagem
        UNIQUE (conversation_id, tool, contract_id, invoice_id, message_id)
    );
  `);
  pgm.sql(`
    CREATE UNIQUE INDEX IF NOT EXISTS ai_billing_deliveries_envio_inicial
      ON ai_billing_deliveries (conversation_id, tool, contract_id, invoice_id)
      WHERE is_resend = false;
  `);
};

exports.down = (pgm) => {
  // O índice parcial cai junto com a tabela; o DROP explícito é só para o caso
  // de a tabela sobreviver a uma execução manual pela metade.
  pgm.sql(`DROP INDEX IF EXISTS ai_billing_deliveries_envio_inicial;`);
  pgm.sql(`DROP TABLE IF EXISTS ai_billing_deliveries;`);
};
