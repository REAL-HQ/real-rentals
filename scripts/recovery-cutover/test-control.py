import subprocess,tempfile,os,json,time,shutil,hashlib,re
from pathlib import Path
R=Path(__file__).resolve().parent;PG='/opt/homebrew/opt/postgresql@17/bin/';node='/Users/dolmarcross/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node'
b=Path(tempfile.mkdtemp(prefix='rr-cutover-fence-',dir='/private/tmp'));b.chmod(0o700);sock=b/'sock';sock.mkdir(mode=0o700);env=dict(os.environ,LC_ALL='C');results=[];proc=None
subprocess.run([PG+'initdb','-D',str(b/'db'),'-U','fixture_owner','--auth-local=trust','--auth-host=reject'],capture_output=True,check=True,env=env)
with (b/'db/postgresql.conf').open('a') as f:f.write("\nlisten_addresses=''\nport=55461\nunix_socket_directories='"+str(sock)+"'\nunix_socket_permissions=0700\nmax_worker_processes=0\n")
(b/'sandbox').write_text('(version 1)(allow default)(deny network*)(allow network* (local unix-socket))')
log=(b/'log').open('wb');proc=subprocess.Popen(['/usr/bin/sandbox-exec','-f',str(b/'sandbox'),PG+'postgres','-D',str(b/'db')],stdout=log,stderr=log,env=env)
a=[PG+'psql','-h',str(sock),'-p','55461','-U','fixture_owner','-d','postgres','-At','-v','ON_ERROR_STOP=1']
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
 q("CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA private;CREATE TABLE application_resume_tokens(id int PRIMARY KEY, token_hash text, revoked_at timestamptz,last_used_at timestamptz);CREATE TABLE audit_log(id int,note text);INSERT INTO application_resume_tokens VALUES(1,'synthetic-hash',NULL,NULL);INSERT INTO audit_log VALUES(1,'preserved');GRANT ALL ON application_resume_tokens TO service_role;")
 before=q("SELECT row_to_json(t)::text FROM application_resume_tokens t")
 audit=q("SELECT row_to_json(t)::text FROM audit_log t")
 pause=(R/'pause.prepared.sql').read_text();resume=(R/'resume.prepared.sql').read_text()
 q(pause)
 record('pause persists after installing connection closes',q("SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'recovery_cutover_%' AND tgenabled='A'")=='2')
 for label,stmt in [('issuance',"INSERT INTO application_resume_tokens VALUES(2,'new',NULL,NULL)"),('exchange/reissue/trim',"UPDATE application_resume_tokens SET revoked_at=now()"),('deletion','DELETE FROM application_resume_tokens'),('truncate','TRUNCATE application_resume_tokens')]:
  x=q('SET ROLE service_role;'+stmt,False)
  record('service-role '+label+' refused',x.returncode!=0 and 'Recovery temporarily paused' in x.stderr)
 record('replica writer refused',q("SET session_replication_role=replica;INSERT INTO application_resume_tokens VALUES(2,'new',NULL,NULL)",False).returncode!=0)
 record('existing token and audit history unchanged',q("SELECT row_to_json(t)::text FROM application_resume_tokens t")==before and q("SELECT row_to_json(t)::text FROM audit_log t")==audit)
 record('repeat pause fails without opening fence',q(pause,False).returncode!=0 and q("INSERT INTO application_resume_tokens VALUES(2,'new',NULL,NULL)",False).returncode!=0)
 q('BEGIN;ALTER TABLE application_resume_tokens DISABLE TRIGGER recovery_cutover_rows;ROLLBACK;')
 record('interrupted change retains fence',q("INSERT INTO application_resume_tokens VALUES(2,'new',NULL,NULL)",False).returncode!=0)
 q('ALTER TABLE application_resume_tokens DISABLE TRIGGER recovery_cutover_rows;')
 record('resume refuses drift',q(resume,False).returncode!=0)
 q('ALTER TABLE application_resume_tokens ENABLE ALWAYS TRIGGER recovery_cutover_rows;')
 q(resume)
 q("SET ROLE service_role;INSERT INTO application_resume_tokens VALUES(2,'new',NULL,NULL)")
 record('restart allows new issuance preserving old token',q('SELECT count(*) FROM application_resume_tokens')=='2' and q('SELECT row_to_json(t)::text FROM application_resume_tokens t WHERE id=1')==before)
 # Negative control: absence of the guard really allows the previously forbidden write.
 record('guard-removal negative control detected',q("INSERT INTO application_resume_tokens VALUES(3,'negative',NULL,NULL)",False).returncode==0)
 import importlib.util
 spec=importlib.util.spec_from_file_location('drain',R/'drain-gate.py');gate=importlib.util.module_from_spec(spec);spec.loader.exec_module(gate)
 record('missing queue evidence blocks restart',bool(gate.blockers({})))
 e={k:True for k in ['target_verified','fence_verified','cron_paused','all_origins_inventoried','old_instances_quiesced','provider_inventory_complete','pre_pause_sends_reconciled','tokens_preserved','audit_preserved','published_candidate_verified','restart_approved']}
 e.update({k:0 for k in ['inflight_requests','pending_http_jobs','unaccounted_deliveries','retrying_deliveries','unknown_delivery_outcomes']});e.update({k:'synthetic-evidence' for k in ['provider_evidence_ref','origin_inventory_ref','fence_evidence_ref']})
 record('complete synthetic evidence accepted for review',not gate.blockers(e))
 e['unknown_delivery_outcomes']=1
 record('ambiguous in-flight send forbids replay/restart',bool(gate.blockers(e)))
 e['unknown_delivery_outcomes']=False
 record('false cannot masquerade as zero',bool(gate.blockers(e)))
 assert all(x['passed'] for x in results)
finally:
 if proc:proc.terminate();proc.wait(timeout=20);log.close()
 shutil.rmtree(b)
 (R/'test-results.json').write_text(json.dumps({'checks':results,'scope':'storage fence and offline drain gate; not real provider queue testing','database_removed':True},indent=2)+'\n')
