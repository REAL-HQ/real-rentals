// Stamp rental_id on records that were created before their rental existed.
// Called when a reservation/rental is created and when an agreement is
// prepared for someone who already has a live rental. Never throws: linking is
// housekeeping and must not fail a booking, a payment or a send. Only touches
// rows whose rental_id is still null, so it can never move a linked record.
import { liveSiblings, type SiblingRental } from "@/lib/booking-links";

type Admin = any;

export async function linkOrphansToRental(admin: Admin, rentalId: string): Promise<{ agreements: number; payments: number }> {
  const out = { agreements: 0, payments: 0 };
  try {
    const { data: r } = await admin
      .from("rentals")
      .select("id,application_id,vehicle_id,status,reservation_deposit_payment_id")
      .eq("id", rentalId)
      .maybeSingle();
    if (!r?.application_id) return out;
    const { data: sib } = await admin
      .from("rentals")
      .select("id,vehicle_id,status")
      .eq("application_id", r.application_id)
      .neq("id", rentalId);
    const others = liveSiblings(
      ((sib ?? []) as any[]).map((s) => ({ id: s.id, vehicleId: s.vehicle_id ?? null, status: s.status ?? null }) as SiblingRental),
      rentalId,
    );

    // Agreements: unlinked, not voided, same person. With other live rentals,
    // only the one naming this rental's car.
    let q = admin
      .from("agreements")
      .update({ rental_id: rentalId })
      .eq("application_id", r.application_id)
      .is("rental_id", null)
      .is("voided_at", null);
    if (others.length) {
      if (!r.vehicle_id) return out;
      q = q.eq("vehicle_id", r.vehicle_id);
    }
    const a = await q.select("id");
    out.agreements = ((a?.data ?? []) as any[]).length;

    // The Reservation Fee payment the rental points at.
    if (r.reservation_deposit_payment_id) {
      const p = await admin
        .from("payments")
        .update({ rental_id: rentalId })
        .eq("id", r.reservation_deposit_payment_id)
        .is("rental_id", null)
        .select("id");
      out.payments = ((p?.data ?? []) as any[]).length;
    }
  } catch (e) {
    console.error("[booking-links] could not link records to the rental", String((e as Error)?.message ?? e));
  }
  return out;
}

/** After an agreement is prepared: attach it to the person's live rental, if they have exactly one. */
export async function linkAgreementToLiveRental(admin: Admin, agreementId: string): Promise<void> {
  try {
    const { data: ag } = await admin.from("agreements").select("id,application_id,vehicle_id,rental_id").eq("id", agreementId).maybeSingle();
    if (!ag || ag.rental_id || !ag.application_id) return;
    const { data: rs } = await admin
      .from("rentals")
      .select("id,vehicle_id,status")
      .eq("application_id", ag.application_id)
      .in("status", ["reserved", "active"]);
    const rows = (rs ?? []) as Array<{ id: string; vehicle_id: string | null }>;
    const pick = rows.length === 1 ? rows[0] : rows.find((x) => ag.vehicle_id && x.vehicle_id === ag.vehicle_id);
    if (!pick) return;
    await admin.from("agreements").update({ rental_id: pick.id }).eq("id", agreementId).is("rental_id", null);
  } catch (e) {
    console.error("[booking-links] could not link agreement", String((e as Error)?.message ?? e));
  }
}
