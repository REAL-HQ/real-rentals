// Read-only rental closeout preview. Owners and managers only.
// The flag is checked before the role lookup and before any read.
// No insert, update, delete, deposit settlement, or Stripe call.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { CLOSEOUT_PREVIEW_ENABLED, showsCloseoutPreview } from "@/lib/closeout-preview-flag";
import type { CloseoutPreviewInput, RowLoad } from "@/lib/closeout-preview";

const PAGE = 1000;

async function rowsOf<T>(
  load: () => PromiseLike<{ data: T[] | null; error: { message: string } | null; count: number | null }>,
): Promise<RowLoad<T>> {
  try {
    const { data, error, count } = await load();
    if (error || !data || count == null) {
      console.error("[closeout-preview] read failed");
      return { ok: false };
    }
    return { ok: true, rows: data, truncated: count > data.length };
  } catch {
    console.error("[closeout-preview] read failed");
    return { ok: false };
  }
}

export const getRentalCloseoutPreview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ rentalId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    if (!CLOSEOUT_PREVIEW_ENABLED) throw new Error("Closeout Preview is off");
    const { buildCloseoutPreview, easternCalendarDate } = await import("@/lib/closeout-preview");
    const { requireManager } = await import("@/lib/roles.server");
    await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { rentalReadyItems } = await import("@/lib/vehicle-readiness");
    const sb = supabaseAdmin;

    const rentalRead = await sb
      .from("rentals")
      .select(
        "id,status,vehicle_id,end_date,autopay_active,stripe_subscription_id,deposit_amount,deposit_held,deposit_status,deposit_settled_at,deposit_refund_amount",
      )
      .eq("id", data.rentalId)
      .maybeSingle();
    if (rentalRead.error || !rentalRead.data) throw new Error("Closeout preview unavailable.");
    const rental = rentalRead.data;
    if (!showsCloseoutPreview(rental.status)) return { shown: false as const };

    const inspectionRead = await rowsOf(() =>
      sb
        .from("inspections")
        .select("id,status,completed_at,vehicle_id,exterior_notes,interior_notes", { count: "exact" })
        .eq("rental_id", data.rentalId)
        .eq("inspection_type", "return")
        .order("created_at", { ascending: false })
        .limit(1),
    );
    const inspection = inspectionRead.ok ? inspectionRead.rows[0] : undefined;
    const [items, rentalIncidents, payments, tolls, deductions, vehicleIncidents, vehicleRead] = await Promise.all([
      inspection
        ? rowsOf(() =>
            sb
              .from("inspection_items")
              .select("label,result,is_critical", { count: "exact" })
              .eq("inspection_id", inspection.id)
              .limit(PAGE),
          )
        : Promise.resolve({ ok: true as const, rows: [], truncated: false }),
      rowsOf(() =>
        sb
          .from("incidents")
          // Live incidents have no payment_id, and payments have no incident_id. Do not select a link that is not there.
          .select("id,status,actual_cost,estimated_cost,driver_responsible_amount,drivable", { count: "exact" })
          .eq("rental_id", data.rentalId)
          .limit(PAGE),
      ),
      rowsOf(() =>
        sb
          .from("payments")
          .select("status,amount,balance_due,type,due_date", { count: "exact" })
          .eq("rental_id", data.rentalId)
          .limit(PAGE),
      ),
      rowsOf(() =>
        sb
          .from("toll_charges")
          .select("status,amount,admin_fee,charge_type,payment_id", { count: "exact" })
          .eq("rental_id", data.rentalId)
          .limit(PAGE),
      ),
      rowsOf(() =>
        sb
          .from("deposit_deductions")
          .select("amount,incident_id", { count: "exact" })
          .eq("rental_id", data.rentalId)
          .limit(PAGE),
      ),
      rental.vehicle_id
        ? rowsOf(() =>
            sb
              .from("incidents")
              .select("id,status,rental_id", { count: "exact" })
              .eq("vehicle_id", rental.vehicle_id)
              .limit(PAGE),
          )
        : Promise.resolve({ ok: false as const }),
      rental.vehicle_id
        ? sb.from("vehicles").select("year,make,model,vin,weekly_rate,status").eq("id", rental.vehicle_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);

    let vehicle: CloseoutPreviewInput["vehicle"] = { ok: false };
    if (rental.vehicle_id && vehicleRead && "data" in vehicleRead && !vehicleRead.error && vehicleRead.data) {
      vehicle = {
        ok: true,
        status: vehicleRead.data.status ?? null,
        rentalReadyMissing: rentalReadyItems(vehicleRead.data)
          .filter((item) => !item.done)
          .map((item) => item.label),
      };
    }

    const input: CloseoutPreviewInput = {
      status: rental.status,
      today: easternCalendarDate(new Date()),
      endDate: rental.end_date,
      rentalVehicleId: rental.vehicle_id,
      inspection: inspectionRead.ok
        ? { ok: true, rows: inspectionRead.rows.slice(0, 1), truncated: false }
        : { ok: false },
      items,
      vehicle,
      vehicleIncidents,
      rentalIncidents,
      payments,
      tolls,
      deductions,
      billing: {
        autopay: rental.autopay_active,
        subscriptionLinked: !!rental.stripe_subscription_id,
      },
      deposit: {
        amount: rental.deposit_amount,
        held: rental.deposit_held,
        status: rental.deposit_status,
        settledAt: rental.deposit_settled_at,
        refundAmount: rental.deposit_refund_amount,
      },
    };
    return buildCloseoutPreview(input);
  });
