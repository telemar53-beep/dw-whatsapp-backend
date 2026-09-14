const { getPool } = require('../db/pool');

// Configuração da empresa: singleton, no mesmo padrão de business_hours_config
// (uma linha só, criada no primeiro salvamento). O nome e os nomes aceitos
// como favorecido no comprovante são configuração, nunca constante no código.
const COLUMNS = 'id, name, accepted_payee_names';

// Os nomes vivem numa coluna TEXT separada por ';' — é uma lista curta, escrita
// à mão pelo admin, e uma tabela filha só para isso não pagaria o próprio custo.
const SEPARADOR = ';';

function nomesDoTexto(texto) {
  return String(texto || '')
    .split(SEPARADOR)
    .map((n) => n.trim())
    .filter(Boolean);
}

function textoDosNomes(nomes) {
  return (Array.isArray(nomes) ? nomes : [])
    .map((n) => String(n == null ? '' : n).trim())
    .filter(Boolean)
    .join(SEPARADOR);
}

function toConfig(row) {
  return {
    id: row.id,
    name: row.name,
    acceptedPayeeNames: nomesDoTexto(row.accepted_payee_names),
  };
}

async function getCompanyConfig() {
  const result = await getPool().query(`SELECT ${COLUMNS} FROM company_config ORDER BY created_at ASC LIMIT 1`);
  if (result.rowCount === 0) {
    return { id: null, name: '', acceptedPayeeNames: [] };
  }
  return toConfig(result.rows[0]);
}

async function upsertCompanyConfig({ name, acceptedPayeeNames }) {
  const nome = String(name == null ? '' : name).trim();
  const nomes = textoDosNomes(acceptedPayeeNames);
  const existing = await getPool().query('SELECT id FROM company_config ORDER BY created_at ASC LIMIT 1');
  if (existing.rowCount === 0) {
    const inserted = await getPool().query(
      `INSERT INTO company_config (name, accepted_payee_names) VALUES ($1, $2) RETURNING ${COLUMNS}`,
      [nome, nomes]
    );
    return toConfig(inserted.rows[0]);
  }
  const updated = await getPool().query(
    `UPDATE company_config SET name = $2, accepted_payee_names = $3, updated_at = now()
     WHERE id = $1 RETURNING ${COLUMNS}`,
    [existing.rows[0].id, nome, nomes]
  );
  return toConfig(updated.rows[0]);
}

module.exports = { getCompanyConfig, upsertCompanyConfig };
