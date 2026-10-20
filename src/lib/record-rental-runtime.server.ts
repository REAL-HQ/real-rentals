import {authenticatedPrincipal,authenticatedConsumption,trustedIssuer,type CallerClient,type IssuerSql} from './record-rental-transport.server';
import {readEsign,readExistingSubscription,type SubscriptionGateway} from './record-rental-readers.server';
import {boundSignedTermsV2} from './record-rental-document-reader.server';
import type {RecordOperationTransport} from './record-rental-operation.server';
import {z} from 'zod';
export type RentalContext={supabase:CallerClient;userId:string;claims:Record<string,unknown>};
type Link={driverId:string;account:string;environment:'live'|'sandbox';currency:string;subscriptionId:string|null;customer:string};
export interface RecordResources {
 sql:IssuerSql;
 provider:SubscriptionGateway;
 linkage(context:RentalContext,applicationId:string):Promise<Link>;
 download(context:RentalContext,bucket:string,path:string):Promise<Uint8Array>;
}
let resources:RecordResources|undefined;
// Server bootstrap only. No endpoint accepts these capabilities, credentials or verified facts.
export function configureRecordRentalV2(value:RecordResources) {
 if(resources) throw new Error('Record Rental resources already configured');
 resources=value;
}
export function createRecordRentalTransportV2(context:RentalContext,token:string,configured:RecordResources):RecordOperationTransport {
 const session=z.string().uuid().parse(context.claims.session_id);
 const authorize=authenticatedPrincipal(context.supabase,context.userId,session,token);
 const trusted=trustedIssuer(configured.sql,authorize);
 let current:{app:string;link:Link}|undefined;
 const linkage=async(app:string)=>{
  const link=await configured.linkage(context,app);current={app,link};return link;
 };
 const artifacts={verify:async(agreementId:string,documentId:string)=>{
  const [ag,doc]=await Promise.all([
   context.supabase.from('agreements').select('*').eq('id',agreementId).single(),
   context.supabase.from('documents').select('*').eq('id',documentId).single()]);
  if(ag.error||doc.error||!ag.data||!doc.data)throw new Error('Signed evidence unavailable');
  const bytes=await configured.download(context,doc.data.storage_bucket,doc.data.storage_path);
  return boundSignedTermsV2(ag.data,doc.data,bytes);
 }};
 return {issuer:trusted.issuer,recover:trusted.recover,consume:authenticatedConsumption(context.supabase),linkage,
  readers:{authorize,identity:trusted.identity,agreement:(app,vehicle)=>readEsign(context.supabase,artifacts,app,vehicle),
   linkedCustomer:async app=>{if(!current||current.app!==app)throw new Error('Linkage unavailable');return current.link.customer},
   subscription:async id=>{
    if(!current||current.link.subscriptionId!==id)throw new Error('Subscription linkage unavailable');
    const {link,app}=current;
    return readExistingSubscription(configured.provider,id,{account:link.account,environment:link.environment,customer:link.customer,applicationId:app,driverId:link.driverId},Date.now);
   }}};
}
export function getRecordRentalTransportV2(context:RentalContext,token:string) {
 if(!resources) throw new Error('Record Rental trusted resources are not installed');
 return createRecordRentalTransportV2(context,token,resources);
}
// Explicit server-only adoption/completion step; never called merely because an old
// agreement lacks evidence. Caller supplies the existing authorized bucket gateway.
export async function finalizeRecordArchiveV2(context:RentalContext,token:string,configured:RecordResources,
 store:import('./esign-immutable-archive-v1.server').ImmutableArchiveStore,agreementId:string,bytes:Uint8Array) {
 const authorize=authenticatedPrincipal(context.supabase,context.userId,z.string().uuid().parse(context.claims.session_id),token);
 await authorize();
 const ag=await context.supabase.from('agreements').select('*').eq('id',agreementId).single();
 if(ag.error||!ag.data||ag.data.status!=='signed'||ag.data.voided_at!==null||ag.data.document_id!==ag.data.completed_document_id)
  throw new Error('Signed archive binding unavailable');
 const doc=await context.supabase.from('documents').select('*').eq('id',ag.data.completed_document_id).single();
 if(doc.error||!doc.data||doc.data.storage_bucket!=='rental-agreements')throw new Error('Document unavailable');
 const {preserveCompletedPdfV1}=await import('./esign-immutable-archive-v1.server');
 const archived=await preserveCompletedPdfV1(store,doc.data.id,bytes,ag.data.sha256);
 const trusted=trustedIssuer(configured.sql,authorize);
 await trusted.bindDocument(doc.data.id,doc.data,archived.sha256,archived.path,agreementId);
 await authorize();
 return archived;
}
