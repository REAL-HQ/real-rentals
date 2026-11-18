// FLEET reservation-fee-link: auth, stage rules, idempotent reuse, audit, send refused.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
process.env.SUPABASE_URL ??= "http://127.0.0.1:9";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "dummy";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "dummy";
globalThis.fetch = (async (url: any) => { throw new Error(`network refused in test: ${url}`); }) as any;
import { fakeDb, KEY, req } from "./fleet-fake-db";
const h = await import("@/lib/fleet-reservation-fee-link.server");

const L1 = "11111111-1111-4111-8111-111111111111";
const L2 = "22222222-2222-4222-8222-222222222222";
const PREP = JSON.stringify({ reservation: { mode: "required", amount: 50 } });
const BODY = "… Reservation Fee: $50, applied to your first payment …";
const env = { FLEET_API_KEY: KEY };

function setup(opts: { status?: string; amendment?: boolean; paid?: boolean } = {}) {
  const db = fakeDb({
    agreements: [{ id: "ag1", application_id: L1, status: opts.status ?? "signed", body: BODY, merge_data: { _prep: PREP }, metadata: opts.amendment ? { amendment: true } : {}, vehicle_id: "v1", signed_at: "2026-11-18T18:00:00Z" }],
    applications: [{ id: L1, full_name: "Ana Test", email: "a@example.com", phone: "8135550101", stripe_customer_id: "cus_1" }, { id: L2, full_name: "Ben", stripe_customer_id: "cus_2" }],
    payments: opts.paid ? [{ id: "p1", driver_id: L1, type: "fee", status: "paid", amount: 50, notes: "reservation_fee:ag1" }] : [],
    rentals: [], audit_log: [],
  });
  const sessions: any[] = [];
  const audits: any[] = [];
  const stripe = { checkout: { sessions: { create: async (a: any, o: any) => { sessions.push({ a, o }); return { id: `cs_${sessions.length}`, url: `https://checkout.stripe.com/c/pay/cs_${sessions.length}` }; } } } };
  const d: any = { admin: db, env, audit: async (e: any) => { audits.push(e); }, fee: { settings: { enabled: true, amount: 50 }, stripe, audit: async () => {} } };
  return { db, sessions, audits, d };
}
const call = async (body: any, d: any, headers?: any) => { const res = await h.handleFleetReservationFeeLink(req(body, headers), d); return { status: res.status, json: (await res.json()) as any }; };

describe("auth and input", () => {
  test("no key is 401, bad lead is 400, send:true is refused and nothing is created", async () => {
    const s = setup();
    const noKey = await h.handleFleetReservationFeeLink(new Request("https://x/api", { method: "POST", body: JSON.stringify({ lead_id: L1 }) }), s.d);
    expect(noKey.status).toBe(401);
    expect((await call({ lead_id: "nope" }, s.d)).status).toBe(400);
    expect((await call({ lead_id: L1, send: true }, s.d)).status).toBe(400);
    expect(s.sessions.length).toBe(0);
  });
});

describe("link", () => {
  test("signed agreement: returns url, session id, expiry, 23h, correct metadata/urls, audited as FLEET", async () => {
    const s = setup();
    const out = await call({ lead_id: L1, reason: "renter asked" }, s.d);
    expect(out.status).toBe(200);
    expect(out.json).toMatchObject({ ok: true, amount: 50, reused: false, sent: false, session_id: "cs_1", agreement_id: "ag1", url: "https://checkout.stripe.com/c/pay/cs_1" });
    expect(Date.parse(out.json.expires_at) - Date.now()).toBeGreaterThan(22.9 * 3600e3);
    const a = s.sessions[0].a;
    expect(a.metadata).toMatchObject({ applicationId: L1, agreementId: "ag1", reason: "reservation_fee" });
    expect(a.success_url).toBe("https://drivereal.com/reservation-fee?status=paid&session_id={CHECKOUT_SESSION_ID}");
    expect(a.cancel_url).toContain("status=canceled");
    const au = s.audits.find((e) => e.action === "payment.reservation_fee_link_fleet");
    expect(au.metadata).toMatchObject({ by: "FLEET", lead_id: L1, reused: false, session_id: "cs_1" });
  });
  test("second call reuses the open session: same link, no new Stripe session", async () => {
    const s = setup();
    const a = await call({ lead_id: L1 }, s.d);
    const b = await call({ lead_id: L1 }, s.d);
    expect(b.json).toMatchObject({ ok: true, reused: true, url: a.json.url, session_id: a.json.session_id });
    expect(s.sessions.length).toBe(1);
  });
  test("no signed agreement, unsigned, amendment-only: 409 and nothing created", async () => {
    for (const o of [{ status: "sent" }, { amendment: true }]) {
      const s = setup(o);
      expect((await call({ lead_id: L1 }, s.d)).status).toBe(409);
      expect(s.sessions.length).toBe(0);
    }
    const s = setup();
    expect((await call({ lead_id: L2 }, s.d)).status).toBe(409);
  });
  test("already paid: 409, never a second charge or session", async () => {
    const s = setup({ paid: true });
    const out = await call({ lead_id: L1 }, s.d);
    expect(out).toMatchObject({ status: 409, json: { ok: false, status: "already_paid" } });
    expect(s.sessions.length).toBe(0);
  });
  test("fee switched off: 409", async () => {
    const s = setup(); s.d.fee.settings = { enabled: false, amount: 50 };
    expect((await call({ lead_id: L1 }, s.d)).status).toBe(409);
  });
});

describe("wiring", () => {
  test("route, shared core used by staff fn, docs, and test registered", () => {
    expect(readFileSync("src/routes/api/public/fleet/reservation-fee-link.ts", "utf8")).toContain("handleFleetReservationFeeLink");
    const fn = readFileSync("src/lib/agreements.functions.ts", "utf8");
    expect(fn).toContain("reservationFeeLinkForApplication");
    expect(readFileSync("src/lib/fleet-reservation-fee-link.server.ts", "utf8")).toContain("reservationFeeLinkForApplication");
    expect(readFileSync("docs/fleet-api.md", "utf8")).toContain("reservation-fee-link");
    expect(readFileSync("package.json", "utf8")).toContain("fleet-reservation-fee-link.test.ts");
  });
});
