/**
 * Reads the follow-up list. The first action is the flag refusal, before any
 * database read. This file does not insert, update, or send.
 */
import {
  assertBookingFollowupEnabled,
  buildBookingFollowups,
  isApprovedStatus,
  isSentDelivery,
  takeUnbooked,
  type BookingFollowupList,
  type FollowupApplication,
  type FollowupRental,
  type FollowupStamp,
  type LastContactSource,
} from "@/lib/booking-followup";

const CANDIDATE_LIMIT = 200;
const PAGE = 200;
/** Stop scanning once this many pages have been read. Another full page means the list is incomplete. */
const PAGE_CAP = 20;
/** Latest contact is one batch per this many applications, not one query per row. */
const CONTACT_CHUNK = 50;
/**
 * PostgREST returns at most this many rows and drops the rest with no error.
 * The readable cap is one below that, so limit(READ_CAP + 1) is a row the
 * server can actually return. Receiving it means the list is incomplete.
 */
const POSTGREST_MAX_ROWS = 1000;
const READ_CAP = POSTGREST_MAX_ROWS - 1;

const CANDIDATE_COLUMNS =
  "id,full_name,email,phone,status,user_id,contact_status,contact_status_at,doc_request_sent_at,recovery_sent_at,recovery_email_sent_24h,recovery_email_sent_72h,background_check_status,mvr_status,rideshare_history_status,earnings_verified_status";

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asApplication(row: Record<string, unknown>): FollowupApplication {
  return {
    id: String(row.id ?? ""),
    fullName: typeof row.full_name === "string" ? row.full_name : "",
    email: text(row.email),
    phone: text(row.phone),
    status: typeof row.status === "string" ? row.status : "",
    userId: text(row.user_id),
    deletedAt: null,
    contactStatus: text(row.contact_status),
    contactStatusAt: text(row.contact_status_at),
    docRequestSentAt: text(row.doc_request_sent_at),
    recoverySentAt: text(row.recovery_sent_at),
    recoveryEmailSent24h: text(row.recovery_email_sent_24h),
    recoveryEmailSent72h: text(row.recovery_email_sent_72h),
    backgroundCheckStatus: text(row.background_check_status),
    mvrStatus: text(row.mvr_status),
    rideshareHistoryStatus: text(row.rideshare_history_status),
    earningsVerifiedStatus: text(row.earnings_verified_status),
  };
}

function portalUrl(): string {
  const origin = process.env.PUBLIC_SITE_URL || "https://drivereal.com";
  return `${origin.replace(/\/$/, "")}/portal`;
}

function refuseIfTruncated(count: number): void {
  if (count > READ_CAP) throw new Error("Booking follow-up could not be listed.");
}

function rentalOf(row: { application_id?: unknown; driver_id?: unknown }): FollowupRental {
  return { applicationId: text(row.application_id), driverId: text(row.driver_id) };
}

type Admin = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

async function rentalsFor(admin: Admin, apps: FollowupApplication[]): Promise<FollowupRental[]> {
  if (apps.length === 0) return [];
  const ids = apps.map((app) => app.id);
  const userIds = [...new Set(apps.map((app) => app.userId).filter((id): id is string => !!id))];
  const byApplication = await admin
    .from("rentals")
    .select("application_id,driver_id")
    .in("application_id", ids)
    .limit(READ_CAP + 1);
  if (byApplication.error) throw new Error(byApplication.error.message);
  const applicationRows = byApplication.data ?? [];
  refuseIfTruncated(applicationRows.length);

  const driverRows = userIds.length
    ? await admin.from("rentals").select("application_id,driver_id").in("driver_id", userIds).limit(READ_CAP + 1)
    : { data: [], error: null };
  if (driverRows.error) throw new Error(driverRows.error.message);
  const drivers = driverRows.data ?? [];
  refuseIfTruncated(drivers.length);
  return [...applicationRows, ...drivers].map((row) => rentalOf(row));
}

/** Booked rows are removed before this page counts toward the candidate cap. */
async function collectUnbooked(admin: Admin, mode: "approved" | "verified"): Promise<FollowupApplication[]> {
  const kept: FollowupApplication[] = [];
  for (let pageIndex = 0; kept.length < CANDIDATE_LIMIT; pageIndex += 1) {
    if (pageIndex >= PAGE_CAP) throw new Error("Booking follow-up could not be listed.");
    const from = pageIndex * PAGE;
    const page =
      mode === "approved"
        ? await admin
            .from("applications")
            .select(CANDIDATE_COLUMNS)
            .is("deleted_at", null)
            .eq("status", "approved")
            .order("updated_at", { ascending: false })
            .order("id", { ascending: true })
            .range(from, from + PAGE)
        : await admin
            .from("applications")
            .select(CANDIDATE_COLUMNS)
            .is("deleted_at", null)
            .in("status", ["new", "complete", "reviewing"])
            .eq("background_check_status", "passed")
            .eq("mvr_status", "passed")
            .eq("rideshare_history_status", "passed")
            .eq("earnings_verified_status", "passed")
            .order("updated_at", { ascending: false })
            .order("id", { ascending: true })
            .range(from, from + PAGE);
    if (page.error) throw new Error(page.error.message);
    const rows = (page.data ?? []) as Record<string, unknown>[];
    const more = rows.length > PAGE;
    const apps = rows.slice(0, PAGE).map(asApplication).filter((app) => app.id);
    const rentals = await rentalsFor(admin, apps);
    kept.push(...takeUnbooked(apps, rentals, CANDIDATE_LIMIT - kept.length));
    if (!more) break;
  }
  return kept;
}

function firstPerApplication<T extends { application_id?: unknown }>(
  rows: readonly T[],
  atFor: (row: T) => string | null,
): Map<string, string> {
  const best = new Map<string, string>();
  for (const row of rows) {
    const applicationId = text(row.application_id);
    if (!applicationId || best.has(applicationId)) continue;
    const at = atFor(row);
    if (at) best.set(applicationId, at);
  }
  return best;
}

type ContactMark = { at: string; source: LastContactSource };

function laterContact(left: ContactMark | null, right: ContactMark | null): ContactMark | null {
  if (!left) return right;
  if (!right) return left;
  return Date.parse(right.at) > Date.parse(left.at) ? right : left;
}

/** Newest-first rows already hold each listed application's latest. A cap only hides the rest. */
function keptNewest<T>(rows: readonly T[]): { kept: T[]; capped: boolean } {
  const capped = rows.length > READ_CAP;
  return { kept: capped ? rows.slice(0, READ_CAP) : [...rows], capped };
}

async function oneMessage(admin: Admin, applicationId: string): Promise<ContactMark | null | "unchecked"> {
  const message = await admin
    .from("messages")
    .select("application_id,created_at,delivery_state")
    .eq("application_id", applicationId)
    .eq("direction", "outbound")
    .in("delivery_state", ["accepted", "sent", "delivered"])
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1);
  if (message.error) return "unchecked";
  const row = message.data?.[0];
  if (!row || !isSentDelivery(row.delivery_state)) return null;
  const at = text(row.created_at);
  return at ? { at, source: "message" } : null;
}

async function oneOutbound(admin: Admin, applicationId: string): Promise<ContactMark | null | "unchecked"> {
  const outbound = await admin
    .from("outbound_messages")
    .select("application_id,sent_at,created_at,status")
    .eq("application_id", applicationId)
    .in("status", ["sent", "delivered"])
    .order("sent_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1);
  if (outbound.error) return "unchecked";
  const row = outbound.data?.[0];
  if (!row || !isSentDelivery(row.status)) return null;
  const at = text(row.sent_at) ?? text(row.created_at);
  return at ? { at, source: "outbound" } : null;
}

/**
 * Latest sent contact for each application, in batches.
 * A capped newest-first batch still has the true latest for every application it contains.
 * Applications missing from that batch are read again with limit(1). A failed re-read is
 * marked unchecked instead of failing the list.
 */
async function latestContacts(
  admin: Admin,
  ids: readonly string[],
): Promise<{ stamps: FollowupStamp[]; unchecked: string[] }> {
  const stamps: FollowupStamp[] = [];
  const unchecked: string[] = [];
  for (let index = 0; index < ids.length; index += CONTACT_CHUNK) {
    const chunk = ids.slice(index, index + CONTACT_CHUNK);
    const message = await admin
      .from("messages")
      .select("application_id,created_at,delivery_state")
      .in("application_id", chunk)
      .eq("direction", "outbound")
      .in("delivery_state", ["accepted", "sent", "delivered"])
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(READ_CAP + 1);
    if (message.error) throw new Error(message.error.message);
    const messages = keptNewest(message.data ?? []);

    const outbound = await admin
      .from("outbound_messages")
      .select("application_id,sent_at,created_at,status")
      .in("application_id", chunk)
      .in("status", ["sent", "delivered"])
      .order("sent_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(READ_CAP + 1);
    if (outbound.error) throw new Error(outbound.error.message);
    const outbounds = keptNewest(outbound.data ?? []);

    const messageAt = firstPerApplication(messages.kept, (row) =>
      isSentDelivery(row.delivery_state) ? text(row.created_at) : null,
    );
    const outboundAt = firstPerApplication(outbounds.kept, (row) =>
      isSentDelivery(row.status) ? text(row.sent_at) ?? text(row.created_at) : null,
    );
    for (const applicationId of chunk) {
      let messageMark: ContactMark | null = null;
      const messageSeen = messageAt.get(applicationId);
      if (messageSeen) messageMark = { at: messageSeen, source: "message" };
      else if (messages.capped) {
        const again = await oneMessage(admin, applicationId);
        if (again === "unchecked") {
          unchecked.push(applicationId);
          continue;
        }
        messageMark = again;
      }

      let outboundMark: ContactMark | null = null;
      const outboundSeen = outboundAt.get(applicationId);
      if (outboundSeen) outboundMark = { at: outboundSeen, source: "outbound" };
      else if (outbounds.capped) {
        const again = await oneOutbound(admin, applicationId);
        if (again === "unchecked") {
          unchecked.push(applicationId);
          continue;
        }
        outboundMark = again;
      }

      const at = laterContact(messageMark, outboundMark);
      if (at) stamps.push({ applicationId, at: at.at, source: at.source });
    }
  }
  return { stamps, unchecked };
}

/** Oldest approval per application. A capped chunk re-reads the missing ids one at a time. */
async function approvalStamps(
  admin: Admin,
  approvedIds: readonly string[],
): Promise<{ stamps: FollowupStamp[]; truncated: boolean }> {
  const stamps: FollowupStamp[] = [];
  let truncated = false;
  for (let index = 0; index < approvedIds.length; index += CONTACT_CHUNK) {
    const chunk = approvedIds.slice(index, index + CONTACT_CHUNK);
    const approvalsQuery = await admin
      .from("audit_log")
      .select("entity_id,created_at")
      .eq("action", "application.approved")
      .eq("entity_type", "application")
      .in("entity_id", chunk)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(READ_CAP + 1);
    if (approvalsQuery.error) throw new Error(approvalsQuery.error.message);
    const rows = approvalsQuery.data ?? [];
    const capped = rows.length > READ_CAP;
    const seen = new Set<string>();
    for (const row of capped ? rows.slice(0, READ_CAP) : rows) {
      const applicationId = String(row.entity_id ?? "");
      if (!applicationId || seen.has(applicationId)) continue;
      seen.add(applicationId);
      stamps.push({ applicationId, at: String(row.created_at ?? "") });
    }
    if (!capped) continue;
    for (const applicationId of chunk) {
      if (seen.has(applicationId)) continue;
      const one = await admin
        .from("audit_log")
        .select("entity_id,created_at")
        .eq("action", "application.approved")
        .eq("entity_type", "application")
        .eq("entity_id", applicationId)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .limit(1);
      if (one.error) {
        truncated = true;
        continue;
      }
      // An empty re-read means this application has no approval audit row. That is not a truncated page.
      const row = one.data?.[0];
      if (!row) continue;
      stamps.push({ applicationId, at: String(row.created_at ?? "") });
    }
  }
  return { stamps, truncated };
}

export async function loadBookingFollowups(now = new Date()): Promise<BookingFollowupList> {
  assertBookingFollowupEnabled();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const approved = await collectUnbooked(supabaseAdmin, "approved");
  const verified = await collectUnbooked(supabaseAdmin, "verified");
  const byId = new Map<string, FollowupApplication>();
  for (const app of [...approved, ...verified]) byId.set(app.id, app);
  const applications = [...byId.values()];
  if (applications.length === 0) return { rows: [] };

  const approvedIds = applications.filter((app) => isApprovedStatus(app.status)).map((app) => app.id);
  const approvals = approvedIds.length > 0 ? await approvalStamps(supabaseAdmin, approvedIds) : { stamps: [], truncated: false };

  const contacts = await latestContacts(
    supabaseAdmin,
    applications.map((app) => app.id),
  );

  return {
    truncated: approvals.truncated || contacts.unchecked.length > 0,
    rows: buildBookingFollowups({
      applications,
      rentals: [],
      approvals: approvals.stamps,
      contacts: contacts.stamps,
      uncheckedContacts: contacts.unchecked,
      now,
      portalUrl: portalUrl(),
    }),
  };
}
