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
export interface IssuerSql {
 transaction<T>(run:(query:(sql:string,args:unknown[])=>Promise<Array<Record<string,unknown>>>)=>Promise<T>):Promise<T>;
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
export function trustedIssuer(sql:IssuerSql, authorize:ReturnType<typeof authenticatedPrincipal>) {
 const call=async(statement:string,args:unknown[], application?:string, vehicle?:string)=>{
  const p=await authorize();
  const value=await sql.transaction(async query=>{
   const role=await query('SELECT current_user AS role',[]);
   if(role[0]?.role!=='rr_evidence_issuer') throw new Error('Dedicated evidence issuer required');
   // Claims come from authenticated server context, never a browser-provided actor field.
   await query("SELECT set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:p.actorId,session_id:p.sessionId,role:'authenticated'})]);
   // Each issuer transaction establishes its own scope after server authentication.
   // Clear absent scope on pooled connections; never inherit a prior operation's scope.
   await query("SELECT set_config('record.application_id',$1,true),set_config('record.vehicle_id',$2,true)",
    [application===undefined?'':uuid.parse(application),vehicle===undefined?'':uuid.parse(vehicle)]);
   const rows=await query(statement,args);
   if(rows.length!==1) throw new Error('Evidence response unavailable');
   return rows[0].value;
  });
  const final=await authorize();
  if(final.actorId!==p.actorId || final.sessionId!==p.sessionId) throw new Error('Session changed');
  return value;
 };
 const issuer:TrustedEvidenceIssuer={
  snapshot:(a,v,g,d)=>call('SELECT private.record_snapshot_v1($1::uuid,$2::uuid,$3::uuid,$4::uuid) AS value',[a,v,g,d],a,v),
  issue:async(req,verified,snapshot)=>{const scope=z.object({applicationId:uuid,vehicleId:uuid}).parse(req);return uuid.parse(await call('SELECT private.issue_record_evidence_v1($1::jsonb,$2::jsonb,$3::jsonb) AS value',[JSON.stringify(req),JSON.stringify(verified),JSON.stringify(snapshot)],scope.applicationId,scope.vehicleId));},
 };
 return {issuer,bindDocument:(document:string,expected:unknown,sha:string,path:string,agreement:string)=>call('SELECT private.bind_document_integrity_v1($1::uuid,$2::jsonb,$3::text,$4::text,$5::uuid) AS value',[uuid.parse(document),JSON.stringify(expected),sha,path,uuid.parse(agreement)],z.object({driver_id:uuid}).parse(expected).driver_id),identity:(application:string)=>call('SELECT private.record_identity_reader_v2($1::uuid) AS value',[uuid.parse(application)],application),recover:async(operation:string)=>{
  const value=await call('SELECT private.recover_record_evidence_v1($1::uuid) AS value',[uuid.parse(operation)]);
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
