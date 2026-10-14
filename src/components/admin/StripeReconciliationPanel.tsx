import { useEffect, useState } from 'react';
import { useServerFn } from '@tanstack/react-start';
import { listStripeReview, linkStripeSubscription, previewStripeHistory, applyStripeHistory, replayStripeEvent } from '@/lib/stripe-reconciliation.functions';
import { SectionCard } from './ui';

// Server functions and database checks independently require Manager/Owner.
export function StripeReconciliationPanel() {
 const list=useServerFn(listStripeReview),link=useServerFn(linkStripeSubscription),preview=useServerFn(previewStripeHistory),apply=useServerFn(applyStripeHistory),replay=useServerFn(replayStripeEvent);
 const [history,setHistory]=useState<any[]>([]);
 const [rows,setRows]=useState<any[]>([]),[cancellations,setCancellations]=useState<any[]>([]),[sub,setSub]=useState(''),[rental,setRental]=useState(''),[customer,setCustomer]=useState(''),[reason,setReason]=useState(''),[plan,setPlan]=useState<any>(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const refresh=async()=>{const r=await list();setRows(r.events??[]);setCancellations(r.cancellations??[]);setHistory(r.history??[])};
 useEffect(()=>{refresh().catch(()=>setMessage('Reconciliation Review Unavailable'))},[]);
 const action=async(fn:()=>Promise<unknown>)=>{setBusy(true);setMessage('');try{await fn();await refresh()}catch{setMessage('Action Refused Or Incomplete. Verify The Rental Customer, Subscription And Preview Before Retrying.')}finally{setBusy(false)}};
 return <SectionCard title="Stripe Reconciliation">
  <p className="text-sm text-muted-foreground">Unmatched Collections Are Excluded From Rental Revenue. Link Only After Verifying The Rental And Stripe Customer. Up To 100 Pending Events Shown.</p>
  {message && <p role="status">{message}</p>}
  <div className="my-3 space-y-2 text-sm">
   {cancellations.map(c=><div key={c.rental_id} className="rounded border p-3">
    <p>Rental {c.rental_id} · Billing {c.state}</p>
    <p className="font-medium">Cancellation: {c.cancellation_state ? c.cancellation_state[0].toUpperCase()+c.cancellation_state.slice(1) : 'Not Requested'}</p>
    <p>{c.cancellation_state==='confirmed' ? 'Stripe cancellation verified.' : 'Billing termination is not confirmed. Staff review required.'}</p>
    {c.cancellation_attempted_at && <p>Updated: {new Date(c.cancellation_attempted_at).toLocaleString()}</p>}
    {c.error_code && <p>{c.error_code==='provider_rejected' ? 'Stripe rejected cancellation. Subscription reference retained.' : 'Provider outcome could not be verified. Retry checks Stripe first.'}</p>}
   </div>)}
  </div>
  <details className="text-sm my-3"><summary>Cancellation attempt history (latest 100 events)</summary>
   <ul className="space-y-2 mt-2">{history.map(h=><li key={h.id} className="border rounded p-2 break-all">
    <p>Attempt {h.attempt_id} · {h.outcome} · Operation {h.operation_id}</p>
    <p>Initiated by {h.actor_user_id} · Requested {new Date(h.requested_at).toLocaleString()} · Recorded {new Date(h.recorded_at).toLocaleString()}</p>
    {h.retry_of && <p>Retry of {h.retry_of}</p>}
    <p>{h.evidence==='provider_canceled' ? 'Stripe returned canceled.' : h.evidence==='provider_rejected' ? 'Definitive provider rejection.' : h.evidence==='provider_unverified' ? 'Provider outcome unknown.' : 'Request recorded; outcome not yet recorded.'}</p>
   </li>)}</ul>
  </details>
  <div className="grid gap-2 sm:grid-cols-2 my-3">
   <input className="border rounded p-2" aria-label="Stripe Subscription ID" placeholder="Stripe Subscription ID" value={sub} onChange={e=>{setSub(e.target.value);setPlan(null)}} />
   <input className="border rounded p-2" aria-label="Existing Rental ID" placeholder="Existing Rental ID" value={rental} onChange={e=>{setRental(e.target.value);setPlan(null)}} />
   <input className="border rounded p-2" aria-label="Verified Stripe Customer ID" placeholder="Verified Stripe Customer ID (cus_...)" value={customer} onChange={e=>setCustomer(e.target.value)} />
   <input className="border rounded p-2 sm:col-span-2" aria-label="Reconciliation Reason" placeholder="Reason And Verification Performed" value={reason} onChange={e=>setReason(e.target.value)} />
  </div>
  <div className="flex gap-3 flex-wrap">
   <button disabled={busy||!sub||!rental||!customer||reason.length<8} onClick={()=>action(async()=>{await link({data:{subscriptionId:sub,rentalId:rental,confirmedCustomerId:customer,reason}});setMessage('Linked. Preview Historical Invoices Next. Refresh Overview After Reconciliation.')})}>Link Verified Rental</button>
   <button disabled={busy||!sub} onClick={()=>action(async()=>setPlan(await preview({data:{subscriptionId:sub}})))}>Preview Invoice Backfill</button>
  </div>
  {plan && <div className="mt-3"><p>{plan.invoices} Invoices · {plan.reviewRequired} Require Review · ${(plan.collectedCents/100).toFixed(2)} Provider Collections Before Refunds</p>
   <button disabled={busy} onClick={()=>action(async()=>{await apply({data:{subscriptionId:sub,previewHash:plan.hash,confirm:'APPLY VERIFIED INVOICES'}});setPlan(null);setMessage('Backfill Processed. Review Remaining Exceptions And Refresh Overview.')})}>Apply Verified Invoices From This Preview</button>
  </div>}
  <ul className="mt-3 space-y-2">{rows.map(r=><li key={r.event_id} className="break-all text-sm">{r.object_id} — {r.reason??r.state} <button disabled={busy} onClick={()=>action(()=>replay({data:{eventId:r.event_id}}))}>Replay Verified Provider State</button></li>)}</ul>
 </SectionCard>;
}
