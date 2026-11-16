/**
 * FLEET lifecycle check-offs.
 *
 * The Driver Lifecycle rail is derived from real records (driver-lifecycle.ts):
 * an approval is the application status, an agreement is a signed agreement,
 * a reservation is a reserved rental. FLEET never writes a checkmark. What
 * this module adds is the trail: when one of FLEET's own actions completes a
 * stage, an audit_log row says so ("Checked off by FLEET (automated)"), and
 * the profile shows "By FLEET" under that stage.
 *
 * The only column written here is applications.contacted_at, and only when it
 * is blank and FLEET has just had a real exchange with the applicant (a YES
 * text or call that confirmed terms, or a booked pickup it texted about).
 *
 * Insurance, inspection, pickup and Active can never be recorded by FLEET:
 * insurance needs a person (bound and verified by staff), and inspection,
 * pickup and Active come only from the field rep and the rental transaction.
 */
import { FLEET_ACTOR_LABEL } from "@/lib/fleet-review";
import type { FleetDeps } from "@/lib/fleet-api.server";
import type { DriverLifecycleKey } from "@/lib/driver-lifecycle";

export const LIFECYCLE_STEP_ACTION = "application.lifecycle_step";

/** Stages a FLEET action may record. Anything else throws. */
export const FLEET_RECORDABLE_STEPS = ["contacted", "approved", "agreement", "reserved"] as const;
export type FleetRecordableStep = (typeof FLEET_RECORDABLE_STEPS)[number];
/** Never recordable by FLEET, whatever the caller passes. */
export const FLEET_FORBIDDEN_STEPS: readonly DriverLifecycleKey[] = ["insurance", "inspection", "pickup", "active", "screening", "documents", "applied"];

const STEP_LABEL: Record<FleetRecordableStep, string> = {
  contacted: "Contacted",
  approved: "Approved",
  agreement: "Agreement Sent",
  reserved: "Reserved",
};

type Audit = NonNullable<FleetDeps["audit"]>;

export function lifecycleStepEntry(input: { applicationId: string; step: FleetRecordableStep; evidence: string; source: string; at: Date; extra?: Record<string, unknown> }) {
  if (!(FLEET_RECORDABLE_STEPS as readonly string[]).includes(input.step) || FLEET_FORBIDDEN_STEPS.includes(input.step as DriverLifecycleKey)) {
    throw new Error(`FLEET cannot record the ${String(input.step)} step.`);
  }
  return {
    action: LIFECYCLE_STEP_ACTION,
    summary: `${STEP_LABEL[input.step]} checked off by ${FLEET_ACTOR_LABEL}: ${input.evidence}`.slice(0, 300),
    entityType: "application",
    entityId: input.applicationId,
    metadata: {
      step: input.step,
      by: FLEET_ACTOR_LABEL,
      evidence: input.evidence.slice(0, 300),
      source: input.source,
      at: input.at.toISOString(),
      ...(input.extra ?? {}),
    },
  };
}

/** Audit one FLEET-completed stage. Never throws: logging must not break the action. */
export async function recordFleetLifecycleStep(audit: Audit, input: Parameters<typeof lifecycleStepEntry>[0]): Promise<void> {
  let entry: ReturnType<typeof lifecycleStepEntry>;
  try { entry = lifecycleStepEntry(input); } catch (e) { console.error("[fleet-lifecycle]", (e as Error).message); return; }
  await audit(entry).catch((e: unknown) => console.error("[fleet-lifecycle] audit failed", String((e as Error)?.message ?? e)));
}

/**
 * Stamp contacted_at when it is blank, after a real two-way exchange FLEET
 * just handled. Conditional on contacted_at IS NULL so a staff date is never
 * moved. Returns true when this call set it.
 */
export async function stampContactedByFleet(admin: any, audit: Audit, input: { applicationId: string; evidence: string; source: string; at: Date }): Promise<boolean> {
  try {
    const res = await admin.from("applications").update({ contacted_at: input.at.toISOString() }).eq("id", input.applicationId).is("contacted_at", null).select("id");
    if (res?.error || !Array.isArray(res?.data) || res.data.length === 0) return false;
  } catch {
    return false;
  }
  await recordFleetLifecycleStep(audit, { applicationId: input.applicationId, step: "contacted", evidence: input.evidence, source: input.source, at: input.at });
  return true;
}

/** Rows for the profile: FLEET lifecycle marks on one application, newest first. */
export async function readFleetLifecycleMarks(admin: any, applicationId: string): Promise<{ step: FleetRecordableStep; at: string; summary: string }[]> {
  const res = await admin.from("audit_log").select("created_at,summary,metadata")
    .eq("entity_type", "application").eq("entity_id", applicationId).eq("action", LIFECYCLE_STEP_ACTION)
    .order("created_at", { ascending: false }).limit(50);
  if (res?.error) return [];
  const out: { step: FleetRecordableStep; at: string; summary: string }[] = [];
  for (const r of (res?.data ?? []) as any[]) {
    const step = String(r?.metadata?.step ?? "");
    if (!(FLEET_RECORDABLE_STEPS as readonly string[]).includes(step)) continue;
    if (String(r?.metadata?.by ?? "") !== FLEET_ACTOR_LABEL) continue;
    out.push({ step: step as FleetRecordableStep, at: String(r.created_at ?? ""), summary: String(r.summary ?? "") });
  }
  return out;
}
