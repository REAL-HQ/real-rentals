// Renter lifecycle notices.
//
// Staff already write the message in Automations (automation_steps subject/body).
// This module only enrolls the renter after a rental or incident write commits.
// runDueAutomations renders those steps with renderTemplate and delivers them
// through sendSms / sendEmail. SMS still stops on sms_opt_outs, applications.sms_consent,
// and applications.sms_opt_out_at. There is no separate email opt-out column.
//
// RENTER_LIFECYCLE_NOTICES_ENABLED must be the exact string "true". Any other
// value, including unset, returns before a workflow read or a send. The caller
// also checks the flag so the module is not even loaded while it is off.
// Enrollment failures are swallowed here: a notice can never fail the rental write.

import type { TriggerEvent } from "@/lib/automations.server";

export type RenterLifecycleEvent = Extract<
  TriggerEvent,
  "rental_started" | "rental_ended" | "incident_logged"
>;

export type LifecycleNoticeResult = {
  enrolled: number;
  skipped: "flag" | "not_fresh" | "no_renter" | "error" | null;
};

type EnrollArgs = {
  trigger: RenterLifecycleEvent;
  applicationId: string | null;
  rentalId: string | null;
};

export type LifecycleNoticeDeps = {
  enroll?: (args: EnrollArgs) => Promise<{ enrolled: number }>;
  loadApplicationId?: (rentalId: string) => Promise<string | null>;
};

export function renterLifecycleNoticesEnabled(): boolean {
  return process.env.RENTER_LIFECYCLE_NOTICES_ENABLED === "true";
}

async function defaultEnroll(args: EnrollArgs): Promise<{ enrolled: number }> {
  const { enrollInWorkflows } = await import("@/lib/automations.server");
  return enrollInWorkflows({
    trigger: args.trigger,
    applicationId: args.applicationId,
    rentalId: args.rentalId,
  });
}

async function defaultLoadApplicationId(rentalId: string): Promise<string | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("rentals")
    .select("application_id")
    .eq("id", rentalId)
    .maybeSingle();
  return (data?.application_id as string | null) ?? null;
}

/**
 * Enroll active workflows for one lifecycle event. Safe to await: it does not throw.
 * `fresh: false` covers incident edits and rentals that were already closed.
 * An incident with no rental is not the renter's rental, so it does not enroll.
 */
export async function enrollRenterLifecycleNotice(
  input: {
    event: RenterLifecycleEvent;
    applicationId?: string | null;
    rentalId?: string | null;
    fresh?: boolean;
  },
  deps?: LifecycleNoticeDeps,
): Promise<LifecycleNoticeResult> {
  if (!renterLifecycleNoticesEnabled()) return { enrolled: 0, skipped: "flag" };
  if (input.fresh === false) return { enrolled: 0, skipped: "not_fresh" };

  const rentalId = input.rentalId ?? null;
  // Started, ended, and incident notices all name a rental. An incident with
  // no rental is not on the renter's rental, so it does not enroll.
  if (!rentalId) return { enrolled: 0, skipped: "no_renter" };

  try {
    let applicationId = input.applicationId ?? null;
    if (!applicationId) {
      const load = deps?.loadApplicationId ?? defaultLoadApplicationId;
      applicationId = await load(rentalId);
    }
    if (!applicationId) return { enrolled: 0, skipped: "no_renter" };

    const enroll = deps?.enroll ?? defaultEnroll;
    const { enrolled } = await enroll({
      trigger: input.event,
      applicationId,
      rentalId,
    });
    return { enrolled, skipped: null };
  } catch (err) {
    console.error("[renter-lifecycle] enroll failed", input.event, err);
    return { enrolled: 0, skipped: "error" };
  }
}
