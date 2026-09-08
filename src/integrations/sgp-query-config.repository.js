const { getPool } = require('../db/pool');

function toConfig(row) {
  return {
    id: row.id,
    baseUrl: row.base_url,
    app: row.app,
    token: row.token,
    enabled: row.enabled,
  };
}

async function getSgpQueryConfig() {
  const result = await getPool().query('SELECT * FROM sgp_query_config ORDER BY created_at ASC LIMIT 1');
  if (result.rowCount === 0) return null;
  return toConfig(result.rows[0]);
}

async function upsertSgpQueryConfig({ baseUrl, app, token, enabled }) {
  const existing = await getPool().query('SELECT id, token FROM sgp_query_config ORDER BY created_at ASC LIMIT 1');
  if (existing.rowCount === 0) {
    const result = await getPool().query(
      `INSERT INTO sgp_query_config (base_url, app, token, enabled)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [baseUrl, app, token, enabled]
    );
    return toConfig(result.rows[0]);
  }
  const nextToken = token || existing.rows[0].token;
  const result = await getPool().query(
    `UPDATE sgp_query_config SET base_url = $2, app = $3, token = $4, enabled = $5, updated_at = now()
     WHERE id = $1 RETURNING *`,
    [existing.rows[0].id, baseUrl, app, nextToken, enabled]
  );
  return toConfig(result.rows[0]);
}

module.exports = { getSgpQueryConfig, upsertSgpQueryConfig };
