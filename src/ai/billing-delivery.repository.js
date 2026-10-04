const { getPool } = require('../db/pool');
const { parametrosDaCondicaoDoEscopo } = require('../conversations/conversation.repository');

// Segurança final da F2 (03/10/2026): a condição sobre o alvo financeiro da conversa — o escopo de terceiro
// (conversations.ai_triage_third_party) tem de estar num dos estados que o turno conhece: coluna vazia, a marca
// de um escopo, ou o conteúdo de um escopo de antes da marca. O mesmo critério da gravação condicional.
const CONDICAO_DO_ALVO = `(($7::boolean AND c.ai_triage_third_party IS NULL)
          OR (c.ai_triage_third_party ->> 'marca') = ANY($8::text[])
          OR c.ai_triage_third_party = ANY($9::jsonb[]))`;

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
async function claimDelivery({ conversationId, tool, contractId, invoiceId, messageId, isResend, condicaoDoAlvo = null }) {
  const alvo = [conversationId, tool, contractId, String(invoiceId), String(messageId)];
  // `ON CONFLICT DO NOTHING` NU, sem alvo nomeado: com duas restrições não dá
  // para nomear uma só, e nomear uma deixaria a outra estourar como erro 23505
  // em vez de virar "já existe". O DO NOTHING sem alvo cobre as duas.
  let inserido;
  if (!condicaoDoAlvo) {
    inserido = await getPool().query(
      `INSERT INTO ai_billing_deliveries (conversation_id, tool, contract_id, invoice_id, message_id, is_resend)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT DO NOTHING
       RETURNING ${COLUNAS}`,
      [...alvo, Boolean(isResend)]
    );
  } else {
    // Segurança final da F2 (03/10/2026): a autorização vale NA RESERVA, que é o ponto de não retorno antes de
    // qualquer efeito para o cliente. A mesma instrução confere o alvo atual e trava a linha da conversa (FOR SHARE).
    // Uma mudança do alvo já gravada faz a reserva não acontecer; uma em andamento a faz esperar, e a condição é
    // reavaliada sobre o valor novo; a mudança que chega depois da reserva espera por ela e fica ordenada depois
    // da entrega. Não há leitura separada seguida de envio.
    const { aceitaNulo, marcas, legados } = parametrosDaCondicaoDoEscopo(condicaoDoAlvo);
    inserido = await getPool().query(
      `WITH autorizado AS (
         SELECT c.id FROM conversations c
          WHERE c.id = $1::uuid AND ${CONDICAO_DO_ALVO}
          FOR SHARE
       )
       INSERT INTO ai_billing_deliveries (conversation_id, tool, contract_id, invoice_id, message_id, is_resend)
       SELECT $1::uuid, $2::text, $3::integer, $4::text, $5::text, $6::boolean FROM autorizado
       ON CONFLICT DO NOTHING
       RETURNING ${COLUNAS}`,
      [...alvo, Boolean(isResend), aceitaNulo, marcas, legados]
    );
    if (inserido.rowCount === 0) {
      // Só para escolher a resposta (a autorização já foi decidida acima): o alvo mudou, ou é duplicata.
      const vale = await getPool().query(
        `SELECT EXISTS (SELECT 1 FROM conversations c WHERE c.id = $1::uuid AND ${CONDICAO_DO_ALVO.split('$7').join('$2').split('$8').join('$3').split('$9').join('$4')}) AS vale`,
        [conversationId, aceitaNulo, marcas, legados]
      );
      if (!vale.rows[0].vale) return { obtido: false, registro: null, alvoMudou: true };
    }
  }
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
