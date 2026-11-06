// Run: bun test scripts/application-doc-gaps.test.ts
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { describe, it } from "node:test";
import { supabaseAdmin } from "./fake-supabase.src.mjs";
import {
  APPLICATION_DOC_GAPS_ENABLED,
  APPLICATION_DOC_GAPS_ROW_CAP,
  OPEN_APPLICATION_STATUSES,
} from "../src/lib/application-doc-gaps";
import { buildApplicationDocGaps, type GapDocument } from "../src/lib/application-doc-gaps-build";
import { loadApplicationDocGaps } from "../src/lib/application-doc-gaps-load";
import { canonicalRequiredDoc, requiredDocCounts } from "../src/lib/required-docs";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const fake = globalThis.__fakeSb as { tables: Record<string, unknown[]>; failSelect?: string; reads?: number };

function slot(result: ReturnType<typeof buildApplicationDocGaps>, id: string, key: string) {
  return result.applications.find((app) => app.id === id)?.slots.find((item) => item.key === key);
}

function doc(partial: GapDocument & { id: string }): GapDocument {
  return {
    driver_id: "open",
    category: "license_front",
    is_current: true,
    review_status: "uploaded",
    created_at: "2026-03-08T05:00:00.000Z",
    ...partial,
  };
}

describe("application document gaps", () => {
  it("declares the flag once, hard false, with no env", () => {
    const src = read("src/lib/application-doc-gaps.ts");
    assert.equal(src.match(/export const APPLICATION_DOC_GAPS_ENABLED: boolean = false/g)?.length, 1);
    assert.equal(APPLICATION_DOC_GAPS_ENABLED, false);
    assert.equal(read("src/lib/application-doc-gaps.functions.ts").includes("APPLICATION_DOC_GAPS_ENABLED"), false);
    assert.equal(read("src/lib/application-doc-gaps-load.ts").includes("APPLICATION_DOC_GAPS_ENABLED"), false);
    assert.doesNotMatch(src, /process\.env/);
    assert.doesNotMatch(read("src/lib/application-doc-gaps.functions.ts"), /process\.env/);
    assert.doesNotMatch(read("src/lib/application-doc-gaps-load.ts"), /process\.env/);
    assert.doesNotMatch(read("src/lib/application-doc-gaps-build.ts"), /process\.env/);
  });

  it("refuses before the role check and before any read", () => {
    const fn = read("src/lib/application-doc-gaps.functions.ts");
    assert.match(fn, /\.middleware\(\[applicationDocGapsGate, requireSupabaseAuth\]\)/);
    const handler = fn.slice(fn.indexOf(".handler("));
    const asserted = handler.indexOf("assertApplicationDocGapsEnabled()");
    const loadImport = handler.indexOf('import("./application-doc-gaps-load")');
    const role = handler.indexOf("requireManager(");
    const client = handler.indexOf('import("@/integrations/supabase/client.server")');
    const loadCall = handler.indexOf("loadApplicationDocGaps(");
    assert.ok(asserted !== -1 && asserted < loadImport && loadImport < role && role < client && client < loadCall);
    assert.match(handler, /if \(DOC_GAPS_REFUSED\) \{\s*assertApplicationDocGapsEnabled\(\);\s*\} else \{/);
    assert.doesNotMatch(fn, /return idle\(/);
    assert.doesNotMatch(fn, /\.from\(|\.limit\(/);
    assert.doesNotMatch(fn, /throw /);
    assert.doesNotMatch(fn, /\.(insert|update|delete|upsert)\(/);
    const load = read("src/lib/application-doc-gaps-load.ts");
    assert.match(load, /count: "exact"/);
    assert.match(load, /\.range\(from, to\)/);
    assert.match(load, /canonicalRequiredDoc/);
    assert.match(load, /from "\.\/count-paged-read"/);
    assert.match(read("src/lib/count-paged-read.ts"), /COUNTED_ID_BATCH = 100/);
    assert.doesNotMatch(load, /\.in\("category"/);
    assert.doesNotMatch(load, /\.limit\(/);
    assert.doesNotMatch(load, /proof_of_address|license_photo_url|insurance_doc_url|address/);
    assert.equal(APPLICATION_DOC_GAPS_ROW_CAP, 1000);
    assert.deepEqual(OPEN_APPLICATION_STATUSES, ["partial", "new", "complete", "reviewing"]);
  });

  it("extends the drivers list and does not add a route or tab", () => {
    const panel = read("src/components/admin/DriversPanel.tsx");
    const ui = read("src/components/admin/ApplicationDocGaps.tsx");
    const gate = panel.indexOf(
      "if (APPLICATION_DOC_GAPS_ENABLED !== true || !driversLoaded || canSeeSensitive !== true) return;",
    );
    const call = panel.indexOf("loadDocGaps()");
    assert.ok(gate !== -1 && call !== -1 && gate < call);
    assert.equal(ui.includes("useServerFn"), false);
    assert.match(panel, /<ApplicationDocGaps/);
    assert.doesNotMatch(ui, /uppercase|lowercase|capitalize/);
    assert.doesNotMatch(read("src/components/admin/nav-config.ts"), /application-doc-gaps|Application Documents/);
    assert.doesNotMatch(read("src/routes/admin.tsx"), /ApplicationDocGaps|application-doc-gaps/);
    assert.match(ui, /License Front/);
    assert.match(ui, /License Back/);
    assert.match(ui, /Insurance/);
    assert.match(ui, /Gig Profile/);
    assert.match(ui, /Proof Of Address/);
    assert.match(ui, /Present/);
    assert.match(ui, /Missing/);
    assert.match(ui, /Unknown/);
    const failed = ui.indexOf("Could Not Load Application Documents");
    const capped = ui.indexOf("Later Applications Were Not Read");
    assert.ok(failed !== -1 && capped !== -1 && failed < capped);
  });

  it("uses the shared required-document rule, and proof of address stays unknown", () => {
    assert.equal(canonicalRequiredDoc({ category: "insurance", is_current: true, review_status: "uploaded" }), "insurance_card");
    assert.equal(canonicalRequiredDoc({ category: "gig_profile", is_current: true, review_status: "verified" }), "driver_profile_screenshot");
    assert.equal(canonicalRequiredDoc({ category: "license_back", is_current: true, review_status: "rejected" }), null);
    assert.equal(canonicalRequiredDoc({ category: "trip_history", is_current: true, review_status: "uploaded" }), null);
    assert.equal(canonicalRequiredDoc({ category: "proof_of_address", is_current: true, review_status: "uploaded" }), null);
    assert.deepEqual(
      requiredDocCounts([
        { lead_id: "a", category: "license_front" },
        { lead_id: "a", category: "insurance" },
        { lead_id: "a", category: "insurance_card" },
        { lead_id: "a", category: "license_back", review_status: "rejected" },
        { lead_id: "a", category: "gig_profile", is_current: false },
      ]),
      { a: 2 },
    );

    const documents: GapDocument[] = [
      doc({ id: "front-early", category: "license_front", created_at: "2026-03-08T04:30:00.000Z" }),
      doc({ id: "front-late", category: "license_front", created_at: "2026-03-08T05:00:00.000Z" }),
      doc({ id: "back-rejected", category: "license_back", review_status: "rejected", created_at: "2026-03-08T12:00:00.000Z" }),
      doc({ id: "ins", category: "insurance", created_at: "2026-11-01T04:00:00.000Z" }),
      doc({ id: "old-gig", driver_id: "open", category: "gig_profile", is_current: false, created_at: "2026-01-01T00:00:00.000Z" }),
      doc({ id: "trip", category: "trip_history", created_at: "2026-06-01T15:00:00.000Z" }),
      doc({ id: "proof", category: "proof_of_address", created_at: "2026-06-01T15:00:00.000Z" }),
      doc({
        id: "expired-still-counts",
        driver_id: "dated",
        category: "license_front",
        created_at: "2026-03-09T03:30:00.000Z",
        expires_at: "2020-01-01",
      }),
    ];
    const result = buildApplicationDocGaps({
      applications: [
        { id: "open", full_name: "Ada Lovelace", status: "reviewing", deleted_at: null },
        { id: "dated", full_name: "  ", status: "partial", deleted_at: null },
        { id: "bare", full_name: "New Driver", status: "new", deleted_at: null },
        { id: "done", full_name: "Approved", status: "approved", deleted_at: null },
        { id: "live", full_name: "Active", status: "active", deleted_at: null },
        { id: "held", full_name: "Suspended", status: "suspended", deleted_at: null },
        { id: "no", full_name: "Declined", status: "declined", deleted_at: null },
        { id: "shut", full_name: "Closed", status: "closed", deleted_at: null },
        { id: "copy", full_name: "Duplicate", status: "duplicate", deleted_at: null },
        { id: "gone", full_name: "Deleted", status: "new", deleted_at: "2026-01-01T00:00:00.000Z" },
      ],
      documents,
      truncated: false,
    });
    assert.deepEqual(
      result.applications.map((app) => app.id),
      ["open", "dated", "bare"],
    );
    assert.equal(result.applications[1]?.name, "Unnamed Applicant");
    assert.equal(slot(result, "open", "license_front")?.state, "present");
    assert.equal(slot(result, "open", "license_front")?.on, "2026-03-08");
    assert.equal(slot(result, "open", "license_back")?.state, "missing");
    assert.equal(slot(result, "open", "insurance_card")?.state, "present");
    assert.equal(slot(result, "open", "insurance_card")?.on, "2026-11-01");
    assert.equal(slot(result, "open", "driver_profile_screenshot")?.state, "missing");
    assert.equal(slot(result, "open", "proof_of_address")?.state, "unknown");
    assert.equal(slot(result, "open", "proof_of_address")?.on, null);
    assert.equal(slot(result, "dated", "license_front")?.state, "present");
    assert.equal(slot(result, "dated", "license_front")?.on, "2026-03-08");
    assert.equal(slot(result, "bare", "license_front")?.state, "missing");
    assert.equal(slot(result, "bare", "proof_of_address")?.state, "unknown");
    assert.equal(result.applications.some((app) => app.slots.some((item) => item.key === "trip_history")), false);
  });
});

describe("application document gap pages", () => {
  type Page = { data: unknown[] | null; error: unknown; count: number | null };

  function pagingAdmin(reply: (table: string, from: number, to: number) => Page, batches: number[] = []) {
    return {
      from(table: string) {
        const filters: Array<(row: Record<string, unknown>) => boolean> = [];
        const query = {
          select() {
            return query;
          },
          is(field: string, value: unknown) {
            filters.push((row) => (value === null ? row[field] == null : row[field] === value));
            return query;
          },
          in(field: string, values: readonly string[]) {
            if (table === "documents" && field === "driver_id") batches.push(values.length);
            filters.push((row) => values.map(String).includes(String(row[field])));
            return query;
          },
          neq(field: string, value: unknown) {
            filters.push((row) => String(row[field]) !== String(value));
            return query;
          },
          order() {
            return query;
          },
          range(from: number, to: number) {
            return Promise.resolve(reply(table, from, to));
          },
        };
        return query;
      },
    };
  }

  it("rejects a count that changes between pages", async () => {
    let calls = 0;
    const result = await loadApplicationDocGaps(
      pagingAdmin((table, from, to) => {
        if (table !== "applications") return { data: [], error: null, count: 0 };
        calls += 1;
        const count = calls === 1 ? 400 : 401;
        const data = Array.from({ length: to - from + 1 }, (_, index) => ({
          id: `app-${from + index}`,
          full_name: "Driver",
          status: "new",
          deleted_at: null,
          created_at: "2026-01-01T00:00:00.000Z",
        }));
        return { data, error: null, count };
      }),
    );
    assert.equal(result.failed, true);
    assert.equal(result.truncated, false);
    assert.deepEqual(result.applications, []);
    assert.equal(calls, 2);
  });

  it("rejects an empty short page while the count says rows remain", async () => {
    const result = await loadApplicationDocGaps(
      pagingAdmin((table) => {
        if (table !== "applications") return { data: [], error: null, count: 0 };
        return { data: [], error: null, count: 50 };
      }),
    );
    assert.equal(result.failed, true);
    assert.equal(result.truncated, false);
    assert.deepEqual(result.applications, []);
  });

  it("rejects a document batch whose count is above the pager ceiling", async () => {
    const result = await loadApplicationDocGaps(
      pagingAdmin((table) => {
        if (table === "applications") {
          return {
            data: [
              {
                id: "app-1",
                full_name: "Driver",
                status: "new",
                deleted_at: null,
                created_at: "2026-01-01T00:00:00.000Z",
              },
            ],
            error: null,
            count: 1,
          };
        }
        return {
          data: [
            {
              id: "doc-1",
              driver_id: "app-1",
              category: "license_front",
              is_current: true,
              review_status: "uploaded",
              created_at: "2026-01-01T00:00:00.000Z",
            },
          ],
          error: null,
          count: 100_001,
        };
      }),
    );
    assert.equal(result.failed, true);
    assert.equal(result.truncated, false);
    assert.deepEqual(result.applications, []);
  });

  it("keeps every document id list at or under 100 and counts a trimmed category", async () => {
    const batches: number[] = [];
    const applications = Array.from({ length: 101 }, (_, index) => ({
      id: `app-${String(index).padStart(3, "0")}`,
      full_name: `Driver ${index}`,
      status: "new",
      deleted_at: null,
      created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    }));
    const documents = [
      {
        id: "padded",
        driver_id: "app-100",
        category: " license_front ",
        is_current: true,
        review_status: "uploaded",
        created_at: "2026-03-08T05:00:00.000Z",
      },
    ];
    const result = await loadApplicationDocGaps({
      from(table: string) {
        const filters: Array<(row: Record<string, unknown>) => boolean> = [];
        const rows = table === "applications" ? applications : documents;
        const query = {
          select() {
            return query;
          },
          is(field: string, value: unknown) {
            filters.push((row) => (value === null ? row[field] == null : row[field] === value));
            return query;
          },
          in(field: string, values: readonly string[]) {
            if (table === "documents" && field === "driver_id") batches.push(values.length);
            const wanted = new Set(values.map(String));
            filters.push((row) => wanted.has(String(row[field])));
            return query;
          },
          neq(field: string, value: unknown) {
            filters.push((row) => String(row[field]) !== String(value));
            return query;
          },
          order() {
            return query;
          },
          range(from: number, to: number) {
            const matched = rows.filter((row) => filters.every((keep) => keep(row as Record<string, unknown>)));
            return Promise.resolve({ data: matched.slice(from, to + 1), error: null, count: matched.length });
          },
        };
        return query;
      },
    });
    assert.equal(result.failed, false);
    assert.equal(batches.length > 0, true);
    assert.equal(batches.every((size) => size <= 100), true);
    assert.equal(Math.max(...batches), 100);
    const padded = result.applications.find((app) => app.id === "app-100");
    assert.equal(padded?.slots.find((slot) => slot.key === "license_front")?.state, "present");
  });
});

describe("application document gaps read", () => {
  const admin = supabaseAdmin as unknown as { from: (table: string) => any };

  function reset(tables: Record<string, unknown[]>) {
    fake.tables = tables;
    fake.failSelect = undefined;
  }

  it("pages a counted read, keeps a batched vault, and refuses with the flag off", async () => {
    const applications = Array.from({ length: APPLICATION_DOC_GAPS_ROW_CAP + 1 }, (_, index) => ({
      id: `app-${String(index).padStart(4, "0")}`,
      full_name: `Driver ${index}`,
      status: "new",
      deleted_at: null,
      created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    }));
    applications.push(
      {
        id: "approved",
        full_name: "Already Approved",
        status: "approved",
        deleted_at: null,
        created_at: "2026-12-01T00:00:00.000Z",
      },
      {
        id: "gone",
        full_name: "Deleted",
        status: "new",
        deleted_at: "2026-08-01T00:00:00.000Z",
        created_at: "2026-12-02T00:00:00.000Z",
      },
    );
    reset({ applications, documents: [] });
    const capped = await loadApplicationDocGaps(admin);
    assert.equal(capped.failed, false);
    assert.equal(capped.truncated, true);
    assert.equal(capped.applications.length, APPLICATION_DOC_GAPS_ROW_CAP);
    assert.equal(capped.applications[0]?.id, "app-1000");
    assert.equal(capped.applications.some((app) => app.id === "app-0000"), false);
    assert.equal(capped.applications.some((app) => app.id === "approved" || app.id === "gone"), false);
    assert.equal(capped.applications[0]?.slots.find((item) => item.key === "license_front")?.state, "missing");
    assert.equal(capped.applications[0]?.slots.find((item) => item.key === "proof_of_address")?.state, "unknown");

    fake.failSelect = "documents";
    const docError = await loadApplicationDocGaps(admin);
    assert.equal(docError.failed, true);
    assert.equal(docError.truncated, false);
    assert.deepEqual(docError.applications, []);

    fake.failSelect = "applications";
    const appError = await loadApplicationDocGaps(admin);
    assert.equal(appError.failed, true);
    assert.equal(appError.truncated, false);
    assert.deepEqual(appError.applications, []);

    const count = 500;
    const cohort = Array.from({ length: count }, (_, index) => ({
      id: `drv-${String(index).padStart(4, "0")}`,
      full_name: `Driver ${index}`,
      status: index % 2 === 0 ? "partial" : "complete",
      deleted_at: null,
      created_at: new Date(Date.UTC(2026, 2, 1, 0, 0, index)).toISOString(),
    }));
    const documents = cohort.flatMap((row, index) => [
      {
        id: `doc-f-${index}`,
        driver_id: row.id,
        category: "license_front",
        is_current: true,
        review_status: "uploaded",
        created_at: "2026-03-08T05:00:00.000Z",
      },
      {
        id: `doc-b-${index}`,
        driver_id: row.id,
        category: "license_back",
        is_current: true,
        review_status: "verified",
        created_at: "2026-03-08T06:30:00.000Z",
      },
      {
        id: `doc-i-${index}`,
        driver_id: row.id,
        category: "insurance",
        is_current: true,
        review_status: "uploaded",
        created_at: "2026-11-01T05:30:00.000Z",
      },
    ]);
    reset({ applications: cohort, documents });
    const batched = await loadApplicationDocGaps(admin);
    assert.equal(batched.failed, false);
    assert.equal(batched.truncated, false);
    assert.equal(batched.applications.length, count);
    const newest = batched.applications[0];
    const oldest = batched.applications[count - 1];
    assert.equal(newest?.id, "drv-0499");
    assert.equal(oldest?.id, "drv-0000");
    for (const app of [newest, oldest]) {
      assert.equal(app?.slots.find((item) => item.key === "license_front")?.state, "present");
      assert.equal(app?.slots.find((item) => item.key === "license_front")?.on, "2026-03-08");
      assert.equal(app?.slots.find((item) => item.key === "license_back")?.state, "present");
      assert.equal(app?.slots.find((item) => item.key === "insurance_card")?.state, "present");
      assert.equal(app?.slots.find((item) => item.key === "insurance_card")?.on, "2026-11-01");
      assert.equal(app?.slots.find((item) => item.key === "driver_profile_screenshot")?.state, "missing");
      assert.equal(app?.slots.find((item) => item.key === "proof_of_address")?.state, "unknown");
    }

    const out = ".doc-gaps-build";
    rmSync(out, { recursive: true, force: true });
    mkdirSync(`${out}/stub`, { recursive: true });
    writeFileSync(`${out}/stub/supabase.js`, readFileSync("scripts/fake-supabase.src.mjs", "utf8"));
    writeFileSync(
      `${out}/stub/react-start.js`,
      `export const createServerFn = () => { const api = { middleware: () => api, handler: (fn) => fn }; return api; };\nexport const createMiddleware = () => ({ server: (fn) => fn });\n`,
    );
    writeFileSync(`${out}/stub/auth-middleware.js`, `export const requireSupabaseAuth = {};`);
    const alias = [
      "--alias:@=./src",
      `--alias:@tanstack/react-start=./${out}/stub/react-start.js`,
      `--alias:@/integrations/supabase/auth-middleware=./${out}/stub/auth-middleware.js`,
      `--alias:@/integrations/supabase/client.server=./${out}/stub/supabase.js`,
    ];
    execFileSync(
      "npx",
      [
        "esbuild",
        "src/lib/application-doc-gaps.functions.ts",
        "--bundle",
        "--platform=node",
        "--format=esm",
        `--outfile=${out}/handler.mjs`,
        ...alias,
      ],
      { stdio: ["ignore", "ignore", "inherit"] },
    );
    const probe = `
      import { getApplicationDocGaps } from "./handler.mjs";
      const before = globalThis.__fakeSb?.reads ?? 0;
      let message = "";
      try { await getApplicationDocGaps({ context: { userId: "mgr-1" } }); }
      catch (error) { message = error instanceof Error ? error.message : String(error); }
      if (message !== "Application document gaps are disabled.") throw new Error(message || "no refusal");
      const reads = (globalThis.__fakeSb?.reads ?? 0) - before;
      if (reads !== 0) throw new Error("read " + reads + " tables");
    `;
    writeFileSync(`${out}/probe.mjs`, probe);
    execFileSync("node", [`${out}/probe.mjs`], { stdio: "inherit" });
  });
});
