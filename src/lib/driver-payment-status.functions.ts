import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { requireTier } from "@/lib/roles.server";
import { computePayCells } from "@/lib/driver-payment-status";

/**
 * Server-authoritative driver Payment / Deposit cells for the Drivers list
 * (driverIds omitted) and Driver Profile (one id). Reads as the caller, so RLS
 * decides which rentals/payments count; nothing is written.
 */
export const getDriverPayStatuses = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ driverIds: z.array(z.string().uuid()).max(1000).optional() }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    await requireTier(context.userId, "coordinator");
    const sb = context.supabase as any;
    let rq = sb.from("rentals").select("id,application_id,status,deposit_amount,deposit_held,deposit_status,deposit_refund_amount");
    let pq = sb.from("payments").select("driver_id,rental_id,type,amount,balance_due,net_collected,refunded_amount,status,due_date");
    if (data.driverIds) { rq = rq.in("application_id", data.driverIds); pq = pq.in("driver_id", data.driverIds); }
    const [r, p] = await Promise.all([rq, pq]);
    if (r.error || p.error) throw new Error("Could not load payment records.");
    return computePayCells(r.data ?? [], p.data ?? []);
  });
