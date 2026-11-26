/**
 * Renders the reservation-fee release screens from mock rows. No database.
 * WRITE_FEE_SHOTS=1 writes HTML pages under /tmp/fee-shots.
 */
import { mock } from "bun:test";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdirSync, writeFileSync } from "node:fs";
import * as realRouter from "@tanstack/react-router";
import * as realStart from "@tanstack/react-start";
import type { ReservationRow, AwaitingReservationFee } from "../src/lib/reservations";
import type { Payment, Application } from "../src/components/admin/types";
import type { RenterCreditRow } from "../src/lib/rental-hold.functions";
import type { ActivationReadiness } from "../src/lib/activation-readiness";
import type { NextStep } from "../src/lib/next-step";

mock.module("@tanstack/react-router", () => ({
  ...realRouter,
  useNavigate: () => () => {},
  Link: ({ children, className }: { children?: ReactNode; className?: string }) =>
    createElement("a", { className }, children),
}));
mock.module("@tanstack/react-start", () => ({
  ...realStart,
  useServerFn: () => async () => ({ rows: [], offer: null }),
}));
mock.module("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open?: boolean; children?: ReactNode }) => (open ? createElement("div", { className: "flex min-h-[28rem] items-start justify-center bg-[#111114]/40 p-8" }, children) : null),
  DialogContent: ({ children, className }: { children?: ReactNode; className?: string }) => createElement("div", { role: "dialog", className: `w-full max-w-md rounded-lg border border-[#EDEDF0] bg-white p-6 ${className ?? ""}` }, children),
  DialogHeader: ({ children }: { children?: ReactNode }) => createElement("div", { className: "mb-2" }, children),
  DialogTitle: ({ children }: { children?: ReactNode }) => createElement("h2", { className: "text-lg font-semibold text-[#111114]" }, children),
  DialogFooter: ({ children }: { children?: ReactNode }) => createElement("div", { className: "mt-4 flex justify-end gap-2" }, children),
  DialogDescription: ({ children }: { children?: ReactNode }) => createElement("p", null, children),
}));

const { PaymentsPanel } = await import("../src/components/admin/PaymentsPanel.tsx");
const { ReservationsPanel } = await import("../src/components/admin/ReservationsPanel.tsx");
const { NextStepCard } = await import("../src/components/admin/NextStepCard.tsx");
const { OfferCreditDialog } = await import("../src/components/admin/OfferCreditDialog.tsx");
const { RenterCreditsCard } = await import("../src/components/admin/RenterCreditsCard.tsx");

const APP = "802fb55c-d7e8-45ae-9b40-dc5efa74753f";
const RENTAL = "11111111-0000-4000-8000-0000000000aa";
const NOW = new Date("2026-11-26T18:00:00.000Z");
const HOLD_START = new Date(NOW.getTime() - 6 * 3_600_000).toISOString();

function pay(partial: Partial<Payment> & Pick<Payment, "id" | "amount" | "status">): Payment {
  return {
    driver_id: APP,
    vehicle_id: null,
    rental_id: RENTAL,
    balance_due: partial.status === "paid" ? 0 : partial.amount,
    due_date: "2026-11-26",
    type: "rent",
    reason: null,
    notes: null,
    payment_method: "card",
    late_fees: 0,
    net_collected: partial.status === "paid" ? partial.amount : 0,
    created_at: HOLD_START,
    ...partial,
  } as Payment;
}

const drivers = [{ id: APP, full_name: "Jordan Hale", vehicle_id: null }] as Application[];
const payments = [
  pay({ id: "rent-1", amount: 350, status: "current", balance_due: 350, type: "rent" }),
  pay({ id: "fee-paid", amount: 50, status: "paid", balance_due: 0, type: "reservation", reason: "reservation_fee", net_collected: 50 }),
  pay({ id: "fee-unpaid", amount: 50, status: "pending", balance_due: 50, type: "reservation", reason: "reservation_fee", net_collected: 0 }),
];

const reserved: ReservationRow = {
  id: RENTAL,
  applicationId: APP,
  driverUserId: APP,
  driverName: "Jordan Hale",
  vehicleId: "33333333-0000-4000-8000-0000000000cc",
  vehicleLabel: "2019 Toyota Camry",
  unitNumber: "RR-018",
  pickupDate: "2026-11-28",
  pickupTime: "10:00",
  pickupLocation: "Shop",
  note: null,
  bookedBy: null,
  createdAt: "2026-11-26T12:00:00.000Z",
  status: "reserved",
  depositRequired: true,
  depositAmount: 50,
  depositStatus: "pending",
  depositPaymentId: "fee-unpaid",
  plate: "CAM1918",
  vinLast6: "123456",
  weeklyRate: 350,
  feeAmount: 50,
  feeDueDate: "2026-11-27",
  feeHoldStartedAt: HOLD_START,
};

const awaiting: AwaitingReservationFee = {
  paymentId: "fee-waiting",
  applicationId: "aaaaaaaa-0000-4000-8000-0000000000bb",
  driverName: "Casey Nguyen",
  amount: 50,
  dueDate: "2026-11-27",
  vehicleId: null,
  vehicleLabel: null,
  holdStartedAt: HOLD_START,
};

const credit: RenterCreditRow = {
  id: "credit-1",
  applicationId: APP,
  driverName: "Jordan Hale",
  amount: 50,
  reason: "Offered from the paid Reservation Fee",
  status: "available",
  appliedToRentalId: null,
  createdAt: "2026-11-01T15:00:00.000Z",
  expiresAt: "2027-01-30T15:00:00.000Z",
  sourcePaymentId: "fee-paid",
};

const next: NextStep = {
  label: "Activate Rental",
  target: { kind: "none" },
  busy: false,
  blockers: [],
  activation: "ready",
  note: "The Reservation Fee is still unpaid.",
};

function page(node: ReactElement): string {
  return renderToStaticMarkup(node);
}

describe("reservation fee release screens", () => {
  it("hides the unpaid fee on Payments and shows the paid fee", () => {
    const html = page(createElement(PaymentsPanel, { tier: "manager", previewPayments: payments, previewDrivers: drivers }));
    assert.match(html, /Jordan Hale/);
    assert.match(html, /\$350/);
    assert.match(html, /\$50/);
    assert.equal(html.includes("fee-unpaid"), false);
    assert.equal(html.includes("Awaiting Reservation Fee"), false);
  });

  it("shows the unpaid hold, the time left, and Release", () => {
    const html = page(createElement(ReservationsPanel, {
      canManage: true,
      previewRows: [reserved],
      previewAwaitingFees: [awaiting],
    }));
    assert.match(html, /Jordan Hale/);
    assert.match(html, /Unpaid/);
    assert.match(html, /reservation-hold-countdown/);
    assert.match(html, /Hours Left|h \d+m Left/);
    assert.match(html, />Release</);
    assert.match(html, /Casey Nguyen/);
    assert.match(html, /Not Held/);
  });

  it("filters Reserved to the booking the View button opens", () => {
    const html = page(createElement(ReservationsPanel, {
      canManage: true,
      previewRows: [reserved, { ...reserved, id: "other", driverName: "Someone Else", depositStatus: "paid", feeAmount: null, feeHoldStartedAt: null }],
      focusRentalId: RENTAL,
    }));
    assert.match(html, /Jordan Hale/);
    assert.equal(html.includes("Someone Else"), false);
  });

  it("offers a paid fee as a 90-day credit and shows the expiry", () => {
    const offer = page(createElement(OfferCreditDialog, {
      open: true,
      driverName: "Jordan Hale",
      amount: 50,
      days: 90,
      onOpenChange: () => {},
      onConfirm: () => {},
    }));
    assert.match(offer, /Offer Credit/);
    assert.match(offer, /valid 90 days/);
    const card = page(createElement(RenterCreditsCard, {
      canManage: true,
      applicationId: APP,
      rentals: [],
      showOffer: true,
      driverName: "Jordan Hale",
      previewRows: [credit],
      now: NOW,
    }));
    assert.match(card, /Jordan Hale/);
    assert.match(card, /\$50\.00/);
    assert.match(card, /Expires Jan 30, 2027/);
    assert.match(card, /days left/);
  });

  it("shows View on Next Step while the fee is unpaid", () => {
    const html = page(createElement(NextStepCard, {
      model: next,
      readiness: { requirements: [] } as unknown as ActivationReadiness,
      onRun: () => {},
      onActivate: () => {},
      onRetry: () => {},
      reservationPaymentStatus: "pending",
      reservationFeeAmount: 50,
      reservationFeeDue: "2026-11-27",
    }));
    assert.match(html, /Reservation Paid/);
    assert.match(html, /Unpaid · \$50/);
    assert.match(html, /data-testid="reservation-paid-view"/);
    assert.match(html, />View</);
    assert.match(html, />Release</);
  });
});

if (process.env.WRITE_FEE_SHOTS === "1") {
  mkdirSync("/tmp/fee-shots", { recursive: true });
  const wrap = (title: string, body: string) =>
    `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="http://127.0.0.1:5173/src/styles.css"></head><body class="bg-[#F6F6F7]"><div class="mx-auto max-w-6xl p-6"><h1 class="mb-4 text-lg font-semibold text-[#111114]">${title}</h1>${body}</div></body></html>`;
  const paymentsHtml = page(createElement(PaymentsPanel, { tier: "manager", previewPayments: payments, previewDrivers: drivers }))
    .replace(/<section aria-label="Unmatched"[\s\S]*?<\/section>/, "");
  writeFileSync("/tmp/fee-shots/payments.html", wrap("Payments", paymentsHtml));
  writeFileSync("/tmp/fee-shots/reserved.html", wrap("Bookings · Reserved", page(createElement(ReservationsPanel, { canManage: true, previewRows: [reserved], previewAwaitingFees: [awaiting] }))));
  writeFileSync("/tmp/fee-shots/reserved-one.html", wrap("Bookings · Reserved · This Booking", page(createElement(ReservationsPanel, { canManage: true, previewRows: [reserved, { ...reserved, id: "other", driverName: "Someone Else", depositStatus: "paid", feeAmount: null, feeHoldStartedAt: null }], focusRentalId: RENTAL }))));
  writeFileSync("/tmp/fee-shots/offer.html", wrap("Offer As 90-Day Credit", page(createElement("div", { className: "space-y-6" },
    createElement(OfferCreditDialog, { open: true, driverName: "Jordan Hale", amount: 50, days: 90, onOpenChange: () => {}, onConfirm: () => {} }),
    createElement(RenterCreditsCard, { canManage: true, applicationId: APP, rentals: [], showOffer: true, driverName: "Jordan Hale", previewRows: [credit], now: NOW }),
  ))));
  writeFileSync("/tmp/fee-shots/next-step.html", wrap("Next Step", page(createElement("div", { className: "space-y-6" },
    createElement(NextStepCard, {
      model: next,
      readiness: { requirements: [] } as unknown as ActivationReadiness,
      onRun: () => {},
      onActivate: () => {},
      onRetry: () => {},
      reservationPaymentStatus: "pending",
      reservationFeeAmount: 50,
      reservationFeeDue: "2026-11-27",
    }),
    createElement("p", { className: "text-sm text-[#55555E]" }, "View opens Bookings > Reserved, filtered to this booking."),
    createElement(ReservationsPanel, { canManage: true, previewRows: [reserved], focusRentalId: RENTAL }),
  ))));
}
