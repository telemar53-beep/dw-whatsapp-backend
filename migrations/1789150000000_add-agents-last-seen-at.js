/**
 * Ultima atividade do atendente, para o painel "Equipe" do chat mostrar
 * "Ultima atividade: hoje as 08:37" em quem esta offline. Atualizada pelo
 * socket ao conectar e ao desconectar (src/realtime/socket-server.js).
 */
exports.up = (pgm) => {
  pgm.sql(`ALTER TABLE agents ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NULL;`);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE agents DROP COLUMN IF EXISTS last_seen_at;`);
};
