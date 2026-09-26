const { getPool } = require('../db/pool');

function toCityNotice(row) {
  return {
    id: row.id,
    cityId: row.city_id,
    message: row.message,
    enabled: row.enabled,
    activatedAt: row.activated_at,
  };
}

async function listCityNoticesByCityIds(cityIds) {
  if (cityIds.length === 0) return [];
  const result = await getPool().query(
    'SELECT id, city_id, message, enabled, activated_at FROM city_notices WHERE city_id = ANY($1)',
    [cityIds]
  );
  return result.rows.map(toCityNotice);
}

async function findActiveCityNoticeByCityId(cityId) {
  if (!cityId) return null;
  const result = await getPool().query(
    'SELECT id, city_id, message, enabled, activated_at FROM city_notices WHERE city_id = $1 AND enabled = true',
    [cityId]
  );
  if (result.rowCount === 0) return null;
  return toCityNotice(result.rows[0]);
}

async function upsertCityNotice(cityId, { message, enabled }) {
  const existing = await getPool().query('SELECT enabled FROM city_notices WHERE city_id = $1', [cityId]);
  const wasEnabled = existing.rowCount > 0 && existing.rows[0].enabled;
  const isReactivation = enabled && !wasEnabled;

  const result = await getPool().query(
    `INSERT INTO city_notices (city_id, message, enabled, activated_at)
     VALUES ($1, $2, $3, NULL)
     ON CONFLICT (city_id) DO UPDATE SET
       message = EXCLUDED.message,
       enabled = EXCLUDED.enabled,
       activated_at = CASE WHEN EXCLUDED.enabled THEN city_notices.activated_at ELSE NULL END,
       updated_at = now()
     RETURNING id, city_id, message, enabled, activated_at`,
    [cityId, message, enabled]
  );
  const notice = toCityNotice(result.rows[0]);

  if (isReactivation) {
    // A reactivation (false -> true) is a fresh occurrence of the problem: forget who
    // already got the previous round, so every contact in the city is notified again.
    await getPool().query('UPDATE city_notices SET activated_at = now() WHERE id = $1', [notice.id]);
    await getPool().query('DELETE FROM city_notice_deliveries WHERE city_notice_id = $1', [notice.id]);
    notice.activatedAt = new Date();
  }
  return notice;
}

async function deleteCityNotice(cityId) {
  const result = await getPool().query('DELETE FROM city_notices WHERE city_id = $1', [cityId]);
  return result.rowCount > 0;
}

async function hasContactReceivedNotice(cityNoticeId, contactId) {
  const result = await getPool().query(
    'SELECT 1 FROM city_notice_deliveries WHERE city_notice_id = $1 AND contact_id = $2',
    [cityNoticeId, contactId]
  );
  return result.rowCount > 0;
}

/**
 * Quando o aviso saiu para este contato (ou null se não saiu). Só leitura: o worker usa para
 * saber se o aviso foi mandado NESTE turno (na entrada da mesma mensagem) e não repeti-lo.
 */
async function findNoticeDeliverySentAt(cityNoticeId, contactId) {
  const result = await getPool().query(
    'SELECT sent_at FROM city_notice_deliveries WHERE city_notice_id = $1 AND contact_id = $2',
    [cityNoticeId, contactId]
  );
  return result.rowCount > 0 ? result.rows[0].sent_at : null;
}

async function recordNoticeDelivery(cityNoticeId, contactId) {
  const result = await getPool().query(
    `INSERT INTO city_notice_deliveries (city_notice_id, contact_id)
     VALUES ($1, $2)
     ON CONFLICT (city_notice_id, contact_id) DO NOTHING
     RETURNING id`,
    [cityNoticeId, contactId]
  );
  return result.rowCount > 0;
}

module.exports = {
  listCityNoticesByCityIds,
  findActiveCityNoticeByCityId,
  upsertCityNotice,
  deleteCityNotice,
  hasContactReceivedNotice,
  recordNoticeDelivery,
  findNoticeDeliverySentAt,
};
