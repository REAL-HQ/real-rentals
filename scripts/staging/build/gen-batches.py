#!/usr/bin/env python3
"""Generate the t33u + t35 staging build submissions. Usage: gen-batches.py <sysid> <outdir>
Each file = ONE submission: db-guard first, then BEGIN … COMMIT. Cron safeguard (t35): after every file that
schedules a cron job, in the same transaction, unschedule every job referencing drivereal.com. After drizzle 0000/0001,
assert 'fleet-inbox' is absent from private.cron_tokens."""
import sys,os,re
SYS,OUT=sys.argv[1],sys.argv[2]; R=os.path.abspath(os.path.join(os.path.dirname(__file__),'../../..')); os.makedirs(OUT,exist_ok=True)
GUARD=f"""DO $guard$ DECLARE s text := (SELECT system_identifier::text FROM pg_control_system()); BEGIN
  IF s IN ('7642734024280108049','7692130048193495360') OR s <> '{SYS}' THEN RAISE EXCEPTION 'refused: system id % is not the approved target', s; END IF; END $guard$;\n"""
SAFE="""\n-- t35 safeguard (staging-only): same transaction as the cron-scheduling migration above
DO $safe$ BEGIN IF to_regclass('cron.job') IS NOT NULL THEN PERFORM cron.unschedule(jobid) FROM cron.job WHERE command LIKE '%drivereal.com%'; END IF;
 IF to_regclass('cron.job') IS NOT NULL AND EXISTS (SELECT 1 FROM cron.job WHERE command LIKE '%drivereal.com%') THEN RAISE EXCEPTION 'safeguard: drivereal.com cron job remains'; END IF; END $safe$;\n"""
NOFLEET="""\n-- t35 safeguard: keep 'fleet-inbox' out of private.cron_tokens (drizzle 0000 inserts it; removed in the same transaction, so it never commits)
DELETE FROM private.cron_tokens WHERE name='fleet-inbox';
DO $nf$ BEGIN IF to_regclass('private.cron_tokens') IS NOT NULL AND EXISTS (SELECT 1 FROM private.cron_tokens WHERE name='fleet-inbox') THEN RAISE EXCEPTION 'safeguard: fleet-inbox token present'; END IF; END $nf$;\n"""
items=[]
pre=f"""-- step 00: platform defaults (Lovable sandbox_exec role + its default grant; Supabase already has the anon/authenticated/service_role defaults) and drizzle ledger table
DO $r$ BEGIN CREATE ROLE sandbox_exec NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $r$;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT, INSERT ON TABLES TO sandbox_exec;
GRANT USAGE ON SCHEMA public TO sandbox_exec;
CREATE SCHEMA IF NOT EXISTS drizzle;
CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations(id serial primary key, hash text not null, created_at bigint);
"""
items.append(('00-platform-defaults',pre,False))
for f in open(f'{R}/scripts/staging/local-rehearsal/supabase-order.txt').read().split():
  p=f'{R}/scripts/staging/local-rehearsal/{f}' if f.startswith('GAPFILL-') else f'{R}/supabase/migrations/{f}'
  items.append((f,open(p).read(),True))
import glob
for p in sorted(glob.glob(f'{R}/drizzle/migrations/00[01]*.sql'))+sorted(glob.glob(f'{R}/drizzle/migrations/002[0-2]*.sql')):
  pass
dz=sorted(p for p in glob.glob(f'{R}/drizzle/migrations/00*.sql') if int(os.path.basename(p)[:4])<=22)
for p in dz: items.append(('drizzle/'+os.path.basename(p),open(p).read(),True))
items.append(('ledger',open(f'{R}/scripts/staging/local-rehearsal/prod-drizzle-ledger.sql').read(),False))
items.append(('PRODDEF-3-functions',open(f'{R}/scripts/staging/local-rehearsal/PRODDEF-3-functions.sql').read(),False))
items.append(('exclusions',open(f'{R}/scripts/staging/local-rehearsal/exclusions.sql').read(),False))
# batching: <=60KB; break after enum ADD VALUE; files with their own BEGIN/COMMIT go alone without outer tx
batches=[];cur=[];size=0
def flush():
  global cur,size
  if cur: batches.append(cur); cur=[]; size=0
for name,sql,mig in items:
  own=bool(re.search(r'^\s*(begin|commit)\s*;',sql,re.I|re.M))
  if own or name in('00-platform-defaults','ledger','PRODDEF-3-functions','exclusions') or size+len(sql)>60000: flush()
  cur.append((name,sql,own)); size+=len(sql)
  if own or re.search(r'add\s+value',sql,re.I) or name in('00-platform-defaults',) : flush()
flush()
man=[]
for i,b in enumerate(batches):
  own=any(x[2] for x in b)
  body=GUARD+('' if own else 'BEGIN;\n')
  for name,sql,_ in b:
    body+=f'\n-- ===== {name}\n'+sql.rstrip()+'\n'
    if re.search(r'cron\.schedule',sql) and not name.startswith(('drizzle/0000','drizzle/0001')) : body+=SAFE
    if name.startswith(('drizzle/0000','drizzle/0001')) : body+=NOFLEET+SAFE
  body+=('' if own else '\nCOMMIT;\n')
  fn=f'{OUT}/b{i:03d}.sql'; open(fn,'w').write(body); man.append(f'b{i:03d} {len(body)} '+' '.join(x[0] for x in b))
open(f'{OUT}/MANIFEST.txt','w').write('\n'.join(man)+'\n'); print(len(batches),'submissions')
