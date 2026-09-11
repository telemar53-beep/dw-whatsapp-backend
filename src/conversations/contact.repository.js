const { getPool } = require('../db/pool');

function toContact(row) {
  return {
    id: row.id,
    phoneNumber: row.phone_number,
    displayName: row.display_name,
    avatarPath: row.avatar_path,
    avatarCheckedAt: row.avatar_checked_at,
    cityId: row.city_id,
    internalNote: row.internal_note,
    createdAt: row.created_at,
  };
}

async function findOrCreateContactByPhoneNumber(phoneNumber, displayName) {
  const existing = await getPool().query(
    'SELECT id, phone_number, display_name, avatar_path, avatar_checked_at, city_id, internal_note, created_at FROM contacts WHERE phone_number = $1',
    [phoneNumber]
  );
  if (existing.rowCount > 0) {
    return { ...toContact(existing.rows[0]), wasCreated: false };
  }
  const inserted = await getPool().query(
    `INSERT INTO contacts (phone_number, display_name) VALUES ($1, $2)
     ON CONFLICT (phone_number) DO UPDATE SET phone_number = EXCLUDED.phone_number
     RETURNING id, phone_number, display_name, avatar_path, avatar_checked_at, city_id, internal_note, created_at`,
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
     RETURNING id, phone_number, display_name, avatar_path, city_id, internal_note, created_at`,
    [contactId, Math.max(0, Math.floor(minIntervalMs || 0))]
  );
  if (result.rowCount === 0) return null;
  return toContact(result.rows[0]);
}

async function findContactById(id) {
  const result = await getPool().query(
    'SELECT id, phone_number, display_name, avatar_path, avatar_checked_at, city_id, internal_note, created_at FROM contacts WHERE id = $1',
    [id]
  );
  if (result.rowCount === 0) return null;
  return toContact(result.rows[0]);
}

async function findContactByPhoneNumber(phoneNumber) {
  const result = await getPool().query(
    'SELECT id, phone_number, display_name, avatar_path, avatar_checked_at, city_id, internal_note, created_at FROM contacts WHERE phone_number = $1',
    [phoneNumber]
  );
  if (result.rowCount === 0) return null;
  return toContact(result.rows[0]);
}

async function updateContact(id, { displayName, cityId, internalNote }) {
  const result = await getPool().query(
    `UPDATE contacts SET display_name = $2, city_id = $3, internal_note = $4 WHERE id = $1
     RETURNING id, phone_number, display_name, avatar_path, avatar_checked_at, city_id, internal_note, created_at`,
    [id, displayName || null, cityId || null, internalNote || null]
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

module.exports = {
  findOrCreateContactByPhoneNumber,
  setContactAvatarPath,
  claimContactAvatarRefresh,
  findContactById,
  findContactByPhoneNumber,
  updateContact,
  listContactsMissingAvatarForBaileysBackfill,
};
