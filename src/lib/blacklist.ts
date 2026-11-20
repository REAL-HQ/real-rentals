/**
 * Renter Blacklist: vocabulary, field rules and identifier normalization.
 *
 * Client-safe (no server imports). The SAME rules run in the dialog (to
 * disable Save and say why) and on the server (to refuse), and the
 * normalizers below are mirrored exactly by the SQL helpers in
 * supabase/migrations/20261120040000_renter_blacklist.sql so the database
 * and the app agree on what "the same phone / email / licence / address" is.
 *
 * Blacklisted is NOT an applications.status value. It is its own record
 * (public.renter_blacklist) so that approval, activation and agreements keep
 * reading the lifecycle they always read, while the database refuses any
 * approval or rental for a blacklisted person (triggers in the migration).
 * Only an Owner adds or removes; nothing is ever deleted, so history stays.
 */
import { DANGER_BADGE } from "./badge-tone";

export const BLACKLISTED_LABEL = "Blacklisted";
/** The pastel red "Unqualified" badge, so Blacklisted reads as the same family. */
export const BLACKLISTED_BADGE = DANGER_BADGE;
/** needs_staff escalation code written by the database when a new application matches. */
export const BLACKLIST_MATCH_CODE = "blacklist_match";
export const BLACKLIST_MATCH_REASON = "matches blacklisted renter";

/** Any ONE of these = blacklist (Dolmar, Nov 19 2026 10:51 PM ET). */
export const BLACKLIST_REASONS = [
  { key: "vehicle_repossessed", label: "Vehicle Repossessed For Non-Payment Or Refusal To Return", strike: null },
  { key: "unpaid_balance", label: "Unpaid Balance After Return (Rent, Damage, Fees, Tolls)", strike: null },
  { key: "gps_tamper", label: "Tampered With / Bypassed GPS Or Starter-Interrupt", strike: null },
  { key: "unauthorized_driver", label: "Unauthorized Driver Or Sublease", strike: null },
  { key: "left_service_area", label: "Left FL / Service Area Without Permission After A Warning", strike: null },
  {
    key: "application_fraud",
    label: "Application Fraud (Fake ID, Someone Else's License / Gig Account, Doctored Screenshots)",
    strike: null,
  },
  { key: "chargeback", label: "Chargeback On Rent Actually Owed", strike: null },
  {
    key: "serious_damage_contraband",
    label: "Serious Unreported Damage, Or Drugs / Weapons / Heavy Infestation In Car",
    strike: null,
  },
  { key: "threats_crime", label: "Threats / Harassment Of Staff Or Crime In The Car", strike: null },
  // Two-strike reasons: a warning is logged first; blacklist only on the 2nd strike.
  { key: "late_payment_second_strike", label: "Late Payment More Than Once In 60 Days (Second Strike)", strike: "late_payment" },
  { key: "smoking_second_strike", label: "Smoking (Second Strike)", strike: "smoking" },
  { key: "dirty_return_second_strike", label: "Returning Car Dirty (Second Strike)", strike: "dirty_return" },
] as const;

export type BlacklistReasonKey = (typeof BLACKLIST_REASONS)[number]["key"];
export const BLACKLIST_REASON_KEYS = BLACKLIST_REASONS.map((r) => r.key) as BlacklistReasonKey[];

export const STRIKE_KINDS = [
  { key: "late_payment", label: "Late Payment" },
  { key: "smoking", label: "Smoking" },
  { key: "dirty_return", label: "Returned Car Dirty" },
] as const;
export type StrikeKind = (typeof STRIKE_KINDS)[number]["key"];
export const STRIKE_KIND_KEYS = STRIKE_KINDS.map((s) => s.key) as StrikeKind[];
/** Two late-payment strikes count only when they fall within this many days of each other. */
export const LATE_PAYMENT_WINDOW_DAYS = 60;

const REASON_LABELS: Record<string, string> = Object.fromEntries(BLACKLIST_REASONS.map((r) => [r.key, r.label]));
const STRIKE_LABELS: Record<string, string> = Object.fromEntries(STRIKE_KINDS.map((s) => [s.key, s.label]));

export function blacklistReasonLabel(key: unknown): string {
  const k = String(key ?? "").trim();
  return REASON_LABELS[k] ?? k;
}
export function strikeKindLabel(key: unknown): string {
  const k = String(key ?? "").trim();
  return STRIKE_LABELS[k] ?? k;
}
export function normalizeBlacklistReason(raw: unknown): BlacklistReasonKey | null {
  const k = String(raw ?? "").trim();
  return (BLACKLIST_REASON_KEYS as string[]).includes(k) ? (k as BlacklistReasonKey) : null;
}
export function normalizeStrikeKind(raw: unknown): StrikeKind | null {
  const k = String(raw ?? "").trim();
  return (STRIKE_KIND_KEYS as string[]).includes(k) ? (k as StrikeKind) : null;
}
/** The strike kind a two-strike reason needs, or null for a one-strike reason. */
export function reasonStrikeKind(reason: BlacklistReasonKey): StrikeKind | null {
  return BLACKLIST_REASONS.find((r) => r.key === reason)?.strike ?? null;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
export const NOTE_MIN = 5;
export const NOTE_MAX = 2000;

export type BlacklistBlocker = { field: "reason" | "note" | "date" | "strikes"; why: string };

export type StrikeLike = { kind: string; occurred_on: string; voided_at?: string | null };

function dayNumber(iso: string): number {
  return Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);
}

/**
 * Has this renter earned the second strike for `kind`? Two live (not voided)
 * strikes of the kind; for Late Payment the two must be within 60 days.
 */
export function secondStrikeReached(strikes: readonly StrikeLike[], kind: StrikeKind): boolean {
  const days = strikes
    .filter((s) => s.kind === kind && !s.voided_at && DATE_ONLY.test(String(s.occurred_on)))
    .map((s) => dayNumber(String(s.occurred_on)))
    .sort((a, b) => a - b);
  if (days.length < 2) return false;
  if (kind !== "late_payment") return true;
  for (let i = 1; i < days.length; i++) if (days[i] - days[i - 1] <= LATE_PAYMENT_WINDOW_DAYS) return true;
  return false;
}

/** What stops a blacklist entry from being saved. Runs in the dialog and on the server. */
export function blacklistBlockers(
  draft: { reason: unknown; note?: unknown; date?: unknown },
  strikes: readonly StrikeLike[] = [],
  today?: string,
): BlacklistBlocker[] {
  const out: BlacklistBlocker[] = [];
  const reason = normalizeBlacklistReason(draft.reason);
  if (!reason) out.push({ field: "reason", why: "Pick A Blacklist Reason." });
  const note = String(draft.note ?? "").trim();
  if (note.length < NOTE_MIN) out.push({ field: "note", why: "A Reason Note Is Required." });
  if (note.length > NOTE_MAX) out.push({ field: "note", why: `Keep The Note Under ${NOTE_MAX} Characters.` });
  const date = String(draft.date ?? "").trim();
  if (!DATE_ONLY.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)))
    out.push({ field: "date", why: "Enter The Blacklist Date." });
  else if (today && date > today) out.push({ field: "date", why: "The Blacklist Date Cannot Be In The Future." });
  if (reason) {
    const kind = reasonStrikeKind(reason);
    if (kind && !secondStrikeReached(strikes, kind))
      out.push({
        field: "strikes",
        why:
          kind === "late_payment"
            ? "This Reason Needs Two Logged Late Payment Strikes Within 60 Days. Log A Warning First."
            : `This Reason Needs Two Logged ${strikeKindLabel(kind)} Strikes. Log A Warning First.`,
      });
  }
  return out;
}

export function strikeBlockers(draft: { kind: unknown; note?: unknown; date?: unknown }, today?: string): BlacklistBlocker[] {
  const out: BlacklistBlocker[] = [];
  if (!normalizeStrikeKind(draft.kind)) out.push({ field: "reason", why: "Pick What The Warning Is For." });
  const note = String(draft.note ?? "").trim();
  if (note.length < NOTE_MIN) out.push({ field: "note", why: "A Note Is Required." });
  if (note.length > NOTE_MAX) out.push({ field: "note", why: `Keep The Note Under ${NOTE_MAX} Characters.` });
  const date = String(draft.date ?? "").trim();
  if (!DATE_ONLY.test(date)) out.push({ field: "date", why: "Enter The Date It Happened." });
  else if (today && date > today) out.push({ field: "date", why: "The Date Cannot Be In The Future." });
  return out;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** 2026-11-19 -> "Nov 19, 2026". */
export function formatBlacklistDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ""));
  if (!m) return String(iso ?? "");
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

/**
 * The line added to the renter's Notes (applications.notes) when they are
 * blacklisted. A note staff already wrote as "Blacklisted …" is kept verbatim.
 */
export function blacklistNotesLine(entry: { reason: BlacklistReasonKey; note: string; date: string; addedBy: string }): string {
  const note = entry.note.trim();
  if (/^blacklisted\b/i.test(note)) return note;
  return `Blacklisted ${formatBlacklistDate(entry.date)} (${blacklistReasonLabel(entry.reason)}) by ${entry.addedBy}: ${note}`;
}
export function unblacklistNotesLine(entry: { reason: string; date: string; removedBy: string }): string {
  return `Removed From Blacklist ${formatBlacklistDate(entry.date)} by ${entry.removedBy}: ${entry.reason.trim()}`;
}
export function strikeNotesLine(s: { kind: StrikeKind; note: string; date: string; addedBy: string }): string {
  return `Warning (${strikeKindLabel(s.kind)}) ${formatBlacklistDate(s.date)} by ${s.addedBy}: ${s.note.trim()}`;
}

/** Append `line` to existing notes, unless an identical note is already there. */
export function appendNote(existing: string | null | undefined, line: string): string {
  const cur = String(existing ?? "");
  const add = line.trim();
  if (!add) return cur;
  if (cur.includes(add)) return cur;
  return cur.trim() ? `${cur.replace(/\s+$/, "")}\n\n${add}` : add;
}

// ---------------------------------------------------------------- matching
// Mirrored by private.rr_norm_* in the migration. Change both or neither.

/** Digits only; a leading US country code 1 on an 11-digit number is dropped. Under 10 digits: null. */
export function normalizePhone(raw: unknown): string | null {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  return d.length >= 10 ? d : null;
}
/** Trimmed lowercase; must look like an email. */
export function normalizeEmail(raw: unknown): string | null {
  const e = String(raw ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+$/.test(e) ? e : null;
}
/** Uppercase letters and digits only; under 4 characters: null. */
export function normalizeLicense(raw: unknown): string | null {
  const l = String(raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return l.length >= 4 ? l : null;
}

const ADDRESS_WORDS: Record<string, string> = {
  street: "st", str: "st", avenue: "ave", av: "ave", road: "rd", drive: "dr", boulevard: "blvd", blv: "blvd",
  lane: "ln", court: "ct", circle: "cir", place: "pl", parkway: "pkwy", highway: "hwy", terrace: "ter",
  trail: "trl", square: "sq", way: "way", north: "n", south: "s", east: "e", west: "w",
  northeast: "ne", northwest: "nw", southeast: "se", southwest: "sw",
  apartment: "apt", unit: "apt", suite: "ste", number: "apt", no: "apt",
};

/**
 * Street line (text before the first comma) normalized, plus the 5-digit ZIP
 * (from `zip`, else the last ZIP in the address). Lowercase, punctuation to
 * spaces, "#" / Unit / Apartment -> apt, common street words abbreviated.
 * Must start with a house number, else null (no matching on "N/A").
 */
export function normalizeAddress(address: unknown, zip?: unknown): string | null {
  const full = String(address ?? "");
  const streetRaw = full.split(",")[0] ?? "";
  const tokens = streetRaw
    .toLowerCase()
    .replace(/#/g, " apt ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((t) => ADDRESS_WORDS[t] ?? t);
  const street = tokens.join(" ");
  if (!/^\d/.test(street) || tokens.length < 2) return null;
  const zipFrom = (v: unknown) => {
    const m = String(v ?? "").match(/\b(\d{5})(?:-\d{4})?\b/g);
    return m ? m[m.length - 1].slice(0, 5) : "";
  };
  const z = zipFrom(zip) || (full.includes(",") ? zipFrom(full.slice(full.indexOf(",") + 1)) : "");
  return `${street}|${z}`;
}

export type BlacklistIdentifierKind = "phone" | "email" | "license" | "address";
export type BlacklistIdentifier = { kind: BlacklistIdentifierKind; value: string };

/** Every normalized identifier on an application row (for display-free matching and tests). */
export function applicationIdentifiers(app: {
  phone?: unknown;
  email?: unknown;
  license_number?: unknown;
  address?: unknown;
  zip?: unknown;
}): BlacklistIdentifier[] {
  const out: BlacklistIdentifier[] = [];
  const p = normalizePhone(app.phone);
  if (p) out.push({ kind: "phone", value: p });
  const e = normalizeEmail(app.email);
  if (e) out.push({ kind: "email", value: e });
  const l = normalizeLicense(app.license_number);
  if (l) out.push({ kind: "license", value: l });
  const a = normalizeAddress(app.address, app.zip);
  if (a) out.push({ kind: "address", value: a });
  return out;
}

/** Which kinds two identifier sets share. Empty = no match. */
export function matchingKinds(a: readonly BlacklistIdentifier[], b: readonly BlacklistIdentifier[]): BlacklistIdentifierKind[] {
  const set = new Set(b.map((x) => `${x.kind}:${x.value}`));
  return [...new Set(a.filter((x) => set.has(`${x.kind}:${x.value}`)).map((x) => x.kind))].sort();
}

const KIND_LABELS: Record<BlacklistIdentifierKind, string> = {
  phone: "Phone",
  email: "Email",
  license: "License Number",
  address: "Address",
};
export function identifierKindLabel(k: string): string {
  return KIND_LABELS[k as BlacklistIdentifierKind] ?? k;
}

/** The message staff see when the server refuses because of the blacklist. */
export function blacklistRefusal(kind: "blacklisted" | "match"): string {
  return kind === "blacklisted"
    ? "This Renter Is Blacklisted. They Cannot Be Approved, Reserved Or Rented To."
    : "This Applicant Matches A Blacklisted Renter. An Owner Must Review And Clear The Match First.";
}

// ------------------------------------------------------- shapes the UI reads
export type BlacklistEntry = {
  id: string;
  applicationId: string | null;
  fullName: string | null;
  reason: string;
  reasonLabel: string;
  note: string;
  blacklistedOn: string;
  addedBy: string;
  createdAt: string | null;
  removedAt: string | null;
  removedBy: string | null;
  removalReason: string | null;
};

export type StrikeEntry = {
  id: string;
  kind: string;
  kindLabel: string;
  occurredOn: string;
  note: string;
  addedBy: string;
  createdAt: string | null;
  voidedAt: string | null;
  voidedBy: string | null;
  voidReason: string | null;
};

export type BlacklistProfile = {
  installed: boolean;
  active: BlacklistEntry | null;
  history: BlacklistEntry[];
  strikes: StrikeEntry[];
  matches: { blacklistId: string; kinds: string[]; cleared: boolean }[];
};
