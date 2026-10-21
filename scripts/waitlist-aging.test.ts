// Waitlist aging stays dark, and the numbers change when the rules change.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { supabaseAdmin } from "./fake-supabase.src.mjs";
import { displayDays } from "../src/components/admin/WaitlistAging.tsx";
import {
  buildWaitlistAging,
  easternCalendarDay,
  exactMedian,
  waitlistVehicleType,
  type AgingEntry,
} from "../src/lib/waitlist-aging-build.ts";
import { loadWaitlistAging } from "../src/lib/waitlist-aging-load.ts";

const root = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

function entry(partial: Partial<AgingEntry> & Pick<AgingEntry, "id">): AgingEntry {
  return {
    city: "Atlanta",
    status: "waiting",
    created_at: "2026-06-13T15:00:00.000Z",
    notified_at: null,
    promoted_application_id: null,
    ...partial,
  };
}

function notifiedSum(groups: { notifiedNotApplied: number }[]): number {
  return groups.reduce((sum, group) => sum + group.notifiedNotApplied, 0);
}

test("the flag is one hard false and the read stays behind it", () => {
  const flag = read("src/lib/waitlist-aging.ts");
  const fn = read("src/lib/waitlist-aging.functions.ts");
  const load = read("src/lib/waitlist-aging-load.ts");
  const buildSrc = read("src/lib/waitlist-aging-build.ts");
  const ui = read("src/components/admin/WaitlistAging.tsx");
  const panel = read("src/components/admin/WaitlistPanel.tsx");
  const nav = read("src/components/admin/nav-config.ts");
  const admin = read("src/routes/admin.tsx");

  assert.equal(flag.match(/export const WAITLIST_AGING_ENABLED\b/g)?.length, 1);
  assert.match(flag, /WAITLIST_AGING_ENABLED: boolean = false/);
  assert.doesNotMatch(flag, /process\.env/);
  assert.equal(fn.includes("WAITLIST_AGING_ENABLED"), false);
  assert.match(fn, /\[waitlistAgingGate, requireSupabaseAuth\]/);
  const refused = fn.indexOf("assertWaitlistAgingEnabled()");
  const loadImport = fn.indexOf('import("./waitlist-aging-load")');
  const role = fn.indexOf("requireStaff");
  const client = fn.indexOf("client.server");
  const loadCall = fn.indexOf("loadWaitlistAging(");
  assert.ok(refused >= 0 && refused < loadImport);
  assert.ok(loadImport < role && role < client && client < loadCall);
  assert.match(fn, /return idleWaitlistAging\(\)/);
  assert.doesNotMatch(
    fn,
    /\.from\(|\.limit\(|\bthrow\b|\.insert\(|\.update\(|\.delete\(|\.upsert\(/,
  );

  assert.match(load, /count:\s*"exact"/);
  assert.match(load, /\.range\(/);
  assert.match(load, /PAGE = 200/);
  assert.match(load, /ID_BATCH = 50/);
  assert.match(load, /i \+= ID_BATCH/);
  assert.doesNotMatch(load, /\.limit\(|\.insert\(|\.update\(|\.delete\(|\.upsert\(/);
  assert.doesNotMatch(load, /email|phone|full_name|vehicle_type/);

  assert.doesNotMatch(buildSrc, /Math\.round/);
  assert.match(ui, /Math\.round/);
  assert.ok(
    ui.indexOf("Could Not Load Waitlist Aging") < ui.indexOf("Later Entries Were Not Read"),
  );
  assert.match(ui, /result\.failed/);
  assert.ok(ui.indexOf("result.failed") < ui.indexOf("result.truncated"));
  assert.doesNotMatch(ui, /uppercase|lowercase|capitalize|text-transform|useServerFn/);

  const gate = panel.indexOf("WAITLIST_AGING_ENABLED !== true");
  const call = panel.indexOf("loadAging()");
  assert.ok(gate >= 0 && gate < call);
  assert.match(panel, /WAITLIST_AGING_ENABLED === true \? <WaitlistAging/);
  assert.doesNotMatch(nav, /waitlist-aging|Waitlist Aging/);
  assert.doesNotMatch(admin, /waitlist-aging|WaitlistAging|Waitlist Aging/);
});

test("median stays exact and vehicle type stays unknown", () => {
  assert.equal(exactMedian([]), null);
  assert.equal(exactMedian([4]), 4);
  assert.equal(exactMedian([1, 2]), 1.5);
  assert.equal(exactMedian([3, 1, 2]), 2);
  assert.equal(waitlistVehicleType({ vehicle_type: "suv" }), null);
  assert.equal(displayDays(1.5), "2");
  assert.equal(displayDays(2), "2");
  assert.equal(displayDays(null), "Unknown");

  const today = new Date("2026-06-15T15:00:00.000Z");
  const aged = buildWaitlistAging({
    today,
    applications: [],
    entries: [
      entry({ id: "a", created_at: "2026-06-13T15:00:00.000Z", vehicle_type: "suv" }),
      entry({ id: "b", created_at: "2026-06-14T15:00:00.000Z" }),
      entry({
        id: "still-waiting",
        status: "waiting",
        created_at: "2026-05-01T15:00:00.000Z",
        notified_at: "2026-05-01T15:00:00.000Z",
      }),
    ],
  });
  assert.equal(aged.groups.length, 1);
  const group = aged.groups[0]!;
  assert.equal(group.city, "Atlanta");
  assert.equal(group.vehicleType, null);
  assert.equal(group.waiting, 3);
  assert.equal(group.medianDays, 2);
  assert.equal(group.oldestDays, 45);
  assert.equal(group.notifiedNotApplied, 0);
});

test("notified window, cities, and Eastern days", () => {
  assert.equal(easternCalendarDay("2026-03-08T04:30:00.000Z"), "2026-03-07");
  assert.equal(easternCalendarDay("2026-03-08T05:00:00.000Z"), "2026-03-08");
  assert.equal(easternCalendarDay("2026-11-01T03:30:00.000Z"), "2026-10-31");
  assert.equal(easternCalendarDay("2026-11-01T04:00:00.000Z"), "2026-11-01");
  assert.equal(easternCalendarDay("2026-11-01T05:30:00.000Z"), "2026-11-01");
  assert.equal(easternCalendarDay("2026-11-01T06:30:00.000Z"), "2026-11-01");

  const march8 = new Date("2026-03-08T15:00:00.000Z");
  const open = (notifiedAt: string, applicationCreatedAt: string | null) =>
    notifiedSum(
      buildWaitlistAging({
        today: applicationCreatedAt ? new Date("2026-03-20T15:00:00.000Z") : march8,
        entries: [
          entry({
            id: "n",
            status: "notified",
            city: "Boston",
            created_at: notifiedAt,
            notified_at: notifiedAt,
            promoted_application_id: applicationCreatedAt ? "app" : null,
          }),
        ],
        applications: applicationCreatedAt ? [{ id: "app", created_at: applicationCreatedAt }] : [],
      }).groups,
    );

  assert.equal(open("2026-03-01T15:00:00.000Z", null), 1);
  assert.equal(open("2026-03-02T15:00:00.000Z", null), 0);
  assert.equal(open("2026-03-01T15:00:00.000Z", "2026-03-08T15:00:00.000Z"), 0);
  assert.equal(open("2026-03-01T15:00:00.000Z", "2026-03-09T15:00:00.000Z"), 1);
  assert.equal(open("2026-03-08T15:00:00.000Z", "2026-03-01T15:00:00.000Z"), 0);

  const unlabeled = buildWaitlistAging({
    today: march8,
    applications: [],
    entries: [
      entry({ id: "status-only", status: "notified", notified_at: null, city: "Boston" }),
      entry({ id: "blank", city: "  ", created_at: "2026-03-08T15:00:00.000Z" }),
      entry({ id: "missing", city: null, created_at: "2026-03-08T15:00:00.000Z" }),
      entry({ id: "trimmed", city: " Atlanta ", created_at: "2026-03-07T15:00:00.000Z" }),
      entry({ id: "named", city: "Atlanta", created_at: "2026-03-06T15:00:00.000Z" }),
      entry({ id: "boston", city: "Boston", created_at: "2026-03-08T15:00:00.000Z" }),
      entry({ id: "bad-date", city: "Chicago", created_at: "not-a-date" }),
      entry({
        id: "wrong-case",
        city: "Chicago",
        status: "Waiting",
        created_at: "2026-03-01T15:00:00.000Z",
      }),
    ],
  });
  assert.deepEqual(
    unlabeled.groups.map((group) => ({
      city: group.city,
      waiting: group.waiting,
      medianDays: group.medianDays,
      oldestDays: group.oldestDays,
      notifiedNotApplied: group.notifiedNotApplied,
      vehicleType: group.vehicleType,
    })),
    [
      {
        city: "Atlanta",
        waiting: 2,
        medianDays: 1.5,
        oldestDays: 2,
        notifiedNotApplied: 0,
        vehicleType: null,
      },
      {
        city: "Boston",
        waiting: 1,
        medianDays: 0,
        oldestDays: 0,
        notifiedNotApplied: 0,
        vehicleType: null,
      },
      {
        city: "Chicago",
        waiting: 1,
        medianDays: null,
        oldestDays: null,
        notifiedNotApplied: 0,
        vehicleType: null,
      },
      {
        city: null,
        waiting: 2,
        medianDays: 0,
        oldestDays: 0,
        notifiedNotApplied: 0,
        vehicleType: null,
      },
    ],
  );

  // 04:30Z on the spring-forward morning is still the previous Eastern day.
  const dst = buildWaitlistAging({
    today: new Date("2026-03-08T16:00:00.000Z"),
    applications: [],
    entries: [
      entry({ id: "before", created_at: "2026-03-08T04:30:00.000Z" }),
      entry({ id: "after", created_at: "2026-03-08T05:00:00.000Z" }),
    ],
  });
  assert.equal(dst.groups[0]?.medianDays, 0.5);
  assert.equal(dst.groups[0]?.oldestDays, 1);

  const fall = buildWaitlistAging({
    today: new Date("2026-11-07T15:00:00.000Z"),
    applications: [],
    entries: [
      entry({
        id: "fall",
        status: "notified",
        notified_at: "2026-11-01T03:30:00.000Z",
        created_at: "2026-11-01T03:30:00.000Z",
      }),
    ],
  });
  assert.equal(notifiedSum(fall.groups), 1);
});

type Fake = {
  tables: Record<string, Array<Record<string, unknown>>>;
  failSelect?: string;
  reads?: number;
  log: unknown[];
  files: Record<string, unknown>;
  defaults: Record<string, unknown>;
};

function fake(): Fake {
  return (globalThis as unknown as { __fakeSb: Fake }).__fakeSb;
}

function reset() {
  const state = fake();
  state.tables = {};
  state.failSelect = undefined;
  state.reads = 0;
  state.log = [];
  state.files = {};
  state.defaults = {};
}

test("count-checked pages, failed reads, and the second application batch", async () => {
  reset();
  fake().tables.waitlist = [
    {
      id: "n1",
      city: "Atlanta",
      status: "notified",
      created_at: "2026-01-01T15:00:00.000Z",
      notified_at: "2026-01-01T15:00:00.000Z",
      promoted_application_id: null,
    },
  ];
  const one = await loadWaitlistAging(supabaseAdmin, new Date("2026-02-01T15:00:00.000Z"));
  assert.equal(one.failed, false);
  assert.equal(one.truncated, false);
  assert.equal(notifiedSum(one.groups), 1);

  reset();
  const rows: Array<Record<string, unknown>> = [];
  for (let i = 1000; i >= 0; i--) {
    rows.push({
      id: `w${String(i).padStart(4, "0")}`,
      city: i === 1000 ? "Zebra" : "Atlanta",
      status: "waiting",
      created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
      notified_at: null,
      promoted_application_id: null,
    });
  }
  fake().tables.waitlist = rows;
  const capped = await loadWaitlistAging(supabaseAdmin, new Date("2026-06-01T15:00:00.000Z"));
  assert.equal(capped.failed, false);
  assert.equal(capped.truncated, true);
  assert.equal(capped.cap, 1000);
  assert.deepEqual(
    capped.groups.map((group) => ({ city: group.city, waiting: group.waiting })),
    [{ city: "Atlanta", waiting: 1000 }],
  );

  reset();
  fake().failSelect = "waitlist";
  fake().tables.waitlist = [
    {
      id: "w",
      city: "Atlanta",
      status: "waiting",
      created_at: "2026-01-01T15:00:00.000Z",
      notified_at: null,
      promoted_application_id: null,
    },
  ];
  const waitlistDown = await loadWaitlistAging(supabaseAdmin, new Date("2026-06-01T15:00:00.000Z"));
  assert.equal(waitlistDown.failed, true);
  assert.equal(waitlistDown.truncated, false);
  assert.deepEqual(waitlistDown.groups, []);

  reset();
  fake().failSelect = "applications";
  fake().tables.waitlist = [
    {
      id: "n",
      city: "Atlanta",
      status: "notified",
      created_at: "2026-01-01T15:00:00.000Z",
      notified_at: "2026-01-01T15:00:00.000Z",
      promoted_application_id: "app-1",
    },
  ];
  const appsDown = await loadWaitlistAging(supabaseAdmin, new Date("2026-06-01T15:00:00.000Z"));
  assert.equal(appsDown.failed, true);
  assert.equal(appsDown.truncated, false);
  assert.deepEqual(appsDown.groups, []);

  reset();
  const entries: Array<Record<string, unknown>> = [];
  const applications: Array<Record<string, unknown>> = [];
  for (let i = 0; i < 51; i++) {
    const id = `app${String(i).padStart(2, "0")}`;
    entries.push({
      id: `n${String(i).padStart(2, "0")}`,
      city: "Chicago",
      status: "notified",
      created_at: "2026-05-01T15:00:00.000Z",
      notified_at: "2026-05-01T15:00:00.000Z",
      promoted_application_id: id,
    });
    applications.push({ id, created_at: "2026-05-02T15:00:00.000Z" });
  }
  fake().tables.waitlist = entries;
  fake().tables.applications = applications;
  const batched = await loadWaitlistAging(supabaseAdmin, new Date("2026-06-01T15:00:00.000Z"));
  assert.equal(batched.failed, false);
  assert.equal(batched.truncated, false);
  assert.equal(notifiedSum(batched.groups), 0);

  const dir = path.join(root, ".waitlist-aging-build");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, "react-start.mjs"),
    `export const createServerFn = () => {
      const api = { middleware: () => api, handler: (fn) => fn };
      return api;
    };
    export const createMiddleware = () => ({ server: (fn) => fn });
    `,
  );
  writeFileSync(path.join(dir, "auth.mjs"), "export const requireSupabaseAuth = {};\n");
  const fakePath = path.join(root, "scripts/fake-supabase.src.mjs");
  await build({
    entryPoints: [path.join(root, "src/lib/waitlist-aging.functions.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: path.join(dir, "handler.mjs"),
    alias: { "@tanstack/react-start": path.join(dir, "react-start.mjs") },
    plugins: [
      {
        name: "alias-at",
        setup(plugin) {
          plugin.onResolve({ filter: /^@\// }, (args) => {
            if (args.path === "@/integrations/supabase/client.server") return { path: fakePath };
            if (args.path === "@/integrations/supabase/auth-middleware") {
              return { path: path.join(dir, "auth.mjs") };
            }
            const target = path.join(root, "src", args.path.slice(2));
            return { path: target.endsWith(".ts") ? target : `${target}.ts` };
          });
        },
      },
    ],
  });
  const before = fake().reads ?? 0;
  const bundled = await import(pathToFileURL(path.join(dir, "handler.mjs")).href);
  await assert.rejects(
    () => bundled.getWaitlistAging({ context: { userId: "staff" } }),
    /Waitlist aging is disabled/,
  );
  assert.equal(fake().reads ?? 0, before);
});
