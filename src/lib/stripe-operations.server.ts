import { reconciliationClient } from './stripe-reconciliation.server';
import type { StripeEnv } from './stripe.server';
async function rpc(db:any,name:string,args:any){const r=await db.rpc(name,args);if(r.error)throw new Error('Billing operation requires staff reconciliation');return r.data;}
export async function createReservedSubscription(db:any,rentalId:string,env:StripeEnv,actor:string){
 const stripe=await reconciliationClient(env);
 const op=await rpc(db,'stripe_claim_creation',{_rental:rentalId,_env:env,_actor:actor});
 try{
 const p=op.parameters;
 const price=await stripe.prices.create({currency:'usd',unit_amount:p.cents,recurring:{interval:'week'},product_data:{name:`Weekly Rent — Rental ${rentalId.slice(0,8)}`}},{idempotencyKey:`rental-price:${op.operation_id}`});
 const sub=await stripe.subscriptions.create({customer:p.customer,default_payment_method:p.payment_method,items:[{price:price.id}],collection_method:'charge_automatically',proration_behavior:'none',
 billing_cycle_anchor:Math.floor(new Date(op.created_at).getTime()/1000)+60,metadata:{rentalId,operationId:op.operation_id}},{idempotencyKey:`rental-subscription:${op.operation_id}`});
 await rpc(db,'stripe_finish_creation',{_rental:rentalId,_op:op.operation_id,_sub:sub.id,_actor:actor});
 return {ok:true as const,subscriptionId:sub.id};
 }catch{
 const saved=await db.from('stripe_operations').update({state:'failed',error_code:'creation_retry_same_operation'}).eq('operation_id',op.operation_id).eq('state','pending');
 if(saved.error)throw new Error('Creation outcome unknown; staff reconciliation required. Do not create another subscription.');
 throw new Error('Creation Failed — Retry Same Operation Or Request Staff Review.');
 }
}
// Provider errors are deliberately reduced to a fixed taxonomy; never persist raw SDK errors.
export async function cancelDurably(db:any,rentalId:string,subId:string,env:StripeEnv,actor:string){
 const stripe=await reconciliationClient(env);
 const args={_rental:rentalId,_env:env,_sub:subId,_actor:actor};
 const request=await rpc(db,'stripe_cancel_state',{...args,_state:'requested'});
 if(!request || typeof request.attempt_id!=='string' || !request.attempt_id)throw new Error('Cancellation request not recorded; staff reconciliation required');
 let cancelInvoked=false;
 try{
  const current=await stripe.subscriptions.retrieve(subId);
  if(current.id!==subId || typeof current.status!=='string')throw new Error('Unverified response');
  if(current.status!=='canceled'){
   cancelInvoked=true;
   const canceled=await stripe.subscriptions.cancel(subId);
   if(canceled.id!==subId || canceled.status!=='canceled')throw new Error('Unverified response');
  }
 }catch(error){
  const e=error as {type?:string;statusCode?:number};
  const definitive=cancelInvoked && e.type==='StripeInvalidRequestError' && e.statusCode===400;
  const state=definitive?'failed':'unknown';
  const code=definitive?'provider_rejected':'provider_unverified';
  await rpc(db,'stripe_cancel_state',{...args,_attempt:request.attempt_id,_state:state,_evidence:code,_error:code});
  throw new Error(definitive?'Cancellation Failed — Provider Rejected The Request. Mapping Retained.':'Cancellation Unknown — Verify Provider State Before Retrying. Mapping Retained.');
 }
 await rpc(db,'stripe_cancel_state',{...args,_attempt:request.attempt_id,_state:'confirmed',_evidence:'provider_canceled'});
 return {ok:true as const};
}
