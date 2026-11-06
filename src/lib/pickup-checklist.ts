/**
 * Pickup readiness. The flag is a hard false constant, declared only here.
 * The portal imports that constant and loads the client only after the check passes.
 *
 * Nothing here writes, sends mail, or talks to the database. The browser
 * loader reads with the driver's own session. Address, hours, and rules are
 * owner inputs that are not in the database yet, so the only copy is the
 * placeholder constant below.
 */
export const PICKUP_CHECKLIST_ENABLED: boolean = false as boolean;

/** Owner inputs still pending. Do not replace these with a guessed address, hours, or rules. */
export const PICKUP_SITE = {
  address: "Pickup address is not set. An owner still needs to enter it.",
  hours: "Pickup hours are not set. An owner still needs to enter them.",
  rules: "Pickup rules are not set. An owner still needs to enter them.",
} as const;

export type PickupLink = "documents" | "payments";

export type PickupStep = {
  id: "agreement" | "payment" | "documents" | "appointment";
  label: string;
  done: boolean;
  detail: string;
  /** Existing portal section. Null when no page owns this step. */
  link: PickupLink | null;
  linkLabel: string | null;
  /** Saved pickup date (YYYY-MM-DD) when the appointment step has one. */
  date: string | null;
  /** Saved pickup time, unchanged. */
  time: string | null;
};

export type PickupChecklist = {
  steps: PickupStep[];
  site: typeof PICKUP_SITE;
};

export type PickupChecklistInput = {
  status: string | null;
  pickupDate: string | null;
  pickupTime: string | null;
  agreements: { status: string | null; signedAt: string | null; voidedAt: string | null }[];
  documents: { category: string | null; reviewStatus: string | null; current: boolean }[];
  payments: {
    type: string | null;
    status: string | null;
    netCollected: number | null;
    amount: number | null;
  }[];
  depositHeld: boolean;
};

function text(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function money(value: number | null): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** A paid charge with money collected. net_collected wins; amount is the fallback the deposit display already uses. */
export function paymentCollected(row: PickupChecklistInput["payments"][number]): boolean {
  if (String(row.status ?? "").trim().toLowerCase() !== "paid") return false;
  const net = row.netCollected == null ? money(row.amount) : money(row.netCollected);
  return net > 0;
}

function agreementSigned(rows: PickupChecklistInput["agreements"]): boolean {
  return rows.some((row) => {
    const status = String(row.status ?? "").trim().toLowerCase();
    return status === "signed" && Boolean(text(row.signedAt)) && !text(row.voidedAt);
  });
}

function docApproved(rows: PickupChecklistInput["documents"], categories: string[]): boolean {
  const wanted = new Set(categories);
  return rows.some((row) => {
    if (!row.current) return false;
    if (String(row.reviewStatus ?? "").trim().toLowerCase() !== "verified") return false;
    return wanted.has(String(row.category ?? "").trim().toLowerCase());
  });
}

export function pickupChecklist(input: PickupChecklistInput): PickupChecklist | null {
  if (String(input.status ?? "").trim().toLowerCase() !== "approved") return null;

  const signed = agreementSigned(input.agreements);
  const depositPaid = input.payments.some(
    (row) => String(row.type ?? "").trim().toLowerCase() === "deposit" && paymentCollected(row),
  );
  const rentPaid = input.payments.some(
    (row) => String(row.type ?? "").trim().toLowerCase() === "rent" && paymentCollected(row),
  );
  const paid = depositPaid || rentPaid || input.depositHeld;
  const license = docApproved(input.documents, ["license_front", "license_back"]);
  const insurance = docApproved(input.documents, ["insurance"]);
  const docs = license && insurance;
  const date = text(input.pickupDate);
  const time = text(input.pickupTime);

  let paymentDetail = "No deposit or first week payment is collected.";
  if (depositPaid && rentPaid) paymentDetail = "Deposit and first week are paid.";
  else if (depositPaid) paymentDetail = "Deposit is paid.";
  else if (rentPaid) paymentDetail = "First week is paid.";
  else if (input.depositHeld) paymentDetail = "Deposit is held on your rental.";

  const steps: PickupStep[] = [
    {
      id: "agreement",
      label: "Agreement Signed",
      done: signed,
      detail: signed ? "Your agreement is signed." : "Your agreement is not signed.",
      link: "documents",
      linkLabel: "Open Documents",
      date: null,
      time: null,
    },
    {
      id: "payment",
      label: "Deposit Or First Week Paid",
      done: paid,
      detail: paymentDetail,
      link: "payments",
      linkLabel: "Open Payments",
      date: null,
      time: null,
    },
    {
      id: "documents",
      label: "License And Insurance Approved",
      done: docs,
      detail: docs
        ? "License and insurance are approved."
        : "License and insurance are not both approved.",
      link: "documents",
      linkLabel: "Open Documents",
      date: null,
      time: null,
    },
    {
      id: "appointment",
      label: "Pickup Appointment",
      done: Boolean(date),
      detail: date ? "A pickup date is saved on your application." : "No pickup date is saved on your application.",
      link: null,
      linkLabel: null,
      date,
      time,
    },
  ];

  return { steps, site: PICKUP_SITE };
}
