const { getPool, closePool } = require('../db/pool');
const { findOrCreateContactByPhoneNumber } = require('../conversations/contact.repository');
const { createPlace, findCityById } = require('./city.repository');
const { converterEmLocalidade, listarLugaresParaConversao } = require('./converter-localidade');

// Reproduz o estado real de producao: o povoado e um registro LEGADO
// (unclassified) e os contatos dele apontam para ele como se fosse municipio,
// porque ate agora povoado e municipio dividiam a mesma lista.
async function cenario({ classificarPai = true } = {}) {
  const pai = await createPlace({ name: 'Candido Mendes', kind: classificarPai ? 'city' : undefined });
  if (!classificarPai) {
    await getPool().query("UPDATE cities SET kind = 'unclassified' WHERE id = $1", [pai.id]);
  }
  const legado = await getPool().query("INSERT INTO cities (name) VALUES ('Barao de Tromai') RETURNING id");
  const povoadoId = legado.rows[0].id;

  const doPovoado = [];
  for (let i = 0; i < 3; i += 1) {
    const contato = await findOrCreateContactByPhoneNumber(`+551190000${100 + i}`, `C${i}`);
    await getPool().query('UPDATE contacts SET city_id = $2 WHERE id = $1', [contato.id, povoadoId]);
    doPovoado.push(contato.id);
  }

  const soMunicipio = await findOrCreateContactByPhoneNumber('+5511900009999', 'So municipio');
  await getPool().query('UPDATE contacts SET city_id = $2 WHERE id = $1', [soMunicipio.id, pai.id]);

  return { municipioId: pai.id, povoadoId, doPovoado, soMunicipioId: soMunicipio.id };
}

describe('conversao de registro legado em localidade', () => {
  beforeEach(async () => {
    await getPool().query('TRUNCATE channels, contacts, cities CASCADE');
  });

  afterAll(async () => {
    await closePool();
  });

  test('sem confirmar nao escreve nada, so relata', async () => {
    const { municipioId, povoadoId } = await cenario();

    const relatorio = await converterEmLocalidade({ placeId: povoadoId, parentId: municipioId });

    expect(relatorio.ok).toBe(true);
    expect(relatorio.simulacao).toBe(true);
    expect(relatorio.contatosMovidos).toBe(3);
    expect(relatorio.place.name).toBe('Barao de Tromai');
    expect(relatorio.parent.name).toBe('Candido Mendes');
    expect((await findCityById(povoadoId)).kind).toBe('unclassified');
  });

  test('com confirmar converte e preserva o id e o nome', async () => {
    const { municipioId, povoadoId, doPovoado } = await cenario();

    const relatorio = await converterEmLocalidade({ placeId: povoadoId, parentId: municipioId, confirmar: true });

    expect(relatorio.ok).toBe(true);
    expect(relatorio.simulacao).toBe(false);
    expect(relatorio.contatosMovidos).toBe(3);

    const povoado = await findCityById(povoadoId);
    expect(povoado.id).toBe(povoadoId);
    expect(povoado.kind).toBe('locality');
    expect(povoado.parentId).toBe(municipioId);
    expect(povoado.name).toBe('Barao de Tromai');

    const { rows } = await getPool().query(
      'SELECT city_id, locality_id FROM contacts WHERE id = ANY($1)',
      [doPovoado]
    );
    expect(rows).toHaveLength(3);
    for (const linha of rows) {
      expect(linha.city_id).toBe(municipioId);
      expect(linha.locality_id).toBe(povoadoId);
    }
  });

  test('o municipio nao e tocado: nome e tipo ficam como estavam', async () => {
    const { municipioId, povoadoId } = await cenario();

    await converterEmLocalidade({ placeId: povoadoId, parentId: municipioId, confirmar: true });

    const pai = await findCityById(municipioId);
    expect(pai.name).toBe('Candido Mendes');
    expect(pai.kind).toBe('city');
    expect(pai.parentId).toBeNull();
  });

  test('contato ligado so ao municipio nao e tocado', async () => {
    const { municipioId, povoadoId, soMunicipioId } = await cenario();

    await converterEmLocalidade({ placeId: povoadoId, parentId: municipioId, confirmar: true });

    const { rows } = await getPool().query('SELECT city_id, locality_id FROM contacts WHERE id = $1', [soMunicipioId]);
    expect(rows[0].city_id).toBe(municipioId);
    expect(rows[0].locality_id).toBeNull();
  });

  test('o aviso do povoado continua apontando para o mesmo registro', async () => {
    const { municipioId, povoadoId } = await cenario();
    await getPool().query(
      "INSERT INTO city_notices (city_id, message, enabled) VALUES ($1, 'falha regional', true)",
      [povoadoId]
    );

    const relatorio = await converterEmLocalidade({ placeId: povoadoId, parentId: municipioId, confirmar: true });

    expect(relatorio.avisosPreservados).toBe(1);
    const { rows } = await getPool().query('SELECT city_id, message, enabled FROM city_notices');
    expect(rows).toHaveLength(1);
    expect(rows[0].city_id).toBe(povoadoId);
    expect(rows[0].message).toBe('falha regional');
    expect(rows[0].enabled).toBe(true);
  });

  test('a nota interna e o vinculo com o SGP sobrevivem', async () => {
    const { municipioId, povoadoId, doPovoado } = await cenario();
    await getPool().query(
      "UPDATE contacts SET internal_note = 'cliente antigo', sgp_client_id = '4321' WHERE id = $1",
      [doPovoado[0]]
    );

    await converterEmLocalidade({ placeId: povoadoId, parentId: municipioId, confirmar: true });

    const { rows } = await getPool().query(
      'SELECT internal_note, sgp_client_id FROM contacts WHERE id = $1',
      [doPovoado[0]]
    );
    expect(rows[0].internal_note).toBe('cliente antigo');
    expect(Number(rows[0].sgp_client_id)).toBe(4321);
  });

  test('recusa quando o municipio ainda nao foi classificado', async () => {
    const { municipioId, povoadoId } = await cenario({ classificarPai: false });

    const relatorio = await converterEmLocalidade({ placeId: povoadoId, parentId: municipioId, confirmar: true });

    expect(relatorio.ok).toBe(false);
    expect(relatorio.motivo).toBe('parent_nao_e_municipio');
    expect((await findCityById(povoadoId)).kind).toBe('unclassified');
  });

  test('a segunda execucao nao altera nada e se identifica como ja convertida', async () => {
    const { municipioId, povoadoId, doPovoado } = await cenario();
    await converterEmLocalidade({ placeId: povoadoId, parentId: municipioId, confirmar: true });

    const segunda = await converterEmLocalidade({ placeId: povoadoId, parentId: municipioId, confirmar: true });

    expect(segunda.ok).toBe(false);
    expect(segunda.motivo).toBe('ja_e_localidade');

    // E nada mudou: nem duplicata de registro, nem contato remexido.
    const { rows: lugares } = await getPool().query('SELECT count(*)::int AS n FROM cities');
    expect(lugares[0].n).toBe(2);
    const { rows } = await getPool().query(
      'SELECT city_id, locality_id FROM contacts WHERE id = ANY($1)',
      [doPovoado]
    );
    for (const linha of rows) {
      expect(linha.city_id).toBe(municipioId);
      expect(linha.locality_id).toBe(povoadoId);
    }
  });

  test('recusa quando o registro tem localidades filhas', async () => {
    const { municipioId, povoadoId } = await cenario();
    await getPool().query("UPDATE cities SET kind = 'city' WHERE id = $1", [povoadoId]);
    await createPlace({ name: 'Neta', kind: 'locality', parentId: povoadoId });

    const relatorio = await converterEmLocalidade({ placeId: povoadoId, parentId: municipioId, confirmar: true });

    expect(relatorio.ok).toBe(false);
    expect(relatorio.motivo).toBe('tem_filhas');
  });

  test('recusa quando placeId e parentId sao o mesmo registro', async () => {
    const { municipioId } = await cenario();

    const relatorio = await converterEmLocalidade({ placeId: municipioId, parentId: municipioId, confirmar: true });

    expect(relatorio.ok).toBe(false);
    expect(relatorio.motivo).toBe('pai_igual_ao_filho');
  });

  test('recusa ids ausentes ou inexistentes', async () => {
    const { municipioId } = await cenario();
    const sumido = '00000000-0000-0000-0000-000000000000';

    expect((await converterEmLocalidade({})).motivo).toBe('faltam_ids');
    expect((await converterEmLocalidade({ placeId: sumido, parentId: municipioId })).motivo)
      .toBe('place_nao_encontrado');
    expect((await converterEmLocalidade({ placeId: municipioId, parentId: sumido })).motivo)
      .toBe('parent_nao_encontrado');
  });

  // Regressao: toda saida antecipada tem de encerrar a transacao. Enquanto os
  // `return` de recusa saiam sem ROLLBACK, o cliente voltava ao pool com BEGIN
  // aberto e o trabalho de QUEM PEGASSE esse cliente depois sumia no primeiro
  // ROLLBACK.
  //
  // A verificacao e no MECANISMO, nao no efeito colateral: depender de qual
  // cliente o pool entrega na proxima consulta daria um teste que passa ou
  // falha por sorte. Aqui gravamos o que foi enviado e exigimos que a
  // transacao tenha sido encerrada antes do release.
  test('toda recusa encerra a transacao antes de devolver o cliente ao pool', async () => {
    const { municipioId, povoadoId } = await cenario({ classificarPai: false });
    const semFilhas = await cenario();

    const casos = [
      ['faltam_ids', {}, true],
      ['pai_igual_ao_filho', { placeId: municipioId, parentId: municipioId }, true],
      ['place_nao_encontrado', { placeId: '00000000-0000-0000-0000-000000000000', parentId: municipioId }, true],
      ['parent_nao_encontrado', { placeId: povoadoId, parentId: '00000000-0000-0000-0000-000000000000' }, true],
      ['parent_nao_e_municipio', { placeId: povoadoId, parentId: municipioId }, true],
      // A previa tambem nao pode deixar transacao aberta.
      ['simulacao', { placeId: semFilhas.povoadoId, parentId: semFilhas.municipioId }, false],
    ];

    for (const [rotulo, args, confirmar] of casos) {
      const enviados = [];
      const connectOriginal = getPool().connect.bind(getPool());
      jest.spyOn(getPool(), 'connect').mockImplementation(async () => {
        const client = await connectOriginal();
        const queryOriginal = client.query.bind(client);
        client.query = (...a) => {
          if (typeof a[0] === 'string') enviados.push(a[0].trim().split(/\s+/)[0].toUpperCase());
          return queryOriginal(...a);
        };
        return client;
      });

      await converterEmLocalidade({ ...args, confirmar });

      getPool().connect.mockRestore();

      expect(enviados[0]).toBe('BEGIN');
      expect(enviados[enviados.length - 1]).toBe('ROLLBACK');
      expect(enviados.filter((q) => q === 'COMMIT')).toHaveLength(0);
      if (enviados[enviados.length - 1] !== 'ROLLBACK') {
        throw new Error(`transacao ficou aberta no caso ${rotulo}`);
      }
    }
  });

  test('uma falha depois do UPDATE de cities nao deixa estado pela metade', async () => {
    const { municipioId, povoadoId } = await cenario();

    // A operacao usa connect(), nao getPool().query: o espiao precisa ser no
    // client, senao o teste passa sem exercitar a transacao.
    const connectOriginal = getPool().connect.bind(getPool());
    jest.spyOn(getPool(), 'connect').mockImplementation(async () => {
      const client = await connectOriginal();
      const queryOriginal = client.query.bind(client);
      client.query = (...args) => {
        if (typeof args[0] === 'string' && args[0].includes('UPDATE contacts')) {
          return Promise.reject(new Error('falha simulada'));
        }
        return queryOriginal(...args);
      };
      return client;
    });

    await expect(
      converterEmLocalidade({ placeId: povoadoId, parentId: municipioId, confirmar: true })
    ).rejects.toThrow('falha simulada');

    getPool().connect.mockRestore();

    // O ROLLBACK desfez o UPDATE de cities: o povoado continua legado.
    expect((await findCityById(povoadoId)).kind).toBe('unclassified');
    const { rows } = await getPool().query('SELECT count(*)::int AS n FROM contacts WHERE locality_id IS NOT NULL');
    expect(rows[0].n).toBe(0);
  });
});

describe('listagem para a conversao', () => {
  beforeEach(async () => {
    await getPool().query('TRUNCATE channels, contacts, cities CASCADE');
  });

  test('lista os lugares com tipo e quantidade de contatos, para achar os ids', async () => {
    const { municipioId, povoadoId } = await cenario();

    const lugares = await listarLugaresParaConversao();

    const povoado = lugares.find((l) => l.id === povoadoId);
    const municipio = lugares.find((l) => l.id === municipioId);
    expect(povoado).toMatchObject({ name: 'Barao de Tromai', kind: 'unclassified', contatosComoMunicipio: 3 });
    expect(municipio).toMatchObject({ name: 'Candido Mendes', kind: 'city', contatosComoMunicipio: 1 });
  });
});
