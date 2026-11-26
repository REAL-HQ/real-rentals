/**
 * Service records table fits its cells, and Service labels are Title Case.
 * Run: bun test scripts/service-records-layout.test.ts
 */
import { mock } from "bun:test";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, writeFileSync } from "node:fs";
import * as realRouter from "@tanstack/react-router";
import * as realStart from "@tanstack/react-start";

mock.module("@tanstack/react-router", () => ({
  ...realRouter,
  useNavigate: () => () => {},
  Link: ({ children, className }: { children?: ReactNode; className?: string }) =>
    createElement("a", { className }, children),
}));
mock.module("@tanstack/react-start", () => ({
  ...realStart,
  useServerFn: () => async () => ({ attention: [], upcoming: [] }),
}));
mock.module("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ select: () => ({ order: async () => ({ data: [], error: null }) }) }) },
}));

const { MaintenancePanel, recordCount } = await import("../src/components/admin/MaintenancePanel.tsx");

const vehicles = [
  vehicle("v1", 2018, "Nissan", "Altima", 84210),
  vehicle("v2", 2016, "Toyota", "Camry", null),
];

const rows = [
  record("r1", "v1", "Oil Change", "routine", "completed", "2026-11-02", 89.5, "Full synthetic. Filter replaced. Next interval is 5,000 miles."),
  record("r2", "v1", "Brake Inspection", "repair", "in_progress", "2026-11-20", 240, "Waiting on pads from the shop."),
  record("r3", "v2", "Tire Rotation", "inspection", "scheduled", "2026-12-04", 0, null),
];

describe("service records layout", () => {
  it("counts one record and many records in title case", () => {
    assert.equal(recordCount(1), "1 Record");
    assert.equal(recordCount(0), "0 Records");
    assert.equal(recordCount(3), "3 Records");
  });

  it("keeps the status select inside a padded cell and title-cases the page", () => {
    const html = renderToStaticMarkup(
      createElement(MaintenancePanel, { preview: { rows, vehicles } }),
    );
    assert.match(html, /data-testid="service-records-table"/);
    assert.match(html, /table-fixed/);
    assert.match(html, /w-\[16%\].*Status/);
    assert.match(html, /w-\[14%\].*Item/);
    assert.match(html, /w-\[12%\].*Category/);
    assert.match(html, /w-\[12%\].*Due/);
    assert.match(html, /w-\[10%\].*Cost/);
    assert.match(html, /w-\[14%\].*Notes/);
    assert.match(html, /w-full max-w-full/);
    assert.match(html, />Completed</);
    assert.match(html, /3 Records/);
    assert.match(html, /placeholder="Log Reading"/);
    assert.doesNotMatch(html, /record\(s\)/);
    assert.doesNotMatch(html, /placeholder="Log reading"/);
    const source = readFileSync("src/components/admin/MaintenancePanel.tsx", "utf8");
    assert.match(source, /placeholder="New Reading"/);
    assert.match(source, /placeholder="Item \(e\.g\. Oil Change\)"/);
    assert.match(html, />Routine</);
    assert.match(html, />Repair</);
    assert.match(html, />Inspection</);
    assert.match(html, /Full synthetic/);
    const statusHeader = html.indexOf(">Status<");
    const itemHeader = html.indexOf(">Item<");
    const categoryHeader = html.indexOf(">Category<");
    assert.ok(statusHeader > 0 && itemHeader > statusHeader && categoryHeader > itemHeader);
  });
});

if (process.env.WRITE_SERVICE_HTML === "1") {
  const body = renderToStaticMarkup(createElement(MaintenancePanel, { preview: { rows, vehicles } }));
  const page = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="http://127.0.0.1:5173/src/styles.css"><style>.admin-table-fit{overflow:visible !important}</style></head><body class="bg-[#F6F6F7]"><div class="flex min-h-screen"><aside class="w-[220px] shrink-0 bg-[#111114]"></aside><main class="min-w-0 flex-1 px-8 py-6"><h1 class="mb-4 text-lg font-semibold">Service · Maintenance</h1>${body}</main></div></body></html>`;
  writeFileSync("/tmp/service-records.html", page);
}

function vehicle(id: string, year: number, make: string, model: string, odometer: number | null) {
  return {
    id,
    year,
    make,
    model,
    status: "available",
    current_odometer: odometer,
    last_oil_change_miles: 80000,
    oil_interval_miles: 5000,
    last_tire_date: null,
    last_brake_inspection_date: null,
  };
}

function record(
  id: string,
  vehicle_id: string,
  item: string,
  category: string,
  status: string,
  due_date: string,
  total_cost: number,
  notes: string | null,
) {
  return { id, vehicle_id, item, category, status, due_date, total_cost, notes, created_at: "2026-11-01T12:00:00Z" };
}
