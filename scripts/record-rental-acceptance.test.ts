// Record Rental acceptance against the local harness (scripts/record-rental-harness),
// with the historical-agreements SQL installed. Never a hosted backend.
//   Existing renter (Paige): staff-verified paper original, existing Stripe subscription.
//   New renter (Nate): eSign agreement carrying the signed-terms block, no Stripe customer.
// Both go through the app's own flows: positive licence review, immutable archival,
// historical registration, Record Rental and closeout. Stripe is a read-only double that
// throws on any write.
// Run: bash scripts/record-rental-harness/up.sh && bash scripts/record-rental-harness/seed.sh
//      bun scripts/record-rental-acceptance.test.ts
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import postgres from "postgres";
import { DB, ISSUER_CONFIG, OWNER, OWNER_SESSION, context, staff, fakeStripe, weeklySub, harnessStorage } from "./record-rental-harness/clients";
import { buildRecordResources, type RecordStripeReader } from "../src/lib/record-rental-resources.server";
import { createRecordRentalTransportV2 } from "../src/lib/record-rental-runtime.server";
import { executeRecordRental } from "../src/lib/record-rental-operation.server";
import { previewPositiveLicenseV1, verifyPositiveLicenseV1, archiveSignedAgreementV1 } from "../src/lib/record-rental-archive.server";
import { registerHistoricalAgreementV1, voidHistoricalAgreementV1 } from "../src/lib/record-rental-historical.server";
import { signedRentalTermsV1, zonedDayStart } from "../src/lib/signed-rental-terms";

const db = postgres(DB, { max: 1, onnotice: () => {} });
const storage = harnessStorage(db);
const results: string[] = [];
const pass = (name: string) => { results.push(name); console.log(`PASS ${name}`); };
const sha = (b: Uint8Array | Buffer) => createHash("sha256").update(b).digest("hex");
const signal = new AbortController().signal;

const MANAGER = "e0000000-0000-4000-8000-0000000000e1", MANAGER_SESSION = "e0000000-0000-4000-8000-0000000000e2";
const COORD = "c0000000-0000-4000-8000-00000000c001", COORD_SESSION = "c0000000-0000-4000-8000-00000000c002";
const PAIGE = { app: "a1000000-0000-4000-8000-000000000001", drv: "d1000000-0000-4000-8000-000000000001", front: "f1000000-0000-4000-8000-000000000001",
  back: "b1000000-0000-4000-8000-000000000001", veh: "e1000000-0000-4000-8000-000000000001", vin: "2T1BURHE0JC012345", name: "Paige Paper", email: "paige@example.test", license: "P7654321" };
const DANA = { app: "a3000000-0000-4000-8000-000000000003", drv: "d3000000-0000-4000-8000-000000000003", front: "f3000000-0000-4000-8000-000000000003",
  back: "b3000000-0000-4000-8000-000000000003", veh: "e3000000-0000-4000-8000-000000000003", vin: "2T1BURHE0JC067890", name: "Dana Duplicate", email: "dana@example.test", license: "D2468024" };
const NATE = { app: "a2000000-0000-4000-8000-000000000002", drv: "d2000000-0000-4000-8000-000000000002", front: "f2000000-0000-4000-8000-000000000002",
  back: "b2000000-0000-4000-8000-000000000002", veh: "e2000000-0000-4000-8000-000000000002", vin: "2T1BURHE0JC054321", name: "Nate New", email: "nate@example.test", license: "N1234567" };

function driver(d: typeof PAIGE) {
  const vars = Object.entries({ ...d, approve_op: randomUUID() }).flatMap(([k, v]) => ["-v", `${k}=${v}`]);
  execFileSync("psql", [DB, "-q", ...vars, "-f", "scripts/record-rental-harness/driver.sql"], { stdio: "pipe" });
}
function resources(stripe: RecordStripeReader) {
  // historicalAgreements: the harness has proposed/record-rental-historical/01 installed.
  return buildRecordResources({ ...ISSUER_CONFIG, stripeEnvironment: "sandbox", currency: "usd", historicalAgreements: true }, { stripe, ...storage });
}
async function counts(app: string) {
  const [c] = await db`select (select count(*) from public.rentals where application_id = ${app})::int rentals,
    (select count(*) from public.payments)::int payments, (select count(*) from public.agreements where application_id = ${app})::int agreements`;
  return c;
}
async function refuses(name: string, app: string, run: () => Promise<unknown>, pattern: RegExp) {
  const before = await counts(app);
  let message = "";
  await assert.rejects(run, (e: any) => { message = String(e?.message ?? e); assert.match(message, pattern); return true; });
  assert.deepEqual(await counts(app), before, `${name} changed rentals, payments or agreements`);
  pass(`${name} (${message.split("\n")[0].slice(0, 100)})`);
}
async function audits(action: string, entity: string) {
  return db`select actor_user_id, summary, metadata from public.audit_log where action = ${action} and entity_id = ${entity} order by created_at`;
}
// The app's paper upload step (paper-contract.uploadVerified) as the server performs it:
// bytes stored under paper/, the verified operation row written server-side, then the
// Manager's own register_paper_agreement call through PostgREST.
async function paperUpload(staffCtx: ReturnType<typeof context>, app: string, bytes: Buffer, signedOn: string | null, type = "original") {
  const op = randomUUID(), path = `paper/${app}/${op}.pdf`;
  await db`insert into public.rr_harness_objects (bucket, path, bytes) values ('rental-agreements', ${path}, ${bytes})`;
  await db`insert into public.paper_upload_operations (operation_id, actor_id, driver_id, sha256, size_bytes, storage_path, file_name, agreement_type, signed_on)
    values (${op}, ${staffCtx.ctx.userId}, ${app}, ${sha(bytes)}, ${bytes.length}, ${path}, 'signed-agreement.pdf', ${type}, ${signedOn})`;
  const { data, error } = await staffCtx.ctx.supabase.rpc("register_paper_agreement", { p_operation_id: op });
  assert.equal(error, null, (error as any)?.message);
  return { op, path, documentId: (data as any).document_id as string };
}

try {
  // ---- Pure checks of the signed-terms block used for new eSign agreements.
  assert.deepEqual(signedRentalTermsV1("2026-10-20", 275, "$275"), { startDate: "2026-10-20", timeZone: "America/New_York", weeklyCents: 27500, currency: "usd" });
  assert.throws(() => signedRentalTermsV1("2026-10-20", 275, "$280"), /printed weekly rent differs/);
  assert.throws(() => signedRentalTermsV1(null, 275, "$275"), /no exact start date/);
  assert.throws(() => signedRentalTermsV1("2026-02-30", 275, "$275"), /no exact start date/);
  assert.equal(zonedDayStart("2026-08-28"), "2026-08-28T04:00:00.000Z");
  assert.equal(zonedDayStart("2026-01-15"), "2026-01-15T05:00:00.000Z");
  const [{ pgday }] = await db`select ('2026-08-28'::date::timestamp at time zone 'America/New_York') pgday`;
  assert.equal(new Date(pgday).toISOString(), zonedDayStart("2026-08-28"));
  pass("signed-terms block derives from the printed values and refuses a mismatch; signing-day instants match Postgres");

  // ---- Fixtures: staff of each tier and two approved synthetic drivers (through the real approval RPCs).
  const owner = context(OWNER, OWNER_SESSION);
  const manager = await staff(db, MANAGER, MANAGER_SESSION, "manager2@example.test", "team");
  const coord = await staff(db, COORD, COORD_SESSION, "coordinator@example.test", "coordinator");
  driver(PAIGE); driver(NATE); driver(DANA);
  const paymentsAtStart = (await counts(PAIGE.app)).payments;
  await db`update public.applications set stripe_customer_id = 'cus_paige' where id = ${PAIGE.app}`;
  pass("three approved synthetic drivers created through the approval RPCs, with unbound licence images");

  // ---- Gap 1: positive licence review through the app flow.
  await refuses("Coordinator cannot run the positive licence review", PAIGE.app,
    () => previewPositiveLicenseV1(coord.ctx, coord.token, resources(fakeStripe({}, [])), PAIGE.app), /Owner or Manager required/);
  const preview = await previewPositiveLicenseV1(manager.ctx, manager.token, resources(fakeStripe({}, [])), PAIGE.app);
  const lic = await db`select id, storage_path, content_sha256, integrity_v1 from public.documents where id in (${PAIGE.front}, ${PAIGE.back})`;
  for (const d of lic) {
    assert.equal(d.storage_path, `immutable-v1/${d.id}/${d.content_sha256}.pdf`);
    assert.equal(d.integrity_v1.agreement, null);
    assert.equal(sha(await storage.download("driver-docs", d.storage_path)), d.content_sha256);
  }
  const originals = await db`select count(*)::int n from public.rr_harness_objects where bucket = 'driver-docs' and path like ${PAIGE.app + "/license_%"}`;
  assert.equal(originals[0].n, 2, "original licence uploads must be kept");
  assert.equal((preview.snapshot as any).license_number, PAIGE.license);
  pass("licence images copied write-once to immutable-v1, re-hashed and bound; originals kept");
  await assert.rejects(() => verifyPositiveLicenseV1(manager.ctx, manager.token, resources(fakeStripe({}, [])), PAIGE.app, "0".repeat(64)), /changed since the preview/);
  const { reviewId } = await verifyPositiveLicenseV1(manager.ctx, manager.token, resources(fakeStripe({}, [])), PAIGE.app, preview.fingerprint);
  const [review] = await db`select kind, resolution, resolved_by from public.application_identity_reviews where id = ${reviewId}`;
  assert.deepEqual({ ...review }, { kind: "positive_license_v1", resolution: "verified", resolved_by: MANAGER });
  assert.equal((await audits("identity_review.positive_license_v1", PAIGE.app)).length, 1);
  const again = await previewPositiveLicenseV1(manager.ctx, manager.token, resources(fakeStripe({}, [])), PAIGE.app);
  assert.equal(again.fingerprint, preview.fingerprint); assert.ok(again.archived.every((a) => a.recovered));
  pass("positive licence review recorded by the Manager after a stale-fingerprint refusal; audited; re-preview is idempotent");

  // ---- Historical (paper) agreement for the existing renter.
  const pdf = Buffer.from(`%PDF-1.4\n% synthetic signed rental agreement for ${PAIGE.name}, VIN ${PAIGE.vin}, $275/week\n%%EOF\n`);
  const upload = await paperUpload(manager, PAIGE.app, pdf, "2026-08-28");
  const reg = (over: Record<string, unknown> = {}) => ({ operationId: randomUUID(), applicationId: PAIGE.app, vehicleId: PAIGE.veh,
    documentId: upload.documentId, signedOn: "2026-08-28", rentalStart: "2026-09-01T10:00:00-04:00", weeklyRate: 275, deposit: 500,
    termsSummary: "Weekly rent $275 due Mondays, $500 refundable deposit, 12-week minimum, insurance through REAL RENTALS.", ...over });
  await refuses("Coordinator cannot register a historical agreement", PAIGE.app,
    () => registerHistoricalAgreementV1(coord.ctx, coord.token, resources(fakeStripe({}, [])), reg()), /Owner or Manager required/);
  await refuses("a document signed after the rental start is refused", PAIGE.app,
    () => registerHistoricalAgreementV1(manager.ctx, manager.token, resources(fakeStripe({}, [])), reg({ signedOn: "2026-09-02" })), /dated after the rental started/);
  await refuses("a signing date that contradicts the upload's attestation is refused", PAIGE.app,
    () => registerHistoricalAgreementV1(manager.ctx, manager.token, resources(fakeStripe({}, [])), reg({ signedOn: "2026-08-27" })), /different signing date/);
  await refuses("a future rental start is refused", PAIGE.app,
    () => registerHistoricalAgreementV1(manager.ctx, manager.token, resources(fakeStripe({}, [])), reg({ rentalStart: "2027-01-01T10:00:00-05:00" })), /cannot be in the future/);
  const regInput = reg();
  const registered = await registerHistoricalAgreementV1(manager.ctx, manager.token, resources(fakeStripe({}, [])), regInput);
  const hist = registered.registration as any;
  assert.equal(hist.status, "registered"); assert.equal(hist.verification, "staff_verified");
  assert.equal(hist.signedOn, "2026-08-28"); assert.equal(Date.parse(hist.rentalStart), Date.parse("2026-09-01T14:00:00Z"));
  assert.equal(hist.weeklyCents, 27500); assert.equal(hist.depositCents, 50000); assert.equal(hist.registeredBy, MANAGER);
  const [paperDoc] = await db`select storage_path, content_sha256, integrity_v1, source from public.documents where id = ${upload.documentId}`;
  assert.equal(paperDoc.content_sha256, sha(pdf)); assert.equal(paperDoc.source, "paper");
  assert.equal(paperDoc.storage_path, `immutable-v1/${upload.documentId}/${sha(pdf)}.pdf`);
  assert.equal(sha(await storage.download("rental-agreements", paperDoc.storage_path)), sha(pdf));
  assert.equal(sha(await storage.download("rental-agreements", upload.path)), sha(pdf), "the uploaded original must be kept");
  const [regAudit] = await audits("historical_agreement.registered", PAIGE.app);
  assert.equal(regAudit.actor_user_id, MANAGER); assert.match(regAudit.summary, /not an eSign event/);
  assert.equal((await counts(PAIGE.app)).agreements, 0, "no eSign agreement row may be created for a paper original");
  pass("historical agreement registered by a Manager: original preserved and bound, signing date and rental start kept separately, labelled staff-verified, audited, no eSign row");
  const replay = await registerHistoricalAgreementV1(manager.ctx, manager.token, resources(fakeStripe({}, [])), regInput);
  assert.equal((replay.registration as any).recovered, true); assert.equal((replay.registration as any).historicalAgreementId, hist.historicalAgreementId);
  await refuses("a second open registration for the same driver is refused", PAIGE.app,
    () => registerHistoricalAgreementV1(manager.ctx, manager.token, resources(fakeStripe({}, [])), reg()), /already has an open historical agreement/);
  pass("same registration operation recovers instead of registering twice");

  // ---- Record Rental for the existing renter from the historical agreement.
  const paigeCalls: string[] = [];
  const paigeStripe = () => fakeStripe({ cus_paige: [weeklySub("sub_paige1", "cus_paige", 27500)] }, paigeCalls);
  const request = (over: Record<string, unknown> = {}) => ({ operationId: randomUUID(), applicationId: PAIGE.app, vehicleId: PAIGE.veh,
    startedAt: "2026-09-01T10:00:00-04:00", weeklyRate: 275, deposit: 500, pickupMileage: 30500, subscriptionEvidenceId: null,
    reason: "Recording an existing rental from the signed paper agreement", ...over });
  const record = (who: ReturnType<typeof context>, actor: string, req: unknown, stripe = paigeStripe()) =>
    executeRecordRental(req, actor, createRecordRentalTransportV2(who.ctx, who.token, resources(stripe)), signal);
  await refuses("Coordinator cannot record the rental", PAIGE.app, () => record(coord, COORD, request()), /Owner or Manager required/);
  await refuses("a start time that differs from the registered start is refused", PAIGE.app, () => record(manager, MANAGER, request({ startedAt: "2026-09-01T11:00:00-04:00" })), /mismatched/);
  await refuses("a weekly rate that differs from the registered agreement is refused", PAIGE.app, () => record(manager, MANAGER, request({ weeklyRate: 260 })), /mismatched/);
  await refuses("a deposit that differs from the registered agreement is refused by the database", PAIGE.app, () => record(manager, MANAGER, request({ deposit: 400 })), /unavailable|recover/i);
  const req = request();
  const recorded = await record(manager, MANAGER, req);
  assert.equal(recorded.status, "recorded"); assert.equal(recorded.billing, "unchanged"); assert.equal(recorded.paymentsImported, 0);
  const [rental] = await db`select r.status, r.start_date::text, r.weekly_rate::float8 rate, r.deposit_amount::float8 deposit, r.stripe_subscription_id,
      v.status vehicle_status, a.assignment_start, a.pickup_mileage, a.vehicle_id
    from public.rentals r join public.vehicles v on v.id = r.vehicle_id join public.booking_vehicle_assignments a on a.rental_id = r.id where r.id = ${recorded.rentalId}`;
  assert.equal(rental.status, "active"); assert.equal(rental.start_date, "2026-09-01");
  assert.equal(Date.parse(rental.assignment_start), Date.parse("2026-09-01T14:00:00Z"));
  assert.equal(rental.rate, 275); assert.equal(rental.deposit, 500); assert.equal(rental.pickup_mileage, 30500);
  assert.equal(rental.vehicle_id, PAIGE.veh); assert.equal(rental.vehicle_status, "rented"); assert.equal(rental.stripe_subscription_id, "sub_paige1");
  pass("existing renter recorded from the historical agreement: historical start, terms and vehicle assignment preserved; existing subscription linked");
  const [linked] = await db`select rental_id, consumed_at from private.historical_agreements_v1 where id = ${hist.historicalAgreementId}`;
  assert.equal(linked.rental_id, recorded.rentalId); assert.ok(linked.consumed_at);
  const [ev] = await db`select verified->'agreement'->>'kind' kind, verified->'agreement'->>'verification' verification, verified->'agreement'->>'signedAt' signed_at
    from private.record_evidence_v1 where operation_id = ${req.operationId}`;
  assert.deepEqual({ ...ev }, { kind: "paper", verification: "paper-registered", signed_at: "2026-08-28T04:00:00.000Z" });
  const [recAudit] = await audits("historical_agreement.recorded", recorded.rentalId);
  assert.equal(recAudit.actor_user_id, MANAGER); assert.equal(recAudit.metadata.signedOn, "2026-08-28");
  assert.equal((await audits("rental.recorded_existing", recorded.rentalId)).length, 1);
  assert.equal((await counts(PAIGE.app)).agreements, 0); assert.equal((await counts(PAIGE.app)).payments, paymentsAtStart);
  assert.deepEqual([...new Set(paigeCalls)].sort(), ["accounts.retrieve", "subscriptions.list", "subscriptions.retrieve"]);
  pass("registration linked to the rental once; evidence labelled paper/paper-registered with the signing day; both audit rows; Stripe only read");
  const recovered = await record(manager, MANAGER, req);
  assert.equal(recovered.recovered, true); assert.equal(recovered.rentalId, recorded.rentalId);
  await refuses("a second recording for the same driver is refused", PAIGE.app, () => record(manager, MANAGER, request()), /unavailable|mismatched|conflict/i);
  await refuses("a recorded historical agreement cannot be voided", PAIGE.app,
    () => voidHistoricalAgreementV1(manager.ctx, { historicalAgreementId: hist.historicalAgreementId, reason: "Testing a void after recording" }), /already the record for a rental/);
  pass("same operation recovers the committed rental");

  // A second driver's paper agreement for the vehicle Paige now has: registration is allowed
  // (the paper is genuine), but recording it would double-assign the car and is refused.
  const dana = await previewPositiveLicenseV1(owner.ctx, owner.token, resources(fakeStripe({}, [])), DANA.app);
  await verifyPositiveLicenseV1(owner.ctx, owner.token, resources(fakeStripe({}, [])), DANA.app, dana.fingerprint);
  const danaUpload = await paperUpload(owner, DANA.app, Buffer.from(`%PDF-1.4\n% ${DANA.name} agreement for VIN ${PAIGE.vin}\n%%EOF\n`), "2026-09-28");
  const danaReg = await registerHistoricalAgreementV1(owner.ctx, owner.token, resources(fakeStripe({}, [])), { operationId: randomUUID(),
    applicationId: DANA.app, vehicleId: PAIGE.veh, documentId: danaUpload.documentId, signedOn: "2026-09-28", rentalStart: "2026-10-01T09:00:00-04:00",
    weeklyRate: 275, deposit: null, termsSummary: "Weekly rent $275, no deposit, same vehicle as an active rental." });
  await refuses("a historical agreement cannot assign a vehicle that is already rented", DANA.app, () => record(owner, OWNER, { operationId: randomUUID(),
    applicationId: DANA.app, vehicleId: PAIGE.veh, startedAt: "2026-10-01T09:00:00-04:00", weeklyRate: 275, deposit: null, pickupMileage: null,
    subscriptionEvidenceId: null, reason: "Attempting a duplicate vehicle assignment" }, fakeStripe({}, [])), /unavailable|recover|conflict/i);
  await refuses("voiding needs a reason", DANA.app, () => voidHistoricalAgreementV1(owner.ctx,
    { historicalAgreementId: (danaReg.registration as any).historicalAgreementId, reason: "no" }), /too_small/);
  const voided = await voidHistoricalAgreementV1(owner.ctx, { historicalAgreementId: (danaReg.registration as any).historicalAgreementId, reason: "Registered against the wrong vehicle" }) as any;
  assert.equal(voided.status, "voided");
  const [voidAudit] = await audits("historical_agreement.voided", DANA.app);
  assert.equal(voidAudit.actor_user_id, OWNER); assert.equal(voidAudit.metadata.reason, "Registered against the wrong vehicle");
  const [{ docKept }] = await db`select count(*)::int "docKept" from public.documents where id = ${danaUpload.documentId} and integrity_v1 is not null`;
  assert.equal(docKept, 1);
  pass("an unused registration is voided by the Owner with a reason, audited, and its preserved original kept");

  // ---- Gaps 2 and 3: a new renter's eSign agreement carrying the signed-terms block.
  const ownerNate = await previewPositiveLicenseV1(owner.ctx, owner.token, resources(fakeStripe({}, [])), NATE.app);
  await verifyPositiveLicenseV1(owner.ctx, owner.token, resources(fakeStripe({}, [])), NATE.app, ownerNate.fingerprint);
  const terms = signedRentalTermsV1("2026-10-20", 275, "$275");
  const signedPdf = Buffer.from(`%PDF-1.4\n% synthetic eSign completed agreement for ${NATE.name}\n%%EOF\n`);
  const body = `Vehicle Rental Agreement for ${NATE.name}. Start date October 20, 2026. Weekly rent $275.`;
  // As the eSign v1 archive (esign.server.ts) writes it: once, at its immutable-v1 content address.
  const doc = randomUUID(), agreement = randomUUID(), completedPath = `immutable-v1/${doc}/${sha(signedPdf)}.pdf`;
  await db`insert into public.rr_harness_objects (bucket, path, bytes) values ('rental-agreements', ${completedPath}, ${signedPdf})`;
  await db`insert into public.documents (id, driver_id, kind, category, storage_bucket, storage_path, content_sha256, is_current)
    values (${doc}, ${NATE.app}, 'rental_agreement', 'agreement', 'rental-agreements', ${completedPath}, ${sha(signedPdf)}, true)`;
  await db`insert into public.agreements (id, application_id, vehicle_id, title, body, status, signed_at, document_id, completed_document_id,
      archive_status, sha256, body_sha256, merge_data, company_signer_name)
    values (${agreement}, ${NATE.app}, ${NATE.veh}, 'Vehicle Rental Agreement', ${body}, 'signed', '2026-10-19T16:00:00Z', ${doc}, ${doc},
      'archived', ${sha(signedPdf)}, ${sha(Buffer.from(body))}, ${db.json({ weekly_rate: "$275", start_date: "October 20, 2026", record_rental_terms_v1: terms } as any)}, 'REAL RENTALS')`;
  await refuses("Coordinator cannot archive a signed agreement", NATE.app,
    () => archiveSignedAgreementV1(coord.ctx, coord.token, resources(fakeStripe({}, [])), agreement), /Owner or Manager required/);
  const archived = await archiveSignedAgreementV1(owner.ctx, owner.token, resources(fakeStripe({}, [])), agreement);
  const [bound] = await db`select storage_path, integrity_v1 from public.documents where id = ${doc}`;
  assert.equal(bound.storage_path, archived.path); assert.equal(bound.integrity_v1.agreement, agreement);
  assert.deepEqual(bound.integrity_v1.merge_data.record_rental_terms_v1, terms);
  assert.equal(archived.path, completedPath, "binding must not relocate a finalized eSign document");
  assert.equal(sha(await storage.download("rental-agreements", completedPath)), sha(signedPdf));
  assert.equal((await archiveSignedAgreementV1(owner.ctx, owner.token, resources(fakeStripe({}, [])), agreement)).recovered, true);
  pass("new renter's signed eSign PDF verified at its immutable-v1 address and bound with its agreement and signed-terms block; replay is idempotent");

  // A paper original cannot be registered while that eSign agreement is pending.
  const natePaper = await paperUpload(owner, NATE.app, Buffer.from("%PDF-1.4\n% a contradicting paper copy\n%%EOF\n"), null);
  await refuses("a historical agreement is refused while an eSign agreement is pending", NATE.app,
    () => registerHistoricalAgreementV1(owner.ctx, owner.token, resources(fakeStripe({}, [])), { operationId: randomUUID(), applicationId: NATE.app,
      vehicleId: NATE.veh, documentId: natePaper.documentId, signedOn: "2026-10-18", rentalStart: "2026-10-20T09:00:00-04:00", weeklyRate: 275,
      deposit: null, termsSummary: "Contradicting paper copy for the same rental." }), /eSign agreement that is not yet linked/);

  const nateReq = (over: Record<string, unknown> = {}) => ({ operationId: randomUUID(), applicationId: NATE.app, vehicleId: NATE.veh,
    startedAt: "2026-10-20T09:30:00-04:00", weeklyRate: 275, deposit: null, pickupMileage: 12000, subscriptionEvidenceId: null,
    reason: "Recording a rental that started from a signed eSign agreement", ...over });
  const nateCalls: string[] = [];
  await refuses("a start on a different day than the signed start date is refused", NATE.app,
    () => record(owner, OWNER, nateReq({ startedAt: "2026-10-21T09:30:00-04:00" }), fakeStripe({}, nateCalls)), /mismatched|signed start date/);
  await refuses("the new renter cannot take the existing renter's rented vehicle", NATE.app,
    () => record(owner, OWNER, nateReq({ vehicleId: PAIGE.veh }), fakeStripe({}, nateCalls)), /unavailable|mismatched|conflict/i);
  const nate = await record(owner, OWNER, nateReq(), fakeStripe({}, nateCalls));
  const [nr] = await db`select r.start_date::text, r.stripe_subscription_id, v.status vehicle_status, a.assignment_start
    from public.rentals r join public.vehicles v on v.id = r.vehicle_id join public.booking_vehicle_assignments a on a.rental_id = r.id where r.id = ${nate.rentalId}`;
  assert.equal(nr.start_date, "2026-10-20"); assert.equal(Date.parse(nr.assignment_start), Date.parse("2026-10-20T13:30:00Z"));
  assert.equal(nr.stripe_subscription_id, null); assert.equal(nr.vehicle_status, "rented");
  const [nev] = await db`select verified->'agreement'->>'kind' kind, verified->'agreement'->>'verification' verification from private.record_evidence_v1 where application_id = ${NATE.app}`;
  assert.deepEqual({ ...nev }, { kind: "esign", verification: "esign-verified" });
  assert.ok(!nateCalls.includes("subscriptions.retrieve"));
  pass("new renter recorded from the eSign signed-terms block: start on the signed date, no Stripe customer, nothing created in Stripe, labelled esign-verified");

  // ---- Closeout of the historical rental.
  const closeArgs = { _operation_id: randomUUID(), _rental_id: recorded.rentalId, _ended_at: new Date().toISOString(),
    _vehicle_status: "available", _return_miles: 33100, _reason: "Driver returned the vehicle" };
  const coordClose = await coord.ctx.supabase.rpc("close_recorded_rental_v2", closeArgs);
  assert.ok(coordClose.error); pass(`Coordinator cannot close the recorded rental (${(coordClose.error as any).message})`);
  const paymentsBefore = (await counts(PAIGE.app)).payments;
  const closed = await manager.ctx.supabase.rpc("close_recorded_rental_v2", closeArgs);
  assert.equal(closed.error, null, (closed.error as any)?.message);
  const c = closed.data as any;
  const [after] = await db`select r.status, r.end_date::text end_date, v.status vehicle_status, h.rental_id hist_rental
    from public.rentals r join public.vehicles v on v.id = r.vehicle_id join private.historical_agreements_v1 h on h.rental_id = r.id where r.id = ${recorded.rentalId}`;
  assert.notEqual(after.status, "active"); assert.ok(after.end_date); assert.equal(after.vehicle_status, c.vehicleStatus);
  if (c.vehicleStatus !== "available") assert.ok(c.releaseReasons.length > 0, "vehicle held without a stated reason");
  assert.equal(after.hist_rental, recorded.rentalId); assert.equal((await counts(PAIGE.app)).payments, paymentsBefore);
  pass(`historical rental closed: ${after.status} on ${after.end_date}, vehicle ${c.vehicleStatus} (${c.releaseReasons.join(", ") || "released"}); the agreement stays linked; billing unchanged`);

  const [{ jobs }] = await db`select count(*)::int jobs from cron.job`;
  assert.equal(jobs, 0); pass("no scheduled job committed");
  console.log(`\nrecord-rental-acceptance (${process.env.RR_TRANSPORT === "gateway" ? "evidence gateway" : "TCP transport"}): ${results.length} checks passed`);
} finally {
  await db.end();
}
