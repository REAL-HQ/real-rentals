/**
 * Cancelled booking rows show the renter's credit under Status.
 * Run: bun test scripts/cancelled-credit-line-render.test.ts
 * WRITE_CANCELLED_CREDIT_HTML=1 writes the screenshot page to /tmp.
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
import type { BookingRow } from "../src/lib/bookings-list";
import type { CancelledRentalCredit } from "../src/lib/forfeited-fee-credit";

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

const { BookingsPanel } = await import("../src/components/admin/BookingsPanel.tsx");

const FABIO = "057edf3f-1111-4000-8000-000000000001";
const JONATHON = "303a7ae5-2222-4000-8000-000000000002";
const CASEY = "11111111-3333-4000-8000-000000000003";
const RILEY = "11111111-4444-4000-8000-000000000004";
const SAM = "11111111-5555-4000-8000-000000000005";
const DEE = "11111111-6666-4000-8000-000000000006";
const APP = (n: string) => `aaaaaaaa-0000-4000-8000-00000000000${n}`;
const NOW = new Date("2026-11-26T16:00:00Z");

function row(over: Partial<BookingRow> & Pick<BookingRow, "id" | "driverName" | "applicationId">): BookingRow {
  return {
    source: "rental",
    phase: "cancelled",
    status: "cancelled",
    startDate: "2026-11-01",
    endDate: "2026-11-20",
    openEnded: false,
    lengthLabel: "19 Days",
    driverEmail: "driver@example.com",
    driverUserId: over.applicationId,
    vehicleId: "33333333-0000-4000-8000-0000000000cc",
    unitNumber: "RR-014",
    vehicleLabel: "2018 Nissan Altima",
    plate: "ALT4418",
    vinLast6: "118204",
    weeklyRate: 325,
    balanceDue: 0,
    ...over,
  };
}

const rows: BookingRow[] = [
  row({ id: FABIO, driverName: "Fabio Hale", applicationId: APP("1"), driverEmail: "fabio@example.com", unitNumber: "RR-014", plate: "ALT4418", vinLast6: "118204" }),
  row({ id: JONATHON, driverName: "Jonathon", applicationId: APP("2"), driverEmail: "jonathon@example.com", unitNumber: "RR-022", vehicleLabel: "2019 Toyota Camry", plate: "CAM1902", vinLast6: "440219" }),
  row({ id: CASEY, driverName: "Casey Nguyen", applicationId: APP("3"), driverEmail: "casey@example.com", unitNumber: "RR-008", vehicleLabel: "2020 Honda Accord", plate: "ACC2008", vinLast6: "882001" }),
  row({ id: RILEY, driverName: "Riley Ortiz", applicationId: APP("4"), driverEmail: "riley@example.com", unitNumber: "RR-003", vehicleLabel: "2017 Hyundai Elantra", plate: "ELN1703", vinLast6: "331704" }),
  row({ id: SAM, driverName: "Sam Patel", applicationId: APP("5"), driverEmail: "sam@example.com", unitNumber: "RR-011", vehicleLabel: "2016 Ford Fusion", plate: "FUS1611", vinLast6: "551611" }),
  row({ id: DEE, driverName: "Dee Cole", applicationId: APP("6"), driverEmail: "dee@example.com", unitNumber: "RR-019", vehicleLabel: "2021 Kia Forte", plate: "FOR2119", vinLast6: "772119" }),
];

const credits: CancelledRentalCredit[] = [
  { id: "c-fabio", applicationId: APP("1"), sourceRentalId: FABIO, amount: 50, status: "available", expiresAt: "2027-02-23T15:00:00Z", createdAt: "2026-11-25T15:00:00Z" },
  { id: "c-jon", applicationId: APP("2"), sourceRentalId: JONATHON, amount: 50, status: "available", expiresAt: "2027-02-17T15:00:00Z", createdAt: "2026-11-19T15:00:00Z" },
  { id: "c-casey", applicationId: APP("3"), sourceRentalId: CASEY, amount: 50, status: "available", expiresAt: "2026-12-03T16:00:00Z", createdAt: "2026-11-20T15:00:00Z" },
  { id: "c-riley", applicationId: APP("4"), sourceRentalId: RILEY, amount: 50, status: "available", expiresAt: "2026-01-01T15:00:00Z", createdAt: "2025-10-01T15:00:00Z" },
  { id: "c-sam", applicationId: APP("5"), sourceRentalId: SAM, amount: 50, status: "applied", expiresAt: "2027-01-15T15:00:00Z", createdAt: "2026-10-15T15:00:00Z" },
];

const client = new QueryClient();

function panel() {
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(BookingsPanel, {
        scope: "cancelled",
        canManage: false,
        previewRows: rows,
        previewKeptFees: [{ rentalId: DEE, paymentId: "03733dbe-a9c1-4eaf-9f42-2c04e386945a" }],
        previewCreditMode: "case_by_case",
        previewCredits: credits,
        previewNow: NOW,
      }),
    ),
  );
}

describe("cancelled credit line", () => {
  it("shows amount, status, redeem-by date, and the days-left pill", () => {
    const html = panel();
    assert.match(html, /Fabio Hale/);
    assert.match(html, /\$50\.00 · Available/);
    assert.match(html, /Expires Feb 23, 2027/);
    assert.match(html, /Expires Feb 17, 2027/);
    assert.match(html, /bg-\[#FFF4D6\]/);
    assert.match(html, />7 days left</);
    assert.match(html, /data-credit-state="expired"/);
    assert.match(html, /Expired Jan 1, 2026/);
    assert.match(html, /\$50\.00 · Credit Applied/);
    assert.match(html, /Expires Jan 15, 2027/);
    assert.match(html, /Fee Kept, Credit Not Decided/);
    const deeStart = html.indexOf(`data-booking="${DEE}"`);
    const deeRow = html.slice(deeStart, html.indexOf("</tr>", deeStart));
    assert.equal(deeRow.includes("cancelled-credit"), false);
    assert.match(deeRow, /Fee Kept, Credit Not Decided/);
    assert.match(html, />Open<\/th>/);
    assert.match(html, /Open <svg/);
  });
});

if (process.env.WRITE_CANCELLED_CREDIT_HTML === "1") {
  const wrap = (body: string) =>
    `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="http://127.0.0.1:5173/src/styles.css"></head><body class="bg-[#F6F6F7]"><div class="mx-auto max-w-6xl p-6"><h1 class="mb-4 text-lg font-semibold">Bookings · Cancelled</h1>${body}</div></body></html>`;
  writeFileSync("/tmp/cancelled-credit-line.html", wrap(panel()));
}
