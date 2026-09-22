// O que esta "no caminho" de uma edicao estrutural ou de uma exclusao de lugar.
//
// Modulo proprio porque duas rotas consultam o mesmo conjunto e porque a
// mensagem do 409 precisa NOMEAR o que impede — quem administra tem de saber o
// que tratar antes de tentar de novo, e nao receber "conflito" seco.
const { getPool } = require('../db/pool');

async function dependenciasDoLugar(id) {
  const { rows } = await getPool().query(
    `SELECT
       (SELECT count(*) FROM contacts     WHERE city_id     = $1)::int AS contatos_municipio,
       (SELECT count(*) FROM contacts     WHERE locality_id = $1)::int AS contatos_localidade,
       (SELECT count(*) FROM cities       WHERE parent_id   = $1)::int AS filhas,
       (SELECT count(*) FROM city_notices WHERE city_id     = $1)::int AS avisos`,
    [id]
  );
  return {
    contatosComoMunicipio: rows[0].contatos_municipio,
    contatosComoLocalidade: rows[0].contatos_localidade,
    filhas: rows[0].filhas,
    avisos: rows[0].avisos,
  };
}

module.exports = { dependenciasDoLugar };
