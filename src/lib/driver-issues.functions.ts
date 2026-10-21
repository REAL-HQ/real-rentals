import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  DRIVER_ISSUE_NOTES_ENABLED,
  ISSUE_STATUSES,
  incidentSeedFromIssue,
  isIssueClosed,
  type IssueIncidentSeed,
} from "@/lib/driver-issues";

/** Duplicated so this module does not load the notice sender while the flag is off. */
const DRIVER_NOTIFICATIONS_ENABLED: boolean = false as boolean;

// Manager inbox for public.issues.
//
// RLS lets admin and team (Owner and Manager) manage every row, and lets a
// driver read and insert only their own. Coordinators are not in that policy.
// These handlers run as the service role, so they repeat that gate with
// requireManager and do not use requireStaff.

async function gate(userId: string) {
  const { requireManager } = await import("@/lib/roles.server");
  return requireManager(userId);
}

const CLOSED = ["resolved", "closed"] as const;

export type DriverIssueRow = {
  id: string;
  title: string;
  body: string | null;
  kind: string;
  severity: string;
  status: string;
  closed: boolean;
  createdAt: string;
  driverId: string;
  driverName: string;
  applicationId: string | null;
  vehicleId: string | null;
  vehicleLabel: string | null;
  rentalId: string | null;
  notesEnabled: false;
};

export const listDriverIssues = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ filter: z.enum(["open", "closed", "all"]).default("open") }).parse(d ?? {}),
  )
  .handler(async ({ data, context }): Promise<{ rows: DriverIssueRow[]; truncated: boolean }> => {
    await gate(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let q = supabaseAdmin
      .from("issues")
      .select("id,driver_id,rental_id,vehicle_id,kind,severity,title,body,status,created_at", { count: "exact" })
      .order("created_at", { ascending: false })
      .limit(200);
    if (data.filter === "closed") q = q.in("status", [...CLOSED]);
    if (data.filter === "open") q = q.not("status", "in", "(resolved,closed)");

    const { data: rows, error, count } = await q;
    if (error) throw new Error(error.message);
    const list = rows ?? [];

    const driverIds = [...new Set(list.map((r) => r.driver_id).filter(Boolean))];
    const rentalIds = [...new Set(list.map((r) => r.rental_id).filter(Boolean))] as string[];
    const vehicleIds = [...new Set(list.map((r) => r.vehicle_id).filter(Boolean))] as string[];

    const [apps, rentals, vehicles] = await Promise.all([
      driverIds.length
        ? supabaseAdmin
            .from("applications")
            .select("id,full_name,email,user_id,created_at")
            .in("user_id", driverIds)
            .order("created_at", { ascending: false })
            .limit(1000)
        : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
      rentalIds.length
        ? supabaseAdmin.from("rentals").select("id,application_id").in("id", rentalIds)
        : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
      vehicleIds.length
        ? supabaseAdmin
            .from("vehicles")
            .select("id,unit_number,year,make,model,license_plate")
            .in("id", vehicleIds)
        : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
    ]);

    const rentalApp = new Map<string, string | null>();
    for (const r of rentals.data ?? []) rentalApp.set(String(r.id), (r.application_id as string | null) ?? null);

    const appsByUser = new Map<string, Array<{ id: string; name: string }>>();
    for (const a of apps.data ?? []) {
      const uid = String(a.user_id);
      const name = String(a.full_name || a.email || "").trim();
      const bucket = appsByUser.get(uid) ?? [];
      bucket.push({ id: String(a.id), name });
      appsByUser.set(uid, bucket);
    }

    const vehicleById = new Map<string, string>();
    for (const v of vehicles.data ?? []) {
      const name = [v.year, v.make, v.model].filter(Boolean).join(" ");
      const bits = [v.unit_number ? `Unit ${v.unit_number}` : null, name || null, v.license_plate || null].filter(Boolean);
      vehicleById.set(String(v.id), bits.join(" · ") || "Vehicle");
    }

    return {
      truncated: (count ?? list.length) > list.length,
      rows: list.map((r) => {
        const linkedApp = r.rental_id ? rentalApp.get(String(r.rental_id)) : null;
        const candidates = appsByUser.get(String(r.driver_id)) ?? [];
        const chosen = (linkedApp && candidates.find((a) => a.id === linkedApp)) || candidates[0] || null;
        return {
          id: r.id,
          title: r.title,
          body: r.body,
          kind: r.kind,
          severity: r.severity,
          status: r.status,
          closed: isIssueClosed(r.status),
          createdAt: r.created_at,
          driverId: r.driver_id,
          driverName: chosen?.name || "Driver",
          applicationId: chosen?.id ?? linkedApp ?? null,
          vehicleId: r.vehicle_id,
          vehicleLabel: r.vehicle_id ? vehicleById.get(String(r.vehicle_id)) ?? "Vehicle" : null,
          rentalId: r.rental_id,
          notesEnabled: DRIVER_ISSUE_NOTES_ENABLED,
        };
      }),
    };
  });

export const updateDriverIssueStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), status: z.enum(ISSUE_STATUSES) }).parse(d),
  )
  .handler(async ({ data, context }): Promise<{ ok: true; status: string } | { ok: false; error: string }> => {
    const actor = await gate(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: existing, error: readErr } = await supabaseAdmin
      .from("issues")
      .select("id,status,title")
      .eq("id", data.id)
      .maybeSingle();
    if (readErr) return { ok: false, error: readErr.message };
    if (!existing) return { ok: false, error: "Issue not found." };
    if (existing.status === data.status) return { ok: true, status: data.status };

    const { error } = await supabaseAdmin.from("issues").update({ status: data.status }).eq("id", data.id);
    if (error) return { ok: false, error: error.message };

    const { logAudit } = await import("@/lib/audit.server");
    await logAudit(actor, {
      action: "issue.status_changed",
      summary: `Marked "${existing.title}" ${data.status}`,
      entityType: "issue",
      entityId: data.id,
      metadata: { from: existing.status, to: data.status },
    });
    if (DRIVER_NOTIFICATIONS_ENABLED === true) {
      await import("@/lib/driver-notifications.server")
        .then((m) => m.notifyIssueStatusChanged(data.id))
        .catch((err) => console.error("[driver-notifications] issue_status", err));
    }
    return { ok: true, status: data.status };
  });

/**
 * Staff notes have no column. The flag stays false, and this refuses even if
 * the flag is turned on, until a later change writes the proposed table.
 */
export const saveDriverIssueNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), note: z.string().max(4000) }).parse(d))
  .handler(async ({ context }): Promise<{ ok: false; error: string }> => {
    await gate(context.userId);
    if (!DRIVER_ISSUE_NOTES_ENABLED) return { ok: false, error: "Staff notes are not installed." };
    return { ok: false, error: "Staff notes are not installed." };
  });

export const incidentSeedForIssue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<IssueIncidentSeed | null> => {
    await gate(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("issues")
      .select("kind,title,body,vehicle_id,created_at")
      .eq("id", data.id)
      .maybeSingle();
    if (error || !row) return null;
    return incidentSeedFromIssue({
      kind: row.kind,
      title: row.title,
      body: row.body,
      vehicleId: row.vehicle_id,
      createdAt: row.created_at,
    });
  });
