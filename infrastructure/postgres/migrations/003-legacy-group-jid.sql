BEGIN;

ALTER TABLE business_groups
  DROP CONSTRAINT IF EXISTS business_groups_group_jid_check;

ALTER TABLE business_groups
  ADD CONSTRAINT business_groups_group_jid_check CHECK (
    group_jid ~ '^[0-9]+(-[0-9]+)?@g[.]us$'
  );

COMMIT;
