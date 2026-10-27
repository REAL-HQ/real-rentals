/**
 * Read-only pickup checklist for an approved driver who is not yet renting.
 *
 * Document lines use documentExpiryTone, the vault's expiry reading.
 * Payment and deposit lines use derivePaymentStatus / deriveDepositDisplay,
 * and only when those functions have a real outstanding result. Wording is
 * the strings those surfaces already show. Nothing here writes.
 */

import { DOC_CATEGORIES } from "@/lib/documents.functions";
import { documentExpiryTone } from "@/lib/document-expiry";
import { awaitsDriverSignature } from "@/lib/portal-agreement-state";
import {
  deriveDepositDisplay,
  derivePaymentStatus,
  PAYMENT_STATUS_LABEL,
  type PayRental,
  type PayRow,
  type PaymentStatus,
} from "@/lib/driver-payment-status";

export const PORTAL_PICKUP_CHECKLIST_ENABLED: boolean = false;

export type PickupChecklistItem = {
  id: string;
  label: string;
  detail: string;
};

export type PickupChecklist = {
  show: boolean;
  items: PickupChecklistItem[];
};

export type PickupDocument = {
  category: string;
  expiresAt: string | null;
  isCurrent: boolean;
  visibleToDriver: boolean;
  createdAt: string | null;
};

export type PickupAgreement = {
  status: string | null;
  signedAt: string | null;
};

const EXPIRING_DOCUMENTS = DOC_CATEGORIES.filter((category) => category.expiring);

const DOCUMENT_DETAIL = {
  missing: "Not on file",
  expired: "Expired",
  soon: "Expiring soon",
} as const;

const OUTSTANDING_PAYMENT: ReadonlySet<PaymentStatus> = new Set(["due", "partial", "overdue", "failed"]);

export function assertPortalPickupChecklistEnabled(): void {
  if (PORTAL_PICKUP_CHECKLIST_ENABLED !== true) {
    throw new Error("Portal pickup checklist is not enabled.");
  }
}

function ownedPath(value: string | null | undefined): boolean {
  if (!value) return false;
  const path = value.trim();
  return path.length > 0 && !path.startsWith("http://") && !path.startsWith("https://");
}

function newest(docs: PickupDocument[], category: string): PickupDocument | null {
  const hits = docs.filter((doc) => doc.category === category && doc.isCurrent && doc.visibleToDriver);
  hits.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  return hits[0] ?? null;
}

export function pickupChecklist(input: {
  applicationStatus: string | null;
  hasActiveRental: boolean;
  documents: PickupDocument[];
  licensePhotoPath: string | null;
  licenseExpiration: string | null;
  insuranceDocPath: string | null;
  insuranceExpiresOn: string | null;
  agreements: PickupAgreement[];
  rentals: PayRental[];
  payments: PayRow[];
  now?: number;
}): PickupChecklist {
  const show = input.applicationStatus === "approved" && !input.hasActiveRental;
  if (!show) return { show: false, items: [] };

  const now = input.now ?? Date.now();
  const items: PickupChecklistItem[] = [];

  const signed = input.agreements.some(
    (agreement) => agreement.status === "signed" || Boolean(agreement.signedAt),
  );
  // Same rule as the portal's agreement list: voided and draft rows never ask
  // the driver to sign.
  const waiting = input.agreements.some(
    (agreement) => awaitsDriverSignature({ status: agreement.status, signed_at: agreement.signedAt }),
  );
  if (!signed && waiting) {
    items.push({
      id: "agreement",
      label: "Rental Agreements",
      detail: "Awaiting your signature",
    });
  }

  for (const category of EXPIRING_DOCUMENTS) {
    const doc = newest(input.documents, category.key);
    const applicationFile =
      category.key === "license_front"
        ? ownedPath(input.licensePhotoPath)
        : category.key === "insurance"
          ? ownedPath(input.insuranceDocPath)
          : false;
    const onFile = Boolean(doc) || applicationFile;
    if (!onFile) {
      items.push({ id: category.key, label: category.label, detail: DOCUMENT_DETAIL.missing });
      continue;
    }
    const applicationDate =
      category.key === "license_front"
        ? input.licenseExpiration
        : category.key === "insurance"
          ? input.insuranceExpiresOn
          : null;
    const expiresAt = doc?.expiresAt || (!doc ? applicationDate : null);
    const tone = documentExpiryTone(expiresAt, now);
    if (tone === "expired" || tone === "soon") {
      items.push({ id: category.key, label: category.label, detail: DOCUMENT_DETAIL[tone] });
    }
  }

  const paymentStatus = derivePaymentStatus(input.rentals, input.payments, new Date(now));
  if (OUTSTANDING_PAYMENT.has(paymentStatus)) {
    items.push({
      id: "payment",
      label: "Next Payment Due",
      detail: PAYMENT_STATUS_LABEL[paymentStatus],
    });
  }

  const deposit = deriveDepositDisplay(input.rentals, input.payments);
  if (deposit.detail && (deposit.detail.startsWith("Unpaid") || deposit.detail.startsWith("Partial Of"))) {
    items.push({
      id: "deposit",
      label: "Refundable Deposit",
      detail: deposit.detail,
    });
  }

  return { show: true, items };
}
