// Server-only Twilio SMS helper.
//
// Never import from client code — the .server.ts suffix keeps it out of the
// browser bundle. Credentials are read INSIDE the function because Cloudflare
// Workers bind env at request time, matching email.server.ts.
//
// Every send goes through `sendSms`, which enforces consent before it dials
// out: an applicant who never ticked the SMS box, or who replied STOP, is
// never texted. That check lives here rather than at each call site so a new
// caller cannot accidentally bypass it.

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

  // 2. Marketing/automated messages additionally require a recorded opt-in.
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

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;

  if (!sid || !token || (!from && !messagingServiceSid)) {
    console.error("[sms] Twilio credentials missing; skipping send", { kind: args.kind });
    await logMessage(supabaseAdmin, {
      channel: "sms",
      to_address: to,
      body: args.body,
      status: "skipped",
      error: "twilio not configured",
      kind: args.kind ?? null,
      application_id: args.applicationId ?? null,
      workflow_id: args.workflowId ?? null,
      enrollment_id: args.enrollmentId ?? null,
      step_id: args.stepId ?? null,
    });
    return { ok: false, skipped: true, reason: "not_configured" };
  }

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
