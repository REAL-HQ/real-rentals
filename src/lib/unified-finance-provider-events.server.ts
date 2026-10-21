import type { createStripeClient } from './stripe.server';
import type { ProviderRow, SourceActor, SourceScope } from './unified-finance-source-contracts';
import { requireSourceActor } from './unified-finance-source-contracts';

/** Structurally restricted view of the existing gateway, never a client factory.
 * Only mocked injection is wired today. Account must be trusted server configuration.
 */
type Gateway = ReturnType<typeof createStripeClient>;
export type FinanceEventGateway = {
  accounts: Pick<Gateway['accounts'], 'retrieve'>;
  charges: Pick<Gateway['charges'], 'list' | 'retrieve'>;
  refunds: Pick<Gateway['refunds'], 'list'>;
  balanceTransactions: Pick<Gateway['balanceTransactions'], 'retrieve'>;
  payouts: Pick<Gateway['payouts'], 'list'>;
};
export type ProviderEvidence = {
  rows: ProviderRow[];
  balanceTransactions: { id: string; account: string; environment: SourceScope['environment']; amount: number; fee: number; net: number; currency: string; created: number; source: string | null }[];
  payouts: { id: string; account: string; environment: SourceScope['environment']; amount: number; currency: string; status: string; arrivalDate: number; balanceTransactionId: string | null }[];
  coverage: 'complete' | 'incomplete' | 'unavailable'; reasons: string[];
};
const ref = (v: unknown): string | null => typeof v === 'string' && v ? v : v && typeof v === 'object' && 'id' in v ? ref(v.id) : null;
const cents = (v: unknown): v is number => Number.isSafeInteger(v);
const currency = (v: unknown): string | null => typeof v === 'string' && /^[a-z]{3}$/.test(v) ? v.toUpperCase() : null;
const date = (v: number) => Number.isSafeInteger(v) && v > 0 ? new Date(v * 1000).toISOString().slice(0,10) : null;

export async function readFinanceProviderEvents(gateway: FinanceEventGateway, authorize: () => Promise<SourceActor>, scope: SourceScope,
  window: { gte: number; lt: number }, options: { maxPages?: number; signal?: AbortSignal } = {}): Promise<ProviderEvidence> {
  const actor = await authorize(); const tier = requireSourceActor(actor);
  if (!scope.account.trim() || !['test','live','synthetic'].includes(scope.environment) || !Number.isSafeInteger(window.gte) || !Number.isSafeInteger(window.lt) || window.gte < 0 || window.lt <= window.gte) throw Error('Invalid provider scope');
  const cap = options.maxPages ?? 100; if (!Number.isInteger(cap) || cap < 1 || cap > 100) throw Error('Invalid page cap');
  const empty = (): ProviderEvidence => ({rows:[],balanceTransactions:[],payouts:[],coverage:'unavailable',reasons:['Provider evidence unavailable or inconsistent']});
  // Provider account-wide data has no row-level Owner classification. Until a reviewed
  // operating-event boundary exists, a Manager must not receive account-wide evidence.
  if (tier !== 'owner') return empty();
  async function check() {
    options.signal?.throwIfAborted(); const now = await authorize();
    options.signal?.throwIfAborted();
    if (now.userId !== actor.userId || requireSourceActor(now) !== tier) throw Error('Forbidden');
  }
  function mode(v: {livemode?: boolean}) {
    if (typeof v.livemode !== 'boolean' || v.livemode !== (scope.environment === 'live')) throw Error('Environment mismatch');
  }
  async function pages<T extends {id:string;livemode?:boolean}>(read:(cursor?:string)=>PromiseLike<{data:T[];has_more:boolean}>) {
    const map = new Map<string,T>(); let cursor: string | undefined;
    for (let page=0;page<cap;page++) {
      await check(); const result=await read(cursor); await check();
      if (!Array.isArray(result.data) || typeof result.has_more !== 'boolean') throw Error('Malformed page');
      for (const row of result.data) {
        if (typeof row.id !== 'string' || !row.id.trim()) throw Error('Missing identity'); mode(row);
        const old=map.get(row.id); if(old && JSON.stringify(old)!==JSON.stringify(row)) throw Error('Conflicting event');
        map.set(row.id,row);
      }
      if(!result.has_more) return [...map.values()];
      const next=result.data.at(-1)?.id; if(!next || next===cursor || result.data.every(r=>r.id===cursor))throw Error('Stalled pagination');
      cursor=next;
    }
    throw Error('Page cap');
  }
  try {
    await check(); if ((await gateway.accounts.retrieve(null)).id !== scope.account) throw Error('Account mismatch');
    const charges=await pages(c=>gateway.charges.list({limit:100,starting_after:c,created:{lt:window.lt}}));
    // Refund creation time does not bound cash time. Exhaust available history;
    // caps/errors remain unavailable rather than asserting complete cash coverage.
    const refunds=await pages(c=>gateway.refunds.list({limit:100,starting_after:c}));
    const payouts=await pages(c=>gateway.payouts.list({limit:100,starting_after:c,arrival_date:window}));
    const byCharge=new Map(charges.map(c=>[c.id,c]));
    const fetchedParents: string[] = [];
    for(const r of refunds) {
      const id=ref(r.charge); if(!id)throw Error('Missing refund parent');
      if(!byCharge.has(id)) {await check();const c=await gateway.charges.retrieve(id);mode(c);if(c.id!==id)throw Error('Wrong parent');byCharge.set(id,c);fetchedParents.push(id);}
    }
    const out:ProviderEvidence={rows:[],balanceTransactions:[],payouts:[],coverage:'complete',reasons:[]};
    const incomplete=()=>{out.coverage='incomplete';out.reasons=['Provider monetary evidence incomplete'];};
    const balances=new Map<string,ProviderEvidence['balanceTransactions'][number]>();
    async function balance(value:unknown, source:string) {
      const id=ref(value); if(!id){incomplete();return null;}
      await check();const b=await gateway.balanceTransactions.retrieve(id);
      if(b.id!==id || ref(b.source)!==source || !cents(b.amount)||!cents(b.fee)||!cents(b.net)||b.amount-b.fee!==b.net||!currency(b.currency)||!date(b.created)){incomplete();return null;}
      const result={id,account:scope.account,environment:scope.environment,amount:b.amount,fee:b.fee,net:b.net,currency:currency(b.currency)!,created:b.created,source:ref(b.source)};
      const old=balances.get(id);if(old&&JSON.stringify(old)!==JSON.stringify(result))throw Error('Changing balance evidence');balances.set(id,result);return result;
    }
    for(const c of byCharge.values()) {
      if(!(c.paid&&c.captured&&c.status==='succeeded'))continue;
      const b=await balance(c.balance_transaction,c.id); const cur=currency(c.currency);
      if(!cents(c.amount_captured)||c.amount_captured<=0||!cur||!b||b.currency!==cur||b.amount!==c.amount_captured||b.fee<0){incomplete();continue;}
      if(!ref(c.customer)) incomplete();
      const invoice = ref((c as unknown as {invoice?: unknown}).invoice);
      out.rows.push({id:c.id,object:'charge',kind:'collection',amountCents:c.amount_captured,currency:cur,cashDate:date(b.created),recognitionDate:null,feeCents:b.fee,status:'succeeded',verified:true,method:'stripe',customerId:ref(c.customer),rentalId:null,relatedEventId:null,parentChargeId:null,identities:[{provider:'stripe',...scope,object:'charge',id:c.id},...(ref(c.payment_intent)?[{provider:'stripe',...scope,object:'payment_intent' as const,id:ref(c.payment_intent)!}]:[]),...(invoice?[{provider:'stripe',...scope,object:'invoice' as const,id:invoice}]:[])]});
    }
    for(const r of refunds) {
      if(r.status!=='succeeded')continue;
      const parent=out.rows.find(c=>c.object==='charge'&&c.id===ref(r.charge));const b=await balance(r.balance_transaction,r.id);const cur=currency(r.currency);
      if(!parent||!cents(r.amount)||r.amount<=0||!cur||cur!==parent.currency||!b||b.currency!==cur||b.amount!==-r.amount){incomplete();continue;}
      if(b.created < window.gte || b.created >= window.lt) continue;
      if(b.fee !== 0) incomplete(); // Existing monetary projection cannot yet apply refund fee adjustments.
      out.rows.push({id:r.id,object:'refund',kind:'refund',amountCents:r.amount,currency:cur,cashDate:date(b.created),recognitionDate:null,feeCents:b.fee,status:'succeeded',verified:true,method:'stripe',customerId:parent.customerId,rentalId:null,relatedEventId:parent.id,parentChargeId:parent.id,identities:[{provider:'stripe',...scope,object:'refund',id:r.id},{provider:'stripe',...scope,object:'charge',id:parent.id}]});
    }
    for(const p of payouts) {
      if(!cents(p.amount)||p.amount<0||!currency(p.currency)||!date(p.arrival_date)){incomplete();continue;}
      if(p.status === 'paid') {
        const b = await balance(p.balance_transaction,p.id);
        if(!b || b.currency !== currency(p.currency) || b.amount !== -p.amount) incomplete();
      }
      out.payouts.push({id:p.id,account:scope.account,environment:scope.environment,amount:p.amount,currency:currency(p.currency)!,status:p.status,arrivalDate:p.arrival_date,balanceTransactionId:ref(p.balance_transaction)});
    }
    // Bounded second extraction detects observed changes; not a cross-service snapshot.
    const againCharges=await pages(c=>gateway.charges.list({limit:100,starting_after:c,created:{lt:window.lt}}));
    const againRefunds=await pages(c=>gateway.refunds.list({limit:100,starting_after:c}));
    const againPayouts=await pages(c=>gateway.payouts.list({limit:100,starting_after:c,arrival_date:window}));
    if(JSON.stringify(charges)!==JSON.stringify(againCharges)||JSON.stringify(refunds)!==JSON.stringify(againRefunds)||JSON.stringify(payouts)!==JSON.stringify(againPayouts))throw Error('Source changed');
    for(const id of fetchedParents) {await check();if(JSON.stringify(byCharge.get(id))!==JSON.stringify(await gateway.charges.retrieve(id)))throw Error('Parent changed');}
    for(const b of [...balances.values()]) await balance(b.id,b.source!);
    out.balanceTransactions=[...balances.values()];
    await check();if((await gateway.accounts.retrieve(null)).id!==scope.account)throw Error('Account changed');
    // No provider await may follow this final identity/role/cancellation check.
    await check();
    return out;
  } catch {return empty();}
}
