/**
 * Renders the real Bookings tables and checks that each header sits on its cell.
 * A stand-in table with one fewer cell shifted Paid under Pickup and Open onto the menu.
 * Run: bun test scripts/bookings-open-column-render.test.ts
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
import type { ActiveRentalRow } from "../src/lib/active-rentals";
import type { BookingRow } from "../src/lib/bookings-list";
import type { ReservationRow } from "../src/lib/reservations";

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

const reserved: ReservationRow[] = [
  {
    id: "r1",
    applicationId: "a1",
    driverUserId: "u1",
    driverName: "Dana Rivers",
    vehicleId: "v1",
    vehicleLabel: "2013 Ford Fusion",
    unitNumber: "RR-001",
    plate: "ABC1234",
    vinLast6: "004352",
    pickupDate: "2026-05-01",
    pickupTime: "09:30",
    pickupLocation: "Shop",
    note: null,
    bookedBy: null,
    createdAt: "2026-04-20T15:00:00Z",
    status: "reserved",
    depositRequired: true,
    depositAmount: 50,
    depositStatus: "paid",
    depositPaymentId: "p1",
    weeklyRate: 350,
  },
];

const active: ActiveRentalRow[] = [
  {
    id: "a1",
    driverId: "u1",
    driverName: "Dana Rivers",
    applicationId: "a1",
    vehicleId: "v1",
    vehicleLabel: "2013 Ford Fusion",
    vehicleVinLast6: "004352",
    vehicleUnit: "RR-001",
    startDate: "2026-05-01",
    weeksIn: 4,
    weeklyRate: 350,
    nextPaymentDue: "2026-05-29",
    overdueDays: 0,
    lastPaymentStatus: "paid",
    lastPaymentViaStripe: true,
    paymentsLoaded: true,
    openIssues: 0,
    openIncidents: 0,
    documentsExpiring: false,
    rentOwed: 0,
  },
];

function booking(partial: Pick<BookingRow, "id" | "driverName" | "driverEmail" | "vehicleLabel" | "phase" | "startDate" | "endDate" | "weeklyRate" | "lengthLabel">): BookingRow {
  return {
    source: "rental",
    status: partial.phase,
    openEnded: false,
    applicationId: partial.id,
    driverUserId: partial.id,
    vehicleId: partial.id,
    unitNumber: "RR-001",
    plate: "ABC1234",
    vinLast6: "004352",
    balanceDue: 0,
    ...partial,
  };
}

const completed: BookingRow[] = [
  booking({
    id: "c1",
    driverName: "Dana Rivers",
    driverEmail: "dana@example.com",
    vehicleLabel: "2013 Ford Fusion",
    phase: "completed",
    startDate: "2026-05-01",
    endDate: "2026-08-01",
    weeklyRate: 350,
    lengthLabel: "13 Weeks 2 Days",
  }),
];

const cancelled: BookingRow[] = [
  booking({
    id: "x1",
    driverName: "Jordan Hale",
    driverEmail: "jordan@example.com",
    vehicleLabel: "2014 Chevy Malibu",
    phase: "cancelled",
    startDate: "2026-04-01",
    endDate: "2026-04-02",
    weeklyRate: 400,
    lengthLabel: "1 Day",
  }),
];

function text(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function columns(html: string): { headers: string[]; cells: string[] } {
  const headers = [...html.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map((m) => text(m[1]));
  const row = html.split(/<tr\b/).slice(2, 3)[0] ?? "";
  const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((m) => text(m[1]));
  return { headers, cells };
}

function pair(html: string): string[] {
  const { headers, cells } = columns(html);
  assert.equal(headers.length, cells.length, `header ${headers.length} vs cells ${cells.length}: ${headers.join(" | ")} // ${cells.join(" | ")}`);
  return headers.map((h, i) => `${h || "(menu)"} => ${cells[i]}`);
}

const client = new QueryClient();
function markup(node: ReactElement): string {
  return renderToStaticMarkup(node);
}

const views: Record<string, ReactElement> = {
  reserved: createElement(ReservationsPanel, { canManage: true, previewRows: reserved }),
  active: createElement(ActiveRentalsPanel, { previewRows: active }),
  completed: createElement(QueryClientProvider, { client }, createElement(BookingsPanel, { scope: "completed", previewRows: completed })),
  cancelled: createElement(QueryClientProvider, { client }, createElement(BookingsPanel, { scope: "cancelled", previewRows: cancelled })),
};

describe("real Bookings tables line each header up with its cell", () => {
  it("Reserved: Paid under Reservation Fee, rate under Rate, Open over the button, menu unlabeled", () => {
    const html = markup(views.reserved);
    const lined = pair(html);
    assert.match(lined[2], /^Reserved => Apr 20, 2026$/);
    assert.match(lined[3], /^Pickup => May 1, 2026/);
    assert.match(lined[4], /^Reservation Fee => Paid$/);
    assert.match(lined[5], /^Rate => \$350\/wk$/);
    assert.match(lined[6], /^Open => Open$/);
    assert.match(lined[7], /^\(menu\) => $/);
    assert.equal(html.includes(">Open</th>"), true);
    assert.equal((html.match(/<th\b/g) ?? []).length, 8);
  });

  it("Active: rate under Rate, due under Due, Open over the button, menu unlabeled", () => {
    const html = markup(views.active);
    const lined = pair(html);
    assert.match(lined[3], /^Rate => \$350\.00$/);
    assert.match(lined[4], /^Due => May 29, 2026/);
    assert.match(lined[5], /^Overdue => Current/);
    assert.match(lined[6], /^Open => Open$/);
    assert.match(lined[7], /^\(menu\) => $/);
    assert.equal((html.match(/<th\b/g) ?? []).length, 8);
  });

  it("Completed and Cancelled: Open is the last column and there is no menu", () => {
    for (const view of ["completed", "cancelled"] as const) {
      const html = markup(views[view]);
      const { headers, cells } = columns(html);
      assert.deepEqual(headers, ["Driver", "Vehicle", "Dates", "Status", "Rent", "Open"]);
      assert.equal(cells.length, headers.length);
      assert.match(cells[4], /^\$\d+\/wk/);
      assert.equal(cells[5], "Open");
      assert.equal(html.includes("ROW_MENU") || headers.includes(""), false);
    }
  });
});

if (process.env.WRITE_OPEN_COLUMN_HTML === "1") {
  const tabs = ["reserved", "active", "completed", "cancelled"];
  for (const view of tabs) {
    const body = markup(views[view]);
    const tabBar = tabs
      .map((id) => {
        const label = id[0].toUpperCase() + id.slice(1);
        const on = id === view;
        return `<span class="-mb-px border-b-2 px-0.5 pb-2 text-sm font-semibold ${on ? "border-[#D03020] text-foreground" : "border-transparent text-muted-foreground"}">${label}</span>`;
      })
      .join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="http://127.0.0.1:5173/src/styles.css"></head><body class="bg-[#F6F6F7]"><div class="mx-auto max-w-6xl space-y-4 p-6"><h1 class="text-lg font-semibold">Bookings</h1><div class="flex flex-wrap items-end gap-5 border-b border-border">${tabBar}</div>${body}</div></body></html>`;
    writeFileSync(`/tmp/open-header-${view}.html`, html);
  }
}
