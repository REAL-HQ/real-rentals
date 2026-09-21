import { createFileRoute } from "@tanstack/react-router";
import { classifyInboundSms, toE164 } from "@/lib/sms.server";

// Twilio inbound SMS webhook.
//
// Point the Twilio number's "A MESSAGE COMES IN" webhook at
// POST https://drivereal.com/api/public/sms/inbound
//
// Two jobs, both compliance-critical:
//   1. STOP/START must be honoured immediately and permanently.
//   2. A reply from an applicant cancels any in-flight follow-up sequence, so
//      a human conversation is never talked over by an automated nudge.
export const Route = createFileRoute("/api/public/sms/inbound")({
  server: {
    handlers: {
      POST: async ({ request }) => handle(request),
    },
  },
});

/**
 * Validate Twilio's X-Twilio-Signature: base64(HMAC-SHA1(authToken, url + sorted k+v pairs)).
 * Without this anyone could POST a forged STOP — or worse, read our replies.
 */
async function isValidTwilioSignature(
  url: string,
  params: Record<string, string>,
  signature: string,
  authToken: string,
): Promise<boolean> {
  const payload = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(authToken),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));

  // Constant-time compare so the signature can't be probed byte by byte.
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}

function twiml(message?: string): Response {
  const body = message
    ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${message}</Message></Response>`
    : `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
  return new Response(body, { status: 200, headers: { "Content-Type": "text/xml" } });
}

async function handle(request: Request): Promise<Response> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const raw = await request.text();
  const params: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(raw)) params[k] = v;

  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    console.error("[sms-inbound] TWILIO_AUTH_TOKEN missing; rejecting webhook");
    return new Response("not configured", { status: 500 });
  }

  const signature = request.headers.get("x-twilio-signature") || "";
  // Twilio signs the exact public URL it was configured with. Behind a proxy
  // the inbound URL can differ, so allow an explicit override.
  const url = process.env.TWILIO_INBOUND_URL || request.url;
  if (!signature || !(await isValidTwilioSignature(url, params, signature, authToken))) {
    console.error("[sms-inbound] invalid Twilio signature");
    return new Response("invalid signature", { status: 403 });
  }

  const from = toE164(params.From);
  const body = params.Body ?? "";
  if (!from) return twiml();

  const intent = classifyInboundSms(body);

  // Log the inbound message so the team can see the conversation in the admin.
  await supabaseAdmin.from("outbound_messages").insert({
    channel: "sms",
    to_address: from,
    from_address: params.To ?? null,
    body,
    status: "sent",
    provider: "twilio",
    provider_message_id: params.MessageSid ?? null,
    kind: `inbound_${intent}`,
    sent_at: new Date().toISOString(),
  });

  // Match the number back to applications so we can act on their record.
  const digits = from.replace(/^\+1/, "");
  const { data: apps } = await supabaseAdmin
    .from("applications")
    .select("id,phone")
    .ilike("phone", `%${digits.slice(-10)}%`)
    .limit(10);
  const appIds = (apps ?? []).map((a: any) => a.id as string);

  if (intent === "stop") {
    await supabaseAdmin
      .from("sms_opt_outs")
      .upsert({ phone: from, reason: "inbound STOP" }, { onConflict: "phone" });
    if (appIds.length) {
      await supabaseAdmin
        .from("applications")
        .update({ sms_opt_out_at: new Date().toISOString(), sms_consent: false })
        .in("id", appIds);
      await supabaseAdmin
        .from("automation_enrollments")
        .update({
          status: "cancelled",
          cancelled_reason: "recipient replied STOP",
          next_run_at: null,
        })
        .in("application_id", appIds)
        .eq("status", "active");
    }
    // Twilio's Advanced Opt-Out sends the confirmation itself; stay silent.
    return twiml();
  }

  if (intent === "start") {
    await supabaseAdmin.from("sms_opt_outs").delete().eq("phone", from);
    if (appIds.length) {
      await supabaseAdmin
        .from("applications")
        .update({ sms_opt_out_at: null, sms_consent: true })
        .in("id", appIds);
    }
    return twiml();
  }

  if (intent === "help") {
    return twiml(
      "REAL RENTALS: rental support at (813) 699-9118 or team@drivereal.com. Reply STOP to opt out.",
    );
  }

  // A real reply — stop the drip so a human can take over the conversation.
  if (appIds.length) {
    const { data: live } = await supabaseAdmin
      .from("automation_enrollments")
      .select("id,workflow_id")
      .in("application_id", appIds)
      .eq("status", "active");

    for (const enrollment of live ?? []) {
      const { data: wf } = await supabaseAdmin
        .from("automation_workflows")
        .select("stop_on_reply")
        .eq("id", enrollment.workflow_id)
        .maybeSingle();
      if (wf?.stop_on_reply) {
        await supabaseAdmin
          .from("automation_enrollments")
          .update({ status: "cancelled", cancelled_reason: "recipient replied", next_run_at: null })
          .eq("id", enrollment.id);
      }
    }

    // Surface the reply in the admin inbox.
    await supabaseAdmin.from("notifications").insert({
      kind: "sms_reply",
      title: "New SMS reply",
      body: `${from}: ${body.slice(0, 280)}`,
      channels: ["in_app"],
    });
  }

  return twiml();
}
