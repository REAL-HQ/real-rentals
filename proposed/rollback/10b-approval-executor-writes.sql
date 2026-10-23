-- Rollback for 10b-approval-executor-writes.sql. Restores the step 10 audit policies.
-- Run after later steps, and before proposed/rollback/10-approval-permissions.sql.
-- Column grants are omitted from the schema dump (--no-privileges). They are
-- revoked here so a later step-10 rollback is not the only cleanup.
BEGIN;
DROP POLICY IF EXISTS approval_scope_permissive_v3 ON public.audit_log;
DROP POLICY IF EXISTS approval_scope_restrictive_v3 ON public.audit_log;
CREATE POLICY approval_scope_permissive_v3 ON public.audit_log AS PERMISSIVE FOR ALL TO rr_approval_executor
 USING (actor_user_id=private.approval_actor() AND action='identity_review.positive_license_v1' AND entity_type='application' AND private.record_approval_scope_v3(entity_id::uuid))
 WITH CHECK (actor_user_id=private.approval_actor() AND action='identity_review.positive_license_v1' AND entity_type='application' AND private.record_approval_scope_v3(entity_id::uuid));
CREATE POLICY approval_scope_restrictive_v3 ON public.audit_log AS RESTRICTIVE FOR ALL TO rr_approval_executor
 USING (actor_user_id=private.approval_actor() AND action='identity_review.positive_license_v1' AND entity_type='application' AND private.record_approval_scope_v3(entity_id::uuid))
 WITH CHECK (actor_user_id=private.approval_actor() AND action='identity_review.positive_license_v1' AND entity_type='application' AND private.record_approval_scope_v3(entity_id::uuid));
REVOKE SELECT (status, purged_at, approval_evidence_version, contacted_at), UPDATE (status, contacted_at) ON public.applications FROM rr_approval_executor;
REVOKE INSERT (resolution_note, approval_evidence) ON public.application_identity_reviews FROM rr_approval_executor;
COMMIT;
