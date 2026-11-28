/**
 * Add Driver requests: same-address guard, form check, status order, payment
 * metadata, webhook settle, staff-only steps and renter copy rules.
 * Run: bun test scripts/add-driver-requests.test.ts
 * Pure and in-memory. Never reads production env or calls Stripe.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  ADD_DRIVER_APPLY_LABEL,
  ADD_DRIVER_CONSENT_LABEL,
  ADD_DRIVER_DIFFERENT_ADDRESS,
  ADD_DRIVER_INFO_POINTS,
  ADD_DRIVER_RENTER_STATUS_LINE,
  ADD_DRIVER_STATUS_LABEL,
  ADD_DRIVER_STATUSES,
  ADD_DRIVER_SWITCH_KEY,
  ADD_DRIVER_TRANSITIONS,
  ADD_DRIVER_CARD_INTRO,
  ADD_DRIVER_NO_ADDRESS,
  ADD_DRIVER_NO_RENTAL,
  ADD_DRIVER_SENT,
  APPLY_OWN_CAR_URL,
  addDriverFormError,
  canMoveAddDriver,
  compareHouseholdAddress,
  emptyAddDriverForm,
  householdAddressKey,
  ownAddDriverPath,
  renterView,
  type AddDriverForm,
} from "../src/lib/add-driver-requests";
import {
  approveAddDriverRequest,
  createRenterUploadUrl,
  denyAddDriverRequest,
  renterAddDriverState,
  settleAddDriverPayment,
  startAddDriverCheckout,
  startAddDriverInsurance,
  submitAddDriverRequest,
} from "../src/lib/add-driver-requests.server";
import { AUTOMATIONS, isAutomationOn, readAutomationControls } from "../src/lib/automation-catalog";

// ---- In-memory stand-in for the Supabase admin client ---------------------------

type Row = Record<string, any>;
function fakeAdmin(seed: Record<string, Row[]>) {
  const db: Record<string, Row[]> = Object.fromEntries(Object.entries(seed).map(([k, v]) => [k, v.map((r) => ({ ...r }))]));
  const uploads: string[] = [];
  let n = 0;
  const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
  function query(table: string) {
    db[table] ??= [];
    const filters: ((r: Row) => boolean)[] = [];
    let op: "select" | "insert" | "update" = "select";
    let payload: any = null;
    let limit = Infinity;
    let order: { col: string; asc: boolean } | null = null;
    const api: any = {
      select: () => api,
      insert: (p: any) => { op = "insert"; payload = p; return api; },
      update: (p: any) => { op = "update"; payload = p; return api; },
      eq: (c: string, v: any) => { filters.push((r) => String(r[c]) === String(v)); return api; },
      neq: (c: string, v: any) => { filters.push((r) => String(r[c]) !== String(v)); return api; },
      in: (c: string, vs: any[]) => { filters.push((r) => vs.map(String).includes(String(r[c]))); return api; },
      is: (c: string, v: any) => { filters.push((r) => (r[c] ?? null) === v); return api; },
      order: (col: string, o?: { ascending?: boolean }) => { order = { col, asc: o?.ascending !== false }; return api; },
      limit: (k: number) => { limit = k; return api; },
      run() {
        if (op === "insert") {
          const row = { id: id(), created_at: new Date().toISOString(), ...payload };
          db[table].push(row);
          return { data: [row], error: null };
        }
        let rows = db[table].filter((r) => filters.every((f) => f(r)));
        if (op === "update") {
          rows.forEach((r) => Object.assign(r, payload));
          return { data: rows.map((r) => ({ ...r })), error: null };
        }
        if (order) rows = [...rows].sort((a, b) => (String(a[order!.col]) < String(b[order!.col]) ? -1 : 1) * (order!.asc ? 1 : -1));
        return { data: rows.slice(0, limit).map((r) => ({ ...r })), error: null };
      },
      maybeSingle: async () => { const r = api.run(); return { data: r.data[0] ?? null, error: null }; },
      single: async () => { const r = api.run(); return r.data[0] ? { data: r.data[0], error: null } : { data: null, error: { message: "no row" } }; },
      then: (res: any, rej: any) => Promise.resolve(api.run()).then(res, rej),
    };
    return api;
  }
  return {
    db,
    uploads,
    from: query,
    storage: {
      from: () => ({
        createSignedUploadUrl: async (path: string) => { uploads.push(path); return { data: { path, token: "tok" }, error: null }; },
        createSignedUrl: async (path: string) => ({ data: { signedUrl: `https://files.test/${path}` }, error: null }),
      }),
    },
  };
}

const USER = "aaaaaaaa-0000-4000-8000-000000000001";
const OTHER_USER = "aaaaaaaa-0000-4000-8000-000000000002";
const APP = "bbbbbbbb-0000-4000-8000-000000000001";
const OTHER_APP = "bbbbbbbb-0000-4000-8000-000000000002";
const RENTAL = "cccccccc-0000-4000-8000-000000000001";
const VEH = "dddddddd-0000-4000-8000-000000000001";
const NOW = Date.parse("2026-11-28T17:00:00Z");

function seed() {
  return fakeAdmin({
    applications: [
      { id: APP, user_id: USER, full_name: "Pat Renter", email: "pat@example.com", phone: "5555550100", address: "100 Main Street Apt 4", city: "Tampa", state: "Florida", zip: "33602", stripe_customer_id: "cus_test", created_at: "2026-11-01" },
      { id: OTHER_APP, user_id: OTHER_USER, full_name: "Other Renter", email: "o@example.com", phone: "5555550101", address: "9 Elm St", city: "Tampa", state: "FL", zip: "33603", created_at: "2026-11-01" },
    ],
    rentals: [{ id: RENTAL, application_id: APP, vehicle_id: VEH, status: "active", start_date: "2026-11-02", created_at: "2026-11-02" }],
    vehicles: [{ id: VEH, license_plate: "ABC 123" }],
    payments: [],
    additional_driver_requests: [],
  });
}

const on = { gate: async () => "send" as const, now: () => NOW, audit: async () => {} };
const off = { ...on, gate: async () => "off" as const };

function goodForm(patch: Partial<AddDriverForm> = {}): AddDriverForm {
  return {
    ...emptyAddDriverForm({ line1: "100 Main St", line2: "#4", city: "tampa", state: "FL", zip: "33602-1234" }),
    fullName: "Sam Driver",
    dob: "1990-05-01",
    phone: "555-555-0199",
    email: "sam@example.com",
    relationship: "Spouse",
    licenseNumber: "D123-456-789",
    licenseState: "FL",
    licenseExpiration: "2029-01-01",
    yearsLicensed: "10",
    licenseFrontPath: `${APP}/additional-driver/license_front-1.jpg`,
    licenseBackPath: `${APP}/additional-driver/license_back-1.jpg`,
    consent: true,
    ...patch,
  };
}

// ---- Same-address guard ------------------------------------------------------------

describe("same address guard", () => {
  test("normalizes street words, unit markers, state names and ZIP+4", () => {
    const a = { line1: "100 Main Street Apt 4", city: "Tampa", state: "Florida", zip: "33602" };
    const b = { line1: "100 main st", line2: "#4", city: "TAMPA", state: "fl", zip: "33602-1234" };
    expect(householdAddressKey(a)).toBe(householdAddressKey(b));
    expect(compareHouseholdAddress(a, b)).toBe("same");
    expect(compareHouseholdAddress(a, { ...b, line1: "100 N Main St" })).toBe("different");
    expect(compareHouseholdAddress(a, { ...b, line2: "#5" })).toBe("different");
    expect(compareHouseholdAddress(a, { ...b, zip: "33603" })).toBe("different");
  });
  test("missing main address or an incomplete driver address never passes", () => {
    expect(compareHouseholdAddress(null, { line1: "1 A St", city: "Tampa", state: "FL", zip: "33602" })).toBe("no_main_address");
    expect(compareHouseholdAddress({ line1: "1 A St", city: "Tampa", state: "FL", zip: "33602" }, { line1: "1 A St", city: "", state: "FL", zip: "33602" })).toBe("incomplete");
  });
  test("server refuses a different address with the apply-for-own-car message", async () => {
    const admin = seed();
    await expect(submitAddDriverRequest(admin, USER, goodForm({ addressLine1: "200 Oak Ave", addressLine2: "" }), on)).rejects.toThrow(ADD_DRIVER_DIFFERENT_ADDRESS);
    expect(admin.db.additional_driver_requests.length).toBe(0);
  });
  test("server refuses when no main address is on file", async () => {
    const admin = seed();
    admin.db.applications[0].address = null;
    await expect(submitAddDriverRequest(admin, USER, goodForm(), on)).rejects.toThrow(ADD_DRIVER_NO_ADDRESS);
  });
});

describe("form check", () => {
  const today = "2026-11-28";
  test("a complete form passes", () => expect(addDriverFormError(goodForm(), today)).toBeNull());
  test("under 23, expired license, missing uploads and consent are refused", () => {
    expect(addDriverFormError(goodForm({ dob: "2004-01-01" }), today)).toMatch(/at least 23/);
    expect(addDriverFormError(goodForm({ licenseExpiration: "2026-11-01" }), today)).toMatch(/expired/);
    expect(addDriverFormError(goodForm({ licenseFrontPath: null }), today)).toMatch(/front/);
    expect(addDriverFormError(goodForm({ licenseBackPath: null }), today)).toMatch(/back/);
    expect(addDriverFormError(goodForm({ consent: false }), today)).toMatch(/agrees/);
    expect(addDriverFormError(goodForm({ fullName: "Sam" }), today)).toMatch(/full name/);
  });
  test("uploads must sit in the renter's own Add Driver folder", () => {
    expect(ownAddDriverPath(APP, `${APP}/additional-driver/license_front-1.jpg`)).toBe(true);
    expect(ownAddDriverPath(APP, `${OTHER_APP}/additional-driver/license_front-1.jpg`)).toBe(false);
    expect(ownAddDriverPath(APP, `${APP}/license_front-1.jpg`)).toBe(false);
    expect(ownAddDriverPath(APP, `${APP}/additional-driver/../x.jpg`)).toBe(false);
  });
  test("server refuses another renter's upload path", async () => {
    const admin = seed();
    await expect(submitAddDriverRequest(admin, USER, goodForm({ licenseFrontPath: `${OTHER_APP}/additional-driver/license_front-1.jpg` }), on)).rejects.toThrow(/Upload the license again/);
  });
});

// ---- Switch -------------------------------------------------------------------------

describe("feature switch", () => {
  test("renter_add_driver is catalogued, Off by default and sends nothing", () => {
    const def = AUTOMATIONS.find((a) => a.key === ADD_DRIVER_SWITCH_KEY)!;
    expect(def).toBeTruthy();
    expect(def.defaultOn).toBe(false);
    expect(def.channels).toEqual([]);
    expect(def.emailWorkflows).toEqual([]);
    expect(isAutomationOn(readAutomationControls({ off: {} })!, ADD_DRIVER_SWITCH_KEY)).toBe(false);
    expect(isAutomationOn(readAutomationControls({ off: {}, on: { renter_add_driver: { at: "x", by: "y" } } })!, ADD_DRIVER_SWITCH_KEY)).toBe(true);
  });
  test("Off hides the button and refuses upload, submit and pay", async () => {
    const admin = seed();
    const state = await renterAddDriverState(admin, USER, off);
    expect(state.enabled).toBe(false);
    expect(state.canRequest).toBe(false);
    await expect(createRenterUploadUrl(admin, USER, { kind: "license_front", fileName: "a.jpg", mimeType: "image/jpeg", sizeBytes: 10 }, off)).rejects.toThrow(/isn't available/);
    await expect(submitAddDriverRequest(admin, USER, goodForm(), off)).rejects.toThrow(/isn't available/);
    await expect(startAddDriverCheckout(admin, USER, "00000000-0000-4000-8000-000000000099", off)).rejects.toThrow(/isn't available/);
  });
  test("no active rental: no request", async () => {
    const admin = seed();
    admin.db.rentals[0].status = "closed";
    const state = await renterAddDriverState(admin, USER, on);
    expect(state.canRequest).toBe(false);
    expect(state.blocked).toBe(ADD_DRIVER_NO_RENTAL);
  });
});

// ---- Request, pay, settle -----------------------------------------------------------

describe("request and payment", () => {
  test("upload URL is in the renter's own folder in driver-docs", async () => {
    const admin = seed();
    const up = await createRenterUploadUrl(admin, USER, { kind: "license_front", fileName: "front.jpg", mimeType: "image/jpeg", sizeBytes: 1000 }, { ...on, uuid: () => "u1" });
    expect(up.bucket).toBe("driver-docs");
    expect(up.path).toBe(`${APP}/additional-driver/license_front-u1.jpg`);
    await expect(createRenterUploadUrl(admin, USER, { kind: "license_front", fileName: "x.exe", mimeType: "application/x-msdownload", sizeBytes: 10 }, on)).rejects.toThrow(/photo or a PDF/);
  });

  test("submit → Requested, then Checkout carries every required metadata field", async () => {
    const admin = seed();
    const req = await submitAddDriverRequest(admin, USER, goodForm(), on);
    expect(req.status).toBe("requested");
    expect(req.canPay).toBe(true);
    const row = admin.db.additional_driver_requests[0];
    expect(row.application_id).toBe(APP);
    expect(row.rental_id).toBe(RENTAL);
    expect(row.state).toBe("FL");

    let created: any = null;
    let opts: any = null;
    const stripe = { checkout: { sessions: { create: async (p: any, o: any) => { created = p; opts = o; return { id: "cs_test_1", url: "https://checkout.stripe.test/cs_test_1" }; } } } };
    const res = await startAddDriverCheckout(admin, USER, req.id, { ...on, stripe });
    expect(res).toEqual({ status: "checkout", url: "https://checkout.stripe.test/cs_test_1", reused: false });

    const pay = admin.db.payments[0];
    expect(pay).toMatchObject({ driver_id: APP, type: "fee", reason: "add_driver", amount: 100, status: "unpaid", notes: `add_driver:${req.id}` });
    // Owed, it stays off the rental balance (no rental_id), so Pay Now and reminders never see it.
    expect(pay.rental_id ?? null).toBeNull();
    for (const slot of [created.metadata, created.payment_intent_data.metadata]) {
      expect(slot).toMatchObject({ rental_id: RENTAL, lead_id: APP, reason: "add_driver", for_date: "2026-11-28", renter: "Pat Renter", plate: "ABC123", paymentIds: pay.id, add_driver_request_id: req.id });
    }
    expect(created.mode).toBe("payment");
    expect(created.line_items[0].price_data.unit_amount).toBe(10000);
    expect(opts.idempotencyKey).toBe(`add-driver-checkout:${pay.id}:attempt:1`);
    expect(created.success_url).toBe("https://drivereal.com/portal?add_driver=paid");

    // A second tap reuses the open Checkout and writes no second row.
    const again = await startAddDriverCheckout(admin, USER, req.id, { ...on, stripe });
    expect(again).toMatchObject({ status: "checkout", reused: true });
    expect(admin.db.payments.length).toBe(1);
  });

  test("another renter can't pay or see someone else's request", async () => {
    const admin = seed();
    const req = await submitAddDriverRequest(admin, USER, goodForm(), on);
    admin.db.rentals.push({ id: "cccccccc-0000-4000-8000-000000000002", application_id: OTHER_APP, vehicle_id: VEH, status: "active", created_at: "2026-11-02" });
    await expect(startAddDriverCheckout(admin, OTHER_USER, req.id, { ...on, stripe: {} })).rejects.toThrow(/not found/);
    const theirs = await renterAddDriverState(admin, OTHER_USER, on);
    expect(theirs.requests).toEqual([]);
    const mine = await renterAddDriverState(admin, USER, on);
    expect(mine.requests.map((r) => r.id)).toEqual([req.id]);
  });

  test("webhook settle moves Requested → Paid once and files the money on the rental", async () => {
    const admin = seed();
    const req = await submitAddDriverRequest(admin, USER, goodForm(), on);
    const stripe = { checkout: { sessions: { create: async () => ({ id: "cs_1", url: "https://checkout.stripe.test/cs_1" }) } } };
    await startAddDriverCheckout(admin, USER, req.id, { ...on, stripe });
    const pay = admin.db.payments[0];
    const pi = { metadata: { reason: "add_driver", add_driver_request_id: req.id, paymentIds: pay.id } };
    // Row not paid yet: nothing moves.
    expect(await settleAddDriverPayment(admin, pi, on)).toBe("skipped");
    pay.status = "paid";
    expect(await settleAddDriverPayment(admin, pi, on)).toBe("settled");
    expect(admin.db.additional_driver_requests[0].status).toBe("paid");
    expect(pay.rental_id).toBe(RENTAL);
    expect(await settleAddDriverPayment(admin, pi, on)).toBe("skipped");
    // Other intents are ignored.
    expect(await settleAddDriverPayment(admin, { metadata: { reason: "reservation_fee" } }, on)).toBe("skipped");
  });

  test("a missed webhook is caught up on the next read", async () => {
    const admin = seed();
    const req = await submitAddDriverRequest(admin, USER, goodForm(), on);
    await startAddDriverCheckout(admin, USER, req.id, { ...on, stripe: { checkout: { sessions: { create: async () => ({ id: "cs_1", url: "https://checkout.stripe.test/cs_1" }) } } } });
    admin.db.payments[0].status = "paid";
    const state = await renterAddDriverState(admin, USER, on);
    expect(state.requests[0].status).toBe("paid");
    expect(state.requests[0].canPay).toBe(false);
  });

  test("duplicate open request for the same license is refused", async () => {
    const admin = seed();
    await submitAddDriverRequest(admin, USER, goodForm(), on);
    await expect(submitAddDriverRequest(admin, USER, goodForm({ licenseNumber: "d123456789" }), on)).rejects.toThrow(/already have a request/);
  });
});

// ---- Staff steps --------------------------------------------------------------------

describe("status order and staff steps", () => {
  test("transition table matches the guard trigger in the migration", () => {
    const sql = readFileSync(new URL("../supabase/migrations/20261128170000_add_driver_requests.sql", import.meta.url), "utf8");
    expect(sql).toContain("(OLD.status = 'requested' AND NEW.status IN ('paid', 'denied'))");
    expect(sql).toContain("(OLD.status = 'paid' AND NEW.status IN ('insurance_pending', 'denied'))");
    expect(sql).toContain("(OLD.status = 'insurance_pending' AND NEW.status IN ('approved', 'denied'))");
    expect(ADD_DRIVER_TRANSITIONS.approved).toEqual([]);
    expect(ADD_DRIVER_TRANSITIONS.denied).toEqual([]);
    expect(canMoveAddDriver("requested", "approved")).toBe(false);
    expect(canMoveAddDriver("requested", "insurance_pending")).toBe(false);
    expect(canMoveAddDriver("paid", "approved")).toBe(false);
  });

  test("staff steps: Paid → Insurance Pending → Approved with the card, then the renter sees the card", async () => {
    const admin = seed();
    const actor = { userId: "eeeeeeee-0000-4000-8000-000000000001", email: "staff@example.com" };
    const req = await submitAddDriverRequest(admin, USER, goodForm(), on);
    await expect(startAddDriverInsurance(admin, actor, req.id, on)).rejects.toThrow(/can't move/);
    await startAddDriverCheckout(admin, USER, req.id, { ...on, stripe: { checkout: { sessions: { create: async () => ({ id: "cs_1", url: "https://checkout.stripe.test/cs_1" }) } } } });
    admin.db.payments[0].status = "paid";
    await settleAddDriverPayment(admin, { metadata: { reason: "add_driver", add_driver_request_id: req.id, paymentIds: admin.db.payments[0].id } }, on);
    await expect(approveAddDriverRequest(admin, actor, req.id, { insuranceCardPath: `${APP}/additional-driver/insurance_card-1.pdf` }, on)).rejects.toThrow(/can't move/);
    await startAddDriverInsurance(admin, actor, req.id, on);
    const row = admin.db.additional_driver_requests[0];
    expect(row.status).toBe("insurance_pending");
    expect(row.insurance_started_by).toBe(actor.userId);
    // No card, or a card outside this renter's folder: refused.
    await expect(approveAddDriverRequest(admin, actor, req.id, { insuranceCardPath: `${APP}/additional-driver/license_front-1.jpg` }, on)).rejects.toThrow(/insurance card/);
    await expect(approveAddDriverRequest(admin, actor, req.id, { insuranceCardPath: `${OTHER_APP}/additional-driver/insurance_card-1.pdf` }, on)).rejects.toThrow(/insurance card/);
    await approveAddDriverRequest(admin, actor, req.id, { insuranceCardPath: `${APP}/additional-driver/insurance_card-1.pdf`, notes: "Added" }, on);
    expect(row).toMatchObject({ status: "approved", decided_by: actor.userId, insurance_card_path: `${APP}/additional-driver/insurance_card-1.pdf` });
    const state = await renterAddDriverState(admin, USER, off);
    expect(state.requests[0]).toMatchObject({ status: "approved", statusLabel: "Approved" });
    expect(state.requests[0].insuranceCardUrl).toContain("insurance_card-1.pdf");
    // Approved is final.
    await expect(denyAddDriverRequest(admin, actor, req.id, { notes: "x" }, on)).rejects.toThrow(/can't move/);
  });

  test("Deny needs a note; an unpaid $100 is voided, never refunded automatically", async () => {
    const admin = seed();
    const actor = { userId: "eeeeeeee-0000-4000-8000-000000000001" };
    const req = await submitAddDriverRequest(admin, USER, goodForm(), on);
    await startAddDriverCheckout(admin, USER, req.id, { ...on, stripe: { checkout: { sessions: { create: async () => ({ id: "cs_1", url: "https://checkout.stripe.test/cs_1" }), expire: async () => ({}) } } } });
    await expect(denyAddDriverRequest(admin, actor, req.id, { notes: "  " }, on)).rejects.toThrow(/note/);
    await denyAddDriverRequest(admin, actor, req.id, { notes: "Different household" }, { ...on, stripe: { checkout: { sessions: { expire: async () => ({}) } } } });
    expect(admin.db.additional_driver_requests[0].status).toBe("denied");
    expect(admin.db.payments[0].status).toBe("void");
    const view = (await renterAddDriverState(admin, USER, on)).requests[0];
    expect(view.statusLabel).toBe("Denied");
    expect(JSON.stringify(view)).not.toContain("Different household");
  });

  test("staff functions require Manager; renter functions refuse staff preview writes", () => {
    const src = readFileSync(new URL("../src/lib/add-driver-requests.functions.ts", import.meta.url), "utf8");
    for (const fn of ["listAddDriverRequests", "getAddDriverFileUrl", "startAddDriverInsuranceStep", "createAddDriverCardUploadUrl", "approveAddDriver", "denyAddDriver"]) {
      const body = src.slice(src.indexOf(`export const ${fn}`), src.indexOf("});", src.indexOf(`export const ${fn}`)));
      expect(body).toContain("managerActor(context.userId)");
    }
    for (const fn of ["createAddDriverUploadUrl", "submitAddDriver", "payAddDriver"]) {
      const body = src.slice(src.indexOf(`export const ${fn}`), src.indexOf("});", src.indexOf(`export const ${fn}`)));
      expect(body).toContain("renterWriter(context.userId)");
    }
    expect(src).toContain("requireManager");
    expect(src).toContain("refuseStaffPortalWrite");
  });
});

// ---- Webhook wiring -------------------------------------------------------------------

describe("payments webhook", () => {
  const src = readFileSync(new URL("../src/routes/api/public/payments/webhook.ts", import.meta.url), "utf8");
  test("settles the request after the row is paid, and a declined try is not a failed rent payment", () => {
    expect(src).toContain("settleAddDriverPayment(getSupabase(), event.data.object)");
    expect(src).toContain("if (status === 'failed' && pi?.metadata?.reason === 'add_driver') return;");
  });
  test("adds no renter email: no receipt and no portal welcome for the $100", () => {
    expect(src).toContain("const driver = reason === 'add_driver' ? null :");
    expect(src).toContain("if (event.data.object?.metadata?.reason !== 'add_driver') await welcomeAfterPaid({");
  });
});

// ---- Renter copy rules ------------------------------------------------------------------

describe("renter copy", () => {
  const copy = [
    ...ADD_DRIVER_INFO_POINTS.flatMap((p) => [p.title, p.text]),
    ...Object.values(ADD_DRIVER_RENTER_STATUS_LINE),
    ...Object.values(ADD_DRIVER_STATUS_LABEL),
    ADD_DRIVER_DIFFERENT_ADDRESS, ADD_DRIVER_APPLY_LABEL, ADD_DRIVER_CONSENT_LABEL, ADD_DRIVER_CARD_INTRO, ADD_DRIVER_NO_ADDRESS, ADD_DRIVER_NO_RENTAL, ADD_DRIVER_SENT,
  ];
  const card = readFileSync(new URL("../src/components/portal/AddDriverCard.tsx", import.meta.url), "utf8");
  test("says $100, the policy, the driving record and same address", () => {
    const all = copy.join(" ");
    expect(all).toContain("$100");
    expect(all).toMatch(/insurance policy/);
    expect(all).toMatch(/driving record/);
    expect(all).toMatch(/same address/);
    expect(ADD_DRIVER_DIFFERENT_ADDRESS).toMatch(/apply for their own car/);
    expect(APPLY_OWN_CAR_URL).toBe("/apply");
  });
  test("no em dashes, no 'deposit', no insurer, broker or rep names", () => {
    for (const text of [...copy, card]) {
      expect(text).not.toContain("\u2014");
      expect(text.toLowerCase()).not.toMatch(/\bdeposit\b/);
      expect(text).not.toMatch(/progressive|geico|state farm|allstate|broker|\brep\b|lemonade|hippo|nationwide/i);
    }
  });
  test("status labels are Title Case and 1 or 2 words", () => {
    for (const s of ADD_DRIVER_STATUSES) {
      const label = ADD_DRIVER_STATUS_LABEL[s];
      expect(label.split(" ").length).toBeLessThanOrEqual(2);
      for (const w of label.split(" ")) expect(w[0]).toBe(w[0].toUpperCase());
    }
  });
  test("renter view hides staff notes and only shows the card when approved", () => {
    const base = { id: "r1", applicationId: APP, rentalId: RENTAL, fullName: "Sam Driver", dob: "1990-01-01", phone: "", email: "", relationship: "Spouse", address: {}, licenseNumber: "", licenseState: "", licenseExpiration: "", yearsLicensed: null, feeCents: 10000, paymentId: null, paidAt: null, insuranceStartedAt: null, decidedAt: null, decisionNotes: "secret", hasInsuranceCard: true, refundNote: "r", createdAt: "2026-11-28" };
    expect(renterView({ ...base, status: "insurance_pending" }, "https://x").insuranceCardUrl).toBeNull();
    expect(renterView({ ...base, status: "approved" }, "https://x").insuranceCardUrl).toBe("https://x");
    expect(JSON.stringify(renterView({ ...base, status: "denied" }, null))).not.toContain("secret");
  });
  test("no renter phone numbers in the new code", () => {
    for (const f of ["../src/lib/add-driver-requests.ts", "../src/lib/add-driver-requests.server.ts", "../src/components/portal/AddDriverCard.tsx", "../src/components/admin/AddDriverRequests.tsx"]) {
      const text = readFileSync(new URL(f, import.meta.url), "utf8");
      expect(text).not.toMatch(/\(?\b\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b/);
    }
  });
});
