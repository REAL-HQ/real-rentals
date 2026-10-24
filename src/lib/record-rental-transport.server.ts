import { z } from 'zod';
import type { TrustedEvidenceIssuer } from './record-rental-evidence.server';
import type { RecordOperationTransport } from './record-rental-operation.server';
const uuid=z.string().uuid();
export interface CallerClient {
 auth:{getClaims(jwt:string):Promise<{data:{claims:Record<string,unknown>}|null;error:unknown}>};
 from(table:string):any;
 rpc(name:string,args:Record<string,unknown>):PromiseLike<{data:unknown;error:unknown}>;
}
// The supplied SQL transport MUST be a dedicated server-only issuer connection. It must
// run each callback on one connection in one transaction and rollback on any error.
// role defaults to rr_evidence_issuer; rr_approval_executor is used only for the
// positive-license review (license_snapshot_v1 / verify_license_v1).
export type IssuerRole='rr_evidence_issuer'|'rr_approval_executor';
export interface IssuerSql {
 transaction<T>(run:(query:(sql:string,args:unknown[])=>Promise<Array<Record<string,unknown>>>)=>Promise<T>,role?:IssuerRole):Promise<T>;
}
export function authenticatedPrincipal(client:CallerClient, expectedActor:string, expectedSession:string, bearerToken:string) {
 return async()=>{
  const {data,error}=await client.auth.getClaims(bearerToken);
  if(error || !data || data.claims.sub!==expectedActor || data.claims.session_id!==expectedSession ||
   typeof data.claims.exp!=='number' || data.claims.exp*1000<=Date.now()) throw new Error('Session unavailable');
  uuid.parse(expectedActor);uuid.parse(expectedSession);
  const roles=await client.from('user_roles').select('role').eq('user_id',expectedActor);
  if(roles.error || !Array.isArray(roles.data)) throw new Error('Role unavailable');
  const role=roles.data.some((x:any)=>x.role==='admin')?'Owner':roles.data.some((x:any)=>x.role==='team')?'Manager':null;
  if(!role) throw new Error('Owner or Manager required');
  return {actorId:expectedActor,sessionId:expectedSession,role};
 };
}
// The fixed evidence operations. The TCP transport runs the statement as the role;
// the evidence gateway (proposed/record-rental-gateway) names the operation and the
// database maps it to the same function. Nothing else can be named either way.
type EvidenceOp='snapshot'|'issue'|'bind'|'identity'|'recover'|'licenseSnapshot'|'verifyLicense';
const OPS:Record<EvidenceOp,{role:IssuerRole;statement:string;params:(a:any)=>unknown[]}>={
 snapshot:{role:'rr_evidence_issuer',statement:'SELECT private.record_snapshot_v1($1::uuid,$2::uuid,$3::uuid,$4::uuid) AS value',params:a=>[a.a,a.v,a.g,a.d]},
 issue:{role:'rr_evidence_issuer',statement:'SELECT private.issue_record_evidence_v1($1::jsonb,$2::jsonb,$3::jsonb) AS value',params:a=>[JSON.stringify(a.req),JSON.stringify(a.verified),JSON.stringify(a.snapshot)]},
 bind:{role:'rr_evidence_issuer',statement:'SELECT private.bind_document_integrity_v1($1::uuid,$2::jsonb,$3::text,$4::text,$5::uuid) AS value',params:a=>[a.document,JSON.stringify(a.expected),a.sha,a.path,a.agreement]},
 identity:{role:'rr_evidence_issuer',statement:'SELECT private.record_identity_reader_v2($1::uuid) AS value',params:a=>[a.application]},
 recover:{role:'rr_evidence_issuer',statement:'SELECT private.recover_record_evidence_v1($1::uuid) AS value',params:a=>[a.operation]},
 // Positive-license review: the snapshot the staff member reviews, then the review itself.
 // Both run as rr_approval_executor; verify_license_v1 refuses if the snapshot has changed.
 licenseSnapshot:{role:'rr_approval_executor',statement:'SELECT private.license_snapshot_v1($1::uuid) AS value',params:a=>[a.application]},
 verifyLicense:{role:'rr_approval_executor',statement:'SELECT private.verify_license_v1($1::uuid,$2::jsonb) AS value',params:a=>[a.application,JSON.stringify(a.expected)]},
};
// Server-held key for the evidence gateway. The staff member's own client carries the call,
// so PostgREST verifies their JWT; the key proves the arguments came from this server.
export interface EvidenceGateway { gatewayKey:Uint8Array }
type Principal={actorId:string;sessionId:string};
async function viaGateway(gateway:EvidenceGateway, client:CallerClient, op:EvidenceOp, args:Record<string,unknown>, p:Principal, application?:string, vehicle?:string) {
 const text=JSON.stringify({...args,scopeApplication:application??'',scopeVehicle:vehicle??''});
 const issued=Date.now(), nonce=crypto.randomUUID();
 const message=['record-evidence-gateway-v1',op,p.actorId,p.sessionId,String(issued),nonce,text].join('\n');
 const key=await crypto.subtle.importKey('raw',new Uint8Array(gateway.gatewayKey),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const mac=Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(message))),v=>v.toString(16).padStart(2,'0')).join('');
 const fn=OPS[op].role==='rr_evidence_issuer'?'record_evidence_gateway_v1':'record_license_gateway_v1';
 const {data,error}=await client.rpc(fn,{_op:op,_args:text,_issued_ms:issued,_nonce:nonce,_mac:mac});
 if(error) throw new Error(String((error as {message?:unknown}).message ?? 'Evidence response unavailable'));
 return z.object({value:z.unknown()}).parse(data).value;
}
export function trustedIssuer(sql:IssuerSql|EvidenceGateway, authorize:ReturnType<typeof authenticatedPrincipal>, client?:CallerClient) {
 const call=async(op:EvidenceOp,args:Record<string,unknown>, application?:string, vehicle?:string)=>{
  const as=OPS[op].role;
  const p=await authorize();
  if(application!==undefined) uuid.parse(application);
  if(vehicle!==undefined) uuid.parse(vehicle);
  const value='gatewayKey' in sql ? await viaGateway(sql,client??(()=>{throw new Error('Evidence gateway requires the staff client')})(),op,args,p,application,vehicle)
   : await sql.transaction(async query=>{
   const role=await query('SELECT current_user AS role',[]);
   if(role[0]?.role!==as) throw new Error('Dedicated evidence issuer required');
   // Claims come from authenticated server context, never a browser-provided actor field.
   await query("SELECT set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:p.actorId,session_id:p.sessionId,role:'authenticated'})]);
   // Each issuer transaction establishes its own scope after server authentication.
   // Clear absent scope on pooled connections; never inherit a prior operation's scope.
   await query("SELECT set_config('record.application_id',$1,true),set_config('record.vehicle_id',$2,true)",
    [application===undefined?'':application,vehicle===undefined?'':vehicle]);
   const rows=await query(OPS[op].statement,OPS[op].params(args));
   if(rows.length!==1) throw new Error('Evidence response unavailable');
   return rows[0].value;
  },as);
  const final=await authorize();
  if(final.actorId!==p.actorId || final.sessionId!==p.sessionId) throw new Error('Session changed');
  return value;
 };
 const issuer:TrustedEvidenceIssuer={
  snapshot:(a,v,g,d)=>call('snapshot',{a,v,g,d},a,v),
  issue:async(req,verified,snapshot)=>{const scope=z.object({applicationId:uuid,vehicleId:uuid}).parse(req);return uuid.parse(await call('issue',{req,verified,snapshot},scope.applicationId,scope.vehicleId));},
 };
 return {issuer,
  bindDocument:(document:string,expected:unknown,sha:string,path:string,agreement:string|null)=>call('bind',{document:uuid.parse(document),expected,sha,path,agreement:agreement===null?null:uuid.parse(agreement)},z.object({driver_id:uuid}).parse(expected).driver_id),
  licenseSnapshot:(application:string)=>call('licenseSnapshot',{application:uuid.parse(application)},application),
  verifyLicense:async(application:string,expected:unknown)=>uuid.parse(await call('verifyLicense',{application:uuid.parse(application),expected},application)),
  identity:(application:string)=>call('identity',{application:uuid.parse(application)},application),
  recover:async(operation:string)=>{
   const value=await call('recover',{operation:uuid.parse(operation)});
   return value===null?null:uuid.parse(value);
  }};
}
export function authenticatedConsumption(client:CallerClient):RecordOperationTransport['consume'] {
 return async(token,req)=>{
  const {data,error}=await client.rpc('record_existing_rental_evidence_v1',{token:uuid.parse(token),req});
  if(error) throw new Error('Rental submission unavailable; recover the same operation before retrying');
  return data;
 };
}
// Deliberately no default provider/issuer credentials, service client, or writable gateway.
// Binding these capabilities requires the actual immutable document/approval contracts.

export function connectRecordRental(client:CallerClient, sql:IssuerSql,
 authorize:ReturnType<typeof authenticatedPrincipal>, readers:Omit<RecordOperationTransport['readers'],'authorize'>,
 linkage:RecordOperationTransport['linkage']):RecordOperationTransport {
 const trusted=trustedIssuer(sql,authorize);
 return {readers:{...readers,authorize},issuer:trusted.issuer,recover:trusted.recover,
  linkage,consume:authenticatedConsumption(client)};
}
