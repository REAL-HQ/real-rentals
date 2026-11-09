import { createFileRoute } from "@tanstack/react-router";
import { toE164 } from "@/lib/sms.server";

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
  if (!from) return twiml();
  const { processInboundSms } = await import("@/lib/sms-inbound.server");
  const out = await processInboundSms({
    from,
    to: params.To ?? null,
    body: params.Body ?? "",
    provider: "twilio",
    providerMessageId: params.MessageSid ?? null,
  });
  return twiml(out.reply);
}
