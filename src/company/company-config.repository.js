const { getPool } = require('../db/pool');

// Configuração da empresa: singleton, no mesmo padrão de business_hours_config
// (uma linha só, criada no primeiro salvamento). O nome e os nomes aceitos
// como favorecido no comprovante são configuração, nunca constante no código.
const COLUMNS = 'id, name, accepted_payee_names, logo_url, symbol_url, brand_color';

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
    logoUrl: row.logo_url || '',
    symbolUrl: row.symbol_url || '',
    brandColor: row.brand_color || '',
  };
}

async function getCompanyConfig() {
  const result = await getPool().query(`SELECT ${COLUMNS} FROM company_config ORDER BY created_at ASC LIMIT 1`);
  if (result.rowCount === 0) {
    return { id: null, name: '', acceptedPayeeNames: [], logoUrl: '', symbolUrl: '', brandColor: '' };
  }
  return toConfig(result.rows[0]);
}

// Os tres campos visuais sao OPCIONAIS aqui: `undefined` quer dizer "nao
// mexe", e nao "apaga". Sem isso, uma tela que salvasse so o nome e os nomes
// do comprovante zeraria a marca da instalacao -- o reset lateral que a
// ADR-011 proibe. String vazia continua sendo um valor legitimo: e assim que
// se TIRA o logo.
function manter(valor) {
  return valor === undefined;
}

async function upsertCompanyConfig({ name, acceptedPayeeNames, logoUrl, symbolUrl, brandColor }) {
  const nome = String(name == null ? '' : name).trim();
  const nomes = textoDosNomes(acceptedPayeeNames);
  const texto = (v) => String(v == null ? '' : v).trim();
  const existing = await getPool().query('SELECT id FROM company_config ORDER BY created_at ASC LIMIT 1');
  if (existing.rowCount === 0) {
    const inserted = await getPool().query(
      `INSERT INTO company_config (name, accepted_payee_names, logo_url, symbol_url, brand_color)
       VALUES ($1, $2, $3, $4, $5) RETURNING ${COLUMNS}`,
      [nome, nomes, texto(logoUrl), texto(symbolUrl), texto(brandColor)]
    );
    return toConfig(inserted.rows[0]);
  }
  const updated = await getPool().query(
    `UPDATE company_config SET
       name = $2,
       accepted_payee_names = $3,
       logo_url    = CASE WHEN $5::boolean THEN logo_url    ELSE $4 END,
       symbol_url  = CASE WHEN $7::boolean THEN symbol_url  ELSE $6 END,
       brand_color = CASE WHEN $9::boolean THEN brand_color ELSE $8 END,
       updated_at = now()
     WHERE id = $1 RETURNING ${COLUMNS}`,
    [
      existing.rows[0].id, nome, nomes,
      texto(logoUrl), manter(logoUrl),
      texto(symbolUrl), manter(symbolUrl),
      texto(brandColor), manter(brandColor),
    ]
  );
  return toConfig(updated.rows[0]);
}

module.exports = { getCompanyConfig, upsertCompanyConfig };
