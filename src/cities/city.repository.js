const { getPool } = require('../db/pool');
const { normalizar } = require('./city-matcher');

// Colunas enumeradas de proposito: o projeto nao usa SELECT *, entao coluna
// nova nao chega sozinha a aplicacao.
// sgp_pop_key fica FORA do DTO: e chave interna de casamento, nao dado de tela.
const COLUNAS = 'id, name, kind, parent_id, sgp_pop, active, served, note, created_at';

// O conjunto que os consumidores antigos sempre enxergaram. 'unclassified'
// entra aqui de proposito: os povoados legados de producao precisam continuar
// aparecendo onde aparecem hoje, inclusive no seletor de cidade do contato, que
// e como os contatos deles foram cadastrados. Depois da conversao eles saem
// daqui sozinhos, virando 'locality'.
const KINDS_LEGADO = ['city', 'unclassified'];

function toCity(row) {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    parentId: row.parent_id,
    sgpPop: row.sgp_pop,
    active: row.active,
    served: row.served,
    note: row.note,
    createdAt: row.created_at,
  };
}

async function listCities() {
  const result = await getPool().query(
    `SELECT ${COLUNAS} FROM cities WHERE kind = ANY($1) ORDER BY name ASC`,
    [KINDS_LEGADO]
  );
  return result.rows.map(toCity);
}

// Hierarquia completa: o municipio vem antes das localidades dele.
async function listPlaces() {
  const result = await getPool().query(`
    SELECT ${COLUNAS} FROM cities
    ORDER BY COALESCE((SELECT p.name FROM cities p WHERE p.id = cities.parent_id), cities.name) ASC,
             CASE WHEN parent_id IS NULL THEN 0 ELSE 1 END,
             name ASC
  `);
  return result.rows.map(toCity);
}

// A chave de POP usa exatamente a mesma normalizacao do matcher. E o que
// garante que gravar " BARAO " e consultar "barao" encontrem a mesma linha.
// NUNCA aceitar sgp_pop_key vinda de fora: ela e derivada, com caminho de
// escrita unico, e o banco nao tem como garantir a derivacao.
function chaveDoPop(sgpPop) {
  const bruto = typeof sgpPop === 'string' ? sgpPop.trim() : null;
  if (!bruto) return { valor: null, chave: null };
  const chave = normalizar(bruto);
  if (!chave) return { valor: null, chave: null };
  return { valor: bruto, chave };
}

async function createPlace({
  name, kind = 'city', parentId = null, sgpPop = null, active = true, served = false, note = '',
}) {
  const pop = chaveDoPop(sgpPop);
  const result = await getPool().query(
    `INSERT INTO cities (name, kind, parent_id, sgp_pop, sgp_pop_key, active, served, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${COLUNAS}`,
    [name, kind, parentId, pop.valor, pop.chave, active, served, note]
  );
  return toCity(result.rows[0]);
}

async function createCity({ name }) {
  return createPlace({ name, kind: 'city' });
}

// Escrita parcial no padrao do ADR-011: o que decide "nao mexe" e a chave NAO
// ESTAR no objeto, nunca o valor ser falso, zero ou vazio — esses sao valores
// legitimos. `served: false` e `note: ''` precisam ser gravaveis.
const CAMPOS = {
  name: 'name',
  kind: 'kind',
  parentId: 'parent_id',
  active: 'active',
  served: 'served',
  note: 'note',
};

async function updatePlace(id, patch = {}) {
  const partes = [];
  const valores = [id];

  for (const [chave, coluna] of Object.entries(CAMPOS)) {
    if (!(chave in patch)) continue;
    valores.push(patch[chave]);
    partes.push(`${coluna} = $${valores.length}`);
  }

  // sgpPopKey nao esta em CAMPOS: a chave e derivada aqui a partir de sgpPop, e
  // mandar sgpPopKey no patch nao tem efeito nenhum.
  if ('sgpPop' in patch) {
    const pop = chaveDoPop(patch.sgpPop);
    valores.push(pop.valor);
    partes.push(`sgp_pop = $${valores.length}`);
    valores.push(pop.chave);
    partes.push(`sgp_pop_key = $${valores.length}`);
  }

  if (partes.length === 0) return findCityById(id);

  const result = await getPool().query(
    `UPDATE cities SET ${partes.join(', ')} WHERE id = $1 RETURNING ${COLUNAS}`,
    valores
  );
  if (result.rowCount === 0) return null;
  return toCity(result.rows[0]);
}

async function deleteCity(id) {
  const result = await getPool().query('DELETE FROM cities WHERE id = $1', [id]);
  return result.rowCount > 0;
}

/**
 * Só os nomes, de TODOS os registros: município, localidade e legado ainda não
 * classificado. Consulta explícita, separada de listCities(), justamente para
 * não mexer no significado do padrão — que continua sendo "município".
 *
 * Existe para o vocabulário da transcrição: converter um povoado legado em
 * localidade não pode tirar o nome dele de um vocabulário onde já estava.
 */
async function listPlaceNamesForVocabulary() {
  const result = await getPool().query('SELECT name FROM cities ORDER BY name ASC');
  return result.rows.map((row) => row.name).filter(Boolean);
}

async function findCityById(id) {
  const result = await getPool().query(`SELECT ${COLUNAS} FROM cities WHERE id = $1`, [id]);
  if (result.rowCount === 0) return null;
  return toCity(result.rows[0]);
}

module.exports = {
  listCities, listPlaces, listPlaceNamesForVocabulary,
  createCity, createPlace, updatePlace, deleteCity, findCityById,
};
