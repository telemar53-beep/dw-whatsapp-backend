const { Pool } = require('pg');
const { loadConfig } = require('../config/env');

let pool;

function getPool() {
  if (!pool) {
    const config = loadConfig();
    pool = new Pool({ connectionString: config.databaseUrl });
    pool.on('error', (err) => {
      console.error('Unexpected error on idle postgres client', err);
    });
  }
  return pool;
}

async function withTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function closePool() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

module.exports = { getPool, closePool, withTransaction };
