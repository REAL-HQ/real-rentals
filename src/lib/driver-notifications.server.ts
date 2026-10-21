/**
 * Loads the renter for a committed rental, incident, or issue, then delivers
 * through the activation channels. Every public function returns before a
 * database read or a send while DRIVER_NOTIFICATIONS_ENABLED is not true.
 *
 * notifyRentalEnded is for the moment end_rental_tx has committed.
 * notifyIncidentOpened is for a newly inserted incident that names a renter.
 * notifyIssueStatusChanged is called from updateDriverIssueStatus, and only
 * from inside that flag check. An incident with no application is not the
 * renter's notice.
 */
import {
  DRIVER_NOTIFICATIONS_ENABLED,
  deliverDriverNotice,
  incidentOpenedNotice,
  issueStatusChangedNotice,
  noticeChannels,
  noticeHeld,
  noticeWithoutRenter,
  rentalEndedNotice,
  type DriverNotice,
  type DriverNoticeResult,
  type RenterContact,
} from "@/lib/driver-notifications";

type ApplicationRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  user_id: string | null;
};

function contact(row: ApplicationRow, rentalId: string | null, driverId: string | null): RenterContact {
  const name = String(row.full_name ?? "").trim().split(/\s+/)[0] || "there";
  return {
    firstName: name,
    email: row.email,
    phone: row.phone,
    applicationId: row.id,
    driverId: row.user_id || driverId,
    rentalId,
  };
}

async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function applicationById(applicationId: string | null): Promise<ApplicationRow | null> {
  if (!applicationId) return null;
  const admin = await db();
  const { data } = await admin
    .from("applications")
    .select("id,full_name,email,phone,user_id")
    .eq("id", applicationId)
    .maybeSingle();
  return (data as ApplicationRow | null) ?? null;
}

async function applicationForDriver(driverId: string | null): Promise<ApplicationRow | null> {
  if (!driverId) return null;
  const admin = await db();
  const { data } = await admin
    .from("applications")
    .select("id,full_name,email,phone,user_id")
    .eq("user_id", driverId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as ApplicationRow | null) ?? null;
}

async function vehicleLabel(vehicleId: string | null): Promise<string> {
  if (!vehicleId) return "your vehicle";
  const admin = await db();
  const { data } = await admin.from("vehicles").select("year,make,model").eq("id", vehicleId).maybeSingle();
  const label = [data?.year, data?.make, data?.model].filter(Boolean).join(" ");
  return label || "your vehicle";
}

function statusLabel(status: string): string {
  const raw = status.trim().toLowerCase();
  if (raw === "resolved") return "Resolved";
  if (raw === "closed") return "Closed";
  if (raw === "open") return "Open";
  return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : "Updated";
}

export async function notifyRentalEnded(rentalId: string): Promise<DriverNoticeResult> {
  if (DRIVER_NOTIFICATIONS_ENABLED !== true) return noticeHeld();
  const admin = await db();
  const { data: rental } = await admin
    .from("rentals")
    .select("id,application_id,driver_id,vehicle_id")
    .eq("id", rentalId)
    .maybeSingle();
  if (!rental) return noticeWithoutRenter();
  const app = (await applicationById(rental.application_id as string | null)) ?? (await applicationForDriver(rental.driver_id as string | null));
  if (!app) return noticeWithoutRenter();
  const notice = rentalEndedNotice({
    ...contact(app, rental.id as string, rental.driver_id as string | null),
    vehicleLabel: await vehicleLabel(rental.vehicle_id as string | null),
  });
  return deliverDriverNotice(notice, { send: sendDriverNoticeChannels });
}

export async function notifyIncidentOpened(incidentId: string): Promise<DriverNoticeResult> {
  if (DRIVER_NOTIFICATIONS_ENABLED !== true) return noticeHeld();
  const admin = await db();
  const { data: incident } = await admin
    .from("incidents")
    .select("id,application_id,rental_id,incident_type")
    .eq("id", incidentId)
    .maybeSingle();
  if (!incident) return noticeWithoutRenter();
  let applicationId = (incident.application_id as string | null) ?? null;
  let driverId: string | null = null;
  if (!applicationId && incident.rental_id) {
    const { data: rental } = await admin
      .from("rentals")
      .select("application_id,driver_id")
      .eq("id", incident.rental_id)
      .maybeSingle();
    applicationId = (rental?.application_id as string | null) ?? null;
    driverId = (rental?.driver_id as string | null) ?? null;
  }
  const app = (await applicationById(applicationId)) ?? (await applicationForDriver(driverId));
  if (!app) return noticeWithoutRenter();
  const notice = incidentOpenedNotice({
    ...contact(app, (incident.rental_id as string | null) ?? null, driverId),
    incidentType: String(incident.incident_type ?? "incident"),
  });
  return deliverDriverNotice(notice, { send: sendDriverNoticeChannels });
}

export async function notifyIssueStatusChanged(issueId: string): Promise<DriverNoticeResult> {
  if (DRIVER_NOTIFICATIONS_ENABLED !== true) return noticeHeld();
  const admin = await db();
  const { data: issue } = await admin
    .from("issues")
    .select("id,title,status,driver_id,rental_id")
    .eq("id", issueId)
    .maybeSingle();
  if (!issue) return noticeWithoutRenter();
  let applicationId: string | null = null;
  if (issue.rental_id) {
    const { data: rental } = await admin.from("rentals").select("application_id").eq("id", issue.rental_id).maybeSingle();
    applicationId = (rental?.application_id as string | null) ?? null;
  }
  const app = (await applicationById(applicationId)) ?? (await applicationForDriver(issue.driver_id as string | null));
  if (!app) return noticeWithoutRenter();
  const notice = issueStatusChangedNotice({
    ...contact(app, (issue.rental_id as string | null) ?? null, issue.driver_id as string | null),
    issueTitle: String(issue.title ?? ""),
    statusLabel: statusLabel(String(issue.status ?? "")),
  });
  return deliverDriverNotice(notice, { send: sendDriverNoticeChannels });
}

type NoticeChannelDeps = {
  sendEmail?: (args: {
    to: string;
    subject: string;
    html: string;
    noticeTimeout?: boolean;
  }) => Promise<{ ok: boolean; error?: string }>;
  sendSms?: (args: {
    to: string;
    body: string;
    kind: DriverNotice["kind"];
    applicationId: string;
    rentalId: string | null;
    noticeTimeout?: boolean;
  }) => Promise<{ ok: boolean; skipped?: boolean }>;
  insertInApp?: (row: {
    driver_id: string;
    kind: DriverNotice["kind"];
    title: string;
    body: string;
    channels: Array<"in_app" | "email">;
  }) => Promise<{ error: { message: string } | null }>;
};

/**
 * Activation's three channels. Consent for SMS stays inside sendSms.
 * The flag is checked here as well as in the loaders, so a direct call
 * does not send while notifications are off.
 */
export async function sendDriverNoticeChannels(
  notice: DriverNotice,
  deps: NoticeChannelDeps = {},
): Promise<DriverNoticeResult> {
  if (DRIVER_NOTIFICATIONS_ENABLED !== true) return noticeHeld();
  return deliverDriverNoticeChannels(notice, deps);
}

/** Channel delivery after the flag has already allowed it. Tests call this with stubs. */
export async function deliverDriverNoticeChannels(
  notice: DriverNotice,
  deps: NoticeChannelDeps = {},
): Promise<DriverNoticeResult> {
  const result: DriverNoticeResult = { email: "skipped", sms: "skipped", inApp: "skipped", skipped: null };

  if (notice.email) {
    try {
      const sendEmail = deps.sendEmail ?? (await import("@/lib/email.server")).sendEmail;
      const r = await sendEmail({
        to: notice.email,
        subject: notice.emailSubject,
        html: notice.emailHtml,
        noticeTimeout: true,
      });
      if (!r.ok) {
        console.error("[driver-notifications] email failed", notice.kind, r.error ?? "not sent");
        result.email = "failed";
      } else {
        result.email = "sent";
      }
    } catch (err) {
      console.error("[driver-notifications] email failed", notice.kind, err);
      result.email = "failed";
    }
  }

  if (notice.phone && notice.applicationId) {
    try {
      const sendSms = deps.sendSms ?? (await import("@/lib/sms.server")).sendSms;
      const sms = await sendSms({
        to: notice.phone,
        body: notice.smsBody,
        kind: notice.kind,
        applicationId: notice.applicationId,
        rentalId: notice.rentalId,
        noticeTimeout: true,
      });
      result.sms = sms.ok ? "sent" : sms.skipped ? "skipped" : "failed";
    } catch (err) {
      console.error("[driver-notifications] sms failed", notice.kind, err);
      result.sms = "failed";
    }
  }

  if (notice.driverId) {
    try {
      const row = {
        driver_id: notice.driverId,
        kind: notice.kind,
        title: notice.title,
        body: notice.body,
        channels: noticeChannels(result.email),
      };
      const inserted = deps.insertInApp
        ? await deps.insertInApp(row)
        : await (await db()).from("notifications").insert(row);
      const { error } = inserted;
      if (error) {
        console.error("[driver-notifications] in-app failed", notice.kind, error.message);
        result.inApp = "failed";
      } else {
        result.inApp = "sent";
      }
    } catch (err) {
      console.error("[driver-notifications] in-app failed", notice.kind, err);
      result.inApp = "failed";
    }
  }

  return result;
}
