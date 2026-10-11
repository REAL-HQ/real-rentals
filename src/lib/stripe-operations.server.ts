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
export async function cancelDurably(db:any,rentalId:string,subId:string,env:StripeEnv,actor:string){
 const stripe=await reconciliationClient(env);
 const args={_rental:rentalId,_env:env,_sub:subId,_actor:actor};
 await rpc(db,'stripe_cancel_state',{...args,_state:'requested'});
 try{
 const current=await stripe.subscriptions.retrieve(subId);
 const canceled=current.status==='canceled'?current:await stripe.subscriptions.cancel(subId);
 if(canceled.status!=='canceled')throw new Error('Unconfirmed');
 }catch{
 await rpc(db,'stripe_cancel_state',{...args,_state:'failed'});
 throw new Error('Cancellation Failed — Retry Required. Mapping Retained.');
 }
 await rpc(db,'stripe_cancel_state',{...args,_state:'confirmed'});
 return {ok:true as const};
}
