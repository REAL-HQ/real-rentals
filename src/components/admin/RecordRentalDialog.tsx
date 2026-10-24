// Adapted from reviewed 406877fd RecordRentalDialog: existing modal, selector and intake fields.
// Stepped review of every fact Record Rental relies on. Each step explains what is missing
// (record-rental-readiness.ts); the database re-checks everything on Save. Disabled while
// RECORD_RENTAL_CONTRACT_ENABLED is false: DriversPanel does not open it, and every server
// function it calls refuses.
import { useEffect, useRef, useState } from 'react';
import { useServerFn } from '@tanstack/react-start';
import { supabase } from '@/integrations/supabase/client';
import { ModalShell, ModalHeader, ModalBody, ModalFooter, ModalButton, ConfirmDialog, Field, FormGrid, inputCls } from './modal';
import { PaperAgreements } from './PaperAgreements';
import { recordExistingRentalV3 } from '@/lib/record-rental.functions';
import { RECORD_RENTAL_CONTRACT_ENABLED, recordRequest } from '@/lib/record-rental-contract';
import { readRecovery, saveRecovery, recoveryKey, type RecordRequest } from '@/lib/record-rental-recovery';
import { recordRentalStatus, previewBillingLink, previewPositiveLicense, verifyPositiveLicense, archiveSignedAgreement,
 registerHistoricalAgreement, registerLegacyEsignAgreement, voidHistoricalAgreement } from '@/lib/record-rental-evidence.functions';
import { listPaperAgreementOriginals } from '@/lib/paper-agreements.functions';
import { EXPLANATIONS, STEPS, historicalDefaults, provenanceLabel, recordRentalSteps,
 type Blocker, type BillingPreview, type RecordRentalStatus, type StepKey } from '@/lib/record-rental-readiness';
type Vehicle = {id:string;year?:number|null;make?:string|null;model?:string|null;color?:string|null;license_plate?:string|null;status?:string|null};
type Original = {id:string;file_name:string|null;content_sha256:string|null;is_current:boolean|null;agreement_type:string|null;signed_on:string|null;provenance:string};
const vehicleLabel=(v?:Vehicle)=>v?[v.year,v.color,v.make,v.model,v.license_plate].filter(Boolean).join(' · '):'Not Selected';
const money=(cents:number|null|undefined)=>cents==null?'Unknown':`$${(cents/100).toFixed(2)}`;
const short=(sha?:string|null)=>sha?`${sha.slice(0,12)}…`:'—';
const message=(e:unknown)=>e instanceof Error?e.message:'Request failed';

function Blockers({codes}:{codes:Blocker[]}) {
 if(!codes.length) return <p className="text-sm text-success">Ready.</p>;
 return <ul className="space-y-2" aria-label="Requirements Not Met">{codes.map(c=><li key={c} className="rounded-lg border border-border px-3 py-2 text-sm">
  <span className="font-medium">{EXPLANATIONS[c][0]}</span> — {EXPLANATIONS[c][1]}</li>)}</ul>;
}
function Facts({rows}:{rows:[string,React.ReactNode][]}) {
 return <dl className="divide-y divide-border rounded-xl border border-border text-sm">{rows.map(([k,v])=><div key={k} className="flex justify-between gap-3 px-4 py-2">
  <dt className="text-muted-foreground">{k}</dt><dd className="text-right font-medium break-all">{v}</dd></div>)}</dl>;
}

export function RecordRentalDialog({driver,vehicles,onClose,onRecorded}:{driver:{id:string;full_name?:string|null};vehicles:Vehicle[];onClose:()=>void;onRecorded:()=>void}) {
 const record=useServerFn(recordExistingRentalV3), readStatus=useServerFn(recordRentalStatus), readBilling=useServerFn(previewBillingLink),
  licencePreview=useServerFn(previewPositiveLicense), licenceVerify=useServerFn(verifyPositiveLicense), archive=useServerFn(archiveSignedAgreement),
  registerPaper=useServerFn(registerHistoricalAgreement), registerLegacy=useServerFn(registerLegacyEsignAgreement),
  voidHistorical=useServerFn(voidHistoricalAgreement), listOriginals=useServerFn(listPaperAgreementOriginals);
 const [actor,setActor]=useState<string|null>(null),[pending,setPending]=useState<RecordRequest|null>(null);
 const [vehicleId,setVehicle]=useState(''),[startedAt,setStart]=useState(''),[mileage,setMiles]=useState(''),[rate,setRate]=useState(''),[deposit,setDeposit]=useState(''),[reason,setReason]=useState(''),[confirm,setConfirm]=useState('');
 const [error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [step,setStep]=useState<StepKey>('driver'),[facts,setFacts]=useState<RecordRentalStatus|null>(null),[action,setAction]=useState(''),[notice,setNotice]=useState('');
 const [licence,setLicence]=useState<{fingerprint:string;snapshot:unknown}|null>(null),[licenceConfirmed,setLicenceConfirmed]=useState(false);
 const [billing,setBilling]=useState<BillingPreview|'unavailable'|null>(null),[billingChecked,setBillingChecked]=useState(false);
 const [originals,setOriginals]=useState<Original[]>([]),[documentId,setDocument]=useState(''),[signedOn,setSignedOn]=useState(''),[terms,setTerms]=useState(''),[voidReason,setVoidReason]=useState(''),[voidOpen,setVoidOpen]=useState(false);
 // A registration keeps its operation ids until it succeeds, so a lost response recovers the same operation.
 const [ops,setOps]=useState(()=>({register:crypto.randomUUID(),paper:crypto.randomUUID()}));
 const generation=useRef(0), currentActor=useRef<string|null>(null);
 useEffect(()=>{
  const {data}=supabase.auth.onAuthStateChange((_event,session)=>{
   const nextActor=session?.user.id??null;
   if(currentActor.current!==nextActor){setVehicle('');setStart('');setMiles('');setRate('');setDeposit('');setReason('');setConfirm('');
    setFacts(null);setLicence(null);setLicenceConfirmed(false);setBilling(null);setBillingChecked(false);setOriginals([]);setDocument('');setSignedOn('');setTerms('');setVoidReason('');setStep('driver');}
   generation.current++;currentActor.current=nextActor;setActor(currentActor.current);setBusy(false);setPending(null);setError('');setAction('');setNotice('');
   if(currentActor.current) {try {setPending(readRecovery(sessionStorage,currentActor.current,driver.id));}catch {setError('Recovery could not be read. Resolve the original operation before recording.');}}
  });
  return ()=>{generation.current++;currentActor.current=null;data.subscription.unsubscribe()};
 },[driver.id]);
 useEffect(()=>{if(actor&&RECORD_RENTAL_CONTRACT_ENABLED)void refresh();},[actor]);
 // Runs one server call for the current staff session; a session change discards the result.
 async function run<T>(name:string,call:()=>Promise<T>,done:(value:T)=>void){
  const owner=actor,epoch=generation.current;if(!owner||action)return;
  setAction(name);setNotice('');
  try{const value=await call();if(epoch===generation.current&&currentActor.current===owner)done(value);}
  catch(e){if(epoch===generation.current&&currentActor.current===owner)setNotice(message(e));}
  finally{if(epoch===generation.current&&currentActor.current===owner)setAction('');}
 }
 async function refresh(){
  const owner=actor,epoch=generation.current;
  try{
   const next=await readStatus({data:{applicationId:driver.id}});
   const docs=next.historicalInstalled&&!next.historical?await listOriginals({data:{applicationId:driver.id}}).catch(()=>[]):[];
   if(epoch!==generation.current||currentActor.current!==owner)return;
   setFacts(next);setOriginals((docs as Original[]).filter(d=>d.provenance==='Verified'&&d.is_current&&d.agreement_type==='original'));
   // A registered agreement already fixed these values; the record must repeat them exactly.
   const fixed=historicalDefaults(next);
   if(fixed){setVehicle(fixed.vehicleId);setStart(fixed.startedAt);setRate(fixed.weeklyRate);setDeposit(fixed.deposit);}
  }catch(e){if(epoch===generation.current&&currentActor.current===owner)setNotice(message(e));}
 }
 const billingState=billingChecked&&billing&&billing!=='unavailable'?billing:billing==='unavailable'?'unavailable':null;
 const view=facts?recordRentalSteps(facts,{vehicleId,startedAt,weeklyRate:rate,deposit,mileage,reason,licenceConfirmed,billing:billingState}):null;
 const draft = recordRequest.omit({operationId:true}).safeParse({applicationId:driver.id,vehicleId,startedAt,weeklyRate:Number(rate),deposit:deposit===''?null:Number(deposit),pickupMileage:mileage===''?null:Number(mileage),subscriptionEvidenceId:null,reason});
 const validationError = !pending && !draft.success ? draft.error.issues.map(issue=>issue.message).join('; ') : '';
 async function submit(){
  if(!RECORD_RENTAL_CONTRACT_ENABLED||!actor||busy||error||(!pending&&(!draft.success||!view?.ready))) return;
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
 const amounts={rentalStart:startedAt,weeklyRate:Number(rate),deposit:deposit===''?null:Number(deposit),termsSummary:terms};
 const registerReady=!!vehicleId&&!!startedAt&&rate!==''&&terms.trim().length>=10;
 const index=STEPS.findIndex(([k])=>k===step), current=view?.steps[index];
 const vehicle=vehicles.find(v=>v.id===vehicleId), h=facts?.historical;
 const open=facts?.agreements.filter(a=>!a.voided&&a.status!=='voided')??[];
 // Registration is offered only where the database would accept it: a paper original when no
 // agreement is open, or the one open, signed and archived eSign agreement that has no signed terms.
 const canPaper=!!facts?.historicalInstalled&&!h&&open.length===0;
 const legacy=facts?.historicalInstalled&&!h&&open.length===1&&open[0].status==='signed'&&open[0].archived&&!open[0].signedTerms?open[0]:null;
 const blockersFor=(key:StepKey)=>view?.steps.find(s=>s.key===key)?.blockers??[];

 const body=()=>{
  if(!facts) return <p>{notice||'Loading driver evidence…'}</p>;
  switch(step){
  case 'driver': return <div className="space-y-4">
   <Facts rows={[['Driver',facts.driver.name??'Unnamed driver'],['Portal Login',facts.driver.portalLogin?'Linked':'Not Linked'],['Record',facts.driver.archived?'Archived':'Active']]}/>
   <Field label="Vehicle" required><select className={inputCls} value={vehicleId} disabled={!!h} onChange={e=>setVehicle(e.target.value)}><option value="">Select Verified Vehicle</option>{vehicles.map(v=><option key={v.id} value={v.id}>{vehicleLabel(v)}</option>)}</select></Field>
   {h&&<p className="text-sm">The registered agreement names this vehicle. Void it to choose another.</p>}
   <Blockers codes={blockersFor('driver')}/></div>;
  case 'licence': return <div className="space-y-4">
   <Facts rows={[['Front Image',facts.licence.front],['Back Image',facts.licence.back],['Licence Number',facts.licence.number?'On File':'Missing'],['State',facts.licence.state?'On File':'Missing'],['Expires',facts.licence.expiresOn??'Missing'],['Licence Check',licenceConfirmed?'Confirmed This Session':licence?'Ready To Confirm':'Not Run']]}/>
   <p className="text-sm">The check preserves the reviewed images, then shows the details the database will rely on. Confirm only if they match the images.</p>
   {licence&&!licenceConfirmed&&<pre className="max-h-48 overflow-auto rounded-lg bg-muted p-3 text-xs">{JSON.stringify(licence.snapshot,null,2)}</pre>}
   <div className="flex gap-2">
    <ModalButton disabled={!!action||licenceConfirmed} onClick={()=>run('licence',()=>licencePreview({data:{applicationId:driver.id}}),v=>setLicence({fingerprint:v.fingerprint,snapshot:v.snapshot}))}>Run Licence Check</ModalButton>
    <ModalButton variant="primary" disabled={!!action||!licence||licenceConfirmed} onClick={()=>licence&&run('licence',()=>licenceVerify({data:{applicationId:driver.id,fingerprint:licence.fingerprint}}),()=>setLicenceConfirmed(true))}>Confirm Licence Verified</ModalButton>
   </div><Blockers codes={blockersFor('licence')}/></div>;
  case 'agreement': return <div className="space-y-4">
   <Facts rows={[['Provenance',provenanceLabel(facts,view!.route)],...(h?[['Source',h.source==='legacy_esign'?'Legacy eSign (byte-identical copy)':'Paper Original'],['Document SHA-256',short(h.documentSha256)],['Signed',h.legacySignedAt??h.signedOn],['Registered',h.registeredAt],['Start',h.rentalStart],['Weekly Rate',money(h.weeklyCents)],['Deposit',money(h.depositCents)]] as [string,string][]:[])]}/>
   {facts.agreements.length>0&&<div className="space-y-2">{facts.agreements.map(a=><div key={a.id} className="rounded-lg border border-border px-3 py-2 text-sm">
    <div className="font-medium">eSign Agreement · {a.voided||a.status==='voided'?'Voided':a.status==='signed'?'Signed':'Awaiting Signature'}</div>
    <div className="text-muted-foreground">{vehicleLabel(vehicles.find(v=>v.id===a.vehicleId))} · Signed {a.signedAt??'—'} · {a.archived?'Archived':'Not Archived'} · {a.signedTerms?'Signed Rental Terms':'No Signed Rental Terms'} · SHA-256 {short(a.sha256)}</div>
    {!a.voided&&a.status==='signed'&&!a.archived&&<ModalButton className="mt-2" disabled={!!action} onClick={()=>run('archive',()=>archive({data:{agreementId:a.id}}),()=>void refresh())}>Archive Signed Agreement</ModalButton>}
   </div>)}</div>}
   {h?<div className="space-y-2">
    <p className="text-sm">Not yet used by a rental. Void it if it is wrong; the original stays preserved and the void is audited.</p>
    <ModalButton disabled={!!action} onClick={()=>setVoidOpen(true)}>Void Historical Agreement</ModalButton>
   </div>:(canPaper||legacy)&&<div className="space-y-3">
    <p className="text-sm">{legacy?'Register this eSign agreement as staff-verified: the server copies its archived PDF byte for byte and keeps its signing date. Confirm the start, weekly rate and deposit written in it':'Register a signed paper original: confirm the start, weekly rate and deposit written in it'} (also used in Rental Details) and summarize the terms you checked.</p>
    <FormGrid cols={2}>
     {canPaper&&<Field label="Paper Original"><select className={inputCls} value={documentId} onChange={e=>{setDocument(e.target.value);setSignedOn(originals.find(o=>o.id===e.target.value)?.signed_on??'');}}>
      <option value="">{originals.length?'Select Uploaded Original':'No Verified Originals Uploaded'}</option>{originals.map(o=><option key={o.id} value={o.id}>{o.file_name??'Original'} · {o.signed_on??'Undated'} · {short(o.content_sha256)}</option>)}</select></Field>}
     {canPaper&&<Field label="Date Written On Agreement"><input className={inputCls} type="date" value={signedOn} onChange={e=>setSignedOn(e.target.value)}/></Field>}
     <Field label="Verified Start (With UTC Offset)"><input className={inputCls} placeholder="2026-08-01T10:00:00-04:00" value={startedAt} onChange={e=>setStart(e.target.value)}/></Field>
     <Field label="Weekly Rate"><input className={inputCls} value={rate} onChange={e=>setRate(e.target.value)}/></Field>
     <Field label="Deposit (Blank If Unknown)"><input className={inputCls} value={deposit} onChange={e=>setDeposit(e.target.value)}/></Field>
    </FormGrid>
    <Field label="Terms Checked"><textarea className={inputCls} rows={3} value={terms} onChange={e=>setTerms(e.target.value)}/></Field>
    {legacy?<ModalButton variant="primary" disabled={!!action||!registerReady} onClick={()=>run('legacy',()=>registerLegacy({data:{operationId:ops.register,paperOperationId:ops.paper,agreementId:legacy.id,...amounts}}),()=>{setOps({register:crypto.randomUUID(),paper:crypto.randomUUID()});void refresh();})}>Register As Legacy Agreement</ModalButton>
     :<ModalButton variant="primary" disabled={!!action||!registerReady||!documentId||!signedOn} onClick={()=>run('register',()=>registerPaper({data:{operationId:ops.register,applicationId:driver.id,vehicleId,documentId,signedOn,...amounts}}),()=>{setOps({register:crypto.randomUUID(),paper:crypto.randomUUID()});void refresh();})}>Register Signed Original</ModalButton>}
   </div>}
   <PaperAgreements applicationId={driver.id}/>
   <Blockers codes={blockersFor('agreement')}/></div>;
  case 'details': return <div className="space-y-4">
   <FormGrid cols={2}>
    <Field label="Verified Pickup Time (With UTC Offset)" required><input className={inputCls} placeholder="2026-10-15T10:00:00-04:00" disabled={!!h} value={startedAt} onChange={e=>setStart(e.target.value)}/></Field>
    <Field label="Pickup Mileage"><input className={inputCls} inputMode="numeric" value={mileage} onChange={e=>setMiles(e.target.value)}/></Field>
    <Field label="Weekly Rate" required><input className={inputCls} disabled={!!h} value={rate} onChange={e=>setRate(e.target.value)}/></Field>
    <Field label="Deposit Collected"><input className={inputCls} placeholder="Unknown" disabled={!!h} value={deposit} onChange={e=>setDeposit(e.target.value)}/></Field>
   </FormGrid>
   <p className="text-sm">A date alone is not enough; never guess a pickup time. Deposit: blank means unknown, 0 means confirmed none.{h?' Start, rate and deposit come from the registered agreement.':''}</p>
   <Field label="Reason For Recording" required><input className={inputCls} value={reason} onChange={e=>setReason(e.target.value)}/></Field>
   <Blockers codes={blockersFor('details')}/></div>;
  case 'billing': return <div className="space-y-4">
   <p className="text-sm">Recording links the driver's existing Stripe subscription, if there is one. It never creates a customer, subscription, charge or invoice, and never imports past payments.</p>
   <ModalButton disabled={!!action} onClick={()=>{setBillingChecked(false);setBilling(null);run('billing',()=>readBilling({data:{applicationId:driver.id}}),v=>setBilling(v)).then(()=>setBilling(b=>b??'unavailable'));}}>Check Existing Stripe Link</ModalButton>
   {billing&&billing!=='unavailable'&&<>
    <Facts rows={[['Environment',billing.environment==='live'?'Live':'Sandbox'],['Customer',billing.customer??'None'],['Subscription',billing.subscription??'None (rental recorded without billing)'],['Weekly Amount',billing.unitAmount==null?'—':money(billing.unitAmount)],['Next Due',billing.nextDue??'—'],['Checked',billing.observedAt]]}/>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={billingChecked} onChange={e=>setBillingChecked(e.target.checked)}/>I Checked This Is The Driver's Existing Billing</label>
   </>}
   <Blockers codes={blockersFor('billing')}/></div>;
  case 'review': return <div className="space-y-4">
   <Facts rows={[['Driver',facts.driver.name??'Unnamed driver'],['Vehicle',vehicleLabel(vehicle)],['Licence',licenceConfirmed?'Confirmed':'Not Confirmed'],
    ['Agreement',provenanceLabel(facts,view!.route)],['Pickup',startedAt||'—'],['Mileage',mileage||'Unknown'],['Weekly Rate',rate?`$${rate}`:'—'],['Deposit',deposit===''?'Unknown':`$${deposit}`],
    ['Billing',billingState&&billingState!=='unavailable'?(billingState.subscription??'No Subscription'):'Not Checked'],['Reason',reason||'—']]}/>
   <Blockers codes={view!.steps[index].blockers}/>
   <p className="text-sm">Identity, licence, agreement, vehicle availability and billing are re-checked by the database when you save. No charges, subscriptions, messages or payment imports.</p>
   <Field label="Type RECORD RENTAL To Confirm"><input className={inputCls} value={confirm} onChange={e=>setConfirm(e.target.value)}/></Field>
  </div>;
  }
 };
 return <ModalShell onClose={onClose} size="lg" label="Record Rental">
  <ModalHeader title="Record Rental" subtitle={`${driver.full_name??'Driver'} · Existing Rental`} onClose={onClose}/>
  <ModalBody>
   {pending?<p>Unresolved operation {pending.operationId}. Only this exact request may be reconciled; no new operation is allowed.</p>:<>
    <nav className="mb-4 flex flex-wrap gap-2" aria-label="Record Rental Steps">{STEPS.map(([key,title],i)=>{const n=view?.steps[i].blockers.length;
     return <ModalButton key={key} variant={key===step?'primary':'ghost'} aria-current={key===step?'step':undefined} onClick={()=>setStep(key)}>{title}{view&&key!=='review'?(n?` (${n})`:' ✓'):''}</ModalButton>;})}</nav>
    <fieldset disabled={busy} className="space-y-3">{body()}</fieldset>
   </>}
   {(error||notice||(step==='review'&&validationError))&&<p role="alert" className="mt-3">{error||notice||validationError}</p>}
  </ModalBody>
  <ModalFooter left={!pending&&index>0?<ModalButton variant="ghost" onClick={()=>setStep(STEPS[index-1][0])}>Back</ModalButton>:undefined}>
   <ModalButton variant="ghost" onClick={onClose}>Close</ModalButton>
   {!pending&&step!=='review'?<ModalButton onClick={()=>setStep(STEPS[index+1][0])}>{current?.blockers.length?'Next (Not Ready)':'Next'}</ModalButton>
    :<ModalButton variant="primary" disabled={!RECORD_RENTAL_CONTRACT_ENABLED||!actor||busy||!!error||(!pending&&(!!validationError||!view?.ready))||confirm!=='RECORD RENTAL'} onClick={submit}>{pending?'Reconcile Original Operation':'Record Rental'}</ModalButton>}
  </ModalFooter>
  {voidOpen&&h&&<ConfirmDialog title="Void Historical Agreement" confirmLabel="Void Agreement" busy={action==='void'} onCancel={()=>setVoidOpen(false)}
   onConfirm={()=>{if(voidReason.trim().length<5){setNotice(EXPLANATIONS.reason_required[0]+': give a reason for voiding (5 to 500 characters).');return;}
    run('void',()=>voidHistorical({data:{historicalAgreementId:h.id,reason:voidReason.trim()}}),()=>{setVoidOpen(false);setVoidReason('');setVehicle('');setStart('');setRate('');setDeposit('');void refresh();});}}>
   <p className="text-sm">The original stays preserved; the void and your reason are recorded in the audit log. It cannot be undone.</p>
   <Field label="Reason" required><textarea className={inputCls} rows={3} value={voidReason} onChange={e=>setVoidReason(e.target.value)}/></Field>
  </ConfirmDialog>}
 </ModalShell>;
}
