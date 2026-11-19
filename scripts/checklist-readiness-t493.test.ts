import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { activationRequirements, NEXT_STEP_REQUIREMENT_KEYS, type DriverReadinessFacts } from "../src/lib/activation-readiness";
import { checklistEvidenceItems, insuranceQuoteApplied, lifecycleReadiness, withVaultReceipt } from "../src/lib/checklist-readiness";
import { requirementEvidence, type EvidenceEvent } from "../src/lib/checklist-evidence";
import { driverLifecycle } from "../src/lib/driver-lifecycle";
import { driverNextStepRequirements } from "../src/lib/driver-next-step-requirements";
import { handleFleetInsuranceApplied, INSURANCE_APPLIED_ACTION, readFleetInsuranceApplied } from "../src/lib/fleet-insurance-applied.server";

// Modeled on Jonathon Boykins (802fb55c…, rental 303a7ae5 Reserved, pickup
// Nov 19, not picked up) as read from production on Nov 18 2026 8:30 PM ET.
const APP = "802fb55c-d7e8-45ae-9b40-dc5efa74753f";
// The browser vault list (adminListDriverDocuments) never carries storage_path.
const vault = [
  { id: "da2e9925", category: "license_front", is_current: true, review_status: "verified" },
  { id: "bec38e27", category: "gig_profile", is_current: true, review_status: "verified" },
  { id: "a7f197f6", category: "trip_history", is_current: true, review_status: "verified" },
  { id: "13573dd2", category: "license_back", is_current: true, review_status: "verified" },
  { id: "9919af73", category: "income", is_current: true, review_status: "verified" },
  { id: "d97d44e7", category: "income", is_current: false, review_status: "uploaded" },
  { id: "486d14f2", category: "agreement", is_current: true, review_status: "uploaded" },
];
const ev = (field: EvidenceEvent["field"], revision: number, state: "collected" | "not_collected", id: string, supersedesId: string | null, occurredAt: string): EvidenceEvent => ({
  applicationId: APP, field, revision, expectedRevision: revision - 1, id, supersedesId, state, source: state === "collected" ? "other" : null, note: "", idempotencyKey: id, actorId: "rosa", occurredAt,
} as EvidenceEvent);
const events: EvidenceEvent[] = [
  ev("license_front", 1, "collected", "17b4fe28", null, "2026-11-18T14:59:41Z"),
  ev("gig_profile", 1, "collected", "02d2c57a", null, "2026-11-18T14:59:43Z"),
  ev("insurance_quote", 1, "collected", "1a6a1ff3", null, "2026-11-18T15:40:42Z"),
  ev("insurance_quote", 2, "not_collected", "5c24a8a0", "1a6a1ff3", "2026-11-18T15:41:07Z"),
];
// Server facts (rentals.functions.ts reads documents with storage_path).
const facts: DriverReadinessFacts = {
  status: "approved",
  agreements: [{ source: "rental", status: "signed", signed_at: "2026-11-18T19:09:00Z", voided_at: null, rental_id: null }],
  documents: vault.map((d) => ({ ...d, storage_path: `private/${d.id}` })),
  interviewCompletedAt: "2026-11-18T14:53:00Z",
  insurance: { status: "missing", exceptionAllowed: false, settingPresent: true, settingReadable: true },
  hasPassedInspection: false,
  evidence: { license_front: "collected", insurance_quote: "not_collected" },
  rentalActive: false,
};
const requirements = activationRequirements(facts);
const input = { applicationId: APP, documents: vault, events, requirements, rentalActive: false, inspectionPassed: false, fleetInsuranceApplied: null };
const items = checklistEvidenceItems(input);
const row = (key: Parameters<typeof requirementEvidence>[0]) => requirementEvidence(key, items);

describe("Jonathon's checklist (t493u)", () => {
  it("orders Reservation Paid before Insurance Quote before Insurance Setup, Screening with verification", () => {
    const terms = { key: "terms_confirmed", label: "Terms Confirmed", met: true, enforcement: "advisory" } as const;
    const list = driverNextStepRequirements(requirements, "applied", terms);
    const keys = list.map((r) => r.key);
    expect(keys).toEqual([...NEXT_STEP_REQUIREMENT_KEYS]);
    // His fee is "applied" (credited to week one): still Reservation Paid.
    expect(list.find((r) => r.key === "reservation_paid")).toMatchObject({ met: true, detail: "Paid · Applied To First Week" });
    expect(keys.indexOf("screening")).toBeLessThan(keys.indexOf("approved"));
    expect(keys.indexOf("signed_agreement")).toBeLessThan(keys.indexOf("reservation_paid"));
    expect(keys.indexOf("reservation_paid")).toBeLessThan(keys.indexOf("insurance_quote"));
    expect(keys.indexOf("insurance_quote")).toBeLessThan(keys.indexOf("insurance_verified"));
    expect(keys.slice(-3)).toEqual(["inspection", "pickup", "rental_active"]);
  });

  it("Pickup Complete is NOT green before pickup, even with the $50 fee paid", () => {
    expect(row("pickup")?.tone).toBe("red");
    expect(requirements.find((r) => r.key === "pickup")?.met).toBe(false);
    // Only a running rental completes it.
    const running = checklistEvidenceItems({ ...input, rentalActive: true });
    expect(requirementEvidence("pickup", running)?.tone).toBe("green");
  });

  it("Driver's License and Gig Profile are green Verified from the reviewed files", () => {
    expect(row("license_documents")).toMatchObject({ tone: "green", label: "Verified" });
    expect(row("gig_profile")).toMatchObject({ tone: "green", label: "Verified" });
    expect(row("income")).toMatchObject({ tone: "green", label: "Verified" });
  });

  it("an uploaded but unreviewed file is green On File; a check-off alone stays yellow", () => {
    const unreviewed = checklistEvidenceItems({ ...input, documents: vault.map((d) => ({ ...d, review_status: "uploaded" })) });
    expect(requirementEvidence("license_documents", unreviewed)).toMatchObject({ tone: "green", label: "On File" });
    const noFiles = checklistEvidenceItems({ ...input, documents: [] });
    expect(requirementEvidence("license_documents", noFiles)?.tone).toBe("yellow");
    expect(requirementEvidence("gig_profile", noFiles)?.tone).toBe("yellow");
    // A rejected file never counts.
    const rejected = checklistEvidenceItems({ ...input, events: [], documents: vault.map((d) => d.category === "gig_profile" ? { ...d, review_status: "rejected" } : d) });
    expect(requirementEvidence("gig_profile", rejected)?.tone).toBe("red");
  });

  it("Screening is green Approved because the application is approved, never a background pass", () => {
    const screening = requirements.find((r) => r.key === "screening");
    expect(screening).toMatchObject({ met: true, detail: "Approved" });
    expect(row("screening")).toMatchObject({ tone: "green", label: "Approved" });
    const pending = activationRequirements({ ...facts, status: "new" });
    expect(pending.find((r) => r.key === "screening")?.met).toBe(false);
    expect(JSON.stringify(row("screening"))).not.toMatch(/Passed|Clear/);
  });

  it("Insurance Quote: red Not Applied now; yellow once Mark Applied; green only with the quote file", () => {
    expect(row("insurance_quote")).toMatchObject({ tone: "red", label: "Not Applied" });
    const applied = [...events, ev("insurance_quote", 3, "collected", "q3", "5c24a8a0", "2026-11-19T01:00:00Z")];
    expect(requirementEvidence("insurance_quote", checklistEvidenceItems({ ...input, events: applied }))).toMatchObject({ tone: "yellow", label: "Applied · Awaiting Quote" });
    expect(activationRequirements({ ...facts, evidence: { insurance_quote: "collected" } }).find((r) => r.key === "insurance_quote")?.met).toBe(false);
    const quoteDoc = { id: "quote1", category: "insurance_quote", is_current: true, review_status: "uploaded" };
    expect(requirementEvidence("insurance_quote", checklistEvidenceItems({ ...input, events: applied, documents: [...vault, quoteDoc] }))).toMatchObject({ tone: "green", label: "Quote On File" });
    expect(activationRequirements({ ...facts, documents: [...facts.documents, { ...quoteDoc, storage_path: "p" }] }).find((r) => r.key === "insurance_quote")?.met).toBe(true);
    // Insurance Setup is untouched by any of this.
    expect(requirements.find((r) => r.key === "insurance_verified")?.met).toBe(false);
  });

  it("FLEET's applied mark turns it yellow; a later staff Not Applied correction wins", () => {
    expect(insuranceQuoteApplied({ applicationId: APP, events, fleetInsuranceApplied: { at: "2026-11-19T01:05:00Z", summary: "" } })).toBe(true);
    expect(insuranceQuoteApplied({ applicationId: APP, events, fleetInsuranceApplied: { at: "2026-11-18T15:00:00Z", summary: "" } })).toBe(false);
    expect(insuranceQuoteApplied({ applicationId: APP, events: [], fleetInsuranceApplied: { at: "2026-11-18T15:00:00Z", summary: "" } })).toBe(true);
    expect(insuranceQuoteApplied({ applicationId: APP, events: [], fleetInsuranceApplied: null })).toBe(false);
  });
});

describe("Stepper and checklist share one source (t493u)", () => {
  const stepper = lifecycleReadiness({ ...input, items });
  it("Documents and Screening are complete and green for Jonathon", () => {
    expect(stepper).toEqual({ documentsReceived: true, documentsTone: "green", screeningComplete: true, screeningTone: "green" });
    const life = driverLifecycle({ contacted: true, interviewComplete: true, screening: stepper.screeningComplete, documentsReceived: stepper.documentsReceived, approved: true, agreement: true, reserved: true, inspection: false, rentalActive: false, insuranceComplete: false });
    expect(life.stages.find((s) => s.key === "documents")?.state).toBe("done");
    expect(life.stages.find((s) => s.key === "screening")?.state).toBe("done");
    expect(life.stages.find((s) => s.key === "pickup")?.state).not.toBe("done");
    expect(life.open).toEqual([]);
    expect(life.current.key).toBe("insurance");
  });
  it("the stepper color follows the checklist rows, not the insurance quote", () => {
    // The old stepper painted Screening red from the Insurance Quote row.
    expect(row("insurance_quote")?.tone).toBe("red");
    expect(stepper.screeningTone).toBe("green");
    const noDocs = lifecycleReadiness({ ...input, documents: [], events: [] });
    expect(noDocs.documentsTone).toBe("red");
    expect(noDocs.documentsReceived).toBe(false);
  });
  it("withVaultReceipt treats a current file with an id as received", () => {
    expect(withVaultReceipt([{ id: "x", category: "license_front", is_current: true }])[0]?.storage_path).toBe("vault:x");
    expect(withVaultReceipt([{ id: "x", category: "license_front", is_current: true, storage_path: null }])[0]?.storage_path).toBe(null);
  });
  it("the profile no longer treats a paid account as a completed pickup", () => {
    const src = readFileSync(new URL("../src/components/admin/DriversPanel.tsx", import.meta.url), "utf8");
    expect(src).not.toMatch(/pickupPaid/);
    expect(src).toMatch(/checklistEvidenceItems\(checklistInput\)/);
    expect(src).toMatch(/documents: stepperReadiness\.documentsTone/);
  });
});

describe("FLEET insurance-applied endpoint", () => {
  const KEY = "k".repeat(32);
  const env = { FLEET_API_KEY: KEY };
  const req = (body: unknown, auth = `Bearer ${KEY}`) => new Request("https://x/api/public/fleet/insurance-applied", { method: "POST", headers: { authorization: auth, "content-type": "application/json" }, body: JSON.stringify(body) });
  function fakeAdmin(app: any, dup: any[] = []) {
    const writes: any[] = [];
    const chain = (table: string) => {
      const q: any = { filters: [] as any[] };
      q.select = () => q; q.eq = (...a: any[]) => { q.filters.push(a); return q; }; q.order = () => q;
      q.limit = async () => ({ data: dup, error: null });
      q.maybeSingle = async () => ({ data: table === "applications" ? app : null, error: null });
      q.update = () => { writes.push(table); return q; }; q.insert = () => { writes.push(table); return q; };
      return q;
    };
    return { admin: { from: chain }, writes };
  }
  it("refuses without the key", async () => {
    const res = await handleFleetInsuranceApplied(req({ lead_id: APP }, "Bearer nope"), { env, admin: fakeAdmin({ id: APP, status: "approved" }).admin, audit: async () => {} });
    expect(res.status).toBe(401);
  });
  it("records one audit row for an approved applicant and writes nothing else", async () => {
    const audits: any[] = [];
    const { admin, writes } = fakeAdmin({ id: APP, status: "approved", deleted_at: null });
    const res = await handleFleetInsuranceApplied(req({ lead_id: APP, note: "Applied 11/18" }), { env, admin, audit: async (e) => { audits.push(e); }, now: () => new Date("2026-11-19T01:00:00Z") });
    expect(res.status).toBe(201);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: INSURANCE_APPLIED_ACTION, entityType: "application", entityId: APP, metadata: { by: "FLEET (automated)" } });
    expect(writes).toEqual([]);
  });
  it("refuses an applicant that is not approved", async () => {
    const audits: any[] = [];
    const res = await handleFleetInsuranceApplied(req({ lead_id: APP }), { env, admin: fakeAdmin({ id: APP, status: "declined", deleted_at: null }).admin, audit: async (e) => { audits.push(e); } });
    expect(res.status).toBe(409);
    expect(audits).toHaveLength(0);
  });
  it("a repeated idempotency key writes nothing new", async () => {
    const audits: any[] = [];
    const res = await handleFleetInsuranceApplied(req({ lead_id: APP, idempotency_key: "ins-1" }), { env, admin: fakeAdmin({ id: APP, status: "approved", deleted_at: null }, [{ id: "a1", created_at: "2026-11-19T00:00:00Z" }]).admin, audit: async (e) => { audits.push(e); } });
    expect(res.status).toBe(200);
    expect((await res.json()).duplicate).toBe(true);
    expect(audits).toHaveLength(0);
  });
  it("the reader only trusts rows written by FLEET", async () => {
    const rows = [{ created_at: "2026-11-19T02:00:00Z", summary: "forged", metadata: { by: "someone" } }, { created_at: "2026-11-19T01:00:00Z", summary: "ok", metadata: { by: "FLEET (automated)" } }];
    const admin = { from: () => { const q: any = {}; q.select = () => q; q.eq = () => q; q.order = () => q; q.limit = async () => ({ data: rows, error: null }); return q; } };
    expect(await readFleetInsuranceApplied(admin, APP)).toEqual({ at: "2026-11-19T01:00:00Z", summary: "ok" });
  });
});
