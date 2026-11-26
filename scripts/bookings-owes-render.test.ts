/**
 * Owes Money on every Bookings tab, and Due today on Active.
 * Run: bun test scripts/bookings-owes-render.test.ts
 */
import { mock } from "bun:test";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { writeFileSync } from "node:fs";
import * as realRouter from "@tanstack/react-router";
import * as realStart from "@tanstack/react-start";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { etDateISO, weeksIn, type ActiveRentalRow } from "../src/lib/active-rentals";
import type { BookingRow } from "../src/lib/bookings-list";
import { reservationOwes, type ReservationRow } from "../src/lib/reservations";
import type { ReservationDepositStatus } from "../src/lib/reservation-deposit-settings";
import { owesAmount } from "../src/lib/rental-length-order";
import { rentalLengthLabel } from "../src/lib/swap-ended-rental";

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

const { ReservationsPanel } = await import("../src/components/admin/ReservationsPanel.tsx");
const { ActiveRentalsPanel } = await import("../src/components/admin/ActiveRentalsPanel.tsx");
const { BookingsPanel } = await import("../src/components/admin/BookingsPanel.tsx");

const today = etDateISO();

describe("owes money and due today", () => {
  it("counts a positive balance and ignores zero, null, and non-numbers", () => {
    assert.equal(owesAmount(600), true);
    assert.equal(owesAmount(100), true);
    assert.equal(owesAmount(0), false);
    assert.equal(owesAmount(null), false);
    assert.equal(owesAmount(undefined), false);
    assert.equal(owesAmount(Number.NaN), false);
    assert.equal(reservationOwes("pending", true), true);
    assert.equal(reservationOwes("paid", true), false);
    assert.equal(reservationOwes(null, false), false);
  });

  it("shows Due today, Current, and overdue on Active, and filters to a balance due", () => {
    const rows: ActiveRentalRow[] = [
      row({ id: "future", name: "Bea Nguyen", due: "2099-01-01", days: 0, owed: 0 }),
      row({ id: "today", name: "Amina Cole", due: today, days: 0, owed: 100 }),
      row({ id: "late", name: "Luis Ortega", due: "2020-01-01", days: 4, owed: 0 }),
    ];
    const html = renderToStaticMarkup(
      createElement(ActiveRentalsPanel, { previewRows: rows }),
    );
    assert.match(html, />Status<\/th>/);
    assert.match(html, /data-testid="overdue-due-pill"/);
    assert.match(html, />Due</);
    assert.match(html, /data-testid="overdue-current-pill"/);
    assert.match(html, />Current</);
    assert.match(html, /bg-\[#FFF4D6\]/);
    assert.match(html, />4 Days</);
    assert.match(html, /Owes Money \(1\)/);

    const filtered = renderToStaticMarkup(
      createElement(ActiveRentalsPanel, { previewRows: rows, initialLengthOrder: "owes" }),
    );
    assert.match(filtered, /Amina Cole/);
    assert.doesNotMatch(filtered, /Bea Nguyen/);
    assert.doesNotMatch(filtered, /Luis Ortega/);
    assert.match(filtered, /1 Active Rental(?!s)/);
    assert.match(filtered, /option value="owes" selected/);
  });

  it("keeps Completed rows that still have a balance due", () => {
    const rows: BookingRow[] = [
      booking({ id: "settled", name: "Bea Nguyen", balance: 0 }),
      booking({ id: "owes", name: "Amina Cole", balance: 600 }),
    ];
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(BookingsPanel, { scope: "completed", previewRows: rows, initialLengthOrder: "owes" }),
      ),
    );
    assert.match(html, /Amina Cole/);
    assert.doesNotMatch(html, /Bea Nguyen/);
    assert.match(html, /\$600 due/);
    assert.match(html, /Owes Money \(1\)/);
    assert.match(html, /1 Completed Rental(?!s)/);
    const cancelled = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(BookingsPanel, {
          scope: "cancelled",
          previewRows: rows.map((row) => ({ ...row, phase: "cancelled", status: "cancelled" })),
          initialLengthOrder: "owes",
        }),
      ),
    );
    assert.match(cancelled, /Amina Cole/);
    assert.doesNotMatch(cancelled, /Bea Nguyen/);
    assert.match(cancelled, /\$600 due/);
    assert.match(cancelled, /1 Cancelled Rental(?!s)/);
  });

  it("keeps Reserved rows whose reservation fee is unpaid", () => {
    const paid: ReservationRow = reserved("bea", "Bea Nguyen", "paid");
    const unpaid: ReservationRow = reserved("amina", "Amina Cole", "pending");
    const html = renderToStaticMarkup(
      createElement(ReservationsPanel, { previewRows: [paid, unpaid], initialLengthOrder: "owes" }),
    );
    assert.match(html, /Amina Cole/);
    assert.doesNotMatch(html, /Bea Nguyen/);
    assert.match(html, /Owes Money \(1\)/);
    assert.match(html, /1 Reserved Vehicle(?!s)/);
  });
});

function row(input: { id: string; name: string; due: string; days: number; owed: number }): ActiveRentalRow {
  return {
    id: input.id,
    driverId: input.id,
    driverName: input.name,
    applicationId: input.id,
    vehicleId: input.id,
    vehicleLabel: "2018 Nissan Altima",
    vehicleVinLast6: "118204",
    vehicleUnit: "RR-014",
    startDate: "2026-11-01",
    weeksIn: weeksIn("2026-11-01", today),
    weeklyRate: 325,
    nextPaymentDue: input.due,
    overdueDays: input.days,
    lastPaymentStatus: "paid",
    lastPaymentViaStripe: false,
    paymentsLoaded: true,
    openIssues: 0,
    openIncidents: 0,
    documentsExpiring: false,
    rentOwed: input.owed,
  };
}

function booking(input: { id: string; name: string; balance: number }): BookingRow {
  return {
    id: input.id,
    source: "rental",
    phase: "completed",
    status: "completed",
    startDate: "2026-01-01",
    endDate: "2026-02-01",
    openEnded: false,
    driverName: input.name,
    driverEmail: `${input.id}@example.com`,
    applicationId: input.id,
    driverUserId: input.id,
    vehicleId: input.id,
    unitNumber: "RR-003",
    vehicleLabel: "2016 Toyota Camry",
    plate: "CAM1603",
    vinLast6: "004352",
    balanceDue: input.balance,
    weeklyRate: 350,
    lengthLabel: rentalLengthLabel("2026-01-01", "2026-02-01"),
  };
}

function reserved(id: string, driverName: string, depositStatus: ReservationDepositStatus): ReservationRow {
  return {
    id,
    applicationId: id,
    driverUserId: id,
    driverName,
    vehicleId: id,
    vehicleLabel: "2018 Nissan Altima",
    unitNumber: "RR-014",
    plate: "ALT4418",
    vinLast6: "004352",
    pickupLocation: "Shop",
    pickupDate: "2026-12-01",
    pickupTime: "11:00",
    note: null,
    bookedBy: null,
    status: "reserved",
    createdAt: "2026-11-20T16:00:00Z",
    depositRequired: true,
    depositAmount: 50,
    depositStatus,
    depositPaymentId: id,
    weeklyRate: 325,
  };
}

if (process.env.WRITE_OWES_HTML === "1") {
  const active = renderToStaticMarkup(
    createElement(ActiveRentalsPanel, {
      previewRows: [
        row({ id: "future", name: "Bea Nguyen", due: "2099-01-01", days: 0, owed: 0 }),
        row({ id: "today", name: "Amina Cole", due: today, days: 0, owed: 100 }),
        row({ id: "late", name: "Luis Ortega", due: "2020-01-01", days: 4, owed: 0 }),
      ],
    }),
  );
  const completed = renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(BookingsPanel, {
        scope: "completed",
        initialLengthOrder: "owes",
        previewRows: [
          booking({ id: "settled", name: "Bea Nguyen", balance: 0 }),
          booking({ id: "owes", name: "Amina Cole", balance: 600 }),
        ],
      }),
    ),
  );
  const page = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="http://127.0.0.1:5173/src/styles.css"><style>.admin-table-fit{overflow:visible !important}</style></head><body class="bg-[#F6F6F7]"><div class="flex min-h-screen"><aside class="w-[220px] shrink-0 bg-[#111114]"></aside><main class="min-w-0 flex-1 px-8 py-6"><h1 class="mb-4 text-lg font-semibold">Bookings · Active</h1>${active}<h1 class="mb-4 mt-8 text-lg font-semibold">Bookings · Completed · Owes Money</h1>${completed}</main></div></body></html>`;
  writeFileSync("/tmp/bookings-owes.html", page);
}
