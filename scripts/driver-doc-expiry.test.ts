import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { describe, it } from "node:test";
import { supabaseAdmin } from "./fake-supabase.src.mjs";
import {
  DRIVER_DOC_EXPIRY_ENABLED,
  DRIVER_DOC_EXPIRY_ROW_CAP,
  documentListStatus,
} from "../src/lib/driver-doc-expiry";
import { loadDriverDocExpiry } from "../src/lib/driver-doc-expiry-load";
import {
  addCalendarDays,
  documentDateStatus,
  documentExpiryStatus,
  easternCalendarDay,
  type ReadinessApplication,
} from "../src/lib/driver-readiness-facts";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const fake = globalThis.__fakeSb as { tables: Record<string, unknown[]>; failSelect?: string; reads?: number };

function dates(
  partial: Partial<Pick<ReadinessApplication, "license_expiration" | "insurance_expires_on">>,
): Pick<ReadinessApplication, "license_expiration" | "insurance_expires_on"> {
  return {
    license_expiration: null,
    insurance_expires_on: null,
    ...partial,
  };
}

describe("driver document expiry", () => {
  it("declares the flag once, hard false, with no env", () => {
    const src = read("src/lib/driver-doc-expiry.ts");
    assert.equal(src.match(/export const DRIVER_DOC_EXPIRY_ENABLED: boolean = false/g)?.length, 1);
    assert.equal(DRIVER_DOC_EXPIRY_ENABLED, false);
    assert.equal(read("src/lib/driver-doc-expiry.functions.ts").includes("DRIVER_DOC_EXPIRY_ENABLED"), false);
    assert.equal(read("src/lib/driver-doc-expiry-load.ts").includes("DRIVER_DOC_EXPIRY_ENABLED"), false);
    assert.doesNotMatch(src, /process\.env/);
    assert.doesNotMatch(read("src/lib/driver-doc-expiry.functions.ts"), /process\.env/);
    assert.doesNotMatch(read("src/lib/driver-doc-expiry-load.ts"), /process\.env/);
  });

  it("refuses before the role check and before any read", () => {
    const fn = read("src/lib/driver-doc-expiry.functions.ts");
    assert.match(fn, /\.middleware\(\[driverDocExpiryGate, requireSupabaseAuth\]\)/);
    const handler = fn.slice(fn.indexOf(".handler("));
    const asserted = handler.indexOf("assertDriverDocExpiryEnabled()");
    const loadImport = handler.indexOf('import("./driver-doc-expiry-load")');
    const role = handler.indexOf("requireManager(");
    const client = handler.indexOf('import("@/integrations/supabase/client.server")');
    const loadCall = handler.indexOf("loadDriverDocExpiry(");
    assert.ok(asserted !== -1 && asserted < loadImport && loadImport < role && role < client && client < loadCall);
    assert.match(handler, /if \(DOC_EXPIRY_REFUSED\) \{[^}]*return idle\(\);/s);
    assert.doesNotMatch(fn, /\.from\(|\.limit\(/);
    assert.doesNotMatch(fn, /throw /);
    assert.doesNotMatch(fn, /\.(insert|update|delete|upsert)\(/);
    assert.doesNotMatch(fn, /tnc_uber_approval_expires_on|tnc_lyft_approval_expires_on|pickup_date|documents\.expires_at/);
    const load = read("src/lib/driver-doc-expiry-load.ts");
    assert.match(load, /documentExpiryStatus/);
    assert.match(load, /driver-readiness-facts/);
    assert.match(load, /license_expiration/);
    assert.match(load, /insurance_expires_on/);
    assert.match(load, /count: "exact"/);
    assert.match(load, /\.range\(from, to\)/);
    assert.match(load, /\.is\("deleted_at", null\)/);
    assert.match(load, /\.neq\("status", "duplicate"\)/);
    assert.doesNotMatch(load, /\.limit\(/);
    assert.doesNotMatch(load, /function documentExpiryStatus|function easternCalendarDay/);
    assert.doesNotMatch(load, /tnc_uber_approval_expires_on|tnc_lyft_approval_expires_on|pickup_date|insurance_verified_at/);
    assert.equal(DRIVER_DOC_EXPIRY_ROW_CAP, 1000);
  });

  it("extends the drivers screen and does not add a route or tab", () => {
    const panel = read("src/components/admin/DriversPanel.tsx");
    const ui = read("src/components/admin/DriverDocExpiry.tsx");
    const gate = panel.indexOf(
      "if (DRIVER_DOC_EXPIRY_ENABLED !== true || !driversLoaded || canSeeSensitive !== true) return;",
    );
    const call = panel.indexOf("loadDocExpiry()");
    assert.ok(gate !== -1 && call !== -1 && gate < call);
    assert.equal(ui.includes("useServerFn"), false);
    assert.match(panel, /DRIVER_DOC_EXPIRY_ENABLED === true && driversLoaded && canSeeSensitive/);
    assert.match(panel, /<DriverDocExpiryFilter/);
    assert.match(panel, /<DriverDocExpiryHeader \/>/);
    assert.match(panel, /<DriverDocExpiryCell/);
    assert.match(panel, /<DriverDocExpiryNotice/);
    assert.match(panel, /docFilter === "all"/);
    assert.match(panel, /colSpan=\{DRIVER_DOC_EXPIRY_ENABLED === true && driversLoaded && canSeeSensitive \? 11 : 10\}/);
    assert.doesNotMatch(ui, /uppercase|lowercase|capitalize/);
    assert.doesNotMatch(read("src/components/admin/nav-config.ts"), /doc-expiry|Documents/);
    assert.doesNotMatch(read("src/routes/admin.tsx"), /DriverDocExpiry|driver-doc-expiry/);
    assert.match(ui, /Expired/);
    assert.match(ui, /Expires in 30 Days/);
    assert.match(ui, /Unknown/);
    assert.match(ui, /Not In This Read/);
    assert.match(ui, /Could Not Load Document Expiry/);
    assert.match(ui, /Showing The First \{meta\.cap\} Drivers\. The Rest Were Not Read\./);
    assert.match(ui, /TNC Approval Dates Are Not In The Schema/);
    const failed = ui.indexOf("Could Not Load Document Expiry");
    const capped = ui.indexOf("Showing The First");
    assert.ok(failed !== -1 && capped !== -1 && failed < capped);
  });

  it("keeps the missing TNC columns as proposed SQL and uses the shared dates", () => {
    const sql = read("proposed/driver-doc-expiry-tnc.sql");
    assert.match(sql, /NOT INSTALLED/);
    assert.match(sql, /ROLLBACK/);
    assert.match(sql, /DROP COLUMN IF EXISTS tnc_uber_approval_expires_on/);
    assert.match(sql, /DROP COLUMN IF EXISTS tnc_lyft_approval_expires_on/);
    assert.equal(sql.includes("GRANT "), false);
    assert.match(read("src/lib/driver-readiness-facts.ts"), /export function documentExpiryStatus/);
    const today = "2026-10-21";
    assert.equal(
      documentExpiryStatus(dates({ license_expiration: "2027-06-01", insurance_expires_on: "2027-06-01" }), today, null),
      "unknown",
    );
    assert.equal(
      documentExpiryStatus(dates({ license_expiration: "2027-06-01", insurance_expires_on: "2027-06-01" }), today, "2027-06-01"),
      "ok",
    );
    assert.equal(
      documentExpiryStatus(dates({ license_expiration: "2026-10-01", insurance_expires_on: null }), today, null),
      "expired",
    );
    assert.equal(
      documentExpiryStatus(dates({ license_expiration: "2026-11-20", insurance_expires_on: "2027-01-01" }), today, null),
      "expiring",
    );
    assert.equal(documentExpiryStatus(dates({}), today, null), "unknown");
  });

  it("classifies Eastern calendar days across the DST transitions", () => {
    assert.equal(easternCalendarDay(new Date("2026-03-08T04:30:00.000Z")), "2026-03-07");
    assert.equal(easternCalendarDay(new Date("2026-03-08T05:00:00.000Z")), "2026-03-08");
    assert.equal(easternCalendarDay(new Date("2026-03-08T06:30:00.000Z")), "2026-03-08");
    assert.equal(easternCalendarDay(new Date("2026-03-08T07:30:00.000Z")), "2026-03-08");
    assert.equal(addCalendarDays("2026-03-08", 30), "2026-04-07");
    assert.equal(documentDateStatus("2026-04-07", "2026-03-08"), "expiring");
    assert.equal(documentDateStatus("2026-04-08", "2026-03-08"), "ok");
    assert.equal(documentDateStatus("2026-03-08", "2026-03-08"), "expiring");
    assert.equal(easternCalendarDay(new Date("2026-03-09T03:30:00.000Z")), "2026-03-08");
    assert.equal(documentDateStatus("2026-03-08", easternCalendarDay(new Date("2026-03-09T03:30:00.000Z"))), "expiring");
    assert.equal(easternCalendarDay(new Date("2026-03-09T04:00:00.000Z")), "2026-03-09");
    assert.equal(documentDateStatus("2026-03-08", easternCalendarDay(new Date("2026-03-09T04:00:00.000Z"))), "expired");

    assert.equal(easternCalendarDay(new Date("2026-11-01T03:30:00.000Z")), "2026-10-31");
    assert.equal(easternCalendarDay(new Date("2026-11-01T04:00:00.000Z")), "2026-11-01");
    assert.equal(easternCalendarDay(new Date("2026-11-01T05:30:00.000Z")), "2026-11-01");
    assert.equal(easternCalendarDay(new Date("2026-11-01T06:30:00.000Z")), "2026-11-01");
    assert.equal(addCalendarDays("2026-11-01", 30), "2026-12-01");
    assert.equal(documentDateStatus("2026-12-01", "2026-11-01"), "expiring");
    assert.equal(documentDateStatus("2026-12-02", "2026-11-01"), "ok");
    assert.equal(documentDateStatus("not-a-date", "2026-11-01"), "unknown");
    assert.equal(documentDateStatus("2026-02-31", "2026-11-01"), "unknown");
  });
});

describe("driver document expiry read", () => {
  const admin = supabaseAdmin as unknown as { from: (table: string) => any };

  function reset(tables: Record<string, unknown[]>) {
    fake.tables = tables;
    fake.failSelect = undefined;
  }

  it("pages a counted read, reports errors apart from the cap, and refuses with the flag off", async () => {
    const today = "2026-10-21";
    const applications = Array.from({ length: DRIVER_DOC_EXPIRY_ROW_CAP + 1 }, (_, index) => ({
      id: `app-${String(index).padStart(4, "0")}`,
      status: "new",
      deleted_at: null,
      created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
      license_expiration: index === DRIVER_DOC_EXPIRY_ROW_CAP ? "2020-01-01" : "2027-06-01",
      insurance_expires_on: "2027-06-01",
    }));
    applications.push(
      {
        id: "gone",
        status: "approved",
        deleted_at: "2026-08-01T00:00:00.000Z",
        created_at: "2026-12-01T00:00:00.000Z",
        license_expiration: "2020-01-01",
        insurance_expires_on: "2027-01-01",
      },
      {
        id: "dupe",
        status: "duplicate",
        deleted_at: null,
        created_at: "2026-12-02T00:00:00.000Z",
        license_expiration: "2020-01-01",
        insurance_expires_on: "2027-01-01",
      },
    );
    reset({ applications });
    const capped = await loadDriverDocExpiry(admin, today);
    assert.equal(capped.failed, false);
    assert.equal(capped.truncated, true);
    assert.equal(capped.drivers.length, DRIVER_DOC_EXPIRY_ROW_CAP);
    assert.equal(capped.drivers[0]?.id, "app-1000");
    assert.equal(capped.drivers[0]?.status, "expired");
    assert.equal(capped.drivers.some((driver) => driver.id === "app-0000"), false);
    assert.equal(capped.drivers.some((driver) => driver.id === "gone" || driver.id === "dupe"), false);
    assert.equal(documentListStatus(capped, "app-0000"), "unread");
    assert.equal(documentListStatus(capped, "app-1000"), "expired");
    assert.notEqual(documentListStatus(capped, "app-0000"), "ok");

    fake.failSelect = "applications";
    const errored = await loadDriverDocExpiry(admin, today);
    assert.equal(errored.failed, true);
    assert.equal(errored.truncated, false);
    assert.deepEqual(errored.drivers, []);
    assert.equal(documentListStatus(errored, "app-1000"), "failed");
    assert.notEqual(documentListStatus(errored, "app-1000"), "ok");

    reset({
      applications: [
        {
          id: "past",
          status: "new",
          deleted_at: null,
          created_at: "2026-10-01T00:00:00.000Z",
          license_expiration: "2026-10-20",
          insurance_expires_on: "2027-08-01",
        },
        {
          id: "soon",
          status: "reviewing",
          deleted_at: null,
          created_at: "2026-09-01T00:00:00.000Z",
          license_expiration: "2026-11-20",
          insurance_expires_on: "2027-01-01",
        },
        {
          id: "blank",
          status: "approved",
          deleted_at: null,
          created_at: "2026-08-01T00:00:00.000Z",
          license_expiration: null,
          insurance_expires_on: null,
        },
        {
          id: "gone2",
          status: "approved",
          deleted_at: "2026-01-01T00:00:00.000Z",
          created_at: "2026-11-01T00:00:00.000Z",
          license_expiration: "2020-01-01",
          insurance_expires_on: null,
        },
      ],
    });
    const classified = await loadDriverDocExpiry(admin, today);
    assert.equal(classified.failed, false);
    assert.equal(classified.truncated, false);
    assert.deepEqual(
      classified.drivers.map((driver) => [driver.id, driver.status]),
      [
        ["past", "expired"],
        ["soon", "expiring"],
        ["blank", "unknown"],
      ],
    );
    assert.equal(documentListStatus(classified, "missing"), "unknown");

    const out = ".doc-expiry-build";
    rmSync(out, { recursive: true, force: true });
    mkdirSync(`${out}/stub`, { recursive: true });
    writeFileSync(`${out}/stub/supabase.js`, readFileSync("scripts/fake-supabase.src.mjs", "utf8"));
    writeFileSync(
      `${out}/stub/react-start.js`,
      `export const createServerFn = () => { const api = { middleware: () => api, handler: (fn) => fn }; return api; };\nexport const createMiddleware = () => ({ server: (fn) => fn });\n`,
    );
    writeFileSync(`${out}/stub/auth-middleware.js`, `export const requireSupabaseAuth = {};`);
    const alias = [
      "--alias:@=./src",
      `--alias:@tanstack/react-start=./${out}/stub/react-start.js`,
      `--alias:@/integrations/supabase/auth-middleware=./${out}/stub/auth-middleware.js`,
      `--alias:@/integrations/supabase/client.server=./${out}/stub/supabase.js`,
    ];
    execFileSync(
      "npx",
      ["esbuild", "src/lib/driver-doc-expiry.functions.ts", "--bundle", "--platform=node", "--format=esm", `--outfile=${out}/handler.mjs`, ...alias],
      { stdio: ["ignore", "ignore", "inherit"] },
    );
    const probe = `
      import { getDriverDocExpiry } from "./handler.mjs";
      const before = globalThis.__fakeSb?.reads ?? 0;
      let message = "";
      try { await getDriverDocExpiry({ context: { userId: "mgr-1" } }); }
      catch (error) { message = error instanceof Error ? error.message : String(error); }
      if (message !== "Driver document expiry is disabled.") throw new Error(message || "no refusal");
      const reads = (globalThis.__fakeSb?.reads ?? 0) - before;
      if (reads !== 0) throw new Error("read " + reads + " tables");
    `;
    writeFileSync(`${out}/probe.mjs`, probe);
    execFileSync("node", [`${out}/probe.mjs`], { stdio: "inherit" });
  });
});
