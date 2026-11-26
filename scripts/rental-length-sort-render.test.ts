/**
 * The real Bookings panels order their own rows.
 * Run: bun test scripts/rental-length-sort-render.test.ts
 * WRITE_LENGTH_HTML=1 also writes the screenshot pages to /tmp.
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
import { etDateISO, weeksIn, type ActiveRentalRow } from "../src/lib/active-rentals";
import type { BookingRow } from "../src/lib/bookings-list";
import type { ReservationRow } from "../src/lib/reservations";
import { rentalLengthLabel } from "../src/lib/swap-ended-rental";
import type { RentalLengthOrder } from "../src/lib/rental-length-order";

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

function reserved(partial: {
  id: string;
  driverName: string;
  createdAt: string;
  pickupDate: string;
  pickupTime: string | null;
  status?: string;
  unitNumber: string;
  vehicleLabel: string;
  plate: string;
  weeklyRate: number;
}): ReservationRow {
  return {
    applicationId: partial.id,
    driverUserId: partial.id,
    vehicleId: partial.id,
    vinLast6: "004352",
    pickupLocation: "Shop",
    note: null,
    bookedBy: null,
    status: partial.status ?? "reserved",
    depositRequired: true,
    depositAmount: 50,
    depositStatus: "paid",
    depositPaymentId: partial.id,
    ...partial,
  };
}

const reservedRows: ReservationRow[] = [
  reserved({
    id: "bea",
    driverName: "Bea Nguyen",
    createdAt: "2026-11-20T16:00:00Z",
    pickupDate: "2026-11-28",
    pickupTime: "11:00",
    unitNumber: "RR-014",
    vehicleLabel: "2018 Nissan Altima",
    plate: "ALT4418",
    weeklyRate: 325,
  }),
  reserved({
    id: "amina",
    driverName: "Amina Cole",
    createdAt: "2026-06-01T15:00:00Z",
    pickupDate: "2026-12-04",
    pickupTime: "09:30",
    unitNumber: "RR-003",
    vehicleLabel: "2016 Toyota Camry",
    plate: "CAM1603",
    weeklyRate: 350,
  }),
  reserved({
    id: "jordan",
    driverName: "Jordan Hale",
    createdAt: "2026-10-01T15:00:00Z",
    pickupDate: "2026-11-30",
    pickupTime: null,
    status: "pending_reservation",
    unitNumber: "RR-021",
    vehicleLabel: "2015 Honda Accord",
    plate: "ACC1521",
    weeklyRate: 300,
  }),
  reserved({
    id: "luis",
    driverName: "Luis Ortega",
    createdAt: "2026-09-15T15:00:00Z",
    pickupDate: "2026-12-12",
    pickupTime: "14:00",
    unitNumber: "RR-008",
    vehicleLabel: "2017 Hyundai Elantra",
    plate: "ELN1708",
    weeklyRate: 280,
  }),
];

function active(partial: {
  id: string;
  driverName: string;
  startDate: string;
  unit: string;
  vehicleLabel: string;
  weeklyRate: number;
  overdueDays?: number;
  openIssues?: number;
}): ActiveRentalRow {
  return {
    id: partial.id,
    driverId: partial.id,
    driverName: partial.driverName,
    applicationId: partial.id,
    vehicleId: partial.id,
    vehicleLabel: partial.vehicleLabel,
    vehicleVinLast6: "118204",
    vehicleUnit: partial.unit,
    startDate: partial.startDate,
    weeksIn: weeksIn(partial.startDate, today),
    weeklyRate: partial.weeklyRate,
    nextPaymentDue: "2026-12-01",
    overdueDays: partial.overdueDays ?? 0,
    lastPaymentStatus: "paid",
    lastPaymentViaStripe: false,
    paymentsLoaded: true,
    openIssues: partial.openIssues ?? 0,
    openIncidents: 0,
    documentsExpiring: false,
    rentOwed: 0,
  };
}

const activeRows: ActiveRentalRow[] = [
  active({ id: "bea", driverName: "Bea Nguyen", startDate: "2026-11-10", unit: "RR-014", vehicleLabel: "2018 Nissan Altima", weeklyRate: 325 }),
  active({ id: "amina", driverName: "Amina Cole", startDate: "2026-03-02", unit: "RR-003", vehicleLabel: "2016 Toyota Camry", weeklyRate: 350, overdueDays: 9 }),
  active({ id: "luis", driverName: "Luis Ortega", startDate: "2026-07-20", unit: "RR-008", vehicleLabel: "2017 Hyundai Elantra", weeklyRate: 280, openIssues: 1 }),
];

function booking(partial: {
  id: string;
  driverName: string;
  phase: BookingRow["phase"];
  startDate: string;
  endDate: string;
  unitNumber: string;
  vehicleLabel: string;
  weeklyRate: number;
}): BookingRow {
  return {
    source: "rental",
    status: partial.phase === "swap" ? "cancelled" : partial.phase,
    openEnded: false,
    applicationId: partial.id,
    driverUserId: partial.id,
    driverEmail: `${partial.id}@example.com`,
    vehicleId: partial.id,
    plate: "ABC1234",
    vinLast6: "004352",
    balanceDue: 0,
    lengthLabel: rentalLengthLabel(partial.startDate, partial.endDate),
    ...partial,
  };
}

const completedRows: BookingRow[] = [
  booking({
    id: "bea",
    driverName: "Bea Nguyen",
    phase: "completed",
    startDate: "2026-11-01",
    endDate: "2026-11-02",
    unitNumber: "RR-014",
    vehicleLabel: "2018 Nissan Altima",
    weeklyRate: 325,
  }),
  booking({
    id: "amina",
    driverName: "Amina Cole",
    phase: "completed",
    startDate: "2026-01-01",
    endDate: "2026-04-01",
    unitNumber: "RR-003",
    vehicleLabel: "2016 Toyota Camry",
    weeklyRate: 350,
  }),
  booking({
    id: "luis",
    driverName: "Luis Ortega",
    phase: "completed",
    startDate: "2026-06-01",
    endDate: "2026-06-15",
    unitNumber: "RR-008",
    vehicleLabel: "2017 Hyundai Elantra",
    weeklyRate: 280,
  }),
];

const cancelledRows: BookingRow[] = [
  booking({
    id: "bea",
    driverName: "Bea Nguyen",
    phase: "cancelled",
    startDate: "2026-09-01",
    endDate: "2026-09-08",
    unitNumber: "RR-014",
    vehicleLabel: "2018 Nissan Altima",
    weeklyRate: 325,
  }),
  booking({
    id: "amina",
    driverName: "Amina Cole",
    phase: "swap",
    startDate: "2026-02-01",
    endDate: "2026-08-01",
    unitNumber: "RR-003",
    vehicleLabel: "2016 Toyota Camry",
    weeklyRate: 350,
  }),
  booking({
    id: "luis",
    driverName: "Luis Ortega",
    phase: "cancelled",
    startDate: "2026-05-01",
    endDate: "2026-05-02",
    unitNumber: "RR-008",
    vehicleLabel: "2017 Hyundai Elantra",
    weeklyRate: 280,
  }),
];

const client = new QueryClient();

function view(tab: "reserved" | "active" | "completed" | "cancelled", order: RentalLengthOrder): ReactElement {
  if (tab === "reserved") return createElement(ReservationsPanel, { canManage: true, previewRows: reservedRows, initialLengthOrder: order });
  if (tab === "active") return createElement(ActiveRentalsPanel, { previewRows: activeRows, initialLengthOrder: order });
  const rows = tab === "completed" ? completedRows : cancelledRows;
  return createElement(
    QueryClientProvider,
    { client },
    createElement(BookingsPanel, { scope: tab, previewRows: rows, initialLengthOrder: order }),
  );
}

function markup(node: ReactElement): string {
  return renderToStaticMarkup(node);
}

function indexes(html: string, names: string[]): number[] {
  return names.map((name) => {
    const at = html.indexOf(name);
    assert.ok(at >= 0, `${name} missing`);
    return at;
  });
}

function assertOrder(html: string, names: string[]) {
  const at = indexes(html, names);
  const sorted = [...at].sort((a, b) => a - b);
  assert.deepEqual(at, sorted, names.join(" then "));
}

function assertSelected(html: string, order: RentalLengthOrder) {
  assert.match(html, new RegExp(`<option[^>]*value="${order}"[^>]*selected`));
  assert.match(html, /data-testid="rental-length-sort"/);
}

describe("Bookings length order on the real panels", () => {
  it("Reserved holds longest from the Reserved date, and a Not Booked row still sorts", () => {
    const longest = markup(view("reserved", "longest"));
    const shortest = markup(view("reserved", "shortest"));
    assertSelected(longest, "longest");
    assertSelected(shortest, "shortest");
    assertOrder(longest, ["Amina Cole", "Luis Ortega", "Jordan Hale", "Bea Nguyen"]);
    assertOrder(shortest, ["Bea Nguyen", "Jordan Hale", "Luis Ortega", "Amina Cole"]);
    assert.match(longest, /Not Booked/);
  });

  it("Active sorts time since the start date and still honors Overdue", () => {
    const longest = markup(view("active", "longest"));
    const shortest = markup(view("active", "shortest"));
    assertOrder(longest, ["Amina Cole", "Luis Ortega", "Bea Nguyen"]);
    assertOrder(shortest, ["Bea Nguyen", "Luis Ortega", "Amina Cole"]);
    const overdue = markup(
      createElement(ActiveRentalsPanel, {
        previewRows: [
          ...activeRows,
          active({
            id: "nia",
            driverName: "Nia Brooks",
            startDate: "2026-01-01",
            unit: "RR-001",
            vehicleLabel: "2014 Chevy Malibu",
            weeklyRate: 300,
            overdueDays: 0,
          }),
          active({
            id: "cora",
            driverName: "Cora Diaz",
            startDate: "2026-10-15",
            unit: "RR-019",
            vehicleLabel: "2019 Kia Forte",
            weeklyRate: 310,
            overdueDays: 4,
          }),
        ],
        initialLengthOrder: "longest",
        initialFilter: "overdue",
      }),
    );
    assert.equal(overdue.includes("Nia Brooks"), false);
    assert.equal(overdue.includes("Luis Ortega"), false);
    assert.equal(overdue.includes("Bea Nguyen"), false);
    assertOrder(overdue, ["Amina Cole", "Cora Diaz"]);
  });

  it("Completed and Cancelled sort start-to-end length", () => {
    assertOrder(markup(view("completed", "longest")), ["Amina Cole", "Luis Ortega", "Bea Nguyen"]);
    assertOrder(markup(view("completed", "shortest")), ["Bea Nguyen", "Luis Ortega", "Amina Cole"]);
    assertOrder(markup(view("cancelled", "longest")), ["Amina Cole", "Bea Nguyen", "Luis Ortega"]);
    assertOrder(markup(view("cancelled", "shortest")), ["Luis Ortega", "Bea Nguyen", "Amina Cole"]);
    assert.match(markup(view("completed", "default")), /<option[^>]*value="default"[^>]*selected/);
  });
});

if (process.env.WRITE_LENGTH_HTML === "1") {
  const tabs = ["reserved", "active", "completed", "cancelled"] as const;
  const labels = { reserved: "Reserved", active: "Active", completed: "Completed", cancelled: "Cancelled" };
  for (const tab of tabs) {
    for (const order of ["longest", "shortest"] as const) {
      const body = markup(view(tab, order));
      const tabBar = tabs
        .map((id) => {
          const on = id === tab;
          return `<span class="-mb-px border-b-2 px-0.5 pb-2 text-sm font-semibold ${on ? "border-[#D03020] text-foreground" : "border-transparent text-muted-foreground"}">${labels[id]}</span>`;
        })
        .join("");
      const html = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="http://127.0.0.1:5173/src/styles.css"></head><body class="bg-[#F6F6F7]"><div class="mx-auto max-w-6xl space-y-4 p-6"><h1 class="text-lg font-semibold">Bookings</h1><div class="flex flex-wrap items-end gap-5 border-b border-border">${tabBar}</div>${body}</div></body></html>`;
      writeFileSync(`/tmp/length-${tab}-${order}.html`, html);
    }
  }
}
