// Execute the actual query fragments against the real Supabase query builder.
// HTTP is intercepted in memory; no network, database or production values.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { createClient } from '@supabase/supabase-js';
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
const fleet=readFileSync('src/lib/fleet-inbox.functions.ts','utf8');
const start=fleet.indexOf('    const cols =',fleet.indexOf('export const getVehicleSuggestions'));
const end=fleet.indexOf('    const seenIds',start);
assert(start>0 && end>start);
const query=new AsyncFunction('sb','vin','target',transformSync(fleet.slice(start,end), {loader:'ts'}).code+'\nreturn exactRows;');
const id='10000000-0000-4000-8000-000000000001';
let urls=[];
const rows=Array.from({length:210},(_,i)=>({id:String(i),created_at:new Date(2026,0,1,0,0,i).toISOString()})).reverse();
const sb=createClient('https://fixture.invalid','fixture-key',{auth:{persistSession:false},global:{fetch:async(url)=>{
 const u=new URL(url);urls.push(u);
 const result=u.searchParams.has('vin')?rows.slice(0,200):u.searchParams.has('match_vehicle_id')?rows.slice(10,210):[];
 return new Response(JSON.stringify(result),{headers:{'content-type':'application/json'}});
}}});
for(const vin of ['1HGCM82633A004352','X,match_vehicle_id.not.is.null','X),or(id.not.is.null','".,()\\\n']) {
 urls=[];const result=await query(sb,vin,{id});
 assert(urls.every(u=>!u.searchParams.has('or')));
 assert.equal(urls.find(u=>u.searchParams.has('vin')).searchParams.get('vin'),'eq.'+vin);
 assert.equal(urls.find(u=>u.searchParams.has('match_vehicle_id')).searchParams.get('match_vehicle_id'),'eq.'+id);
 assert.equal(result.length,200);assert.deepEqual(result,rows.slice(0,200));
}
urls=[];await query(sb,'',{id});assert.equal(urls.length,2);
console.log('PASS literal VINs, hostile stored VINs, linked IDs, deduplication, newest-200 cap and empty VIN');
const auto=readFileSync('src/lib/safe-autofill.server.ts','utf8');
const a=auto.indexOf('        let q = sb.from("vehicles")');const b=auto.indexOf('        if (error)',a);
assert(a>0&&b>a);
const update=new AsyncFunction('sb','c','vehicle',transformSync(auto.slice(a,b), {loader:'ts'}).code+'\nreturn upd;');
let stored,requests=0;
const writer=createClient('https://fixture.invalid','fixture-key',{auth:{persistSession:false},global:{fetch:async(url,init)=>{
 requests++; const u=new URL(url);assert(!u.searchParams.has('or'));assert.equal(u.searchParams.get('id'),'eq.'+id);
 const patch=JSON.parse(init.body);const field=Object.keys(patch)[0],filter=u.searchParams.get(field);
 const matches=filter==='is.null'?stored===null:filter==='eq.'?stored==='':false;
 if(matches)stored=patch[field];
 return new Response(JSON.stringify(matches?[{id}]:[]),{headers:{'content-type':'application/json'}});
}}});
for(const field of ['trim','body_type','color','fuel_type','seats']) {
 for(const blank of field==='seats'?[null]:[null,'']) {
  stored=blank;assert.equal((await update(writer,{field,value:field==='seats'?5:'Fixture'},{id,[field]:blank})).length,1);
  stored='human edit';assert.equal((await update(writer,{field,value:'overwrite'},{id,[field]:blank})).length,0);assert.equal(stored,'human edit');
 }
}
assert(requests>0);
console.log('PASS null/empty autofill semantics and protection against intervening human edits');
