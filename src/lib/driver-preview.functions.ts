import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type PreviewDriverRow = { id: string; name: string | null; email: string | null; phone: string | null; status: string | null };

const PAGE = 20;

/** Owner/Manager only: search driver accounts by name, email, phone or ID (server-side paging). */
export const searchPreviewDrivers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ q: z.string().trim().max(120).default(""), page: z.number().int().min(0).max(500).default(0) }).parse(d))
  .handler(async ({ data, context }): Promise<{ rows: PreviewDriverRow[]; hasMore: boolean }> => {
    const { requireManager } = await import("@/lib/roles.server");
    await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin
      .from("applications")
      .select("user_id,full_name,email,phone,status,created_at")
      .not("user_id", "is", null)
      .order("created_at", { ascending: false })
      .range(data.page * PAGE, data.page * PAGE + PAGE);
    const term = data.q.replace(/[%,()]/g, " ").trim();
    if (term) {
      const digits = term.replace(/\D/g, "");
      const ors = [`full_name.ilike.%${term}%`, `email.ilike.%${term}%`];
      if (digits.length >= 3) ors.push(`phone.ilike.%${digits.slice(-10)}%`);
      if (/^[0-9a-f-]{36}$/i.test(term)) ors.push(`user_id.eq.${term}`, `id.eq.${term}`);
      q = q.or(ors.join(","));
    }
    const { data: rows, error } = await q;
    if (error) throw new Error("Search failed");
    const seen = new Set<string>();
    const out: PreviewDriverRow[] = [];
    for (const r of (rows ?? []) as any[]) {
      if (seen.has(r.user_id)) continue;
      seen.add(r.user_id);
      out.push({ id: r.user_id, name: r.full_name ?? null, email: r.email ?? null, phone: r.phone ?? null, status: r.status ?? null });
    }
    return { rows: out.slice(0, PAGE), hasMore: (rows ?? []).length > PAGE };
  });

/** Records start/end of a preview session and returns the driver's display name. */
export const recordDriverPreview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ driverId: z.string().uuid(), event: z.enum(["start", "end"]) }).parse(d))
  .handler(async ({ data, context }): Promise<{ name: string }> => {
    const { requireManager } = await import("@/lib/roles.server");
    const actor = await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { isDriverAccount } = await import("@/lib/driver-preview.server");
    if (!(await isDriverAccount(supabaseAdmin, data.driverId))) throw new Error("Driver not found");
    const { data: app } = await supabaseAdmin.from("applications").select("full_name,email").eq("user_id", data.driverId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    const name = app?.full_name || app?.email || "Driver";
    const { logAudit } = await import("@/lib/audit");
    await logAudit(actor, {
      action: data.event === "start" ? "driver_preview.started" : "driver_preview.ended",
      summary: data.event === "start" ? "Started read-only driver preview" : "Ended read-only driver preview",
      entityType: "driver",
      entityId: data.driverId,
      metadata: { context: "experience_selector_driver_preview", at: new Date().toISOString() },
    });
    return { name };
  });
