// `cities` passa a representar municipio E localidade na mesma lista.
//
// kind nasce 'unclassified', nao 'city': a consulta de producao de 2026-09-22
// mostrou que tres dos treze registros sao povoados com contatos vinculados
// (Aurizona, Barao de Tromai, Chega tudo). Marca-los como 'city' gravaria uma
// afirmacao falsa. 'unclassified' preserva o comportamento atual sem mentir, e
// faz a pendencia aparecer na tela em vez de ficar escondida. A conversao e
// operacao separada e autorizada — NUNCA uma migration, porque o Render roda
// `migrate up` sozinho a cada deploy.
//
// served nasce false: este cadastro nasceu para LOCALIZAR CONTATOS, nao para
// declarar cobertura comercial. Assumir true deduziria cobertura da simples
// existencia do registro. false nunca produz negativa ao cliente — produz
// "precisa verificar viabilidade".
//
// sgp_pop ausente e NULL, nunca '': com default '' um indice unico tornaria
// impossivel existirem duas cidades sem POP.
//
// sgp_pop_key e derivada, escrita pelo repositorio com a MESMA funcao de
// normalizacao do city-matcher. Nao e indice sobre expressao porque unaccent()
// nao e IMMUTABLE e translate() nao reproduz o NFD do JavaScript — divergencia
// entre a chave do banco e a chave do matcher e exatamente o defeito a evitar.
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE cities
      ADD COLUMN IF NOT EXISTS kind        TEXT    NOT NULL DEFAULT 'unclassified',
      ADD COLUMN IF NOT EXISTS parent_id   UUID    REFERENCES cities(id),
      ADD COLUMN IF NOT EXISTS sgp_pop     TEXT,
      ADD COLUMN IF NOT EXISTS sgp_pop_key TEXT,
      ADD COLUMN IF NOT EXISTS active      BOOLEAN NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS served      BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS note        TEXT    NOT NULL DEFAULT '';

    ALTER TABLE cities
      ADD CONSTRAINT cities_kind_valido CHECK (kind IN ('city', 'locality', 'unclassified')),
      -- CASE em vez de OR sobre a lista de kinds: assim esta trava fala APENAS
      -- de hierarquia. Com OR, um kind desconhecido violava as duas e o erro
      -- que chegava era o desta, escondendo que o problema era o kind.
      ADD CONSTRAINT cities_hierarquia CHECK (
        CASE WHEN kind = 'locality' THEN parent_id IS NOT NULL ELSE parent_id IS NULL END
      ),
      ADD CONSTRAINT cities_pop_par CHECK (
        (sgp_pop IS NULL AND sgp_pop_key IS NULL)
        OR (sgp_pop IS NOT NULL AND sgp_pop_key IS NOT NULL)
      );

    CREATE UNIQUE INDEX IF NOT EXISTS cities_sgp_pop_key_unico
      ON cities (sgp_pop_key) WHERE sgp_pop_key IS NOT NULL;

    CREATE INDEX IF NOT EXISTS cities_parent_id_idx ON cities (parent_id);

    -- Alvo da chave estrangeira composta de contacts (migration seguinte).
    ALTER TABLE cities ADD CONSTRAINT cities_id_parent_unico UNIQUE (id, parent_id);

    -- Lacuna que ja existia: o Postgres nao cria indice do lado filho de uma
    -- FK, entao DELETE de cidade fazia varredura sequencial em contacts.
    CREATE INDEX IF NOT EXISTS contacts_city_id_idx ON contacts (city_id);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS contacts_city_id_idx;
    ALTER TABLE cities DROP CONSTRAINT IF EXISTS cities_id_parent_unico;
    DROP INDEX IF EXISTS cities_parent_id_idx;
    DROP INDEX IF EXISTS cities_sgp_pop_key_unico;
    ALTER TABLE cities
      DROP CONSTRAINT IF EXISTS cities_pop_par,
      DROP CONSTRAINT IF EXISTS cities_hierarquia,
      DROP CONSTRAINT IF EXISTS cities_kind_valido;
    ALTER TABLE cities
      DROP COLUMN IF EXISTS note,
      DROP COLUMN IF EXISTS served,
      DROP COLUMN IF EXISTS active,
      DROP COLUMN IF EXISTS sgp_pop_key,
      DROP COLUMN IF EXISTS sgp_pop,
      DROP COLUMN IF EXISTS parent_id,
      DROP COLUMN IF EXISTS kind;
  `);
};
