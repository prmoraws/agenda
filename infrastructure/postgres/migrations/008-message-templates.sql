BEGIN;

CREATE TABLE IF NOT EXISTS business_message_templates (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  content TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 4096),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS business_message_templates_active_idx
  ON business_message_templates (name) WHERE active = TRUE;

COMMIT;
