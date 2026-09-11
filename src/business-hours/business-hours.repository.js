const { getPool } = require('../db/pool');

function toConfig(row) {
  return {
    id: row.id,
    enabled: row.enabled,
    startTime: row.start_time.slice(0, 5),
    endTime: row.end_time.slice(0, 5),
    message: row.message,
  };
}

async function getBusinessHoursConfig() {
  const result = await getPool().query('SELECT * FROM business_hours_config ORDER BY created_at ASC LIMIT 1');
  if (result.rowCount === 0) {
    return { id: null, enabled: false, startTime: '08:00', endTime: '18:00', message: '' };
  }
  return toConfig(result.rows[0]);
}

async function upsertBusinessHoursConfig({ enabled, startTime, endTime, message }) {
  const existing = await getPool().query('SELECT id FROM business_hours_config ORDER BY created_at ASC LIMIT 1');
  if (existing.rowCount === 0) {
    const inserted = await getPool().query(
      `INSERT INTO business_hours_config (enabled, start_time, end_time, message)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [enabled, startTime, endTime, message]
    );
    return toConfig(inserted.rows[0]);
  }
  const updated = await getPool().query(
    `UPDATE business_hours_config SET enabled = $2, start_time = $3, end_time = $4, message = $5, updated_at = now()
     WHERE id = $1 RETURNING *`,
    [existing.rows[0].id, enabled, startTime, endTime, message]
  );
  return toConfig(updated.rows[0]);
}

module.exports = { getBusinessHoursConfig, upsertBusinessHoursConfig };
