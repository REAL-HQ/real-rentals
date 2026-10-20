// Server-only orchestration. All dependencies are server-owned, never deserialized from a request.
import { z } from 'zod';
import { recordRequest, recordResult } from './record-rental-contract';
import { issueRecordEvidence, type EvidenceReaders, type TrustedEvidenceIssuer } from './record-rental-evidence.server';
const uuid = z.string().uuid();
const principal = z.object({actorId:uuid,sessionId:uuid,role:z.enum(['Owner','Manager'])});
export interface RecordOperationTransport {
 readers: EvidenceReaders;
 issuer: TrustedEvidenceIssuer;
 // Server-resolved linkage; browser inputs cannot select account/environment/customer.
 linkage(applicationId:string):Promise<{driverId:string;account:string;environment:'live'|'sandbox';currency:string;subscriptionId:string|null}>;
 // Only recovers an existing actor/session-bound reference; never issues or renews one.
 recover(operationId:string):Promise<string|null>;
 consume(token:string, request:z.infer<typeof recordRequest>):Promise<unknown>;
}
export async function executeRecordRental(raw:unknown, expectedActorId:string, transport:RecordOperationTransport,
 signal:AbortSignal, now:()=>number = Date.now) {
 const request=recordRequest.parse(raw);
 // Old opaque client attestation must not select a provider or replace the server-issued reference.
 if(request.subscriptionEvidenceId!==null) throw new Error('Client evidence overrides are not accepted');
 const initial=principal.parse(await transport.readers.authorize());
 const current=async()=>{
  const p=principal.parse(await transport.readers.authorize());
  if(signal.aborted || p.actorId!==initial.actorId || p.sessionId!==initial.sessionId || p.actorId!==expectedActorId)
   throw new Error('Session changed; recover under the original staff session');
 };
 await current();
 // Recovery comes first: committed operations remain recoverable after evidence expires.
 let token=await transport.recover(request.operationId);
 if(token!==null) token=uuid.parse(token);
 else {
  const link=await transport.linkage(request.applicationId);
  await current();
  const issued=await issueRecordEvidence({operationId:request.operationId,actorId:initial.actorId,
   applicationId:request.applicationId,driverId:link.driverId,vehicleId:request.vehicleId,
   startedAt:request.startedAt,weeklyCents:Math.round(request.weeklyRate*100),currency:link.currency,
   account:link.account,environment:link.environment},request,link.subscriptionId,
   transport.readers,transport.issuer,now,signal);
  token=issued.evidenceId;
 }
 await current();
 // Exactly one attempt. Ambiguous outcomes propagate; the same operation recovers on a later request.
 const result=recordResult.parse(await transport.consume(token,request));
 await current();
 return result;
}
