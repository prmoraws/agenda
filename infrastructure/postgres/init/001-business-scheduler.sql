BEGIN;

CREATE TABLE business_groups (
  id BIGSERIAL PRIMARY KEY,
  instance_name VARCHAR(100) NOT NULL,
  group_jid VARCHAR(100) NOT NULL,
  display_name VARCHAR(200) NOT NULL,
  group_kind VARCHAR(32) NOT NULL DEFAULT 'group' CHECK
    (group_kind IN ('group','community','community_announcement','community_subgroup')),
  community_jid VARCHAR(100),
  sendable BOOLEAN NOT NULL DEFAULT TRUE,
  authorized BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (instance_name, group_jid),
  CHECK (group_jid ~ '^[0-9]+(-[0-9]+)?@g[.]us$'),
  CHECK (authorized = FALSE OR confirmed_at IS NOT NULL)
);

CREATE TABLE business_messages (
  id BIGSERIAL PRIMARY KEY,
  content TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 4096),
  scheduled_at TIMESTAMPTZ NOT NULL,
  timezone VARCHAR(64) NOT NULL DEFAULT 'America/Bahia',
  status VARCHAR(24) NOT NULL DEFAULT 'draft' CHECK (status IN
    ('draft','confirmed','processing','completed','partial_failed','failed','cancelled','deleted')),
  idempotency_key VARCHAR(100) NOT NULL UNIQUE,
  confirmed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  media_path TEXT,
  media_mime_type VARCHAR(50),
  media_original_name VARCHAR(200),
  series_id UUID,
  recurrence_type VARCHAR(16) NOT NULL DEFAULT 'none',
  occurrence_number SMALLINT NOT NULL DEFAULT 1,
  occurrence_count SMALLINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status IN ('draft','cancelled') OR confirmed_at IS NOT NULL),
  CHECK (status <> 'cancelled' OR cancelled_at IS NOT NULL)
  ,CHECK (
    (media_path IS NULL AND media_mime_type IS NULL AND media_original_name IS NULL)
    OR
    (media_path IS NOT NULL AND media_mime_type IN ('image/jpeg','image/png','image/webp')
      AND media_original_name IS NOT NULL)
  )
  ,CHECK (
    recurrence_type IN ('none','weekly')
    AND occurrence_count BETWEEN 1 AND 52
    AND occurrence_number BETWEEN 1 AND occurrence_count
    AND (
      (recurrence_type = 'none' AND occurrence_count = 1 AND series_id IS NULL)
      OR
      (recurrence_type = 'weekly' AND occurrence_count >= 2 AND series_id IS NOT NULL)
    )
  )
);

CREATE TABLE business_labels (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  color VARCHAR(7) NOT NULL DEFAULT '#52606d' CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  source VARCHAR(20) NOT NULL DEFAULT 'agenda' CHECK (source IN ('agenda','evolution')),
  external_id VARCHAR(100),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source, name),
  UNIQUE (source, external_id)
);

CREATE TABLE business_group_labels (
  group_id BIGINT NOT NULL REFERENCES business_groups(id) ON DELETE CASCADE,
  label_id BIGINT NOT NULL REFERENCES business_labels(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (group_id, label_id)
);

CREATE TABLE business_message_templates (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  content TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 4096),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
CREATE INDEX business_messages_series_idx ON business_messages (series_id, occurrence_number)
  WHERE series_id IS NOT NULL;
CREATE INDEX business_group_labels_label_idx ON business_group_labels (label_id, group_id);
CREATE INDEX business_message_templates_active_idx ON business_message_templates (name)
  WHERE active = TRUE;

COMMIT;
