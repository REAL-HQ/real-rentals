import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { readFinanceDatabaseEvidence, FINANCE_PROJECTIONS } from '../src/lib/unified-finance-database-transport.server';
import { readFinanceProviderEvents, type FinanceEventGateway } from '../src/lib/unified-finance-provider-events.server';
import { disabledUnifiedFinanceResponse } from '../src/lib/unified-finance-report.server';
import { mapFinanceSource } from '../src/lib/unified-finance-live-mapping';
import { reconcileFinance } from '../src/lib/unified-finance-reconciliation';
import type { SourceActor } from '../src/lib/unified-finance-source-contracts';

type Row = Record<string, unknown>;
function database(roles=['admin'], rows: Row[] = [{id:'a',sensitivity:'standard',amount:10}], options: {error?:boolean; change?:boolean; overlap?:boolean; roleChange?:boolean; identity?:string; extra?:boolean}={}) {
  const calls: {table:string;columns:string;cursor:string|null;limit:number}[]=[];
  let reads=0, roleReads=0;
  const client={auth:{getUser:async()=>({data:{user:{id:options.identity??'staff'}},error:null})},from:(table:string)=>{
    let columns='',cursor:string|null=null,limit=0;
    const q={select:(s:string)=>{columns=s;return q;},eq:()=>q,order:()=>q,limit:(n:number)=>{limit=n;return q;},gt:(_k:string,v:string)=>{cursor=v;return q;},abortSignal:()=>q,
      then:(resolve:(x:unknown)=>unknown,reject?:(e:unknown)=>unknown)=>Promise.resolve().then(()=>{
        if(table==='user_roles'){roleReads++;return {data:(options.roleChange&&roleReads>2?['coordinator']:roles).map(role=>({role})),error:null};}
        reads++; calls.push({table,columns,cursor,limit});
        let data=rows.filter(r=>cursor===null || String(r.id)>cursor).slice(0,limit).map(r=>({txn_type:'payment',status:'posted',direction:'in',...r}));
        if(options.change&&reads>1&&data[0]) data[0].amount=20;
        if(options.overlap&&cursor) data=rows.slice(0,1);
        return {data,error:options.error?{message:'sensitive SQL information'}:null};
      }).then(resolve,reject)}; return q;
  }};
  return {context:{userId:'staff',supabase:client as unknown as Parameters<typeof readFinanceDatabaseEvidence>[0]['supabase']},calls};
}
const scope={account:'acct_synthetic',environment:'test' as const};
const window={gte:1704067200,lt:1706745600};
const owner=async():Promise<SourceActor>=>({userId:'staff',roles:['admin']});
function provider() {
  const c:any={id:'ch_original',livemode:false,paid:true,captured:true,status:'succeeded',amount_captured:10000,currency:'usd',customer:'cus_fixture',payment_intent:'pi_fixture',balance_transaction:'bt_charge'};
  const r:any={id:'re_partial',livemode:false,charge:c.id,status:'succeeded',amount:2500,currency:'usd',balance_transaction:'bt_refund'};
  const p:any={id:'po_fixture',livemode:false,amount:7200,currency:'usd',status:'paid',arrival_date:window.gte+500,balance_transaction:'bt_payout'};
  const balances:Record<string,any>={bt_payout:{id:'bt_payout',amount:-7200,fee:0,net:-7200,currency:'usd',created:window.gte+400,source:p.id},bt_charge:{id:'bt_charge',amount:10000,fee:300,net:9700,currency:'usd',created:window.gte-86400,source:c.id},bt_refund:{id:'bt_refund',amount:-2500,fee:0,net:-2500,currency:'usd',created:window.gte+100,source:r.id}};
  const state={charges:[c],refunds:[r],payouts:[p],account:scope.account,more:false,change:false,reads:0};
  const calls:string[]=[];
  const gateway={accounts:{retrieve:async(id:unknown)=>{expect(id).toBe(null);calls.push('account');return {id:state.account};}},charges:{list:async()=>{calls.push('charges');state.reads++;return {data:state.charges.map(x=>({...x,...(state.change&&state.reads>1?{amount_captured:9000}:{})})),has_more:state.more};},retrieve:async(id:string)=>{calls.push('parent');return {...c,id};}},refunds:{list:async()=>{calls.push('refunds');return {data:state.refunds,has_more:false};}},payouts:{list:async()=>{calls.push('payouts');return {data:state.payouts,has_more:false};}},balanceTransactions:{retrieve:async(id:string)=>{calls.push('balance');if(!balances[id])throw Error('unavailable');return {...balances[id]};}}};
  return {gateway:gateway as unknown as FinanceEventGateway,state,c,r,p,balances,calls};
}

describe('RLS-bound database evidence transport',()=>{
  for(const role of ['admin','team']) it(`allows current ${role} ledger reads`,async()=>{
    const d=database([role]);const result=await readFinanceDatabaseEvidence(d.context,'financial_transactions');
    expect(result.coverage).toBe('complete');expect(result.rows).toHaveLength(1);expect(result.rows[0].amount).toBe(10);
    expect(d.calls.every(c=>c.columns===FINANCE_PROJECTIONS.financial_transactions)).toBe(true);
    expect(result.rows[0]).not.toHaveProperty('verified');
  });
  for(const role of ['coordinator','driver','service_role','anon'])it(`denies ${role} before evidence`,async()=>{
    const d=database([role]);await expect(readFinanceDatabaseEvidence(d.context,'payments')).rejects.toThrow('Forbidden');expect(d.calls).toHaveLength(0);
  });
  it('rejects anonymous identity',async()=>{const d=database();d.context.userId='';await expect(readFinanceDatabaseEvidence(d.context,'payments')).rejects.toThrow();expect(d.calls).toHaveLength(0);});
  it('rejects forged context identity',async()=>{const d=database(['admin'],[],{identity:'other'});await expect(readFinanceDatabaseEvidence(d.context,'payments')).rejects.toThrow();});
  it('does not fallback on RLS denial or expose error details',async()=>{const d=database(['admin'],[{id:'a'}],{error:true});const r=await readFinanceDatabaseEvidence(d.context,'payments');expect(r.coverage).toBe('unavailable');expect(r.rows).toEqual([]);expect(JSON.stringify(r)).not.toContain('sensitive');expect(d.calls).toHaveLength(1);});
  it('removes Owner rows and extra columns for Managers',async()=>{const d=database(['team'],[{id:'a',sensitivity:'owner_only',amount:99999},{id:'b',sensitivity:'standard',amount:10,password:'never'}]);const r=await readFinanceDatabaseEvidence(d.context,'financial_transactions');expect(r.rows).toHaveLength(1);expect(JSON.stringify(r)).not.toContain('99999');expect(JSON.stringify(r)).not.toContain('password');});
  for(const role of ['admin','team'])it(`unknown visibility has count-invariant result for ${role}`,async()=>{
    const one=database([role],[{id:'a',sensitivity:null,amount:999}]);const many=database([role],Array.from({length:7},(_,i)=>({id:String(i),sensitivity:null,amount:i})));
    const a=await readFinanceDatabaseEvidence(one.context,'financial_transactions');const b=await readFinanceDatabaseEvidence(many.context,'financial_transactions');expect(a).toEqual(b);expect(a.coverage).not.toBe('complete');expect(a.rows).toEqual([]);
  });
  it('Manager unclassified sources are withheld without reads',async()=>{const d=database(['team']);const r=await readFinanceDatabaseEvidence(d.context,'vehicle_expenses');expect(r.coverage).toBe('incomplete');expect(d.calls).toHaveLength(0);});
  it('deterministically pages by id with explicit columns',async()=>{const d=database(['admin'],[{id:'a'},{id:'b'}]);const r=await readFinanceDatabaseEvidence(d.context,'payments',{pageSize:1});expect(r.rows).toHaveLength(2);expect(d.calls.map(c=>c.cursor)).toEqual([null,'a','b',null,'a','b']);});
  it('page cap cannot report verified empty',async()=>{const d=database();const r=await readFinanceDatabaseEvidence(d.context,'payments',{pageSize:1,maxPages:1});expect(r.coverage).not.toBe('complete');expect(r.rows).toEqual([]);});
  it('conflicting overlapping pages fail closed',async()=>{const d=database(['admin'],[{id:'a'}],{overlap:true});expect((await readFinanceDatabaseEvidence(d.context,'payments',{pageSize:1})).coverage).toBe('unavailable');});
  it('changing records invalidate both scans',async()=>{const d=database(['admin'],[{id:'a',amount:10}],{change:true});expect((await readFinanceDatabaseEvidence(d.context,'payments')).coverage).toBe('incomplete');});
  it('revocation during extraction withholds results',async()=>{const d=database(['admin'],[{id:'a'}],{roleChange:true});expect((await readFinanceDatabaseEvidence(d.context,'payments')).rows).toEqual([]);});
  it('aborted read returns no rows',async()=>{const d=database();const abort=new AbortController();abort.abort();await expect(readFinanceDatabaseEvidence(d.context,'payments',{signal:abort.signal})).rejects.toThrow();});
  it('unsupported C1 accounting is incomplete',async()=>{const d=database(['admin'],[{id:'a',sensitivity:'standard',txn_type:'acquisition'}]);const r=await readFinanceDatabaseEvidence(d.context,'financial_transactions');expect(r.coverage).toBe('incomplete');expect(r.rows).toEqual([]);});
  it('rejects arbitrary table',async()=>{const d=database();await expect(readFinanceDatabaseEvidence(d.context,'secrets' as never)).rejects.toThrow();});
});

describe('injected read-only provider event evidence',()=>{
  it('preserves charges refunds balances and separate payout evidence',async()=>{const f=provider();const r=await readFinanceProviderEvents(f.gateway,owner,scope,window);expect(r.coverage).toBe('complete');expect(r.rows.map(x=>x.object)).toEqual(['charge','refund']);expect(r.rows[0].feeCents).toBe(300);expect(r.balanceTransactions.map(x=>x.id)).toEqual(['bt_charge','bt_refund','bt_payout']);expect(r.payouts[0].id).toBe('po_fixture');expect(r.rows.every(x=>x.kind!=='payout')).toBe(true);expect(r.rows[0].identities).toContainEqual({provider:'stripe',...scope,object:'payment_intent',id:'pi_fixture'});});
  it('Manager account-wide evidence is unavailable without provider calls',async()=>{const f=provider();const r=await readFinanceProviderEvents(f.gateway,async()=>({userId:'m',roles:['team']}),scope,window);expect(r.rows).toEqual([]);expect(r.coverage).toBe('unavailable');expect(f.calls).toEqual([]);});
  for(const roles of [['coordinator'],['driver'],['service_role'],[]])it(`denies ${roles.join()||'anonymous'} without provider calls`,async()=>{const f=provider();await expect(readFinanceProviderEvents(f.gateway,async()=>({userId:roles.length?'x':null,roles}),scope,window)).rejects.toThrow();expect(f.calls).toEqual([]);});
  it('rejects account mismatch',async()=>{const f=provider();f.state.account='other';expect((await readFinanceProviderEvents(f.gateway,owner,scope,window)).coverage).toBe('unavailable');});
  it('rejects environment mismatch',async()=>{const f=provider();f.c.livemode=true;expect((await readFinanceProviderEvents(f.gateway,owner,scope,window)).rows).toEqual([]);});
  it('deduplicates identical event overlap',async()=>{const f=provider();f.state.refunds.push({...f.r});const r=await readFinanceProviderEvents(f.gateway,owner,scope,window);expect(r.rows.filter(x=>x.object==='refund')).toHaveLength(1);});
  it('rejects conflicting duplicate events',async()=>{const f=provider();f.state.refunds.push({...f.r,amount:100});expect((await readFinanceProviderEvents(f.gateway,owner,scope,window)).coverage).toBe('unavailable');});
  it('fetches parent outside refund period and preserves cross-period resolution',async()=>{const f=provider();f.state.charges=[];const r=await readFinanceProviderEvents(f.gateway,owner,scope,window);expect(f.calls).toContain('parent');expect(r.rows[0].cashDate).toBe('2023-12-31');expect(r.rows[1].cashDate).toBe('2024-01-01');const reps=r.rows.map(x=>mapFinanceSource('stripe',x,scope).row!.representation!);const result=reconcileFinance(reps,{basis:'cash'});expect(result.complete).toBe(true);expect(result.events.filter(x=>x.kind==='refund')).toHaveLength(1);});
  for(const field of ['fee','currency','id'])it(`missing balance ${field} is not verified zero`,async()=>{const f=provider();delete f.balances.bt_charge[field];const r=await readFinanceProviderEvents(f.gateway,owner,scope,window);expect(r.coverage).toBe('incomplete');expect(r.rows).toEqual([]);});
  it('missing Charge identity is fatal',async()=>{const f=provider();f.c.id='';expect((await readFinanceProviderEvents(f.gateway,owner,scope,window)).coverage).toBe('unavailable');});
  it('missing balance reference preserves incomplete state',async()=>{const f=provider();f.c.balance_transaction=null;expect((await readFinanceProviderEvents(f.gateway,owner,scope,window)).coverage).toBe('incomplete');});
  it('unrepresented refund fee adjustment remains incomplete',async()=>{const f=provider();f.balances.bt_refund.fee=-10;f.balances.bt_refund.net=-2490;const r=await readFinanceProviderEvents(f.gateway,owner,scope,window);expect(r.coverage).toBe('incomplete');expect(r.balanceTransactions.find(x=>x.id==='bt_refund')?.fee).toBe(-10);});
  it('source changes invalidate extraction',async()=>{const f=provider();f.state.change=true;expect((await readFinanceProviderEvents(f.gateway,owner,scope,window)).coverage).toBe('unavailable');});
  it('pagination caps fail closed',async()=>{const f=provider();f.state.more=true;expect((await readFinanceProviderEvents(f.gateway,owner,scope,window,{maxPages:1})).coverage).toBe('unavailable');});
  it('actor switch during read discards all evidence',async()=>{const f=provider();let n=0;const r=await readFinanceProviderEvents(f.gateway,async()=>({userId:++n>2?'other':'staff',roles:['admin']}),scope,window);expect(r.rows).toEqual([]);});
  it('denied provider read has no fallback',async()=>{const f=provider();f.gateway.charges.list=(()=>{throw Error('Denied');}) as never;expect((await readFinanceProviderEvents(f.gateway,owner,scope,window)).coverage).toBe('unavailable');});
});

describe('release remains isolated',()=>{
  it('endpoint stays disabled for authorized users',()=>{expect(disabledUnifiedFinanceResponse('owner',['admin'])).toEqual({status:'disabled',report:null});expect(disabledUnifiedFinanceResponse('manager',['team'])).toEqual({status:'disabled',report:null});});
  it('endpoint gates live reads behind the compile-time constant',()=>{const s=readFileSync('src/lib/unified-finance.functions.ts','utf8');expect(s).not.toMatch(/database-transport|provider-events|createStripeClient|buildMock/);expect(s.match(/\.from\(/g)).toHaveLength(1);expect(s).toContain('.from("user_roles")');expect(s).toContain('if (!UNIFIED_FINANCE_ENDPOINT_ENABLED)');expect(s).toContain('./unified-finance-live.server');});
  it('new adapters cannot invoke mutations or instantiate credentials',()=>{for(const path of ['database-transport','provider-events']){const s=readFileSync(`src/lib/unified-finance-${path}.server.ts`,'utf8');expect(s).not.toMatch(/\.(insert|upsert|update|delete|rpc|create|cancel|capture|refund)\s*\(/);expect(s).not.toMatch(/process\.env|supabaseAdmin|fetch\s*\(|createStripeClient\s*\(/);}});
});


describe('Provider correction regressions',()=>{
  for(const [label,created,cash,inPeriod] of [
    ['created December cash January',window.gte-1,window.gte+100,true],
    ['created January cash December',window.gte+100,window.gte-1,false],
    ['created January cash February',window.gte+100,window.lt+100,false],
    ['created February cash January',window.lt+100,window.gte+100,true],
  ] as const) it(label,async()=>{
    const f=provider();f.r.created=created;f.balances.bt_refund.created=cash;
    f.gateway.refunds.list=(async(args:any)=>({data:!args.created || (args.created.gte<=created && created<args.created.lt)?[f.r]:[],has_more:false})) as never;
    const r=await readFinanceProviderEvents(f.gateway,owner,scope,window);
    expect(r.coverage).toBe('complete');expect(r.rows.filter(x=>x.kind==='refund')).toHaveLength(inPeriod?1:0);
    if(inPeriod)expect(r.rows.find(x=>x.kind==='refund')?.amountCents).toBe(2500);
  });
  it('incomplete refund history cannot establish complete zero',async()=>{
    const f=provider();f.gateway.refunds.list=(async()=>({data:[f.r],has_more:true})) as never;
    const r=await readFinanceProviderEvents(f.gateway,owner,scope,window,{maxPages:1});
    expect(r.coverage).not.toBe('complete');expect(r.rows).toEqual([]);
  });
  for(const change of ['revoked','switch','cancel'] as const)it(`final provider await ${change} discloses no financial evidence`,async()=>{
    const f=provider();const abort=new AbortController();let roles=['admin'],userId='staff',n=0;
    f.gateway.accounts.retrieve=(async()=>{if(++n===2){if(change==='revoked')roles=['driver'];if(change==='switch')userId='other';if(change==='cancel')abort.abort();}return {id:scope.account};}) as never;
    const r=await readFinanceProviderEvents(f.gateway,async()=>({userId,roles}),scope,window,{signal:abort.signal});
    expect(r).toEqual({rows:[],balanceTransactions:[],payouts:[],coverage:'unavailable',reasons:['Provider evidence unavailable or inconsistent']});
  });
  it('cancellation during final authorization discloses no evidence',async()=>{
    const f=provider();const abort=new AbortController();let final=false,n=0;
    f.gateway.accounts.retrieve=(async()=>{if(++n===2)final=true;return {id:scope.account};}) as never;
    const r=await readFinanceProviderEvents(f.gateway,async()=>{if(final)abort.abort();return {userId:'staff',roles:['admin']};},scope,window,{signal:abort.signal});
    expect(r.rows).toEqual([]);expect(r.payouts).toEqual([]);expect(r.balanceTransactions).toEqual([]);expect(r.coverage).toBe('unavailable');
  });
  it('paid payout missing balance identity is incomplete',async()=>{
    const f=provider();f.p.balance_transaction=null;const r=await readFinanceProviderEvents(f.gateway,owner,scope,window);
    expect(r.coverage).toBe('incomplete');expect(r.payouts[0].balanceTransactionId).toBe(null);expect(r.rows.every(x=>x.kind!=='payout')).toBe(true);
  });
  it('verified paid payout retains separate balance evidence',async()=>{
    const f=provider();const r=await readFinanceProviderEvents(f.gateway,owner,scope,window);
    expect(r.coverage).toBe('complete');expect(r.payouts[0].balanceTransactionId).toBe('bt_payout');expect(r.balanceTransactions.find(x=>x.id==='bt_payout')?.source).toBe('po_fixture');expect(r.rows.filter(x=>x.kind==='collection')).toHaveLength(1);
  });
  it('mismatched payout balance cannot verify reconciliation',async()=>{
    const f=provider();f.balances.bt_payout.amount=-7000;f.balances.bt_payout.net=-7000;
    expect((await readFinanceProviderEvents(f.gateway,owner,scope,window)).coverage).toBe('incomplete');
  });
});
