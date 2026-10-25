/**
 * Read-only portal notices. The flag is a hard constant. The server function
 * throws before it looks up a driver or reads a table unless this is true.
 *
 * Wording stays with facts already stored: a status, a document name, a due
 * date, an esign status. No amounts and no rules that are not on the row.
 */

import { fmtDate } from "@/lib/date-format";
import { awaitsDriverSignature } from "@/lib/portal-agreement-state";
import { documentExpiryTone } from "@/lib/document-expiry";
import { DOC_CATEGORIES, RESTRICTED_CATEGORIES } from "@/lib/documents.functions";
import { leadToday } from "@/lib/lead-priorities";
import { REQUIRED_DOC_TYPES } from "@/components/admin/types";
import { VAULT_TO_REQUIRED } from "@/lib/required-docs";

export const PORTAL_NOTICES_ENABLED: boolean = false;

export function assertPortalNoticesEnabled(): void {
  if (PORTAL_NOTICES_ENABLED !== true) {
    throw new Error("Portal notices are not enabled.");
  }
}

export const PORTAL_NOTICE_SECTIONS = ["dashboard", "documents", "payments"] as const;
export type PortalNoticeSection = (typeof PORTAL_NOTICE_SECTIONS)[number];

export type PortalNotice = {
  id: string;
  text: string;
  section: PortalNoticeSection;
};

export type NoticeApplication = { status: string | null };
export type NoticeDocument = {
  category: string | null;
  expires_at: string | null;
  is_current: boolean | null;
  review_status: string | null;
  visibility: string[] | null;
};
export type NoticeRental = { next_payment_due: string | null; payment_status: string | null };
export type NoticePayment = { status: string | null; due_date: string | null };
export type NoticeAgreement = { status: string | null; signed_at: string | null };

export type PortalNoticeInput = {
  application: NoticeApplication | null;
  applicationReadable: boolean;
  documents: NoticeDocument[] | null;
  rentals: NoticeRental[] | null;
  payments: NoticePayment[] | null;
  agreements: NoticeAgreement[] | null;
};

const NOT_DUE = new Set(["paid", "refunded", "waived", "void", "failed"]);

function categoryLabel(category: string): string {
  return DOC_CATEGORIES.find((item) => item.key === category)?.label ?? category.replace(/_/g, " ");
}

function requiredLabel(type: string): string {
  const category = Object.entries(VAULT_TO_REQUIRED).find(([, value]) => value === type)?.[0] ?? type;
  return categoryLabel(category);
}

function canonicalCategory(category: string): string {
  return VAULT_TO_REQUIRED[category] ?? category;
}

function dateOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  return match ? match[1] : null;
}

function daysAfter(today: string, due: string): number {
  return Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
}

function driverVisible(doc: NoticeDocument): boolean {
  if (!doc.category || RESTRICTED_CATEGORIES.includes(doc.category)) return false;
  if (doc.is_current === false) return false;
  return (doc.visibility ?? []).includes("driver");
}

export function buildPortalNotices(input: PortalNoticeInput, now = new Date()): PortalNotice[] {
  const notices: PortalNotice[] = [];
  const today = leadToday(now);

  if (input.applicationReadable && input.application) {
    const status = (input.application.status ?? "").toLowerCase();
    if (status === "approved") {
      notices.push({ id: "application-approved", text: "Your application was approved.", section: "dashboard" });
    } else if (status === "declined") {
      notices.push({ id: "application-declined", text: "Your application was declined.", section: "dashboard" });
    }
  }

  const docs = input.documents?.filter(driverVisible) ?? null;
  if (docs) for (const type of REQUIRED_DOC_TYPES) {
    const rows = docs.filter((doc) => canonicalCategory(doc.category ?? "") === type);
    const usable = rows.filter((doc) => doc.review_status !== "rejected");
    if (usable.length > 0) continue;
    const label = requiredLabel(type);
    if (rows.some((doc) => doc.review_status === "rejected")) {
      notices.push({ id: `document-replacement-${type}`, text: `${label} needs a replacement.`, section: "documents" });
    } else {
      notices.push({ id: `document-missing-${type}`, text: `${label} was not received.`, section: "documents" });
    }
  }

  for (const doc of docs ?? []) {
    if (doc.review_status === "rejected") continue;
    const tone = documentExpiryTone(doc.expires_at, now.getTime());
    if (!tone) continue;
    const label = categoryLabel(doc.category ?? "");
    const when = fmtDate(dateOnly(doc.expires_at) ?? doc.expires_at);
    notices.push({
      id: `document-${tone}-${doc.category}`,
      text: tone === "expired" ? `${label} has expired.` : `${label} expires on ${when}.`,
      section: "documents",
    });
  }

  if (input.payments) {
    if (input.payments.some((payment) => (payment.status ?? "").toLowerCase() === "failed")) {
      notices.push({ id: "payment-failed", text: "A payment failed.", section: "payments" });
    }
  }
  if (input.rentals?.some((rental) => (rental.payment_status ?? "").toLowerCase() === "failed")) {
    if (!notices.some((notice) => notice.id === "payment-failed")) {
      notices.push({ id: "payment-failed", text: "A payment failed.", section: "payments" });
    }
  }

  const dueDates: string[] = [];
  for (const rental of input.rentals ?? []) {
    const due = dateOnly(rental.next_payment_due);
    if (due) dueDates.push(due);
  }
  for (const payment of input.payments ?? []) {
    const status = (payment.status ?? "").toLowerCase();
    if (NOT_DUE.has(status)) continue;
    const due = dateOnly(payment.due_date);
    if (due) dueDates.push(due);
  }
  const soon = dueDates
    .filter((due) => {
      const days = daysAfter(today, due);
      return days >= 0 && days <= 3;
    })
    .sort();
  if (soon[0]) {
    const label = fmtDate(soon[0]);
    if (label) notices.push({ id: "payment-due", text: `A payment is due on ${label}.`, section: "payments" });
  }

  // Only an issued, unsigned agreement asks for a signature: never a voided
  // one, and never a draft that was not sent to the driver.
  const unsigned = (input.agreements ?? []).some((agreement) => awaitsDriverSignature(agreement));
  if (unsigned) {
    notices.push({ id: "agreement-unsigned", text: "Awaiting your signature.", section: "documents" });
  }

  return notices;
}
