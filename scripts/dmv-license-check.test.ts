// State DMV license check: rules, staff log, and the gates on approval, agreement
// send and Reservation Fee link. Fake DB only; nothing real is touched.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
process.env.SUPABASE_URL ??= "http://127.0.0.1:9";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "dummy";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "dummy";
globalThis.fetch = (async (url: any) => { throw new Error(`network refused in test: ${url}`); }) as any;
import { fakeDb } from "./fleet-fake-db";
import { DMV_CHECK_MAX_AGE_MS, dmvDisplay, dmvLogBlockers, evaluateDmvGate, type DmvCheck } from "@/lib/dmv-license-check";
const core = await import("@/lib/dmv-license-check.server");
const fee = await import("@/lib/reservation-fee.server");

const NOW = Date.parse("2026-11-20T15:00:00Z");
const A1 = "11111111-1111-4111-8111-111111111111";
const chk = (over: Partial<DmvCheck> = {}): DmvCheck => ({ id: "c1", status: "valid", licenseState: "FL", checkedAt: new Date(NOW - 3600e3).toISOString(), checkedByLabel: "rosa@drivereal.com", note: "FLHSMV: Valid", screenshotPath: null, ...over });

describe("rules", () => {
  test("valid and under 24 hours passes", () => {
    expect(evaluateDmvGate(chk(), "FL", NOW).ok).toBe(true);
    expect(evaluateDmvGate(chk({ checkedAt: new Date(NOW - DMV_CHECK_MAX_AGE_MS + 1000).toISOString() }), "FL", NOW).ok).toBe(true);
  });
  test("over 24 hours is stale", () => {
    const g = evaluateDmvGate(chk({ checkedAt: new Date(NOW - DMV_CHECK_MAX_AGE_MS - 1000).toISOString() }), "FL", NOW);
    expect(g.ok).toBe(false);
    expect(!g.ok && g.code).toBe("stale");
  });
  test("no check blocks", () => {
    const g = evaluateDmvGate(null, "FL", NOW);
    expect(!g.ok && g.code).toBe("no_check");
  });
  for (const s of ["suspended", "revoked", "cancelled", "expired", "not_found", "other"] as const) {
    test(`${s} is not valid`, () => {
      const g = evaluateDmvGate(chk({ status: s }), "FL", NOW);
      expect(!g.ok && g.code).toBe("not_valid");
    });
  }
  test("out-of-state license is Unverified until its own state's Valid check", () => {
    expect(dmvDisplay(null, "GA", NOW).label).toBe("Unverified");
    const g = evaluateDmvGate(chk({ licenseState: "FL" }), "GA", NOW);
    expect(!g.ok && g.code).toBe("state_mismatch");
    expect(dmvDisplay(chk({ licenseState: "FL" }), "GA", NOW).label).toBe("Unverified");
    expect(evaluateDmvGate(chk({ licenseState: "GA" }), "GA", NOW).ok).toBe(true);
  });
  test("a future-dated check is refused", () => {
    expect(evaluateDmvGate(chk({ checkedAt: new Date(NOW + 3600e3).toISOString() }), "FL", NOW).ok).toBe(false);
  });
  test("log needs a result, a two-letter state and a note", () => {
    expect(dmvLogBlockers({ status: "valid", licenseState: "FL", note: "ok" }).length).toBe(1);
    expect(dmvLogBlockers({ status: "", licenseState: "Florida", note: "" }).length).toBe(3);
    expect(dmvLogBlockers({ status: "valid", licenseState: "FL", note: "FLHSMV: Valid" })).toEqual([]);
  });
  test("copy: Title Case messages, never names a deposit", () => {
    const g = evaluateDmvGate(null, "FL", NOW);
    expect(!g.ok && g.message).toContain("State DMV License Check Needed");
    expect(readFileSync("src/lib/dmv-license-check.ts", "utf8").toLowerCase()).not.toContain("deposit");
  });
});

function seed(checks: any[] | undefined, licenseState = "FL") {
  return fakeDb({
    applications: [{ id: A1, full_name: "Ana Test", license_state: licenseState }],
    fleet_review_decisions: [],
    ...(checks ? { license_dmv_checks: checks } : {}),
  });
}
const row = (over: any = {}) => ({ id: "r1", application_id: A1, status: "valid", license_state: "FL", checked_at: new Date(NOW - 3600e3).toISOString(), checked_by_label: "rosa@drivereal.com", note: "FLHSMV: Valid", screenshot_path: null, ...over });

describe("server gate", () => {
  test("migration not installed: not enforced", async () => {
    const r = await core.checkDmvLicense(seed(undefined), A1, NOW);
    expect(r).toMatchObject({ installed: false, message: null });
  });
  test("installed, no check: refused. Valid fresh: allowed. Suspended: refused. Latest wins.", async () => {
    expect((await core.checkDmvLicense(seed([]), A1, NOW)).message).toContain("State DMV License Check Needed");
    expect((await core.checkDmvLicense(seed([row()]), A1, NOW)).message).toBeNull();
    expect((await core.checkDmvLicense(seed([row({ status: "suspended" })]), A1, NOW)).message).toContain("Suspended");
    const both = seed([row({ id: "old", checked_at: new Date(NOW - 7200e3).toISOString() }), row({ id: "new", status: "suspended" })]);
    expect((await core.checkDmvLicense(both, A1, NOW)).message).toContain("Suspended");
  });
  test("a read error fails closed", async () => {
    const db: any = seed([row()]);
    const orig = db.from;
    db.from = (t: string) => (t === "license_dmv_checks" ? { select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: null, error: { code: "XX000", message: "boom" } }) }) }) }) } : orig(t));
    expect(await core.dmvRefusal(db, A1, NOW)).toBe("Could Not Check The State DMV Record. Try Again.");
  });
});

describe("staff log", () => {
  const actor = { userId: "u1", email: "rosa@drivereal.com", tier: "coordinator" };
  test("valid check is recorded, audited, and not sent to Needs Staff; server sets the time", async () => {
    const db = seed([]);
    const audits: any[] = [];
    const out = await core.logDmvCheck(db, actor, { applicationId: A1, status: "valid", licenseState: "fl", note: "FLHSMV: Valid" }, async (_a, e) => { audits.push(e); }, () => new Date(NOW));
    expect(out.check).toMatchObject({ status: "valid", licenseState: "FL", checkedAt: new Date(NOW).toISOString(), checkedByLabel: "rosa@drivereal.com" });
    expect(out.routed).toBeNull();
    expect(db.state.fleet_review_decisions.length).toBe(0);
    expect(audits[0]).toMatchObject({ action: "application.dmv_license_checked", metadata: { flag_dolmar: false } });
  });
  test("suspended opens Needs Staff and flags Dolmar in the audit; a second one extends the same flag", async () => {
    const db = seed([]);
    const audits: any[] = [];
    const a = async (_x: any, e: any) => { audits.push(e); };
    const out = await core.logDmvCheck(db, actor, { applicationId: A1, status: "suspended", licenseState: "FL", note: "FLHSMV: suspended since Nov 9" }, a, () => new Date(NOW));
    expect(out.routed).toBe("opened");
    expect(db.state.fleet_review_decisions[0]).toMatchObject({ application_id: A1, decision: "needs_staff", escalation_codes: ["dmv_check_not_valid"] });
    expect(db.state.fleet_review_decisions[0].reason).toContain("state dmv check: Suspended (FL)");
    expect(audits[0].metadata.flag_dolmar).toBe(true);
    const again = await core.logDmvCheck(db, actor, { applicationId: A1, status: "revoked", licenseState: "FL", note: "FLHSMV: revoked now" }, a, () => new Date(NOW + 1000));
    expect(again.routed).toBe("extended");
    expect(db.state.fleet_review_decisions.length).toBe(1);
  });
  test("refuses a missing note and a state that is not two letters", async () => {
    const db = seed([]);
    await expect(core.logDmvCheck(db, actor, { applicationId: A1, status: "valid", licenseState: "FL", note: "" }, async () => {})).rejects.toThrow();
    await expect(core.logDmvCheck(db, actor, { applicationId: A1, status: "valid", licenseState: "Florida", note: "FLHSMV: Valid" }, async () => {})).rejects.toThrow();
    expect(db.state.license_dmv_checks.length).toBe(0);
  });
  test("table missing: clear message", async () => {
    await expect(core.logDmvCheck(seed(undefined), actor, { applicationId: A1, status: "valid", licenseState: "FL", note: "FLHSMV: Valid" }, async () => {})).rejects.toThrow("Not Enabled");
  });
});

describe("Reservation Fee link gate", () => {
  const PREP = JSON.stringify({ reservation: { mode: "required", amount: 50 } });
  function feeDb(checks: any[]) {
    return fakeDb({
      agreements: [{ id: "ag1", application_id: A1, status: "signed", body: "… Reservation Fee: $50 …", merge_data: { _prep: PREP }, metadata: {}, vehicle_id: "v1", signed_at: "2026-11-20T10:00:00Z" }],
      applications: [{ id: A1, full_name: "Ana Test", email: "a@example.com", stripe_customer_id: "cus_1", license_state: "FL" }],
      payments: [], rentals: [], audit_log: [], license_dmv_checks: checks,
    });
  }
  const mk = () => { const sessions: any[] = []; return { sessions, stripe: { checkout: { sessions: { create: async (a: any) => { sessions.push(a); return { id: "cs_1", url: "https://checkout.stripe.com/c/pay/cs_1" }; } } } } }; };
  test("no check, stale and suspended create no Checkout and no payment row", async () => {
    for (const checks of [[], [row({ checked_at: new Date(NOW - 25 * 3600e3).toISOString() })], [row({ status: "suspended" })]]) {
      const db: any = feeDb(checks); const m = mk();
      const out = await fee.chargeReservationFeeAfterSigning(db, "ag1", { settings: { enabled: true, amount: 50 } as any, stripe: m.stripe as any, audit: async () => {}, now: () => NOW });
      expect(out.status).toBe("dmv_check_required");
      expect(m.sessions.length).toBe(0);
      expect(db.state.payments.length).toBe(0);
      const link = await fee.reservationFeeLinkForApplication(db, A1, { settings: { enabled: true, amount: 50 } as any, stripe: m.stripe as any, audit: async () => {}, now: () => NOW });
      expect(link.ok).toBe(false);
    }
  });
  test("a valid check under 24 hours old lets the link through", async () => {
    const db: any = feeDb([row()]); const m = mk();
    const out = await fee.chargeReservationFeeAfterSigning(db, "ag1", { settings: { enabled: true, amount: 50 } as any, stripe: m.stripe as any, audit: async () => {}, now: () => NOW });
    expect(out.status).toBe("checkout");
    expect(m.sessions.length).toBe(1);
  });
});

describe("wiring (source)", () => {
  const src = (p: string) => readFileSync(p, "utf8");
  test("approval, agreement readiness and the fee link all run the DMV gate", () => {
    expect(src("src/lib/applications.functions.ts")).toContain("dmvRefusal(supabaseAdmin, data.id)");
    expect(src("src/lib/agreements.functions.ts")).toContain('field: "dmv_license_check"');
    expect(src("src/lib/reservation-fee.server.ts")).toContain('status: "dmv_check_required"');
  });
  test("no fallback payment link when the DMV check blocks the fee", () => {
    expect(src("src/lib/agreements.functions.ts")).toContain("if (!feeHandled && !dmvBlocked)");
  });
  test("migration is append-only for staff and has a unique timestamp", () => {
    const m = src("supabase/migrations/20261120161733_license_dmv_checks.sql");
    expect(m).toContain("FOR INSERT");
    expect(m).not.toMatch(/FOR (UPDATE|DELETE)/);
  });
});
