ALTER TABLE files
  ADD COLUMN IF NOT EXISTS content_hash varchar(64);

CREATE INDEX IF NOT EXISTS files_folder_hash_idx
  ON files (folder_id, content_hash);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'files'
      AND column_name = 'original_name'
  ) AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'files'
      AND column_name = 'file_size'
  ) THEN
    CREATE INDEX IF NOT EXISTS files_folder_name_size_idx
      ON files (folder_id, original_name, file_size);
  END IF;
END $$;
