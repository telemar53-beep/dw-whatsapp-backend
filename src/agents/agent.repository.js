const bcrypt = require('bcrypt');
const { getPool } = require('../db/pool');

const SALT_ROUNDS = 10;

function toPublicAgent(row) {
  return { id: row.id, email: row.email, role: row.role, createdAt: row.created_at };
}

async function createAgent({ email, password, role }) {
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const result = await getPool().query(
    `INSERT INTO agents (email, password_hash, role) VALUES ($1, $2, $3)
     RETURNING id, email, role, created_at`,
    [email, passwordHash, role]
  );
  return toPublicAgent(result.rows[0]);
}

async function findAgentByEmail(email) {
  const result = await getPool().query(
    'SELECT id, email, role, password_hash, created_at FROM agents WHERE email = $1',
    [email]
  );
  if (result.rowCount === 0) return null;
  const row = result.rows[0];
  return { id: row.id, email: row.email, role: row.role, passwordHash: row.password_hash, createdAt: row.created_at };
}

async function findAgentById(id) {
  const result = await getPool().query(
    'SELECT id, email, role, created_at FROM agents WHERE id = $1',
    [id]
  );
  if (result.rowCount === 0) return null;
  return toPublicAgent(result.rows[0]);
}

async function listAgents() {
  const result = await getPool().query(
    'SELECT id, email, role, created_at FROM agents ORDER BY email ASC'
  );
  return result.rows.map(toPublicAgent);
}

module.exports = { createAgent, findAgentByEmail, findAgentById, listAgents };
