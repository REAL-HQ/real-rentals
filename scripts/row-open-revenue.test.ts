// Run: bun test scripts/row-open-revenue.test.ts
// Whole-row open (no Open buttons) and the Driver Revenue column.
import { mock } from "bun:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as realRouter from "@tanstack/react-router";
import * as realStart from "@tanstack/react-start";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { rowHref, rowNav, rowOpenProps } from "../src/lib/row-click.ts";
import {
  DRIVER_SORT_LABEL,
  compareByRevenueDesc,
  formatRevenue,
  revenueForIds,
  sumDriverRevenue,
} from "../src/lib/driver-revenue.ts";
import { loadDriverRevenue } from "../src/lib/driver-revenue.server.ts";

mock.module("@tanstack/react-router", () => ({ ...realRouter, useNavigate: () => () => {} }));
mock.module("@tanstack/react-start", () => ({ ...realStart, useServerFn: () => async () => ({}) }));

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("row link semantics", () => {
  it("builds a plain /admin link and refuses values it cannot put in a URL", () => {
    assert.equal(rowHref({ tab: "bookings", view: "past", id: "r 1" }), "/admin?tab=bookings&view=past&id=r+1");
    assert.equal(rowHref({ tab: "drivers", id: null, q: "" }), "/admin?tab=drivers");
    assert.equal(rowHref({ tab: "x", filter: { a: 1 } }), null);
    assert.equal(rowHref(null), null);
  });

  it("Cmd/Ctrl-click and middle-click open a new tab, a plain click opens in place", () => {
    const opened: string[] = [];
    const real = (globalThis as any).window;
    (globalThis as any).window = { open: (u: string) => opened.push(u), getSelection: () => ({ toString: () => "" }) };
    try {
      let inPlace = 0;
      const row = {};
      const p = rowOpenProps(() => inPlace++, "/admin?tab=drivers&id=a1");
      let prevented = 0;
      const ev = (extra: object) => ({ target: row, currentTarget: row, preventDefault: () => prevented++, ...extra });
      p.onClick(ev({}));
      assert.equal(inPlace, 1);
      p.onClick(ev({ metaKey: true }));
      p.onClick(ev({ ctrlKey: true }));
      p.onAuxClick(ev({ button: 1 }));
      p.onAuxClick(ev({ button: 2 }));
      assert.deepEqual(opened, Array(3).fill("/admin?tab=drivers&id=a1"));
      assert.equal(inPlace, 1);
      // Keyboard: Enter opens, Cmd+Enter opens a new tab, an inner control's Enter does nothing.
      p.onKeyDown({ key: "Enter", target: row, currentTarget: row, preventDefault() {} });
      assert.equal(inPlace, 2);
      p.onKeyDown({ key: "Enter", metaKey: true, target: row, currentTarget: row, preventDefault() {} });
      assert.equal(opened.length, 4);
      p.onKeyDown({ key: "Enter", target: {}, currentTarget: row, preventDefault() {} });
      assert.equal(inPlace, 2);
      assert.equal(p.tabIndex, 0);
      assert.equal((p as any)["data-row-href"], "/admin?tab=drivers&id=a1");
    } finally {
      (globalThis as any).window = real;
    }
  });

  it("clicks on the row menu, inputs and links inside a row never open the row or a new tab", () => {
    const opened: string[] = [];
    const real = (globalThis as any).window;
    (globalThis as any).window = { open: (u: string) => opened.push(u), getSelection: () => ({ toString: () => "" }) };
    try {
      let n = 0;
      const row = { contains: () => true };
      const p = rowOpenProps(() => n++, "/admin?tab=vehicles&id=v1");
      for (const hit of ["button", "a", "select", "input", "[role=menuitem]", "[data-no-row-click]"]) {
        const target = { closest: (s: string) => (s.includes(hit.replace(/[\[\]]/g, "")) ? {} : null) };
        p.onClick({ target, currentTarget: row, metaKey: true });
        p.onClick({ target, currentTarget: row });
        p.onAuxClick({ target, currentTarget: row, button: 1 });
      }
      assert.equal(n, 0);
      assert.equal(opened.length, 0);
    } finally {
      (globalThis as any).window = real;
    }
  });

  it("selecting text does not open the row", () => {
    const real = (globalThis as any).window;
    (globalThis as any).window = { open() {}, getSelection: () => ({ toString: () => "Dana" }) };
    try {
      let n = 0;
      const row = {};
      rowOpenProps(() => n++).onClick({ target: row, currentTarget: row });
      assert.equal(n, 0);
    } finally {
      (globalThis as any).window = real;
    }
  });

  it("rowNav carries the new tab link", () => {
    const p = rowNav(() => {}, { tab: "drivers", id: "a1" }) as any;
    assert.equal(p["data-row-href"], "/admin?tab=drivers&id=a1");
  });
});

describe("Driver Revenue definition", () => {
  it("sums net_collected only, counts a partly refunded row for what is left, ignores zero rows", () => {
    const totals = sumDriverRevenue([
      { driver_id: "a", net_collected: "350" },
      { driver_id: "a", net_collected: 350 },
      { driver_id: "a", net_collected: "0" }, // failed, void, unpaid, fully refunded
      { driver_id: "a", net_collected: null },
      { driver_id: "a", net_collected: -5 },
      { driver_id: "b", net_collected: "120.10" },
      { driver_id: "b", net_collected: "0.2" },
      { driver_id: null, rental_id: "r9", net_collected: 75 },
      { driver_id: null, rental_id: "nope", net_collected: 99 },
    ], new Map([["r9", "c"]]));
    assert.deepEqual(totals, { a: 700, b: 120.3, c: 75 });
  });

  it("adds every submission id of one driver once and formats whole dollars", () => {
    const totals = { a: 700, a2: 300.4, z: 5 };
    assert.equal(revenueForIds(totals, ["a", "a2", "a", null]), 1000.4);
    assert.equal(revenueForIds(null, ["a"]), null);
    assert.equal(formatRevenue(1234), "$1,234");
    assert.equal(formatRevenue(1234.5), "$1,235");
    assert.equal(formatRevenue(0), "$0");
    assert.equal(formatRevenue(1000000), "$1,000,000");
    assert.equal(formatRevenue(null), "—");
    assert.equal(DRIVER_SORT_LABEL.revenue, "Top Revenue");
  });

  it("sorts top earners first and falls back to newest", () => {
    const rows = [
      { id: "low", revenue: 100, createdAt: "2026-11-01" },
      { id: "none", revenue: null, createdAt: "2026-11-20" },
      { id: "top", revenue: 9000, createdAt: "2026-01-01" },
      { id: "tie-new", revenue: 100, createdAt: "2026-11-10" },
    ];
    assert.deepEqual([...rows].sort(compareByRevenueDesc).map((r) => r.id), ["top", "tie-new", "low", "none"]);
  });

  it("documents the source in one place", () => {
    const src = read("src/lib/driver-revenue.ts");
    assert.match(src, /net_collected/);
    assert.match(src, /paid out of band/i);
    assert.match(src, /status = 'paid'/);
  });
});

// A tiny PostgREST stand-in: filters, count, order and range over one table.
function fakeDb(tables: Record<string, Record<string, unknown>[]>, opts: { clamp?: number; failTable?: string } = {}) {
  const calls: string[] = [];
  return {
    calls,
    from(table: string) {
      let rows = [...(tables[table] ?? [])];
      let from = 0;
      let to = Number.MAX_SAFE_INTEGER;
      const q: any = {
        select: () => q,
        gt: (c: string, v: number) => ((rows = rows.filter((r) => Number(r[c]) > v)), q),
        in: (c: string, v: unknown[]) => ((rows = rows.filter((r) => v.includes(r[c]))), q),
        order: (c: string) => ((rows = rows.sort((a, b) => String(a[c]).localeCompare(String(b[c])))), q),
        range: (f: number, t: number) => ((from = f), (to = t), q),
        then: (resolve: (v: unknown) => void) => {
          calls.push(table);
          if (opts.failTable === table) return resolve({ data: null, error: { message: "boom" }, count: null });
          const slice = rows.slice(from, Math.min(to, from + (opts.clamp ?? 1e9) - 1) + 1);
          resolve({ data: slice, error: null, count: rows.length });
        },
      };
      return q;
    },
  };
}

describe("loadDriverRevenue", () => {
  const payments = [
    ...Array.from({ length: 2500 }, (_, i) => ({ id: `p${String(i).padStart(5, "0")}`, driver_id: i % 2 ? "drv-a" : "drv-b", rental_id: null, net_collected: 1 })),
    { id: "p-oob", driver_id: "drv-c", rental_id: "r1", net_collected: 350 }, // marked paid outside Stripe: status paid, counts
    { id: "p-orphan", driver_id: null, rental_id: "r1", net_collected: 50 },
    { id: "p-failed", driver_id: "drv-c", rental_id: "r1", net_collected: 0 },
  ];
  const tables = { payments, rentals: [{ id: "r1", application_id: "drv-c" }] };

  it("pages past the 1000 row ceiling and never reads zero rows", async () => {
    const res = await loadDriverRevenue(fakeDb(tables, { clamp: 1000 }) as any);
    assert.equal(res.ok, true);
    if (res.ok) assert.deepEqual(res.totals, { "drv-a": 1250, "drv-b": 1250, "drv-c": 400 });
  });

  it("reads only the ids it is given for a page of rows", async () => {
    const res = await loadDriverRevenue(fakeDb(tables) as any, ["drv-c", "drv-c"]);
    assert.equal(res.ok, true);
    if (res.ok) assert.deepEqual(res.totals, { "drv-c": 350 });
    const none = await loadDriverRevenue(fakeDb(tables) as any, []);
    assert.deepEqual(none, { ok: true, totals: {} });
  });

  it("a failed read is a failure, not a low number", async () => {
    assert.deepEqual(await loadDriverRevenue(fakeDb(tables, { failTable: "payments" }) as any), { ok: false });
    assert.deepEqual(await loadDriverRevenue(fakeDb(tables, { failTable: "rentals" }) as any), { ok: false });
  });
});

describe("Revenue is manager data and never reaches a coordinator or a renter", () => {
  it("the Drivers list function gates on manager before any read and returns canSee false otherwise", () => {
    const fn = read("src/lib/driver-revenue.functions.ts");
    assert.match(fn, /requireSupabaseAuth/);
    assert.match(fn, /tierAllows\(actor\.tier, "manager"\)\) return \{ canSee: false \}/);
    assert.ok(fn.indexOf('tierAllows(actor.tier, "manager")') < fn.indexOf("loadDriverRevenue("));
    assert.match(fn, /context\.supabase/);
    assert.doesNotMatch(fn, /supabaseAdmin/);
  });

  it("Bookings and Active attach it only inside a manager gate", () => {
    const bookings = read("src/lib/bookings.functions.ts");
    assert.match(bookings, /if \(canSeeMoney && appIds\.length\)[\s\S]{0,200}loadDriverRevenue/);
    assert.match(bookings, /if \(canSeeMoney\) \{[\s\S]{0,400}row\.driverRevenue =/);
    const active = read("src/lib/active-rentals.functions.ts");
    assert.match(active, /await gate\(context\.userId\)[\s\S]*loadDriverRevenue/);
  });

  it("no portal, public or renter file reads it", () => {
    for (const f of ["src/routes/portal.tsx", "src/lib/portal-payment-history.ts"]) assert.doesNotMatch(read(f), /driver-revenue|driverRevenue/, f);
  });

  it("needs no migration: it reads the existing generated net_collected column", () => {
    assert.match(read("supabase/migrations/20261006020456_cf3a2cce-fa6e-4f72-85b9-c95c5d634bb4.sql"), /net_collected numeric GENERATED ALWAYS/);
    assert.doesNotMatch(read("src/lib/driver-revenue.server.ts"), /\.rpc\(/);
  });
});

const client = new QueryClient();
const render = (node: ReactElement) => renderToStaticMarkup(createElement(QueryClientProvider, { client }, node));

describe("rendered lists", () => {
  it("Active tab: Revenue column, no Open button, row carries a link, menu kept", async () => {
    const { ActiveRentalsPanel } = await import("../src/components/admin/ActiveRentalsPanel.tsx");
    const html = render(createElement(ActiveRentalsPanel, {
      previewRows: [
        { id: "r1", driverId: "u1", driverName: "Dana Rivers", applicationId: "a1", vehicleId: "v1", vehicleLabel: "2013 Ford Fusion · ABC1234", startDate: "2026-05-01", weeksIn: 4, weeklyRate: 350, nextPaymentDue: "2026-12-05", overdueDays: 0, lastPaymentStatus: "paid", lastPaymentViaStripe: true, paymentsLoaded: true, openIssues: 0, openIncidents: 0, documentsExpiring: false, rentOwed: 0, driverRevenue: 12345 },
        { id: "r2", driverId: "u2", driverName: "Sam Lee", applicationId: "a2", vehicleId: "v2", vehicleLabel: "2015 Nissan Altima · XYZ9876", startDate: "2026-06-01", weeksIn: 2, weeklyRate: 300, nextPaymentDue: "2026-12-06", overdueDays: 0, lastPaymentStatus: "paid", lastPaymentViaStripe: false, paymentsLoaded: true, openIssues: 0, openIncidents: 0, documentsExpiring: false, rentOwed: 0, driverRevenue: null },
      ],
    }));
    const head = html.slice(html.indexOf("<thead"), html.indexOf("</thead>")).replace(/<[^>]+>/g, "|").replace(/\|+/g, "|");
    assert.match(head, /\|Driver\|Vehicle\|Started\|Rate\|Revenue\|Due\|Status\|/);
    assert.equal(html.includes(">Open<"), false);
    assert.match(html, /\$12,345/);
    assert.match(html, /data-testid="revenue-cell"[^>]*>—</);
    assert.match(html, /data-row-href="\/admin\?tab=bookings&amp;view=past&amp;id=r1"/);
    assert.match(html, /aria-label="Actions For Dana Rivers"/);
    assert.match(html, /tabindex="0"/);
  });

  it("Drivers list: Revenue column and sort for a manager, absent without it, no Open header", async () => {
    const { DriversPanel } = await import("../src/components/admin/DriversPanel.tsx");
    const drivers: any[] = [
      { id: "a1", full_name: "Dana Rivers", email: "d@x.com", phone: "5551230001", status: "active", created_at: "2026-11-01T12:00:00Z", primary_application_id: null },
      { id: "a2", full_name: "Sam Lee", email: "s@x.com", phone: "5551230002", status: "approved", created_at: "2026-11-10T12:00:00Z", primary_application_id: null },
    ];
    const withRevenue = render(createElement(DriversPanel, { previewDrivers: drivers, previewRevenue: { a1: 12345.5, a2: 80 }, isManager: true }));
    const table = withRevenue.slice(withRevenue.indexOf('data-testid="drivers-table"'), withRevenue.indexOf("</table>"));
    assert.match(table, /data-revenue-header/);
    assert.match(table, /Revenue/);
    assert.match(table, /\$12,346/);
    assert.match(table, /\$80</);
    assert.equal(/>\s*Open\s*<\/th>/.test(table), false);
    assert.match(table, /<span class="sr-only">Actions<\/span>/);
    assert.match(table, /data-row-href="\/admin\?tab=drivers&amp;id=a1"/);
    const without = render(createElement(DriversPanel, { previewDrivers: drivers }));
    assert.equal(without.includes("data-revenue-header"), false);
    assert.equal(without.includes("data-revenue-cell"), false);
  });

  it("Drivers list default order is newest and Top Revenue is a named sort", () => {
    const src = read("src/components/admin/DriversPanel.tsx");
    assert.match(src, /useState<DriverSort>\("newest"\)/);
    assert.match(src, /compareByRevenueDesc/);
    assert.match(src, /DRIVER_SORT_LABEL\.revenue/);
  });
});
