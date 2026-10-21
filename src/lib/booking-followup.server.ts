/**
 * Reads the follow-up list. The first action is the flag refusal, before any
 * database read. This file does not insert, update, or send.
 */
import {
  assertBookingFollowupEnabled,
  buildBookingFollowups,
  isSentDelivery,
  type BookingFollowupList,
  type FollowupApplication,
  type FollowupRental,
  type FollowupStamp,
} from "@/lib/booking-followup";

const CANDIDATE_LIMIT = 200;
const CONTACT_LIMIT = 2000;

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

export async function loadBookingFollowups(now = new Date()): Promise<BookingFollowupList> {
  assertBookingFollowupEnabled();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const approved = await supabaseAdmin
    .from("applications")
    .select(CANDIDATE_COLUMNS)
    .is("deleted_at", null)
    .eq("status", "approved")
    .order("updated_at", { ascending: false })
    .limit(CANDIDATE_LIMIT);
  if (approved.error) throw new Error(approved.error.message);

  const verified = await supabaseAdmin
    .from("applications")
    .select(CANDIDATE_COLUMNS)
    .is("deleted_at", null)
    .in("status", ["new", "complete", "reviewing"])
    .eq("background_check_status", "passed")
    .eq("mvr_status", "passed")
    .eq("rideshare_history_status", "passed")
    .eq("earnings_verified_status", "passed")
    .order("updated_at", { ascending: false })
    .limit(CANDIDATE_LIMIT);
  if (verified.error) throw new Error(verified.error.message);

  const byId = new Map<string, FollowupApplication>();
  for (const row of [...(approved.data ?? []), ...(verified.data ?? [])]) {
    const app = asApplication(row as Record<string, unknown>);
    if (app.id) byId.set(app.id, app);
  }
  const applications = [...byId.values()];
  if (applications.length === 0) return { rows: [] };

  const ids = applications.map((app) => app.id);
  const userIds = [...new Set(applications.map((app) => app.userId).filter((id): id is string => !!id))];

  const byApplication = await supabaseAdmin
    .from("rentals")
    .select("application_id,driver_id")
    .in("application_id", ids);
  if (byApplication.error) throw new Error(byApplication.error.message);

  const byDriver = userIds.length
    ? await supabaseAdmin.from("rentals").select("application_id,driver_id").in("driver_id", userIds)
    : { data: [], error: null };
  if (byDriver.error) throw new Error(byDriver.error.message);

  const rentals: FollowupRental[] = [...(byApplication.data ?? []), ...(byDriver.data ?? [])].map((row) => ({
    applicationId: text((row as { application_id?: unknown }).application_id),
    driverId: text((row as { driver_id?: unknown }).driver_id),
  }));

  const approvalsQuery = await supabaseAdmin
    .from("audit_log")
    .select("entity_id,created_at")
    .eq("action", "application.approved")
    .eq("entity_type", "application")
    .in("entity_id", ids);
  if (approvalsQuery.error) throw new Error(approvalsQuery.error.message);
  const approvals: FollowupStamp[] = (approvalsQuery.data ?? []).map((row) => ({
    applicationId: String((row as { entity_id?: unknown }).entity_id ?? ""),
    at: String((row as { created_at?: unknown }).created_at ?? ""),
  }));

  const messages = await supabaseAdmin
    .from("messages")
    .select("application_id,created_at,delivery_state,direction")
    .in("application_id", ids)
    .eq("direction", "outbound")
    .in("delivery_state", ["accepted", "sent", "delivered"])
    .order("created_at", { ascending: false })
    .limit(CONTACT_LIMIT);
  if (messages.error) throw new Error(messages.error.message);

  const outbound = await supabaseAdmin
    .from("outbound_messages")
    .select("application_id,sent_at,created_at,status")
    .in("application_id", ids)
    .in("status", ["sent", "delivered"])
    .order("created_at", { ascending: false })
    .limit(CONTACT_LIMIT);
  if (outbound.error) throw new Error(outbound.error.message);

  const contacts: FollowupStamp[] = [];
  for (const row of messages.data ?? []) {
    const record = row as { application_id?: unknown; created_at?: unknown; delivery_state?: unknown };
    if (!isSentDelivery(typeof record.delivery_state === "string" ? record.delivery_state : null)) continue;
    const at = text(record.created_at);
    const applicationId = text(record.application_id);
    if (!at || !applicationId) continue;
    contacts.push({ applicationId, at, source: "message" });
  }
  for (const row of outbound.data ?? []) {
    const record = row as { application_id?: unknown; sent_at?: unknown; created_at?: unknown; status?: unknown };
    if (!isSentDelivery(typeof record.status === "string" ? record.status : null)) continue;
    const at = text(record.sent_at) ?? text(record.created_at);
    const applicationId = text(record.application_id);
    if (!at || !applicationId) continue;
    contacts.push({ applicationId, at, source: "message" });
  }

  return {
    rows: buildBookingFollowups({
      applications,
      rentals,
      approvals,
      contacts,
      now,
      portalUrl: portalUrl(),
    }),
  };
}
