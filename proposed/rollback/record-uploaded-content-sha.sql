-- Rollback for record-uploaded-content-sha.sql.
-- Drops the public merge function. Does not change storage.objects.
-- This file is one transaction. Run it with ON_ERROR_STOP. Do not also pass psql -1.
BEGIN;
DROP FUNCTION IF EXISTS public.record_uploaded_content_sha(text, text, text, uuid, text, timestamptz);
COMMIT;
