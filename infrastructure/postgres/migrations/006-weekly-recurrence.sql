BEGIN;

ALTER TABLE business_messages
  ADD COLUMN IF NOT EXISTS series_id UUID,
  ADD COLUMN IF NOT EXISTS recurrence_type VARCHAR(16) NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS occurrence_number SMALLINT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS occurrence_count SMALLINT NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'business_messages_recurrence_check'
  ) THEN
    ALTER TABLE business_messages ADD CONSTRAINT business_messages_recurrence_check
      CHECK (
        recurrence_type IN ('none','weekly')
        AND occurrence_count BETWEEN 1 AND 52
        AND occurrence_number BETWEEN 1 AND occurrence_count
        AND (
          (recurrence_type = 'none' AND occurrence_count = 1 AND series_id IS NULL)
          OR
          (recurrence_type = 'weekly' AND occurrence_count >= 2 AND series_id IS NOT NULL)
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS business_messages_series_idx
  ON business_messages (series_id, occurrence_number)
  WHERE series_id IS NOT NULL;

COMMIT;
