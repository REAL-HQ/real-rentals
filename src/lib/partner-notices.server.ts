/**
 * "Your car is rented" — to the partner who owns the vehicle (Dolmar, Nov 17
 * 2026: partners "just can see when their vehicle is rented and get notified
 * via email and text when it is").
 *
 * Catalogued as "Partner Rental Notice" in Back Office -> Automations, OFF
 * until an Owner turns it on. Once per rental (partner_notice_sends key
 * partner_rented:<rental>). Email always; a text only when the partner gave
 * SMS consent and it is 8 AM–9 PM ET (outside that window the email still
 * goes and the text is skipped, matching the Rental Ended notice). The
 * partner's own number comes from the partners row; no renter number is ever
 * read. The message never names the renter, the agreement or insurance.
 */
import {
  PARTNER_PORTAL_URL,
  PARTNER_RENTAL_NOTICE_KEY,
  partnerRentalNotice,
  vehicleLabel,
  withinPartnerTextingHours,
} from "@/lib/partner-portal";

type Admin = any;

export type PartnerNoticeDeps = {
  gate?: "send" | "off" | "held";
  sendEmail?: (a: { to: string; subject: string; html: string; track?: { workflow: string } }) => Promise<{ ok: boolean }>;
  sendSms?: (a: { to: string; body: string; kind: string; vehicleId?: string | null; rentalId?: string | null; requireConsent: boolean }) => Promise<{ ok: boolean }>;
  now?: Date;
};

export async function sendPartnerRentalNotice(admin: Admin, rentalId: string, deps: PartnerNoticeDeps = {}): Promise<{ status: string; email?: string; sms?: string }> {
  try {
    let gate = deps.gate;
    if (!gate) {
      const { gateFor, loadAutomationControls } = await import("@/lib/automation-controls.server");
      gate = gateFor(await loadAutomationControls(admin), PARTNER_RENTAL_NOTICE_KEY);
    }
    if (gate !== "send") return { status: gate };

    // Only rental id, vehicle and dates. The renter columns are never selected.
    const { data: rental } = await admin.from("rentals").select("id,vehicle_id,start_date,status").eq("id", rentalId).maybeSingle();
    if (!rental?.vehicle_id) return { status: "no_vehicle" };
    const { data: v } = await admin.from("vehicles").select("id,year,make,model,trim,partner_id").eq("id", rental.vehicle_id).maybeSingle();
    if (!v?.partner_id) return { status: "not_partner_vehicle" };
    const { data: p } = await admin.from("partners").select("id,name,email,phone,status,sms_consent_at,notify_rentals").eq("id", v.partner_id).maybeSingle();
    if (!p) return { status: "no_partner" };
    if (p.notify_rentals === false) return { status: "partner_opted_out" };

    const key = `partner_rented:${rentalId}`;
    const claim = await admin.from("partner_notice_sends").insert({ key, kind: "partner_rented", partner_id: p.id, rental_id: rentalId, vehicle_id: v.id, status: "claimed" });
    if (claim.error) {
      const { tableMissing } = await import("@/lib/fleet-api.server");
      return { status: tableMissing(claim.error, "partner_notice_sends") ? "no_table" : "duplicate" };
    }

    const notice = partnerRentalNotice({
      firstName: String(p.name ?? "").trim().split(/\s+/)[0] || "there",
      vehicleLabel: vehicleLabel(v),
      startDate: rental.start_date ?? null,
      portalUrl: PARTNER_PORTAL_URL,
    });

    let email = "skipped";
    if (p.email) {
      const send = deps.sendEmail ?? (await import("@/lib/email.server")).sendEmail;
      const r = await send({ to: p.email, subject: notice.subject, html: notice.html, track: { workflow: "partner_rental_notice" } });
      email = r?.ok ? "sent" : "failed";
    }

    let sms = "skipped";
    const now = deps.now ?? new Date();
    if (p.phone && p.sms_consent_at && withinPartnerTextingHours(now)) {
      const send = deps.sendSms ?? (await import("@/lib/sms.server")).sendSms;
      // Partners are not applicants, so consent is the partners.sms_consent_at
      // checked above; sendSms still enforces STOP opt-outs.
      const r = await send({ to: p.phone, body: notice.sms, kind: "partner_rental_notice", vehicleId: v.id, rentalId, requireConsent: false });
      sms = r?.ok ? "sent" : "failed";
    } else if (p.phone && p.sms_consent_at) {
      sms = "outside_hours";
    }

    await admin
      .from("partner_notice_sends")
      .update({ status: email === "sent" || sms === "sent" ? "sent" : "failed", channel: [email === "sent" ? "email" : null, sms === "sent" ? "sms" : null].filter(Boolean).join("+") || null, detail: `email:${email} sms:${sms}` })
      .eq("key", key);
    return { status: "sent", email, sms };
  } catch (e) {
    console.error("[partner-rental-notice] failed", e);
    return { status: "failed" };
  }
}
