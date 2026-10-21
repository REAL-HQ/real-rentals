import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { addCalendarDays } from "../src/lib/maintenance-due";
import { VEHICLE_COMPLIANCE_ENABLED } from "../src/lib/vehicle-compliance-flag";
import {
  COMPLIANCE_MAX_PAGES,
  COMPLIANCE_PAGE,
  buildVehicleCompliance,
  complianceNotes,
  complianceStatus,
  complianceToday,
  readCappedPages,
  type ComplianceDirectory,
} from "../src/lib/vehicle-compliance";
import { loadVehicleCompliance, runVehicleCompliance, type ComplianceReader } from "../src/lib/vehicle-compliance.server";

const TODAY = "2026-10-21";

function directory(extra: Partial<ComplianceDirectory> = {}): ComplianceDirectory {
  return {
    failed: false,
    vehicles: [{
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      registration_expires_on: "2027-01-01",
      insurance_expires_on: "2027-01-01",
      plate_expires_on: "2027-01-01",
    }],
    documents: [],
    inspections: [{ vehicle_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", inspection_due_on: "2027-01-01" }],
    inspectionInstalled: true,
    inspectionDegraded: false,
    documentsIncomplete: false,
    truncated: false,
    ...extra,
  };
}

function reader(pages: Record<string, { data?: unknown[]; error?: { code?: string; message?: string } | null } | ((from: number) => { data?: unknown[]; error?: { code?: string; message?: string } | null })>): ComplianceReader {
  return {
    from(table: string) {
      const query = {
        select: () => query,
        order: () => query,
        is: () => query,
        not: () => query,
        eq: () => query,
        in: () => query,
        range: (from: number) => {
          const page = pages[table];
          const result = typeof page === "function" ? page(from) : page ?? { data: [], error: null };
          return Promise.resolve(result);
        },
        limit: () => {
          const page = pages[table];
          const result = typeof page === "function" ? page(0) : page ?? { data: [], error: null };
          return Promise.resolve(result);
        },
      };
      return query;
    },
  };
}

describe("vehicle compliance dates", () => {
  it("uses the Eastern calendar day across the DST transitions and does not shift a stored date", () => {
    expect(complianceToday(new Date("2026-03-08T04:59:00.000Z"))).toBe("2026-03-07");
    expect(complianceToday(new Date("2026-03-08T06:30:00.000Z"))).toBe("2026-03-08");
    expect(complianceToday(new Date("2026-03-08T07:30:00.000Z"))).toBe("2026-03-08");
    expect(complianceToday(new Date("2026-11-01T03:30:00.000Z"))).toBe("2026-10-31");
    expect(complianceToday(new Date("2026-11-01T05:30:00.000Z"))).toBe("2026-11-01");
    expect(complianceToday(new Date("2026-11-01T06:30:00.000Z"))).toBe("2026-11-01");
    expect(addCalendarDays("2026-03-08", 30)).toBe("2026-04-07");
    expect(addCalendarDays("2026-11-01", 30)).toBe("2026-12-01");
    expect(complianceStatus("2026-03-08", "2026-03-08T04:59:00.000Z")).toBe("due_30");
    expect(complianceStatus("2026-03-08", "2026-03-07")).toBe("expired");
    expect(complianceStatus("2026-03-08", "2026-03-08")).toBe("due_30");
    expect(complianceStatus("2026-03-08", "2026-04-07")).toBe("due_30");
    expect(complianceStatus("2026-03-08", "2026-04-08")).toBe("ok");
    expect(complianceStatus("2026-03-08", null)).toBe("unknown");
    expect(complianceStatus("2026-03-08", "2026-02-31")).toBe("unknown");
  });

  it("rolls a vehicle up to the worst known status and leaves a missing inspection Unknown", () => {
    const clear = buildVehicleCompliance(TODAY, directory());
    expect(clear[0]?.status).toBe("ok");
    const expired = buildVehicleCompliance(TODAY, directory({
      vehicles: [{
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        registration_expires_on: "2026-10-20",
        insurance_expires_on: "2027-01-01",
        plate_expires_on: "2027-01-01",
      }],
    }));
    expect(expired[0]?.status).toBe("expired");
    const due = buildVehicleCompliance(TODAY, directory({
      vehicles: [{
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        registration_expires_on: "2026-11-20",
        insurance_expires_on: "2027-01-01",
        plate_expires_on: "2027-01-01",
      }],
    }));
    expect(due[0]?.status).toBe("due_30");
    const missingInspection = buildVehicleCompliance(TODAY, directory({ inspectionInstalled: false, inspections: [] }));
    expect(missingInspection[0]?.status).toBe("unknown");
    expect(missingInspection[0]?.items.find((item) => item.key === "inspection")?.status).toBe("unknown");
    expect(complianceNotes({ truncated: false, inspectionInstalled: false, inspectionDegraded: false, documentsIncomplete: false }))
      .toEqual(["Inspection Expiry Is Not On Record"]);
    const expiredWithoutInspection = buildVehicleCompliance(TODAY, directory({
      inspectionInstalled: false,
      inspections: [],
      vehicles: [{
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        registration_expires_on: "2020-01-01",
        insurance_expires_on: null,
        plate_expires_on: "2027-01-01",
      }],
    }));
    expect(expiredWithoutInspection[0]?.status).toBe("expired");
  });

  it("uses an existing document expiry and ignores owner-only paperwork", () => {
    const fromDocument = buildVehicleCompliance(TODAY, directory({
      documents: [
        { vehicle_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", kind: "registration", expires_at: "2026-10-01" },
        { vehicle_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", kind: "title", expires_at: "2020-01-01" },
        { vehicle_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", kind: "insurance_policy", expires_at: "2026-11-01" },
        { vehicle_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", kind: "emissions", expires_at: "2027-06-01" },
      ],
    }));
    expect(fromDocument[0]?.status).toBe("expired");
    expect(fromDocument[0]?.items.find((item) => item.key === "insurance")?.status).toBe("due_30");
    expect(fromDocument[0]?.items.find((item) => item.key === "emissions")?.status).toBe("ok");
    expect(fromDocument[0]?.items.some((item) => item.label === "Title")).toBe(false);
    const withheld = buildVehicleCompliance(TODAY, directory({ documentsIncomplete: true }));
    expect(withheld[0]?.status).toBe("unknown");
    expect(complianceNotes(directory({ truncated: true, documentsIncomplete: true })).includes("Compliance Is Truncated")).toBe(true);
  });
});

describe("vehicle compliance reads", () => {
  it("stops at limit+1, degrades a missing inspection table, and does not throw", async () => {
    let vehicleCalls = 0;
    const loaded = await loadVehicleCompliance(reader({
      vehicles: () => {
        vehicleCalls += 1;
        return { data: Array.from({ length: COMPLIANCE_PAGE + 1 }, (_, index) => ({ id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, "0")}`, registration_expires_on: "2027-01-01", insurance_expires_on: "2027-01-01", plate_expires_on: "2027-01-01" })), error: null };
      },
      documents: { data: [], error: null },
      maintenance_due_v1: { data: null, error: { code: "PGRST205", message: "Could not find the table 'public.maintenance_due_v1' in the schema cache" } },
      maintenance_log_v1: { data: null, error: { code: "42P01", message: 'relation "public.maintenance_log_v1" does not exist' } },
      document_vehicle_links: { data: [], error: null },
    }));
    expect(vehicleCalls).toBe(COMPLIANCE_MAX_PAGES);
    expect(loaded.failed).toBe(false);
    expect(loaded.truncated).toBe(true);
    expect(loaded.vehicles).toHaveLength(COMPLIANCE_PAGE * COMPLIANCE_MAX_PAGES);
    expect(loaded.inspectionInstalled).toBe(false);
    expect(loaded.inspectionDegraded).toBe(false);
    const failed = await loadVehicleCompliance(reader({
      vehicles: { data: null, error: { code: "XX000", message: "connection refused" } },
    }));
    expect(failed.failed).toBe(true);
    const thrown = await readCappedPages(async () => {
      throw new Error("socket hang up");
    });
    expect(thrown.failed).toBe(true);
  });

  it("stays off, is declared once, and returns before the role check and any read", async () => {
    expect(VEHICLE_COMPLIANCE_ENABLED).toBe(false);
    const flag = readFileSync(new URL("../src/lib/vehicle-compliance-flag.ts", import.meta.url), "utf8");
    expect(flag).toMatch(/export const VEHICLE_COMPLIANCE_ENABLED = false/);
    expect(flag.match(/VEHICLE_COMPLIANCE_ENABLED\s*=/g)).toHaveLength(1);
    expect(flag).not.toMatch(/process\.env/);
    const handler = readFileSync(new URL("../src/lib/vehicle-compliance.functions.ts", import.meta.url), "utf8");
    const gate = handler.indexOf("if (!VEHICLE_COMPLIANCE_ENABLED) return COMPLIANCE_DISABLED");
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(handler.indexOf('await import("@/lib/roles.server")'));
    expect(gate).toBeLessThan(handler.indexOf('"./vehicle-compliance.server"'));
    expect(gate).toBeLessThan(handler.indexOf('await import("@/integrations/supabase/client.server")'));
    const sources = [
      "src/lib/vehicle-compliance.ts",
      "src/lib/vehicle-compliance.server.ts",
      "src/lib/vehicle-compliance.functions.ts",
      "src/components/admin/VehicleCompliance.tsx",
      "src/components/admin/VehiclesPanel.tsx",
      "src/routes/admin.tsx",
      "src/components/admin/nav-config.ts",
    ];
    for (const path of sources) {
      const text = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
      expect(text).not.toMatch(/export const VEHICLE_COMPLIANCE_ENABLED/);
      expect(text).not.toMatch(/process\.env\.VEHICLE_COMPLIANCE_ENABLED/);
    }
    const panel = readFileSync(new URL("../src/components/admin/VehiclesPanel.tsx", import.meta.url), "utf8");
    expect(panel).toContain("compliance.enabled &&");
    expect(panel).toContain(">Compliance<");
    expect(panel).not.toMatch(/text-transform/);
    const column = readFileSync(new URL("../src/components/admin/VehicleCompliance.tsx", import.meta.url), "utf8");
    expect(column).toContain("Due In 30 Days");
    expect(column).toContain("Expired");
    expect(column).toContain("Unknown");
    expect(column).not.toMatch(/text-transform/);
    expect(readFileSync(new URL("../src/routes/admin.tsx", import.meta.url), "utf8")).not.toContain("VEHICLE_COMPLIANCE_ENABLED");
    expect(readFileSync(new URL("../src/components/admin/nav-config.ts", import.meta.url), "utf8")).not.toContain("VEHICLE_COMPLIANCE_ENABLED");
    expect(readFileSync(new URL("../src/lib/vehicles-list.functions.ts", import.meta.url), "utf8")).not.toMatch(/registration_expires_on|getVehicleCompliance/);
    const readerSource = readFileSync(new URL("../src/lib/vehicle-compliance.server.ts", import.meta.url), "utf8");
    expect(readerSource).toContain('.in("kind", COMPLIANCE_DOCUMENT_KINDS)');
    expect(readerSource).not.toMatch(/\.(insert|update|delete|upsert)\(/);
    const proposal = readFileSync(new URL("../proposed/vehicle-compliance-inspection.sql", import.meta.url), "utf8");
    expect(proposal).toMatch(/NOT INSTALLED/);
    expect(proposal).toMatch(/DROP TABLE IF EXISTS public\.maintenance_due_v1/);
    expect(proposal).toMatch(/DROP TABLE IF EXISTS public\.maintenance_log_v1/);
    expect(proposal).not.toMatch(/CREATE TABLE/);
    const load = vi.fn();
    await expect(runVehicleCompliance({
      enabled: false,
      userId: "owner-1",
      tier: "owner",
      today: TODAY,
      load,
    })).resolves.toMatchObject({ status: "disabled" });
    expect(load).not.toHaveBeenCalled();
  });

  it("refuses a signed-out caller before the read and lets a coordinator load", async () => {
    const load = vi.fn();
    await expect(runVehicleCompliance({
      enabled: true,
      userId: null,
      tier: null,
      today: TODAY,
      load,
    })).rejects.toThrow("Forbidden");
    expect(load).not.toHaveBeenCalled();
    load.mockResolvedValue(directory());
    const result = await runVehicleCompliance({
      enabled: true,
      userId: "coord-1",
      tier: "coordinator",
      today: TODAY,
      load,
    });
    expect(load).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("ready");
    if (result.status === "ready") expect(result.rows[0]?.status).toBe("ok");
  });

  it("turns a failed read into unavailable instead of throwing", async () => {
    const result = await runVehicleCompliance({
      enabled: true,
      userId: "manager-1",
      tier: "manager",
      today: TODAY,
      load: async () => {
        throw new Error("connection refused");
      },
    });
    expect(result.status).toBe("unavailable");
    const degraded = await runVehicleCompliance({
      enabled: true,
      userId: "manager-1",
      tier: "manager",
      today: TODAY,
      load: async () => directory({ failed: true }),
    });
    expect(degraded).toMatchObject({ status: "unavailable", reason: "Compliance Could Not Be Loaded" });
  });
});
