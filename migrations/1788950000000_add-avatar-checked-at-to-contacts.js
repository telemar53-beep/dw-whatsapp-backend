// Momento da última consulta ao WhatsApp pela foto do contato (com ou sem foto
// disponível). Serve de trava de frequência para o refresh automático — antes
// disso a foto era buscada uma única vez, na criação do contato, e nunca mais.
exports.up = (pgm) => {
  pgm.sql(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS avatar_checked_at TIMESTAMPTZ;`);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE contacts DROP COLUMN IF EXISTS avatar_checked_at;`);
};
