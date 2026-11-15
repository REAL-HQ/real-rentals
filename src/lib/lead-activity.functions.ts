import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireStaff } from "@/lib/roles.server";

export type LeadActivityRow = {
  occurred_at: string;
  activity_type: "text" | "call" | "voicemail" | "transcript" | "recording" | "call_summary" | "email" | "status_change";
  direction: string | null;
  summary: string | null;
  status: string | null;
  template: string | null;
  line_e164: string | null;
  phone_number_id: string | null;
  line_label: string | null;
  recording_url: string | null;
  source_table: string;
  source_id: string;
};

/** Texts, calls, voicemails, transcripts, emails and stage changes for one lead, newest first. */
export const getLeadActivity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ applicationId: z.string().uuid(), limit: z.number().int().min(1).max(500).optional() }).parse(d))
  .handler(async ({ data, context }): Promise<{ rows: LeadActivityRow[]; error: string | null }> => {
    await requireStaff(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await (supabaseAdmin as any)
      .from("lead_activity")
      .select("*")
      .eq("application_id", data.applicationId)
      .order("occurred_at", { ascending: false })
      .limit(data.limit ?? 200);
    if (error) {
      console.error("[lead-activity] read failed", error.message);
      return { rows: [], error: "Activity isn't available yet." };
    }
    return { rows: (rows ?? []) as LeadActivityRow[], error: null };
  });
