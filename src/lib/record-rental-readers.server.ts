import { z } from 'zod';
import type { CallerClient } from './record-rental-transport.server';
const uuid=z.string().uuid(), hash=z.string().regex(/^[a-f0-9]{64}$/);
const instant=z.string().datetime({offset:true});
// This is an immutable signed-terms resolver, not request metadata or current application rates.
export interface SignedArtifactReader {
 verify(agreementId:string,documentId:string):Promise<{version:string;sha256:string;bodySha256:string;
  applicationId:string;driverId:string;vehicleId:string;effectiveAt:string;weeklyCents:number;currency:string}>;
}
export async function readEsign(client:CallerClient, artifacts:SignedArtifactReader, applicationId:string, vehicleId:string) {
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
  .parse(await artifacts.verify(ag.id,doc.id));
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
