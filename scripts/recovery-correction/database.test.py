import subprocess,tempfile,os,json,time,shutil,hashlib,re
from pathlib import Path
R=Path(__file__).resolve().parent;PG='/opt/homebrew/opt/postgresql@17/bin/';node='/Users/dolmarcross/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node'
b=Path(tempfile.mkdtemp(prefix='rr-recovery-correction-',dir='/private/tmp'));b.chmod(0o700);sock=b/'sock';sock.mkdir(mode=0o700);env=dict(os.environ,LC_ALL='C');results=[];proc=None
subprocess.run([PG+'initdb','-D',str(b/'db'),'-U','fixture_owner','--auth-local=trust','--auth-host=reject'],capture_output=True,check=True,env=env)
with (b/'db/postgresql.conf').open('a') as f:f.write("\nlisten_addresses=''\nport=55463\nunix_socket_directories='"+str(sock)+"'\nunix_socket_permissions=0700\nmax_worker_processes=0\n")
(b/'sandbox').write_text('(version 1)(allow default)(deny network*)(allow network* (local unix-socket))')
log=(b/'log').open('wb');proc=subprocess.Popen(['/usr/bin/sandbox-exec','-f',str(b/'sandbox'),PG+'postgres','-D',str(b/'db')],stdout=log,stderr=log,env=env)
a=[PG+'psql','-h',str(sock),'-p','55463','-U','fixture_owner','-d','postgres','-At','-v','ON_ERROR_STOP=1']
def q(sql,ok=True):
 p=subprocess.run(a,input=sql,text=True,capture_output=True,env=env)
 if ok and p.returncode:raise RuntimeError(p.stderr)
 return p.stdout.strip() if ok else p
quote=lambda x:'"'+x.replace('"','""')+'"'
def record(n,c):results.append({'test':n,'passed':bool(c)});print(('PASS ' if c else 'FAIL ')+n,flush=True)
try:
 for _ in range(60):
  if q('SELECT 1',False).returncode==0:break
  time.sleep(.1)
 q("""CREATE SCHEMA cron;CREATE SCHEMA net;CREATE SCHEMA private;CREATE SCHEMA auth;
 CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE cron.job(jobid bigint PRIMARY KEY,jobname text,schedule text,command text,active boolean);
 CREATE FUNCTION cron.alter_job(job_id bigint,command text) RETURNS void LANGUAGE sql AS $$UPDATE cron.job SET command=$2 WHERE jobid=$1$$;
 CREATE TABLE private.cron_tokens(name text,token text);INSERT INTO private.cron_tokens VALUES('wizard-recovery','synthetic');
 CREATE TABLE net.calls(url text,headers jsonb,body jsonb);
 CREATE FUNCTION net.http_post(url text,body jsonb DEFAULT '{}',params jsonb DEFAULT '{}',headers jsonb DEFAULT '{}',timeout_milliseconds integer DEFAULT 1000) RETURNS bigint LANGUAGE plpgsql AS $$BEGIN INSERT INTO net.calls VALUES(url,headers,body);RETURN 1;END$$;
 """)
 root=R.parents[1]
 old=(root/'supabase/migrations/20260722235657_f2c6714d-16f7-4b08-9114-676af87ffed4.sql').read_text().split('$cron$')[1]
 literal=lambda v:"'"+v.replace("'","''")+"'"
 q("INSERT INTO cron.job VALUES(2,'wizard-recovery-hourly','15 * * * *',"+literal(old)+",false),(3,'unrelated','30 13 * * *','SELECT 1',true)")
 sql=(R/'scheduler.prepared.sql').read_text();q(sql)
 record('cadence, identity, pause and unrelated job preserved',q("SELECT count(*) FROM cron.job WHERE (jobid=2 AND schedule='15 * * * *' AND NOT active) OR (jobid=3 AND command='SELECT 1' AND active)")=='2')
 record('installation never invokes HTTP',q('SELECT count(*) FROM net.calls')=='0')
 command=q('SELECT command FROM cron.job WHERE jobid=2');q(command)
 record('existing route and authentication contract invoked through net',q("SELECT count(*) FROM net.calls WHERE url='https://drivereal.com/api/public/cron/wizard-recovery' AND headers->>'Authorization'='Bearer synthetic' AND body='{}'")=='1')
 record('reapplication fails closed',q(sql,False).returncode!=0)
 q('UPDATE cron.job SET command='+literal(old)+' WHERE jobid=2;DROP FUNCTION net.http_post(text,jsonb,jsonb,jsonb,integer)')
 record('missing HTTP dependency fails visibly', 'SUPPORTED_HTTP_DEPENDENCY_MISSING' in q(sql,False).stderr)
 record('failed repair preserves original command',q('SELECT md5(command) FROM cron.job WHERE jobid=2')=='1c830e7409ddcb0275cea04ffcca74c9')
 q('UPDATE cron.job SET active=true WHERE jobid=2')
 record('active scheduler refused', 'RECOVERY_JOB_NOT_PAUSED_OR_DRIFT' in q(sql,False).stderr)
 q("""CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$SELECT 'service_role'::text$$;
 CREATE TABLE applications(id uuid PRIMARY KEY,full_name text,email text,deleted_at timestamptz,purged_at timestamptz,resubmission_history jsonb DEFAULT '[]');
 CREATE TABLE application_resume_tokens(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),application_id uuid,token_hash text,created_at timestamptz,expires_at timestamptz,revoked_at timestamptz);
 CREATE TABLE audit_log(id int,note text);INSERT INTO audit_log VALUES(1,'synthetic preserve');
 INSERT INTO applications(id,full_name,email) VALUES('10000000-0000-4000-8000-000000000001','Synthetic','fixture@example.invalid');
 INSERT INTO application_resume_tokens VALUES(gen_random_uuid(),'10000000-0000-4000-8000-000000000001','old-synthetic',now(),now()+interval '1 day',NULL);
 """)
 migration=(root/'scripts/app-resume-integration/0022_application_resume_atomic_security.sql').read_text().split('-- Called using the authenticated caller')[0];q(migration)
 reserve="SELECT reserve_application_recovery('10000000-0000-4000-8000-000000000001',repeat('a',64))"
 d=json.loads(q(reserve));record('durable reservation before any provider send',d['reserved'] and q('SELECT count(*) FROM application_recovery_attempts')=='1')
 record('duplicate issuance denied',not json.loads(q(reserve))['reserved'])
 q("SELECT finish_application_recovery('"+d['attempt_id']+"','unknown',NULL)")
 record('unknown retains quota',not json.loads(q(reserve))['reserved'])
 record('unknown token remains valid',q('SELECT count(*) FROM application_resume_tokens WHERE revoked_at IS NULL')=='2')
 q("SELECT finish_application_recovery('"+d['attempt_id']+"','sent','synthetic-provider')")
 record('unknown cannot silently be relabeled sent',q('SELECT status FROM application_recovery_attempts')=='unknown')
 record('existing token and audit preserved',q("SELECT count(*) FROM application_resume_tokens WHERE token_hash='old-synthetic' AND revoked_at IS NULL")=='1' and q('SELECT note FROM audit_log')=='synthetic preserve')
 q('BEGIN;DELETE FROM application_recovery_attempts;ROLLBACK')
 record('interrupted transaction preserves cooldown',not json.loads(q(reserve))['reserved'])
 # Negative control proves loss of the reservation defeats duplicate protection.
 q('DELETE FROM application_recovery_attempts')
 record('reservation-removal negative control exposes duplicate',json.loads(q(reserve))['reserved'])
 assert all(x['passed'] for x in results)
finally:
 if proc:proc.terminate();proc.wait(timeout=20);log.close()
 shutil.rmtree(b)
 (R/'database-results.json').write_text(json.dumps({'checks':results,'database_removed':True,'http':'local SQL contract stub; no HTTP network'},indent=2)+'\n')
