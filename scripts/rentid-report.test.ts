import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
process.env.SUPABASE_URL ??= "http://127.0.0.1:9";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "dummy";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "dummy";
globalThis.fetch = (async (url: any) => { throw new Error(`network refused in test: ${url}`); }) as any;

const L = await import("@/lib/rentid-report");
const S = await import("@/lib/rentid-report.server");
const cat = await import("@/lib/automation-catalog");

const APP = "baa6dacd-fcfe-47b7-84a1-04952903f514";
const APP2 = "11111111-2222-4333-8444-555555555555";
const DOC = "d50f69e9-0000-4000-8000-000000000001";
const ENV = { FLEET_API_KEY: "test-fleet-key-0123456789abcdef" };

type Row = Record<string, any>;
function fakeDb(seed: Record<string, Row[]>, opts: { missingTable?: boolean } = {}) {
  const state: Record<string, Row[]> = JSON.parse(JSON.stringify(seed));
  const writes: { table: string; op: string; payload: any }[] = [];
  let n = 1;
  function from(table: string) {
    state[table] ??= [];
    let op = "select"; let payload: any = null; let single = false;
    const f: ((r: Row) => boolean)[] = [];
    const q: any = {
      select: () => q,
      insert: (r: Row) => { op = "insert"; payload = r; return q; },
      update: (r: Row) => { op = "update"; payload = r; return q; },
      eq: (c: string, v: any) => { f.push((r) => r[c] === v); return q; },
      in: (c: string, v: any[]) => { f.push((r) => v.includes(r[c])); return q; },
      ilike: (c: string, v: string) => { const needle = v.replace(/%/g, "").toLowerCase(); f.push((r) => String(r[c] ?? "").toLowerCase().includes(needle)); return q; },
      order: () => q,
      limit: () => q,
      maybeSingle: () => { single = true; return q; },
      single: () => { single = true; return q; },
      then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
    };
    function run() {
      if (opts.missingTable && table === "rentid_reports") return { data: null, error: { code: "42P01", message: 'relation "public.rentid_reports" does not exist' } };
      const rows = state[table].filter((r) => f.every((p) => p(r)));
      if (op === "insert") {
        const row = { id: `00000000-0000-4000-8000-${String(n++).padStart(12, "0")}`, created_at: "2026-11-21T19:00:00Z", ...payload };
        state[table].push(row); writes.push({ table, op, payload });
        return { data: single ? row : [row], error: null };
      }
      if (op === "update") {
        for (const r of rows) Object.assign(r, payload);
        writes.push({ table, op, payload });
        return { data: single ? rows[0] ?? null : rows, error: null };
      }
      return { data: single ? rows[0] ?? null : rows, error: null };
    }
    return q;
  }
  return { from, state, writes, storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: "https://signed.example/x" } }) }) } };
}
const seed = () => ({
  applications: [
    { id: APP, full_name: "James Smith", deleted_at: null, background_check_status: "pending", mvr_status: "pending" },
    { id: APP2, full_name: "Whitney Camarre", deleted_at: null, background_check_status: "pending", mvr_status: "pending" },
  ],
  documents: [{ id: DOC, driver_id: APP, category: "screening", file_name: "rentid.png", mime_type: "image/png", storage_bucket: "driver-docs", storage_path: `${APP}/internal/x.png` }],
  rentid_reports: [] as Row[],
});
const audits: any[] = [];
const audit = async (e: any) => { audits.push(e); };
const req = (body: unknown, key = ENV.FLEET_API_KEY) =>
  new Request("https://drivereal.com/api/public/fleet/rentid-report", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });

describe("parsers", () => {
  test("receipt email → order, renter, paid time, products", () => {
    const body = "Order #: INV-4H7F2YTY\r\n\r\nRenter: Whitney Camarre\r\n\r\nDate Paid: November 17, 2026 at 3:42 AM (UTC)\r\n\r\nProductCostCriminal Record Check1 creditDriver's License Status1 creditDL State Fee (Florida)$0.50";
    const r = L.parseRentidReceipt("Your receipt from Rentid, Inc. Order #INV-4H7F2YTY", body)!;
    expect(r.order_id).toBe("INV-4H7F2YTY");
    expect(r.renter_name).toBe("Whitney Camarre");
    expect(r.paid_at).toBe("2026-11-17T03:42:00.000Z");
    expect(r.products).toEqual(["Criminal Record Check", "Driver's License Status"]);
  });
  test("credit purchase receipts are not screenings", () => {
    expect(L.parseRentidReceipt("Your receipt from Rentid, Inc. Order #CRD-2KNOB6NX", "Order #: CRD-2KNOB6NX")).toBeNull();
  });
  test("portal text → summary; never guesses a pass", () => {
    const p = L.parseRentidReportText("Driver's License Status: Active\nCriminal Record Check: Detected (18 cases)\nhttps://rent-id.io/rentid/req_1793719376790_jn4khlc48");
    expect(p).toMatchObject({ license_status: "active", criminal_record: "detected", criminal_case_count: 18, order_id: "N4KHLC48", report_ref: "req_1793719376790_jn4khlc48" });
    const staff = L.parseRentidReportText("RentID verification completed. Driver's license status shows Active. Criminal record screening flagged");
    expect(staff.license_status).toBe("active");
    expect(staff.criminal_record).toBe("detected");
    expect(staff.criminal_case_count).toBeNull();
    expect(L.parseRentidReportText("hello").criminal_record).toBeNull();
  });
  test("order numbers and report links", () => {
    expect(L.normalizeOrderId(" inv-4h7f2yty ")).toBe("INV-4H7F2YTY");
    expect(L.normalizeOrderId("N4KHLC48")).toBe("N4KHLC48");
    expect(L.normalizeOrderId("12")).toBeNull();
    expect(L.orderKey("INV-N4KHLC48")).toBe("N4KHLC48");
    expect(L.parseReportRef("https://rent-id.io/rentid/req_1793719376790_jn4khlc48")).toEqual({ ref: "req_1793719376790_jn4khlc48", order: "N4KHLC48" });
    expect(L.parseReportRef("https://app.rentid.io/x")).toBeNull();
  });
});

describe("case dedupe", () => {
  test("AOC and Clerk formats of one case share a key", () => {
    expect(L.caseNumberKey("10004830MMMO")).toBe("10|MM|4830");
    expect(L.caseNumberKey("032010MM004830XXOXMX")).toBe("10|MM|4830");
    expect(L.caseNumberKey("2010-MM-004830")).toBe("10|MM|4830");
    expect(L.caseNumberKey("10004831MMMO")).not.toBe(L.caseNumberKey("032010MM004830XXOXMX"));
  });
  test("merges duplicates, keeps the other number and fills blanks", () => {
    const out = L.dedupeCases([
      { case_number: "10004830MMMO", date: "2010-03-01", offense: "Driving While License Suspended", level: null, disposition: null, jurisdiction: "Hillsborough" },
      { case_number: "032010MM004830XXOXMX", internal_id: "77", date: "2010-03-01", file_date: "2010-03-05", offense: "DWLS", level: "Misdemeanor 2nd Degree", disposition: "Adjudication Withheld", jurisdiction: "Hillsborough County Court" },
      { case_number: "15CF001234", date: "2015-01-01", offense: "Grand Theft", level: "F3", disposition: "Nolle Prosequi", jurisdiction: "Pinellas" },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ case_number: "10004830MMMO", alt_case_numbers: ["032010MM004830XXOXMX"], level: "Misdemeanor 2nd Degree", disposition: "Adjudication Withheld", internal_id: "77", file_date: "2010-03-05", offense: "Driving While License Suspended" });
  });
  test("staff case lines are parsed and deduped", () => {
    const cases = L.parseCaseLines("2010-03-01 | DWLS | M2 | Withheld | Hillsborough | 10004830MMMO\n2010-03-01 | DWLS | M2 | Withheld | Hillsborough | 032010MM004830XXOXMX\nPetty Theft");
    expect(cases).toHaveLength(2);
    expect(cases[1].offense).toBe("Petty Theft");
  });
});

describe("matching", () => {
  test("exact normalized full name, one applicant only", () => {
    const c = [{ id: "a", full_name: "James Smith" }, { id: "b", full_name: "James  Smith" }, { id: "c", full_name: "Whitney Camarre" }];
    expect(L.matchApplicantByName("whitney camarre", c)).toEqual({ kind: "match", id: "c" });
    expect(L.matchApplicantByName("James Smith", c)).toEqual({ kind: "ambiguous", count: 2 });
    expect(L.matchApplicantByName("Whitney", c)).toEqual({ kind: "none" });
    expect(L.matchApplicantByName("Whitney Camarre", [{ id: "c", full_name: "Whitney Camarre", deleted_at: "2026-01-01" }])).toEqual({ kind: "none" });
  });
});

describe("saveRentidReport", () => {
  test("receipt then result: one row, ordered → reported, never touches the application", async () => {
    const db = fakeDb(seed());
    const a = await S.saveRentidReport(db, { applicationId: APP, orderId: "INV-N4KHLC48", renterName: "James Smith", products: ["Criminal Record Check"], source: "fleet", recordedByLabel: "FLEET MANAGER" }, audit);
    expect(a.created).toBe(true);
    expect(a.report.status).toBe("ordered");
    const b = await S.saveRentidReport(db, {
      applicationId: APP, orderId: "N4KHLC48", reportRef: "https://rent-id.io/rentid/req_1793719376790_jn4khlc48",
      licenseStatus: "active", licenseState: "FL", criminalRecord: "detected", criminalCaseCount: 18,
      criminalCases: [{ case_number: "10004830MMMO", date: "2010", offense: "DWLS", level: null, disposition: null, jurisdiction: null }, { case_number: "032010MM004830XXOXMX", date: "2010", offense: "DWLS", level: "M2", disposition: "Withheld", jurisdiction: "Hillsborough" }],
      documentId: DOC, source: "staff", recordedBy: "u1", recordedByLabel: "rosa@drivereal.com",
    }, audit);
    expect(b.created).toBe(false);
    expect(db.state.rentid_reports).toHaveLength(1);
    expect(b.report).toMatchObject({ status: "reported", order_id: "INV-N4KHLC48", report_ref: "req_1793719376790_jn4khlc48", criminal_case_count: 18, document_id: DOC, renter_name: "James Smith" });
    expect(b.report.criminal_cases).toHaveLength(1);
    expect(db.writes.some((w) => w.table !== "rentid_reports")).toBe(false);
    expect(db.state.applications[0]).toMatchObject({ background_check_status: "pending", mvr_status: "pending" });
    expect(audits.at(-1).metadata).toMatchObject({ verified: false, decision: null });
  });
  test("refuses an order already on another driver, a foreign file, contradictions and a mismatched link", async () => {
    const db = fakeDb(seed());
    await S.saveRentidReport(db, { applicationId: APP2, orderId: "INV-4H7F2YTY", source: "fleet", recordedByLabel: "FLEET" }, audit);
    await expect(S.saveRentidReport(db, { applicationId: APP, orderId: "4H7F2YTY", criminalRecord: "detected", source: "staff", recordedByLabel: "x" }, audit)).rejects.toThrow(/another driver/);
    await expect(S.saveRentidReport(db, { applicationId: APP2, orderId: "INV-4H7F2YTY", documentId: DOC, source: "staff", recordedByLabel: "x" }, audit)).rejects.toThrow(/not on this driver/);
    await expect(S.saveRentidReport(db, { applicationId: APP, orderId: "N4KHLC48", criminalRecord: "not_detected", criminalCaseCount: 3, source: "staff", recordedByLabel: "x" }, audit)).rejects.toThrow(/Not Detected/);
    await expect(S.saveRentidReport(db, { applicationId: APP, orderId: "N4KHLC48", reportRef: "req_1793719376790_jzzzzzz99", source: "staff", recordedByLabel: "x" }, audit)).rejects.toThrow(/For Order/);
  });
  test("migration not applied: reads say not installed, writes refuse", async () => {
    const db = fakeDb(seed(), { missingTable: true });
    expect(await S.listRentidReports(db, APP)).toEqual({ installed: false, reports: [] });
    await expect(S.saveRentidReport(db, { applicationId: APP, orderId: "N4KHLC48", source: "staff", recordedByLabel: "x" }, audit)).rejects.toThrow(/not installed/);
  });
  test("list returns a signed file link", async () => {
    const db = fakeDb(seed());
    await S.saveRentidReport(db, { applicationId: APP, orderId: "N4KHLC48", documentId: DOC, criminalRecord: "detected", source: "staff", recordedByLabel: "x" }, audit);
    const r = await S.listRentidReports(db, APP);
    expect(r.reports[0].file).toEqual({ name: "rentid.png", url: "https://signed.example/x", mime: "image/png" });
  });
});

describe("FLEET endpoint", () => {
  const on = async () => "send" as const;
  test("needs the key and is Off by default", async () => {
    const db = fakeDb(seed());
    expect((await S.handleFleetRentidReport(req({ order_id: "N4KHLC48", lead_id: APP }, "wrong-key-wrong-key-wrong-key"), { admin: db, env: ENV, audit })).status).toBe(401);
    const off = await S.handleFleetRentidReport(req({ order_id: "N4KHLC48", lead_id: APP }), { admin: db, env: ENV, audit, gate: async () => "off" });
    expect(off.status).toBe(409);
    expect(db.writes).toHaveLength(0);
    const entry = cat.AUTOMATIONS.find((a: any) => a.key === "rentid_report_imports") as any;
    expect(entry.defaultOn).toBe(false);
  });
  test("receipt by renter name: unique match saves Ordered; same name twice is refused", async () => {
    const db = fakeDb(seed());
    const ok = await S.handleFleetRentidReport(req({ order_id: "INV-4H7F2YTY", renter_name: "Whitney Camarre", ordered_at: "2026-11-17T03:42:00Z", products: ["Criminal Record Check"] }), { admin: db, env: ENV, audit, gate: on, now: () => new Date("2026-11-21T19:00:00Z") });
    const j: any = await ok.json();
    expect(ok.status).toBe(201);
    expect(j).toMatchObject({ lead_id: APP2, matched_by: "renter_name", status: "ordered", verified: false });
    db.state.applications.push({ id: "22222222-2222-4222-8222-222222222222", full_name: "James Smith", deleted_at: null });
    const amb = await S.handleFleetRentidReport(req({ order_id: "N4KHLC48", renter_name: "James Smith" }), { admin: db, env: ENV, audit, gate: on });
    expect(amb.status).toBe(409);
  });
  test("result with report_url and file: files under screening and saves Reported", async () => {
    const db = fakeDb(seed());
    let filedWith: any = null;
    const res = await S.handleFleetRentidReport(req({
      lead_id: APP, report_url: "https://rent-id.io/rentid/req_1793719376790_jn4khlc48",
      license_status: "Active", criminal_record: "Detected", criminal_case_count: 18,
      criminal_cases: [{ case_number: "10004830MMMO", charges: "DWLS", degree: "M2", offense_date: "2010-03-01", file_date: "2010-03-05", disposition: "Withheld", court: "Hillsborough", internal_id: "77" }],
      content_base64: "iVBORw0KGgo=", file_name: "james-rentid.png",
    }), { admin: db, env: ENV, audit, gate: on, now: () => new Date("2026-11-21T19:00:00Z"), fileDocument: async (a) => { filedWith = a; return { ok: true, documentId: DOC }; } });
    const j: any = await res.json();
    expect(res.status).toBe(201);
    expect(filedWith).toMatchObject({ leadId: APP, orderId: "N4KHLC48" });
    expect(j).toMatchObject({ order_id: "N4KHLC48", status: "reported", document_id: DOC, criminal_case_count: 18, cases_listed: 1 });
    expect(db.state.rentid_reports[0].criminal_cases[0]).toMatchObject({ offense: "DWLS", level: "M2", jurisdiction: "Hillsborough", internal_id: "77", file_date: "2010-03-05" });
    expect(db.state.applications[0].background_check_status).toBe("pending");
  });
  test("a file that cannot be filed saves nothing", async () => {
    const db = fakeDb(seed());
    const res = await S.handleFleetRentidReport(req({ lead_id: APP, order_id: "N4KHLC48", criminal_record: "detected", content_base64: "x" }), { admin: db, env: ENV, audit, gate: on, fileDocument: async () => ({ ok: false, status: 409, error: "The FLEET Document Uploads switch is Off." }) });
    expect(res.status).toBe(409);
    expect(db.state.rentid_reports).toHaveLength(0);
  });
  test("rejects unknown answers", async () => {
    const db = fakeDb(seed());
    expect((await S.handleFleetRentidReport(req({ lead_id: APP, order_id: "N4KHLC48", license_status: "great" }), { admin: db, env: ENV, audit, gate: on })).status).toBe(400);
  });
});

describe("source guards", () => {
  test("nothing in the RentID report code writes a decision column", () => {
    for (const f of ["src/lib/rentid-report.server.ts", "src/lib/rentid-report.functions.ts", "src/components/admin/RentidReportsCard.tsx"]) {
      const src = readFileSync(f, "utf8");
      expect(src).not.toMatch(/background_check_status\s*:|mvr_status\s*:|insurance_verified|review_status\s*:\s*["']verified/);
      expect(src).not.toMatch(/from\("applications"\)\.update/);
    }
  });
  test("migration is new, idempotent and not wired to any decision", () => {
    const sql = readFileSync("supabase/migrations/20261121193000_rentid_reports.sql", "utf8");
    expect(sql).toMatch(/NOT APPLIED/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.rentid_reports/);
    expect(sql).not.toMatch(/CREATE TRIGGER|UPDATE public\.applications/);
  });
});
