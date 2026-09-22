// Conversao de um registro LEGADO de `cities` em localidade, repontando os
// contatos dele.
//
// Ate esta etapa, povoado e municipio dividiam a mesma lista: os contatos de
// Barao de Tromai apontam para ele em city_id, como se fosse municipio. A
// conversao move essa informacao para o lugar certo sem perde-la:
//
//   antes:  contact.city_id = Barao de Tromai   locality_id = NULL
//   depois: contact.city_id = Candido Mendes    locality_id = Barao de Tromai
//
// NAO e migration, de proposito: o Render roda `npm run migrate -- up` sozinho
// a cada deploy, e uma conversao de dados ali seria executada SEM AUTORIZACAO,
// em producao, no meio de uma publicacao. E operacao administrativa, disparada
// a mao, um registro por vez.
//
// NAO enfraquece o 409 da rota de edicao: `PATCH /api/admin/cities/:id`
// continua recusando mudanca estrutural com vinculos, exatamente como esta.
// Este e caminho proprio, explicito e auditado — nao uma flag de bypass.
const { getPool } = require('../db/pool');

async function carregar(client, id) {
  const { rows } = await client.query(
    'SELECT id, name, kind, parent_id FROM cities WHERE id = $1',
    [id]
  );
  return rows[0] || null;
}

async function contar(client, placeId) {
  const { rows } = await client.query(
    `SELECT
       (SELECT count(*) FROM contacts     WHERE city_id   = $1)::int AS contatos,
       (SELECT count(*) FROM cities       WHERE parent_id = $1)::int AS filhas,
       (SELECT count(*) FROM city_notices WHERE city_id   = $1)::int AS avisos`,
    [placeId]
  );
  return rows[0];
}

function recusa(motivo, extras = {}) {
  return {
    ok: false,
    motivo,
    place: null,
    parent: null,
    contatosMovidos: 0,
    avisosPreservados: 0,
    simulacao: true,
    ...extras,
  };
}

/**
 * Converte UM registro por chamada. Simula por padrao: so escreve com
 * `confirmar: true`.
 *
 * Uma segunda execucao sobre o mesmo registro nao altera nada — ela para em
 * `ja_e_localidade`, antes de qualquer escrita.
 */
async function converterEmLocalidade({ placeId, parentId, confirmar = false } = {}) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    // TODA saida antecipada precisa encerrar a transacao. Devolver ao pool um
    // cliente com BEGIN aberto contamina quem pegar esse cliente depois: o
    // trabalho dele entra na transacao pendurada e some no primeiro ROLLBACK.
    // Custou um teste "impossivel" para aparecer.
    const desistir = async (motivo, extras) => {
      await client.query('ROLLBACK');
      return recusa(motivo, extras);
    };

    if (!placeId || !parentId) return desistir('faltam_ids');
    if (placeId === parentId) return desistir('pai_igual_ao_filho');

    const place = await carregar(client, placeId);
    if (!place) return desistir('place_nao_encontrado');
    // Idempotencia: ja convertido nao e erro de dado, e "nada a fazer".
    if (place.kind === 'locality') {
      return desistir('ja_e_localidade', { place: { id: place.id, name: place.name } });
    }

    const parent = await carregar(client, parentId);
    if (!parent) return desistir('parent_nao_encontrado');
    // O municipio precisa estar classificado ANTES. Classificar um municipio e
    // edicao comum, feita na tela: nada depende dele como localidade, entao a
    // rota permite e nao devolve 409. Aqui so conferimos — este script nunca
    // altera o registro do municipio, nem o nome nem o tipo.
    if (parent.kind !== 'city') {
      return desistir('parent_nao_e_municipio', { parent: { id: parent.id, name: parent.name } });
    }

    const antes = await contar(client, placeId);
    if (antes.filhas > 0) {
      return desistir('tem_filhas', { place: { id: place.id, name: place.name } });
    }

    const relatorio = {
      ok: true,
      motivo: null,
      place: { id: place.id, name: place.name },
      parent: { id: parent.id, name: parent.name },
      contatosMovidos: antes.contatos,
      avisosPreservados: antes.avisos,
      simulacao: !confirmar,
    };

    if (!confirmar) {
      await client.query('ROLLBACK');
      return relatorio;
    }

    // A ordem importa: a FK composta de contacts exige que a linha da
    // localidade JA tenha o parent_id certo quando o contato passar a apontar
    // para ela. O estado intermediario e valido porque, enquanto locality_id e
    // nulo, MATCH SIMPLE nao verifica a FK.
    await client.query(
      "UPDATE cities SET kind = 'locality', parent_id = $2 WHERE id = $1",
      [placeId, parentId]
    );
    // SOMENTE os contatos DESTE povoado. Quem esta ligado apenas ao municipio
    // nao e tocado: estar em Candido Mendes nao prova a qual povoado a pessoa
    // pertence, e deduzir isso inventaria endereco de cliente real.
    await client.query(
      'UPDATE contacts SET city_id = $2, locality_id = $1 WHERE city_id = $1',
      [placeId, parentId]
    );

    await client.query('COMMIT');
    return relatorio;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Inventario para achar os ids antes de converter: nome, tipo, municipio pai e
 * quantos contatos dependem de cada registro. Somente leitura.
 */
async function listarLugaresParaConversao() {
  const { rows } = await getPool().query(`
    SELECT c.id, c.name, c.kind, c.parent_id,
           p.name AS parent_name,
           (SELECT count(*) FROM contacts WHERE city_id     = c.id)::int AS contatos_municipio,
           (SELECT count(*) FROM contacts WHERE locality_id = c.id)::int AS contatos_localidade,
           (SELECT count(*) FROM cities   WHERE parent_id   = c.id)::int AS filhas,
           (SELECT count(*) FROM city_notices WHERE city_id = c.id)::int AS avisos
    FROM cities c
    LEFT JOIN cities p ON p.id = c.parent_id
    ORDER BY c.name ASC
  `);
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    parentId: row.parent_id,
    parentName: row.parent_name,
    contatosComoMunicipio: row.contatos_municipio,
    contatosComoLocalidade: row.contatos_localidade,
    filhas: row.filhas,
    avisos: row.avisos,
  }));
}

module.exports = { converterEmLocalidade, listarLugaresParaConversao };
