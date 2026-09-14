/**
 * Canal oficial (meta_cloud / 360dialog) nasce "connected".
 *
 * Producao 2026-09-14: o canal 360dialog "DW Telcom 3" recebia e enviava
 * mensagens normalmente, mas aparecia como "Desconectado" no cartao de Canais,
 * na faixa do topo do chat e na recusa de envio pela integracao SGP. Motivo:
 * so o baileys.manager chama updateChannelStatus, entao o canal oficial ficava
 * com o DEFAULT 'disconnected' do banco para sempre. Esta migracao corrige os
 * canais oficiais que ja existem.
 */
exports.up = (pgm) => {
  pgm.sql(`
    UPDATE channels
    SET status = 'connected'
    WHERE type IN ('meta_cloud', '360dialog') AND status = 'disconnected';
  `);
};

exports.down = () => {
  // No-op de proposito: o 'disconnected' anterior nunca significou nada para um
  // canal oficial, e nao ha como saber quais linhas o up alterou de fato.
};
