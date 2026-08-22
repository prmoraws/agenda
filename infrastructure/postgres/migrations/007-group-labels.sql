BEGIN;

CREATE TABLE IF NOT EXISTS business_labels (
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

CREATE TABLE IF NOT EXISTS business_group_labels (
  group_id BIGINT NOT NULL REFERENCES business_groups(id) ON DELETE CASCADE,
  label_id BIGINT NOT NULL REFERENCES business_labels(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (group_id, label_id)
);

CREATE INDEX IF NOT EXISTS business_group_labels_label_idx
  ON business_group_labels (label_id, group_id);

COMMIT;
