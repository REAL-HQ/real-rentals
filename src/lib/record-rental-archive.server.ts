// Immutable evidence archival for Record Rental: licence images, signed eSign agreements
// and paper originals. A document's current bytes are copied write-once to
// <bucket>/immutable-v1/<document>/<sha256>.pdf, read back and re-hashed, and only then is
// that content address bound in the database through the evidence issuer
// (private.bind_document_integrity_v1). The original object is never overwritten or
// deleted, and nothing here accepts bytes, hashes or paths from a browser.
import { z } from 'zod';
import { authenticatedPrincipal, trustedIssuer } from './record-rental-transport.server';
import type { RecordResources, RentalContext } from './record-rental-runtime.server';
import type { Json } from '@/integrations/supabase/types';

const uuid = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/);
// Exactly the columns bind_document_integrity_v1 compares before it binds.
// (source is read only to tell a paper original from an eSign PDF; the binding ignores it.)
const DOC_COLS = 'id,driver_id,storage_bucket,storage_path,content_sha256,integrity_v1,category,is_current,superseded_by,review_status,reviewed_by,reviewed_at,source';
export const ARCHIVE_PURPOSES = {
 license: { bucket: 'driver-docs', categories: ['license_front', 'license_back'], pdfOnly: false },
 esign: { bucket: 'rental-agreements', categories: ['rental_agreement', 'agreement'], pdfOnly: true },
 paper: { bucket: 'rental-agreements', categories: ['agreement'], pdfOnly: true },
} as const;
export type ArchivePurpose = keyof typeof ARCHIVE_PURPOSES;
export const immutablePath = (documentId: string, sha: string) => `immutable-v1/${uuid.parse(documentId)}/${hash.parse(sha)}.pdf`;

async function sha256Hex(bytes: Uint8Array) {
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer)), v => v.toString(16).padStart(2, '0')).join('');
}
// The content address always ends .pdf (the database fixes the layout); the stored
// object keeps its real type. Anything that is not a PDF or a common photo is refused.
export function evidenceContentType(b: Uint8Array): string {
 if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'application/pdf';
 if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
 if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
 if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
 throw new Error('Unsupported document format for an evidence archive');
}

export async function archiveEvidenceDocumentV1(context: RentalContext, token: string, configured: RecordResources,
 purpose: ArchivePurpose, documentId: string, opts: { agreementId?: string | null; expectedSha256?: string } = {}) {
 const rule = ARCHIVE_PURPOSES[purpose];
 const authorize = authenticatedPrincipal(context.supabase, context.userId, z.string().uuid().parse(context.claims.session_id), token);
 await authorize();
 // Read with the staff member's own client: RLS decides whether they may see this document.
 const res = await context.supabase.from('documents').select(DOC_COLS).eq('id', uuid.parse(documentId)).single();
 if (res.error || !res.data) throw new Error('Document unavailable');
 const doc = res.data as Record<string, any>;
 if (doc.storage_bucket !== rule.bucket || !(rule.categories as readonly string[]).includes(doc.category) ||
  (purpose === 'paper') !== (doc.source === 'paper'))
  throw new Error('This document cannot be archived as evidence of this kind');
 if (doc.is_current !== true || doc.superseded_by !== null) throw new Error('Only the current version of a document can be archived');
 const agreement = opts.agreementId ?? null;
 if (doc.integrity_v1) {
  // Already bound: confirm the archived bytes still hash to the bound address.
  const b = z.object({ sha256: hash, path: z.string(), agreement: uuid.nullable() }).passthrough().parse(doc.integrity_v1);
  if (b.agreement !== agreement) throw new Error('Document is already bound to a different agreement');
  if (b.path !== doc.storage_path || b.sha256 !== doc.content_sha256 || b.path !== immutablePath(doc.id, b.sha256))
   throw new Error('Archived document binding mismatch');
  if (await sha256Hex(await configured.archive.read(rule.bucket, b.path)) !== b.sha256) throw new Error('Archived document integrity mismatch');
  return { documentId: doc.id as string, path: b.path, sha256: b.sha256, recovered: true };
 }
 const bytes = await configured.archive.read(rule.bucket, z.string().min(1).parse(doc.storage_path));
 const sha = await sha256Hex(bytes);
 if (doc.content_sha256 && doc.content_sha256 !== sha) throw new Error('The stored file no longer matches its recorded hash');
 if (opts.expectedSha256 !== undefined && opts.expectedSha256 !== sha) throw new Error('The stored file differs from the signed agreement');
 const type = evidenceContentType(bytes);
 if (rule.pdfOnly && type !== 'application/pdf') throw new Error('Agreement evidence must be a PDF');
 const path = immutablePath(doc.id, sha);
 const written = await configured.archive.writeOnce(rule.bucket, path, bytes, type);
 // A failed or ambiguous write is resolved only by identical bytes already at the address.
 let stored: Uint8Array | null = null;
 try { stored = await configured.archive.read(rule.bucket, path); } catch { stored = null; }
 if (!stored || await sha256Hex(stored) !== sha)
  throw new Error(written.error ? 'Archive unresolved; retry the same document' : 'Stored copy verification failed');
 await trustedIssuer(configured.sql, authorize, context.supabase).bindDocument(doc.id, doc, sha, path, agreement);
 await authorize();
 return { documentId: doc.id as string, path, sha256: sha, recovered: false };
}

// Gap 3: a signed eSign agreement's completed PDF, archived and bound with its agreement.
export async function archiveSignedAgreementV1(context: RentalContext, token: string, configured: RecordResources, agreementId: string) {
 // Owner or Manager first (Security 0031 hides agreements from a Coordinator).
 await authenticatedPrincipal(context.supabase, context.userId, z.string().uuid().parse(context.claims.session_id), token)();
 const ag = await context.supabase.from('agreements').select('id,status,voided_at,archive_status,document_id,completed_document_id,sha256')
  .eq('id', uuid.parse(agreementId)).single();
 if (ag.error || !ag.data) throw new Error('Agreement unavailable');
 const a = ag.data as Record<string, any>;
 if (a.status !== 'signed' || a.voided_at !== null || a.archive_status !== 'archived' || !a.completed_document_id ||
  a.document_id !== a.completed_document_id || !hash.safeParse(a.sha256).success)
  throw new Error('Only a signed, archived, unvoided agreement can be preserved as evidence');
 return archiveEvidenceDocumentV1(context, token, configured, 'esign', a.completed_document_id, { agreementId: a.id, expectedSha256: a.sha256 });
}

// Gap 1: positive licence review. Preview archives and binds the current, staff-reviewed
// front and back images, then returns the database's licence snapshot and its fingerprint.
// Verify re-reads the snapshot, refuses if the fingerprint differs from what the staff
// member reviewed, and records the review (verify_license_v1 refuses a stale snapshot too).
export async function licenseFingerprint(snapshot: unknown) {
 return sha256Hex(new TextEncoder().encode(JSON.stringify(snapshot)));
}
export async function previewPositiveLicenseV1(context: RentalContext, token: string, configured: RecordResources, applicationId: string) {
 const app = uuid.parse(applicationId);
 // Owner or Manager first: under Security 0031 a Coordinator cannot see licence documents,
 // so checking the images first would refuse with a misleading message.
 const authorize = authenticatedPrincipal(context.supabase, context.userId, z.string().uuid().parse(context.claims.session_id), token);
 await authorize();
 const docs = await context.supabase.from('documents').select('id,category,review_status')
  .eq('driver_id', app).in('category', ['license_front', 'license_back']).eq('is_current', true);
 if (docs.error || !Array.isArray(docs.data)) throw new Error('Licence images unavailable');
 const rows = docs.data as Array<{ id: string; category: string; review_status: string | null }>;
 for (const side of ['license_front', 'license_back']) {
  const found = rows.filter(r => r.category === side);
  if (found.length !== 1) throw new Error('Exactly one current front and one current back licence image are required');
  if (found[0].review_status !== 'verified') throw new Error('Review and verify the licence images before the positive licence check');
 }
 const archived = [];
 for (const r of rows) archived.push(await archiveEvidenceDocumentV1(context, token, configured, 'license', r.id));
 const snapshot = await trustedIssuer(configured.sql, authorize, context.supabase).licenseSnapshot(app) as Json;
 return { snapshot, fingerprint: await licenseFingerprint(snapshot), archived };
}
export async function verifyPositiveLicenseV1(context: RentalContext, token: string, configured: RecordResources, applicationId: string, fingerprint: string) {
 const app = uuid.parse(applicationId);
 const authorize = authenticatedPrincipal(context.supabase, context.userId, z.string().uuid().parse(context.claims.session_id), token);
 const trusted = trustedIssuer(configured.sql, authorize, context.supabase);
 const snapshot = await trusted.licenseSnapshot(app);
 if (await licenseFingerprint(snapshot) !== hash.parse(fingerprint))
  throw new Error('The licence details or images changed since the preview; review them again');
 return { reviewId: await trusted.verifyLicense(app, snapshot) };
}
