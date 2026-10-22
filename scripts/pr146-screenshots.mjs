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
    // 19:30 UTC is 3:30 PM ET. The browser zone is UTC, so a device-local
    // clock would paint 7:30 PM. fmtDateTime must paint 3:30 PM ET.
    refreshedAt: "2026-10-21T19:30:00.000Z",
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
  if (/getFleetMaintenance/.test(name)) {
    return { counts: { overdue: 0, due: 0, dueSoon: 0, open: 0, conflict: 0 }, attention: [], upcoming: [] };
  }
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
    timezoneId: "UTC",
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

function normalizeClock(value) {
  return value.replace(/[\s\u202f\u00a0]+/g, " ").trim();
}

/** The browser stays on UTC. Eastern text has to come from the app. */
async function assertUtcBrowser(page) {
  const seen = await page.evaluate(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const clock = new Date("2026-10-21T19:30:00.000Z").toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    return { zone, clock, scrollY: window.scrollY };
  });
  const clock = normalizeClock(seen.clock);
  if (seen.zone !== "UTC" || clock !== "7:30 PM") {
    throw new Error(`expected a UTC browser and 7:30 PM, got ${seen.zone} and ${clock}`);
  }
  console.log("browser clock", seen.zone, clock);
}

/**
 * Read the payments toolbar as the page painted it. No style writes and no
 * scrolling. On a phone, Due Date, Outstanding, and Export CSV must already
 * sit inside the viewport.
 */
async function assertPaymentsToolbar(page, viewport) {
  const placed = await page.evaluate(() => {
    const bar = document.querySelector(".admin-sticky-bar");
    const style = getComputedStyle(bar);
    const boxOf = (node) => {
      if (!node) return null;
      const r = node.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    };
    const due = [...bar.querySelectorAll("button")].find((node) => (node.textContent || "").includes("Due date"));
    const outstanding = [...bar.querySelectorAll("div")].find((node) => (node.textContent || "").trim().startsWith("Outstanding:"));
    const button = [...bar.querySelectorAll("button")].find((node) => (node.textContent || "").includes("Export CSV"));
    return {
      scrollY: window.scrollY,
      inline: bar.getAttribute("style"),
      position: style.position,
      flexWrap: style.flexWrap,
      overflowX: style.overflowX,
      scrollLeft: bar.scrollLeft,
      due: boxOf(due),
      outstanding: boxOf(outstanding),
      export: boxOf(button),
    };
  });
  console.log("payments toolbar", viewport.width, JSON.stringify(placed));
  if (placed.scrollY !== 0) throw new Error(`page was scrolled before the shot (${placed.scrollY})`);
  if (placed.inline) throw new Error(`toolbar has an injected style (${placed.inline})`);
  if (placed.scrollLeft !== 0) throw new Error(`toolbar is scrolled sideways (${placed.scrollLeft})`);
  if (viewport.width < 700) {
    if (placed.position === "sticky") throw new Error("phone toolbar is sticky and can cover the section under it");
    if (placed.flexWrap !== "wrap") throw new Error(`phone toolbar did not wrap (${placed.flexWrap})`);
    const inside = (box, label) => {
      if (!box || box.left < -1 || box.right > viewport.width + 1 || box.top < 0 || box.bottom > viewport.height) {
        throw new Error(`${label} is outside the ${viewport.width}px viewport (${JSON.stringify(box)})`);
      }
    };
    inside(placed.due, "Due Date");
    inside(placed.outstanding, "Outstanding");
    inside(placed.export, "Export CSV");
  }
}

async function prepare(viewport) {
  const opened = await open(viewport);
  const { page } = opened;
  await page.goto(`${BASE}/admin?tab=overview`, { waitUntil: "domcontentloaded" });
  await assertUtcBrowser(page);
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

/**
 * Phone bars other than Payments. Scroll stays at 0. No style writes.
 * Maintenance counts come from the vehicles fixture. The vehicles list
 * server function is not stubbed, so that shot is the toolbar only.
 */
async function assertWrappedBar(page, viewport, label) {
  const placed = await page.evaluate(() => {
    const bar = document.querySelector(".admin-sticky-bar");
    const style = getComputedStyle(bar);
    const box = bar.getBoundingClientRect();
    const inner = bar.querySelector(":scope > .flex-wrap");
    const innerStyle = inner ? getComputedStyle(inner) : null;
    const innerBox = inner ? inner.getBoundingClientRect() : null;
    return {
      scrollY: window.scrollY,
      inline: bar.getAttribute("style"),
      position: style.position,
      flexWrap: style.flexWrap,
      flexDirection: style.flexDirection,
      overflowX: style.overflowX,
      scrollLeft: bar.scrollLeft,
      top: box.top,
      bottom: box.bottom,
      left: box.left,
      right: box.right,
      height: box.height,
      innerWrap: innerStyle?.flexWrap ?? null,
      innerHeight: innerBox?.height ?? null,
      innerRight: innerBox?.right ?? null,
    };
  });
  console.log(label, JSON.stringify(placed));
  if (placed.scrollY !== 0) throw new Error(`${label} page was scrolled (${placed.scrollY})`);
  if (placed.inline) throw new Error(`${label} toolbar has an injected style (${placed.inline})`);
  if (placed.scrollLeft !== 0) throw new Error(`${label} toolbar is scrolled sideways (${placed.scrollLeft})`);
  if (placed.position === "sticky") throw new Error(`${label} phone toolbar is sticky`);
  if (placed.overflowX === "auto" || placed.overflowX === "scroll") throw new Error(`${label} still scrolls sideways (${placed.overflowX})`);
  if (placed.left < -1 || placed.right > viewport.width + 1) throw new Error(`${label} bar is wider than 390px`);
  if (placed.top < 0 || placed.bottom > viewport.height) throw new Error(`${label} bar is outside the viewport`);
  const wrapped = placed.flexWrap === "wrap" || placed.innerWrap === "wrap";
  const tall = placed.height > 56 || (placed.innerHeight != null && placed.innerHeight > 48);
  if (!wrapped || !tall) throw new Error(`${label} did not wrap into a taller bar`);
  return placed;
}

async function captureWrappedBars() {
  const viewport = { width: 390, height: 844 };
  const { ctx, page, errors } = await open(viewport);
  await page.goto(`${BASE}/admin?tab=maintenance`, { waitUntil: "domcontentloaded" });
  await assertUtcBrowser(page);
  await page.getByRole("button", { name: /Needs Odometer/ }).waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "Log Odometer" }).waitFor({ timeout: 15000 });
  await assertWrappedBar(page, viewport, "maintenance");
  await shot(page, "phone-390-maintenance");
  await shotOf(page.locator(".admin-sticky-bar"), "phone-390-maintenance-bar");

  await page.goto(`${BASE}/admin?tab=vehicles`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Search vehicles").waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "Add Vehicle" }).waitFor({ timeout: 15000 });
  await assertWrappedBar(page, viewport, "vehicles");
  await shot(page, "phone-390-vehicles");
  await shotOf(page.locator(".admin-sticky-bar"), "phone-390-vehicles-bar");

  if (errors.length) {
    console.error("bar page errors", errors);
    throw new Error(errors.join("\n"));
  }
  await ctx.close();
}

let failed = 0;
if (process.env.SHOT_BARS_ONLY) {
  try {
    await captureWrappedBars();
  } catch (error) {
    failed++;
    console.error(error);
  } finally {
    await browser.close();
  }
  if (failed) process.exit(1);
  console.log("wrapped bars written");
  process.exit(0);
}
try {
  const viewports = process.env.SHOT_PHONE_ONLY
    ? [{ width: 390, height: 844 }]
    : [{ width: 1280, height: 900 }, { width: 390, height: 844 }];
  for (const viewport of viewports) {
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
    await assertPaymentsToolbar(page, viewport);
    await shot(page, `${label}-payments-all`);
    await shotOf(page.getByRole("heading", { name: "Unmatched Payments" }).locator("xpath=ancestor::section[1]"), `${label}-unmatched`);
    await page.evaluate(() => window.scrollTo(0, 0));
    await assertPaymentsToolbar(page, viewport);
    await shotOf(page.locator(".admin-sticky-bar"), `${label}-export-csv`);

    await page.getByRole("button", { name: "Stripe", exact: true }).click();
    await page.getByRole("region", { name: "Stripe Collections" }).waitFor({ timeout: 15000 });
    await page.evaluate(() => window.scrollTo(0, 0));
    const clockText = normalizeClock(await page.getByText("Last Successful").innerText());
    console.log("stripe clock", label, clockText);
    if (!clockText.includes("3:30 PM ET")) throw new Error(`stripe clock is not Eastern: ${clockText}`);
    if (clockText.includes("7:30")) throw new Error(`stripe clock followed the UTC browser: ${clockText}`);
    await assertPaymentsToolbar(page, viewport);
    if (viewport.width < 700) {
      // The collections block sits below the summary. Bring its heading just
      // under the real header. The toolbar is not sticky, so it scrolls away
      // instead of covering the heading. No styles are written.
      await page.getByRole("heading", { name: "Stripe Collections" }).evaluate((el) => {
        const header = document.querySelector("header");
        const headerBottom = header ? header.getBoundingClientRect().bottom : 0;
        const top = window.scrollY + el.getBoundingClientRect().top - headerBottom - 8;
        window.scrollTo(0, Math.max(0, top));
      });
    }
    const heading = await page.getByRole("heading", { name: "Stripe Collections" }).evaluate((el) => {
      const bar = document.querySelector(".admin-sticky-bar");
      const barBox = bar.getBoundingClientRect();
      const headerBottom = document.querySelector("header")?.getBoundingClientRect().bottom ?? 0;
      const h = el.getBoundingClientRect();
      const overlaps = !(h.bottom <= barBox.top || h.top >= barBox.bottom || h.right <= barBox.left || h.left >= barBox.right);
      return {
        overlaps,
        top: h.top,
        bottom: h.bottom,
        headerBottom,
        barPosition: getComputedStyle(bar).position,
        barInline: bar.getAttribute("style"),
        scrollY: window.scrollY,
      };
    });
    console.log("stripe heading", label, JSON.stringify(heading));
    if (heading.barInline) throw new Error("toolbar style was injected");
    if (heading.overlaps) throw new Error(`toolbar covers Stripe Collections (${JSON.stringify(heading)})`);
    if (viewport.width < 700 && (heading.top < heading.headerBottom - 1 || heading.bottom > viewport.height)) {
      throw new Error(`Stripe Collections heading is not in the phone viewport (${JSON.stringify(heading)})`);
    }
    const clockBox = await page.getByText("3:30 PM ET").first().boundingBox();
    if (!clockBox || clockBox.y < 0 || clockBox.y + clockBox.height > viewport.height) {
      throw new Error(`Eastern clock is outside the viewport (${JSON.stringify(clockBox)})`);
    }
    await shot(page, `${label}-payments-stripe`);

    await page.getByRole("button", { name: "Venmo", exact: true }).click();
    await page.getByRole("heading", { name: "Reconciliation" }).waitFor();
    await page.getByText("Priya Shah").first().waitFor();
    await page.evaluate(() => window.scrollTo(0, 0));
    await assertPaymentsToolbar(page, viewport);
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
