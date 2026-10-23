#!/usr/bin/env bash
# Can the authorized Supabase migration route install all five restrictive
# policies ATOMICALLY while satisfying the package's role, catalog and journal
# checks? Answered in a throwaway PostgreSQL, against a model of the production
# privilege shape. No hosted SQL, no production probe, no ownership or grant
# change anywhere near production.
#
# Usage: scripts/0031-feasibility/run.sh <port>
set -uo pipefail
PORT="${1:?port}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
D="$ROOT/scripts/0031-feasibility"

if ! psql -h 127.0.0.1 -p "$PORT" -U postgres -tAqc "select 1" >/dev/null 2>&1; then
  echo "0031 feasibility: no PostgreSQL on 127.0.0.1:$PORT — nothing was tested." >&2; exit 2
fi

fails=0
ok()  { echo "  ok    $1"; }
bad() { echo "  FAIL  $1"; fails=$((fails+1)); }

# Roles are cluster-global, so they are created once, before any scenario.
psql -h 127.0.0.1 -p "$PORT" -U postgres -tAq -f "$D/roles.sql" >/dev/null 2>&1

reset() {
  psql -h 127.0.0.1 -p "$PORT" -U postgres -tAqc "drop database if exists f0031" >/dev/null
  psql -h 127.0.0.1 -p "$PORT" -U postgres -tAqc "create database f0031" >/dev/null
  if ! psql -h 127.0.0.1 -p "$PORT" -U postgres -d f0031 -v ON_ERROR_STOP=1 -tAq \
       -f "$D/schema.sql" >/dev/null 2>&1; then
    echo "0031 feasibility: schema load failed — results would be meaningless." >&2; exit 2
  fi
  # Role MEMBERSHIPS are cluster-global and survive dropping the database, so a
  # grant made by one scenario leaked into the next run and made S1 install
  # successfully when it must not. Every scenario starts from the production
  # shape: the storage owner has no members.
  psql -h 127.0.0.1 -p "$PORT" -U postgres -tAqc "REVOKE storage_owner FROM app_exec" >/dev/null 2>&1
  local members
  members="$(psql -h 127.0.0.1 -p "$PORT" -U postgres -tAqc "select count(*) from pg_auth_members m join pg_roles r on r.oid=m.roleid where r.rolname='storage_owner'")"
  if [ "$members" != "0" ]; then
    echo "0031 feasibility: storage_owner still has $members member(s) — fixture is not the production shape." >&2; exit 2
  fi
  # A scenario that runs against a half-built database passes for the wrong
  # reason, so the fixture is asserted before every scenario, not assumed.
  local rls led
  rls="$(psql -h 127.0.0.1 -p "$PORT" -U postgres -d f0031 -tAqc "select count(*) from pg_class c join pg_namespace nn on nn.oid=c.relnamespace where c.relrowsecurity and ((nn.nspname='public' and c.relname in ('applications','application_identity_reviews','documents','agreements')) or (nn.nspname='storage' and c.relname='objects'))")"
  led="$(psql -h 127.0.0.1 -p "$PORT" -U postgres -d f0031 -tAqc "select count(*) from drizzle.__drizzle_migrations")"
  if [ "$rls" != "5" ] || [ "$led" != "23" ]; then
    echo "0031 feasibility: fixture wrong (rls=$rls ledger=$led) — aborting." >&2; exit 2
  fi
}
# $1 = login role, $2 = role the package expects
attempt() {
  psql -h 127.0.0.1 -p "$PORT" -U "$1" -d f0031 -tAq \
    -c "SELECT set_config('pkg.expected_role', '$2', false)" \
    -f "$D/package.sql" 2>&1
}
count_policies() {
  psql -h 127.0.0.1 -p "$PORT" -U postgres -d f0031 -tAqc \
    "select count(*) from pg_policies where policyname like 'coordinator_%'"
}
count_restrictive_storage() {
  psql -h 127.0.0.1 -p "$PORT" -U postgres -d f0031 -tAqc \
    "select count(*) from pg_policies where schemaname='storage' and tablename='objects' and permissive='RESTRICTIVE'"
}

echo "S1. executor = app_exec (production today: not superuser, NOT a member of the storage owner)"
reset
out="$(attempt app_exec app_exec)"
case "$out" in *"must be owner of table objects"*) ok "the storage policy is refused, as predicted" ;;
  *) bad "expected an ownership refusal; got: $(echo "$out" | head -2 | tr '\n' ' ')" ;; esac
n="$(count_policies)"
if [ "$n" = "0" ]; then ok "ATOMIC: all five rolled back together ($n policies left)"
else bad "NOT atomic — $n policies survived a failed install"; fi

echo
echo "S2. executor = app_exec, but a member of the storage owner (the 'privileges intact' case)"
reset
psql -h 127.0.0.1 -p "$PORT" -U postgres -d f0031 -tAqc "GRANT storage_owner TO app_exec" >/dev/null
out="$(attempt app_exec app_exec)"
case "$out" in *INSTALL_OK*) ok "all five policies install in one transaction" ;;
  *) bad "expected INSTALL_OK; got: $(echo "$out" | head -2 | tr '\n' ' ')" ;; esac
n="$(count_policies)"; [ "$n" = "5" ] && ok "all five present ($n)" || bad "expected 5 policies, found $n"
r="$(count_restrictive_storage)"; [ "$r" = "1" ] && ok "storage.objects restrictive count 0 -> 1" || bad "expected 1 restrictive storage policy, found $r"

echo
echo "S3. executor = super_exec, package still pinned to app_exec (the 'executor is not postgres' case)"
reset
out="$(attempt super_exec app_exec)"
case "$out" in *TARGET_MISMATCH*) ok "the role pin refuses it before any DDL" ;;
  *) bad "expected TARGET_MISMATCH; got: $(echo "$out" | head -2 | tr '\n' ' ')" ;; esac
n="$(count_policies)"; [ "$n" = "0" ] && ok "nothing installed ($n policies)" || bad "expected 0 policies, found $n"

echo
echo "S4. control: a superuser WITH a matching pin can install all five"
reset
out="$(attempt super_exec super_exec)"
case "$out" in *INSTALL_OK*) ok "superuser installs all five atomically" ;;
  *) bad "expected INSTALL_OK; got: $(echo "$out" | head -2 | tr '\n' ' ')" ;; esac
n="$(count_policies)"; [ "$n" = "5" ] && ok "all five present ($n)" || bad "expected 5, found $n"

echo
echo "S5. the journal pin: the Supabase route must leave the drizzle ledger at 23"
reset
psql -h 127.0.0.1 -p "$PORT" -U postgres -d f0031 -tAqc "GRANT storage_owner TO app_exec" >/dev/null
out="$(attempt app_exec app_exec)"
case "$out" in *INSTALL_OK*) ok "pin at 23 passes while the ledger holds 23 rows" ;;
  *) bad "expected INSTALL_OK at 23 rows; got: $(echo "$out" | head -2 | tr '\n' ' ')" ;; esac
# Now simulate 0023 landing first, which moves the ledger to 24.
reset
psql -h 127.0.0.1 -p "$PORT" -U postgres -d f0031 -tAqc "GRANT storage_owner TO app_exec" >/dev/null
psql -h 127.0.0.1 -p "$PORT" -U postgres -d f0031 -tAqc \
  "INSERT INTO drizzle.__drizzle_migrations VALUES (24,'h24',1792545492197)" >/dev/null
out="$(attempt app_exec app_exec)"
case "$out" in *JOURNAL_DRIFT_OR_REPLAY*) ok "applying 0023 first correctly breaks the pin" ;;
  *) bad "expected JOURNAL_DRIFT_OR_REPLAY at 24 rows; got: $(echo "$out" | head -2 | tr '\n' ' ')" ;; esac
n="$(count_policies)"; [ "$n" = "0" ] && ok "nothing installed ($n policies)" || bad "expected 0, found $n"

echo
echo "S6. rollback removes all five and leaves the ledger untouched"
reset
psql -h 127.0.0.1 -p "$PORT" -U postgres -d f0031 -tAqc "GRANT storage_owner TO app_exec" >/dev/null
out="$(attempt app_exec app_exec)"
if ! printf '%s' "$out" | grep -q INSTALL_OK; then
  bad "precondition failed, so the rollback checks are skipped rather than reported: $(echo "$out" | head -2 | tr '\n' ' ')"
  echo; echo "0031 feasibility: $fails FAILED"; exit "$fails"
fi
ok "precondition: the five policies installed"
psql -h 127.0.0.1 -p "$PORT" -U app_exec -d f0031 -v ON_ERROR_STOP=1 -tAq >/dev/null <<'SQL'
BEGIN;
DROP POLICY IF EXISTS coordinator_application_containment ON public.applications;
DROP POLICY IF EXISTS coordinator_review_containment      ON public.application_identity_reviews;
DROP POLICY IF EXISTS coordinator_document_containment    ON public.documents;
DROP POLICY IF EXISTS coordinator_agreement_containment   ON public.agreements;
DROP POLICY IF EXISTS coordinator_identity_storage_containment ON storage.objects;
COMMIT;
SQL
n="$(count_policies)"; [ "$n" = "0" ] && ok "rollback removed all five ($n left)" || bad "rollback left $n"
j="$(psql -h 127.0.0.1 -p "$PORT" -U postgres -d f0031 -tAqc "select count(*) from drizzle.__drizzle_migrations")"
[ "$j" = "23" ] && ok "drizzle ledger still 23 — the route never writes it" || bad "ledger moved to $j"
# RLS must be untouched by install and rollback alike.
e="$(psql -h 127.0.0.1 -p "$PORT" -U postgres -d f0031 -tAqc "select count(*) from pg_class c join pg_namespace nn on nn.oid=c.relnamespace where c.relrowsecurity and ((nn.nspname='public' and c.relname in ('applications','application_identity_reviews','documents','agreements')) or (nn.nspname='storage' and c.relname='objects'))")"
[ "$e" = "5" ] && ok "RLS still enabled on all five relations" || bad "expected RLS on 5 relations, found $e"

echo
if [ "$fails" = 0 ]; then echo "0031 feasibility: all checks passed"; else echo "0031 feasibility: $fails FAILED"; fi
exit "$fails"
