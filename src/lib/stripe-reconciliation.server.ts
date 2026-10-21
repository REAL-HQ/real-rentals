import type Stripe from 'stripe';
import { createStripeClient, type StripeEnv } from './stripe.server';

export function reconciliationEnvironment(): StripeEnv {
  const env = process.env.STRIPE_RECONCILIATION_ENV;
  if (process.env.STRIPE_RECONCILIATION_ENABLED !== 'true' || !['sandbox','live'].includes(env ?? '')) throw new Error('Stripe reconciliation is not activated');
  return env as StripeEnv;
}
export async function reconciliationClient(env: StripeEnv) {
  if (env !== reconciliationEnvironment()) throw new Error('Stripe environment mismatch');
  const stripe = createStripeClient(env);
  const account = await stripe.accounts.retrieve(null);
  if (!process.env.STRIPE_RECONCILIATION_ACCOUNT || account.id !== process.env.STRIPE_RECONCILIATION_ACCOUNT) throw new Error('Stripe account mismatch');
  return stripe;
}
export const objectId = (v: any): string | null => typeof v === 'string' ? v : v?.id ?? null;
const cents = (n: unknown) => { if (!Number.isSafeInteger(n) || Number(n)<0) throw new Error('Invalid provider amount'); return Number(n); };
export function billingDate(seconds: number) {
  if (!Number.isFinite(seconds) || seconds<=0) throw new Error('Missing provider date');
  // One explicit business timezone, never the webhook machine's timezone.
  return new Intl.DateTimeFormat('en-CA',{timeZone:process.env.STRIPE_REPORT_TIMEZONE ?? 'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(seconds*1000));
}
function mode(object: any, env: StripeEnv) { if (object.livemode !== (env==='live')) throw new Error('Provider mode mismatch'); }
export async function subscriptionSnapshot(stripe: Stripe, id: string, env: StripeEnv) {
  const s = await stripe.subscriptions.retrieve(id); mode(s,env);
  return {kind:'subscription',id:s.id,subscription_id:s.id,customer_id:objectId(s.customer),status:s.status,weekly_cents:s.items.data[0]?.price.unit_amount ?? null,
    review_reason:s.items.has_more || s.items.data.length!==1 || s.items.data[0].price.currency!=='usd' || s.items.data[0].price.recurring?.interval!=='week' || s.items.data[0].price.recurring?.interval_count!==1 || s.items.data[0].quantity!==1 ? 'unsupported_subscription_terms' : null};
}
async function chargeSnapshot(stripe: Stripe, pi: any, env: StripeEnv) {
  mode(pi,env);
  const ch = await stripe.charges.retrieve(objectId(pi.latest_charge)!); mode(ch,env);
  if (!ch.paid || !ch.captured || objectId(ch.payment_intent)!==pi.id || ch.amount_captured!==pi.amount_received || ch.currency!=='usd' || objectId(ch.customer)!==objectId(pi.customer)) throw new Error('Unverified charge');
  const refunds=[];
  for await (const refund of stripe.refunds.list({charge:ch.id,limit:100})) {
    if(refund.status==='succeeded') refunds.push({id:refund.id,amount:cents(refund.amount)/100,status:'succeeded'});
    if(refunds.length>10000) throw new Error('Refund pagination limit');
  }
  if (Math.round(refunds.reduce((n,r)=>n+r.amount,0)*100)!==ch.amount_refunded) throw new Error('Refund snapshot changed; retry');
  return {charge_id:ch.id,refunded_cents:cents(ch.amount_refunded),refunds,paid_date:billingDate(ch.created)};
}
export async function invoiceSnapshot(stripe: Stripe, id: string, env: StripeEnv) {
  const invoice:any = await stripe.invoices.retrieve(id); mode(invoice,env);
  const base:any={kind:'invoice',id:invoice.id,subscription_id:objectId(invoice.parent?.subscription_details?.subscription ?? invoice.subscription),customer_id:objectId(invoice.customer),currency:invoice.currency,
    status:invoice.status==='paid'?'paid':'failed',due_cents:cents(invoice.amount_due),paid_cents:0,refunded_cents:0,due_date:billingDate(invoice.period_start),review_reason:null};
  if(invoice.currency!=='usd' || !base.subscription_id) return {...base,review_reason:'unsupported_invoice'};
  const payments=[];
  for await(const p of stripe.invoicePayments.list({invoice:id,status:'paid',limit:100})) {payments.push(p);if(payments.length>100)throw new Error('Invoice payment limit');}
  if(invoice.status!=='paid') return payments.length ? {...base,review_reason:'partial_invoice_requires_review'} : base;
  // Mixed credit/out-of-band/multi-invoice allocations stay in review, never inferred cash.
  if(payments.length!==1 || payments[0].payment.type!=='payment_intent') return {...base,review_reason:'unsupported_payment_allocation'};
  const pi = await stripe.paymentIntents.retrieve(objectId(payments[0].payment.payment_intent)!);mode(pi,env);
  if(pi.status!=='succeeded' || pi.currency!=='usd' || objectId(pi.customer)!==base.customer_id || pi.amount_received!==payments[0].amount_paid || pi.amount_received!==invoice.amount_paid || !pi.latest_charge) return {...base,review_reason:'unverified_invoice_collection'};
  return {...base,paid_cents:cents(pi.amount_received),payment_intent_id:pi.id,...await chargeSnapshot(stripe,pi,env)};
}
export async function paymentSnapshot(stripe: Stripe,id:string,env:StripeEnv,db:any) {
  const pi=await stripe.paymentIntents.retrieve(id); mode(pi,env);
  let ids=String(pi.metadata.paymentIds??'').split(',').filter(x=>/^[0-9a-f-]{36}$/i.test(x));
  if(!ids.length){const r=await db.from('payments').select('id').or(`stripe_payment_intent_id.eq.${id},stripe_collection_reference.eq.${id}`);if(r.error)throw new Error('Payment read failed');ids=(r.data??[]).map((r:any)=>r.id);}
  const base={kind:'payment',id:pi.id,customer_id:objectId(pi.customer),payment_ids:ids,currency:pi.currency,paid_cents:cents(pi.amount_received),refunded_cents:0};
  if(pi.status!=='succeeded'||pi.currency!=='usd'||!pi.latest_charge)return {...base,review_reason:'payment_not_collected'};
  return {...base,status:'paid',...await chargeSnapshot(stripe,pi,env)};
}
export async function ingestSnapshot(db:any,env:StripeEnv,eventId:string,snapshot:any) {
  const r=await db.rpc('stripe_ingest',{_env:env,_event:eventId,_s:snapshot});if(r.error)throw new Error('Reconciliation transaction failed');return r.data;
}
export async function routeReconciliationEvent(db:any,stripe:Stripe,event:any,env:StripeEnv,onVerified?: (s:any)=>Promise<void>) {
  if(event.livemode!==(env==='live') || typeof event.id!=='string')throw new Error('Event environment mismatch');
  const o=event.data.object;
  const persist=async(id:string,s:any)=>{const r=await ingestSnapshot(db,env,id,s);if(r?.state==='processed' && s.status==='paid' && event.type!=='charge.refunded')await onVerified?.(s);};
  if(event.type.startsWith('invoice.')) {await persist(event.id,await invoiceSnapshot(stripe,o.id,env));return true;}
  if(event.type.startsWith('customer.subscription.')) {await persist(event.id,await subscriptionSnapshot(stripe,o.id,env));return true;}
  if(event.type==='checkout.session.completed' && o.mode==='subscription') {
    const session=await stripe.checkout.sessions.retrieve(o.id);mode(session,env);
    const sub=objectId(session.subscription);if(!sub)throw new Error('Subscription checkout incomplete');
    await persist(event.id,await subscriptionSnapshot(stripe,sub,env));return true;
  }
  if(event.type.startsWith('payment_intent.') || event.type==='charge.refunded') {
    const pi=event.type==='charge.refunded'?objectId(o.payment_intent):o.id;if(!pi)throw new Error('Missing payment intent');
    const invoices=new Set<string>();for await(const p of stripe.invoicePayments.list({payment:{type:'payment_intent',payment_intent:pi},limit:100})){invoices.add(objectId(p.invoice)!);if(invoices.size>100)throw new Error('Invoice allocation limit');}
    if(invoices.size) {for(const id of invoices)await persist(`${event.id}:${id}`,await invoiceSnapshot(stripe,id,env));}
    else await persist(event.id,await paymentSnapshot(stripe,pi,env,db));
    return true;
  }
  return false;
}
