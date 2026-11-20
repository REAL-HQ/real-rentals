// Back office: Swap Vehicle on an active rental (Bookings → the rental →
// Vehicle → Swap Vehicle). Manager or Owner for every write; staff read the
// history. Rules: vehicle-swap.ts; server logic: vehicle-swap.server.ts.
//
// Off until the migration (supabase/migrations/20261120130000_rental_vehicle_swaps.sql)
// is installed AND app_settings.vehicle_swap.enabled is true: each handler
// checks the gate before anything else and refuses with nothing written.
// This replaces the M2 packet's hard-coded SWAP_ENABLED = false.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { FUEL_LEVELS } from "@/lib/pickup-handover";
import { OUTGOING_STATUSES, SWAP_REASON_CODES, type SwapGate } from "@/lib/vehicle-swap";
import type { SwapHistoryEntry } from "@/lib/vehicle-swap.server";

export type { SwapHistoryEntry };

const Terms = z
  .object({
    damageWaiver: z.enum(["accepted", "declined"]).optional(),
    paymentSchedule: z.enum(["weekly", "every_4_weeks"]).optional(),
    paymentMethod: z.string().max(40).optional(),
    vehicleOwner: z.string().trim().max(160).optional(),
  })
  .strict()
  .optional();
const termsRaw = (t: z.infer<typeof Terms>) =>
  t
    ? { damage_waiver: t.damageWaiver, payment_schedule: t.paymentSchedule, payment_method: t.paymentMethod || undefined, vehicle_owner: t.vehicleOwner || undefined }
    : null;

const PreviewInput = z.object({ rentalId: z.string().uuid(), toVehicleId: z.string().uuid(), terms: Terms }).strict();
const SendInput = PreviewInput.extend({
  reasonCode: z.enum(SWAP_REASON_CODES),
  reason: z.string().trim().min(5).max(1000),
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  companyAck: z.boolean().optional(),
  idempotencyKey: z.string().min(8).max(120),
}).strict();
const CompleteInput = z
  .object({
    swapId: z.string().uuid(),
    fromVehicleStatus: z.enum(OUTGOING_STATUSES),
    returnMiles: z.number().int().min(0).max(1_999_999),
    pickupMiles: z.number().int().min(0).max(1_999_999),
    returnFuel: z.enum(FUEL_LEVELS),
    pickupFuel: z.enum(FUEL_LEVELS),
  })
  .strict();
const CancelInput = z.object({ swapId: z.string().uuid(), reason: z.string().trim().min(5).max(500) }).strict();

async function manager(userId: string) {
  const { requireTier } = await import("@/lib/roles.server");
  return requireTier(userId, "manager");
}
async function admin() {
  return (await import("@/integrations/supabase/client.server")).supabaseAdmin;
}
const unwrap = (r: { status: number; body: Record<string, unknown> }) => r.body;

/** Gate + everything the Swap Vehicle dialog needs. Read-only. */
export const getSwapOptions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ rentalId: z.string().uuid() }).strict().parse(d))
  .handler(async ({ data, context }) => {
    await manager(context.userId);
    const { swapOptions } = await import("@/lib/vehicle-swap.server");
    return unwrap(await swapOptions(await admin(), data.rentalId)) as { ok: boolean; enabled?: boolean; gate?: SwapGate; error?: string } & Record<string, any>;
  });

/** Exact swap agreement the renter would get (PDF + fingerprint). Read-only. */
export const previewSwapVehicle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => PreviewInput.parse(d))
  .handler(async ({ data, context }) => {
    await manager(context.userId);
    const { previewSwap } = await import("@/lib/vehicle-swap.server");
    return unwrap(await previewSwap(await admin(), { rentalId: data.rentalId, toVehicleId: data.toVehicleId, terms: termsRaw(data.terms) })) as Record<string, any>;
  });

/** Stores the swap and sends the swap agreement for e-signature. */
export const sendSwapVehicleAgreement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => SendInput.parse(d))
  .handler(async ({ data, context }) => {
    const actor = await manager(context.userId);
    const { sendSwapAgreement } = await import("@/lib/vehicle-swap.server");
    const { logAudit } = await import("@/lib/audit.server");
    return unwrap(
      await sendSwapAgreement(
        await admin(),
        {
          rentalId: data.rentalId,
          toVehicleId: data.toVehicleId,
          terms: termsRaw(data.terms),
          reasonCode: data.reasonCode,
          reason: data.reason,
          fingerprint: data.fingerprint,
          companyAck: data.companyAck,
          idempotencyKey: data.idempotencyKey,
          actorUserId: context.userId,
          actorLabel: `${actor.email || "Staff"} (staff)`,
        },
        { audit: (e) => logAudit(actor, e) },
      ),
    ) as Record<string, any>;
  });

/** Handover: the rental moves to the replacement car (complete_rental_vehicle_swap_tx). */
export const completeSwapVehicle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => CompleteInput.parse(d))
  .handler(async ({ data, context }) => {
    await manager(context.userId);
    const { completeSwap } = await import("@/lib/vehicle-swap.server");
    const { swapId, ...handover } = data;
    return unwrap(await completeSwap(await admin(), { swapId, handover, actorUserId: context.userId })) as Record<string, any>;
  });

/** Cancels an open swap; an unsigned swap agreement is voided through esign. */
export const cancelSwapVehicle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => CancelInput.parse(d))
  .handler(async ({ data, context }) => {
    const actor = await manager(context.userId);
    const { cancelSwap } = await import("@/lib/vehicle-swap.server");
    const { logAudit } = await import("@/lib/audit.server");
    return unwrap(await cancelSwap(await admin(), { swapId: data.swapId, reason: data.reason, actorUserId: context.userId, actorLabel: `${actor.email || "Staff"} (staff)` }, { audit: (e) => logAudit(actor, e) })) as Record<string, any>;
  });

/** Swap history for a rental or a vehicle. Staff read; empty until installed. */
export const listVehicleSwaps = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({ rentalId: z.string().uuid().nullable().optional(), vehicleId: z.string().uuid().nullable().optional() })
      .strict()
      .refine((v) => Boolean(v.rentalId || v.vehicleId), "rentalId or vehicleId is required")
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { requireTier } = await import("@/lib/roles.server");
    await requireTier(context.userId, "coordinator");
    const { listSwaps } = await import("@/lib/vehicle-swap.server");
    return listSwaps(await admin(), { rentalId: data.rentalId ?? null, vehicleId: data.vehicleId ?? null });
  });
