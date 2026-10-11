/**
 * Contact Status in a real browser, at desktop and phone width.
 *
 * Four things cannot be seen in a unit test:
 *
 *   1. The popover. The badge opens a list, the list opens a form, and the
 *      form shows ONLY that status' fields. Whether the second step actually
 *      appears — and stays on screen at 390px with a keyboard — is a browser
 *      question, and nested-portal menus are exactly what fails there.
 *   2. Save disabled. Follow-Up with no date and Unqualified with no reason
 *      must be unsaveable IN THE UI, not merely refused afterwards.
 *   3. The filter. The Drivers list filters the same rows two ways, and the
 *      Contact filter must narrow the table without disturbing the
 *      application-status chips beside it.
 *   4. The Not Enabled badge, which only appears when PostgREST answers with
 *      rows that have no contact columns — i.e. a database without the
 *      migration. That shape cannot be produced any other way.
 *
 * Synthetic applicants, stubbed PostgREST and server functions, no network
 * and no real record. The applications rows carry the contact_* columns as
 * the migration defines them, so this is the migrated world; one run
 * deliberately serves the pre-migration shape instead.
 *
 * Run: npm run dev, then npm run test:contact-e2e
 */
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";
import { toCrossJSON, fromCrossJSON } from "seroval";

const BASE = process.env.BASE || "http://127.0.0.1:5199";
const REF = "yuyzdsnrbfhkmfzpvhwx";

const A1 = "22222222-0000-4000-8000-000000000001"; // New, never worked
const A2 = "22222222-0000-4000-8000-000000000002"; // Follow-Up with a date
const A3 = "22222222-0000-4000-8000-000000000003"; // Unqualified with a reason

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

/** An applications row as it looks AFTER the migration. */
const row = (id, name, status, contact) => ({
  id, full_name: name, email: `${name.split(" ")[0].toLowerCase()}@example.com`,
  phone: "8135550142", status, created_at: "2026-10-01T10:00:00Z", deleted_at: null,
  primary_application_id: null, resubmission_count: 0, contacted_at: null,
  city: "Tampa", state: "FL", vehicle_id: null, score: 0,
  // Sensitive, and present ONLY so the Coordinator run can prove the server
  // never sent them and the screen never renders them.
  license_number: "R123-456-78-901-0", dob: "1991-07-02", card_last4: "4242",
  address: "1200 N Ashley Dr",
  contact_status: "new", contact_status_note: null, contact_follow_up_on: null,
  contact_status_at: null, contact_status_by: null,
  ...contact,
});

const APPS = [
  row(A1, "Dana Reyes", "reviewing", {}),
  row(A2, "Marcus Hall", "approved", {
    contact_status: "follow_up", contact_status_note: "Wants the Camry",
    contact_follow_up_on: "2026-10-14", contact_status_at: "2026-10-11T12:00:00Z",
  }),
  row(A3, "Priya Shah", "new", {
    contact_status: "unqualified", contact_status_note: "No rideshare endorsement",
    contact_status_at: "2026-10-10T12:00:00Z",
  }),
];

/** The pre-migration shape: the same people, with no contact columns at all. */
const APPS_UNMIGRATED = APPS.map((r) => {
  const c = { ...r };
  for (const k of Object.keys(c)) if (k.startsWith("contact_status") || k === "contact_follow_up_on") delete c[k];
  return c;
});

let calls;
let saves;
/** What the server would send a Coordinator: operational fields only. */
const OPERATIONAL = ["id", "full_name", "phone", "email", "city", "state", "status",
  "created_at", "contacted_at", "primary_application_id", "resubmission_count", "deleted_at",
  "vehicle_id", "gclid", "utm_campaign", "contact_status", "contact_status_note",
  "contact_follow_up_on", "contact_status_at", "contact_status_by"];
const operational = (r) => Object.fromEntries(Object.entries(r).filter(([k]) => OPERATIONAL.includes(k)));
/** Set per run: the rows the server returns, and whether they are complete. */
let migratedRows = null;
let serverCanSeeSensitive = true;
/** Every non-GET PostgREST request the page made, by table. */
let restWrites;

function serverFn(name, input) {
  calls.push(name);
  switch (true) {
    case /setContactStatus/.test(name): {
      saves.push(input);
      return {
        applicationId: input.applicationId,
        state: {
          status: input.status, note: input.note ?? null, followUpOn: input.followUpOn ?? null,
          changedAt: new Date().toISOString(), changedBy: session.user.id,
        },
      };
    }
    case /getContactStatusHistory/.test(name):
      return [
        { at: "2026-10-11T12:00:00Z", actor: "rosa@drivereal.com", from: "new", to: "follow_up",
          note: "Wants the Camry", followUpOn: "2026-10-14" },
        { at: "2026-10-10T09:00:00Z", actor: "owner@drivereal.com", from: null, to: "attempted",
          note: null, followUpOn: null },
      ];
    // The Drivers list is a SERVER read now (0031: a Coordinator has no
    // direct applications select). The stub answers it the way the real
    // function does — projected by tier — so the browser exercises the same
    // shape the server will send.
    case /listDriverRows/.test(name): {
      const rows = (migratedRows ?? APPS).map((r) => (serverCanSeeSensitive ? r : operational(r)));
      return { rows, canSeeSensitive: serverCanSeeSensitive };
    }
    case /getDriverPayStatuses/.test(name): return {};
    case /listWaitlist/.test(name): return { entries: [], carsAvailable: 2, waitingCount: 0, fleet: {} };
    case /listWaitlistHolds/.test(name): return [];
    case /acknowledgeApplication/.test(name): return { ok: true };
    case /getOverview|listPayments|listBookings/.test(name): return { rows: [], total: 0 };
    default: return null;
  }
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

async function open(viewport, { migrated = true, role = "coordinator", canSeeSensitive = true } = {}) {
  calls = [];
  saves = [];
  restWrites = [];
  migratedRows = migrated ? APPS : APPS_UNMIGRATED;
  serverCanSeeSensitive = canSeeSensitive;
  const ctx = await browser.newContext({ viewport });
  await ctx.route(`**://${REF}.supabase.co/**`, async (route) => {
    const u = route.request().url();
    const method = route.request().method();
    if (u.includes("/rest/v1/") && !["GET", "HEAD"].includes(method))
      restWrites.push(`${method} ${u.split("/rest/v1/")[1]?.split("?")[0]}`);
    if (u.includes("/auth/v1/"))
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(session) });
    if (u.includes("/storage/v1/"))
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ Key: "ok" }) });
    const rows = u.includes("user_roles")
      ? [{ role }]
      : u.includes("applications")
        ? (migrated ? APPS : APPS_UNMIGRATED)
        : [];
    const isHead = route.request().method() === "HEAD";
    return route.fulfill({
      status: 200, contentType: "application/json", headers: { "content-range": "0-2/3" },
      body: isHead ? "" : JSON.stringify(rows),
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
    let input = null;
    try {
      const post = route.request().postData();
      if (post) input = fromCrossJSON(JSON.parse(post).t, { refs: new Map() })?.data ?? null;
      if (!post) {
        const payload = new URL(route.request().url()).searchParams.get("payload");
        if (payload) input = fromCrossJSON(JSON.parse(payload).t, { refs: new Map() })?.data ?? null;
      }
    } catch { /* no body */ }
    try {
      return route.fulfill({
        status: 200, contentType: "application/json", headers: { "x-tss-serialized": "true" },
        body: JSON.stringify(toCrossJSON({ result: serverFn(name, input), context: {} }, { refs: new Map() })),
      });
    } catch (e) {
      return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: String(e?.message ?? e) }) });
    }
  });
  // domcontentloaded, not networkidle: the admin shell keeps a poll open, so
  // the network never goes idle and the navigation times out instead.
  await page.goto(`${BASE}/admin?tab=drivers`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("th:has-text(\"Contact Status\"), td:has-text(\"Not Enabled\")", { timeout: 30000 });
  await page.waitForTimeout(1800);
  return { ctx, page, errors };
}

/** The badge for one applicant, whichever representation this width shows. */
const badge = (page, id) => page.locator(`tr:has-text("${id.slice(-1) === "1" ? "Dana" : id.slice(-1) === "2" ? "Marcus" : "Priya"}") [data-contact-status]`).first();

async function openBadge(page, id) {
  await badge(page, id).scrollIntoViewIfNeeded().catch(() => {});
  await badge(page, id).click({ timeout: 8000 });
  await page.waitForSelector("[data-contact-status-list]", { timeout: 8000 });
}

async function pick(page, label) {
  await page.locator(`[data-contact-status-list] button:has-text("${label}")`).first().click();
  await page.waitForTimeout(400);
}

for (const [label, viewport] of [["desktop 1440x900", { width: 1440, height: 900 }], ["phone 390x844", { width: 390, height: 844 }]]) {
  console.log(`\n================= ${label}`);
  const { ctx, page, errors } = await open(viewport);

  console.log("\nthe column and the badges");
  const header = await page.locator("th", { hasText: "Contact Status" }).count();
  ok(header === 1, `there is one Contact Status column (${header})`);
  const appStatus = await page.locator("th").filter({ hasText: /^Status$/i }).count();
  ok(appStatus === 1, "and the application Status column is still beside it");
  const shown = await page.locator("[data-contact-status]").evaluateAll((e) => e.map((x) => x.dataset.contactStatus));
  ok(shown.length === 3, `every applicant has a badge (${shown.length})`);
  ok(shown.includes("new") && shown.includes("follow_up") && shown.includes("unqualified"),
    `each showing its own stored status (${shown.join(", ")})`);
  const txt = await badge(page, A2).innerText();
  ok(/Follow-Up/.test(txt), `the label is Title Case from the string ("${txt.replace(/\n/g, " ")}")`);

  console.log("\nthe dropdown");
  await openBadge(page, A1);
  const items = await page.locator("[data-contact-status-list] button").allInnerTexts();
  ok(items.length === 9, `nine statuses are listed (${items.length})`);
  ok(items.join("|").includes("Voicemail") && items.join("|").includes("Unresponsive"), "including Voicemail and Unresponsive");
  ok(!items.join("|").includes("Approved") && !items.join("|").includes("Declined"),
    "and no application status is offered among them");

  console.log("\nthe contextual popover shows only what the status uses");
  await pick(page, "Contacted");
  let form = page.locator("[data-contact-status-form]");
  ok(await form.count() === 1, "picking a status opens the form");
  ok(await form.locator("textarea").count() === 1, "Contacted asks for a note");
  ok(await form.locator('input[type="date"]').count() === 1, "  and offers a follow-up date");
  await page.locator('[data-contact-status-form] button:has-text("Back")').click();
  await pick(page, "New");
  form = page.locator("[data-contact-status-form]");
  ok(await form.locator('input[type="date"]').count() === 0, "New asks for no follow-up date at all");
  await page.locator('[data-contact-status-form] button:has-text("Back")').click();
  await pick(page, "Unqualified");
  form = page.locator("[data-contact-status-form]");
  ok(await form.locator('input[type="date"]').count() === 0, "nor does Unqualified");
  ok(/Reason/.test(await form.innerText()), "  which asks for a reason instead");

  console.log("\nSave is refused until the entry is usable");
  let save = page.locator("[data-contact-status-save]");
  ok(await save.isDisabled(), "Unqualified with no reason cannot be saved");
  await form.locator("textarea").fill("No rideshare endorsement on the policy");
  await page.waitForTimeout(250);
  ok(!(await save.isDisabled()), "  and can be once the reason is typed");
  await page.locator('[data-contact-status-form] button:has-text("Back")').click();
  await pick(page, "Follow-Up");
  form = page.locator("[data-contact-status-form]");
  save = page.locator("[data-contact-status-save]");
  ok(await form.locator('input[type="date"]').count() === 1, "Follow-Up asks for the date");
  ok(await save.isDisabled(), "  and cannot be saved without it");
  ok(/follow-up date is needed/i.test(await form.innerText()), "  saying why");

  console.log("\ncancel throws the edit away");
  await form.locator("textarea").fill("typed and abandoned");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  ok(await page.locator("[data-contact-status-form]").count() === 0, "Escape closes the popover");
  ok(saves.length === 0, "  and nothing was saved");
  await openBadge(page, A1);
  await pick(page, "Follow-Up");
  const reopened = await page.locator("[data-contact-status-form] textarea").inputValue();
  ok(reopened === "", `reopening starts from the stored values, not the abandoned draft ("${reopened}")`);

  console.log("\nsaving status, note and date together");
  await page.locator('[data-contact-status-form] input[type="date"]').fill("2026-10-20");
  await page.locator("[data-contact-status-form] textarea").fill("Call back Tuesday");
  await page.waitForTimeout(250);
  await page.locator("[data-contact-status-save]").click();
  await page.waitForTimeout(1200);
  ok(saves.length === 1, `one save was sent (${saves.length})`);
  ok(saves[0]?.status === "follow_up", `  carrying the status key, not the label (${saves[0]?.status})`);
  ok(saves[0]?.followUpOn === "2026-10-20", `  the date as a date (${saves[0]?.followUpOn})`);
  ok(saves[0]?.note === "Call back Tuesday", `  and the note (${saves[0]?.note})`);
  ok(saves[0]?.applicationId === A1, "  against the applicant whose badge was clicked");
  ok(Object.keys(saves[0] ?? {}).every((k) => ["applicationId", "status", "note", "followUpOn"].includes(k)),
    `  and nothing else: ${Object.keys(saves[0] ?? {}).join(", ")}`);
  await page.waitForTimeout(600);
  const after = await badge(page, A1).innerText();
  ok(/Follow-Up/.test(after), `the badge updates without a reload ("${after.replace(/\n/g, " ")}")`);

  console.log("\nthe write went nowhere near the lifecycle");
  const lifecycle = calls.filter((c) => /approveApplication|endRental|activateRental|issueAgreement/.test(c));
  ok(lifecycle.length === 0, `no lifecycle function was called (${lifecycle.join(", ") || "none"})`);
  ok(restWrites.length === 0,
    `and the browser sent no PostgREST write of its own — the save went through the server function, which is what writes the audit entry (${restWrites.join(", ") || "none"})`);

  console.log("\nthe Contact Status filter");
  const all = await page.locator("[data-contact-status]").count();
  await page.selectOption("[data-contact-filter]", "unqualified");
  await page.waitForTimeout(700);
  const narrowed = await page.locator("[data-contact-status]").evaluateAll((e) => e.map((x) => x.dataset.contactStatus));
  ok(narrowed.length === 1 && narrowed[0] === "unqualified",
    `filtering to Unqualified shows only that applicant (${narrowed.join(", ") || "none"}, from ${all})`);
  const chips = await page.locator("button", { hasText: /^All \(/ }).count();
  ok(chips === 1, "the application-status chips are untouched beside it");
  await page.selectOption("[data-contact-filter]", "all");
  await page.waitForTimeout(700);
  ok(await page.locator("[data-contact-status]").count() === all, "and Contact: All puts everyone back");

  if (viewport.width < 500) {
    console.log("\nthe phone layout");
    const box = await page.locator("[data-contact-status-list], [data-contact-status-form]").first().boundingBox().catch(() => null);
    await openBadge(page, A3);
    const panel = await page.locator("[data-contact-status-list]").boundingBox();
    ok(panel && panel.width <= viewport.width - 24, `the popover fits the screen (${Math.round(panel?.width ?? 0)}px of ${viewport.width})`);
    ok(panel && panel.x >= 0 && panel.x + panel.width <= viewport.width, "  with nothing off either edge");
    await pick(page, "Documents");
    const f = await page.locator("[data-contact-status-form]").boundingBox();
    ok(f && f.x >= 0 && f.x + f.width <= viewport.width, "and so does the form");
    const sv = await page.locator("[data-contact-status-save]").boundingBox();
    ok(sv && sv.height >= 28, `the Save target is thumb-sized (${Math.round(sv?.height ?? 0)}px)`);
    void box;
    await page.keyboard.press("Escape");
  }

  ok(errors.length === 0, `no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
  await ctx.close();
}

// ============================================ the Coordinator, under 0031
console.log("\n================= a Coordinator (0031: operational fields only)");
for (const [label, viewport] of [["desktop", { width: 1440, height: 900 }], ["phone", { width: 390, height: 844 }]]) {
  const { ctx, page, errors } = await open(viewport, { role: "coordinator", canSeeSensitive: false });
  const body = await page.locator("table").first().innerText().catch(() => "");
  ok(/Dana Reyes/.test(body), `${label}: the list is NOT empty for a Coordinator`);
  ok(!/R123-456-78-901-0/.test(body), `${label}: no licence number on the screen`);
  ok(!/1991-07-02/.test(body) && !/4242/.test(body), `${label}: no date of birth, no card digits`);
  ok(!/1200 N Ashley/.test(body), `${label}: no home address`);
  const withheld = await page.locator("[data-readiness-withheld]").count();
  ok(withheld === 3, `${label}: readiness says Manager Only rather than scoring absent data (${withheld})`);
  const badges = await page.locator("[data-contact-status]").count();
  ok(badges === 3, `${label}: every Contact Status badge is still there (${badges})`);
  // And the save still works for them — a Coordinator may set a contact status.
  await openBadge(page, A1);
  await pick(page, "Voicemail");
  await page.locator("[data-contact-status-form] textarea").fill("Left a message");
  await page.waitForTimeout(250);
  await page.locator("[data-contact-status-save]").click();
  await page.waitForTimeout(1200);
  ok(saves.length === 1 && saves[0].status === "voicemail",
    `${label}: a Coordinator can still save a Contact Status (${saves[0]?.status})`);
  ok(saves[0]?.note === "Left a message", `${label}: with the note`);
  ok(restWrites.length === 0, `${label}: and the browser still writes nothing directly`);
  ok(errors.length === 0, `${label}: no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
  await ctx.close();
}

// ============================================ the pre-migration world
console.log("\n================= a database without the migration");
{
  const { ctx, page, errors } = await open({ width: 1440, height: 900 }, { migrated: false });
  const texts = await page.locator("td").filter({ hasText: "Not Enabled" }).count();
  ok(texts === 3, `every row says Not Enabled rather than claiming New (${texts})`);
  ok(await page.locator("[data-contact-status]").count() === 0, "  and no badge pretends to be clickable");
  ok(saves.length === 0, "nothing can be saved into columns that do not exist");
  ok(errors.length === 0, `no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
  await ctx.close();
}

// Audit history has no Phase 1A screen — the entry is written server-side by
// setContactStatus and read back by getContactStatusHistory, both covered in
// scripts/contact-status.test.mjs against the real module. What the browser
// CAN show is that the save reaches that server function and the page writes
// nothing itself, which is asserted above.

await browser.close();
console.log(fail ? `\n${fail} blocker(s)` : "\nall Contact Status browser checks pass");
process.exit(fail ? 1 : 0);
