/** Pure reader validation and session lifecycle; no provider or mutation capabilities. */
function settledOutsideStripe(row: { stripe_payment_intent_id?: string | null; stripe_invoice_id?: string | null; failure_reason?: string | null }) {
 // Mark as Paid writes only status and paid_date. A failed autopay invoice
 // keeps stripe_invoice_id and failure_reason. A later Stripe success clears
 // only failure_reason on that already-paid row. It does not change status
 // or paid_date, and it does not store a payment intent, so the row leaves
 // the non-Stripe sum and Overview counts it once, as Stripe. When staff
 // took cash and Stripe also collected, the duplicate needs a refund.
 // Only a paid invoice that still has a failure reason was settled outside
 // Stripe.
 const reason = row.failure_reason;
 return !row.stripe_payment_intent_id && !!row.stripe_invoice_id && typeof reason === "string" && reason.trim() !== "";
}
export function paymentRevenue(result: { data: Array<{ net_collected: unknown; stripe_payment_intent_id?: string | null; stripe_invoice_id?: string | null; failure_reason?: string | null }> | null; error: unknown; count: number | null }) {
 if (result.error || !Array.isArray(result.data) || result.count !== result.data.length) return null;
 let total=0, nonStripe=0;
 for (const row of result.data) {
  if (row.net_collected === null || row.net_collected === undefined || row.net_collected === "") return null;
  const amount=Number(row.net_collected); if(!Number.isFinite(amount)) return null;
  // A payment intent or an invoice Stripe settled is already inside Stripe
  // collections. Deposit rows are not filtered here.
  total+=amount; if((!row.stripe_payment_intent_id && !row.stripe_invoice_id) || settledOutsideStripe(row)) nonStripe+=amount;
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
