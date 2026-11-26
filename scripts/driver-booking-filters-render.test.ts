/**
 * Renders the real Drivers filter menu and the Completed Booking list.
 * Run: bun test scripts/driver-booking-filters-render.test.ts
 * WRITE_DRIVER_FILTER_HTML=1 writes the screenshot pages to /tmp.
 */
import { mock } from "bun:test";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { writeFileSync } from "node:fs";
import * as realRouter from "@tanstack/react-router";
import * as realStart from "@tanstack/react-start";
import type { Application } from "../src/components/admin/types";

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

const { DriversPanel } = await import("../src/components/admin/DriversPanel.tsx");

const ADA = "11111111-0000-4000-8000-0000000000aa";
const BEA = "22222222-0000-4000-8000-0000000000bb";
const CAM = "33333333-0000-4000-8000-0000000000cc";
const DEE = "44444444-0000-4000-8000-0000000000dd";

function driver(id: string, name: string, status: string): Application {
  return {
    id,
    full_name: name,
    email: `${name.split(" ")[0].toLowerCase()}@example.com`,
    phone: "+18135550100",
    status,
    contact_status: "new",
    created_at: "2026-11-01T15:00:00Z",
    city: "Tampa",
    state: "FL",
  } as Application;
}

const previewDrivers = [
  driver(ADA, "Ada Cole", "approved"),
  driver(BEA, "Bea Nguyen", "approved"),
  driver(CAM, "Cam Ortiz", "closed"),
  driver(DEE, "Dee Patel", "approved"),
];
const previewBookingOutcomes = {
  completed: [ADA, CAM],
  cancelled: [BEA, CAM],
};

function panel(extra: { urlFilter?: string; previewMenuOpen?: boolean }) {
  return renderToStaticMarkup(
    createElement(DriversPanel, {
      isManager: true,
      canManageWaitlist: true,
      previewDrivers,
      previewBookingOutcomes,
      ...extra,
    }),
  );
}

describe("driver booking filters", () => {
  it("shows the new status options and keeps only completed bookings in the list", () => {
    const menu = panel({ previewMenuOpen: true });
    assert.match(menu, /Completed Booking \(2\)/);
    assert.match(menu, /Cancelled Booking \(2\)/);
    assert.match(menu, /Needs Staff/);
    assert.match(menu, /Approved, Awaiting Reservation/);
    const list = panel({ urlFilter: "completed-booking" });
    assert.match(list, /Ada Cole/);
    assert.match(list, /Cam Ortiz/);
    assert.doesNotMatch(list, /Bea Nguyen/);
    assert.doesNotMatch(list, /Dee Patel/);
    assert.match(list, /Completed Booking \(2\)/);
  });
});

if (process.env.WRITE_DRIVER_FILTER_HTML === "1") {
  const wrap = (title: string, body: string) =>
    `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="http://127.0.0.1:5173/src/styles.css"><style>.admin-table-fit{overflow:visible !important}[data-radix-popper-content-wrapper]{position:fixed !important;left:360px !important;top:148px !important;transform:none !important;z-index:80 !important}</style></head><body class="bg-[#F6F6F7]"><div class="mx-auto max-w-6xl p-6"><h1 class="mb-4 text-lg font-semibold">${title}</h1>${body}</div></body></html>`;
  writeFileSync("/tmp/driver-filters-menu.html", wrap("Drivers · Filters", panel({ previewMenuOpen: true })));
  writeFileSync("/tmp/driver-filters-completed.html", wrap("Drivers · Completed Booking", panel({ urlFilter: "completed-booking" })));
}
