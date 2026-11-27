// Server side of the internal DNC List. Every write goes through here with the
// service role, after the caller's role check in dnc.functions.ts, and is audited.
import {
  DNC_NOT_INSTALLED,
  DNC_PERSON_TYPE_LABELS,
  dncPersonType,
  dncReasonBlockers,
  normalizeDncEmail,
  normalizeDncPhone,
  uniqueNormalized,
  type DncEntry,
  type DncIndexEntry,
  type DncPersonType,
} from "@/lib/dnc";
import { TIER_RANK, type StaffTier } from "@/lib/roles";

export type DncActor = { userId: string; email: string | null; tier: StaffTier };
type Audit = (
  actor: any,
  entry: {
    action: string;
    summary: string;
    entityType?: string;
    entityId?: string;
    metadata?: Record<string, unknown>;
  },
) => Promise<void>;

const ENTRY_COLS =
  "id,application_id,waitlist_id,person_type,full_name,reason,added_by_label,created_at,removed_at,removed_by_label,removal_reason";
const INDEX_COLS = `${ENTRY_COLS},phones,emails`;

export function dncNotInstalled(
  err: { code?: string | null; message?: string | null } | null | undefined,
): boolean {
  if (!err) return false;
  const code = String(err.code ?? "");
  if (code === "42P01" || code === "PGRST205" || code === "PGRST202" || code === "42883")
    return true;
  return (
    /dnc_list|dnc_suppressed/.test(String(err.message ?? "")) &&
    /does not exist|schema cache|could not find/i.test(String(err.message ?? ""))
  );
}

export function dncActorLabel(actor: DncActor): string {
  const tier =
    actor.tier === "owner" ? "Owner" : actor.tier === "manager" ? "Manager" : "Coordinator";
  return actor.email ? `${actor.email} (${tier})` : tier;
}

export function toDncEntry(r: any): DncEntry {
  const type = String(r.person_type ?? "applicant") as DncPersonType;
  return {
    id: String(r.id),
    applicationId: r.application_id ?? null,
    waitlistId: r.waitlist_id ?? null,
    personType: type,
    personTypeLabel: DNC_PERSON_TYPE_LABELS[type] ?? "Applicant",
    fullName: r.full_name ?? null,
    reason: String(r.reason ?? ""),
    addedBy: String(r.added_by_label ?? ""),
    createdAt: r.created_at ?? null,
    removedAt: r.removed_at ?? null,
    removedBy: r.removed_by_label ?? null,
    removalReason: r.removal_reason ?? null,
  };
}

function toIndexEntry(r: any): DncIndexEntry {
  return {
    ...toDncEntry(r),
    phones: Array.isArray(r.phones) ? r.phones : [],
    emails: Array.isArray(r.emails) ? r.emails : [],
  };
}

/** Every entry (active first, newest first), for the DNC section. */
export async function listDncEntries(
  admin: any,
): Promise<{ installed: boolean; entries: DncEntry[] }> {
  const { data, error } = await admin
    .from("dnc_list")
    .select(ENTRY_COLS)
    .order("created_at", { ascending: false })
    .limit(2000);
  if (error) {
    if (dncNotInstalled(error)) return { installed: false, entries: [] };
    throw new Error(error.message);
  }
  const entries = ((data ?? []) as any[]).map(toDncEntry);
  entries.sort((a, b) => Number(!!a.removedAt) - Number(!!b.removedAt));
  return { installed: true, entries };
}

/** Active entries with their normalized phones / emails, so the browser can badge and warn everywhere. */
export async function listDncIndex(
  admin: any,
): Promise<{ installed: boolean; entries: DncIndexEntry[] }> {
  const { data, error } = await admin
    .from("dnc_list")
    .select(INDEX_COLS)
    .is("removed_at", null)
    .limit(5000);
  if (error) {
    if (dncNotInstalled(error)) return { installed: false, entries: [] };
    throw new Error(error.message);
  }
  return { installed: true, entries: ((data ?? []) as any[]).map(toIndexEntry) };
}

type Subject = {
  applicationId: string | null;
  waitlistId: string | null;
  fullName: string | null;
  personType: DncPersonType;
  phones: string[];
  emails: string[];
};

/** Read the person being moved, with every phone / email on their record (never from the browser). */
export async function loadDncSubject(
  admin: any,
  ref: { applicationId?: string | null; waitlistId?: string | null },
): Promise<Subject> {
  if (ref.applicationId) {
    const { data: app, error } = await admin
      .from("applications")
      .select("id,full_name,phone,email,status")
      .eq("id", ref.applicationId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!app) throw new Error("Driver Not Found.");
    const phones: unknown[] = [app.phone];
    const emails: unknown[] = [app.email];
    const contacts = await admin
      .from("driver_contacts")
      .select("kind,value")
      .eq("application_id", app.id);
    if (!contacts.error) {
      for (const c of (contacts.data ?? []) as any[]) {
        if (c.kind === "phone") phones.push(c.value);
        if (c.kind === "email") emails.push(c.value);
      }
    }
    const rentals = await admin
      .from("rentals")
      .select("id")
      .eq("application_id", app.id)
      .eq("status", "active")
      .limit(1);
    const hasOpenRental = !rentals.error && (rentals.data ?? []).length > 0;
    return {
      applicationId: app.id,
      waitlistId: null,
      fullName: app.full_name ?? null,
      personType: dncPersonType({ source: "application", status: app.status, hasOpenRental }),
      phones: uniqueNormalized(phones, normalizeDncPhone),
      emails: uniqueNormalized(emails, normalizeDncEmail),
    };
  }
  if (ref.waitlistId) {
    const { data: w, error } = await admin
      .from("waitlist")
      .select("id,full_name,phone,email")
      .eq("id", ref.waitlistId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!w) throw new Error("Waitlist Entry Not Found.");
    return {
      applicationId: null,
      waitlistId: w.id,
      fullName: w.full_name ?? null,
      personType: "lead",
      phones: uniqueNormalized([w.phone], normalizeDncPhone),
      emails: uniqueNormalized([w.email], normalizeDncEmail),
    };
  }
  throw new Error("Choose A Person.");
}

export async function addToDnc(
  admin: any,
  actor: DncActor,
  input: { applicationId?: string | null; waitlistId?: string | null; reason: string },
  audit: Audit,
): Promise<DncEntry> {
  const issues = dncReasonBlockers(input.reason);
  if (issues.length) throw new Error(issues[0]);
  const subject = await loadDncSubject(admin, input);
  const row = {
    application_id: subject.applicationId,
    waitlist_id: subject.waitlistId,
    person_type: subject.personType,
    full_name: subject.fullName,
    phones: subject.phones,
    emails: subject.emails,
    reason: input.reason.trim(),
    added_by: actor.userId,
    added_by_label: dncActorLabel(actor),
  };
  const { data, error } = await admin.from("dnc_list").insert(row).select(ENTRY_COLS).single();
  if (error) {
    if (dncNotInstalled(error)) throw new Error(DNC_NOT_INSTALLED);
    if (String(error.code) === "23505") throw new Error("This Person Is Already On The DNC List.");
    throw new Error(error.message);
  }
  const entry = toDncEntry(data);
  await audit(actor, {
    action: "dnc.added",
    summary: `Moved ${subject.fullName ?? "a person"} to the DNC List`,
    entityType: subject.applicationId ? "application" : "waitlist",
    entityId: subject.applicationId ?? subject.waitlistId ?? entry.id,
    metadata: { dnc_id: entry.id, reason: row.reason, person_type: subject.personType },
  });
  return entry;
}

export async function removeFromDnc(
  admin: any,
  actor: DncActor,
  input: { id: string; reason: string },
  audit: Audit,
): Promise<DncEntry> {
  if (TIER_RANK[actor.tier] < TIER_RANK.manager) throw new Error("Forbidden");
  const issues = dncReasonBlockers(input.reason);
  if (issues.length) throw new Error(issues[0]);
  const { data, error } = await admin
    .from("dnc_list")
    .update({
      removed_at: new Date().toISOString(),
      removed_by: actor.userId,
      removed_by_label: dncActorLabel(actor),
      removal_reason: input.reason.trim(),
    })
    .eq("id", input.id)
    .is("removed_at", null)
    .select(ENTRY_COLS)
    .maybeSingle();
  if (error) {
    if (dncNotInstalled(error)) throw new Error(DNC_NOT_INSTALLED);
    throw new Error(error.message);
  }
  if (!data) throw new Error("This Entry Is No Longer On The DNC List.");
  const entry = toDncEntry(data);
  await audit(actor, {
    action: "dnc.removed",
    summary: `Removed ${entry.fullName ?? "a person"} from the DNC List`,
    entityType: entry.applicationId ? "application" : "waitlist",
    entityId: entry.applicationId ?? entry.waitlistId ?? entry.id,
    metadata: { dnc_id: entry.id, reason: input.reason.trim() },
  });
  return entry;
}

/** Is this application on DNC? Used by sendStaffMessage (staff must confirm Contact Anyway). */
export async function activeDncForApplication(
  admin: any,
  applicationId: string,
): Promise<DncEntry | null> {
  const { data, error } = await admin
    .from("dnc_list")
    .select(ENTRY_COLS)
    .eq("application_id", applicationId)
    .is("removed_at", null)
    .maybeSingle();
  if (error) return null;
  return data ? toDncEntry(data) : null;
}

/**
 * Automated sends: is this recipient on the DNC List? A missing migration means "no".
 * Any other error also lets the message through (logged), the same rule as the
 * Blacklist, so a database hiccup cannot silence every renter.
 */
export async function isDncSuppressed(
  admin: any,
  who: { applicationId?: string | null; phone?: string | null; email?: string | null },
): Promise<boolean> {
  if (!admin || typeof admin.rpc !== "function") return false;
  if (!who.applicationId && !who.phone && !who.email) return false;
  try {
    const { data, error } = await admin.rpc("dnc_suppressed", {
      _application_id: who.applicationId ?? null,
      _phone: who.phone ?? null,
      _email: who.email ?? null,
    });
    if (error) {
      if (!dncNotInstalled(error))
        console.error("[dnc] suppression check failed; sending", error.message);
      return false;
    }
    return data === true;
  } catch (e) {
    console.error("[dnc] suppression check threw; sending", e instanceof Error ? e.message : e);
    return false;
  }
}

// ---- Staff-confirmed sends ------------------------------------------------------
// A staff action that sends (Send Agreement, Payment Link, Pickup Link...) runs its
// handler inside staffContact(): the browser already showed the "On DNC List" popup
// and the staff member chose Contact Anyway (or the person is not on the list), so
// sendSms / sendEmail let that one send through. Anything outside such a scope (crons,
// automations, webhooks, FLEET endpoints) is automated and skips DNC people.
type Store = { staff: true };
type Als = { getStore(): Store | undefined; run<T>(s: Store, f: () => T): T };
const ALS_KEY = Symbol.for("real-rentals:dnc-staff-contact");
const g = globalThis as unknown as Record<symbol, Als | undefined>;

export function inStaffContact(): boolean {
  return g[ALS_KEY]?.getStore()?.staff === true;
}

export async function staffContact<T>(run: () => Promise<T>): Promise<T> {
  if (!g[ALS_KEY]) {
    const { AsyncLocalStorage } = await import("node:async_hooks");
    g[ALS_KEY] = new AsyncLocalStorage<Store>() as unknown as Als;
  }
  return g[ALS_KEY]!.run({ staff: true }, run);
}
