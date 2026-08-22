BEGIN;

ALTER TABLE business_messages
  ADD COLUMN IF NOT EXISTS media_path TEXT,
  ADD COLUMN IF NOT EXISTS media_mime_type VARCHAR(50),
  ADD COLUMN IF NOT EXISTS media_original_name VARCHAR(200);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'business_messages_media_complete_check'
  ) THEN
    ALTER TABLE business_messages ADD CONSTRAINT business_messages_media_complete_check
      CHECK (
        (media_path IS NULL AND media_mime_type IS NULL AND media_original_name IS NULL)
        OR
        (media_path IS NOT NULL AND media_mime_type IN ('image/jpeg','image/png','image/webp')
          AND media_original_name IS NOT NULL)
      );
  END IF;
END $$;

COMMIT;
