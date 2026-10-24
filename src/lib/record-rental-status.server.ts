// Read-only facts behind the Record Rental screens, read with the staff member's own
// client so RLS decides what they may see. Nothing here writes, issues evidence or
// calls a payment method; the billing preview only retrieves the existing Stripe link.
import { z } from 'zod';
import { readExistingSubscription } from './record-rental-readers.server';
import { recordRentalStatus, billingPreview } from './record-rental-readiness';
import type { RecordResources, RentalContext } from './record-rental-runtime.server';

const uuid = z.string().uuid();
export async function readRecordRentalStatusV1(context: RentalContext, configured: RecordResources, applicationId: string) {
 const app = uuid.parse(applicationId);
 const [a, docs, ags] = await Promise.all([
  context.supabase.from('applications').select('id,full_name,user_id,deleted_at,license_number,license_state,license_expiration').eq('id', app).single(),
  context.supabase.from('documents').select('id,category,review_status').eq('driver_id', app).in('category', ['license_front', 'license_back']).eq('is_current', true),
  context.supabase.from('agreements').select('id,vehicle_id,status,signed_at,voided_at,archive_status,sha256,merge_data').eq('application_id', app).is('rental_id', null),
 ]);
 if (a.error || !a.data) throw new Error('Driver record unavailable');
 if (docs.error || !Array.isArray(docs.data) || ags.error || !Array.isArray(ags.data)) throw new Error('Driver evidence unavailable');
 const row = a.data as Record<string, any>;
 const side = (category: string) => {
  const found = (docs.data as Array<{ category: string; review_status: string | null }>).filter(d => d.category === category);
  if (found.length === 0) return 'missing';
  if (found.length > 1) return 'duplicate';
  return found[0].review_status === 'verified' ? 'verified' : found[0].review_status === 'rejected' ? 'rejected' : 'pending';
 };
 let historical = null;
 if (configured.historicalAgreements) {
  const h = await context.supabase.rpc('historical_agreement_for_record_v1', { _application_id: app });
  if (h.error) throw new Error('Historical agreement unavailable');
  const r = h.data as Record<string, any> | null;
  historical = r && { id: r.historicalAgreementId, source: r.source ?? 'paper', legacyAgreementId: r.legacyAgreementId ?? null,
   vehicleId: r.vehicleId, documentId: r.documentId, documentSha256: r.documentSha256, signedOn: r.signedOn,
   legacySignedAt: r.legacySignedAt ?? null, rentalStart: r.rentalStart, weeklyCents: r.weeklyCents, depositCents: r.depositCents,
   termsSummary: r.termsSummary, registeredAt: r.registeredAt };
 }
 return recordRentalStatus.parse({
  driver: { applicationId: app, name: row.full_name ?? null, portalLogin: row.user_id !== null, archived: row.deleted_at !== null },
  licence: { front: side('license_front'), back: side('license_back'), number: !!row.license_number?.trim(),
   state: !!row.license_state?.trim(), expiresOn: row.license_expiration ?? null },
  agreements: (ags.data as Array<Record<string, any>>).map(g => ({ id: g.id, vehicleId: g.vehicle_id, status: g.status,
   signedAt: g.signed_at, voided: g.voided_at !== null, archived: g.archive_status === 'archived',
   // Only terms already signed into the agreement count; never current application rates.
   signedTerms: !!g.merge_data?.record_rental_terms_v1, sha256: g.sha256 ?? null })),
  historicalInstalled: configured.historicalAgreements === true, historical,
 });
}

// The existing Stripe customer and subscription the record will reference: the same
// server-resolved linkage and reader the record operation uses. Retrieve-only.
export async function previewBillingLinkV1(context: RentalContext, configured: RecordResources, applicationId: string) {
 const app = uuid.parse(applicationId);
 const link = await configured.linkage(context, app);
 const observedAt = new Date().toISOString();
 if (!link.subscriptionId) return billingPreview.parse({ environment: link.environment, customer: link.customer || null,
  subscription: null, unitAmount: null, currency: null, interval: null, nextDue: null, observedAt });
 const sub = await readExistingSubscription(configured.provider, link.subscriptionId,
  { account: link.account, environment: link.environment, customer: link.customer, applicationId: app, driverId: link.driverId }, Date.now);
 return billingPreview.parse({ environment: link.environment, customer: link.customer, subscription: sub.subscription,
  unitAmount: sub.unitAmount, currency: sub.currency, interval: 'week', nextDue: sub.nextDue, observedAt: sub.observedAt });
}
