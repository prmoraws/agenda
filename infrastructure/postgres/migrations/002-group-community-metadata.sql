BEGIN;

ALTER TABLE business_groups
  ADD COLUMN IF NOT EXISTS group_kind VARCHAR(32) NOT NULL DEFAULT 'group',
  ADD COLUMN IF NOT EXISTS community_jid VARCHAR(100),
  ADD COLUMN IF NOT EXISTS sendable BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE business_groups
  DROP CONSTRAINT IF EXISTS business_groups_group_kind_check;

ALTER TABLE business_groups
  ADD CONSTRAINT business_groups_group_kind_check CHECK (
    group_kind IN ('group', 'community', 'community_announcement', 'community_subgroup')
  );

CREATE INDEX IF NOT EXISTS business_groups_kind_idx
  ON business_groups (group_kind, display_name);

COMMIT;
