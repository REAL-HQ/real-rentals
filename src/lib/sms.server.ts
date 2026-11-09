// Server-only SMS helper. Provider: Quo (formerly OpenPhone) when QUO_API_KEY
// is set, otherwise Twilio — see sms-provider.server.ts. SMS_DRY_RUN=true logs
// every send as "dry run: not sent" and never calls a provider.
//
// Never import from client code — the .server.ts suffix keeps it out of the
// browser bundle. Credentials are read INSIDE the function because Cloudflare
// Workers bind env at request time, matching email.server.ts.
//
// Every send goes through `sendSms`, which enforces consent before it dials
// out: an applicant who never ticked the SMS box, or who replied STOP, is
// never texted. That check lives here rather than at each call site so a new
// caller cannot accidentally bypass it.

import { resolveQuoSender, smsProviderStatus } from "@/lib/sms-provider.server";

export type SmsResult =
  | { ok: true; id: string | null; skipped?: false }
  | { ok: false; skipped: true; reason: string }
  | { ok: false; skipped?: false; error: string };

type SendSmsArgs = {
  to: string;
  body: string;
  /** Tags the row in outbound_messages, e.g. "automation" or "past_due". */
  kind?: string;
  applicationId?: string | null;
  rentalId?: string | null;
  vehicleId?: string | null;
  workflowId?: string | null;
  enrollmentId?: string | null;
  stepId?: string | null;
  /**
   * Transactional messages (a rental agreement link the driver asked for)
   * still require an opt-out check but not a marketing opt-in.
   */
  requireConsent?: boolean;
  /**
   * Driver notices set this. Live sends omit it, so the Twilio fetch is the
   * same request it was before: no abort signal is created.
   */
  noticeTimeout?: boolean;
  /** Combined with the 5s notice abort. Live sends omit noticeTimeout, so this is ignored. */
  signal?: AbortSignal;
  /**
   * Quo number to send from (PN id). Must be on the server allowlist
   * (sms-provider.server quoSenders); anything else is refused before any
   * send. Omitted → the default REAL Rentals line.
   */
  fromId?: string | null;
};

/**
 * Normalise a US phone number to E.164. Returns null when the input cannot be
 * a valid North American number, so we never hand Twilio junk.
 */
export function toE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/[^\d]/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (String(raw).trim().startsWith("+") && digits.length >= 8 && digits.length <= 15) {
    return `+${digits}`;
  }
  return null;
}

/** Words that opt a recipient out, per CTIA guidance. */
const STOP_WORDS = new Set([
  "stop",
  "stopall",
  "unsubscribe",
  "cancel",
  "end",
  "quit",
  "revoke",
  "optout",
]);
/** Words that opt a recipient back in. */
const START_WORDS = new Set(["start", "unstop", "yes", "optin"]);

export function classifyInboundSms(body: string): "stop" | "start" | "help" | "other" {
  const word = body
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  if (STOP_WORDS.has(word)) return "stop";
  if (START_WORDS.has(word)) return "start";
  if (word === "help" || word === "info") return "help";
  return "other";
}

/**
 * Substitute {{token}} placeholders in an automation body. Unknown tokens
 * collapse to an empty string rather than leaking "{{first_name}}" into a
 * customer's text message.
 */
export function renderTemplate(
  template: string,
  vars: Record<string, string | null | undefined>,
): string {
  return (
    template
      .replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_m, key: string) => {
        const v = vars[key.toLowerCase()];
        return v == null ? "" : String(v);
      })
      // Collapse the double spaces an empty token leaves behind.
      .replace(/[ \t]{2,}/g, " ")
      .trim()
  );
}

/** Has this number opted out of SMS? */
export async function isOptedOut(admin: any, e164: string): Promise<boolean> {
  const { data } = await admin.from("sms_opt_outs").select("phone").eq("phone", e164).maybeSingle();
  return !!data;
}

async function logMessage(admin: any, row: Record<string, unknown>): Promise<void> {
  const { error } = await admin.from("outbound_messages").insert(row);
  // A duplicate here means the per-step unique index caught a double send.
  if (error && !String(error.message).includes("duplicate key")) {
    console.error("[sms] could not log outbound message", error.message);
  }
}

function noticeFetchSignal(noticeTimeout: boolean | undefined, signal: AbortSignal | undefined): AbortSignal | undefined {
  if (noticeTimeout !== true) return undefined;
  const timeout = AbortSignal.timeout(5000);
  return signal ? AbortSignal.any([timeout, signal]) : timeout;
}

export async function sendSms(args: SendSmsArgs): Promise<SmsResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const requireConsent = args.requireConsent !== false;

  const to = toE164(args.to);
  if (!to) {
    return { ok: false, skipped: true, reason: "invalid_phone" };
  }

  // 1. Opt-out always wins, transactional or not.
  if (await isOptedOut(supabaseAdmin, to)) {
    await logMessage(supabaseAdmin, {
      channel: "sms",
      to_address: to,
      body: args.body,
      status: "skipped",
      error: "recipient opted out",
      kind: args.kind ?? null,
      application_id: args.applicationId ?? null,
      rental_id: args.rentalId ?? null,
      vehicle_id: args.vehicleId ?? null,
      workflow_id: args.workflowId ?? null,
      enrollment_id: args.enrollmentId ?? null,
      step_id: args.stepId ?? null,
    });
    return { ok: false, skipped: true, reason: "opted_out" };
  }

  // 2. Ordinary messages require a recorded opt-in on a known applicant.
  //    No applicant record means no consent record, so nothing is sent.
  if (requireConsent && !args.applicationId) {
    await logMessage(supabaseAdmin, {
      channel: "sms",
      to_address: to,
      body: args.body,
      status: "skipped",
      error: "no SMS consent record (no applicant)",
      kind: args.kind ?? null,
    });
    return { ok: false, skipped: true, reason: "no_consent" };
  }
  if (requireConsent && args.applicationId) {
    const { data: app } = await supabaseAdmin
      .from("applications")
      .select("sms_consent,sms_opt_out_at")
      .eq("id", args.applicationId)
      .maybeSingle();
    if (!app?.sms_consent || app?.sms_opt_out_at) {
      await logMessage(supabaseAdmin, {
        channel: "sms",
        to_address: to,
        body: args.body,
        status: "skipped",
        error: app?.sms_opt_out_at ? "applicant opted out" : "no SMS consent on file",
        kind: args.kind ?? null,
        application_id: args.applicationId,
        workflow_id: args.workflowId ?? null,
        enrollment_id: args.enrollmentId ?? null,
        step_id: args.stepId ?? null,
      });
      return { ok: false, skipped: true, reason: "no_consent" };
    }
  }

  const provider = smsProviderStatus();
  const base = {
    channel: "sms",
    to_address: to,
    body: args.body,
    kind: args.kind ?? null,
    application_id: args.applicationId ?? null,
    rental_id: args.rentalId ?? null,
    vehicle_id: args.vehicleId ?? null,
    workflow_id: args.workflowId ?? null,
    enrollment_id: args.enrollmentId ?? null,
    step_id: args.stepId ?? null,
  };

  if (!provider.ready) {
    console.error("[sms] SMS provider not configured; skipping send", { kind: args.kind });
    await logMessage(supabaseAdmin, {
      ...base,
      status: "skipped",
      error: provider.provider === "twilio" ? "twilio not configured" : "sms provider not configured",
    });
    return { ok: false, skipped: true, reason: "not_configured" };
  }

  // Sender choice: only allowlisted Quo numbers, and only when Quo is the provider.
  const hasFrom = args.fromId != null && args.fromId !== "";
  const sender = provider.provider === "quo" ? resolveQuoSender(args.fromId) : null;
  if (hasFrom && !sender) {
    console.error("[sms] refused a sending number that is not allowlisted", { kind: args.kind });
    return { ok: false, skipped: true, reason: "sender_not_allowed" };
  }

  // 3. Same text to the same number moments ago (double click, retry, two
  //    staff, overlapping cron) — never text it twice.
  if (await recentDuplicate(supabaseAdmin, to, args.body)) {
    return { ok: false, skipped: true, reason: "duplicate" };
  }

  // 4. Dry run: record exactly what would have gone out, call nobody.
  if (provider.dryRun) {
    await logMessage(supabaseAdmin, {
      ...base,
      from_address: sender?.e164 ?? provider.sender,
      status: "skipped",
      provider: provider.provider,
      error: "dry run: not sent",
    });
    return { ok: false, skipped: true, reason: "dry_run" };
  }

  const noticeSignal = noticeFetchSignal(args.noticeTimeout, args.signal);
  if (provider.provider === "quo" && sender) return sendViaQuo(supabaseAdmin, base, sender, noticeSignal);
  return sendViaTwilio(supabaseAdmin, args, to, noticeSignal);
}

/** Window in which an identical text to the same number is treated as a repeat. */
export const SMS_DUPLICATE_WINDOW_MS = 2 * 60 * 1000;

async function recentDuplicate(admin: any, to: string, body: string): Promise<boolean> {
  try {
    const since = new Date(Date.now() - SMS_DUPLICATE_WINDOW_MS).toISOString();
    const { data } = await admin
      .from("outbound_messages")
      .select("id")
      .eq("channel", "sms")
      .eq("to_address", to)
      .eq("body", body)
      .in("status", ["queued", "sent"])
      // Inbound texts are logged here too (kind inbound_*); a reply that
      // repeats the renter's own words is not a duplicate send.
      .or("kind.is.null,kind.not.like.inbound_*")
      .gte("created_at", since)
      .limit(1);
    return Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
}

/**
 * Quo send. The log row is claimed as "queued" BEFORE the API call, so the
 * per-step unique index stops an overlapping automation run from texting
 * twice, and a crash mid-send still leaves a visible record. The row then
 * moves to sent / failed; a timeout or 5xx stays "queued" with an
 * "Unconfirmed" error because Quo may have accepted it — never auto-resent.
 */
async function sendViaQuo(admin: any, base: Record<string, unknown>, sender: { id: string; e164: string }, signal: AbortSignal | undefined): Promise<SmsResult> {
  const { sendQuoMessage } = await import("@/lib/quo.server");
  // from_address records the number actually used (E.164), so replies and
  // the next text in this conversation can default to the same line.
  const claim = await admin
    .from("outbound_messages")
    .insert({ ...base, from_address: sender.e164, status: "queued", provider: "quo" })
    .select("id")
    .single();
  if (claim.error) {
    if (String(claim.error.message).includes("duplicate key")) {
      return { ok: false, skipped: true, reason: "duplicate" };
    }
    console.error("[sms] could not record outbound text; not sending", claim.error.message);
    return { ok: false, error: "could not record the text before sending" };
  }
  const rowId = claim.data?.id as string | undefined;
  const update = async (patch: Record<string, unknown>) => {
    if (!rowId) return;
    const { error } = await admin.from("outbound_messages").update(patch).eq("id", rowId);
    if (error) console.error("[sms] could not update outbound text log", error.message);
  };

  const r = await sendQuoMessage({
    apiKey: String(process.env.QUO_API_KEY).trim(),
    from: sender.id,
    to: String(base.to_address),
    content: String(base.body),
    signal,
  });

  if (r.ok) {
    await update({ status: "sent", provider_message_id: r.id, error: null, sent_at: new Date().toISOString() });
    return { ok: true, id: r.id };
  }
  console.error(`[sms] Quo send failed [${r.httpStatus ?? "network"}]`, r.error);
  if (r.optedOut) {
    // Quo has the recipient as STOPped; mirror it so no path retries them.
    await admin.from("sms_opt_outs").upsert({ phone: base.to_address, reason: "Quo reported opt-out" }, { onConflict: "phone" });
    await update({ status: "failed", error: "recipient opted out (Quo)" });
    return { ok: false, skipped: true, reason: "opted_out" };
  }
  if (r.uncertain) {
    await update({ status: "queued", error: `Unconfirmed: ${r.error}` });
    return { ok: false, error: r.error };
  }
  await update({ status: "failed", error: r.error });
  if (r.badNumber) return { ok: false, skipped: true, reason: "invalid_phone" };
  return { ok: false, error: r.error };
}

async function sendViaTwilio(supabaseAdmin: any, args: SendSmsArgs, to: string, noticeSignal: AbortSignal | undefined): Promise<SmsResult> {
  const sid = process.env.TWILIO_ACCOUNT_SID as string;
  const token = process.env.TWILIO_AUTH_TOKEN as string;
  const from = process.env.TWILIO_FROM_NUMBER;
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;

  const form = new URLSearchParams();
  form.set("To", to);
  form.set("Body", args.body);
  if (messagingServiceSid) form.set("MessagingServiceSid", messagingServiceSid);
  else form.set("From", from as string);

  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${sid}:${token}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
      ...(noticeSignal ? { signal: noticeSignal } : {}),
    });
    const payload = (await res.json().catch(() => ({}))) as { sid?: string; message?: string };

    if (!res.ok) {
      console.error(`[sms] Twilio send failed [${res.status}]`, payload?.message);
      await logMessage(supabaseAdmin, {
        channel: "sms",
        to_address: to,
        from_address: from ?? messagingServiceSid ?? null,
        body: args.body,
        status: "failed",
        provider: "twilio",
        error: payload?.message ?? `HTTP ${res.status}`,
        kind: args.kind ?? null,
        application_id: args.applicationId ?? null,
        rental_id: args.rentalId ?? null,
        vehicle_id: args.vehicleId ?? null,
        workflow_id: args.workflowId ?? null,
        enrollment_id: args.enrollmentId ?? null,
        step_id: args.stepId ?? null,
      });
      return { ok: false, error: payload?.message ?? `HTTP ${res.status}` };
    }

    await logMessage(supabaseAdmin, {
      channel: "sms",
      to_address: to,
      from_address: from ?? messagingServiceSid ?? null,
      body: args.body,
      status: "sent",
      provider: "twilio",
      provider_message_id: payload?.sid ?? null,
      kind: args.kind ?? null,
      application_id: args.applicationId ?? null,
      rental_id: args.rentalId ?? null,
      vehicle_id: args.vehicleId ?? null,
      workflow_id: args.workflowId ?? null,
      enrollment_id: args.enrollmentId ?? null,
      step_id: args.stepId ?? null,
      sent_at: new Date().toISOString(),
    });
    return { ok: true, id: payload?.sid ?? null };
  } catch (err) {
    console.error("[sms] Twilio send threw", err);
    return { ok: false, error: err instanceof Error ? err.message : "send failed" };
  }
}
