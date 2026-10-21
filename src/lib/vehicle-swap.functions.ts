import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { SWAP_ENABLED } from "@/lib/record-numbers";

const swapInput = z.object({
  operationId: z.string().uuid(),
  rentalId: z.string().uuid(),
  expectedAssignmentId: z.string().uuid(),
  replacementVehicleId: z.string().uuid(),
  effectiveAt: z.string().datetime({ offset: true }),
  returnMileage: z.number().int().min(0).max(2_000_000).nullable(),
  pickupMileage: z.number().int().min(0).max(2_000_000).nullable(),
  reason: z.string().min(5).max(500),
  agreementEvidenceId: z.string().uuid(),
});

export type SwapResult = {
  contract: "vehicle-swap-v1";
  rentalId: string;
  operationId: string;
  closedAssignmentId: string;
  replacementAssignmentId: string;
  swapNumber: number;
  outgoingStatus: "maintenance";
  billing: "unchanged";
  recovered: boolean;
};

/** Manager-only. The RPC is not called while SWAP_ENABLED is false. */
export const swapRentalVehicle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => swapInput.parse(d))
  .handler(async ({ data, context }) => {
    if (!SWAP_ENABLED) throw new Error("Vehicle swap is disabled pending installation and acceptance");
    const { requireManager } = await import("@/lib/roles.server");
    await requireManager(context.userId);
    const { data: result, error } = await (context.supabase as any).rpc("swap_rental_vehicle_tx", {
      _operation_id: data.operationId,
      _rental_id: data.rentalId,
      _expected_assignment_id: data.expectedAssignmentId,
      _replacement_vehicle_id: data.replacementVehicleId,
      _effective_at: data.effectiveAt,
      _return_mileage: data.returnMileage,
      _pickup_mileage: data.pickupMileage,
      _reason: data.reason,
      _agreement_evidence_id: data.agreementEvidenceId,
    });
    if (error) throw new Error(error.message);
    const parsed = z.object({
      contract: z.literal("vehicle-swap-v1"),
      rentalId: z.string().uuid(),
      operationId: z.string().uuid(),
      closedAssignmentId: z.string().uuid(),
      replacementAssignmentId: z.string().uuid(),
      swapNumber: z.number().int().positive(),
      outgoingStatus: z.literal("maintenance"),
      billing: z.literal("unchanged"),
      recovered: z.boolean(),
    }).parse(result);
    if (parsed.rentalId !== data.rentalId || parsed.operationId !== data.operationId) {
      throw new Error("Swap response binding mismatch; reconcile the original operation");
    }
    return parsed;
  });

export type AssignmentHistoryEntry = {
  id: string;
  vehicleId: string;
  vehicle: string;
  start: string | null;
  end: string | null;
  mileage: number | null;
  swapNumber: number | null;
  reason: string | null;
  status: string | null;
};

const historyInput = z.object({
  rentalId: z.string().uuid().nullable().optional(),
  vehicleId: z.string().uuid().nullable().optional(),
}).refine((d) => Boolean(d.rentalId || d.vehicleId), { message: "A rental or a vehicle is required" });

function historyMissing(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const text = `${error.code ?? ""} ${error.message ?? ""}`;
  return /PGRST202|PGRST205|does not exist|schema cache|Could not find the function/i.test(text);
}

/**
 * Read-only. Today's database has no assignment tables; a missing function
 * returns an empty list instead of an error. No swap RPC is involved.
 */
export const listAssignmentHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => historyInput.parse(d))
  .handler(async ({ data, context }): Promise<{ ready: boolean; entries: AssignmentHistoryEntry[] }> => {
    const { requireStaff } = await import("@/lib/roles.server");
    await requireStaff(context.userId);
    const { data: rows, error } = await (context.supabase as any).rpc("list_assignment_history_v1", {
      _rental: data.rentalId ?? null,
      _vehicle: data.vehicleId ?? null,
    });
    if (historyMissing(error)) return { ready: false, entries: [] };
    if (error) throw new Error(error.message);
    const entries = z.array(z.object({
      id: z.string().uuid(),
      vehicleId: z.string().uuid(),
      vehicle: z.string(),
      start: z.string().nullable(),
      end: z.string().nullable(),
      mileage: z.number().nullable(),
      swapNumber: z.number().int().positive().nullable(),
      reason: z.string().nullable(),
      status: z.string().nullable(),
    })).parse(rows ?? []);
    return { ready: true, entries };
  });
