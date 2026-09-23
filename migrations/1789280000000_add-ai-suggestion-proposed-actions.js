// Contenção de 22/09/2026. No perfil assistente, ação com efeito real virou
// PROPOSTA: a IA pede, a atendente decide. A tentativa precisa chegar à tela,
// e `acoes_executadas` não serve para isso — o card do frontend rotula cada
// nome dali com uma frase no passado ("Liberação em confiança executada no
// SGP"). Reaproveitar aquela coluna faria a tela afirmar que aconteceu
// exatamente o que o gate impediu de acontecer.
//
// Coluna separada, não um valor novo dentro da mesma lista: o card filtra por
// `ROTULO_ACAO[nome]` e descartaria em silêncio qualquer string marcada
// ("desbloqueio_confianca (aguardando você)"), que é o desaparecimento
// silencioso que esta entrega existe para impedir.
//
// Aditiva e com DEFAULT: as sugestões já gravadas continuam válidas com a
// lista vazia, que é a verdade sobre elas — naquele mundo nada era proposto,
// tudo era executado.
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE ai_suggestions
    ADD COLUMN IF NOT EXISTS acoes_propostas JSONB NOT NULL DEFAULT '[]';
  `);
};

exports.down = (pgm) => {
  pgm.sql('ALTER TABLE ai_suggestions DROP COLUMN IF EXISTS acoes_propostas;');
};
