import { createFileRoute } from "@tanstack/react-router";
import {
  sendEmail,
  sendPastDueReminderEmail,
  sendLicenseExpiringEmail,
  sendServiceDigestEmail,
} from "@/lib/email.server";
import { runOpsReminders } from "@/lib/ops-reminders.server";

export const Route = createFileRoute("/api/public/cron/ops-reminders")({
  server: {
    handlers: {
      POST: async ({ request }) => handle(request),
      GET: async ({ request }) => handle(request),
    },
  },
});

async function handle(request: Request): Promise<Response> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const authHeader = request.headers.get("authorization") || "";
  const provided = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const { data: expectedToken, error: tokenErr } = await supabaseAdmin.rpc("get_cron_token", {
    _name: "ops-reminders",
  });
  if (tokenErr || !expectedToken) return new Response("token config missing", { status: 500 });
  if (!provided || provided !== expectedToken) return new Response("unauthorized", { status: 401 });

  // Eligibility (unchanged), claim-before-send (no double emails from overlapping
  // runs), the 10-per-run / 10-per-24h driver cap and once-a-day digests live in
  // runOpsReminders, where they are unit-tested.
  const report = await runOpsReminders(supabaseAdmin, {
    sendEmail,
    sendPastDueReminderEmail,
    sendLicenseExpiringEmail,
    sendServiceDigestEmail,
  });
  return Response.json(report);
}
