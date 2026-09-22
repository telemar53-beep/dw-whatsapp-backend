const { getPool, closePool } = require('../db/pool');

describe('esquema de cities depois da evolucao para lugares', () => {
  beforeEach(async () => {
    await getPool().query('TRUNCATE cities, contacts CASCADE');
  });

  afterAll(async () => {
    await closePool();
  });

  test('linha legada nasce unclassified, ativa e nao atendida', async () => {
    const { rows } = await getPool().query(
      "INSERT INTO cities (name) VALUES ('Legado') RETURNING kind, parent_id, sgp_pop, sgp_pop_key, active, served, note"
    );
    expect(rows[0].kind).toBe('unclassified');
    expect(rows[0].parent_id).toBeNull();
    expect(rows[0].sgp_pop).toBeNull();
    expect(rows[0].sgp_pop_key).toBeNull();
    expect(rows[0].active).toBe(true);
    expect(rows[0].served).toBe(false);
    expect(rows[0].note).toBe('');
  });

  test('locality exige parent_id', async () => {
    await expect(
      getPool().query("INSERT INTO cities (name, kind) VALUES ('Sem pai', 'locality')")
    ).rejects.toThrow(/cities_hierarquia/);
  });

  test('city nao pode ter parent_id', async () => {
    const { rows } = await getPool().query("INSERT INTO cities (name, kind) VALUES ('Municipio', 'city') RETURNING id");
    await expect(
      getPool().query("INSERT INTO cities (name, kind, parent_id) VALUES ('Errado', 'city', $1)", [rows[0].id])
    ).rejects.toThrow(/cities_hierarquia/);
  });

  test('unclassified tambem nao pode ter parent_id', async () => {
    const { rows } = await getPool().query("INSERT INTO cities (name, kind) VALUES ('Municipio', 'city') RETURNING id");
    await expect(
      getPool().query("INSERT INTO cities (name, parent_id) VALUES ('Errado', $1)", [rows[0].id])
    ).rejects.toThrow(/cities_hierarquia/);
  });

  test('kind fora da lista e recusado', async () => {
    await expect(
      getPool().query("INSERT INTO cities (name, kind) VALUES ('Errado', 'village')")
    ).rejects.toThrow(/cities_kind_valido/);
  });

  test('duas linhas nao podem ter a mesma sgp_pop_key', async () => {
    const { rows } = await getPool().query("INSERT INTO cities (name, kind) VALUES ('Municipio', 'city') RETURNING id");
    await getPool().query(
      "INSERT INTO cities (name, kind, parent_id, sgp_pop, sgp_pop_key) VALUES ('A', 'locality', $1, 'Barão', 'barao')",
      [rows[0].id]
    );
    await expect(
      getPool().query(
        "INSERT INTO cities (name, kind, parent_id, sgp_pop, sgp_pop_key) VALUES ('B', 'locality', $1, 'BARAO', 'barao')",
        [rows[0].id]
      )
    ).rejects.toThrow(/cities_sgp_pop_key_unico/);
  });

  test('varias linhas podem ficar sem POP ao mesmo tempo', async () => {
    await getPool().query("INSERT INTO cities (name, kind) VALUES ('Um', 'city'), ('Dois', 'city')");
    const { rows } = await getPool().query('SELECT count(*)::int AS total FROM cities WHERE sgp_pop_key IS NULL');
    expect(rows[0].total).toBe(2);
  });

  test('sgp_pop e sgp_pop_key andam juntas', async () => {
    await expect(
      getPool().query("INSERT INTO cities (name, kind, sgp_pop) VALUES ('Sem chave', 'city', 'Barão')")
    ).rejects.toThrow(/cities_pop_par/);
  });

  test('existe indice em contacts.city_id, que a FK nao cria sozinha', async () => {
    const { rows } = await getPool().query(
      "SELECT indexname FROM pg_indexes WHERE tablename = 'contacts' AND indexname = 'contacts_city_id_idx'"
    );
    expect(rows).toHaveLength(1);
  });
});
