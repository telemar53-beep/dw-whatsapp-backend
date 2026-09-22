// O contato guarda os DOIS: city_id continua sendo o municipio, com o mesmo
// significado de antes, e locality_id e o povoado, opcional. Povoado nunca
// ocupa o lugar de municipio.
//
// A invariante "a localidade pertence ao municipio do contato" fica no BANCO,
// por chave estrangeira composta — nao na aplicacao. Combinacao invalida a
// recusar: municipio Carutapera + localidade cujo pai e Candido Mendes.
//
// ON DELETE SET NULL (locality_id), com lista de colunas, e PostgreSQL 15+;
// producao roda 16.15 (verificado em 2026-09-22). Sem a lista, o SET NULL
// anularia TODAS as colunas da FK, e apagar um povoado zeraria tambem o
// municipio do contato.
//
// O CHECK e indispensavel: MATCH SIMPLE considera a FK satisfeita quando
// QUALQUER coluna e nula, entao sem ele um contato poderia ter localidade sem
// municipio.
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE contacts ADD COLUMN IF NOT EXISTS locality_id UUID;

    ALTER TABLE contacts
      ADD CONSTRAINT contacts_localidade_do_municipio
        FOREIGN KEY (locality_id, city_id) REFERENCES cities (id, parent_id)
        ON DELETE SET NULL (locality_id),
      ADD CONSTRAINT contacts_localidade_exige_municipio
        CHECK (locality_id IS NULL OR city_id IS NOT NULL);

    CREATE INDEX IF NOT EXISTS contacts_locality_id_idx ON contacts (locality_id);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS contacts_locality_id_idx;
    ALTER TABLE contacts
      DROP CONSTRAINT IF EXISTS contacts_localidade_exige_municipio,
      DROP CONSTRAINT IF EXISTS contacts_localidade_do_municipio;
    ALTER TABLE contacts DROP COLUMN IF EXISTS locality_id;
  `);
};
