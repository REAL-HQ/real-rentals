// Staff-verified historical (paper/PDF) rental agreements for Record Rental.
// Registration preserves the uploaded original immutably first, then records the
// staff-confirmed terms through register_historical_agreement_v1 (SQL proposal
// proposed/record-rental-historical). It never creates or backdates an eSign event,
// and it refuses contradictions instead of resolving them. A rental with no signed
// original is not handled here: missing-contract exceptions are a separate, unbuilt
// business decision.
import { z } from 'zod';
import { archiveEvidenceDocumentV1 } from './record-rental-archive.server';
import type { RecordResources, RentalContext } from './record-rental-runtime.server';
import type { Json } from '@/integrations/supabase/types';

const uuid = z.string().uuid();
const cents = z.number().finite().nonnegative().max(100000).refine(n => Math.abs(n * 100 - Math.round(n * 100)) < 1e-7, 'Use at most two decimal places');
export const historicalRegistration = z.object({
 operationId: uuid, applicationId: uuid, vehicleId: uuid, documentId: uuid,
 // The date written on the signed document, and the verified handover instant: separate facts.
 signedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
 rentalStart: z.string().datetime({ offset: true }),
 weeklyRate: cents.refine(n => n > 0), deposit: cents.nullable(),
 termsSummary: z.string().trim().min(10).max(2000),
}).strict();
export const historicalVoid = z.object({ historicalAgreementId: uuid, reason: z.string().trim().min(5).max(500) }).strict();

const REFUSALS: Record<string, string> = {
 historical_agreement_invalid: 'Enter a positive weekly rate and a deposit (or none) with at most two decimal places.',
 operation_conflict: 'This registration was already submitted with different details; start a new one.',
 rental_start_invalid: 'Enter the verified rental start date and time; it cannot be in the future.',
 signed_on_invalid: 'Enter the date written on the signed agreement; it cannot be in the future.',
 signed_after_start_unsupported: 'The agreement is dated after the rental started. That is not supported; it is a missing-contract exception for the Owner to decide.',
 terms_summary_required: 'Summarize the agreement terms you checked (10 to 2000 characters).',
 application_unavailable: 'Driver record unavailable.',
 driver_account_contract_required: 'This driver has no portal login yet; link one before registering the agreement.',
 vehicle_unavailable: 'That vehicle is unavailable or archived.',
 paper_document_unverified: 'That file is not a preserved paper original for this driver.',
 paper_provenance_missing: 'That file has no completed paper upload record.',
 paper_attestation_conflict: 'The upload was recorded as a different kind of agreement or with a different signing date.',
 esign_agreement_pending: 'This driver has an eSign agreement that is not yet linked to a rental. Use it, or void it, first.',
 historical_agreement_open: 'This driver already has an open historical agreement; void it first.',
 historical_agreement_unavailable: 'Historical agreement unavailable.',
 historical_agreement_recorded: 'This historical agreement is already the record for a rental and cannot be voided.',
 void_reason_required: 'Give a reason for voiding (5 to 500 characters).',
 historical_agreement_contention_retry: 'Another change to this driver is in progress; try again.',
};
const refusal = (error: unknown) => {
 const message = String((error as { message?: unknown })?.message ?? '');
 return new Error(REFUSALS[message] ?? 'Historical agreement refused');
};

export async function registerHistoricalAgreementV1(context: RentalContext, token: string, configured: RecordResources, raw: unknown) {
 const v = historicalRegistration.parse(raw);
 // The registration refuses a document that is not already immutably bound, so preserve it first.
 const archive = await archiveEvidenceDocumentV1(context, token, configured, 'paper', v.documentId);
 const { data, error } = await context.supabase.rpc('register_historical_agreement_v1', {
  _operation_id: v.operationId, _application_id: v.applicationId, _vehicle_id: v.vehicleId, _document_id: v.documentId,
  _signed_on: v.signedOn, _rental_start: v.rentalStart, _weekly_rate: v.weeklyRate, _deposit: v.deposit, _terms_summary: v.termsSummary });
 if (error) throw refusal(error);
 return { registration: data as Json, archive };
}

export async function voidHistoricalAgreementV1(context: RentalContext, raw: unknown) {
 const v = historicalVoid.parse(raw);
 const { data, error } = await context.supabase.rpc('void_historical_agreement_v1', { _historical_agreement_id: v.historicalAgreementId, _reason: v.reason });
 if (error) throw refusal(error);
 return data as Json;
}
