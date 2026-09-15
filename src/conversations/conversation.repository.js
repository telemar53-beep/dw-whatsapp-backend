const { getPool, withTransaction } = require('../db/pool');

function toConversation(row) {
  return {
    id: row.id,
    contactId: row.contact_id,
    channelId: row.channel_id,
    status: row.status,
    assignedAgentId: row.assigned_agent_id,
    sectorId: row.sector_id,
    triageState: row.triage_state,
    triageAttempts: row.triage_attempts,
    protocolNumber: row.protocol_number !== undefined ? row.protocol_number : null,
    businessHoursNoticeSentAt: row.business_hours_notice_sent_at !== undefined ? row.business_hours_notice_sent_at : null,
    suggestedReasonId: row.suggested_reason_id !== undefined ? row.suggested_reason_id : null,
    aiTriageSectorId: row.ai_triage_sector_id !== undefined ? row.ai_triage_sector_id : null,
    aiTriageReasonId: row.ai_triage_reason_id !== undefined ? row.ai_triage_reason_id : null,
    aiTriageConfidence: row.ai_triage_confidence != null ? Number(row.ai_triage_confidence) : null,
    aiTriageSummary: row.ai_triage_summary !== undefined ? row.ai_triage_summary : null,
    aiTriageIdentifiedBy: row.ai_triage_identified_by !== undefined ? row.ai_triage_identified_by : null,
    aiTriageLowConfidence: Boolean(row.ai_triage_low_confidence),
    aiTriageResolvedByAi: Boolean(row.ai_triage_resolved_by_ai),
    aiTriageCompletedAt: row.ai_triage_completed_at !== undefined ? row.ai_triage_completed_at : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toConversationSummary(row) {
  return {
    ...toConversation(row),
    contactPhoneNumber: row.contact_phone_number,
    contactDisplayName: row.contact_display_name,
    contactAvatarPath: row.contact_avatar_path,
    contactCityId: row.contact_city_id,
    contactCityName: row.contact_city_name,
    contactInternalNote: row.contact_internal_note,
    contactSgpDocument: row.contact_sgp_document ?? null,
    sectorName: row.sector_name,
    channelName: row.channel_name !== undefined ? row.channel_name : null,
    channelType: row.channel_type !== undefined ? row.channel_type : null,
    aiTriageReasonName: row.ai_triage_reason_name,
    lastMessageContent: row.last_message_content,
    lastMessageType: row.last_message_type,
    lastMessageStatus: row.last_message_status,
    lastMessageDirection: row.last_message_direction,
    lastMessageAt: row.last_message_at,
  };
}

async function findOpenConversation(contactId, channelId) {
  const result = await getPool().query(
    `SELECT id, contact_id, channel_id, status, assigned_agent_id, sector_id, triage_state, triage_attempts, business_hours_notice_sent_at, suggested_reason_id, ai_triage_sector_id, ai_triage_reason_id, ai_triage_confidence, ai_triage_summary, ai_triage_identified_by, ai_triage_low_confidence, ai_triage_resolved_by_ai, ai_triage_completed_at, created_at, updated_at
     FROM conversations WHERE contact_id = $1 AND channel_id = $2 AND status <> 'closed'`,
    [contactId, channelId]
  );
  if (result.rowCount === 0) return null;
  return toConversation(result.rows[0]);
}

/**
 * A conversa mais recente deste contato/canal que a PRÓPRIA IA encerrou há
 * menos de `withinMs` — ou null. "Encerrada pela IA" é o evento 'closed' sem
 * atendente (from_agent_id nulo), que só closeConversationByAi grava. Serve à
 * janela de cortesia: um "obrigado" ou "ótimo dia pra você também" que chega
 * logo depois do encerramento não pode virar atendimento novo.
 */
async function findRecentAiClosedConversation(contactId, channelId, withinMs) {
  const result = await getPool().query(
    `SELECT c.id, c.contact_id, c.channel_id, c.status, c.assigned_agent_id, c.sector_id, c.triage_state, c.triage_attempts, c.business_hours_notice_sent_at, c.suggested_reason_id, c.ai_triage_sector_id, c.ai_triage_reason_id, c.ai_triage_confidence, c.ai_triage_summary, c.ai_triage_identified_by, c.ai_triage_low_confidence, c.ai_triage_resolved_by_ai, c.ai_triage_completed_at, c.created_at, c.updated_at
       FROM conversations c
       JOIN conversation_events e
         ON e.conversation_id = c.id AND e.event_type = 'closed' AND e.from_agent_id IS NULL
      WHERE c.contact_id = $1 AND c.channel_id = $2 AND c.status = 'closed'
        AND e.created_at > now() - ($3::bigint * interval '1 millisecond')
      ORDER BY e.created_at DESC
      LIMIT 1`,
    [contactId, channelId, Math.max(0, Math.floor(withinMs))]
  );
  if (result.rowCount === 0) return null;
  return toConversation(result.rows[0]);
}

async function createConversation(contactId, channelId, triageState = null, status = 'waiting') {
  const result = await getPool().query(
    `INSERT INTO conversations (contact_id, channel_id, triage_state, status) VALUES ($1, $2, $3, $4)
     RETURNING id, contact_id, channel_id, status, assigned_agent_id, sector_id, triage_state, triage_attempts, business_hours_notice_sent_at, suggested_reason_id, ai_triage_sector_id, ai_triage_reason_id, ai_triage_confidence, ai_triage_summary, ai_triage_identified_by, ai_triage_low_confidence, ai_triage_resolved_by_ai, ai_triage_completed_at, created_at, updated_at`,
    [contactId, channelId, triageState, status]
  );
  return toConversation(result.rows[0]);
}

async function claimConversation(conversationId, agentId) {
  return withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE conversations SET status = 'assigned', assigned_agent_id = $2, triage_state = 'completed', updated_at = now()
       WHERE id = $1 AND assigned_agent_id IS NULL AND status <> 'closed'
       RETURNING id, contact_id, channel_id, status, assigned_agent_id, sector_id, triage_state, triage_attempts, protocol_number, suggested_reason_id, ai_triage_sector_id, ai_triage_reason_id, ai_triage_confidence, ai_triage_summary, ai_triage_identified_by, ai_triage_low_confidence, ai_triage_resolved_by_ai, ai_triage_completed_at, created_at, updated_at`,
      [conversationId, agentId]
    );
    if (result.rowCount === 0) return null;
    await client.query(
      `INSERT INTO conversation_events (conversation_id, event_type, to_agent_id) VALUES ($1, 'assigned', $2)`,
      [conversationId, agentId]
    );
    return toConversation(result.rows[0]);
  });
}

async function transferConversation(conversationId, fromAgentId, toAgentId) {
  return withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE conversations SET status = 'assigned', assigned_agent_id = $2, triage_state = 'completed', updated_at = now()
       WHERE id = $1 AND (assigned_agent_id = $3 OR assigned_agent_id IS NULL) AND status <> 'closed'
       RETURNING id, contact_id, channel_id, status, assigned_agent_id, sector_id, triage_state, triage_attempts, suggested_reason_id, ai_triage_sector_id, ai_triage_reason_id, ai_triage_confidence, ai_triage_summary, ai_triage_identified_by, ai_triage_low_confidence, ai_triage_resolved_by_ai, ai_triage_completed_at, created_at, updated_at`,
      [conversationId, toAgentId, fromAgentId]
    );
    if (result.rowCount === 0) return null;
    await client.query(
      `INSERT INTO conversation_events (conversation_id, event_type, from_agent_id, to_agent_id) VALUES ($1, 'transferred', $2, $3)`,
      [conversationId, fromAgentId, toAgentId]
    );
    return toConversation(result.rows[0]);
  });
}

async function closeConversation(conversationId, agentId, reasonId) {
  return withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE conversations SET status = 'closed', updated_at = now()
       WHERE id = $1 AND (assigned_agent_id = $2 OR assigned_agent_id IS NULL) AND status <> 'closed'
       RETURNING id, contact_id, channel_id, status, assigned_agent_id, sector_id, triage_state, triage_attempts, protocol_number, suggested_reason_id, ai_triage_sector_id, ai_triage_reason_id, ai_triage_confidence, ai_triage_summary, ai_triage_identified_by, ai_triage_low_confidence, ai_triage_resolved_by_ai, ai_triage_completed_at, created_at, updated_at`,
      [conversationId, agentId]
    );
    if (result.rowCount === 0) return null;
    await client.query(
      `INSERT INTO conversation_events (conversation_id, event_type, from_agent_id, reason_id) VALUES ($1, 'closed', $2, $3)`,
      [conversationId, agentId, reasonId]
    );
    return toConversation(result.rows[0]);
  });
}

async function adminTransferConversation(conversationId, toAgentId) {
  return withTransaction(async (client) => {
    const current = await client.query(`SELECT assigned_agent_id FROM conversations WHERE id = $1 AND status <> 'closed'`, [
      conversationId,
    ]);
    if (current.rowCount === 0) return null;
    const fromAgentId = current.rows[0].assigned_agent_id;
    const result = await client.query(
      `UPDATE conversations SET status = 'assigned', assigned_agent_id = $2, triage_state = 'completed', updated_at = now()
       WHERE id = $1 AND status <> 'closed'
       RETURNING id, contact_id, channel_id, status, assigned_agent_id, sector_id, triage_state, triage_attempts, suggested_reason_id, ai_triage_sector_id, ai_triage_reason_id, ai_triage_confidence, ai_triage_summary, ai_triage_identified_by, ai_triage_low_confidence, ai_triage_resolved_by_ai, ai_triage_completed_at, created_at, updated_at`,
      [conversationId, toAgentId]
    );
    if (result.rowCount === 0) return null;
    await client.query(
      `INSERT INTO conversation_events (conversation_id, event_type, from_agent_id, to_agent_id) VALUES ($1, 'transferred', $2, $3)`,
      [conversationId, fromAgentId, toAgentId]
    );
    return toConversation(result.rows[0]);
  });
}

async function adminCloseConversation(conversationId, adminAgentId, reasonId) {
  return withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE conversations SET status = 'closed', updated_at = now()
       WHERE id = $1 AND status <> 'closed'
       RETURNING id, contact_id, channel_id, status, assigned_agent_id, sector_id, triage_state, triage_attempts, protocol_number, suggested_reason_id, ai_triage_sector_id, ai_triage_reason_id, ai_triage_confidence, ai_triage_summary, ai_triage_identified_by, ai_triage_low_confidence, ai_triage_resolved_by_ai, ai_triage_completed_at, created_at, updated_at`,
      [conversationId]
    );
    if (result.rowCount === 0) return null;
    await client.query(
      `INSERT INTO conversation_events (conversation_id, event_type, from_agent_id, reason_id) VALUES ($1, 'closed', $2, $3)`,
      [conversationId, adminAgentId, reasonId]
    );
    return toConversation(result.rows[0]);
  });
}

async function completeTriage(conversationId, sectorId) {
  const result = await getPool().query(
    `UPDATE conversations SET sector_id = $2, triage_state = 'completed', updated_at = now()
     WHERE id = $1 AND triage_state = 'pending'
     RETURNING id, contact_id, channel_id, status, assigned_agent_id, sector_id, triage_state, triage_attempts, suggested_reason_id, ai_triage_sector_id, ai_triage_reason_id, ai_triage_confidence, ai_triage_summary, ai_triage_identified_by, ai_triage_low_confidence, ai_triage_resolved_by_ai, ai_triage_completed_at, created_at, updated_at`,
    [conversationId, sectorId]
  );
  if (result.rowCount === 0) return null;
  return toConversation(result.rows[0]);
}

/**
 * Conclusão da triagem feita pela IA. Guardada por triage_state = 'pending'
 * como completeTriage: dois turnos (ou o job de timeout e um turno) que
 * tentem concluir a mesma conversa — só o primeiro ganha, o outro recebe null.
 * sector_id (setor FINAL) recebe o mesmo valor que ai_triage_sector_id; o
 * atendente pode mudar sector_id depois, e a diferença é a "triagem corrigida".
 */
async function concludeAiTriage(conversationId, { sectorId, reasonId, confidence, summary, identifiedBy, lowConfidence, resolvedByAi }) {
  const result = await getPool().query(
    `UPDATE conversations
        SET triage_state = 'completed', sector_id = $2, suggested_reason_id = $3,
            ai_triage_sector_id = $2, ai_triage_reason_id = $3, ai_triage_confidence = $4,
            ai_triage_summary = $5, ai_triage_identified_by = $6, ai_triage_low_confidence = $7,
            ai_triage_resolved_by_ai = (ai_triage_resolved_by_ai OR $8), ai_triage_completed_at = now(), updated_at = now()
      WHERE id = $1 AND triage_state = 'pending'
      RETURNING id, contact_id, channel_id, status, assigned_agent_id, sector_id, triage_state, triage_attempts,
                protocol_number, business_hours_notice_sent_at, suggested_reason_id, created_at, updated_at,
                ai_triage_sector_id, ai_triage_reason_id, ai_triage_confidence, ai_triage_summary,
                ai_triage_identified_by, ai_triage_low_confidence, ai_triage_resolved_by_ai, ai_triage_completed_at`,
    [conversationId, sectorId || null, reasonId || null, confidence != null ? confidence : null,
     summary, identifiedBy || 'none', Boolean(lowConfidence), Boolean(resolvedByAi)]
  );
  if (result.rowCount === 0) return null;
  return toConversation(result.rows[0]);
}

/**
 * Marca que a IA já ENTREGOU algo de valor nesta conversa (boleto ou PIX).
 * Persistida de propósito, e não só em contexto.resolvidoPelaIa: a entrega
 * pode ter sido num turno anterior, e é esta flag que autoriza a IA (e o job
 * de tempo limite) a encerrar o atendimento sozinha depois.
 */
async function markTriageResolvedByAi(conversationId) {
  const result = await getPool().query(
    `UPDATE conversations SET ai_triage_resolved_by_ai = true, updated_at = now()
      WHERE id = $1 AND triage_state = 'pending' RETURNING id`,
    [conversationId]
  );
  return result.rowCount > 0;
}

/**
 * Encerramento feito pela própria IA, sem atendente nenhum: a conversa nunca
 * chegou a aparecer na fila. As condições do WHERE são a trava de segurança —
 * só uma conversa ainda em triagem, em espera e sem atendente pode ser
 * fechada por aqui; qualquer outra devolve null e nada acontece.
 * O evento de fechamento fica com from_agent_id NULL (a coluna aceita):
 * inventar um atendente poluiria o relatório de produtividade.
 */
async function closeConversationByAi(conversationId, { reasonId, summary }) {
  return withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE conversations
          SET status = 'closed', triage_state = 'completed', ai_triage_completed_at = now(),
              ai_triage_resolved_by_ai = true, ai_triage_summary = $2,
              ai_triage_identified_by = COALESCE(ai_triage_identified_by, 'none'), updated_at = now()
        WHERE id = $1 AND status = 'waiting' AND assigned_agent_id IS NULL AND triage_state = 'pending'
        RETURNING id, contact_id, channel_id, status, assigned_agent_id, sector_id, triage_state, triage_attempts, protocol_number, suggested_reason_id, ai_triage_sector_id, ai_triage_reason_id, ai_triage_confidence, ai_triage_summary, ai_triage_identified_by, ai_triage_low_confidence, ai_triage_resolved_by_ai, ai_triage_completed_at, created_at, updated_at`,
      [conversationId, summary]
    );
    if (result.rowCount === 0) return null;
    await client.query(
      `INSERT INTO conversation_events (conversation_id, event_type, from_agent_id, reason_id) VALUES ($1, 'closed', NULL, $2)`,
      [conversationId, reasonId || null]
    );
    return toConversation(result.rows[0]);
  });
}

async function incrementTriageAttempts(conversationId) {
  const result = await getPool().query(
    `UPDATE conversations SET triage_attempts = triage_attempts + 1, updated_at = now()
     WHERE id = $1 AND triage_state = 'pending'
     RETURNING triage_attempts, ai_triage_sector_id, ai_triage_reason_id, ai_triage_confidence, ai_triage_summary, ai_triage_identified_by, ai_triage_low_confidence, ai_triage_resolved_by_ai, ai_triage_completed_at`,
    [conversationId]
  );
  if (result.rowCount === 0) return 0;
  return result.rows[0].triage_attempts;
}

/**
 * Tentativas de confirmar_nascimento (ai/tool-registry.js), por conversa —
 * gravado no banco de propósito, não no contexto em memória do turno: um
 * contador em memória zera a cada turno e também com esquecer_identificacao,
 * que é justamente a brecha que este contador fecha. Sem condição de
 * triage_state = 'pending': confirmar_nascimento pode ser chamado a
 * qualquer momento da triagem, não só enquanto pendente.
 */
async function incrementBirthdateAttempts(conversationId) {
  const result = await getPool().query(
    `UPDATE conversations SET ai_triage_birthdate_attempts = ai_triage_birthdate_attempts + 1
     WHERE id = $1
     RETURNING ai_triage_birthdate_attempts`,
    [conversationId]
  );
  if (result.rowCount === 0) return 0;
  return result.rows[0].ai_triage_birthdate_attempts;
}

/**
 * ai_triage_phone_contested vive fora do mapper e das 25 consultas que
 * enumeram colunas (mesmo tratamento de ai_triage_birthdate_attempts): só
 * estas duas funções a leem/escrevem. Registra que esquecer_identificacao já
 * foi chamado nesta conversa — sem isso, o turno seguinte de resolverIdentidade
 * buscaria de novo pelo MESMO telefone no SGP e cumprimentaria a mesma pessoa
 * errada.
 */
async function markPhoneContested(conversationId) {
  await getPool().query(
    `UPDATE conversations SET ai_triage_phone_contested = true WHERE id = $1`,
    [conversationId]
  );
}

async function isPhoneContested(conversationId) {
  const result = await getPool().query(
    `SELECT ai_triage_phone_contested FROM conversations WHERE id = $1`,
    [conversationId]
  );
  if (result.rowCount === 0) return false;
  return Boolean(result.rows[0].ai_triage_phone_contested);
}

/**
 * ai_triage_pending_document: o CPF/CNPJ que o cliente DIGITOU na triagem e
 * que ainda não passou pela conferência da data de nascimento. Mesmo
 * tratamento de ai_triage_phone_contested — fora do mapper e das consultas que
 * enumeram colunas, só estas duas funções o leem/escrevem, e ele nunca entra
 * num resumo de conversa. Sem isto, a identidade FRACA vivia só no contexto do
 * turno e o turno seguinte pedia o CPF de novo.
 *
 * Nunca vai a log: é dado pessoal do cliente.
 */
async function setTriagePendingDocument(conversationId, document) {
  await getPool().query(
    `UPDATE conversations SET ai_triage_pending_document = $2 WHERE id = $1`,
    [conversationId, document || null]
  );
}

async function getTriagePendingDocument(conversationId) {
  const result = await getPool().query(
    `SELECT ai_triage_pending_document FROM conversations WHERE id = $1`,
    [conversationId]
  );
  if (result.rowCount === 0) return null;
  return result.rows[0].ai_triage_pending_document || null;
}

async function activateConversation(conversationId) {
  const result = await getPool().query(
    `UPDATE conversations SET status = 'waiting', updated_at = now()
     WHERE id = $1 AND status = 'silent'
     RETURNING id, contact_id, channel_id, status, assigned_agent_id, sector_id, triage_state, triage_attempts, business_hours_notice_sent_at, suggested_reason_id, ai_triage_sector_id, ai_triage_reason_id, ai_triage_confidence, ai_triage_summary, ai_triage_identified_by, ai_triage_low_confidence, ai_triage_resolved_by_ai, ai_triage_completed_at, created_at, updated_at`,
    [conversationId]
  );
  if (result.rowCount === 0) return null;
  return toConversation(result.rows[0]);
}

async function markBusinessHoursNoticeSent(conversationId) {
  const result = await getPool().query(
    `UPDATE conversations SET business_hours_notice_sent_at = now() WHERE id = $1
     RETURNING id, contact_id, channel_id, status, assigned_agent_id, sector_id, triage_state, triage_attempts, business_hours_notice_sent_at, suggested_reason_id, ai_triage_sector_id, ai_triage_reason_id, ai_triage_confidence, ai_triage_summary, ai_triage_identified_by, ai_triage_low_confidence, ai_triage_resolved_by_ai, ai_triage_completed_at, created_at, updated_at`,
    [conversationId]
  );
  return toConversation(result.rows[0]);
}

async function getConversationWithContact(conversationId) {
  const result = await getPool().query(
    `SELECT c.id, c.contact_id, c.channel_id, c.status, c.assigned_agent_id, c.sector_id, c.triage_state, c.triage_attempts, c.protocol_number, c.suggested_reason_id, c.ai_triage_sector_id, c.ai_triage_reason_id, c.ai_triage_confidence, c.ai_triage_summary, c.ai_triage_identified_by, c.ai_triage_low_confidence, c.ai_triage_resolved_by_ai, c.ai_triage_completed_at, c.created_at, c.updated_at,
            ct.phone_number AS contact_phone_number, ct.display_name AS contact_display_name,
            ct.avatar_path AS contact_avatar_path,
            ct.city_id AS contact_city_id, ci.name AS contact_city_name, ct.sgp_document AS contact_sgp_document,
            ct.internal_note AS contact_internal_note,
            s.name AS sector_name,
            ch.name AS channel_name, ch.type AS channel_type,
            r.name AS ai_triage_reason_name,
            lm.content AS last_message_content, lm.message_type AS last_message_type,
            lm.status AS last_message_status, lm.direction AS last_message_direction,
            lm.created_at AS last_message_at
     FROM conversations c
     JOIN contacts ct ON ct.id = c.contact_id
     LEFT JOIN channels ch ON ch.id = c.channel_id
     LEFT JOIN sectors s ON s.id = c.sector_id
     LEFT JOIN contact_reasons r ON r.id = c.ai_triage_reason_id
     LEFT JOIN cities ci ON ci.id = ct.city_id
     LEFT JOIN LATERAL (
       SELECT content, message_type, status, direction, created_at
       FROM messages m
       WHERE m.conversation_id = c.id
       ORDER BY m.created_at DESC
       LIMIT 1
     ) lm ON true
     WHERE c.id = $1`,
    [conversationId]
  );
  if (result.rowCount === 0) return null;
  return toConversationSummary(result.rows[0]);
}

async function findConversationByProtocolNumber(protocolNumber) {
  const result = await getPool().query(
    `SELECT c.id, c.contact_id, c.channel_id, c.status, c.assigned_agent_id, c.sector_id, c.triage_state, c.triage_attempts, c.protocol_number, c.suggested_reason_id, c.ai_triage_sector_id, c.ai_triage_reason_id, c.ai_triage_confidence, c.ai_triage_summary, c.ai_triage_identified_by, c.ai_triage_low_confidence, c.ai_triage_resolved_by_ai, c.ai_triage_completed_at, c.created_at, c.updated_at,
            ct.phone_number AS contact_phone_number, ct.display_name AS contact_display_name,
            ct.avatar_path AS contact_avatar_path,
            ct.city_id AS contact_city_id, ci.name AS contact_city_name, ct.sgp_document AS contact_sgp_document,
            ct.internal_note AS contact_internal_note,
            s.name AS sector_name,
            ch.name AS channel_name, ch.type AS channel_type,
            r.name AS ai_triage_reason_name,
            lm.content AS last_message_content, lm.message_type AS last_message_type,
            lm.status AS last_message_status, lm.direction AS last_message_direction,
            lm.created_at AS last_message_at
     FROM conversations c
     JOIN contacts ct ON ct.id = c.contact_id
     LEFT JOIN channels ch ON ch.id = c.channel_id
     LEFT JOIN sectors s ON s.id = c.sector_id
     LEFT JOIN contact_reasons r ON r.id = c.ai_triage_reason_id
     LEFT JOIN cities ci ON ci.id = ct.city_id
     LEFT JOIN LATERAL (
       SELECT content, message_type, status, direction, created_at
       FROM messages m
       WHERE m.conversation_id = c.id
       ORDER BY m.created_at DESC
       LIMIT 1
     ) lm ON true
     WHERE c.protocol_number = $1`,
    [protocolNumber]
  );
  if (result.rowCount === 0) return null;
  return toConversationSummary(result.rows[0]);
}

async function listConversationsByContact(contactId) {
  const result = await getPool().query(
    `SELECT c.id, c.contact_id, c.channel_id, c.status, c.assigned_agent_id, c.sector_id, c.triage_state, c.triage_attempts, c.protocol_number, c.suggested_reason_id, c.ai_triage_sector_id, c.ai_triage_reason_id, c.ai_triage_confidence, c.ai_triage_summary, c.ai_triage_identified_by, c.ai_triage_low_confidence, c.ai_triage_resolved_by_ai, c.ai_triage_completed_at, c.created_at, c.updated_at,
            ct.phone_number AS contact_phone_number, ct.display_name AS contact_display_name,
            ct.avatar_path AS contact_avatar_path,
            ct.city_id AS contact_city_id, ci.name AS contact_city_name, ct.sgp_document AS contact_sgp_document,
            s.name AS sector_name,
            ch.name AS channel_name, ch.type AS channel_type,
            r.name AS ai_triage_reason_name,
            lm.content AS last_message_content, lm.message_type AS last_message_type,
            lm.status AS last_message_status, lm.direction AS last_message_direction,
            lm.created_at AS last_message_at
     FROM conversations c
     JOIN contacts ct ON ct.id = c.contact_id
     LEFT JOIN channels ch ON ch.id = c.channel_id
     LEFT JOIN sectors s ON s.id = c.sector_id
     LEFT JOIN contact_reasons r ON r.id = c.ai_triage_reason_id
     LEFT JOIN cities ci ON ci.id = ct.city_id
     LEFT JOIN LATERAL (
       SELECT content, message_type, status, direction, created_at
       FROM messages m
       WHERE m.conversation_id = c.id
       ORDER BY m.created_at DESC
       LIMIT 1
     ) lm ON true
     WHERE c.contact_id = $1
     ORDER BY c.created_at DESC`,
    [contactId]
  );
  return result.rows.map(toConversationSummary);
}

async function listWaitingConversations() {
  const result = await getPool().query(
    `SELECT c.id, c.contact_id, c.channel_id, c.status, c.assigned_agent_id, c.sector_id, c.triage_state, c.triage_attempts, c.suggested_reason_id, c.ai_triage_sector_id, c.ai_triage_reason_id, c.ai_triage_confidence, c.ai_triage_summary, c.ai_triage_identified_by, c.ai_triage_low_confidence, c.ai_triage_resolved_by_ai, c.ai_triage_completed_at, c.created_at, c.updated_at,
            ct.phone_number AS contact_phone_number, ct.display_name AS contact_display_name,
            ct.avatar_path AS contact_avatar_path,
            ct.city_id AS contact_city_id, ci.name AS contact_city_name, ct.sgp_document AS contact_sgp_document,
            s.name AS sector_name,
            ch.name AS channel_name, ch.type AS channel_type,
            r.name AS ai_triage_reason_name,
            lm.content AS last_message_content, lm.message_type AS last_message_type,
            lm.status AS last_message_status, lm.direction AS last_message_direction,
            lm.created_at AS last_message_at
     FROM conversations c
     JOIN contacts ct ON ct.id = c.contact_id
     LEFT JOIN channels ch ON ch.id = c.channel_id
     LEFT JOIN sectors s ON s.id = c.sector_id
     LEFT JOIN contact_reasons r ON r.id = c.ai_triage_reason_id
     LEFT JOIN cities ci ON ci.id = ct.city_id
     LEFT JOIN LATERAL (
       SELECT content, message_type, status, direction, created_at
       FROM messages m
       WHERE m.conversation_id = c.id
       ORDER BY m.created_at DESC
       LIMIT 1
     ) lm ON true
     WHERE c.status = 'waiting'
     ORDER BY c.created_at ASC`
  );
  return result.rows.map(toConversationSummary);
}

async function listInProgressConversations() {
  const result = await getPool().query(
    `SELECT c.id, c.contact_id, c.channel_id, c.status, c.assigned_agent_id, c.sector_id, c.triage_state, c.triage_attempts, c.suggested_reason_id, c.ai_triage_sector_id, c.ai_triage_reason_id, c.ai_triage_confidence, c.ai_triage_summary, c.ai_triage_identified_by, c.ai_triage_low_confidence, c.ai_triage_resolved_by_ai, c.ai_triage_completed_at, c.created_at, c.updated_at,
            ct.phone_number AS contact_phone_number, ct.display_name AS contact_display_name,
            ct.avatar_path AS contact_avatar_path,
            ct.city_id AS contact_city_id, ci.name AS contact_city_name, ct.sgp_document AS contact_sgp_document,
            s.name AS sector_name,
            ch.name AS channel_name, ch.type AS channel_type,
            r.name AS ai_triage_reason_name,
            lm.content AS last_message_content, lm.message_type AS last_message_type,
            lm.status AS last_message_status, lm.direction AS last_message_direction,
            lm.created_at AS last_message_at
     FROM conversations c
     JOIN contacts ct ON ct.id = c.contact_id
     LEFT JOIN channels ch ON ch.id = c.channel_id
     LEFT JOIN sectors s ON s.id = c.sector_id
     LEFT JOIN contact_reasons r ON r.id = c.ai_triage_reason_id
     LEFT JOIN cities ci ON ci.id = ct.city_id
     LEFT JOIN LATERAL (
       SELECT content, message_type, status, direction, created_at
       FROM messages m
       WHERE m.conversation_id = c.id
       ORDER BY m.created_at DESC
       LIMIT 1
     ) lm ON true
     WHERE c.status = 'assigned'
     ORDER BY c.updated_at DESC`
  );
  return result.rows.map(toConversationSummary);
}

async function listWaitingForAgentConversations() {
  const result = await getPool().query(
    `SELECT c.id, c.contact_id, c.channel_id, c.status, c.assigned_agent_id, c.sector_id, c.triage_state, c.triage_attempts, c.suggested_reason_id, c.ai_triage_sector_id, c.ai_triage_reason_id, c.ai_triage_confidence, c.ai_triage_summary, c.ai_triage_identified_by, c.ai_triage_low_confidence, c.ai_triage_resolved_by_ai, c.ai_triage_completed_at, c.created_at, c.updated_at,
            ct.phone_number AS contact_phone_number, ct.display_name AS contact_display_name,
            ct.avatar_path AS contact_avatar_path,
            ct.city_id AS contact_city_id, ci.name AS contact_city_name, ct.sgp_document AS contact_sgp_document,
            s.name AS sector_name,
            ch.name AS channel_name, ch.type AS channel_type,
            r.name AS ai_triage_reason_name,
            lm.content AS last_message_content, lm.message_type AS last_message_type,
            lm.status AS last_message_status, lm.direction AS last_message_direction,
            lm.created_at AS last_message_at
     FROM conversations c
     JOIN contacts ct ON ct.id = c.contact_id
     LEFT JOIN channels ch ON ch.id = c.channel_id
     LEFT JOIN sectors s ON s.id = c.sector_id
     LEFT JOIN contact_reasons r ON r.id = c.ai_triage_reason_id
     LEFT JOIN cities ci ON ci.id = ct.city_id
     LEFT JOIN LATERAL (
       SELECT content, message_type, status, direction, created_at
       FROM messages m
       WHERE m.conversation_id = c.id
       ORDER BY m.created_at DESC
       LIMIT 1
     ) lm ON true
     WHERE c.status = 'waiting' AND c.triage_state IS DISTINCT FROM 'pending'
     ORDER BY c.created_at ASC`
  );
  return result.rows.map(toConversationSummary);
}

async function listInAutomationConversations() {
  const result = await getPool().query(
    `SELECT c.id, c.contact_id, c.channel_id, c.status, c.assigned_agent_id, c.sector_id, c.triage_state, c.triage_attempts, c.suggested_reason_id, c.ai_triage_sector_id, c.ai_triage_reason_id, c.ai_triage_confidence, c.ai_triage_summary, c.ai_triage_identified_by, c.ai_triage_low_confidence, c.ai_triage_resolved_by_ai, c.ai_triage_completed_at, c.created_at, c.updated_at,
            ct.phone_number AS contact_phone_number, ct.display_name AS contact_display_name,
            ct.avatar_path AS contact_avatar_path,
            ct.city_id AS contact_city_id, ci.name AS contact_city_name, ct.sgp_document AS contact_sgp_document,
            s.name AS sector_name,
            ch.name AS channel_name, ch.type AS channel_type,
            r.name AS ai_triage_reason_name,
            lm.content AS last_message_content, lm.message_type AS last_message_type,
            lm.status AS last_message_status, lm.direction AS last_message_direction,
            lm.created_at AS last_message_at
     FROM conversations c
     JOIN contacts ct ON ct.id = c.contact_id
     LEFT JOIN channels ch ON ch.id = c.channel_id
     LEFT JOIN sectors s ON s.id = c.sector_id
     LEFT JOIN contact_reasons r ON r.id = c.ai_triage_reason_id
     LEFT JOIN cities ci ON ci.id = ct.city_id
     LEFT JOIN LATERAL (
       SELECT content, message_type, status, direction, created_at
       FROM messages m
       WHERE m.conversation_id = c.id
       ORDER BY m.created_at DESC
       LIMIT 1
     ) lm ON true
     WHERE c.triage_state = 'pending' AND c.status NOT IN ('closed', 'silent')
     ORDER BY c.created_at ASC`
  );
  return result.rows.map(toConversationSummary);
}

async function countClosedSince(since) {
  const result = await getPool().query(
    `SELECT COUNT(*)::int AS count FROM conversation_events WHERE event_type = 'closed' AND created_at >= $1`,
    [since]
  );
  return Number(result.rows[0].count);
}

async function listClosedSince(since, { limit, offset }) {
  const result = await getPool().query(
    `SELECT c.id, c.contact_id, c.channel_id, c.status, c.assigned_agent_id, c.sector_id, c.triage_state, c.triage_attempts, c.suggested_reason_id, c.ai_triage_sector_id, c.ai_triage_reason_id, c.ai_triage_confidence, c.ai_triage_summary, c.ai_triage_identified_by, c.ai_triage_low_confidence, c.ai_triage_resolved_by_ai, c.ai_triage_completed_at, c.created_at, c.updated_at,
            ct.phone_number AS contact_phone_number, ct.display_name AS contact_display_name,
            ct.avatar_path AS contact_avatar_path,
            ct.city_id AS contact_city_id, ci.name AS contact_city_name, ct.sgp_document AS contact_sgp_document,
            s.name AS sector_name,
            ch.name AS channel_name, ch.type AS channel_type,
            r.name AS ai_triage_reason_name,
            lm.content AS last_message_content, lm.message_type AS last_message_type,
            lm.status AS last_message_status, lm.direction AS last_message_direction,
            lm.created_at AS last_message_at,
            ce.created_at AS closed_at
     FROM conversation_events ce
     JOIN conversations c ON c.id = ce.conversation_id
     JOIN contacts ct ON ct.id = c.contact_id
     LEFT JOIN channels ch ON ch.id = c.channel_id
     LEFT JOIN sectors s ON s.id = c.sector_id
     LEFT JOIN contact_reasons r ON r.id = c.ai_triage_reason_id
     LEFT JOIN cities ci ON ci.id = ct.city_id
     LEFT JOIN LATERAL (
       SELECT content, message_type, status, direction, created_at
       FROM messages m
       WHERE m.conversation_id = c.id
       ORDER BY m.created_at DESC
       LIMIT 1
     ) lm ON true
     WHERE ce.event_type = 'closed' AND ce.created_at >= $1
     ORDER BY ce.created_at DESC
     LIMIT $2 OFFSET $3`,
    [since, limit, offset]
  );
  return result.rows.map((row) => ({ ...toConversationSummary(row), closedAt: row.closed_at }));
}

async function listConversationsByAgent(agentId) {
  const result = await getPool().query(
    `SELECT c.id, c.contact_id, c.channel_id, c.status, c.assigned_agent_id, c.sector_id, c.triage_state, c.triage_attempts, c.suggested_reason_id, c.ai_triage_sector_id, c.ai_triage_reason_id, c.ai_triage_confidence, c.ai_triage_summary, c.ai_triage_identified_by, c.ai_triage_low_confidence, c.ai_triage_resolved_by_ai, c.ai_triage_completed_at, c.created_at, c.updated_at,
            ct.phone_number AS contact_phone_number, ct.display_name AS contact_display_name,
            ct.avatar_path AS contact_avatar_path,
            ct.city_id AS contact_city_id, ci.name AS contact_city_name, ct.sgp_document AS contact_sgp_document,
            s.name AS sector_name,
            ch.name AS channel_name, ch.type AS channel_type,
            r.name AS ai_triage_reason_name,
            lm.content AS last_message_content, lm.message_type AS last_message_type,
            lm.status AS last_message_status, lm.direction AS last_message_direction,
            lm.created_at AS last_message_at
     FROM conversations c
     JOIN contacts ct ON ct.id = c.contact_id
     LEFT JOIN channels ch ON ch.id = c.channel_id
     LEFT JOIN sectors s ON s.id = c.sector_id
     LEFT JOIN contact_reasons r ON r.id = c.ai_triage_reason_id
     LEFT JOIN cities ci ON ci.id = ct.city_id
     LEFT JOIN LATERAL (
       SELECT content, message_type, status, direction, created_at
       FROM messages m
       WHERE m.conversation_id = c.id
       ORDER BY m.created_at DESC
       LIMIT 1
     ) lm ON true
     WHERE c.assigned_agent_id = $1 AND c.status <> 'closed'
     ORDER BY c.updated_at DESC`,
    [agentId]
  );
  return result.rows.map(toConversationSummary);
}

async function countClosedConversationsByAgent(agentId) {
  const result = await getPool().query(
    `SELECT COUNT(*)::int AS count FROM conversations WHERE assigned_agent_id = $1 AND status = 'closed'`,
    [agentId]
  );
  return Number(result.rows[0].count);
}

async function listClosedConversationsByAgent(agentId, { limit, offset }) {
  const result = await getPool().query(
    `SELECT c.id, c.contact_id, c.channel_id, c.status, c.assigned_agent_id, c.sector_id, c.triage_state, c.triage_attempts, c.suggested_reason_id, c.ai_triage_sector_id, c.ai_triage_reason_id, c.ai_triage_confidence, c.ai_triage_summary, c.ai_triage_identified_by, c.ai_triage_low_confidence, c.ai_triage_resolved_by_ai, c.ai_triage_completed_at, c.created_at, c.updated_at,
            ct.phone_number AS contact_phone_number, ct.display_name AS contact_display_name,
            ct.avatar_path AS contact_avatar_path,
            ct.city_id AS contact_city_id, ci.name AS contact_city_name, ct.sgp_document AS contact_sgp_document,
            s.name AS sector_name,
            ch.name AS channel_name, ch.type AS channel_type,
            r.name AS ai_triage_reason_name,
            lm.content AS last_message_content, lm.message_type AS last_message_type,
            lm.status AS last_message_status, lm.direction AS last_message_direction,
            lm.created_at AS last_message_at
     FROM conversations c
     JOIN contacts ct ON ct.id = c.contact_id
     LEFT JOIN channels ch ON ch.id = c.channel_id
     LEFT JOIN sectors s ON s.id = c.sector_id
     LEFT JOIN contact_reasons r ON r.id = c.ai_triage_reason_id
     LEFT JOIN cities ci ON ci.id = ct.city_id
     LEFT JOIN LATERAL (
       SELECT content, message_type, status, direction, created_at
       FROM messages m
       WHERE m.conversation_id = c.id
       ORDER BY m.created_at DESC
       LIMIT 1
     ) lm ON true
     WHERE c.assigned_agent_id = $1 AND c.status = 'closed'
     ORDER BY c.updated_at DESC
     LIMIT $2 OFFSET $3`,
    [agentId, limit, offset]
  );
  return result.rows.map((row) => ({ ...toConversationSummary(row), closedAt: row.updated_at }));
}

async function setSuggestedReason(conversationId, reasonId) {
  const result = await getPool().query(
    'UPDATE conversations SET suggested_reason_id = $2, updated_at = now() WHERE id = $1 RETURNING *',
    [conversationId, reasonId]
  );
  if (result.rowCount === 0) return null;
  return toConversation(result.rows[0]);
}

async function setConversationSector(conversationId, sectorId) {
  const result = await getPool().query(
    `UPDATE conversations SET sector_id = $2, updated_at = now()
     WHERE id = $1
     RETURNING id, contact_id, channel_id, status, assigned_agent_id, sector_id, triage_state, triage_attempts, suggested_reason_id, ai_triage_sector_id, ai_triage_reason_id, ai_triage_confidence, ai_triage_summary, ai_triage_identified_by, ai_triage_low_confidence, ai_triage_resolved_by_ai, ai_triage_completed_at, created_at, updated_at`,
    [conversationId, sectorId]
  );
  if (result.rowCount === 0) return null;
  return toConversation(result.rows[0]);
}

async function listClosedConversationsByContact(contactId) {
  const result = await getPool().query(
    `SELECT c.id, c.contact_id, c.channel_id, c.status, c.assigned_agent_id, c.suggested_reason_id, c.created_at, c.updated_at,
            ch.name AS channel_name, ch.type AS channel_type
     FROM conversations c
     JOIN channels ch ON ch.id = c.channel_id
     WHERE c.contact_id = $1 AND c.status = 'closed'
     ORDER BY c.updated_at DESC
     LIMIT 50`,
    [contactId]
  );
  return result.rows.map((row) => ({
    ...toConversation(row),
    channelName: row.channel_name,
    channelType: row.channel_type,
  }));
}

module.exports = {
  findOpenConversation,
  createConversation,
  claimConversation,
  transferConversation,
  closeConversation,
  adminTransferConversation,
  adminCloseConversation,
  completeTriage,
  concludeAiTriage,
  markTriageResolvedByAi,
  closeConversationByAi,
  findRecentAiClosedConversation,
  incrementTriageAttempts,
  incrementBirthdateAttempts,
  activateConversation,
  getConversationWithContact,
  findConversationByProtocolNumber,
  listConversationsByContact,
  listWaitingConversations,
  listConversationsByAgent,
  countClosedConversationsByAgent,
  listClosedConversationsByAgent,
  listClosedConversationsByContact,
  listInProgressConversations,
  listWaitingForAgentConversations,
  listInAutomationConversations,
  countClosedSince,
  listClosedSince,
  markBusinessHoursNoticeSent,
  setSuggestedReason,
  setConversationSector,
  markPhoneContested,
  isPhoneContested,
  setTriagePendingDocument,
  getTriagePendingDocument,
};
