// Quando um atendente assume a conversa, a IA passava a sugerir respostas para
// ele — comportamento que o dono não quer. Só que desligar isso pelo `mode`
// levava junto a triagem e a transcrição de áudio: `mode = 'disabled'` barra a
// IA inteira em ai.service.js. Daí a chave própria.
//
// Nasce DESLIGADA de propósito: é o estado pedido, e assim não depende de
// ninguém lembrar de desmarcar depois do deploy. Ligar de volta é um clique em
// Integrações, sem tocar em código.
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE ai_config
    ADD COLUMN assistant_suggestions_enabled BOOLEAN NOT NULL DEFAULT false;
  `);
};

exports.down = (pgm) => {
  pgm.sql('ALTER TABLE ai_config DROP COLUMN assistant_suggestions_enabled;');
};
