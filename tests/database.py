from pathlib import Path
import subprocess,os,json,tempfile,concurrent.futures,time,shutil
E=Path(__file__).resolve().parents[1]; O=E.parent/'record-rental-corrections-v3-2026-10-18'; R=E.parent/'record-rental-contract-2026-10-18'; B=Path(tempfile.mkdtemp(prefix='rr-record-local-',dir='/private/tmp')); P='/opt/homebrew/opt/postgresql@17/bin/'
env={k:v for k,v in os.environ.items() if not k.startswith('PG') and k not in ('DATABASE_URL','SUPABASE_URL')};env['LC_ALL']='C'
(B/'socket').mkdir(); results=[]
def run(args,**kw):return subprocess.run(args,env=env,**kw)
def q(sql,user='postgres',ok=True):
 r=run([P+'psql','-X','-At','-v','ON_ERROR_STOP=1','-h',str(B/'socket'),'-p','55487','-U',user,'-d','postgres'],input=sql,text=True,capture_output=True)
 if ok and r.returncode:raise RuntimeError(r.stderr)
 return r.stdout.strip() if ok else r
def check(name,x):
 results.append({'name':name,'result':'PASS' if x else 'FAIL'});assert x,name
 print('PASS',name,flush=True)
def deny(name,sql,user='owner_test',error=None):
 r=q(sql,user,False);check(name,r.returncode!=0 and (error is None or error in r.stderr))
def uid(i):return '10000000-0000-4000-8000-'+str(i).zfill(12)
def seed(i):
 q(f"INSERT INTO applications(id,user_id,status,deleted_at,license_expiration,positive_verified,documents_verified) VALUES('{uid(i)}','{uid(i+1000)}','approved',NULL,CURRENT_DATE+30,true,true);INSERT INTO vehicles VALUES('{uid(i+2000)}','available',NULL,NULL);INSERT INTO agreements(id,application_id,vehicle_id,rental_id,signed) VALUES('{uid(i+3000)}','{uid(i)}','{uid(i+2000)}',NULL,true);")
def call(i,op=None,deposit='NULL',vehicle=None,sub='NULL',reason='synthetic intake'):
 return f"SELECT record_existing_rental_tx('{uid(op or i+4000)}','{uid(i)}','{uid(vehicle or i+2000)}','2026-10-15 14:00:00+00',350,{deposit},1000,{sub},'{reason}');"
started=False
try:
 run([P+'initdb','-D',str(B/'data'),'-U','postgres','--auth-local=trust','--auth-host=reject'],check=True,stdout=subprocess.DEVNULL)
 with (B/'data/postgresql.conf').open('a') as f:f.write(f"\nlisten_addresses=''\nport=55487\nunix_socket_directories='{B}/socket'\nmax_worker_processes=0\n")
 run([P+'pg_ctl','-D',str(B/'data'),'-l',str(B/'server.log'),'-w','start'],check=True,stdout=subprocess.DEVNULL);started=True
 q((R/'tests/fixture.sql').read_text());q((O/'tests/repository-role-enum.sql').read_text());q((R/'source/activation.sql').read_text());q((O/'proposed/record-rental-v2.sql').read_text());q((O/'tests/closeout-fixture.sql').read_text());q((O/'source/end-rental-safe-release.sql').read_text());q((O/'proposed/closeout-v2.sql').read_text())
 for n,(u,role) in enumerate([('owner_test','admin'),('manager_test','team'),('coordinator_test','coordinator'),('driver_test','driver')],1):
  q(f"CREATE ROLE {u} LOGIN IN ROLE authenticated;INSERT INTO private.principals VALUES('{u}','{uid(n)}');INSERT INTO user_roles VALUES('{uid(n)}','{role}');")
 q((R/'tests/evidence-fixture.sql').read_text());q((O/'tests/closeout-grants.sql').read_text())
 q("CREATE SCHEMA auth;CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid,not_after timestamptz);CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$SELECT jsonb_build_object('session_id',id) FROM auth.sessions WHERE user_id=private.approval_actor()$$;")
 q("ALTER TABLE applications ADD COLUMN license_number text DEFAULT 'synthetic';ALTER TABLE applications ADD COLUMN license_state text DEFAULT 'FL';ALTER TABLE agreements ADD COLUMN status text DEFAULT 'signed';CREATE TABLE documents(id uuid PRIMARY KEY,version text,sha256 text);CREATE FUNCTION private.approval_snapshot(a uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT to_jsonb(x) FROM public.applications x WHERE id=a$$;")
 q((E/'proposed/evidence-v1.sql').read_text())
 q(f"INSERT INTO auth.sessions VALUES('{uid(9001)}','{uid(1)}',NULL);INSERT INTO auth.sessions VALUES('{uid(9002)}','{uid(2)}',NULL);GRANT rr_evidence_issuer TO owner_test;")
 def literal(j):return "'"+json.dumps(j).replace("'","''")+"'::jsonb"
 def token(i, subscription=None, paper=False, document_hash="a"*64):
  dh="NULL" if document_hash is None else chr(39)+document_hash+chr(39)
  seed(i);q(f"INSERT INTO documents(id,version,sha256) VALUES('{uid(i+6000)}','v1',{dh})")
  req={'operationId':uid(i+4000),'applicationId':uid(i),'vehicleId':uid(i+2000),'startedAt':'2026-10-15T14:00:00Z','weeklyRate':350,'deposit':None,'pickupMileage':1000,'subscriptionEvidenceId':None,'reason':'synthetic intake'}
  ver={'request':{'actorId':uid(1),'operationId':req['operationId'],'applicationId':req['applicationId'],'vehicleId':req['vehicleId'],'startedAt':req['startedAt'],'weeklyCents':35000,'driverId':uid(i+1000),'currency':'usd','account':'acct_synthetic','environment':'sandbox'},'agreement':{'id':uid(i+3000),'documentId':uid(i+6000),'provenanceId':uid(i+3000),'kind':'esign','verification':'esign-verified','status':'signed','signedVersion':'v1','currentVersion':'v1','signedHash':'a'*64,'currentHash':'a'*64,'applicationId':uid(i),'driverId':uid(i+1000),'vehicleId':uid(i+2000),'weeklyCents':35000,'currency':'usd','effectiveAt':req['startedAt'],'signedAt':req['startedAt']},'subscription':None}
  # Fixture administrator obtains the same locked snapshot under authenticated Owner session;
  # production issuer transport requires reviewed narrow access, not this fixture grant.
  q('GRANT EXECUTE ON FUNCTION private.record_snapshot_v1(uuid,uuid,uuid,uuid) TO rr_evidence_issuer')
  if subscription:
   ver['subscription']={'account':'acct_synthetic','environment':'sandbox','customer':'cus_synthetic','subscription':subscription,'applicationId':uid(i),'driverId':uid(i+1000),'currency':'usd','unitAmount':35000,'interval':'week','intervalCount':1,'quantity':1,'status':'active','observedAt':q('SELECT clock_timestamp()'),'expiresAt':q("SELECT clock_timestamp()+interval '4 minutes'"),'nextDue':None}
  if paper:
   q(f"DELETE FROM agreements WHERE id='{uid(i+3000)}'");ver['agreement']['kind']='paper';ver['agreement']['verification']='paper-registered'
  snap=json.loads(q(f"SET ROLE rr_evidence_issuer;SELECT private.record_snapshot_v1('{uid(i)}','{uid(i+2000)}','{uid(i+3000)}','{uid(i+6000)}')",'owner_test').splitlines()[-1])
  t=q(f"SET ROLE rr_evidence_issuer;SELECT private.issue_record_evidence_v1({literal(req)},{literal(ver)},{literal(snap)})",'owner_test').splitlines()[-1]
  return t,req,ver,snap
 def consume(t,r):return f"SELECT public.record_existing_rental_evidence_v1('{t}',{literal(r)})"
 t,r,v,s=token(500)
 result=json.loads(q(consume(t,r),'owner_test'));check('atomic rental and evidence consumption',result['status']=='recorded' and q('SELECT count(*) FROM private.record_evidence_consumed_v1')=='1')
 check('duplicate recovery',json.loads(q(consume(t,r),'owner_test'))['recovered'])
 altered=dict(r,operationId=uid(8888));deny('replay different operation rejected',consume(t,altered),error='evidence_binding_invalid')
 deny('different actor rejected',consume(t,r),'manager_test','evidence_binding_invalid')
 t2,r2,_,_=token(501)
 q(f"UPDATE documents SET version='v2' WHERE id='{uid(6501)}'");deny('changed document rejected',consume(t2,r2),error='evidence_changed')
 t3,r3,_,_=token(502);q(f"UPDATE applications SET positive_verified=false WHERE id='{uid(502)}'");deny('stale identity rejected',consume(t3,r3),error='identity_invalid')
 t4,r4,_,_=token(503)
 q("CREATE FUNCTION private.evidence_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'test_audit_failure';END$$;CREATE TRIGGER test_fail BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION private.evidence_test_fail();")
 deny('audit failure rolls back',consume(t4,r4),error='test_audit_failure')
 check('rollback leaves neither rental nor consumption',q(f"SELECT NOT EXISTS(SELECT 1 FROM rentals WHERE application_id='{uid(503)}') AND NOT EXISTS(SELECT 1 FROM private.record_evidence_consumed_v1 WHERE evidence_id='{t4}')")=='t')
 q('DROP TRIGGER test_fail ON audit_log');check('same token after rollback succeeds',json.loads(q(consume(t4,r4),'owner_test'))['status']=='recorded')
 t5,r5,_,_=token(504)
 with concurrent.futures.ThreadPoolExecutor() as pool:rs=list(pool.map(lambda _:q(consume(t5,r5),'owner_test',False),range(2)))
 check('concurrent consumption creates exactly one',q(f"SELECT count(*) FROM rentals WHERE application_id='{uid(504)}'")=='1' and any(x.returncode==0 for x in rs))
 check('concurrent loser recovery',json.loads(q(consume(t5,r5),'owner_test'))['recovered'])
 tp,rp,vp,sp=token(506,paper=True)
 check('paper provenance retained without eSign row',json.loads(q(consume(tp,rp),'owner_test'))['status']=='recorded' and q(f"SELECT NOT EXISTS(SELECT 1 FROM agreements WHERE application_id='{uid(506)}')")=='t')
 ts,rs,vs,ss=token(507,subscription='sub_unique')
 check('subscription identity and null billing date preserved',json.loads(q(consume(ts,rs),'owner_test'))['status']=='recorded' and q(f"SELECT stripe_subscription_id='sub_unique' AND next_payment_due IS NULL FROM rentals WHERE application_id='{uid(507)}'")=='t')
 tt,rt,vt,st=token(508,subscription='sub_unique');deny('subscription cannot link twice',consume(tt,rt))
 check('duplicate subscription failure consumes nothing',q(f"SELECT NOT EXISTS(SELECT 1 FROM private.record_evidence_consumed_v1 WHERE evidence_id='{tt}')")=='t')
 vt['subscription']['account']='acct_wrong';deny('issuer rejects provider mismatch',f"SET ROLE rr_evidence_issuer;SELECT private.issue_record_evidence_v1({literal(rt)},{literal(vt)},{literal(st)})",error='subscription_binding_invalid')
 ti,ri,vi,si=token(509)
 check('idempotent issuance same token',q(f"SET ROLE rr_evidence_issuer;SELECT private.issue_record_evidence_v1({literal(ri)},{literal(vi)},{literal(si)})",'owner_test').splitlines()[-1]==ti)
 changed=dict(ri,reason='conflicting payload');deny('conflicting same operation issuance',f"SET ROLE rr_evidence_issuer;SELECT private.issue_record_evidence_v1({literal(changed)},{literal(vi)},{literal(si)})",error='operation_conflict')
 te=uid(9900);re=dict(ri,operationId=uid(9901));q(f"INSERT INTO private.record_evidence_v1 SELECT '{te}',actor_id,session_id,'{uid(9901)}',application_id,{literal(re)},verified,snapshot,clock_timestamp()-interval '10 minutes',clock_timestamp()-interval '5 minutes' FROM private.record_evidence_v1 WHERE id='{ti}'")
 deny('expired reference rejected',consume(te,re),error='evidence_expired')
 # Focused independent reproductions: authority, canonical snapshots, stable issuance recovery.
 for i,h in [(530,'b'*64),(531,None)]:
  try: token(i,document_hash=h); rejected=False
  except RuntimeError as err: rejected='authoritative_document_mismatch' in str(err)
  check('authoritative hash mismatch/missing rejected '+str(i),rejected)
 q("ALTER TABLE documents ADD COLUMN created_at timestamptz DEFAULT '2026-01-01T00:00:00Z'")
 for i,zone in [(532,'Pacific/Honolulu'),(533,'Asia/Kolkata'),(534,'America/New_York')]:
  tz,rz,vz,sz=token(i)
  other=json.loads(q(f"SET TIME ZONE '{zone}';SET ROLE rr_evidence_issuer;SELECT private.record_snapshot_v1('{uid(i)}','{uid(i+2000)}','{uid(i+3000)}','{uid(i+6000)}')",'owner_test').splitlines()[-1])
  check('timezone snapshot invariant '+zone,other==sz)
  check('cross timezone consumption '+zone,json.loads(q(f"SET TIME ZONE '{zone}';"+consume(tz,rz),'owner_test').splitlines()[-1])['status']=='recorded')
 tm,rm,vm,sm=token(535);q(f"UPDATE documents SET created_at=created_at+interval '1 second' WHERE id='{uid(6535)}'")
 deny('material timestamp change rejected',consume(tm,rm),error='evidence_changed')
 th,rh,vh,sh=token(536);q(f"UPDATE documents SET sha256=repeat('b',64) WHERE id='{uid(6536)}'")
 deny('hash changed before consumption rejected',consume(th,rh),error='evidence_changed')
 tr,rr,vr,sr=token(537,subscription='sub_recovery')
 original=q(f"SELECT verified::text||expires_at::text FROM private.record_evidence_v1 WHERE id='{tr}'")
 vr['subscription']['observedAt']=q('SELECT clock_timestamp()');vr['subscription']['expiresAt']=q("SELECT clock_timestamp()+interval '4 minutes'")
 issue=f"SET ROLE rr_evidence_issuer;SELECT private.issue_record_evidence_v1({literal(rr)},{literal(vr)},{literal(sr)})"
 check('lost issuance response refreshed observation recovers original',q(issue,'owner_test').splitlines()[-1]==tr)
 check('recovery never extends stored freshness',q(f"SELECT verified::text||expires_at::text FROM private.record_evidence_v1 WHERE id='{tr}'")==original)
 with concurrent.futures.ThreadPoolExecutor() as pool: outcomes=list(pool.map(lambda _:q(issue,'owner_test',False),range(2)))
 check('concurrent issuance recovers one immutable token',any(x.returncode==0 for x in outcomes) and all(x.stdout.strip().splitlines()[-1]==tr for x in outcomes if x.returncode==0) and q(f"SELECT count(*) FROM private.record_evidence_v1 WHERE operation_id='{rr['operationId']}'")=='1')
 vr['subscription']['nextDue']='2026-11-01T00:00:00Z'
 deny('material subscription facts conflict',f"SET ROLE rr_evidence_issuer;SELECT private.issue_record_evidence_v1({literal(rr)},{literal(vr)},{literal(sr)})",error='operation_conflict')
 check('recovered reference consumes atomically',json.loads(q(consume(tr,rr),'owner_test'))['status']=='recorded')
 tx,rx,vx,sx=token(538,subscription='sub_expiry')
 vx['subscription']['expiresAt']=q("SELECT clock_timestamp()-interval '1 second'")
 deny('expired refreshed observation denied',f"SET ROLE rr_evidence_issuer;SELECT private.issue_record_evidence_v1({literal(rx)},{literal(vx)},{literal(sx)})",error='subscription_binding_invalid')
 # Fixture-admin insertion simulates time passage without editing immutable evidence.
 stale=uid(9990);rsx=dict(rx,operationId=uid(9991));vsx=json.loads(json.dumps(vx));vsx['request']['operationId']=rsx['operationId']
 q(f"INSERT INTO private.record_evidence_v1 SELECT '{stale}',actor_id,session_id,'{uid(9991)}',application_id,{literal(rsx)},{literal(vsx)},snapshot,issued_at,expires_at FROM private.record_evidence_v1 WHERE id='{tx}'")
 deny('expired original subscription cannot consume',consume(stale,rsx),error='subscription_evidence_unavailable')
 vsx['subscription']['observedAt']=q('SELECT clock_timestamp()');vsx['subscription']['expiresAt']=q("SELECT clock_timestamp()+interval '4 minutes'")
 deny('fresh observations cannot renew expired original',f"SET ROLE rr_evidence_issuer;SELECT private.issue_record_evidence_v1({literal(rsx)},{literal(vsx)},{literal(sx)})",error='evidence_expired')
 t6,r6,_,_=token(505);q(f"DELETE FROM user_roles WHERE user_id='{uid(1)}'");deny('revoked role denied',consume(t6,r6),error='forbidden');q(f"INSERT INTO user_roles VALUES('{uid(1)}','admin')")
 q(f"DELETE FROM auth.sessions WHERE user_id='{uid(1)}'");deny('revoked session denied',consume(t6,r6),error='session_unavailable')
 deny('browser cannot issue evidence',f"SELECT private.issue_record_evidence_v1({literal(r)},{literal(v)},{literal(s)})",'manager_test')
 check('no financial payment schema created',q("SELECT to_regclass('public.payments') IS NULL")=='t')
finally:
 (E/'database-results.json').write_text(json.dumps(results,indent=2))
 if started:run([P+'pg_ctl','-D',str(B/'data'),'-m','fast','-w','stop'],stdout=subprocess.DEVNULL,check=True)
 if (B/'server.log').exists():(E/'tests/postgres.log').write_bytes((B/'server.log').read_bytes())
 shutil.rmtree(B)
