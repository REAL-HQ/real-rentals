// Local preparation only: no endpoint, credentials, provider construction or persistence.
import { z } from 'zod';
const id = z.string().uuid();
const instant = z.string().datetime({ offset: true });
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const money = z.number().int().positive().safe();
export const evidenceRequest = z.object({ operationId:id, actorId:id, applicationId:id,
 driverId:id, vehicleId:id, startedAt:instant, weeklyCents:money,
 currency:z.string().regex(/^[a-z]{3}$/), account:z.string().min(1),
 environment:z.enum(['live','sandbox']) }).strict();
export type EvidenceRequest = z.infer<typeof evidenceRequest>;
const principal = z.object({ actorId:id, sessionId:z.string().min(1), role:z.enum(['Owner','Manager']) }).strict();
const identity = z.object({ applicationId:id, driverId:id, positiveReview:id,
 reviewVersion:z.string().min(1), currentVersion:z.string().min(1),
 licenseNumber:z.string().min(1), licenseState:z.string().min(1),
 licenseExpires:z.string().regex(/^\d{4}-\d{2}-\d{2}$/), licenseDocumentVersion:z.string().min(1),
 reviewedLicenseVersion:z.string().min(1), eligible:z.literal(true) }).strict();
const agreement = z.object({ id:id, kind:z.enum(['esign','paper']), applicationId:id, driverId:id,
 vehicleId:id, weeklyCents:money, currency:z.string(), effectiveAt:instant, signedAt:instant,
 documentId:id, signedVersion:z.string().min(1), currentVersion:z.string().min(1),
 signedHash:hash, currentHash:hash, status:z.literal('signed'),
 verification:z.enum(['esign-verified','paper-registered']), provenanceId:id }).strict();
const subscription = z.object({ account:z.string(), environment:z.enum(['live','sandbox']),
 subscription:z.string().regex(/^sub_[A-Za-z0-9]+$/), customer:z.string().regex(/^cus_[A-Za-z0-9]+$/),
 applicationId:id, driverId:id, currency:z.string(), unitAmount:money, quantity:z.literal(1),
 interval:z.literal('week'), intervalCount:z.literal(1), status:z.literal('active'),
 nextDue:instant.nullable(), observedAt:instant, expiresAt:instant }).strict();
export interface EvidenceReaders {
 // These are trusted server dependencies, never request-provided objects.
 authorize(): Promise<unknown>;
 identity(applicationId:string): Promise<unknown>;
 // startedAt lets a date-only signed term match the staff-entered handover instant.
 agreement(applicationId:string,vehicleId:string,startedAt:string): Promise<unknown>;
 subscription(subscriptionId:string): Promise<unknown>;
 linkedCustomer(applicationId:string): Promise<string>;
}
function requireTrue(value:boolean):void { if(!value) throw new Error('Record Rental evidence unavailable or mismatched'); }
export async function verifyRecordEvidence(raw:unknown, subscriptionId:string|null, readers:EvidenceReaders,
 now:()=>number, signal:AbortSignal) {
 const request=evidenceRequest.parse(raw);
 const initial=principal.parse(await readers.authorize());
 requireTrue(initial.actorId===request.actorId && !signal.aborted);
 const person=identity.parse(await readers.identity(request.applicationId));
 const signed=agreement.parse(await readers.agreement(request.applicationId,request.vehicleId,request.startedAt));
 let sub:z.infer<typeof subscription>|null=null;
 if(subscriptionId!==null){
  sub=subscription.parse(await readers.subscription(subscriptionId));
  const customer=await readers.linkedCustomer(request.applicationId);
  requireTrue(sub.subscription===subscriptionId && sub.customer===customer && sub.account===request.account &&
   sub.environment===request.environment && sub.applicationId===request.applicationId && sub.driverId===request.driverId &&
   sub.currency===request.currency && sub.unitAmount===request.weeklyCents);
 }
 const final=principal.parse(await readers.authorize()); // Last await; no data returned on revoked/switched session.
 const clock=now(); requireTrue(Number.isFinite(clock));
 requireTrue(!signal.aborted && final.actorId===initial.actorId && final.sessionId===initial.sessionId);
 requireTrue(person.applicationId===request.applicationId && person.driverId===request.driverId &&
  person.reviewVersion===person.currentVersion && person.licenseDocumentVersion===person.reviewedLicenseVersion);
 const expiry=Date.parse(person.licenseExpires+'T23:59:59.999Z');
 requireTrue(Number.isFinite(expiry) && new Date(expiry).toISOString().slice(0,10)===person.licenseExpires &&
  expiry>=clock && expiry>=Date.parse(request.startedAt));
 requireTrue(signed.applicationId===request.applicationId && signed.driverId===request.driverId &&
  signed.vehicleId===request.vehicleId && signed.weeklyCents===request.weeklyCents && signed.currency===request.currency &&
  Date.parse(signed.effectiveAt)===Date.parse(request.startedAt) && Date.parse(signed.signedAt)<=Date.parse(request.startedAt) &&
  Date.parse(request.startedAt)<=clock && signed.signedVersion===signed.currentVersion && signed.signedHash===signed.currentHash &&
  signed.verification===(signed.kind==='esign'?'esign-verified':'paper-registered'));
 if(sub) requireTrue(Date.parse(sub.observedAt)<=clock && Date.parse(sub.expiresAt)>clock &&
  Date.parse(sub.expiresAt)-Date.parse(sub.observedAt)<=300000 && clock-Date.parse(sub.observedAt)<=300000);
 // NOT a browser attestation or durable token. A separately authorized DB evidence issuer must
 // bind this result to operation/actor, revalidate locked records, and atomically consume it.
 return { request, identity:person, agreement:signed, subscription:sub };
}

export interface TrustedEvidenceIssuer {
 // Must be a server-owned transport with narrowly scoped rr_evidence_issuer authority,
 // provider-authenticated identity/session propagation; never an ordinary browser RPC.
 snapshot(applicationId:string,vehicleId:string,agreementId:string,documentId:string):Promise<unknown>;
 issue(request:unknown, verified:unknown, expectedSnapshot:unknown):Promise<string>;
}
// Observation windows are freshness checks, not subscription identity. Never renew stored evidence.
function stableEvidence(value:Awaited<ReturnType<typeof verifyRecordEvidence>>) {
 const sub=value.subscription;
 if(!sub) return value;
 const {observedAt,expiresAt,...facts}=sub;
 return {...value,subscription:facts};
}
function bindDocument(snapshot:unknown, signed:z.infer<typeof agreement>) {
 const doc=z.object({document:z.object({id,version:z.string().min(1),sha256:hash})}).parse(snapshot).document;
 requireTrue(doc.id===signed.documentId && doc.version===signed.signedVersion &&
  doc.version===signed.currentVersion && doc.sha256===signed.signedHash && doc.sha256===signed.currentHash);
}
export async function issueRecordEvidence(raw:unknown, rentalRequest:unknown, subscriptionId:string|null,
 readers:EvidenceReaders, issuer:TrustedEvidenceIssuer, now:()=>number, signal:AbortSignal) {
 const {recordRequest}=await import('./record-rental-contract');
 const rental=recordRequest.parse(rentalRequest);
 const expected=principal.parse(await readers.authorize());
 const verified=await verifyRecordEvidence(raw,subscriptionId,readers,now,signal);
 requireTrue(verified.request.actorId===expected.actorId && rental.operationId===verified.request.operationId &&
 rental.applicationId===verified.request.applicationId && rental.vehicleId===verified.request.vehicleId &&
 Date.parse(rental.startedAt)===Date.parse(verified.request.startedAt) && Math.round(rental.weeklyRate*100)===verified.request.weeklyCents);
 const snapshot=await issuer.snapshot(rental.applicationId,rental.vehicleId,verified.agreement.id,verified.agreement.documentId);
 const again=await verifyRecordEvidence(raw,subscriptionId,readers,now,signal);
 bindDocument(snapshot,verified.agreement);
 bindDocument(snapshot,again.agreement);
 requireTrue(JSON.stringify(stableEvidence(again))===JSON.stringify(stableEvidence(verified)));
 const token=id.parse(await issuer.issue(rental,again,snapshot));
 const final=principal.parse(await readers.authorize());
 requireTrue(!signal.aborted && final.actorId===expected.actorId && final.sessionId===expected.sessionId);
 return {evidenceId:token,operationId:rental.operationId};
}
