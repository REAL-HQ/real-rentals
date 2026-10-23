-- Temporary CREATE privilege check, for use after ANY interrupted M2 install.
--
-- HOSTED-INSTALL step 5 (proposed/m2-packet/03.sql) runs
--   GRANT CREATE ON SCHEMA private, public TO rr_record_executor;
-- which step 29 revokes. This asserts no packet executor role holds CREATE on
-- either schema, whatever point the install stopped at.
--
-- The preflight's "public CREATE holders" row reports the grantee list but only
-- fails for anon and authenticated, and it covers public only. This covers both
-- schemas and all three executor roles, and must return t.
--
-- A role that does not exist yet, or was dropped by a rollback, is skipped by
-- to_regrole(...) IS NOT NULL, so the same query is correct before step 5, after
-- a full unwind, and after a completed install.
--
-- Read-only. Run it in its own execution and record the result before standing
-- down from any stopped install.

SELECT NOT EXISTS (
  SELECT 1
  FROM (VALUES ('rr_record_executor'), ('rr_approval_executor'), ('rr_evidence_issuer')) AS r(rol)
  CROSS JOIN (VALUES ('public'), ('private')) AS s(nsp)
  WHERE to_regrole(r.rol) IS NOT NULL
    AND has_schema_privilege(r.rol, s.nsp, 'CREATE')
) AS no_executor_create;
