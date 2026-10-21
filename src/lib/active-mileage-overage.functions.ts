// Read-only mileage overage for the Active bookings list.
// The flag is checked before the role lookup and before any read.
// No insert, update, delete, or new table.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { ACTIVE_MILEAGE_OVERAGE_ENABLED } from "@/lib/active-mileage-overage-flag";
import {
  allowanceTextFromAgreement,
  estimateMileageOverage,
  type MileageOverage,
} from "@/lib/active-mileage-overage";

const LIMIT = 200;
const ID_BATCH = 80;

export type ActiveMileageOverageResult = {
  today: string;
  rows: MileageOverage[];
  truncated: boolean;
};

function idBatches(ids: string[]): string[][] {
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += ID_BATCH) batches.push(ids.slice(i, i + ID_BATCH));
  return batches;
}

type Page<T> = { data: T[] | null; error: { message: string } | null };

async function readBatches<T>(
  ids: string[],
  load: (batch: string[]) => PromiseLike<Page<T>>,
): Promise<{ rows: T[]; truncated: boolean }> {
  if (ids.length === 0) return { rows: [], truncated: false };
  const pages = await Promise.all(idBatches(ids).map((batch) => load(batch)));
  const rows: T[] = [];
  let truncated = false;
  for (const page of pages) {
    if (page.error) throw new Error(page.error.message);
    const data = page.data ?? [];
    if (data.length > LIMIT) truncated = true;
    rows.push(...data.slice(0, LIMIT));
  }
  return { rows, truncated };
}

/** Manager-only. Throws before the role check and before any read while the flag is off. */
export const listActiveMileageOverage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ rentalIds: z.array(z.string().uuid()).max(100) }).strict().parse(input ?? {}))
  .handler(async ({ data, context }): Promise<ActiveMileageOverageResult> => {
    if (!ACTIVE_MILEAGE_OVERAGE_ENABLED) throw new Error("Mileage Overage is off");
    const { requireManager } = await import("@/lib/roles.server");
    await requireManager(context.userId);
    const today = new Date().toISOString().slice(0, 10);
    if (data.rentalIds.length === 0) return { today, rows: [], truncated: false };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const rentalsQ = await supabaseAdmin
      .from("rentals")
      .select("id,vehicle_id,start_date,pickup_reading_id")
      .eq("status", "active")
      .in("id", data.rentalIds)
      .order("id", { ascending: true })
      .limit(LIMIT + 1);
    if (rentalsQ.error) throw new Error(rentalsQ.error.message);
    const rentalPage = rentalsQ.data ?? [];
    const rentalsTruncated = rentalPage.length > LIMIT;
    const rentals = rentalPage.slice(0, LIMIT);

    const pickupIds = [...new Set(rentals.map((row) => row.pickup_reading_id).filter((id): id is string => !!id))];
    const vehicleIds = [...new Set(rentals.map((row) => row.vehicle_id).filter((id): id is string => !!id))];
    const rentalIds = rentals.map((row) => row.id);

    const [readingsQ, vehiclesQ, agreementsQ] = await Promise.all([
      readBatches(pickupIds, (batch) =>
        supabaseAdmin.from("odometer_readings").select("id,mileage").in("id", batch).limit(LIMIT + 1),
      ),
      readBatches(vehicleIds, (batch) =>
        supabaseAdmin.from("vehicles").select("id,current_odometer").in("id", batch).limit(LIMIT + 1),
      ),
      readBatches(rentalIds, (batch) =>
        supabaseAdmin
          .from("agreements")
          .select("id,rental_id,status,signed_at,body")
          .in("rental_id", batch)
          .order("signed_at", { ascending: false, nullsFirst: false })
          .order("id", { ascending: false })
          .limit(LIMIT + 1),
      ),
    ]);

    const startById = new Map(readingsQ.rows.map((row) => [row.id, row.mileage]));
    const lastByVehicle = new Map(vehiclesQ.rows.map((row) => [row.id, row.current_odometer]));
    const agreementsByRental = new Map<string, typeof agreementsQ.rows>();
    for (const row of agreementsQ.rows) {
      if (!row.rental_id) continue;
      const list = agreementsByRental.get(row.rental_id) ?? [];
      list.push(row);
      agreementsByRental.set(row.rental_id, list);
    }

    return {
      today,
      rows: rentals.map((rental) => {
        const agreements = [...(agreementsByRental.get(rental.id) ?? [])].sort((a, b) => {
          const aOn = a.signed_at ?? "";
          const bOn = b.signed_at ?? "";
          if (aOn !== bOn) return aOn < bOn ? 1 : -1;
          return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
        });
        let allowanceText: string | null = null;
        for (const agreement of agreements) {
          if (agreement.status === "void" || agreement.status === "voided") continue;
          allowanceText = allowanceTextFromAgreement(agreement.body);
          if (allowanceText) break;
        }
        return estimateMileageOverage({
          rentalId: rental.id,
          startMiles: rental.pickup_reading_id ? startById.get(rental.pickup_reading_id) : null,
          lastMiles: lastByVehicle.get(rental.vehicle_id),
          allowanceText,
          startDate: rental.start_date,
          today,
        });
      }),
      truncated: rentalsTruncated || readingsQ.truncated || vehiclesQ.truncated || agreementsQ.truncated,
    };
  });
