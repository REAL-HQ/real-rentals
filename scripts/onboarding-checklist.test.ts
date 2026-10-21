// Run: bun test scripts/onboarding-checklist.test.ts
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { describe, it } from "node:test";
import { supabaseAdmin } from "./fake-supabase.src.mjs";
import { COUNTED_ID_BATCH, COUNTED_MAX, COUNTED_PAGE, readCounted, readInIdBatches } from "../src/lib/count-paged-read";
import {
  readinessFacts,
  type ReadinessAgreement,
  type ReadinessApplication,
  type ReadinessDocument,
  type ReadinessPayment,
  type ReadinessRental,
  type ReadinessScreening,
} from "../src/lib/driver-readiness-facts";
import { ONBOARDING_CHECKLIST_ENABLED, ONBOARDING_ROW_CAP } from "../src/lib/onboarding-checklist";
import { buildOnboardingChecklist } from "../src/lib/onboarding-checklist-build";
import { loadOnboardingChecklist } from "../src/lib/onboarding-checklist-load";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const fake = globalThis.__fakeSb as { tables: Record<string, unknown[]>; failSelect?: string };

function app(partial: Partial<ReadinessApplication> & Pick<ReadinessApplication, "id">): ReadinessApplication {
  return {
    full_name: "Ada Lovelace",
    status: "approved",
    deleted_at: null,
    card_last4: null,
    stripe_payment_method_id: null,
    card_on_file_at: null,
    deposit_status: null,
    license_expiration: null,
    insurance_expires_on: null,
    ...partial,
  };
}

function screening(partial: Partial<ReadinessScreening> & Pick<ReadinessScreening, "lead_id">): ReadinessScreening {
  return {
    interview_completed_at: null,
    insurance_verified: false,
    insurance_verified_at: null,
    mvr_authorized: false,
    ...partial,
  };
}

describe("onboarding checklist", () => {
  it("declares the flag once, hard false, with no env", () => {
    const src = read("src/lib/onboarding-checklist.ts");
    assert.equal(src.match(/export const ONBOARDING_CHECKLIST_ENABLED: boolean = false/g)?.length, 1);
    assert.equal(ONBOARDING_CHECKLIST_ENABLED, false);
    assert.equal(read("src/lib/onboarding-checklist.functions.ts").includes("ONBOARDING_CHECKLIST_ENABLED"), false);
    assert.doesNotMatch(src, /process\.env/);
    assert.doesNotMatch(read("src/lib/onboarding-checklist.functions.ts"), /process\.env/);
    assert.doesNotMatch(read("src/lib/onboarding-checklist-load.ts"), /process\.env/);
  });

  it("refuses before the role check and before any read", () => {
    const fn = read("src/lib/onboarding-checklist.functions.ts");
    assert.match(fn, /\.middleware\(\[onboardingChecklistGate, requireSupabaseAuth\]\)/);
    const handler = fn.slice(fn.indexOf(".handler("));
    const asserted = handler.indexOf("assertOnboardingChecklistEnabled()");
    const loadImport = handler.indexOf('import("./onboarding-checklist-load")');
    const role = handler.indexOf("requireManager(");
    const client = handler.indexOf('import("@/integrations/supabase/client.server")');
    const loadCall = handler.indexOf("loadOnboardingChecklist(");
    assert.ok(asserted !== -1 && asserted < loadImport && loadImport < role && role < client && client < loadCall);
    assert.match(handler, /if \(ONBOARDING_CHECKLIST_REFUSED\) \{[^}]*return idle\(\);/s);
    assert.doesNotMatch(fn, /\.from\(|\.limit\(/);
    assert.doesNotMatch(fn, /throw /);
    assert.doesNotMatch(fn, /pickup_date|background_check_status|application_identity_reviews/);
    const load = read("src/lib/onboarding-checklist-load.ts");
    assert.match(load, /count: "exact"/);
    assert.match(load, /\.range\(from, to\)/);
    assert.doesNotMatch(load, /\.limit\(/);
    assert.doesNotMatch(load, /pickup_date|background_check_status|application_identity_reviews|pickup_at/);
    assert.equal(COUNTED_ID_BATCH, 100);
    assert.equal(COUNTED_PAGE, 200);
    assert.equal(ONBOARDING_ROW_CAP, 1000);
  });

  it("keeps the drawer rows and does not refetch the list when one driver opens", () => {
    const panel = read("src/components/admin/DriversPanel.tsx");
    const ui = read("src/components/admin/OnboardingChecklist.tsx");
    const gate = panel.indexOf("if (ONBOARDING_CHECKLIST_ENABLED !== true || canViewOnboarding !== true) return;");
    const call = panel.indexOf("loadOnboarding()");
    assert.ok(gate !== -1 && call !== -1 && gate < call);
    assert.equal(ui.includes("useServerFn"), false);
    assert.equal(panel.includes("focusId"), false);
    assert.match(panel, /<OnboardingReadinessRows driver=\{sharedDriver\} \/>/);
    assert.match(panel, /This Driver Is Past The First 1000\. Showing The Original Readiness Rows\./);
    assert.match(panel, /onSharedReadinessRefresh/);
    const note = panel.indexOf("This Driver Is Past The First 1000");
    const rows = panel.indexOf("<OnboardingReadinessRows driver={sharedDriver} />");
    assert.ok(rows !== -1 && note > rows);
    assert.match(panel, /<SignalRow key=\{r\.label\} label=\{r\.label\} ok=\{r\.ok\} \/>/);
    assert.doesNotMatch(ui, /uppercase|lowercase|capitalize/);
    assert.doesNotMatch(read("src/components/admin/nav-config.ts"), /onboarding/);
    const failed = ui.indexOf("Could Not Load Onboarding Checklist");
    const capped = ui.indexOf("Later Drivers Were Not Read");
    assert.ok(failed !== -1 && capped !== -1 && failed < capped);
    assert.match(ui, />Unknown</);
    assert.match(ui, />Missing</);
  });

  it("shares one fact list: licence sides, rental pickup, unknown id, latest unpaid-back deposit", () => {
    const documents: ReadinessDocument[] = [
      { driver_id: "done", category: "license_front", is_current: true, reviewed_at: "2026-04-02T15:00:00.000Z", created_at: "2026-04-01T00:00:00.000Z" },
      { driver_id: "done", category: "license_back", is_current: true, reviewed_at: "2026-04-03T15:00:00.000Z", created_at: "2026-04-01T00:00:00.000Z" },
      { driver_id: "done", category: "insurance", is_current: true, reviewed_at: null, created_at: "2026-04-04T00:00:00.000Z" },
      { driver_id: "done", category: "gig_profile", is_current: true, reviewed_at: null, created_at: "2026-04-04T00:00:00.000Z" },
      { driver_id: "half", category: "license_front", is_current: true, reviewed_at: "2026-04-02T15:00:00.000Z", created_at: null },
    ];
    const agreements: ReadinessAgreement[] = [
      { application_id: "done", status: "signed", signed_at: "2026-04-04T15:00:00.000Z", voided_at: null },
      { application_id: "signing", status: "signing", signed_at: "2026-04-04T15:00:00.000Z", voided_at: null },
    ];
    const payments: ReadinessPayment[] = [
      { driver_id: "done", type: "deposit", status: "paid", net_collected: 200, amount: 200, paid_date: "2026-04-01" },
      { driver_id: "done", type: "deposit", status: "paid", net_collected: 50, amount: 50, paid_date: "2026-05-02" },
      { driver_id: "done", type: "deposit", status: "refunded", net_collected: 200, amount: 200, paid_date: "2026-06-01" },
      { driver_id: "signing", type: "deposit", status: "refunded", net_collected: 200, amount: 200, paid_date: "2026-06-01" },
    ];
    const rentals: ReadinessRental[] = [
      {
        application_id: "done",
        status: "active",
        start_date: "2026-04-09",
        card_last4: null,
        stripe_payment_method_id: null,
        card_on_file_at: null,
        deposit_held: false,
        deposit_status: "refunded",
        deposit_settled_at: "2026-07-01T00:00:00.000Z",
      },
      {
        application_id: "intent",
        status: "cancelled",
        start_date: "2026-08-01",
        card_last4: null,
        stripe_payment_method_id: null,
        card_on_file_at: null,
        deposit_held: true,
        deposit_status: "held",
        deposit_settled_at: null,
      },
    ];
    const screenings: ReadinessScreening[] = [
      screening({
        lead_id: "done",
        interview_completed_at: "2026-04-05T15:00:00.000Z",
        insurance_verified: true,
        insurance_verified_at: "2026-04-06T15:00:00.000Z",
        mvr_authorized: true,
      }),
    ];
    const result = buildOnboardingChecklist({
      applications: [
        app({ id: "done", card_last4: "4242", card_on_file_at: "2026-04-06T12:00:00.000Z", full_name: "Ada Lovelace" }),
        app({ id: "half", full_name: "Grace Hopper" }),
        app({ id: "signing", full_name: "Signing Driver" }),
        app({ id: "intent", full_name: "Intent Only" }),
        app({ id: "closed", status: "closed", full_name: "Closed Driver" }),
        app({ id: "gone", deleted_at: "2026-04-01T00:00:00.000Z" }),
        app({ id: "dupe", status: "duplicate" }),
        app({ id: "new", status: "new" }),
      ],
      documents,
      screenings,
      agreements,
      payments,
      rentals,
      truncated: false,
    });
    assert.deepEqual(
      result.drivers.map((driver) => driver.id),
      ["done", "half", "signing", "intent", "closed"],
    );
    const done = result.drivers[0];
    const byKey = Object.fromEntries(done.steps.map((step) => [step.key, step]));
    assert.equal(byKey.license.state, "done");
    assert.equal(byKey.license.source, "Document Vault");
    assert.equal(byKey.license.at, "2026-04-03T15:00:00.000Z");
    assert.equal(byKey.documents.label, "Documents 4/4");
    assert.equal(byKey.documents.state, "done");
    assert.equal(byKey.card.source, "Application");
    assert.equal(byKey.agreement.state, "done");
    assert.equal(byKey.agreement.source, "Agreement");
    assert.equal(byKey.pickup.state, "done");
    assert.equal(byKey.pickup.source, "Rental");
    assert.equal(byKey.pickup.at, "2026-04-09");
    assert.equal(byKey.interview.source, "Interview");
    assert.equal(byKey.insurance.source, "Screening");
    assert.equal(byKey.mvr.state, "done");
    assert.equal(byKey.id.state, "unknown");
    assert.equal(byKey.id.source, null);
    assert.equal(byKey.deposit.state, "done");
    assert.equal(byKey.deposit.source, "Payment");
    assert.equal(byKey.deposit.at, "2026-05-02");
    assert.equal(done.nextMissingStep, "Unknown");
    assert.equal(result.drivers[1].steps.find((step) => step.key === "license")?.state, "missing");
    assert.equal(result.drivers[2].steps.find((step) => step.key === "agreement")?.state, "missing");
    assert.equal(result.drivers[2].steps.find((step) => step.key === "deposit")?.state, "missing");
    assert.equal(result.drivers[3].steps.find((step) => step.key === "pickup")?.state, "unknown");
    assert.equal(result.drivers[4].name, "Closed Driver");
    const passedBackground = readinessFacts({
      application: app({ id: "bg" }),
      documents: [],
      screening: screening({ lead_id: "bg" }),
      agreements: [{ application_id: "bg", status: "signing", signed_at: "2026-01-01T00:00:00.000Z", voided_at: null }],
      payments: [],
      rentals: [],
    });
    assert.equal(passedBackground.find((step) => step.key === "id")?.state, "unknown");
    assert.equal(passedBackground.find((step) => step.key === "agreement")?.state, "missing");
  });

  it("uses the latest live rental for pickup", () => {
    const blank = {
      card_last4: null,
      stripe_payment_method_id: null,
      card_on_file_at: null,
      deposit_held: false,
      deposit_status: null,
      deposit_settled_at: null,
    };
    const facts = readinessFacts({
      application: app({ id: "p" }),
      documents: [],
      screening: null,
      agreements: [],
      payments: [],
      rentals: [
        { application_id: "p", status: "ended", start_date: "2026-01-15", ...blank },
        { application_id: "p", status: "cancelled", start_date: "2026-12-01", ...blank },
        { application_id: "p", status: "active", start_date: "2026-03-01", ...blank },
        { application_id: "p", status: "active", start_date: "2026-06-15", ...blank },
      ],
    });
    const pickup = facts.find((step) => step.key === "pickup");
    assert.equal(pickup?.state, "done");
    assert.equal(pickup?.source, "Rental");
    assert.equal(pickup?.at, "2026-06-15");
  });

  it("does not treat a refunded deposit as received when the held flag is still true", () => {
    const facts = readinessFacts({
      application: app({ id: "d" }),
      documents: [],
      screening: null,
      agreements: [],
      payments: [],
      rentals: [
        {
          application_id: "d",
          status: "active",
          start_date: "2026-04-01",
          card_last4: null,
          stripe_payment_method_id: null,
          card_on_file_at: null,
          deposit_held: true,
          deposit_status: "refunded",
          deposit_settled_at: "2026-08-01T00:00:00.000Z",
        },
      ],
    });
    const deposit = facts.find((step) => step.key === "deposit");
    assert.equal(deposit?.state, "missing");
    assert.equal(deposit?.source, null);
    assert.equal(deposit?.at, null);
  });
});

describe("count-checked pages", () => {
  it("rejects a count that changes between pages", async () => {
    let calls = 0;
    const read = await readCounted(async (from, to) => {
      calls += 1;
      const count = calls === 1 ? 400 : 401;
      const data = Array.from({ length: to - from + 1 }, (_, index) => ({ id: `row-${from + index}` }));
      return { data, error: null, count };
    });
    assert.equal(read.ok, false);
    assert.equal(calls, 2);
  });

  it("rejects an empty page while rows remain", async () => {
    const read = await readCounted(async (from, to) => {
      if (from === 0) {
        const data = Array.from({ length: to - from + 1 }, (_, index) => ({ id: `row-${index}` }));
        return { data, error: null, count: 400 };
      }
      return { data: [], error: null, count: 400 };
    });
    assert.equal(read.ok, false);
  });

  it("rejects an id batch that reports more rows than the pager ceiling", async () => {
    const read = await readInIdBatches(["driver-1"], async () => ({
      data: [{ id: "doc-1" }],
      error: null,
      count: COUNTED_MAX + 1,
    }));
    assert.equal(read.ok, false);
  });
});

describe("onboarding checklist read", () => {
  const admin = supabaseAdmin as unknown as { from: (table: string) => any };

  function reset(tables: Record<string, unknown[]>) {
    fake.tables = tables;
    fake.failSelect = undefined;
  }

  function bare(id: string, created_at: string) {
    return {
      id,
      full_name: `Driver ${id}`,
      status: "approved",
      deleted_at: null,
      created_at,
      card_last4: null,
      stripe_payment_method_id: null,
      card_on_file_at: null,
      deposit_status: null,
      license_expiration: "2027-01-01",
      insurance_expires_on: null,
    };
  }

  it("pages, batches, and refuses before a read", async () => {
    const applications = Array.from({ length: ONBOARDING_ROW_CAP + 1 }, (_, index) =>
      bare(`app-${String(index).padStart(4, "0")}`, new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString()),
    );
    reset({
      applications,
      documents: [],
      driver_screenings: [],
      agreements: [],
      payments: [],
      rentals: [],
    });
    const capped = await loadOnboardingChecklist(admin);
    assert.equal(capped.failed, false);
    assert.equal(capped.truncated, true);
    assert.equal(capped.drivers.length, ONBOARDING_ROW_CAP);
    assert.equal(capped.drivers[0]?.id, "app-0000");
    assert.equal(capped.drivers.some((driver) => driver.id === "app-1000"), false);

    fake.failSelect = "agreements";
    const errored = await loadOnboardingChecklist(admin);
    assert.equal(errored.failed, true);
    assert.equal(errored.truncated, false);
    assert.deepEqual(errored.drivers, []);

    fake.failSelect = "applications";
    const unread = await loadOnboardingChecklist(admin);
    assert.equal(unread.failed, true);
    assert.equal(unread.truncated, false);

    const count = 500;
    const cohort = Array.from({ length: count }, (_, index) =>
      bare(`drv-${String(index).padStart(4, "0")}`, `2026-02-01T00:00:00.000Z`),
    );
    const documents = cohort.flatMap((row, index) => [
      { id: `doc-f-${index}`, driver_id: row.id, category: "license_front", is_current: true, reviewed_at: "2026-03-01T00:00:00.000Z", created_at: "2026-03-01T00:00:00.000Z" },
      { id: `doc-b-${index}`, driver_id: row.id, category: "license_back", is_current: true, reviewed_at: "2026-03-02T00:00:00.000Z", created_at: "2026-03-02T00:00:00.000Z" },
      { id: `doc-i-${index}`, driver_id: row.id, category: "insurance", is_current: true, reviewed_at: null, created_at: "2026-03-03T00:00:00.000Z" },
    ]);
    reset({
      applications: cohort,
      documents,
      driver_screenings: [],
      agreements: [],
      payments: [],
      rentals: [],
    });
    const result = await loadOnboardingChecklist(admin);
    assert.equal(result.failed, false);
    assert.equal(result.truncated, false);
    assert.equal(result.drivers.length, count);
    const first = result.drivers[0];
    const last = result.drivers[count - 1];
    assert.equal(first?.steps.find((step) => step.key === "license")?.state, "done");
    assert.equal(last?.steps.find((step) => step.key === "license")?.state, "done");
    assert.equal(first?.steps.find((step) => step.key === "documents")?.label, "Documents 3/4");
    assert.equal(first?.steps.find((step) => step.key === "id")?.state, "unknown");
    assert.equal(first?.steps.find((step) => step.key === "pickup")?.state, "unknown");

    const out = ".onboarding-build";
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
      ["esbuild", "src/lib/onboarding-checklist.functions.ts", "--bundle", "--platform=node", "--format=esm", `--outfile=${out}/handler.mjs`, ...alias],
      { stdio: ["ignore", "ignore", "inherit"] },
    );
    const probe = `
      import { getOnboardingChecklist } from "./handler.mjs";
      const before = globalThis.__fakeSb?.reads ?? 0;
      let message = "";
      try { await getOnboardingChecklist({ context: { userId: "mgr-1" } }); }
      catch (error) { message = error instanceof Error ? error.message : String(error); }
      if (message !== "Onboarding checklist is disabled.") throw new Error(message || "no refusal");
      const reads = (globalThis.__fakeSb?.reads ?? 0) - before;
      if (reads !== 0) throw new Error("read " + reads + " tables");
    `;
    writeFileSync(`${out}/probe.mjs`, probe);
    execFileSync("node", [`${out}/probe.mjs`], { stdio: "inherit" });
  });
});
