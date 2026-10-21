/**
 * Renter notices for the end of a rental, an incident opened on that rental,
 * and a driver-issue status change.
 *
 * The flag is a hard false constant. While it is off, deliverDriverNotice
 * returns before any sender runs, and the server loaders are not called.
 * Email, SMS, and the in-app notifications row are the same three paths
 * activation already uses (sendEmail, sendSms, notifications insert).
 * SMS consent stays inside sendSms.
 */
export const DRIVER_NOTIFICATIONS_ENABLED: boolean = false as boolean;

export type DriverNoticeKind = "rental_ended" | "incident_opened" | "issue_status_changed";

export type DriverNotice = {
  kind: DriverNoticeKind;
  applicationId: string;
  driverId: string | null;
  rentalId: string | null;
  email: string | null;
  phone: string | null;
  title: string;
  body: string;
  smsBody: string;
  emailSubject: string;
  emailHtml: string;
};

export type DriverNoticeResult = {
  email: "sent" | "skipped" | "failed";
  sms: "sent" | "skipped" | "failed";
  inApp: "sent" | "skipped" | "failed";
  skipped: "flag" | "no_renter" | null;
};

export type NoticeSender = (notice: DriverNotice) => Promise<DriverNoticeResult>;

export type NoticeDeps = {
  send?: NoticeSender;
};

export const NOTICE_HELD: DriverNoticeResult = {
  email: "skipped",
  sms: "skipped",
  inApp: "skipped",
  skipped: "flag",
};

const NO_RENTER: DriverNoticeResult = {
  email: "skipped",
  sms: "skipped",
  inApp: "skipped",
  skipped: "no_renter",
};

export function noticeHeld(): DriverNoticeResult {
  return NOTICE_HELD;
}

export function noticeWithoutRenter(): DriverNoticeResult {
  return NO_RENTER;
}

/** The in-app row lists email only after that channel was actually sent. */
export function noticeChannels(email: DriverNoticeResult["email"]): Array<"in_app" | "email"> {
  return email === "sent" ? ["in_app", "email"] : ["in_app"];
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function firstName(value: string): string {
  const name = value.trim().split(/\s+/)[0];
  return name || "there";
}

function portalUrl(): string {
  const origin = process.env.PUBLIC_SITE_URL || "https://drivereal.com";
  return `${origin.replace(/\/$/, "")}/portal`;
}

function letter(heading: string, paragraphs: string): string {
  return `<div style="font-family:Arial,Helvetica,sans-serif;padding:24px;max-width:560px;color:#111">
    <h1 style="font-size:20px">${escapeHtml(heading)}</h1>
    ${paragraphs}
    <a href="${escapeHtml(portalUrl())}" style="display:inline-block;background:#D03020;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600">Open Driver Portal</a>
  </div>`;
}

export type RenterContact = {
  firstName: string;
  email: string | null;
  phone: string | null;
  applicationId: string;
  driverId: string | null;
  rentalId: string | null;
};

export function rentalEndedNotice(input: RenterContact & { vehicleLabel: string }): DriverNotice {
  const vehicle = input.vehicleLabel.trim() || "your vehicle";
  const name = firstName(input.firstName);
  return {
    kind: "rental_ended",
    applicationId: input.applicationId,
    driverId: input.driverId,
    rentalId: input.rentalId,
    email: input.email,
    phone: input.phone,
    title: "Your rental has ended",
    body: `${vehicle} has been returned.`,
    smsBody: `REAL RENTALS: Hi ${name}, your rental has ended. The driver portal has the details. Reply STOP to opt out.`,
    emailSubject: "Your rental has ended",
    emailHtml: letter(
      "Your rental has ended",
      `<p style="font-size:15px;line-height:1.6">Hi ${escapeHtml(name)},</p>
       <p style="font-size:15px;line-height:1.6"><strong>${escapeHtml(vehicle)}</strong> has been returned. The driver portal keeps the record of this rental.</p>`,
    ),
  };
}

export function incidentOpenedNotice(input: RenterContact & { incidentType: string }): DriverNotice {
  const name = firstName(input.firstName);
  const kind = input.incidentType.trim() || "incident";
  return {
    kind: "incident_opened",
    applicationId: input.applicationId,
    driverId: input.driverId,
    rentalId: input.rentalId,
    email: input.email,
    phone: input.phone,
    title: "An incident was opened",
    body: `An incident (${kind}) was opened on your rental.`,
    smsBody: `REAL RENTALS: Hi ${name}, an incident was opened on your rental. The driver portal has what to do next. Reply STOP to opt out.`,
    emailSubject: "An incident was opened on your rental",
    emailHtml: letter(
      "An incident was opened",
      `<p style="font-size:15px;line-height:1.6">Hi ${escapeHtml(name)},</p>
       <p style="font-size:15px;line-height:1.6">An incident was opened on your rental (${escapeHtml(kind)}). The driver portal has what to do next.</p>`,
    ),
  };
}

export function issueStatusChangedNotice(input: RenterContact & { issueTitle: string; statusLabel: string }): DriverNotice {
  const name = firstName(input.firstName);
  const title = input.issueTitle.trim() || "Your issue";
  const status = input.statusLabel.trim() || "Updated";
  return {
    kind: "issue_status_changed",
    applicationId: input.applicationId,
    driverId: input.driverId,
    rentalId: input.rentalId,
    email: input.email,
    phone: input.phone,
    title: "Your issue status changed",
    body: `${title} is now ${status}.`,
    smsBody: `REAL RENTALS: Hi ${name}, your issue "${title.replace(/[\r\n]+/g, " ")}" is now ${status}. Reply STOP to opt out.`,
    emailSubject: "Your issue status changed",
    emailHtml: letter(
      "Your issue status changed",
      `<p style="font-size:15px;line-height:1.6">Hi ${escapeHtml(name)},</p>
       <p style="font-size:15px;line-height:1.6"><strong>${escapeHtml(title)}</strong> is now ${escapeHtml(status)}.</p>`,
    ),
  };
}

/**
 * Sends only when the flag is on. The flag-off return is before any sender,
 * including an injected one, so a test can prove the channels were not called.
 */
export async function deliverDriverNotice(notice: DriverNotice, deps?: NoticeDeps): Promise<DriverNoticeResult> {
  if (DRIVER_NOTIFICATIONS_ENABLED !== true) return NOTICE_HELD;
  const send = deps?.send;
  if (!send) {
    const server = await import("@/lib/driver-notifications.server");
    return server.sendDriverNoticeChannels(notice);
  }
  return send(notice);
}
