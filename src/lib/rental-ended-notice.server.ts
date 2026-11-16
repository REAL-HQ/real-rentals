/**
 * Rental Ended notice (SOP D14 / M32, decided Nov 16 2026: "turn on Rental
 * Ended"). Built as its own switch, "Rental Ended Notice" in Back Office ->
 * Automations, OFF until an Owner turns it on. The incident and issue-status
 * notices stay off (DRIVER_NOTIFICATIONS_ENABLED).
 *
 * Once per rental (renter_reminder_sends key rental_ended:<rental>). Same
 * wording as the built notice (driver-notifications.ts rentalEndedNotice):
 * email, plus a text from the main line when the renter has SMS consent.
 */
import { rentalEndedNotice } from "@/lib/driver-notifications";
import { tableMissing } from "@/lib/fleet-api.server";

type Admin = any;
export const RENTAL_ENDED_NOTICE_KEY = "rental_ended_notice";

export type RentalEndedDeps = {
  gate?: "send" | "off" | "held";
  deliver?: (notice: any) => Promise<any>;
};

export async function sendRentalEndedNotice(admin: Admin, rentalId: string, deps: RentalEndedDeps = {}): Promise<{ status: string }> {
  try {
    let gate = deps.gate;
    if (!gate) {
      const { gateFor, loadAutomationControls } = await import("@/lib/automation-controls.server");
      gate = gateFor(await loadAutomationControls(admin), RENTAL_ENDED_NOTICE_KEY);
    }
    if (gate !== "send") return { status: gate };
    const { data: rental } = await admin.from("rentals").select("id,status,application_id,driver_id,vehicle_id").eq("id", rentalId).maybeSingle();
    if (!rental?.application_id) return { status: "no_renter" };
    const { data: app } = await admin.from("applications").select("id,full_name,email,phone,user_id").eq("id", rental.application_id).maybeSingle();
    if (!app) return { status: "no_renter" };
    const claim = await admin.from("renter_reminder_sends").insert({ key: `rental_ended:${rentalId}`, kind: "rental_ended", application_id: app.id, rental_id: rentalId, status: "claimed" });
    if (claim.error) return { status: tableMissing(claim.error, "renter_reminder_sends") ? "no_table" : "duplicate" };
    const { data: v } = rental.vehicle_id ? await admin.from("vehicles").select("year,make,model").eq("id", rental.vehicle_id).maybeSingle() : { data: null };
    const vehicleLabel = [v?.year, v?.make, v?.model].filter(Boolean).join(" ") || "your vehicle";
    const notice = rentalEndedNotice({
      firstName: String(app.full_name ?? "").trim().split(/\s+/)[0] || "there",
      email: app.email ?? null, phone: app.phone ?? null, applicationId: app.id,
      driverId: app.user_id ?? rental.driver_id ?? null, rentalId,
      vehicleLabel,
    });
    const deliver = deps.deliver ?? (async (n: any) => (await import("@/lib/driver-notifications.server")).deliverDriverNoticeChannels(n));
    const r = await deliver(notice);
    await admin.from("renter_reminder_sends").update({ status: "sent", channel: [r?.email === "sent" ? "email" : null, r?.sms === "sent" ? "sms" : null].filter(Boolean).join("+") || null }).eq("key", `rental_ended:${rentalId}`);
    return { status: "sent" };
  } catch (e) {
    console.error("[rental-ended] notice failed", e);
    return { status: "failed" };
  }
}
