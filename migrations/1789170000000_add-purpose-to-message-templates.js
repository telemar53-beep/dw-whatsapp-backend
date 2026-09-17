// Todo template aprovado aparecia para o atendente ao iniciar uma conversa,
// inclusive os que existem só para os disparos do SGP. A finalidade separa as
// duas listas: "atendimento" é o que o atendente escolhe numa conversa,
// "disparo" é o que vai para campanha e para os envios automáticos.
//
// O DEFAULT é 'atendimento' de propósito: assim o deploy não faz template
// nenhum sumir da vista do atendente de uma hora para outra. Os de disparo
// precisam ser marcados na tela de Templates depois de subir — enquanto isso
// não for feito, a tela de campanha fica sem opções.
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE message_templates
    ADD COLUMN purpose TEXT NOT NULL DEFAULT 'atendimento'
    CHECK (purpose IN ('atendimento', 'disparo'));
  `);
};

exports.down = (pgm) => {
  pgm.sql('ALTER TABLE message_templates DROP COLUMN purpose;');
};
