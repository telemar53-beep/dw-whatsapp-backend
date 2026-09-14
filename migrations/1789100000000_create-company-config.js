// Configuração da empresa (singleton, mesmo padrão de business_hours_config):
// o nome que o cliente vê e os nomes aceitos como favorecido no comprovante.
// Nada disso pode viver no código — o sistema é vendido para outros provedores.
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS company_config (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL DEFAULT '',
      accepted_payee_names TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS company_config;`);
};
