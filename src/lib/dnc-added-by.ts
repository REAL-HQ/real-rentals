// Short Added By label for the DNC table. The stored added_by_label stays
// intact (it is the tooltip). This only decides what the column shows.

export type DncNameSource = {
  userId?: string | null;
  email?: string | null;
  staffKey?: string | null;
  /** Staff profile name, or the account's full name. */
  name: string;
};

const BOTS: { key: string; name: string }[] = [
  { key: "vibe", name: "VIBE" },
  { key: "responder", name: "Responder" },
];

const ROLES = new Set(["owner", "manager", "coordinator", "admin", "staff"]);

function compact(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function emailIn(label: string): string | null {
  const hit = label.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  return hit ? hit[0].toLowerCase() : null;
}

function localPart(email: string | null): string {
  return email?.split("@")[0] ?? "";
}

/** The stored text with parenthetical notes removed. */
function actorToken(label: string): string {
  return label.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
}

function botName(token: string): string | null {
  const key = token.trim().toLowerCase();
  return BOTS.find((bot) => bot.key === key)?.name ?? null;
}

function titleLocal(local: string): string {
  const parts = local.split(/[._-]+/).filter(Boolean);
  const titled = parts.map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase());
  return /[._-]/.test(local) ? titled.join(" ") : titled.join("");
}

/** First name when the profile is a full name; the whole name when it is one word. */
function shortStaffName(name: string): string {
  const cleaned = name.trim().replace(/\s+/g, " ");
  return cleaned.split(" ")[0] ?? "";
}

function sourceMatches(source: DncNameSource, userId: string | null, email: string | null): boolean {
  if (!source.name.trim()) return false;
  if (userId && source.userId && source.userId === userId) return true;
  if (!email) return false;
  if (source.email && source.email.toLowerCase() === email) return true;
  const local = localPart(email);
  if (source.staffKey && source.staffKey.toLowerCase() === local) return true;
  return compact(source.name) === compact(local);
}

/**
 * Who added the row, as a short name.
 * Staff profile first (by user id or email), then a known bot, then the
 * mailbox name in Title Case. Role words and parenthetical notes are dropped.
 */
export function dncAddedByDisplay(
  label: string | null | undefined,
  sources: DncNameSource[] = [],
  userId?: string | null,
): string {
  const raw = String(label ?? "").trim();
  if (!raw) return "—";
  const email = emailIn(raw);
  const token = actorToken(raw);
  const profile = sources.find((source) => sourceMatches(source, userId ?? null, email));
  if (profile) {
    const short = shortStaffName(profile.name);
    if (short) return short;
  }
  const fromToken = botName(token) ?? (email ? botName(localPart(email)) : null);
  if (fromToken) return fromToken;
  if (!email) {
    const mentioned = BOTS.find((bot) => new RegExp(`\\b${bot.key}\\b`, "i").test(raw));
    if (mentioned) return mentioned.name;
  }
  if (email) return titleLocal(localPart(email)) || "Staff";
  if (token && !ROLES.has(token.toLowerCase())) {
    return token
      .split(/\s+/)
      .map((part) => titleLocal(part))
      .join(" ");
  }
  return "Staff";
}
