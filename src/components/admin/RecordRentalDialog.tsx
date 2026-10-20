// Adapted from reviewed 406877fd RecordRentalDialog: existing modal, selector and intake fields.
import { useEffect, useRef, useState } from 'react';
import { useServerFn } from '@tanstack/react-start';
import { supabase } from '@/integrations/supabase/client';
import { ModalShell, ModalHeader, ModalBody, ModalFooter, ModalButton, inputCls } from './modal';
import { MicroLabel } from './ui';
import { recordExistingRentalV3 } from '@/lib/record-rental.functions';
import { RECORD_RENTAL_CONTRACT_ENABLED, recordRequest } from '@/lib/record-rental-contract';
import { readRecovery, saveRecovery, recoveryKey, type RecordRequest } from '@/lib/record-rental-recovery';
type Vehicle = {id:string;year?:number|null;make?:string|null;model?:string|null;color?:string|null;license_plate?:string|null;status?:string|null};
export function RecordRentalDialog({driver,vehicles,onClose,onRecorded}:{driver:{id:string;full_name?:string|null};vehicles:Vehicle[];onClose:()=>void;onRecorded:()=>void}) {
 const record=useServerFn(recordExistingRentalV3);
 const [actor,setActor]=useState<string|null>(null),[pending,setPending]=useState<RecordRequest|null>(null);
 const [vehicleId,setVehicle]=useState(''),[startedAt,setStart]=useState(''),[mileage,setMiles]=useState(''),[rate,setRate]=useState(''),[deposit,setDeposit]=useState(''),[evidence,setEvidence]=useState(''),[reason,setReason]=useState(''),[confirm,setConfirm]=useState('');
 const [error,setError]=useState(''),[busy,setBusy]=useState(false);
 const generation=useRef(0), currentActor=useRef<string|null>(null);
 useEffect(()=>{
  const {data}=supabase.auth.onAuthStateChange((_event,session)=>{
   const nextActor=session?.user.id??null;
   if(currentActor.current!==nextActor){setVehicle('');setStart('');setMiles('');setRate('');setDeposit('');setEvidence('');setReason('');setConfirm('');}
   generation.current++;currentActor.current=nextActor;setActor(currentActor.current);setBusy(false);setPending(null);setError('');
   if(currentActor.current) {try {setPending(readRecovery(sessionStorage,currentActor.current,driver.id));}catch {setError('Recovery could not be read. Resolve the original operation before recording.');}}
  });
  return ()=>{generation.current++;currentActor.current=null;data.subscription.unsubscribe()};
 },[driver.id]);
 const draft = recordRequest.omit({operationId:true}).safeParse({applicationId:driver.id,vehicleId,startedAt,weeklyRate:Number(rate),deposit:deposit===''?null:Number(deposit),pickupMileage:mileage===''?null:Number(mileage),subscriptionEvidenceId:evidence||null,reason});
 const validationError = !pending && !draft.success ? draft.error.issues.map(issue=>issue.message).join('; ') : '';
 async function submit(){
  if(!RECORD_RENTAL_CONTRACT_ENABLED||!actor||busy||error||(!pending&&!draft.success)) return;
  const owner=actor,epoch=generation.current;
  try {
   const request=pending??recordRequest.parse({...draft.data,operationId:crypto.randomUUID()});
   // Persist BEFORE the request. Storage failure prevents submission. Never replace an unknown operation.
   saveRecovery(sessionStorage,owner,request);setPending(request);setBusy(true);
   const result=await record({data:{request,expectedActorId:owner}});
   if(epoch!==generation.current||currentActor.current!==owner)return;
   sessionStorage.removeItem(recoveryKey(owner,driver.id));setPending(null);onRecorded();
  }catch(e){if(epoch===generation.current&&currentActor.current===owner)setError(e instanceof Error?e.message:'Outcome unknown; reconcile the original operation');}
  finally{if(epoch===generation.current&&currentActor.current===owner)setBusy(false)}
 }
 return <ModalShell onClose={onClose} size="lg" label="Record Rental">
  <ModalHeader title="Record Rental" subtitle={`${driver.full_name??'Driver'} · existing rental`} onClose={onClose}/>
  <ModalBody>
   <p>Disabled until the database contracts and hosted acceptance are complete. No charges, subscriptions, messages or historical payment imports.</p>
   {pending?<p>Unresolved operation {pending.operationId}. Only this exact request may be reconciled; no new operation is allowed.</p>:<fieldset disabled={busy} className="space-y-3 mt-4">
    <label><MicroLabel>Vehicle</MicroLabel><select className={inputCls} value={vehicleId} onChange={e=>setVehicle(e.target.value)}><option value="">Select verified vehicle</option>{vehicles.map(v=><option key={v.id} value={v.id}>{[v.year,v.color,v.make,v.model,v.license_plate].filter(Boolean).join(' · ')}</option>)}</select></label>
    <label><MicroLabel>Verified pickup timestamp with UTC offset</MicroLabel><input className={inputCls} placeholder="2026-10-15T10:00:00-04:00" value={startedAt} onChange={e=>setStart(e.target.value)}/></label>
    <p>Date alone is insufficient. Do not infer a pickup time.</p>
    <label><MicroLabel>Pickup mileage</MicroLabel><input className={inputCls} value={mileage} onChange={e=>setMiles(e.target.value)}/></label>
    <label><MicroLabel>Weekly rate</MicroLabel><input className={inputCls} value={rate} onChange={e=>setRate(e.target.value)}/></label>
    <label><MicroLabel>Deposit collected</MicroLabel><input className={inputCls} placeholder="Unknown" value={deposit} onChange={e=>setDeposit(e.target.value)}/></label>
    <p>Blank means unknown; 0 means confirmed zero.</p>
    <label><MicroLabel>Verified subscription evidence reference (optional)</MicroLabel><input className={inputCls} value={evidence} onChange={e=>setEvidence(e.target.value)}/></label>
    <p>The server must validate evidence. A typed reference is not verification.</p>
    <label><MicroLabel>Reason</MicroLabel><input className={inputCls} value={reason} onChange={e=>setReason(e.target.value)}/></label>
   </fieldset>}
   <p>Identity review, license, agreement, vehicle availability and subscription evidence are revalidated by the database transaction. No eligibility approval is inferred here.</p>
   <label><MicroLabel>Type RECORD RENTAL to confirm</MicroLabel><input className={inputCls} value={confirm} onChange={e=>setConfirm(e.target.value)}/></label>
   {(error||validationError)&&<p role="alert">{error||validationError}</p>}
  </ModalBody><ModalFooter><ModalButton variant="ghost" onClick={onClose}>Close</ModalButton><ModalButton variant="primary" disabled={!RECORD_RENTAL_CONTRACT_ENABLED||!actor||busy||!!error||!!validationError||confirm!=='RECORD RENTAL'} onClick={submit}>{pending?'Reconcile original operation':'Record Rental'}</ModalButton></ModalFooter>
 </ModalShell>;
}
