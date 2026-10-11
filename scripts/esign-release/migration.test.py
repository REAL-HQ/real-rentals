import subprocess,tempfile,os,json,time,shutil,base64,hmac,hashlib,socket,http.client,secrets
from pathlib import Path
OUT=Path(__file__).resolve().parent; ROOT=OUT.parents[1]; PG='/opt/homebrew/opt/postgresql@17/bin/';env=dict(os.environ,LC_ALL='C')
b=Path(tempfile.mkdtemp(prefix='rr-coordinator-synthetic-',dir='/private/tmp'));b.chmod(0o700);sock=b/'socket';sock.mkdir(mode=0o700);db=b/'data';results=[];proc=None;api=None
subprocess.run([PG+'initdb','-D',str(db),'-U','fixture_owner','--auth-local=trust','--auth-host=reject','--encoding=UTF8'],capture_output=True,env=env,check=True)
with (db/'postgresql.conf').open('a') as f:f.write("\nlisten_addresses=''\nport=55447\nunix_socket_directories='"+str(sock)+"'\nunix_socket_permissions=0700\nmax_worker_processes=0\nshared_preload_libraries=''\n")
(b/'isolation.sb').write_text('(version 1)(allow default)(deny network*)(allow network* (local unix-socket))')
log=(b/'server.log').open('wb');proc=subprocess.Popen(['/usr/bin/sandbox-exec','-f',str(b/'isolation.sb'),PG+'postgres','-D',str(db)],stdout=log,stderr=log,env=env)
args=[PG+'psql','-h',str(sock),'-p','55447','-U','fixture_owner','-d','postgres','-At','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose']
def run(s):return subprocess.run(args,input=s,text=True,capture_output=True,env=env)
def q(s):
 r=run(s)
 if r.returncode:raise RuntimeError(r.stderr)
 return r.stdout.strip()
def test(name,s,want=None,deny=False):
 r=run(s);ok=('42501' in r.stderr and r.returncode!=0) if deny else (r.returncode==0 and (want is None or want in r.stdout.splitlines()))
 results.append({'test':name,'passed':ok});print(('PASS ' if ok else 'FAIL ')+name)
 if not ok:print(r.stderr,r.stdout)
try:
 for _ in range(60):
  if run('SELECT 1').returncode==0:break
  time.sleep(.1)
 q("CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA extensions;CREATE EXTENSION pgcrypto WITH SCHEMA extensions;CREATE SCHEMA private;CREATE SCHEMA auth;CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT NULL::uuid$$;CREATE FUNCTION public.has_role(uuid,text) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;CREATE FUNCTION private.is_staff() RETURNS boolean LANGUAGE sql AS $$SELECT true$$;CREATE FUNCTION private.is_manager() RETURNS boolean LANGUAGE sql AS $$SELECT false$$;CREATE TABLE applications(id uuid PRIMARY KEY);CREATE TABLE documents(id uuid PRIMARY KEY);CREATE TABLE agreement_templates(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text,version int,body text,is_active boolean);CREATE TABLE agreements(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),status text,body text,merge_data jsonb,template_id uuid);ALTER TABLE agreements ENABLE ROW LEVEL SECURITY;INSERT INTO agreements(status,body,merge_data) VALUES('signed','SIGNED HISTORY','{}');CREATE TABLE journal(hash text UNIQUE,executed_at timestamptz DEFAULT clock_timestamp());")
 a=(OUT/'0023_esign_template_versioning_library.sql').read_text();migration_24=(OUT/'0024_esign_agreement_numbering.sql').read_text()
 failure=run('BEGIN;'+a+"INSERT INTO journal(hash) VALUES('x'),('x');COMMIT;")
 results.append({'test':'failed journal rolls back 0023 installation','passed':failure.returncode!=0 and q("SELECT to_regclass('public.rental_insurance_verifications') IS NULL;")=='t'})
 q('BEGIN;'+a+"INSERT INTO journal(hash) VALUES('0023');COMMIT;")
 q('BEGIN;'+migration_24+"INSERT INTO journal(hash) VALUES('0024');COMMIT;")
 test('signed history preserved',"SELECT body FROM agreements WHERE status='signed';",'SIGNED HISTORY')
 test('legacy agreement numbers remain NULL','SELECT agreement_number IS NULL FROM agreements;','t')
 attempt=run("UPDATE agreements SET body='changed';")
 results.append({'test':'signed content edit refused','passed':attempt.returncode!=0})
 for field,value in [('template_key',"'altered'"),('insurance_snapshot',"'{}'::jsonb"),('preview_fingerprint',"'altered'")]:
  attempt=run('UPDATE agreements SET '+field+'='+value+';');results.append({'test':'signed '+field+' immutable','passed':attempt.returncode!=0})
 q("INSERT INTO agreement_templates(name,version,body,template_key) VALUES('Synthetic',1,'Synthetic wording','no_insurance');")
 attempt=run("UPDATE agreement_templates SET body='changed';")
 results.append({'test':'template wording immutable','passed':attempt.returncode!=0})
 attempt=run("INSERT INTO rental_insurance_verifications(application_id,carrier,policy_number,status) VALUES(gen_random_uuid(),'Synthetic','SYNTHETIC','verified');")
 results.append({'test':'unattributed verified insurance refused','passed':attempt.returncode!=0 and 'requires actor' in attempt.stderr})
 q("UPDATE agreements SET agreement_number=next_agreement_number();")
 attempt=run("UPDATE agreements SET agreement_number='RRA-999999';")
 results.append({'test':'issued number immutable','passed':attempt.returncode!=0})
 import concurrent.futures
 with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool: numbers=list(pool.map(lambda _:q('SELECT next_agreement_number();'),range(24)))
 results.append({'test':'24 concurrent numbers unique','passed':len(set(numbers))==24})
 attempt=run('BEGIN;'+a+'COMMIT;')
 results.append({'test':'raw repeat install refuses safely','passed':attempt.returncode!=0})
 test('repeat failure preserves signed history',"SELECT body FROM agreements;",'SIGNED HISTORY')
 test('agreements restrictive boundary installed',"SELECT count(*) FROM pg_policy WHERE polname='identity_agreement_boundary' AND NOT polpermissive;",'1')
 test('journal reflects execution order',"SELECT string_agg(hash,',' ORDER BY executed_at) FROM journal;",'0023,0024')
 for r in results:print(('PASS ' if r['passed'] else 'FAIL ')+r['test'])
finally:
 if api:
  api.terminate();api.wait(timeout=15)
 if proc:
  proc.terminate();proc.wait(timeout=15)
 log.close();shutil.rmtree(b)
 (OUT/'database-results.json').write_text(json.dumps({'syntheticOnly':True,'network':'Unix socket only; server outbound denied','disposableClusterRemoved':True,'tests':results},indent=2))
if not all(r['passed'] for r in results):raise SystemExit(1)
