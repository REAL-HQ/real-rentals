// Loads the renter, lead and plate for an existing rental and builds charge
// metadata. Active rentals use the strict allowance: every field is required.
import { buildChargeMetadata, easternDay, type ChargeMetadataAllowance } from "@/lib/stripe-charge-metadata";

type Admin = any;

export async function chargeMetadataForRental(
  admin: Admin,
  rentalId: string,
  reason: string,
  forDate?: string | null,
  allowance: ChargeMetadataAllowance = { kind: "rental" },
): Promise<Record<string, string>> {
  const rentalRes = await admin.from("rentals").select("id, application_id, vehicle_id, start_date").eq("id", rentalId).maybeSingle();
  const rental = rentalRes?.data ?? null;
  const appRes = rental?.application_id
    ? await admin.from("applications").select("id, full_name").eq("id", rental.application_id).maybeSingle()
    : { data: null };
  const vehRes = rental?.vehicle_id
    ? await admin.from("vehicles").select("id, license_plate").eq("id", rental.vehicle_id).maybeSingle()
    : { data: null };
  const start = typeof rental?.start_date === "string" ? rental.start_date.slice(0, 10) : "";
  return buildChargeMetadata(
    {
      rentalId: rental?.id ?? rentalId,
      leadId: rental?.application_id ?? null,
      reason,
      forDate: forDate || start || easternDay(),
      renter: appRes?.data?.full_name ?? null,
      plate: vehRes?.data?.license_plate ?? null,
    },
    allowance,
  );
}

/** Reservation Fee / initial payment: rental id and plate when they already exist. */
export async function preRentalChargeContext(admin: Admin, leadId: string, vehicleId: string | null | undefined): Promise<{ rentalId: string | null; plate: string | null }> {
  let rentalId: string | null = null;
  try {
    const rentals = await admin.from("rentals").select("id, status, created_at").eq("application_id", leadId).limit(10);
    const rows = (rentals?.data ?? []) as Array<{ id?: string; status?: string }>;
    const open = rows.find((r) => ["active", "reserved", "pending", "upcoming"].includes(String(r.status ?? "")));
    rentalId = open?.id ?? null;
  } catch {
    rentalId = null;
  }
  let plate: string | null = null;
  if (vehicleId) {
    try {
      const veh = await admin.from("vehicles").select("license_plate").eq("id", vehicleId).maybeSingle();
      plate = veh?.data?.license_plate ?? null;
    } catch {
      plate = null;
    }
  }
  return { rentalId, plate };
}
