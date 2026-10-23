#!/bin/bash
# Local M3 install, verify, and schema-dump rollback.
# Clones postgresql://postgres@127.0.0.1:55442/m2 into m3_rehearsal,
# proves the packet there, and drops m3_rehearsal. It does not write m2
# and it does not connect to a hosted database.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ADMIN="postgresql://postgres@127.0.0.1:55442/postgres?sslmode=disable"
DUMPS="${M3_DUMP_DIR:-/tmp/m3-dumps}"
LOG="${M3_PROOF_LOG:-/tmp/m3-proof-run.log}"
BUN="${BUN:-$(command -v bun || true)}"
if [[ -z "$BUN" && -x "$HOME/.bun/bin/bun" ]]; then
  BUN="$HOME/.bun/bin/bun"
fi
mkdir -p "$DUMPS"
: > "$LOG"
OWN_SCRATCH=0
PGURL="${M3_DATABASE_URL:-}"

case "${PGURL:-local}" in
  local|*127.0.0.1*|*localhost*|*\[::1\]*) ;;
  *) echo "refusing non-local database" | tee -a "$LOG"; exit 1 ;;
esac
if [[ "$PGURL" == *supabase.co* || "$PGURL" == *amazonaws.com* ]]; then
  echo "refusing hosted database" | tee -a "$LOG"
  exit 1
fi
db="${PGURL##*/}"
db="${db%%\?*}"
if [[ "$db" == "m2" ]]; then
  echo "refusing to write the shared m2 database" | tee -a "$LOG"
  exit 1
fi

READER_ROLE="m3_preflight_reader"
READER_URL=""
if [[ -z "$PGURL" ]]; then
  OWN_SCRATCH=1
  PGURL="postgresql://postgres@127.0.0.1:55442/m3_rehearsal?sslmode=disable"
  busy="$(psql "$ADMIN" -At -c "SELECT count(*) FROM pg_stat_activity WHERE datname = 'm2'")"
  if [[ "$busy" != "0" ]]; then
    echo "refusing to clone m2 while other sessions are connected" | tee -a "$LOG"
    exit 1
  fi
  psql "$ADMIN" -v ON_ERROR_STOP=1 -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'm3_rehearsal' AND pid <> pg_backend_pid();" >>"$LOG" 2>&1 || true
  psql "$ADMIN" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS m3_rehearsal;" >>"$LOG" 2>&1
  psql "$ADMIN" -v ON_ERROR_STOP=1 -c "CREATE DATABASE m3_rehearsal TEMPLATE m2;" >>"$LOG" 2>&1
  psql "$ADMIN" -v ON_ERROR_STOP=1 -c "DROP ROLE IF EXISTS ${READER_ROLE};" >>"$LOG" 2>&1
  psql "$ADMIN" -v ON_ERROR_STOP=1 -c "CREATE ROLE ${READER_ROLE} LOGIN PASSWORD 'readerpass' NOSUPERUSER NOCREATEDB NOCREATEROLE; GRANT pg_read_all_data TO ${READER_ROLE};" >>"$LOG" 2>&1
  READER_URL="postgresql://${READER_ROLE}:readerpass@127.0.0.1:55442/m3_rehearsal?sslmode=disable"
  echo "scratch database m3_rehearsal cloned from local m2" | tee -a "$LOG"
fi

psqlq() { psql "$PGURL" -v ON_ERROR_STOP=1 "$@"; }

cleanup() {
  psql "$PGURL" -v ON_ERROR_STOP=1 -c "DELETE FROM public.waitlist WHERE email ILIKE 'm3-proof-%@example.test';" >>"$LOG" 2>&1 || true
  psql "$PGURL" -v ON_ERROR_STOP=1 -f "$ROOT/proposed/m3-rollback/02-waitlist-coming-soon-rate.sql" >>"$LOG" 2>&1 || true
  if [[ "$OWN_SCRATCH" == 1 ]]; then
    psql "$ADMIN" -v ON_ERROR_STOP=1 -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'm3_rehearsal' AND pid <> pg_backend_pid();" >>"$LOG" 2>&1 || true
    psql "$ADMIN" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS m3_rehearsal;" >>"$LOG" 2>&1 || true
    psql "$ADMIN" -v ON_ERROR_STOP=1 -c "DROP ROLE IF EXISTS ${READER_ROLE};" >>"$LOG" 2>&1 || true
    echo "dropped scratch database m3_rehearsal" | tee -a "$LOG"
  fi
}
trap cleanup EXIT

dump_schema() {
  local out="$1"
  pg_dump --schema-only --no-owner "$PGURL" \
    | grep -vE '^\\restrict |^\\unrestrict |^-- Dumped from |^-- Dumped by ' \
    > "$out"
}

acl_snapshot() {
  psqlq -At -F $'\t' -c "
    SELECT 'relacl', c.oid::regclass::text, COALESCE(c.relacl::text, '')
    FROM pg_class c
    WHERE c.oid IN ('public.applications'::regclass, 'public.waitlist'::regclass)
    UNION ALL
    SELECT 'attacl', a.attrelid::regclass::text || '.' || a.attname, COALESCE(a.attacl::text, '')
    FROM pg_attribute a
    WHERE a.attrelid = 'public.waitlist'::regclass
      AND a.attnum > 0
      AND NOT a.attisdropped
    ORDER BY 1, 2;
  "
}

require_preflight() {
  local text
  if [[ -z "$BUN" ]]; then
    echo "bun is required for the read-only preflight" | tee -a "$LOG"
    exit 1
  fi
  local url="${READER_URL:-$PGURL}" status
  set +e
  text="$("$BUN" "$ROOT/scripts/m3-hosted-preflight.ts" --url "$url" 2>&1)"
  status=$?
  set -e
  printf '%s\n' "$text" | tee -a "$LOG"
  if [[ "$status" -ne 0 ]]; then
    echo "preflight failed" | tee -a "$LOG"
    exit 1
  fi
  if ! printf '%s\n' "$text" | grep -q 'checklist stops=0 checks=19'; then
    echo "preflight failed" | tee -a "$LOG"
    exit 1
  fi
}

verify_file() {
  local file="$1" result
  result="$(psqlq -At -f "$ROOT/$file" | tail -n 1)"
  echo "VERIFY $file $result" | tee -a "$LOG"
  if [[ "$result" != "t" ]]; then
    echo "verify failed: $file" | tee -a "$LOG"
    exit 1
  fi
}

echo "CITATIONS" | tee -a "$LOG"
node "$ROOT/scripts/m3-step-citations.test.mjs" | tee -a "$LOG"

echo "CATALOG WRITE GUARD" | tee -a "$LOG"
guard_hits="$(
  find "$ROOT/proposed/m3" "$ROOT/proposed/m3-packet" "$ROOT/proposed/m3-verify" "$ROOT/proposed/m3-rollback" -type f -print0 |
    xargs -0 perl -ne '
      s/--.*$//;
      next if /^\s*$/;
      if (/\b(?:UPDATE|DELETE\s+FROM|INSERT\s+INTO)\s+(?:pg_catalog\.)?pg_[a-z0-9_]+\b/i
          || /\b(?:nspacl|attacl|proacl|relacl)\s*=/) {
        print "$ARGV:$.:$_";
      }
    '
)"
if [[ -n "$guard_hits" ]]; then
  echo "catalog write guard: FAIL" | tee -a "$LOG"
  echo "$guard_hits" | tee -a "$LOG"
  exit 1
fi
echo "catalog write guard: clean" | tee -a "$LOG"

echo "PREFLIGHT" | tee -a "$LOG"
require_preflight

echo "DUMP baseline" | tee -a "$LOG"
dump_schema "$DUMPS/baseline.sql"
acl_snapshot > "$DUMPS/acl-baseline.txt"
apps_before="$(psqlq -At -c "SELECT count(*) FROM public.applications")"
wait_before="$(psqlq -At -c "SELECT count(*) FROM public.waitlist")"
echo "counts before applications=$apps_before waitlist=$wait_before" | tee -a "$LOG"

echo "TNC FILE REFUSES" | tee -a "$LOG"
set +e
psqlq -f "$ROOT/proposed/m3-packet/01-tnc-approval-expiry.sql" >>"$LOG" 2>&1
tnc_status=$?
set -e
if [[ "$tnc_status" -eq 0 ]]; then
  echo "TNC file committed" | tee -a "$LOG"
  exit 1
fi
if ! grep -q 'tnc_install_is_pull_request_226' "$LOG"; then
  echo "TNC file failed for a different reason" | tee -a "$LOG"
  exit 1
fi
echo "TNC file refused" | tee -a "$LOG"

echo "INSTALL step 2" | tee -a "$LOG"
psqlq -f "$ROOT/proposed/m3-packet/02-waitlist-coming-soon-rate.sql" >>"$LOG" 2>&1
verify_file "proposed/m3-verify/02-waitlist-coming-soon-rate.sql"
echo "INSTALL step 2 again" | tee -a "$LOG"
psqlq -f "$ROOT/proposed/m3-packet/02-waitlist-coming-soon-rate.sql" >>"$LOG" 2>&1
verify_file "proposed/m3-verify/02-waitlist-coming-soon-rate.sql"
wait_after="$(psqlq -At -c "SELECT count(*) FROM public.waitlist")"
if [[ "$wait_after" != "$wait_before" ]]; then
  echo "waitlist count changed from $wait_before to $wait_after" | tee -a "$LOG"
  exit 1
fi
acl_snapshot > "$DUMPS/acl-installed.txt"
if ! cmp -s "$DUMPS/acl-baseline.txt" "$DUMPS/acl-installed.txt"; then
  echo "ACL changed during install" | tee -a "$LOG"
  diff -u "$DUMPS/acl-baseline.txt" "$DUMPS/acl-installed.txt" | head -80 | tee -a "$LOG"
  exit 1
fi
echo "ACL unchanged" | tee -a "$LOG"

echo "RATE PROOF" | tee -a "$LOG"
psqlq -f "$ROOT/scripts/m3-rate-proof.sql" >>"$LOG" 2>&1
left="$(psqlq -At -c "SELECT count(*) FROM public.waitlist WHERE email ILIKE 'm3-proof-%@example.test'")"
echo "rate proof rows=$left" | tee -a "$LOG"
if [[ "$left" != "0" ]]; then
  echo "rate proof left rows behind" | tee -a "$LOG"
  exit 1
fi

echo "ROLLBACK step 2" | tee -a "$LOG"
psqlq -f "$ROOT/proposed/m3-rollback/02-waitlist-coming-soon-rate.sql" >>"$LOG" 2>&1
dump_schema "$DUMPS/after-step2.sql"
if ! cmp -s "$DUMPS/baseline.sql" "$DUMPS/after-step2.sql"; then
  echo "MISMATCH step 2 rollback" | tee -a "$LOG"
  diff -u "$DUMPS/baseline.sql" "$DUMPS/after-step2.sql" | head -120 | tee -a "$LOG"
  exit 1
fi
echo "MATCH step 2 rollback" | tee -a "$LOG"
set +e
psqlq -f "$ROOT/proposed/m3-rollback/01-tnc-approval-expiry.sql" >>"$LOG" 2>&1
tnc_undo=$?
set -e
if [[ "$tnc_undo" -eq 0 ]]; then
  echo "TNC rollback committed" | tee -a "$LOG"
  exit 1
fi
if ! grep -q 'tnc_rollback_is_pull_request_226' "$LOG"; then
  echo "TNC rollback failed for a different reason" | tee -a "$LOG"
  exit 1
fi
echo "TNC rollback refused" | tee -a "$LOG"
acl_snapshot > "$DUMPS/acl-after.txt"
if ! cmp -s "$DUMPS/acl-baseline.txt" "$DUMPS/acl-after.txt"; then
  echo "ACL mismatch after rollback" | tee -a "$LOG"
  diff -u "$DUMPS/acl-baseline.txt" "$DUMPS/acl-after.txt" | head -80 | tee -a "$LOG"
  exit 1
fi

echo "PREFLIGHT after rollback" | tee -a "$LOG"
require_preflight
echo "PROOF_EXIT:0" | tee -a "$LOG"
