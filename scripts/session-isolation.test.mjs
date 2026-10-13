/**
 * Synthetic browser property test for account switching, not a unit test of
 * QueryClient clearing. Driver sign-out reloads /portal; the non-driver portal reloads /login.
 * No hosted sessions: external traffic is refused and auth/server reads mocked.
 * Run a local dev server, then npm run test:session. Install Playwright in the
 * test environment (or set SESSION_PLAYWRIGHT_MODULE to its module path).
 * SESSION_NEGATIVE_CONTROL=identity|rental|payment|document deliberately leaks
 * previous-driver data through a mocked read; each must exit nonzero.
 * Run all four with: npm run test:session -- --negative-controls
 */
const { chromium } = await import(process.env.SESSION_PLAYWRIGHT_MODULE ?? "playwright");
import { toCrossJSON } from "seroval";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// A timeout/crash is NOT a successful negative control: require the precise
// leak assertion from the same end-to-end path used by the passing run.
if (process.argv.includes("--negative-controls")) {
  for (const category of ["identity", "rental", "payment", "document"]) {
    const run = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
      env: { ...process.env, SESSION_NEGATIVE_CONTROL: category }, encoding: "utf8", timeout: 180000,
    });
    const expected = `FAIL driver A → driver B: no prior ${category} leaks`;
    if (run.status !== 1 || !run.stdout.includes(expected) || /Timeout|Error:/.test(run.stderr)) {
      console.error(`Negative control did not reach the intended assertion: ${category}\n${run.stdout}\n${run.stderr}`);
      process.exit(1);
    }
    console.log(`PASS negative control: ${category} leak rejected`);
  }
  process.exit(0);
}

const BASE = process.env.SESSION_E2E_BASE ?? "http://127.0.0.1:5199";
const PROJECT = "yuyzdsnrbfhkmfzpvhwx";
const STORAGE_KEY = `sb-${PROJECT}-auth-token`;
const HOLD_MS = 2500;
const negative = process.env.SESSION_NEGATIVE_CONTROL;
if (negative && !["identity", "rental", "payment", "document"].includes(negative)) throw new Error("Unknown negative control");
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(BASE).hostname)) throw new Error("Local synthetic server required");

let fail = 0;
const ok = (c, l) => {
  if (!c) fail++;
  console.log(`  ${c ? "ok  " : "FAIL"} ${l}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PEOPLE = {
  A: {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    email: "alpha@example.com",
    name: "Alpha Alphason",
    doc: "alpha-licence-SECRET.jpg",
    role: "driver",
  },
  B: {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    email: "bravo@example.com",
    name: "Bravo Bravoson",
    doc: "bravo-licence.jpg",
    role: "driver",
  },
  S: {
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    email: "staff@example.com",
    name: "Staff Person",
    doc: "staff-only-DOSSIER.pdf",
    role: "manager",
  },
};

const session = (p) => ({
  access_token: `token-${p.id}`,
  refresh_token: `refresh-${p.id}`,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  expires_in: 3600,
  token_type: "bearer",
  user: {
    id: p.id,
    email: p.email,
    aud: "authenticated",
    role: "authenticated",
    app_metadata: {},
    user_metadata: {},
    created_at: new Date().toISOString(),
  },
});

const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
});

async function makePage() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } });
  // `current` is flipped from the test body; every stub answers for whoever
  // is current, so a cached response from the previous identity is the only
  // way their data can appear.
  const state = { current: PEOPLE.A, previous: null, hold: 0, errors: [], calls: new Set() };
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => state.errors.push(e.message));
  // Last registered matching route wins; the explicit synthetic routes below
  // override this deny-by-default boundary. Never contact a hosted backend.
  await page.route("**/*", (route) => new URL(route.request().url()).origin === new URL(BASE).origin
    ? route.continue() : route.abort());

  await page.route(`**/${PROJECT}.supabase.co/auth/v1/**`, async (route) => {
    const url = route.request().url();
    if (url.includes("/logout")) return route.fulfill({ status: 204, body: "" });
    if (url.includes("/token")) {
      // A real password sign-in for whoever the test says is arriving.
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(session(state.current)),
      });
    }
    if (url.includes("/user")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(session(state.current).user),
      });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  await page.route(`**/${PROJECT}.supabase.co/rest/v1/**`, async (route) => {
    if (state.hold) await sleep(state.hold);
    const url = route.request().url();
    const p = state.current;
    if (url.includes("user_roles")) {
      // Current portal reads a role array; never an object or null.
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ role: p.role }]),
      });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });

  await page.route("**/_serverFn/**", async (route) => {
    if (state.hold) await sleep(state.hold);
    const p = state.current;
    const id = new URL(route.request().url()).pathname.split("/").pop() ?? "";
    let fn = "";
    try {
      fn = Buffer.from(id.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString();
    } catch {
      /* not one of ours */
    }
    state.calls.add(fn.split('"').filter(Boolean).join(" "));
    const source = (category) => negative === category && state.previous ? state.previous : p;
    const send = (v) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "x-tss-serialized": "true" },
        body: JSON.stringify(toCrossJSON({ result: v, context: {} }, { refs: new Map() })),
      });
    if (/getDriverDashboard/.test(fn))
      return send({
        applicationStatus: "approved",
        unavailable: {},
        rental: { id: `rental-${p.id}`, weekly_rate: 350, deposit_amount: 200, deposit_held: true,
          next_payment_due: "2026-11-07", start_date: "2026-11-01", status: "active", weeks_rented: 1 },
        vehicle: { id: `vehicle-${p.id}`, year: 2026, make: "Synthetic", model: `${source("rental").name}-rental`,
          trim: null, color: null, photo: null, plate: null, status: "rented" },
        payments: [{ id: `payment-${p.id}`, paid_date: "2026-11-01", amount: source("payment").id === PEOPLE.A.id ? 731.25 : source("payment").id === PEOPLE.B.id ? 842.50 : 953.75,
          type: "rental", status: "paid" }],
        maintenance: [],
        notifications: [],
        shops: [],
      });
    if (/getDriverProfile/.test(fn))
      return send({ full_name: source("identity").name, email: source("identity").email, phone: "8135550100", status: "approved" });
    if (/getMyVault/.test(fn))
      return send({
        applicationId: `app-${p.id}`,
        documents: [
          {
            id: `doc-${p.id}`,
            category: "license_front",
            file_name: source("document").doc,
            url: `https://example.test/${p.doc}`,
            created_at: new Date().toISOString(),
            is_current: true,
            review_status: "pending",
            visibility: ["driver"],
          },
        ],
      });
    if (/getDriverDocuments|getMyAgreements|getMyCharges|getDriverIssues|getDriverReferrals/.test(fn))
      return send([]);
    if (/getMyPortalAccess/.test(fn)) return send({ stage: "none", email: p.email, application: null, waitlist: null, review: false });
    if (/getPublicBusinessPhone/.test(fn)) return send({ tel: "tel:+15555550100", display: "555-555-0100" });
    if (/getMyRentalHistory|getDriverPictures/.test(fn)) return send([]);
    if (/getRentalBilling|getMyApplication/.test(fn)) return send(null);
    state.errors.push(`Unmocked server function: ${fn}`);
    return route.abort();
  });

  page.state = state;
  return page;
}

/**
 * Seed once, by hand — not addInitScript, which re-injects on every navigation
 * and would silently restore the signed-out user when the test moves to
 * /login, making the whole exercise meaningless.
 */
async function seedSession(page, person) {
  await page.goto(`${BASE}/faq`, { waitUntil: "networkidle" });
  await page.evaluate(
    ([key, value]) => {
      localStorage.setItem(key, value);
    },
    [STORAGE_KEY, JSON.stringify(session(person))],
  );
}

const tab = (page, name) => page.locator("aside nav").getByRole("button", { name, exact: true });
const markers = (p) => ({ identity: p.email, name: p.name, rental: `${p.name}-rental`, payment: p.id === PEOPLE.A.id ? "$731.25" : p.id === PEOPLE.B.id ? "$842.50" : "$953.75", document: p.doc });
async function assertVisible(page, needle) {
  await page.waitForFunction((n) => (document.body.innerText + [...document.querySelectorAll("input,textarea")].map(e => e.value).join("\n")).includes(n), needle);
}
async function startMonitor(page, person) {
  await page.evaluate((needles) => {
    window.__isolationHits = [];
    const scan = () => {
      const content = document.body.innerText + [...document.querySelectorAll("input,textarea")].map(e => e.value).join("\n");
      for (const [category, needle] of Object.entries(needles)) {
        if (content.includes(needle) && !window.__isolationHits.includes(category)) window.__isolationHits.push(category);
      }
    };
    new MutationObserver(scan).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
    window.__isolationTimer = setInterval(scan, 20); // input.value changes need polling too
    scan();
  }, markers(person));
}
async function run(from, to, label) {
  console.log(`\n── ${label}`);
  const page = await makePage();
  try {
    page.state.current = from;
    await seedSession(page, from);
    await page.goto(`${BASE}/portal`, { waitUntil: "networkidle" });
    if (from.role === "driver") {
      // Prove all four categories were actually rendered/cached before signout.
      for (const [name, needle] of [["Vehicle", markers(from).rental], ["Payments", markers(from).payment], ["Documents", from.doc], ["Settings", from.email]]) {
        await tab(page, name).click();
        await assertVisible(page, needle);
        ok(true, `${label}: seeded ${name}`);
      }
    } else {
      await assertVisible(page, from.email);
      ok(true, `${label}: seeded staff portal identity`);
    }
    await Promise.all([
      page.waitForURL(`${BASE}/${from.role === "driver" ? "portal" : "login"}`, { waitUntil: "load" }),
      page.getByRole("button", { name: /sign out/i }).click(),
    ]);
    if (from.role === "driver") await page.getByRole("link", { name: "Sign In", exact: true }).waitFor();
    ok(await page.evaluate((key) => localStorage.getItem(key) === null, STORAGE_KEY), `${label}: signout clears session`);
    page.state.previous = from;
    page.state.current = to;
    page.state.hold = HOLD_MS;
    if (from.role === "driver") await page.getByRole("link", { name: "Sign In", exact: true }).click();
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: /use my password instead/i }).click();
    await page.locator('input[type="email"]').fill(to.email);
    await page.locator('input[type="password"]').fill("synthetic-password-only");
    // Starts BEFORE login and remains active while every personal-data tab loads.
    await startMonitor(page, from);
    await page.getByRole("button", { name: "Sign In", exact: true }).click();
    if (to.role === "driver") {
      for (const [name, needle] of [["Vehicle", markers(to).rental], ["Payments", markers(to).payment], ["Documents", to.doc], ["Settings", to.email]]) {
        await tab(page, name).click();
        // Negative controls must fail the SAME leak assertion, not a timeout
        // waiting for intentionally replaced data.
        const category = { Vehicle: "rental", Payments: "payment", Documents: "document", Settings: "identity" }[name];
        await assertVisible(page, negative === category ? markers(from)[category] : needle);
        await sleep(HOLD_MS + 100);
      }
    } else {
      await page.getByRole("button", { name: /sign out/i }).waitFor();
      await sleep(HOLD_MS + 300);
    }
    const hits = await page.evaluate(() => {
      if (!window.__isolationHits) throw new Error("Isolation monitor lost during navigation");
      clearInterval(window.__isolationTimer);
      return window.__isolationHits;
    });
    for (const category of Object.keys(markers(from))) ok(!hits.includes(category), `${label}: no prior ${category} leaks`);
    ok(page.state.errors.length === 0, `${label}: no page errors or unknown server mocks (${page.state.errors.join("; ")})`);
    if (to.role === "driver") {
      for (const fn of ["getDriverDashboard", "getDriverProfile", "getMyVault", "getRentalBilling"])
        ok([...page.state.calls].some(call => call.includes(fn)), `${label}: exercised ${fn}`);
    }
  } finally {
    // Finish intentionally delayed mock responses before disposing their page.
    page.state.hold = 0;
    await sleep(HOLD_MS + 100);
    await page.close();
    console.log(`  closed synthetic page: ${label}`);
  }
}
try {
  await run(PEOPLE.A, PEOPLE.B, "driver A → driver B");
  if (!negative) {
    await run(PEOPLE.S, PEOPLE.B, "staff → driver");
    await run(PEOPLE.A, PEOPLE.S, "driver → staff");
  }
} finally {
  await browser.close();
  console.log("Closed isolated browser");
}
console.log(`\n${fail === 0 ? "PASS" : `FAIL — ${fail} assertion(s)`}`);
process.exit(fail === 0 ? 0 : 1);
