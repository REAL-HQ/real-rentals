/**
 * The admin dashboard, in a real browser, under 0030-style restrictions.
 *
 * The unit suite (admin-reads-access.test.mjs) proves the server sends the
 * right thing. This proves the screens RENDER it: that a Manager still gets
 * counts, Hot Prospects and readiness, that a Coordinator gets a working
 * dashboard with none of the evidence on it, and — the one that matters
 * most — that a failed read says so instead of drawing a confident zero.
 *
 * Every direct PostgREST call to `applications` is answered with a 403, the
 * way 0030 answers a query that touches a revoked column. If a screen still
 * works, it is because it stopped asking the browser.
 *
 * Needs the dev server: npx vite dev --host 127.0.0.1 --port 5199 --strictPort
 * Run: node scripts/admin-reads-e2e.test.mjs   (npm run test:admin-reads-e2e)
 */
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "/opt/node22/lib/node_modules/playwright/index.mjs");
import { toCrossJSON, fromCrossJSON } from "seroval";

const BASE = process.env.BASE || "http://127.0.0.1:5199";
const REF = "yuyzdsnrbfhkmfzpvhwx";

let fail = 0;
const ok = (c, l) => { if (!c) fail++; console.log(`  ${c ? "PASS" : "BLOCKER"}  ${l}`); };

const exp = Math.floor(Date.now() / 1000) + 86400 * 30;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "00000000-0000-0000-0000-0000000000aa", role: "authenticated", email: "rosa@drivereal.com", exp })}.sig`;
const session = {
  access_token: jwt, token_type: "bearer", expires_in: 86400 * 30, expires_at: exp, refresh_token: "probe-refresh",
  user: { id: "00000000-0000-0000-0000-0000000000aa", aud: "authenticated", role: "authenticated",
    email: "rosa@drivereal.com", app_metadata: {}, user_metadata: { full_name: "Rosa" },
    created_at: new Date().toISOString() },
};

const A1 = "33333333-0000-4000-8000-000000000001";
const A2 = "33333333-0000-4000-8000-000000000002";
const iso = (d) => new Date(Date.now() - d * 864e5).toISOString();

/** Exactly what the server function returns — display fields, no evidence. */
const APPLICANTS = [
  { id: A1, full_name: "Dana Reyes", status: "reviewing", current_step: "part2", created_at: iso(1), reviewed_at: null },
  { id: A2, full_name: "Marcus Hall", status: "new", current_step: "part1", created_at: iso(2), reviewed_at: null },
];

const verdict = (state, qualification) => ({
  qualification, coverage: 90, verifiedCoverage: 80, state, stateLabel: state,
  factors: [], positives: [], attention: [], unknowns: [], disqualifiers: [],
});
/** A Hot Prospect needs qualification and coverage high, no disqualifiers. */
const READINESS = { [A1]: verdict("decision_ready", 95), [A2]: verdict("more_info_needed", 40) };

const NOTIFS = APPLICANTS.map((a) => ({
  id: a.id, full_name: a.full_name, email: `${a.full_name.split(" ")[0].toLowerCase()}@example.com`,
  phone: "8135550142", created_at: a.created_at, status: a.status,
}));

/** Set per run. */
let mode = "manager";
/** Every direct PostgREST table the page asked for. */
let restReads;

function serverFn(name) {
  switch (true) {
    case /getOverviewApplicants/.test(name): {
      if (mode === "failed") throw new Error("permission denied for table applications");
      const coord = mode === "coordinator";
      return {
        newApps: 1, pendingApps: 1, applicants: APPLICANTS,
        readiness: coord ? {} : READINESS, canSeeReadiness: !coord,
      };
    }
    case /getAdminNotifications/.test(name):
      if (mode === "failed") throw new Error("permission denied for table applications");
      return { rows: NOTIFS };
    case /listConversations/.test(name): return { unread: 0, conversations: [] };
    case /getFleetMaintenance/.test(name): return { counts: { overdue: 0, due: 0, dueSoon: 0, open: 0, conflict: 0 } };
    case /listDriverRows/.test(name): return { rows: [], canSeeSensitive: mode !== "coordinator" };
    default: return null;
  }
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || "/opt/pw-browsers/chromium" });

async function open(runMode) {
  mode = runMode;
  restReads = [];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  // Synthetic-only test: fail closed on every unmocked external destination.
  await ctx.route("**/*", route => new URL(route.request().url()).origin === new URL(BASE).origin
    ? route.continue() : route.abort());
  await ctx.route(`**://${REF}.supabase.co/**`, async (route) => {
    const u = route.request().url();
    if (u.includes("/auth/v1/"))
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(session) });
    if (u.includes("/storage/v1/"))
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ Key: "ok" }) });
    const table = u.split("/rest/v1/")[1]?.split("?")[0] ?? "";
    if (table) restReads.push(table);
    // 0030: a direct applications query that touches a revoked column —
    // deleted_at, for every read this PR moved — is refused outright.
    if (table === "applications")
      return route.fulfill({
        status: 403, contentType: "application/json",
        body: JSON.stringify({ code: "42501", message: "permission denied for table applications" }),
      });
    const rows = u.includes("user_roles")
      ? [{ role: runMode === "coordinator" ? "coordinator" : "team" }]
      : [];
    return route.fulfill({
      status: 200, contentType: "application/json", headers: { "content-range": "0-0/0" },
      body: route.request().method() === "HEAD" ? "" : JSON.stringify(rows),
    });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("PAGEERROR " + String(e).slice(0, 200)));
  await page.addInitScript(([k, v]) => window.localStorage.setItem(k, v), [`sb-${REF}-auth-token`, JSON.stringify(session)]);
  await page.route("**/_serverFn/**", async (route) => {
    const id = new URL(route.request().url()).pathname.split("/").pop() ?? "";
    let name = "";
    try { name = Buffer.from(id.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(); } catch { /* not ours */ }
    try {
      return route.fulfill({
        status: 200, contentType: "application/json", headers: { "x-tss-serialized": "true" },
        body: JSON.stringify(toCrossJSON({ result: serverFn(name), context: {} }, { refs: new Map() })),
      });
    } catch (e) {
      return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: String(e?.message ?? e) }) });
    }
  });
  await page.goto(`${BASE}/admin?tab=overview`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("text=Recent Applications", { timeout: 30000 });
  await page.waitForTimeout(1800);
  return { ctx, page, errors };
}

// ============================================================ Manager
console.log("\n================= a Manager, with applications refused in the browser");
{
  const { ctx, page, errors } = await open("manager");
  const body = await page.locator("body").innerText();
  ok(/Dana Reyes/.test(body), "the recent applicants render");
  ok(/Marcus Hall/.test(body), "  both of them");
  ok(/1 New/.test(body) && /1 Pending/.test(body), "the New and Pending counts render");
  ok(!/Counts Unavailable/.test(body), "  and are not reported unavailable");
  ok(!/Could Not Load Applications/.test(body), "the list does not claim it failed");
  ok(await page.locator('option[value="readiness"]').count() > 0, "the Readiness sort is offered");
  ok(/Hot Leads/.test(body), "Hot Leads renders from the same readiness verdict");
  ok(restReads.filter((t) => t === "applications").length === 0,
    "the browser made NO direct applications request at all");
  ok(errors.length === 0, `no page errors${errors.length ? ": " + errors[0] : ""}`);
  await ctx.close();
}

// ======================================================== Coordinator
console.log("\n================= a Coordinator");
{
  const { ctx, page, errors } = await open("coordinator");
  const body = await page.locator("body").innerText();
  ok(/Dana Reyes/.test(body), "a Coordinator still sees the recent applicants");
  ok(/1 New/.test(body) && /1 Pending/.test(body), "and the operational counts");
  ok(!/Hot Prospect/i.test(body), "the Hot Prospect strip is withheld");
  ok(await page.locator('option[value="readiness"]').count() === 0,
    "the Readiness sort is not offered to a tier with no readiness");
  for (const s of ["R123-456-78-901-0", "1991-07-02", "4242", "1200 N Ashley", "licences/"])
    ok(!body.includes(s), `  no identity or card data on screen (${s})`);
  ok(restReads.filter((t) => t === "applications").length === 0,
    "and still no direct applications request");
  ok(errors.length === 0, `no page errors${errors.length ? ": " + errors[0] : ""}`);
  await ctx.close();
}

// ============================================================ failure
console.log("\n================= the read fails");
{
  const { ctx, page, errors } = await open("failed");
  const body = await page.locator("body").innerText();
  ok(/Could Not Load Applications/.test(body), "the list says it could not load");
  ok(!/No Applications Yet/.test(body), "  and does NOT claim an empty pipeline");
  ok(/Counts Unavailable/.test(body), "the counts say they are unavailable");
  ok(!/\b0 New\b/.test(body) && !/\b0 Pending\b/.test(body), "  and no zero is drawn");
  ok(await page.locator('[data-applicants-state="failed"]').count() > 0,
    "the failed state is marked in the DOM");
  ok(errors.length === 0, `no page errors${errors.length ? ": " + errors[0] : ""}`);
  await ctx.close();
}

await browser.close();
console.log(fail ? `\n${fail} BLOCKER(S)` : "\nall admin dashboard browser checks pass");
process.exit(fail ? 1 : 0);
