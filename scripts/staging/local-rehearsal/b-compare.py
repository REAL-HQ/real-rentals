#!/usr/bin/env python3
# Compares local b-objects-readonly.sql output against production's recorded result (JSON file arg 2). LOCAL ONLY.
import json,subprocess,sys
db=sys.argv[1]; prodf=sys.argv[2]
q=open(__file__.rsplit('/',1)[0]+'/b-objects-readonly.sql').read().replace('SET TRANSACTION READ ONLY;','')
loc=subprocess.run(['psql','-h','/tmp','-p','55499','-U','postgres','-qAtX','-d',db,'-c','BEGIN READ ONLY','-c',q,'-c','ROLLBACK'],capture_output=True,text=True).stdout
loc=json.loads([l for l in loc.splitlines() if l.startswith('{')][0])
t=open(prodf).read(); prod=None
dec=json.JSONDecoder()
for i in range(len(t)):
  if t[i]=='{':
    try:
      o,_=dec.raw_decode(t[i:])
    except Exception: continue
    def find(o):
      if isinstance(o,dict):
        if set(['tables','functions','policies']).issubset(o): return o
        for v in o.values():
          r=find(v)
          if r: return r
      if isinstance(o,list):
        for v in o:
          r=find(v)
          if r: return r
      if isinstance(o,str) and o.strip().startswith('{'):
        try: return find(json.loads(o))
        except Exception: pass
    prod=find(o)
    if prod: break
same=diff=0; d=[]; mp=[]; ml=[]
for k in ['tables','functions','policies','triggers','indexes','views','columns']:
  P=prod.get(k) or {}; L=loc.get(k) or {}
  for n in set(P)|set(L):
    a=P.get(n); b=L.get(n)
    if a==b: same+=1
    elif b is None: mp.append(f'{k}:{n}')
    elif a is None: ml.append(f'{k}:{n}')
    else: d.append(f'{k}:{n}')
print('objects compared',same+len(d)+len(mp)+len(ml),'identical (incl. both-absent)',same)
print('present in prod, missing locally',len(mp),mp); print('present locally, absent in prod',len(ml),ml); print('definition differs',len(d),d)
