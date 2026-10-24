// What the Record Rental screens show and explain. Pure and client-safe. It mirrors the
// database gates (record_snapshot_v1, the evidence readers, the record transaction) so
// staff see why a step is not ready; it never replaces them. Every fact is re-checked
// on Save, so "ready" here is a hint, not an approval.
import { z } from 'zod';
import { recordRequest } from './record-rental-contract';

const uuid = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/);
const imageState = z.enum(['missing', 'duplicate', 'pending', 'verified', 'rejected']);
export const recordRentalStatus = z.object({
 driver: z.object({ applicationId: uuid, name: z.string().nullable(), portalLogin: z.boolean(), archived: z.boolean() }),
 licence: z.object({ front: imageState, back: imageState, number: z.boolean(), state: z.boolean(), expiresOn: z.string().nullable() }),
 // Agreements of this driver not yet linked to a rental (voided ones included, shown as voided).
 agreements: z.array(z.object({ id: uuid, vehicleId: uuid.nullable(), status: z.string(), signedAt: z.string().nullable(),
  voided: z.boolean(), archived: z.boolean(), signedTerms: z.boolean(), sha256: hash.nullable() })),
 historicalInstalled: z.boolean(),
 historical: z.object({ id: uuid, source: z.enum(['paper', 'legacy_esign']), legacyAgreementId: uuid.nullable(), vehicleId: uuid,
  documentId: uuid, documentSha256: hash, signedOn: z.string(), legacySignedAt: z.string().nullable(), rentalStart: z.string(),
  weeklyCents: z.number().int().positive(), depositCents: z.number().int().nonnegative().nullable(),
  termsSummary: z.string(), registeredAt: z.string() }).nullable(),
}).strict();
export type RecordRentalStatus = z.infer<typeof recordRentalStatus>;

export const billingPreview = z.object({
 environment: z.enum(['live', 'sandbox']), customer: z.string().nullable(), subscription: z.string().nullable(),
 unitAmount: z.number().int().positive().nullable(), currency: z.string().nullable(), interval: z.literal('week').nullable(),
 nextDue: z.string().nullable(), observedAt: z.string(),
}).strict();
export type BillingPreview = z.infer<typeof billingPreview>;

// One entry per unmet requirement: what is wrong and what staff can do about it.
export const EXPLANATIONS = {
 driver_archived: ['Driver Archived', 'This driver record is archived. Restore it before recording a rental.'],
 portal_login_missing: ['No Portal Login', 'The rental belongs to the driver\'s portal login. Invite the driver and link a login first.'],
 vehicle_required: ['Choose A Vehicle', 'Select the vehicle the driver has today.'],
 licence_details_missing: ['Licence Details Missing', 'Enter the licence number, state and expiry date on the driver record.'],
 licence_expired: ['Licence Expired', 'The licence on file has expired. Upload and review the renewed licence.'],
 licence_image_missing: ['Licence Images Missing', 'Exactly one current front and one current back licence image are required.'],
 licence_image_duplicate: ['Duplicate Licence Images', 'More than one current image exists for a side. Supersede the extra one in Documents.'],
 licence_image_unverified: ['Licence Images Not Verified', 'Review the front and back images in Documents and mark them verified.'],
 licence_check_required: ['Licence Check Not Confirmed', 'Run the licence check below, compare it with the images, then confirm it.'],
 agreement_missing: ['No Signed Agreement', 'Send an agreement for signature, or upload and register the signed paper original.'],
 agreement_ambiguous: ['More Than One Open Agreement', 'Void the agreements that do not apply, so exactly one remains.'],
 agreement_unsigned: ['Agreement Not Signed', 'An agreement is waiting for the driver\'s signature. Finish it or void it first.'],
 agreement_vehicle_mismatch: ['Agreement Names Another Vehicle', 'The signed agreement is for a different vehicle. Choose that vehicle, or void it.'],
 agreement_not_archived: ['Agreement Not Archived', 'Preserve the signed agreement in the archive before recording.'],
 agreement_legacy_terms: ['Signed Before Rental Terms Existed', 'This eSign agreement has no signed rental terms. Register it as a staff-verified legacy agreement.'],
 historical_not_installed: ['Historical Agreements Not Installed', 'Staff-verified agreements need a database installation the Owner has not approved yet.'],
 historical_esign_conflict: ['Two Agreements For One Rental', 'A registered historical agreement and an open eSign agreement both exist. Void one.'],
 historical_vehicle_mismatch: ['Agreement Names Another Vehicle', 'The registered agreement is for a different vehicle. Choose that vehicle, or void it.'],
 historical_start_mismatch: ['Start Differs From Agreement', 'The start must equal the start confirmed when the agreement was registered.'],
 historical_rate_mismatch: ['Rate Differs From Agreement', 'The weekly rate must equal the rate confirmed when the agreement was registered.'],
 start_invalid: ['Start Time Needed', 'Enter the verified pickup date and time with its UTC offset. A date alone is not enough.'],
 start_future: ['Start In The Future', 'A recorded rental has already started. Use Start Rental for future handovers.'],
 rate_invalid: ['Weekly Rate Needed', 'Enter a positive weekly rate with at most two decimal places.'],
 deposit_invalid: ['Deposit Invalid', 'Leave blank if unknown, enter 0 for none, or the amount collected.'],
 mileage_invalid: ['Mileage Invalid', 'Enter whole miles, or leave blank if unknown.'],
 reason_required: ['Reason Needed', 'Explain why this rental is being recorded rather than started (5 to 500 characters).'],
 billing_unreviewed: ['Billing Not Reviewed', 'Check the existing Stripe link below. Recording never creates charges or subscriptions.'],
 billing_unavailable: ['Billing Link Unavailable', 'The existing Stripe link could not be read. Resolve it in Stripe, then check again.'],
} as const satisfies Record<string, readonly [string, string]>;
export type Blocker = keyof typeof EXPLANATIONS;

export type RecordDraft = { vehicleId: string; startedAt: string; weeklyRate: string; deposit: string; mileage: string; reason: string;
 licenceConfirmed: boolean; billing: BillingPreview | null | 'unavailable' };
export type AgreementRoute =
 | { kind: 'esign'; agreementId: string }
 | { kind: 'historical'; source: 'paper' | 'legacy_esign'; historicalId: string }
 | { kind: 'none' };
export const STEPS = [['driver', 'Driver & Vehicle'], ['licence', 'Licence'], ['agreement', 'Signed Agreement'],
 ['details', 'Rental Details'], ['billing', 'Billing'], ['review', 'Review']] as const;
export type StepKey = typeof STEPS[number][0];

const sameInstant = (a: string, b: string) => Number.isFinite(Date.parse(a)) && Date.parse(a) === Date.parse(b);
export function agreementRoute(s: RecordRentalStatus, vehicleId: string): { route: AgreementRoute; blockers: Blocker[] } {
 const open = s.agreements.filter(a => !a.voided && a.status !== 'voided');
 const h = s.historical;
 if (h) {
  if (open.some(a => a.id !== h.legacyAgreementId)) return { route: { kind: 'none' }, blockers: ['historical_esign_conflict'] };
  if (vehicleId && h.vehicleId !== vehicleId) return { route: { kind: 'none' }, blockers: ['historical_vehicle_mismatch'] };
  return { route: { kind: 'historical', source: h.source, historicalId: h.id }, blockers: [] };
 }
 if (open.length === 0) return { route: { kind: 'none' }, blockers: ['agreement_missing'] };
 if (open.length > 1) return { route: { kind: 'none' }, blockers: ['agreement_ambiguous'] };
 const a = open[0];
 if (a.status !== 'signed') return { route: { kind: 'none' }, blockers: ['agreement_unsigned'] };
 if (vehicleId && a.vehicleId !== vehicleId) return { route: { kind: 'none' }, blockers: ['agreement_vehicle_mismatch'] };
 if (!a.archived) return { route: { kind: 'none' }, blockers: ['agreement_not_archived'] };
 if (!a.signedTerms) return { route: { kind: 'none' }, blockers: [s.historicalInstalled ? 'agreement_legacy_terms' : 'historical_not_installed'] };
 return { route: { kind: 'esign', agreementId: a.id }, blockers: [] };
}

export function recordRentalSteps(s: RecordRentalStatus, d: RecordDraft, now = Date.now()) {
 const driver: Blocker[] = [];
 if (s.driver.archived) driver.push('driver_archived');
 if (!s.driver.portalLogin) driver.push('portal_login_missing');
 if (!d.vehicleId) driver.push('vehicle_required');
 const licence: Blocker[] = [];
 if (!s.licence.number || !s.licence.state || !s.licence.expiresOn) licence.push('licence_details_missing');
 else if (s.licence.expiresOn < new Date(now).toISOString().slice(0, 10)) licence.push('licence_expired');
 const sides = [s.licence.front, s.licence.back];
 if (sides.includes('missing')) licence.push('licence_image_missing');
 else if (sides.includes('duplicate')) licence.push('licence_image_duplicate');
 else if (sides.some(x => x !== 'verified')) licence.push('licence_image_unverified');
 else if (!d.licenceConfirmed) licence.push('licence_check_required');
 const { route, blockers: agreement } = agreementRoute(s, d.vehicleId);
 const details: Blocker[] = [];
 const start = z.string().datetime({ offset: true }).safeParse(d.startedAt);
 if (!start.success) details.push('start_invalid');
 else if (Date.parse(d.startedAt) > now) details.push('start_future');
 const rate = Number(d.weeklyRate);
 if (d.weeklyRate.trim() === '' || !recordRequest.shape.weeklyRate.safeParse(rate).success) details.push('rate_invalid');
 if (d.deposit.trim() !== '' && !recordRequest.shape.deposit.safeParse(Number(d.deposit)).success) details.push('deposit_invalid');
 if (d.mileage.trim() !== '' && !recordRequest.shape.pickupMileage.safeParse(Number(d.mileage)).success) details.push('mileage_invalid');
 if (d.reason.trim().length < 5 || d.reason.trim().length > 500) details.push('reason_required');
 if (route.kind === 'historical' && s.historical) {
  if (start.success && !sameInstant(d.startedAt, s.historical.rentalStart)) details.push('historical_start_mismatch');
  if (Number.isFinite(rate) && Math.round(rate * 100) !== s.historical.weeklyCents) details.push('historical_rate_mismatch');
 }
 const billing: Blocker[] = d.billing === null ? ['billing_unreviewed'] : d.billing === 'unavailable' ? ['billing_unavailable'] : [];
 const by: Record<Exclude<StepKey, 'review'>, Blocker[]> = { driver, licence, agreement, details, billing };
 const all = Object.values(by).flat();
 return { route, steps: STEPS.map(([key, title]) => ({ key, title, blockers: key === 'review' ? all : by[key] })), ready: all.length === 0 };
}

// Values a registered historical agreement already fixed; the record must repeat them exactly.
export function historicalDefaults(s: RecordRentalStatus) {
 const h = s.historical;
 return h ? { vehicleId: h.vehicleId, startedAt: h.rentalStart, weeklyRate: (h.weeklyCents / 100).toFixed(2),
  deposit: h.depositCents === null ? '' : (h.depositCents / 100).toFixed(2) } : null;
}

export function provenanceLabel(s: RecordRentalStatus, route: AgreementRoute) {
 if (route.kind === 'esign') return 'eSign Verified';
 if (route.kind === 'historical') return route.source === 'legacy_esign' ? 'Staff-Verified Legacy eSign' : 'Staff-Verified Paper Original';
 return s.historical ? 'Registered, Not Usable' : 'None';
}
