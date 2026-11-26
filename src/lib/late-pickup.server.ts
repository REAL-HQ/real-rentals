/**
 * Late pickup (Dolmar, t299s1618; SOP D25; 30 minutes per t309u): a renter 30+ minutes late to
 * pickup loses the reservation and the $50 Reservation Fee is kept.
 *
 * Run every 5 minutes by /api/public/cron/renter-reminders. Switch
 * "late_pickup_release" in Back Office -> Automations, OFF until an Owner
 * turns it on. For each Reserved rental whose pickup time (Eastern) was 30
 * minutes to 6 hours ago and has no pickup checklist on file:
 *
 *   1. claim it once (renter_reminder_sends key late_release:<rental>);
 *   2. release it: rental Reserved -> cancelled, the car back to Available if
 *      nothing else holds it, and the applicant's car assignment cleared so it
 *      can go to the next person;
 *   3. keep the fee: a paid Reservation Fee stays paid and is marked kept (it
 *      is never credited to a later week). When forfeited-fee credit mode is
 *      auto, that kept fee is also saved as a staff-only renter credit. Case
 *      by case and off leave the credit for staff. The renter text does not
 *      mention a credit;
 *   4. tell staff: one team alert (email team@drivereal.com + text to the field
 *      rep, src/lib/team-alerts.server.ts);
 *   5. tell the renter: one text from the main line (email if they cannot get
 *      texts), only 8 AM to 9 PM ET. Wording needs Dolmar's OK.
 *
 * Also, with the Reservation Fee switch on: a reservation still showing the
 * fee as pending is marked held once the fee is paid (e.g. the payment
 * settled through the webhook after signing).
 */
import { readReservationDetails } from "@/lib/reservations";
import { slotIso, PICKUP_TIMEZONE } from "@/lib/pickup-schedule";
import { tableMissing } from "@/lib/fleet-api.server";
import { textingHours, timeLabel } from "@/lib/renter-reminders.server";

type Admin = any;
export const LATE_PICKUP_KEY = "late_pickup_release";
/** Minutes after the pickup time before the car is released (Dolmar t309u: 30, "more fair for the renter"; was 15). */
export const LATE_MINUTES = 30;
const MAX_LATE_HOURS = 6;
const PHONE = "(888) 833-8280";

export type LatePickupDeps = {
  now?: () => Date;
  gate?: "send" | "off" | "held";
  sendSms?: (a: any) => Promise<any>;
  sendEmail?: (a: any) => Promise<any>;
  teamAlert?: (admin: Admin, alert: any) => Promise<any>;
  audit?: (e: any) => Promise<void>;
  feeEnabled?: boolean;
  dryRun?: boolean;
  /** Skips the settings read. Absent reads app_settings (default: case by case). */
  creditPolicy?: { mode: "auto" | "case_by_case" | "off"; days: number };
};

export function latePickupSms(f: { time: string; feeKept: number | null }): string {
  const fee = f.feeKept ? ` Your $${Number.isInteger(f.feeKept) ? f.feeKept : f.feeKept.toFixed(2)} Reservation Fee is non-refundable for a missed pickup.` : "";
  return `Real Rentals: We held your car until ${LATE_MINUTES} minutes after your ${timeLabel(f.time)} ET pickup, and it has now been released.${fee} To rebook, reply here or call ${PHONE}. Reply STOP to opt out.`;
}

export function latePickupEmail(f: { firstName: string; time: string; feeKept: number | null }): { subject: string; html: string } {
  const p = (t: string) => `<p style="color:#444;font-size:15px;line-height:1.55">${t}</p>`;
  const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return {
    subject: "Your REAL RENTALS Pickup Was Released",
    html: `<div style="font-family:Arial,Helvetica,sans-serif;padding:24px;max-width:560px"><h1 style="font-size:20px;color:#111">Your pickup was released</h1>${p(`Hi ${esc(f.firstName)}, we held your car until ${LATE_MINUTES} minutes after your ${esc(timeLabel(f.time))} ET pickup, and it has now been released.`)}${f.feeKept ? p(`Your $${f.feeKept.toFixed(2)} Reservation Fee is non-refundable for a missed pickup.`) : ""}${p(`To rebook, reply to this email or call ${PHONE}.`)}</div>`,
  };
}

/** Minutes late now (negative = before the pickup time). */
export function minutesLate(startDate: string, time: string, now: Date): number {
  return (now.getTime() - new Date(slotIso(startDate, time, PICKUP_TIMEZONE)).getTime()) / 60_000;
}

export type LateOutcome = { rental_id: string; status: string; detail?: string };

export async function runLatePickups(admin: Admin, deps: LatePickupDeps = {}): Promise<{ ok: boolean; reason?: string; outcomes: LateOutcome[] }> {
  const now = deps.now ? deps.now() : new Date();
  const outcomes: LateOutcome[] = [];

  let feeOn = deps.feeEnabled;
  if (feeOn === undefined) {
    const { loadReservationFeeSettings } = await import("@/lib/reservation-fee.server");
    feeOn = (await loadReservationFeeSettings(admin)).enabled;
  }

  let gate = deps.gate;
  if (!gate) {
    const { gateFor, loadAutomationControls } = await import("@/lib/automation-controls.server");
    gate = gateFor(await loadAutomationControls(admin), LATE_PICKUP_KEY);
  }

  // Never release without being able to tell staff: the team alert claim table must exist.
  if (gate === "send" && !deps.teamAlert) {
    const t = await admin.from("team_alert_sends").select("key").limit(1);
    if (t?.error && tableMissing(t.error, "team_alert_sends")) gate = "held";
  }

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: PICKUP_TIMEZONE }).format(now);
  const { data: rentals, error } = await admin
    .from("rentals")
    .select("id,status,application_id,vehicle_id,start_date,reservation_note,reservation_deposit_status,reservation_deposit_required")
    .eq("status", "reserved")
    .eq("start_date", today)
    .limit(100);
  if (error) return { ok: false, reason: "Could not read reservations.", outcomes };

  for (const r of (rentals ?? []) as any[]) {
    // Fee paid after the reservation was made: mark the car held.
    if (feeOn && r.application_id && r.reservation_deposit_required === true && r.reservation_deposit_status === "pending" && !deps.dryRun) {
      const { paidReservationFee, holdReservationForFee } = await import("@/lib/reservation-fee.server");
      const fee = await paidReservationFee(admin, r.application_id);
      if (fee) { await holdReservationForFee(admin, r.application_id, fee); r.reservation_deposit_status = "applied"; outcomes.push({ rental_id: r.id, status: "fee_hold" }); }
    }

    if (gate !== "send") continue; // off, or held (settings unreadable / team alert table missing)
    const d = readReservationDetails(r.reservation_note);
    if (!d.pickupTime) continue;
    const late = minutesLate(r.start_date, d.pickupTime, now);
    if (late < LATE_MINUTES || late > MAX_LATE_HOURS * 60) continue;
    const ho = await admin.from("pickup_handovers").select("rental_id").eq("rental_id", r.id).maybeSingle();
    if (ho?.error && !tableMissing(ho.error, "pickup_handovers")) { outcomes.push({ rental_id: r.id, status: "skipped", detail: "could not read the pickup checklist" }); continue; }
    if (ho?.data) continue; // the rep is handing it over

    if (deps.dryRun) { outcomes.push({ rental_id: r.id, status: "would_release", detail: `${Math.floor(late)} minutes late` }); continue; }
    const key = `late_release:${r.id}`;
    const c = await admin.from("renter_reminder_sends").insert({ key, kind: "late_pickup_release", application_id: r.application_id ?? null, rental_id: r.id, status: "claimed" });
    if (c.error) {
      if (tableMissing(c.error, "renter_reminder_sends")) return { ok: false, reason: "renter_reminder_sends table missing; nothing released", outcomes };
      continue; // already claimed
    }

    // 2. Release.
    const rel = await admin.from("rentals").update({ status: "cancelled" }).eq("id", r.id).eq("status", "reserved").select("id");
    if (!(rel?.data ?? []).length) { await admin.from("renter_reminder_sends").update({ status: "skipped", detail: "no longer reserved" }).eq("key", key); continue; }
    if (r.vehicle_id) {
      const still = await admin.from("rentals").select("id").eq("vehicle_id", r.vehicle_id).in("status", ["reserved", "on_hold", "pending_reservation", "active"]).limit(1);
      if (!(still?.data ?? []).length) await admin.from("vehicles").update({ status: "available" }).eq("id", r.vehicle_id).eq("status", "reserved");
      if (r.application_id) await admin.from("applications").update({ vehicle_id: null }).eq("id", r.application_id).eq("vehicle_id", r.vehicle_id).eq("status", "approved");
    }

    // 3. Keep the fee.
    let feeKept: number | null = null;
    if (r.application_id) {
      const { paidReservationFee } = await import("@/lib/reservation-fee.server");
      const fee = await paidReservationFee(admin, r.application_id);
      if (fee) {
        feeKept = fee.amount;
        await admin.from("payments").update({ notes: `${fee.notes} kept:late_pickup:${r.id}` }).eq("id", fee.id);
        let policy = deps.creditPolicy;
        if (!policy) {
          try {
            const { loadForfeitedFeeCreditSettings } = await import("@/lib/forfeited-fee-credit.server");
            policy = await loadForfeitedFeeCreditSettings(admin);
          } catch {
            policy = { mode: "case_by_case", days: 90 };
          }
        }
        // Auto saves the credit after the kept mark. The renter text above does not mention it.
        if (policy.mode === "auto") {
          const { convertFeeToCredit } = await import("@/lib/rental-hold.server");
          await convertFeeToCredit(admin, { paymentId: fee.id, reason: "Late Pickup Reservation Fee Kept As Credit" }, { creditDays: policy.days, now: () => now });
        }
      }
    }
    const audit = deps.audit ?? (async (e: any) => (await import("@/lib/audit.server")).logAudit(null, e));
    await audit({ action: "reservation.released_late_pickup", summary: `Reservation released ${Math.floor(late)} minutes after the ${timeLabel(d.pickupTime)} ET pickup${feeKept ? `; $${feeKept} Reservation Fee kept` : ""}`, entityType: "rental", entityId: r.id, metadata: { automatic: true, minutes_late: Math.floor(late), vehicle_id: r.vehicle_id, application_id: r.application_id, fee_kept: feeKept } }).catch(() => {});

    // 4. Staff.
    const { data: app } = r.application_id ? await admin.from("applications").select("id,full_name,phone,email").eq("id", r.application_id).maybeSingle() : { data: null };
    const site = String(process.env.SITE_URL || "https://drivereal.com").replace(/\/$/, "");
    const teamAlert = deps.teamAlert ?? (async (a: Admin, alert: any) => {
      const { sendTeamAlert, loadTeamAlertSettings } = await import("@/lib/team-alerts.server");
      // This switch governs the staff notice: releasing without telling staff is not an option.
      return sendTeamAlert(a, alert, { settings: { ...(await loadTeamAlertSettings(a)), late_pickup: true } });
    });
    await teamAlert(admin, {
      kind: "late_pickup", dedupeKey: r.id,
      title: `PICKUP RELEASED: ${String(app?.full_name ?? "").trim() || "Renter"} - Rebook If Needed`,
      lines: [`${LATE_MINUTES}+ minutes late for the ${timeLabel(d.pickupTime)} ET pickup.`, `The reservation was released and the car is back to Available.${feeKept ? ` The $${feeKept} Reservation Fee was kept.` : ""}`, "To rebook, reserve again from Bookings (a new Reservation Fee applies)."],
      link: `${site}/admin?tab=bookings`, rentalId: r.id, vehicleId: r.vehicle_id ?? null,
    });

    // 5. Renter.
    let renter = "skipped";
    if (app && textingHours(now)) {
      const sendSms = deps.sendSms ?? (async (a: any) => (await import("@/lib/sms.server")).sendSms(a));
      const sendEmail = deps.sendEmail ?? (async (a: any) => (await import("@/lib/email.server")).sendEmail(a));
      const { sendRenterSms, sendRenterEmail } = await import("@/lib/driver-contacts.server");
      const sms = latePickupSms({ time: d.pickupTime, feeKept });
      const fan = await sendRenterSms({ admin, applicationId: app.id, body: sms, kind: "late_pickup_release", rentalId: r.id, sendSms, app });
      if (fan.sent > 0) renter = "sms";
      else if (fan.skipped && app.email) {
        const first = String(app.full_name ?? "").trim().split(/\s+/)[0] || "there";
        const mail = latePickupEmail({ firstName: first, time: d.pickupTime, feeKept });
        const e = await sendRenterEmail({
          admin, applicationId: app.id, subject: mail.subject, html: mail.html,
          track: { workflow: "late_pickup_release" }, idempotencyKey: `late-release:${r.id}`,
          sendEmail, app,
        });
        renter = e.sent > 0 ? "email" : "failed";
      } else renter = "failed";
    }
    await admin.from("renter_reminder_sends").update({ status: "released", channel: renter, detail: feeKept ? `fee kept $${feeKept}` : null }).eq("key", key);
    outcomes.push({ rental_id: r.id, status: "released", detail: renter });
  }
  return { ok: true, outcomes };
}
