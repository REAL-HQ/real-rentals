-- LOCAL REHEARSAL ONLY. Apply after packet step 10 and before step 11.
-- Step 10 grants the executor the positive-license columns and an audit policy
-- that allows only identity_review.positive_license_v1. verify_approval_identity
-- and approve_application_checked run as rr_approval_executor. They write
-- approval_evidence, resolution_note, applications.status, and the two approval
-- audit actions. Those writes stay inside the existing application scope.
-- No authenticated or service-role policy is added or widened.

GRANT SELECT (status, purged_at, approval_evidence_version, contacted_at), UPDATE (status, contacted_at) ON public.applications TO rr_approval_executor;
GRANT INSERT (resolution_note, approval_evidence) ON public.application_identity_reviews TO rr_approval_executor;

DROP POLICY IF EXISTS approval_scope_permissive_v3 ON public.audit_log;
DROP POLICY IF EXISTS approval_scope_restrictive_v3 ON public.audit_log;
CREATE POLICY approval_scope_permissive_v3 ON public.audit_log AS PERMISSIVE FOR ALL TO rr_approval_executor
 USING (actor_user_id=private.approval_actor() AND action IN ('identity_review.positive_license_v1','identity_review.approval_verified','application.approved') AND entity_type='application' AND private.record_approval_scope_v3(entity_id::uuid))
 WITH CHECK (actor_user_id=private.approval_actor() AND action IN ('identity_review.positive_license_v1','identity_review.approval_verified','application.approved') AND entity_type='application' AND private.record_approval_scope_v3(entity_id::uuid));
CREATE POLICY approval_scope_restrictive_v3 ON public.audit_log AS RESTRICTIVE FOR ALL TO rr_approval_executor
 USING (actor_user_id=private.approval_actor() AND action IN ('identity_review.positive_license_v1','identity_review.approval_verified','application.approved') AND entity_type='application' AND private.record_approval_scope_v3(entity_id::uuid))
 WITH CHECK (actor_user_id=private.approval_actor() AND action IN ('identity_review.positive_license_v1','identity_review.approval_verified','application.approved') AND entity_type='application' AND private.record_approval_scope_v3(entity_id::uuid));
