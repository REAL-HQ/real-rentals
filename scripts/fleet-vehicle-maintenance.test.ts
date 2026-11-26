// FLEET mileage log, oil next service due, and monthly inspection.
// Network refused; fake database and storage. Nothing here writes production.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

process.env.SUPABASE_URL ??= "http://127.0.0.1:9";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "dummy";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "dummy";
globalThis.fetch = (async (url: any) => {
  throw new Error(`network refused in test: ${url}`);
}) as any;

const api = await import("@/lib/fleet-vehicle-maintenance.server");
const rules = await import("@/lib/vehicle-maintenance");
const cat = await import("@/lib/automation-catalog");

type Row = Record<string, any>;
const pick = (r: Row, c: string) => {
  const m = /^(\w+)->>(\w+)$/.exec(c);
  return m
    ? r[m[1]] == null
      ? undefined
      : r[m[1]][m[2]] == null
        ? undefined
        : String(r[m[1]][m[2]])
    : r[c];
};

function fakeDb(seed: Record<string, Row[]>) {
  const state: Record<string, Row[]> = JSON.parse(JSON.stringify(seed));
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  const writes: Array<{ table: string; op: string }> = [];
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
      insert: (r: Row) => {
        op = "insert";
        payload = r;
        return q;
      },
      update: (r: Row) => {
        op = "update";
        payload = r;
        return q;
      },
      upsert: (r: Row) => {
        op = "upsert";
        payload = r;
        return q;
      },
      eq: (c: string, v: any) => {
        filters.push((r) => pick(r, c) === v || r[c] === v);
        return q;
      },
      ilike: (c: string, v: any) => {
        filters.push((r) => String(r[c] ?? "").toLowerCase() === String(v ?? "").toLowerCase());
        return q;
      },
      is: (c: string, v: any) => {
        filters.push((r) => (v === null ? r[c] == null : r[c] === v));
        return q;
      },
      in: (c: string, v: any[]) => {
        filters.push((r) => v.includes(r[c]));
        return q;
      },
      order: (c: string, opts?: { ascending?: boolean }) => {
        sorts.push({ c, asc: opts?.ascending !== false });
        return q;
      },
      limit: (x: number) => {
        lim = x;
        return q;
      },
      maybeSingle: () => {
        single = true;
        return q;
      },
      single: () => {
        single = true;
        return q;
      },
      then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
    };
    function run() {
      const rows = state[table];
      const matched = () => rows.filter((r) => filters.every((fn) => fn(r)));
      if (op === "insert") {
        writes.push({ table, op });
        if (payload?.evidence_key && rows.some((r) => r.evidence_key === payload.evidence_key)) {
          return {
            data: null,
            error: { message: "duplicate key value violates unique constraint" },
          };
        }
        const row = {
          id: `${table}-${n++}`,
          status: table === "odometer_readings" ? "valid" : undefined,
          is_active: true,
          ...payload,
        };
        rows.push(row);
        return { data: single ? row : null, error: null };
      }
      if (op === "update") {
        writes.push({ table, op });
        const hit = matched();
        for (const row of hit) Object.assign(row, payload);
        return { data: null, error: null };
      }
      if (op === "upsert") {
        writes.push({ table, op });
        rows.push({ id: `${table}-${n++}`, ...payload });
        return { data: null, error: null };
      }
      let m = matched();
      if (sorts.length) {
        m = [...m].sort((a, b) => {
          for (const s of sorts) {
            const av = a[s.c] ?? "";
            const bv = b[s.c] ?? "";
            if (av === bv) continue;
            const cmp = av < bv ? -1 : 1;
            return s.asc ? cmp : -cmp;
          }
          return 0;
        });
      }
      if (lim != null) m = m.slice(0, lim);
      return { data: single ? (m[0] ?? null) : m, error: null };
    }
    return q;
  }
  const storage = {
    from: () => ({
      upload: async (path: string, bytes: Uint8Array, o: any) => {
        objects.set(path, { bytes, contentType: o?.contentType });
        return { data: { path }, error: null };
      },
      download: async (path: string) => {
        const hit = objects.get(path);
        if (!hit) return { data: null, error: { message: "missing" } };
        return {
          data: {
            arrayBuffer: async () =>
              hit.bytes.buffer.slice(
                hit.bytes.byteOffset,
                hit.bytes.byteOffset + hit.bytes.byteLength,
              ),
          },
          error: null,
        };
      },
      remove: async (paths: string[]) => {
        for (const p of paths) objects.delete(p);
        return { data: [], error: null };
      },
    }),
  };
  return { from, storage, state, objects, writes };
}

const KEY = "k".repeat(40);
const ENV = { FLEET_API_KEY: KEY };
const V = "ca3d2cc6-0144-4efa-b0d6-5091b27db254";
const OTHER = "22222222-2222-4222-8222-222222222222";
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0]);
const PDF = new TextEncoder().encode("%PDF-1.7\n");
const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");

function seed(extra: Record<string, Row[]> = {}) {
  return {
    vehicles: [
      {
        id: V,
        license_plate: "EC20LK",
        vin: "1HGCM82633A123456",
        unit_number: "UNIT-9",
        year: 2018,
        make: "Honda",
        model: "Accord",
        current_odometer: 1000,
        odometer_updated_at: null,
        oil_interval_miles: 5000,
        archived_at: null,
      },
      {
        id: OTHER,
        license_plate: "ZZTOP1",
        vin: "WBAFR9C50BC123999",
        unit_number: "UNIT-2",
        year: 2014,
        make: "BMW",
        model: "528",
        current_odometer: null,
        oil_interval_miles: 5000,
        archived_at: "2026-01-01",
      },
    ],
    maintenance_schedules: [],
    maintenance_records: [],
    odometer_readings: [],
    documents: [],
    document_vehicle_links: [],
    audit_log: [],
    vehicle_expenses: [],
    ...extra,
  };
}

function call(
  path: string,
  handler: (req: Request, deps: any) => Promise<Response>,
  db: any,
  body: any,
  o: { gate?: "send" | "off" | "held"; key?: string } = {},
) {
  const audits: any[] = [];
  const req = new Request(`https://x/api/public/fleet/${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${o.key ?? KEY}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return handler(req, {
    admin: db,
    env: ENV,
    today: () => "2026-11-23",
    gate: async () => o.gate ?? "send",
    audit: async (e: any) => {
      audits.push(e);
      db.state.audit_log.push({ action: e.action, entity_id: e.entityId, metadata: e.metadata });
    },
  }).then(async (r) => ({ status: r.status, json: (await r.json()) as any, audits, db }));
}

describe("vehicle maintenance rules", () => {
  test("shapes a vehicle without the unit number or the full VIN", () => {
    const view = rules.shapeVehicleMaintenance({
      vehicle: {
        id: V,
        license_plate: "ec20lk",
        vin: "1HGCM82633A123456",
        unit_number: "UNIT-9",
        year: 2018,
        make: "Honda",
        model: "Accord",
        current_odometer: 163977,
      },
      schedules: [
        {
          id: "s1",
          item: "Oil change",
          next_due_miles: 166869,
          next_due_on: null,
          interval_miles: 5000,
          is_active: true,
        },
      ],
      readings: [
        {
          id: "r1",
          mileage: 163977,
          observed_on: "2026-11-23",
          source_type: "manual",
          status: "valid",
          evidence_key: "fleet:mileage:k",
        },
      ],
      records: [
        {
          id: "m1",
          item: "Monthly Inspection",
          performed_on: "2026-11-01",
          notes: "All clear",
          document_id: "d1",
        },
      ],
    });
    expect(view.vehicle.license_plate).toBe("EC20LK");
    expect(view.vehicle.vin_last6).toBe("123456");
    expect((view.vehicle as any).unit_number).toBeUndefined();
    expect(JSON.stringify(view)).not.toContain("UNIT-9");
    expect(JSON.stringify(view)).not.toContain("1HGCM82633A123456");
    expect(view.next_service_due.item).toBe("Oil Change");
    expect(view.next_service_due.next_due_miles).toBe(166869);
    expect(view.mileage_log[0].source_label).toBe("FLEET · Manual");
    expect(view.monthly_inspection.interval_days).toBe(30);
    expect(view.monthly_inspection.history[0].has_photo).toBe(true);
  });

  test("parsers accept the first planned oil due and refuse a future reading", () => {
    const due = rules.parseServiceDueWrite({ next_due_miles: 166869 });
    expect(due.ok && due.value.nextDueMiles).toBe(166869);
    const reading = rules.parseMileageWrite(
      { observed_on: "2026-11-23", mileage: 163977 },
      "2026-11-23",
    );
    expect(reading.ok && reading.value.mileage).toBe(163977);
    const future = rules.parseMileageWrite({ observed_on: "2026-11-24", mileage: 1 }, "2026-11-23");
    expect(future.ok).toBe(false);
    expect(rules.sniffMaintenancePhoto(JPG)?.mime).toBe("image/jpeg");
    expect(rules.sniffMaintenancePhoto(PDF)).toBeNull();
    expect(rules.MONTHLY_INTERVAL_DAYS).toBe(30);
    expect(rules.MAINTENANCE_PHOTO_MAX_BYTES).toBe(20 * 1024 * 1024);
  });
});

describe("FLEET vehicle maintenance API", () => {
  test("the Automations switch defaults Off and writes are refused while Off", async () => {
    expect(cat.isDefaultOff("fleet_vehicle_maintenance")).toBe(true);
    const db = fakeDb(seed());
    const r = await call(
      "mileage-reading",
      api.handleFleetMileageReading,
      db,
      { license_plate: "EC20LK", observed_on: "2026-11-23", mileage: 163977 },
      { gate: "off" },
    );
    expect(r.status).toBe(409);
    expect(r.json.reason).toBe("switched_off");
    expect(db.state.odometer_readings).toHaveLength(0);
    const held = await call(
      "service-due",
      api.handleFleetServiceDue,
      db,
      { license_plate: "EC20LK", next_due_miles: 166869 },
      { gate: "held" },
    );
    expect(held.status).toBe(503);
    expect(held.json.reason).toBe("controls_unreadable");
    expect(db.writes.some((w) => w.table === "vehicles" && w.op === "update")).toBe(false);
  });

  test("requires the FLEET key and a real vehicle", async () => {
    const db = fakeDb(seed());
    const denied = await call(
      "vehicle-maintenance",
      api.handleFleetVehicleMaintenance,
      db,
      { license_plate: "EC20LK" },
      { key: "nope".repeat(8) },
    );
    expect(denied.status).toBe(401);
    const missing = await call("vehicle-maintenance", api.handleFleetVehicleMaintenance, db, {
      license_plate: "NOCAR1",
    });
    expect(missing.status).toBe(404);
    const archived = await call("vehicle-maintenance", api.handleFleetVehicleMaintenance, db, {
      license_plate: "ZZTOP1",
    });
    expect(archived.status).toBe(409);
  });

  test("reads the log, oil due, and monthly inspection without the unit number", async () => {
    const db = fakeDb(
      seed({
        odometer_readings: [
          {
            id: "read-1",
            vehicle_id: V,
            mileage: 163977,
            observed_on: "2026-11-23",
            source_type: "manual",
            status: "valid",
            note: null,
            document_id: null,
            evidence_key: "fleet:mileage:old",
          },
        ],
        maintenance_schedules: [
          {
            id: "sch-oil",
            vehicle_id: V,
            item: "Oil Change",
            interval_miles: 5000,
            interval_days: null,
            next_due_miles: 166869,
            next_due_on: null,
            last_done_on: null,
            last_done_miles: null,
            notes: null,
            is_active: true,
          },
        ],
      }),
    );
    const r = await call("vehicle-maintenance", api.handleFleetVehicleMaintenance, db, {
      license_plate: "ec20lk",
    });
    expect(r.status).toBe(200);
    expect(r.json.vehicle.license_plate).toBe("EC20LK");
    expect(r.json.vehicle.vin_last6).toBe("123456");
    expect(r.json.vehicle.unit_number).toBeUndefined();
    expect(JSON.stringify(r.json)).not.toContain("UNIT-9");
    expect(r.json.mileage_log[0].mileage).toBe(163977);
    expect(r.json.mileage_log[0].source_label).toBe("FLEET · Manual");
    expect(r.json.next_service_due.next_due_miles).toBe(166869);
    expect(r.json.monthly_inspection.item).toBe("Monthly Inspection");
    expect(r.json.monthly_inspection.schedule_id).toBeNull();
    expect(db.writes.filter((w) => w.op !== "select")).toHaveLength(0);
  });

  test("appends a mileage reading and an optional photo without editing current mileage", async () => {
    const db = fakeDb(seed());
    const r = await call("mileage-reading", api.handleFleetMileageReading, db, {
      vehicle_id: V,
      license_plate: "EC20LK",
      observed_on: "2026-11-23",
      mileage: 163977,
      note: "Shop reading",
      idempotency_key: "ec20lk-odo-1",
      file_name: "odo.jpg",
      content_base64: b64(JPG),
    });
    expect(r.status).toBe(201);
    expect(r.json.mileage).toBe(163977);
    expect(r.json.source_type).toBe("odometer_photo");
    expect(r.json.has_photo).toBe(true);
    expect(r.json.vin_last6).toBe("123456");
    expect(db.state.odometer_readings).toHaveLength(1);
    expect(db.state.odometer_readings[0].mileage).toBe(163977);
    expect(db.state.odometer_readings[0].source_type).toBe("odometer_photo");
    expect(db.state.odometer_readings[0].vehicle_id).toBe(V);
    expect(db.state.documents[0].kind).toBe("odometer_photo");
    expect(db.state.documents[0].visibility).toEqual(["admin"]);
    expect(db.state.vehicles.find((v: Row) => v.id === V).current_odometer).toBe(1000);
    expect(db.writes.some((w) => w.table === "vehicles" && w.op === "update")).toBe(false);
    expect(db.state.vehicle_expenses).toHaveLength(0);
    expect(r.audits[0].summary.startsWith("FLEET (automated)")).toBe(true);
    const again = await call("mileage-reading", api.handleFleetMileageReading, db, {
      license_plate: "EC20LK",
      observed_on: "2026-11-23",
      mileage: 163977,
      idempotency_key: "ec20lk-odo-1",
    });
    expect(again.status).toBe(200);
    expect(again.json.duplicate).toBe(true);
    expect(db.state.odometer_readings).toHaveLength(1);
    const clash = await call("mileage-reading", api.handleFleetMileageReading, db, {
      license_plate: "EC20LK",
      observed_on: "2026-11-22",
      mileage: 1,
      idempotency_key: "ec20lk-odo-1",
    });
    expect(clash.status).toBe(409);
  });

  test("refuses a PDF photo, a future date, and rental source types", async () => {
    const db = fakeDb(seed());
    const pdf = await call("mileage-reading", api.handleFleetMileageReading, db, {
      license_plate: "EC20LK",
      observed_on: "2026-11-23",
      mileage: 10,
      content_base64: b64(PDF),
    });
    expect(pdf.status).toBe(415);
    expect(db.state.odometer_readings).toHaveLength(0);
    const future = await call("mileage-reading", api.handleFleetMileageReading, db, {
      license_plate: "EC20LK",
      observed_on: "2026-12-01",
      mileage: 10,
    });
    expect(future.status).toBe(400);
    const rental = await call("mileage-reading", api.handleFleetMileageReading, db, {
      license_plate: "EC20LK",
      observed_on: "2026-11-23",
      mileage: 10,
      source_type: "rental_checkout",
    });
    expect(rental.status).toBe(400);
  });

  test("sets next oil service due miles without a last oil change", async () => {
    const db = fakeDb(seed());
    const r = await call("service-due", api.handleFleetServiceDue, db, {
      license_plate: "EC20LK",
      next_due_miles: 166869,
      idempotency_key: "ec20lk-due-1",
    });
    expect(r.status).toBe(201);
    expect(r.json.item).toBe("Oil Change");
    expect(r.json.next_due_miles).toBe(166869);
    expect(r.json.interval_miles).toBe(5000);
    expect(r.json.next_due_on).toBeNull();
    const row = db.state.maintenance_schedules[0];
    expect(row.item).toBe("Oil Change");
    expect(row.next_due_miles).toBe(166869);
    expect(row.last_done_miles).toBeUndefined();
    expect(db.state.vehicles.find((v: Row) => v.id === V).current_odometer).toBe(1000);
    expect(db.writes.some((w) => w.table === "vehicles" && w.op === "update")).toBe(false);
    const again = await call("service-due", api.handleFleetServiceDue, db, {
      license_plate: "EC20LK",
      next_due_miles: 166869,
      idempotency_key: "ec20lk-due-1",
    });
    expect(again.status).toBe(200);
    expect(again.json.duplicate).toBe(true);
    expect(db.state.maintenance_schedules).toHaveLength(1);
  });

  test("records a monthly inspection with notes, history, and no expense", async () => {
    const db = fakeDb(seed());
    const r = await call("monthly-inspection", api.handleFleetMonthlyInspection, db, {
      vehicle_id: V,
      last_done_on: "2026-11-01",
      next_due_on: "2026-12-01",
      notes: "All clear",
      odometer: 163000,
      file_name: "check.jpg",
      content_base64: b64(JPG),
      idempotency_key: "ec20lk-month-1",
    });
    expect(r.status).toBe(201);
    expect(r.json.item).toBe("Monthly Inspection");
    expect(r.json.interval_days).toBe(30);
    expect(r.json.last_done_on).toBe("2026-11-01");
    expect(r.json.next_due_on).toBe("2026-12-01");
    expect(r.json.has_photo).toBe(true);
    expect(r.json.record_id).toBeTruthy();
    expect(db.state.maintenance_schedules[0].interval_days).toBe(30);
    expect(db.state.maintenance_records).toHaveLength(1);
    expect(db.state.maintenance_records[0].item).toBe("Monthly Inspection");
    expect(db.state.maintenance_records[0].total_cost).toBe(0);
    expect(db.state.maintenance_records[0].notes).toBe("All clear");
    expect(db.state.odometer_readings[0].source_type).toBe("inspection");
    expect(db.state.odometer_readings[0].mileage).toBe(163000);
    expect(db.state.vehicle_expenses).toHaveLength(0);
    expect(db.state.documents[0].kind).toBe("inspection_photo");
    expect(db.writes.some((w) => w.table === "vehicles" && w.op === "update")).toBe(false);
    const read = await call("vehicle-maintenance", api.handleFleetVehicleMaintenance, db, {
      vehicle_id: V,
    });
    expect(read.json.monthly_inspection.history).toHaveLength(1);
    expect(read.json.monthly_inspection.history[0].notes).toBe("All clear");
    expect(read.json.mileage_log.some((row: any) => row.mileage === 163000)).toBe(true);
  });
});

describe("maintenance files stay on the existing stack", () => {
  test("docs, switch, migration, and UI name the same fields and do not text renters", () => {
    const docs = readFileSync("docs/fleet-api.md", "utf8");
    for (const path of [
      "vehicle-maintenance",
      "mileage-reading",
      "service-due",
      "monthly-inspection",
    ]) {
      expect(docs).toContain(path);
    }
    expect(docs).toContain("next_due_miles");
    expect(docs).toContain("next_due_on");
    expect(docs).toContain("last_done_on");
    expect(docs).toContain("fleet_vehicle_maintenance");
    expect(docs).toContain("20 MB");
    expect(docs).toContain("20261123120100_maintenance_schedule_explicit_next_due.sql");
    const sql = readFileSync(
      "supabase/migrations/20261123120100_maintenance_schedule_explicit_next_due.sql",
      "utf8",
    );
    expect(sql).toContain("IF NEW.next_due_on IS NULL THEN");
    expect(sql).toContain("NEW.next_due_on IS NOT DISTINCT FROM OLD.next_due_on");
    expect(sql).toContain("Not applied to production");
    const server = readFileSync("src/lib/fleet-vehicle-maintenance.server.ts", "utf8");
    expect(server).not.toMatch(/sendSms|sendEmail|ops-reminders/);
    expect(server).not.toContain('from("vehicles").update');
    expect(server).not.toContain("current_odometer =");
    const writer = readFileSync("src/lib/maintenance.server.ts", "utf8");
    const oil = writer.slice(
      writer.indexOf("export async function saveOilNextDue"),
      writer.indexOf("export async function saveMonthlyInspection"),
    );
    expect(oil).not.toContain("current_odometer");
    expect(oil).not.toContain('from("vehicles").update');
    expect(oil).toContain("maintenance_schedules");
    expect(writer).toContain("export async function addOdometerReading");
    const ui = readFileSync("src/components/admin/VehicleService.tsx", "utf8");
    const cards = readFileSync("src/components/admin/VehicleMaintenanceCards.tsx", "utf8");
    expect(ui).toContain('title="Mileage Log"');
    expect(ui).toContain("<VehicleMaintenanceCards");
    expect(cards).toContain('title="Next Service Due"');
    expect(cards).toContain('title="Monthly Inspection"');
    expect(cards).toContain("VIN …");
    expect(cards).not.toContain("unit_number");
    expect(cards).not.toContain("text-transform");
    const schedule = readFileSync("src/components/admin/MaintenanceSchedules.tsx", "utf8");
    expect(schedule).toContain('item: "Monthly Inspection"');
    expect(schedule).toContain("interval_days: 30");
    const flag = readFileSync("src/lib/maintenance-log-flag.ts", "utf8");
    expect(flag).toContain("export const MAINTENANCE_LOG_ENABLED = false;");
    expect(readFileSync("src/routes/api/public/cron/ops-reminders.ts", "utf8")).toContain(
      'on("service_digest")',
    );
  });
});
