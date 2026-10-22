-- Rollback for HOSTED-INSTALL step 2: proposed/m2-with-approval-boundary/record-uploaded-content-sha.sql
-- Drops the merge function and the server binding table.
-- Does not change storage.objects.
-- This file is one transaction. Run it with ON_ERROR_STOP. Do not also pass psql -1.
BEGIN;
DROP FUNCTION IF EXISTS public.record_uploaded_content_sha(text, text, text, uuid, text, timestamptz, uuid);
DROP FUNCTION IF EXISTS public.record_uploaded_content_sha(text, text, text, uuid, text, timestamptz);
DROP TABLE IF EXISTS private.uploaded_content_sha;
COMMIT;
