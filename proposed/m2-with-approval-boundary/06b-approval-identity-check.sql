-- Apply after packet step 6 and before step 7. A hosted run follows proposed/HOSTED-INSTALL.md.
-- Step 6 replaces the step 0 identity check with the positive_license_v1 check.
-- verify_approval_identity inserts kind approval_identity, resolution verified,
-- approval_evidence set, positive_evidence_v1 null. That row is what
-- approval_validate reads, and step 6's check rejects it. This restores that
-- one shape beside the positive-license shape. Other kinds stay on step 6's
-- resolution list, and neither shape may carry the other's evidence column.
-- Packet SQL is not edited.
-- This file is one transaction. Run it with ON_ERROR_STOP. Do not also pass psql -1.
BEGIN;
--
-- integrity_serialize_v1 is an invoker trigger. It calls private.approval_lock,
-- and step 1 revokes that function from authenticated and service_role. A normal
-- license insert then dies in the trigger before the row exists. The body only
-- takes the lock the packet already required. Running it as the installer lets
-- that lock succeed. It does not grant the lock function to those roles.

CREATE OR REPLACE FUNCTION private.integrity_serialize_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN PERFORM private.approval_lock(); RETURN NULL; END $$;
-- CREATE OR REPLACE keeps the step 6 revoke. Repeat it so this definer
-- cannot fall back to PUBLIC EXECUTE if step 6 is ever re-read alone.
REVOKE ALL ON FUNCTION private.integrity_serialize_v1() FROM PUBLIC, anon, authenticated, service_role;

ALTER TABLE public.application_identity_reviews DROP CONSTRAINT application_identity_reviews_resolution_check;
ALTER TABLE public.application_identity_reviews ADD CONSTRAINT application_identity_reviews_resolution_check CHECK ((
 (kind='positive_license_v1' AND status='resolved' AND resolution='verified' AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL AND positive_evidence_v1 IS NOT NULL AND approval_evidence IS NULL)
 OR (kind='approval_identity' AND status='resolved' AND resolution='verified' AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL AND approval_evidence IS NOT NULL AND positive_evidence_v1 IS NULL AND jsonb_typeof(approval_evidence)='object' AND approval_evidence ?& ARRAY['application','version','identity','front','back'] AND jsonb_typeof(approval_evidence->'identity')='object' AND jsonb_typeof(approval_evidence->'front')='object' AND jsonb_typeof(approval_evidence->'back')='object'
  AND approval_evidence->>'application'=application_id::text AND (approval_evidence->>'version') ~ '^[0-9]+$'
  AND approval_evidence->'identity'->>'license_number' IS NOT NULL AND approval_evidence->'identity'->>'license_expiration' IS NOT NULL
  AND approval_evidence->'front' ?& ARRAY['id','bucket','path','sha256','reviewer','reviewed_at','object_version']
  AND approval_evidence->'back' ?& ARRAY['id','bucket','path','sha256','reviewer','reviewed_at','object_version']
  AND approval_evidence->'front'->>'sha256' ~ '^[0-9a-f]{64}$' AND approval_evidence->'back'->>'sha256' ~ '^[0-9a-f]{64}$'
  AND approval_evidence->'front'->>'id' IS NOT NULL AND approval_evidence->'back'->>'id' IS NOT NULL
  AND approval_evidence->'front'->>'reviewer' IS NOT NULL AND approval_evidence->'back'->>'reviewer' IS NOT NULL
  AND approval_evidence->'front'->>'reviewed_at' IS NOT NULL AND approval_evidence->'back'->>'reviewed_at' IS NOT NULL
  AND jsonb_typeof(approval_evidence->'version')='number' AND nullif(btrim(approval_evidence->'identity'->>'license_number'),'') IS NOT NULL
  AND nullif(approval_evidence->'front'->>'id','') IS NOT NULL
  AND nullif(approval_evidence->'front'->>'bucket','') IS NOT NULL
  AND nullif(approval_evidence->'front'->>'path','') IS NOT NULL
  AND nullif(approval_evidence->'front'->>'reviewer','') IS NOT NULL
  AND nullif(approval_evidence->'front'->>'reviewed_at','') IS NOT NULL
  AND approval_evidence->'front'->'object_version'->>'bucket'=approval_evidence->'front'->>'bucket'
  AND approval_evidence->'front'->'object_version'->>'path'=approval_evidence->'front'->>'path'
  AND approval_evidence->'front'->'object_version'->>'sha256'=approval_evidence->'front'->>'sha256'
  AND nullif(approval_evidence->'front'->'object_version'->>'version','') IS NOT NULL
  AND nullif(approval_evidence->'back'->>'id','') IS NOT NULL
  AND nullif(approval_evidence->'back'->>'bucket','') IS NOT NULL
  AND nullif(approval_evidence->'back'->>'path','') IS NOT NULL
  AND nullif(approval_evidence->'back'->>'reviewer','') IS NOT NULL
  AND nullif(approval_evidence->'back'->>'reviewed_at','') IS NOT NULL
  AND approval_evidence->'back'->'object_version'->>'bucket'=approval_evidence->'back'->>'bucket'
  AND approval_evidence->'back'->'object_version'->>'path'=approval_evidence->'back'->>'path'
  AND approval_evidence->'back'->'object_version'->>'sha256'=approval_evidence->'back'->>'sha256'
  AND nullif(approval_evidence->'back'->'object_version'->>'version','') IS NOT NULL)
 OR (kind NOT IN ('positive_license_v1','approval_identity') AND positive_evidence_v1 IS NULL AND approval_evidence IS NULL AND (resolution IS NULL OR resolution IN ('same_person','different_person','dismissed')))));
COMMIT;
