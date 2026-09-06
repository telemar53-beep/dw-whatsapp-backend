const { getPool, withTransaction } = require('../db/pool');

function toSector(row) {
  return { id: row.id, name: row.name, createdAt: row.created_at };
}

async function listSectors() {
  const result = await getPool().query('SELECT id, name, created_at FROM sectors ORDER BY name ASC');
  return result.rows.map(toSector);
}

async function createSector({ name }) {
  const result = await getPool().query(
    'INSERT INTO sectors (name) VALUES ($1) RETURNING id, name, created_at',
    [name]
  );
  return toSector(result.rows[0]);
}

async function updateSector(id, { name }) {
  const result = await getPool().query(
    'UPDATE sectors SET name = $2 WHERE id = $1 RETURNING id, name, created_at',
    [id, name]
  );
  if (result.rowCount === 0) return null;
  return toSector(result.rows[0]);
}

async function deleteSector(id) {
  const result = await getPool().query('DELETE FROM sectors WHERE id = $1', [id]);
  return result.rowCount > 0;
}

async function setAgentSectors(agentId, sectorIds) {
  await withTransaction(async (client) => {
    await client.query('DELETE FROM agent_sectors WHERE agent_id = $1', [agentId]);
    for (const sectorId of sectorIds) {
      await client.query('INSERT INTO agent_sectors (agent_id, sector_id) VALUES ($1, $2)', [agentId, sectorId]);
    }
  });
}

module.exports = { listSectors, createSector, updateSector, deleteSector, setAgentSectors };
