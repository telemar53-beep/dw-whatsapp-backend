// Sem FK para contact_reasons de proposito: a chave estrangeira faria qualquer
// TRUNCATE contact_reasons CASCADE levar junto a linha singleton de ai_config
// (armadilha para todo teste futuro) e nao cobre o caso que acontece de
// verdade — o admin DESATIVAR o motivo, nao apaga-lo (o app nem oferece
// apagar). Quem garante que o id aponta para um motivo ativo e
// src/ai/triage-close-reason.js, em toda leitura.
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE ai_config
      ADD COLUMN IF NOT EXISTS triage_resolved_reason_id UUID NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE ai_config DROP COLUMN IF EXISTS triage_resolved_reason_id;
  `);
};
