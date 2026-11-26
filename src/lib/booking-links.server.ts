// Stamp rental_id on records that were created before their rental existed.
// Called when a reservation/rental is created and when an agreement is
// prepared for someone who already has a live rental. Never throws: linking is
// housekeeping and must not fail a booking, a payment or a send. Only touches
// rows whose rental_id is still null, so it can never move a linked record.
//
// A pending, reserved, or on-hold rental must not consume the signed agreement.
// Activation (isUsableSignedAgreement and activate_rental_checked_tx) only
// counts a signed agreement whose rental_id is still null. Linking it at the
// $50 fee or at Book Pickup turns the Agreement step amber and pickup fails
// with no_signed_agreement. The fee payment is still linked.
import { liveSiblings, type SiblingRental } from "@/lib/booking-links";

type Admin = any;

/** Rentals that are not yet a live rental. Their agreement stays unlinked. */
const PRE_ACTIVATION = new Set(["pending_reservation", "reserved", "on_hold"]);

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
    // Several live rentals and no car on this one: do not guess. Same exit as
    // before, so the fee payment is left alone in that case too.
    if (others.length && !r.vehicle_id) return out;

    if (!PRE_ACTIVATION.has(String(r.status ?? "").toLowerCase())) {
      // Agreements: unlinked, not voided, same person. With other live rentals,
      // only the one naming this rental's car.
      let q = admin
        .from("agreements")
        .update({ rental_id: rentalId })
        .eq("application_id", r.application_id)
        .is("rental_id", null)
        .is("voided_at", null);
      if (others.length) q = q.eq("vehicle_id", r.vehicle_id);
      const a = await q.select("id");
      out.agreements = ((a?.data ?? []) as any[]).length;
    }

    // The Reservation Fee payment the rental points at. Linked even when the
    // agreement stays free for activation.
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

/** After an agreement is prepared: attach it only to an active rental. A pending, reserved, or on-hold rental leaves it unlinked so pickup can still count it. */
export async function linkAgreementToLiveRental(admin: Admin, agreementId: string): Promise<void> {
  try {
    const { data: ag } = await admin.from("agreements").select("id,application_id,vehicle_id,rental_id").eq("id", agreementId).maybeSingle();
    if (!ag || ag.rental_id || !ag.application_id) return;
    const { data: rs } = await admin
      .from("rentals")
      .select("id,vehicle_id,status")
      .eq("application_id", ag.application_id)
      .eq("status", "active");
    const rows = ((rs ?? []) as Array<{ id: string; vehicle_id: string | null; status?: string | null }>).filter(
      (x) => x.status === "active",
    );
    const pick = rows.length === 1 ? rows[0] : rows.find((x) => ag.vehicle_id && x.vehicle_id === ag.vehicle_id);
    if (!pick) return;
    await admin.from("agreements").update({ rental_id: pick.id }).eq("id", agreementId).is("rental_id", null);
  } catch (e) {
    console.error("[booking-links] could not link agreement", String((e as Error)?.message ?? e));
  }
}
