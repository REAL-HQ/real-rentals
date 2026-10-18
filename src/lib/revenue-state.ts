/** Pure reader validation and session lifecycle; no provider or mutation capabilities. */
export function paymentRevenue(result: { data: Array<{ net_collected: unknown; stripe_payment_intent_id?: string | null }> | null; error: unknown; count: number | null }) {
 if (result.error || !Array.isArray(result.data) || result.count !== result.data.length) return null;
 let total=0, nonStripe=0;
 for (const row of result.data) {
  if (row.net_collected === null || row.net_collected === undefined || row.net_collected === "") return null;
  const amount=Number(row.net_collected); if(!Number.isFinite(amount)) return null;
  total+=amount; if(!row.stripe_payment_intent_id) nonStripe+=amount;
 }
 return {total,nonStripe};
}
export type RevenueSession = { epoch:number; ready:boolean; collections:boolean };
export function createRevenueBoundary(authorize:(id:string)=>Promise<{ allowed:boolean; collections:boolean }>,
 invalidate:()=>void, publish:(state:RevenueSession)=>void) {
 let epoch=0, disposed=false;
 return {
  ticket:()=>epoch,
  change(userId:string|null) {
   const current=++epoch; invalidate(); publish({epoch:current,ready:false,collections:false});
   if(!userId || disposed) return;
   // Defer Supabase calls out of its synchronous Auth callback.
   void Promise.resolve().then(()=>authorize(userId)).then(role=>{
    if(!disposed && current===epoch) publish({epoch:current,ready:role.allowed,collections:role.allowed && role.collections});
   }).catch(()=>{ /* Remain unavailable; never retain a prior account's state. */ });
  },
  dispose(){disposed=true;epoch++;}
 };
}
