export async function assertSignedArchiveBytes(doc: any, agreement: any, bytes: Uint8Array) {
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes).buffer)),v=>v.toString(16).padStart(2,'0')).join('');
  if (!/^[a-f0-9]{64}$/.test(agreement.sha256 ?? '') || digest !== agreement.sha256) throw new Error('Signed PDF hash mismatch');
  if (agreement.document_id !== doc.id || agreement.completed_document_id !== doc.id) throw new Error('Signed PDF pointer mismatch');
  if (/^(immutable|completed)-v1\//.test(doc.storage_path ?? '') && (doc.content_sha256 !== agreement.sha256 || doc.storage_path !== `${doc.storage_path.split('/')[0]}/${doc.id}/${agreement.sha256}.pdf`)) throw new Error('Signed PDF content address mismatch');
}
export function refuseArchiveDeletion(bucket: string, path: string) {
  if (bucket === 'rental-agreements' || /^(immutable|completed)-v1\//.test(path)) throw new Error('Signed archive retained; separate authorized retention review required');
}
