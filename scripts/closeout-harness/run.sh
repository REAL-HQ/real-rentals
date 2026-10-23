#!/usr/bin/env bash
# Behavioural evidence for proposed/end-rental-returns-approved-v2.sql (Option B:
# a rental that ends successfully returns the renter to Approved).
#
# scripts/end-rental-preserves-application.test.mjs compares the proposal's TEXT
# against the migration file. This runs the real functions against a throwaway
# PostgreSQL and checks what they actually DO, including the live
# application_active_guard and the real re-rental precondition.
# Nothing here touches a hosted database.
#
# Usage: scripts/closeout-harness/run.sh <datadir> <port>
set -uo pipefail
DATA="${1:?datadir}"; PORT="${2:?port}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
Q() { psql -h 127.0.0.1 -p "$PORT" -U postgres -d harness -v ON_ERROR_STOP=1 -tAq "$@"; }

fails=0
ok()  { echo "  ok    $1"; }
bad() { echo "  FAIL  $1"; fails=$((fails+1)); }
is()  { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (want '$3', got '$2')"; fi; }

# Refuse to report results we cannot trust. A dead cluster must abort the run,
# never surface as a row of failed assertions that look like findings.
if ! psql -h 127.0.0.1 -p "$PORT" -U postgres -tAqc "select 1" >/dev/null 2>&1; then
  echo "closeout harness: no PostgreSQL on 127.0.0.1:$PORT — nothing was tested." >&2
  exit 2
fi
# Every Q must reach the server. If the cluster dies mid-run, stop immediately
# rather than letting empty output be compared against expected values.
Q() {
  local out rc
  out="$(psql -h 127.0.0.1 -p "$PORT" -U postgres -d harness -v ON_ERROR_STOP=1 -tAq "$@" 2>&1)"; rc=$?
  if printf '%s' "$out" | grep -q 'could not connect\|Connection refused\|server closed the connection\|terminating connection'; then
    echo "closeout harness: lost the cluster mid-run — results are void." >&2
    exit 2
  fi
  printf '%s' "$out"
  return $rc
}

psql -h 127.0.0.1 -p "$PORT" -U postgres -tAqc "drop database if exists harness" >/dev/null
psql -h 127.0.0.1 -p "$PORT" -U postgres -tAqc "create database harness" >/dev/null
Q -f "$ROOT/scripts/closeout-harness/schema.sql" >/dev/null

INSTALLED_MIG="$ROOT/supabase/migrations/20261006112250_6c73a4f7-a851-44fd-bdf1-f8fc85906eda.sql"
PROPOSAL="$ROOT/proposed/end-rental-returns-approved-v2.sql"
python3 -I - "$INSTALLED_MIG" "$PROPOSAL" "$DATA" <<'PY'
import re, sys
mig, prop, out = sys.argv[1], sys.argv[2], sys.argv[3]
pat = re.compile(r"CREATE(?: OR REPLACE)? FUNCTION public\.end_rental_tx\([\s\S]*?END \$function\$;")
text = open(prop).read()
open(f"{out}/installed_fn.sql","w").write(pat.search(open(mig).read()).group(0))
open(f"{out}/forward_fn.sql","w").write(pat.search(text[:text.index("-- ROLLBACK")]).group(0))
rb = text[text.index("-- ROLLBACK"):]
code = "\n".join(l[3:] if l.startswith("-- ") else (l[2:] if l.startswith("--") else l)
                 for l in rb.splitlines())
open(f"{out}/rollback_fn.sql","w").write(pat.search(code).group(0))
PY

APP=22222222-2222-4222-8222-222222222222
RENTAL=33333333-3333-4333-8333-333333333333

seed() {  # $1 = application status while the rental runs
  Q <<SQL >/dev/null
TRUNCATE public.rentals, public.applications, public.vehicles,
         public.odometer_readings, public.automation_enrollments;
INSERT INTO public.vehicles VALUES ('11111111-1111-4111-8111-111111111111','rented');
-- 'approved' first, then flip: the guard refuses 'active' before a rental
-- exists, which is exactly how activate_rental_tx has to do it too.
INSERT INTO public.applications (id,status,notes)
  VALUES ('$APP','approved','vetting notes');
INSERT INTO public.rentals (id,vehicle_id,driver_id,application_id,status)
  VALUES ('$RENTAL','11111111-1111-4111-8111-111111111111',
          '44444444-4444-4444-8444-444444444444','$APP','active');
UPDATE public.applications SET status='$1' WHERE id='$APP';
INSERT INTO public.automation_enrollments (application_id,status)
  VALUES ('$APP','active');
SQL
}
endit()    { Q -c "SELECT public.end_rental_tx('$RENTAL','2026-10-23','available',NULL,NULL)"; }
appstatus(){ Q -c "SELECT status FROM public.applications WHERE id='$APP'"; }
# The real precondition from activate_rental_tx: status NOT IN ('approved','active')
# raises not_approved. This is what decides whether the driver can rent again.
canrent()  { Q -c "SELECT (status IN ('approved','active')) FROM public.applications WHERE id='$APP'"; }

echo "A. installed function (control: it closes the application)"
Q -f "$DATA/installed_fn.sql" >/dev/null
seed active
is "end_rental_tx returns closed"       "$(endit)" "closed"
is "application is CLOSED today"        "$(appstatus)" "closed"
is "and today the driver CANNOT re-rent" "$(canrent)" "f"

echo "B. proposed v2 — Option B"
Q -f "$DATA/forward_fn.sql" >/dev/null
seed active
is "end_rental_tx returns closed"        "$(endit)" "closed"
is "application RETURNS TO APPROVED"     "$(appstatus)" "approved"
is "the driver CAN re-rent"              "$(canrent)" "t"
is "rental is closed"        "$(Q -c "SELECT status FROM public.rentals WHERE id='$RENTAL'")" "closed"
is "rental end_date is set"  "$(Q -c "SELECT end_date FROM public.rentals WHERE id='$RENTAL'")" "2026-10-23"
is "autopay is off"          "$(Q -c "SELECT autopay_active FROM public.rentals WHERE id='$RENTAL'")" "f"
is "vehicle is available"    "$(Q -c "SELECT status FROM public.vehicles")" "available"
is "automation is cancelled" "$(Q -c "SELECT status FROM public.automation_enrollments")" "cancelled"
is "cancel reason kept"      "$(Q -c "SELECT cancelled_reason FROM public.automation_enrollments")" "rental ended"
is "vetting notes untouched" "$(Q -c "SELECT notes FROM public.applications")" "vetting notes"
is "rental history kept"     "$(Q -c "SELECT count(*) FROM public.rentals WHERE application_id='$APP'")" "1"
is "odometer history kept"   "$(Q -c "SELECT count(*) FROM public.odometer_readings")" "0"

echo "C. eligibility decisions made during the rental are NOT overwritten"
#  The whole point of `AND status = 'active'`. Without it, returning a car
#  would silently clear a suspension.
for s in suspended declined closed reviewing; do
  seed "$s" 2>/dev/null || true
  # the guard blocks 'active' -> these are set directly, which is allowed
  Q -c "UPDATE public.applications SET status='$s' WHERE id='$APP'" >/dev/null
  endit >/dev/null
  is "a '$s' driver stays '$s' after the rental ends" "$(appstatus)" "$s"
done

echo "D. the active guard"
seed active; endit >/dev/null
is "application is approved, no running rental" "$(appstatus)" "approved"
err=$(Q -c "UPDATE public.applications SET status='active' WHERE id='$APP'")
case "$err" in *active_requires_running_rental*) ok "cannot hand-edit back to Active with no rental" ;;
  *) bad "a person could set Active with no rental (got: ${err:-no error})" ;; esac
err=$(Q -c "INSERT INTO public.applications (id,status) VALUES ('55555555-5555-4555-8555-555555555555','active')")
case "$err" in *active_requires_running_rental*) ok "guard still refuses a new Active with no rental" ;;
  *) bad "guard did NOT fire — section D is vacuous (got: ${err:-no error})" ;; esac

echo "E. Active is derived, so the driver leaves the Active list either way"
is "no active rental remains for this application" \
   "$(Q -c "SELECT count(*) FROM public.rentals WHERE application_id='$APP' AND status='active'")" "0"

echo "F. rollback restores today's behaviour"
Q -f "$DATA/rollback_fn.sql" >/dev/null
seed active
endit >/dev/null
is "application closes again after rollback" "$(appstatus)" "closed"

echo
if [ "$fails" = 0 ]; then echo "closeout harness: all checks passed"; else echo "closeout harness: $fails FAILED"; fi
exit "$fails"
