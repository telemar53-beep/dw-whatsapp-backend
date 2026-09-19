const { getPool } = require('../db/pool');

// A entrega de uma fatura é reivindicada ANTES de qualquer efeito externo, e a
// reivindicação é atômica: `INSERT ... ON CONFLICT DO NOTHING RETURNING`. Duas
// execuções simultâneas do mesmo envio disputam a mesma linha e só uma recebe
// RETURNING — a outra volta de mãos vazias e sabe que perdeu. Uma consulta
// antes do INSERT não serviria: entre o SELECT e o INSERT cabe a segunda
// entrega, e é exatamente o cliente recebendo dois boletos.
const COLUNAS = 'id, conversation_id, tool, contract_id, invoice_id, request_key, claimed_at, sent_at';

function paraRegistro(linha) {
  if (!linha) return null;
  return {
    id: linha.id,
    conversationId: linha.conversation_id,
    tool: linha.tool,
    contractId: linha.contract_id,
    invoiceId: linha.invoice_id,
    requestKey: linha.request_key,
    claimedAt: linha.claimed_at,
    sentAt: linha.sent_at,
  };
}

/**
 * Reivindica a entrega desta fatura, por esta ferramenta, nesta conversa, sob
 * esta chave de pedido.
 *
 * Devolve `{ obtido, registro }`:
 * - `obtido: true` — a linha é nova e quem chamou pode seguir para o envio.
 *   `registro.id` é o que `markDeliverySent`/`releaseDelivery` recebem depois.
 * - `obtido: false` — já havia um claim. `registro` é o que está gravado, para
 *   quem chamou distinguir duas situações que NÃO são a mesma: com `sentAt`, a
 *   entrega se completou; só com `claimedAt`, uma tentativa começou e nunca
 *   confirmou — e ninguém pode afirmar que o cliente recebeu.
 *
 * `registro` pode vir null no caso raro de a linha concorrente ainda não estar
 * visível; quem chama trata isso como o caso incerto (falha fechado).
 */
async function claimDelivery({ conversationId, tool, contractId, invoiceId, requestKey }) {
  const valores = [conversationId, tool, contractId, String(invoiceId), requestKey];
  const inserido = await getPool().query(
    `INSERT INTO ai_billing_deliveries (conversation_id, tool, contract_id, invoice_id, request_key)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (conversation_id, tool, contract_id, invoice_id, request_key) DO NOTHING
     RETURNING ${COLUNAS}`,
    valores
  );
  if (inserido.rowCount === 1) return { obtido: true, registro: paraRegistro(inserido.rows[0]) };

  const existente = await getPool().query(
    `SELECT ${COLUNAS} FROM ai_billing_deliveries
      WHERE conversation_id = $1 AND tool = $2 AND contract_id = $3 AND invoice_id = $4 AND request_key = $5`,
    valores
  );
  return { obtido: false, registro: paraRegistro(existente.rows[0]) };
}

/** Zona C: todos os efeitos externos voltaram. A entrega passa a ser um fato. */
async function markDeliverySent(id) {
  if (!id) return;
  await getPool().query('UPDATE ai_billing_deliveries SET sent_at = now() WHERE id = $1', [id]);
}

/**
 * Zona A, e SÓ a Zona A: nada saiu do sistema ainda, então devolver o claim é
 * correto — a próxima tentativa tem de poder entregar. Depois do primeiro
 * efeito externo esta função nunca é chamada; o `sent_at IS NULL` é a rede de
 * baixo, para que nem um chamador enganado consiga apagar uma entrega
 * confirmada e abrir caminho para a segunda.
 */
async function releaseDelivery(id) {
  if (!id) return;
  await getPool().query('DELETE FROM ai_billing_deliveries WHERE id = $1 AND sent_at IS NULL', [id]);
}

/** Leitura direta do claim (auditoria e testes); null quando não existe. */
async function findDelivery({ conversationId, tool, contractId, invoiceId, requestKey }) {
  const resultado = await getPool().query(
    `SELECT ${COLUNAS} FROM ai_billing_deliveries
      WHERE conversation_id = $1 AND tool = $2 AND contract_id = $3 AND invoice_id = $4 AND request_key = $5`,
    [conversationId, tool, contractId, String(invoiceId), requestKey]
  );
  return paraRegistro(resultado.rows[0]);
}

module.exports = { claimDelivery, markDeliverySent, releaseDelivery, findDelivery };
