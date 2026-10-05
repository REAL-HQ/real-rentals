import { createFileRoute } from "@tanstack/react-router";

// Resend delivery webhook.
//
// This is the only thing allowed to say an email was delivered, bounced or
// complained about. Resend signs every delivery with an HMAC (svix scheme);
// anything without a valid signature is rejected before the payload is read.
//
// Fail closed: with no RESEND_WEBHOOK_SECRET configured the endpoint answers
// 500 to everything, because an unverifiable webhook is worse than none.
//
// Idempotent and out-of-order safe: events carry Resend's message id, each
// terminal timestamp is written only once, and a late "sent" can never
// downgrade a row that already reached a terminal state. Unknown message ids
// are acknowledged and ignored — Resend must not retry them forever.

const EVENT_STATE: Record<string, "accepted" | "delivered" | "bounced" | "complained" | "failed"> = {
  "email.sent": "accepted",
  "email.delivered": "delivered",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.failed": "failed",
};


async function verifySignature(body: string, headers: Headers, secret: string): Promise<boolean> {
  const id = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const signature = headers.get("svix-signature");
  if (!id || !timestamp || !signature) return false;

  // Reject replays older than 5 minutes.
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;

  try {
    const keyB64 = secret.startsWith("whsec_") ? secret.slice(6) : secret;
    const keyBytes = Uint8Array.from(atob(keyB64), (c) => c.charCodeAt(0));
    const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${body}`));
    const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
    // Header holds space-separated "v1,<base64>" entries; any match passes.
    return signature.split(" ").some((part) => {
      const [version, sig] = part.split(",");
      return version === "v1" && sig === expected;
    });
  } catch {
    return false;
  }
}

export const Route = createFileRoute("/api/public/resend/webhook")({
  server: {
    handlers: {
      GET: async () => Response.json({ error: "Method not allowed." }, { status: 405 }),
      POST: async ({ request }) => {
        const secret = process.env.RESEND_WEBHOOK_SECRET;
        if (!secret) {
          console.error("[resend-webhook] RESEND_WEBHOOK_SECRET is not configured; rejecting");
          return Response.json({ error: "Webhook not configured." }, { status: 500 });
        }

        const body = await request.text();
        const valid = await verifySignature(body, request.headers, secret);
        if (!valid) {
          return Response.json({ error: "Invalid signature." }, { status: 401 });
        }

        let event: {
          type?: string;
          data?: { email_id?: string; to?: string[] | string; bounce?: { message?: string }; reason?: string };
        };
        try {
          event = JSON.parse(body);
        } catch {
          return Response.json({ error: "Invalid payload." }, { status: 400 });
        }

        const state = event.type ? EVENT_STATE[event.type] : undefined;
        // Correlate ONLY on Resend's data.email_id (the id returned by the send call).
        const messageId = event.data?.email_id;
        if (!state || !messageId) {
          return Response.json({ ignored: true });
        }
        const to = event.data?.to;
        const recipient = Array.isArray(to) ? to[0] : to;
        const reason = event.data?.bounce?.message ?? event.data?.reason ?? null;

        // Atomic, order-independent update. If the app hasn't attached this id
        // yet, a placeholder is stored and merged in when the send finishes.
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin.rpc("email_delivery_event", {
          _resend_id: messageId,
          _state: state,
          _reason: (reason ? String(reason).slice(0, 500) : null) as unknown as string,
          _recipient: (recipient ?? null) as unknown as string,
        });
        if (error) {
          // Non-2xx so Resend retries; nothing is lost.
          console.error("[resend-webhook] failed to record event", event.type, error.message);
          return Response.json({ error: "Could not record event." }, { status: 500 });
        }
        return Response.json({ ok: true, correlation: data });
      },
    },
  },
});
