import { createFileRoute } from "@tanstack/react-router";

// Email-to-Evidence intake webhook (Resend inbound, event `email.received`).
// Fail closed: no RESEND_INBOUND_WEBHOOK_SECRET → every request is refused.
// Unsigned or invalid signatures are rejected before the body is parsed.
// Email content is stored as data only; nothing in it is ever executed.
export const Route = createFileRoute("/api/public/inbound/email")({
  server: {
    handlers: {
      GET: async () => Response.json({ error: "Method not allowed." }, { status: 405 }),
      POST: async ({ request }) => {
        const secret = process.env.RESEND_INBOUND_WEBHOOK_SECRET;
        if (!secret) {
          console.error("[inbound-email] RESEND_INBOUND_WEBHOOK_SECRET not configured; rejecting");
          return Response.json({ error: "Intake not configured." }, { status: 500 });
        }
        const body = await request.text();
        if (body.length > 1_000_000) return Response.json({ error: "Too large." }, { status: 413 });
        const { verifySvix, ingestResendEmail } = await import("@/lib/inbound-email.server");
        if (!(await verifySvix(body, request.headers, secret))) {
          return Response.json({ error: "Invalid signature." }, { status: 401 });
        }
        let evt: any;
        try { evt = JSON.parse(body); } catch { return Response.json({ error: "Bad payload." }, { status: 400 }); }
        if (evt?.type !== "email.received") return Response.json({ ok: true, ignored: true });
        try {
          const r = await ingestResendEmail(request.headers.get("svix-id"), evt.data);
          return Response.json({ ok: true, status: r.status });
        } catch (e) {
          console.error("[inbound-email] ingest failed", String(e).slice(0, 200));
          return Response.json({ error: "Ingest failed." }, { status: 500 }); // provider retries; ingest is idempotent
        }
      },
    },
  },
});
