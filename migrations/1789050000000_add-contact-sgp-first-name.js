// O primeiro nome do cliente no SGP fica gravado no contato para que, quando o
// SGP não responder, a triagem ainda consiga cumprimentar pelo nome em vez de
// pedir o CPF de novo a um cliente que já está vinculado.
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE contacts ADD COLUMN IF NOT EXISTS sgp_first_name TEXT;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE contacts DROP COLUMN IF EXISTS sgp_first_name;
  `);
};
