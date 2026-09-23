const { getPool } = require('../db/pool');

function toMessage(row) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    direction: row.direction,
    content: row.content,
    messageType: row.message_type,
    mediaPath: row.media_path,
    mediaMimeType: row.media_mime_type,
    mediaFilename: row.media_filename,
    locationLatitude: row.location_latitude !== null ? Number(row.location_latitude) : null,
    locationLongitude: row.location_longitude !== null ? Number(row.location_longitude) : null,
    whatsappMessageId: row.whatsapp_message_id,
    status: row.status,
    repliedToMessageId: row.replied_to_message_id,
    sentBy: row.sent_by,
    transcription: row.transcription,
    transcriptionStatus: row.transcription_status,
    transcriptionDetail: row.transcription_detail,
    transcriptionModel: row.transcription_model,
    transcriptionMs: row.transcription_ms,
    audioDurationSeconds: row.audio_duration_seconds,
    metadata: row.metadata || null,
    createdAt: row.created_at,
  };
}

function toMessageWithReplyPreview(row) {
  return {
    ...toMessage(row),
    repliedToPreview: row.replied_to_message_id
      ? { content: row.replied_to_content, direction: row.replied_to_direction }
      : null,
  };
}

const MESSAGE_COLUMNS = `id, conversation_id, direction, content, whatsapp_message_id, status,
       message_type, media_path, media_mime_type, media_filename,
       location_latitude, location_longitude, replied_to_message_id, sent_by, created_at,
       transcription, transcription_status, transcription_detail,
       transcription_model, transcription_ms, audio_duration_seconds, metadata`;

async function createMessage({
  conversationId,
  direction,
  content,
  whatsappMessageId,
  status,
  messageType,
  mediaPath,
  mediaMimeType,
  mediaFilename,
  locationLatitude,
  locationLongitude,
  repliedToMessageId,
  sentBy,
  metadata,
  sentAt,
}) {
  const result = await getPool().query(
    `INSERT INTO messages (
       conversation_id, direction, content, whatsapp_message_id, status,
       message_type, media_path, media_mime_type, media_filename,
       location_latitude, location_longitude, replied_to_message_id, sent_by, metadata, created_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, COALESCE($15, now()))
     RETURNING ${MESSAGE_COLUMNS}`,
    [
      conversationId,
      direction,
      content || null,
      whatsappMessageId || null,
      status,
      messageType || 'text',
      mediaPath || null,
      mediaMimeType || null,
      mediaFilename || null,
      locationLatitude != null ? locationLatitude : null,
      locationLongitude != null ? locationLongitude : null,
      repliedToMessageId || null,
      sentBy || 'human',
      // JSONB: serializamos aqui em vez de entregar o objeto ao pg, para não
      // depender do palpite do driver sobre o tipo do parâmetro.
      metadata ? JSON.stringify(metadata) : null,
      // A hora que o provedor informou. Ausente cai no now(): melhor a hora da
      // gravacao do que uma data inventada.
      sentAt || null,
    ]
  );
  return toMessage(result.rows[0]);
}

// O video e comprimido DEPOIS de gravado, fora do webhook: quando o worker
// termina, ele troca o arquivo da mensagem por aqui.
async function updateMessageMedia(messageId, { mediaPath, mediaMimeType }) {
  const result = await getPool().query(
    `UPDATE messages SET media_path = $2, media_mime_type = $3 WHERE id = $1 RETURNING ${MESSAGE_COLUMNS}`,
    [messageId, mediaPath, mediaMimeType]
  );
  if (result.rowCount === 0) return null;
  return toMessage(result.rows[0]);
}

// Retenção de mídia: o disco só cresce, porque nada nunca era apagado. Arquivo
// com mais de N meses sai; a MENSAGEM fica — a bolha, a legenda e o tipo
// permanecem no histórico do atendimento, e só o arquivo some.
//
// `media_path IS NOT NULL` também exclui o que já foi limpo numa passagem
// anterior: sem isso a varredura devolveria as mesmas linhas para sempre.
// Dias, e nao meses: a retencao virou o numero que dimensiona o disco em regime
// (disco ≈ ritmo diario × dias de retencao), e mes e unidade grossa demais para
// ajustar isso — alem de variar de 28 a 31 dias conforme o mes em que a
// varredura roda.
async function listExpiredMedia({ olderThanDays, limit = 500 }) {
  const result = await getPool().query(
    `SELECT id, media_path, media_mime_type, message_type, created_at
       FROM messages
      WHERE media_path IS NOT NULL
        AND created_at < now() - ($1::int * interval '1 day')
      ORDER BY created_at ASC
      LIMIT $2`,
    [olderThanDays, limit]
  );
  return result.rows.map((row) => ({
    id: row.id,
    mediaPath: row.media_path,
    mediaMimeType: row.media_mime_type,
    messageType: row.message_type,
    createdAt: row.created_at,
  }));
}

// Só o caminho do arquivo é limpo. O message_type continua 'image'/'video', e é
// isso que permite a tela dizer "arquivo removido" em vez de sumir com a bolha.
async function clearMessageMedia(messageId) {
  const result = await getPool().query(
    `UPDATE messages SET media_path = NULL WHERE id = $1 RETURNING ${MESSAGE_COLUMNS}`,
    [messageId]
  );
  if (result.rowCount === 0) return null;
  return toMessage(result.rows[0]);
}

async function updateMessageStatus(messageId, status) {
  const result = await getPool().query(
    `UPDATE messages SET status = $2 WHERE id = $1 RETURNING ${MESSAGE_COLUMNS}`,
    [messageId, status]
  );
  if (result.rowCount === 0) return null;
  return toMessage(result.rows[0]);
}

const STATUS_RANK_SQL = `CASE status WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 WHEN 'failed' THEN 4 ELSE 0 END`;

async function advanceMessageStatus(whatsappMessageId, status) {
  const result = await getPool().query(
    `UPDATE messages SET status = $2
     WHERE whatsapp_message_id = $1
       AND ${STATUS_RANK_SQL} < (CASE $2 WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 WHEN 'failed' THEN 4 ELSE 0 END)
     RETURNING ${MESSAGE_COLUMNS}`,
    [whatsappMessageId, status]
  );
  if (result.rowCount === 0) return null;
  return toMessage(result.rows[0]);
}

async function recordMessageSent(messageId, whatsappMessageId) {
  const result = await getPool().query(
    `UPDATE messages SET whatsapp_message_id = $2 WHERE id = $1 RETURNING ${MESSAGE_COLUMNS}`,
    [messageId, whatsappMessageId]
  );
  if (result.rowCount === 0) return null;
  return toMessage(result.rows[0]);
}

async function listMessagesByConversation(conversationId) {
  const result = await getPool().query(
    `SELECT m.id, m.conversation_id, m.direction, m.content, m.whatsapp_message_id, m.status,
            m.message_type, m.media_path, m.media_mime_type, m.media_filename,
            m.location_latitude, m.location_longitude, m.replied_to_message_id, m.sent_by, m.created_at,
            m.transcription, m.transcription_status, m.transcription_detail,
            m.transcription_model, m.transcription_ms, m.audio_duration_seconds, m.metadata,
            rm.content AS replied_to_content, rm.direction AS replied_to_direction
     FROM messages m
     LEFT JOIN messages rm ON rm.id = m.replied_to_message_id
     WHERE m.conversation_id = $1
     ORDER BY m.created_at ASC`,
    [conversationId]
  );
  return result.rows.map(toMessageWithReplyPreview);
}

/**
 * As últimas `limit` mensagens da conversa, em ordem cronológica (mais antiga
 * primeiro). Diferente de listMessagesByConversation (que não pagina e serve
 * a tela de atendimento inteira), esta função existe para alimentar o
 * histórico enviado à IA: pega as mais NOVAS via ORDER BY created_at DESC
 * LIMIT, e só então inverte para a ordem de leitura. Um LIMIT aplicado direto
 * num ORDER BY ASC devolveria as mensagens mais antigas da conversa, fazendo
 * a IA nunca ver o que o cliente acabou de escrever.
 */
async function listRecentMessagesByConversation(conversationId, limit) {
  const result = await getPool().query(
    `SELECT m.id, m.conversation_id, m.direction, m.content, m.whatsapp_message_id, m.status,
            m.message_type, m.media_path, m.media_mime_type, m.media_filename,
            m.location_latitude, m.location_longitude, m.replied_to_message_id, m.sent_by, m.created_at,
            m.transcription, m.transcription_status, m.transcription_detail,
            m.transcription_model, m.transcription_ms, m.audio_duration_seconds, m.metadata,
            rm.content AS replied_to_content, rm.direction AS replied_to_direction
     FROM messages m
     LEFT JOIN messages rm ON rm.id = m.replied_to_message_id
     WHERE m.conversation_id = $1
     ORDER BY m.created_at DESC
     LIMIT $2`,
    [conversationId, limit]
  );
  return result.rows.map(toMessageWithReplyPreview).reverse();
}

async function findMessageById(id) {
  const result = await getPool().query(`SELECT ${MESSAGE_COLUMNS} FROM messages WHERE id = $1`, [id]);
  if (result.rowCount === 0) return null;
  return toMessage(result.rows[0]);
}

/**
 * A mensagem citada por um reply INBOUND, pelo whatsapp_message_id que o
 * cliente ecoou de volta. Escopado à conversa: o mesmo whatsapp_message_id
 * nunca deveria repetir entre conversas diferentes, mas restringir aqui evita
 * que uma citação vaze para outra conversa caso isso um dia aconteça.
 */
async function findMessageByWhatsappMessageId(conversationId, whatsappMessageId) {
  const result = await getPool().query(
    `SELECT ${MESSAGE_COLUMNS} FROM messages
      WHERE conversation_id = $1 AND whatsapp_message_id = $2
      LIMIT 1`,
    [conversationId, whatsappMessageId]
  );
  if (result.rowCount === 0) return null;
  return toMessage(result.rows[0]);
}

/**
 * O id da mensagem inbound mais recente da conversa (ou null, se não houver
 * nenhuma). Usada pela fila da IA para saber se um job ainda representa a
 * última coisa que o cliente escreveu — filtra por direction porque a
 * mensagem cronologicamente mais nova pode muito bem ser uma resposta da
 * própria IA, o que faria todo job se achar "ultrapassado".
 *
 * "Utilizável pela IA" = texto, ou áudio já transcrito — mas só quando
 * `incluirAudioTranscrito` é true (padrão). Foto e documento continuam de
 * fora sempre: uma foto enviada após um texto não deve fazer a IA desistir
 * de responder ao texto — sem esse filtro ela ainda viraria "a última
 * inbound", e o job do texto, ao comparar seu messageId contra ela, se
 * acharia ultrapassado e sairia sem responder. Ninguém respondia ao cliente.
 *
 * `incluirAudioTranscrito: false` existe para o mesmo motivo, do lado do
 * áudio: com `transcriptionFeedAi` desligado, um áudio transcrito nunca gera
 * turno de IA (o worker de transcrição não enfileira job pra ele). Se ele
 * ainda contasse aqui como "última mensagem utilizável", o job do texto
 * anterior se acharia ultrapassado e sairia sem responder — o mesmo silêncio
 * que o filtro original evita para foto/documento, só que do lado do áudio.
 * O chamador (ai-worker.js) passa `config.transcriptionFeedAi` nessa opção.
 *
 * `tiposTriagem: true` existe para a triagem por IA: lá, imagem, documento e
 * áudio (transcrito ou não) também geram turno — viram placeholder no
 * histórico — então o filtro conta exatamente
 * `text|image|document|audio` (fix round 1, I1). Um `qualquerTipo` sem
 * restrição nenhuma era amplo demais: figurinha, vídeo e localização (que
 * NUNCA agendam job — ver scheduleAiTriage em ai.service.js) viravam "a mais
 * nova" e faziam o job do texto anterior se achar ultrapassado, emudecendo a
 * triagem até o timeout.
 */
async function findLatestInboundMessageId(conversationId, { incluirAudioTranscrito = true, tiposTriagem = false } = {}) {
  const filtroTipo = tiposTriagem
    ? `AND message_type IN ('text', 'image', 'document', 'audio')`
    : incluirAudioTranscrito
      ? `AND (message_type = 'text' OR (message_type = 'audio' AND transcription_status = 'completed'))`
      : `AND message_type = 'text'`;
  const result = await getPool().query(
    `SELECT id FROM messages
      WHERE conversation_id = $1 AND direction = 'inbound'
        ${filtroTipo}
      ORDER BY created_at DESC LIMIT 1`,
    [conversationId]
  );
  if (result.rowCount === 0) return null;
  return result.rows[0].id;
}

/**
 * Última imagem que o CLIENTE enviou nesta conversa dentro da janela pedida.
 * Quem escolhe a imagem é o servidor, nunca o modelo: a leitura de comprovante
 * não recebe parâmetro nenhum, só o que o cliente acabou de mandar. Imagem de
 * saída e texto ficam de fora, e o recorte por tempo evita ler a foto antiga
 * de outro assunto.
 */
async function findLatestInboundImage(conversationId, { withinMs }) {
  const result = await getPool().query(
    `SELECT id, media_path, media_mime_type, created_at FROM messages
      WHERE conversation_id = $1 AND direction = 'inbound' AND message_type = 'image'
        AND created_at > now() - ($2::bigint * interval '1 millisecond')
      ORDER BY created_at DESC LIMIT 1`,
    [conversationId, Math.max(0, Math.floor(withinMs))]
  );
  if (result.rowCount === 0) return null;
  const row = result.rows[0];
  return { id: row.id, mediaPath: row.media_path, mediaMimeType: row.media_mime_type, createdAt: row.created_at };
}

async function markTranscriptionPending(messageId, audioDurationSeconds) {
  const result = await getPool().query(
    `UPDATE messages SET transcription_status = 'pending', audio_duration_seconds = $2
     WHERE id = $1 RETURNING ${MESSAGE_COLUMNS}`,
    [messageId, audioDurationSeconds !== undefined ? audioDurationSeconds : null]
  );
  if (result.rowCount === 0) return null;
  return toMessage(result.rows[0]);
}

async function markTranscriptionProcessing(messageId) {
  const result = await getPool().query(
    `UPDATE messages SET transcription_status = 'processing'
     WHERE id = $1 RETURNING ${MESSAGE_COLUMNS}`,
    [messageId]
  );
  if (result.rowCount === 0) return null;
  return toMessage(result.rows[0]);
}

async function saveTranscription(messageId, { transcription, model, ms }) {
  const result = await getPool().query(
    `UPDATE messages
        SET transcription = $2, transcription_status = 'completed',
            transcription_model = $3, transcription_ms = $4, transcription_detail = NULL
      WHERE id = $1 RETURNING ${MESSAGE_COLUMNS}`,
    [messageId, transcription, model, ms !== undefined ? ms : null]
  );
  if (result.rowCount === 0) return null;
  return toMessage(result.rows[0]);
}

async function markTranscriptionFailed(messageId, { status, detail, ms }) {
  const result = await getPool().query(
    `UPDATE messages
        SET transcription_status = $2, transcription_detail = $3, transcription_ms = $4
      WHERE id = $1 RETURNING ${MESSAGE_COLUMNS}`,
    [messageId, status, detail || null, ms !== undefined ? ms : null]
  );
  if (result.rowCount === 0) return null;
  return toMessage(result.rows[0]);
}

/**
 * Marca a mensagem como falha, com o motivo gravado em metadata.motivoFalha.
 *
 * Usada pelo caminho síncrono do envio (o catch do outbound-worker, quando a
 * própria chamada à API estoura). O motivo vive na metadata - igual à queda de
 * Pix para texto (markPixFallbackSent) - porque é dali que o chat lê a
 * explicação a mostrar sob o balão vermelho.
 *
 * Só grava se a mensagem ainda não tem motivoFalha: o webhook de status da
 * Meta/360dialog (markMessageFailedByWhatsappId) pode ter chegado primeiro com
 * o motivo real e estruturado, e este caminho não pode sobrescrevê-lo com um
 * texto menos informativo vindo do worker. Retorna null quando não atualiza
 * nada.
 */
async function markMessageFailed(messageId, motivo) {
  const result = await getPool().query(
    `UPDATE messages
        SET status = 'failed',
            metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('motivoFalha', $2::text)
      WHERE id = $1
        AND (metadata->>'motivoFalha') IS NULL
      RETURNING ${MESSAGE_COLUMNS}`,
    [messageId, motivo || null]
  );
  if (result.rowCount === 0) return null;
  return toMessage(result.rows[0]);
}

/**
 * A mesma marca de falha, mas pelo caminho assíncrono: o webhook de status da
 * Meta/360dialog, que só sabe o whatsapp_message_id (a mensagem já foi
 * enviada e recebeu o id de volta).
 *
 * Usa a mesma guarda de ordem que advanceMessageStatus - STATUS_RANK_SQL < o
 * rank de 'failed' (o mais alto, 4) - para não reescrever um status que já
 * chegou a 'failed' por outro caminho (ex.: o próprio catch do worker já
 * marcou antes do webhook chegar). Igual a advanceMessageStatus, uma condição
 * de corrida entre duas chamadas é resolvida pelo banco.
 */
async function markMessageFailedByWhatsappId(whatsappMessageId, motivo) {
  const result = await getPool().query(
    `UPDATE messages
        SET status = 'failed',
            metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('motivoFalha', $2::text)
      WHERE whatsapp_message_id = $1
        AND ${STATUS_RANK_SQL} < 4
      RETURNING ${MESSAGE_COLUMNS}`,
    [whatsappMessageId, motivo || null]
  );
  if (result.rowCount === 0) return null;
  return toMessage(result.rows[0]);
}

/**
 * Marca que a queda para texto do cartão de Pix já foi feita nesta mensagem.
 *
 * A marca vive na própria metadata da mensagem porque precisa sobreviver a um
 * restart do worker e a um retry da fila: sem ela, o cliente receberia o código
 * duas vezes. O UPDATE só pega quem ainda não está marcado, então a corrida
 * entre dois processos é resolvida pelo banco e não por quem chega antes.
 *
 * Junto da marca vai o motivo ('codigo_sem_chave', 'cartao_recusado' ou
 * 'cartao_nao_entregue'): é dele que o chat tira a explicação que o atendente
 * lê no balão, para ninguém achar que o cliente recebeu o cartão nativo quando
 * o que saiu foi o texto. Como o UPDATE só pega quem ainda não está marcado, o
 * motivo do primeiro desfecho é o que fica — uma segunda chamada não reescreve.
 *
 * Devolve true quando esta chamada foi a que marcou (pode enfileirar o texto),
 * false quando alguém já tinha marcado antes.
 */
async function markPixFallbackSent(messageId, motivo) {
  const result = await getPool().query(
    `UPDATE messages
        SET metadata = COALESCE(metadata, '{}'::jsonb)
                       || jsonb_build_object('fallbackTextoEnviado', true, 'motivoTexto', $2::text)
      WHERE id = $1
        AND (metadata->>'fallbackTextoEnviado') IS DISTINCT FROM 'true'
      RETURNING id`,
    [messageId, motivo || null]
  );
  return result.rowCount > 0;
}

module.exports = {
  createMessage,
  updateMessageStatus,
  updateMessageMedia,
  listExpiredMedia,
  clearMessageMedia,
  advanceMessageStatus,
  markMessageFailed,
  markMessageFailedByWhatsappId,
  recordMessageSent,
  listMessagesByConversation,
  listRecentMessagesByConversation,
  findMessageById,
  findMessageByWhatsappMessageId,
  findLatestInboundMessageId,
  findLatestInboundImage,
  markTranscriptionPending,
  markTranscriptionProcessing,
  saveTranscription,
  markTranscriptionFailed,
  markPixFallbackSent,
};
