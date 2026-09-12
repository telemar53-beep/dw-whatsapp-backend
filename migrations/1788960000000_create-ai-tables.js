const SYSTEM_PROMPT = `Você é a assistente virtual da DW Telecom.

Seu objetivo é ajudar clientes utilizando informações fornecidas pelo sistema e ferramentas autorizadas.

Nunca invente informações.
Sempre que precisar consultar informações do cliente, utilize as ferramentas disponíveis.
Nunca diga que uma ação foi realizada se uma ferramenta não confirmou sucesso.

Diferencie status do contrato de status da conexão.
Contrato ativo não significa necessariamente conexão online.
Contrato suspenso não significa necessariamente falha técnica.

Nunca exponha APIs, tokens, senhas, IDs internos desnecessários ou informações administrativas.
Nunca forneça informações pertencentes a outro cliente.
Nunca invente faturas, valores, IPs, status, protocolos ou dados técnicos.

Antes de executar ação sensível, siga as regras de autorização.
Se não conseguir resolver com segurança, transfira para um atendente humano.

Responda em português brasileiro de forma clara, educada e objetiva.`;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE contacts
      ADD COLUMN IF NOT EXISTS sgp_client_id   INTEGER,
      ADD COLUMN IF NOT EXISTS sgp_contract_id INTEGER,
      ADD COLUMN IF NOT EXISTS sgp_document    TEXT;

    ALTER TABLE conversations
      ADD COLUMN IF NOT EXISTS suggested_reason_id UUID REFERENCES contact_reasons(id);

    ALTER TABLE messages
      ADD COLUMN IF NOT EXISTS sent_by TEXT NOT NULL DEFAULT 'human';
    ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_sent_by_check;
    ALTER TABLE messages ADD CONSTRAINT messages_sent_by_check
      CHECK (sent_by IN ('human', 'ai'));

    ALTER TABLE channels
      ADD COLUMN IF NOT EXISTS ai_enabled BOOLEAN NOT NULL DEFAULT false;

    CREATE TABLE IF NOT EXISTS ai_config (
      id INTEGER PRIMARY KEY DEFAULT 1,
      api_key TEXT,
      model TEXT NOT NULL DEFAULT '',
      mode TEXT NOT NULL DEFAULT 'disabled'
        CHECK (mode IN ('disabled', 'assistant', 'automatic')),
      system_prompt TEXT NOT NULL,
      max_tools_per_interaction INTEGER NOT NULL DEFAULT 8,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS ai_tool_permissions (
      tool_name  TEXT PRIMARY KEY,
      enabled    BOOLEAN NOT NULL DEFAULT false,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS ai_suggestions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id UUID NOT NULL REFERENCES conversations(id),
      message_id UUID REFERENCES messages(id),
      content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'sent', 'edited', 'discarded')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS ai_suggestions_pending
      ON ai_suggestions (conversation_id) WHERE status = 'pending';

    CREATE TABLE IF NOT EXISTS ai_interactions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id UUID NOT NULL REFERENCES conversations(id),
      contact_id UUID REFERENCES contacts(id),
      mode  TEXT NOT NULL,
      model TEXT NOT NULL,
      tools_requested JSONB NOT NULL DEFAULT '[]',
      tools_executed  JSONB NOT NULL DEFAULT '[]',
      tools_refused   JSONB NOT NULL DEFAULT '[]',
      final_response TEXT,
      error TEXT,
      prompt_tokens INTEGER,
      completion_tokens INTEGER,
      duration_ms INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS ai_interactions_conversation ON ai_interactions (conversation_id);
    CREATE INDEX IF NOT EXISTS ai_interactions_created ON ai_interactions (created_at DESC);
  `);

  pgm.sql(`
    INSERT INTO ai_config (id, system_prompt) VALUES (1, $SEED$${SYSTEM_PROMPT}$SEED$)
    ON CONFLICT (id) DO NOTHING;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS ai_interactions;
    DROP TABLE IF EXISTS ai_suggestions;
    DROP TABLE IF EXISTS ai_tool_permissions;
    DROP TABLE IF EXISTS ai_config;
    ALTER TABLE channels      DROP COLUMN IF EXISTS ai_enabled;
    ALTER TABLE messages      DROP COLUMN IF EXISTS sent_by;
    ALTER TABLE conversations DROP COLUMN IF EXISTS suggested_reason_id;
    ALTER TABLE contacts
      DROP COLUMN IF EXISTS sgp_document,
      DROP COLUMN IF EXISTS sgp_contract_id,
      DROP COLUMN IF EXISTS sgp_client_id;
  `);
};
