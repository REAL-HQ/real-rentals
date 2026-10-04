/**
 * One person's data must never reach the next person on the same browser.
 *
 * READ THIS BEFORE TRUSTING A GREEN RUN: this is a property guard, not a bug
 * reproduction. It passes with useSessionIsolation removed, because two other
 * things also enforce the property today — getRouter() builds a new
 * QueryClient per router instance, and the portal's signed-out gate unmounts
 * every query consumer when the session drops. That was measured, not
 * assumed: with the hook disabled and every response held, signing back in as
 * a different driver, across the staff boundary, and even as the same person,
 * nothing cached ever rendered.
 *
 * What it does catch is the day either of those changes — a QueryClient
 * hoisted to a module singleton, or a shell that renders before the role
 * check resolves. Both are ordinary refactors, and both would make a shared
 * phone leak. The mechanism itself is pinned separately, by the static
 * assertions in driver-access.test.mjs.
 *
 * The incoming user's data is deliberately held for HOLD_MS, and the tabs
 * that actually show personal data are opened inside that window, so a stale
 * value would have nowhere to hide.
 *
 * Run: npm run dev, then npm run test:session
 */
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";
import { toCrossJSON } from "/home/user/real-rentals/node_modules/seroval/dist/index.js";

const BASE = process.env.SESSION_E2E_BASE ?? "http://127.0.0.1:5199";
const PROJECT = "yuyzdsnrbfhkmfzpvhwx";
const STORAGE_KEY = `sb-${PROJECT}-auth-token`;
const HOLD_MS = 2500;

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
    role: "staff",
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
  executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium",
});

async function makePage() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } });
  // `current` is flipped from the test body; every stub answers for whoever
  // is current, so a cached response from the previous identity is the only
  // way their data can appear.
  const state = { current: PEOPLE.A, hold: 0 };

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
      // The portal asks with .maybeSingle(); staff get no driver row.
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: p.role === "driver" ? JSON.stringify({ role: "driver" }) : "null",
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
        rental: null,
        vehicle: null,
        payments: [],
        maintenance: [],
        notifications: [],
        shops: [],
      });
    if (/getDriverProfile/.test(fn))
      return send({ full_name: p.name, email: p.email, phone: "8135550100", status: "approved" });
    if (/getMyVault/.test(fn))
      return send({
        applicationId: `app-${p.id}`,
        documents: [
          {
            id: `doc-${p.id}`,
            category: "license",
            file_name: p.doc,
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
    return send(null);
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
  await page.goto(`${BASE}/faq`, { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ([key, value]) => {
      try {
        localStorage.setItem(key, value);
      } catch {
        /* private mode */
      }
    },
    [STORAGE_KEY, JSON.stringify(session(person))],
  );
}

/**
 * Everything a person could actually see: rendered text plus the value of every
 * form field. A leaked name sits in an <input value>, which innerText misses.
 */
const SURFACE = () => {
  const text = document.body?.innerText ?? "";
  const values = [...document.querySelectorAll("input, textarea")]
    .map((el) => el.value ?? "")
    .join("\n");
  return `${text}\n${values}`;
};

async function surface(page) {
  return page.evaluate(SURFACE).catch(() => "");
}

/** Poll throughout a window and report whether a needle ever appeared. */
async function everShows(page, needle, windowMs) {
  const deadline = Date.now() + windowMs;
  while (Date.now() < deadline) {
    const seen = await page
      .evaluate((n) => {
        const text = document.body?.innerText ?? "";
        const values = [...document.querySelectorAll("input, textarea")]
          .map((el) => el.value ?? "")
          .join("\n");
        return `${text}\n${values}`.includes(n);
      }, needle)
      .catch(() => false);
    if (seen) return true;
    await sleep(60);
  }
  return false;
}

async function run(from, to, label) {
  console.log(`\n── ${label}`);
  const page = await makePage();
  page.state.current = from;
  await seedSession(page, from);

  // 1. The first person uses the portal, so their data lands in the cache.
  await page.goto(`${BASE}/portal`, { waitUntil: "domcontentloaded" });
  if (from.role === "driver") {
    await page.locator("aside nav button").first().waitFor({ timeout: 60000 }).catch(() => {});
    for (const tab of ["Documents", "Settings"]) {
      await page.locator(`aside nav button:has-text("${tab}")`).click().catch(() => {});
      await sleep(1200);
    }
    const body = await surface(page);
    ok(
      body.includes(from.email) || body.includes(from.name) || body.includes(from.doc),
      `${label}: first user's data is on screen and cached`,
    );
  } else {
    await sleep(2500);
  }

  /*
   * Everything from here is clicks. No page.goto.
   *
   * A full navigation throws away the in-memory QueryClient, which would hide
   * the very bug this test exists for — the first version of this test passed
   * with the isolation disabled for exactly that reason. The real journey
   * never leaves the JS context: sign-out re-renders the gate in place, the
   * Sign In link is a client-side route change, and signing in navigates the
   * router. One context, one QueryClient, all the way through.
   */
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) =>
      /sign out/i.test(b.textContent ?? ""),
    );
    btn?.click();
  });
  await sleep(1500);

  // 3. The next person signs in on the same browser, in the same context.
  //    Their data is held, so any gap is filled by whatever is still cached.
  page.state.current = to;
  page.state.hold = HOLD_MS;
  await page.locator('a[href="/login"]').first().click();
  await sleep(900);
  await page.locator('input[type="email"]').fill(to.email);
  await page.locator('input[type="password"]').fill("correct-horse");
  await page.locator('button:has-text("Sign In")').click();

  /*
   * 4. Open the tabs that actually show personal data, while the incoming
   *    user's own data is still held.
   *
   *    Landing on Dashboard is not enough: it shows no PII, so an earlier
   *    version of this test watched a screen that could not have leaked and
   *    passed with the isolation switched off. The leak is what the next
   *    person sees when they open their own profile or documents before the
   *    refetch lands — so that is what we do here, deliberately inside the
   *    hold window.
   */
  await page.locator("aside nav button").first().waitFor({ timeout: 20000 }).catch(() => {});
  for (const tab of ["Settings", "Documents"]) {
    await page.locator(`aside nav button:has-text("${tab}")`).click().catch(() => {});
    await sleep(150);
  }

  const leakedEmail = await everShows(page, from.email, HOLD_MS + 1500);
  const leakedDoc = await everShows(page, from.doc, 400);
  const leakedName = await everShows(page, from.name, 400);
  ok(!leakedEmail, `${label}: the previous user's email never renders`);
  ok(!leakedDoc, `${label}: their document name never renders`);
  ok(!leakedName, `${label}: their name never renders`);

  // 5. And the incoming user does eventually get their own data.
  page.state.hold = 0;
  if (to.role === "driver") {
    await page.locator("aside nav button").first().waitFor({ timeout: 60000 }).catch(() => {});
    await page.locator('aside nav button:has-text("Settings")').click().catch(() => {});
    await sleep(2200);
    const body = await surface(page);
    ok(body.includes(to.email), `${label}: the new user sees their own details`);
    ok(!body.includes(from.email), `${label}: and none of the previous user's`);
    ok(!body.includes(from.doc) && !body.includes(from.name), `${label}: nothing of theirs at all`);
  }
  await page.close();
}

await run(PEOPLE.A, PEOPLE.B, "driver A → driver B");
await run(PEOPLE.S, PEOPLE.B, "staff → driver");
await run(PEOPLE.A, PEOPLE.S, "driver → staff");

await browser.close();
console.log(`\n${fail === 0 ? "PASS" : `FAIL — ${fail} assertion(s)`}`);
process.exit(fail === 0 ? 0 : 1);
