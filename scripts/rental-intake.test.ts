import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { evaluateIntake, planPaymentImport, summarizeSubscription, collectedTotal, type IntakeFacts, type IntakeInput } from "../src/lib/rental-intake";

// Synthetic data only. No database, no Stripe.
const input: IntakeInput = {
  applicationId: "a", vehicleId: "v", pickupDate: "2026-10-15", pickupMileage: 100000,
  weeklyRate: 350, depositCollected: null, stripeCustomerId: "cus_T", stripeSubscriptionId: "sub_T",
};
const sub = summarizeSubscription({
  id: "sub_T", customer: "cus_T", status: "active", cancel_at_period_end: false,
  items: { data: [{ quantity: 1, current_period_end: 1792022400, price: { unit_amount: 35000, recurring: { interval: "week", interval_count: 1 } } }] },
});
const facts = (o: Partial<IntakeFacts> = {}): IntakeFacts => ({
  today: "2026-10-16", driver: { id: "a", status: "reviewing" }, vehicle: { id: "v", status: "available", archived: false },
  rentalReadyMissing: [], activeRentalOnVehicle: false, activeRentalForDriver: false, duplicateRental: false,
  mileageHistoryMax: 99000, subscription: sub, stripeChecked: true, stripeLiveBlocked: false,
  subscriptionLinkedElsewhere: false, ...o,
});
const codes = (f: IntakeFacts, i = input) => evaluateIntake(i, f).map((b) => b.code);

describe("Record Rental rules", () => {
  it("clean case passes", () => expect(codes(facts())).toEqual([]));
  it("prevents duplicates and overlaps", () => {
    expect(codes(facts({ duplicateRental: true }))).toContain("duplicate_rental");
    expect(codes(facts({ activeRentalOnVehicle: true }))).toContain("vehicle_busy");
    expect(codes(facts({ activeRentalForDriver: true }))).toContain("driver_has_active_rental");
  });
  it("keeps readiness and safety", () => {
    expect(codes(facts({ rentalReadyMissing: ["vin"] }))).toContain("vehicle_not_ready");
    expect(codes(facts({ vehicle: { id: "v", status: "sold", archived: false } }))).toContain("vehicle_unavailable");
    expect(codes(facts({ mileageHistoryMax: 120000 }))).toContain("mileage_below_history");
    expect(codes(facts(), { ...input, pickupDate: "2026-10-20" })).toContain("future_pickup");
  });
  it("verifies the existing subscription", () => {
    expect(codes(facts({ subscriptionLinkedElsewhere: true }))).toContain("subscription_already_linked");
    expect(codes(facts(), { ...input, weeklyRate: 375 })).toContain("subscription_amount_mismatch");
    expect(codes(facts({ subscription: { ...sub, interval: "month" } }))).toContain("subscription_not_weekly");
    expect(codes(facts({ subscription: { ...sub, customerId: "cus_X" } }))).toContain("subscription_customer_mismatch");
    expect(codes(facts({ subscription: { ...sub, status: "canceled" } }))).toContain("subscription_inactive");
    expect(codes(facts({ stripeLiveBlocked: true, subscription: null, stripeChecked: false }))).toEqual(["stripe_live_not_approved"]);
  });
  it("uses Stripe's next billing date", () => expect(sub.nextBillingDate).toBe("2026-10-15"));
  it("deposit unknown stays Not Set", () => expect(codes(facts(), { ...input, depositCollected: null })).toEqual([]));
});

describe("Payment import", () => {
  const paid = { id: "in_1", status: "paid", amount_paid: 35000, amount_due: 35000, payment_intent: "pi_1", charge: { id: "ch_1", amount_refunded: 0 }, period_start: 1792022400, status_transitions: { paid_at: 1792022400 } };
  it("imports paid once, dedupes by invoice/PI/charge", () => {
    expect(planPaymentImport([paid, paid], { invoiceIds: [], paymentIntentIds: [], chargeIds: [] })).toHaveLength(1);
    expect(planPaymentImport([paid], { invoiceIds: ["in_1"], paymentIntentIds: [], chargeIds: [] })).toHaveLength(0);
    expect(planPaymentImport([{ ...paid, id: "in_2" }], { invoiceIds: [], paymentIntentIds: ["pi_1"], chargeIds: [] })).toHaveLength(0);
    expect(planPaymentImport([{ ...paid, id: "in_3", payment_intent: null }], { invoiceIds: [], paymentIntentIds: [], chargeIds: ["ch_1"] })).toHaveLength(0);
  });
  it("keeps refunds and failures, skips projected", () => {
    const rows = planPaymentImport([
      { ...paid, id: "in_r", payment_intent: "pi_r", charge: { id: "ch_r", amount_refunded: 35000 } },
      { id: "in_f", status: "open", amount_due: 35000, attempt_count: 2, period_start: 1792022400 },
      { id: "in_u", status: "open", amount_due: 35000, attempt_count: 0 },
      { id: "upcoming_x", object: "upcoming", status: "draft", amount_due: 35000 },
    ], { invoiceIds: [], paymentIntentIds: [], chargeIds: [] });
    expect(rows.map((r) => r.status)).toEqual(["refunded", "failed"]);
    expect(collectedTotal(rows)).toBe(0);
  });
});

describe("No-charge guarantees (source check)", () => {
  const src = readFileSync("src/lib/rental-intake.functions.ts", "utf8").replace(/\/\/.*$/gm, "");
  it("never writes to Stripe, messages, or provisions logins", () => {
    expect(src).not.toMatch(/\.(create|update|cancel|del|pay|finalizeInvoice|confirm)\s*\(/);
    expect(src).not.toMatch(/sendEmail|sendSms|provisionDriverAccount|startRentalAutopay|chargeCardOnRental|inviteUserByEmail/);
  });
  it("creates rentals only through the transaction, behind Manager + typed confirmation", () => {
    expect(src).not.toMatch(/from\("rentals"\)\s*\.(insert|update|upsert)/);
    expect(src).toMatch(/record_existing_rental_tx/);
    expect(src).toMatch(/requireManager/);
    expect(src).toMatch(/RECORD_CONFIRM_PHRASE/);
  });
});

// ── Corrections (Oct 16, 2026): identity, authorization, approval modes ──
import { evaluateDriverEligibility, RECORD_RENTAL_ENABLED, type DriverIdentityFacts } from "../src/lib/rental-intake";
const okId: DriverIdentityFacts = {
  status: "approved", deleted: false, openIdentityReviews: 0, differentPersonResolved: false,
  hasLicenseNumber: true, licenseExpiration: "2028-01-01", hasLicenseFront: true, hasLicenseBack: true,
};
const elig = (o: Partial<DriverIdentityFacts>, req = true) =>
  evaluateDriverEligibility({ ...okId, ...o }, "2026-10-16", { requireApproved: req }).map((b) => b.code);

describe("Driver identity requirements", () => {
  it("complete evidence passes", () => expect(elig({})).toEqual([]));
  it("requires Approved for Record Rental", () => expect(elig({ status: "reviewing" })).toContain("application_not_approved"));
  it("approval itself does not require Approved", () => expect(elig({ status: "reviewing" }, false)).toEqual([]));
  it("blocks open or different-person reviews", () => {
    expect(elig({ openIdentityReviews: 1 })).toContain("identity_review_open");
    expect(elig({ differentPersonResolved: true })).toContain("identity_conflict");
  });
  it("requires a valid license and both photos", () => {
    expect(elig({ hasLicenseNumber: false })).toContain("license_missing_or_expired");
    expect(elig({ licenseExpiration: "2026-10-15" })).toContain("license_missing_or_expired");
    expect(elig({ licenseExpiration: null })).toContain("license_missing_or_expired");
    expect(elig({ hasLicenseBack: false })).toContain("license_documents_missing");
  });
  it("deleted or missing driver fails", () => {
    expect(elig({ deleted: true })).toEqual(["no_driver"]);
    expect(evaluateDriverEligibility(null, "2026-10-16", { requireApproved: true }).map((b) => b.code)).toEqual(["no_driver"]);
  });
  it("Record Rental rules include identity when supplied", () => {
    expect(codes(facts({ identity: { ...okId, status: "reviewing", hasLicenseFront: false } })))
      .toEqual(expect.arrayContaining(["application_not_approved", "license_documents_missing"]));
    expect(codes(facts({ identity: okId }))).toEqual([]);
  });
});

describe("Record Rental authorization and activation (source guarantees)", () => {
  const fn = readFileSync("src/lib/rental-intake.functions.ts", "utf8");
  const sql = readFileSync("scripts/record-existing-rental.v2.proposed.sql", "utf8");
  it("stays disabled", () => expect(RECORD_RENTAL_ENABLED).toBe(false));
  it("calls the database as the signed-in user with no actor", () => {
    expect(fn).toMatch(/context\.supabase as any\)\.rpc\("record_existing_rental_tx"/);
    expect(fn).not.toMatch(/supabaseAdmin as any\)\.rpc\("record_existing_rental_tx"/);
    expect(fn).not.toMatch(/_actor/);
  });
  it("checks the feature gate before calling the database", () =>
    expect(fn.indexOf("!RECORD_RENTAL_ENABLED")).toBeLessThan(fn.indexOf('rpc("record_existing_rental_tx"')));
  it("database function: auth.uid + is_manager, no actor param, no service_role grant", () => {
    expect(sql).toMatch(/v_actor uuid := auth\.uid\(\)/);
    expect(sql).toMatch(/private\.is_manager\(\) IS NOT TRUE/);
    expect(sql).not.toMatch(/_actor uuid\)/);
    expect(sql).toMatch(/FROM PUBLIC, anon, service_role/);
    expect(sql).toMatch(/TO authenticated;/);
    expect(sql).toMatch(/actor_user_id, actor_role, action, entity_type, entity_id, summary, metadata/);
  });
  it("database function: identity gate and payment conflict handling", () => {
    for (const c of ["application_not_approved", "identity_review_open", "identity_conflict", "license_missing_or_expired", "license_documents_missing", "payment_conflict"])
      expect(sql).toContain(c);
    expect(sql).not.toMatch(/ON CONFLICT DO NOTHING/);
  });
  it("still no Stripe writes, messages or logins", () => {
    expect(fn).not.toMatch(/\.(create|update|cancel|del)\(/);
    expect(fn).not.toMatch(/sendEmail|sendSms|sendPortalInviteEmail|provisionDriverAccount|issueAgreement/);
  });
});

describe("Consolidated approval (source guarantees)", () => {
  const src = readFileSync("src/lib/applications.functions.ts", "utf8");
  const ap = src.slice(src.indexOf("export const approveApplication"), src.indexOf("export const getApprovalEligibility"));
  const inv = src.slice(src.indexOf("export const inviteDriverPortal"), src.indexOf("// ---------------------------------------------------------- acknowledgement"));
  const core = src.slice(src.indexOf("async function invitePortalCore"), src.indexOf("export const approveApplication"));
  it("one approval path: Manager+, eligibility before any write, strict input", () => {
    expect(ap).toContain("requireManager");
    expect(ap.indexOf("evaluateDriverEligibility")).toBeLessThan(ap.indexOf(".update("));
    expect(ap).toMatch(/\.strict\(\)/);
    expect(ap).toMatch(/mode: z\.enum\(\["approve_only", "approve_invite"\]\)/);
    expect(ap).not.toMatch(/"standard"|"manual_intake"/);
  });
  it("never sends an agreement or touches Stripe/rentals", () => {
    expect(ap).not.toMatch(/issueAgreement|hasOpenOrSignedAgreement|stripe|from\("rentals"\)/i);
    expect(inv).not.toMatch(/issueAgreement|stripe|rentals/i);
  });
  it("Approve Only creates no login and sends nothing", () => {
    expect(ap).toMatch(/mode === "approve_invite"\s*\? await invitePortalCore/);
    expect(ap).not.toMatch(/provisionDriverAccount|sendPortalInviteEmail/);
  });
  it("guarded update and audit attribution", () => {
    expect(ap).toMatch(/\.eq\("status", app\.status as string\)/);
    expect(ap).toMatch(/logAudit\(actor,/);
    expect(ap).toContain("agreement_sent: false");
  });
  it("only New/Reviewing can be approved", () => expect(ap).toMatch(/\["new", "reviewing"\]\.includes/));
  it("no duplicate invites: email only when the login is new", () => {
    expect(core).toMatch(/if \(!account\.created\) return "existing"/);
    expect(core.indexOf('return "existing"')).toBeLessThan(core.indexOf("sendPortalInviteEmail"));
  });
  it("Invite: Manager+, Approved/Active only, shared core", () => {
    expect(inv).toContain("requireManager");
    expect(inv).toMatch(/\["approved", "active"\]/);
    expect(inv).toContain("invitePortalCore");
  });
  it("Send Agreement remains a separate explicit action", () =>
    expect(readFileSync("src/lib/agreements.functions.ts", "utf8")).toMatch(/export const sendAgreement = createServerFn/));
});

describe("Approval interface (source guarantees)", () => {
  const ui = readFileSync("src/components/admin/DriverApprovalActions.tsx", "utf8");
  const panel = readFileSync("src/components/admin/DriversPanel.tsx", "utf8");
  it("old Approve & Send Contract is gone", () => {
    expect(panel).not.toContain("Approve & Send Contract");
    expect(panel).not.toContain("useServerFn(approveApplication)");
  });
  it("shown only to Manager/Owner and never with an active rental", () =>
    expect(panel).toMatch(/\{canManage && !rentalActive \? \(\s*<DriverApprovalActions/));
  it("modal offers exactly Approve Only and Approve & Invite, disabled until eligible", () => {
    expect(ui).toContain('doApprove("approve_only")');
    expect(ui).toContain('doApprove("approve_invite")');
    expect(ui).toMatch(/const blocked = missing === null \|\| missing\.length > 0/);
  });
  it("Invite only for Approved drivers without a login", () => expect(ui).toMatch(/status === "approved" && !hasLogin/));
  it("Record Rental still off", () => expect(RECORD_RENTAL_ENABLED).toBe(false));
});
