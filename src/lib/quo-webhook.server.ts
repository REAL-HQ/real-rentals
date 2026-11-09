// Quo webhook handler (see routes/api/public/sms/quo.ts). Split out so tests
// can drive it with a fake database and a signed request.
import { verifyQuoWebhook } from "@/lib/quo.server";
import { quoSender } from "@/lib/sms-provider.server";
import { toE164 } from "@/lib/sms.server";

type Deps = {
  admin?: any;
  processInbound?: (a: import("@/lib/sms-inbound.server").InboundSmsArgs) => Promise<unknown>;
  now?: number;
};

const ok = () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });

export async function handleQuoWebhook(request: Request, deps: Deps = {}): Promise<Response> {
  const secret = String(process.env.QUO_WEBHOOK_KEY ?? "").trim();
  if (!secret) {
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
  // Only the REAL Rentals line feeds the app.
  if (context.phoneNumberId && context.phoneNumberId !== quoSender()) return ok();

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
      if (Array.isArray(seen) && seen.length) return ok();
    }
    const processInbound = deps.processInbound
      ?? (await import("@/lib/sms-inbound.server")).processInboundSms;
    await processInbound({
      from,
      to: Array.isArray(context.recipientIdentifiers) ? String(context.recipientIdentifiers[0] ?? "") || null : null,
      body: String(resource.text ?? ""),
      provider: "quo",
      providerMessageId: messageId,
    });
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
