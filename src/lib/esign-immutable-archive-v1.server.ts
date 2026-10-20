import { z } from 'zod';
// Inject the existing authorized Storage gateway. No privileged client or live wiring here.
export interface ImmutableArchiveStore {
 upload(path:string, bytes:Uint8Array, options:{upsert:false;contentType:'application/pdf'}):Promise<{error:unknown}>;
 download(path:string):Promise<{data:Uint8Array|null;error:unknown}>;
}
export async function preserveCompletedPdfV1(store:ImmutableArchiveStore, documentId:string, bytes:Uint8Array, expectedSha256:string, namespace:'immutable-v1'|'completed-v1'='immutable-v1') {
 z.enum(['immutable-v1','completed-v1']).parse(namespace);
 z.string().uuid().parse(documentId);
 z.string().regex(/^[a-f0-9]{64}$/).parse(expectedSha256);
 const digest=async(b:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(b).buffer)),v=>v.toString(16).padStart(2,'0')).join('');
 if(await digest(bytes)!==expectedSha256) throw new Error('Signed PDF hash mismatch');
 const path=`${namespace}/${documentId}/${expectedSha256}.pdf`;
 const result=await store.upload(path,bytes,{upsert:false,contentType:'application/pdf'});
 // A failed/ambiguous upload is recoverable only by reading identical bytes at the exact path.
 const stored=await store.download(path);
 if(stored.error || !stored.data || await digest(stored.data)!==expectedSha256)
  throw new Error(result.error?'Archive unresolved; preserve original operation':'Stored PDF verification failed');
 return {path,sha256:expectedSha256,version:expectedSha256};
}
// This digest is a content reference, not proof of Storage immutability. Registration must
// run under the versioned DB contract only after write-once Storage enforcement is accepted.
