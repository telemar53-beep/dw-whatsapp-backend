// O cartão nativo de Pix do WhatsApp precisa de um tipo de mensagem próprio
// ('pix') e de um lugar para guardar valor/vencimento/fatura — dados que o
// worker de saída usa para montar o cartão na hora do envio, e que não cabem
// em nenhuma coluna existente de messages. O código copia e cola continua em
// `content`, como qualquer outra mensagem.
//
// Em sgp_query_config entram os dados do recebedor Pix da empresa, exigidos
// pela API de pagamentos do Brasil da Meta nos canais oficiais (no Baileys a
// "chave" é o próprio copia e cola, então lá isso não é obrigatório).
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_message_type_check;
    ALTER TABLE messages ADD CONSTRAINT messages_message_type_check
      CHECK (message_type IN ('text', 'image', 'document', 'audio', 'video', 'sticker', 'location', 'pix'));
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS metadata JSONB;
    ALTER TABLE sgp_query_config
      ADD COLUMN IF NOT EXISTS pix_merchant_name TEXT,
      ADD COLUMN IF NOT EXISTS pix_merchant_key TEXT,
      ADD COLUMN IF NOT EXISTS pix_merchant_key_type TEXT
        CHECK (pix_merchant_key_type IS NULL OR pix_merchant_key_type IN ('CPF', 'CNPJ', 'EMAIL', 'PHONE', 'EVP'));
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE sgp_query_config
      DROP COLUMN IF EXISTS pix_merchant_name,
      DROP COLUMN IF EXISTS pix_merchant_key,
      DROP COLUMN IF EXISTS pix_merchant_key_type;
    ALTER TABLE messages DROP COLUMN IF EXISTS metadata;
    ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_message_type_check;
    ALTER TABLE messages ADD CONSTRAINT messages_message_type_check
      CHECK (message_type IN ('text', 'image', 'document', 'audio', 'video', 'sticker', 'location'));
  `);
};
