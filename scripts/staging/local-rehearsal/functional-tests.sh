#!/usr/bin/env bash
# LOCAL ONLY functional tests on a fresh clone of rr_secured_tpl (combined-install.sh output). Synthetic local rows only.
set -uo pipefail; DB=rr_func
P="psql -h /tmp -p 55499 -U postgres -qAt -X"
$P -d template1 -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" -c "CREATE DATABASE $DB TEMPLATE rr_secured_tpl" >/dev/null
SYS=$($P -d $DB -c "select system_identifier from pg_control_system()"); case "$SYS" in 7642734024280108049|7702070854497379551|7692130048193495360) echo REFUSED; exit 1;; esac
OWN=00000000-0000-0000-0000-0000000000a1 MGR=00000000-0000-0000-0000-0000000000a2 COO=00000000-0000-0000-0000-0000000000a3 DRV=00000000-0000-0000-0000-0000000000d1
APP=10000000-0000-0000-0000-000000000001 VEH=20000000-0000-0000-0000-000000000001 PAY=30000000-0000-0000-0000-000000000001
$P -d $DB -v ON_ERROR_STOP=1 >/dev/null <<SQL
INSERT INTO auth.users(id,email) VALUES ('$OWN','o@x.test'),('$MGR','m@x.test'),('$COO','c@x.test'),('$DRV','d@x.test');
INSERT INTO public.user_roles(user_id,role) VALUES ('$OWN','admin'),('$MGR','team'),('$COO','coordinator'),('$DRV','driver');
INSERT INTO public.applications(id,full_name,email,phone,status,user_id) VALUES ('$APP','Test Driver','d@x.test','5550000000','reviewing','$DRV');
INSERT INTO public.vehicles(id,year,make,model,vin,weekly_rate,status) VALUES ('$VEH',2022,'Toyota','Camry','4T1BF1FK5CU123456',350,'available');
INSERT INTO public.documents(driver_id,kind,category,storage_bucket,storage_path,is_current,review_status) VALUES
 ('$APP','license_front','license_front','b','p1',true,'verified'),('$APP','license_back','license_back','b','p2',true,'verified'),('$APP','insurance','insurance','b','p3',true,'uploaded');
INSERT INTO public.agreements(application_id,body,source,status,signed_at) VALUES ('$APP','x','rental','signed',now());
INSERT INTO public.driver_screenings(lead_id,interview_completed_at) VALUES ('$APP',now());
INSERT INTO public.inspections(vehicle_id,inspection_type,status) VALUES ('$VEH','pre_delivery','passed');
INSERT INTO public.payments(id,driver_id,type,amount,balance_due,status) VALUES ('$PAY','$APP','rent',350,350,'upcoming');
SQL
pass=0; fail=0
t(){ local name="$1" expect="$2" role="$3" uid="$4" sql="$5" out rc
  out=$($P -d $DB -c "BEGIN" -c "SET LOCAL ROLE $role" -c "SELECT set_config('request.jwt.claims', '{\"sub\":\"$uid\",\"role\":\"$role\"}', true)" -c "$sql" -c "COMMIT" 2>&1); rc=$?
  # refused = an error, or a write that matched zero visible rows (RETURNING produced nothing; RLS hid the row)
  if echo "$out" | grep -q ERROR; then got=refused; elif [[ "$sql" == *RETURNING* ]] && ! echo "$out" | grep -qx 1; then got="refused(0 rows)"; else got=allowed; fi
  if [[ "${got%%(*}" == "$expect" ]]; then pass=$((pass+1)); echo "PASS [$got] $name"; else fail=$((fail+1)); echo "FAIL [$expect, got $got] $name :: $(echo "$out" | grep -m1 ERROR)"; fi; }
N=00000000-0000-0000-0000-000000000000
# --- application approval protections (S1 + 0031)
t "coordinator cannot approve application" refused authenticated $COO "UPDATE public.applications SET status='approved' WHERE id='$APP' RETURNING 1/(count(*) over())::int"
t "manager browser session cannot approve directly" refused authenticated $MGR "UPDATE public.applications SET status='approved' WHERE id='$APP' RETURNING 1"
t "driver cannot change own application status" refused authenticated $DRV "UPDATE public.applications SET status='approved' WHERE id='$APP' RETURNING 1"
t "server (service_role) approves application" allowed service_role $N "UPDATE public.applications SET status='approved' WHERE id='$APP'"
# --- insurance verification authority
t "coordinator cannot set insurance verification" refused authenticated $COO "SELECT public.set_insurance_verification('$APP',true,'ok')"
t "driver cannot write insurance_verified directly" refused authenticated $DRV "UPDATE public.driver_screenings SET insurance_verified=true WHERE lead_id='$APP' RETURNING 1"
t "service_role cannot write insurance_verified directly" refused service_role $N "UPDATE public.driver_screenings SET insurance_verified=true WHERE lead_id='$APP'"
# --- activation: insurance gate (exception OFF)
A="SELECT public.activate_rental_checked_tx('$APP','$VEH','$DRV',350,0,false,current_date,NULL,NULL,'$MGR',%s,'{\"summary\":\"t\"}'::jsonb)"
t "activation refused while insurance unverified (exception OFF)" refused service_role $N "$(printf "$A" false)"
t "activation refused with ack while exception OFF" refused service_role $N "$(printf "$A" true)"
t "browser session cannot call checked activation" refused authenticated $MGR "$(printf "$A" false)"
t "manager cannot flip insurance exception setting" refused authenticated $MGR "SELECT public.set_rental_activation_insurance_exception(true)"
t "service_role cannot write rental_activation setting directly" refused service_role $N "UPDATE public.app_settings SET value='{\"allow_activation_without_insurance_verification\":true}' WHERE key='rental_activation'"
t "owner setter callable (sets exception to false; stays OFF)" allowed authenticated $OWN "SELECT public.set_rental_activation_insurance_exception(false)"
t "manager sets insurance verification via setter" allowed authenticated $MGR "SELECT public.set_insurance_verification('$APP',true,'policy checked')"
t "server activation succeeds once verified" allowed service_role $N "$(printf "$A" false)"
# --- payments
t "manager browser cannot mark payment paid" refused authenticated $MGR "UPDATE public.payments SET status='paid' WHERE id='$PAY' RETURNING 1"
t "server records a payment (paid)" allowed service_role $N "UPDATE public.payments SET status='paid', balance_due=0, paid_date=current_date WHERE id='$PAY'"
t "manager browser cannot void payment" refused authenticated $MGR "UPDATE public.payments SET status='void', reason='x' WHERE id='$PAY' RETURNING 1"
t "manager can add an owed charge" allowed authenticated $MGR "INSERT INTO public.payments(driver_id,type,amount,balance_due,status) VALUES ('$APP','fee',25,25,'upcoming')"
t "manager cannot insert a paid row" refused authenticated $MGR "INSERT INTO public.payments(driver_id,type,amount,balance_due,status) VALUES ('$APP','fee',25,0,'paid')"
t "server voids payment with reason" allowed service_role $N "UPDATE public.payments SET status='void', reason='Recorded in error (local test)' WHERE id='$PAY'"
t "manager cannot delete payment" refused authenticated $MGR "DELETE FROM public.payments WHERE id='$PAY' RETURNING 1"
t "service_role cannot delete payment" refused service_role $N "DELETE FROM public.payments WHERE id='$PAY' RETURNING 1"
t "anon cannot read payments" refused anon $N "SELECT 1/(SELECT count(*) FROM public.payments)::int"
echo "end state: $($P -d $DB -c "select a.status||'|'||(select count(*) from public.rentals where application_id=a.id and status='active')||'|'||(select status from public.payments where id='$PAY')||'|'||(select count(*) from public.payments) from public.applications a where id='$APP'")"
echo "TOTAL pass=$pass fail=$fail"
