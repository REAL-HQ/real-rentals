// Server-only automation engine.
//
// Workflows are "trigger -> ordered steps, each with a delay measured from the
// moment of enrollment". A trigger enrolls a record once; a cron sweep then
// sends whatever step has come due. Keeping the delay relative to enrollment
// (rather than to the previous step) means a late cron run never compounds the
// drift across a 3-step sequence.
//
// Two guards keep an applicant from being spammed:
//   * a unique index makes a second enrollment in the same workflow impossible
//   * a unique index on (enrollment_id, step_id) in outbound_messages means a
//     step can only ever be sent once, even if two cron runs overlap
// Both live in the database rather than in this file, so they hold regardless
// of which code path does the sending.

import { sendSms, renderTemplate, toE164 } from "@/lib/sms.server";

export type TriggerEvent =
  | "application_submitted"
  | "application_abandoned"
  | "application_approved"
  | "rental_started"
  | "payment_past_due";

/** Business timezone used for quiet-hours math. */
const BUSINESS_TZ = "America/New_York";

/** Local hour (0-23) in the business timezone for a given instant. */
export function localHour(at: Date, timeZone: string = BUSINESS_TZ): number {
  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    hour12: false,
  }).format(at);
  // Intl renders midnight as "24" in some runtimes; normalise it.
  return Number(hour) % 24;
}

/**
 * Is `at` inside the workflow's quiet hours? Handles windows that wrap
 * midnight (the common case: 21:00 -> 08:00).
 */
export function isQuietHour(
  at: Date,
  start: number,
  end: number,
  timeZone: string = BUSINESS_TZ,
): boolean {
  if (start === end) return false; // no quiet window configured
  const h = localHour(at, timeZone);
  return start > end ? h >= start || h < end : h >= start && h < end;
}

/**
 * Push a send time forward to the first moment outside quiet hours. Steps
 * forward an hour at a time (at most a day) rather than doing timezone
 * arithmetic by hand, which is where DST bugs come from.
 */
export function nextSendableTime(
  from: Date,
  start: number,
  end: number,
  timeZone: string = BUSINESS_TZ,
): Date {
  if (!isQuietHour(from, start, end, timeZone)) return from;
  const cursor = new Date(from.getTime());
  for (let i = 0; i < 26; i++) {
    cursor.setTime(cursor.getTime() + 60 * 60 * 1000);
    if (!isQuietHour(cursor, start, end, timeZone)) {
      // Land on the top of the hour so sends look deliberate, not jittery.
      cursor.setUTCMinutes(0, 0, 0);
      return cursor;
    }
  }
  return cursor;
}

type EnrollArgs = {
  trigger: TriggerEvent;
  applicationId?: string | null;
  rentalId?: string | null;
};

/**
 * Enroll a record in every active workflow listening for `trigger`.
 * Safe to call more than once: duplicate enrollments are rejected by a unique
 * index and swallowed here.
 */
export async function enrollInWorkflows(args: EnrollArgs): Promise<{ enrolled: number }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: workflows } = await supabaseAdmin
    .from("automation_workflows")
    .select("id,quiet_hours_start,quiet_hours_end")
    .eq("trigger_event", args.trigger)
    .eq("is_active", true);

  if (!workflows?.length) return { enrolled: 0 };

  let enrolled = 0;
  for (const w of workflows) {
    // First step decides when this enrollment first comes due.
    const { data: firstStep } = await supabaseAdmin
      .from("automation_steps")
      .select("delay_minutes")
      .eq("workflow_id", w.id)
      .eq("is_active", true)
      .order("step_order", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!firstStep) continue;

    const now = new Date();
    const due = new Date(now.getTime() + Number(firstStep.delay_minutes ?? 0) * 60_000);
    const sendable = nextSendableTime(due, w.quiet_hours_start, w.quiet_hours_end);

    const { error } = await supabaseAdmin.from("automation_enrollments").insert({
      workflow_id: w.id,
      application_id: args.applicationId ?? null,
      rental_id: args.rentalId ?? null,
      status: "active",
      current_step: 0,
      enrolled_at: now.toISOString(),
      next_run_at: sendable.toISOString(),
    });

    if (error) {
      // Expected when the same trigger fires twice for one applicant.
      if (!String(error.message).includes("duplicate key")) {
        console.error("[automations] enroll failed", error.message);
      }
      continue;
    }
    enrolled++;
  }
  return { enrolled };
}

export type SweepResult = {
  processed: number;
  sent: number;
  skipped: number;
  cancelled: number;
  completed: number;
  errors: number;
};

/**
 * Send every automation step that has come due. Called by the cron route.
 */
export async function runDueAutomations(limit = 100): Promise<SweepResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { sendEmail } = await import("@/lib/email.server");

  const result: SweepResult = {
    processed: 0,
    sent: 0,
    skipped: 0,
    cancelled: 0,
    completed: 0,
    errors: 0,
  };
  const now = new Date();

  const { data: due } = await supabaseAdmin
    .from("automation_enrollments")
    .select("id,workflow_id,application_id,rental_id,current_step,enrolled_at,next_run_at")
    .eq("status", "active")
    .not("next_run_at", "is", null)
    .lte("next_run_at", now.toISOString())
    .order("next_run_at", { ascending: true })
    .limit(limit);

  for (const enrollment of due ?? []) {
    result.processed++;
    try {
      const { data: workflow } = await supabaseAdmin
        .from("automation_workflows")
        .select("id,name,is_active,quiet_hours_start,quiet_hours_end,stop_on_statuses")
        .eq("id", enrollment.workflow_id)
        .maybeSingle();

      // A workflow switched off mid-sequence stops sending immediately.
      if (!workflow || !workflow.is_active) {
        await cancel(supabaseAdmin, enrollment.id, "workflow inactive");
        result.cancelled++;
        continue;
      }

      const { data: app } = enrollment.application_id
        ? await supabaseAdmin
            .from("applications")
            .select("id,full_name,email,phone,city,status,sms_consent,sms_opt_out_at")
            .eq("id", enrollment.application_id)
            .maybeSingle()
        : { data: null };

      // The applicant converted (or was rejected) — stop nudging them.
      const stopStatuses = (workflow.stop_on_statuses ?? []) as string[];
      if (app?.status && stopStatuses.includes(app.status)) {
        await cancel(supabaseAdmin, enrollment.id, `status became ${app.status}`);
        result.cancelled++;
        continue;
      }
      if (app?.sms_opt_out_at) {
        await cancel(supabaseAdmin, enrollment.id, "recipient opted out");
        result.cancelled++;
        continue;
      }

      const { data: step } = await supabaseAdmin
        .from("automation_steps")
        .select("id,step_order,delay_minutes,channel,subject,body")
        .eq("workflow_id", workflow.id)
        .eq("is_active", true)
        .gt("step_order", enrollment.current_step)
        .order("step_order", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (!step) {
        await complete(supabaseAdmin, enrollment.id);
        result.completed++;
        continue;
      }

      // Respect quiet hours: reschedule rather than text someone at 3am.
      if (isQuietHour(now, workflow.quiet_hours_start, workflow.quiet_hours_end)) {
        const retry = nextSendableTime(now, workflow.quiet_hours_start, workflow.quiet_hours_end);
        await supabaseAdmin
          .from("automation_enrollments")
          .update({ next_run_at: retry.toISOString() })
          .eq("id", enrollment.id);
        result.skipped++;
        continue;
      }

      const firstName = (app?.full_name ?? "").trim().split(/\s+/)[0] || "there";
      const vars = {
        first_name: firstName,
        full_name: app?.full_name ?? "",
        city: app?.city ?? "your area",
        phone: app?.phone ?? "",
        email: app?.email ?? "",
      };
      const body = renderTemplate(step.body, vars);

      if (step.channel === "sms") {
        if (!app?.phone || !toE164(app.phone)) {
          result.skipped++;
        } else {
          const sent = await sendSms({
            to: app.phone,
            body,
            kind: "automation",
            applicationId: enrollment.application_id,
            rentalId: enrollment.rental_id,
            workflowId: workflow.id,
            enrollmentId: enrollment.id,
            stepId: step.id,
          });
          if (sent.ok) result.sent++;
          else result.skipped++;
        }
      } else {
        if (!app?.email) {
          result.skipped++;
        } else {
          const subject = renderTemplate(step.subject || "A quick update from REAL RENTALS", vars);
          await sendEmail({
            to: app.email,
            subject,
            html: `<div style="font-family:Arial,Helvetica,sans-serif;padding:24px;max-width:560px;color:#111">
              <p style="font-size:15px;line-height:1.6;white-space:pre-wrap">${escapeHtml(body)}</p>
              <p style="color:#888;font-size:12px;margin-top:24px">REAL RENTALS · Reply to this email and our team will pick it up.</p>
            </div>`,
            replyTo: "team@drivereal.com",
          });
          await supabaseAdmin.from("outbound_messages").insert({
            channel: "email",
            to_address: app.email,
            subject,
            body,
            status: "sent",
            provider: "resend",
            kind: "automation",
            application_id: enrollment.application_id,
            rental_id: enrollment.rental_id,
            workflow_id: workflow.id,
            enrollment_id: enrollment.id,
            step_id: step.id,
            sent_at: new Date().toISOString(),
          });
          result.sent++;
        }
      }

      // Queue the following step, or finish the sequence.
      const { data: nextStep } = await supabaseAdmin
        .from("automation_steps")
        .select("delay_minutes")
        .eq("workflow_id", workflow.id)
        .eq("is_active", true)
        .gt("step_order", step.step_order)
        .order("step_order", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (!nextStep) {
        await supabaseAdmin
          .from("automation_enrollments")
          .update({
            current_step: step.step_order,
            status: "completed",
            next_run_at: null,
            completed_at: new Date().toISOString(),
          })
          .eq("id", enrollment.id);
        result.completed++;
      } else {
        const base = new Date(enrollment.enrolled_at as string).getTime();
        const nextDue = new Date(base + Number(nextStep.delay_minutes ?? 0) * 60_000);
        // A step whose delay has already elapsed should fire on the next sweep,
        // not be treated as overdue-forever.
        const notBefore = nextDue.getTime() < now.getTime() ? now : nextDue;
        const sendable = nextSendableTime(
          notBefore,
          workflow.quiet_hours_start,
          workflow.quiet_hours_end,
        );
        await supabaseAdmin
          .from("automation_enrollments")
          .update({ current_step: step.step_order, next_run_at: sendable.toISOString() })
          .eq("id", enrollment.id);
      }
    } catch (err) {
      result.errors++;
      console.error("[automations] enrollment failed", enrollment.id, err);
    }
  }

  return result;
}

async function cancel(admin: any, id: string, reason: string): Promise<void> {
  await admin
    .from("automation_enrollments")
    .update({ status: "cancelled", cancelled_reason: reason, next_run_at: null })
    .eq("id", id);
}

async function complete(admin: any, id: string): Promise<void> {
  await admin
    .from("automation_enrollments")
    .update({ status: "completed", next_run_at: null, completed_at: new Date().toISOString() })
    .eq("id", id);
}

function escapeHtml(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
