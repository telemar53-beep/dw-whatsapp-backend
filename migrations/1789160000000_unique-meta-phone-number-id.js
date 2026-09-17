// A entrada de mensagem acha o canal por config->>'phoneNumberId' e usa
// rows[0] de uma consulta sem ordenacao: com dois canais no mesmo ID, qual
// deles recebe as mensagens seria decidido pelo Postgres, e poderia mudar entre
// execucoes. O indice faz o banco recusar a duplicata na hora do cadastro.
//
// O bloco antes do indice existe so para dar um erro legivel: se ja houver
// duplicata em producao, o CREATE INDEX falharia com uma mensagem cifrada e o
// deploy quebraria sem dizer qual canal e o problema.
exports.up = (pgm) => {
  pgm.sql(`
    DO $$
    DECLARE duplicado TEXT;
    BEGIN
      SELECT config->>'phoneNumberId' INTO duplicado
      FROM channels
      WHERE type = 'meta_cloud' AND config->>'phoneNumberId' IS NOT NULL
      GROUP BY config->>'phoneNumberId'
      HAVING COUNT(*) > 1
      LIMIT 1;
      IF duplicado IS NOT NULL THEN
        RAISE EXCEPTION 'Existe mais de um canal meta_cloud com o Phone Number ID %. Apague ou corrija o canal duplicado antes de subir esta migracao.', duplicado;
      END IF;
    END $$;
  `);
  pgm.sql(`
    CREATE UNIQUE INDEX channels_meta_phone_number_id_unique
    ON channels ((config->>'phoneNumberId'))
    WHERE type = 'meta_cloud' AND config->>'phoneNumberId' IS NOT NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql('DROP INDEX IF EXISTS channels_meta_phone_number_id_unique;');
};
