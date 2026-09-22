const { getPool } = require('../db/pool');

// Colunas enumeradas: o projeto nao usa SELECT *, entao coluna nova nao chega
// sozinha a aplicacao.
const COLUNAS = 'id, name, speed_mbps, monthly_price, install_condition, active, sort_order, note, created_at';

const ORDEM = 'ORDER BY sort_order ASC, name ASC';

// Duas formas de resposta, e a separacao e ESTRUTURAL — nao depende de a IA
// ignorar o campo. Quem nao pode ver `note` recebe a resposta SEM A CHAVE: nao
// null, nao string vazia, para ninguem confundir "nao tenho acesso" com "nao ha
// observacao escrita". Aplicacao direta do ADR-008.
function paraAdmin(row) {
  return {
    id: row.id,
    name: row.name,
    speedMbps: row.speed_mbps,
    // NUMERIC volta como string no driver pg. Converter aqui, uma vez, para o
    // resto do sistema nunca precisar lembrar disso.
    monthlyPrice: Number(row.monthly_price),
    installCondition: row.install_condition,
    active: row.active,
    sortOrder: row.sort_order,
    note: row.note,
    createdAt: row.created_at,
  };
}

function paraOperacao(row) {
  return {
    id: row.id,
    name: row.name,
    speedMbps: row.speed_mbps,
    monthlyPrice: Number(row.monthly_price),
    installCondition: row.install_condition,
  };
}

async function listPlansForAdmin() {
  const result = await getPool().query(`SELECT ${COLUNAS} FROM plans ${ORDEM}`);
  return result.rows.map(paraAdmin);
}

// Sem argumento, de proposito. A porta para cobertura por plano e a existencia
// deste servico, nao um parametro que hoje seria ignorado: abstracao morta e
// divida, nao preparacao.
async function listarPlanosDisponiveis() {
  const result = await getPool().query(`SELECT ${COLUNAS} FROM plans WHERE active = true ${ORDEM}`);
  return result.rows.map(paraOperacao);
}

async function findPlanById(id) {
  const result = await getPool().query(`SELECT ${COLUNAS} FROM plans WHERE id = $1`, [id]);
  if (result.rowCount === 0) return null;
  return paraAdmin(result.rows[0]);
}

async function createPlan({
  name, speedMbps = null, monthlyPrice, installCondition = '', active = true, sortOrder = 0, note = '',
}) {
  const result = await getPool().query(
    `INSERT INTO plans (name, speed_mbps, monthly_price, install_condition, active, sort_order, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${COLUNAS}`,
    [name, speedMbps, monthlyPrice, installCondition, active, sortOrder, note]
  );
  return paraAdmin(result.rows[0]);
}

// Escrita parcial no padrao do ADR-011: o que decide "nao mexe" e a chave NAO
// ESTAR no objeto, nunca o valor ser falso, zero ou vazio — esses sao valores
// legitimos. `active: false`, `note: ''`, `sortOrder: 0` e `speedMbps: null`
// precisam ser gravaveis.
const CAMPOS = {
  name: 'name',
  speedMbps: 'speed_mbps',
  monthlyPrice: 'monthly_price',
  installCondition: 'install_condition',
  active: 'active',
  sortOrder: 'sort_order',
  note: 'note',
};

async function updatePlan(id, patch = {}) {
  const partes = [];
  const valores = [id];

  for (const [chave, coluna] of Object.entries(CAMPOS)) {
    if (!(chave in patch)) continue;
    valores.push(patch[chave]);
    partes.push(`${coluna} = $${valores.length}`);
  }

  // Corpo sem nenhum campo conhecido nao e erro: devolve o estado atual, e
  // continua devolvendo null quando o plano nao existe.
  if (partes.length === 0) return findPlanById(id);

  partes.push('updated_at = now()');

  const result = await getPool().query(
    `UPDATE plans SET ${partes.join(', ')} WHERE id = $1 RETURNING ${COLUNAS}`,
    valores
  );
  if (result.rowCount === 0) return null;
  return paraAdmin(result.rows[0]);
}

async function deletePlan(id) {
  const result = await getPool().query('DELETE FROM plans WHERE id = $1', [id]);
  return result.rowCount > 0;
}

module.exports = {
  listPlansForAdmin,
  listarPlanosDisponiveis,
  findPlanById,
  createPlan,
  updatePlan,
  deletePlan,
};
