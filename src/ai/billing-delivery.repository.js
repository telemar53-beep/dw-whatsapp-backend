const { getPool } = require('../db/pool');

// A entrega de uma fatura é reivindicada ANTES de qualquer efeito externo, e a
// reivindicação é atômica: `INSERT ... ON CONFLICT DO NOTHING RETURNING`. Duas
// execuções simultâneas do mesmo envio disputam a mesma linha e só uma recebe
// RETURNING — a outra volta de mãos vazias e sabe que perdeu. Uma consulta
// antes do INSERT não serviria: entre o SELECT e o INSERT cabe a segunda
// entrega, e é exatamente o cliente recebendo dois boletos.
//
// As DUAS propriedades vivem no banco (ver a migração 1789210000000):
//   1. UNIQUE (conversa, ferramenta, contrato, fatura, message_id)
//      → uma entrega por mensagem do cliente, independente de `reenviar`.
//   2. índice parcial único WHERE is_resend = false
//      → um único envio INICIAL, para sempre.
// Nenhuma das duas é conferida em JavaScript: não há SELECT antes do INSERT.
const COLUNAS = 'id, conversation_id, tool, contract_id, invoice_id, message_id, is_resend, claimed_at, enqueued_at';

function paraRegistro(linha) {
  if (!linha) return null;
  return {
    id: linha.id,
    conversationId: linha.conversation_id,
    tool: linha.tool,
    contractId: linha.contract_id,
    invoiceId: linha.invoice_id,
    messageId: linha.message_id,
    isResend: linha.is_resend,
    claimedAt: linha.claimed_at,
    enqueuedAt: linha.enqueued_at,
  };
}

/**
 * Reivindica a entrega desta fatura, por esta ferramenta, nesta conversa, para
 * ESTA mensagem do cliente.
 *
 * `messageId` é a IDENTIDADE da tentativa (a mensagem inbound do turno);
 * `isResend` é só a PERMISSÃO de abrir uma entrega nova. Trocar os dois papéis
 * foi o defeito do desenho anterior: a mesma mensagem produzia duas chaves e
 * entregava duas vezes.
 *
 * Devolve `{ obtido, registro }`:
 * - `obtido: true` — a linha é nova e quem chamou pode seguir para o envio.
 *   `registro.id` é o que `markDeliveryEnqueued`/`releaseDelivery` recebem.
 * - `obtido: false` — alguma das duas restrições bloqueou. `registro` é a linha
 *   que bloqueou, para quem chamou distinguir duas situações que NÃO são a
 *   mesma: com `enqueuedAt`, a entrega chegou a ser enfileirada; só com
 *   `claimedAt`, uma tentativa começou e nunca confirmou — e ninguém pode
 *   afirmar que o cliente recebeu.
 *
 * `registro` pode vir null no caso raro de a linha concorrente ainda não estar
 * visível; quem chama trata isso como o caso incerto (falha fechado).
 */
async function claimDelivery({ conversationId, tool, contractId, invoiceId, messageId, isResend }) {
  const alvo = [conversationId, tool, contractId, String(invoiceId), String(messageId)];
  // `ON CONFLICT DO NOTHING` NU, sem alvo nomeado: com duas restrições não dá
  // para nomear uma só, e nomear uma deixaria a outra estourar como erro 23505
  // em vez de virar "já existe". O DO NOTHING sem alvo cobre as duas.
  const inserido = await getPool().query(
    `INSERT INTO ai_billing_deliveries (conversation_id, tool, contract_id, invoice_id, message_id, is_resend)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT DO NOTHING
     RETURNING ${COLUNAS}`,
    [...alvo, Boolean(isResend)]
  );
  if (inserido.rowCount === 1) return { obtido: true, registro: paraRegistro(inserido.rows[0]) };

  // Perdeu. A linha que bloqueou pode ser a da MESMA mensagem (restrição 1) ou
  // a do envio inicial de outra mensagem (restrição 2), então a busca é por
  // (conversa, ferramenta, contrato, fatura) — qualquer message_id. A ordem
  // devolve primeiro a da mesma mensagem, que é a bloqueadora exata quando
  // existe; senão a inicial, que é a única outra capaz de bloquear.
  const existente = await getPool().query(
    `SELECT ${COLUNAS} FROM ai_billing_deliveries
      WHERE conversation_id = $1 AND tool = $2 AND contract_id = $3 AND invoice_id = $4
      ORDER BY (message_id = $5) DESC, is_resend ASC, claimed_at ASC
      LIMIT 1`,
    alvo
  );
  return { obtido: false, registro: paraRegistro(existente.rows[0]) };
}

/**
 * Zona C: todos os efeitos externos voltaram. A mensagem já está gravada e
 * enfileirada — é o máximo que esta camada pode afirmar, e por isso a coluna
 * se chama enqueued_at e não sent_at.
 */
async function markDeliveryEnqueued(id) {
  if (!id) return;
  await getPool().query('UPDATE ai_billing_deliveries SET enqueued_at = now() WHERE id = $1', [id]);
}

/**
 * Zona A, e SÓ a Zona A: nada saiu do sistema ainda, então devolver o claim é
 * correto — a próxima tentativa tem de poder entregar. Depois do primeiro
 * efeito externo esta função nunca é chamada; o `enqueued_at IS NULL` é a rede
 * de baixo, para que nem um chamador enganado consiga apagar uma entrega já
 * enfileirada e abrir caminho para a segunda.
 */
async function releaseDelivery(id) {
  if (!id) return;
  await getPool().query('DELETE FROM ai_billing_deliveries WHERE id = $1 AND enqueued_at IS NULL', [id]);
}

/** Leitura direta do claim (auditoria e testes); null quando não existe. */
async function findDelivery({ conversationId, tool, contractId, invoiceId, messageId }) {
  const resultado = await getPool().query(
    `SELECT ${COLUNAS} FROM ai_billing_deliveries
      WHERE conversation_id = $1 AND tool = $2 AND contract_id = $3 AND invoice_id = $4 AND message_id = $5`,
    [conversationId, tool, contractId, String(invoiceId), String(messageId)]
  );
  return paraRegistro(resultado.rows[0]);
}

/**
 * A última cobrança que de fato saiu nesta conversa (enfileirada): é ELA que a conferência do
 * pagamento relê no SGP, pelo mesmo invoice_id (regra financeira 0/1/2+, 25/09/2026).
 */
async function findLatestEnqueuedDelivery(conversationId) {
  const resultado = await getPool().query(
    `SELECT ${COLUNAS} FROM ai_billing_deliveries
      WHERE conversation_id = $1 AND enqueued_at IS NOT NULL
      ORDER BY enqueued_at DESC, claimed_at DESC
      LIMIT 1`,
    [conversationId]
  );
  return paraRegistro(resultado.rows[0]);
}

module.exports = { claimDelivery, markDeliveryEnqueued, releaseDelivery, findDelivery, findLatestEnqueuedDelivery };
