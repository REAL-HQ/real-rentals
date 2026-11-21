// E-signed vehicle swap: gate, wording, store-then-send order, signing hook,
// handover validation and the UI/agreement wiring. The SQL itself is proved
// on a local Postgres by scripts/vehicle-swap-db.test.cjs.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
process.env.SUPABASE_URL ??= "http://127.0.0.1:9";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "dummy";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "dummy";
globalThis.fetch = (async (url: any) => { throw new Error(`network refused in test: ${url}`); }) as any;
const lib = await import("@/lib/vehicle-swap");
const m = await import("@/lib/vehicle-swap.server");
const { roleFromLabel } = await import("@/lib/inbox-agreement-filing");

type Row = Record<string, any>;
function fakeDb(seed: Record<string, Row[]>, opts: { missing?: string[]; rpc?: (name: string, args: any) => { data: any; error: any } } = {}) {
  const state: Record<string, Row[]> = JSON.parse(JSON.stringify(seed));
  let n = 1;
  const rpcCalls: any[] = [];
  const writes: { table: string; op: string; payload: any }[] = [];
  function from(table: string) {
    state[table] ??= [];
    let op = "select"; let payload: any = null; let single = false; let lim = Infinity;
    const f: ((r: Row) => boolean)[] = [];
    const q: any = {
      select: () => q, upsert: (r: Row) => { op = "insert"; payload = r; return q; }, insert: (r: Row) => { op = "insert"; payload = r; return q; }, update: (r: Row) => { op = "update"; payload = r; return q; },
      eq: (c: string, v: any) => { f.push((r) => r[c] === v); return q; },
      in: (c: string, v: any[]) => { f.push((r) => v.includes(r[c])); return q; },
      is: (c: string, v: any) => { f.push((r) => (r[c] ?? null) === v); return q; },
      or: () => q, order: () => q, limit: (k: number) => { lim = k; return q; },
      maybeSingle: () => { single = true; return q; }, single: () => { single = true; return q; },
      then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
    };
    function run() {
      if (opts.missing?.includes(table)) return { data: null, error: { code: "42P01", message: `relation "${table}" does not exist` } };
      const rows = state[table];
      if (op === "insert") {
        writes.push({ table, op, payload });
        if (payload.idempotency_key && rows.some((r) => r.idempotency_key === payload.idempotency_key)) return { data: null, error: { code: "23505", message: "dup" } };
        const r = { id: `${table}-${n}`, swap_number: 999 + n, ...payload }; n++; rows.push(r); return { data: { id: r.id, swap_number: r.swap_number }, error: null };
      }
      const hit = rows.filter((r) => f.every((x) => x(r))).slice(0, lim);
      if (op === "update") { writes.push({ table, op, payload }); hit.forEach((r) => Object.assign(r, payload)); return { data: hit, error: null }; }
      return { data: single ? hit[0] ?? null : hit, error: null };
    }
    return q;
  }
  async function rpc(name: string, args: any) {
    rpcCalls.push({ name, args });
    if (opts.rpc) return opts.rpc(name, args);
    if (name === "vehicle_rental_ready_missing") return { data: [], error: null };
    return { data: { result: "completed", swap_id: args._swap_id, swap_number: 1000 }, error: null };
  }
  return { from, rpc, state, rpcCalls, writes };
}

const R = "9108ea8c-528f-4a81-9237-af505a1b208a";
const A = "baa6dacd-fcfe-47b7-84a1-04952903f514";
const OLD = "02f8bac0-0ade-4ab6-89bc-a2693cc691ad";
const NEW = "33333333-3333-4333-8333-333333333333";
const BUSY = "44444444-4444-4444-8444-444444444444";
const ORIG = "2a4bbf87-c530-4a24-bc1f-84cd608215f9";
const DOC = "66bce12b-c803-4f17-8601-7ad7c0c2c6e8";
const PREP = JSON.stringify({ drivers: { mode: "none", list: [] }, reservation: { mode: "not_required", amount: null }, deposit: { mode: "none", amount: null, reason: "" }, damageWaiver: "declined", payment: { schedule: "weekly", method: "Card Autopay" } });
const seed = (x: Record<string, Row[]> = {}) => ({
  rentals: [{ id: R, application_id: A, status: "active", weekly_rate: 375, vehicle_id: OLD }],
  applications: [{ id: A, full_name: "James Test", email: "j@example.com", deleted_at: null }],
  vehicles: [
    { id: OLD, year: 2018, make: "Toyota", model: "Camry", license_plate: "ED40NC", vin: "4T1B11HK5JU000001", status: "rented", archived_at: null, unit_number: "U7" },
    { id: NEW, year: 2019, make: "Honda", model: "Accord", license_plate: "NEW123", vin: "1HGCV1F30KA000002", status: "available", archived_at: null, unit_number: "U9" },
    { id: BUSY, year: 2017, make: "Nissan", model: "Altima", license_plate: "BSY999", vin: "1N4AL3AP5HC000003", status: "available", archived_at: null, unit_number: "U3" },
  ],
  agreements: [{ id: ORIG, application_id: A, status: "signed", signed_at: "2026-11-16T20:00:00Z", voided_at: null, document_id: DOC, title: "Rental Agreement (Amended)", merge_data: { agreement_number: "RRA-20261116-2A4BBF", _prep: PREP } }],
  documents: [],
  rental_vehicle_swaps: [],
  ...x,
});
const ON = async () => lib.swapGate(true, { enabled: true });
const OFF = async () => lib.swapGate(true, null);
const sendInput = (x: Row = {}) => ({ rentalId: R, toVehicleId: NEW, reasonCode: "maintenance", reason: "Check engine light on", fingerprint: "a".repeat(64), idempotencyKey: "swap-key-0001", actorUserId: "55555555-5555-4555-8555-555555555555", actorLabel: "staff@drivereal.com (staff)", ...x });
const okCheck = async (_a: any, _id: string, r: any) => ({ blockers: [], weeklyRate: r.weeklyRate });

describe("gate", () => {
  test("only an explicit enabled: true with the migration installed turns it on", () => {
    expect(lib.swapGate(false, { enabled: true }).enabled).toBe(false);
    expect(lib.swapGate(true, null).enabled).toBe(false);
    expect(lib.swapGate(true, { enabled: "true" }).enabled).toBe(false);
    expect(lib.swapGate(true, { enabled: 1 }).enabled).toBe(false);
    expect(lib.swapGate(true, { enabled: true }).enabled).toBe(true);
    expect(lib.swapGate(false, { enabled: true }).reason).toContain(lib.VEHICLE_SWAP_MIGRATION);
  });
  test("loadSwapGate: missing table or missing function is not installed; errors fail closed", async () => {
    const missing = fakeDb(seed(), { missing: ["rental_vehicle_swaps"] });
    expect((await m.loadSwapGate(missing)).installed).toBe(false);
    const noFn = fakeDb(seed({ app_settings: [{ key: "vehicle_swap", value: { enabled: true } }] }), { rpc: () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function" } }) });
    const g1 = await m.loadSwapGate(noFn);
    expect(g1.installed).toBe(false);
    expect(g1.enabled).toBe(false);
    const ok = fakeDb(seed({ app_settings: [{ key: "vehicle_swap", value: { enabled: true } }] }), { rpc: () => ({ data: null, error: { code: "P0001", message: "invalid_vehicle_status" } }) });
    const g2 = await m.loadSwapGate(ok);
    expect(g2.installed).toBe(true);
    expect(g2.enabled).toBe(true);
    // The probe never names a real swap and passes a null status.
    expect(ok.rpcCalls[0].args._from_vehicle_status).toBeNull();
  });
  test("every write refuses while off, before it reads or writes", async () => {
    const db = fakeDb(seed());
    for (const r of [
      await m.sendSwapAgreement(db, sendInput(), { gate: OFF }),
      await m.previewSwap(db, { rentalId: R, toVehicleId: NEW }, { gate: OFF }),
      await m.completeSwap(db, { swapId: NEW, handover: { fromVehicleStatus: "maintenance", returnMiles: 1, pickupMiles: 1, returnFuel: "F", pickupFuel: "F" }, actorUserId: R }, { gate: OFF }),
      await m.cancelSwap(db, { swapId: NEW, reason: "changed mind", actorUserId: R, actorLabel: "x" }, { gate: OFF }),
    ]) {
      expect(r.status).toBe(409);
      expect(r.body.reason).toBe("swap_off");
    }
    expect(db.writes).toHaveLength(0);
    expect(db.rpcCalls).toHaveLength(0);
  });
});

describe("wording", () => {
  test("the notice keeps the rent, names the original, and never prints a unit number", () => {
    const t = lib.swapNoticeText({ weeklyRate: 375, previousSignedAt: "2026-11-16", previousNumber: "RRA-20261116-2A4BBF", previousIsPaper: false, outgoing: { year: 2018, make: "Toyota", model: "Camry", license_plate: "ed40nc" } });
    expect(t).toContain("$375.00");
    expect(t).toContain("RRA-20261116-2A4BBF");
    expect(t).toContain("Nov 16, 2026");
    expect(t).toContain("2018 Toyota Camry, plate ED40NC");
    expect(t).toContain("No Reservation Fee".replace("No", "no"));
    expect(t).not.toMatch(/unit|late fee/i);
    expect(lib.swapNoticeText({ weeklyRate: 375, previousSignedAt: null, previousNumber: null, previousIsPaper: true, outgoing: null })).toContain("your Rental Agreement on file");
  });
  test("the signed PDF is filed with Agreement Filing's Swap label", () => {
    const l = lib.swapDocumentLabel(DOC);
    expect(roleFromLabel(l)).toBe("swap");
    expect(l).toContain(DOC.slice(0, 8));
  });
  test("database errors become staff text", () => {
    expect(lib.swapErrorText("replacement_not_rental_ready:vin,weekly_rate")).toContain("vin,weekly_rate");
    expect(lib.swapErrorText("return_below_pickup:50000")).toContain("50000");
    expect(lib.swapErrorText("swap_contention")).toContain("Try again");
    expect(lib.swapErrorText("something else")).toContain("Nothing was changed");
  });
  test("UI strings are Title Case and name no insurer", () => {
    const ui = readFileSync("src/components/admin/BookingVehicleHistory.tsx", "utf8");
    for (const s of ["Swap Vehicle", "Replacement Vehicle", "Preview Agreement", "Send For E-Signature", "Complete Swap", "Cancel Swap", "Return Odometer (Current Car)", "Pickup Odometer (New Car)", "Returned Car Goes To"]) expect(ui).toContain(s);
    expect(ui).not.toMatch(/text-transform|uppercase/);
    for (const f of ["src/lib/vehicle-swap.ts", "src/components/admin/BookingVehicleHistory.tsx"]) expect(readFileSync(f, "utf8")).not.toMatch(/progressive|geico|state farm|allstate|broker/i);
  });
});

describe("send", () => {
  test("stores the swap first, then issues a v1.16 agreement naming the new car at the same rent", async () => {
    const db = fakeDb(seed());
    const issued: any[] = []; const audits: any[] = [];
    const r = await m.sendSwapAgreement(db, sendInput(), {
      gate: ON, check: okCheck, audit: async (e) => { audits.push(e); },
      issue: async (_a, id, o) => { issued.push({ id, o, rows: db.state.rental_vehicle_swaps.length }); return { id: "agr-swap", url: "https://drivereal.com/sign/SECRET", delivery: { email: "sent", sms: "sent", delivered: true } }; },
    });
    expect(r.status).toBe(200);
    expect(r.body.agreement_id).toBe("agr-swap");
    expect(JSON.stringify(r.body)).not.toContain("SECRET");
    expect(issued[0].rows).toBe(1);
    const a = issued[0].o.amendment;
    expect(a.templateKey).toBe("insurance_included_v116");
    expect(a.vehicleId).toBe(NEW);
    expect(a.weeklyRate).toBe(375);
    expect(a.swap).toEqual({ rentalId: R, swapId: db.state.rental_vehicle_swaps[0].id, fromVehicleId: OLD });
    expect(a.metadata.kind).toBe("vehicle_swap");
    expect(a.metadata.previous_agreement_id).toBe(ORIG);
    expect(a.metadata.previous_document_id).toBe(DOC);
    expect(roleFromLabel(a.metadata.document_label)).toBe("swap");
    expect(a.prep.reservation.mode).toBe("not_required");
    expect(a.prep.deposit.mode).toBe("none");
    expect(a.prep.damageWaiver).toBe("declined");
    expect(a.prep.payment).toEqual({ schedule: "weekly", method: "Card Autopay" });
    expect(issued[0].o.fingerprint).toBe("a".repeat(64));
    const row = db.state.rental_vehicle_swaps[0];
    expect(row).toMatchObject({ status: "pending_signature", from_vehicle_id: OLD, to_vehicle_id: NEW, weekly_rate: 375, agreement_id: "agr-swap", previous_agreement_id: ORIG });
    expect(audits.map((x) => x.action)).toEqual(["rental.vehicle_swap_sent"]);
    // Billing untouched.
    expect(db.writes.filter((w) => ["rentals", "payments", "vehicles"].includes(w.table))).toHaveLength(0);
  });
  test("a repeat with the same key does not send twice", async () => {
    const db = fakeDb(seed());
    let sends = 0;
    const deps = { gate: ON, check: okCheck, audit: async () => {}, issue: async () => { sends++; return { id: "agr-swap", url: "u", delivery: { email: "sent", sms: "sent", delivered: true } }; } };
    await m.sendSwapAgreement(db, sendInput(), deps);
    const again = await m.sendSwapAgreement(db, sendInput(), deps);
    expect(again.body.duplicate).toBe(true);
    expect(sends).toBe(1);
  });
  test("refusals store and send nothing", async () => {
    const cases: [Record<string, Row[]>, Row, RegExp][] = [
      [{ rentals: [{ id: R, application_id: A, status: "reserved", weekly_rate: 375, vehicle_id: OLD }] }, {}, /active rental/],
      [{}, { toVehicleId: OLD }, /different car/],
      [{ rentals: [{ id: R, application_id: A, status: "active", weekly_rate: 375, vehicle_id: OLD }, { id: "r2", vehicle_id: BUSY, status: "reserved" }] }, { toVehicleId: BUSY }, /another booking/],
      [{ agreements: [] }, {}, /No signed original agreement/],
      [{ agreements: [{ id: ORIG, application_id: A, status: "signed", signed_at: "2026-11-16T20:00:00Z", voided_at: null, document_id: DOC, merge_data: {} }, { id: "open", application_id: A, status: "sent", voided_at: null }] }, {}, /unsigned agreement is already out/],
      [{ rental_vehicle_swaps: [{ id: "s0", rental_id: R, to_vehicle_id: BUSY, status: "signed" }] }, {}, /already open/],
      [{}, { reason: "no" }, /at least 5/],
      [{}, { reasonCode: "because" }, /swap reason/],
    ];
    for (const [over, input, msg] of cases) {
      const db = fakeDb(seed(over));
      let sent = 0;
      const r = await m.sendSwapAgreement(db, sendInput(input), { gate: ON, check: okCheck, audit: async () => {}, issue: async () => { sent++; return { id: "x", url: "u", delivery: { email: "", sms: "", delivered: true } }; } });
      expect(r.body.ok).toBe(false);
      expect(String(r.body.error)).toMatch(msg);
      expect(sent).toBe(0);
      expect(db.writes.filter((w) => w.table === "rental_vehicle_swaps" && w.op === "insert")).toHaveLength(0);
    }
  });
  test("a replacement that is not Rental Ready is refused", async () => {
    const db = fakeDb(seed(), { rpc: (n) => (n === "vehicle_rental_ready_missing" ? { data: ["vin"], error: null } : { data: null, error: null }) });
    const r = await m.sendSwapAgreement(db, sendInput(), { gate: ON, check: okCheck, audit: async () => {}, issue: async () => { throw new Error("no"); } });
    expect(String(r.body.error)).toContain("not Rental Ready");
  });
  test("blockers or a different printed rate send nothing", async () => {
    for (const check of [async () => ({ blockers: [{ field: "x", label: "X", why: "y" }], weeklyRate: 375 }), async () => ({ blockers: [], weeklyRate: 400 })]) {
      const db = fakeDb(seed());
      const r = await m.sendSwapAgreement(db, sendInput(), { gate: ON, check, audit: async () => {}, issue: async () => { throw new Error("must not send"); } });
      expect(r.status).toBe(409);
      expect(db.state.rental_vehicle_swaps).toHaveLength(0);
    }
  });
  test("a paper original: the swap follows the verified paper document and needs the terms entered", async () => {
    const db = fakeDb(seed({ agreements: [], documents: [{ id: "paper-doc", driver_id: A, category: "agreement", is_current: true, review_status: "verified", reviewed_at: "2026-11-01", label: "Rental Agreement — Original", created_at: "2026-11-01" }] }));
    const issued: any[] = [];
    const r = await m.sendSwapAgreement(db, sendInput({ terms: { damage_waiver: "declined", payment_schedule: "weekly", payment_method: "Zelle" } }), {
      gate: ON, check: okCheck, audit: async () => {}, issue: async (_a, _id, o) => { issued.push(o); return { id: "agr-p", url: "u", delivery: { email: "sent", sms: "sent", delivered: true } }; },
    });
    expect(r.status).toBe(200);
    expect(issued[0].amendment.metadata.previous_document_id).toBe("paper-doc");
    expect(issued[0].amendment.metadata.previous_agreement_id).toBeNull();
    expect(issued[0].amendment.notice).toContain("your Rental Agreement on file");
    expect(issued[0].amendment.prep.payment).toEqual({ schedule: "weekly", method: "Zelle" });
    // An unverified paper upload is not an original.
    const db2 = fakeDb(seed({ agreements: [], documents: [{ id: "d", driver_id: A, category: "agreement", is_current: true, review_status: "uploaded", label: "Rental Agreement — Original" }] }));
    expect(String((await m.sendSwapAgreement(db2, sendInput(), { gate: ON, check: okCheck, audit: async () => {} })).body.error)).toMatch(/No signed original/);
  });
  test("a send failure marks the swap send_failed", async () => {
    const db = fakeDb(seed());
    const r = await m.sendSwapAgreement(db, sendInput(), { gate: ON, check: okCheck, audit: async () => {}, issue: async () => { throw new Error("Resend down"); } });
    expect(r.status).toBe(409);
    expect(db.state.rental_vehicle_swaps[0].status).toBe("send_failed");
  });
});

describe("signing and handover", () => {
  test("onSwapSigned marks the swap signed, relabels the PDF, and never moves the car", async () => {
    const db = fakeDb(seed({
      agreements: [{ id: "agr-swap", signed_at: "2026-11-20T15:00:00Z", document_id: "doc-new", metadata: { amendment: { kind: "vehicle_swap", swap_id: "s1" } } }],
      documents: [{ id: "doc-new", label: "Signed rental agreement" }],
      rental_vehicle_swaps: [{ id: "s1", rental_id: R, status: "pending_signature", swap_number: 1000, agreement_id: "agr-swap", previous_document_id: DOC }],
    }));
    const audits: any[] = [];
    expect(await m.onSwapSigned(db, "agr-swap", { audit: async (e) => { audits.push(e); } })).toBe(true);
    expect(db.state.rental_vehicle_swaps[0].status).toBe("signed");
    expect(roleFromLabel(db.state.documents[0].label)).toBe("swap");
    expect(db.writes.filter((w) => w.table === "rentals" || w.table === "vehicles")).toHaveLength(0);
    expect(db.rpcCalls).toHaveLength(0);
    expect(audits[0].action).toBe("rental.vehicle_swap_signed");
    // Not a swap agreement: untouched.
    expect(await m.onSwapSigned(fakeDb(seed()), ORIG)).toBe(false);
  });
  test("completeSwap validates readings and calls the transaction once", async () => {
    const db = fakeDb(seed());
    const bad = await m.completeSwap(db, { swapId: NEW, handover: { fromVehicleStatus: "maintenance", returnMiles: -1, pickupMiles: 5, returnFuel: "F", pickupFuel: "F" }, actorUserId: R }, { gate: ON });
    expect(bad.status).toBe(400);
    const badFuel = await m.completeSwap(db, { swapId: NEW, handover: { fromVehicleStatus: "maintenance", returnMiles: 1, pickupMiles: 5, returnFuel: "Half" as any, pickupFuel: "F" }, actorUserId: R }, { gate: ON });
    expect(badFuel.status).toBe(400);
    expect(db.rpcCalls).toHaveLength(0);
    const ok = await m.completeSwap(db, { swapId: NEW, handover: { fromVehicleStatus: "available", returnMiles: 50250, pickupMiles: 30010, returnFuel: "1/2", pickupFuel: "F" }, actorUserId: R }, { gate: ON });
    expect(ok.status).toBe(200);
    expect(db.rpcCalls[0]).toEqual({ name: "complete_rental_vehicle_swap_tx", args: { _swap_id: NEW, _from_vehicle_status: "available", _return_miles: 50250, _pickup_miles: 30010, _return_fuel: "1/2", _pickup_fuel: "F", _actor: R } });
    const refused = await m.completeSwap(fakeDb(seed(), { rpc: () => ({ data: null, error: { message: "replacement_on_other_rental" } }) }), { swapId: NEW, handover: { fromVehicleStatus: "available", returnMiles: 1, pickupMiles: 1, returnFuel: "F", pickupFuel: "F" }, actorUserId: R }, { gate: ON });
    expect(String(refused.body.error)).toContain("another booking");
  });
  test("cancelSwap voids an unsigned agreement through esign and frees the car", async () => {
    const db = fakeDb(seed({ rental_vehicle_swaps: [{ id: "s1", rental_id: R, status: "pending_signature", agreement_id: "agr-swap", swap_number: 1000 }] }));
    const voided: string[] = [];
    const r = await m.cancelSwap(db, { swapId: "11111111-1111-4111-8111-111111111111".replace(/1/g, "1"), reason: "Car fixed after all", actorUserId: R, actorLabel: "x" }, { gate: ON, audit: async () => {}, voidAgreement: async (_a, id) => { voided.push(id); return "voided"; } });
    expect(r.status).toBe(404); // unknown id
    db.state.rental_vehicle_swaps[0].id = "11111111-1111-4111-8111-111111111111";
    const ok = await m.cancelSwap(db, { swapId: "11111111-1111-4111-8111-111111111111", reason: "Car fixed after all", actorUserId: R, actorLabel: "x" }, { gate: ON, audit: async () => {}, voidAgreement: async (_a, id) => { voided.push(id); return "voided"; } });
    expect(ok.status).toBe(200);
    expect(voided).toEqual(["agr-swap"]);
    expect(db.state.rental_vehicle_swaps[0].status).toBe("voided");
  });
  test("history is empty, not an error, before the migration is installed", async () => {
    const r = await m.listSwaps(fakeDb(seed(), { missing: ["rental_vehicle_swaps"] }), { rentalId: R });
    expect(r).toEqual({ installed: false, entries: [] });
  });
});

describe("addendum wording (Dolmar t541u/t542u: upgrade to current terms, same start date and rent)", () => {
  const notice = lib.swapNoticeText({ weeklyRate: 375, previousSignedAt: "2026-11-16", previousNumber: "RRA-20261116-2A4BBF", previousIsPaper: false, outgoing: { year: 2018, make: "Toyota", model: "Camry", license_plate: "ed40nc" } });
  test("it is an addendum that states the renter accepts the current v1.16 terms, printed in full", () => {
    expect(lib.VEHICLE_SWAP_TITLE).toBe("Vehicle Swap Addendum To Rental Agreement");
    expect(lib.SWAP_TERMS_VERSION).toBe("v1.16");
    expect(notice).toContain("Vehicle Swap Addendum");
    expect(notice).toContain("you accept the current Rental Agreement terms (Version 1.16)");
    expect(notice).toContain("printed in full below");
    expect(notice).toContain("original start date");
    expect(notice).toContain("$375.00");
    expect(notice).not.toMatch(/progressive|bristol|allcom|broker|deposit/i);
    expect(notice).toContain("There is no Reservation Fee. Until you sign and receive the new Vehicle, your current agreement stays in effect.");
  });
  test("the swap is always built on the v1.16 template and the original start date, whatever version the original was", () => {
    expect(readFileSync("src/lib/rental-amendment.ts", "utf8")).toMatch(/AMENDMENT_TEMPLATE_KEY = "insurance_included_v116"/);
    expect(readFileSync("src/lib/agreement-library.ts", "utf8")).toMatch(/DEFAULT_LIBRARY_KEY = "insurance_included_v116"/);
    const ag = readFileSync("src/lib/agreements.functions.ts", "utf8");
    expect(ag).toMatch(/const storedStart = fromRental \? rental\.start_date/);
    expect(ag).toContain('"Vehicle Swap Addendum To Rental Agreement"');
  });
  test("the Florida addendum stays out: it is unapproved and no agreement path reads it", () => {
    const fl = readFileSync("src/lib/agreement-fl-addendum.ts", "utf8");
    expect(fl).toMatch(/FL_ADDENDUM_OWNER_APPROVAL: \{ at: string; by: string \} \| null = null;/);
    for (const f of ["src/lib/agreements.functions.ts", "src/lib/vehicle-swap.server.ts", "src/lib/rental-amendment.ts"]) {
      expect(readFileSync(f, "utf8")).not.toMatch(/agreement-fl-addendum|FL_ADDENDUM/);
    }
  });
});

describe("New Vehicle Insurance (Optional since Nov 21, Dolmar t549u/t550u)", () => {
  const SWAP = "77777777-7777-4777-8777-777777777777";
  const USER = "55555555-5555-4555-8555-555555555555";
  const openSwap = (x: Row = {}) => ({ id: SWAP, status: "signed", to_vehicle_id: NEW, rental_id: R, swap_number: 1000, ...x });
  const withStorage = (db: any, ok = true) => {
    const removed: string[] = [];
    db.storage = { from: () => ({ download: async () => (ok ? { data: new Blob(["card"]) } : { data: null }), remove: async (p: string[]) => { removed.push(...p); } }) };
    return { db, removed };
  };
  const input = (x: Row = {}) => ({ swapId: SWAP, kind: "insurance_card", path: `${NEW}/insurance_card-1.pdf`, fileName: "ID CARD.pdf", mimeType: "application/pdf", sizeBytes: 100, actorUserId: USER, ...x });
  const deps = { gate: ON, audit: async () => {} };

  test("a document is filed on the NEW vehicle, staff only, tied to the swap, and writes no insurance field", async () => {
    const { db } = withStorage(fakeDb(seed({ rental_vehicle_swaps: [openSwap()], rental_vehicle_swap_documents: [] })));
    const r = await m.addSwapInsuranceDoc(db as any, input(), deps);
    expect(r.status).toBe(200);
    const doc = db.writes.find((w) => w.table === "documents" && w.op === "insert")!.payload;
    expect(doc).toMatchObject({ vehicle_id: NEW, kind: "insurance_card", category: "insurance_card", storage_bucket: "vehicle-docs", visibility: ["admin"] });
    expect(db.writes.find((w) => w.table === "rental_vehicle_swap_documents")!.payload).toMatchObject({ swap_id: SWAP, vehicle_id: NEW, doc_kind: "insurance_card" });
    expect(db.writes.filter((w) => w.table === "vehicles" || w.table === "applications" || w.table === "rentals")).toEqual([]);
    expect(JSON.stringify(db.writes)).not.toMatch(/insurance_verified|insured|insurance_status|insurance_expires/);
  });
  test("ID cards, declarations and endorsements are accepted; anything else, another car's folder, or a closed swap is refused", async () => {
    for (const kind of ["insurance_card", "insurance_declarations", "insurance_endorsement"]) {
      const { db } = withStorage(fakeDb(seed({ rental_vehicle_swaps: [openSwap()], rental_vehicle_swap_documents: [] })));
      expect((await m.addSwapInsuranceDoc(db as any, input({ kind }), deps)).status).toBe(200);
    }
    const cases: [Row, Row][] = [
      [{ kind: "title" }, openSwap()],
      [{ path: `${OLD}/x.pdf` }, openSwap()],
      [{ path: `${NEW}/../x.pdf` }, openSwap()],
      [{}, openSwap({ status: "completed" })],
    ];
    for (const [inp, sw] of cases) {
      const { db } = withStorage(fakeDb(seed({ rental_vehicle_swaps: [sw], rental_vehicle_swap_documents: [] })));
      const r = await m.addSwapInsuranceDoc(db as any, input(inp), deps);
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect(db.writes.filter((w) => w.table === "documents" || w.table === "rental_vehicle_swap_documents")).toEqual([]);
    }
  });
  test("it refuses while Vehicle Swap is off", async () => {
    const { db } = withStorage(fakeDb(seed({ rental_vehicle_swaps: [openSwap()] })));
    expect((await m.addSwapInsuranceDoc(db as any, input(), { gate: OFF })).status).toBe(409);
    expect(db.writes).toEqual([]);
  });
  test("status only reports whether a document is uploaded (a reminder, never a requirement)", async () => {
    const none = await m.swapInsuranceStatus(fakeDb(seed({ rental_vehicle_swaps: [openSwap()], rental_vehicle_swap_documents: [] })) as any, SWAP);
    expect(none).toEqual({ docs: [], uploaded: false });
    const doc = await m.swapInsuranceStatus(fakeDb(seed({ rental_vehicle_swaps: [openSwap()], rental_vehicle_swap_documents: [{ id: "l1", swap_id: SWAP, document_id: "d1", doc_kind: "insurance_endorsement", created_at: "2026-11-20" }], documents: [{ id: "d1", file_name: "endorsement.pdf" }] })) as any, SWAP);
    expect(doc.uploaded).toBe(true);
    expect(doc.docs[0]).toMatchObject({ kindLabel: "Insurance Endorsement", fileName: "endorsement.pdf" });
  });
  test("sending the swap agreement with no insurance document succeeds", async () => {
    const db = fakeDb(seed({ rental_vehicle_swap_documents: [] }));
    const r = await m.sendSwapAgreement(db, sendInput(), { gate: ON, check: okCheck, audit: async () => {}, issue: async () => ({ id: "agr-swap", url: "u", delivery: { email: "sent", sms: "sent", delivered: true } }) });
    expect(r.status).toBe(200);
    expect(db.state.rental_vehicle_swap_documents).toEqual([]);
  });
  test("completing a swap with no insurance document and no override succeeds", async () => {
    const db = fakeDb(seed({ rental_vehicle_swaps: [openSwap()], rental_vehicle_swap_documents: [] }));
    const r = await m.completeSwap(db, { swapId: SWAP, handover: { fromVehicleStatus: "maintenance", returnMiles: 50250, pickupMiles: 30010, returnFuel: "1/2", pickupFuel: "F" }, actorUserId: USER }, { gate: ON });
    expect(r.status).toBe(200);
    expect(db.rpcCalls.map((c) => c.name)).toEqual(["complete_rental_vehicle_swap_tx"]);
  });
  test("no insurance gate in the database or the button; no Owner override; the reminder is neutral Title Case", () => {
    const fix = readFileSync("supabase/migrations/20261121070000_swap_insurance_optional.sql", "utf8");
    expect(fix).toMatch(/CREATE OR REPLACE FUNCTION public\.complete_rental_vehicle_swap_tx/);
    expect(fix).not.toMatch(/RAISE EXCEPTION 'swap_insurance_missing'/);
    expect(fix).not.toMatch(/UPDATE public\.vehicles SET[^;]*insur/i);
    expect(fix).toMatch(/GRANT EXECUTE ON FUNCTION public\.complete_rental_vehicle_swap_tx\(uuid,text,integer,integer,text,text,uuid\) TO service_role/);
    const fns = readFileSync("src/lib/vehicle-swap.functions.ts", "utf8");
    expect(fns).not.toMatch(/overrideSwapInsurance/);
    expect(Object.keys(m)).not.toContain("overrideSwapInsurance");
    const ui = readFileSync("src/components/admin/BookingVehicleHistory.tsx", "utf8");
    expect(ui).not.toMatch(/satisfied|Override As Owner|Required Before Handover/);
    expect(ui).toMatch(/const ready = swap\.status === "signed" && miles/);
    expect(ui).toMatch(/bg-amber-50 text-amber-800/);
    expect(ui).toContain("Upload New Vehicle Insurance");
    expect(lib.SWAP_INSURANCE_MISSING_REMINDER).toBe("No Insurance Card Uploaded For The New Vehicle");
    expect(lib.SWAP_INSURANCE_CHECK_LABEL).toBe("New Vehicle Insurance (Optional)");
    expect(lib.SWAP_INSURANCE_NOTE).toMatch(/does not mark the vehicle insured/);
    // Renter-facing swap copy never names the insurer, broker or rep.
    expect(readFileSync("src/lib/vehicle-swap.ts", "utf8")).not.toMatch(/bristol|allcom|clarence|leo boland|progressive/i);
  });
});

describe("wiring", () => {
  const agreements = readFileSync("src/lib/agreements.functions.ts", "utf8");
  const esign = readFileSync("src/lib/esign.server.ts", "utf8");
  const numbers = readFileSync("src/lib/record-numbers.ts", "utf8");
  const migration = readFileSync("supabase/migrations/20261120171500_rental_vehicle_swaps.sql", "utf8");
  test("no hard-coded swap flag remains; the gate is runtime", () => {
    expect(numbers).not.toMatch(/SWAP_ENABLED/);
    expect(agreements).not.toMatch(/SWAP_ENABLED/);
    expect(agreements).toMatch(/const vehicleOverride = amendment \? \(amendment\.vehicleId \?\? undefined\) : undefined;/);
  });
  test("a swap agreement may name only the open swap's replacement car", () => {
    expect(agreements).toMatch(/swap\s*\n?\s*\? await swapVehicleForAgreement\(admin, applicationId, vehicleId, swap\)/);
    expect(agreements).toMatch(/row\.status !== "pending_signature"/);
    expect(agreements).toMatch(/v\.status !== "available"/);
  });
  test("signing a swap goes to onSwapSigned, not the rate amendment", () => {
    const i = esign.indexOf('kind === "vehicle_swap"');
    expect(i).toBeGreaterThan(0);
    expect(esign.indexOf("onSwapSigned")).toBeGreaterThan(i);
    expect(esign.indexOf("onSwapSigned")).toBeLessThan(esign.indexOf("onAmendmentSigned(admin, args.id)"));
  });
  test("the migration never writes billing columns and does not switch the feature on", () => {
    const fn = migration.slice(migration.indexOf("CREATE OR REPLACE FUNCTION"), migration.indexOf("REVOKE ALL ON FUNCTION"));
    expect(fn).not.toMatch(/weekly_rate\s*=|stripe_|autopay_active|payments|balance_due|deposit/);
    expect(migration).not.toMatch(/INSERT INTO public\.app_settings/);
    expect(migration).toMatch(/DO NOT apply to production until Dolmar approves/);
  });
});
