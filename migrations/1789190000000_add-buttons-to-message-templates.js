// Botão de resposta rápida é o único jeito sancionado pela Meta de o cliente
// reabrir a janela de 24 h com um toque — sem ele, iniciar uma conversa entrega
// o template e para ali, porque a janela só abre quando o cliente responde.
//
// Guardamos o texto dos botões porque a prévia da tela e o histórico precisam
// mostrar o que o cliente viu. A Meta continua sendo a dona da verdade: aqui é
// cópia, e por isso o DEFAULT vazio serve para todo template já existente.
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE message_templates
    ADD COLUMN buttons JSONB NOT NULL DEFAULT '[]'::jsonb;
  `);
};

exports.down = (pgm) => {
  pgm.sql('ALTER TABLE message_templates DROP COLUMN buttons;');
};
