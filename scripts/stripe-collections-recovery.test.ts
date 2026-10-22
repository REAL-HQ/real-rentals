import {describe,it,expect,vi} from 'vitest';
import {paymentRevenue,createRevenueBoundary,type RevenueSession} from '../src/lib/revenue-state';
import {consolidatedRevenue} from '../src/lib/stripe-collections';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const flush=()=>new Promise(r=>setImmediate(r));
const report:any={collectionsComplete:true,totals:[{currency:'usd',net:10000}]};
describe('Revenue error recovery',()=>{
 it('successful empty result is verified zero',()=>expect(paymentRevenue({data:[],count:0,error:null})).toEqual({total:0,nonStripe:0,doubleCollection:0}));
 it('failed read is unknown, not zero',()=>expect(paymentRevenue({data:null,count:null,error:{message:'denied'}})).toBeNull());
 it('error with returned rows still fails closed',()=>expect(paymentRevenue({data:[{net_collected:50}],count:1,error:{message:'partial failure'}})).toBeNull());
 it('missing data is unavailable',()=>expect(paymentRevenue({data:null,count:0,error:null})).toBeNull());
 it('capped/missing count cannot imply full internal coverage',()=>{expect(paymentRevenue({data:[],count:3,error:null})).toBeNull();expect(paymentRevenue({data:[],count:null,error:null})).toBeNull();});
 it('unknown amounts remain unknown',()=>{for(const n of [null,undefined,'',NaN,Infinity])expect(paymentRevenue({data:[{net_collected:n}],count:1,error:null})).toBeNull();});
 it('known Stripe PI rows are excluded from internal contribution',()=>expect(paymentRevenue({data:[{net_collected:'35.50',stripe_payment_intent_id:null},{net_collected:100,stripe_payment_intent_id:'pi_1'}],count:2,error:null})).toEqual({total:135.5,nonStripe:35.5,doubleCollection:0}));
 it('an invoice id with no payment intent is not added on top of Stripe',()=>{
  const rows=paymentRevenue({data:[
   {net_collected:50,stripe_payment_intent_id:null,stripe_invoice_id:null},
   {net_collected:100,stripe_payment_intent_id:null,stripe_invoice_id:'in_1'},
   {net_collected:80,stripe_payment_intent_id:'pi_1',stripe_invoice_id:'in_2'},
  ],count:3,error:null});
  expect(rows).toEqual({total:230,nonStripe:50,doubleCollection:0});
  expect(consolidatedRevenue({internalNonStripe:rows!.nonStripe,report}).amount).toBe(150);
 });
 it('a failed invoice later marked paid stays non-Stripe while a Stripe-settled invoice does not',()=>{
  // Mark as Paid writes status and paid_date only, so failure_reason survives
  // until a later Stripe success clears it.
  const rows=paymentRevenue({data:[
   {net_collected:40,stripe_payment_intent_id:null,stripe_invoice_id:null,failure_reason:null},
   {net_collected:75,stripe_payment_intent_id:null,stripe_invoice_id:'in_cash',failure_reason:'Weekly rent charge failed'},
   {net_collected:90,stripe_payment_intent_id:null,stripe_invoice_id:'in_stripe',failure_reason:null},
   {net_collected:15,stripe_payment_intent_id:'pi_1',stripe_invoice_id:'in_both',failure_reason:'Weekly rent charge failed'},
   {net_collected:5,stripe_payment_intent_id:null,stripe_invoice_id:'in_blank',failure_reason:'   '},
  ],count:5,error:null});
  expect(rows).toEqual({total:225,nonStripe:115,doubleCollection:0});
 });
 it('a Stripe success after Mark as Paid keeps the cash and labels the double collection',()=>{
  const marked={net_collected:75,stripe_payment_intent_id:null,stripe_invoice_id:'in_cash',failure_reason:'Weekly rent charge failed'};
  const noted={...marked,failure_reason:'Possible double collection: row marked paid manually, then Stripe collected $75.00 on 2026-10-17; a refund may be owed.'};
  expect(paymentRevenue({data:[marked],count:1,error:null})).toEqual({total:75,nonStripe:75,doubleCollection:0});
  const kept=paymentRevenue({data:[noted],count:1,error:null});
  expect(kept).toEqual({total:75,nonStripe:75,doubleCollection:75});
  expect(consolidatedRevenue({internalNonStripe:kept!.nonStripe,report}).amount).toBe(175);
  expect(paymentRevenue({data:[{...marked,failure_reason:null}],count:1,error:null})).toEqual({total:75,nonStripe:0,doubleCollection:0});
  expect(paymentRevenue({data:[{...marked,failure_reason:null,stripe_payment_intent_id:'pi_retry'}],count:1,error:null})).toEqual({total:75,nonStripe:0,doubleCollection:0});
  const panel=readFileSync(new URL('../src/components/admin/OverviewPanel.tsx',import.meta.url),'utf8');
  expect(panel).toContain('Possible Double Collection');
  expect(panel).toContain('A refund may be owed. Included in the total.');
  const webhook=readFileSync(new URL('../src/routes/api/public/payments/webhook.ts',import.meta.url),'utf8');
  const invoiceFn=webhook.slice(webhook.indexOf('async function upsertPaymentFromInvoice'), webhook.indexOf('async function handleChargeRefunded'));
  const settle=invoiceFn.slice(invoiceFn.indexOf('if (!(r.data?.length))'), invoiceFn.indexOf("must(await admin.from('rentals')"));
  expect(settle).toContain('recordPossibleDoubleCollection');
  expect(settle).toContain('invoiceId: invoice.id');
  expect(settle).toContain('rentalId: rental.id');
  expect(settle).toContain("eq('status', 'paid')");
  expect(settle).not.toContain('failure_reason: null');
  expect(settle).not.toContain('stripe_payment_intent_id');
  expect(settle).not.toContain('notified_status');
  expect(settle).not.toMatch(/paid_date:/);
  expect(settle).not.toMatch(/status:\s*['"]paid['"]/);
  expect(invoiceFn.indexOf('if (!(r.data?.length))')).toBeLessThan(invoiceFn.indexOf("title: status === 'paid' ? 'Weekly Rent Paid'"));
 });
 it('an unresolved combined charge keeps the failure reason, so Mark as Paid still counts',()=>{
  const src=readFileSync(new URL('../src/lib/payment-collection.server.ts',import.meta.url),'utf8');
  const fn=src.slice(src.indexOf('export async function collectRows'), src.indexOf('export async function markUncollectable'));
  const pending=fn.slice(0, fn.indexOf('paymentIntents.create'));
  expect(pending).not.toContain('failure_reason:');
  const outcome=fn.slice(fn.indexOf('const paid = pi.status'), fn.indexOf('} catch'));
  expect(outcome).toContain('failure_reason: null');
  expect(outcome).not.toContain('notified_status');
  expect(outcome).not.toContain('.eq("status", "paid")');
  expect(outcome).toContain('single ? { stripe_payment_intent_id: pi.id }');
  expect(outcome).toContain('.neq("status", "paid")');
  const rows=paymentRevenue({data:[
   {net_collected:40,stripe_payment_intent_id:null,stripe_invoice_id:'in_combined',failure_reason:'Weekly rent charge failed'},
  ],count:1,error:null});
  expect(rows).toEqual({total:40,nonStripe:40,doubleCollection:0});
 });
 it('a sandbox invoice row (?env=sandbox writes the same stripe_invoice_id) is excluded',()=>{
  const webhook=readFileSync(new URL('../src/routes/api/public/payments/webhook.ts',import.meta.url),'utf8');
  expect(webhook).toContain("if (rawEnv !== 'sandbox' && rawEnv !== 'live')");
  expect(webhook).toContain("const env: StripeEnv = rawEnv;");
  const invoiceFn=webhook.slice(webhook.indexOf('async function upsertPaymentFromInvoice'), webhook.indexOf('async function handleChargeRefunded'));
  expect(invoiceFn).toContain('stripe_invoice_id: invoice.id');
  expect(invoiceFn).toContain('failure_reason: null');
  expect(invoiceFn).toContain(".neq('status', 'paid').neq('status', 'refunded')");
  expect(invoiceFn).not.toContain('sandbox');
  const panel=readFileSync(new URL('../src/components/admin/PaymentsPanel.tsx',import.meta.url),'utf8');
  expect(panel).toContain('Mark as Paid');
  expect(panel).not.toContain('failure_reason');
  expect(panel).not.toContain('stripe_invoice_id');
  const rows=paymentRevenue({data:[
   {net_collected:60,stripe_payment_intent_id:null,stripe_invoice_id:'in_sandbox',failure_reason:null},
  ],count:1,error:null});
  expect(rows).toEqual({total:60,nonStripe:0,doubleCollection:0});
 });
 it('internal failure suppresses combined total without modifying Stripe report',()=>{const before=JSON.stringify(report);expect(consolidatedRevenue({report,internalNonStripe:null})).toEqual({amount:null,coverage:'Unavailable'});expect(JSON.stringify(report)).toBe(before);});
});
function boundary(){const states:RevenueSession[]=[];const resolvers:Array<(v:{allowed:boolean;collections:boolean})=>void>=[];const authorize=vi.fn(()=>new Promise<{allowed:boolean;collections:boolean}>(r=>resolvers.push(r)));const invalidate=vi.fn();const gate=createRevenueBoundary(authorize,invalidate,v=>states.push(v));return {states,resolvers,authorize,invalidate,gate};}
describe('Revenue session lifecycle',()=>{
 it('logout synchronously hides old account and rejects pending authorization',async()=>{const f=boundary();f.gate.change('A');await flush();f.gate.change(null);f.resolvers[0]({allowed:true,collections:true});await flush();expect(f.states.at(-1)?.ready).toBe(false);expect(f.invalidate).toHaveBeenCalledTimes(2);});
 it('account switch discards late account A role response',async()=>{const f=boundary();f.gate.change('A');await flush();f.gate.change('B');await flush();f.resolvers[1]({allowed:true,collections:false});await flush();const before=JSON.stringify(f.states);f.resolvers[0]({allowed:true,collections:true});await flush();expect(JSON.stringify(f.states)).toBe(before);expect(f.states.at(-1)?.collections).toBe(false);});
 it('same-user reauthentication uses a fresh epoch and invalidates cache',async()=>{const f=boundary();f.gate.change('A');await flush();f.resolvers[0]({allowed:true,collections:true});await flush();const old=f.states.at(-1)!.epoch;f.gate.change('A');expect(f.states.at(-1)).toEqual({epoch:old+1,ready:false,collections:false});await flush();expect(f.authorize).toHaveBeenCalledTimes(2);});
 it('role downgrade cannot retain restricted data',async()=>{const f=boundary();f.gate.change('A');await flush();f.resolvers[0]({allowed:true,collections:true});await flush();f.gate.change('A');await flush();f.resolvers[1]({allowed:true,collections:false});await flush();expect(f.states.at(-1)?.collections).toBe(false);});
 it('revoked role leaves panel unavailable',async()=>{const f=boundary();f.gate.change('A');await flush();f.resolvers[0]({allowed:false,collections:false});await flush();expect(f.states.at(-1)?.ready).toBe(false);});
 it('disposal blocks late responses and initial session ticket is invalidated',async()=>{const f=boundary();const ticket=f.gate.ticket();f.gate.change('A');expect(f.gate.ticket()).not.toBe(ticket);await flush();f.gate.dispose();const before=JSON.stringify(f.states);f.resolvers[0]({allowed:true,collections:true});await flush();expect(JSON.stringify(f.states)).toBe(before);});
 it('actual payment effect ignores a delayed result after unmount',async()=>{
  const src=readFileSync(new URL('../src/components/admin/OverviewPanel.tsx',import.meta.url),'utf8');const start=src.indexOf('  useEffect(() => {',src.indexOf('const compare = useMemo'));const marker='  }, [range, compare, canSeeCollections]);';const code=src.slice(start,src.indexOf(marker,start)+marker.length);let cleanup:()=>void=()=>{};let resolve:any;const p=new Promise(r=>resolve=r);const chain:any={};for(const k of ['from','select','in','gte','lte'])chain[k]=()=>chain;chain.then=(...args:any[])=>p.then(...args);const set=vi.fn();
  vm.runInNewContext(ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,{canSeeCollections:true,useEffect:(f:any)=>{cleanup=f()},supabase:chain,range:{from:'2026-10-01',to:'2026-10-18'},compare:{from:'2026-09-01',to:'2026-09-18'},REVENUE_TYPES:['rent'],paymentRevenue,setRevenue:set,setInternalNonStripe:set,setDoubleCollection:set,setPriorRevenue:set,setRevenueLoading:vi.fn()});cleanup();resolve({data:[{net_collected:275}],count:1,error:null});await flush();expect(set).not.toHaveBeenCalled();
 });
 it('integration remounts by epoch and role gate; root isolation is retained',()=>{const src=readFileSync(new URL('../src/components/admin/OverviewPanel.tsx',import.meta.url),'utf8');expect(src).toContain('key={`${boundary.epoch}:${canSeeCollections}`}');expect(src).toContain('if(!canSeeCollections)');expect(src).toContain('onAuthStateChange');expect(src).toContain('client.cancelQueries');expect(src).toContain('client.removeQueries');expect(readFileSync(new URL('../src/routes/__root.tsx',import.meta.url),'utf8')).toContain('useSessionIsolation(queryClient)');});
});
