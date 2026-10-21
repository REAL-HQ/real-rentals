#!/bin/bash
# Local M2 install, functional proof, and per-step privilege rollback.
# Talks only to postgresql://postgres@127.0.0.1:55442/m2.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGURL="${M2_DATABASE_URL:-postgresql://postgres@127.0.0.1:55442/m2?sslmode=disable}"
export M2_DATABASE_URL="$PGURL"
DUMPS="${M2_DUMP_DIR:-/tmp/m2-privilege-dumps}"
LOG="${M2_PROOF_LOG:-/tmp/m2-proof-run.log}"
mkdir -p "$DUMPS"
: > "$LOG"

psqlq() { psql "$PGURL" -v ON_ERROR_STOP=1 -q "$@"; }

dump_schema() {
  local out="$1"
  pg_dump --schema-only --no-owner "$PGURL" \
    | grep -vE '^\\restrict |^\\unrestrict |^-- Dumped from |^-- Dumped by ' \
    > "$out"
}

apply_packet() {
  echo "INSTALL packet $1" | tee -a "$LOG"
  psqlq -1 -f "$ROOT/proposed/m2-packet/$1" >>"$LOG" 2>&1
}

apply_own() {
  echo "INSTALL own $1" | tee -a "$LOG"
  psqlq -f "$ROOT/proposed/m2-with-approval-boundary/$1" >>"$LOG" 2>&1
}

snap() {
  echo "DUMP $1" | tee -a "$LOG"
  dump_schema "$DUMPS/$1.sql"
}

rollback_to() {
  local file="$1" expect="$2"
  echo "ROLLBACK $file -> $expect" | tee -a "$LOG"
  psqlq -f "$ROOT/proposed/rollback/$file" >>"$LOG" 2>&1
  dump_schema "$DUMPS/after-$file"
  if ! cmp -s "$DUMPS/$expect.sql" "$DUMPS/after-$file"; then
    echo "MISMATCH $file vs $expect" | tee -a "$LOG"
    diff -u "$DUMPS/$expect.sql" "$DUMPS/after-$file" | head -120 | tee -a "$LOG"
    exit 1
  fi
  echo "MATCH $file" | tee -a "$LOG"
}

echo "BASELINE" | tee -a "$LOG"
snap baseline

apply_packet 01.sql; snap inst-01
apply_own 00-approval-boundary.sql; snap inst-00
for n in 02 03 04 05 06; do apply_packet "$n.sql"; snap "inst-$n"; done
apply_own 06b-approval-identity-check.sql; snap inst-06b
for n in 07 08 09 10; do apply_packet "$n.sql"; snap "inst-$n"; done
apply_own 10b-approval-executor-writes.sql; snap inst-10b
for n in 11 12 13 14 15 16 17 18 19; do apply_packet "$n.sql"; snap "inst-$n"; done
apply_packet 19b.sql; snap inst-19b
apply_own 19c-agreement-contract.sql; snap inst-19c
apply_packet 20.sql; snap inst-20
apply_packet extend.sql; snap inst-extend
apply_packet return.sql; snap inst-return

echo "PROOF" | tee -a "$LOG"
if grep -Eq '[0-9a-fA-F]{64}' "$ROOT/scripts/m2-functional-proof.sql"; then
  echo "proof SQL contains a 64-hex literal" | tee -a "$LOG"
  exit 1
fi
psqlq -f "$ROOT/scripts/m2-functional-proof.sql" | tee -a "$LOG"
bun "$ROOT/scripts/m2-content-sha.test.ts" | tee -a "$LOG"

echo "06b REFUSAL" | tee -a "$LOG"
psqlq <<'SQL' >>"$LOG" 2>&1
INSERT INTO auth.users (id, email, email_confirmed_at)
VALUES ('12121212-1212-4121-8121-121212121212','fixture@example.test', now());
INSERT INTO public.applications (id, full_name, email, phone, status)
VALUES ('13131313-1313-4131-8131-131313131313','Fixture Driver','fixture@example.test','5550001111','reviewing');
SQL
psqlq <<'SQL' >>"$LOG" 2>&1
BEGIN;
SET LOCAL session_replication_role = replica;
INSERT INTO public.application_identity_reviews (
 id, application_id, kind, status, resolution, resolved_by, resolved_at, approval_evidence
) VALUES (
 '14141414-1414-4141-8141-141414141414',
 '13131313-1313-4131-8131-131313131313',
 'approval_identity','resolved','verified',
 '12121212-1212-4121-8121-121212121212',
 now(),
 jsonb_build_object(
  'application','13131313-1313-4131-8131-131313131313',
  'version', 1,
  'identity', jsonb_build_object('license_number','D1234567','license_expiration','2027-12-31'),
  'front', jsonb_build_object(
    'id','55555555-5555-4555-8555-555555555555','bucket','driver-docs','path','front.jpg',
    'sha256', encode(extensions.digest(convert_to('m2-fixture-front','UTF8'),'sha256'),'hex'),
    'reviewer','12121212-1212-4121-8121-121212121212','reviewed_at','2026-10-20T12:00:00Z',
    'object_version', jsonb_build_object(
      'bucket','driver-docs','path','front.jpg',
      'sha256', encode(extensions.digest(convert_to('m2-fixture-front','UTF8'),'sha256'),'hex'),
      'version','1')),
  'back', jsonb_build_object(
    'id','66666666-6666-4666-8666-666666666666','bucket','driver-docs','path','back.jpg',
    'sha256', encode(extensions.digest(convert_to('m2-fixture-back','UTF8'),'sha256'),'hex'),
    'reviewer','12121212-1212-4121-8121-121212121212','reviewed_at','2026-10-20T12:00:00Z',
    'object_version', jsonb_build_object(
      'bucket','driver-docs','path','back.jpg',
      'sha256', encode(extensions.digest(convert_to('m2-fixture-back','UTF8'),'sha256'),'hex'),
      'version','1')))
);
COMMIT;
SQL
set +e
psqlq -f "$ROOT/proposed/rollback/06b-approval-identity-check.sql" >>"$LOG" 2>&1
refuse_status=$?
set -e
if [[ "$refuse_status" -eq 0 ]]; then
  echo "06b rollback committed while a verified approval existed" | tee -a "$LOG"
  exit 1
fi
if ! grep -q '06b_rollback_unused_install_only' "$LOG"; then
  echo "06b rollback failed for a different reason" | tee -a "$LOG"
  exit 1
fi
echo "06b refusal pass" | tee -a "$LOG"
psqlq -c "SELECT pg_get_constraintdef(oid) LIKE '%approval_identity%' AS still_06b FROM pg_constraint WHERE conname='application_identity_reviews_resolution_check';" | tee -a "$LOG"
psqlq <<'SQL' >>"$LOG" 2>&1
BEGIN;
SET LOCAL session_replication_role = replica;
DELETE FROM public.application_identity_reviews WHERE id='14141414-1414-4141-8141-141414141414';
DELETE FROM public.applications WHERE id='13131313-1313-4131-8131-131313131313';
DELETE FROM auth.users WHERE id='12121212-1212-4121-8121-121212121212';
COMMIT;
SQL

rollback_to return-checklist.sql inst-extend
rollback_to extend-rental.sql inst-20
rollback_to 20-vehicle-swap.sql inst-19c
rollback_to 19c-agreement-contract.sql inst-19b
rollback_to 19b-agreement-evidence.sql inst-19
rollback_to 19-signed-archive-protection.sql inst-18
rollback_to 18-subscription-coordination.sql inst-17
rollback_to 17-storage-integrity.sql inst-16
rollback_to 16-closeout-scope.sql inst-15
rollback_to 15-consumption-scope.sql inst-14
rollback_to 14-issuer-identity-permissions.sql inst-13
rollback_to 13-closeout-projection.sql inst-12
rollback_to 12-deposit-nullability.sql inst-11
rollback_to 11-executor-permissions.sql inst-10b
rollback_to 10b-approval-executor-writes.sql inst-10
rollback_to 10-approval-permissions.sql inst-09
rollback_to 09-issuer-permissions.sql inst-08
rollback_to 08-evidence-recovery.sql inst-07
rollback_to 07-evidence-consumer.sql inst-06b
rollback_to 06b-approval-identity-check.sql inst-06
rollback_to 06-document-identity.sql inst-05
rollback_to 05-evidence.sql inst-04
rollback_to 04-closeout-legacy-guard.sql inst-03
rollback_to 03-record-rental.sql inst-02
rollback_to 02-safe-release.sql inst-00

echo "EXPORT" | tee -a "$LOG"
psqlq <<'SQL' >>"$LOG" 2>&1
INSERT INTO public.applications (id, full_name, email, phone, status)
VALUES ('15151515-1515-4151-8151-151515151515','Export Driver','export@example.test','5550002222','reviewing');
INSERT INTO private.approval_operations (operation_id, application_id, actor_id, evidence_version, requested_mode)
VALUES ('16161616-1616-4161-8161-161616161616','15151515-1515-4151-8151-151515151515','15151515-1515-4151-8151-151515151515', 0, 'approve_only');
SQL
psqlq -f "$ROOT/proposed/rollback/00-approval-data-export.sql" | tee "$DUMPS/export.out" | tee -a "$LOG"
if ! grep -q '16161616-1616-4161-8161-161616161616' "$DUMPS/export.out"; then
  echo "export did not emit the approval operation" | tee -a "$LOG"
  exit 1
fi
echo "export pass" | tee -a "$LOG"

rollback_to 00-approval-boundary.sql inst-01
psqlq -c "DELETE FROM public.applications WHERE id='15151515-1515-4151-8151-151515151515';" >>"$LOG" 2>&1
rollback_to 01-auth-binding.sql baseline

echo "FINAL COUNTS" | tee -a "$LOG"
psqlq -c "SELECT (SELECT count(*) FROM pg_roles WHERE rolname LIKE 'rr_%') AS rr_roles, (SELECT count(*) FROM public.applications) AS applications, (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private') AND p.proname LIKE '%approval%') AS approval_funcs;" | tee -a "$LOG"
echo "DONE" | tee -a "$LOG"
