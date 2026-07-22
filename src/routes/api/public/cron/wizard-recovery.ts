import { createFileRoute } from "@tanstack/react-router";
import { sendWizardRecoveryEmail } from "@/lib/email.server";

export const Route = createFileRoute("/api/public/cron/wizard-recovery")({
  server: {
    handlers: {
      POST: async ({ request }) => handle(request),
      GET: async ({ request }) => handle(request),
    },
  },
});

async function handle(request: Request): Promise<Response> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // Verify bearer token stored in private.cron_tokens via SECURITY DEFINER RPC
  const authHeader = request.headers.get("authorization") || "";
  const provided = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const { data: expectedToken, error: tokenErr } = await supabaseAdmin.rpc("get_cron_token", {
    _name: "wizard-recovery",
  });
  if (tokenErr || !expectedToken) {
    return new Response("token config missing", { status: 500 });
  }
  if (!provided || provided !== expectedToken) {
    return new Response("unauthorized", { status: 401 });
  }

  const now = Date.now();
  const h24 = new Date(now - 24 * 3600 * 1000).toISOString();
  const h26 = new Date(now - 26 * 3600 * 1000).toISOString(); // window: leads created 24–26h ago (avoid backfilling ancient rows)
  const h72 = new Date(now - 72 * 3600 * 1000).toISOString();
  const h96 = new Date(now - 96 * 3600 * 1000).toISOString();

  const cols =
    "id, full_name, email, current_step, status, created_at, recovery_email_sent_24h, recovery_email_sent_72h";

  // 24h nudge: created between 26h and 24h ago, not sent yet, wizard not completed
  const { data: batch24 } = await supabaseAdmin
    .from("applications")
    .select(cols)
    .lt("created_at", h24)
    .gte("created_at", h26)
    .is("recovery_email_sent_24h", null)
    .not("email", "is", null)
    .neq("status", "approved")
    .neq("status", "rejected")
    .neq("status", "active");

  // 72h nudge: created between 96h and 72h ago, 24h nudge already sent, 72h not yet, still not finished
  const { data: batch72 } = await supabaseAdmin
    .from("applications")
    .select(cols)
    .lt("created_at", h72)
    .gte("created_at", h96)
    .not("recovery_email_sent_24h", "is", null)
    .is("recovery_email_sent_72h", null)
    .not("email", "is", null)
    .neq("status", "approved")
    .neq("status", "rejected")
    .neq("status", "active");

  let sent24 = 0;
  let sent72 = 0;

  for (const row of batch24 ?? []) {
    // Skip rows that already finished the wizard (confirmation is step >= 5)
    if (isWizardComplete(row.current_step, row.status)) continue;
    try {
      await sendWizardRecoveryEmail({
        to: row.email as string,
        firstName: row.full_name as string | null,
        applicationId: row.id as string,
        variant: "24h",
      });
      await supabaseAdmin
        .from("applications")
        .update({ recovery_email_sent_24h: new Date().toISOString() })
        .eq("id", row.id);
      sent24++;
    } catch (err) {
      console.error("[wizard-recovery] 24h send failed", row.id, err);
    }
  }

  for (const row of batch72 ?? []) {
    if (isWizardComplete(row.current_step, row.status)) continue;
    try {
      await sendWizardRecoveryEmail({
        to: row.email as string,
        firstName: row.full_name as string | null,
        applicationId: row.id as string,
        variant: "72h",
      });
      await supabaseAdmin
        .from("applications")
        .update({ recovery_email_sent_72h: new Date().toISOString() })
        .eq("id", row.id);
      sent72++;
    } catch (err) {
      console.error("[wizard-recovery] 72h send failed", row.id, err);
    }
  }

  return Response.json({
    ok: true,
    considered_24h: batch24?.length ?? 0,
    considered_72h: batch72?.length ?? 0,
    sent_24h: sent24,
    sent_72h: sent72,
  });
}

function isWizardComplete(step: unknown, status: unknown): boolean {
  const s = typeof step === "string" ? step.toLowerCase() : "";
  const st = typeof status === "string" ? status.toLowerCase() : "";
  if (st === "complete" || st === "completed" || st === "submitted") return true;
  if (s === "confirmation" || s === "complete" || s === "done") return true;
  return false;
}