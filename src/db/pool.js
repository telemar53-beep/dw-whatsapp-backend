const { Pool } = require('pg');
const { loadConfig } = require('../config/env');

let pool;

function getPool() {
  if (!pool) {
    const config = loadConfig();
    pool = new Pool({ connectionString: config.databaseUrl });
  }
  return pool;
}

async function closePool() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

module.exports = { getPool, closePool };
