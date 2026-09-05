const { getPool } = require('../db/pool');

function toContact(row) {
  return { id: row.id, phoneNumber: row.phone_number, displayName: row.display_name, createdAt: row.created_at };
}

async function findOrCreateContactByPhoneNumber(phoneNumber, displayName) {
  const existing = await getPool().query(
    'SELECT id, phone_number, display_name, created_at FROM contacts WHERE phone_number = $1',
    [phoneNumber]
  );
  if (existing.rowCount > 0) {
    return toContact(existing.rows[0]);
  }
  const inserted = await getPool().query(
    `INSERT INTO contacts (phone_number, display_name) VALUES ($1, $2)
     ON CONFLICT (phone_number) DO UPDATE SET phone_number = EXCLUDED.phone_number
     RETURNING id, phone_number, display_name, created_at`,
    [phoneNumber, displayName || null]
  );
  return toContact(inserted.rows[0]);
}

module.exports = { findOrCreateContactByPhoneNumber };
