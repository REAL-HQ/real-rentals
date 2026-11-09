#!/usr/bin/env bash
# LOCAL TEST ONLY: disposable Postgres on 127.0.0.1:${AR23_PORT:-55491}. Refuses any other host.
# Usage: AR23_PORT=55491 bash proposed/application-resume-0023/test/run-local.sh
set -uo pipefail
PORT=${AR23_PORT:-55491}; HOST=127.0.0.1; PKG="$(cd "$(dirname "$0")/.." && pwd)"
[ "$HOST" = 127.0.0.1 ] || exit 2
ADMIN="postgresql://postgres@$HOST:$PORT/template1?sslmode=disable"; DB="postgresql://postgres@$HOST:$PORT/postgres?sslmode=disable"
pass=0; fail=0
ok(){ echo "PASS $1"; pass=$((pass+1)); }; bad(){ echo "FAIL $1"; fail=$((fail+1)); }
q(){ psql "$DB" -v ON_ERROR_STOP=1 -Atqc "$1" 2>&1; }
sendfile(){ node "$PKG/test/send.mjs" "$DB" "$1" 2>&1; }   # exact bytes, one simple-query message, like query_database
expect_err(){ local out; out=$(sendfile "$2"); if echo "$out" | grep -q "$3"; then ok "$1"; else bad "$1 :: $out"; fi; }
allok(){ local out; out=$(psql "$DB" -Atqc "$(cat "$2")" 2>&1 | grep -v '^SET$'); if [ -n "$out" ] && ! echo "$out" | grep -qv '|t$'; then ok "$1"; else bad "$1 :: $(echo "$out" | grep -v '|t$')"; fi; }

psql "$ADMIN" -qc "DROP DATABASE IF EXISTS postgres WITH (FORCE)" >/dev/null; psql "$ADMIN" -qc "CREATE DATABASE postgres" >/dev/null
psql "$DB" -v ON_ERROR_STOP=1 -q -f "$PKG/test/stub-baseline.sql" >/dev/null || { echo "stub failed"; exit 1; }
(cd "$PKG/../.." && python3 -I proposed/application-resume-0023/src/build.py --check) && ok "build reproduces every artifact" || bad "build --check"
(cd "$PKG" && sha256sum -c --quiet SHA256SUMS) && ok "SHA256SUMS" || bad "SHA256SUMS"

SYS=$(q "SELECT system_identifier FROM pg_control_system()")
J=$(q "SELECT md5((SELECT jsonb_agg(to_jsonb(j) ORDER BY id) FROM (SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id LIMIT 23) j)::text)")
P=$(q "SELECT md5(string_agg(concat_ws('|', schemaname, tablename, policyname, permissive, roles::text, cmd, qual, with_check), E'\n' ORDER BY policyname)) FROM pg_policies WHERE policyname LIKE 'coordinator_%'")
T=$(mktemp -d)
loc(){ sed -e "s/7642734024280108049/$SYS/g" -e "s/5cfa7e88ccac860637339bd9bdaab72c/$J/g" -e "s/d33877618a9f40924d14e49b6653d7fa/$P/g" "$1" > "$T/$2"; }
for f in application_resume_0023_v1.sql rollback.sql preflight-readonly.sql verify-after-readonly.sql; do loc "$PKG/$f" "$f"; done

out=$(psql "$DB" -Atqc "$(cat "$PKG/preflight-readonly.sql")" | grep -v '|t$' | cut -d'|' -f1 | sort | tr '\n' ' ')
[ "$out" = "drizzle.first_23_receipts_md5 security_0031.policies_md5 target.system_identifier " ] && ok "real preflight: only the three production-pinned rows differ locally" || bad "real preflight :: $out"
allok "local preflight all ok" "$T/preflight-readonly.sql"
expect_err "real request refuses this (non-production) target" "$PKG/request-application-resume-0023.sql" "TARGET_MISMATCH"
{ cat "$PKG/request-application-resume-0023.sql"; echo "SELECT 1;"; } > "$T/tamper.sql"; expect_err "guard refuses trailing SQL" "$T/tamper.sql" "RRGUARD"
[ "$(q "SELECT to_regclass('public.application_recovery_attempts') IS NULL")" = t ] && ok "nothing left behind after refusals" || bad "leftover"
sed 's/ -- TEST_FAILURE_POINT.*/ RAISE EXCEPTION '"'"'INJECTED'"'"';/' "$T/application_resume_0023_v1.sql" > "$T/inject.sql"
expect_err "injected failure after DDL" "$T/inject.sql" "INJECTED"
[ "$(q "SELECT to_regclass('public.application_recovery_attempts') IS NULL AND to_regprocedure('public.reserve_application_recovery(uuid,text)') IS NULL")" = t ] && ok "injected failure rolled everything back" || bad "partial after injection"
q "UPDATE drizzle.__drizzle_migrations SET hash = 'x' WHERE id = 23" >/dev/null; expect_err "journal drift refused" "$T/application_resume_0023_v1.sql" "JOURNAL_DRIFT"
q "UPDATE drizzle.__drizzle_migrations SET hash = md5('23') WHERE id = 23" >/dev/null
q "ALTER TABLE public.applications DISABLE TRIGGER zz_application_write_guard" >/dev/null; expect_err "missing/disabled S1 refused" "$T/application_resume_0023_v1.sql" "S1_GUARD_MISSING"
q "ALTER TABLE public.applications ENABLE TRIGGER zz_application_write_guard" >/dev/null
out=$(sendfile "$T/application_resume_0023_v1.sql"); [ -z "$(echo "$out" | grep -v '^OK$')" ] && ok "local copy installs" || bad "install :: $out"
allok "verify-after all ok" "$T/verify-after-readonly.sql"
[ "$(q "SELECT count(*) || ':' || bool_and(application_id = '00000000-0000-4000-8000-000000000001') FROM public.application_recovery_attempts")" = "1:true" ] && ok "backfill: only the send inside 24h (malformed and old skipped)" || bad "backfill"
[ "$(q "SELECT count(*) FROM public.application_resume_tokens")" = 0 ] && [ "$(q "SELECT count(*) FROM drizzle.__drizzle_migrations")" = 23 ] && ok "tokens and drizzle ledger untouched" || bad "tokens/ledger"
expect_err "replay refused" "$T/application_resume_0023_v1.sql" "AR23_EVIDENCE_REPLAY"
H=$(printf 'a%.0s' {1..64})
r=$(q "SET ROLE service_role; SELECT set_config('request.jwt.claim.role','service_role',false); SELECT public.reserve_application_recovery('00000000-0000-4000-8000-000000000004', '$H')->>'reserved'" | tail -1)
r2=$(q "SET ROLE service_role; SELECT set_config('request.jwt.claim.role','service_role',false); SELECT public.reserve_application_recovery('00000000-0000-4000-8000-000000000004', '$(printf 'b%.0s' {1..64})')->>'reserved'" | tail -1)
[ "$r:$r2" = "true:false" ] && ok "reserve then cooldown refusal" || bad "reserve :: $r $r2"
r=$(q "SET ROLE service_role; SELECT set_config('request.jwt.claim.role','service_role',false); SELECT public.reserve_application_recovery('00000000-0000-4000-8000-000000000001', '$(printf 'c%.0s' {1..64})')->>'reserved'" | tail -1)
[ "$r" = false ] && ok "backfilled send keeps the cooldown" || bad "backfill cooldown :: $r"
A=$(q "SELECT id FROM public.application_recovery_attempts WHERE token_id IS NOT NULL")
q "SET ROLE service_role; SELECT set_config('request.jwt.claim.role','service_role',false); SELECT public.finish_application_recovery('$A', 'failed')" >/dev/null
[ "$(q "SELECT (revoked_at IS NOT NULL) FROM public.application_resume_tokens")" = t ] && ok "failed delivery revokes only the recovery token" || bad "finish"
out=$(q "SET ROLE anon; SELECT public.reserve_application_recovery('00000000-0000-4000-8000-000000000004', '$H')"); echo "$out" | grep -q "permission denied" && ok "anon cannot execute reserve" || bad "anon reserve :: $out"
out=$(q "SET ROLE authenticated; SELECT count(*) FROM public.application_recovery_attempts"); echo "$out" | grep -q "permission denied" && ok "authenticated cannot read attempts" || bad "auth read :: $out"
out=$(q "SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000aa',false); SELECT public.resolve_application_identity_review('00000000-0000-4000-8000-0000000000b1','same_person','checked id')->>'changed'" | tail -1)
[ "$out" = true ] && [ "$(q "SELECT count(*) FROM public.audit_log WHERE action = 'identity_review.resolved'")" = 1 ] && ok "manager resolves review with one audit row" || bad "resolve :: $out"
out=$(q "SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000bb',false); SELECT public.resolve_application_identity_review('00000000-0000-4000-8000-0000000000b1','same_person','checked id')"); echo "$out" | grep -q Forbidden && ok "non-manager refused" || bad "non-manager :: $out"
expect_err "real rollback request refuses this target" "$PKG/request-rollback-application-resume-0023.sql" "TARGET_MISMATCH"
out=$(sendfile "$T/rollback.sql"); [ -z "$(echo "$out" | grep -v '^OK$')" ] && ok "local rollback" || bad "rollback :: $out"
[ "$(q "SELECT to_regclass('public.application_recovery_attempts') IS NULL AND count(*) = 2 FROM public.audit_log WHERE entity_id LIKE 'application_resume_0023_v1%'")" = t ] && ok "rollback removed exactly 0023 objects; both evidence rows kept" || bad "after rollback"
[ "$(q "SELECT count(*) FROM public.application_resume_tokens")" = 1 ] && [ "$(q "SELECT count(*) FROM pg_trigger WHERE tgname='zz_application_write_guard'")" = 1 ] && ok "tokens and S1 kept after rollback" || bad "kept"
expect_err "rollback replay refused" "$T/rollback.sql" "AR23_ROLLBACK_REPLAY"
rm -rf "$T"; psql "$ADMIN" -qc "SELECT 1" >/dev/null
echo "$pass passed, $fail failed"; [ $fail = 0 ]
