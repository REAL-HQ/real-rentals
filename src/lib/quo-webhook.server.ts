// Quo webhook handler (see routes/api/public/sms/quo.ts). Split out so tests
// can drive it with a fake database and a signed request.
import { parseQuoWebhookKeys, verifyQuoWebhook } from "@/lib/quo.server";
import { quoInboundLineFor, recordQuoEvent, type QuoLine } from "@/lib/quo-events.server";
import { toE164 } from "@/lib/sms.server";

type Deps = {
  admin?: any;
  processInbound?: (a: import("@/lib/sms-inbound.server").InboundSmsArgs) => Promise<unknown>;
  now?: number;
  /** Sends one queued FLEET delivery right away. Default: the shared signed sender. */
  dispatch?: (admin: any, ids: string[]) => Promise<unknown>;
};

/**
 * Log on the lead and forward to FLEET (idempotent on the Quo event id), then
 * try the FLEET send at once. A failed send stays queued for the cron retry.
 */
async function logAndForward(admin: any, event: any, line: QuoLine, deps: Deps): Promise<void> {
  const nowIso = new Date(deps.now ? deps.now * 1000 : Date.now()).toISOString();
  const rec = await recordQuoEvent(admin, event, line, nowIso);
  if (!rec?.deliveryId) return;
  try {
    if (deps.dispatch) await deps.dispatch(admin, [rec.deliveryId]);
    else {
      const { dispatchFleetWebhooks } = await import("@/lib/fleet-webhook.server");
      await dispatchFleetWebhooks(admin, { ids: [rec.deliveryId] }, { timeoutMs: 5000 });
    }
  } catch (e) {
    console.error("[sms-quo] FLEET forward will retry", e);
  }
}

const ok = () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });

export async function handleQuoWebhook(request: Request, deps: Deps = {}): Promise<Response> {
  // One key, or a comma-separated list (one per Quo webhook).
  const secret = parseQuoWebhookKeys(process.env.QUO_WEBHOOK_KEY);
  if (!secret.length) {
    console.error("[sms-quo] QUO_WEBHOOK_KEY missing; rejecting webhook");
    return new Response("not configured", { status: 503 });
  }
  const raw = await request.text();
  const valid = await verifyQuoWebhook(
    secret,
    {
      id: request.headers.get("webhook-id"),
      timestamp: request.headers.get("webhook-timestamp"),
      signature: request.headers.get("webhook-signature"),
    },
    raw,
    deps.now,
  );
  if (!valid) {
    console.error("[sms-quo] invalid Quo webhook signature");
    return new Response("invalid signature", { status: 403 });
  }

  let event: any;
  try {
    event = JSON.parse(raw);
  } catch {
    return new Response("bad payload", { status: 400 });
  }
  const type = String(event?.type ?? "");
  const resource = event?.data?.resource ?? {};
  const context = event?.data?.context ?? {};
  // Only the accepted lines (QUO_INBOUND_NUMBER_IDS; default Primary 813 and
  // REAL Rentals 888) feed the app; events for any other Quo number are
  // acknowledged and dropped. Independent of QUO_FROM_NUMBERS (sending).
  const line = quoInboundLineFor(context.phoneNumberId);
  if (!line) return ok();

  const admin = deps.admin ?? (await import("@/integrations/supabase/client.server")).supabaseAdmin;
  const messageId = typeof resource.id === "string" ? resource.id : null;

  if (type === "message.received") {
    const from = toE164(context.senderIdentifier);
    if (!from) return ok();
    // Quo retries until it sees a 2xx: process each message once.
    if (messageId) {
      const { data: seen } = await admin
        .from("outbound_messages").select("id")
        .eq("provider", "quo").eq("provider_message_id", messageId).limit(1);
      if (Array.isArray(seen) && seen.length) {
        // Already threaded; the log and FLEET forward are idempotent, so a
        // retry still completes them if the first try stopped part-way.
        await logAndForward(admin, event, line, deps).catch((e) => console.error("[sms-quo] log/forward failed", e));
        return ok();
      }
    }
    const processInbound = deps.processInbound
      ?? (await import("@/lib/sms-inbound.server")).processInboundSms;
    await processInbound({
      from,
      // Record the line it arrived on, so the next reply defaults to it.
      to: line.e164,
      body: String(resource.text ?? ""),
      provider: "quo",
      providerMessageId: messageId,
    });
    await logAndForward(admin, event, line, deps).catch((e) => console.error("[sms-quo] log/forward failed", e));
    return ok();
  }

  // Calls, missed calls, voicemails, recordings, transcripts and summaries:
  // log on the matched lead (or unmatched) and forward to FLEET. A failure
  // here answers 500 so Quo retries; the event id keeps it to one entry.
  if (type.startsWith("call.")) {
    try {
      await logAndForward(admin, event, line, deps);
    } catch (e) {
      console.error("[sms-quo] call event not logged; Quo will retry", e);
      return new Response("retry", { status: 500 });
    }
    return ok();
  }

  if ((type === "message.failed" || type === "message.undelivered") && messageId) {
    const reason = type === "message.failed" ? "Quo: message failed" : "Quo: message undelivered";
    await admin.from("outbound_messages")
      .update({ status: "failed", error: reason })
      .eq("provider", "quo").eq("provider_message_id", messageId);
    return ok();
  }

  // message.delivered and anything else: nothing to change ("sent" already).
  return ok();
}
