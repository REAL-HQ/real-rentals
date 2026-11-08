// Pay Now guards, by behavior: the real decision logic (payRentalBalanceCore)
// against a fake renter session that enforces row visibility, a fake balance
// that tracks claimed rows, and a fake Stripe collector. No network.
// (Database-level concurrency is in scripts/pay-now-concurrency.db.test.mjs.)
import { describe, expect, test } from "bun:test";
import { payRentalBalanceCore, type PayDeps } from "../src/lib/pay-rental-balance.server";

const RENTAL = "r1", DRIVER = "u-driver", OTHER = "u-other", STAFF = "u-staff";
function world(opts: { owed?: number[]; card?: boolean } = {}) {
  const rows = (opts.owed ?? [32500]).map((c, i) => ({ id: "p" + i, cents: c, status: "failed" }));
  const charges: any[] = [];
  const rental = { id: RENTAL, driver_id: DRIVER, application_id: "a1", stripe_customer_id: opts.card === false ? null : "cus_1", stripe_payment_method_id: opts.card === false ? null : "pm_1" };
  // Staff can read every rental (RLS), so the session returns it for staff and other renters too.
  const userDb = { from: () => { const b: any = { select: () => b, eq: () => b, maybeSingle: async () => ({ data: { ...rental } }) }; return b; } };
  const deps: PayDeps = {
    refuseStaff: async (uid) => { if (uid === STAFF) throw new Error("Staff can't pay from the renter portal"); },
    userDb, admin: {},
    rentalBalance: async () => {
      const owed = rows.filter((r) => r.status === "failed");
      return { processing: rows.some((r) => r.status === "pending"), rows: owed, cents: owed.reduce((s, r) => s + r.cents, 0) };
    },
    collectRows: async (_a, _s, claim) => {
      if (rows.some((r) => r.status === "pending")) return { error: "already processing" };
      claim.forEach((c: any) => (rows.find((r) => r.id === c.id)!.status = "pending"));
      charges.push(claim.map((c: any) => c.id));
      return { paymentIntentId: "pi_" + charges.length };
    },
    stripe: () => ({}),
    errorMessage: (e: any) => e?.message ?? "error",
  };
  return { deps, rows, charges };
}
const pay = (w: any, uid = DRIVER, cents = 32500) => payRentalBalanceCore({ rentalId: RENTAL, amountCents: cents }, uid, w.deps);

describe("payRentalBalance guards", () => {
  test("the renter pays their exact balance: one charge covering the owed rows", async () => {
    const w = world({ owed: [20000, 12500] });
    expect(await pay(w)).toEqual({ ok: true, paymentIntentId: "pi_1" });
    expect(w.charges).toEqual([["p0", "p1"]]);
  });
  test("another renter is refused even though the rental is readable", async () => {
    const w = world();
    expect(await pay(w, OTHER)).toEqual({ error: "Rental not found" });
    expect(w.charges).toHaveLength(0);
  });
  test("staff are refused before any lookup", async () => {
    const w = world();
    await expect(pay(w, STAFF)).rejects.toThrow(/Staff/);
    expect(w.charges).toHaveLength(0);
  });
  test("amount that no longer matches the balance is refused", async () => {
    const w = world();
    expect(await pay(w, DRIVER, 30000)).toEqual({ error: "Your balance changed. Refresh and try again." });
    expect(w.charges).toHaveLength(0);
  });
  test("nothing owed is refused", async () => {
    const w = world({ owed: [] });
    expect(await pay(w, DRIVER, 50)).toEqual({ error: "Nothing is owed on this rental." });
  });
  test("no card on file is refused", async () => {
    const w = world({ card: false });
    expect(await pay(w)).toEqual({ error: "No card on file" });
  });
  test("a second press (or a second tab from the email link) while processing charges nothing", async () => {
    const w = world();
    expect("ok" in (await pay(w))).toBe(true);
    const again = await pay(w);
    expect("error" in again && again.error).toMatch(/still being confirmed/);
    expect(w.charges).toHaveLength(1);
  });
  test("simultaneous presses: the collector's claim admits one", async () => {
    const w = world();
    const res = await Promise.all([pay(w), pay(w), pay(w)]);
    expect(res.filter((r) => "ok" in r)).toHaveLength(1);
    expect(w.charges).toHaveLength(1);
  });
  test("unknown Stripe outcome tells the renter not to pay again", async () => {
    const w = world();
    w.deps.collectRows = async () => ({ error: "x", outcome: "unconfirmed" });
    const r = await pay(w);
    expect("error" in r && r.error).toMatch(/don't pay again/);
  });
});

describe("pay intent survives email-link sign-in", async () => {
  const m = await import("../src/lib/portal-pay-link");
  const store = () => { const s = new Map<string, string>(); return { getItem: (k: string) => s.get(k) ?? null, setItem: (k: string, v: string) => void s.set(k, v), removeItem: (k: string) => void s.delete(k), _s: s }; };
  test("remembered intent opens Payments once, then is consumed", () => {
    const st = store();
    m.rememberPayIntent(st as any);
    expect(m.initialPortalTab("", "overview", st as any)).toBe("payments");
    expect(m.initialPortalTab("", "overview", st as any)).toBe("overview");
  });
  test("URL ?pay=balance opens Payments without storage", () => {
    expect(m.initialPortalTab("?pay=balance", "overview")).toBe("payments");
    expect(m.initialPortalTab("?pay=other", "overview")).toBe("overview");
  });
  test("an intent older than 2 hours is ignored", () => {
    const st = store();
    st.setItem(m.PAY_INTENT_KEY, String(Date.now() - 3 * 3600_000));
    expect(m.initialPortalTab("", "overview", st as any)).toBe("overview");
  });
  test("storage that throws (private mode) never breaks the portal", () => {
    const bad = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); }, removeItem: () => { throw new Error("x"); } };
    expect(() => m.rememberPayIntent(bad as any)).not.toThrow();
    expect(m.initialPortalTab("", "overview", bad as any)).toBe("overview");
  });
});
