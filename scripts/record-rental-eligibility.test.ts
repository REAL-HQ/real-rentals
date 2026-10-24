// Agreement eligibility (proposed/record-rental-historical/04) against the local harness:
//   Vera: an old eSign agreement that was VOIDED no longer blocks a paper original;
//   Uma:  an unsigned, unvoided agreement still blocks (staff must void it first);
//   Leo:  a LEGACY eSign agreement (no signed-terms block, archive at a legacy path) is
//         registered as staff-verified evidence through the app's own flow, recorded, and
//         the eSign row is linked to the rental once.
// Run after up.sh and seed.sh (both install 01 and 04). Local harness only.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import postgres from "postgres";
import { DB, ISSUER_CONFIG, OWNER, OWNER_SESSION, context, staff, fakeStripe, harnessStorage } from "./record-rental-harness/clients";
import { buildRecordResources } from "../src/lib/record-rental-resources.server";
import { createRecordRentalTransportV2 } from "../src/lib/record-rental-runtime.server";
import { executeRecordRental } from "../src/lib/record-rental-operation.server";
import { previewPositiveLicenseV1, verifyPositiveLicenseV1 } from "../src/lib/record-rental-archive.server";
import { registerHistoricalAgreementV1, registerLegacyEsignAgreementV1 } from "../src/lib/record-rental-historical.server";
import type { Port } from "../src/lib/paper-contract";

const db = postgres(DB, { max: 1, onnotice: () => {} });
const storage = harnessStorage(db);
const sha = (b: Uint8Array | Buffer) => createHash("sha256").update(b).digest("hex");
const signal = new AbortController().signal;
let checks = 0;
const pass = (name: string) => { checks++; console.log(`PASS ${name}`); };
const COORD = "c0000000-0000-4000-8000-00000000c001", COORD_SESSION = "c0000000-0000-4000-8000-00000000c002";
const mk = (n: number, name: string, vin: string, license: string) => ({ app: `a${n}000000-0000-4000-8000-00000000000${n}`, drv: `d${n}000000-0000-4000-8000-00000000000${n}`,
  front: `f${n}000000-0000-4000-8000-00000000000${n}`, back: `b${n}000000-0000-4000-8000-00000000000${n}`, veh: `e${n}000000-0000-4000-8000-00000000000${n}`,
  vin, name, email: `${name.split(" ")[0].toLowerCase()}@example.test`, license });
const VERA = mk(4, "Vera Voided", "1HGCM82633A004352", "V1112223");
const UMA = mk(5, "Uma Unsigned", "1HGCM82633A004353", "U1112223");
const LEO = mk(6, "Leo Legacy", "1HGCM82633A004354", "L1112223");

function driver(d: typeof VERA) {
  const vars = Object.entries({ ...d, approve_op: randomUUID() }).flatMap(([k, v]) => ["-v", `${k}=${v}`]);
  execFileSync("psql", [DB, "-q", ...vars, "-f", "scripts/record-rental-harness/driver.sql"], { stdio: "pipe" });
}
const resources = () => buildRecordResources({ ...ISSUER_CONFIG, stripeEnvironment: "sandbox", currency: "usd", historicalAgreements: true },
  { stripe: fakeStripe({}, []), ...storage });
// The server's paper upload port, against the harness: storage double, the operation row as
// the server writes it, and the Manager's own register_paper_agreement through PostgREST.
function paperPort(who: ReturnType<typeof context>): Port {
  return {
    async operation(id) { const [r] = await db`select * from public.paper_upload_operations where operation_id = ${id}`; return (r as any) ?? null; },
    async read(path) { try { return await storage.download("rental-agreements", path); } catch { return null; } },
    async upload(path, bytes) { const r = await storage.upload("rental-agreements", path, bytes, "application/pdf"); if (r.error) throw r.error; },
    async attest(row) { await db`insert into public.paper_upload_operations ${db(row as any)}`; },
    async register(id) { const { data, error } = await who.ctx.supabase.rpc("register_paper_agreement", { p_operation_id: id }); if (error) throw new Error((error as any).message); return data; },
  };
}
async function verifyLicence(d: typeof VERA, who: ReturnType<typeof context>) {
  const p = await previewPositiveLicenseV1(who.ctx, who.token, resources(), d.app);
  await verifyPositiveLicenseV1(who.ctx, who.token, resources(), d.app, p.fingerprint);
}
async function agreementRow(d: typeof VERA, over: Record<string, unknown>) {
  const id = randomUUID(), doc = randomUUID(), pdf = Buffer.from(`%PDF-1.4\n% legacy eSign agreement ${id} for ${d.name}\n%%EOF\n`);
  const path = `${d.app}/agreement-${id}.pdf`, body = `Vehicle Rental Agreement for ${d.name}. Weekly rent $275.`;
  await db`insert into public.rr_harness_objects (bucket, path, bytes) values ('rental-agreements', ${path}, ${pdf})`;
  await db`insert into public.documents (id, driver_id, kind, category, storage_bucket, storage_path, content_sha256, is_current)
    values (${doc}, ${d.app}, 'rental_agreement', 'agreement', 'rental-agreements', ${path}, ${sha(pdf)}, true)`;
  const row = { id, application_id: d.app, vehicle_id: d.veh, title: "Vehicle Rental Agreement", body, status: "signed",
    signed_at: "2026-08-30T18:00:00Z", document_id: doc, completed_document_id: doc, archive_status: "archived", sha256: sha(pdf),
    body_sha256: sha(Buffer.from(body)), merge_data: db.json({ weekly_rate: "$275" } as any), company_signer_name: "REAL RENTALS", ...over };
  await db`insert into public.agreements ${db(row as any)}`;
  return { id, doc, pdf, path };
}
async function paperOriginal(d: typeof VERA, who: ReturnType<typeof context>, signedOn: string) {
  const op = randomUUID(), path = `paper/${d.app}/${op}.pdf`, bytes = Buffer.from(`%PDF-1.4\n% paper original for ${d.name}\n%%EOF\n`);
  await db`insert into public.rr_harness_objects (bucket, path, bytes) values ('rental-agreements', ${path}, ${bytes})`;
  await db`insert into public.paper_upload_operations (operation_id, actor_id, driver_id, sha256, size_bytes, storage_path, file_name, agreement_type, signed_on)
    values (${op}, ${who.ctx.userId}, ${d.app}, ${sha(bytes)}, ${bytes.length}, ${path}, 'original.pdf', 'original', ${signedOn})`;
  const { data, error } = await who.ctx.supabase.rpc("register_paper_agreement", { p_operation_id: op });
  assert.equal(error, null); return (data as any).document_id as string;
}
const record = (who: ReturnType<typeof context>, actor: string, req: Record<string, unknown>) =>
  executeRecordRental({ operationId: randomUUID(), subscriptionEvidenceId: null, pickupMileage: null, reason: "Recording an existing rental", ...req }, actor,
    createRecordRentalTransportV2(who.ctx, who.token, resources()), signal);

try {
  const owner = context(OWNER, OWNER_SESSION);
  const coord = await staff(db, COORD, COORD_SESSION, "coordinator@example.test", "coordinator");
  driver(VERA); driver(UMA); driver(LEO);
  for (const d of [VERA, UMA, LEO]) await verifyLicence(d, owner);

  // ---- Vera: a voided agreement is ignored, but kept untouched.
  const voided = await agreementRow(VERA, { status: "voided", voided_at: "2026-08-31T12:00:00Z" });
  const veraDoc = await paperOriginal(VERA, owner, "2026-09-01");
  const vreg = await registerHistoricalAgreementV1(owner.ctx, owner.token, resources(), { operationId: randomUUID(), applicationId: VERA.app,
    vehicleId: VERA.veh, documentId: veraDoc, signedOn: "2026-09-01", rentalStart: "2026-09-02T10:00:00-04:00", weeklyRate: 275, deposit: null,
    termsSummary: "Weekly rent $275, no deposit, signed on paper after the eSign copy was voided." });
  const vrec = await record(owner, OWNER, { applicationId: VERA.app, vehicleId: VERA.veh, startedAt: "2026-09-02T10:00:00-04:00", weeklyRate: 275, deposit: null });
  const [v] = await db`select status, voided_at, rental_id, sha256 from public.agreements where id = ${voided.id}`;
  // activate_rental_tx attaches every unlinked row to the new rental, as for any activation today.
  assert.equal(v.status, "voided"); assert.ok(v.voided_at); assert.equal(v.rental_id, vrec.rentalId); assert.equal(v.sha256, sha(voided.pdf));
  assert.equal(vrec.status, "recorded"); assert.equal((vreg.registration as any).source, "paper");
  pass("a voided eSign agreement no longer blocks registration or recording; it stays voided with its archive hash");

  // ---- Uma: an unsigned, unvoided agreement still blocks.
  await agreementRow(UMA, { status: "sent", signed_at: null, archive_status: "none", document_id: null, completed_document_id: null, sha256: null, body_sha256: null });
  const umaDoc = await paperOriginal(UMA, owner, "2026-09-01");
  await assert.rejects(() => registerHistoricalAgreementV1(owner.ctx, owner.token, resources(), { operationId: randomUUID(), applicationId: UMA.app,
    vehicleId: UMA.veh, documentId: umaDoc, signedOn: "2026-09-01", rentalStart: "2026-09-02T10:00:00-04:00", weeklyRate: 275, deposit: null,
    termsSummary: "Paper original while an unsigned eSign agreement is still open." }), /eSign agreement that is not yet linked/);
  pass("an open, unsigned eSign agreement still blocks until staff void it");

  // ---- Leo: legacy eSign agreement through the app's legacy route.
  const legacy = await agreementRow(LEO, {});
  const input = (over: Record<string, unknown> = {}) => ({ operationId: randomUUID(), paperOperationId: randomUUID(), agreementId: legacy.id,
    rentalStart: "2026-09-01T09:00:00-04:00", weeklyRate: 275, deposit: 250,
    termsSummary: "Weekly rent $275, $250 deposit, terms as printed in the signed eSign PDF.", ...over });
  await assert.rejects(() => registerLegacyEsignAgreementV1(coord.ctx, coord.token, resources(), input(), paperPort(coord)), /Owner or Manager required/);
  await assert.rejects(() => registerLegacyEsignAgreementV1(owner.ctx, owner.token, resources(), input({ rentalStart: "2026-08-29T09:00:00-04:00" }), paperPort(owner)),
    /dated after the rental started/);
  pass("legacy route refuses a Coordinator and a start before the real eSign signing instant");
  const lreg = await registerLegacyEsignAgreementV1(owner.ctx, owner.token, resources(), input(), paperPort(owner));
  const h = lreg.registration as any;
  assert.equal(h.source, "legacy_esign"); assert.equal(h.legacyAgreementId, legacy.id); assert.equal(h.verification, "staff_verified");
  assert.equal(Date.parse(h.legacySignedAt), Date.parse("2026-08-30T18:00:00Z")); assert.equal(h.signedOn, "2026-08-30");
  assert.equal(h.documentSha256, sha(legacy.pdf), "the registered copy must be the exact eSign archive");
  const [lagBefore] = await db`select rental_id, sha256, signed_at, merge_data from public.agreements where id = ${legacy.id}`;
  assert.equal(lagBefore.rental_id, null); assert.deepEqual(lagBefore.merge_data, { weekly_rate: "$275" });
  pass("legacy eSign agreement registered: copy hashes to agreements.sha256, signing date from the eSign record, eSign row unchanged");
  await assert.rejects(() => record(owner, OWNER, { applicationId: LEO.app, vehicleId: LEO.veh, startedAt: "2026-09-01T09:00:00-04:00", weeklyRate: 275, deposit: 300 }),
    /unavailable|recover/i);
  const lrec = await record(owner, OWNER, { applicationId: LEO.app, vehicleId: LEO.veh, startedAt: "2026-09-01T09:00:00-04:00", weeklyRate: 275, deposit: 250 });
  const [lag] = await db`select rental_id from public.agreements where id = ${legacy.id}`;
  assert.equal(lag.rental_id, lrec.rentalId);
  const [ev] = await db`select verified->'agreement'->>'signedAt' s, verified->'agreement'->>'kind' k from private.record_evidence_v1 where operation_id = (select operation_id from private.record_operations where rental_id = ${lrec.rentalId})`;
  assert.equal(Date.parse(ev.s), Date.parse("2026-08-30T18:00:00Z")); assert.equal(ev.k, "paper");
  const [audit] = await db`select metadata from public.audit_log where action = 'historical_agreement.recorded' and entity_id = ${lrec.rentalId}`;
  assert.equal(audit.metadata.source, "legacy_esign"); assert.equal(audit.metadata.legacyAgreementId, legacy.id);
  pass("legacy rental recorded (deposit mismatch refused first); the eSign row is linked to it once; evidence keeps the real signing instant; audited");
  await assert.rejects(() => registerLegacyEsignAgreementV1(owner.ctx, owner.token, resources(), input(), paperPort(owner)), /not yet linked to a rental/);
  pass("a legacy agreement already linked to a rental cannot be registered again");
  console.log(`\nrecord-rental-eligibility: ${checks} checks passed`);
} finally {
  await db.end();
}
