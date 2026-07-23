import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const DOC_LABELS: Record<string, string> = {
  license: "Driver's License Photo",
  gig_screenshot: "Gig Driving Profile Screenshot (Uber, Lyft, DoorDash, Instacart, etc.)",
  insurance: "Insurance Information",
  other: "Additional Info",
};

const Input = z.object({
  applicationId: z.string().uuid(),
  items: z.array(z.enum(["license", "gig_screenshot", "insurance", "other"])).min(1).max(4),
  note: z.string().trim().max(500).optional().nullable(),
});

export const requestApplicationDocuments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data, context }) => {
    const { data: adminRow } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();
    if (!adminRow) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: app, error } = await supabaseAdmin
      .from("applications")
      .select("id, email, full_name, doc_request_sent_at")
      .eq("id", data.applicationId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!app) throw new Error("Application not found");
    if (!app.email) throw new Error("Applicant has no email on file");

    // Rate limit: allow re-send after 24h
    if (app.doc_request_sent_at) {
      const last = new Date(app.doc_request_sent_at as string).getTime();
      if (Date.now() - last < 24 * 3600 * 1000) {
        throw new Error("Documents already requested within the last 24 hours");
      }
    }

    const labels = data.items.map((k) => DOC_LABELS[k]);
    const note = data.note?.trim() || null;

    try {
      const { sendDocumentRequestEmail } = await import("@/lib/email.server");
      await sendDocumentRequestEmail({
        to: app.email as string,
        firstName: (app.full_name as string | null) ?? null,
        applicationId: app.id as string,
        items: labels,
        note,
      });
    } catch (e) {
      console.error("[doc-request] email send failed", e);
      throw new Error("Failed to send document request email");
    }

    const sentAt = new Date().toISOString();
    const { error: updErr } = await supabaseAdmin
      .from("applications")
      .update({
        doc_request_sent_at: sentAt,
        requested_docs: data.items,
        doc_request_note: note,
      })
      .eq("id", data.applicationId);
    if (updErr) console.error("[doc-request] stamp failed", updErr);

    return { ok: true, sent_at: sentAt, items: data.items };
  });
