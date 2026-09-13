const { getPool } = require('../db/pool');

function toConfig(row) {
  return {
    id: row.id,
    baseUrl: row.base_url,
    app: row.app,
    token: row.token,
    enabled: row.enabled,
    // Recebedor Pix da empresa: exigido pelos canais oficiais para montar o
    // cartão nativo de Pix. Vazio conta como ausente, nunca como string vazia.
    pixMerchantName: row.pix_merchant_name || null,
    pixMerchantKey: row.pix_merchant_key || null,
    pixMerchantKeyType: row.pix_merchant_key_type || null,
  };
}

async function getSgpQueryConfig() {
  const result = await getPool().query('SELECT * FROM sgp_query_config ORDER BY created_at ASC LIMIT 1');
  if (result.rowCount === 0) return null;
  return toConfig(result.rows[0]);
}

async function upsertSgpQueryConfig({ baseUrl, app, token, enabled, pixMerchantName, pixMerchantKey, pixMerchantKeyType }) {
  const existing = await getPool().query(
    'SELECT id, token, pix_merchant_name, pix_merchant_key, pix_merchant_key_type FROM sgp_query_config ORDER BY created_at ASC LIMIT 1'
  );
  if (existing.rowCount === 0) {
    const result = await getPool().query(
      `INSERT INTO sgp_query_config (base_url, app, token, enabled, pix_merchant_name, pix_merchant_key, pix_merchant_key_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [baseUrl, app, token, enabled, pixMerchantName || null, pixMerchantKey || null, pixMerchantKeyType || null]
    );
    return toConfig(result.rows[0]);
  }
  const nextToken = token || existing.rows[0].token;
  // `undefined` significa "não mexi nesse campo" e preserva o que está gravado;
  // `null` (ou vazio) é um pedido explícito de apagar o recebedor Pix. Sem essa
  // distinção, qualquer chamador antigo que não conhece esses campos apagaria o
  // cadastro do recebedor sem querer.
  const manter = (valor, atual) => (valor === undefined ? atual : valor || null);
  const result = await getPool().query(
    `UPDATE sgp_query_config SET base_url = $2, app = $3, token = $4, enabled = $5,
            pix_merchant_name = $6, pix_merchant_key = $7, pix_merchant_key_type = $8, updated_at = now()
     WHERE id = $1 RETURNING *`,
    [
      existing.rows[0].id,
      baseUrl,
      app,
      nextToken,
      enabled,
      manter(pixMerchantName, existing.rows[0].pix_merchant_name),
      manter(pixMerchantKey, existing.rows[0].pix_merchant_key),
      manter(pixMerchantKeyType, existing.rows[0].pix_merchant_key_type),
    ]
  );
  return toConfig(result.rows[0]);
}

module.exports = { getSgpQueryConfig, upsertSgpQueryConfig };
