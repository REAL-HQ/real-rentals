-- HOSTED AMENDMENT, not part of the approved packet. Runs immediately after
-- HOSTED-INSTALL step 3 commits and before its verification query.
-- Revokes the CREATE that 03-pre-approval-executor-owner.sql granted for the
-- step-3 ownership transfers. No later step transfers ownership to
-- rr_approval_executor, and proposed/m2-verify/no-executor-create.sql requires
-- that it hold no CREATE on public or private.
REVOKE CREATE ON SCHEMA public, private FROM rr_approval_executor;
