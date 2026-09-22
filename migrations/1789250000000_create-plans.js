// Catalogo comercial de planos.
//
// Hoje ele so existe como TEXTO LIVRE dentro de ai_config.triage_extra_instructions,
// colado verbatim no prompt — o que significa que o preco vai para a OpenAI em
// toda conversa, inclusive nas de boleto, e que alterar um preco depende de
// alguem reescrever o texto sem errar.
//
// monthly_price e NUMERIC, nunca texto formatado: e o que de fato elimina o
// risco de preco desatualizado. "R$ 100,00" e problema da camada de exibicao.
//
// speed_mbps e INTEGER e NULLABLE. Inteiro para ordenar, comparar e filtrar sem
// parsing, e para lidar com 1000 Mbps. Nulo porque o SGP ja tem planotv: um
// plano de TV ou combo nao tem velocidade, e nulo e mais honesto que zero.
//
// note e INTERNA: nao sai na resposta operacional nem chega a IA. Quem decide
// isso e a forma da resposta no repositorio, nao a obediencia do modelo.
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS plans (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name              TEXT NOT NULL,
      speed_mbps        INTEGER,
      monthly_price     NUMERIC(10,2) NOT NULL,
      install_condition TEXT NOT NULL DEFAULT '',
      active            BOOLEAN NOT NULL DEFAULT true,
      sort_order        INTEGER NOT NULL DEFAULT 0,
      note              TEXT NOT NULL DEFAULT '',
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT plans_preco_nao_negativo  CHECK (monthly_price >= 0),
      CONSTRAINT plans_velocidade_positiva CHECK (speed_mbps IS NULL OR speed_mbps > 0)
    );

    CREATE INDEX IF NOT EXISTS plans_ordem_idx ON plans (sort_order ASC, name ASC);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS plans_ordem_idx;
    DROP TABLE IF EXISTS plans;
  `);
};
