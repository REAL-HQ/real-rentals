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

cleanup_transport() {
  psql "$PGURL" -v ON_ERROR_STOP=1 -c "DROP ROLE IF EXISTS rr_evidence_transport;" >>"$LOG" 2>&1 || true
}
trap cleanup_transport EXIT

verify_step() {
  local n="$1"
  local tmp result
  tmp="$(mktemp)"
  python3 - "$ROOT/proposed/HOSTED-INSTALL.md" "$n" "$tmp" <<'PY'
import re, sys
from pathlib import Path
text = Path(sys.argv[1]).read_text()
n = sys.argv[2]
m = re.search(rf"### Step {n}\n\n```sql\n(.*?)```", text, re.S)
if not m:
    raise SystemExit(f"missing step {n} query")
Path(sys.argv[3]).write_text(m.group(1))
PY
  result="$(psqlq -At -f "$tmp" | tail -n 1)"
  rm -f "$tmp"
  echo "VERIFY step $n $result" | tee -a "$LOG"
  if [[ "$result" != "t" ]]; then
    echo "verify step $n failed" | tee -a "$LOG"
    exit 1
  fi
}

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

echo "CATALOG WRITE GUARD" | tee -a "$LOG"
guard_hits="$(
  find "$ROOT/proposed" -type f -print0 |
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

echo "STORAGE USER METADATA" | tee -a "$LOG"
psqlq -c "ALTER TABLE storage.objects ADD COLUMN IF NOT EXISTS user_metadata jsonb;" >>"$LOG" 2>&1
psqlq -c "ALTER TABLE storage.objects ADD COLUMN IF NOT EXISTS version text;" >>"$LOG" 2>&1

echo "PREFLIGHT" | tee -a "$LOG"
preflight_bad="$(psqlq -At -F '|' -f "$ROOT/proposed/m2-preflight.sql" | awk -F'|' '$4 != "t" { c++ } END { print c+0 }')"
preflight_rows="$(psqlq -At -F '|' -f "$ROOT/proposed/m2-preflight.sql" | awk -F'|' 'NF { c++ } END { print c+0 }')"
echo "preflight rows=$preflight_rows bad=$preflight_bad" | tee -a "$LOG"
if [[ "$preflight_bad" != "0" ]]; then
  psqlq -At -F '|' -f "$ROOT/proposed/m2-preflight.sql" | awk -F'|' '$4 != "t" { print }' | tee -a "$LOG"
  echo "preflight failed" | tee -a "$LOG"
  exit 1
fi
echo "preflight pass" | tee -a "$LOG"

echo "BASELINE" | tee -a "$LOG"
snap baseline

echo "APPROVE BEFORE INSTALL" | tee -a "$LOG"
psqlq -f "$ROOT/scripts/m2-approve-before.sql" | tee -a "$LOG"

apply_packet 01.sql; snap inst-01; verify_step 1
apply_own 00-approval-boundary.sql; snap inst-00; verify_step 2
step_n=3
for n in 02 03 04 05 06; do apply_packet "$n.sql"; snap "inst-$n"; verify_step "$step_n"; step_n=$((step_n+1)); done
apply_own 06b-approval-identity-check.sql; snap inst-06b; verify_step 8
step_n=9
for n in 07 08 09 10; do apply_packet "$n.sql"; snap "inst-$n"; verify_step "$step_n"; step_n=$((step_n+1)); done
apply_own 10b-approval-executor-writes.sql; snap inst-10b; verify_step 13
step_n=14
for n in 11 12 13 14 15 16 17 18 19; do apply_packet "$n.sql"; snap "inst-$n"; verify_step "$step_n"; step_n=$((step_n+1)); done
apply_packet 19b.sql; snap inst-19b; verify_step 23
apply_own 19c-agreement-contract.sql; snap inst-19c; verify_step 24
apply_packet 20.sql; snap inst-20; verify_step 25
apply_packet extend.sql; snap inst-extend; verify_step 26
apply_packet return.sql; snap inst-return; verify_step 27
apply_own record-uploaded-content-sha.sql; snap inst-sha; verify_step 28
apply_packet 21-revoke-executor-create.sql; snap inst-21; verify_step 29

echo "PROOF" | tee -a "$LOG"
if grep -Eq '[0-9a-fA-F]{64}' "$ROOT/scripts/m2-functional-proof.sql"; then
  echo "proof SQL contains a 64-hex literal" | tee -a "$LOG"
  exit 1
fi
psqlq -f "$ROOT/scripts/m2-functional-proof.sql" | tee -a "$LOG"

echo "REALISTIC APPROVE" | tee -a "$LOG"
if grep -Eq '[0-9a-fA-F]{64}' "$ROOT/scripts/m2-realistic-approve.sql" "$ROOT/proposed/backfill-document-content-sha.sql"; then
  echo "realistic approve SQL contains a 64-hex literal" | tee -a "$LOG"
  exit 1
fi
psqlq -f "$ROOT/scripts/m2-realistic-approve.sql" | tee -a "$LOG"

echo "19b REAPPLY GUARD" | tee -a "$LOG"
set +e
psqlq -1 -f "$ROOT/proposed/m2-packet/19b.sql" >>"$LOG" 2>&1
reapply_status=$?
set -e
if [[ "$reapply_status" -eq 0 ]]; then
  echo "19b reapply committed after agreement_evidence existed" | tee -a "$LOG"
  exit 1
fi
if ! grep -q 'agreement_evidence_already_installed' "$LOG"; then
  echo "19b reapply failed for a different reason" | tee -a "$LOG"
  exit 1
fi
still_definer="$(psqlq -At -c "SELECT prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname='record_agreement_evidence' AND p.pronargs=4;")"
if [[ "$still_definer" != "t" ]]; then
  echo "19b reapply replaced the 19c evidence function: $still_definer" | tee -a "$LOG"
  exit 1
fi
echo "19b reapply guard pass" | tee -a "$LOG"

bun "$ROOT/scripts/m2-content-sha.test.ts" | tee -a "$LOG"
bun "$ROOT/scripts/m2-approve-fallback.test.ts" | tee -a "$LOG"

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

rollback_to 21-revoke-executor-create.sql inst-sha
rollback_to record-uploaded-content-sha.sql inst-return
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
BEGIN;
SET LOCAL session_replication_role = replica;
INSERT INTO public.applications (id, full_name, email, phone, status, approval_evidence_version)
VALUES
 ('15151515-1515-4151-8151-151515151515','Export Driver','export@example.test','5550002222','reviewing', 1),
 ('19191919-1919-4191-8191-191919191919','Export Driver Two','export-two@example.test','5550003333','reviewing', 2);
INSERT INTO private.approval_operations (operation_id, application_id, actor_id, evidence_version, requested_mode)
VALUES
 ('16161616-1616-4161-8161-161616161616','15151515-1515-4151-8151-151515151515','15151515-1515-4151-8151-151515151515', 1, 'approve_only'),
 ('17171717-1717-4171-8171-171717171717','19191919-1919-4191-8191-191919191919','19191919-1919-4191-8191-191919191919', 2, 'approve_invite');
INSERT INTO public.application_identity_reviews (
 id, application_id, kind, status, resolution, resolved_by, resolved_at, approval_evidence
)
SELECT * FROM (
  SELECT
   '1a1a1a1a-1a1a-41a1-81a1-1a1a1a1a1a1a'::uuid AS id,
   '15151515-1515-4151-8151-151515151515'::uuid AS application_id,
   'approval_identity' AS kind, 'resolved' AS status, 'verified' AS resolution,
   '15151515-1515-4151-8151-151515151515'::uuid AS resolved_by,
   timestamptz '2026-10-20 12:00:00+00' AS resolved_at,
   jsonb_build_object(
    'application','15151515-1515-4151-8151-151515151515',
    'version', 1,
    'identity', jsonb_build_object('license_number','D1234567','license_expiration','2027-12-31'),
    'front', jsonb_build_object(
     'id','55555555-5555-4555-8555-555555555555','bucket','driver-docs','path','export-a-front.jpg',
     'sha256', encode(extensions.digest(convert_to('m2-export-a-front','UTF8'),'sha256'),'hex'),
     'reviewer','15151515-1515-4151-8151-151515151515','reviewed_at','2026-10-20T12:00:00Z',
     'object_version', jsonb_build_object(
      'bucket','driver-docs','path','export-a-front.jpg',
      'sha256', encode(extensions.digest(convert_to('m2-export-a-front','UTF8'),'sha256'),'hex'),
      'version','v1')),
    'back', jsonb_build_object(
     'id','66666666-6666-4666-8666-666666666666','bucket','driver-docs','path','export-a-back.jpg',
     'sha256', encode(extensions.digest(convert_to('m2-export-a-back','UTF8'),'sha256'),'hex'),
     'reviewer','15151515-1515-4151-8151-151515151515','reviewed_at','2026-10-20T12:00:00Z',
     'object_version', jsonb_build_object(
      'bucket','driver-docs','path','export-a-back.jpg',
      'sha256', encode(extensions.digest(convert_to('m2-export-a-back','UTF8'),'sha256'),'hex'),
      'version','v1'))
   ) AS approval_evidence
  UNION ALL
  SELECT
   '1b1b1b1b-1b1b-41b1-81b1-1b1b1b1b1b1b'::uuid,
   '19191919-1919-4191-8191-191919191919'::uuid,
   'approval_identity', 'resolved', 'verified',
   '19191919-1919-4191-8191-191919191919'::uuid,
   timestamptz '2026-10-20 12:05:00+00',
   jsonb_build_object(
    'application','19191919-1919-4191-8191-191919191919',
    'version', 2,
    'identity', jsonb_build_object('license_number','D7654321','license_expiration','2028-06-30'),
    'front', jsonb_build_object(
     'id','55555555-5555-4555-8555-555555555551','bucket','driver-docs','path','export-b-front.jpg',
     'sha256', encode(extensions.digest(convert_to('m2-export-b-front','UTF8'),'sha256'),'hex'),
     'reviewer','19191919-1919-4191-8191-191919191919','reviewed_at','2026-10-20T12:05:00Z',
     'object_version', jsonb_build_object(
      'bucket','driver-docs','path','export-b-front.jpg',
      'sha256', encode(extensions.digest(convert_to('m2-export-b-front','UTF8'),'sha256'),'hex'),
      'version','v1')),
    'back', jsonb_build_object(
     'id','66666666-6666-4666-8666-666666666661','bucket','driver-docs','path','export-b-back.jpg',
     'sha256', encode(extensions.digest(convert_to('m2-export-b-back','UTF8'),'sha256'),'hex'),
     'reviewer','19191919-1919-4191-8191-191919191919','reviewed_at','2026-10-20T12:05:00Z',
     'object_version', jsonb_build_object(
      'bucket','driver-docs','path','export-b-back.jpg',
      'sha256', encode(extensions.digest(convert_to('m2-export-b-back','UTF8'),'sha256'),'hex'),
      'version','v1'))
   )
) rows;
COMMIT;
SQL
psqlq -f "$ROOT/proposed/rollback/00-approval-data-export.sql" | tee "$DUMPS/export.out" | tee -a "$LOG"
for token in \
  16161616-1616-4161-8161-161616161616 \
  17171717-1717-4171-8171-171717171717 \
  1a1a1a1a-1a1a-41a1-81a1-1a1a1a1a1a1a \
  1b1b1b1b-1b1b-41b1-81b1-1b1b1b1b1b1b \
  15151515-1515-4151-8151-151515151515 \
  19191919-1919-4191-8191-191919191919
do
  if ! grep -q "$token" "$DUMPS/export.out"; then
    echo "export did not emit $token" | tee -a "$LOG"
    exit 1
  fi
done
echo "export pass" | tee -a "$LOG"

echo "00 REFUSAL" | tee -a "$LOG"
set +e
psqlq -f "$ROOT/proposed/rollback/00-approval-boundary.sql" >>"$LOG" 2>&1
refuse00_status=$?
set -e
if [[ "$refuse00_status" -eq 0 ]]; then
  echo "00 rollback committed while approval_identity rows existed" | tee -a "$LOG"
  exit 1
fi
if ! grep -q '00_rollback_unused_install_only' "$LOG"; then
  echo "00 rollback failed for a different reason" | tee -a "$LOG"
  exit 1
fi
echo "00 refusal pass" | tee -a "$LOG"
psqlq <<'SQL' >>"$LOG" 2>&1
BEGIN;
SET LOCAL session_replication_role = replica;
DELETE FROM public.application_identity_reviews
 WHERE id IN (
  '1a1a1a1a-1a1a-41a1-81a1-1a1a1a1a1a1a',
  '1b1b1b1b-1b1b-41b1-81b1-1b1b1b1b1b1b'
 );
COMMIT;
SQL

rollback_to 00-approval-boundary.sql inst-01
psqlq -c "DELETE FROM public.applications WHERE id IN ('15151515-1515-4151-8151-151515151515','19191919-1919-4191-8191-191919191919');" >>"$LOG" 2>&1
rollback_to 01-auth-binding.sql baseline

echo "FINAL COUNTS" | tee -a "$LOG"
psqlq -c "SELECT (SELECT count(*) FROM pg_roles WHERE rolname LIKE 'rr_%') AS rr_roles, (SELECT count(*) FROM public.applications) AS applications, (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private') AND p.proname LIKE '%approval%') AS approval_funcs;" | tee -a "$LOG"
echo "DONE" | tee -a "$LOG"
