"""Local file/order verification only. Does not connect to a database or execute SQL."""
import hashlib,json,sys,tempfile,shutil
from pathlib import Path
HERE=Path(__file__).resolve().parent
SQL='drizzle/migrations/0031_guarded_coordinator_containment.sql'
JOURNAL='drizzle/migrations/meta/_journal.json'
SQL_HASH='479d44d3377103c78894ee46426621ca777dc9de68832918d5dcaf8fd6309f0a'
JOURNAL_HASH='1f76f03b72ede4d4af28b0823f3a20266819ffdb1744d9146553bdb653cb81dc'
MANIFEST_HASH='e4df55f71abffa847a86331ae2ebbbf30b2252839fddb27c2d3fb24f0b3ff22d'
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def verify(root):
 assert digest(HERE/'baseline.json')=='0d9ecc0c13e694c90de3e7a53e0b798de739ea7056b9bc528aeab5b39a93fbcb','VERIFIER_BASELINE_DRIFT'
 b=json.loads((HERE/'baseline.json').read_text())
 assert digest(HERE/'APPROVED-PACKAGE-MANIFEST.json')==MANIFEST_HASH,'MANIFEST_DRIFT'
 actual={str(p.relative_to(root)) for p in (root/'drizzle/migrations').rglob('*') if p.is_file()}
 assert actual==set(b['files'])|{SQL},'INVENTORY_DRIFT'
 for f,h in b['files'].items():
  if f!=JOURNAL:assert digest(root/f)==h,'HISTORICAL_FILE_DRIFT: '+f
 assert digest(root/SQL)==SQL_HASH,'SQL_DRIFT'
 assert digest(root/JOURNAL)==JOURNAL_HASH,'JOURNAL_DRIFT'
 j=json.loads((root/JOURNAL).read_text())['entries'];old=b['journal']['entries'];rows=b['receipts']
 assert len(j)==23 and j[:22]==old and len(rows)==22,'BASELINE_DRIFT'
 for e,row in zip(old,rows):
  assert e['when']==row['created_at'] and digest(root/('drizzle/migrations/'+e['tag']+'.sql'))==row['hash'],'RECEIPT_DRIFT'
 pending=[e['tag'] for e in j if e['when']>max(r['created_at'] for r in rows)]
 assert pending==['0031_guarded_coordinator_containment'],'PENDING_SET_DRIFT'
 return {'pending':pending,'historicalSQL':22,'historicalSnapshots':len([f for f in b['files'] if f.endswith('_snapshot.json')])}
root=Path(sys.argv[1]).resolve() if len(sys.argv)>1 else HERE.parents[1]
result=verify(root)
if '--test' in sys.argv:
 checks=[]
 for case in ['extra_sql','extra_snapshot','missing_snapshot','changed_snapshot','changed_historical_sql','changed_guarded_sql','extra_entry','backdate']:
  with tempfile.TemporaryDirectory(prefix='rr0031-inventory-') as d:
   t=Path(d);shutil.copytree(root/'drizzle',t/'drizzle')
   snapshots=sorted((t/'drizzle/migrations/meta').glob('*_snapshot.json'))
   if case=='extra_sql':(t/'drizzle/migrations/0022_unapproved.sql').write_text('SELECT 1;')
   elif case=='extra_snapshot':(t/'drizzle/migrations/meta/0022_snapshot.json').write_text('{}')
   elif case=='missing_snapshot':snapshots[0].unlink()
   elif case=='changed_snapshot':snapshots[0].write_text('{}')
   elif case=='changed_historical_sql':(t/'drizzle/migrations/0000_fleet_inbox_job_queue.sql').write_text('SELECT 1;')
   elif case=='changed_guarded_sql':(t/SQL).write_text('SELECT 1;')
   else:
    j=json.loads((t/JOURNAL).read_text())
    if case=='extra_entry':j['entries'].append({'idx':23,'when':9999999999999,'tag':'unapproved'})
    else:j['entries'][-1]['when']=0
    (t/JOURNAL).write_text(json.dumps(j))
   try:verify(t)
   except AssertionError:checks.append(case+' rejected')
   else:raise AssertionError(case+' was accepted')
 result['negativeControls']=checks
print(json.dumps(result,indent=2))
