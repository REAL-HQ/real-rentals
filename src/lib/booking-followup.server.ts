/**
 * Reads the follow-up list. The first action is the flag refusal, before any
 * database read. This file does not insert, update, or send.
 */
import {
  assertBookingFollowupEnabled,
  buildBookingFollowups,
  isSentDelivery,
  takeUnbooked,
  type BookingFollowupList,
  type FollowupApplication,
  type FollowupRental,
  type FollowupStamp,
} from "@/lib/booking-followup";

const CANDIDATE_LIMIT = 200;
const PAGE = 200;
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
  for (let from = 0; kept.length < CANDIDATE_LIMIT; from += PAGE) {
    const page =
      mode === "approved"
        ? await admin
            .from("applications")
            .select(CANDIDATE_COLUMNS)
            .is("deleted_at", null)
            .eq("status", "approved")
            .order("updated_at", { ascending: false })
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

async function latestContact(admin: Admin, applicationId: string): Promise<FollowupStamp | null> {
  const message = await admin
    .from("messages")
    .select("created_at,delivery_state")
    .eq("application_id", applicationId)
    .eq("direction", "outbound")
    .in("delivery_state", ["accepted", "sent", "delivered"])
    .order("created_at", { ascending: false })
    .limit(1);
  if (message.error) throw new Error(message.error.message);
  const outbound = await admin
    .from("outbound_messages")
    .select("sent_at,created_at,status")
    .eq("application_id", applicationId)
    .in("status", ["sent", "delivered"])
    .order("created_at", { ascending: false })
    .limit(1);
  if (outbound.error) throw new Error(outbound.error.message);

  const marks: FollowupStamp[] = [];
  const sent = message.data?.[0];
  if (sent && isSentDelivery(sent.delivery_state) && text(sent.created_at)) {
    marks.push({ applicationId, at: text(sent.created_at) as string, source: "message" });
  }
  const logged = outbound.data?.[0];
  const loggedAt = logged ? text(logged.sent_at) ?? text(logged.created_at) : null;
  if (logged && isSentDelivery(logged.status) && loggedAt) {
    marks.push({ applicationId, at: loggedAt, source: "message" });
  }
  marks.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return marks[0] ?? null;
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

  const ids = applications.map((app) => app.id);
  const approvalsQuery = await supabaseAdmin
    .from("audit_log")
    .select("entity_id,created_at")
    .eq("action", "application.approved")
    .eq("entity_type", "application")
    .in("entity_id", ids)
    .order("created_at", { ascending: true })
    .limit(READ_CAP + 1);
  if (approvalsQuery.error) throw new Error(approvalsQuery.error.message);
  const approvalRows = approvalsQuery.data ?? [];
  refuseIfTruncated(approvalRows.length);
  const approvals: FollowupStamp[] = approvalRows.map((row) => ({
    applicationId: String(row.entity_id ?? ""),
    at: String(row.created_at ?? ""),
  }));

  const contacts: FollowupStamp[] = [];
  for (const id of ids) {
    const latest = await latestContact(supabaseAdmin, id);
    if (latest) contacts.push(latest);
  }

  return {
    rows: buildBookingFollowups({
      applications,
      rentals: [],
      approvals,
      contacts,
      now,
      portalUrl: portalUrl(),
    }),
  };
}
