// FLEET vehicle expenses, rental inspection photos and pickup odometer.
// Network refused; fake database and storage. Nothing here writes production.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

process.env.SUPABASE_URL ??= "http://127.0.0.1:9";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "dummy";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "dummy";
globalThis.fetch = (async (url: any) => {
  throw new Error(`network refused in test: ${url}`);
}) as any;

const exp = await import("@/lib/fleet-expenses.server");
const rec = await import("@/lib/fleet-rental-records.server");
const rules = await import("@/lib/fleet-expenses");
const cat = await import("@/lib/automation-catalog");

type Row = Record<string, any>;
const pick = (r: Row, c: string) => {
  const m = /^(\w+)->>(\w+)$/.exec(c);
  return m ? (r[m[1]]?.[m[2]] == null ? undefined : String(r[m[1]][m[2]])) : r[c];
};

function fakeDb(seed: Record<string, Row[]>) {
  const state: Record<string, Row[]> = JSON.parse(JSON.stringify(seed));
  const objects = new Map<string, { bucket: string; bytes: Uint8Array; contentType: string }>();
  let n = 1;
  function from(table: string) {
    state[table] ??= [];
    let op = "select";
    let payload: any = null;
    let single = false;
    let lim: number | null = null;
    const filters: Array<(r: Row) => boolean> = [];
    const sorts: Array<{ c: string; asc: boolean }> = [];
    const q: any = {
      select: () => q,
      insert: (r: Row) => ((op = "insert"), (payload = r), q),
      update: (r: Row) => ((op = "update"), (payload = r), q),
      eq: (c: string, v: any) => (filters.push((r) => pick(r, c) === v || r[c] === v), q),
      gte: (c: string, v: any) => (filters.push((r) => String(r[c]) >= String(v)), q),
      lte: (c: string, v: any) => (filters.push((r) => String(r[c]) <= String(v)), q),
      ilike: (c: string, v: any) => {
        // % any run; \% \_ literal; _ any one character
        let re = "";
        const s = String(v ?? "");
        for (let i = 0; i < s.length; i++) {
          const ch = s[i];
          if (ch === "\\" && i + 1 < s.length) re += s[++i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          else if (ch === "%") re += ".*";
          else if (ch === "_") re += ".";
          else re += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        }
        const rx = new RegExp(`^${re}$`, "i");
        filters.push((r) => rx.test(String(r[c] ?? "")));
        return q;
      },
      is: (c: string, v: any) => (filters.push((r) => (v === null ? r[c] == null : r[c] === v)), q),
      in: (c: string, v: any[]) => (filters.push((r) => v.includes(r[c])), q),
      order: (c: string, o?: { ascending?: boolean }) => (sorts.push({ c, asc: o?.ascending !== false }), q),
      limit: (x: number) => ((lim = x), q),
      maybeSingle: () => ((single = true), q),
      single: () => ((single = true), q),
      then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
    };
    function run() {
      const rows = state[table];
      const matched = () => rows.filter((r) => filters.every((fn) => fn(r)));
      if (op === "insert") {
        if (payload?.evidence_key && rows.some((r) => r.evidence_key === payload.evidence_key))
          return { data: null, error: { message: "duplicate key value violates unique constraint" } };
        const row = { id: `${table}-${n++}`, created_at: `2026-11-27T20:00:0${n % 10}Z`, ...(table === "odometer_readings" ? { status: "valid" } : {}), ...payload };
        rows.push(row);
        return { data: single ? row : [row], error: null };
      }
      if (op === "update") {
        const hit = matched();
        for (const row of hit) Object.assign(row, payload);
        return { data: hit, error: null };
      }
      let m = matched();
      if (sorts.length)
        m = [...m].sort((a, b) => {
          for (const s of sorts) {
            const av = a[s.c] ?? "";
            const bv = b[s.c] ?? "";
            if (av === bv) continue;
            return (av < bv ? -1 : 1) * (s.asc ? 1 : -1);
          }
          return 0;
        });
      if (lim != null) m = m.slice(0, lim);
      const out = structuredClone(m);
      return { data: single ? (out[0] ?? null) : out, error: null };
    }
    return q;
  }
  const storage = {
    from: (bucket: string) => ({
      upload: async (path: string, bytes: Uint8Array, o: any) => {
        objects.set(`${bucket}/${path}`, { bucket, bytes, contentType: o?.contentType });
        return { data: { path }, error: null };
      },
      remove: async (paths: string[]) => {
        for (const p of paths) objects.delete(`${bucket}/${p}`);
        return { data: [], error: null };
      },
    }),
  };
  return { from, storage, state, objects };
}

const KEY = "k".repeat(40);
const ENV = { FLEET_API_KEY: KEY };
const V1 = "ca3d2cc6-0144-4efa-b0d6-5091b27db254";
const V2 = "22222222-2222-4222-8222-222222222222";
const V3 = "33333333-3333-4333-8333-333333333333";
const V4 = "44444444-4444-4444-8444-444444444444";
const R1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const R2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const R3 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const APP = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const VENDOR = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n");
const GIF = new TextEncoder().encode("GIF89a\u0001\u0000\u0001\u0000\u0000\u0000");
const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");

function seed(extra: Record<string, Row[]> = {}) {
  return {
    vehicles: [
      { id: V1, license_plate: "EC20LK", vin: "1HGCM82633A123456", unit_number: "UNIT-9", archived_at: null },
      { id: V2, license_plate: "ZZTOP1", vin: "WBAFR9C50BC123999", unit_number: "UNIT-2", archived_at: null },
      { id: V3, license_plate: "DUP-1", vin: "AAAAAAAAAAA000001", unit_number: "UNIT-3", archived_at: null },
      { id: V4, license_plate: "DUP1", vin: "AAAAAAAAAAA000002", unit_number: "UNIT-4", archived_at: null },
    ],
    vendors: [{ id: VENDOR, name: "Pep Boys", name_key: "pepboys" }],
    vehicle_expenses: [],
    rentals: [
      { id: R1, vehicle_id: V1, driver_id: "drv-1", application_id: APP, status: "active", start_date: "2026-11-20", pickup_reading_id: null, return_reading_id: null },
      { id: R2, vehicle_id: V2, driver_id: "drv-2", application_id: null, status: "cancelled", start_date: "2026-11-01", pickup_reading_id: null, return_reading_id: null },
      { id: R3, vehicle_id: V1, driver_id: "drv-3", application_id: null, status: "closed", start_date: "2026-10-01", pickup_reading_id: "odo-pick", return_reading_id: "odo-ret" },
    ],
    odometer_readings: [],
    condition_media: [],
    audit_log: [],
    ...extra,
  };
}

type Out = { status: number; json: any; db: any; audits: any[] };
function run(
  handler: (req: Request, deps: any) => Promise<Response>,
  db: any,
  o: { method?: string; url?: string; body?: any; gate?: "send" | "off" | "held"; key?: string | null; env?: any; store?: any } = {},
): Promise<Out> {
  const audits: any[] = [];
  const method = o.method ?? "POST";
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (o.key !== null) headers.authorization = `Bearer ${o.key ?? KEY}`;
  const req = new Request(o.url ?? "https://x/api/public/fleet/x", { method, headers, body: method === "GET" ? undefined : JSON.stringify(o.body ?? {}) });
  return handler(req, {
    admin: db,
    env: o.env ?? ENV,
    today: () => "2026-11-27",
    gate: async () => o.gate ?? "send",
    store: o.store,
    audit: async (e: any) => {
      audits.push(e);
      db.state.audit_log.push({ action: e.action, entity_id: e.entityId, metadata: e.metadata, summary: e.summary });
    },
  }).then(async (r) => ({ status: r.status, json: (await r.json()) as any, audits, db }));
}

const create = (db: any, body: any, o: Parameters<typeof run>[2] = {}) => run(exp.handleFleetExpenseCreate, db, { ...o, body });
const list = (db: any, query: string, o: Parameters<typeof run>[2] = {}) =>
  run(exp.handleFleetExpenseList, db, { method: "GET", url: `https://x/api/public/fleet/vehicle-expenses?${query}`, ...o });
const good = { license_plate: "EC20LK", date: "2026-11-25", amount: 74.5, category: "repair", vendor: "Pep Boys", description: "Front brake pads", invoice_number: "INV-1001" };

describe("rules", () => {
  test("the category list matches the database check and Back Office Expenses", () => {
    const fn = readFileSync("src/lib/expenses.functions.ts", "utf8");
    const ui = [...fn.matchAll(/\{ value: "([a-z]+)", label:/g)].map((m) => m[1]);
    expect([...rules.FLEET_EXPENSE_CATEGORIES]).toEqual(ui);
    const mig = readFileSync("supabase/migrations/20260925161000_vehicle_expenses.sql", "utf8");
    const check = /category IN \(([\s\S]*?)\)\),/.exec(mig)![1];
    expect([...check.matchAll(/'([a-z]+)'/g)].map((m) => m[1])).toEqual(ui);
  });

  test("amount: positive, at most 2 decimals, numbers or plain numeric strings", () => {
    expect(rules.parseExpenseAmount(74.5)).toEqual({ ok: true, value: 74.5 });
    expect(rules.parseExpenseAmount("$1,000")).toMatchObject({ ok: false });
    expect(rules.parseExpenseAmount("120.25")).toEqual({ ok: true, value: 120.25 });
    for (const bad of [0, -5, "0", 74.555, "abc", null, NaN, 1_000_000.01, {}, true]) expect(rules.parseExpenseAmount(bad).ok).toBe(false);
  });

  test("date: real, not future, not more than 5 years old", () => {
    expect(rules.parseExpenseDate("2026-11-27", "2026-11-27").ok).toBe(true);
    for (const bad of ["2026-11-28", "2026-02-30", "11/25/2026", "", null, "2021-11-26", "2026-11-25T10:00:00Z"]) expect(rules.parseExpenseDate(bad, "2026-11-27").ok).toBe(false);
    expect(rules.parseExpenseDate("2021-11-28", "2026-11-27").ok).toBe(true);
  });

  test("an odometer must be a whole number in range", () => {
    expect(rules.parsePickupOdometer(163977)).toEqual({ ok: true, value: 163977 });
    expect(rules.parsePickupOdometer("5000")).toEqual({ ok: true, value: 5000 });
    for (const bad of [-1, 1.5, 2_000_000, "12.5", "abc", null]) expect(rules.parsePickupOdometer(bad).ok).toBe(false);
  });

  test("a label that names a standard angle sets it", () => {
    expect(rules.parseInspectionLabel("Driver side")).toMatchObject({ ok: true, value: { angle: "driver_side" } });
    expect(rules.parseInspectionLabel("Odometer")).toMatchObject({ ok: true, value: { angle: "odometer" } });
    expect(rules.parseInspectionLabel("Scratch on bumper")).toMatchObject({ ok: true, value: { angle: null } });
    expect(rules.parseInspectionLabel("  ").ok).toBe(false);
  });

  test("both switches default Off", () => {
    expect(cat.isDefaultOff("fleet_expenses")).toBe(true);
    expect(cat.isDefaultOff("fleet_rental_records")).toBe(true);
  });
});

describe("auth and switches", () => {
  const cases: Array<[string, (db: any, o: any) => Promise<Out>]> = [
    ["create", (db, o) => create(db, good, o)],
    ["list", (db, o) => list(db, "license_plate=EC20LK", o)],
    ["list (POST)", (db, o) => run(exp.handleFleetExpenseList, db, { ...o, body: { license_plate: "EC20LK" } })],
    ["photo", (db, o) => run(rec.handleFleetInspectionPhoto, db, { ...o, body: { rental_id: R1, stage: "pickup", label: "Front", content_base64: b64(JPG) } })],
    ["odometer", (db, o) => run(rec.handleFleetPickupOdometer, db, { ...o, method: "PATCH", body: { rental_id: R1, odometer: 5 } })],
  ];
  for (const [name, call] of cases) {
    test(`${name}: no key, wrong key and an unconfigured key are refused and nothing is read or written`, async () => {
      const db = fakeDb(seed());
      expect((await call(db, { key: null })).status).toBe(401);
      expect((await call(db, { key: "wrong".repeat(10) })).status).toBe(401);
      expect((await call(db, { env: {} })).status).toBe(503);
      expect(db.state.vehicle_expenses).toHaveLength(0);
      expect(db.state.audit_log).toHaveLength(0);
      expect(db.state.odometer_readings).toHaveLength(0);
      expect(db.objects.size).toBe(0);
    });
  }

  test("create is refused while Off or when the switches cannot be read; listing still works", async () => {
    const db = fakeDb(seed());
    const off = await create(db, good, { gate: "off" });
    expect(off.status).toBe(409);
    expect(off.json.reason).toBe("switched_off");
    expect((await create(db, good, { gate: "held" })).status).toBe(503);
    expect(db.state.vehicle_expenses).toHaveLength(0);
    expect((await list(db, "license_plate=EC20LK", { gate: "off" })).status).toBe(200);
    for (const [h, method] of [[rec.handleFleetInspectionPhoto, "POST"], [rec.handleFleetPickupOdometer, "PATCH"]] as const) {
      const r = await run(h as any, db, { method, gate: "off", body: { rental_id: R1, odometer: 5, stage: "pickup", label: "x", content_base64: b64(JPG) } });
      expect(r.status).toBe(409);
      expect(r.json.reason).toBe("switched_off");
    }
  });

  test("only POST creates; only GET or POST lists", async () => {
    const db = fakeDb(seed());
    expect((await run(exp.handleFleetExpenseCreate, db, { method: "GET" })).status).toBe(405);
    expect((await run(exp.handleFleetExpenseList, db, { method: "PATCH", body: {} })).status).toBe(405);
    expect((await run(rec.handleFleetInspectionPhoto, db, { method: "PATCH" })).status).toBe(405);
    expect((await run(rec.handleFleetPickupOdometer, db, { method: "DELETE" } as any)).status).toBe(405);
  });
});

describe("POST vehicle expense", () => {
  test("saves to vehicle_expenses by plate, matches the vendor, keeps the receipt the Back Office way, audits FLEET", async () => {
    const db = fakeDb(seed());
    const r = await create(db, { ...good, notes: "Replaced both front pads", receipt_base64: b64(PDF), receipt_file_name: "invoice 1001.pdf", payment_method: "card", idempotency_key: "exp-1" });
    expect(r.status).toBe(201);
    expect(r.json.ok).toBe(true);
    expect(r.json.expense).toMatchObject({ vehicle_id: V1, license_plate: "EC20LK", vin_last6: "123456", date: "2026-11-25", amount: 74.5, category: "repair", vendor: "Pep Boys", invoice_number: "INV-1001", has_receipt: true, created_by: "FLEET" });
    expect(r.json.vendor_matched).toBe(true);
    expect(r.json.duplicate_warnings).toEqual([]);
    expect(JSON.stringify(r.json)).not.toContain("UNIT-9");
    expect(JSON.stringify(r.json)).not.toContain("1HGCM82633A123456");

    const row = db.state.vehicle_expenses[0];
    expect(row).toMatchObject({ vehicle_id: V1, vendor_id: VENDOR, category: "repair", description: "Front brake pads", amount: 74.5, incurred_on: "2026-11-25", reference: "INV-1001", payment_method: "card", is_recurring: false, created_by: null, rental_id: null, receipt_name: "invoice 1001.pdf", receipt_mime: "application/pdf" });
    expect(row.notes).toBe("Replaced both front pads\nAdded by FLEET.");
    // Same path shape as Back Office: <vehicle>/<time>-<random>.<ext> in the receipts bucket.
    expect(row.receipt_path).toMatch(new RegExp(`^${V1}/\\d+-[a-z0-9]{1,6}\\.pdf$`));
    const obj = db.objects.get(`receipts/${row.receipt_path}`);
    expect(obj.contentType).toBe("application/pdf");
    expect([...obj.bytes]).toEqual([...PDF]);

    expect(r.audits).toHaveLength(1);
    expect(r.audits[0].action).toBe("expense.fleet_created");
    expect(r.audits[0].summary).toContain("FLEET (automated)");
    expect(r.audits[0].entityId).toBe(row.id);
    expect(r.audits[0].metadata).toMatchObject({ actor: "FLEET (automated)", vehicle_id: V1, amount: 74.5, has_receipt: true, idempotency_key: "exp-1" });
  });

  test("vehicle by id; an unmatched vendor is kept in the notes; no receipt means no file", async () => {
    const db = fakeDb(seed());
    const r = await create(db, { vehicle_id: V2, date: "2026-11-26", amount: "120.25", category: "Tires", vendor: "Bob's Tire Shop", description: "Two tires" });
    expect(r.status).toBe(201);
    expect(r.json.vendor_matched).toBe(false);
    expect(r.json.expense).toMatchObject({ vehicle_id: V2, vendor: "Bob's Tire Shop", category: "tires", has_receipt: false });
    const row = db.state.vehicle_expenses[0];
    expect(row.vendor_id).toBeNull();
    expect(row.notes).toBe("Vendor: Bob's Tire Shop\nAdded by FLEET.");
    expect(row.receipt_path).toBeNull();
    expect(db.objects.size).toBe(0);
  });

  test("notes can stand in for a missing description", async () => {
    const db = fakeDb(seed());
    const r = await create(db, { vehicle_id: V1, date: "2026-11-26", amount: 10, category: "other", notes: "Wiper blades" });
    expect(r.status).toBe(201);
    expect(db.state.vehicle_expenses[0].description).toBe("Wiper blades");
  });

  test("refuses bad input and saves nothing", async () => {
    const db = fakeDb(seed());
    const bad: Array<[string, any]> = [
      ["zero amount", { ...good, amount: 0 }],
      ["negative amount", { ...good, amount: -5 }],
      ["missing amount", { ...good, amount: undefined }],
      ["three decimals", { ...good, amount: 1.005 }],
      ["future date", { ...good, date: "2026-11-28" }],
      ["old date", { ...good, date: "2020-01-01" }],
      ["fake date", { ...good, date: "2026-02-30" }],
      ["bad category", { ...good, category: "snacks" }],
      ["no description or notes", { ...good, description: "" }],
      ["no vehicle", { ...good, license_plate: undefined }],
      ["bad vehicle id", { ...good, license_plate: undefined, vehicle_id: "nope" }],
      ["two different invoice numbers", { ...good, ticket_number: "OTHER-9" }],
      ["recurring not a boolean", { ...good, is_recurring: "yes" }],
      ["receipt not base64", { ...good, receipt_base64: "***" }],
      ["file name without a file", { ...good, receipt_file_name: "a.pdf" }],
      ["bad idempotency key", { ...good, idempotency_key: "x".repeat(121) }],
    ];
    for (const [name, body] of bad) {
      const r = await create(db, body);
      expect([name, r.status]).toEqual([name, 400]);
    }
    const text = await create(db, { ...good, receipt_base64: b64(GIF) });
    expect(text.status).toBe(415);
    expect(db.state.vehicle_expenses).toHaveLength(0);
    expect(db.state.audit_log).toHaveLength(0);
    expect(db.objects.size).toBe(0);
  });

  test("vehicle lookup refuses unknown, ambiguous, mismatched and archived vehicles", async () => {
    const db = fakeDb(seed());
    expect((await create(db, { ...good, license_plate: "NOPE99" })).status).toBe(404);
    const amb = await create(db, { ...good, license_plate: "dup 1" });
    expect(amb.status).toBe(409);
    expect(amb.json.error).toContain("More than one vehicle");
    expect((await create(db, { ...good, vehicle_id: V2, license_plate: "EC20LK" })).status).toBe(409);
    expect((await create(db, { ...good, license_plate: undefined, vehicle_id: "99999999-9999-4999-8999-999999999999" })).status).toBe(404);
    const arch = fakeDb(seed({ vehicles: [{ id: V1, license_plate: "EC20LK", vin: "1HGCM82633A123456", archived_at: "2026-01-01" }] }));
    expect((await create(arch, good)).status).toBe(409);
    expect(db.state.vehicle_expenses).toHaveLength(0);
    expect(arch.state.vehicle_expenses).toHaveLength(0);
  });

  test("a plate matches ignoring case, spaces and dashes", async () => {
    const db = fakeDb(seed());
    for (const p of ["ec20lk", "EC 20-LK", " Ec20Lk "]) {
      const r = await create(db, { ...good, license_plate: p, invoice_number: `X-${p.length}`, amount: 5 + p.length });
      expect(r.status).toBe(201);
      expect(r.json.expense.vehicle_id).toBe(V1);
    }
    const dash = await create(db, { ...good, license_plate: "DUP-1", amount: 9 });
    expect(dash.status).toBe(409); // DUP-1 and DUP1 are the same plate on two vehicles
  });

  test("idempotency: the same key and request returns the original; a different request is a 409", async () => {
    const db = fakeDb(seed());
    const first = await create(db, { ...good, receipt_base64: b64(JPG), idempotency_key: "k-1" });
    expect(first.status).toBe(201);
    const again = await create(db, { ...good, receipt_base64: b64(JPG), idempotency_key: "k-1" });
    expect(again.status).toBe(200);
    expect(again.json.duplicate).toBe(true);
    expect(again.json.matched_by).toBe("idempotency_key");
    expect(again.json.expense.id).toBe(first.json.expense.id);
    expect(again.json.expense.has_receipt).toBe(true);
    expect(db.state.vehicle_expenses).toHaveLength(1);
    expect(db.state.audit_log).toHaveLength(1);
    expect(db.objects.size).toBe(1);

    for (const change of [{ amount: 75 }, { date: "2026-11-24" }, { category: "maintenance" }, { vendor: "Other Shop" }, { description: "Rear pads" }, { license_plate: "ZZTOP1" }, { receipt_base64: b64(PNG) }, { receipt_base64: undefined }]) {
      const r = await create(db, { ...good, receipt_base64: b64(JPG), idempotency_key: "k-1", ...change });
      expect([JSON.stringify(Object.keys(change)), r.status]).toEqual([JSON.stringify(Object.keys(change)), 409]);
      expect(r.json.reason).toBe("idempotency_key_reused");
    }
    expect(db.state.vehicle_expenses).toHaveLength(1);
    expect(db.objects.size).toBe(1);
  });

  test("a replay after staff deleted the expense saves nothing again", async () => {
    const db = fakeDb(seed());
    const first = await create(db, { ...good, idempotency_key: "k-2" });
    db.state.vehicle_expenses.length = 0;
    const again = await create(db, { ...good, idempotency_key: "k-2" });
    expect(again.status).toBe(200);
    expect(again.json).toMatchObject({ duplicate: true, deleted: true, expense: null, expense_id: first.json.expense.id });
    expect(db.state.vehicle_expenses).toHaveLength(0);
  });

  test("likely duplicates are reported but never refused", async () => {
    const db = fakeDb(seed());
    const a = await create(db, good);
    expect(a.status).toBe(201);
    // Same vehicle, date, amount and vendor (no invoice number this time).
    const b = await create(db, { ...good, invoice_number: undefined, description: "Brake pads again" });
    expect(b.status).toBe(201);
    expect(b.json.duplicate_warnings).toEqual([expect.objectContaining({ expense_id: a.json.expense.id, reason: "same_vehicle_date_amount_vendor", same_vehicle: true })]);
    // Same invoice number, different everything else, other vehicle.
    const c = await create(db, { license_plate: "ZZTOP1", date: "2026-11-20", amount: 500, category: "other", description: "Shared bill", invoice_number: "inv 1001" });
    expect(c.status).toBe(201);
    const ids = c.json.duplicate_warnings.map((w: any) => [w.expense_id, w.reason, w.same_vehicle]);
    expect(ids).toContainEqual([a.json.expense.id, "same_invoice_number", false]);
    // Different vendor on the same vehicle/date/amount is not a likely duplicate.
    const d = await create(db, { ...good, invoice_number: undefined, vendor: "Jiffy Lube" });
    expect(d.status).toBe(201);
    expect(d.json.duplicate_warnings).toEqual([]);
    expect(db.state.vehicle_expenses).toHaveLength(4);
    // The warning is also on the audit row.
    expect(b.audits[0].metadata.duplicate_warnings).toEqual([a.json.expense.id]);
  });

  test("the same receipt file already filed on this vehicle is flagged", async () => {
    const db = fakeDb(seed());
    await create(db, { ...good, receipt_base64: b64(JPG) });
    const r = await create(db, { ...good, amount: 99, invoice_number: "OTHER", receipt_base64: b64(JPG) });
    expect(r.status).toBe(201);
    expect(r.json.warnings.some((w: string) => w.startsWith("same_receipt_file_already_on:"))).toBe(true);
  });
});

describe("GET vehicle expenses", () => {
  async function filled() {
    const db = fakeDb(seed({ vehicle_expenses: [{ id: "legacy-1", vehicle_id: V1, incurred_on: "2026-10-01", amount: 30, category: "maintenance", description: "Oil", vendor_id: VENDOR, reference: null, notes: null, receipt_path: `${V1}/1-a.jpg`, created_by: "u-1", created_at: "2026-10-01T10:00:00Z" }] }));
    await create(db, good);
    await create(db, { ...good, date: "2026-11-10", amount: 12.34, invoice_number: undefined, vendor: undefined, description: "Wipers", category: "other", receipt_base64: b64(PNG) });
    await create(db, { vehicle_id: V2, date: "2026-11-26", amount: 5, category: "fuel", description: "Other car" });
    return db;
  }

  test("by plate: id, date, amount, category, vendor, invoice number, has_receipt and created_by, newest first", async () => {
    const db = await filled();
    const r = await list(db, "license_plate=ec20lk");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, count: 3, truncated: false, total_amount: 116.84, vehicle: { vehicle_id: V1, license_plate: "EC20LK", vin_last6: "123456", archived: false } });
    expect(r.json.expenses.map((e: any) => e.date)).toEqual(["2026-11-25", "2026-11-10", "2026-10-01"]);
    expect(r.json.expenses[0]).toMatchObject({ amount: 74.5, category: "repair", vendor: "Pep Boys", invoice_number: "INV-1001", has_receipt: false, created_by: "FLEET" });
    expect(r.json.expenses[1]).toMatchObject({ has_receipt: true, created_by: "FLEET", vendor: null });
    expect(r.json.expenses[2]).toMatchObject({ id: "legacy-1", created_by: "Staff", has_receipt: true, vendor: "Pep Boys" });
    expect(JSON.stringify(r.json)).not.toContain("UNIT-9");
    expect(JSON.stringify(r.json)).not.toContain("1HGCM82633A123456");
    expect(JSON.stringify(r.json)).not.toContain("receipt_path");
  });

  test("by vehicle id with a date range and a limit; POST list gives the same answer", async () => {
    const db = await filled();
    const ranged = await list(db, `vehicle_id=${V1}&from=2026-11-01&to=2026-11-30`);
    expect(ranged.json.count).toBe(2);
    const one = await list(db, `vehicle_id=${V1}&limit=1`);
    expect(one.json).toMatchObject({ count: 1, truncated: true });
    const post = await run(exp.handleFleetExpenseList, db, { body: { vehicle_id: V1, from: "2026-11-01", to: "2026-11-30" } });
    expect(post.status).toBe(200);
    expect(post.json.expenses).toEqual(ranged.json.expenses);
  });

  test("refuses bad queries and unknown or ambiguous vehicles", async () => {
    const db = await filled();
    for (const q of ["license_plate=EC20LK&from=2026-13-01", "license_plate=EC20LK&to=nope", "license_plate=EC20LK&from=2026-11-30&to=2026-11-01", "license_plate=EC20LK&limit=0", "license_plate=EC20LK&limit=501", ""]) expect([q, (await list(db, q)).status]).toEqual([q, 400]);
    expect((await list(db, "license_plate=NOPE99")).status).toBe(404);
    expect((await list(db, "license_plate=DUP1")).status).toBe(409);
  });

  test("an archived vehicle can still be listed", async () => {
    const db = fakeDb(seed({ vehicles: [{ id: V1, license_plate: "EC20LK", vin: "1HGCM82633A123456", archived_at: "2026-01-01" }] }));
    const r = await list(db, "license_plate=EC20LK");
    expect(r.status).toBe(200);
    expect(r.json.vehicle.archived).toBe(true);
  });
});

describe("POST rental inspection photo", () => {
  const photo = (db: any, body: any, o: Parameters<typeof run>[2] = {}) => {
    const stored: any[] = [];
    return run(rec.handleFleetInspectionPhoto, db, {
      ...o,
      body,
      store: async (_a: any, args: any) => {
        stored.push(args);
        return { id: `cm-${stored.length}`, missingExifTime: true, sharePreview: true };
      },
    }).then((r) => ({ ...r, stored }));
  };

  test("pickup photo: staff-captured (Ours), checkout phase, bound to the rental, original uploaded, renter not notified", async () => {
    const db = fakeDb(seed());
    const r = await photo(db, { rental_id: R1, stage: "pickup", label: "Driver side", content_base64: b64(JPG), file_name: "IMG_1.jpg", idempotency_key: "ph-1" });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ ok: true, photo_id: "cm-1", rental_id: R1, license_plate: "EC20LK", vin_last6: "123456", stage: "pickup", label: "Driver side", shown_as: "Ours", renter_preview: true, renter_notified: false });
    const a = r.stored[0];
    expect(a).toMatchObject({ vehicleId: V1, rentalId: R1, applicationId: APP, phase: "checkout", angle: "driver_side", capturedByRole: "staff", capturedBy: null, mimeType: "image/jpeg", caption: "Driver side", fileName: "IMG_1.jpg" });
    expect(a.path).toMatch(new RegExp(`^${V1}/trip/${APP}/${R1}/checkout-[0-9a-f-]{36}\\.jpg$`));
    expect(db.objects.get(`condition-media/${a.path}`)?.contentType).toBe("image/jpeg");
    expect(r.audits[0]).toMatchObject({ action: "fleet.rental_inspection_photo", entityType: "rental", entityId: R1 });
    expect(r.audits[0].summary).toContain("FLEET (automated)");
    expect(r.audits[0].summary).toContain("Renter not notified");
    // Nothing else was written: no notification, message or payment row.
    expect(Object.keys(db.state).sort()).toEqual(["audit_log", "condition_media", "odometer_readings", "rentals", "vehicle_expenses", "vehicles", "vendors"]);
  });

  test("return photo uses the checkin phase; a free-text label sets no angle", async () => {
    const db = fakeDb(seed());
    const r = await photo(db, { rental_id: R1, stage: "return", label: "Scratch on rear bumper", content_base64: b64(PNG) });
    expect(r.status).toBe(201);
    expect(r.stored[0]).toMatchObject({ phase: "checkin", angle: null, caption: "Scratch on rear bumper", mimeType: "image/png" });
  });

  test("a rental with no application still files (neutral folder)", async () => {
    const db = fakeDb(seed({ rentals: [{ id: R3, vehicle_id: V1, driver_id: "d", application_id: null, status: "closed" }] }));
    const r = await photo(db, { rental_id: R3, stage: "return", label: "Front", content_base64: b64(JPG) });
    expect(r.status).toBe(201);
    expect(r.stored[0].applicationId).toBeNull();
    expect(r.stored[0].path).toContain(`/trip/no-application/${R3}/`);
  });

  test("idempotency: the same key returns the original; a different photo under the key is a 409; the same bytes are never filed twice", async () => {
    const db = fakeDb(seed());
    const first = await photo(db, { rental_id: R1, stage: "pickup", label: "Front", content_base64: b64(JPG), idempotency_key: "ph-2" });
    const again = await photo(db, { rental_id: R1, stage: "pickup", label: "Front", content_base64: b64(JPG), idempotency_key: "ph-2" });
    expect(again.status).toBe(200);
    expect(again.json).toMatchObject({ duplicate: true, photo_id: first.json.photo_id });
    expect(again.stored).toHaveLength(0);
    const other = await photo(db, { rental_id: R1, stage: "pickup", label: "Front", content_base64: b64(PNG), idempotency_key: "ph-2" });
    expect(other.status).toBe(409);
    const diffStage = await photo(db, { rental_id: R1, stage: "return", label: "Front", content_base64: b64(JPG), idempotency_key: "ph-2" });
    expect(diffStage.status).toBe(409);
    const sameBytes = await photo(db, { rental_id: R1, stage: "pickup", label: "Rear", content_base64: b64(JPG) });
    expect(sameBytes.status).toBe(200);
    expect(sameBytes.json).toMatchObject({ duplicate: true, matched_by: "content" });
    // The same bytes as a return photo is a different record.
    const asReturn = await photo(db, { rental_id: R1, stage: "return", label: "Front", content_base64: b64(JPG) });
    expect(asReturn.status).toBe(201);
    expect(db.state.audit_log.filter((x: any) => x.action === "fleet.rental_inspection_photo")).toHaveLength(2);
  });

  test("refuses bad input, unknown or cancelled rentals, and non-photos", async () => {
    const db = fakeDb(seed());
    const base = { rental_id: R1, stage: "pickup", label: "Front", content_base64: b64(JPG) };
    const cases: Array<[string, any, number]> = [
      ["bad stage", { ...base, stage: "during" }, 400],
      ["no label", { ...base, label: "" }, 400],
      ["no image", { ...base, content_base64: undefined }, 400],
      ["not base64", { ...base, content_base64: "***" }, 400],
      ["pdf", { ...base, content_base64: b64(PDF) }, 415],
      ["gif", { ...base, content_base64: b64(GIF) }, 415],
      ["bad rental id", { ...base, rental_id: "x" }, 400],
      ["unknown rental", { ...base, rental_id: "99999999-9999-4999-8999-999999999999" }, 404],
      ["cancelled rental", { ...base, rental_id: R2 }, 409],
      ["bad key", { ...base, idempotency_key: "k".repeat(200) }, 400],
    ];
    for (const [name, body, status] of cases) expect([name, (await photo(db, body)).status]).toEqual([name, status]);
    expect(db.objects.size).toBe(0);
    expect(db.state.audit_log).toHaveLength(0);
  });

  test("a failed save removes the stored original", async () => {
    const db = fakeDb(seed());
    const r = await run(rec.handleFleetInspectionPhoto, db, {
      body: { rental_id: R1, stage: "pickup", label: "Front", content_base64: b64(JPG) },
      store: async () => {
        throw new Error("boom");
      },
    });
    expect(r.status).toBe(503);
    expect(db.objects.size).toBe(0);
    expect(db.state.audit_log).toHaveLength(0);
  });

  test("the default save step is the staff trip-media one, which strips GPS from the renter copy", () => {
    const src = readFileSync("src/lib/fleet-rental-records.server.ts", "utf8");
    expect(src).toContain('import("@/lib/trip-media.server")');
    expect(src).toContain("storeConditionMedia");
    const store = readFileSync("src/lib/trip-media.server.ts", "utf8");
    expect(store).toMatch(/buildShareCopy[\s\S]*shareCopyIsClean/);
    expect(src).not.toMatch(/sendEmail|sendSms|quo-sms|notify/i);
  });
});

describe("PATCH rental pickup odometer", () => {
  const patch = (db: any, body: any, o: Parameters<typeof run>[2] = {}) => run(rec.handleFleetPickupOdometer, db, { method: "PATCH", body, ...o });
  const withPickup = (mileage: number, extra: Record<string, Row[]> = {}) =>
    seed({
      odometer_readings: [{ id: "odo-1", vehicle_id: V1, mileage, observed_on: "2026-11-20", observed_at: "2026-11-20T15:00:00Z", status: "valid", source_type: "rental_checkout", rental_id: R1 }],
      rentals: [{ id: R1, vehicle_id: V1, driver_id: "drv-1", application_id: APP, status: "active", start_date: "2026-11-20", pickup_reading_id: "odo-1", return_reading_id: null }],
      ...extra,
    });

  test("a rental with no pickup reading gets one, dated the pickup day, and the rental points at it", async () => {
    const db = fakeDb(seed());
    const r = await patch(db, { rental_id: R1, odometer: 163977 });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, rental_id: R1, license_plate: "EC20LK", pickup_odometer: 163977, previous_odometer: null, status: "valid" });
    const reading = db.state.odometer_readings[0];
    expect(reading).toMatchObject({ vehicle_id: V1, mileage: 163977, observed_on: "2026-11-20", source_type: "rental_checkout", rental_id: R1, driver_id: "drv-1", entered_by: null, supersedes_id: null });
    expect(db.state.rentals.find((x: any) => x.id === R1).pickup_reading_id).toBe(reading.id);
    expect(r.audits[0]).toMatchObject({ action: "fleet.rental_pickup_odometer", entityType: "rental", entityId: R1 });
    expect(r.audits[0].summary).toContain("FLEET (automated)");
  });

  test("raising it adds a correcting reading, keeps the old one as history and repoints the rental", async () => {
    const db = fakeDb(withPickup(163000));
    const r = await patch(db, { rental_id: R1, odometer: 163977 });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ pickup_odometer: 163977, previous_odometer: 163000, superseded_reading_id: "odo-1" });
    const old = db.state.odometer_readings.find((x: any) => x.id === "odo-1");
    expect(old.status).toBe("superseded");
    expect(old.mileage).toBe(163000); // a reading is never edited
    const fresh = db.state.odometer_readings.find((x: any) => x.id !== "odo-1");
    expect(fresh).toMatchObject({ mileage: 163977, status: "valid", supersedes_id: "odo-1", observed_on: "2026-11-20", source_type: "rental_checkout" });
    expect(db.state.rentals.find((x: any) => x.id === R1).pickup_reading_id).toBe(fresh.id);
    expect(r.audits[0].metadata).toMatchObject({ odometer: 163977, previous: 163000, forced: false });
  });

  test("lowering is refused without force; force also needs a note; with both it goes through", async () => {
    const db = fakeDb(withPickup(163977));
    const no = await patch(db, { rental_id: R1, odometer: 163000 });
    expect(no.status).toBe(409);
    expect(no.json.reason).toBe("would_lower");
    expect(no.json.pickup_odometer).toBe(163977);
    const noNote = await patch(db, { rental_id: R1, odometer: 163000, force: true });
    expect(noNote.status).toBe(400);
    expect(db.state.odometer_readings).toHaveLength(1);
    expect(db.state.odometer_readings[0].status).toBe("valid");
    const bad = await patch(db, { rental_id: R1, odometer: 163000, force: "yes" });
    expect(bad.status).toBe(400);
    const ok = await patch(db, { rental_id: R1, odometer: 163000, force: true, note: "Typo: photo shows 163000" });
    expect(ok.status).toBe(200);
    expect(ok.json).toMatchObject({ pickup_odometer: 163000, previous_odometer: 163977 });
    expect(ok.audits[0].metadata).toMatchObject({ forced: true, note: "Typo: photo shows 163000" });
    expect(ok.audits[0].summary).toContain("lowered with force");
  });

  test("the same number changes nothing", async () => {
    const db = fakeDb(withPickup(5000));
    const r = await patch(db, { rental_id: R1, odometer: 5000 });
    expect(r.status).toBe(200);
    expect(r.json.unchanged).toBe(true);
    expect(db.state.odometer_readings).toHaveLength(1);
    expect(r.audits).toHaveLength(0);
  });

  test("refuses a pickup above the rental's return reading, and one far below the vehicle's earlier history", async () => {
    const db = fakeDb(
      withPickup(100, {
        odometer_readings: [
          { id: "odo-1", vehicle_id: V1, mileage: 100, observed_on: "2026-11-20", status: "valid", rental_id: R1 },
          { id: "odo-ret", vehicle_id: V1, mileage: 900, observed_on: "2026-11-25", status: "valid", rental_id: R1 },
          { id: "odo-old", vehicle_id: V1, mileage: 50000, observed_on: "2026-10-01", status: "valid" },
          { id: "odo-future", vehicle_id: V1, mileage: 90000, observed_on: "2026-12-30", status: "valid" },
        ],
        rentals: [{ id: R1, vehicle_id: V1, driver_id: "d", application_id: APP, status: "closed", start_date: "2026-11-20", pickup_reading_id: "odo-1", return_reading_id: "odo-ret" }],
      }),
    );
    const above = await patch(db, { rental_id: R1, odometer: 51000 });
    expect(above.status).toBe(409);
    expect(above.json.reason).toBe("above_return");
    const below = await patch(db, { rental_id: R1, odometer: 800 });
    expect(below.status).toBe(409);
    expect(below.json.reason).toBe("below_vehicle_history");
    expect(below.json.highest_reading).toBe(50000);
    expect(db.state.odometer_readings.find((x: any) => x.id === "odo-1").status).toBe("valid");
    // A later-dated higher reading (another rental, after this pickup) is normal and does not block.
    const db2 = fakeDb(withPickup(100, { odometer_readings: [{ id: "odo-1", vehicle_id: V1, mileage: 100, observed_on: "2026-11-20", status: "valid", rental_id: R1 }, { id: "odo-later", vehicle_id: V1, mileage: 70000, observed_on: "2026-11-26", status: "valid" }] }));
    expect((await patch(db2, { rental_id: R1, odometer: 150 })).status).toBe(200);
  });

  test("idempotency: the same key returns the original; a different number under it is a 409", async () => {
    const db = fakeDb(withPickup(163000));
    const first = await patch(db, { rental_id: R1, odometer: 163500, idempotency_key: "od-1" });
    expect(first.status).toBe(200);
    const again = await patch(db, { rental_id: R1, odometer: 163500, idempotency_key: "od-1" });
    expect(again.status).toBe(200);
    expect(again.json).toMatchObject({ duplicate: true, pickup_odometer: 163500, reading_id: first.json.reading_id });
    expect(db.state.odometer_readings).toHaveLength(2);
    const other = await patch(db, { rental_id: R1, odometer: 163600, idempotency_key: "od-1" });
    expect(other.status).toBe(409);
    expect(db.state.odometer_readings).toHaveLength(2);
  });

  test("refuses bad input and unknown, cancelled or vehicle-less rentals; POST is accepted as well as PATCH", async () => {
    const db = fakeDb(seed({ rentals: [...seed().rentals, { id: "11111111-1111-4111-8111-111111111111", vehicle_id: null, driver_id: "d", status: "reserved" }] }));
    for (const [name, body, status] of [
      ["no odometer", { rental_id: R1 }, 400],
      ["decimal", { rental_id: R1, odometer: 12.5 }, 400],
      ["negative", { rental_id: R1, odometer: -1 }, 400],
      ["huge", { rental_id: R1, odometer: 5_000_000 }, 400],
      ["bad id", { rental_id: "x", odometer: 5 }, 400],
      ["unknown", { rental_id: "99999999-9999-4999-8999-999999999999", odometer: 5 }, 404],
      ["cancelled", { rental_id: R2, odometer: 5 }, 409],
      ["no vehicle", { rental_id: "11111111-1111-4111-8111-111111111111", odometer: 5 }, 409],
    ] as Array<[string, any, number]>) expect([name, (await patch(db, body)).status]).toEqual([name, status]);
    expect(db.state.odometer_readings).toHaveLength(0);
    const viaPost = await run(rec.handleFleetPickupOdometer, db, { method: "POST", body: { rental_id: R1, odometer: 77 } });
    expect(viaPost.status).toBe(200);
  });

  test("a failed link puts everything back", async () => {
    const db = fakeDb(withPickup(163000));
    // The rental's pointer moves under us between the read and the link.
    const real = db.from;
    let swapped = false;
    (db as any).from = (t: string) => {
      const q = real(t);
      if (t === "rentals" && !swapped) {
        const upd = q.update;
        q.update = (p: any) => {
          swapped = true;
          db.state.rentals.find((x: any) => x.id === R1).pickup_reading_id = "someone-else";
          return upd(p);
        };
      }
      return q;
    };
    const r = await patch(db, { rental_id: R1, odometer: 163500 });
    expect(r.status).toBe(409);
    expect(r.json.reason).toBe("changed_concurrently");
    expect(db.state.odometer_readings.find((x: any) => x.id === "odo-1").status).toBe("valid");
    expect(db.state.odometer_readings.filter((x: any) => x.status === "valid")).toHaveLength(1);
    expect(r.audits).toHaveLength(0);
  });
});
