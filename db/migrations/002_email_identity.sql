-- Abort without merging accounts if old data contains case-insensitive duplicates.
DO $$ BEGIN
  IF EXISTS (SELECT lower(btrim(email)) FROM users WHERE email IS NOT NULL
             GROUP BY lower(btrim(email)) HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Case-insensitive email duplicates exist. Resolve conflicting account IDs before running migrations.';
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS users_normalized_email_unique ON users(lower(btrim(email))) WHERE email IS NOT NULL;
