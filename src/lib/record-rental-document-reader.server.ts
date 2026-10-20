import {createHash} from 'node:crypto';
import {z} from 'zod';
const id=z.string().uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/);
const bindingSchema=z.object({version:hash,sha256:hash,agreement:id,application:id,driver:id,vehicle:id,bucket:z.string(),path:z.string(),body_sha256:hash});
export function assertCompletedDownloadV2(agreement:any,doc:any,bytes:Uint8Array) {
 const protectedPath=typeof doc.storage_path==='string' && doc.storage_path.startsWith('immutable-v1/');
 if(!doc.integrity_v1 && !protectedPath) return; // Existing unbound downloads retain their established behavior.
 const b=bindingSchema.parse(doc.integrity_v1);
 if(agreement.id!==b.agreement || agreement.application_id!==b.application || agreement.vehicle_id!==b.vehicle ||
  agreement.document_id!==doc.id || agreement.completed_document_id!==doc.id ||
  doc.driver_id!==b.application || doc.content_sha256!==b.sha256 || agreement.sha256!==b.sha256 ||
  agreement.body_sha256!==b.body_sha256 || b.version!==b.sha256 || doc.storage_bucket!==b.bucket || doc.storage_path!==b.path ||
  b.path!==`immutable-v1/${doc.id}/${b.sha256}.pdf` || createHash('sha256').update(bytes).digest('hex')!==b.sha256)
  throw new Error('Finalized signed document integrity mismatch');
}
export function boundSignedTermsV2(agreement:any,doc:any,bytes:Uint8Array) {
 if(!doc.integrity_v1) throw new Error('Verified immutable archive required');
 assertCompletedDownloadV2(agreement,doc,bytes);
 const b=bindingSchema.parse(doc.integrity_v1);
 if(agreement.status!=='signed'||agreement.voided_at!==null || agreement.archive_status!=='archived') throw new Error('Signed agreement unavailable');
 if(createHash('sha256').update(agreement.body).digest('hex')!==b.body_sha256) throw new Error('Signed terms changed');
 // Only exact normalized terms already included in the signed archive. Never infer an
 // instant/currency from formatted legacy dates or current application billing settings.
 const terms=z.object({effectiveAt:z.string().datetime({offset:true}),weeklyCents:z.number().int().positive().safe(),currency:z.string().regex(/^[a-z]{3}$/)}).parse(doc.integrity_v1.merge_data?.record_rental_terms_v1);
 if(JSON.stringify(agreement.merge_data)!==JSON.stringify(doc.integrity_v1.merge_data)) throw new Error('Signed terms binding mismatch');
 return {version:b.version,sha256:b.sha256,bodySha256:b.body_sha256,applicationId:b.application,driverId:b.driver,vehicleId:b.vehicle,...terms};
}
