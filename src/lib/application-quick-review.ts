/**
 * Read-only quick review for a manager looking at an application that is
 * still awaiting an approval decision.
 *
 * Document expiry is documentExpiryTone, the vault's reading. Document
 * links are not built here — the drawer already holds signed URLs from
 * adminListDriverDocuments. Wording is the strings those surfaces already
 * show. Nothing here writes.
 */

import { DOC_CATEGORIES } from "@/lib/documents.functions";
import { documentExpiryTone } from "@/lib/document-expiry";
import { fmtDate, fmtDateTime } from "@/lib/date-format";

export const APPLICATION_QUICK_REVIEW_ENABLED: boolean = false;

/** Statuses still awaiting an approval decision. `partial` is the overview's Pending count. */
export const PENDING_REVIEW_STATUSES = ["partial", "new", "complete", "reviewing"] as const;

/** The four categories the open application drawer treats as required. */
const REQUIRED_KEYS = ["license_front", "license_back", "insurance", "gig_profile"] as const;

const EXPIRY_LABEL = { expired: "Expired", soon: "Expiring soon" } as const;

const DRIVE_TYPE_LABEL: Record<string, string> = {
  full_time: "Full-Time",
  part_time: "Part-Time",
};

const DURATION_LABEL: Record<string, string> = {
  "1_month": "1 month",
  "2_months": "2 months",
  "3_months": "3 months",
  "4plus_months": "4+ months",
  not_sure: "a period they weren't sure of yet",
  "1-2_weeks": "1–2 weeks",
  "3-4_weeks": "3–4 weeks",
  "1-2_months": "1–2 months",
  "2plus_months": "2+ months",
  ongoing: "an open-ended period",
};

const RESOLUTION_LABEL: Record<string, string> = {
  same_person: "Same Person",
  different_person: "Different Person",
  dismissed: "Dismiss",
};

export type QuickReviewField = { label: string; value: string };

export type QuickReviewDocument = {
  id: string;
  label: string;
  fileName: string | null;
  mimeType: string | null;
  expiryLabel: string | null;
};

export type QuickReviewItem = { id: string; label: string; detail: string };

export type QuickReviewIdentity = { label: string; detail: string; submitted: string };

export type QuickReview = {
  show: boolean;
  fields: QuickReviewField[];
  documents: QuickReviewDocument[];
  identity: QuickReviewIdentity | null;
  esign: { label: string; detail: string } | null;
  missing: QuickReviewItem[];
};

export type QuickReviewDocumentRow = {
  id: string;
  category: string;
  label: string | null;
  fileName: string | null;
  mimeType: string | null;
  expiresAt: string | null;
  isCurrent: boolean;
  reviewStatus: string | null;
  createdAt: string | null;
};

export type QuickReviewAgreement = {
  status: string | null;
  signedAt: string | null;
  sentAt: string | null;
  createdAt: string | null;
  signerName: string | null;
};

export type QuickReviewIdentityRow = {
  status: string;
  resolution: string | null;
  createdAt: string | null;
  submittedFullName: string | null;
  submittedEmail: string | null;
  submittedPhone: string | null;
};

export function assertApplicationQuickReviewEnabled(): void {
  if (APPLICATION_QUICK_REVIEW_ENABLED !== true) {
    throw new Error("Application quick review is not enabled.");
  }
}

export function isPendingReviewStatus(status: string | null | undefined): boolean {
  return (PENDING_REVIEW_STATUSES as readonly string[]).includes(status ?? "");
}

function text(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function phoneDisplay(value: string | null): string | null {
  const raw = text(value);
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  const n = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (n.length === 10) return `${n.slice(0, 3)}-${n.slice(3, 6)}-${n.slice(6)}`;
  return raw;
}

function money(value: number): string {
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function newest(docs: QuickReviewDocumentRow[], category: string): QuickReviewDocumentRow | null {
  const hits = docs.filter((doc) => doc.category === category && doc.isCurrent);
  hits.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  return hits[0] ?? null;
}

function categoryLabel(category: string, stored: string | null): string | null {
  return DOC_CATEGORIES.find((item) => item.key === category)?.label ?? text(stored);
}

function applicationFile(category: string, input: {
  licensePhotoUrl: string | null;
  insuranceDocUrl: string | null;
  profileScreenshotUrl: string | null;
}): boolean {
  if (category === "license_front") return Boolean(text(input.licensePhotoUrl));
  if (category === "insurance") return Boolean(text(input.insuranceDocUrl));
  if (category === "gig_profile") return Boolean(text(input.profileScreenshotUrl));
  return false;
}

const HIDDEN: QuickReview = {
  show: false,
  fields: [],
  documents: [],
  identity: null,
  esign: null,
  missing: [],
};

export function applicationQuickReview(input: {
  status: string | null;
  deletedAt: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  dob: string | null;
  licenseNumber: string | null;
  licenseState: string | null;
  licenseExpiration: string | null;
  yearsLicensed: number | null;
  platforms: string[] | null;
  weeklyHours: number | null;
  weeklyRent: number | null;
  driveType: string | null;
  expectedDuration: string | null;
  cardLast4: string | null;
  licensePhotoUrl: string | null;
  insuranceDocUrl: string | null;
  profileScreenshotUrl: string | null;
  interviewCompletedAt: string | null;
  insuranceVerified: boolean;
  mvrAuthorized: boolean;
  documents: QuickReviewDocumentRow[];
  agreements: QuickReviewAgreement[];
  identity: QuickReviewIdentityRow[] | null;
  now?: number;
}): QuickReview {
  if (input.deletedAt || !isPendingReviewStatus(input.status)) return HIDDEN;

  const now = input.now ?? Date.now();
  const fields: QuickReviewField[] = [];
  const push = (label: string, value: string | null) => {
    if (value) fields.push({ label, value });
  };

  push("Phone", phoneDisplay(input.phone));
  push("Email", text(input.email));
  const address = [input.address, input.city, input.state, input.zip].map((part) => text(part)).filter(Boolean).join(", ");
  push("Address", address || null);
  push("DOB", text(fmtDate(input.dob)) || text(input.dob));
  push("License #", text(input.licenseNumber));
  push("License State", text(input.licenseState));
  push("License exp.", text(fmtDate(input.licenseExpiration)) || text(input.licenseExpiration));
  if (input.yearsLicensed != null && Number.isFinite(input.yearsLicensed)) {
    push("Years Licensed", String(input.yearsLicensed));
  }
  const platforms = (input.platforms ?? []).map((item) => item.trim()).filter(Boolean);
  push("Platforms", platforms.length ? platforms.join(", ") : null);
  if (input.weeklyHours != null && Number.isFinite(input.weeklyHours)) {
    push("Weekly Hours", String(input.weeklyHours));
  }
  const drive = input.driveType ? DRIVE_TYPE_LABEL[input.driveType] : null;
  push("Drive Type", drive ?? null);
  const duration = input.expectedDuration ? DURATION_LABEL[input.expectedDuration] : null;
  push("Expected Duration", duration ?? null);
  if (input.weeklyRent != null && Number.isFinite(input.weeklyRent)) {
    push("Weekly Rate", money(input.weeklyRent));
  }
  const last4 = text(input.cardLast4);
  push("Card On File", last4 ? `····${last4}` : null);

  const documents: QuickReviewDocument[] = [];
  const shownCategory = new Set<string>();
  const ordered = [...input.documents].filter((doc) => doc.isCurrent && doc.category !== "verification_recording");
  ordered.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  for (const doc of ordered) {
    const multi = doc.category === "trip_history" || doc.category === "other";
    if (!multi && shownCategory.has(doc.category)) continue;
    const label = categoryLabel(doc.category, doc.label);
    if (!label) continue;
    shownCategory.add(doc.category);
    const tone = documentExpiryTone(doc.expiresAt, now);
    documents.push({
      id: doc.id,
      label,
      fileName: text(doc.fileName),
      mimeType: text(doc.mimeType),
      expiryLabel: tone ? EXPIRY_LABEL[tone] : null,
    });
  }

  const missing: QuickReviewItem[] = [];
  for (const key of REQUIRED_KEYS) {
    const label = categoryLabel(key, null);
    if (!label) continue;
    const doc = newest(input.documents.filter((row) => row.category !== "verification_recording"), key);
    if (doc?.reviewStatus === "rejected") {
      missing.push({ id: key, label, detail: "Needs Replacement" });
      continue;
    }
    const onFile = Boolean(doc) || applicationFile(key, input);
    if (!onFile) {
      missing.push({ id: key, label, detail: "Not Received" });
      continue;
    }
    const tone = doc ? documentExpiryTone(doc.expiresAt, now) : null;
    if (tone === "expired") missing.push({ id: key, label, detail: EXPIRY_LABEL.expired });
  }

  if (!input.interviewCompletedAt) missing.push({ id: "interview", label: "Interview Complete", detail: "" });
  if (!input.insuranceVerified) missing.push({ id: "insurance_verified", label: "Insurance Verified", detail: "" });
  if (!input.mvrAuthorized) missing.push({ id: "mvr", label: "MVR Authorized", detail: "" });
  if (!last4) missing.push({ id: "card", label: "Card On File", detail: "" });

  let identity: QuickReviewIdentity | null = null;
  if (input.identity) {
    const ranked = [...input.identity].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
    const open = ranked.filter((row) => row.status === "open");
    const resolved = ranked.filter((row) => row.status === "resolved");
    const row = open[0] ?? resolved[0] ?? null;
    if (row?.status === "open") {
      const when = text(fmtDateTime(row.createdAt));
      identity = {
        label: "Identity Review Needed",
        detail: when ? `Same phone submitted with a different email on ${when}. Not linked or merged.` : "",
        submitted: `Submitted: ${text(row.submittedFullName) ?? "—"} · ${text(row.submittedEmail) ?? "—"} · ${text(row.submittedPhone) ?? "—"}`,
      };
      missing.push({ id: "identity", label: "Identity Review Needed", detail: "" });
    } else if (row) {
      identity = {
        label: "Identity Review Resolved",
        detail: (row.resolution && RESOLUTION_LABEL[row.resolution]) || "",
        submitted: "",
      };
    }
  }

  const agreements = [...input.agreements].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  const signed = agreements.find((agreement) => agreement.status === "signed" || Boolean(agreement.signedAt));
  const current = signed ?? agreements.find((agreement) => agreement.status !== "voided") ?? agreements[0] ?? null;
  let esignDetail = "No agreement sent yet.";
  if (current?.signedAt || current?.status === "signed") {
    const when = text(fmtDateTime(current.signedAt));
    esignDetail = `Signed by ${text(current.signerName) ?? "renter"}${when ? ` · ${when}` : ""}`;
  } else if (current?.sentAt) {
    const when = text(fmtDateTime(current.sentAt));
    esignDetail = when ? `Sent ${when}` : "No agreement sent yet.";
  } else if (current?.createdAt) {
    const when = text(fmtDateTime(current.createdAt));
    esignDetail = when ? `Created ${when}` : "No agreement sent yet.";
  }

  return {
    show: true,
    fields,
    documents,
    identity,
    esign: { label: "Rental Agreement", detail: esignDetail },
    missing,
  };
}
