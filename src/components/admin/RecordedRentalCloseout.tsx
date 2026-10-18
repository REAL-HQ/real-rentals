import { useEffect, useRef, useState } from 'react';
import { useServerFn } from '@tanstack/react-start';
import { supabase } from '@/integrations/supabase/client';
import { endRental } from '@/lib/rentals.functions';
import { RECORD_RENTAL_CONTRACT_ENABLED } from '@/lib/record-rental-contract';
import { ModalShell, ModalHeader, ModalBody, ModalFooter, ModalButton, inputCls } from './modal';
import { z } from 'zod';
const operation=z.object({actor:z.string().uuid(),rentalId:z.string().uuid(),endedAt:z.string().datetime({offset:true}),operationId:z.string().uuid(),returnMileage:z.number().int().min(0).max(2000000).nullable(),vehicleStatus:z.enum(['available','maintenance']),reason:z.string().min(5).max(500)}).strict();
export function RecordedRentalCloseout({rentalId,onClose,onSaved}:{rentalId:string;onClose:()=>void;onSaved:()=>void}){
 const close=useServerFn(endRental),generation=useRef(0),who=useRef<string|null>(null);
 const [actor,setActor]=useState<string|null>(null),[pending,setPending]=useState<z.infer<typeof operation>|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [endedAt,setEnd]=useState(''),[mileage,setMiles]=useState(''),[reason,setReason]=useState(''),[status,setStatus]=useState<'available'|'maintenance'>('maintenance');
 const key=(a:string)=>`rr-close-v3:${a}:${rentalId}`;
 useEffect(()=>{const {data}=supabase.auth.onAuthStateChange((_event,session)=>{const nextActor=session?.user.id??null;if(who.current!==nextActor){setEnd('');setMiles('');setReason('');setStatus('maintenance')}generation.current++;who.current=nextActor;setActor(who.current);setPending(null);setError('');setBusy(false);if(who.current)try{const raw=sessionStorage.getItem(key(who.current));if(raw){const p=operation.parse(JSON.parse(raw));if(p.actor!==who.current||p.rentalId!==rentalId)throw Error('binding');setPending(p)}}catch{setError('Recovery unavailable. Resolve the original operation before proceeding.')}});return()=>{generation.current++;who.current=null;data.subscription.unsubscribe()}},[rentalId]);
 const draft = operation.omit({operationId:true}).safeParse({actor,rentalId,endedAt,returnMileage:mileage===''?null:Number(mileage),vehicleStatus:status,reason});
 const validationError = !pending && !draft.success ? draft.error.issues.map(issue=>issue.message).join('; ') : '';
 async function submit(){if(!RECORD_RENTAL_CONTRACT_ENABLED||!actor||busy||error||(!pending&&!draft.success))return;const a=actor,g=generation.current;try{
  const p=pending??operation.parse({...draft.data,operationId:crypto.randomUUID()});
  sessionStorage.setItem(key(a),JSON.stringify(p));setPending(p);setBusy(true);
  const r=await close({data:{rentalId:p.rentalId,closeoutV2:{operationId:p.operationId,endedAt:p.endedAt,expectedActorId:a},returnMileage:p.returnMileage,vehicleStatus:p.vehicleStatus,reason:p.reason}});
  if(g!==generation.current||who.current!==a)return;
  if(!r.ok)throw Error('Closeout rejected; reconcile the original operation');
  sessionStorage.removeItem(key(a));setPending(null);onSaved();
 }catch(e){if(g===generation.current&&who.current===a)setError(e instanceof Error?e.message:'Outcome unknown')}finally{if(g===generation.current&&who.current===a)setBusy(false)}}
 return <ModalShell onClose={onClose} size="lg" label="Close recorded rental"><ModalHeader title="Close recorded rental" onClose={onClose}/><ModalBody>
 <p>Disabled pending installation and acceptance. Existing safety checks decide whether the vehicle can be released.</p>
 {pending?<p>Reconcile operation {pending.operationId}. Its original inputs are preserved.</p>:<fieldset disabled={busy} className="space-y-3"><label>Verified return timestamp with offset<input className={inputCls} placeholder="2026-10-16T12:00:00-04:00" value={endedAt} onChange={e=>setEnd(e.target.value)}/></label><label>Return mileage<input className={inputCls} value={mileage} onChange={e=>setMiles(e.target.value)}/></label><label>Requested disposition<select className={inputCls} value={status} onChange={e=>setStatus(e.target.value as typeof status)}><option value="maintenance">Maintenance</option><option value="available">Available only if safety checks allow</option></select></label><label>Reason<input className={inputCls} value={reason} onChange={e=>setReason(e.target.value)}/></label></fieldset>}
 {(error||validationError)&&<p role="alert">{error||validationError}</p>}</ModalBody><ModalFooter><ModalButton variant="ghost" onClick={onClose}>Close</ModalButton><ModalButton disabled={!RECORD_RENTAL_CONTRACT_ENABLED||!actor||busy||!!error||!!validationError} onClick={submit}>{pending?'Reconcile original operation':'End recorded rental'}</ModalButton></ModalFooter></ModalShell>;
}
