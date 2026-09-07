const { getPool } = require('../db/pool');

function toContact(row) {
  return {
    id: row.id,
    phoneNumber: row.phone_number,
    displayName: row.display_name,
    avatarPath: row.avatar_path,
    cityId: row.city_id,
    createdAt: row.created_at,
  };
}

async function findOrCreateContactByPhoneNumber(phoneNumber, displayName) {
  const existing = await getPool().query(
    'SELECT id, phone_number, display_name, avatar_path, city_id, created_at FROM contacts WHERE phone_number = $1',
    [phoneNumber]
  );
  if (existing.rowCount > 0) {
    return { ...toContact(existing.rows[0]), wasCreated: false };
  }
  const inserted = await getPool().query(
    `INSERT INTO contacts (phone_number, display_name) VALUES ($1, $2)
     ON CONFLICT (phone_number) DO UPDATE SET phone_number = EXCLUDED.phone_number
     RETURNING id, phone_number, display_name, avatar_path, city_id, created_at`,
    [phoneNumber, displayName || null]
  );
  return { ...toContact(inserted.rows[0]), wasCreated: true };
}

async function setContactAvatarPath(contactId, avatarPath) {
  await getPool().query('UPDATE contacts SET avatar_path = $2 WHERE id = $1', [contactId, avatarPath]);
}

async function findContactById(id) {
  const result = await getPool().query(
    'SELECT id, phone_number, display_name, avatar_path, city_id, created_at FROM contacts WHERE id = $1',
    [id]
  );
  if (result.rowCount === 0) return null;
  return toContact(result.rows[0]);
}

async function updateContact(id, { displayName, cityId }) {
  const result = await getPool().query(
    `UPDATE contacts SET display_name = $2, city_id = $3 WHERE id = $1
     RETURNING id, phone_number, display_name, avatar_path, city_id, created_at`,
    [id, displayName || null, cityId || null]
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
  findContactById,
  updateContact,
  listContactsMissingAvatarForBaileysBackfill,
};
