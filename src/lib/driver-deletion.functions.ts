import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { requireOwner } from "@/lib/roles.server";
import { logAudit } from "@/lib/audit";

// Owner-only driver deletion. Every write goes through the Owner-checked
// database functions (soft_delete/restore/purge_application, set_legal_hold),
// called as the signed-in user so the database checks the role itself too.
// Retention rules live in purge_application; never add a parallel delete path.

const idInput = (d: unknown) => z.object({ applicationId: z.string().uuid() }).parse(d);

const ERRORS: Record<string, string> = {
  not_found: "That driver record was not found.",
  active_rental: "This driver has an active rental. End it in Rentals before deleting.",
  not_soft_deleted: "Delete the driver first, then delete permanently.",
  legal_hold: "This driver is on Legal Hold, so permanent deletion is blocked.",
  open_charge: "This driver has an open toll or charge. Resolve it in Charges before deleting.",
  unpaid_payment: "This driver has an unpaid or upcoming payment. Settle, waive or void it in Payments before deleting.",
  purged: "This record was permanently deleted and cannot be restored.",
};

export const getDeletionSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(idInput)
  .handler(async ({ data, context }) => {
    await requireOwner(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const id = data.applicationId;
    const [app, docs, wl, holds, rentals, pays, agr, dups] = await Promise.all([
      supabaseAdmin.from("applications").select("full_name,status,deleted_at,purged_at,legal_hold").eq("id", id).maybeSingle(),
      supabaseAdmin.from("documents").select("category").eq("driver_id", id),
      supabaseAdmin.from("waitlist").select("id", { count: "exact", head: true }).eq("promoted_application_id", id),
      supabaseAdmin.from("application_waitlist_holds").select("id", { count: "exact", head: true }).eq("application_id", id),
      supabaseAdmin.from("rentals").select("status").eq("application_id", id),
      supabaseAdmin.from("payments").select("status").eq("driver_id", id),
      supabaseAdmin.from("agreements").select("status").eq("application_id", id),
      supabaseAdmin.from("applications").select("id", { count: "exact", head: true }).eq("primary_application_id", id),
    ]);
    if (!app.data) return { ok: false as const, error: ERRORS.not_found };
    const identity = new Set(["license_front", "license_back", "insurance", "insurance_card", "gig_profile", "trip_history"]);
    const cats = (docs.data ?? []).map((d: any) => String(d.category));
    const closed = new Set(["paid", "succeeded", "refunded", "partially_refunded", "void", "voided", "waived", "cancelled", "canceled", "resolved"]);
    return {
      ok: true as const,
      name: app.data.full_name,
      status: app.data.status,
      deleted: !!app.data.deleted_at,
      purged: !!app.data.purged_at,
      legalHold: !!app.data.legal_hold,
      waitlistHistory: (wl.count ?? 0) + (holds.count ?? 0) > 0,
      duplicates: dups.count ?? 0,
      documents: cats.length,
      identityDocuments: cats.filter((c) => identity.has(c)).length,
      retainedDocuments: cats.filter((c) => !identity.has(c)).length,
      activeRentals: (rentals.data ?? []).filter((r: any) => r.status === "active").length,
      rentals: (rentals.data ?? []).length,
      payments: (pays.data ?? []).length,
      openCharges: (pays.data ?? []).filter((p: any) => !closed.has(String(p.status ?? "").toLowerCase())).length,
      agreements: (agr.data ?? []).length,
    };
  });

async function run(context: any, fn: string, args: Record<string, unknown>) {
  const { data, error } = await context.supabase.rpc(fn, args);
  if (error) return { ok: false as const, error: error.message === "Forbidden" ? "Forbidden" : "Could not complete. Please try again." };
  const r = data as any;
  if (!r?.ok) return { ok: false as const, error: ERRORS[r?.error] ?? "Could not complete. Please try again." };
  return { ok: true as const, already: !!r.already, result: r };
}

export const deleteDriver = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ applicationId: z.string().uuid(), reason: z.string().max(500).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const actor = await requireOwner(context.userId);
    const res = await run(context, "soft_delete_application", { _id: data.applicationId, _reason: data.reason ?? null });
    if (res.ok && !res.already)
      await logAudit(actor, { action: "driver.deleted", summary: "Deleted a driver record (recoverable)", entityType: "application", entityId: data.applicationId, metadata: {} });
    return res;
  });

export const restoreDriver = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(idInput)
  .handler(async ({ data, context }) => {
    const actor = await requireOwner(context.userId);
    const res = await run(context, "restore_application", { _id: data.applicationId });
    if (res.ok && !res.already)
      await logAudit(actor, { action: "driver.restored", summary: "Restored a deleted driver record", entityType: "application", entityId: data.applicationId, metadata: {} });
    return res;
  });

export const setLegalHold = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ applicationId: z.string().uuid(), on: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireOwner(context.userId);
    return run(context, "set_legal_hold", { _id: data.applicationId, _on: data.on });
  });

export const purgeDriver = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(idInput)
  .handler(async ({ data, context }) => {
    const actor = await requireOwner(context.userId);
    const res = await run(context, "purge_application", { _id: data.applicationId });
    if (!res.ok) return res;
    if (!res.already)
      await logAudit(actor, {
        action: "driver.purged",
        summary: "Permanently deleted eligible personal data for a driver record",
        entityType: "application",
        entityId: data.applicationId,
        metadata: { removed: res.result.removed, retained_documents: res.result.retained_documents },
      });
    const { processFileJobs } = await import("@/lib/driver-deletion.server");
    const files = await processFileJobs(data.applicationId);
    return { ...res, files };
  });

export const retryFileCleanup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireOwner(context.userId);
    const { processFileJobs } = await import("@/lib/driver-deletion.server");
    return processFileJobs(null);
  });

export const listDeletedDrivers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireOwner(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: rows }, { data: jobs }] = await Promise.all([
      supabaseAdmin
        .from("applications")
        .select("id,full_name,status,deleted_at,purged_at,legal_hold")
        .not("deleted_at", "is", null)
        .order("deleted_at", { ascending: false })
        .limit(200),
      supabaseAdmin.from("deletion_file_jobs").select("status").neq("status", "done"),
    ]);
    return {
      drivers: (rows ?? []) as { id: string; full_name: string; status: string; deleted_at: string; purged_at: string | null; legal_hold: boolean }[],
      pendingFiles: (jobs ?? []).filter((j: any) => j.status === "pending").length,
      failedFiles: (jobs ?? []).filter((j: any) => j.status === "failed").length,
    };
  });
