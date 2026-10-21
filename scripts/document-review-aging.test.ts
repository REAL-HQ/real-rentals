// Run: bun test scripts/document-review-aging.test.ts
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  DOCUMENT_REVIEW_AGING_ENABLED,
  DOCUMENT_REVIEW_AGING_ROW_CAP,
  waitingDayLabel,
} from "../src/lib/document-review-aging";
import {
  awaitingReviewCategory,
  buildDocumentReviewAging,
  easternWaitingDays,
  type ReviewDocument,
} from "../src/lib/document-review-aging-build";
import { loadDocumentReviewAging } from "../src/lib/document-review-aging-load";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

function doc(partial: Partial<ReviewDocument> & { id: string }): ReviewDocument {
  return {
    driver_id: "ada",
    category: "license_front",
    is_current: true,
    review_status: "uploaded",
    created_at: "2026-03-08T05:00:00.000Z",
    ...partial,
  };
}

describe("document review aging", () => {
  it("declares the flag once, hard false, with no env", () => {
    const src = read("src/lib/document-review-aging.ts");
    assert.equal(src.match(/export const DOCUMENT_REVIEW_AGING_ENABLED: boolean = false/g)?.length, 1);
    assert.equal(DOCUMENT_REVIEW_AGING_ENABLED, false);
    assert.equal(read("src/lib/document-review-aging.functions.ts").includes("DOCUMENT_REVIEW_AGING_ENABLED"), false);
    assert.equal(read("src/lib/document-review-aging-load.ts").includes("DOCUMENT_REVIEW_AGING_ENABLED"), false);
    for (const path of [
      "src/lib/document-review-aging.ts",
      "src/lib/document-review-aging.functions.ts",
      "src/lib/document-review-aging-load.ts",
      "src/lib/document-review-aging-build.ts",
    ]) {
      assert.doesNotMatch(read(path), /process\.env/);
    }
  });

  it("refuses before auth, the role check, and any read", () => {
    const fn = read("src/lib/document-review-aging.functions.ts");
    assert.match(fn, /\.middleware\(\[documentReviewAgingGate, requireSupabaseAuth\]\)/);
    const handler = fn.slice(fn.indexOf(".handler("));
    const asserted = handler.indexOf("assertDocumentReviewAgingEnabled()");
    const loadImport = handler.indexOf('import("./document-review-aging-load")');
    const role = handler.indexOf("requireManager(");
    const client = handler.indexOf('import("@/integrations/supabase/client.server")');
    const loadCall = handler.indexOf("loadDocumentReviewAging(");
    assert.ok(asserted !== -1 && asserted < loadImport && loadImport < role && role < client && client < loadCall);
    assert.match(handler, /if \(DOCUMENT_REVIEW_AGING_REFUSED\) \{\s*assertDocumentReviewAgingEnabled\(\);\s*\} else \{/);
    assert.doesNotMatch(fn, /return idle\(/);
    assert.doesNotMatch(fn, /\.from\(|\.limit\(/);
    assert.doesNotMatch(fn, /throw /);
    assert.doesNotMatch(fn, /\.(insert|update|delete|upsert)\(/);
    const load = read("src/lib/document-review-aging-load.ts");
    assert.match(load, /count: "exact"/);
    assert.match(load, /\.range\(from, to\)/);
    assert.match(load, /canonicalRequiredDoc/);
    assert.match(load, /const ID_BATCH = 100/);
    assert.doesNotMatch(load, /\.in\("category"/);
    assert.doesNotMatch(load, /\.limit\(/);
    assert.doesNotMatch(load, /storage_path|bucket/);
    assert.doesNotMatch(read("src/lib/document-review-aging-build.ts"), /Math\.round/);
    assert.equal(DOCUMENT_REVIEW_AGING_ROW_CAP, 1000);
  });

  it("extends the drivers list and does not add a route or tab", () => {
    const panel = read("src/components/admin/DriversPanel.tsx");
    const ui = read("src/components/admin/DocumentReviewAging.tsx");
    const gate = panel.indexOf(
      "if (DOCUMENT_REVIEW_AGING_ENABLED !== true || !driversLoaded || canSeeSensitive !== true) return;",
    );
    const call = panel.indexOf("loadReviewAging()");
    assert.ok(gate !== -1 && call !== -1 && gate < call);
    assert.match(panel, /DOCUMENT_REVIEW_AGING_ENABLED === true \? \(\s*<DocumentReviewAging/);
    assert.equal(ui.includes("useServerFn"), false);
    assert.equal(ui.includes("document-review-aging-build"), false);
    assert.doesNotMatch(ui, /uppercase|lowercase|capitalize/);
    assert.doesNotMatch(read("src/components/admin/nav-config.ts"), /document-review-aging|Document Review/);
    assert.doesNotMatch(read("src/routes/admin.tsx"), /DocumentReviewAging|document-review-aging/);
    for (const sentence of [
      "Document Review",
      "Days Waiting By Category",
      "Could Not Load Document Review",
      "Later Uploads Were Not Read",
      "Nothing Waiting",
      "License Front",
      "License Back",
      "Insurance",
      "Gig Profile",
    ]) {
      assert.equal(ui.includes(sentence), true, sentence);
    }
    const failed = ui.indexOf("Could Not Load Document Review");
    const capped = ui.indexOf("Later Uploads Were Not Read");
    assert.ok(failed !== -1 && capped !== -1 && failed < capped);
  });

  it("keeps verified, rejected, and superseded uploads out of the queue", () => {
    assert.equal(
      awaitingReviewCategory({ category: "insurance", is_current: true, review_status: "verified" }),
      null,
    );
    assert.equal(
      awaitingReviewCategory({ category: "license_back", is_current: true, review_status: "rejected" }),
      null,
    );
    assert.equal(
      awaitingReviewCategory({ category: "gig_profile", is_current: false, review_status: "uploaded" }),
      null,
    );
    assert.equal(
      awaitingReviewCategory({ category: "insurance", is_current: true, review_status: "uploaded" }),
      "insurance_card",
    );
    assert.equal(
      awaitingReviewCategory({ category: " license_front ", is_current: true, review_status: "uploaded" }),
      "license_front",
    );
    assert.equal(easternWaitingDays("2026-03-08T04:30:00.000Z", "2026-03-09"), 2);
    assert.equal(easternWaitingDays("2026-03-08T05:00:00.000Z", "2026-03-09"), 1);
    assert.equal(easternWaitingDays("2026-03-08T05:00:00.000Z", "2026-03-08"), 0);
    assert.equal(easternWaitingDays("2026-11-01T03:30:00.000Z", "2026-11-02"), 2);
    assert.equal(easternWaitingDays("2026-11-01T04:00:00.000Z", "2026-11-02"), 1);
    assert.equal(easternWaitingDays("2026-03-08T05:00:00.000Z", "2026-02-30"), null);
    assert.equal(waitingDayLabel(null), "Unknown");
    assert.equal(waitingDayLabel(1), "1 Day");
    assert.equal(waitingDayLabel(-1), "-1 Day");
    assert.equal(waitingDayLabel(2), "2 Days");
    assert.equal(waitingDayLabel(0), "0 Days");

    const result = buildDocumentReviewAging({
      documents: [
        doc({ id: "front-new", created_at: "2026-03-08T05:00:00.000Z" }),
        doc({ id: "front-old", created_at: "2026-03-08T04:30:00.000Z" }),
        doc({ id: "front-blank", driver_id: "blank", category: " license_front ", created_at: "2026-03-08T16:00:00.000Z" }),
        doc({ id: "verified", category: "insurance", review_status: "verified", created_at: "2026-01-01T00:00:00.000Z" }),
        doc({ id: "rejected", category: "license_back", review_status: "rejected", created_at: "2026-01-01T00:00:00.000Z" }),
        doc({ id: "superseded", category: "gig_profile", is_current: false, created_at: "2026-01-01T00:00:00.000Z" }),
        doc({ id: "trip", category: "trip_history", created_at: "2026-01-01T00:00:00.000Z" }),
        doc({ id: "proof", category: "proof_of_address", created_at: "2026-01-01T00:00:00.000Z" }),
        doc({ id: "ins-old", category: "insurance", created_at: "2026-03-06T05:00:00.000Z" }),
        doc({ id: "ins-new", driver_id: "missing", category: "insurance_card", created_at: "2026-03-08T05:00:00.000Z" }),
        doc({ id: "null-current", category: "license_back", is_current: null, created_at: "2026-03-07T05:00:00.000Z" }),
      ],
      applications: [
        { id: "ada", full_name: "Ada Lovelace" },
        { id: "blank", full_name: "  " },
      ],
      truncated: false,
      today: "2026-03-09",
    });
    assert.equal(result.failed, false);
    assert.deepEqual(
      result.categories.map((category) => category.key),
      ["insurance_card", "license_front", "license_back"],
    );
    const front = result.categories.find((category) => category.key === "license_front");
    assert.deepEqual(
      front?.rows.map((row) => row.id),
      ["front-old", "front-new", "front-blank"],
    );
    assert.equal(front?.rows[0]?.days, 2);
    assert.equal(front?.rows[2]?.name, "Unnamed Applicant");
    assert.equal(front?.oldestDays, 2);
    const insurance = result.categories[0];
    assert.equal(insurance?.oldestDays, 3);
    assert.equal(insurance?.rows[0]?.name, "Ada Lovelace");
    assert.equal(insurance?.rows[1]?.name, "Unnamed Applicant");
    assert.equal(result.categories.some((category) => category.rows.some((row) => row.id === "verified")), false);
    assert.equal(result.categories.some((category) => category.rows.some((row) => row.id === "rejected")), false);
    assert.equal(result.categories.some((category) => category.rows.some((row) => row.id === "superseded")), false);
    assert.equal(result.categories.some((category) => category.rows.some((row) => row.id === "trip" || row.id === "proof")), false);
  });

  it("orders equal oldest waits by the required-document list", () => {
    const result = buildDocumentReviewAging({
      documents: [
        doc({ id: "ins", category: "insurance_card", created_at: "2026-03-08T05:00:00.000Z" }),
        doc({ id: "front", category: "license_front", created_at: "2026-03-08T05:00:00.000Z" }),
      ],
      applications: [{ id: "ada", full_name: "Ada Lovelace" }],
      truncated: false,
      today: "2026-03-09",
    });
    assert.deepEqual(
      result.categories.map((category) => category.key),
      ["license_front", "insurance_card"],
    );
    assert.equal(result.categories[0]?.oldestDays, 1);
    assert.equal(result.categories[1]?.oldestDays, 1);
  });
});

describe("document review aging pages", () => {
  type Page = { data: unknown[] | null; error: unknown; count: number | null };
  type Row = Record<string, unknown>;

  function scripted(reply: (table: string, from: number, to: number) => Page) {
    return {
      from(table: string) {
        const query = {
          select() {
            return query;
          },
          eq() {
            return query;
          },
          not() {
            return query;
          },
          in() {
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

  function tableAdmin(tables: Record<string, Row[]>, batches: number[] = []) {
    return {
      from(table: string) {
        const filters: Array<(row: Row) => boolean> = [];
        const orders: Array<{ field: string; ascending: boolean }> = [];
        const query = {
          select() {
            return query;
          },
          eq(field: string, value: unknown) {
            filters.push((row) => row[field] === value);
            return query;
          },
          not(field: string, op: string, value: unknown) {
            if (op === "is" && value === null) filters.push((row) => row[field] != null);
            return query;
          },
          in(field: string, values: readonly string[]) {
            if (values.length === 0) throw new Error("empty in");
            batches.push(values.length);
            const wanted = new Set(values.map(String));
            filters.push((row) => wanted.has(String(row[field])));
            return query;
          },
          order(field: string, options?: { ascending?: boolean }) {
            orders.push({ field, ascending: options?.ascending !== false });
            return query;
          },
          range(from: number, to: number) {
            const matched = tables[table]
              .filter((row) => filters.every((keep) => keep(row)))
              .sort((left, right) => {
                for (const order of orders) {
                  const compared = String(left[order.field] ?? "").localeCompare(String(right[order.field] ?? ""));
                  if (compared !== 0) return order.ascending ? compared : -compared;
                }
                return 0;
              });
            return Promise.resolve({
              data: matched.slice(from, to + 1),
              error: null,
              count: matched.length,
            });
          },
        };
        return query;
      },
    };
  }

  it("rejects a count that changes between pages", async () => {
    let calls = 0;
    const result = await loadDocumentReviewAging(
      scripted((table, from, to) => {
        if (table !== "documents") return { data: [], error: null, count: 0 };
        calls += 1;
        const count = calls === 1 ? 400 : 401;
        const data = Array.from({ length: to - from + 1 }, (_, index) => ({
          id: `doc-${from + index}`,
          driver_id: "ada",
          category: "license_front",
          is_current: true,
          review_status: "uploaded",
          created_at: "2026-03-08T05:00:00.000Z",
        }));
        return { data, error: null, count };
      }),
    );
    assert.equal(result.failed, true);
    assert.equal(result.truncated, false);
    assert.deepEqual(result.categories, []);
    assert.equal(calls, 2);
  });

  it("rejects an empty short page while the count says rows remain", async () => {
    const result = await loadDocumentReviewAging(
      scripted((table) => {
        if (table !== "documents") return { data: [], error: null, count: 0 };
        return { data: [], error: null, count: 50 };
      }),
    );
    assert.equal(result.failed, true);
    assert.equal(result.truncated, false);
    assert.deepEqual(result.categories, []);
  });

  it("rejects an application batch whose count is above the pager ceiling", async () => {
    const result = await loadDocumentReviewAging(
      scripted((table) => {
        if (table === "documents") {
          return {
            data: [
              {
                id: "doc-1",
                driver_id: "ada",
                category: "license_front",
                is_current: true,
                review_status: "uploaded",
                created_at: "2026-03-08T05:00:00.000Z",
              },
            ],
            error: null,
            count: 1,
          };
        }
        return {
          data: [{ id: "ada", full_name: "Ada Lovelace" }],
          error: null,
          count: 100_001,
        };
      }),
    );
    assert.equal(result.failed, true);
    assert.equal(result.truncated, false);
    assert.deepEqual(result.categories, []);
  });

  it("rejects a document query error", async () => {
    const result = await loadDocumentReviewAging(
      scripted(() => ({ data: null, error: { message: "unavailable" }, count: null })),
    );
    assert.equal(result.failed, true);
    assert.equal(result.truncated, false);
    assert.deepEqual(result.categories, []);
  });

  it("keeps the oldest thousand uploads and drops the newest", async () => {
    const documents = Array.from({ length: 1001 }, (_, index) => ({
      id: `doc-${String(index).padStart(4, "0")}`,
      driver_id: "ada",
      category: "license_front",
      is_current: true,
      review_status: "uploaded",
      created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    }));
    const result = await loadDocumentReviewAging(
      tableAdmin({
        documents,
        applications: [{ id: "ada", full_name: "Ada Lovelace" }],
      }),
      "2026-06-01",
    );
    assert.equal(result.failed, false);
    assert.equal(result.truncated, true);
    const rows = result.categories[0]?.rows ?? [];
    assert.equal(rows.length, 1000);
    assert.equal(rows[0]?.id, "doc-0000");
    assert.equal(rows[0]?.name, "Ada Lovelace");
    assert.equal(rows.some((row) => row.id === "doc-1000"), false);
    assert.equal(rows[rows.length - 1]?.id, "doc-0999");
  });

  it("keeps every application id list at or under 100 and counts a trimmed category", async () => {
    const batches: number[] = [];
    const documents = Array.from({ length: 101 }, (_, index) => ({
      id: `doc-${String(index).padStart(3, "0")}`,
      driver_id: `app-${String(index).padStart(3, "0")}`,
      category: index === 100 ? " license_front " : "license_front",
      is_current: true,
      review_status: "uploaded",
      created_at: new Date(Date.UTC(2026, 2, 8, 5, 0, index)).toISOString(),
    }));
    documents.push(
      {
        id: "verified",
        driver_id: "app-000",
        category: "insurance",
        is_current: true,
        review_status: "verified",
        created_at: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "old",
        driver_id: "app-000",
        category: "license_back",
        is_current: false,
        review_status: "uploaded",
        created_at: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "trip",
        driver_id: "app-000",
        category: "trip_history",
        is_current: true,
        review_status: "uploaded",
        created_at: "2026-01-02T00:00:00.000Z",
      },
    );
    const applications = Array.from({ length: 101 }, (_, index) => ({
      id: `app-${String(index).padStart(3, "0")}`,
      full_name: `Driver ${index}`,
    }));
    const result = await loadDocumentReviewAging(
      tableAdmin({ documents, applications }, batches),
      "2026-03-09",
    );
    assert.equal(result.failed, false);
    assert.equal(result.truncated, false);
    assert.equal(batches.length > 0, true);
    assert.equal(batches.every((size) => size <= 100), true);
    assert.equal(Math.max(...batches), 100);
    assert.deepEqual(
      result.categories.map((category) => category.key),
      ["license_front"],
    );
    assert.equal(result.categories[0]?.count, 101);
    assert.equal(result.categories[0]?.rows.some((row) => row.id === "doc-100"), true);
    assert.equal(result.categories[0]?.rows.some((row) => row.id === "verified" || row.id === "old" || row.id === "trip"), false);
  });
});

describe("document review aging flag off", () => {
  it("throws before a read when the handler is bundled", () => {
    const out = ".document-review-build";
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
      ["esbuild", "src/lib/document-review-aging.functions.ts", "--bundle", "--platform=node", "--format=esm", `--outfile=${out}/handler.mjs`, ...alias],
      { stdio: ["ignore", "ignore", "inherit"] },
    );
    const probe = `
      import { getDocumentReviewAging } from "./handler.mjs";
      const before = globalThis.__fakeSb?.reads ?? 0;
      let message = "";
      try { await getDocumentReviewAging({ context: { userId: "mgr-1" } }); }
      catch (error) { message = error instanceof Error ? error.message : String(error); }
      if (message !== "Document review aging is disabled.") throw new Error(message || "no refusal");
      const reads = (globalThis.__fakeSb?.reads ?? 0) - before;
      if (reads !== 0) throw new Error("read " + reads + " tables");
    `;
    writeFileSync(`${out}/probe.mjs`, probe);
    execFileSync("node", [`${out}/probe.mjs`], { stdio: "inherit" });
  });
});
