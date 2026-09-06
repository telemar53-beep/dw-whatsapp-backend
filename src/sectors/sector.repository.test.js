const { getPool, closePool } = require('../db/pool');
const { createAgent } = require('../agents/agent.repository');
const {
  listSectors,
  createSector,
  updateSector,
  deleteSector,
  setAgentSectors,
} = require('./sector.repository');

describe('sector repository', () => {
  beforeEach(async () => {
    await getPool().query('TRUNCATE sectors, agent_sectors, agents CASCADE');
  });

  afterAll(async () => {
    await closePool();
  });

  test('createSector stores and returns a sector', async () => {
    const sector = await createSector({ name: 'Financeiro' });
    expect(sector.id).toBeDefined();
    expect(sector.name).toBe('Financeiro');
    expect(sector.createdAt).toBeDefined();
  });

  test('listSectors returns an empty array when there are none', async () => {
    const sectors = await listSectors();
    expect(sectors).toEqual([]);
  });

  test('listSectors returns all sectors ordered by name', async () => {
    await createSector({ name: 'Zebra' });
    await createSector({ name: 'Abelha' });

    const sectors = await listSectors();

    expect(sectors.map((s) => s.name)).toEqual(['Abelha', 'Zebra']);
  });

  test('updateSector updates and returns the sector with the new name', async () => {
    const sector = await createSector({ name: 'Original' });

    const updated = await updateSector(sector.id, { name: 'Editado' });

    expect(updated.id).toBe(sector.id);
    expect(updated.name).toBe('Editado');
  });

  test('updateSector returns null when the id does not exist', async () => {
    const updated = await updateSector('00000000-0000-0000-0000-000000000000', { name: 'X' });
    expect(updated).toBeNull();
  });

  test('deleteSector removes the row and returns true', async () => {
    const sector = await createSector({ name: 'Para excluir' });

    const deleted = await deleteSector(sector.id);

    expect(deleted).toBe(true);
    expect(await listSectors()).toEqual([]);
  });

  test('deleteSector returns false when the id does not exist', async () => {
    const deleted = await deleteSector('00000000-0000-0000-0000-000000000000');
    expect(deleted).toBe(false);
  });

  test('setAgentSectors assigns the given sectors to an agent', async () => {
    const agent = await createAgent({ email: 'sector-agent1@dw.com', password: 'secret123', role: 'agent' });
    const sectorA = await createSector({ name: 'Financeiro' });
    const sectorB = await createSector({ name: 'Comercial' });

    await setAgentSectors(agent.id, [sectorA.id, sectorB.id]);

    const result = await getPool().query(
      'SELECT sector_id FROM agent_sectors WHERE agent_id = $1 ORDER BY sector_id',
      [agent.id]
    );
    expect(result.rows.map((r) => r.sector_id).sort()).toEqual([sectorA.id, sectorB.id].sort());
  });

  test('setAgentSectors replaces the previous set of sectors entirely', async () => {
    const agent = await createAgent({ email: 'sector-agent2@dw.com', password: 'secret123', role: 'agent' });
    const sectorA = await createSector({ name: 'Financeiro' });
    const sectorB = await createSector({ name: 'Comercial' });
    await setAgentSectors(agent.id, [sectorA.id]);

    await setAgentSectors(agent.id, [sectorB.id]);

    const result = await getPool().query('SELECT sector_id FROM agent_sectors WHERE agent_id = $1', [agent.id]);
    expect(result.rows.map((r) => r.sector_id)).toEqual([sectorB.id]);
  });

  test('setAgentSectors with an empty array clears all sectors for the agent', async () => {
    const agent = await createAgent({ email: 'sector-agent3@dw.com', password: 'secret123', role: 'agent' });
    const sectorA = await createSector({ name: 'Financeiro' });
    await setAgentSectors(agent.id, [sectorA.id]);

    await setAgentSectors(agent.id, []);

    const result = await getPool().query('SELECT sector_id FROM agent_sectors WHERE agent_id = $1', [agent.id]);
    expect(result.rows).toEqual([]);
  });

  test('deleting a sector removes its memberships from agent_sectors', async () => {
    const agent = await createAgent({ email: 'sector-cascade1@dw.com', password: 'secret123', role: 'agent' });
    const sector = await createSector({ name: 'Financeiro' });
    await setAgentSectors(agent.id, [sector.id]);

    await deleteSector(sector.id);

    const result = await getPool().query('SELECT * FROM agent_sectors WHERE agent_id = $1', [agent.id]);
    expect(result.rows).toEqual([]);
  });

  test('deleting an agent removes their memberships from agent_sectors', async () => {
    const agent = await createAgent({ email: 'sector-cascade2@dw.com', password: 'secret123', role: 'agent' });
    const sector = await createSector({ name: 'Comercial' });
    await setAgentSectors(agent.id, [sector.id]);

    await getPool().query('DELETE FROM agents WHERE id = $1', [agent.id]);

    const result = await getPool().query('SELECT * FROM agent_sectors WHERE sector_id = $1', [sector.id]);
    expect(result.rows).toEqual([]);
  });
});
