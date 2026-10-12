import subprocess,tempfile,os,json,time,shutil,base64,hmac,hashlib,socket,http.client,secrets
from pathlib import Path
OUT=Path(__file__).resolve().parent; ROOT=OUT.parents[1]; PG='/opt/homebrew/opt/postgresql@17/bin/';env=dict(os.environ,LC_ALL='C')
b=Path(tempfile.mkdtemp(prefix='rr-coordinator-synthetic-',dir='/private/tmp'));b.chmod(0o700);sock=b/'socket';sock.mkdir(mode=0o700);db=b/'data';results=[];proc=None;api=None
subprocess.run([PG+'initdb','-D',str(db),'-U','fixture_owner','--auth-local=trust','--auth-host=reject','--encoding=UTF8'],capture_output=True,env=env,check=True)
with (db/'postgresql.conf').open('a') as f:f.write("\nlisten_addresses=''\nport=55449\nunix_socket_directories='"+str(sock)+"'\nunix_socket_permissions=0700\nmax_worker_processes=0\nshared_preload_libraries=''\n")
(b/'isolation.sb').write_text('(version 1)(allow default)(deny network*)(allow network* (local unix-socket))')
log=(b/'server.log').open('wb');proc=subprocess.Popen(['/usr/bin/sandbox-exec','-f',str(b/'isolation.sb'),PG+'postgres','-D',str(db)],stdout=log,stderr=log,env=env)
args=[PG+'psql','-h',str(sock),'-p','55449','-U','fixture_owner','-d','postgres','-At','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose']
def run(s):return subprocess.run(args,input=s,text=True,capture_output=True,env=env)
def q(s):
 r=run(s)
 if r.returncode:raise RuntimeError(r.stderr)
 return r.stdout.strip()
def test(name,s,want=None,deny=False):
 r=run(s);ok=('42501' in r.stderr and r.returncode!=0) if deny else (r.returncode==0 and (want is None or want in r.stdout.splitlines()))
 results.append({'test':name,'passed':ok});print(('PASS ' if ok else 'FAIL ')+name)
 if not ok:print(r.stderr,r.stdout)
app='10000000-0000-4000-8000-000000000001';doc='20000000-0000-4000-8000-000000000001';review='40000000-0000-4000-8000-000000000001'
ids={r:'30000000-0000-4000-8000-00000000000'+str(i+1) for i,r in enumerate(['owner','manager','coordinator','driver'])}
def role(r,s):return "BEGIN; SET LOCAL ROLE authenticated;SELECT set_config('request.jwt.claim.sub','"+ids[r]+"',true);"+s+';ROLLBACK;'
try:
 for _ in range(60):
  if run('SELECT 1').returncode==0:break
  time.sleep(.1)
 q('''CREATE ROLE anon NOLOGIN;CREATE ROLE authenticated NOLOGIN;CREATE ROLE service_role NOLOGIN BYPASSRLS;
 CREATE SCHEMA auth;CREATE SCHEMA private;CREATE SCHEMA storage;
 GRANT USAGE ON SCHEMA public,auth,private,storage TO anon,authenticated,service_role;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
 CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$SELECT coalesce(nullif(current_setting('request.jwt.claim.role',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role')$$;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz DEFAULT now(),phone_confirmed_at timestamptz,banned_until timestamptz,deleted_at timestamptz);CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid,not_after timestamptz);CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS $$SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$; CREATE TABLE user_roles(user_id uuid REFERENCES auth.users(id),role text);
 CREATE TABLE applications(id uuid PRIMARY KEY,user_id uuid,vehicle_id uuid,full_name text,email text,phone text,status text,license_number text,license_photo_url text,deleted_at timestamptz,purged_at timestamptz,resubmission_history jsonb DEFAULT '[]');
 CREATE TABLE application_resume_tokens(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),application_id uuid REFERENCES applications(id),token_hash text UNIQUE NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL,revoked_at timestamptz);
 CREATE TABLE audit_log(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,actor_email text,actor_role text,action text NOT NULL,entity_type text,entity_id text,summary text NOT NULL,metadata jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now());
 CREATE FUNCTION private.is_manager() RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND role IN ('team','admin'))$$;
 CREATE FUNCTION private.is_staff() RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND role IN ('team','admin','coordinator'))$$;
 CREATE FUNCTION private.partner_owns_vehicle(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
 CREATE TABLE agreements(id uuid PRIMARY KEY,body text);ALTER TABLE agreements ENABLE ROW LEVEL SECURITY;GRANT SELECT ON agreements TO authenticated;CREATE POLICY agreement_read ON agreements FOR SELECT TO authenticated USING(private.is_staff());
 CREATE TABLE documents(id uuid PRIMARY KEY,driver_id uuid,category text,storage_bucket text,storage_path text,visibility text[]);
 CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text);
 ALTER TABLE applications ENABLE ROW LEVEL SECURITY;ALTER TABLE documents ENABLE ROW LEVEL SECURITY;ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
 GRANT SELECT,UPDATE ON applications TO authenticated;CREATE POLICY app_update ON applications FOR UPDATE TO authenticated USING(private.is_staff()) WITH CHECK(private.is_staff());GRANT ALL ON documents,storage.objects TO authenticated;GRANT ALL ON audit_log TO service_role;
 CREATE POLICY app_read ON applications FOR SELECT TO authenticated USING(private.is_staff() OR user_id=auth.uid());
 CREATE POLICY doc_access ON documents FOR ALL TO authenticated USING(private.is_staff() OR (visibility @> ARRAY['driver'] AND EXISTS(SELECT 1 FROM applications a WHERE a.id=driver_id AND a.user_id=auth.uid()))) WITH CHECK(private.is_staff());
 CREATE POLICY existing_storage ON storage.objects FOR ALL TO authenticated USING(true) WITH CHECK(true);
 ''')
 for r,ident in ids.items():q("INSERT INTO auth.users(id,email) VALUES('"+ident+"','"+r+"@example.invalid');INSERT INTO user_roles VALUES('"+ident+"','"+{'owner':'admin','manager':'team'}.get(r,r)+"');")
 q("INSERT INTO applications(id,user_id,full_name,email,phone,status,license_number,license_photo_url) VALUES('"+app+"','"+ids['driver']+"','Synthetic','fixture@example.invalid','+12025550199','new','SYNTHETIC-NUMBER','synthetic/private/path');INSERT INTO documents VALUES('"+doc+"','"+app+"','license_front','license-uploads','"+app+"/fixture.png',ARRAY['driver','admin']);INSERT INTO storage.objects(bucket_id,name) VALUES('license-uploads','"+app+"/fixture.png');")
 for n in ['0019_application_identity_reviews.sql','0020_identity_reviews_tighten_grants.sql','0022_application_resume_atomic_security.sql']:q(((OUT/n) if n.startswith('0022') else (ROOT/'drizzle/migrations'/n)).read_text())
 q((OUT/'0025_identity_audit_append_only.sql').read_text())
 q("INSERT INTO application_identity_reviews(id,application_id,kind) VALUES('"+review+"','"+app+"','phone_match_email_differs');")
 before=q('SELECT md5(row_to_json(a)::text) FROM applications a;')

 repair=(OUT/'0032_identity_rpc_fail_closed.sql').read_text()
 installed=(OUT/'0030_coordinator_identity_access.sql').read_text()
 q("INSERT INTO applications(id,full_name,email,phone,status,license_number) VALUES('10000000-0000-4000-8000-000000000002','Unlinked','null@example.invalid','2025550100','new','NULL-SECRET');")
 nullapp='10000000-0000-4000-8000-000000000002'; missing='10000000-0000-4000-8000-000000000099'
 for n,uid in ids.items():q("INSERT INTO auth.sessions VALUES('"+uid+"','"+uid+"',NULL);")
 q('BEGIN;'+installed+'COMMIT;')
 test('original NULL ownership bug reproduced',role('driver',"SELECT read_application_identity('"+nullapp+"')->>'license_number'"),'NULL-SECRET')
 q('BEGIN;'+repair+'COMMIT;')
 def rpcrole(n,appid,claims=None):
  claims=claims or {'sub':ids[n],'role':'authenticated','session_id':ids[n],'exp':int(time.time())+600}
  return "BEGIN;SET LOCAL ROLE authenticated;SELECT set_config('request.jwt.claims','"+json.dumps(claims)+"',true);SELECT read_application_identity('"+appid+"');ROLLBACK;"
 for n in ['owner','manager','driver']:test(n+' verified RPC access',rpcrole(n,app),want=None)
 for label,appid in [('NULL ownership',nullapp),('missing application',missing),('NULL argument',None)]:
  stmt=rpcrole('driver',appid or app)
  if appid is None:stmt=stmt.replace("read_application_identity('"+app+"')","read_application_identity(NULL)")
  test(label+' fails closed',stmt,deny=True)
 q("UPDATE applications SET user_id='"+ids['owner']+"' WHERE id='"+nullapp+"';")
 test('wrong Driver or forged other application id denied',rpcrole('driver',nullapp),deny=True)
 test('Coordinator RPC denied',rpcrole('coordinator',app),deny=True)
 test('anonymous RPC denied',"BEGIN;SET LOCAL ROLE anon;SELECT read_application_identity('"+app+"');ROLLBACK;",deny=True)
 test('unverified session denied',rpcrole('driver',app,{'sub':ids['driver'],'role':'authenticated','exp':int(time.time())+600}),deny=True)
 test('expired claims denied',rpcrole('driver',app,{'sub':ids['driver'],'role':'authenticated','session_id':ids['driver'],'exp':1}),deny=True)
 for label,change,undo in [('unconfirmed identity',"UPDATE auth.users SET email_confirmed_at=NULL", "UPDATE auth.users SET email_confirmed_at=now()"),('banned identity',"UPDATE auth.users SET banned_until=now()+interval '1 hour'","UPDATE auth.users SET banned_until=NULL"),('expired server session',"UPDATE auth.sessions SET not_after=now()-interval '1 hour'","UPDATE auth.sessions SET not_after=NULL")]:
  q(change);test(label+' denied',rpcrole('driver',app),deny=True);q(undo)
 test('mismatched session denied',rpcrole('driver',app,{'sub':ids['driver'],'role':'authenticated','session_id':ids['owner'],'exp':int(time.time())+600}),deny=True)
 q("DELETE FROM auth.sessions WHERE user_id='"+ids['driver']+"';")
 test('revoked session denied',rpcrole('driver',app),deny=True)
 q("INSERT INTO auth.sessions VALUES('"+ids['driver']+"','"+ids['driver']+"',NULL);")
 original=installed[installed.index('CREATE FUNCTION public.read_application_identity'):installed.index('-- Query consumers')].replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION',1)
 q("UPDATE applications SET user_id=NULL WHERE id='"+nullapp+"';")
 q(original)
 mutant=run(rpcrole('driver',nullapp));test('mutation control detects lost guard',rpcrole('driver',nullapp))
 results[-1]['passed']=mutant.returncode==0 and 'NULL-SECRET' in mutant.stdout
 q(repair)
 test('repaired guard rejects mutant attack',rpcrole('driver',nullapp),deny=True)
 # Emergency pause rehearsal: revoke only the sensitive RPC, retain all data/guards.
 q('REVOKE EXECUTE ON FUNCTION public.read_application_identity(uuid) FROM authenticated;')
 test('security-preserving RPC pause denies access',rpcrole('driver',app),deny=True)
 q('GRANT EXECUTE ON FUNCTION public.read_application_identity(uuid) TO authenticated;')
 test('reviewed forward repair resumes verified access',rpcrole('driver',app))
 digest=q('SELECT md5(string_agg(row_to_json(a)::text,\'\' ORDER BY id)) FROM applications a;')
 q('CREATE TABLE local_journal(hash text);CREATE FUNCTION reject_journal() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION \'journal failure\';END$$;CREATE TRIGGER reject_journal BEFORE INSERT ON local_journal FOR EACH ROW EXECUTE FUNCTION reject_journal();')
 failed=run('BEGIN;'+repair+"INSERT INTO local_journal VALUES('probe');COMMIT;")
 test('journal failure preserves data','SELECT md5(string_agg(row_to_json(a)::text,\'\' ORDER BY id)) FROM applications a;',digest)
 results.append({'test':'journal write failure reported','passed':failed.returncode!=0})
 q("INSERT INTO audit_log(action,summary) VALUES('identity_review.test','Synthetic audit');")
 test('0025 service mutation denied',"BEGIN;SET LOCAL ROLE service_role;UPDATE audit_log SET summary='changed';ROLLBACK;",deny=True)
 test('0025 truncate denied',"BEGIN;SET LOCAL ROLE service_role;TRUNCATE audit_log;ROLLBACK;",deny=True)
 # Real PostgREST HTTP requests over a private Unix socket: no network listener.
 jwt_secret=secrets.token_urlsafe(48); api_sock=b/'api.sock'
 cfg=b/'postgrest.conf';cfg.write_text('db-uri = "postgresql://fixture_owner@/postgres?host='+str(sock)+'&port=55449"\ndb-schemas = "public,storage"\ndb-anon-role = "anon"\nserver-unix-socket = "'+str(api_sock)+'"\nserver-unix-socket-mode = "600"\njwt-secret = "'+jwt_secret+'"\nlog-level = "crit"\n')
 api_log=(b/'api.log').open('wb')
 api=subprocess.Popen(['/usr/bin/sandbox-exec','-f',str(b/'isolation.sb'),'/usr/bin/env','DYLD_LIBRARY_PATH=/opt/homebrew/opt/postgresql@17/lib/postgresql','/private/tmp/rr-coordinator-postgrest/postgrest',str(cfg)],stdout=api_log,stderr=api_log,env=env)
 for _ in range(80):
  if api_sock.exists():break
  if api.poll() is not None:raise RuntimeError((b/'api.log').read_text())
  time.sleep(.1)
 class LocalHTTP(http.client.HTTPConnection):
  def connect(self):
   self.sock=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);self.sock.connect(str(api_sock))
 def token(r):
  enc=lambda v:base64.urlsafe_b64encode(json.dumps(v,separators=(',',':')).encode()).rstrip(b'=')
  msg=enc({'alg':'HS256','typ':'JWT'})+b'.'+enc({'role':'authenticated','sub':ids[r],'session_id':ids[r],'exp':int(time.time())+300})
  return (msg+b'.'+base64.urlsafe_b64encode(hmac.new(jwt_secret.encode(),msg,hashlib.sha256).digest()).rstrip(b'=')).decode()
 def http_test(name,r,method,url,body=None,status=200,check=None):
  c=LocalHTTP('localhost');headers={'Content-Type':'application/json','Prefer':'return=representation'}
  if r:headers['Authorization']='Bearer '+token(r)
  c.request(method,url,json.dumps(body) if body is not None else None,headers);resp=c.getresponse();raw=resp.read();c.close()
  data=json.loads(raw) if raw else None
  if resp.status==503: print('Synthetic HTTP diagnostic:',data)
  ok=resp.status==status and (check is None or check(data))
  results.append({'test':'HTTP '+name,'passed':ok,'status':resp.status});print(('PASS ' if ok else 'FAIL ')+'HTTP '+name+' '+str(resp.status))

 time.sleep(2)
 for n in ['owner','manager','driver']:http_test(n+' verified RPC',n,'POST','/rpc/read_application_identity',{'_application_id':app},check=lambda d:d['license_number']=='SYNTHETIC-NUMBER')
 for n in ['driver','coordinator']:http_test(n+' NULL-owner RPC denial',n,'POST','/rpc/read_application_identity',{'_application_id':nullapp},status=403)
 http_test('missing application denied','driver','POST','/rpc/read_application_identity',{'_application_id':missing},status=403)
 http_test('anonymous denied',None,'POST','/rpc/read_application_identity',{'_application_id':app},status=401)
 http_test('Coordinator safe base projection','coordinator','GET','/applications?select=id',check=lambda d:len(d)==2)
 http_test('Coordinator document denied','coordinator','GET','/documents?select=id',check=lambda d:d==[])
 http_test('Coordinator number denied','coordinator','GET','/applications?select=license_number',status=403)
 q("DELETE FROM auth.sessions WHERE user_id='"+ids['driver']+"';")
 http_test('revoked signed token denied','driver','POST','/rpc/read_application_identity',{'_application_id':app},status=403)

 q("INSERT INTO auth.sessions VALUES('"+ids['driver']+"','"+ids['driver']+"',NULL);")
 browser_config=b/'browser.json';browser_config.write_text(json.dumps({'socket':str(api_sock),'secret':jwt_secret,'ids':ids}));browser_config.chmod(0o600)
 browser_run=subprocess.run(['node',str(OUT/'browser.test.mjs'),str(browser_config)],capture_output=True,text=True,timeout=90)
 print(browser_run.stdout,browser_run.stderr);results.append({'test':'browser role isolation and direct API','passed':browser_run.returncode==0})

finally:
 if api:
  api.terminate();api.wait(timeout=15)
 if proc:
  proc.terminate();proc.wait(timeout=15)
 log.close();shutil.rmtree(b)
 (OUT/'database-results.json').write_text(json.dumps({'syntheticOnly':True,'network':'Unix socket only; server outbound denied','disposableClusterRemoved':True,'tests':results},indent=2))
if not all(r['passed'] for r in results):raise SystemExit(1)
