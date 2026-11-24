/**
 * Staff recovery when a renter has signed and paid the Reservation Fee but
 * never booked a pickup. Book Pickup itself is createReservation →
 * createReservationCore (the same guards, fee link, and confirmation side
 * effects as Reserve A Car). This module only detects that state, refreshes
 * the Payment Received link onto the current signed agreement, emails that
 * link when staff click Send, and raises one staff notice when signing finds
 * the fee already paid and no pickup exists.
 *
 * No SMS. No phone numbers in notices or email.
 */
import { driverRecordPath } from "@/lib/admin-record-links";
import { isCheckoutSessionId } from "@/lib/payment-received";
import {
  FEE_PAID_NO_PICKUP_TITLE,
  feePaidNoPickupBody,
  feePaidNoPickupEmail,
  isOpenRentalStatus,
  isPickupNotBooked,
  pickupLinkEmail,
  pickupLinkPath,
  type PickupNotBookedState,
} from "@/lib/pickup-not-booked";
import { publicAppUrl } from "@/lib/public-app-url";
import { agreementIdFromReservationFeeNotes, RESERVATION_FEE_REASON } from "@/lib/reservation-fee";
import { reservationPickupDate } from "@/lib/reservations";

type Admin = any;

export type { PickupNotBookedState };

export type PickupLinkResult =
  | { ok: true; url: string; sessionId: string; agreementId: string; paymentId: string; refreshed: boolean }
  | { ok: false; message: string };

export type PickupLinkSendResult = { ok: true; to: string } | { ok: false; message: string };

export type FeePaidNoPickupResult = { status: "notified" | "duplicate" | "pickup_booked" | "skipped" | "failed"; email?: "sent" | "failed" | "skipped" };

const OPEN = ["reserved", "on_hold", "active"];

function keptOrCredited(notes: unknown): boolean {
  const text = String(notes ?? "");
  return /\bkept:/.test(text) || /credited_week1/.test(text);
}

function currentSigned(rows: any[]): any | null {
  const live = rows.filter((r) => r && r.status === "signed" && !r.voided_at && !r.metadata?.amendment && r.signed_at);
  live.sort((a, b) => String(b.signed_at).localeCompare(String(a.signed_at)));
  return live[0] ?? null;
}

function checkoutOf(row: any): { session_id?: string; payment_id?: string; url?: string } | null {
  const co = row?.metadata?.reservation_fee_checkout;
  return co && typeof co === "object" ? co : null;
}

type Context = {
  state: PickupNotBookedState;
  name: string | null;
  email: string | null;
  agreements: any[];
  payment: any | null;
};

async function loadContext(admin: Admin, applicationId: string): Promise<Context> {
  const empty: PickupNotBookedState = {
    show: false, openRental: false, vehicleId: null, startDate: null, agreementId: null, paymentId: null, feeNotesMatch: false,
  };
  const [appRes, agRes, payRes, rentRes] = await Promise.all([
    admin.from("applications").select("id,status,vehicle_id,contract_start_date,full_name,email,deleted_at").eq("id", applicationId).maybeSingle(),
    admin.from("agreements").select("id,status,signed_at,voided_at,metadata,application_id").eq("application_id", applicationId).limit(20),
    admin.from("payments").select("id,status,notes,reason,amount").eq("driver_id", applicationId).eq("reason", RESERVATION_FEE_REASON).eq("status", "paid").limit(5),
    admin.from("rentals").select("id,status").eq("application_id", applicationId).in("status", OPEN).limit(5),
  ]);
  const app = appRes?.data ?? null;
  const agreements = ((agRes?.data ?? []) as any[]);
  const signed = currentSigned(agreements);
  const payment = ((payRes?.data ?? []) as any[]).find((p) => !keptOrCredited(p.notes)) ?? null;
  const openRental = ((rentRes?.data ?? []) as any[]).some((r) => isOpenRentalStatus(r.status));
  const noted = agreementIdFromReservationFeeNotes(payment?.notes);
  const feeNotesMatch = !!signed && !!payment && noted === String(signed.id).toLowerCase();
  const startDate = reservationPickupDate(typeof app?.contract_start_date === "string" ? app.contract_start_date.slice(0, 10) : null);
  const state: PickupNotBookedState = {
    show: isPickupNotBooked({
      applicationStatus: app?.status ?? null,
      deleted: !!app?.deleted_at,
      hasCurrentSignedAgreement: !!signed,
      reservationFeePaid: !!payment,
      openRental,
    }),
    openRental,
    vehicleId: app?.vehicle_id ?? null,
    startDate,
    agreementId: signed?.id ?? null,
    paymentId: payment?.id ?? null,
    feeNotesMatch,
  };
  if (!app) return { state: empty, name: null, email: null, agreements: [], payment: null };
  return { state, name: app.full_name ?? null, email: app.email ?? null, agreements, payment };
}

export async function loadPickupNotBooked(admin: Admin, applicationId: string): Promise<PickupNotBookedState> {
  try {
    return (await loadContext(admin, applicationId)).state;
  } catch (e) {
    console.error("[pickup-not-booked] load failed", String((e as Error)?.message ?? e));
    return { show: false, openRental: false, vehicleId: null, startDate: null, agreementId: null, paymentId: null, feeNotesMatch: false };
  }
}

function sessionFor(ctx: Context): { sessionId: string; url: string | null; fromAgreementId: string } | null {
  const currentId = ctx.state.agreementId;
  const paymentId = ctx.state.paymentId;
  if (!currentId || !paymentId) return null;
  const hits: { sessionId: string; url: string | null; fromAgreementId: string; rank: number }[] = [];
  for (const row of ctx.agreements) {
    const co = checkoutOf(row);
    const sessionId = typeof co?.session_id === "string" ? co.session_id : "";
    if (!isCheckoutSessionId(sessionId)) continue;
    if (co?.payment_id && co.payment_id !== paymentId) continue;
    const exact = co?.payment_id === paymentId;
    hits.push({
      sessionId,
      url: typeof co?.url === "string" ? co.url : null,
      fromAgreementId: row.id,
      rank: (exact ? 2 : 0) + (exact && row.id === currentId ? 1 : 0),
    });
  }
  hits.sort((a, b) => b.rank - a.rank);
  const best = hits[0];
  return best ? { sessionId: best.sessionId, url: best.url, fromAgreementId: best.fromAgreementId } : null;
}

/** Build or refresh the renter slot-picker link. Sends nothing. */
export async function preparePickupLink(admin: Admin, applicationId: string): Promise<PickupLinkResult> {
  const ctx = await loadContext(admin, applicationId);
  if (!ctx.state.show) {
    return { ok: false, message: ctx.state.openRental ? "A Pickup Is Already Booked." : "This Lead Is Not Ready For A Pickup Link." };
  }
  if (!ctx.state.feeNotesMatch || !ctx.state.agreementId || !ctx.state.paymentId) {
    return { ok: false, message: "The Reservation Fee Is Not Tied To The Current Signed Agreement." };
  }
  const found = sessionFor(ctx);
  if (!found) return { ok: false, message: "No Payment Received Link Is On File For This Reservation Fee." };
  const current = ctx.agreements.find((r) => r.id === ctx.state.agreementId);
  const stored = checkoutOf(current);
  const already = stored?.session_id === found.sessionId && stored?.payment_id === ctx.state.paymentId;
  if (!already && current) {
    const metadata = {
      ...(current.metadata ?? {}),
      reservation_fee_checkout: {
        ...(stored ?? {}),
        session_id: found.sessionId,
        payment_id: ctx.state.paymentId,
        ...(found.url ? { url: found.url } : {}),
        refreshed_at: new Date().toISOString(),
      },
    };
    await admin.from("agreements").update({ metadata }).eq("id", current.id);
  }
  return {
    ok: true,
    url: publicAppUrl(pickupLinkPath(found.sessionId)),
    sessionId: found.sessionId,
    agreementId: ctx.state.agreementId,
    paymentId: ctx.state.paymentId,
    refreshed: !already,
  };
}

export type PickupSendDeps = {
  sendEmail?: (a: { to: string; subject: string; html: string; track: { workflow: string } }) => Promise<{ ok?: boolean; error?: string } | unknown>;
};

/** Email the current slot-picker link from team@. No SMS. */
export async function sendPickupLink(admin: Admin, applicationId: string, deps: PickupSendDeps = {}): Promise<PickupLinkSendResult> {
  const link = await preparePickupLink(admin, applicationId);
  if (!link.ok) return link;
  const ctx = await loadContext(admin, applicationId);
  const to = String(ctx.email ?? "").trim();
  if (!to) return { ok: false, message: "This Renter Has No Email On File." };
  const first = String(ctx.name ?? "").trim().split(/\s+/)[0] || null;
  const message = pickupLinkEmail({ firstName: first, url: link.url });
  const send = deps.sendEmail ?? (async (a) => (await import("@/lib/email.server")).sendEmail(a));
  const result: any = await send({ to, subject: message.subject, html: message.html, track: { workflow: "pickup_link" } });
  if (result?.ok === false) return { ok: false, message: String(result.error ?? "The Pickup Link Email Could Not Be Sent.") };
  return { ok: true, to };
}

export type AlertDeps = {
  sendEmail?: (a: { to: string; subject: string; html: string; track: { workflow: string } }) => Promise<unknown>;
};

/**
 * One staff notice per lead when signing finds the Reservation Fee already
 * paid and no pickup is booked. Never throws.
 */
export async function alertFeePaidNoPickup(admin: Admin, applicationId: string, deps: AlertDeps = {}): Promise<FeePaidNoPickupResult> {
  try {
    if (!applicationId) return { status: "skipped" };
    const ctx = await loadContext(admin, applicationId);
    if (ctx.state.openRental) return { status: "pickup_booked" };
    if (!ctx.state.agreementId || !ctx.payment) return { status: "skipped" };
    const prior = await admin.from("notifications").select("id").eq("title", FEE_PAID_NO_PICKUP_TITLE).ilike("body", `%Lead ${applicationId}%`).limit(1);
    if (((prior?.data ?? []) as any[]).length) return { status: "duplicate" };
    const body = feePaidNoPickupBody(ctx.name, applicationId);
    const ins = await admin.from("notifications").insert({
      driver_id: null,
      user_id: null,
      partner_id: null,
      title: FEE_PAID_NO_PICKUP_TITLE,
      body,
      kind: "payment",
      read: false,
      channels: ["in_app"],
    });
    if (ins?.error) return { status: "failed" };
    let email: FeePaidNoPickupResult["email"] = "skipped";
    try {
      const { TEAM_ALERT_EMAIL } = await import("@/lib/team-alerts");
      const mail = feePaidNoPickupEmail({ name: ctx.name, applicationId, adminUrl: publicAppUrl(driverRecordPath(applicationId)) });
      const send = deps.sendEmail ?? (async (a) => (await import("@/lib/email.server")).sendEmail(a));
      const result: any = await send({ to: TEAM_ALERT_EMAIL, subject: mail.subject, html: mail.html, track: { workflow: "fee_paid_no_pickup" } });
      email = result?.ok === false ? "failed" : "sent";
    } catch {
      email = "failed";
    }
    return { status: "notified", email };
  } catch (e) {
    console.error("[pickup-not-booked] alert failed", String((e as Error)?.message ?? e));
    return { status: "failed" };
  }
}
