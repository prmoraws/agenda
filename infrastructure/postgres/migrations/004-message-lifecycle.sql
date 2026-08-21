BEGIN;

ALTER TABLE business_messages
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE business_messages
  DROP CONSTRAINT IF EXISTS business_messages_status_check;

ALTER TABLE business_messages
  ADD CONSTRAINT business_messages_status_check CHECK (status IN (
    'draft','confirmed','processing','completed','partial_failed','failed','cancelled','deleted'
  ));

COMMIT;
