#!/usr/bin/env bash
# Behavioural evidence for proposed/end-rental-preserves-application-v1.sql.
#
# scripts/end-rental-preserves-application.test.mjs compares the proposal's TEXT
# against the migration file. This runs both functions against a throwaway
# PostgreSQL and checks what they actually DO, including the live
# application_active_guard. Nothing here touches a hosted database.
#
# Usage: scripts/closeout-harness/run.sh <datadir> <port>
set -uo pipefail
DATA="${1:?datadir}"; PORT="${2:?port}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
Q() { psql -h 127.0.0.1 -p "$PORT" -U postgres -d harness -v ON_ERROR_STOP=1 -tAq "$@"; }

fails=0
ok()   { echo "  ok    $1"; }
bad()  { echo "  FAIL  $1"; fails=$((fails+1)); }
is()   { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (want '$3', got '$2')"; fi; }

psql -h 127.0.0.1 -p "$PORT" -U postgres -tAqc "drop database if exists harness" >/dev/null
psql -h 127.0.0.1 -p "$PORT" -U postgres -tAqc "create database harness" >/dev/null
Q -f "$ROOT/scripts/closeout-harness/schema.sql" >/dev/null

# The two function bodies, taken from the files under review.
INSTALLED_MIG="$ROOT/supabase/migrations/20261006112250_6c73a4f7-a851-44fd-bdf1-f8fc85906eda.sql"
PROPOSAL="$ROOT/proposed/end-rental-preserves-application-v1.sql"
python3 -I - "$INSTALLED_MIG" "$PROPOSAL" "$DATA" <<'PY'
import re, sys
mig, prop, out = sys.argv[1], sys.argv[2], sys.argv[3]
pat = re.compile(r"CREATE(?: OR REPLACE)? FUNCTION public\.end_rental_tx\([\s\S]*?END \$function\$;")
installed = pat.search(open(mig).read()).group(0)
forward = pat.search(open(prop).read()[:open(prop).read().index("-- ROLLBACK")]).group(0)
open(f"{out}/installed_fn.sql","w").write(installed)
open(f"{out}/forward_fn.sql","w").write(forward)
PY

seed() {  # $1 = application status to start from
  Q <<SQL >/dev/null
TRUNCATE public.rentals, public.applications, public.vehicles,
         public.odometer_readings, public.automation_enrollments;
INSERT INTO public.vehicles VALUES ('11111111-1111-4111-8111-111111111111','rented');
-- Insert as 'approved' then flip to 'active' once the rental exists, because the
-- guard refuses 'active' before there is a running rental. That is the real path.
INSERT INTO public.applications (id,status,notes)
  VALUES ('22222222-2222-4222-8222-222222222222','approved','keep me');
INSERT INTO public.rentals (id,vehicle_id,driver_id,application_id,status)
  VALUES ('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111',
          '44444444-4444-4444-8444-444444444444','22222222-2222-4222-8222-222222222222','active');
UPDATE public.applications SET status='$1' WHERE id='22222222-2222-4222-8222-222222222222';
INSERT INTO public.automation_enrollments (application_id,status)
  VALUES ('22222222-2222-4222-8222-222222222222','active');
SQL
}
endit() { Q -c "SELECT public.end_rental_tx('33333333-3333-4333-8333-333333333333','2026-10-23','available',NULL,NULL)"; }
appstatus() { Q -c "SELECT status FROM public.applications WHERE id='22222222-2222-4222-8222-222222222222'"; }

echo "A. installed function (control: it closes the application)"
Q -f "$DATA/installed_fn.sql" >/dev/null
seed active
is "end_rental_tx returns closed" "$(endit)" "closed"
is "application is closed by the installed function" "$(appstatus)" "closed"

echo "B. proposed function"
Q -f "$DATA/forward_fn.sql" >/dev/null
seed active
is "end_rental_tx returns closed" "$(endit)" "closed"
is "application status is PRESERVED" "$(appstatus)" "active"
is "rental is closed"        "$(Q -c "SELECT status FROM public.rentals WHERE id='33333333-3333-4333-8333-333333333333'")" "closed"
is "rental end_date is set"  "$(Q -c "SELECT end_date FROM public.rentals WHERE id='33333333-3333-4333-8333-333333333333'")" "2026-10-23"
is "autopay is off"          "$(Q -c "SELECT autopay_active FROM public.rentals WHERE id='33333333-3333-4333-8333-333333333333'")" "f"
is "vehicle is available"    "$(Q -c "SELECT status FROM public.vehicles")" "available"
is "automation is cancelled" "$(Q -c "SELECT status FROM public.automation_enrollments")" "cancelled"
is "cancel reason kept"      "$(Q -c "SELECT cancelled_reason FROM public.automation_enrollments")" "rental ended"
is "application notes untouched" "$(Q -c "SELECT notes FROM public.applications")" "keep me"

echo "C. the active guard after the rental ended"
#  The application is left 'active' with no running rental. The guard only polices
#  the TRANSITION into active, so the row may stay and may still be edited.
err=$(Q -c "UPDATE public.applications SET notes='edited' WHERE id='22222222-2222-4222-8222-222222222222'" 2>&1 >/dev/null)
is "an edit to the still-active application succeeds" "${err:-none}" "none"
is "the edit landed" "$(Q -c "SELECT notes FROM public.applications")" "edited"

#  Negative control: the guard IS live here. Moving a DIFFERENT application into
#  'active' with no running rental must still be refused. Without this, C proves nothing.
err=$(Q -c "INSERT INTO public.applications (id,status) VALUES ('55555555-5555-4555-8555-555555555555','active')" 2>&1 >/dev/null)
case "$err" in *active_requires_running_rental*) ok "guard still refuses a new Active with no rental" ;;
  *) bad "guard did NOT fire — section C is vacuous (got: ${err:-no error})" ;; esac

#  And a driver moved off Active cannot be put back by hand.
Q -c "UPDATE public.applications SET status='approved' WHERE id='22222222-2222-4222-8222-222222222222'" >/dev/null
err=$(Q -c "UPDATE public.applications SET status='active' WHERE id='22222222-2222-4222-8222-222222222222'" 2>&1 >/dev/null)
case "$err" in *active_requires_running_rental*) ok "cannot hand-edit back to Active after the rental ended" ;;
  *) bad "a person could set Active with no rental (got: ${err:-no error})" ;; esac

echo "D. rollback restores today's behaviour"
python3 -I - "$PROPOSAL" "$DATA" <<'PY'
import sys
prop, out = sys.argv[1], sys.argv[2]
text = open(prop).read(); rb = text[text.index("-- ROLLBACK"):]
code = "\n".join(l[3:] if l.startswith("-- ") else (l[2:] if l.startswith("--") else l)
                 for l in rb.splitlines())
i = code.index("CREATE OR REPLACE FUNCTION")
open(f"{out}/rollback_fn.sql","w").write(code[i:code.index("END $function$;")+len("END $function$;")])
PY
Q -f "$DATA/rollback_fn.sql" >/dev/null
seed active
endit >/dev/null
is "application closes again after rollback" "$(appstatus)" "closed"

echo
if [ "$fails" = 0 ]; then echo "closeout harness: all checks passed"; else echo "closeout harness: $fails FAILED"; fi
exit "$fails"
