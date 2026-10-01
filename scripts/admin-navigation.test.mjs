/**
 * Admin navigation, asserted on what is RENDERED.
 *
 * The bug this exists to prevent: `tab` was React state that the sidebar set
 * without touching the URL, while the Overview's links set the URL without
 * touching that state, and the effect between them fired only when the tab
 * VALUE changed. Once the two disagreed — which happened the moment you used
 * the sidebar — an Overview link pointing at the tab already named in the
 * stale URL changed the address bar and nothing else. The click looked dead.
 *
 * So every assertion here checks the rendered screen, never the href and
 * never the URL alone. A test that only compared URLs would have passed
 * throughout the entire outage.
 *
 * Needs a dev server: npm run dev, then npm run test:nav.
 */
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";

const BASE = process.env.BASE || "http://127.0.0.1:5199";
const REF = "yuyzdsnrbfhkmfzpvhwx";

// A session shaped the way supabase-js stores one, with a far-future expiry so
// nothing tries to refresh it.
const exp = Math.floor(Date.now() / 1000) + 86400 * 30;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({
  sub: "00000000-0000-0000-0000-0000000000aa",
  role: "authenticated",
  email: "probe@example.com",
  exp,
})}.sig`;
const session = {
  access_token: jwt,
  token_type: "bearer",
  expires_in: 86400 * 30,
  expires_at: exp,
  refresh_token: "probe-refresh",
  user: {
    id: "00000000-0000-0000-0000-0000000000aa",
    aud: "authenticated",
    role: "authenticated",
    email: "probe@example.com",
    app_metadata: {},
    user_metadata: { full_name: "Probe Staff" },
    created_at: new Date().toISOString(),
  },
};

// Three applications, all Hot Prospect material: high qualification from
// answers alone, enough coverage to clear the floor, nothing alarming.
const apps = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    full_name: "Karen Pantoja", email: "k@example.com", phone: "8130000001",
    status: "new", created_at: new Date(Date.now() - 3600e3).toISOString(),
    trips_completed: "1200", rating: 4.95, license_valid: true, license_photo_url: "a/b.jpg",
    full_coverage_insurance: true, insurance_answer: "yes", insurance_doc_url: "a/c.jpg",
    insurance_rideshare_endorsement: true, gig_status: "Yes, already driving",
    platforms: ["Uber", "Lyft", "DoorDash"], drive_type: "full_time",
    pickup_date: new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10),
    profile_screenshot_url: "a/d.jpg", trip_screenshots: ["a/e.jpg"],
    expected_duration: "1-2_months", city: "Tampa", state: "FL",
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    full_name: "Sasha Brown", email: "s@example.com", phone: "8130000002",
    status: "new", created_at: new Date(Date.now() - 7200e3).toISOString(),
    trips_completed: "900", rating: 4.9, license_valid: true, license_photo_url: "a/f.jpg",
    full_coverage_insurance: true, insurance_answer: "yes", insurance_doc_url: "a/g.jpg",
    gig_status: "Yes, already driving", platforms: ["Uber", "Lyft"], drive_type: "part_time",
    pickup_date: new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10),
    profile_screenshot_url: "a/h.jpg", trip_screenshots: ["a/i.jpg"],
    expected_duration: "3-4_weeks", city: "Tampa", state: "FL",
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    full_name: "Tamika Reed", email: "t@example.com", phone: "8130000003",
    status: "new", created_at: new Date(Date.now() - 10800e3).toISOString(),
    trips_completed: "40", rating: null, license_valid: true,
    insurance_answer: "not_sure", full_coverage_insurance: null,
    gig_status: "Not yet, ready to start", platforms: ["Instacart"], drive_type: null,
    pickup_date: null, expected_duration: "ongoing", city: "Tampa", state: "FL",
    trip_screenshots: [],
  },
];

const table = (url) => {
  const m = url.match(/\/rest\/v1\/([^?]+)/);
  return m ? decodeURIComponent(m[1]) : "";
};

function body(url) {
  switch (table(url)) {
    case "user_roles":
      return [{ role: "admin" }];
    case "applications":
      return apps;
    default:
      return [];
  }
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });

await ctx.route(`**://${REF}.supabase.co/**`, async (route) => {
  const url = route.request().url();
  if (url.includes("/auth/v1/")) {
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(session) });
  }
  const isHead = route.request().method() === "HEAD";
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "content-range": "0-0/0" },
    body: isHead ? "" : JSON.stringify(body(url)),
  });
});


const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
page.on("pageerror", (e) => errors.push("PAGEERROR " + String(e).slice(0, 300)));
await page.addInitScript(([k, v]) => window.localStorage.setItem(k, v),
  [`sb-${REF}-auth-token`, JSON.stringify(session)]);

let fail = 0;
const ok = (c, l) => { if (!c) fail++; console.log(`  ${c ? "PASS" : "BLOCKER"}  ${l}`); };

/** What is on screen — never what the URL claims. */
const view = () => page.evaluate(() => {
  const text = document.body.innerText;
  // Only the driver drawer renders its own tab bar. "Driver Lifecycle" would
  // have been a false positive: it is part of the Drivers tab SUBTITLE, so it
  // is on screen for the list too.
  const tabs = [...document.querySelectorAll('[role="tab"]')].map((t) => t.textContent.trim());
  const drawer = tabs.includes("Documents") && tabs.includes("Screening");
  const activeNav = [...document.querySelectorAll("aside a")]
    .filter((a) => a.className.includes("bg-[#1F1F23]"))
    .map((a) => a.textContent.trim());
  return {
    h1: document.querySelector("h1")?.textContent?.trim() ?? "",
    drawer,
    driversList: !drawer && document.querySelectorAll("tbody tr").length > 0,
    overview: /Pipeline, Fleet And Revenue At A Glance/.test(text),
    addDialog: /Add a vehicle/i.test(text),
    activeNav,
    url: location.pathname + location.search,
  };
});

const goto = async (u) => {
  await page.goto(`${BASE}${u}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2200);
};
const navClick = async (label) => {
  await page.locator("aside").getByText(label, { exact: true }).first().click();
  await page.waitForTimeout(1600);
};
const openFirstApplicant = async () => {
  await page.locator('a[href*="tab=drivers"][href*="id="]').last().click();
  await page.waitForTimeout(2000);
};

const APP_A = "33333333-3333-4333-8333-333333333333";
const APP_B = "11111111-1111-4111-8111-111111111111";

console.log("OVERVIEW LINKS OPEN WHAT THEY NAME");
await goto("/admin");
{
  ok((await view()).overview, "a bare /admin renders Overview");
  await openFirstApplicant();
  ok((await view()).drawer, "Recent Applications: an applicant row opens that applicant");

  await navClick("Overview");
  const o = await view();
  ok(o.overview, "the sidebar returns to Overview");
  ok(o.url === "/admin?tab=overview", `  and the URL follows it (${o.url})`);

  // The regression that made names look dead: from a URL already naming the
  // drivers tab, a second applicant link used to change nothing on screen.
  await page.locator(`a[href*="id=${APP_B}"]`).first().click();
  await page.waitForTimeout(2200);
  const b = await view();
  ok(b.drawer, "a second applicant, clicked from Overview, opens their detail");
  ok(b.url.includes(APP_B), `  and the URL names them (${b.url})`);

  await navClick("Overview");
  await page.locator('a[href*="tab=drivers"]:not([href*="id="])').first().click();
  await page.waitForTimeout(2000);
  const all = await view();
  ok(all.driversList && !all.drawer, "Hot Prospects / Recent 'View All' lands on the list");
}

console.log("\nA ROOT NAV ITEM MEANS THE ROOT");
{
  await goto(`/admin?tab=drivers&id=${APP_A}`);
  ok((await view()).drawer, "deep link opens the driver detail");
  await navClick("Drivers");
  const v = await view();
  ok(!v.drawer, "Drivers, once, closes the detail");
  ok(v.driversList, "  and the listing is what renders");
  ok(v.url === "/admin?tab=drivers", `  with no id left behind (${v.url})`);
}

console.log("\nEVERY LEFT-NAV DESTINATION, FROM A DRIVER DETAIL");
{
  const DESTS = [
    ["Overview", (v) => v.overview],
    ["Drivers", (v) => v.driversList],
    // Added to main after this branch started. A new tab inherits the
    // ownership model by default — nothing is mapped to it, so nothing
    // follows it — which is the property worth pinning down.
    ["Waitlist", (v) => /Waitlist/.test(v.h1)],
    ["Vehicles", (v) => /Vehicles/.test(v.h1)],
    ["Payments", (v) => /Payments/.test(v.h1)],
    ["Service", (v) => /Service|Maintenance/.test(v.h1)],
    ["Expenses", (v) => /Expenses/.test(v.h1)],
    ["Activity", (v) => /Activity/.test(v.h1)],
    ["Team", (v) => /Team/.test(v.h1)],
    ["Settings", (v) => /Settings/.test(v.h1)],
  ];
  for (const [label, renders] of DESTS) {
    await goto(`/admin?tab=drivers&id=${APP_A}`);
    await navClick(label);
    const v = await view();
    ok(renders(v), `${label}: renders its root from a driver detail (h1 "${v.h1}")`);
    ok(!v.url.includes("id="), `  ${label}: the applicant id did not follow (${v.url})`);
    ok(!v.drawer, `  ${label}: no driver detail left open`);
    ok(v.activeNav.length <= 1, `  ${label}: one nav item highlighted (${v.activeNav.join(", ") || "none"})`);
  }
}

console.log("\nVEHICLES — THE SAME CLASS");
{
  await goto("/admin?tab=vehicles&add=%221%22");
  ok((await view()).addDialog, "?add=1 opens the creation flow");
  await page.getByRole("button", { name: "Close" }).first().click();
  await page.waitForTimeout(1200);
  const closed = await view();
  ok(!closed.addDialog, "closing it dismisses the dialog");
  ok(!closed.url.includes("add"), `  and clears add from the URL (${closed.url})`);

  await goto("/admin?tab=vehicles");
  ok(/Vehicles/.test((await view()).h1), "Vehicles renders its listing");
}

console.log("\nBROWSER HISTORY");
{
  await goto("/admin");
  await openFirstApplicant();
  ok((await view()).drawer, "Overview -> applicant");
  await page.goBack({ waitUntil: "networkidle" });
  await page.waitForTimeout(1800);
  ok((await view()).overview, "Back returns to Overview");
  await page.goForward({ waitUntil: "networkidle" });
  await page.waitForTimeout(1800);
  ok((await view()).drawer, "Forward returns to the applicant");

  await goto("/admin?tab=drivers");
  // The list's rows are buttons rather than links — they open the same
  // destination through the same navigation, but there is no href to match.
  await page.locator("tbody tr").first().click();
  await page.waitForTimeout(2000);
  ok((await view()).drawer, "Drivers list -> applicant");
  await page.goBack({ waitUntil: "networkidle" });
  await page.waitForTimeout(1800);
  const back = await view();
  ok(back.driversList && !back.drawer, "Back returns to the Drivers list");
}

console.log("\nDEEP LINKS AND RUBBISH LAND SOMEWHERE SENSIBLE");
{
  const CASES = [
    ["/admin", (v) => v.overview, "Overview"],
    ["/admin?tab=overview", (v) => v.overview, "Overview"],
    ["/admin?tab=drivers", (v) => v.driversList, "the Drivers list"],
    [`/admin?tab=drivers&id=${APP_A}`, (v) => v.drawer, "that applicant"],
    ["/admin?tab=vehicles", (v) => /Vehicles/.test(v.h1), "Vehicles"],
    ["/admin?tab=payments", (v) => /Payments/.test(v.h1), "Payments"],
    ["/admin?tab=waitlist", (v) => /Waitlist/.test(v.h1), "Waitlist"],
    [`/admin?tab=waitlist&id=${APP_A}&add=%221%22`, (v) => /Waitlist/.test(v.h1),
      "Waitlist with another tab's parameters stripped"],
    // An id that matches nobody must not blank the screen.
    ["/admin?tab=drivers&id=00000000-0000-4000-8000-000000000000", (v) => v.driversList,
      "the Drivers list (unknown id)"],
    ["/admin?tab=drivers&id=not-a-uuid", (v) => v.driversList, "the Drivers list (malformed id)"],
    ["/admin?tab=nonsense", (v) => v.overview, "Overview (unknown tab)"],
    // Parameters belonging to another tab must not survive the landing.
    [`/admin?tab=vehicles&id=${APP_A}`, (v) => /Vehicles/.test(v.h1), "Vehicles"],
    ["/admin?tab=overview&filter=overdue&add=%221%22", (v) => v.overview, "Overview"],
  ];
  for (const [url, renders, what] of CASES) {
    await goto(url);
    const v = await view();
    ok(renders(v), `${url} -> ${what} (h1 "${v.h1}")`);
    ok(v.h1.length > 0, `  ${url}: not a blank screen`);
  }

  await goto("/admin?tab=overview&filter=overdue&add=%221%22");
  const stripped = await view();
  ok(stripped.url === "/admin?tab=overview",
     `parameters belonging to other tabs are stripped (${stripped.url})`);
  await goto(`/admin?tab=vehicles&id=${APP_A}`);
  ok(!(await view()).drawer, "an applicant id on the vehicles tab opens no driver detail");
}

console.log("THE NORMALIZE EFFECT SETTLES RATHER THAN LOOPING");
{
  // Count how many times the URL changes after landing on a URL that needs
  // normalizing. A normalize that re-triggers itself would spin forever.
  await page.goto(`${BASE}/admin?tab=overview&filter=overdue&add=%221%22`, { waitUntil: "networkidle" });
  await page.evaluate(() => {
    window.__urls = [];
    const push = history.pushState, rep = history.replaceState;
    history.pushState = function (...a) { window.__urls.push("push:" + a[2]); return push.apply(this, a); };
    history.replaceState = function (...a) { window.__urls.push("replace:" + a[2]); return rep.apply(this, a); };
  });
  await page.waitForTimeout(3500);
  const urls = await page.evaluate(() => window.__urls);
  ok(urls.length <= 1, `the URL settles rather than looping (${urls.length} further changes: ${urls.join(" | ") || "none"})`);
  const v = await view();
  ok(v.url === "/admin?tab=overview", `  and settles on the normalized form (${v.url})`);

  // Same, landing somewhere already clean — must do nothing at all.
  await page.goto(`${BASE}/admin?tab=drivers`, { waitUntil: "networkidle" });
  await page.evaluate(() => {
    window.__urls2 = [];
    const rep = history.replaceState;
    history.replaceState = function (...a) { window.__urls2.push(a[2]); return rep.apply(this, a); };
  });
  await page.waitForTimeout(3000);
  const clean = await page.evaluate(() => window.__urls2);
  ok(clean.length === 0, `a clean URL is left alone (${clean.length} rewrites)`);
}

console.log("\nA DEEP LINK DOES NOT FLASH THE LIST OR DROP THE DRAWER");
{
  // open is now derived from the loaded list. Before the list arrives there
  // is no match, so the question is what renders in that window.
  await page.goto(`${BASE}/admin?tab=drivers&id=${APP_A}`, { waitUntil: "domcontentloaded" });
  const seen = [];
  for (let i = 0; i < 24; i++) {
    seen.push(await page.evaluate(() => {
      const tabs = [...document.querySelectorAll('[role="tab"]')].map((t) => t.textContent.trim());
      return tabs.includes("Documents") ? "drawer" : document.querySelectorAll("tbody tr").length ? "list" : "empty";
    }));
    await page.waitForTimeout(220);
  }
  const firstDrawer = seen.indexOf("drawer");
  const listBeforeDrawer = seen.slice(0, firstDrawer < 0 ? seen.length : firstDrawer).includes("list");
  console.log(`       render sequence: ${[...new Set(seen)].join(" -> ")}`);
  ok(firstDrawer >= 0, "the drawer does eventually render");
  ok(!listBeforeDrawer, "the applicant list never flashes before it");
  // And once open, it must stay open across a re-render.
  const after = seen.slice(firstDrawer);
  ok(!after.includes("list"), "and the drawer does not drop back to the list once shown");
}

console.log("\nEDITING IN THE DRAWER STILL UPDATES THE DRAWER");
{
  /*
   * `update()` no longer patches a second copy of the record — the open
   * applicant is derived from the list it already patches. If that derivation
   * were wrong, an edit would save and the drawer would go on showing the old
   * value, which is worse than failing outright. The status control lives on
   * the Application tab.
   */
  await goto(`/admin?tab=drivers&id=${APP_A}`);
  ok((await view()).drawer, "drawer open");
  await page.locator('[role="tab"]', { hasText: /^Application$/ }).first().click();
  await page.waitForTimeout(1200);
  // SelField is a Radix Select, not a native <select>: a combobox trigger
  // plus a portalled listbox.
  const trigger = page.locator('[role="combobox"]').first();
  ok(await trigger.count() > 0, "the Driver status control is on the Application tab");
  if (await trigger.count()) {
    const before = (await trigger.textContent())?.trim() ?? "";
    await trigger.click();
    await page.waitForTimeout(700);
    const option = page.locator('[role="option"]').filter({ hasText: /reviewing|approved/i }).first();
    const label = (await option.textContent())?.trim() ?? "";
    await option.click();
    await page.waitForTimeout(2500);

    const v = await view();
    ok(v.drawer, `the drawer stays open after the edit (${before} -> ${label})`);
    const now = (await page.locator('[role="combobox"]').first().textContent())?.trim() ?? "";
    ok(now.toLowerCase() === label.toLowerCase(),
       `  the control shows the new value (${now})`);
    // The derived record, not merely the control's own state: the drawer
    // header renders the status pill from `driver`, which is now derived
    // from the list rather than a second copy update() used to patch.
    const header = await page.evaluate(() => document.body.innerText.slice(0, 1500).toLowerCase());
    ok(header.includes(label.toLowerCase()),
       `  and the drawer header re-renders from the updated record (${label})`);
  }
}

console.log("\nCLOSING ADD VEHICLE MUST NOT WIPE AN UNRELATED SELECTION");
{
  await goto("/admin?tab=vehicles");
  const addBtn = page.locator("button", { hasText: /Add Vehicle/i }).first();
  if (await addBtn.count()) {
    const urlBefore = (await view()).url;
    await addBtn.click();
    await page.waitForTimeout(1200);
    ok(/Add a vehicle/i.test(await page.evaluate(() => document.body.innerText)),
       "the Add dialog opens from the button");
    await page.getByRole("button", { name: "Close" }).first().click();
    await page.waitForTimeout(1200);
    const v = await view();
    ok(!/Add a vehicle/i.test(await page.evaluate(() => document.body.innerText)), "and closes");
    ok(v.url === "/admin?tab=vehicles", `  landing on the vehicles root (${v.url}, was ${urlBefore})`);
  } else ok(false, "no Add Vehicle button on the vehicles tab");
}

console.log("\nTHE SEARCH BOX MUST NOT LOSE FOCUS WHEN IT JUMPS TABS");
{
  // Typing on Overview navigates to Drivers. If that navigation remounts the
  // header, the caret is gone and everything after the first character is
  // typed into nothing.
  await goto("/admin?tab=overview");
  const box = page.locator('input[placeholder*="earch"], header input').first();
  if (await box.count()) {
    await box.click();
    await page.keyboard.type("kar", { delay: 160 });
    await page.waitForTimeout(1800);
    const state = await page.evaluate(() => {
      const el = document.activeElement;
      return {
        value: el && "value" in el ? el.value : "",
        isInput: el?.tagName === "INPUT",
        url: location.pathname + location.search,
      };
    });
    console.log(`       after typing: focus=${state.isInput ? "input" : "LOST"} value="${state.value}" url=${state.url}`);
    ok(state.isInput, "the search input still has focus after the tab jump");
    ok(state.value === "kar", `  and kept every character (${state.value})`);
  } else ok(false, "no search box found");
}

console.log("\nA TIER CANNOT REACH A TAB IT MAY NOT SEE");
{
  /*
   * Presentation half only — the server function behind each panel refuses
   * an unauthorized caller regardless, and must keep doing so. What this
   * checks is that hand-editing the query cannot render a panel the sidebar
   * does not offer, and that the clamp lands somewhere usable rather than on
   * a blank screen.
   */
  const coord = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await coord.route(`**://${REF}.supabase.co/**`, async (route) => {
    const url = route.request().url();
    if (url.includes("/auth/v1/"))
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(session) });
    const isHead = route.request().method() === "HEAD";
    const table = (url.match(/\/rest\/v1\/([^?]+)/) || [])[1];
    const payload = decodeURIComponent(table ?? "") === "user_roles"
      ? [{ role: "coordinator" }]
      : decodeURIComponent(table ?? "") === "applications" ? apps : [];
    await route.fulfill({ status: 200, contentType: "application/json",
      headers: { "content-range": "0-0/0" }, body: isHead ? "" : JSON.stringify(payload) });
  });
  const cp = await coord.newPage();
  await cp.addInitScript(([k, v]) => window.localStorage.setItem(k, v),
    [`sb-${REF}-auth-token`, JSON.stringify(session)]);

  for (const [url, label] of [["/admin?tab=team", "Team"], ["/admin?tab=settings", "Settings"]]) {
    await cp.goto(`${BASE}${url}`, { waitUntil: "networkidle" });
    await cp.waitForTimeout(2500);
    const r = await cp.evaluate(() => ({
      h1: document.querySelector("h1")?.textContent?.trim() ?? "",
      url: location.pathname + location.search,
      navLabels: [...document.querySelectorAll("aside a")].map((a) => a.textContent.trim()),
    }));
    ok(!new RegExp(`^${label}$`).test(r.h1),
       `a Coordinator asking for ${url} does not get ${label} (got "${r.h1}")`);
    ok(r.h1.length > 0, `  and lands on something (${r.h1})`);
    ok(!r.navLabels.includes(label), `  ${label} is not offered in their sidebar either`);
  }
  await coord.close();
}

console.log("\nNOTHING BROKE ON THE WAY");
const real = errors.filter((e) => !/ERR_CERT|ERR_TUNNEL|Failed to load resource/.test(e));
ok(real.length === 0, `no application-level console errors (${real.length})`);
for (const e of real.slice(0, 4)) console.log(`       ${e}`);

await browser.close();
console.log(fail ? `\n${fail} FAILURE(S)` : "\nall assertions passed");
process.exit(fail ? 1 : 0);
