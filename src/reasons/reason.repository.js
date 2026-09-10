const { getPool } = require('../db/pool');

function toReason(row) {
  return { id: row.id, name: row.name, active: row.active, createdAt: row.created_at };
}

async function listActiveReasons() {
  const result = await getPool().query(
    'SELECT id, name, active, created_at FROM contact_reasons WHERE active = true ORDER BY name ASC'
  );
  return result.rows.map(toReason);
}

async function listAllReasons() {
  const result = await getPool().query(
    'SELECT id, name, active, created_at FROM contact_reasons ORDER BY name ASC'
  );
  return result.rows.map(toReason);
}

async function findReasonById(id) {
  const result = await getPool().query(
    'SELECT id, name, active, created_at FROM contact_reasons WHERE id = $1',
    [id]
  );
  if (result.rowCount === 0) return null;
  return toReason(result.rows[0]);
}

async function createReason({ name }) {
  const result = await getPool().query(
    'INSERT INTO contact_reasons (name) VALUES ($1) RETURNING id, name, active, created_at',
    [name]
  );
  return toReason(result.rows[0]);
}

async function updateReason(id, { name, active }) {
  const result = await getPool().query(
    `UPDATE contact_reasons SET name = COALESCE($2, name), active = COALESCE($3, active), updated_at = now()
     WHERE id = $1 RETURNING id, name, active, created_at`,
    [id, name !== undefined ? name : null, active !== undefined ? active : null]
  );
  if (result.rowCount === 0) return null;
  return toReason(result.rows[0]);
}

module.exports = { listActiveReasons, listAllReasons, findReasonById, createReason, updateReason };
