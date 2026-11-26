/**
 * Renders the real settings control, Cancelled row menu, and credits card.
 * Run: bun test scripts/forfeited-fee-credit-render.test.ts
 * WRITE_FEE_CREDIT_HTML=1 writes the screenshot pages to /tmp.
 */
import { mock } from "bun:test";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { writeFileSync } from "node:fs";
import * as realRouter from "@tanstack/react-router";
import * as realStart from "@tanstack/react-start";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BookingRow } from "../src/lib/bookings-list";
import type { RenterCreditRow } from "../src/lib/rental-hold.functions";

mock.module("@tanstack/react-router", () => ({
  ...realRouter,
  useNavigate: () => () => {},
  Link: ({ children, className }: { children?: ReactNode; className?: string }) =>
    createElement("a", { className }, children),
}));
mock.module("@tanstack/react-start", () => ({
  ...realStart,
  useServerFn: () => async () => ({}),
}));

const { ForfeitedFeeCreditSettings } = await import("../src/components/admin/ForfeitedFeeCreditSettings.tsx");
const { BookingsPanel } = await import("../src/components/admin/BookingsPanel.tsx");
const { RenterCreditsCard } = await import("../src/components/admin/RenterCreditsCard.tsx");

const RENTAL = "11111111-0000-4000-8000-0000000000aa";
const PAY = "03733dbe-a9c1-4eaf-9f42-2c04e386945a";

const cancelled: BookingRow[] = [
  {
    id: RENTAL,
    source: "rental",
    phase: "cancelled",
    status: "cancelled",
    startDate: "2026-11-20",
    endDate: "2026-11-20",
    openEnded: false,
    lengthLabel: "Same Day",
    driverName: "Fabio Hale",
    driverEmail: "fabio@example.com",
    applicationId: "802fb55c-d7e8-45ae-9b40-dc5efa74753f",
    driverUserId: "802fb55c-d7e8-45ae-9b40-dc5efa74753f",
    vehicleId: "33333333-0000-4000-8000-0000000000cc",
    unitNumber: "RR-014",
    vehicleLabel: "2018 Nissan Altima",
    plate: "ALT4418",
    vinLast6: "118204",
    weeklyRate: 325,
    balanceDue: 0,
  },
];

const NOW = new Date("2026-11-26T16:00:00Z");
const credits: RenterCreditRow[] = [
  {
    id: "c-many",
    applicationId: "802fb55c-d7e8-45ae-9b40-dc5efa74753f",
    driverName: "Fabio Hale",
    amount: 50,
    reason: "Late Pickup Reservation Fee Kept As Credit",
    status: "available",
    appliedToRentalId: null,
    createdAt: "2026-11-26T15:00:00Z",
    expiresAt: "2027-02-21T16:00:00Z",
    sourcePaymentId: PAY,
  },
  {
    id: "c-soon",
    applicationId: "802fb55c-d7e8-45ae-9b40-dc5efa74753f",
    driverName: "Fabio Hale",
    amount: 50,
    reason: "Reservation Fee Credit Toward Next Rental",
    status: "available",
    appliedToRentalId: null,
    createdAt: "2026-11-20T15:00:00Z",
    expiresAt: "2026-12-03T16:00:00Z",
    sourcePaymentId: "03733dbe-a9c1-4eaf-9f42-2c04e386945c",
  },
  {
    id: "c-today",
    applicationId: "802fb55c-d7e8-45ae-9b40-dc5efa74753f",
    driverName: "Fabio Hale",
    amount: 50,
    reason: "Reservation Fee Credit Toward Next Rental",
    status: "available",
    appliedToRentalId: null,
    createdAt: "2026-11-26T12:00:00Z",
    expiresAt: "2026-11-26T22:00:00Z",
    sourcePaymentId: "03733dbe-a9c1-4eaf-9f42-2c04e386945d",
  },
  {
    id: "c-old",
    applicationId: "802fb55c-d7e8-45ae-9b40-dc5efa74753f",
    driverName: "Fabio Hale",
    amount: 50,
    reason: "Reservation Fee Credit Toward Next Rental",
    status: "available",
    appliedToRentalId: null,
    createdAt: "2025-10-01T15:00:00Z",
    expiresAt: "2026-01-01T15:00:00Z",
    sourcePaymentId: "03733dbe-a9c1-4eaf-9f42-2c04e386945b",
  },
  {
    id: "c-open",
    applicationId: "802fb55c-d7e8-45ae-9b40-dc5efa74753f",
    driverName: "Fabio Hale",
    amount: 50,
    reason: "Reservation Fee Credit Toward Next Rental",
    status: "available",
    appliedToRentalId: null,
    createdAt: "2026-11-01T15:00:00Z",
    expiresAt: null,
    sourcePaymentId: "03733dbe-a9c1-4eaf-9f42-2c04e386945e",
  },
];

const client = new QueryClient();

function page(body: ReactElement): string {
  return renderToStaticMarkup(body);
}

describe("forfeited fee credit screens", () => {
  it("shows the policy, the cancelled menu, and an expired credit", () => {
    const settings = page(createElement(ForfeitedFeeCreditSettings, { canEdit: true, initial: { mode: "case_by_case", days: 90 } }));
    assert.match(settings, /Forfeited Fee Credit/);
    assert.match(settings, /aria-pressed="true"/);
    assert.match(settings, /Case By Case/);
    assert.match(settings, /value="90"/);

    const cancelledHtml = page(
      createElement(
        QueryClientProvider,
        { client },
        createElement(BookingsPanel, {
          scope: "cancelled",
          canManage: true,
          previewRows: cancelled,
          previewKeptFees: [{ rentalId: RENTAL, paymentId: PAY }],
          previewCreditMode: "case_by_case",
          previewMenuOpen: true,
        }),
      ),
    );
    assert.match(cancelledHtml, /Fee Kept, Credit Not Decided/);
    assert.match(cancelledHtml, /Keep Fee As Credit/);
    assert.match(cancelledHtml, /Fabio Hale/);

    const card = page(
      createElement(RenterCreditsCard, {
        canManage: true,
        rentals: [],
        previewRows: credits,
        now: NOW,
      }),
    );
    assert.match(card, />87 days left</);
    assert.match(card, />7 days left</);
    assert.match(card, /Expires today/);
    assert.match(card, /No expiry/);
    assert.match(card, /Expires Feb 21, 2027/);
    assert.match(card, /data-credit-state="expired"/);
    assert.match(card, /Expired Jan 1, 2026/);
  });
});

if (process.env.WRITE_FEE_CREDIT_HTML === "1") {
  const wrap = (title: string, body: string) =>
    `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="http://127.0.0.1:5173/src/styles.css"><style>.admin-table-fit{overflow:visible !important}</style></head><body class="bg-[#F6F6F7]"><div class="mx-auto max-w-6xl p-6"><h1 class="mb-4 text-lg font-semibold">${title}</h1>${body}</div></body></html>`;
  writeFileSync(
    "/tmp/fee-credit-settings.html",
    wrap("Settings · Rental Terms", page(createElement(ForfeitedFeeCreditSettings, { canEdit: true, initial: { mode: "case_by_case", days: 90 } }))),
  );
  writeFileSync(
    "/tmp/fee-credit-cancelled.html",
    wrap(
      "Bookings · Cancelled",
      page(
        createElement(
          QueryClientProvider,
          { client },
          createElement(BookingsPanel, {
            scope: "cancelled",
            canManage: true,
            previewRows: cancelled,
            previewKeptFees: [{ rentalId: RENTAL, paymentId: PAY }],
            previewCreditMode: "case_by_case",
            previewMenuOpen: true,
          }),
        ),
      ),
    ),
  );
  writeFileSync(
    "/tmp/fee-credit-card.html",
    wrap(
      "Renter Credits",
      page(
        createElement(RenterCreditsCard, {
          canManage: false,
          rentals: [],
          previewRows: credits,
          now: NOW,
        }),
      ),
    ),
  );
}
