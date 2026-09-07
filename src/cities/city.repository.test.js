const { getPool, closePool } = require('../db/pool');
const { findOrCreateContactByPhoneNumber } = require('../conversations/contact.repository');
const { listCities, createCity, deleteCity } = require('./city.repository');

describe('city repository', () => {
  beforeEach(async () => {
    await getPool().query('TRUNCATE cities, contacts CASCADE');
  });

  afterAll(async () => {
    await closePool();
  });

  test('createCity stores and returns a city', async () => {
    const city = await createCity({ name: 'Bahia' });
    expect(city.id).toBeDefined();
    expect(city.name).toBe('Bahia');
    expect(city.createdAt).toBeDefined();
  });

  test('listCities returns an empty array when there are none', async () => {
    const cities = await listCities();
    expect(cities).toEqual([]);
  });

  test('listCities returns all cities ordered by name', async () => {
    await createCity({ name: 'Zebra' });
    await createCity({ name: 'Abelha' });

    const cities = await listCities();

    expect(cities.map((c) => c.name)).toEqual(['Abelha', 'Zebra']);
  });

  test('deleteCity removes the row and returns true', async () => {
    const city = await createCity({ name: 'Para excluir' });

    const deleted = await deleteCity(city.id);

    expect(deleted).toBe(true);
    expect(await listCities()).toEqual([]);
  });

  test('deleteCity returns false when the id does not exist', async () => {
    const deleted = await deleteCity('00000000-0000-0000-0000-000000000000');
    expect(deleted).toBe(false);
  });

  test('deleting a city that has an associated contact leaves the contact without a city instead of blocking', async () => {
    const city = await createCity({ name: 'Bahia' });
    const contact = await findOrCreateContactByPhoneNumber('+5511988887777', 'Maria');
    await getPool().query('UPDATE contacts SET city_id = $2 WHERE id = $1', [contact.id, city.id]);

    const deleted = await deleteCity(city.id);

    expect(deleted).toBe(true);
    const result = await getPool().query('SELECT city_id FROM contacts WHERE id = $1', [contact.id]);
    expect(result.rows[0].city_id).toBeNull();
  });
});
