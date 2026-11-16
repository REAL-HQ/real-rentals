/**
 * "Reservation fully confirmed": the FLEET reservation_confirmed event and the
 * staff text + email. See confirmationGaps in pickup-schedule.ts for the rule.
 *
 * Called (best effort, never throws) after a reservation is created, after a
 * reservation deposit is recorded, after the renter signs the agreement, and
 * by the fleet-webhooks cron as a safety net for any other path.
 *
 * Idempotent per rental:
 *  - the webhook row uses dedupe_key reservation_confirmed:<rental id>;
 *  - the staff notice is claimed by inserting reservation_confirmations
 *    (rental_id primary key). No table, no notice.
 * Staff notices are sent only when Settings -> Pickup Schedule -> Notify is On
 * (Off by default). A confirmation reached while it is Off is recorded as
 * "off" and is not sent later.
 */
import {
  confirmationGaps,
  PICKUP_SCHEDULE_SETTINGS_KEY,
  readPickupSchedule,
  slotIso,
  slotLabel,
  type PickupScheduleSettings,
} from "@/lib/pickup-schedule";
import { readReservationDetails } from "@/lib/reservations";
import { tableMissing } from "@/lib/fleet-api.server";

type Admin = any;
const SITE = () => String(process.env.SITE_URL || "https://drivereal.com").replace(/\/$/, "");

export type ConfirmDeps = {
  sendSms?: (a: { to: string; body: string; kind: string; requireConsent: false; rentalId: string }) => Promise<{ ok?: boolean; status?: string } | unknown>;
  sendEmail?: (a: { to: string[]; subject: string; html: string; track: { workflow: string }; idempotencyKey: string }) => Promise<{ ok: boolean } | unknown>;
  enqueue?: (admin: Admin, row: any) => Promise<string | null>;
  dispatch?: (admin: Admin, ids: string[]) => Promise<unknown>;
  settings?: PickupScheduleSettings;
  now?: () => Date;
};

export async function loadPickupSchedule(admin: Admin): Promise<PickupScheduleSettings> {
  const { data } = await admin.from("app_settings").select("value").eq("key", PICKUP_SCHEDULE_SETTINGS_KEY).maybeSingle();
  return readPickupSchedule(data?.value);
}

function esc(v: unknown): string {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export type ConfirmationResult =
  | { confirmed: false; rentalId: string | null; gaps: string[] }
  | { confirmed: true; rentalId: string; webhookId: string | null; notice: "sent" | "off" | "already" | "no_table" | "failed"; payload: Record<string, unknown> };

/** Load everything the rule needs for one reserved rental. */
async function loadFacts(admin: Admin, rentalId: string) {
  const { data: r } = await admin
    .from("rentals")
    .select("id,status,application_id,vehicle_id,start_date,reservation_note,reservation_deposit_required,reservation_deposit_amount,reservation_deposit_status")
    .eq("id", rentalId)
    .maybeSingle();
  if (!r) return null;
  const appId: string | null = r.application_id ?? null;
  const [appRes, vehRes, agRes] = await Promise.all([
    appId ? admin.from("applications").select("id,full_name,status").eq("id", appId).maybeSingle() : Promise.resolve({ data: null }),
    r.vehicle_id ? admin.from("vehicles").select("id,year,make,model,license_plate,unit_number").eq("id", r.vehicle_id).maybeSingle() : Promise.resolve({ data: null }),
    appId
      ? admin.from("agreements").select("id,status,signed_at,voided_at,rental_id").eq("application_id", appId).eq("status", "signed")
      : Promise.resolve({ data: [] }),
  ]);
  const signed = ((agRes?.data ?? []) as any[]).filter((a) => !a.voided_at && a.signed_at && (!a.rental_id || a.rental_id === r.id));
  signed.sort((a, b) => String(b.signed_at).localeCompare(String(a.signed_at)));
  return { rental: r, app: appRes?.data ?? null, vehicle: vehRes?.data ?? null, agreement: signed[0] ?? null };
}

export function buildReservationConfirmedPayload(f: NonNullable<Awaited<ReturnType<typeof loadFacts>>>, s: PickupScheduleSettings, site = SITE()) {
  const d = readReservationDetails(f.rental.reservation_note);
  const v = f.vehicle;
  const label = v ? [v.year, v.make, v.model].filter(Boolean).join(" ") || null : null;
  const appId = f.rental.application_id ?? null;
  return {
    event: "reservation_confirmed",
    lead_id: appId,
    rental_id: f.rental.id,
    renter_name: f.app?.full_name ?? null,
    vehicle: { id: f.rental.vehicle_id ?? null, label, plate: v?.license_plate ?? null, unit_number: v?.unit_number ?? null },
    pickup: {
      date: f.rental.start_date,
      time: d.pickupTime,
      start_at: d.pickupTime ? slotIso(f.rental.start_date, d.pickupTime, s.timezone) : null,
      timezone: s.timezone,
      label: d.pickupTime ? slotLabel(f.rental.start_date, d.pickupTime) : null,
      location: d.pickupLocation,
    },
    field_rep: { name: s.fieldRep.name },
    deposit: {
      required: f.rental.reservation_deposit_required === true,
      amount: Number(f.rental.reservation_deposit_amount ?? 0),
      status: f.rental.reservation_deposit_status ?? "not_required",
    },
    agreement: f.agreement ? { id: f.agreement.id, signed_at: f.agreement.signed_at } : null,
    admin_url: appId ? `${site}/admin?tab=drivers&id=${encodeURIComponent(appId)}` : `${site}/admin`,
  } as Record<string, any>;
}

export function staffSmsBody(p: Record<string, any>): string {
  const parts = [`REAL RENTALS pickup confirmed: ${p.renter_name ?? "Renter"}`, p.vehicle?.label ?? "vehicle TBD", p.pickup?.label ?? p.pickup?.date];
  return `${parts.join(", ")}. ${p.admin_url}`.slice(0, 300);
}

export function staffEmail(p: Record<string, any>): { subject: string; html: string } {
  const row = (k: string, v: unknown) => `<tr><td style="padding:4px 12px 4px 0;color:#555">${esc(k)}</td><td style="padding:4px 0"><strong>${esc(v)}</strong></td></tr>`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;padding:24px;max-width:560px;color:#111">
    <h1 style="font-size:18px">Reservation confirmed</h1>
    <table style="font-size:14px;border-collapse:collapse">
      ${row("Renter", p.renter_name ?? "")}
      ${row("Vehicle", [p.vehicle?.label, p.vehicle?.plate ? `plate ${p.vehicle.plate}` : null].filter(Boolean).join(" · ") || "")}
      ${row("Pickup", p.pickup?.label ?? p.pickup?.date ?? "")}
      ${row("Location", p.pickup?.location ?? "")}
      ${row("Field rep", p.field_rep?.name ?? "")}
    </table>
    <p style="margin-top:16px"><a href="${esc(p.admin_url)}" style="display:inline-block;background:#D03020;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600">Open In Admin</a></p>
  </div>`;
  return { subject: `Pickup Confirmed: ${p.renter_name ?? "Renter"}, ${p.pickup?.label ?? p.pickup?.date ?? ""}`.slice(0, 180), html };
}

/** Find the reserved rental for an application (or use the given rental). */
async function resolveRentalId(admin: Admin, ref: { rentalId?: string | null; applicationId?: string | null }): Promise<string | null> {
  if (ref.rentalId) return ref.rentalId;
  if (!ref.applicationId) return null;
  const { data } = await admin.from("rentals").select("id").eq("application_id", ref.applicationId).eq("status", "reserved").limit(1);
  return Array.isArray(data) && data[0] ? String(data[0].id) : null;
}

export async function maybeConfirmReservation(admin: Admin, ref: { rentalId?: string | null; applicationId?: string | null }, deps: ConfirmDeps = {}): Promise<ConfirmationResult> {
  try {
    const rentalId = await resolveRentalId(admin, ref);
    if (!rentalId) return { confirmed: false, rentalId: null, gaps: ["not_reserved"] };
    const s = deps.settings ?? (await loadPickupSchedule(admin));
    const f = await loadFacts(admin, rentalId);
    if (!f) return { confirmed: false, rentalId, gaps: ["not_reserved"] };
    const d = readReservationDetails(f.rental.reservation_note);
    const gaps = confirmationGaps({
      rentalStatus: f.rental.status,
      applicationStatus: f.app?.status ?? null,
      pickupDate: f.rental.start_date ?? null,
      pickupTime: d.pickupTime,
      pickupLocation: d.pickupLocation,
      depositStatus: f.rental.reservation_deposit_required === true ? f.rental.reservation_deposit_status : "not_required",
      signedAgreement: !!f.agreement,
      requireSignedAgreement: s.notify.requireSignedAgreement,
    });
    if (gaps.length) return { confirmed: false, rentalId, gaps };

    const payload = buildReservationConfirmedPayload(f, s);
    const fw = await import("@/lib/fleet-webhook.server");
    const enqueue = deps.enqueue ?? fw.enqueueFleetEvent;
    const webhookId = await enqueue(admin, {
      event_type: "reservation_confirmed",
      dedupe_key: `reservation_confirmed:${rentalId}`,
      application_id: f.rental.application_id ?? null,
      payload,
    });
    if (webhookId) {
      try {
        await (deps.dispatch ? deps.dispatch(admin, [webhookId]) : fw.dispatchFleetWebhooks(admin, { ids: [webhookId] }, { timeoutMs: 5000 }));
      } catch (e) {
        console.error("[reservation-confirmed] dispatch failed (cron retries)", String((e as Error)?.message ?? e));
      }
    }

    const notice = await notifyStaff(admin, rentalId, payload, s, deps);
    return { confirmed: true, rentalId, webhookId, notice, payload };
  } catch (e) {
    console.error("[reservation-confirmed] failed", String((e as Error)?.message ?? e));
    return { confirmed: false, rentalId: ref.rentalId ?? null, gaps: ["error"] };
  }
}

async function notifyStaff(admin: Admin, rentalId: string, payload: Record<string, any>, s: PickupScheduleSettings, deps: ConfirmDeps): Promise<"sent" | "off" | "already" | "no_table" | "failed"> {
  const now = (deps.now ?? (() => new Date()))().toISOString();
  const on = s.notify.enabled === true && (s.notify.sms.length > 0 || s.notify.emails.length > 0);
  const claim = await admin
    .from("reservation_confirmations")
    .insert({ rental_id: rentalId, application_id: payload.lead_id ?? null, confirmed_at: now, notice_status: on ? "sending" : "off", payload })
    .select("rental_id");
  if (claim.error) {
    if (claim.error.code === "23505") return "already";
    if (tableMissing(claim.error, "reservation_confirmations")) return "no_table";
    console.error("[reservation-confirmed] claim failed", claim.error.message);
    return "failed";
  }
  if (!on) return "off";

  const smsResults: string[] = [];
  if (s.notify.sms.length) {
    const send = deps.sendSms ?? (async (a: any) => (await import("@/lib/sms.server")).sendSms(a));
    const body = staffSmsBody(payload);
    for (const to of s.notify.sms) {
      try {
        const r: any = await send({ to, body, kind: "reservation_confirmed_staff", requireConsent: false, rentalId });
        smsResults.push(r?.ok === false ? "failed" : "sent");
      } catch {
        smsResults.push("failed");
      }
    }
  }
  let emailResult = "none";
  if (s.notify.emails.length) {
    const send = deps.sendEmail ?? (async (a: any) => (await import("@/lib/email.server")).sendEmail(a));
    const { subject, html } = staffEmail(payload);
    try {
      const r: any = await send({ to: s.notify.emails, subject, html, track: { workflow: "reservation_confirmed_staff" }, idempotencyKey: `reservation-confirmed-${rentalId}` });
      emailResult = r?.ok === false ? "failed" : "sent";
    } catch {
      emailResult = "failed";
    }
  }
  const failed = smsResults.includes("failed") || emailResult === "failed";
  await admin
    .from("reservation_confirmations")
    .update({ notice_status: failed ? "partial" : "sent", sms_status: smsResults.join(",") || null, email_status: emailResult, notified_at: now })
    .eq("rental_id", rentalId);
  try {
    const { logAudit } = await import("@/lib/audit.server");
    await logAudit(null, {
      action: "reservation.confirmed_notice",
      summary: `Reservation confirmed notice ${failed ? "partly failed" : "sent"} (automated)`,
      entityType: "rental",
      entityId: rentalId,
      metadata: { sms: smsResults.length, email: emailResult },
    });
  } catch {
    /* audit is best effort */
  }
  return failed ? "failed" : "sent";
}

/** Cron safety net: reserved rentals that may have become confirmed by any path. */
export async function sweepReservationConfirmations(admin: Admin, deps: ConfirmDeps = {}): Promise<number> {
  const { data } = await admin.from("rentals").select("id").eq("status", "reserved").limit(200);
  const rows = (data ?? []) as any[];
  if (!rows.length) return 0;
  const done = await admin.from("reservation_confirmations").select("rental_id").in("rental_id", rows.map((r) => r.id));
  const seen = new Set(((done?.data ?? []) as any[]).map((r) => r.rental_id));
  const s = deps.settings ?? (await loadPickupSchedule(admin));
  let n = 0;
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    const res = await maybeConfirmReservation(admin, { rentalId: r.id }, { ...deps, settings: s });
    if (res.confirmed && (res.webhookId || res.notice === "sent")) n++;
  }
  return n;
}
