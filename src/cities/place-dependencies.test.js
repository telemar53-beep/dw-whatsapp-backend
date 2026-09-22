const { getPool, closePool } = require('../db/pool');
const { findOrCreateContactByPhoneNumber } = require('../conversations/contact.repository');
const { createPlace } = require('./city.repository');
const { dependenciasDoLugar } = require('./place-dependencies');

describe('dependencias de um lugar', () => {
  beforeEach(async () => {
    await getPool().query('TRUNCATE cities, contacts CASCADE');
  });

  afterAll(async () => {
    await closePool();
  });

  test('lugar sem nada devolve tudo zerado', async () => {
    const lugar = await createPlace({ name: 'Solto', kind: 'city' });

    expect(await dependenciasDoLugar(lugar.id)).toEqual({
      contatosComoMunicipio: 0, contatosComoLocalidade: 0, filhas: 0, avisos: 0,
    });
  });

  test('conta contatos como municipio, como localidade, filhas e avisos', async () => {
    const municipio = await createPlace({ name: 'Municipio', kind: 'city' });
    const povoado = await createPlace({ name: 'Povoado', kind: 'locality', parentId: municipio.id });

    const um = await findOrCreateContactByPhoneNumber('+5511900000011', 'Um');
    const dois = await findOrCreateContactByPhoneNumber('+5511900000012', 'Dois');
    await getPool().query('UPDATE contacts SET city_id = $2 WHERE id = $1', [um.id, municipio.id]);
    await getPool().query('UPDATE contacts SET city_id = $2, locality_id = $3 WHERE id = $1', [
      dois.id, municipio.id, povoado.id,
    ]);
    await getPool().query("INSERT INTO city_notices (city_id, message, enabled) VALUES ($1, 'aviso', true)", [povoado.id]);

    expect(await dependenciasDoLugar(municipio.id)).toEqual({
      contatosComoMunicipio: 2, contatosComoLocalidade: 0, filhas: 1, avisos: 0,
    });
    expect(await dependenciasDoLugar(povoado.id)).toEqual({
      contatosComoMunicipio: 0, contatosComoLocalidade: 1, filhas: 0, avisos: 1,
    });
  });

  test('id inexistente devolve tudo zerado, sem quebrar', async () => {
    expect(await dependenciasDoLugar('00000000-0000-0000-0000-000000000000')).toEqual({
      contatosComoMunicipio: 0, contatosComoLocalidade: 0, filhas: 0, avisos: 0,
    });
  });
});
