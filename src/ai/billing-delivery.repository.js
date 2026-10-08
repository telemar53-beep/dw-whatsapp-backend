const { getPool } = require('../db/pool');
const { parametrosDaCondicaoDoEscopo } = require('../conversations/conversation.repository');

// Segurança final da F2 (03/10/2026): a condição sobre o alvo financeiro da conversa — o escopo de terceiro
// (conversations.ai_triage_third_party) tem de estar num dos estados que o turno conhece: coluna vazia, a marca
// de um escopo, ou o conteúdo de um escopo de antes da marca. O mesmo critério da gravação condicional.
const CONDICAO_DO_ALVO = `(($7::boolean AND c.ai_triage_third_party IS NULL)
          OR (c.ai_triage_third_party ->> 'marca') = ANY($8::text[])
          OR c.ai_triage_third_party = ANY($9::jsonb[]))`;

// Rodada 9 (N4-C; opção C autorizada pelo proprietário): "há mensagem do cliente que o turno ainda não considerou" — uma entrada sem a marca
// alvoProcessado, fora das que o turno aplicou (ids), na MESMA janela da leitura das entradas (listarFalasSemAlvoConfirmado):
// depois de `desde`, ou sem nenhuma confirmada, ou depois da última confirmada. A detecção é pelo id e pela marca; a hora do
// provedor só delimita a janela, como na leitura. Revisão da rodada 9 (achado 3): só a mensagem que gera o processamento da IA
// (que relê o pedido) — a autorresposta, a figurinha, o vídeo, a localização e o áudio com transcrição que falhou não geram, e
// contá-los travaria a entrega sem retomada. Os placeholders vêm de quem monta a consulta.
const entradaNaoConsiderada = (desde, ids) => `SELECT 1 FROM messages m
            WHERE m.conversation_id = c.id AND m.direction = 'inbound'
              AND m.message_type IN ('text', 'image', 'document', 'audio')
              AND NOT (m.message_type = 'text' AND COALESCE(m.content, '') = '')
              AND NOT (m.message_type = 'audio' AND COALESCE(m.transcription_status, '') IN ('failed', 'skipped'))
              AND COALESCE(m.metadata->>'autorrespostaProvavel', '') <> 'true'
              AND COALESCE(m.metadata->>'alvoProcessado', 'false') <> 'true'
              AND NOT (m.id = ANY(${ids}::uuid[]))
              AND (m.created_at > ${desde}::timestamptz
                OR NOT EXISTS (
                  SELECT 1 FROM messages q
                   WHERE q.conversation_id = c.id AND q.direction = 'inbound' AND q.metadata->>'alvoProcessado' = 'true')
                OR (m.created_at, m.id) > (
                  SELECT p.created_at, p.id FROM messages p
                   WHERE p.conversation_id = c.id AND p.direction = 'inbound' AND p.metadata->>'alvoProcessado' = 'true'
                   ORDER BY p.created_at DESC, p.id DESC
                   LIMIT 1))`;

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
async function claimDelivery({ conversationId, tool, contractId, invoiceId, messageId, isResend, condicaoDoAlvo = null, semEntradaNova = null }) {
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
    // Rodada 9 (N4-C): `semEntradaNova: { ids, desde }` — a mesma instrução também exige que nenhuma mensagem do cliente fora das
    // que o turno aplicou ainda espere ser considerada.
    inserido = await getPool().query(
      `WITH autorizado AS (
         SELECT c.id FROM conversations c
          WHERE c.id = $1::uuid AND ${CONDICAO_DO_ALVO}
            AND (NOT $10::boolean OR NOT EXISTS (${entradaNaoConsiderada('$11', '$12')}))
          FOR SHARE
       )
       INSERT INTO ai_billing_deliveries (conversation_id, tool, contract_id, invoice_id, message_id, is_resend)
       SELECT $1::uuid, $2::text, $3::integer, $4::text, $5::text, $6::boolean FROM autorizado
       ON CONFLICT DO NOTHING
       RETURNING ${COLUNAS}`,
      [...alvo, Boolean(isResend), aceitaNulo, marcas, legados,
        Boolean(semEntradaNova), semEntradaNova ? semEntradaNova.desde : null, semEntradaNova ? semEntradaNova.ids : []]
    );
    if (inserido.rowCount === 0) {
      // Só para escolher a resposta (a autorização já foi decidida acima): o alvo mudou, há mensagem nova, ou é duplicata.
      const vale = await getPool().query(
        `SELECT EXISTS (SELECT 1 FROM conversations c WHERE c.id = $1::uuid AND ${CONDICAO_DO_ALVO.split('$7').join('$2').split('$8').join('$3').split('$9').join('$4')}) AS vale`,
        [conversationId, aceitaNulo, marcas, legados]
      );
      if (!vale.rows[0].vale) return { obtido: false, registro: null, alvoMudou: true };
      if (semEntradaNova) {
        const nova = await getPool().query(
          `SELECT EXISTS (SELECT 1 FROM conversations c WHERE c.id = $1::uuid AND EXISTS (${entradaNaoConsiderada('$2', '$3')})) AS nova`,
          [conversationId, semEntradaNova.desde || null, semEntradaNova.ids || []]
        );
        if (nova.rows[0].nova) return { obtido: false, registro: null, mensagemNova: true };
      }
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

/**
 * Conclusão do atendimento (04/10/2026): a entrega que de fato SAIU (enfileirada) de uma ferramenta para UMA fatura nesta
 * conversa — é o que permite dizer "o boleto desta mesma fatura já foi enviado acima" quando o PIX dela não existe.
 * Só leitura; null quando não saiu.
 */
async function findEnqueuedDeliveryOfInvoice({ conversationId, tool, invoiceId }) {
  const resultado = await getPool().query(
    `SELECT ${COLUNAS} FROM ai_billing_deliveries
      WHERE conversation_id = $1 AND tool = $2 AND invoice_id = $3 AND enqueued_at IS NOT NULL
      ORDER BY enqueued_at DESC
      LIMIT 1`,
    [conversationId, tool, String(invoiceId)]
  );
  return paraRegistro(resultado.rows[0]);
}

/**
 * Fechamento limitado (04/10/2026): a última entrega que de fato SAIU (enfileirada) de uma fatura DIFERENTE desta, nesta
 * conversa — com a mensagem do cliente que a pediu (message_id). A trava do meio usa isto para não deixar o meio escolhido
 * para outra fatura valer para esta. `exceptoMensagem`: as entregas pedidas por esta mensagem (o turno atual) não contam.
 * Só leitura; null quando não há.
 */
async function findLatestEnqueuedDeliveryOfOtherInvoice({ conversationId, invoiceId, exceptoMensagem = null }) {
  const resultado = await getPool().query(
    `SELECT ${COLUNAS} FROM ai_billing_deliveries
      WHERE conversation_id = $1 AND invoice_id <> $2 AND enqueued_at IS NOT NULL
        AND ($3::text IS NULL OR message_id <> $3::text)
      ORDER BY enqueued_at DESC, claimed_at DESC
      LIMIT 1`,
    [conversationId, String(invoiceId), exceptoMensagem == null ? null : String(exceptoMensagem)]
  );
  return paraRegistro(resultado.rows[0]);
}

module.exports = {
  claimDelivery, markDeliveryEnqueued, releaseDelivery, findDelivery, findLatestEnqueuedDelivery, findEnqueuedDeliveryOfInvoice,
  findLatestEnqueuedDeliveryOfOtherInvoice,
};
