BEGIN;

CREATE TABLE business_groups (
  id BIGSERIAL PRIMARY KEY,
  instance_name VARCHAR(100) NOT NULL,
  group_jid VARCHAR(100) NOT NULL,
  display_name VARCHAR(200) NOT NULL,
  authorized BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (instance_name, group_jid),
  CHECK (group_jid ~ '^[0-9]+@g[.]us$'),
  CHECK (authorized = FALSE OR confirmed_at IS NOT NULL)
);

CREATE TABLE business_messages (
  id BIGSERIAL PRIMARY KEY,
  content TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 4096),
  scheduled_at TIMESTAMPTZ NOT NULL,
  timezone VARCHAR(64) NOT NULL DEFAULT 'America/Bahia',
  status VARCHAR(24) NOT NULL DEFAULT 'draft' CHECK (status IN
    ('draft','confirmed','processing','completed','partial_failed','failed','cancelled')),
  idempotency_key VARCHAR(100) NOT NULL UNIQUE,
  confirmed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status IN ('draft','cancelled') OR confirmed_at IS NOT NULL),
  CHECK (status <> 'cancelled' OR cancelled_at IS NOT NULL)
);

CREATE TABLE business_deliveries (
  id BIGSERIAL PRIMARY KEY,
  message_id BIGINT NOT NULL REFERENCES business_messages(id) ON DELETE CASCADE,
  group_id BIGINT NOT NULL REFERENCES business_groups(id) ON DELETE RESTRICT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK
    (status IN ('pending','processing','sent','failed','cancelled')),
  attempt_count SMALLINT NOT NULL DEFAULT 0,
  max_attempts SMALLINT NOT NULL DEFAULT 3,
  next_attempt_at TIMESTAMPTZ,
  evolution_message_id VARCHAR(200),
  error_code VARCHAR(100),
  locked_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (message_id, group_id),
  CHECK (attempt_count BETWEEN 0 AND max_attempts AND max_attempts BETWEEN 1 AND 10)
);

CREATE TABLE business_events (
  id BIGSERIAL PRIMARY KEY,
  message_id BIGINT REFERENCES business_messages(id) ON DELETE SET NULL,
  delivery_id BIGINT REFERENCES business_deliveries(id) ON DELETE SET NULL,
  event_type VARCHAR(50) NOT NULL,
  outcome VARCHAR(20) NOT NULL CHECK (outcome IN ('ok','error','ignored')),
  error_code VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX business_deliveries_due_idx ON business_deliveries (next_attempt_at, id)
  WHERE status IN ('pending','failed');
CREATE INDEX business_messages_due_idx ON business_messages (scheduled_at, id)
  WHERE status = 'confirmed';

COMMIT;
