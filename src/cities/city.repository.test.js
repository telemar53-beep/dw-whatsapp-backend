const { getPool, closePool } = require('../db/pool');
const { findOrCreateContactByPhoneNumber } = require('../conversations/contact.repository');
const { listCities, listPlaces, listPlaceNamesForVocabulary, createCity, createPlace, updatePlace, deleteCity, findCityById } = require('./city.repository');

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

  test('findCityById returns the city, or null when it does not exist', async () => {
    const city = await createCity({ name: 'Bahia' });

    expect(await findCityById(city.id)).toEqual(city);
    expect(await findCityById('00000000-0000-0000-0000-000000000000')).toBeNull();
  });
});

describe('city repository — lugares', () => {
  beforeEach(async () => {
    await getPool().query('TRUNCATE cities, contacts CASCADE');
  });

  afterAll(async () => {
    await closePool();
  });

  test('listCities nao devolve localidades, mas devolve as legadas', async () => {
    const pai = await getPool().query("INSERT INTO cities (name, kind) VALUES ('Municipio', 'city') RETURNING id");
    await getPool().query("INSERT INTO cities (name, kind, parent_id) VALUES ('Povoado', 'locality', $1)", [pai.rows[0].id]);
    await getPool().query("INSERT INTO cities (name) VALUES ('Legado')");

    const cidades = await listCities();

    expect(cidades.map((c) => c.name)).toEqual(['Legado', 'Municipio']);
  });

  test('listPlaces devolve tudo, com a localidade depois do pai', async () => {
    const pai = await getPool().query("INSERT INTO cities (name, kind) VALUES ('Municipio', 'city') RETURNING id");
    await getPool().query("INSERT INTO cities (name, kind, parent_id) VALUES ('Povoado', 'locality', $1)", [pai.rows[0].id]);

    const lugares = await listPlaces();

    expect(lugares.map((l) => l.name)).toEqual(['Municipio', 'Povoado']);
    expect(lugares[1].parentId).toBe(pai.rows[0].id);
    expect(lugares[1].kind).toBe('locality');
  });

  test('o DTO nao expoe sgp_pop_key', async () => {
    await getPool().query("INSERT INTO cities (name, kind, sgp_pop, sgp_pop_key) VALUES ('Com pop', 'city', 'Barão', 'barao')");

    const [lugar] = await listCities();

    expect(lugar.sgpPop).toBe('Barão');
    expect(lugar).not.toHaveProperty('sgpPopKey');
    expect(lugar).not.toHaveProperty('sgp_pop_key');
  });

  test('o DTO traz os campos novos do lugar', async () => {
    await getPool().query("INSERT INTO cities (name, kind, served, note) VALUES ('Atendida', 'city', true, 'obs')");

    const [lugar] = await listCities();

    expect(lugar.kind).toBe('city');
    expect(lugar.parentId).toBeNull();
    expect(lugar.active).toBe(true);
    expect(lugar.served).toBe(true);
    expect(lugar.note).toBe('obs');
  });

  test('findCityById encontra tambem uma localidade', async () => {
    const pai = await getPool().query("INSERT INTO cities (name, kind) VALUES ('Municipio', 'city') RETURNING id");
    const filha = await getPool().query(
      "INSERT INTO cities (name, kind, parent_id) VALUES ('Povoado', 'locality', $1) RETURNING id",
      [pai.rows[0].id]
    );

    const achada = await findCityById(filha.rows[0].id);

    expect(achada.kind).toBe('locality');
    expect(achada.parentId).toBe(pai.rows[0].id);
  });
});

describe('city repository — escrita de lugares', () => {
  beforeEach(async () => {
    await getPool().query('TRUNCATE cities, contacts CASCADE');
  });

  afterAll(async () => {
    await closePool();
  });

  test('createPlace deriva sgp_pop_key com a normalizacao do matcher', async () => {
    const lugar = await createPlace({ name: 'Municipio', kind: 'city', sgpPop: '  BARÃO  Centro ' });

    expect(lugar.sgpPop).toBe('BARÃO  Centro');
    const { rows } = await getPool().query('SELECT sgp_pop_key FROM cities WHERE id = $1', [lugar.id]);
    expect(rows[0].sgp_pop_key).toBe('barao centro');
  });

  test('sem POP, as duas colunas ficam nulas', async () => {
    const lugar = await createPlace({ name: 'Sem pop', kind: 'city', sgpPop: '   ' });

    expect(lugar.sgpPop).toBeNull();
    const { rows } = await getPool().query('SELECT sgp_pop_key FROM cities WHERE id = $1', [lugar.id]);
    expect(rows[0].sgp_pop_key).toBeNull();
  });

  test('createCity continua criando municipio', async () => {
    const cidade = await createCity({ name: 'Classica' });

    expect(cidade.kind).toBe('city');
    expect(cidade.parentId).toBeNull();
  });

  test('createPlace cria localidade com pai', async () => {
    const pai = await createPlace({ name: 'Municipio', kind: 'city' });

    const filha = await createPlace({ name: 'Povoado', kind: 'locality', parentId: pai.id, served: true });

    expect(filha.kind).toBe('locality');
    expect(filha.parentId).toBe(pai.id);
    expect(filha.served).toBe(true);
  });

  test('updatePlace nao mexe em chave ausente', async () => {
    const lugar = await createPlace({ name: 'Original', kind: 'city', note: 'anotacao', served: true });

    const atualizado = await updatePlace(lugar.id, { name: 'Renomeado' });

    expect(atualizado.name).toBe('Renomeado');
    expect(atualizado.note).toBe('anotacao');
    expect(atualizado.served).toBe(true);
  });

  test('updatePlace aceita valor falso de proposito', async () => {
    const lugar = await createPlace({ name: 'Ativo', kind: 'city', active: true, served: true, note: 'sai' });

    const atualizado = await updatePlace(lugar.id, { active: false, served: false, note: '' });

    expect(atualizado.active).toBe(false);
    expect(atualizado.served).toBe(false);
    expect(atualizado.note).toBe('');
  });

  test('updatePlace limpando o POP zera tambem a chave', async () => {
    const lugar = await createPlace({ name: 'Com pop', kind: 'city', sgpPop: 'Barão' });

    const atualizado = await updatePlace(lugar.id, { sgpPop: null });

    expect(atualizado.sgpPop).toBeNull();
    const { rows } = await getPool().query('SELECT sgp_pop_key FROM cities WHERE id = $1', [lugar.id]);
    expect(rows[0].sgp_pop_key).toBeNull();
  });

  test('updatePlace sem nenhum campo devolve o lugar intacto', async () => {
    const lugar = await createPlace({ name: 'Intacto', kind: 'city' });

    expect((await updatePlace(lugar.id, {})).name).toBe('Intacto');
  });

  test('updatePlace devolve null quando o id nao existe', async () => {
    expect(await updatePlace('00000000-0000-0000-0000-000000000000', { name: 'x' })).toBeNull();
    expect(await updatePlace('00000000-0000-0000-0000-000000000000', {})).toBeNull();
  });

  test('a chave de POP nunca vem de fora: sgpPopKey no patch e ignorada', async () => {
    const lugar = await createPlace({ name: 'Com pop', kind: 'city', sgpPop: 'Barão' });

    await updatePlace(lugar.id, { sgpPopKey: 'forjada' });

    const { rows } = await getPool().query('SELECT sgp_pop_key FROM cities WHERE id = $1', [lugar.id]);
    expect(rows[0].sgp_pop_key).toBe('barao');
  });
});

describe('city repository — nomes para o vocabulario', () => {
  beforeEach(async () => {
    await getPool().query('TRUNCATE cities, contacts CASCADE');
  });

  afterAll(async () => {
    await closePool();
  });

  test('inclui municipio, localidade e registro legado', async () => {
    const pai = await createPlace({ name: 'Candido Mendes', kind: 'city' });
    await createPlace({ name: 'Barao de Tromai', kind: 'locality', parentId: pai.id });
    await getPool().query("INSERT INTO cities (name) VALUES ('Aurizona')");

    const nomes = await listPlaceNamesForVocabulary();

    expect(nomes).toEqual(['Aurizona', 'Barao de Tromai', 'Candido Mendes']);
  });

  // O ponto da tarefa: converter um legado em localidade nao pode tirar o nome
  // dele do vocabulario que ja existia.
  test('converter um legado em localidade NAO tira o nome do vocabulario', async () => {
    const pai = await createPlace({ name: 'Candido Mendes', kind: 'city' });
    const legado = await getPool().query("INSERT INTO cities (name) VALUES ('Barao de Tromai') RETURNING id");

    const antes = await listPlaceNamesForVocabulary();
    expect(antes).toContain('Barao de Tromai');

    await getPool().query("UPDATE cities SET kind = 'locality', parent_id = $2 WHERE id = $1", [legado.rows[0].id, pai.id]);

    const depois = await listPlaceNamesForVocabulary();
    expect(depois).toContain('Barao de Tromai');
    expect(depois).toEqual(antes);
  });

  test('listCities continua sem devolver localidade: o padrao nao muda', async () => {
    const pai = await createPlace({ name: 'Candido Mendes', kind: 'city' });
    await createPlace({ name: 'Barao de Tromai', kind: 'locality', parentId: pai.id });

    expect((await listCities()).map((c) => c.name)).toEqual(['Candido Mendes']);
    expect(await listPlaceNamesForVocabulary()).toEqual(['Barao de Tromai', 'Candido Mendes']);
  });
});
