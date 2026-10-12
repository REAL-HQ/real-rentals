import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireStaff } from "@/lib/roles.server";
import { logAudit } from "@/lib/audit";

const text = z.string().max(2000).nullable();
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable();
// Never accept a Partial<Application> at this elevated boundary. Identity
// ownership, document pointers, review decisions and Contact Status are absent.
const patchSchema = z
  .object({
    status: z.enum(["new", "reviewing", "suspended", "declined", "closed"]).optional(),
    contacted_at: z.string().datetime().optional(),
    phone: z.string().min(7).max(32).optional(),
    city: text.optional(),
    state: text.optional(),
    address: text.optional(),
    zip: text.optional(),
    notes: text.optional(),
    background_check_status: z.enum(["pending", "passed", "failed"]).optional(),
    mvr_status: z.enum(["pending", "passed", "failed"]).optional(),
    incident_count: z.number().int().nonnegative().optional(),
    vehicle_id: z.string().uuid().nullable().optional(),
    deposit_amount: z.number().nonnegative().nullable().optional(),
    deposit_paid: z.number().nonnegative().nullable().optional(),
    weekly_rent: z.number().nonnegative().nullable().optional(),
    contract_start_date: date.optional(),
    contract_end_date: date.optional(),
    license_number: text.optional(),
    license_state: text.optional(),
    license_expiration: date.optional(),
  })
  .strict()
  .refine((p) => Object.keys(p).length > 0, "No changes supplied");

export type LifecyclePatch = z.infer<typeof patchSchema>;

export const updateApplicationLifecycle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), patch: patchSchema }).strict().parse(d),
  )
  .handler(async ({ data, context }) => {
    const actor = await requireStaff(context.userId);
    const keys = Object.keys(data.patch);
    if (actor.tier === "coordinator") {
      const permitted = ["status", "contacted_at", "phone", "city", "state"];
      if (keys.some((k) => !permitted.includes(k)) || data.patch.status === "suspended") {
        throw new Error("Forbidden: this change requires a Manager");
      }
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: before, error: readError } = await supabaseAdmin
      .from("applications")
      .select("id,status,contacted_at")
      .eq("id", data.id)
      .is("deleted_at", null)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!before) throw new Error("Application not found");
    if (data.patch.status && data.patch.status !== before.status) {
      if (before.status === "active")
        throw new Error("End the rental through the rental workflow first");
      if (
        actor.tier === "coordinator" &&
        !["partial", "new", "reviewing", "declined", "closed"].includes(before.status)
      ) {
        throw new Error("Forbidden: changing a decided application requires a Manager");
      }
      const { data: rentals, error: rentalError } = await supabaseAdmin
        .from("rentals")
        .select("id")
        .eq("application_id", data.id)
        .eq("status", "active")
        .limit(1);
      if (rentalError) throw new Error(rentalError.message);
      if (!rentals || rentals.length)
        throw new Error("Cannot change lifecycle while an active rental exists");
    }
    const patch = { ...data.patch };
    // Time is authoritative on the server. Never overwrite the first contact.
    if (patch.contacted_at || (patch.status && patch.status !== "new")) {
      patch.contacted_at = before.contacted_at ?? new Date().toISOString();
    }
    let query = supabaseAdmin
      .from("applications")
      .update(patch)
      .eq("id", data.id)
      .is("deleted_at", null);
    query = before.status === null ? query.is("status", null) : query.eq("status", before.status);
    query =
      before.contacted_at === null
        ? query.is("contacted_at", null)
        : query.eq("contacted_at", before.contacted_at);
    // Return only fields this caller was allowed to write, never a full row.
    const columns = [...new Set(["id", "status", "contacted_at", ...Object.keys(patch)])].join(",");
    const { data: rows, error } = await query.select(columns);
    if (error) throw new Error(error.message);
    if (!rows || rows.length !== 1)
      throw new Error(
        "No application was updated. Refresh and retry; it may have changed or been removed.",
      );
    await logAudit(actor, {
      action: "application.lifecycle_updated",
      summary: "Updated application lifecycle or profile",
      entityType: "application",
      entityId: data.id,
      metadata: {
        fields: Object.keys(patch),
        previous_status: before.status,
        status: patch.status ?? before.status,
      },
    });
    return rows[0] as unknown as Record<string, string | number | null>;
  });
