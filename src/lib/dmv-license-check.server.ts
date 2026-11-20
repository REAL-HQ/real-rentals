/**
 * State DMV license check: reads, the gate every approval / agreement send /
 * Reservation Fee link runs, and the staff log. See src/lib/dmv-license-check.ts.
 *
 * Enforced only once the license_dmv_checks migration is installed (then every
 * path below fails CLOSED on an unexpected error). Until then nothing is
 * enforced, so the code can ship before the migration is applied.
 */
import {
  DMV_NEEDS_STAFF_CODE,
  DMV_NEEDS_STAFF_PREFIX,
  evaluateDmvGate,
  dmvLogBlockers,
  dmvStatusLabel,
  normalizeLicenseState,
  type DmvCheck,
  type DmvCheckStatus,
  type DmvGate,
} from "@/lib/dmv-license-check";

const COLUMNS = "id,status,license_state,checked_at,checked_by_label,note,screenshot_path";

export const DMV_CHECK_UNAVAILABLE = "Could Not Check The State DMV Record. Try Again.";

function notInstalled(err: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!err) return false;
  const code = String(err.code ?? "");
  if (code === "42P01" || code === "PGRST205") return true;
  return /license_dmv_checks/.test(String(err.message ?? "")) && /does not exist|schema cache|could not find/i.test(String(err.message ?? ""));
}

export function toDmvCheck(r: any): DmvCheck {
  return {
    id: String(r.id),
    status: r.status as DmvCheckStatus,
    licenseState: String(r.license_state ?? ""),
    checkedAt: String(r.checked_at),
    checkedByLabel: String(r.checked_by_label ?? ""),
    note: r.note ?? null,
    screenshotPath: r.screenshot_path ?? null,
  };
}

/** Newest first. installed=false when the migration is not applied. */
export async function listDmvChecks(admin: any, applicationId: string, limit = 10): Promise<{ installed: boolean; checks: DmvCheck[] }> {
  if (!admin || typeof admin.from !== "function") return { installed: false, checks: [] };
  const res = await admin.from("license_dmv_checks").select(COLUMNS).eq("application_id", applicationId).order("checked_at", { ascending: false }).limit(limit);
  if (res.error) {
    if (notInstalled(res.error)) return { installed: false, checks: [] };
    throw new Error(DMV_CHECK_UNAVAILABLE);
  }
  return { installed: true, checks: ((res.data ?? []) as any[]).map(toDmvCheck) };
}

export type DmvCheckResult = { installed: boolean; gate: DmvGate | null; message: string | null };

/**
 * The pre-check. message is the staff-facing refusal, null when allowed (or
 * when the migration is not installed yet). Throws only on a read error, which
 * callers treat as a refusal (fail closed).
 */
export async function checkDmvLicense(admin: any, applicationId: string, now: number = Date.now()): Promise<DmvCheckResult> {
  const { installed, checks } = await listDmvChecks(admin, applicationId, 1);
  if (!installed) return { installed: false, gate: null, message: null };
  const app = await admin.from("applications").select("license_state").eq("id", applicationId).maybeSingle();
  if (app.error) throw new Error(DMV_CHECK_UNAVAILABLE);
  const gate = evaluateDmvGate(checks[0] ?? null, app.data?.license_state ?? null, now);
  return { installed: true, gate, message: gate.ok ? null : gate.message };
}

/** Refusal sentence for a caller that returns instead of throwing. Errors become a refusal. */
export async function dmvRefusal(admin: any, applicationId: string, now?: number): Promise<string | null> {
  try {
    return (await checkDmvLicense(admin, applicationId, now)).message;
  } catch (e) {
    return e instanceof Error ? e.message : DMV_CHECK_UNAVAILABLE;
  }
}

type Actor = { userId: string; email: string | null; role?: string; tier?: string };
type AuditFn = (actor: any, entry: { action: string; summary: string; entityType?: string; entityId?: string; metadata?: Record<string, unknown> }) => Promise<void>;

/** One open Needs Staff flag per person (unique index): add the DMV code to it, or open one. */
export async function routeDmvToNeedsStaff(admin: any, applicationId: string, check: DmvCheck): Promise<"opened" | "extended"> {
  const why = `${DMV_NEEDS_STAFF_PREFIX}: ${dmvStatusLabel(check.status)} (${check.licenseState}). No agreement, no Reservation Fee link.`;
  const open = await admin.from("fleet_review_decisions").select("id,reason,escalation_codes").eq("application_id", applicationId).eq("decision", "needs_staff").is("resolved_at", null).limit(1);
  if (open.error) throw new Error("Saved The Check, But Could Not Read Needs Staff Flags. Flag This Driver By Hand.");
  const existing = (open.data ?? [])[0];
  const assessment = { dmv_check: { status: check.status, license_state: check.licenseState, checked_at: check.checkedAt } };
  if (existing) {
    const codes = Array.from(new Set([...(Array.isArray(existing.escalation_codes) ? existing.escalation_codes.map(String) : []), DMV_NEEDS_STAFF_CODE]));
    const up = await admin.from("fleet_review_decisions").update({ escalation_codes: codes, reason: `${why}; ${existing.reason ?? ""}`.slice(0, 1000) }).eq("id", existing.id).is("resolved_at", null).select("id");
    if (up.error || !(up.data ?? []).length) throw new Error("Saved The Check, But Could Not Flag Needs Staff. Flag This Driver By Hand.");
    return "extended";
  }
  const ins = await admin.from("fleet_review_decisions").insert({
    application_id: applicationId,
    decision: "needs_staff",
    reason: why.slice(0, 1000),
    escalation_codes: [DMV_NEEDS_STAFF_CODE],
    assessment,
    decided_by: "State DMV Check (staff log)",
  }).select("id").maybeSingle();
  if (ins.error) throw new Error("Saved The Check, But Could Not Flag Needs Staff. Flag This Driver By Hand.");
  return "opened";
}

export type LogDmvInput = { applicationId: string; status: string; licenseState: string; note: string };

/**
 * Staff log a check. checked_at is always the server's clock (no backdating).
 * Any result other than Valid is routed to Needs Staff and audited so Dolmar is
 * flagged. Sends nothing to anyone.
 */
export async function logDmvCheck(
  admin: any,
  actor: Actor,
  input: LogDmvInput,
  audit: AuditFn,
  now: () => Date = () => new Date(),
): Promise<{ check: DmvCheck; routed: "opened" | "extended" | null }> {
  const blockers = dmvLogBlockers(input);
  if (blockers.length) throw new Error(blockers[0]);
  const state = normalizeLicenseState(input.licenseState)!;
  const app = await admin.from("applications").select("id,full_name,deleted_at").eq("id", input.applicationId).maybeSingle();
  if (app.error) throw new Error(app.error.message);
  if (!app.data || app.data.deleted_at) throw new Error("That Driver No Longer Exists.");
  const label = actor.email ?? actor.userId;
  const ins = await admin
    .from("license_dmv_checks")
    .insert({
      application_id: input.applicationId,
      status: input.status,
      license_state: state,
      checked_at: now().toISOString(),
      checked_by: actor.userId,
      checked_by_label: label,
      note: input.note.trim(),
    })
    .select(COLUMNS)
    .single();
  if (ins.error) {
    throw new Error(notInstalled(ins.error) ? "State DMV Checks Are Not Enabled On This Database Yet. Apply The license_dmv_checks Migration, Then Try Again." : ins.error.message);
  }
  const check = toDmvCheck(ins.data);
  let routed: "opened" | "extended" | null = null;
  await audit(actor, {
    action: "application.dmv_license_checked",
    summary: `State DMV license check for ${app.data.full_name ?? input.applicationId}: ${dmvStatusLabel(check.status)} (${state})`,
    entityType: "application",
    entityId: input.applicationId,
    metadata: { check_id: check.id, status: check.status, license_state: state, flag_dolmar: check.status !== "valid" },
  });
  if (check.status !== "valid") routed = await routeDmvToNeedsStaff(admin, input.applicationId, check);
  return { check, routed };
}
