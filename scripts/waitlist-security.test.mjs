import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const out=mkdtempSync(join(tmpdir(),'rr-waitlist-tests-'));
let passed=0;
async function test(name,fn){await fn();passed++;console.log('PASS',name);}
try {
  for(const name of ['date-format','waitlist-readiness']){
    const file=join(out,name+'.mjs');
    await build({entryPoints:[`scripts/${name}.test.ts`],bundle:true,platform:'node',format:'esm',outfile:file,alias:{'@':resolve('src')}});
    for(const tz of name==='date-format'?['UTC','America/New_York','America/Los_Angeles']:['UTC']){
      const r=spawnSync(process.execPath,['--test',file],{env:{...process.env,TZ:tz},encoding:'utf8'});
      assert.equal(r.status,0,r.stdout+r.stderr);console.log('PASS',name,tz);
    }
  }
  await build({entryPoints:['src/lib/waitlist.functions.ts'],bundle:true,platform:'node',format:'esm',outfile:join(out,'handler.mjs'),plugins:[{name:'synthetic-only',setup(b){
    const stubs={
      '@/lib/audit':'export const logAudit=async()=>{throw new Error("Unexpected audit write")}',
      '@tanstack/react-start':'export const createServerFn=()=>{const a={middleware:()=>a,inputValidator:()=>a,handler:f=>f};return a}',
      '@/integrations/supabase/auth-middleware':'export const requireSupabaseAuth={}',
      '@/integrations/supabase/client.server':'export const supabaseAdmin={from:(...a)=>globalThis.fixture.from(...a),rpc:(...a)=>globalThis.fixture.rpc(...a),auth:{admin:{getUserById:async()=>({data:{user:{email:null}}})}}}',
    };
    b.onResolve({filter:/.*/},args=>{
      if(stubs[args.path])return {path:args.path,namespace:'stub'};
      if(args.path==='@/components/admin/types')return {path:resolve('src/components/admin/types.ts')};
      if(args.path.startsWith('@/')){
        const allowed=['roles.server','roles','readiness-index','readiness','required-docs','fleet-summary','waitlist-reads.server'];
        if(allowed.some(x=>args.path==='@/lib/'+x))return {path:resolve('src',args.path.slice(2)+'.ts')};
        return {path:args.path,external:true};
      }
    });
    b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:stubs[a.path],loader:'js'}));
  }}]});
  const {listWaitlist}=await import(pathToFileURL(join(out,'handler.mjs')).href);
  let data,failTable,cap,changeCount,role,calls;
  function reset(n=1){role='coordinator';cap=37;failTable='';changeCount=false;calls=[];data={
    app_settings:[{id:'setting',key:'fleet_availability',value:{cars_available:7}}],
    waitlist:[{id:'w1',created_at:'2026-01-01',status:'waiting',market_id:'m',promoted_application_id:'a'},{id:'w2',created_at:'2026-01-02',status:'waiting',market_id:'m',promoted_application_id:null}],
    applications:[{id:'a',license_valid:true,license_photo_url:'PRIVATE_PATH',insurance_doc_url:'SECRET',platforms:['uber']}],
    driver_screenings:[{id:'s',lead_id:'a',has_dui:true,card_in_own_name:false}],
    documents:[{id:'d',driver_id:'a',lead_id:'a',category:'license_front'}],
    vehicles:Array.from({length:n},(_,i)=>({id:'v'+String(i).padStart(5,'0'),status:'available',archived_at:null})),
    rentals:[],inspections:Array.from({length:n},(_,i)=>({id:'i'+i,vehicle_id:'v'+String(i).padStart(5,'0'),inspection_type:'pre_delivery',status:'passed'})),
  };}
  globalThis.fixture={from(table){let rows=table==='user_roles'?(role?[{role}]:[]):(data[table]||[]);let from=0,to=Infinity,counted=false;const q={
    select(_s,opt){counted=opt?.count==='exact';return q},eq(k,v){rows=rows.filter(r=>r[k]===v||table==='user_roles');return q},is(k,v){rows=rows.filter(r=>(r[k]??null)===v);return q},in(k,v){assert.ok(v.length<=50);rows=rows.filter(r=>v.includes(r[k]));return q},order(k){rows=[...rows].sort((a,b)=>String(a[k]).localeCompare(String(b[k])));return q},range(a,b){from=a;to=b;return q},maybeSingle(){return Promise.resolve({data:rows[0]??null,error:failTable===table?{}:null})},then(ok,bad){calls.push({table,from});const r={data:failTable===table?null:rows.slice(from,Math.min(to+1,from+cap)),count:counted?rows.length+(changeCount&&from>0?1:0):null,error:failTable===table?{}:null};return Promise.resolve(r).then(ok,bad)}};return q},async rpc(){return {data:[],error:failTable==='rpc'?{}:null}}};
  const call=()=>listWaitlist({context:{userId:'synthetic'}});
  await test('Coordinator wire response is summary-only and queue/override unchanged',async()=>{reset();const r=await call();assert.deepEqual(Object.keys(r.entries[0].readiness.result).sort(),['coverage','state']);assert.ok(!/PRIVATE_PATH|SECRET|DUI|factors|disqualifiers|card_in_own_name/.test(JSON.stringify(r)));assert.equal(r.entries[1].readiness,null);assert.deepEqual(r.entries.map(e=>e.position),[1,2]);assert.equal(r.carsAvailable,7);});
  for(const tier of ['admin','team'])await test(tier+' retains list access',async()=>{reset();role=tier;assert.equal((await call()).entries.length,2)});
  for(const tier of ['driver',null])await test(String(tier)+' denied before application reads',async()=>{reset();role=tier;await assert.rejects(call);assert.ok(!calls.some(c=>c.table==='applications'))});
  for(const table of ['rentals','inspections','vehicles','applications','driver_screenings','documents','rpc','waitlist','app_settings'])await test(table+' error rejects instead of zero/ready',async()=>{reset();failTable=table;await assert.rejects(call)});
  await test('1205 vehicles cross server caps and IN batches with exact counts',async()=>{reset(1205);data.rentals=[{id:'r',vehicle_id:'v01204',status:'active'}];const r=await call();assert.equal(r.fleet.fleetAvailable,1205);assert.equal(r.fleet.rentalReady,1204);assert.ok(calls.filter(c=>c.table==='vehicles').length>6)});
  await test('large repeated inspection/rental rows do not truncate later busy vehicle',async()=>{reset(2);cap=2;data.rentals=[...Array.from({length:10},(_,i)=>({id:'r'+i,vehicle_id:'v00000',status:'active'})),{id:'zz',vehicle_id:'v00001',status:'active'}];assert.equal((await call()).fleet.rentalReady,0)});
  await test('changing page count fails closed',async()=>{reset(50);changeCount=true;await assert.rejects(call)});
  await test('partial page with missing count is rejected',async()=>{reset(50);const original=globalThis.fixture.from;globalThis.fixture.from=(table)=>{const q=original(table);if(table==='vehicles'){const then=q.then;q.then=(ok,bad)=>then(r=>ok({...r,count:null}),bad)}return q};try{await assert.rejects(call)}finally{globalThis.fixture.from=original}});
  await test('duplicate page identity is rejected',async()=>{reset(50);data.vehicles[1].id=data.vehicles[0].id;await assert.rejects(call)});
  await test('empty fleet is a verified zero',async()=>{reset(0);assert.deepEqual((await call()).fleet,{fleetAvailable:0,rentalReady:0})});
  console.log(`${passed} real-handler synthetic checks passed; no hosted calls.`);
}finally{delete globalThis.fixture;rmSync(out,{recursive:true,force:true})}
