-- Rollback for 21-revoke-executor-create.sql.
-- Restores the CREATE grant 03.sql needed for ALTER OWNER.
-- This file is one transaction. Run it with ON_ERROR_STOP. Do not also pass psql -1.
BEGIN;
GRANT CREATE ON SCHEMA public, private TO rr_record_executor;
COMMIT;
