/**
 * v1.14 is the agreement new sends use (Dolmar, t319u, Nov 16 2026).
 * Fake data only; no database, no email, no Stripe.
 * Run: bunx vitest run scripts/v114-default-agreement.test.ts
 * Writes the rendered samples to $V114_SAMPLE_DIR when set.
 */
import { describe, it, expect, vi } from "vitest";
import { writeFileSync } from "node:fs";

vi.mock("@/lib/esign.server", () => ({
  getCompanySigner: async () => ({ name: "Test Signer", title: "Operations Lead" }),
  deliverSigningLink: async () => ({ email: "skipped", sms: "skipped", delivered: false }),
}));
vi.mock("@/lib/audit.server", () => ({ logAudit: async () => {} }));
vi.mock("@/lib/roles.server", () => ({ getActor: async () => null }));
vi.mock("@/lib/email.server", () => ({ sendPortalInviteEmail: async () => { throw new Error("no email in tests"); } }));
vi.mock("@/lib/reservation-confirmation.server", () => ({ maybeConfirmReservation: async () => null }));

import { prepareAgreementForTest as prepare, issueAgreement, agreementSendCheck, DEFAULT_LIBRARY_KEY } from "../src/lib/agreements.functions";
import { fleetAgreementPrep } from "../src/lib/fleet-agreement.server";
import { signedReservationFee } from "../src/lib/reservation-fee";
import { chargeReservationFeeAfterSigning } from "../src/lib/reservation-fee.server";
import { createReservationCore } from "../src/lib/reservations.functions";

type Rows = Record<string, any[]>;
function fakeDb(seed: Rows) {
  const state: Rows = JSON.parse(JSON.stringify(seed));
  let n = 0;
  function q(table: string) {
    const f: ((r: any) => boolean)[] = [];
    let lim = Infinity; let op: "select" | "update" | "insert" = "select"; let patch: any = null; let inserted: any = null;
    const all = () => (state[table] ??= []);
    const run = () => {
      if (op === "insert") return { data: inserted, error: null };
      const hit = all().filter((r) => f.every((g) => g(r)));
      if (op === "update") { hit.forEach((r) => Object.assign(r, patch)); return { data: hit, error: null }; }
      return { data: hit.slice(0, lim), error: null };
    };
    const api: any = {
      select: () => api, order: () => api,
      eq: (k: string, v: any) => (f.push((r) => r[k] === v), api),
      neq: (k: string, v: any) => (f.push((r) => r[k] !== v), api),
      is: (k: string, v: any) => (f.push((r) => (r[k] ?? null) === v), api),
      in: (k: string, v: any[]) => (f.push((r) => v.includes(r[k])), api),
      not: (k: string, o: string, v: any) => (f.push((r) => (o === "is" ? (r[k] ?? null) !== v : r[k] !== v)), api),
      gte: (k: string, v: any) => (f.push((r) => r[k] >= v), api),
      lte: (k: string, v: any) => (f.push((r) => r[k] <= v), api),
      limit: (x: number) => ((lim = x), api),
      update: (p: any) => ((op = "update"), (patch = p), api),
      upsert: (p: any) => { const ex = all().find((r) => r.key === p.key); if (ex) Object.assign(ex, p); else all().push({ ...p }); return api; },
      insert: (row: any) => { op = "insert"; const rows = Array.isArray(row) ? row : [row]; const made = rows.map((r) => ({ id: r.id ?? `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, ...r })); all().push(...made); inserted = made[0]; return api; },
      then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
      maybeSingle: async () => { const r = run(); return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: null }; },
      single: async () => { const r = run(); return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: null }; },
    };
    return api;
  }
  return { from: q, state };
}

const APP: any = {
  id: "11111111-1111-4111-8111-111111111111", full_name: "Jordan Q Sample", email: "jordan.sample@example.com", phone: "+15550100199",
  address: "100 Sample St", city: "Tampa", state: "FL", zip: "33602", dob: "1990-04-02",
  license_number: "S123-456-78-900-0", license_state: "FL", license_expiration: "2030-04-02",
  vehicle_id: "22222222-2222-4222-8222-222222222222", weekly_rent: 375, deposit_amount: null,
  contract_start_date: "2026-11-20", contract_end_date: "2026-12-18", status: "approved", deleted_at: null,
};
const CAR: any = { id: APP.vehicle_id, year: 2021, make: "Toyota", model: "Camry", trim: "LE", color: "Silver", vin: "4T1C11AK5MU123456", weekly_rate: 375, deposit: 0, license_plate: "SMP123", plate_state: "FL", partner_id: null, archived_at: null };
const seed = (feeOn: boolean, extra: Rows = {}): Rows => ({
  applications: [APP], vehicles: [CAR], agreement_templates: [], markets: [], partners: [], agreements: [], esign_recipients: [], rentals: [],
  app_settings: [
    { key: "reservation_fee_auto", value: { enabled: feeOn, amount: 50 } },
    { key: "company_identity", value: { legal_name: "Sample Rentals LLC" } },
  ],
  ...extra,
});

describe("v1.14 is the agreement new sends use", () => {
  it("default family is v1.17 (insurance_included_v117); v1.14 stays Owner-approved and selectable", async () => {
    expect(DEFAULT_LIBRARY_KEY).toBe("insurance_included_v117");
    const p = await prepare(fakeDb(seed(true)) as any, APP.id);
    expect(p.tpl.meta.key).toBe("insurance_included_v117");
    expect(p.tpl.meta.approvalStatus).toBe("approved");
    expect(p.tpl.meta.label).toMatch(/v1\.17 — Owner Approved 2026-11-25/);
    const v114 = await prepare(fakeDb(seed(true)) as any, APP.id, undefined, "insurance_included");
    expect(v114.tpl.meta.label).toMatch(/v1\.14 — Owner Approved 2026-11-16/);
  });

  it("fee on (FLEET and approval auto-send): every field fills, $50 fee printed, balance due $325", async () => {
    const db = fakeDb(seed(true));
    const p = await prepare(db as any, APP.id);
    if (process.env.V114_SAMPLE_DIR) writeFileSync(`${process.env.V114_SAMPLE_DIR}/v114-sample-fee-on.txt`, p.body);
    expect(p.blockers).toEqual([]);
    expect(p.body).not.toContain("__________");
    expect(p.body).not.toMatch(/\{\{|\[\[/);
    expect(p.body).toContain("| Reservation Fee (Applied To First Payment) | $50.00");
    expect(p.body).toContain("| Balance Due | $325.00");
    expect(p.body).toContain("| Weekly Rate (Insurance Included) | $375");
    expect(p.body).toMatch(/paid by card right after you sign this Agreement, through the secure payment link we send you, and applied in full to your first payment\. The card you use is saved on file for your rental balance/);
    expect(p.body).toContain("We hold the Vehicle until 30 minutes after your scheduled pickup time; if you have not arrived by then, we may release the Vehicle and the pickup counts as a no-show.");
    expect(p.body).toContain("Unlimited miles within 100 miles of Tampa are included, with no per-mile charge.");
    expect(p.body).toContain("| Service Area | 100-mile radius of Tampa, FL");
    expect(p.body).toContain("There is no security deposit.");
    expect(p.body).not.toMatch(/reservation deposit/i);
    expect(p.body).toContain("The Reservation Fee is not a security deposit.");
    expect(p.body).toContain("We refund it in full if: (a) we cannot set up the Renter Policy for you");
    expect(p.body).toContain("It is not refunded if you do not show for your scheduled pickup, change your mind, miss pickup without notice, or provided information that was false or did not match.");
    expect(p.body).not.toContain("Non-refundable once we set up the Renter Policy");
    for (const s of ["Jordan Q Sample", "jordan.sample@example.com", "S123-456-78-900-0", "2021 Toyota Camry LE", "4T1C11AK5MU123456", "SMP123 / FL", "100 Sample St, Tampa, FL, 33602", "$375.00 weekly", "Card Autopay", "Declined", "None Authorized", "Saved when you pay the Reservation Fee right after signing"]) expect(p.body).toContain(s);
    // The signing charge fires for this agreement.
    expect(signedReservationFee({ body: p.body, merge_data: p.data as any })).toBe(50);
  });

  it("FLEET's prep gives the same agreement", async () => {
    const p = await prepare(fakeDb(seed(true)) as any, APP.id, fleetAgreementPrep({ enabled: true, amount: 50 }, null));
    expect(p.blockers).toEqual([]);
    expect(p.body).toContain("| Reservation Fee (Applied To First Payment) | $50.00");
  });

  it("fee off: prints None, nothing charged, and a missing card does not block send", async () => {
    const db = fakeDb(seed(false));
    const p = await prepare(db as any, APP.id);
    expect(p.body).toContain("| Reservation Fee (Applied To First Payment) | None");
    expect(p.body).toContain("| Balance Due | $375.00");
    expect(signedReservationFee({ body: p.body, merge_data: p.data as any })).toBeNull();
    expect(p.blockers.map((b) => b.field)).not.toContain("card_on_file");
    expect(p.blockers).toEqual([]);
    expect(p.body).toContain("| Payment Card on File (last 4) | Not saved yet");
    expect(p.body).toContain("**3.4 Autopay.**");
    expect(p.body).toContain("If you choose Autopay, you authorize REAL RENTALS to charge your card on file");
    expect(p.notes).toEqual([{ field: "card_on_file", label: "Payment Card On File", why: "No card is saved yet. A card is not required to send this agreement." }]);
    const sent = await issueAgreement(db as any, APP.id, { createdBy: null });
    const row = db.state.agreements.find((a: any) => a.id === sent.id);
    expect(row.status).toBe("sent");
    expect(row.body).toContain("Not saved yet");
    expect(row.body).toContain("**3.4 Autopay.**");
    const withCard = await prepare(fakeDb({ ...seed(false), applications: [{ ...APP, card_brand: "visa", card_last4: "4242" }] }) as any, APP.id);
    expect(withCard.blockers).toEqual([]);
    expect(withCard.notes).toEqual([]);
    expect(withCard.body).toContain("VISA ending 4242");
  });

  it("no saved card can be prepared and sent, including when rent is not Card Autopay", async () => {
    const prep = {
      drivers: { mode: "none" as const, list: [] },
      reservation: { mode: "required" as const, amount: 50 },
      deposit: { mode: "none" as const, amount: null, reason: "" },
      damageWaiver: "declined" as const,
      payment: { schedule: "weekly" as const, method: "Zelle" as const },
      details: {
        driverName: APP.full_name, driverEmail: APP.email, driverPhone: APP.phone,
        address: APP.address, city: APP.city, state: APP.state, zip: APP.zip, dob: APP.dob,
        licenseNumber: APP.license_number, licenseState: APP.license_state, licenseExpiration: APP.license_expiration,
        vehicleDescription: "2021 Toyota Camry LE", vehicleColor: "Silver", vehicleVin: CAR.vin, licensePlate: "SMP123",
        startDate: APP.contract_start_date, endDate: APP.contract_end_date, weeklyRate: "375",
        cardOnFile: "", insuranceCarrier: "", insurancePolicy: "",
      },
    };
    const db = fakeDb(seed(true));
    const p = await prepare(db as any, APP.id, prep);
    expect(p.blockers.find((b) => b.field === "card_on_file")).toBeUndefined();
    expect(p.blockers).toEqual([]);
    expect(p.body).toContain("| Payment Method (Card Autopay, Zelle, Cash App, Venmo, Other) | Zelle");
    expect(p.body).toContain("| Payment Card on File (last 4) | Saved when you pay the Reservation Fee right after signing");
    expect(p.body).toContain("**3.4 Autopay.**");
    expect(p.body).not.toContain("__________");
    expect(p.notes.map((n) => n.why)).toEqual(["Card will be saved when the renter pays the $50 Reservation Fee."]);
    const sent = await issueAgreement(db as any, APP.id, { createdBy: null, prep, fingerprint: p.fingerprint, companyAck: true });
    const row = db.state.agreements.find((a: any) => a.id === sent.id);
    expect(row.status).toBe("sent");
    expect(row.body).toContain("Saved when you pay the Reservation Fee right after signing");
    expect(row.body).toContain("**3.4 Autopay.**");
    expect(row.merge_data.payment_amount).toBe("$375.00 weekly");
    expect(row.merge_data.balance_due).toBe("$325.00");
  });

  it("updated agreement for an active rental: Not Applicable, no fee, no deposit", async () => {
    const db = fakeDb({ ...seed(true), applications: [{ ...APP, card_brand: "visa", card_last4: "4242" }] });
    const prep = { drivers: { mode: "none" as const, list: [] }, reservation: { mode: "not_applicable" as const, amount: null }, deposit: { mode: "none" as const, amount: null, reason: "" }, damageWaiver: "declined" as const, payment: { schedule: "weekly" as const, method: "Card Autopay" as const } };
    const p = await prepare(db as any, APP.id, prep);
    if (process.env.V114_SAMPLE_DIR) writeFileSync(`${process.env.V114_SAMPLE_DIR}/v114-sample-not-applicable.txt`, p.body);
    expect(p.blockers).toEqual([]);
    expect(p.body).toContain("| Reservation Fee (Applied To First Payment) | Not Applicable");
    expect(p.body).toContain("| Balance Due | $375.00");
    expect(signedReservationFee({ body: p.body, merge_data: p.data as any })).toBeNull();
  });

  it("a security deposit on file is refused (v1.14 has only no-deposit wording)", async () => {
    const p = await prepare(fakeDb({ ...seed(true), vehicles: [{ ...CAR, deposit: 250 }] }) as any, APP.id);
    expect(p.blockers.some((b) => b.field === "deposit_amount")).toBe(true);
  });

  it("a saved, active template still wins over v1.14", async () => {
    const p = await prepare(fakeDb({ ...seed(true), agreement_templates: [{ id: "t1", name: "Saved", body: "SAVED {{driver_name}}", version: 3, is_active: true }] }) as any, APP.id);
    expect(p.tpl.meta.id).toBe("t1");
  });

  it("FLEET's send check has no blockers, and the sent agreement gets a number", async () => {
    const db = fakeDb(seed(true));
    expect((await agreementSendCheck(db as any, APP.id)).blockers).toEqual([]);
    const sent = await issueAgreement(db as any, APP.id, { createdBy: null, prep: fleetAgreementPrep({ enabled: true, amount: 50 }, null) });
    const row = db.state.agreements.find((a: any) => a.id === sent.id);
    expect(row.body).not.toContain("Assigned When Sent");
    expect(row.merge_data.agreement_number).toMatch(/^RRA-\d{8}-[0-9A-F]{6}$/);
    expect(row.body).toContain(row.merge_data.agreement_number);
    expect(row.metadata.template_key).toBe("insurance_included_v117");
    expect(signedReservationFee(row)).toBe(50);
    if (process.env.V114_SAMPLE_DIR) writeFileSync(`${process.env.V114_SAMPLE_DIR}/v114-sample-sent.txt`, row.body);
  });

  it("dry run end to end: sign -> Stripe link -> FLEET cannot book -> fee paid -> FLEET books, car held", async () => {
    const db = fakeDb({ ...seed(true), applications: [{ ...APP, user_id: "33333333-3333-4333-8333-333333333333" }], vehicles: [{ ...CAR, status: "available" }] });
    const sent = await issueAgreement(db as any, APP.id, { createdBy: null, prep: fleetAgreementPrep({ enabled: true, amount: 50 }, null) });
    const ag = db.state.agreements.find((a: any) => a.id === sent.id);
    ag.status = "signed";
    const sessions: any[] = [];
    const stripe = { checkout: { sessions: { create: async (a: any) => (sessions.push(a), { id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1" }) } }, customers: { list: async () => ({ data: [] }), create: async () => ({ id: "cus_test" }) } };
    const out = await chargeReservationFeeAfterSigning(db as any, sent.id, { settings: { enabled: true, amount: 50 }, stripe, audit: async () => {} } as any);
    expect(out.status).toBe("checkout");
    expect((out as any).url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    expect(sessions[0]).toMatchObject({ mode: "payment", payment_intent_data: { setup_future_usage: "off_session" }, line_items: [{ price_data: { unit_amount: 5000 } }] });
    const book = () => createReservationCore(db as any, { applicationId: APP.id, vehicleId: CAR.id, pickupDate: "2026-11-20", pickupTime: "10:00", pickupLocation: "3500 E Hillsborough Ave, Tampa, FL", requireReservationFee: true });
    await expect(book()).rejects.toThrow(/Reservation Fee Is Not Paid Yet/);
    const fee = db.state.payments.find((p: any) => p.reason === "reservation_fee");
    fee.status = "paid"; // what the payments webhook does once Stripe confirms
    const res = await book();
    const rental = db.state.rentals.find((r: any) => r.id === res.id);
    expect(rental).toMatchObject({ status: "reserved", reservation_deposit_status: "applied", reservation_deposit_amount: 50, deposit_amount: 0 });
  });

  it("staff dialog: v1.14 shows Owner Approved and the fee switch preselects Required", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../src/components/admin/PrepareAgreementDialog.tsx", import.meta.url), "utf8");
    expect(src).toContain("OWNER_APPROVED_LIBRARY[t.key]");
    expect(src).toMatch(/fee\?\.enabled && fee\.amount > 0/);
    const lib = await import("../src/lib/agreement-library");
    expect(lib.DEFAULT_LIBRARY_KEY).toBe("insurance_included_v117");
    expect(Object.keys(lib.OWNER_APPROVED_LIBRARY)).toEqual(["insurance_included", "insurance_included_v115", "insurance_included_v116", "insurance_included_v117"]);
  });
});
