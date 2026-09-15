// O cartão nativo de Pix dos canais oficiais exige nome, chave e tipo da chave
// do recebedor junto do código copia e cola. Esses três dados já viajam dentro
// do próprio código EMV do boleto que vem do Financeiro do SGP, e passaram a
// ser lidos de lá (src/payments/pix-emv.js) — então o cadastro "Recebedor Pix"
// em Integrações não tem mais função nenhuma e sai do banco.
//
// As três colunas nasceram em 1789030000000_add-pix-message-type.js; o down
// recria só elas, como TEXT nulo (sem o CHECK do tipo da chave, que era parte
// do cadastro que deixou de existir).
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE sgp_query_config
      DROP COLUMN IF EXISTS pix_merchant_name,
      DROP COLUMN IF EXISTS pix_merchant_key,
      DROP COLUMN IF EXISTS pix_merchant_key_type;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE sgp_query_config
      ADD COLUMN IF NOT EXISTS pix_merchant_name TEXT,
      ADD COLUMN IF NOT EXISTS pix_merchant_key TEXT,
      ADD COLUMN IF NOT EXISTS pix_merchant_key_type TEXT;
  `);
};
