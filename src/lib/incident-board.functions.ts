// Incident Board reads and writes. Owners, managers, and coordinators.
//
// supabaseAdmin bypasses RLS. incidents is manager-only in RLS because the
// claim screen carries costs. Coordinators can open this board, so the
// operational read never selects estimated_cost, actual_cost, or claim_number.
// Those columns, plus the proposed recovery and photo-link tables, are read
// only after the flag check and only for a manager or owner. A missing
// proposed table is only 42P01 or PGRST205. Any other error fails the read.
// It does not enroll incident_logged and does not notify the driver.
// It does not read deposit deductions or write a cost.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  INCIDENT_STATUSES,
  INCIDENT_TYPES,
  OPEN_INCIDENT_STATUSES,
  assertIncidentBoardEnabled,
  INCIDENT_CLAIM_MAX_PAGES,
  INCIDENT_CLAIM_PAGE,
  chooseIncidentTotals,
  incidentBoardShowsClaims,
  incidentClaimFacts,
  incidentCreateBlockers,
  incidentStatusLabel,
  incidentRentalLabel,
  incidentStatusMove,
  incidentTypeLabel,
  proposedTableMissing,
  toIncidentBoardRow,
  type IncidentBoardList,
  type IncidentBoardRow,
  type IncidentBoardSource,
  type IncidentCostSource,
  type IncidentDocumentSource,
  type IncidentInspectionSource,
  type IncidentPhotoLinkSource,
  type IncidentRecoverySource,
  type IncidentStatus,
} from "@/lib/incident-board";

const OPEN = [...OPEN_INCIDENT_STATUSES] as [IncidentStatus, ...IncidentStatus[]];
const TYPES = [...INCIDENT_TYPES] as [string, ...string[]];
const STATUSES = [...INCIDENT_STATUSES] as [IncidentStatus, ...IncidentStatus[]];

const COLUMNS =
  "id,vehicle_id,rental_id,application_id,incident_type,occurred_at,reported_at,location,description,at_fault,injuries,drivable,police_report_number,other_party,severity,status,notes";

function missingIssueColumn(err: { code?: string | null; message?: string | null } | null): boolean {
  if (!err) return false;
  if (err.code === "42703" || err.code === "PGRST204") return true;
  return /issue_id/.test(String(err.message ?? ""));
}

export const listIncidentBoard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<IncidentBoardList> => {
    const { requireStaff } = await import("@/lib/roles.server");
    const actor = await requireStaff(context.userId);
    assertIncidentBoardEnabled();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const loaded = await loadOpen(supabaseAdmin);
    const issueTitles = await titlesFor(supabaseAdmin, loaded.rows, loaded.linkColumn);
    const vehicles = await labelsFor(supabaseAdmin, "vehicles", loaded.rows.map((row) => row.vehicle_id).filter(Boolean), vehicleLabel);
    const apps = await labelsFor(supabaseAdmin, "applications", loaded.rows.map((row) => row.application_id).filter(Boolean), (row) => String(row.full_name ?? "").trim());
    const claimsVisible = incidentBoardShowsClaims(actor.tier);
    const claimRead = claimsVisible && loaded.rows.length ? await loadIncidentClaims(supabaseAdmin, loaded.rows) : null;
    const facts = claimRead ? incidentClaimFacts(claimRead) : null;
    const rentalRows = await rowsById(
      supabaseAdmin,
      "rentals",
      "id,status,start_date",
      uniqueIds(loaded.rows.map((row) => (row.rental_id as string | null) ?? null)),
    );
    const rentalById = new Map(rentalRows.map((row) => [String(row.id), row]));
    const rows = loaded.rows.map((row) =>
      toIncidentBoardRow({
        id: String(row.id),
        incidentType: String(row.incident_type ?? ""),
        occurredAt: String(row.occurred_at ?? ""),
        reportedAt: (row.reported_at as string | null) ?? null,
        status: String(row.status ?? ""),
        location: (row.location as string | null) ?? null,
        description: (row.description as string | null) ?? null,
        severity: (row.severity as string | null) ?? null,
        atFault: (row.at_fault as string | null) ?? null,
        injuries: typeof row.injuries === "boolean" ? row.injuries : null,
        drivable: typeof row.drivable === "boolean" ? row.drivable : null,
        policeReportNumber: (row.police_report_number as string | null) ?? null,
        otherParty: (row.other_party as string | null) ?? null,
        notes: (row.notes as string | null) ?? null,
        vehicleLabel: vehicles.get(String(row.vehicle_id)) ?? null,
        driverLabel: row.application_id ? apps.get(String(row.application_id)) ?? null : null,
        linkColumn: loaded.linkColumn,
        issueTitle: loaded.linkColumn && row.issue_id ? issueTitles.get(String(row.issue_id)) ?? null : null,
        vehicleId: row.vehicle_id ? String(row.vehicle_id) : null,
        driverId: row.application_id ? String(row.application_id) : null,
        vehicleOnFile: Boolean(row.vehicle_id && vehicles.has(String(row.vehicle_id))),
        rentalId: (row.rental_id as string | null) ?? null,
        rentalLabel: rentalById.has(String(row.rental_id ?? ""))
          ? incidentRentalLabel({
              status: rentalById.get(String(row.rental_id))?.status as string | null,
              startDate: rentalById.get(String(row.rental_id))?.start_date as string | null,
            })
          : null,
        claims: facts ? (facts.get(String(row.id)) ?? null) : null,
      } satisfies IncidentBoardSource),
    );
    const totals = claimsVisible ? await loadIncidentTotals(supabaseAdmin, rows) : null;
    return {
      rows,
      claimsVisible,
      recoveryInstalled: claimRead ? claimRead.recoveryInstalled : (totals?.recoveryInstalled ?? null),
      photoLinksInstalled: claimRead ? claimRead.photoLinksInstalled : null,
      vehicleTotals: totals ? totals.vehicleTotals : null,
      driverTotals: totals ? totals.driverTotals : null,
      totalsCapped: totals?.totalsCapped ?? false,
      totalsLabel: totals?.totalsLabel ?? null,
    };
  });

export const createIncidentBoard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        vehicleId: z.string().uuid(),
        incidentType: z.enum(TYPES),
        occurredAt: z.string().min(10).max(40),
        description: z.string().max(4000).optional(),
        location: z.string().max(240).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const { requireStaff } = await import("@/lib/roles.server");
    const actor = await requireStaff(context.userId);
    assertIncidentBoardEnabled();
    const blockers = incidentCreateBlockers(data);
    if (blockers.length) throw new Error(blockers.join(" "));
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: vehicle, error: vehicleError } = await supabaseAdmin.from("vehicles").select("id").eq("id", data.vehicleId).maybeSingle();
    if (vehicleError) throw new Error(vehicleError.message);
    if (!vehicle) throw new Error("Choose a vehicle.");

    let rentalId: string | null = null;
    let applicationId: string | null = null;
    const { data: found, error: rpcError } = await supabaseAdmin.rpc("rental_at_time", { _vehicle_id: data.vehicleId, _at: data.occurredAt });
    if (!rpcError && typeof found === "string") rentalId = found;
    if (rentalId) {
      const { data: rental } = await supabaseAdmin.from("rentals").select("application_id").eq("id", rentalId).maybeSingle();
      applicationId = (rental?.application_id as string | null) ?? null;
    }

    const { data: row, error } = await supabaseAdmin
      .from("incidents")
      .insert({
        vehicle_id: data.vehicleId,
        rental_id: rentalId,
        application_id: applicationId,
        incident_type: data.incidentType,
        occurred_at: data.occurredAt,
        location: data.location?.trim() || null,
        description: data.description?.trim() || null,
        status: "open",
        created_by: actor.userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    const { logAudit } = await import("@/lib/audit");
    await logAudit(actor, {
      action: "incident.created",
      summary: `Logged ${incidentTypeLabel(data.incidentType)}`,
      entityType: "incident",
      entityId: row.id as string,
      metadata: { status: "open", incident_type: data.incidentType, vehicle_id: data.vehicleId },
    });
    return { id: row.id as string };
  });

export const setIncidentBoardStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), status: z.enum(STATUSES) }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true; status: IncidentStatus }> => {
    const { requireStaff } = await import("@/lib/roles.server");
    const actor = await requireStaff(context.userId);
    assertIncidentBoardEnabled();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: existing, error: readError } = await supabaseAdmin.from("incidents").select("id,status").eq("id", data.id).maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!existing) throw new Error("Incident not found.");
    const move = incidentStatusMove(String(existing.status ?? ""), data.status);
    if (!move.ok) throw new Error(move.reason);
    if (move.unchanged) return { ok: true, status: data.status };

    const { error } = await supabaseAdmin.from("incidents").update({ status: data.status }).eq("id", data.id);
    if (error) throw new Error(error.message);

    const { logAudit } = await import("@/lib/audit");
    await logAudit(actor, {
      action: "incident.status_changed",
      summary: `Incident status ${incidentStatusLabel(String(existing.status))} → ${incidentStatusLabel(data.status)}`,
      entityType: "incident",
      entityId: data.id,
      metadata: { from: existing.status, to: data.status },
    });
    return { ok: true, status: data.status };
  });

async function loadIncidentClaims(
  sb: any,
  rows: any[],
): Promise<{
  ids: string[];
  costs: IncidentCostSource[];
  recoveryInstalled: boolean;
  photoLinksInstalled: boolean;
  recovery: IncidentRecoverySource[];
  links: IncidentPhotoLinkSource[];
  documents: IncidentDocumentSource[];
  inspections: IncidentInspectionSource[];
}> {
  const ids = rows.map((row) => String(row.id));
  const costs: IncidentCostSource[] = [];
  for (let index = 0; index < ids.length; index += 100) {
    const slice = ids.slice(index, index + 100);
    const { data, error } = await sb.from("incidents").select("id,estimated_cost,actual_cost,claim_number").in("id", slice);
    if (error) throw new Error(error.message);
    costs.push(...((data ?? []) as IncidentCostSource[]));
  }
  const recovery = await readProposed(sb, "incidents_log_v1", "incident_id,amount_recovered", ids);
  const links = await readProposed(sb, "incidents_log_v1_links", "id,incident_id,document_id,inspection_id", ids);
  const linkRows = (links.installed ? links.rows : []) as IncidentPhotoLinkSource[];
  const documents = links.installed
    ? await rowsById(sb, "documents", "id,file_name,category,driver_id", uniqueIds(linkRows.map((row) => row.document_id)))
    : [];
  const inspections = links.installed
    ? await rowsById(sb, "inspections", "id,inspection_type,status,vehicle_id", uniqueIds(linkRows.map((row) => row.inspection_id)))
    : [];
  return {
    ids,
    costs,
    recoveryInstalled: recovery.installed,
    photoLinksInstalled: links.installed,
    recovery: (recovery.installed ? recovery.rows : []) as IncidentRecoverySource[],
    links: linkRows,
    documents: documents as IncidentDocumentSource[],
    inspections: inspections as IncidentInspectionSource[],
  };
}

async function readProposed(
  sb: any,
  table: "incidents_log_v1" | "incidents_log_v1_links",
  columns: string,
  ids: string[],
): Promise<{ installed: boolean; rows: any[] }> {
  const probe = await sb.from(table).select(columns).limit(1);
  if (probe.error) {
    if (proposedTableMissing(probe.error)) return { installed: false, rows: [] };
    throw new Error(probe.error.message);
  }
  const loaded: any[] = [];
  for (let index = 0; index < ids.length; index += 100) {
    const slice = ids.slice(index, index + 100);
    const { data, error } = await sb.from(table).select(columns).in("incident_id", slice);
    if (error) {
      if (proposedTableMissing(error)) return { installed: false, rows: [] };
      throw new Error(error.message);
    }
    loaded.push(...(data ?? []));
  }
  return { installed: true, rows: loaded };
}

async function loadIncidentTotals(
  sb: any,
  openRows: IncidentBoardRow[],
): Promise<{
  vehicleTotals: IncidentBoardList["vehicleTotals"];
  driverTotals: IncidentBoardList["driverTotals"];
  totalsCapped: boolean;
  totalsLabel: string | null;
  recoveryInstalled: boolean;
}> {
  const incidents = await eachClaimPage(sb, "incidents", "id,vehicle_id,application_id,estimated_cost,actual_cost", "id");
  if (incidents.capped) {
    return { ...chooseIncidentTotals({ capped: true, allRows: null, openRows }), recoveryInstalled: false };
  }
  const recovery = await eachClaimPage(sb, "incidents_log_v1", "incident_id,amount_recovered", "incident_id");
  if (recovery.capped) {
    return { ...chooseIncidentTotals({ capped: true, allRows: null, openRows }), recoveryInstalled: recovery.installed };
  }
  const facts = incidentClaimFacts({
    ids: incidents.rows.map((row) => String(row.id)),
    costs: incidents.rows.map((row) => ({
      id: String(row.id),
      estimated_cost: row.estimated_cost,
      actual_cost: row.actual_cost,
      claim_number: null,
    })),
    recoveryInstalled: recovery.installed,
    photoLinksInstalled: false,
    recovery: recovery.installed ? (recovery.rows as IncidentRecoverySource[]) : [],
    links: [],
    documents: [],
    inspections: [],
  });
  const vehicleIds = uniqueIds(incidents.rows.map((row) => (row.vehicle_id ? String(row.vehicle_id) : null)));
  const driverIds = uniqueIds(incidents.rows.map((row) => (row.application_id ? String(row.application_id) : null)));
  const vehicleNames = await labelsFor(sb, "vehicles", vehicleIds, vehicleLabel);
  const driverNames = await labelsFor(sb, "applications", driverIds, (row) => String(row.full_name ?? "").trim());
  const allRows = incidents.rows.map((row) => {
    const vehicleId = row.vehicle_id ? String(row.vehicle_id) : "";
    const onFile = Boolean(vehicleId && vehicleNames.has(vehicleId));
    const driverId = row.application_id ? String(row.application_id) : null;
    return {
      vehicleId,
      vehicle: onFile ? (vehicleNames.get(vehicleId) ?? "") : "",
      vehicleOnFile: onFile,
      driverId,
      driver: driverId ? (driverNames.get(driverId) ?? "") : "",
      claims: facts.get(String(row.id)) ?? null,
    };
  });
  return { ...chooseIncidentTotals({ capped: false, allRows, openRows }), recoveryInstalled: recovery.installed };
}

async function eachClaimPage(
  sb: any,
  table: "incidents" | "incidents_log_v1",
  columns: string,
  orderColumn: "id" | "incident_id",
): Promise<{ capped: boolean; installed: boolean; rows: any[] }> {
  const rows: any[] = [];
  for (let page = 0; page < INCIDENT_CLAIM_MAX_PAGES; page += 1) {
    const from = page * INCIDENT_CLAIM_PAGE;
    const { data, error } = await sb
      .from(table)
      .select(columns)
      .order(orderColumn, { ascending: true })
      .range(from, from + INCIDENT_CLAIM_PAGE - 1);
    if (error) {
      if (table !== "incidents" && proposedTableMissing(error)) return { capped: false, installed: false, rows: [] };
      throw new Error(error.message);
    }
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < INCIDENT_CLAIM_PAGE) return { capped: false, installed: true, rows };
  }
  return { capped: true, installed: true, rows: [] };
}

async function rowsById(sb: any, table: "documents" | "inspections" | "rentals", columns: string, ids: string[]): Promise<any[]> {
  const loaded: any[] = [];
  for (let index = 0; index < ids.length; index += 100) {
    const slice = ids.slice(index, index + 100);
    const { data, error } = await sb.from(table).select(columns).in("id", slice);
    if (error) throw new Error(error.message);
    loaded.push(...(data ?? []));
  }
  return loaded;
}

function uniqueIds(values: Array<string | null>): string[] {
  const ids: string[] = [];
  for (const value of values) if (value && !ids.includes(value)) ids.push(value);
  return ids;
}

async function loadOpen(sb: any): Promise<{ rows: any[]; linkColumn: boolean }> {
  const withLink = await sb.from("incidents").select(`${COLUMNS},issue_id`).in("status", OPEN).order("occurred_at", { ascending: false }).limit(200);
  if (!withLink.error) return { rows: withLink.data ?? [], linkColumn: true };
  if (!missingIssueColumn(withLink.error)) throw new Error(withLink.error.message);
  const plain = await sb.from("incidents").select(COLUMNS).in("status", OPEN).order("occurred_at", { ascending: false }).limit(200);
  if (plain.error) throw new Error(plain.error.message);
  return { rows: plain.data ?? [], linkColumn: false };
}

async function titlesFor(sb: any, rows: any[], linkColumn: boolean): Promise<Map<string, string>> {
  const ids = linkColumn ? [...new Set(rows.map((row) => row.issue_id).filter(Boolean))] : [];
  if (!ids.length) return new Map();
  const { data, error } = await sb.from("issues").select("id,title").in("id", ids);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((row: any) => [String(row.id), String(row.title ?? "")]));
}

async function labelsFor(sb: any, table: "vehicles" | "applications", ids: string[], label: (row: any) => string): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map();
  const columns = table === "vehicles" ? "id,unit_number,year,make,model,license_plate" : "id,full_name";
  const { data, error } = await sb.from(table).select(columns).in("id", unique);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((row: any) => [String(row.id), label(row)]));
}

function vehicleLabel(row: any): string {
  const name = [row.year, row.make, row.model].filter(Boolean).join(" ");
  return [row.unit_number ? `Unit ${row.unit_number}` : null, name || null, row.license_plate || null].filter(Boolean).join(" · ");
}
