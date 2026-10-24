import { z } from 'zod';
import type { CallerClient } from './record-rental-transport.server';
const uuid=z.string().uuid(), hash=z.string().regex(/^[a-f0-9]{64}$/);
const instant=z.string().datetime({offset:true});
// This is an immutable signed-terms resolver, not request metadata or current application rates.
export interface SignedArtifactReader {
 verify(agreementId:string,documentId:string,startedAt?:string):Promise<{version:string;sha256:string;bodySha256:string;
  applicationId:string;driverId:string;vehicleId:string;effectiveAt:string;weeklyCents:number;currency:string}>;
}
export async function readEsign(client:CallerClient, artifacts:SignedArtifactReader, applicationId:string, vehicleId:string, startedAt?:string) {
 const rows=await client.from('agreements').select('id,application_id,vehicle_id,status,signed_at,voided_at,archive_status,completed_document_id,sha256,body_sha256')
  .eq('application_id',applicationId).eq('vehicle_id',vehicleId).eq('status','signed').limit(2);
 if(rows.error || !Array.isArray(rows.data) || rows.data.length!==1) throw new Error('Signed agreement unavailable or ambiguous');
 const ag=z.object({id:uuid,application_id:uuid,vehicle_id:uuid,status:z.literal('signed'),signed_at:instant,
  voided_at:z.null(),archive_status:z.literal('archived'),completed_document_id:uuid,sha256:hash,body_sha256:hash}).parse(rows.data[0]);
 const docResult=await client.from('documents').select('id,driver_id,content_sha256,is_current,superseded_by,storage_bucket,storage_path')
  .eq('id',ag.completed_document_id).single();
 if(docResult.error) throw new Error('Document unavailable');
 const doc=z.object({id:uuid,driver_id:uuid,content_sha256:hash,is_current:z.literal(true),superseded_by:z.null(),
  storage_bucket:z.literal('rental-agreements'),storage_path:z.string().min(1)}).parse(docResult.data);
 const evidence=z.object({version:z.string().min(1),sha256:hash,bodySha256:hash,applicationId:uuid,driverId:uuid,
  vehicleId:uuid,effectiveAt:instant,weeklyCents:z.number().int().positive().safe(),currency:z.string().regex(/^[a-z]{3}$/)})
  .parse(await artifacts.verify(ag.id,doc.id,startedAt));
 if(doc.id!==ag.completed_document_id || ag.application_id!==applicationId || ag.vehicle_id!==vehicleId || doc.driver_id!==applicationId ||
  evidence.applicationId!==applicationId || evidence.vehicleId!==vehicleId || evidence.sha256!==doc.content_sha256 ||
  evidence.sha256!==ag.sha256 || evidence.bodySha256!==ag.body_sha256) throw new Error('Signed artifact mismatch');
 return {id:ag.id,kind:'esign',applicationId,driverId:evidence.driverId,vehicleId,
  weeklyCents:evidence.weeklyCents,currency:evidence.currency,effectiveAt:evidence.effectiveAt,signedAt:ag.signed_at,
  documentId:doc.id,signedVersion:evidence.version,currentVersion:evidence.version,signedHash:ag.sha256,
  currentHash:doc.content_sha256,status:'signed',verification:'esign-verified',provenanceId:ag.id};
}
// Structurally compatible with the existing gateway's accounts/subscriptions readers.
// No Stripe constructor, secret lookup, create/update/cancel method, or payment write.
export interface SubscriptionGateway {
 accounts:{retrieve():Promise<unknown>};
 subscriptions:{retrieve(id:string):Promise<unknown>};
}
export async function readExistingSubscription(gateway:SubscriptionGateway, id:string,
 link:{account:string;environment:'live'|'sandbox';customer:string;applicationId:string;driverId:string},now:()=>number) {
 const account=z.object({id:z.string()}).parse(await gateway.accounts.retrieve());
 const sub=z.object({id:z.string(),customer:z.string(),livemode:z.boolean(),status:z.literal('active'),
  items:z.object({has_more:z.literal(false),data:z.array(z.object({quantity:z.literal(1),current_period_end:z.number().int().positive().nullable().optional(),
   price:z.object({currency:z.string(),unit_amount:z.number().int().positive().safe(),
    recurring:z.object({interval:z.literal('week'),interval_count:z.literal(1)})})})).length(1)})}).parse(await gateway.subscriptions.retrieve(id));
 if(account.id!==link.account || sub.id!==id || sub.customer!==link.customer || sub.livemode!==(link.environment==='live'))
  throw new Error('Subscription linkage mismatch');
 const observed=now();if(!Number.isFinite(observed)) throw new Error('Observation clock unavailable');
 const item=sub.items.data[0];
 return {...link,subscription:sub.id,currency:item.price.currency,unitAmount:item.price.unit_amount,quantity:1,
  interval:'week',intervalCount:1,status:'active',nextDue:item.current_period_end?new Date(item.current_period_end*1000).toISOString():null,
  observedAt:new Date(observed).toISOString(),expiresAt:new Date(observed+300000).toISOString()};
}
// A staff-verified historical (paper) agreement registered for this driver, or null.
// The registration and its immutably bound original come from the database; the bytes
// are re-hashed here. Never an eSign event: kind 'paper', verification 'paper-registered'.
// signedAt is the start of the signing DAY in America/New_York, because a paper original
// carries a date, not an instant; the database requires exactly that value.
export async function readHistorical(client:CallerClient, download:(bucket:string,path:string)=>Promise<Uint8Array>,
 applicationId:string, vehicleId:string) {
 const res=await client.rpc('historical_agreement_for_record_v1',{_application_id:uuid.parse(applicationId)});
 if(res.error) throw new Error('Historical agreement unavailable');
 if(res.data===null) return null;
 const h=z.object({historicalAgreementId:uuid,status:z.literal('registered'),verification:z.literal('staff_verified'),
  applicationId:uuid,vehicleId:uuid,documentId:uuid,documentSha256:hash,signedOn:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  rentalStart:z.string().min(1),weeklyCents:z.number().int().positive().safe(),depositCents:z.number().int().nonnegative().safe().nullable(),
  currency:z.literal('usd'),driverUserId:uuid,rentalId:z.null(),
  // Present once 04 is installed; a 01-only registration is a paper original.
  source:z.enum(['paper','legacy_esign']).default('paper'),legacyAgreementId:uuid.nullable().default(null),legacySignedAt:z.string().nullable().default(null),
  document:z.object({id:uuid,bucket:z.literal('rental-agreements'),path:z.string(),sha256:hash,source:z.literal('paper'),
   integrity:z.object({sha256:hash,version:hash,agreement:z.null(),application:uuid,driver:uuid,path:z.string()}).passthrough()})}).passthrough().parse(res.data);
 if(h.applicationId!==applicationId) throw new Error('Historical agreement unavailable');
 if(h.vehicleId!==vehicleId) throw new Error('The registered historical agreement names a different vehicle');
 // Two agreements for one rental is a contradiction to resolve by voiding one, never to pick from.
 // A voided agreement is not open (proposed/record-rental-historical/04); a legacy-eSign
 // registration names exactly one open agreement: its own.
 const pending=await client.from('agreements').select('id,status,voided_at').eq('application_id',applicationId).is('rental_id',null);
 if(pending.error || !Array.isArray(pending.data)) throw new Error('Agreement state unavailable');
 const open=(pending.data as Array<{id:string;status:string;voided_at:string|null}>).filter(r=>r.voided_at===null && r.status!=='voided');
 if(open.some(r=>r.id!==h.legacyAgreementId)) throw new Error('This driver has both a historical agreement and an eSign agreement; void one before recording');
 const d=h.document, sha=h.documentSha256;
 if(d.id!==h.documentId || d.sha256!==sha || d.integrity.sha256!==sha || d.integrity.version!==sha ||
  d.integrity.application!==applicationId || d.integrity.driver!==h.driverUserId ||
  d.path!==`immutable-v1/${d.id}/${sha}.pdf` || d.integrity.path!==d.path) throw new Error('Historical agreement document binding mismatch');
 const bytes=await download(d.bucket,d.path);
 const {createHash}=await import('node:crypto');
 if(createHash('sha256').update(bytes).digest('hex')!==sha) throw new Error('Historical agreement document integrity mismatch');
 const {zonedDayStart}=await import('./signed-rental-terms');
 // A legacy eSign registration keeps the eSign record's own signing instant.
 if(h.source==='legacy_esign' && (h.legacyAgreementId===null || h.legacySignedAt===null)) throw new Error('Historical agreement unavailable');
 const signedAt=h.source==='legacy_esign'?new Date(Date.parse(h.legacySignedAt as string)).toISOString():zonedDayStart(h.signedOn);
 const effectiveAt=new Date(Date.parse(h.rentalStart)).toISOString();
 return {id:h.historicalAgreementId,kind:'paper',applicationId,driverId:h.driverUserId,vehicleId,
  weeklyCents:h.weeklyCents,currency:h.currency,effectiveAt,signedAt,
  documentId:d.id,signedVersion:sha,currentVersion:sha,signedHash:sha,currentHash:sha,status:'signed',
  verification:'paper-registered',provenanceId:h.historicalAgreementId};
}
