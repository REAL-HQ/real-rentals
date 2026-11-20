// After signing, send the applicant straight to the SAME $50 Reservation Fee
// Checkout the Agreement Signed email links to. Network refused; fake database
// and fake Stripe. No real session, charge or message.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
process.env.SUPABASE_URL ??= "http://127.0.0.1:9";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "dummy";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "dummy";
globalThis.fetch = (async (url: any) => { throw new Error(`network refused in test: ${url}`); }) as any;
const rf = await import("@/lib/reservation-fee");
const rfs = await import("@/lib/reservation-fee.server");
const { ReservationFeeNextStep } = await import("@/components/esign/ReservationFeeNextStep");

type Row = Record<string, any>;
let seq = 0;
function fakeDb(seed: Record<string, Row[]> = {}) {
  const state: Record<string, Row[]> = JSON.parse(JSON.stringify(seed));
  const writes: string[] = [];
  function from(table: string) {
    state[table] ??= [];
    let op = "select"; let payload: any = null; let single = false;
    const f: ((r: Row) => boolean)[] = [];
    const q: any = {
      select: () => q, insert: (r: Row) => { op = "insert"; payload = r; return q; }, update: (r: Row) => { op = "update"; payload = r; return q; },
      eq: (c: string, v: any) => { f.push((r) => r[c] === v); return q; }, is: (c: string, v: any) => { f.push((r) => (r[c] ?? null) === v); return q; },
      in: (c: string, v: any[]) => { f.push((r) => v.includes(r[c])); return q; },
      limit: () => q, order: () => q,
      maybeSingle: () => { single = true; return q; }, single: () => { single = true; return q; },
      then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
    };
    function run() {
      if (table === "license_dmv_checks" && !("license_dmv_checks" in seed)) return { data: null, error: { code: "42P01", message: `relation "license_dmv_checks" does not exist` } };
      const rows = state[table];
      if (op !== "select") writes.push(`${op}:${table}`);
      if (op === "insert") { const row = { id: `${table}-${++seq}`, attempt_count: 0, ...payload }; rows.push(row); return { data: single ? row : [row], error: null }; }
      const m = rows.filter((r) => f.every((x) => x(r)));
      if (op === "update") { for (const r of m) Object.assign(r, payload); return { data: m, error: null }; }
      return { data: single ? m[0] ?? null : m, error: null };
    }
    return q;
  }
  return { from, state, writes };
}
function stripe() {
  const sessions: any[] = []; const calls: any[] = [];
  return {
    sessions, calls,
    paymentIntents: { create: async (a: any) => { calls.push(a); return { id: "pi_1", status: "succeeded" }; } },
    checkout: { sessions: { create: async (a: any, o: any) => { sessions.push({ a, o }); return { id: `cs_${sessions.length}`, url: `https://checkout.stripe.com/c/pay/cs_${sessions.length}` }; } } },
  };
}
const ON = { enabled: true, amount: 50 };
const PREP = JSON.stringify({ reservation: { mode: "required", amount: 50 } });
const BODY = "… Reservation Fee: $50, applied to your first payment …";
const seed = (metadata: Row | null = null, payments: Row[] = []) => ({
  agreements: [{ id: "ag1", application_id: "app1", status: "signed", body: BODY, merge_data: { _prep: PREP }, vehicle_id: "v1", metadata }],
  applications: [{ id: "app1", full_name: "Test Renter", email: "t@example.com", stripe_customer_id: "cus_1" }],
  rentals: [] as Row[], payments,
});
const noAudit = { audit: async () => {} };
const NOW = Date.parse("2026-11-18T00:00:00Z");

describe("signing step from the fee outcome", () => {
  test("checkout → pay with the same https URL; paid/pending; everything else shows the plain screen", () => {
    expect(rf.reservationFeeSigningStep({ status: "checkout", amount: 50, paymentId: "p", url: "https://checkout.stripe.com/c/pay/cs_1" })).toEqual({ state: "pay", amount: 50, url: "https://checkout.stripe.com/c/pay/cs_1" });
    expect(rf.reservationFeeSigningStep({ status: "already_paid", amount: 50, paymentId: "p" })).toEqual({ state: "paid", amount: 50 });
    expect(rf.reservationFeeSigningStep({ status: "paid", amount: 50, paymentId: "p", last4: "4242" })).toEqual({ state: "paid", amount: 50 });
    expect(rf.reservationFeeSigningStep({ status: "pending", amount: 50, paymentId: "p", last4: null })).toEqual({ state: "processing", amount: 50 });
    for (const o of [{ status: "off" }, { status: "no_fee_on_agreement" }, { status: "not_found" }, { status: "no_card", amount: 50, paymentId: "p" }, { status: "failed", amount: 0, paymentId: null, error: "x" }] as const)
      expect(rf.reservationFeeSigningStep(o as any)).toBeNull();
    expect(rf.reservationFeeSigningStep(null)).toBeNull();
  });
  test("never hands the browser a non-https link", () => {
    for (const bad of ["http://checkout.stripe.com/x", "javascript:alert(1)", "", "/relative", null, 5])
      expect(rf.safeCheckoutUrl(bad as any)).toBeNull();
    expect(rf.reservationFeeSigningStep({ status: "checkout", amount: 50, paymentId: "p", url: "javascript:alert(1)" })).toBeNull();
  });
  test("return pages explain the result instead of /login", () => {
    expect(rf.reservationFeeReturnUrls("https://drivereal.com/")).toEqual({ success: "https://drivereal.com/reservation-fee?status=paid&session_id={CHECKOUT_SESSION_ID}", cancel: "https://drivereal.com/reservation-fee?status=canceled&session_id={CHECKOUT_SESSION_ID}" });
  });
});

describe("one Checkout per fee: the page reuses the email's session", () => {
  test("signing creates ONE session with the new return pages; the step carries that same URL", async () => {
    const db = fakeDb(seed()); const s = stripe();
    const o = await rfs.chargeReservationFeeAfterSigning(db, "ag1", { settings: ON, stripe: s, ...noAudit });
    expect(s.sessions).toHaveLength(1);
    expect(s.sessions[0].a.success_url).toMatch(/\/reservation-fee\?status=paid&session_id=\{CHECKOUT_SESSION_ID\}$/);
    expect(s.sessions[0].a.cancel_url).toMatch(/\/reservation-fee\?status=canceled&session_id=\{CHECKOUT_SESSION_ID\}$/);
    expect(s.sessions[0].a.payment_intent_data).toMatchObject({ setup_future_usage: "off_session", metadata: { reason: "reservation_fee", paymentIds: db.state.payments[0].id } });
    const step = rf.reservationFeeSigningStep(o);
    expect(step).toEqual({ state: "pay", amount: 50, url: "https://checkout.stripe.com/c/pay/cs_1" });
    expect(rf.reservationFeePayLink(o)?.url).toBe((step as any).url); // the email button is the same link
  });
  test("already signed (double tap / second tab): read-only lookup returns the open Checkout, never a new one", async () => {
    const db = fakeDb(seed()); const s = stripe();
    await rfs.chargeReservationFeeAfterSigning(db, "ag1", { settings: ON, stripe: s, ...noAudit });
    const before = db.writes.length;
    const step = await rfs.existingReservationFeeStep(db, "ag1");
    expect(step).toEqual({ state: "pay", amount: 50, url: "https://checkout.stripe.com/c/pay/cs_1" });
    expect(s.sessions).toHaveLength(1);
    expect(db.writes.length).toBe(before);
  });
  test("an expired (23h+) stored Checkout is not offered", async () => {
    const meta = { reservation_fee_checkout: { url: "https://checkout.stripe.com/c/pay/old", payment_id: "p1", created_at: "2026-11-16T00:00:00Z" } };
    const db = fakeDb(seed(meta, [{ id: "p1", driver_id: "app1", status: "unpaid", amount: 50, notes: "reservation_fee:ag1" }]));
    expect(await rfs.existingReservationFeeStep(db, "ag1", NOW)).toBeNull();
    const fresh = fakeDb(seed({ reservation_fee_checkout: { ...meta.reservation_fee_checkout, created_at: "2026-11-17T20:00:00Z" } }, [{ id: "p1", driver_id: "app1", status: "unpaid", amount: 50, notes: "reservation_fee:ag1" }]));
    expect(await rfs.existingReservationFeeStep(fresh, "ag1", NOW)).toEqual({ state: "pay", amount: 50, url: "https://checkout.stripe.com/c/pay/old" });
  });
  test("paid, processing, voided, other payment id, amendment, unsigned → no pay link", async () => {
    const pay = (status: string) => [{ id: "p1", driver_id: "app1", status, amount: 50, notes: "reservation_fee:ag1" }];
    const co = { reservation_fee_checkout: { url: "https://checkout.stripe.com/c/pay/x", payment_id: "p1", created_at: "2026-11-17T23:00:00Z" } };
    expect(await rfs.existingReservationFeeStep(fakeDb(seed(co, pay("paid"))), "ag1", NOW)).toEqual({ state: "paid", amount: 50 });
    expect(await rfs.existingReservationFeeStep(fakeDb(seed(co, pay("pending"))), "ag1", NOW)).toEqual({ state: "processing", amount: 50 });
    expect(await rfs.existingReservationFeeStep(fakeDb(seed(co, pay("void"))), "ag1", NOW)).toBeNull();
    expect(await rfs.existingReservationFeeStep(fakeDb(seed(co, pay("refunded"))), "ag1", NOW)).toBeNull();
    expect(await rfs.existingReservationFeeStep(fakeDb(seed({ reservation_fee_checkout: { ...co.reservation_fee_checkout, payment_id: "other" } }, pay("unpaid"))), "ag1", NOW)).toBeNull();
    expect(await rfs.existingReservationFeeStep(fakeDb(seed({ ...co, amendment: { kind: "rate_change" } }, pay("unpaid"))), "ag1", NOW)).toBeNull();
    const unsigned = fakeDb(seed(co, pay("unpaid"))); unsigned.state.agreements[0].status = "viewed";
    expect(await rfs.existingReservationFeeStep(unsigned, "ag1", NOW)).toBeNull();
    expect(await rfs.existingReservationFeeStep(fakeDb(seed()), "ag1", NOW)).toBeNull();
  });
  test("fee switch off: no session, no step", async () => {
    const db = fakeDb(seed()); const s = stripe();
    const o = await rfs.chargeReservationFeeAfterSigning(db, "ag1", { settings: { enabled: false, amount: 50 }, stripe: s, ...noAudit });
    expect(rf.reservationFeeSigningStep(o)).toBeNull();
    expect(s.sessions.length + db.state.payments.length).toBe(0);
  });
  test("already paid: no session, step says paid", async () => {
    const db = fakeDb(seed(null, [{ id: "p1", driver_id: "app1", type: "fee", reason: "reservation_fee", status: "paid", amount: 50, notes: "reservation_fee:ag1" }])); const s = stripe();
    const o = await rfs.chargeReservationFeeAfterSigning(db, "ag1", { settings: ON, stripe: s, ...noAudit });
    expect(rf.reservationFeeSigningStep(o)).toEqual({ state: "paid", amount: 50 });
    expect(s.sessions.length + s.calls.length).toBe(0);
  });
});

describe("signing wiring", () => {
  const src = readFileSync("src/lib/agreements.functions.ts", "utf8");
  test("both signing paths return the step from the ONE fee call; already-signed uses the read-only lookup", () => {
    const sendSigned = src.slice(src.indexOf("async function sendSignedEmails"), src.indexOf("function claimError"));
    expect(sendSigned.match(/chargeReservationFeeAfterSigning\(/g)).toHaveLength(1);
    expect(sendSigned).toContain("if (out) out.reservationFee = reservationFeeSigningStep(fee);");
    expect(sendSigned).toContain("reservationFeePay,"); // the email still carries the link (backup)
    const token = src.slice(src.indexOf("export const signAgreement ="), src.indexOf("export const getMyAgreements"));
    expect(token).toContain("reservationFee: out.reservationFee ?? null");
    expect(token.indexOf('result === "already_signed"')).toBeLessThan(token.indexOf("existingReservationFeeStep"));
    const portal = src.slice(src.indexOf("export const signMyAgreement ="));
    expect(portal).toContain("reservationFee: out.reservationFee ?? null");
    expect(portal).toContain("existingReservationFeeStep(supabaseAdmin, data.agreementId)");
    expect(readFileSync("src/lib/reservation-fee.server.ts", "utf8")).not.toMatch(/login\?paid=1/);
  });
  test("the sign page and portal render the next step from the server answer only", () => {
    const page = readFileSync("src/routes/sign.$token.tsx", "utf8");
    expect(page).toContain("setFeeStep((res as any)?.reservationFee ?? null);");
    expect(page).toContain("<ReservationFeeNextStep step={feeStep} />");
    expect(page).not.toMatch(/useSearch|searchParams/);
    const portal = readFileSync("src/routes/portal.tsx", "utf8");
    expect(portal).toContain("<ReservationFeeNextStep step={feeStep} />");
    expect(readFileSync("src/routeTree.gen.ts", "utf8")).toContain("/reservation-fee");
  });
  test("the payment still records on the lead through the existing webhook", () => {
    const wh = readFileSync("src/routes/api/public/payments/webhook.ts", "utf8");
    expect(wh).toMatch(/session\.mode === 'payment' && session\.metadata\?\.reason === 'reservation_fee'[\s\S]*saveReservationFeeCard/);
  });
});

describe("what the applicant sees", () => {
  test("pay: prominent button to the same Checkout, countdown, stay option, email backup", () => {
    const html = renderToStaticMarkup(createElement(ReservationFeeNextStep, { step: { state: "pay", amount: 50, url: "https://checkout.stripe.com/c/pay/cs_1" }, redirect: () => {} }));
    expect(html).toContain('href="https://checkout.stripe.com/c/pay/cs_1"');
    expect(html).toContain("Pay $50.00 Reservation Fee");
    expect(html).toContain("Taking you to secure checkout in");
    expect(html).toContain("Stay On This Page");
    expect(html).toContain("We also emailed you this payment link");
    expect(html).not.toMatch(/deposit/i);
  });
  test("no auto-redirect: button only", () => {
    const html = renderToStaticMarkup(createElement(ReservationFeeNextStep, { step: { state: "pay", amount: 50, url: "https://checkout.stripe.com/c/pay/cs_1" }, autoRedirect: false }));
    expect(html).toContain("Pay $50.00 Reservation Fee");
    expect(html).not.toContain("Taking you to secure checkout");
  });
  test("paid and processing: no pay button", () => {
    const paid = renderToStaticMarkup(createElement(ReservationFeeNextStep, { step: { state: "paid", amount: 50 } }));
    expect(paid).toContain("Reservation Fee is paid");
    expect(paid).not.toContain("href=");
    const proc = renderToStaticMarkup(createElement(ReservationFeeNextStep, { step: { state: "processing", amount: 50 } }));
    expect(proc).toContain("processing");
    expect(proc).not.toContain("href=");
  });
  test("return page copy: paid and canceled, never 'deposit', no data reads in the route", () => {
    const r = readFileSync("src/routes/reservation-fee.tsx", "utf8");
    const canceled = readFileSync("src/components/reservation/PaymentNotCompletedPage.tsx", "utf8");
    expect(r).toContain('createFileRoute("/reservation-fee")');
    expect(r).toContain("Payment Received");
    expect(r).toContain("PaymentNotCompletedLive");
    expect(canceled).toContain("Payment Not Completed");
    expect(canceled).toContain("Your Car Isn't Reserved Yet");
    expect(canceled).toContain("Insurance Included At");
    expect(canceled).not.toMatch(/declined/i);
    expect(r + canceled).not.toMatch(/deposit/i);
    expect(r).not.toMatch(/supabase|createServerFn|useServerFn/);
  });

  test("an expired stored Checkout is not reused; a new session is minted on the same unpaid row", async () => {
    const meta = { reservation_fee_checkout: { url: "https://checkout.stripe.com/c/pay/old", payment_id: "p1", session_id: "cs_old", created_at: "2026-11-16T00:00:00Z" } };
    const db = fakeDb(seed(meta, [{ id: "p1", driver_id: "app1", status: "unpaid", amount: 50, notes: "reservation_fee:ag1", attempt_count: 1 }]));
    const s = stripe();
    const o = await rfs.chargeReservationFeeAfterSigning(db, "ag1", { settings: ON, stripe: s, now: () => NOW, ...noAudit });
    expect(s.sessions).toHaveLength(1);
    expect(o).toMatchObject({ status: "checkout", amount: 50, paymentId: "p1" });
    expect((o as any).url).toBe("https://checkout.stripe.com/c/pay/cs_1");
    expect(db.state.payments).toHaveLength(1);
  });
});
