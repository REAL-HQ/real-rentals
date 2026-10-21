-- CREATE was granted in 03.sql so ALTER OWNER could move objects to
-- rr_record_executor. Every ownership transfer in this packet has already run.
-- Approve, record, swap, replay, and extend do not need CREATE on the schemas.
REVOKE CREATE ON SCHEMA public, private FROM rr_record_executor;
