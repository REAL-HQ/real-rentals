#!/usr/bin/env bash
# Builds request-s1-RECONSTRUCTED.sql pinned to TARGET_SYSID. Usage: src/build-request.sh <system_identifier> > out.sql
set -euo pipefail; D="$(cd "$(dirname "$0")" && pwd)"; SYSID="${1:?system id}"
[[ "$SYSID" =~ ^[0-9]+$ ]] || { echo "bad sysid" >&2; exit 1; }
INNER="$D/inner-s1-RECONSTRUCTED.sql"; SHA=$(sha256sum "$INNER" | cut -c1-64)
cat <<SQL
-- RECONSTRUCTED S1 install request (NOT the original approved artifact bd86d450). One transaction.
BEGIN;
DO \$g\$ BEGIN
 IF (SELECT system_identifier::text FROM pg_control_system()) <> '$SYSID' THEN RAISE EXCEPTION 'refused: wrong target'; END IF;
 IF (SELECT system_identifier::text FROM pg_control_system()) = '7642734024280108049' THEN RAISE EXCEPTION 'refused: production'; END IF;
 IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.applications'::regclass AND tgname='zz_application_write_guard') THEN RAISE EXCEPTION 'refused: S1 already present'; END IF;
END \$g\$;
CREATE TEMP TABLE s1_pre ON COMMIT DROP AS SELECT pg_catalog.md5(pg_catalog.string_agg(pg_catalog.concat_ws('|',schemaname,tablename,policyname,permissive,roles::text,cmd,qual,with_check),E'\n' ORDER BY policyname)) AS pol FROM pg_catalog.pg_policies;
$(cat "$INNER")
DO \$v\$ DECLARE f oid := 'private.application_write_guard()'::regprocedure; BEGIN
 IF pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to((SELECT prosrc FROM pg_proc WHERE oid=f),'UTF8')),'hex') <> '34ce374b15e106597e7c6f9bd8bbb03607c3b7b68ab30e1aad75f4597fa6a292' THEN RAISE EXCEPTION 'function body mismatch'; END IF;
 IF (SELECT pol FROM s1_pre) IS DISTINCT FROM (SELECT pg_catalog.md5(pg_catalog.string_agg(pg_catalog.concat_ws('|',schemaname,tablename,policyname,permissive,roles::text,cmd,qual,with_check),E'\n' ORDER BY policyname)) FROM pg_catalog.pg_policies) THEN RAISE EXCEPTION 'policies changed'; END IF;
END \$v\$;
INSERT INTO public.audit_log(entity_type, entity_id, action, actor_role, metadata)
VALUES ('database_migration','s1_application_write_guard_reconstructed','security_migration_verified', current_user,
 pg_catalog.jsonb_build_object('package','security-s1 RECONSTRUCTED','reconstructed_from','production catalog 2026-10-31; original bd86d450 unavailable','inner_sql_sha256','$SHA','guard_function_prosrc_sha256','34ce374b15e106597e7c6f9bd8bbb03607c3b7b68ab30e1aad75f4597fa6a292'));
COMMIT;
SQL
