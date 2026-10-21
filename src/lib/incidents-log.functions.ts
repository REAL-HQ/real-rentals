// Read-only incidents and damage claims log. Owners and managers only.
// The flag is checked before the role lookup and before any read.
// No insert, update, or delete. Photo links and the recovered amount are
// optional: a missing proposed table leaves that fact unknown.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { INCIDENTS_LOG_ENABLED } from "@/lib/incidents-log-flag";
import {
  buildIncidentsLog,
  type DocumentLinkSource,
  type DriverLogSource,
  type IncidentLogSource,
  type InspectionLinkSource,
  type PhotoLinkSource,
  type RecoverySource,
  type VehicleLogSource,
} from "@/lib/incidents-log";

const PAGE = 1000;
const INCIDENT_COLUMNS =
  "id,vehicle_id,rental_id,application_id,incident_type,occurred_at,description,estimated_cost,actual_cost,claim_number,status";

async function eachPage(
  load: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
): Promise<unknown[]> {
  const rows: unknown[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await load(from, from + PAGE - 1);
    if (error) {
      console.error("[incidents-log] read failed", error.message);
      throw new Error("Could not load the incidents log.");
    }
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows;
}

function presentIds(values: Array<string | null>): string[] {
  const ids: string[] = [];
  for (const value of values) if (value && !ids.includes(value)) ids.push(value);
  return ids;
}

async function optionalPages(
  missingMessage: string,
  load: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
): Promise<{ installed: boolean; rows: unknown[] }> {
  const rows: unknown[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await load(from, from + PAGE - 1);
    if (error) {
      console.error(missingMessage);
      return { installed: false, rows: [] };
    }
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return { installed: true, rows };
}

async function byIds(
  sb: { from: (table: string) => any },
  table: string,
  columns: string,
  ids: string[],
): Promise<unknown[]> {
  const rows: unknown[] = [];
  for (let index = 0; index < ids.length; index += 100) {
    const slice = ids.slice(index, index + 100);
    const { data, error } = await sb.from(table).select(columns).in("id", slice);
    if (error) {
      console.error("[incidents-log] read failed", error.message);
      throw new Error("Could not load the incidents log.");
    }
    rows.push(...(data ?? []));
  }
  return rows;
}

export const listIncidentsLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({}).parse(d ?? {}))
  .handler(async ({ context }) => {
    if (!INCIDENTS_LOG_ENABLED) throw new Error("Incidents Log is off");
    const { requireManager } = await import("@/lib/roles.server");
    await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const sb = supabaseAdmin;

    const incidents = (await eachPage((from, to) =>
      sb.from("incidents").select(INCIDENT_COLUMNS).order("id", { ascending: true }).range(from, to),
    )) as IncidentLogSource[];

    const vehicleIds = presentIds(incidents.map((row) => row.vehicle_id));
    const driverIds = presentIds(incidents.map((row) => row.application_id));
    const vehicles = (await byIds(sb, "vehicles", "id,unit_number,year,make,model", vehicleIds)) as VehicleLogSource[];
    const drivers = (await byIds(sb, "applications", "id,full_name", driverIds)) as DriverLogSource[];

    const recoveryRead = await optionalPages("[incidents-log] incidents_log_v1 is not installed; that part of the log stays unknown.", (from, to) =>
      (sb as any).from("incidents_log_v1").select("incident_id,amount_recovered").order("incident_id", { ascending: true }).range(from, to),
    );
    const linkRead = await optionalPages("[incidents-log] incidents_log_v1_links is not installed; that part of the log stays unknown.", (from, to) =>
      (sb as any)
        .from("incidents_log_v1_links")
        .select("id,incident_id,document_id,inspection_id")
        .order("id", { ascending: true })
        .range(from, to),
    );
    const links = (linkRead.installed ? linkRead.rows : []) as PhotoLinkSource[];
    const documentIds = presentIds(links.map((row) => row.document_id));
    const inspectionIds = presentIds(links.map((row) => row.inspection_id));
    const documents = linkRead.installed
      ? ((await byIds(sb, "documents", "id,file_name,category", documentIds)) as DocumentLinkSource[])
      : [];
    const inspections = linkRead.installed
      ? ((await byIds(sb, "inspections", "id,inspection_type,status", inspectionIds)) as InspectionLinkSource[])
      : [];

    return buildIncidentsLog({
      incidents,
      vehicles,
      drivers,
      recovery: (recoveryRead.installed ? recoveryRead.rows : []) as RecoverySource[],
      links,
      documents,
      inspections,
      photoLinksInstalled: linkRead.installed,
      recoveryInstalled: recoveryRead.installed,
    });
  });
