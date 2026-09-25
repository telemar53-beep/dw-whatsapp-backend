const { getPool } = require('../db/pool');
const { brazilianNumberVariants } = require('./phone-variants');

function toContact(row) {
  return {
    id: row.id,
    phoneNumber: row.phone_number,
    displayName: row.display_name,
    avatarPath: row.avatar_path,
    avatarCheckedAt: row.avatar_checked_at,
    cityId: row.city_id,
    localityId: row.locality_id,
    internalNote: row.internal_note,
    createdAt: row.created_at,
    sgpClientId: row.sgp_client_id,
    sgpContractId: row.sgp_contract_id,
    sgpDocument: row.sgp_document,
    sgpFirstName: row.sgp_first_name,
  };
}

async function findOrCreateContactByPhoneNumber(phoneNumber, displayName) {
  const existing = await getPool().query(
    'SELECT id, phone_number, display_name, avatar_path, avatar_checked_at, city_id, locality_id, internal_note, created_at, sgp_client_id, sgp_contract_id, sgp_document, sgp_first_name FROM contacts WHERE phone_number = $1',
    [phoneNumber]
  );
  if (existing.rowCount > 0) {
    return { ...toContact(existing.rows[0]), wasCreated: false };
  }
  const inserted = await getPool().query(
    `INSERT INTO contacts (phone_number, display_name) VALUES ($1, $2)
     ON CONFLICT (phone_number) DO UPDATE SET phone_number = EXCLUDED.phone_number
     RETURNING id, phone_number, display_name, avatar_path, avatar_checked_at, city_id, locality_id, internal_note, created_at, sgp_client_id, sgp_contract_id, sgp_document, sgp_first_name`,
    [phoneNumber, displayName || null]
  );
  return { ...toContact(inserted.rows[0]), wasCreated: true };
}

async function setContactAvatarPath(contactId, avatarPath) {
  await getPool().query('UPDATE contacts SET avatar_path = $2 WHERE id = $1', [contactId, avatarPath]);
}

// Reserva atomicamente o direito de reconsultar a foto do contato no WhatsApp.
// Devolve o contato (com o avatar_path ANTERIOR, para o chamador saber se algo
// mudou) quando a última consulta é mais antiga que `minIntervalMs` — ou nunca
// aconteceu — e null quando outra consulta já foi feita dentro do intervalo.
// Como a marcação e a checagem ficam no mesmo UPDATE, duas mensagens
// simultâneas do mesmo contato disparam uma única busca.
async function claimContactAvatarRefresh(contactId, minIntervalMs) {
  const result = await getPool().query(
    `UPDATE contacts SET avatar_checked_at = NOW()
     WHERE id = $1
       AND (avatar_checked_at IS NULL OR avatar_checked_at < NOW() - ($2::bigint * INTERVAL '1 millisecond'))
     RETURNING id, phone_number, display_name, avatar_path, city_id, locality_id, internal_note, created_at, sgp_client_id, sgp_contract_id, sgp_document, sgp_first_name`,
    [contactId, Math.max(0, Math.floor(minIntervalMs || 0))]
  );
  if (result.rowCount === 0) return null;
  return toContact(result.rows[0]);
}

async function findContactById(id) {
  const result = await getPool().query(
    'SELECT id, phone_number, display_name, avatar_path, avatar_checked_at, city_id, locality_id, internal_note, created_at, sgp_client_id, sgp_contract_id, sgp_document, sgp_first_name FROM contacts WHERE id = $1',
    [id]
  );
  if (result.rowCount === 0) return null;
  return toContact(result.rows[0]);
}

async function findContactByPhoneNumber(phoneNumber) {
  const result = await getPool().query(
    'SELECT id, phone_number, display_name, avatar_path, avatar_checked_at, city_id, locality_id, internal_note, created_at, sgp_client_id, sgp_contract_id, sgp_document, sgp_first_name FROM contacts WHERE phone_number = $1',
    [phoneNumber]
  );
  if (result.rowCount === 0) return null;
  return toContact(result.rows[0]);
}

/**
 * Atualização PARCIAL de verdade: campo ausente do objeto permanece como está,
 * e só `null` apaga (ADR-011). A distinção entre "não enviou" e "enviou null"
 * some se ela for feita com `|| null`, então ela viaja até o SQL como um
 * booleano por campo — o mesmo idioma que `setContactSgpLink` já usa aqui.
 * Nenhuma coluna do SGP é tocada: quem cuida delas é `setContactSgpLink`.
 */
async function updateContact(id, patch = {}) {
  const manterNome = !('displayName' in patch);
  const manterCidade = !('cityId' in patch);
  // A localidade tem a mesma sentinela da cidade, e pelo mesmo motivo: o que
  // decide "não mexe" é a chave NÃO ESTAR no patch. `localityId: null` é um
  // pedido legítimo de apagar, e precisa passar.
  const manterLocalidade = !('localityId' in patch);
  const manterNota = !('internalNote' in patch);
  const result = await getPool().query(
    `UPDATE contacts SET
       display_name  = CASE WHEN $3::boolean THEN display_name  ELSE $2 END,
       city_id       = CASE WHEN $5::boolean THEN city_id       ELSE $4::uuid END,
       internal_note = CASE WHEN $7::boolean THEN internal_note ELSE $6 END,
       locality_id   = CASE WHEN $9::boolean THEN locality_id   ELSE $8::uuid END
     WHERE id = $1
     RETURNING id, phone_number, display_name, avatar_path, avatar_checked_at, city_id, locality_id, internal_note, created_at, sgp_client_id, sgp_contract_id, sgp_document, sgp_first_name`,
    [
      id,
      manterNome ? null : patch.displayName ?? null, manterNome,
      manterCidade ? null : patch.cityId ?? null, manterCidade,
      manterNota ? null : patch.internalNote ?? null, manterNota,
      manterLocalidade ? null : patch.localityId ?? null, manterLocalidade,
    ]
  );
  if (result.rowCount === 0) return null;
  return toContact(result.rows[0]);
}

// Preenche a cidade só quando o contato ainda não tem uma. A condição mora no
// próprio UPDATE de propósito: a cidade descoberta no SGP nunca pode passar por
// cima da que um atendente escolheu à mão, e ler antes para decidir depois
// deixaria uma corrida entre dois turnos do mesmo contato. Devolve o contato
// atualizado, ou null quando nada foi tocado (já tinha cidade ou não existe).
async function setContactCityIfEmpty(contactId, cityId) {
  const result = await getPool().query(
    `UPDATE contacts SET city_id = $2 WHERE id = $1 AND city_id IS NULL
     RETURNING id, phone_number, display_name, avatar_path, avatar_checked_at, city_id, locality_id, internal_note, created_at, sgp_client_id, sgp_contract_id, sgp_document, sgp_first_name`,
    [contactId, cityId]
  );
  if (result.rowCount === 0) return null;
  return toContact(result.rows[0]);
}

// Mesma regra de setContactCityIfEmpty, e pelo mesmo motivo: a condição mora no
// próprio UPDATE para o preenchimento automático nunca passar por cima da
// localidade que um atendente escolheu à mão, e para não haver corrida entre
// dois turnos do mesmo contato. Devolve null quando nada foi tocado.
async function setContactLocalityIfEmpty(contactId, localityId) {
  const result = await getPool().query(
    `UPDATE contacts SET locality_id = $2 WHERE id = $1 AND locality_id IS NULL
     RETURNING id, phone_number, display_name, avatar_path, avatar_checked_at, city_id, locality_id, internal_note, created_at, sgp_client_id, sgp_contract_id, sgp_document, sgp_first_name`,
    [contactId, localityId]
  );
  if (result.rowCount === 0) return null;
  return toContact(result.rows[0]);
}

async function listContactsMissingAvatarForBaileysBackfill() {
  const result = await getPool().query(`
    SELECT DISTINCT ON (ct.id) ct.id AS contact_id, ct.phone_number, c.channel_id
    FROM contacts ct
    JOIN conversations c ON c.contact_id = ct.id
    JOIN channels ch ON ch.id = c.channel_id AND ch.type = 'baileys'
    WHERE ct.avatar_path IS NULL
    ORDER BY ct.id, c.updated_at DESC
  `);
  return result.rows.map((row) => ({
    contactId: row.contact_id,
    phoneNumber: row.phone_number,
    channelId: row.channel_id,
  }));
}

// sgpFirstName tem três estados de propósito: um nome grava, `null` apaga (é o
// que esquecer_identificacao faz, limpando o vínculo inteiro) e `undefined`
// MANTÉM o que já estava — quem só troca de contrato não precisa reenviar o
// nome. Um COALESCE não serviria: o driver manda undefined como NULL e os dois
// casos ficariam iguais no SQL — daí a flag que decide manter ou gravar.
async function setContactSgpLink(contactId, { sgpClientId, sgpContractId, sgpDocument, sgpFirstName }) {
  const manterNome = sgpFirstName === undefined;
  const result = await getPool().query(
    `UPDATE contacts
        SET sgp_client_id = $2, sgp_contract_id = $3, sgp_document = $4,
            sgp_first_name = CASE WHEN $6::boolean THEN sgp_first_name ELSE $5 END
      WHERE id = $1 RETURNING id, phone_number, display_name, avatar_path, avatar_checked_at, city_id, locality_id, internal_note, created_at, sgp_client_id, sgp_contract_id, sgp_document, sgp_first_name`,
    [contactId, sgpClientId, sgpContractId, sgpDocument, manterNome ? null : sgpFirstName, manterNome]
  );
  if (result.rowCount === 0) return null;
  return toContact(result.rows[0]);
}

// "Histórico próprio" (definição aprovada pelo proprietário, Fase 1A, 25/09/2026): mensagem
// de entrada, vínculo com o SGP, nota interna, ou conversa que não seja só disparo silencioso.
// Um contato cujas únicas conversas são `silent` de disparo, sem entrada, não tem histórico
// próprio: é o contato fantasma que o nono dígito criou.
// É a régua da RENOMEAÇÃO (renameGhostContactToWaId). A escolha entre as formas com e sem o 9
// usa outra, mais estrita: TEM_EVIDENCIA_IDENTIDADE_FORTE, logo abaixo.
const TEM_HISTORICO_PROPRIO = `(
  ct.sgp_document IS NOT NULL
  OR coalesce(ct.internal_note, '') <> ''
  OR EXISTS (SELECT 1 FROM conversations c JOIN messages m ON m.conversation_id = c.id
             WHERE c.contact_id = ct.id AND m.direction = 'inbound')
  OR EXISTS (SELECT 1 FROM conversations c WHERE c.contact_id = ct.id AND c.status <> 'silent')
)`;

// "Evidência forte de identidade" (revisão da Fase 1A, 25/09/2026, a partir dos 6 pares ambíguos
// de produção): é o que decide ENTRE as formas com e sem o 9 quando as duas existem. Entrada
// real do cliente, vínculo com o SGP (documento, cliente ou contrato) ou nota interna. Conversa
// não-silent SEM entrada (ex.: atendente abriu, mandou e encerrou sem resposta) é histórico —
// continua preservada e continua travando a renomeação (TEM_HISTORICO_PROPRIO) —, mas não diz
// quem é o cliente: nos 6 pares, era só isso que prendia o disparo no contato com 9.
const TEM_EVIDENCIA_IDENTIDADE_FORTE = `(
  ct.sgp_document IS NOT NULL
  OR ct.sgp_client_id IS NOT NULL
  OR ct.sgp_contract_id IS NOT NULL
  OR coalesce(ct.internal_note, '') <> ''
  OR EXISTS (SELECT 1 FROM conversations c JOIN messages m ON m.conversation_id = c.id
             WHERE c.contact_id = ct.id AND m.direction = 'inbound')
)`;

/**
 * As formas pedidas do número que já existem como contato, cada uma com as duas marcações:
 * histórico próprio (a régua da renomeação) e evidência forte de identidade (a régua da
 * escolha). Alimenta a escolha do contato do disparo (dispatch-contact.js).
 */
async function findContactsWithOwnHistoryByPhoneNumbers(phoneNumbers) {
  const result = await getPool().query(
    `SELECT ct.id, ct.phone_number, ct.display_name, ct.avatar_path, ct.avatar_checked_at, ct.city_id, ct.locality_id,
            ct.internal_note, ct.created_at, ct.sgp_client_id, ct.sgp_contract_id, ct.sgp_document, ct.sgp_first_name,
            ${TEM_HISTORICO_PROPRIO} AS tem_historico_proprio,
            ${TEM_EVIDENCIA_IDENTIDADE_FORTE} AS tem_evidencia_forte
     FROM contacts ct WHERE ct.phone_number = ANY($1::text[])`,
    [phoneNumbers]
  );
  return result.rows.map((row) => ({
    contact: toContact(row),
    temHistoricoProprio: row.tem_historico_proprio,
    temEvidenciaForte: row.tem_evidencia_forte,
  }));
}

/**
 * Troca o número do contato pelo wa_id que a Meta devolveu no envio (regra revista pelo
 * proprietário em 25/09/2026, antes do merge da Fase 1A). Só troca quando:
 *  1. o contato NÃO tem histórico próprio (é um fantasma de disparo — vários disparos antigos
 *     em conversa silent não impedem);
 *  2. nenhum outro contato já tem o wa_id;
 *  3. o wa_id e o número atual são as formas com e sem o nono dígito do mesmo celular;
 *  4. não é fixo (a variante de celular nunca existe para fixo — brazilianNumberVariants).
 * Além disso, o número no banco tem de ser ainda o `currentPhone` validado aqui, e a mensagem
 * que trouxe o wa_id tem de ser deste contato.
 *
 * Não é união de contatos: conversas e mensagens continuam no mesmo contact_id; só o
 * phone_number muda. Tudo numa instrução só, para a checagem e a troca não se separarem: se
 * uma resposta chegar no meio ou outro contato ganhar o número, o UPDATE não casa. A
 * unicidade de phone_number é a última trava (23505 vira "não renomeou").
 * Devolve true se renomeou.
 */
async function renameGhostContactToWaId(contactId, currentPhone, waId, messageId) {
  const atual = String(currentPhone || '');
  const alvo = String(waId || '');
  if (!alvo || alvo === atual || !brazilianNumberVariants(atual).includes(alvo)) return false;
  try {
    const result = await getPool().query(
      `UPDATE contacts ct SET phone_number = $3
       WHERE ct.id = $1
         AND ct.phone_number = $2
         AND NOT ${TEM_HISTORICO_PROPRIO}
         AND EXISTS (SELECT 1 FROM messages m JOIN conversations c ON c.id = m.conversation_id
                     WHERE m.id = $4 AND c.contact_id = ct.id)
         AND NOT EXISTS (SELECT 1 FROM contacts o WHERE o.phone_number = $3)
       RETURNING ct.id`,
      [contactId, atual, alvo, messageId]
    );
    return result.rowCount === 1;
  } catch (err) {
    if (err.code === '23505') return false;
    throw err;
  }
}

module.exports = {
  findContactsWithOwnHistoryByPhoneNumbers,
  renameGhostContactToWaId,
  findOrCreateContactByPhoneNumber,
  setContactAvatarPath,
  claimContactAvatarRefresh,
  findContactById,
  findContactByPhoneNumber,
  updateContact,
  setContactCityIfEmpty,
  setContactLocalityIfEmpty,
  listContactsMissingAvatarForBaileysBackfill,
  setContactSgpLink,
};
