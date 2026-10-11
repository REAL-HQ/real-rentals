import { createServerFn } from '@tanstack/react-start';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { requireManager } from '@/lib/roles.server';
import { z } from 'zod';
import { reconciliationEnvironment, reconciliationClient, subscriptionSnapshot, invoiceSnapshot, ingestSnapshot, paymentSnapshot } from './stripe-reconciliation.server';
import { createHash } from 'node:crypto';
const subscriptionId=z.string().regex(/^sub_[a-zA-Z0-9]+$/);
async function services(userId:string){await requireManager(userId);const {supabaseAdmin:db}=await import('@/integrations/supabase/client.server');const env=reconciliationEnvironment();return {db:db as any,env};}
export const getStripeReport=createServerFn({method:'GET'}).middleware([requireSupabaseAuth])
.inputValidator((d:unknown)=>z.object({from:z.string().date(),to:z.string().date(),priorFrom:z.string().date(),priorTo:z.string().date()}).parse(d))
.handler(async({data,context})=>{await requireManager(context.userId);const env=reconciliationEnvironment();const r=await (context.supabase as any).rpc('stripe_report',{_from:data.from,_to:data.to,_prior_from:data.priorFrom,_prior_to:data.priorTo,_env:env});if(r.error)throw new Error('Verified collections unavailable');return r.data;});
export const listStripeReview=createServerFn({method:'GET'}).middleware([requireSupabaseAuth])
.handler(async({context})=>{const {db,env}=await services(context.userId);const r=await db.from('stripe_event_receipts').select('event_id,object_id,kind,state,reason,updated_at').eq('environment',env).neq('state','processed').order('updated_at',{ascending:false}).limit(100);if(r.error)throw new Error('Review unavailable');const c=await db.from('stripe_operations').select('rental_id,state,cancellation_state,error_code').eq('environment',env).or('cancellation_state.in.(requested,failed),state.in.(failed,review)').limit(100);if(c.error)throw new Error('Cancellation status unavailable');return {events:r.data,cancellations:c.data};});
export const linkStripeSubscription=createServerFn({method:'POST'}).middleware([requireSupabaseAuth])
.inputValidator((d:unknown)=>z.object({subscriptionId,rentalId:z.string().uuid(),confirmedCustomerId:z.string().regex(/^cus_[a-zA-Z0-9]+$/),reason:z.string().min(8).max(500)}).parse(d))
.handler(async({data,context})=>{
 const {db,env}=await services(context.userId),stripe=await reconciliationClient(env);
 const sub=await subscriptionSnapshot(stripe,data.subscriptionId,env);if(sub.review_reason)throw new Error('Subscription terms require review');
 if(data.confirmedCustomerId!==sub.customer_id)throw new Error('Provider customer confirmation mismatch');
 const rental=await db.from('rentals').select('weekly_rate').eq('id',data.rentalId).single();if(rental.error||Math.round(Number(rental.data?.weekly_rate)*100)!==sub.weekly_cents)throw new Error('Weekly rate mismatch; explicit pricing review required');
 const r=await db.rpc('stripe_link',{_env:env,_sub:sub.id,_customer:sub.customer_id,_rental:data.rentalId,_actor:context.userId,_reason:data.reason,_confirmed_customer:data.confirmedCustomerId});if(r.error)throw new Error('Link refused: verify rental customer and existing subscription');
 await ingestSnapshot(db,env,`staff-link:${sub.id}`,sub);return {linked:true};
});
async function historicalPlan(stripe:any,sub:string,env:any){
 const snapshots=[];
 for await(const invoice of stripe.invoices.list({subscription:sub,limit:100})) {snapshots.push(await invoiceSnapshot(stripe,invoice.id,env));if(snapshots.length>1000)throw new Error('Use a bounded historical reconciliation window');}
 snapshots.sort((a,b)=>a.id.localeCompare(b.id));
 return {snapshots,hash:createHash('sha256').update(JSON.stringify(snapshots)).digest('hex')};
}
export const previewStripeHistory=createServerFn({method:'POST'}).middleware([requireSupabaseAuth])
.inputValidator((d:unknown)=>z.object({subscriptionId}).parse(d))
.handler(async({data,context})=>{const {env}=await services(context.userId),stripe=await reconciliationClient(env);const plan=await historicalPlan(stripe,data.subscriptionId,env);
 return {hash:plan.hash,invoices:plan.snapshots.length,reviewRequired:plan.snapshots.filter(s=>s.review_reason).length,collectedCents:plan.snapshots.filter(s=>!s.review_reason).reduce((n,s)=>n+s.paid_cents,0)};});
export const applyStripeHistory=createServerFn({method:'POST'}).middleware([requireSupabaseAuth])
.inputValidator((d:unknown)=>z.object({subscriptionId,previewHash:z.string().regex(/^[a-f0-9]{64}$/),confirm:z.literal('APPLY VERIFIED INVOICES')}).parse(d))
.handler(async({data,context})=>{const {db,env}=await services(context.userId),stripe=await reconciliationClient(env);const plan=await historicalPlan(stripe,data.subscriptionId,env);
 if(plan.hash!==data.previewHash)throw new Error('Provider data changed; preview again');
 const link=await db.from('stripe_rental_links').select('rental_id').eq('environment',env).eq('subscription_id',data.subscriptionId).maybeSingle();if(link.error||!link.data)throw new Error('Explicit staff linkage required first');
 for(const s of plan.snapshots)await ingestSnapshot(db,env,`backfill:${s.id}`,s);
 return {reviewRequired:plan.snapshots.filter(s=>s.review_reason).length,processed:plan.snapshots.length};
});
export const replayStripeEvent=createServerFn({method:'POST'}).middleware([requireSupabaseAuth])
.inputValidator((d:unknown)=>z.object({eventId:z.string().min(1).max(250)}).parse(d))
.handler(async({data,context})=>{const {db,env}=await services(context.userId),stripe=await reconciliationClient(env);const r=await db.from('stripe_event_receipts').select('kind,object_id').eq('environment',env).eq('event_id',data.eventId).single();if(r.error||!r.data)throw new Error('Receipt unavailable');
 const s=r.data.kind==='subscription'?await subscriptionSnapshot(stripe,r.data.object_id,env):r.data.kind==='invoice'?await invoiceSnapshot(stripe,r.data.object_id,env):await paymentSnapshot(stripe,r.data.object_id,env,db);
 return ingestSnapshot(db,env,data.eventId,s);
});
