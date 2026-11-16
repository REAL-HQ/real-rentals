// FLEET send-agreement by a YES text: the message_id must be a real inbound
// text on our Quo lines, from this applicant's phone, reading as a plain YES,
// at the confirmed time. End to end through the same send path as a call.
import { describe, expect, test } from "bun:test";
process.env.SUPABASE_URL ??= "http://127.0.0.1:9";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "dummy";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "dummy";
globalThis.fetch = (async (url: any) => { throw new Error(`network refused in test: ${url}`); }) as any;
const m = await import("@/lib/fleet-agreement.server");

type Row = Record<string, any>;
function fakeDb(seed: Record<string, Row[]>, opts: { missing?: string[] } = {}) {
  const state: Record<string, Row[]> = JSON.parse(JSON.stringify(seed));
  let n = 1;
  function from(table: string) {
    state[table] ??= [];
    let op = "select"; let payload: any = null; let single = false;
    const f: ((r: Row) => boolean)[] = [];
    const q: any = {
      select: () => q, insert: (r: Row) => { op = "insert"; payload = r; return q; }, update: (r: Row) => { op = "update"; payload = r; return q; },
      eq: (c: string, v: any) => { f.push((r) => r[c] === v); return q; },
      limit: () => q, maybeSingle: () => { single = true; return q; }, single: () => { single = true; return q; },
      then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
    };
    function run() {
      if (opts.missing?.includes(table)) return { data: null, error: { code: "42P01", message: `relation "${table}" does not exist` } };
      const rows = state[table];
      if (op === "insert") {
        if (payload.idempotency_key && rows.some((r) => r.idempotency_key === payload.idempotency_key)) return { data: null, error: { code: "23505", message: "dup" } };
        const r = { id: `${table}-${n++}`, ...payload }; rows.push(r); return { data: { id: r.id }, error: null };
      }
      const hit = rows.filter((r) => f.every((x) => x(r)));
      if (op === "update") { hit.forEach((r) => Object.assign(r, payload)); return { data: null, error: null }; }
      return { data: single ? hit[0] ?? null : hit, error: null };
    }
    return q;
  }
  return { from, state };
}

const KEY = "k".repeat(40);
const NOW = new Date("2026-11-16T20:10:00Z");
const A = "11111111-1111-4111-8111-111111111111";
const V = "44444444-4444-4444-8444-444444444444";
const okCheck = { blockers: [], weeklyRate: 350, deposit: 0, startDate: "2026-11-18", vehicleId: V, vehicleLabel: "2019 Ford Fusion" };
const conf = (x: Row = {}) => ({ confirmed_at: "2026-11-16T15:04:30-05:00", channel: "sms", message_id: "MSGyes1", summary: "Replied YES to: 2019 Ford Fusion, $350/week, no deposit, start Wed Nov 18.", weekly_rate: 350, deposit: 0, start_date: "2026-11-18", vehicle_id: V, ...x });
const yes = (x: Row = {}) => ({ id: "q1", event_type: "message.received", quo_resource_id: "MSGyes1", direction: "incoming", from_e164: "+18135550100", body: "YES", occurred_at: "2026-11-16T20:04:12Z", created_at: "2026-11-16T20:04:13Z", ...x });
const seed = (q: Row[] = [yes()]) => ({ applications: [{ id: A, status: "approved", full_name: "Test Renter", email: "t@example.com", phone: "(813) 555-0100", deleted_at: null }], agreement_terms_confirmations: [], quo_events: q });
async function call(db: any, body: Row) {
  const issued: any[] = [];
  const res = await m.handleFleetSendAgreement(new Request("https://drivereal.com/api/public/fleet/send-agreement", {
    method: "POST", headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
  }), {
    admin: db, env: { FLEET_API_KEY: KEY }, now: () => NOW, audit: async () => {},
    check: async () => okCheck, hasOpenOrSigned: async () => false,
    issue: async (_a: any, id: string) => { issued.push(id); return { id: "agr-1", url: "https://drivereal.com/sign/SECRET", delivery: { email: "sent", sms: "sent", delivered: true } }; },
  });
  return { status: res.status, body: await res.json(), issued };
}

describe("YES replies", () => {
  test("what counts as a plain YES", () => {
    for (const t of ["YES", "yes", "Yes!", "Yes I confirm", "y", "Yep", "ok", "Okay sounds good", "Confirmed", "I agree"]) expect(m.isYesReply(t)).toBe(true);
    for (const t of ["", "No", "Yes but can I change the date?", "not yet", "yes wait", "STOP", "What time?", "Maybe", "Yes, how do I pay"]) expect(m.isYesReply(t)).toBe(false);
  });
});

describe("send-agreement with channel sms", () => {
  test("a real YES from the applicant's phone sends the agreement and stores the message id", async () => {
    const db = fakeDb(seed());
    const r = await call(db, { lead_id: A, idempotency_key: "agr-A-1", terms_confirmation: conf() });
    expect(r.status).toBe(201);
    expect(r.issued).toEqual([A]);
    expect(db.state.agreement_terms_confirmations[0]).toMatchObject({ channel: "sms", message_id: "MSGyes1", agreement_id: "agr-1" });
    expect(JSON.stringify(r.body)).not.toContain("SECRET");
  });
  test("refused: unknown id, wrong phone, outgoing, not a YES, stale, time far off; nothing sent or stored", async () => {
    const cases: [Row[], Row, number][] = [
      [[], conf(), 409],
      [[yes({ from_e164: "+18135550199" })], conf(), 409],
      [[yes({ direction: "outgoing" })], conf(), 409],
      [[yes({ body: "yes but can we do Friday?" })], conf(), 409],
      [[yes({ event_type: "message.delivered" })], conf(), 409],
      [[yes({ occurred_at: "2026-11-01T20:04:12Z" })], conf({ confirmed_at: "2026-11-15T15:04:30-05:00" }), 409],
      [[yes()], conf({ confirmed_at: "2026-11-16T14:00:00-05:00" }), 400],
    ];
    for (const [q, c, status] of cases) {
      const db = fakeDb(seed(q));
      const r = await call(db, { lead_id: A, terms_confirmation: c });
      expect(r.status).toBe(status);
      expect(r.issued).toEqual([]);
      expect(db.state.agreement_terms_confirmations).toHaveLength(0);
    }
  });
  test("text history not installed: 503, nothing sent", async () => {
    const db = fakeDb(seed(), { missing: ["quo_events"] });
    const r = await call(db, { lead_id: A, terms_confirmation: conf() });
    expect(r.status).toBe(503);
    expect(r.issued).toEqual([]);
  });
  test("a call confirmation is unchanged (no text lookup)", async () => {
    const db = fakeDb(seed([]));
    const r = await call(db, { lead_id: A, terms_confirmation: conf({ channel: "call", call_id: "ACx", message_id: null }) });
    expect(r.status).toBe(201);
  });
});
