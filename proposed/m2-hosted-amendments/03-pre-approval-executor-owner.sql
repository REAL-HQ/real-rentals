-- HOSTED AMENDMENT, not part of the approved packet. Runs immediately before
-- HOSTED-INSTALL step 3 (00-approval-boundary.sql), in its own transaction.
--
-- Found by the hosted rehearsal (2026-10-23, PostgreSQL 17, postgres is not a
-- superuser). Step 3 moves three functions to rr_approval_executor with
-- ALTER FUNCTION ... OWNER TO. A non-superuser can do that only when it can
-- SET ROLE to the new owner and the new owner holds CREATE on the schema.
-- Step 1's CREATE ROLE gave postgres ADMIN on the role but not SET, so step 3
-- fails with 42501 "must be able to SET ROLE rr_approval_executor" and rolls
-- back. The local rehearsal ran as superuser, which skips both checks.
--
-- This is the same pair 03.sql (step 5) already runs for rr_record_executor.
-- 03-post-approval-executor-create.sql revokes the CREATE right after step 3,
-- the only step that transfers ownership to this role.
GRANT rr_approval_executor TO postgres WITH SET TRUE;
GRANT CREATE ON SCHEMA public, private TO rr_approval_executor;
