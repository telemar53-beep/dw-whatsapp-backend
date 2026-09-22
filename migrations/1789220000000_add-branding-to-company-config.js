// Identidade visual da instalação: logo, símbolo e cor de marca.
//
// O sistema é vendido para outros provedores, então nada de marca pode viver
// no código — o nome da empresa já saiu daqui pelo mesmo motivo. Estas três
// são TEXT e guardam URL (logo e símbolo) e um hex (#RGB ou #RRGGBB).
//
// São dados PURAMENTE visuais: não participam de IA, SGP, WhatsApp,
// autorização, ferramentas nem de qualquer regra de negócio. Ficam aqui, no
// singleton que já existia, em vez de numa tabela nova.
//
// Default '' em vez de NULL para a leitura não precisar de COALESCE: vazio
// significa "sem marca", e a tela cai no monograma pelas iniciais do nome.
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE company_config
      ADD COLUMN IF NOT EXISTS logo_url    TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS symbol_url  TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS brand_color TEXT NOT NULL DEFAULT '';
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE company_config
      DROP COLUMN IF EXISTS logo_url,
      DROP COLUMN IF EXISTS symbol_url,
      DROP COLUMN IF EXISTS brand_color;
  `);
};
