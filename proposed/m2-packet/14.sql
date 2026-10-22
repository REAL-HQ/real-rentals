-- LOCAL V5 supplement. No API memberships, broad table grants, or BYPASSRLS.
GRANT SELECT(deleted_at,full_name,dob,license_number,license_state,license_expiration) ON public.applications TO rr_evidence_issuer;
GRANT SELECT(id,application_id,kind,status,resolution,positive_evidence_v1,resolved_at) ON public.application_identity_reviews TO rr_evidence_issuer;
CREATE POLICY issuer_identity_allow_v5 ON public.application_identity_reviews AS PERMISSIVE FOR SELECT TO rr_evidence_issuer USING (private.record_issuer_scope_v2(application_id));
CREATE POLICY issuer_identity_limit_v5 ON public.application_identity_reviews AS RESTRICTIVE FOR SELECT TO rr_evidence_issuer USING (private.record_issuer_scope_v2(application_id));
