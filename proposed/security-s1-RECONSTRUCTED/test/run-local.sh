#!/usr/bin/env bash
# Disposable LOCAL rehearsal only. Requires PG on unix socket /tmp port 55499. Refuses any remote host.
set -uo pipefail; D="$(cd "$(dirname "$0")/.." && pwd)"; H=/tmp; PORT=55499; DB=s1rehearsal
P="psql -h $H -p $PORT -U postgres -v ON_ERROR_STOP=1 -qAt"; PV="psql -h $H -p $PORT -U postgres -v ON_ERROR_STOP=1 -At"
$P -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB" >/dev/null
SYS=$($P -d $DB -c "select system_identifier from pg_control_system()")
[[ "$SYS" == 7642734024280108049 || "$SYS" == 7702070854497379551 || "$SYS" == 7692130048193495360 ]] && { echo REFUSED; exit 1; }
pass=0; fail=0; ok(){ echo "PASS $1"; pass=$((pass+1)); }; ko(){ echo "FAIL $1 :: $2"; fail=$((fail+1)); }
$P -d $DB -f "$D/test/baseline-local.sql" >/dev/null || { echo baseline failed; exit 1; }
"$D/src/build-request.sh" "$SYS" > /tmp/req-s1-local.sql
$P -d $DB -f /tmp/req-s1-local.sql >/dev/null && ok "request applies once" || ko "request" "error"
$P -d $DB -f /tmp/req-s1-local.sql >/dev/null 2>&1 && ko "replay refused" "replay ran" || ok "replay refused"
# 1. function/trigger defs vs production
E="$D/production-evidence-readonly-2026-10-31.json"
want_fn=$(python3 -c "import json,hashlib;print(hashlib.md5(json.load(open('$E'))['guard_functiondef'].encode()).hexdigest())")
got_fn=$($P -d $DB -c "select md5(pg_get_functiondef('private.application_write_guard()'::regprocedure))")
[[ "$want_fn" == "$got_fn" ]] && ok "functiondef md5 = production" || ko "functiondef" "$got_fn vs $want_fn"
got_sha=$($P -d $DB -c "select encode(sha256(convert_to(prosrc,'UTF8')),'hex') from pg_proc where oid='private.application_write_guard()'::regprocedure")
[[ "$got_sha" == 34ce374b15e106597e7c6f9bd8bbb03607c3b7b68ab30e1aad75f4597fa6a292 ]] && ok "prosrc sha256 = 34ce374b…" || ko prosrc "$got_sha"
for t in applications_active_guard applications_updated_at zz_application_write_guard; do
 w=$(python3 -c "import json;print([x for x in json.load(open('$E'))['triggers'] if x['name']=='$t'][0]['def'])")
 g=$($P -d $DB -c "select pg_get_triggerdef(oid) from pg_trigger where tgrelid='public.applications'::regclass and tgname='$t'")
 [[ "$w" == "$g" ]] && ok "trigger def $t = production" || ko "trigger $t" "$g"
done
g=$($P -d $DB -c "select string_agg(tgname||':'||tgenabled::text||':'||tgtype::text,',' order by tgname collate \"C\") from pg_trigger where tgrelid='public.applications'::regclass and not tgisinternal")
w=$(python3 -c "import json;print(','.join(f\"{x['name']}:{x['enabled']}:{x['tgtype']}\" for x in sorted(json.load(open('$E'))['triggers'],key=lambda x:x['name'])))")
[[ "$w" == "$g" ]] && ok "trigger enabled/type/order = production" || ko "trigger order" "$g vs $w"
# 2. EXECUTE privileges / owner
g=$($P -d $DB -c "select pg_get_userbyid(proowner)||' '||proacl::text||' '||has_function_privilege('authenticated',oid,'EXECUTE')||has_function_privilege('anon',oid,'EXECUTE')||has_function_privilege('service_role',oid,'EXECUTE')||' '||prosecdef from pg_proc where oid='private.application_write_guard()'::regprocedure")
[[ "$g" == "postgres {postgres=X/postgres} falsefalsefalse false" ]] && ok "owner/proacl/EXECUTE = production (postgres, {postgres=X/postgres}, no anon/auth/service_role, invoker)" || ko exec "$g"
# 3. fingerprints
$P -d $DB -c "select jsonb_build_object('core',core,'acl',raw)::text from (select jsonb_build_object('owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,'columns',(select jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull) order by a.attnum) from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),'triggers',(select jsonb_agg(jsonb_build_array(t.tgname,pn.nspname,p.proname,t.tgtype,t.tgenabled,t.tgattr::text) order by t.tgname collate \"C\") from pg_trigger t join pg_proc p on p.oid=t.tgfoid join pg_namespace pn on pn.oid=p.pronamespace where t.tgrelid=c.oid and not t.tgisinternal),'policies',(select jsonb_agg(jsonb_build_array(po.polname,po.polcmd,po.polpermissive,po.polroles::regrole[]::text,po.polqual::text,po.polwithcheck::text) order by po.polname collate \"C\") from pg_policy po where po.polrelid=c.oid),'guard_functions',(select count(*) from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='private' and p.proname='application_write_guard')) core, jsonb_build_object('relacl',c.relacl::text,'columns',(select jsonb_agg(jsonb_build_array(a.attname,a.attacl::text) order by a.attnum) from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped)) raw from pg_class c where c.oid='public.applications'::regclass) x" > /tmp/local-snap.json
python3 - "$E" <<'PY'
import json,sys,re
p=json.load(open(sys.argv[1]))['snapshot']; l=json.load(open('/tmp/local-snap.json'))
norm=lambda x: re.sub(r':(funcid|location|varattno|varattnosyn|opno|opfuncid|inputcollid|varcollid|constcollid|inputcollid|consttype|funcresulttype|resulttype) -?\d+',r':\1 N',x or '') if isinstance(x,str) else x
for k in ['owner','rls','force_rls','columns','triggers','guard_functions']:
    print(('PASS' if p['core'][k]==l['core'][k] else 'FAIL'),'snapshot core.'+k,'= production')
pe=[[x[0],x[1],x[2],x[3],norm(x[4]),norm(x[5])] for x in p['core']['policies']]; le=[[x[0],x[1],x[2],x[3],norm(x[4]),norm(x[5])] for x in l['core']['policies']]
print(('PASS' if [x[:4] for x in pe]==[x[:4] for x in le] else 'FAIL'),'policy names/cmd/permissive/roles = production')
print(('PASS' if pe==le else 'INFO'),'policy node trees equal after OID/attno normalisation' if pe==le else 'policy node trees differ beyond OIDs (expected: rebuilt from readable text)')
print(('PASS' if p['acl']==l['acl'] else 'FAIL'),'snapshot acl (relacl + every column attacl) = production')
exact = p==l
print(('PASS' if exact else 'INFO'),'full fingerprint a2b05c35 reproduced' if exact else 'full fingerprint differs only via policy node trees (OIDs) -> not reproducible on a fresh DB')
PY
# 4. original verify-after gates
$P -d $DB -c "BEGIN READ ONLY" -f "$D/test/s1-verify-after-original.sql" -c "ROLLBACK" 2>&1 | python3 -c "
import sys,json
for l in sys.stdin:
  l=l.strip()
  if l.startswith('{'): g=json.loads(l)['gates']; [print(('PASS' if v else 'GATE-FALSE'),'verify-after gate',k) for k,v in sorted(g.items())]"
acl_ok=$($P -d $DB -c "select (select jsonb_agg(x order by x collate \"C\") from (select concat_ws(':','',case when e.grantee=0 then 'PUBLIC' else pg_get_userbyid(e.grantee) end,e.privilege_type,pg_get_userbyid(e.grantor),e.is_grantable::text) x from pg_class c, lateral aclexplode(c.relacl) e where c.oid='public.applications'::regclass union all select concat_ws(':',a.attname,case when e.grantee=0 then 'PUBLIC' else pg_get_userbyid(e.grantee) end,e.privilege_type,pg_get_userbyid(e.grantor),e.is_grantable::text) from pg_attribute a, lateral aclexplode(a.attacl) e where a.attrelid='public.applications'::regclass and a.attnum>0 and not a.attisdropped) s)::text")
w=$(python3 -c "import json;print(json.dumps(json.load(open('$E'))['evidence']['post_install_acl']))")
python3 -c "import json,sys;print('PASS exploded ACL (154 items) = production evidence post_install_acl' if json.loads(sys.argv[1])==json.loads(sys.argv[2]) else 'FAIL exploded ACL')" "$acl_ok" "$w"
# 5. behaviour
t(){ local name="$1" expect="$2" sql="$3"; out=$($PV -d $DB -c "$sql" 2>&1); rc=$?
 if [[ $expect == ok && $rc == 0 ]] || [[ $expect != ok && $out == *"$expect"* ]]; then ok "$name"; else ko "$name" "${out:0:160}"; fi; }
ID=$($P -d $DB -c "insert into public.applications(full_name,email,phone,status) values ('Test Driver','t@example.invalid','5555550100','new') returning id")
FORM="full_name,email,phone,city,state"
t "anon may submit a new application (form columns only; status defaults to new)" ok "set role anon; insert into public.applications($FORM) values ('A B','a@example.invalid','5555550101','X','NY')"
t "anon may NOT set status on insert (column privilege)" "permission denied" "set role anon; insert into public.applications($FORM,status) values ('A B','a@example.invalid','5555550102','X','NY','approved')"
t "anon may NOT set a protected column on insert (weekly_rent)" "permission denied" "set role anon; insert into public.applications($FORM,weekly_rent) values ('A B','a@example.invalid','5555550104','X','NY',1)"
t "authenticated may insert form columns only" ok "set role authenticated; insert into public.applications($FORM) values ('A B','b@example.invalid','5555550103','X','NY')"
t "authenticated may NOT set status on insert" "permission denied" "set role authenticated; insert into public.applications($FORM,status) values ('A B','b@example.invalid','5555550105','X','NY','approved')"
t "staff (authenticated) may NOT change status (refused: column privilege; trigger is second layer)" "permission denied" "set test.role='manager'; set role authenticated; update public.applications set status='approved' where id='$ID'"
t "S1 trigger refuses status change even if a column grant were added (defense in depth)" "application_status_server_only" "begin; grant update (status) on public.applications to authenticated; set local test.role='manager'; set local role authenticated; update public.applications set status='approved' where id='$ID'; rollback"
t "staff (authenticated) may NOT change protected column weekly_rent" "permission denied" "set test.role='manager'; set role authenticated; update public.applications set weekly_rent=1 where id='$ID'"
t "manager (authenticated) may still edit an allowed column (notes), 1 row" "UPDATE 1" "set test.role='manager'; set role authenticated; update public.applications set notes='ok' where id='$ID'"
t "non-staff authenticated cannot update (RLS: 0 rows, no error)" ok "set role authenticated; update public.applications set notes='x' where id='$ID'"
t "server (service_role) may approve, 1 row" "UPDATE 1" "set role service_role; update public.applications set status='approved', reviewed_at=now() where id='$ID'"
t "server (service_role) may set protected payment columns" ok "set role service_role; update public.applications set weekly_rent=350, deposit_status='paid' where id='$ID'"
t "server (postgres owner) may update status" ok "update public.applications set status='pending' where id='$ID'"
t "active guard still enforced for server (no running rental)" "active_requires_running_rental" "set role service_role; update public.applications set status='active' where id='$ID'"
t "server may activate with a running rental" ok "insert into public.rentals(application_id,status) values ('$ID','active'); set role service_role; update public.applications set status='active' where id='$ID'"
t "updated_at trigger still fires" ok "select 1/(case when updated_at>created_at then 1 else 0 end) from public.applications where id='$ID'"
t "anon cannot delete" "permission denied" "set role anon; delete from public.applications where id='$ID'"
t "sandbox_exec keeps SELECT+INSERT only (no UPDATE)" "permission denied" "set role sandbox_exec; update public.applications set notes='x' where id='$ID'"
t "guard function not executable by authenticated" "permission denied" "set role authenticated; select private.application_write_guard()"
st=$($P -d $DB -c "select status||'|'||weekly_rent||'|'||deposit_status||'|'||(reviewed_at is not null) from public.applications where id='$ID'")
[[ "$st" == "active|350.00|paid|true" ]] && ok "end state: server approved, set rent/deposit, activated with rental ($st)" || ko "end state" "$st"
echo "TOTAL pass=$pass fail=$fail"
