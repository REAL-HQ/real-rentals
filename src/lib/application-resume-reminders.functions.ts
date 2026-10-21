import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { APPLICATION_RESUME_REMINDERS_ENABLED } from "@/lib/application-resume-reminders-flag";
import {
  RESUME_REMINDER_READ_CAP,
  buildResumeReminders,
  type ResumeReminderList,
  type ResumeReminderSource,
} from "@/lib/application-resume-reminders";

/** Refuses before auth. The handler takes no client input and sends nothing. */
const resumeReminderGate = createMiddleware({ type: "function" }).server(async ({ next }) => {
  if (APPLICATION_RESUME_REMINDERS_ENABLED !== true) throw new Error("Application resume reminders are not enabled.");
  return next();
});

export const getApplicationResumeReminders = createServerFn({ method: "GET" })
  .middleware([resumeReminderGate, requireSupabaseAuth])
  .handler(async ({ context }): Promise<ResumeReminderList> => {
    if (APPLICATION_RESUME_REMINDERS_ENABLED !== true) throw new Error("Application resume reminders are not enabled.");
    const { requireStaff } = await import("@/lib/roles.server");
    await requireStaff(context.userId);

    const page = await context.supabase
      .from("applications")
      .select("id,full_name,status,updated_at,contact_status,contact_status_at")
      .eq("status", "partial")
      .is("deleted_at", null)
      .order("updated_at", { ascending: true, nullsFirst: true })
      .order("id", { ascending: true })
      .limit(RESUME_REMINDER_READ_CAP + 1);
    if (page.error) throw new Error("Application resume reminders could not be loaded.");

    const raw = (page.data ?? []) as ResumeReminderSource[];
    const truncated = raw.length > RESUME_REMINDER_READ_CAP;
    return buildResumeReminders({
      now: new Date(),
      applications: truncated ? raw.slice(0, RESUME_REMINDER_READ_CAP) : raw,
      truncated,
    });
  });
