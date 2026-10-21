/**
 * Owner-review screenshots for PR #146.
 *
 * Runs the real admin UI in Chromium against fixture responses only.
 * PostgREST and server functions are answered in the browser. Requests to
 * any other host are aborted, except the font files the shell already uses.
 * No hosted database and no Stripe API.
 *
 * Needs the dev server: npx vite dev --host 127.0.0.1 --port 5199 --strictPort
 * Run: node scripts/pr146-screenshots.mjs
 */
import { mkdirSync, readFileSync } from "node:fs";
import { chromium } from "/tmp/pr146-pw/node_modules/playwright-core/index.mjs";
import { toCrossJSON, fromCrossJSON } from "seroval";

const BASE = process.env.BASE || "http://127.0.0.1:5199";
const OUT = "docs/pr146-screenshots";
const env = Object.fromEntries(
  readFileSync(".env", "utf8")
    .split("\n")
    .filter((line) => line.includes("=") && !line.trim().startsWith("#"))
    .map((line) => {
      const i = line.indexOf("=");
      return [line.slice(0, i), line.slice(i + 1).trim().replace(/^"|"$/g, "")];
    }),
);
const REF = new URL(env.SUPABASE_URL).hostname.split(".")[0];

const easternToday = () => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  return ["year", "month", "day"].map((key) => parts.find((part) => part.type === key).value).join("-");
};
const addDays = (iso, days) => {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
};
const TODAY = easternToday();
const day = (offset) => addDays(TODAY, offset);

const exp = Math.floor(Date.now() / 1000) + 86400 * 30;
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const jwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "00000000-0000-0000-0000-0000000000aa", role: "authenticated", email: "rosa@example.com", exp })}.sig`;
const session = {
  access_token: jwt,
  token_type: "bearer",
  expires_in: 86400 * 30,
  expires_at: exp,
  refresh_token: "fixture-refresh",
  user: {
    id: "00000000-0000-0000-0000-0000000000aa",
    aud: "authenticated",
    role: "authenticated",
    email: "rosa@example.com",
    app_metadata: {},
    user_metadata: { full_name: "Rosa" },
    created_at: "2026-01-01T00:00:00.000Z",
  },
};

const ids = {
  dana: "11111111-1111-4111-8111-111111111101",
  marcus: "11111111-1111-4111-8111-111111111102",
  priya: "11111111-1111-4111-8111-111111111103",
  andre: "11111111-1111-4111-8111-111111111104",
  lena: "11111111-1111-4111-8111-111111111105",
  chris: "11111111-1111-4111-8111-111111111106",
  vehicle: "22222222-2222-4222-8222-222222222201",
  rental: "33333333-3333-4333-8333-333333333301",
};

const factor = (detail) => ({
  key: "interview",
  label: "Interview",
  group: "conversation",
  weight: 10,
  state: "positive",
  evidence: "staff_verified",
  earned: 10,
  detail,
  remedy: "interview",
});
const verdict = (state, qualification, coverage, detail) => ({
  qualification,
  coverage,
  verifiedCoverage: 20,
  state,
  stateLabel: state,
  factors: [],
  positives: [factor(detail)],
  attention: [],
  unknowns: [],
  disqualifiers: [],
});

const APPLICANTS = [
  { id: ids.dana, full_name: "Dana Reyes", status: "reviewing", current_step: "part2", created_at: `${day(-6)}T15:00:00.000Z`, reviewed_at: null },
  { id: ids.marcus, full_name: "Marcus Hall", status: "new", current_step: "part1", created_at: `${day(-2)}T15:00:00.000Z`, reviewed_at: null },
  { id: ids.priya, full_name: "Priya Shah", status: "reviewing", current_step: "part2", created_at: `${day(-4)}T15:00:00.000Z`, reviewed_at: null },
  { id: ids.andre, full_name: "Andre Cole", status: "approved", current_step: "done", created_at: `${day(-10)}T15:00:00.000Z`, reviewed_at: null },
  { id: ids.lena, full_name: "Lena Ortiz", status: "reviewing", current_step: "part2", created_at: `${day(-8)}T15:00:00.000Z`, reviewed_at: null },
  { id: ids.chris, full_name: "Chris Nguyen", status: "new", current_step: "part1", created_at: `${day(-12)}T15:00:00.000Z`, reviewed_at: null },
];
const READINESS = {
  [ids.dana]: verdict("needs_attention", 88, 70, "Interview complete"),
  [ids.priya]: verdict("promising_more_info", 81, 55, "License on file"),
  [ids.marcus]: verdict("more_info_needed", 40, 20, "Application started"),
  [ids.andre]: verdict("more_info_needed", 60, 30, "Approved on paper"),
  [ids.lena]: verdict("more_info_needed", 50, 35, "Waiting on insurance"),
  [ids.chris]: verdict("more_info_needed", 30, 15, "New application"),
};

const lead = (id, name, phone, bucket, status, follow, note) => ({
  id,
  full_name: name,
  phone,
  contact_status: status,
  contact_status_note: note,
  contact_follow_up_on: follow,
  contact_status_at: `${day(-1)}T15:00:00.000Z`,
  contact_status_by: "rosa@example.com",
  bucket,
  priority: bucket === "overdue" ? "Urgent" : bucket === "new" || bucket === "interested" ? "High" : bucket === "future" ? "Low" : "Medium",
  reason:
    bucket === "overdue" ? "Follow-up is overdue"
    : bucket === "new" ? "Awaiting first contact"
    : bucket === "interested" ? "Marked Interested"
    : bucket === "today" ? "Follow-up is due today"
    : bucket === "information" ? "Waiting on additional information"
    : "Follow-up is scheduled",
  action:
    bucket === "overdue" ? "Contact the applicant and record the outcome or a new follow-up date."
    : bucket === "new" ? "Make first contact and record the outcome."
    : bucket === "interested" ? "Confirm interest and next steps. Interest does not establish rental readiness."
    : bucket === "today" ? "Contact the applicant today and record the outcome."
    : bucket === "information" ? "Review the contact note and confirm which information is still needed."
    : "Review the contact note before the scheduled follow-up.",
  contactLabel: { new: "New", interested: "Interested", follow_up: "Follow-Up", documents: "Documents" }[status],
});
const LEADS = [
  lead(ids.dana, "Dana Reyes", "8135550101", "overdue", "follow_up", day(-3), "Asked to call after her airport shift."),
  lead(ids.marcus, "Marcus Hall", "8135550102", "new", "new", null, null),
  lead(ids.priya, "Priya Shah", "8135550103", "interested", "interested", null, "Wants the Camry if the weekly rate holds."),
  lead(ids.andre, "Andre Cole", "8135550104", "today", "follow_up", TODAY, "Sending the insurance card today."),
  lead(ids.lena, "Lena Ortiz", "8135550105", "information", "documents", null, "Still needs a rideshare endorsement."),
  lead(ids.chris, "Chris Nguyen", "8135550106", "future", "follow_up", day(7), "Out of town until next week."),
];
const COUNTS = { overdue: 1, new: 1, hot: 1 };

function leadResult(input) {
  const offset = Number(input?.offset ?? 0);
  const limit = Number(input?.limit ?? 3);
  const bucket = input?.bucket;
  const rows = LEADS.filter((row) => !bucket || row.bucket === bucket);
  const page = rows.slice(offset, offset + limit);
  return {
    rows: page,
    total: rows.length,
    counts: COUNTS,
    today: TODAY,
    offset,
    nextOffset: offset + page.length < rows.length ? offset + page.length : null,
  };
}

const pay = (id, driver, over) => ({
  id,
  driver_id: driver,
  vehicle_id: ids.vehicle,
  rental_id: over.type === "deposit" ? ids.rental : null,
  amount: over.amount,
  balance_due: over.balance_due ?? 0,
  refunded_amount: 0,
  refunded_at: null,
  net_collected: over.status === "paid" ? over.amount : 0,
  status: over.status,
  type: over.type,
  paid_date: over.paid_date ?? null,
  due_date: over.due_date,
  payment_method: over.payment_method ?? null,
  stripe_payment_intent_id: over.stripe_payment_intent_id ?? null,
  stripe_invoice_id: null,
  stripe_subscription_id: null,
  notes: over.notes ?? null,
  late_fees: 0,
});
const PAYMENTS = [
  pay("44444444-4444-4444-8444-444444444401", ids.dana, { amount: 350, status: "paid", type: "rent", paid_date: day(-2), due_date: day(-2), payment_method: "card", stripe_payment_intent_id: "pi_fixture_rent" }),
  pay("44444444-4444-4444-8444-444444444402", ids.marcus, { amount: 120, status: "paid", type: "rent", paid_date: day(-3), due_date: day(-3), payment_method: "Cash" }),
  pay("44444444-4444-4444-8444-444444444403", ids.priya, { amount: 90, status: "paid", type: "rent", paid_date: day(-4), due_date: day(-4), payment_method: "Venmo" }),
  pay("44444444-4444-4444-8444-444444444404", ids.andre, { amount: 75, status: "paid", type: "rent", paid_date: day(-1), due_date: day(-1), payment_method: "Cash App" }),
  pay("44444444-4444-4444-8444-444444444405", ids.dana, { amount: 80, status: "paid", type: "rent", paid_date: day(-1), due_date: day(-1), payment_method: null, notes: "Counter drop, no method recorded" }),
  pay("44444444-4444-4444-8444-444444444406", ids.marcus, { amount: 200, status: "paid", type: "deposit", paid_date: day(-5), due_date: day(-5), payment_method: "Cash" }),
  pay("44444444-4444-4444-8444-444444444407", ids.priya, { amount: 40, balance_due: 40, status: "overdue", type: "rent", due_date: day(-1), payment_method: "Cash" }),
];
const RENTALS = [{ id: ids.rental, deposit_amount: 200, deposit_held: true, deposit_status: "held", end_date: day(3), status: "active" }];
const VEHICLES = [{ id: ids.vehicle, year: 2022, make: "Toyota", model: "Camry", status: "rented", archived_at: null, current_odometer: 41000, last_oil_change_miles: 40000, oil_interval_miles: 5000, last_tire_date: null, last_brake_inspection_date: null }];
const APPLICATIONS = APPLICANTS.map((person) => ({ id: person.id, full_name: person.full_name, vehicle_id: ids.vehicle, weekly_rent: 350 }));

function collectionsReport(fromIso) {
  const created = Math.floor(Date.parse(fromIso) / 1000) + 3600;
  const gross = 35000;
  const fees = 1045;
  const refunds = 0;
  const net = gross - fees;
  const totals = [{ currency: "usd", gross, refunds, fees, net, successful: 1, failed: 0 }];
  const customer = { id: "cus_fixture_dana", name: "Dana Reyes", currency: "usd", gross, refunds, fees, net, successful: 1, failed: 0 };
  const charge = {
    id: "ch_fixture_rent",
    customerId: customer.id,
    created,
    currency: "usd",
    amount: gross,
    paid: true,
    captured: true,
    status: "succeeded",
    fee: fees,
    paymentIntentId: "pi_fixture_rent",
    invoiceId: null,
    paymentIds: [],
    rentalId: null,
    sessionId: null,
    reason: "rent",
  };
  return {
    collectionsComplete: true,
    refreshedAt: new Date().toISOString(),
    totals,
    successful: 1,
    failed: 0,
    activeSubscriptions: 0,
    customers: [customer],
    verifiedCollections: { scope: "Verified Only", totals, customers: [customer], successful: 1, failed: 0, charges: [charge], refunds: [] },
    incompletePortions: [],
    subscriptions: [],
    payouts: [{ currency: "usd", amount: net, count: 1 }],
    warnings: ["Fixture data for owner review. Not a live Stripe account."],
  };
}

function filterRows(url, rows) {
  if (!rows.length) return rows;
  let out = rows.slice();
  for (const [key, value] of new URL(url).searchParams) {
    if (["select", "order", "offset", "limit", "apikey"].includes(key)) continue;
    if (!rows.some((row) => Object.prototype.hasOwnProperty.call(row, key))) continue;
    if (value.startsWith("in.(") && value.endsWith(")")) {
      const allowed = new Set(value.slice(4, -1).split(","));
      out = out.filter((row) => allowed.has(String(row[key])));
    } else if (value.startsWith("eq.")) {
      out = out.filter((row) => String(row[key]) === value.slice(3));
    } else if (value.startsWith("gte.")) {
      out = out.filter((row) => row[key] != null && String(row[key]) >= value.slice(4));
    } else if (value.startsWith("lte.")) {
      out = out.filter((row) => row[key] != null && String(row[key]) <= value.slice(4));
    } else if (value === "is.null") {
      out = out.filter((row) => row[key] == null);
    } else if (value === "not.is.null") {
      out = out.filter((row) => row[key] != null);
    }
  }
  return out;
}

function serverFn(name, input) {
  if (/getLeadPriorities/.test(name)) return leadResult(input);
  if (/getOverviewApplicants/.test(name)) {
    return { newApps: 2, pendingApps: 3, applicants: APPLICANTS, readiness: READINESS, canSeeReadiness: true };
  }
  if (/getStripeCollections/.test(name)) return { report: collectionsReport(input?.from || new Date().toISOString()) };
  if (/getAdminNotifications/.test(name)) {
    return { rows: APPLICANTS.map((person) => ({ id: person.id, full_name: person.full_name, email: null, phone: null, created_at: person.created_at, status: person.status })) };
  }
  if (/listConversations/.test(name)) return { unread: 0, conversations: [] };
  if (/getFleetMaintenance/.test(name)) return { counts: { overdue: 0, due: 0, dueSoon: 0, open: 0, conflict: 0 } };
  if (/listDriverRows/.test(name)) return { rows: [], canSeeSensitive: true };
  if (/listExpiring|getContactStatusHistory/.test(name)) return [];
  return null;
}

function tableRows(table) {
  if (table === "user_roles") return [{ role: "team", user_id: session.user.id }];
  if (table === "payments") return PAYMENTS;
  if (table === "payment_refunds") return [];
  if (table === "rentals") return RENTALS;
  if (table === "vehicles") return VEHICLES;
  if (table === "applications") return APPLICATIONS;
  return [];
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE || "/opt/google/chrome/chrome",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const leaked = [];

async function open(viewport) {
  const ctx = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    timezoneId: "America/New_York",
  });
  await ctx.route("**/*", (route) => {
    const url = route.request().url();
    const origin = new URL(url).origin;
    if (origin === new URL(BASE).origin) return route.continue();
    if (url.startsWith("https://fonts.googleapis.com/") || url.startsWith("https://fonts.gstatic.com/")) return route.continue();
    leaked.push(new URL(url).hostname);
    return route.abort();
  });
  await ctx.route(`**://${REF}.supabase.co/**`, async (route) => {
    const url = route.request().url();
    if (url.includes("/auth/v1/")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(url.includes("/token") ? session : session.user) });
    }
    if (url.includes("/storage/v1/")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
    }
    const table = url.split("/rest/v1/")[1]?.split("?")[0] ?? "";
    const rows = filterRows(url, tableRows(table));
    const requested = route.request().headers().range?.match(/(\d+)-(\d+)/);
    const from = requested ? Number(requested[1]) : 0;
    const to = requested ? Number(requested[2]) : rows.length - 1;
    const pageRows = rows.slice(from, to + 1);
    const range = rows.length === 0 ? "*/0" : pageRows.length === 0 ? `*/${rows.length}` : `${from}-${from + pageRows.length - 1}/${rows.length}`;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: {
        "content-range": range,
        "access-control-allow-origin": new URL(BASE).origin,
        "access-control-expose-headers": "content-range",
        "access-control-allow-credentials": "true",
      },
      body: route.request().method() === "HEAD" ? "" : JSON.stringify(pageRows),
    });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error).slice(0, 300)));
  await page.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [`sb-${REF}-auth-token`, JSON.stringify(session)]);
  const seenFns = new Set();
  await page.route("**/_serverFn/**", async (route) => {
    const id = new URL(route.request().url()).pathname.split("/").pop() ?? "";
    let name = "";
    try { name = Buffer.from(id.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(); } catch { /* ignore */ }
    if (!seenFns.has(name)) { seenFns.add(name); console.log("serverFn", name.slice(0, 180)); }
    let input = null;
    try {
      const post = route.request().postData();
      const raw = post || new URL(route.request().url()).searchParams.get("payload");
      if (raw) input = fromCrossJSON(JSON.parse(raw).t, { refs: new Map() })?.data ?? null;
    } catch { /* no payload */ }
    try {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "x-tss-serialized": "true" },
        body: JSON.stringify(toCrossJSON({ result: serverFn(name, input), context: {} }, { refs: new Map() })),
      });
    } catch (error) {
      return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: String(error?.message ?? error) }) });
    }
  });
  return { ctx, page, errors };
}

async function shot(page, name) {
  const file = `${OUT}/${name}.png`;
  await page.screenshot({ path: file, animations: "disabled" });
  console.log(file);
}

async function shotOf(locator, name) {
  const file = `${OUT}/${name}.png`;
  await locator.screenshot({ path: file, animations: "disabled" });
  console.log(file);
}

const widthName = (viewport) => (viewport.width === 1280 ? "desktop-1280" : "phone-390");

/** On a phone the toolbar is one sideways-scrolling row. Place it under the sticky header, and optionally scroll that row until Export CSV is in view. */
async function framePayments(page, viewport, { showExport = false } = {}) {
  if (viewport.width < 700) {
    await page.locator(".admin-sticky-bar").evaluate((el, revealExport) => {
      const headerRaw = getComputedStyle(document.documentElement).getPropertyValue("--admin-sticky-h");
      const headerH = Number.parseFloat(headerRaw) || document.querySelector("header")?.offsetHeight || 0;
      const top = window.scrollY + el.getBoundingClientRect().top - headerH;
      window.scrollTo(0, Math.max(0, top));
      if (!revealExport) {
        el.scrollLeft = 0;
        return;
      }
      const button = [...el.querySelectorAll("button")].find((node) => (node.textContent || "").includes("Export CSV"));
      if (!button) return;
      const barBox = el.getBoundingClientRect();
      const buttonBox = button.getBoundingClientRect();
      el.scrollLeft += buttonBox.right - barBox.right + 8;
    }, showExport);
    await page.waitForTimeout(150);
    return;
  }
  await page.getByRole("button", { name: "Export CSV" }).scrollIntoViewIfNeeded();
}

async function prepare(viewport) {
  const opened = await open(viewport);
  const { page } = opened;
  await page.goto(`${BASE}/admin?tab=overview`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Lead Priorities" }).waitFor({ timeout: 30000 });
  await page.getByText("Dana Reyes").first().waitFor({ timeout: 15000 });
  const partial = page.getByText("Partial").first();
  try {
    await partial.waitFor({ timeout: 15000 });
  } catch (error) {
    const card = page.getByRole("link", { name: "Revenue — Open Payments" });
    const cardText = await card.count() ? await card.innerText() : "(no revenue card)";
    const hints = await page.locator("[aria-label*='Unavailable'], [aria-label*='Partial']").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label")));
    console.log("REVENUE CARD:\n", cardText);
    console.log("HINTS", hints);
    console.log("PAGE ERRORS", opened.errors);
    await page.screenshot({ path: "/tmp/pr146-debug.png", fullPage: true });
    throw error;
  }
  return opened;
}

let failed = 0;
try {
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    const label = widthName(viewport);
    const { ctx, page, errors } = await prepare(viewport);
    const priorities = page.getByRole("region", { name: "Lead Priorities" });
    await priorities.scrollIntoViewIfNeeded();
    await shotOf(priorities, `${label}-lead-priorities`);

    await page.getByRole("button", { name: "Hot Leads" }).click();
    const hot = page.getByRole("dialog", { name: "Hot Prospects" });
    await hot.waitFor();
    await page.getByText("Qualification 88").waitFor();
    await shotOf(hot.locator("> div").first(), `${label}-hot-leads`);
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "View All Follow-ups" }).click();
    const all = page.getByRole("dialog", { name: "All Follow-ups" });
    await all.waitFor();
    await page.getByText("Follow-up is due today").waitFor();
    await page.getByText("Waiting on additional information").waitFor();
    await shotOf(all.locator("> div").first(), `${label}-all-follow-ups`);
    await page.keyboard.press("Escape");

    const revenue = page.getByRole("link", { name: "Revenue — Open Payments" });
    await revenue.scrollIntoViewIfNeeded();
    await page.getByText("$625").waitFor();
    await shotOf(revenue, `${label}-revenue-partial`);

    await page.goto(`${BASE}/admin?tab=payments&from=${day(-6)}&to=${TODAY}`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Export CSV" }).waitFor({ timeout: 30000 });
    await page.getByRole("heading", { name: "Unmatched Payments" }).waitFor({ timeout: 15000 });
    await page.getByText("Partial").first().waitFor();
    await framePayments(page, viewport);
    await shot(page, `${label}-payments-all`);
    await page.getByRole("heading", { name: "Unmatched Payments" }).evaluate((el) => el.scrollIntoView({ block: "start" }));
    await page.waitForTimeout(200);
    await shot(page, `${label}-unmatched`);
    await framePayments(page, viewport, { showExport: true });
    await shotOf(page.locator(".admin-sticky-bar"), `${label}-export-csv`);

    await page.getByRole("button", { name: "Stripe", exact: true }).click();
    await page.getByRole("region", { name: "Stripe Collections" }).waitFor({ timeout: 15000 });
    await framePayments(page, viewport);
    await shot(page, `${label}-payments-stripe`);

    await page.getByRole("button", { name: "Venmo", exact: true }).click();
    await page.getByRole("heading", { name: "Reconciliation" }).waitFor();
    await page.getByText("Priya Shah").first().waitFor();
    await framePayments(page, viewport);
    await shot(page, `${label}-payments-venmo`);

    if (errors.length) {
      failed++;
      console.error(label, errors);
    }
    await ctx.close();
  }
} catch (error) {
  failed++;
  console.error(error);
} finally {
  await browser.close();
}

const hosts = [...new Set(leaked)];
if (hosts.length) console.log("blocked external hosts:", hosts.join(", "));
if (failed) process.exit(1);
console.log("screenshots written for", TODAY);
