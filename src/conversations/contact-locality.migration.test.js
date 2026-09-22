const { getPool, closePool } = require('../db/pool');
const { findOrCreateContactByPhoneNumber } = require('./contact.repository');

async function criarMunicipioELocalidade() {
  const municipio = await getPool().query(
    "INSERT INTO cities (name, kind) VALUES ('Cidade Pai', 'city') RETURNING id"
  );
  const localidade = await getPool().query(
    "INSERT INTO cities (name, kind, parent_id) VALUES ('Povoado', 'locality', $1) RETURNING id",
    [municipio.rows[0].id]
  );
  return { municipioId: municipio.rows[0].id, localidadeId: localidade.rows[0].id };
}

describe('invariante municipio x localidade no contato', () => {
  beforeEach(async () => {
    await getPool().query('TRUNCATE cities, contacts CASCADE');
  });

  afterAll(async () => {
    await closePool();
  });

  test('aceita a localidade cujo pai e o municipio do contato', async () => {
    const { municipioId, localidadeId } = await criarMunicipioELocalidade();
    const contato = await findOrCreateContactByPhoneNumber('+5511900000001', 'Ana');

    await getPool().query('UPDATE contacts SET city_id = $2, locality_id = $3 WHERE id = $1', [
      contato.id, municipioId, localidadeId,
    ]);

    const { rows } = await getPool().query('SELECT locality_id FROM contacts WHERE id = $1', [contato.id]);
    expect(rows[0].locality_id).toBe(localidadeId);
  });

  test('recusa localidade de outro municipio', async () => {
    const { localidadeId } = await criarMunicipioELocalidade();
    const outro = await getPool().query("INSERT INTO cities (name, kind) VALUES ('Outro', 'city') RETURNING id");
    const contato = await findOrCreateContactByPhoneNumber('+5511900000002', 'Bia');

    await expect(
      getPool().query('UPDATE contacts SET city_id = $2, locality_id = $3 WHERE id = $1', [
        contato.id, outro.rows[0].id, localidadeId,
      ])
    ).rejects.toThrow(/contacts_localidade_do_municipio/);
  });

  test('recusa localidade sem municipio', async () => {
    const { localidadeId } = await criarMunicipioELocalidade();
    const contato = await findOrCreateContactByPhoneNumber('+5511900000003', 'Cid');

    await expect(
      getPool().query('UPDATE contacts SET locality_id = $2 WHERE id = $1', [contato.id, localidadeId])
    ).rejects.toThrow(/contacts_localidade_exige_municipio/);
  });

  test('contato so com municipio continua valido', async () => {
    const { municipioId } = await criarMunicipioELocalidade();
    const contato = await findOrCreateContactByPhoneNumber('+5511900000005', 'Edu');

    await getPool().query('UPDATE contacts SET city_id = $2 WHERE id = $1', [contato.id, municipioId]);

    const { rows } = await getPool().query('SELECT city_id, locality_id FROM contacts WHERE id = $1', [contato.id]);
    expect(rows[0].city_id).toBe(municipioId);
    expect(rows[0].locality_id).toBeNull();
  });

  test('apagar a localidade limpa so locality_id, preservando o municipio', async () => {
    const { municipioId, localidadeId } = await criarMunicipioELocalidade();
    const contato = await findOrCreateContactByPhoneNumber('+5511900000004', 'Dora');
    await getPool().query('UPDATE contacts SET city_id = $2, locality_id = $3 WHERE id = $1', [
      contato.id, municipioId, localidadeId,
    ]);

    await getPool().query('DELETE FROM cities WHERE id = $1', [localidadeId]);

    const { rows } = await getPool().query('SELECT city_id, locality_id FROM contacts WHERE id = $1', [contato.id]);
    expect(rows[0].locality_id).toBeNull();
    expect(rows[0].city_id).toBe(municipioId);
  });

  test('apagar o municipio limpa os dois, e nao derruba o contato', async () => {
    const { municipioId, localidadeId } = await criarMunicipioELocalidade();
    const contato = await findOrCreateContactByPhoneNumber('+5511900000006', 'Fabi');
    await getPool().query('UPDATE contacts SET city_id = $2, locality_id = $3 WHERE id = $1', [
      contato.id, municipioId, localidadeId,
    ]);

    // A localidade sai junto por ON DELETE do proprio parent_id? Nao: parent_id
    // nao tem ON DELETE, entao o municipio com filha nao pode ser apagado. E o
    // comportamento correto, e a rota devolve 409 em vez de 500.
    await expect(
      getPool().query('DELETE FROM cities WHERE id = $1', [municipioId])
    ).rejects.toThrow();

    const { rows } = await getPool().query('SELECT city_id FROM contacts WHERE id = $1', [contato.id]);
    expect(rows[0].city_id).toBe(municipioId);
  });
});
