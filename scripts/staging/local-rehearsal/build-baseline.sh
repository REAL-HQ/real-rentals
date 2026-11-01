#!/usr/bin/env bash
# LOCAL disposable rehearsal only (unix socket /tmp:55499). Builds the production-structure baseline per
# STAGING-BASELINE-PLAN: supabase migrations in order (duplicate 20260925093000 skipped), drizzle 0000-0022,
# then removes the documented exclusions (10 policies, 4 vehicles columns). Refuses prod/staging system ids.
set -uo pipefail; R="$(git rev-parse --show-toplevel)"; DB="${1:-rrbase}"
P="psql -h /tmp -p 55499 -U postgres -v ON_ERROR_STOP=1 -qAt"
$P -d template1 -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" -c "CREATE DATABASE $DB" >/dev/null 2>&1
S=$($P -d $DB -c "select system_identifier from pg_control_system()")
case "$S" in 7642734024280108049|7702070854497379551|7692130048193495360) echo REFUSED; exit 1;; esac
$P -d $DB -c "DO \$\$ BEGIN CREATE ROLE sandbox_exec LOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END \$\$" >/dev/null
for r in anon authenticated service_role authenticator supabase_admin postgres_role_dummy; do $P -d template1 -c "DO \$\$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='$r') THEN EXECUTE 'DROP OWNED BY $r'; END IF; END \$\$" -d $DB >/dev/null 2>&1; done
# Platform default privileges (Supabase + Lovable sandbox_exec), inferred from production ACL evidence:
# tables default ALL to anon/authenticated/service_role and SELECT,INSERT to sandbox_exec; functions EXECUTE to anon/authenticated/service_role.
$P -d $DB -c "ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role" -c "ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT, INSERT ON TABLES TO sandbox_exec" -c "ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role" -c "ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role" -c "GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, sandbox_exec" >/dev/null
for r in "anon nologin" "authenticated nologin" "service_role nologin bypassrls" "authenticator login noinherit" "supabase_admin" "postgres_role_dummy"; do
  $P -d $DB -c "DO \$\$ BEGIN CREATE ROLE $r; EXCEPTION WHEN duplicate_object THEN NULL; END \$\$" >/dev/null; done
$P -d $DB -c "grant anon, authenticated, service_role to authenticator" >/dev/null
grep -v -i '^create role\|^grant anon, authenticated' "$R/scripts/esign-harness/stubs.sql" | sed 's/^create role.*//' > /tmp/stubs.sql
$P -d $DB -f /tmp/stubs.sql >/tmp/stubs.log 2>&1 || { echo "stubs failed"; cat /tmp/stubs.log; exit 1; }
$P -d $DB -c "DROP FUNCTION IF EXISTS net.http_post(text,jsonb,jsonb,jsonb,int)" -c "ALTER DATABASE $DB SET search_path = \"\$user\", public, extensions" >/dev/null
$P -d $DB -c "ALTER ROLE service_role BYPASSRLS; CREATE SCHEMA IF NOT EXISTS supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations(version text primary key, statements text[], name text); CREATE SCHEMA IF NOT EXISTS drizzle; CREATE TABLE drizzle.__drizzle_migrations(id serial primary key, hash text not null, created_at bigint)" >/dev/null
n=0; FAILS=0
while read -r f; do n=$((n+1))
  F="$R/supabase/migrations/$f"; [[ $f == GAPFILL-* ]] && F="$R/scripts/staging/local-rehearsal/$f"
  if ! $P -d $DB -1 -f "$F" >/tmp/mig.log 2>&1; then echo "FAILED #$n $f :: $(grep -m1 ERROR /tmp/mig.log | sed 's/.*ERROR: *//' | cut -c1-110)"; FAILS=$((FAILS+1)); [[ "${STRICT:-1}" == 1 ]] && exit 2; fi
done < "$R/scripts/staging/local-rehearsal/supabase-order.txt"
echo "supabase migrations attempted: $n, failed: $FAILS"
for f in "$R"/drizzle/migrations/00{0,1}*.sql "$R"/drizzle/migrations/002[0-2]*.sql; do
  if ! $P -d $DB -1 -f "$f" >/tmp/mig.log 2>&1; then echo "FAILED drizzle $(basename $f)"; tail -5 /tmp/mig.log; exit 3; fi
done
$P -d $DB -f "$R/scripts/staging/local-rehearsal/prod-drizzle-ledger.sql" >/dev/null
echo "drizzle applied: $($P -d $DB -c 'select count(*) from drizzle.__drizzle_migrations')"
$P -d $DB -f "$R/scripts/staging/local-rehearsal/PRODDEF-3-functions.sql" >/dev/null && echo "production definitions applied (3 functions)"
$P -d $DB -f "$R/scripts/staging/local-rehearsal/exclusions.sql" && echo "exclusions removed"
