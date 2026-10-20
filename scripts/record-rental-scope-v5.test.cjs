const fs=require('fs'),ts=require('typescript'),assert=require('node:assert/strict');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);
const {trustedIssuer,authenticatedConsumption}=require('../src/lib/record-rental-transport.server.ts');
const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let transactions=[],principal={actorId:id(1),sessionId:id(2),role:'Owner'},deny=false;
const sql={transaction:async fn=>{let calls=[];transactions.push(calls);return fn(async(s,args)=>{calls.push({s,args});if(s.includes('current_user'))return [{role:'rr_evidence_issuer'}];if(s.includes('set_config'))return [{}];return [{value:s.includes('issue_record')?id(9):s.includes('recover_record')?null:{}}]})}};
const trusted=trustedIssuer(sql,async()=>{if(deny)throw Error('revoked');return principal});
(async()=>{
 await trusted.identity(id(3));await trusted.issuer.snapshot(id(3),id(4),id(5),id(6));
 await trusted.issuer.issue({applicationId:id(3),vehicleId:id(4)}, {}, {});
 await trusted.bindDocument(id(6),{driver_id:id(3)},'a'.repeat(64),'immutable',id(5));
 await trusted.recover(id(7));
 for(const [i,t] of transactions.entries()){
  assert.equal(t.length,4);assert.match(t[1].s,/request.jwt.claims/);assert.deepEqual(JSON.parse(t[1].args[0]),{sub:id(1),session_id:id(2),role:'authenticated'});
  assert.match(t[2].s,/record.application_id/);assert.match(t[2].s,/,true/);
  assert.deepEqual(t[2].args,i===4?['','']:[id(3),[1,2].includes(i)?id(4):'']);
 }
 console.log('PASS issuer identity, snapshot, issuance, binding and recovery have independent transaction-local scopes (5)');
 deny=true;let count=transactions.length;await assert.rejects(trusted.identity(id(3)),/revoked/);assert.equal(transactions.length,count);deny=false;
 let checks=0;const revoked=trustedIssuer(sql,async()=>{if(++checks>1)throw Error('revoked');return principal});await assert.rejects(revoked.identity(id(3)),/revoked/);
 console.log('PASS revoked authorization before SQL and after SQL rejects response (2)');
 let rpcCalls=0;const consume=authenticatedConsumption({rpc:async(name,args)=>{rpcCalls++;assert.equal(name,'record_existing_rental_evidence_v1');assert.deepEqual(args,{token:id(9),req:{operationId:id(7)}});return {data:{ok:true},error:null}}});
 assert.deepEqual(await consume(id(9),{operationId:id(7)}),{ok:true});assert.equal(rpcCalls,1);
 console.log('PASS consumption sends token/request once; database independently derives scope (1)');
})().catch(e=>{console.error(e);process.exitCode=1});
