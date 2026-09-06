const bcrypt = require('bcrypt');
const { getPool } = require('../db/pool');

const SALT_ROUNDS = 10;

function toPublicAgent(row) {
  return { id: row.id, name: row.name, email: row.email, role: row.role, active: row.active, createdAt: row.created_at };
}

async function createAgent({ name, email, password, role }) {
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const result = await getPool().query(
    `INSERT INTO agents (name, email, password_hash, role) VALUES ($1, $2, $3, $4)
     RETURNING id, name, email, role, active, created_at`,
    [name || email.split('@')[0], email, passwordHash, role]
  );
  return toPublicAgent(result.rows[0]);
}

async function findAgentByEmail(email) {
  const result = await getPool().query(
    'SELECT id, name, email, role, active, password_hash, created_at FROM agents WHERE email = $1',
    [email]
  );
  if (result.rowCount === 0) return null;
  const row = result.rows[0];
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    active: row.active,
    passwordHash: row.password_hash,
    createdAt: row.created_at,
  };
}

async function findAgentByIdWithPasswordHash(id) {
  const result = await getPool().query(
    'SELECT id, name, email, role, active, password_hash, created_at FROM agents WHERE id = $1',
    [id]
  );
  if (result.rowCount === 0) return null;
  const row = result.rows[0];
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    active: row.active,
    passwordHash: row.password_hash,
    createdAt: row.created_at,
  };
}

async function findAgentById(id) {
  const result = await getPool().query(
    'SELECT id, name, email, role, active, created_at FROM agents WHERE id = $1',
    [id]
  );
  if (result.rowCount === 0) return null;
  return toPublicAgent(result.rows[0]);
}

async function listAgents() {
  const result = await getPool().query(
    'SELECT id, name, email, role, active, created_at FROM agents ORDER BY email ASC'
  );
  return result.rows.map(toPublicAgent);
}

async function setAgentActive(id, active) {
  const result = await getPool().query(
    'UPDATE agents SET active = $2 WHERE id = $1 RETURNING id, name, email, role, active, created_at',
    [id, active]
  );
  if (result.rowCount === 0) return null;
  return toPublicAgent(result.rows[0]);
}

async function updateAgentPassword(id, passwordHash) {
  await getPool().query('UPDATE agents SET password_hash = $2 WHERE id = $1', [id, passwordHash]);
}

module.exports = {
  createAgent,
  findAgentByEmail,
  findAgentById,
  findAgentByIdWithPasswordHash,
  listAgents,
  setAgentActive,
  updateAgentPassword,
};
