import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireStaff, requireManager } from "@/lib/roles.server";
import { z } from "zod";
import {
  ReservationSchema,
  OptionsSchema,
  HistorySchema,
  type ReservationReply,
} from "./reservations";
const unavailable = {
  available: false as const,
  message:
    "Reservations are unavailable. This feature and its reviewed database migrations must be enabled separately.",
};
const enabled = () => process.env.RESERVATIONS_ENABLED === "true";
function failure(error: { code?: string; message?: string }) {
  if (["PGRST202", "42P01", "42883", "42501"].includes(error.code ?? "")) return unavailable;
  const m = error.message ?? "";
  const reasons: Record<string, string> = {
    Forbidden: "You do not have permission for this action.",
    stale_version: "This reservation changed. Reload it before trying again.",
    hold_expired: "The temporary hold expired. Expire or cancel it before creating another hold.",
    not_expirable:
      "Only an elapsed temporary hold can expire. Confirmed no-shows require a Manager decision.",
    vehicle_not_ready: "Vehicle is held or readiness could not be verified.",
    pre_delivery_evidence_missing: "Completed pre-delivery inspection evidence is missing.",
    active_rental_conflict:
      "An active rental blocks this vehicle, including open-ended weekly rentals.",
    applicant_not_approved: "The applicant must be approved before reserving.",
    invalid_transition: "This action is not permitted in the current state.",
    invalid_schedule: "Check the market-local quarter-hour schedule and end date.",
    market_scheduling_configuration_missing:
      "Owner-approved market timezone and turnaround are required.",
    reason_required: "Enter a cancellation reason.",
  };
  if (error.code === "23P01" || error.code === "23505")
    return {
      available: false as const,
      message:
        "Allocation conflict. Another reservation already holds this vehicle or applicant. Reload availability.",
    };
  return {
    available: false as const,
    message:
      Object.entries(reasons).find(([key]) => m.includes(key))?.[1] ??
      "The reservation request could not be verified. Reload before retrying; do not assume a change succeeded.",
  };
}
async function rpc<T>(
  client: unknown,
  name: string,
  args: Record<string, unknown>,
  schema: z.ZodType<T>,
  canManage: boolean,
): Promise<ReservationReply<T>> {
  try {
    // Proposed RPCs are intentionally absent from generated installed-schema types.
    const scoped = client as {
      rpc: (
        name: string,
        args: Record<string, unknown>,
      ) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
    };
    const { data, error } = await scoped.rpc(name, args);
    if (error) return failure(error);
    const parsed = schema.safeParse(data);
    return parsed.success
      ? { available: true, value: parsed.data, canManage }
      : {
          available: false,
          message: "Reservation response could not be verified. Reload before retrying.",
        };
  } catch {
    return {
      available: false,
      message:
        "Reservations could not be reached. Reload to verify the current state before retrying.",
    };
  }
}
export const listReservations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        view: z.enum(["upcoming", "drafts", "history"]),
        after: z.string().datetime({ offset: true }).optional(),
        afterId: z.string().uuid().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const actor = await requireStaff(context.userId);
    if (!enabled()) return unavailable;
    return rpc(
      context.supabase,
      "reservation_interface_list",
      {
        _view: data.view,
        _after: data.after ?? "-infinity",
        _after_id: data.afterId ?? "00000000-0000-0000-0000-000000000000",
      },
      z.array(ReservationSchema),
      actor.tier !== "coordinator",
    );
  });
export const getReservationOptions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        q: z.string().max(100).default(""),
        vehicleQuery: z.string().max(100).default(""),
        pickupAt: z.string().datetime({ offset: true }).nullable().default(null),
        endAt: z.string().datetime({ offset: true }).nullable().default(null),
        excludeId: z.string().uuid().nullable().default(null),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireManager(context.userId);
    if (!enabled()) return unavailable;
    return rpc(
      context.supabase,
      "reservation_interface_options",
      {
        _q: data.q,
        _vehicle_q: data.vehicleQuery,
        _pickup: data.pickupAt,
        _end: data.endAt,
        _exclude: data.excludeId,
      },
      OptionsSchema,
      true,
    );
  });
export const getReservationHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const actor = await requireStaff(context.userId);
    if (!enabled()) return unavailable;
    return rpc(
      context.supabase,
      "reservation_interface_history",
      { _id: data.id },
      HistorySchema,
      actor.tier !== "coordinator",
    );
  });
export const changeReservation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        action: z.enum(["create", "edit", "reserve", "confirm", "cancel", "expire"]),
        id: z.string().uuid().optional(),
        version: z.union([z.number().int().positive(), z.string().regex(/^[1-9]\d*$/)]).optional(),
        applicationId: z.string().uuid().optional(),
        vehicleId: z.string().uuid().nullable().default(null),
        pickupAt: z.string().datetime({ offset: true }).optional(),
        endAt: z.string().datetime({ offset: true }).nullable().default(null),
        reason: z.string().trim().max(1000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireManager(context.userId);
    if (!enabled()) return unavailable;
    if (data.action === "create") {
      if (!data.applicationId || !data.pickupAt)
        return { available: false as const, message: "Choose an applicant and pickup time." };
      const result = await rpc(
        context.supabase,
        "reservation_create",
        {
          _application: data.applicationId,
          _vehicle: data.vehicleId,
          _pickup: data.pickupAt,
          _end: data.endAt,
        },
        z.string().uuid(),
        true,
      );
      return result.available
        ? { available: true as const, value: { id: result.value }, canManage: true }
        : result;
    }
    if (!data.id || !data.version)
      return {
        available: false as const,
        message: "Reload the reservation before making changes.",
      };
    if (data.action === "edit" && !data.pickupAt)
      return { available: false as const, message: "A full replacement schedule is required." };
    // Caller-scoped RPC preserves auth.uid(); never use service-role identity or rental creation fallback.
    return rpc(
      context.supabase,
      "reservation_change",
      {
        _id: data.id,
        _version: data.version,
        _action: data.action,
        _vehicle: data.vehicleId,
        _pickup: data.pickupAt ?? null,
        _end: data.endAt,
        _reason: data.reason ?? null,
      },
      z
        .union([
          z.object({ id: z.string().uuid() }),
          z.array(z.object({ id: z.string().uuid() })).length(1),
        ])
        .transform((value) => (Array.isArray(value) ? value[0] : value)),
      true,
    );
  });
