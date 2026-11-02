#!/usr/bin/env python3
# Compare two saved b-objects results (e.g. staging vs production). Usage: b-compare-files.py <prod_result> <other_result>
import json,sys
def load(f):
  t=open(f).read(); dec=json.JSONDecoder()
  def find(o):
    if isinstance(o,dict):
      if {'tables','functions','policies'}<=set(o): return o
      for v in o.values():
        r=find(v)
        if r: return r
    if isinstance(o,list):
      for v in o:
        r=find(v)
        if r: return r
    if isinstance(o,str) and '[{' in o:
      j=o.index('[{')
      try: return find(json.JSONDecoder().raw_decode(o[j:])[0])
      except Exception: pass
  i=0
  while True:
    i=t.find('{',i)
    if i<0: return None
    try: o,_=dec.raw_decode(t[i:]); r=find(o)
    except Exception: r=None
    if r: return r
    i+=1
P=load(sys.argv[1]); L=load(sys.argv[2]); same=0; d=[];mp=[];ml=[]
for k in ['tables','functions','policies','triggers','indexes','views','columns']:
  a=P.get(k) or {}; b=L.get(k) or {}
  for n in set(a)|set(b):
    if a.get(n)==b.get(n): same+=1
    elif b.get(n) is None: mp.append(f'{k}:{n}')
    elif a.get(n) is None: ml.append(f'{k}:{n}')
    else: d.append(f'{k}:{n}')
print('objects compared',same+len(d)+len(mp)+len(ml),'identical (incl. both-absent)',same)
print('present in prod, missing in target',len(mp),mp); print('present in target, absent in prod',len(ml),ml); print('definition differs',len(d),d)
