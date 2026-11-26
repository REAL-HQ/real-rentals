/**
 * Records rental-text consent for the person signing, or paying the
 * Reservation Fee. The phone number is read from the database. Callers cannot
 * pass one. An existing consent is left alone, including when the checkbox is
 * sent unchecked, so this step cannot opt somebody out.
 */
import { samePhone } from "@/lib/driver-contacts";
import { usPhoneE164 } from "@/lib/us-phone";
import {
  RENTAL_SMS_CONSENT_TEXT,
  RENTAL_SMS_CONSENT_VERSION,
  SMS_CONSENT_SOURCE_AGREEMENT_SIGNING,
  SMS_CONSENT_SOURCE_RESERVATION_FEE,
  smsConsentMissing,
  type RentalSmsConsentSource,
} from "@/lib/sms-consent";

const TICKET_TTL_MS = 24 * 3600 * 1000;
const TICKET_PREFIX = "sms-consent-ticket.v1";

export type SignerConsentSubject = {
  kind: "application" | "additional_driver";
  applicationId: string | null;
  additionalDriverId: string | null;
  esignRecipientId: string | null;
  /** Number on file, E.164 when it is a US number. Never taken from the browser. */
  phone: string | null;
  consented: boolean;
};

type CaptureArgs = {
  agreementId: string;
  applicationId: string | null;
  recipientId: string | null;
  consent: boolean;
  source: RentalSmsConsentSource;
  ip: string | null;
  userAgent: string | null;
  now?: Date;
};

function phoneOnFile(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  return usPhoneE164(trimmed) ?? trimmed;
}

function missingTable(error: { message?: string } | null | undefined): boolean {
  return /does not exist|schema cache|could not find/i.test(String(error?.message ?? ""));
}

async function loadAgreementApplication(admin: any, agreementId: string, applicationId: string | null): Promise<string | null> {
  if (applicationId) return applicationId;
  const row = await admin.from("agreements").select("application_id").eq("id", agreementId).maybeSingle();
  return (row?.data?.application_id as string | null) ?? null;
}

async function loadRecipient(admin: any, agreementId: string, recipientId: string | null) {
  if (recipientId) {
    const row = await admin
      .from("esign_recipients")
      .select("id,document_id,email,phone,signing_order,role")
      .eq("id", recipientId)
      .maybeSingle();
    const recipient = row?.data;
    if (!recipient || recipient.document_id !== agreementId || recipient.role === "cc") return null;
    return recipient;
  }
  const row = await admin
    .from("esign_recipients")
    .select("id,document_id,email,phone,signing_order,role")
    .eq("document_id", agreementId)
    .eq("role", "signer")
    .eq("signing_order", 1)
    .maybeSingle();
  return row?.data ?? null;
}

async function loadAdditionalDriver(admin: any, applicationId: string | null, email: string | null, phone: string | null) {
  if (!applicationId) return null;
  const res = await admin
    .from("rental_additional_drivers")
    .select("id,application_id,email,phone,sms_consent,removed_at")
    .eq("application_id", applicationId);
  if (res?.error) {
    if (missingTable(res.error)) return null;
    throw new Error(res.error.message);
  }
  const rows = ((res?.data ?? []) as any[]).filter((row) => !row.removed_at);
  const want = String(email ?? "").trim().toLowerCase();
  const byEmail = want ? rows.find((row) => String(row.email ?? "").trim().toLowerCase() === want) : null;
  if (byEmail) return byEmail;
  if (phone) return rows.find((row) => samePhone(row.phone, phone)) ?? null;
  return null;
}

export async function resolveSignerConsent(
  admin: any,
  args: { agreementId: string; applicationId: string | null; recipientId: string | null },
): Promise<SignerConsentSubject> {
  const applicationId = await loadAgreementApplication(admin, args.agreementId, args.applicationId);
  const recipient = await loadRecipient(admin, args.agreementId, args.recipientId);
  const additional = !!recipient && Number(recipient.signing_order) > 1;
  if (additional) {
    const driver = await loadAdditionalDriver(admin, applicationId, recipient.email ?? null, recipient.phone ?? null);
    return {
      kind: "additional_driver",
      applicationId: null,
      additionalDriverId: driver?.id ?? null,
      esignRecipientId: recipient.id,
      phone: phoneOnFile(driver?.phone ?? recipient.phone),
      consented: driver?.sms_consent === true,
    };
  }
  let consented = false;
  let phone: string | null = null;
  if (applicationId) {
    const app = await admin.from("applications").select("id,phone,sms_consent").eq("id", applicationId).maybeSingle();
    consented = app?.data?.sms_consent === true;
    phone = phoneOnFile(app?.data?.phone);
  }
  return {
    kind: "application",
    applicationId,
    additionalDriverId: null,
    esignRecipientId: recipient?.id ?? null,
    phone,
    consented,
  };
}

async function insertLog(admin: any, row: Record<string, unknown>) {
  const res = await admin.from("sms_consent_log").insert(row);
  if (res?.error) console.error("[sms-consent] log insert failed", res.error.message ?? res.error);
}

async function clearNumberStop(admin: any, phone: string | null) {
  if (!phone) return;
  try {
    const res = await admin.from("sms_opt_outs").delete().eq("phone", phone);
    if (res?.error && !missingTable(res.error)) console.error("[sms-consent] opt-out clear failed", res.error.message);
  } catch (e) {
    console.error("[sms-consent] opt-out clear failed", e);
  }
}

async function markPrimaryContact(admin: any, applicationId: string, phone: string | null) {
  if (!phone) return;
  try {
    const { recordContactSmsConsent } = await import("@/lib/driver-contacts.server");
    await recordContactSmsConsent(admin, applicationId, phone, "start");
  } catch (e) {
    console.error("[sms-consent] contact evidence failed", e);
  }
}

/**
 * Writes consent for the resolved signer. `consent: false` leaves a false
 * (or empty) flag as it is and records the choice. A person who already
 * consented is not written again.
 */
export async function captureSignerSmsConsent(admin: any, args: CaptureArgs): Promise<{
  recorded: boolean;
  consent: boolean;
  phone: string | null;
  stillNeeded: boolean;
}> {
  const subject = await resolveSignerConsent(admin, args);
  if (!smsConsentMissing(subject.consented)) {
    return { recorded: false, consent: true, phone: subject.phone, stillNeeded: false };
  }
  const now = (args.now ?? new Date()).toISOString();
  const person = {
    application_id: subject.kind === "application" ? subject.applicationId : null,
    additional_driver_id: subject.additionalDriverId,
    esign_recipient_id: subject.esignRecipientId,
  };
  if (!args.consent) {
    if (person.application_id || person.additional_driver_id || person.esign_recipient_id) {
      await insertLog(admin, {
        consented_at: now,
        ip: args.ip,
        user_agent: args.userAgent,
        wording: RENTAL_SMS_CONSENT_TEXT,
        wording_version: RENTAL_SMS_CONSENT_VERSION,
        agreement_id: args.agreementId,
        phone: subject.phone,
        source: args.source,
        consent: false,
        ...person,
      });
    }
    return { recorded: true, consent: false, phone: subject.phone, stillNeeded: true };
  }

  if (subject.kind === "additional_driver") {
    if (subject.additionalDriverId) {
      const upd = await admin.from("rental_additional_drivers").update({ sms_consent: true }).eq("id", subject.additionalDriverId);
      if (upd?.error && !missingTable(upd.error)) throw new Error(upd.error.message);
    }
  } else if (subject.applicationId) {
    const upd = await admin.from("applications").update({
      sms_consent: true,
      sms_opt_out_at: null,
      sms_consent_at: now,
      sms_consent_source: args.source,
      sms_consent_version: RENTAL_SMS_CONSENT_VERSION,
      sms_consent_text: RENTAL_SMS_CONSENT_TEXT,
      sms_consent_phone: subject.phone,
      sms_consent_page: args.source === SMS_CONSENT_SOURCE_RESERVATION_FEE ? "/reservation-fee" : "/sign",
    }).eq("id", subject.applicationId);
    if (upd?.error) throw new Error(upd.error.message);
    await markPrimaryContact(admin, subject.applicationId, subject.phone);
  }
  await clearNumberStop(admin, subject.phone);
  await insertLog(admin, {
    consented_at: now,
    ip: args.ip,
    user_agent: args.userAgent,
    wording: RENTAL_SMS_CONSENT_TEXT,
    wording_version: RENTAL_SMS_CONSENT_VERSION,
    agreement_id: args.agreementId,
    phone: subject.phone,
    source: args.source,
    consent: true,
    ...person,
  });
  return { recorded: true, consent: true, phone: subject.phone, stillNeeded: false };
}

function ticketSecret(): string {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("SMS consent ticket secret is not configured");
  return secret;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

function b64url(value: string): string {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlDecode(value: string): string {
  const pad = value.length % 4 === 0 ? "" : "=".repeat(4 - (value.length % 4));
  return atob(value.replace(/-/g, "+").replace(/_/g, "/") + pad);
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let n = 0;
  for (let i = 0; i < a.length; i++) n |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return n === 0;
}

export async function issueReservationFeeConsentTicket(args: { agreementId: string; recipientId: string | null }): Promise<string> {
  const body = JSON.stringify({ v: 1, agreementId: args.agreementId, recipientId: args.recipientId, exp: Date.now() + TICKET_TTL_MS });
  const sig = await hmacHex(ticketSecret(), `${TICKET_PREFIX}\n${body}`);
  return `${b64url(body)}.${sig}`;
}

export async function readReservationFeeConsentTicket(ticket: string): Promise<{ agreementId: string; recipientId: string | null } | null> {
  const dot = ticket.indexOf(".");
  if (dot <= 0) return null;
  let body = "";
  try {
    body = b64urlDecode(ticket.slice(0, dot));
  } catch {
    return null;
  }
  const sig = ticket.slice(dot + 1);
  const expect = await hmacHex(ticketSecret(), `${TICKET_PREFIX}\n${body}`);
  if (!safeEqual(sig, expect)) return null;
  let parsed: { v?: number; agreementId?: string; recipientId?: string | null; exp?: number };
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (parsed.v !== 1 || typeof parsed.agreementId !== "string" || typeof parsed.exp !== "number") return null;
  if (parsed.exp < Date.now()) return null;
  const recipientId = parsed.recipientId == null ? null : String(parsed.recipientId);
  return { agreementId: parsed.agreementId, recipientId };
}

/** After a signature: store the checkbox choice, then say whether the fee page should ask. */
export async function finishSigningSmsConsent(
  admin: any,
  args: {
    agreementId: string;
    applicationId: string | null;
    recipientId: string | null;
    consent: boolean | undefined;
    ip: string | null;
    userAgent: string | null;
  },
): Promise<{ smsConsentNeeded: boolean; smsConsentTicket: string | null }> {
  try {
    if (typeof args.consent === "boolean") {
      await captureSignerSmsConsent(admin, {
        agreementId: args.agreementId,
        applicationId: args.applicationId,
        recipientId: args.recipientId,
        consent: args.consent,
        source: SMS_CONSENT_SOURCE_AGREEMENT_SIGNING,
        ip: args.ip,
        userAgent: args.userAgent,
      });
    }
  } catch (e) {
    console.error("[sms-consent] signing capture failed", e);
  }
  try {
    const subject = await resolveSignerConsent(admin, args);
    if (!smsConsentMissing(subject.consented)) return { smsConsentNeeded: false, smsConsentTicket: null };
    const ticket = await issueReservationFeeConsentTicket({
      agreementId: args.agreementId,
      recipientId: subject.esignRecipientId,
    });
    return { smsConsentNeeded: true, smsConsentTicket: ticket };
  } catch (e) {
    console.error("[sms-consent] offer failed", e);
    return { smsConsentNeeded: false, smsConsentTicket: null };
  }
}

export async function captureReservationFeeSmsConsent(
  admin: any,
  args: {
    consent: boolean;
    ticket?: string | null;
    sessionId?: string | null;
    ip: string | null;
    userAgent: string | null;
  },
): Promise<{ ok: true } | { ok: false }> {
  try {
    if (args.ticket) {
      const parsed = await readReservationFeeConsentTicket(args.ticket);
      if (!parsed) return { ok: false };
      await captureSignerSmsConsent(admin, {
        agreementId: parsed.agreementId,
        applicationId: null,
        recipientId: parsed.recipientId,
        consent: args.consent,
        source: SMS_CONSENT_SOURCE_RESERVATION_FEE,
        ip: args.ip,
        userAgent: args.userAgent,
      });
      return { ok: true };
    }
    if (args.sessionId) {
      const { reservationFeePayer } = await import("@/lib/payment-not-completed.server");
      const payer = await reservationFeePayer(admin, args.sessionId);
      if (!payer) return { ok: false };
      await captureSignerSmsConsent(admin, {
        agreementId: payer.agreementId,
        applicationId: payer.applicationId,
        recipientId: null,
        consent: args.consent,
        source: SMS_CONSENT_SOURCE_RESERVATION_FEE,
        ip: args.ip,
        userAgent: args.userAgent,
      });
      return { ok: true };
    }
  } catch (e) {
    console.error("[sms-consent] reservation fee capture failed", e);
  }
  return { ok: false };
}
