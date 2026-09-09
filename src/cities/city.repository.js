const { getPool } = require('../db/pool');

function toCity(row) {
  return { id: row.id, name: row.name, createdAt: row.created_at };
}

async function listCities() {
  const result = await getPool().query('SELECT id, name, created_at FROM cities ORDER BY name ASC');
  return result.rows.map(toCity);
}

async function createCity({ name }) {
  const result = await getPool().query('INSERT INTO cities (name) VALUES ($1) RETURNING id, name, created_at', [name]);
  return toCity(result.rows[0]);
}

async function deleteCity(id) {
  const result = await getPool().query('DELETE FROM cities WHERE id = $1', [id]);
  return result.rowCount > 0;
}

async function findCityById(id) {
  const result = await getPool().query('SELECT id, name, created_at FROM cities WHERE id = $1', [id]);
  if (result.rowCount === 0) return null;
  return toCity(result.rows[0]);
}

module.exports = { listCities, createCity, deleteCity, findCityById };
