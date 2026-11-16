/**
 * Staff-text auto-pause (Dolmar, card t310s1681: "auto-pause the bots when
 * staff text someone from Quo").
 *
 * When a person on the team texts someone from one of our Quo lines (888
 * PNrZULvFMn or 813 PNcX8a0PLJ), the site's automatic outreach to that person
 * holds for STAFF_TEXT_PAUSE_DEFAULT_HOURS (48 h). Every further staff text
 * pushes the end out again (rolling), staff can extend it by hand, and staff
 * can clear it. It is a light pause, not a red Needs Staff handoff: nothing is
 * flagged, nobody is alerted, and FLEET's next step is unchanged.
 *
 * Switch: Back Office → Automations → "Pause Bots When Staff Text"
 * (automation key `staff_text_pause`), Off by default. The switch only gates
 * CREATING a pause from a Quo text; an existing pause is always honoured.
 * Tuning (all optional): app_settings `staff_text_pause`
 *   { "hours": 48, "staff_user_ids": ["US…"], "bot_user_ids": ["US…"] }.
 *
 * Telling a staff text from a bot text (classifyQuoOutbound):
 *   1. Our own send log. Every text the site sends (missing-items, follow-ups,
 *      reminders, rent and late-fee notices, FLEET link resends, receipts...)
 *      is written to outbound_messages BEFORE Quo is called, then stamped with
 *      Quo's message id. A delivered text whose id, or whose recipient + exact
 *      wording within 30 minutes, is in that log is ours: a bot text, unless
 *      its kind is a staff send from the site (Messages → Text, kind
 *      "staff_message"), which counts as staff.
 *   2. Quo's sender. context.userId missing or not a "US…" user (Quo system
 *      actors such as Sona are "SYU…") is a bot. A user id listed in
 *      bot_user_ids (the Quo user FLEET sends as) is a bot.
 *   3. Automated wording: a text containing "Reply STOP to opt out" is treated
 *      as automated (every bot template carries it; people do not type it).
 *   4. Only then is it staff: the user id is in staff_user_ids, or (when
 *      staff_user_ids is empty) bot_user_ids is configured and this user is
 *      not in it. With neither list configured the text is "unknown" and
 *      nothing pauses: we never guess.
 *
 * Storage: public.bot_text_pauses, one row per phone number (last 10 digits)
 * — proposed/staff-text-pause-v1.sql. Before that table exists every check
 * answers "not paused" (today's behaviour) and nothing is written.
 */
type Admin = any;
type Env = Record<string, string | undefined>;

export const STAFF_TEXT_PAUSE_KEY = "staff_text_pause";
export const STAFF_TEXT_PAUSE_SETTINGS_KEY = "staff_text_pause";
export const STAFF_TEXT_PAUSE_TABLE = "bot_text_pauses";
export const STAFF_TEXT_PAUSE_DEFAULT_HOURS = 48;
export const STAFF_TEXT_PAUSE_MAX_DAYS = 14;
/** How far back a delivered Quo text is matched to our log by recipient + wording. */
export const OWN_LOG_MATCH_WINDOW_MS = 30 * 60 * 1000;
/** outbound_messages kinds that are a person on the team texting from the site. */
export const STAFF_SITE_KINDS: readonly string[] = ["staff_message"];
const AUTOMATED_MARKER = /reply\s+stop\s+to\s+opt[\s-]*out/i;

export type StaffTextPauseSettings = { hours: number; staffUserIds: string[]; botUserIds: string[] };
export type PauseState =
  | { paused: true; until: string; since: string | null; reason: string; source: string | null }
  | { paused: false }
  | "unavailable";

export function phoneKey(phone: string | null | undefined): string | null {
  const d = String(phone ?? "").replace(/\D/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  return ten.length === 10 ? ten : null;
}

function tableMissing(err: any): boolean {
  const code = String(err?.code ?? "");
  const msg = String(err?.message ?? "");
  return code === "42P01" || code === "PGRST205" || (msg.includes(STAFF_TEXT_PAUSE_TABLE) && /does not exist|not find/i.test(msg));
}

const ids = (v: unknown): string[] =>
  (Array.isArray(v) ? v : []).map((x) => String(x ?? "").trim()).filter((x) => /^[A-Z]{2,4}[A-Za-z0-9]+$/.test(x));

export function readStaffTextPauseSettings(value: unknown): StaffTextPauseSettings {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const h = Number(v.hours);
  const hours = Number.isFinite(h) && h >= 1 && h <= STAFF_TEXT_PAUSE_MAX_DAYS * 24 ? Math.round(h) : STAFF_TEXT_PAUSE_DEFAULT_HOURS;
  return { hours, staffUserIds: ids(v.staff_user_ids), botUserIds: ids(v.bot_user_ids) };
}

export async function loadStaffTextPauseSettings(admin: Admin): Promise<StaffTextPauseSettings> {
  try {
    const { data, error } = await admin.from("app_settings").select("value").eq("key", STAFF_TEXT_PAUSE_SETTINGS_KEY).maybeSingle();
    if (error) return readStaffTextPauseSettings(null);
    return readStaffTextPauseSettings(data?.value);
  } catch {
    return readStaffTextPauseSettings(null);
  }
}

// ------------------------------------------------------------------ read

/**
 * Is bot outreach to this phone paused right now? "unavailable" = the table
 * exists but could not be read (callers hold the message, like the payment
 * pause). A missing table, or no phone, is "not paused".
 */
export async function activeStaffTextPause(admin: Admin, phone: string | null | undefined, now: Date = new Date()): Promise<PauseState> {
  const key = phoneKey(phone);
  if (!key) return { paused: false };
  try {
    const res = await admin.from(STAFF_TEXT_PAUSE_TABLE)
      .select("phone_key,paused_until,reason,source,last_staff_text_at,created_at,cleared_at")
      .eq("phone_key", key)
      .limit(1);
    if (res.error) return tableMissing(res.error) ? { paused: false } : "unavailable";
    const row = (Array.isArray(res.data) ? res.data : res.data ? [res.data] : [])[0];
    if (!row || row.cleared_at) return { paused: false };
    const until = Date.parse(String(row.paused_until ?? ""));
    if (!Number.isFinite(until) || until <= now.getTime()) return { paused: false };
    return { paused: true, until: new Date(until).toISOString(), since: row.last_staff_text_at ?? row.created_at ?? null, reason: String(row.reason ?? "staff_text"), source: row.source ?? null };
  } catch {
    return "unavailable";
  }
}

/**
 * Phone keys (last 10 digits) with a pause on right now, for batch senders.
 * Missing table = empty set; any other read error = "unavailable".
 */
export async function activePauseKeys(admin: Admin, now: Date = new Date()): Promise<Set<string> | "unavailable"> {
  try {
    const res = await admin.from(STAFF_TEXT_PAUSE_TABLE)
      .select("phone_key,paused_until,cleared_at")
      .is("cleared_at", null)
      .limit(5000);
    if (res.error) return tableMissing(res.error) ? new Set() : "unavailable";
    return new Set((res.data ?? []).filter((r: any) => !r.cleared_at && Date.parse(String(r.paused_until)) > now.getTime()).map((r: any) => String(r.phone_key)));
  } catch {
    return "unavailable";
  }
}

/** The phone on file for a lead, for callers that only hold an application id. */
export async function phoneForLead(admin: Admin, applicationId: string | null | undefined): Promise<string | null | "unavailable"> {
  if (!applicationId) return null;
  try {
    const r = await admin.from("applications").select("id,phone").eq("id", applicationId).maybeSingle();
    if (r.error) return "unavailable";
    return r.data?.phone ? String(r.data.phone) : null;
  } catch {
    return "unavailable";
  }
}

/** Pause for a lead (by its phone on file). */
export async function activeStaffTextPauseForLead(admin: Admin, applicationId: string | null | undefined, now: Date = new Date()): Promise<PauseState> {
  const phone = await phoneForLead(admin, applicationId);
  if (phone === "unavailable") return "unavailable";
  return activeStaffTextPause(admin, phone, now);
}

/** True when the sender must hold: paused, or the pause could not be read. */
export function holds(p: PauseState): boolean {
  return p === "unavailable" || p.paused === true;
}

// ------------------------------------------------------------------ classify

export type OutboundVerdict = { verdict: "staff" | "bot" | "unknown"; why: string; userId: string | null };

/**
 * Pure part of the decision, for one delivered outgoing text. `ownLogKind` is
 * the outbound_messages kind of the matching log row (undefined = no match).
 */
export function decideOutbound(input: { ownLogKind?: string | null | undefined; ownLogMatched: boolean; userId: unknown; body: unknown; settings: StaffTextPauseSettings }): OutboundVerdict {
  const userId = typeof input.userId === "string" && input.userId.trim() ? input.userId.trim() : null;
  if (input.ownLogMatched) {
    return STAFF_SITE_KINDS.includes(String(input.ownLogKind ?? ""))
      ? { verdict: "staff", why: "site staff text (our log)", userId }
      : { verdict: "bot", why: `site automated text (our log, kind ${input.ownLogKind ?? "none"})`, userId };
  }
  if (!userId || !/^US/.test(userId)) return { verdict: "bot", why: "no Quo user, or a Quo system actor", userId };
  if (input.settings.botUserIds.includes(userId)) return { verdict: "bot", why: "Quo user listed as a bot", userId };
  if (AUTOMATED_MARKER.test(String(input.body ?? ""))) return { verdict: "bot", why: "automated wording (Reply STOP to opt out)", userId };
  if (input.settings.staffUserIds.length) {
    return input.settings.staffUserIds.includes(userId)
      ? { verdict: "staff", why: "Quo user listed as staff", userId }
      : { verdict: "unknown", why: "Quo user not on the staff list", userId };
  }
  if (input.settings.botUserIds.length) return { verdict: "staff", why: "a Quo user who is not a bot", userId };
  return { verdict: "unknown", why: "staff/bot Quo users not configured", userId };
}

/** Our outbound_messages row for this delivered Quo text, if any (id first, then recipient + wording). */
export async function ownLogMatch(admin: Admin, input: { messageId: string | null; to: string; body: string; now: Date }): Promise<{ matched: boolean; kind: string | null } | "unavailable"> {
  try {
    if (input.messageId) {
      const r = await admin.from("outbound_messages").select("id,kind").eq("provider", "quo").eq("provider_message_id", input.messageId).limit(1);
      if (r.error) return "unavailable";
      const row = (r.data ?? [])[0];
      if (row) return { matched: true, kind: row.kind ?? null };
    }
    if (!input.body) return { matched: false, kind: null };
    const since = new Date(input.now.getTime() - OWN_LOG_MATCH_WINDOW_MS).toISOString();
    // The row is written as "queued" before Quo is called, so a delivery that
    // beats the id update still matches here. Skipped/failed rows never went out.
    const r = await admin.from("outbound_messages").select("id,kind,status,provider")
      .eq("channel", "sms").eq("to_address", input.to).eq("body", input.body)
      .in("status", ["queued", "sent"]).gte("created_at", since).limit(5);
    if (r.error) return "unavailable";
    const row = (r.data ?? []).find((x: any) => !String(x.kind ?? "").startsWith("inbound_") && (x.provider == null || x.provider === "quo"));
    return row ? { matched: true, kind: row.kind ?? null } : { matched: false, kind: null };
  } catch {
    return "unavailable";
  }
}

export type QuoOutboundResult = {
  handled: boolean;
  verdict?: OutboundVerdict["verdict"];
  why?: string;
  paused?: string[];
  skipped?: string;
};

/**
 * Webhook hook: a delivered outgoing text on one of our lines. Pauses bot
 * outreach to the recipient when it was a staff text and the switch is On.
 * Never throws; a read failure means "do not pause" (the bots keep today's
 * behaviour rather than silently stopping).
 */
export async function handleQuoOutbound(
  admin: Admin,
  event: any,
  line: { id: string; e164: string },
  deps: { now?: Date; gate?: (admin: Admin) => Promise<"send" | "off" | "held">; settings?: StaffTextPauseSettings; toE164: (s: string | null | undefined) => string | null },
): Promise<QuoOutboundResult> {
  try {
    const type = String(event?.type ?? "");
    const r = event?.data?.resource ?? {};
    const c = event?.data?.context ?? {};
    if (type !== "message.delivered") return { handled: false };
    if (r.direction && r.direction !== "outgoing") return { handled: false };
    const gate = await (deps.gate ?? defaultGate)(admin).catch(() => "held" as const);
    if (gate !== "send") return { handled: true, skipped: gate === "off" ? "switched_off" : "controls_unreadable" };
    const now = deps.now ?? new Date();
    const recips: string[] = [];
    for (const x of [...(Array.isArray(c.recipientIdentifiers) ? c.recipientIdentifiers : []), ...(Array.isArray(r.to) ? r.to : [r.to])]) {
      const e = deps.toE164(typeof x === "string" ? x : null);
      if (e && e !== line.e164 && !recips.includes(e)) recips.push(e);
    }
    if (!recips.length) return { handled: true, skipped: "no_recipient" };
    const settings = deps.settings ?? (await loadStaffTextPauseSettings(admin));
    const body = String(r.text ?? r.body ?? "");
    const messageId = typeof r.id === "string" && r.id ? r.id : null;
    const paused: string[] = [];
    let last: OutboundVerdict | null = null;
    for (const to of recips) {
      const own = await ownLogMatch(admin, { messageId, to, body, now });
      if (own === "unavailable") return { handled: true, skipped: "log_unreadable" };
      const v = decideOutbound({ ownLogMatched: own.matched, ownLogKind: own.kind, userId: c.userId ?? r.userId, body, settings });
      last = v;
      if (v.verdict !== "staff") continue;
      const ok = await setStaffTextPause(admin, {
        phone: to, hours: settings.hours, source: own.matched ? "site_staff_text" : "quo_staff_text",
        reason: "staff_text", quoEventId: typeof event?.id === "string" ? event.id : null, quoUserId: v.userId, lineE164: line.e164, by: v.userId ?? "staff",
      }, now);
      if (ok) paused.push(to);
    }
    return { handled: true, verdict: last?.verdict, why: last?.why, paused };
  } catch (e) {
    console.error("[staff-text-pause] could not evaluate outgoing text", e);
    return { handled: true, skipped: "error" };
  }
}

async function defaultGate(admin: Admin): Promise<"send" | "off" | "held"> {
  const { gateFor, loadAutomationControls } = await import("@/lib/automation-controls.server");
  return gateFor(await loadAutomationControls(admin), STAFF_TEXT_PAUSE_KEY);
}

// ------------------------------------------------------------------ write

/** Newest non-deleted application on this phone (last 10 digits), for display only. */
async function leadForPhone(admin: Admin, key: string): Promise<string | null> {
  try {
    const { matchLeadByPhone } = await import("@/lib/quo-events.server");
    return await matchLeadByPhone(admin, `+1${key}`);
  } catch {
    return null;
  }
}

/**
 * Start or extend a pause: paused_until = the later of the current end and
 * now + hours (capped at STAFF_TEXT_PAUSE_MAX_DAYS). Clears an earlier "cleared".
 * Returns false when the table is missing or the write failed.
 */
export async function setStaffTextPause(
  admin: Admin,
  input: { phone: string; hours: number; reason: string; source: string; by: string; quoEventId?: string | null; quoUserId?: string | null; lineE164?: string | null; applicationId?: string | null },
  now: Date = new Date(),
): Promise<boolean> {
  const key = phoneKey(input.phone);
  if (!key) return false;
  const hours = Math.min(Math.max(1, Math.round(input.hours || STAFF_TEXT_PAUSE_DEFAULT_HOURS)), STAFF_TEXT_PAUSE_MAX_DAYS * 24);
  const target = new Date(now.getTime() + hours * 3600_000);
  try {
    const cur = await admin.from(STAFF_TEXT_PAUSE_TABLE).select("phone_key,paused_until,cleared_at,application_id").eq("phone_key", key).limit(1);
    if (cur.error) {
      if (!tableMissing(cur.error)) console.error("[staff-text-pause] read failed", cur.error.message);
      return false;
    }
    const row = (cur.data ?? [])[0];
    const curUntil = row && !row.cleared_at ? Date.parse(String(row.paused_until ?? "")) : NaN;
    const until = Number.isFinite(curUntil) && curUntil > target.getTime() ? new Date(curUntil) : target;
    const applicationId = input.applicationId ?? row?.application_id ?? (await leadForPhone(admin, key));
    const patch = {
      phone_e164: `+1${key}`,
      application_id: applicationId,
      paused_until: until.toISOString(),
      reason: input.reason,
      source: input.source,
      last_staff_text_at: input.reason === "staff_text" ? now.toISOString() : undefined,
      quo_event_id: input.quoEventId ?? null,
      quo_user_id: input.quoUserId ?? null,
      line_e164: input.lineE164 ?? null,
      set_by: input.by,
      cleared_at: null,
      cleared_by: null,
      updated_at: now.toISOString(),
    };
    const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    if (row) {
      const u = await admin.from(STAFF_TEXT_PAUSE_TABLE).update(clean).eq("phone_key", key);
      if (u.error) { console.error("[staff-text-pause] update failed", u.error.message); return false; }
      return true;
    }
    const ins = await admin.from(STAFF_TEXT_PAUSE_TABLE).insert({ phone_key: key, ...clean });
    if (ins.error) {
      if (String(ins.error.code) === "23505") {
        const u = await admin.from(STAFF_TEXT_PAUSE_TABLE).update(clean).eq("phone_key", key);
        return !u.error;
      }
      if (!tableMissing(ins.error)) console.error("[staff-text-pause] insert failed", ins.error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[staff-text-pause] write failed", e);
    return false;
  }
}

/** Staff: end a pause now. */
export async function clearStaffTextPause(admin: Admin, phone: string, by: string, now: Date = new Date()): Promise<boolean> {
  const key = phoneKey(phone);
  if (!key) return false;
  const u = await admin.from(STAFF_TEXT_PAUSE_TABLE).update({ cleared_at: now.toISOString(), cleared_by: by, updated_at: now.toISOString() }).eq("phone_key", key);
  if (u.error) throw new Error(tableMissing(u.error) ? "The bot pause table is not installed yet." : u.error.message);
  return true;
}

// ------------------------------------------------------------------ sendSms backstop

/**
 * outbound_messages kinds that are automatic bot outreach. sendSms refuses
 * these while a pause is on, as a backstop behind each sender's own check.
 * Staff texts, receipts, team alerts, roadside replies, STOP/HELP replies and
 * staff-triggered sends (agreement, activation, vehicle share) are not here.
 */
export function isBotOutreachKind(kind: string | null | undefined): boolean {
  const k = String(kind ?? "");
  return k === "automation"
    || k.startsWith("missing_items")
    || k.startsWith("rent_reminder_")
    || k === "payment_failed"
    || k.startsWith("pickup_reminder_")
    || k.startsWith("agreement_sign_")
    || k.startsWith("fleet_")
    || k === "late_pickup_release";
}
