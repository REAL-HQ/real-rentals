/**
 * Renter Blacklist: the server-side rules. Every write goes through here.
 *
 * supabaseAdmin bypasses RLS, so the role check happens in the server
 * functions (blacklist.functions.ts) AND the actor's tier is checked again
 * here: Owner to add or remove, or to clear a match; any staff to log a
 * warning (strike); Owner to void one. The database triggers in
 * 20261120040000_renter_blacklist.sql refuse approvals and rentals for a
 * blacklisted person whatever path a caller takes; checkBlacklist() below is
 * only the friendly pre-check so staff see a sentence, not a Postgres error.
 *
 * `admin` is injected (a Supabase-style client) so the rules are testable
 * with an in-memory fake (scripts/renter-blacklist.test.ts).
 */
import {
  BLACKLIST_MATCH_CODE,
  appendNote,
  blacklistBlockers,
  blacklistNotesLine,
  blacklistReasonLabel,
  blacklistRefusal,
  normalizeBlacklistReason,
  normalizeStrikeKind,
  secondStrikeReached,
  strikeBlockers,
  strikeKindLabel,
  strikeNotesLine,
  unblacklistNotesLine,
  type BlacklistReasonKey,
  type StrikeKind,
  type BlacklistEntry,
  type StrikeEntry,
  type BlacklistProfile,
} from "@/lib/blacklist";

export type { BlacklistEntry, StrikeEntry, BlacklistProfile };

export type BlacklistActor = { userId: string; email: string | null; role?: string; tier: "owner" | "manager" | "coordinator" };
export type AuditFn = (actor: BlacklistActor, entry: { action: string; summary: string; entityType?: string; entityId?: string; metadata?: Record<string, unknown> }) => Promise<void>;


const ENTRY_COLUMNS =
  "id,application_id,full_name,reason_code,note,blacklisted_on,added_by_label,created_at,removed_at,removed_by_label,removal_reason";
const STRIKE_COLUMNS =
  "id,application_id,kind,occurred_on,note,added_by_label,created_at,voided_at,voided_by_label,void_reason";

export const BLACKLIST_NOT_INSTALLED =
  "The Blacklist Is Not Enabled On This Database Yet. Apply The renter_blacklist Migration, Then Try Again.";

function notInstalled(err: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!err) return false;
  const code = String(err.code ?? "");
  if (code === "42P01" || code === "PGRST205" || code === "PGRST202" || code === "42883") return true;
  return /renter_blacklist|renter_strikes/.test(String(err.message ?? "")) && /does not exist|schema cache|could not find/i.test(String(err.message ?? ""));
}

export function actorLabel(actor: BlacklistActor): string {
  const tier = actor.tier === "owner" ? "Owner" : actor.tier === "manager" ? "Manager" : "Coordinator";
  return actor.email ? `${actor.email} (${tier})` : tier;
}

function todayEt(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function toEntry(r: any): BlacklistEntry {
  return {
    id: String(r.id),
    applicationId: r.application_id ?? null,
    fullName: r.full_name ?? null,
    reason: String(r.reason_code),
    reasonLabel: blacklistReasonLabel(r.reason_code),
    note: String(r.note ?? ""),
    blacklistedOn: String(r.blacklisted_on ?? ""),
    addedBy: String(r.added_by_label ?? ""),
    createdAt: r.created_at ?? null,
    removedAt: r.removed_at ?? null,
    removedBy: r.removed_by_label ?? null,
    removalReason: r.removal_reason ?? null,
  };
}
export function toStrike(r: any): StrikeEntry {
  return {
    id: String(r.id),
    kind: String(r.kind),
    kindLabel: strikeKindLabel(r.kind),
    occurredOn: String(r.occurred_on ?? ""),
    note: String(r.note ?? ""),
    addedBy: String(r.added_by_label ?? ""),
    createdAt: r.created_at ?? null,
    voidedAt: r.voided_at ?? null,
    voidedBy: r.voided_by_label ?? null,
    voidReason: r.void_reason ?? null,
  };
}

/** Postgres refusals from the triggers, as the sentence staff should read. Null when unrelated. */
export function blacklistRefusalFromDbError(message: unknown): string | null {
  const m = String(message ?? "");
  if (/renter_blacklist_match_uncleared/.test(m)) return blacklistRefusal("match");
  if (/renter_blacklisted/.test(m)) return blacklistRefusal("blacklisted");
  if (/blacklist_needs_second_strike/.test(m)) return "This Reason Needs A Second Logged Strike First.";
  return null;
}

export type BlacklistCheck = {
  installed: boolean;
  blacklisted: boolean;
  block: "renter_blacklisted" | "renter_blacklist_match_uncleared" | null;
  message: string | null;
  matches: { blacklistId: string; kinds: string[]; cleared: boolean }[];
};

/**
 * The pre-check every approval, reservation, activation and agreement send
 * runs. Fails closed on an unexpected error; open only when the migration is
 * not installed yet (then nobody can be on the list).
 */
export async function checkBlacklist(admin: any, applicationId: string): Promise<BlacklistCheck> {
  const none: BlacklistCheck = { installed: false, blacklisted: false, block: null, message: null, matches: [] };
  if (!admin || typeof admin.rpc !== "function") return none;
  const { data, error } = await admin.rpc("renter_blacklist_check", { _application_id: applicationId });
  if (error) {
    if (notInstalled(error)) return none;
    throw new Error("Could Not Check The Blacklist. Try Again.");
  }
  const d = (data ?? {}) as Record<string, any>;
  const block = d.block === "renter_blacklisted" || d.block === "renter_blacklist_match_uncleared" ? d.block : null;
  return {
    installed: true,
    blacklisted: d.blacklisted === true,
    block,
    message: block === "renter_blacklisted" ? blacklistRefusal("blacklisted") : block ? blacklistRefusal("match") : null,
    matches: Array.isArray(d.matches)
      ? d.matches.map((m: any) => ({ blacklistId: String(m.blacklist_id), kinds: Array.isArray(m.kinds) ? m.kinds.map(String) : [], cleared: m.cleared === true }))
      : [],
  };
}

/** Throws the staff-facing refusal when the application may not be approved / reserved / rented. */
export async function assertNotBlacklisted(admin: any, applicationId: string): Promise<void> {
  const c = await checkBlacklist(admin, applicationId);
  if (c.message) throw new Error(c.message);
}

async function readStrikes(admin: any, applicationId: string) {
  const res = await admin.from("renter_strikes").select(STRIKE_COLUMNS).eq("application_id", applicationId);
  if (res.error) throw new Error(notInstalled(res.error) ? BLACKLIST_NOT_INSTALLED : res.error.message);
  return (res.data ?? []) as any[];
}

async function readApplication(admin: any, applicationId: string) {
  const { data, error } = await admin
    .from("applications")
    .select("id,full_name,notes,deleted_at")
    .eq("id", applicationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.deleted_at) throw new Error("That Driver No Longer Exists.");
  return data as { id: string; full_name: string | null; notes: string | null };
}

async function appendToNotes(admin: any, app: { id: string; notes: string | null }, line: string): Promise<string> {
  const next = appendNote(app.notes, line);
  if (next !== (app.notes ?? "")) {
    const { error } = await admin.from("applications").update({ notes: next }).eq("id", app.id);
    if (error) throw new Error(`Saved, But The Note Could Not Be Added To Notes: ${error.message}`);
  }
  return next;
}

function requireOwnerTier(actor: BlacklistActor, what: string) {
  if (actor.tier !== "owner") throw new Error(`Only An Owner Can ${what}.`);
}

export async function addToBlacklist(
  admin: any,
  actor: BlacklistActor,
  input: { applicationId: string; reason: string; note: string; date: string },
  audit: AuditFn,
  today = todayEt(),
): Promise<{ entry: BlacklistEntry; notes: string }> {
  requireOwnerTier(actor, "Blacklist A Renter");
  const app = await readApplication(admin, input.applicationId);
  const strikes = await readStrikes(admin, input.applicationId);
  const blockers = blacklistBlockers({ reason: input.reason, note: input.note, date: input.date }, strikes, today);
  if (blockers.length) throw new Error(blockers.map((b) => b.why).join(" "));
  const reason = normalizeBlacklistReason(input.reason) as BlacklistReasonKey;

  const existing = await admin.from("renter_blacklist").select("id").eq("application_id", app.id).is("removed_at", null);
  if (existing.error) throw new Error(notInstalled(existing.error) ? BLACKLIST_NOT_INSTALLED : existing.error.message);
  if ((existing.data ?? []).length) throw new Error("This Renter Is Already Blacklisted.");

  const label = actorLabel(actor);
  const note = input.note.trim();
  const ins = await admin
    .from("renter_blacklist")
    .insert({
      application_id: app.id,
      full_name: app.full_name,
      reason_code: reason,
      note,
      blacklisted_on: input.date,
      added_by: actor.userId,
      added_by_label: label,
    })
    .select(ENTRY_COLUMNS)
    .single();
  if (ins.error) {
    if (/renter_blacklist_one_active_per_application/.test(String(ins.error.message))) throw new Error("This Renter Is Already Blacklisted.");
    throw new Error(blacklistRefusalFromDbError(ins.error.message) ?? (notInstalled(ins.error) ? BLACKLIST_NOT_INSTALLED : ins.error.message));
  }
  const notes = await appendToNotes(admin, app, blacklistNotesLine({ reason, note, date: input.date, addedBy: label }));
  await audit(actor, {
    action: "renter.blacklisted",
    summary: `Blacklisted ${app.full_name ?? "a renter"} (${blacklistReasonLabel(reason)})`,
    entityType: "application",
    entityId: app.id,
    metadata: { blacklist_id: ins.data?.id ?? null, reason, blacklisted_on: input.date, note },
  });
  return { entry: toEntry(ins.data), notes };
}

export async function removeFromBlacklist(
  admin: any,
  actor: BlacklistActor,
  input: { applicationId: string; reason: string },
  audit: AuditFn,
  now = new Date(),
): Promise<{ entry: BlacklistEntry; notes: string }> {
  requireOwnerTier(actor, "Remove A Renter From The Blacklist");
  const why = String(input.reason ?? "").trim();
  if (why.length < 5) throw new Error("Say Why They Are Being Removed.");
  if (why.length > 1000) throw new Error("Keep The Reason Under 1000 Characters.");
  const app = await readApplication(admin, input.applicationId);
  const label = actorLabel(actor);
  const upd = await admin
    .from("renter_blacklist")
    .update({ removed_at: now.toISOString(), removed_by: actor.userId, removed_by_label: label, removal_reason: why })
    .eq("application_id", app.id)
    .is("removed_at", null)
    .select(ENTRY_COLUMNS);
  if (upd.error) throw new Error(notInstalled(upd.error) ? BLACKLIST_NOT_INSTALLED : upd.error.message);
  const row = (upd.data ?? [])[0];
  if (!row) throw new Error("This Renter Is Not Blacklisted.");
  const notes = await appendToNotes(admin, app, unblacklistNotesLine({ reason: why, date: todayEt(now), removedBy: label }));
  await audit(actor, {
    action: "renter.blacklist_removed",
    summary: `Removed ${app.full_name ?? "a renter"} From The Blacklist`,
    entityType: "application",
    entityId: app.id,
    metadata: { blacklist_id: row.id, reason: why },
  });
  return { entry: toEntry(row), notes };
}

export async function logStrike(
  admin: any,
  actor: BlacklistActor,
  input: { applicationId: string; kind: string; note: string; date: string },
  audit: AuditFn,
  today = todayEt(),
): Promise<{ strike: StrikeEntry; notes: string; secondStrike: boolean }> {
  const blockers = strikeBlockers({ kind: input.kind, note: input.note, date: input.date }, today);
  if (blockers.length) throw new Error(blockers.map((b) => b.why).join(" "));
  const kind = normalizeStrikeKind(input.kind) as StrikeKind;
  const app = await readApplication(admin, input.applicationId);
  const label = actorLabel(actor);
  const note = input.note.trim();
  const ins = await admin
    .from("renter_strikes")
    .insert({ application_id: app.id, kind, occurred_on: input.date, note, added_by: actor.userId, added_by_label: label })
    .select(STRIKE_COLUMNS)
    .single();
  if (ins.error) throw new Error(notInstalled(ins.error) ? BLACKLIST_NOT_INSTALLED : ins.error.message);
  const notes = await appendToNotes(admin, app, strikeNotesLine({ kind, note, date: input.date, addedBy: label }));
  const all = await readStrikes(admin, app.id);
  const secondStrike = secondStrikeReached(all, kind);
  await audit(actor, {
    action: "renter.strike_logged",
    summary: `Warning Logged For ${app.full_name ?? "a renter"}: ${strikeKindLabel(kind)}`,
    entityType: "application",
    entityId: app.id,
    metadata: { strike_id: ins.data?.id ?? null, kind, occurred_on: input.date, note, second_strike: secondStrike },
  });
  return { strike: toStrike(ins.data), notes, secondStrike };
}

export async function voidStrike(
  admin: any,
  actor: BlacklistActor,
  input: { strikeId: string; reason: string },
  audit: AuditFn,
  now = new Date(),
): Promise<StrikeEntry> {
  requireOwnerTier(actor, "Void A Warning");
  const why = String(input.reason ?? "").trim();
  if (why.length < 5) throw new Error("Say Why The Warning Is Being Voided.");
  const upd = await admin
    .from("renter_strikes")
    .update({ voided_at: now.toISOString(), voided_by: actor.userId, voided_by_label: actorLabel(actor), void_reason: why })
    .eq("id", input.strikeId)
    .is("voided_at", null)
    .select(STRIKE_COLUMNS);
  if (upd.error) throw new Error(notInstalled(upd.error) ? BLACKLIST_NOT_INSTALLED : upd.error.message);
  const row = (upd.data ?? [])[0];
  if (!row) throw new Error("That Warning Is Already Voided.");
  await audit(actor, {
    action: "renter.strike_voided",
    summary: `Voided A ${strikeKindLabel(row.kind)} Warning`,
    entityType: "application",
    entityId: row.application_id ?? undefined,
    metadata: { strike_id: row.id, reason: why },
  });
  return toStrike(row);
}


export async function getBlacklistProfile(admin: any, applicationId: string): Promise<BlacklistProfile> {
  const entries = await admin.from("renter_blacklist").select(ENTRY_COLUMNS).eq("application_id", applicationId);
  if (entries.error) {
    if (notInstalled(entries.error)) return { installed: false, active: null, history: [], strikes: [], matches: [] };
    throw new Error(entries.error.message);
  }
  const strikes = await readStrikes(admin, applicationId);
  const history = ((entries.data ?? []) as any[]).map(toEntry).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const check = await checkBlacklist(admin, applicationId);
  return {
    installed: true,
    active: history.find((e) => !e.removedAt) ?? null,
    history,
    strikes: strikes.map(toStrike).sort((a, b) => b.occurredOn.localeCompare(a.occurredOn)),
    matches: check.matches.filter((m) => !m.cleared),
  };
}

export async function listActiveBlacklist(admin: any): Promise<{ installed: boolean; entries: BlacklistEntry[] }> {
  const res = await admin.from("renter_blacklist").select(ENTRY_COLUMNS).is("removed_at", null).limit(2000);
  if (res.error) {
    if (notInstalled(res.error)) return { installed: false, entries: [] };
    throw new Error(res.error.message);
  }
  return { installed: true, entries: ((res.data ?? []) as any[]).map(toEntry) };
}

/** The blacklist ids a needs_staff flag was raised for (assessment.blacklist_match.blacklist_ids). */
export function flagBlacklistIds(flag: { escalation_codes?: unknown; assessment?: unknown } | null | undefined): string[] {
  if (!flag) return [];
  const codes = Array.isArray(flag.escalation_codes) ? flag.escalation_codes.map(String) : [];
  if (!codes.includes(BLACKLIST_MATCH_CODE)) return [];
  const a = (flag.assessment ?? {}) as Record<string, any>;
  const ids = a?.blacklist_match?.blacklist_ids;
  return Array.isArray(ids) ? ids.map(String) : [];
}

/**
 * An Owner decided a match is NOT the blacklisted person: record a clearance
 * for each matched entry, so the approval and rental triggers let this
 * applicant through. The flag itself is resolved by the caller.
 */
export async function clearBlacklistMatch(
  admin: any,
  actor: BlacklistActor,
  input: { applicationId: string; blacklistIds: string[]; note?: string | null },
  audit: AuditFn,
): Promise<void> {
  requireOwnerTier(actor, "Clear A Blacklist Match");
  if (!input.blacklistIds.length) return;
  const rows = input.blacklistIds.map((id) => ({
    application_id: input.applicationId,
    blacklist_id: id,
    cleared_by: actor.userId,
    cleared_by_label: actorLabel(actor),
    note: input.note ? String(input.note).slice(0, 500) : null,
  }));
  const res = await admin.from("renter_blacklist_clearances").upsert(rows, { onConflict: "application_id,blacklist_id", ignoreDuplicates: true });
  if (res.error) throw new Error(notInstalled(res.error) ? BLACKLIST_NOT_INSTALLED : res.error.message);
  await audit(actor, {
    action: "renter.blacklist_match_cleared",
    summary: "Cleared A Blacklist Match (Not The Same Person)",
    entityType: "application",
    entityId: input.applicationId,
    metadata: { blacklist_ids: input.blacklistIds, note: input.note ?? null },
  });
}
