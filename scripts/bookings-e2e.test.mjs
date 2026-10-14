/**
 * Bookings, in a real browser, at desktop and phone width.
 *
 * Three things here cannot be seen in a unit test, and two of them have
 * already bitten this codebase once:
 *
 *   1. admin.tsx strips a search param that its tab does not own, a moment
 *      AFTER the navigation. A filter that works in isolation loses itself on
 *      the next render, and the only way to catch it is to click the chip and
 *      then read the address bar back.
 *   2. The sticky filter bar publishes its own height and overlaps the strip
 *      below it. A second filter row renders fine and is unclickable. So the
 *      chips are CLICKED here, not merely found.
 *   3. The money boundary is a server decision. A Coordinator's answer has no
 *      money IN IT, so the columns must be absent from the rendered table —
 *      not present and blank, and not hidden by a class.
 *
 * Also: Bookings sits above Payments under RENTALS, the drawer's tabs are the
 * paperwork that already pointed at the rental, and the driver link carries
 * applications.id while the vehicle link carries the vehicle id.
 *
 * Synthetic rentals, stubbed server functions, no network, no real record.
 *
 * Run: npm run dev, then npm run test:bookings-e2e
 */
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";
import { toCrossJSON, fromCrossJSON } from "seroval";

const BASE = process.env.BASE || "http://127.0.0.1:5199";
const REF = "yuyzdsnrbfhkmfzpvhwx";

const R1 = "11111111-0000-4000-8000-000000000001"; // active, open-ended
const R2 = "11111111-0000-4000-8000-000000000002"; // completed
const R3 = "11111111-0000-4000-8000-000000000003"; // cancelled
const A1 = "22222222-0000-4000-8000-000000000001";
const V1 = "33333333-0000-4000-8000-000000000001";
/** The portal login behind A1 — deliberately NOT equal to A1. */
const U1 = "44444444-0000-4000-8000-000000000001";

let fail = 0;
const ok = (c, l) => { if (!c) fail++; console.log(`  ${c ? "PASS" : "BLOCKER"}  ${l}`); };

const exp = Math.floor(Date.now() / 1000) + 86400 * 30;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "00000000-0000-0000-0000-0000000000aa", role: "authenticated", email: "probe@example.com", exp })}.sig`;
const session = {
  access_token: jwt, token_type: "bearer", expires_in: 86400 * 30, expires_at: exp, refresh_token: "probe-refresh",
  user: { id: "00000000-0000-0000-0000-0000000000aa", aud: "authenticated", role: "authenticated", email: "probe@example.com",
    app_metadata: {}, user_metadata: { full_name: "Probe Staff" }, created_at: new Date().toISOString() },
};

/** Every call the screen made, so the test can assert it wrote nothing. */
let calls;
/** The same calls with their decoded input, for asserting WHAT was sent. */
let inputs;

const ROWS = [
  { id: R1, source: "rental", phase: "active", status: "active", startDate: "2026-09-01", endDate: null,
    openEnded: true, driverName: "Dana Rivers", driverEmail: "dana@example.com", applicationId: A1,
    driverUserId: U1, vehicleId: V1, unitNumber: "RR-001", vehicleLabel: "2013 Ford Fusion", plate: "ABC1234" },
  { id: R2, source: "rental", phase: "completed", status: "ended", startDate: "2026-05-01", endDate: "2026-08-01",
    openEnded: false, driverName: "Omar Vance", driverEmail: "omar@example.com",
    applicationId: "22222222-0000-4000-8000-000000000002", driverUserId: "44444444-0000-4000-8000-000000000002",
    vehicleId: "33333333-0000-4000-8000-000000000002", unitNumber: "RR-002", vehicleLabel: "2016 Toyota Camry", plate: "XYZ7788" },
  { id: R3, source: "rental", phase: "cancelled", status: "cancelled", startDate: "2026-04-01", endDate: "2026-04-02",
    openEnded: false, driverName: "Omar Vance", driverEmail: "omar@example.com",
    applicationId: "22222222-0000-4000-8000-000000000002", driverUserId: "44444444-0000-4000-8000-000000000002",
    vehicleId: "33333333-0000-4000-8000-000000000002", unitNumber: "RR-002", vehicleLabel: "2016 Toyota Camry", plate: "XYZ7788" },
];
const MONEY_BY_ID = {
  [R1]: { weeklyRate: 350, paymentStatus: "current", depositStatus: "held", balanceDue: 350 },
  [R2]: { weeklyRate: 400, paymentStatus: "current", depositStatus: "refunded", balanceDue: 0 },
  [R3]: { weeklyRate: 400, paymentStatus: "current", depositStatus: "none", balanceDue: 0 },
};
const COUNTS = { active: 1, completed: 1, cancelled: 1 };

/** The server's own shape: a Coordinator's rows have NO money keys at all. */
function listPayload(input, canSeeMoney) {
  const q = String(input?.q ?? "").toLowerCase();
  const phase = String(input?.phase ?? "all");
  let rows = ROWS;
  if (phase !== "all") rows = rows.filter((r) => r.phase === phase);
  if (q) rows = rows.filter((r) => `${r.driverName} ${r.driverEmail} ${r.unitNumber} ${r.plate}`.toLowerCase().includes(q));
  const out = rows.map((r) => (canSeeMoney ? { ...r, ...MONEY_BY_ID[r.id] } : { ...r }));
  return { rows: out, total: out.length, page: 1, pageSize: 25, counts: COUNTS, canSeeMoney };
}

function detailPayload(rentalId, canSeeMoney) {
  const row = ROWS.find((r) => r.id === rentalId);
  if (!row) return null;
  const booking = canSeeMoney ? { ...row, ...MONEY_BY_ID[row.id] } : { ...row };
  return {
    booking,
    driver: { applicationId: row.applicationId, name: row.driverName, email: row.driverEmail,
      phone: "8135550111", applicationStatus: "approved", portalUserId: row.driverUserId },
    vehicle: { id: row.vehicleId, unitNumber: row.unitNumber, label: row.vehicleLabel, plate: row.plate,
      vin: "1HGCM82633A004352", color: "Blue", status: "rented" },
    mileage: { pickup: 41000, return: row.openEnded ? null : 48000 },
    inspections: [
      // The check-in is already done — which is the state you are in when you
      // reach for End Rental, and where its mileage prefill comes from.
      { id: "i-2", type: "return", status: "passed", startedAt: "2026-10-11T08:30:00Z",
        completedAt: "2026-10-11T09:00:00Z", odometer: 48000, inspector: "Luis",
        driverSignedAt: null, photoCount: 1 },
      { id: "i-1", type: "pre_delivery", status: "passed", startedAt: "2026-09-01T08:30:00Z",
        completedAt: "2026-09-01T09:00:00Z", odometer: 41000, inspector: "Luis",
        driverSignedAt: "2026-09-01T09:05:00Z", photoCount: 2 },
    ],
    agreements: [{ id: "ag-1", title: "Rental Agreement", status: "signed", sentAt: "2026-09-01T06:00:00Z",
      signedAt: "2026-09-01T07:00:00Z", voidedAt: null, archiveStatus: "archived", documentId: "doc-1" }],
    money: canSeeMoney
      ? { payments: [{ id: "p-1", type: "rent", status: "due", amount: 350, balanceDue: 350,
            dueDate: "2026-10-05", paidDate: null, netCollected: null }],
          charges: [{ id: "t-1", chargeType: "toll", agency: "SunPass", amount: 4.25, adminFee: 5,
            status: "rebilled", occurredAt: "2026-09-20T14:00:00Z" }],
          deposit: { amount: 300, held: true, status: "held", refunded: null } }
      : undefined,
    // Operational for everyone; the amounts only for a Manager, exactly as the
    // server builds it. A Coordinator's rows have no cost KEYS at all.
    incidents: [
      canSeeMoney
        ? { id: "inc-1", type: "accident", occurredAt: "2026-09-20T14:00:00Z", reportedAt: "2026-09-20T15:00:00Z",
            severity: "moderate", status: "open", atFault: "renter", drivable: false, claimNumber: "CLM-9",
            description: "Rear-ended at a light", estimatedCost: 2400, actualCost: 2650, driverResponsible: 1000 }
        : { id: "inc-1", type: "accident", occurredAt: "2026-09-20T14:00:00Z", reportedAt: "2026-09-20T15:00:00Z",
            severity: "moderate", status: "open", atFault: "renter", drivable: false, claimNumber: "CLM-9",
            description: "Rear-ended at a light" },
    ],
    maintenance: [
      canSeeMoney
        ? { id: "mr-1", item: "Oil change", category: "oil", status: "completed", priority: "routine",
            dueDate: null, performedOn: "2026-09-15", odometer: 43000, vendorName: "Tampa Lube", totalCost: 89.5 }
        : { id: "mr-1", item: "Oil change", category: "oil", status: "completed", priority: "routine",
            dueDate: null, performedOn: "2026-09-15", odometer: 43000, vendorName: "Tampa Lube" },
    ],
    counts: { inspections: 2, agreements: 1, conditionPhotos: 3,
      payments: canSeeMoney ? 1 : 0, charges: canSeeMoney ? 1 : 0, incidents: 1, maintenance: 1 },
    // One honest gap on the open rental: the car has not come back yet.
    unavailable: row.openEnded ? ["Return mileage pending return"] : [],
    canSeeMoney,
    canManage: canSeeMoney,
  };
}

/**
 * The driver's own two rentals: the one they are driving and the one that
 * ended. The ended one is the whole reason this card exists — every other
 * portal read asks for the ACTIVE rental, so a finished rental vanished.
 */
const MY_RENTALS = [
  { id: R1, status: "active", phase: "Active", start_date: "2026-09-01", end_date: null, open_ended: true,
    weekly_rate: 350,
    vehicle: { year: 2013, make: "Ford", model: "Fusion", trim: "SE", color: "Blue", plate: "ABC1234", photo: null },
    agreement: { id: "ag-1", status: "signed", signed_at: "2026-09-01T07:00:00Z" } },
  { id: R2, status: "ended", phase: "Completed", start_date: "2026-01-05", end_date: "2026-04-05", open_ended: false,
    weekly_rate: 325,
    vehicle: { year: 2015, make: "Nissan", model: "Altima", trim: null, color: "Silver", plate: "OLD9900", photo: null },
    agreement: { id: "ag-old", status: "signed", signed_at: "2026-01-05T07:00:00Z" } },
];

function serverFn(name, input, canSeeMoney) {
  calls.push(name);
  inputs.push({ name, input });
  switch (true) {
    case /getMyRentalHistory/.test(name): return MY_RENTALS;
    // The portal shell renders the applicant home for a moment before the
    // role read lands, and it needs a real answer to do that.
    case /getMyPortalAccess/.test(name):
      return { stage: "approved", email: "dana@example.com", review: false,
        application: { status: "approved", step: null, name: "Dana Rivers",
          createdAt: "2026-08-01T10:00:00Z", onWaitlist: false, documents: [] },
        waitlist: null };
    case /getPublicBusinessPhone/.test(name): return "813-555-0000";
    case /getDriverDashboard/.test(name):
      return {
        applicationStatus: "approved",
        rental: { id: R1, weekly_rate: 350, deposit_amount: 300, deposit_held: true,
          next_payment_due: "2026-10-12", start_date: "2026-09-01", status: "active", weeks_rented: 6 },
        vehicle: { id: V1, year: 2013, make: "Ford", model: "Fusion", trim: "SE", color: "Blue",
          photo: null, plate: "ABC1234", status: "rented" },
        payments: [], maintenance: [], notifications: [], shops: [],
      };
    case /listBookings/.test(name): return listPayload(input, canSeeMoney);
    case /getBooking/.test(name): return detailPayload(input?.rentalId, canSeeMoney);
    // ConditionMedia[] — an ARRAY. Returning {items} here once crashed the
    // drawer on .map, which is exactly the shape mistake worth catching.
    case /listConditionMedia/.test(name):
      return [{ id: "cm-1", vehicle_id: V1, rental_id: R1, phase: "before", angle: "front",
        media_type: "photo", caption: null, captured_by_role: "staff",
        created_at: "2026-09-01T09:00:00Z", url: "data:image/gif;base64,R0lGODlhAQABAAAAACw=" }];
    case /listAuditLog/.test(name): return { rows: [], total: 0 };
    // The R1 actions. Recorded, never performed: the point is which endpoint
    // the button reached and with what, not to run a transaction in a browser.
    case /endRental/.test(name): return { ok: true, alreadyClosed: false, vehicleStatus: "maintenance", releaseReasons: ["Return inspection missing, incomplete or failed"], billing: "Closure does not confirm Stripe cancellation. Review billing separately." };
    case /startInspection/.test(name): return { id: "insp-new-1" };
    case /getInspection/.test(name):
      return { id: "insp-new-1", vehicle_id: V1, rental_id: R1, inspection_type: "return",
        status: "in_progress", odometer: 48000, fuel_level: "half", inspector_name: "Probe Staff",
        started_at: "2026-10-11T09:00:00Z", completed_at: null, driver_signed_at: null,
        exterior_notes: null, interior_notes: null, notes: null, driver_notes: null,
        items: [{ id: "it-1", section: "Exterior", label: "Front bumper", result: "pending",
          notes: null, requires_photo: true, is_critical: false, sort_order: 1 }],
        media: [] };
    case /getDepositSummary/.test(name):
      return { rentalId: R1, depositAmount: 300, deductions: [], withheld: 0, refund: 300,
        settledAt: null, status: "held", candidates: { tolls: [], incidents: [] } };
    case /getAgreementPdf/.test(name): return null;
    case /listConversations/.test(name): return [];
    case /listVehicles/.test(name): return { rows: [], total: 0, page: 1, pageSize: 25 };
    case /getOverview|listDrivers|listPayments/.test(name): return { rows: [], total: 0 };
    default: return null;
  }
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

async function open(viewport, role, url = `${BASE}/admin?tab=bookings`, noTemplates = false) {
  calls = [];
  inputs = [];
  const canSeeMoney = role === "team" || role === "admin";
  const ctx = await browser.newContext({ viewport });
  await ctx.route(`**://${REF}.supabase.co/**`, async (route) => {
    const u = route.request().url();
    if (u.includes("/auth/v1/"))
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(session) });
    if (u.includes("/storage/v1/"))
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ Key: "ok" }) });
    // The handoff dialog reads the checklists straight from PostgREST under
    // RLS, the same way the Inspections panel does. `noTemplates` lets a run
    // prove the honest empty state instead of only the happy path.
    const rows = u.includes("user_roles")
      ? [{ role }]
      : u.includes("inspection_templates") && !noTemplates
        ? [
            { id: "tpl-out", name: "Pre-Delivery", inspection_type: "pre_delivery", is_active: true },
            { id: "tpl-in", name: "Return", inspection_type: "return", is_active: true },
          ]
        : [];
    const isHead = route.request().method() === "HEAD";
    return route.fulfill({
      status: 200, contentType: "application/json", headers: { "content-range": "0-0/0" },
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
        body: JSON.stringify(toCrossJSON({ result: serverFn(name, input, canSeeMoney), context: {} }, { refs: new Map() })),
      });
    } catch (e) {
      return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: String(e?.message ?? e) }) });
    }
  });
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(2200);
  return { ctx, page, errors };
}

/**
 * How many DISTINCT rentals the list is showing. The table and the mobile
 * cards are both in the DOM at every width — one is hidden by CSS — so
 * counting elements double-counts. Count the ids.
 */
async function shown(page) {
  const ids = await page
    .locator("[data-booking], [data-booking-card]")
    .evaluateAll((els) => els.map((e) => e.dataset.booking || e.dataset.bookingCard));
  return new Set(ids.filter(Boolean)).size;
}

/**
 * Open a booking by clicking whichever of its two representations this width
 * actually shows: the table row on a desktop, the card on a phone.
 */
async function openBooking(page, id) {
  const target = page.locator(`[data-booking="${id}"]:visible, [data-booking-card="${id}"]:visible`).first();
  await target.scrollIntoViewIfNeeded().catch(() => {});
  await target.click({ timeout: 8000 });
  await page.waitForTimeout(1600);
}

/** The chips sit under the sticky bar, which has overlapped them before. */
async function clickPhase(page, phase) {
  const chip = page.locator(`[data-phase="${phase}"]`);
  await chip.scrollIntoViewIfNeeded().catch(() => {});
  await chip.click({ timeout: 4000 });
  await page.waitForTimeout(1200);
}

async function run(label, viewport) {
  console.log(`\n================ ${label} (${viewport.width}x${viewport.height}) — MANAGER`);
  const { ctx, page, errors } = await open(viewport, "team");

  // ---------------------------------------------- the rail
  const nav = page.locator('aside[aria-label="Main navigation"]');
  const railVisible = await nav.isVisible().catch(() => false);
  if (railVisible) {
    const labels = (await nav.innerText()).split("\n").map((s) => s.trim()).filter(Boolean);
    const iRentals = labels.indexOf("RENTALS");
    const iBookings = labels.indexOf("Bookings");
    const iPayments = labels.indexOf("Payments");
    ok(iBookings > -1, "Bookings is on the rail");
    ok(iRentals > -1 && iBookings > iRentals, "  under the RENTALS divider");
    ok(iPayments > -1 && iBookings < iPayments, "  and above Payments, where it was asked for");
  } else {
    ok(await page.locator('[data-testid="booking-phases"]').count() === 1,
      "the rail is collapsed at this width; Bookings is reached by URL and renders");
  }

  // ---------------------------------------------- the list
  ok(await page.locator('[data-testid="booking-phases"]').count() === 1, "the phase chips render");
  for (const [p, n] of Object.entries(COUNTS))
    ok(await page.locator(`[data-phase="${p}"]`).getAttribute("data-count") === String(n),
      `  the ${p} chip counts the scope (${n})`);
  ok(await shown(page) === 3, "all three rentals are listed, cancelled included");
  const bodyText = await page.locator("body").innerText();
  ok(/Dana Rivers/.test(bodyText), "the driver is named from the application");
  ok(/RR-001/.test(bodyText), "the unit number is shown");
  ok(/Open-ended/i.test(bodyText), "an open-ended rental says so instead of printing a dash");
  ok(!/Reserved|Upcoming/i.test(bodyText), "and no upcoming booking is invented from a rental that does not exist");

  // ------------------------------- the filter survives the router's normalisation
  await clickPhase(page, "cancelled");
  let url = new URL(page.url());
  ok(url.searchParams.get("tab") === "bookings", "the tab is still bookings after the chip click");
  ok(url.searchParams.get("phase") === "cancelled",
    `the phase survives in the URL (phase=${url.searchParams.get("phase")})`);
  // The strip happens a tick AFTER the navigation. Wait, then read again.
  await page.waitForTimeout(1500);
  url = new URL(page.url());
  ok(url.searchParams.get("phase") === "cancelled",
    "  and is still there after the admin router has normalised the search");
  ok(await page.locator('[data-phase="cancelled"]').getAttribute("aria-pressed") === "true",
    "  the chip reads as pressed");
  ok(await shown(page) === 1, "  and the list narrowed to the cancelled rental");
  ok(await page.locator(`[data-phase="active"]`).getAttribute("data-count") === "1",
    "  while the counts still count the whole scope, not the filtered page");

  // a reload is the real test of a URL-held filter
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  ok(await page.locator('[data-phase="cancelled"]').getAttribute("aria-pressed") === "true",
    "the filter comes back on a reload — it lives in the URL, not in memory");
  await clickPhase(page, "cancelled");
  ok(!new URL(page.url()).searchParams.get("phase"), "clicking the pressed chip clears the filter from the URL");

  // ---------------------------------------------- search
  await page.getByLabel("Search bookings").fill("RR-002");
  await page.waitForTimeout(1600);
  ok(new URL(page.url()).searchParams.get("q") === "RR-002", "the search lands in the URL after the pause");
  ok(await shown(page) === 2, "  and narrows the list to that unit's two rentals");
  await page.getByLabel("Search bookings").fill("nobody-by-this-name");
  await page.waitForTimeout(1600);
  ok(await page.getByText("No Matching Bookings").count() === 1,
    "a search with no match says so, and does not show the empty-fleet message");
  await page.getByLabel("Search bookings").fill("");
  await page.waitForTimeout(1600);

  // ---------------------------------------------- the drawer
  await openBooking(page, R1);
  ok(await page.getByRole("heading", { name: "Dana Rivers" }).count() > 0, "opening a booking shows the rental");
  ok(new URL(page.url()).searchParams.get("id") === R1, "  and the open record is held in the URL");
  const tabKeys = await page.locator("[data-booking-tab]").evaluateAll((els) => els.map((e) => e.dataset.bookingTab));
  ok(JSON.stringify(tabKeys) === JSON.stringify(["overview", "inspections", "agreements", "money", "activity"]),
    `a Manager gets every tab (${tabKeys.join(", ")})`);
  const drawer = await page.locator("body").innerText();
  ok(/41,000 mi/.test(drawer), "the pickup mileage is read from the reading the rental points at");
  ok(/Return mileage pending return/.test(drawer), "the missing return mileage is named as pending, not as zero");
  ok(await page.locator('[data-testid="booking-unavailable"]').count() === 1, "  in its own Not Available block");
  ok(/1HGCM82633A004352/.test(drawer), "the real VIN is shown — never a record id");

  await page.locator('[data-booking-tab="inspections"]').click();
  await page.waitForTimeout(1400);
  ok(/Pre delivery|Pre_delivery|Pre-delivery/i.test(await page.locator("body").innerText()),
    "the Inspections tab lists the inspection already on the rental");
  ok(await page.locator('[data-testid="condition-photos"]').count() >= 0, "  and offers its condition photos");

  await page.locator('[data-booking-tab="agreements"]').click();
  await page.waitForTimeout(1200);
  ok(/Rental Agreement/.test(await page.locator("body").innerText()),
    "the Agreements tab lists the signed agreement already on the rental");
  ok(await page.locator('[data-testid="open-agreement-pdf"]').count() === 1,
    "  and a Manager is offered the signed PDF");
  ok(await page.locator('[data-testid="agreement-pdf-withheld"]').count() === 0,
    "  with no withheld note for them");

  await page.locator('[data-booking-tab="money"]').click();
  await page.waitForTimeout(1200);
  const moneyTab = await page.locator("body").innerText();
  ok(await page.locator('[data-testid="booking-payments"]').count() === 1, "the Payments tab lists this rental's charges");
  ok(/SunPass/.test(moneyTab), "  including the toll rebilled to it");
  ok(/\$300\.00/.test(moneyTab), "  and the deposit as the record holds it");

  // ---------------------------------------------- the actions (R1)
  await page.locator('[data-booking-tab="overview"]').click();
  await page.waitForTimeout(900);
  ok(await page.locator('[data-testid="booking-actions"]').count() === 1, "the Actions card renders");
  for (const a of ["end-rental", "settle-deposit", "checkout", "checkin", "message", "charges", "incidents", "maintenance"]) {
    ok(await page.locator(`[data-testid="action-${a}"]`).count() === 1, `  a Manager is offered ${a}`);
  }

  // End Rental: the existing protected endpoint, with the questions it asks.
  await page.locator('[data-testid="action-end-rental"]').click();
  await page.waitForTimeout(900);
  ok(await page.locator('[data-testid="end-rental-dialog"]').count() === 1, "End Rental opens its own dialog");
  const endText = await page.locator('[data-testid="end-rental-dialog"]').innerText();
  ok(/48,000 mi|48000/.test(endText), "the return mileage is prefilled from the completed check-in");
  ok(/Available If Safe/.test(endText) && /Into Maintenance/.test(endText),
    "and it can send the car to the shop, which the driver-record path never could");
  await page.locator('[data-testid="end-rental-maintenance"]').click();
  await page.waitForTimeout(300);
  ok(await page.locator('[data-testid="end-rental-maintenance"]').getAttribute("aria-pressed") === "true",
    "  the destination is a real choice");
  calls.length = 0;
  await page.locator('[data-testid="end-rental-confirm"]').click();
  await page.waitForTimeout(1800);
  ok(calls.some((c) => /endRental/.test(c)),
    "confirming calls the existing endRental — the only caller of end_rental_tx");
  ok(!calls.some((c) => /activateRental|swap/i.test(c)), "  and nothing else that moves a rental");
  ok(await page.locator('[data-testid="booking-payments"], [data-testid="deposit-dialog"], body').count() > 0,
    "the screen stays usable afterwards");
  // Settling the deposit opens next; close whatever is on top before moving on.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(700);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(700);

  // Check-In: launched with the rental AND the vehicle, which is what keeps
  // the photos findable from the booking afterwards.
  await page.goto(`${BASE}/admin?tab=bookings&id=${R1}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2200);
  inputs.length = 0;
  await page.locator('[data-testid="action-checkin"]').click();
  await page.waitForTimeout(1200);
  ok(await page.locator('[data-testid="handoff-dialog"]').count() === 1, "Check-In opens the handoff dialog");
  await page.locator('[data-testid="handoff-start"]').click();
  await page.waitForTimeout(1800);
  const started = inputs.find((i) => /startInspection/.test(i.name));
  ok(!!started, "starting calls the existing startInspection");
  ok(started?.input?.rentalId === R1, `  carrying THIS rental (${String(started?.input?.rentalId).slice(0, 8)})`);
  ok(started?.input?.vehicleId === V1, `  and THIS vehicle (${String(started?.input?.vehicleId).slice(0, 8)})`);
  ok(started?.input?.templateId === "tpl-in",
    "and the RETURN checklist, chosen by the handoff rather than whichever sorted first");
  ok(await page.locator('[data-testid="handoff-runner"]').count() === 1,
    "and hands straight over to the existing inspection runner — no second checklist");
  ok(/Front bumper/.test(await page.locator('[data-testid="handoff-runner"]').innerText()),
    "  with the checklist items it already had");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);

  // Message Driver reuses the existing overlay, on this applicant's thread.
  await page.goto(`${BASE}/admin?tab=bookings&id=${R1}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2200);
  await page.locator('[data-testid="action-message"]').click();
  await page.waitForTimeout(1600);
  ok(new URL(page.url()).searchParams.get("msg") === A1,
    "Message Driver opens the existing thread for applications.id");
  ok(new URL(page.url()).searchParams.get("id") === R1, "  without losing the booking underneath");

  // What is already on the rental, before you navigate anywhere.
  await page.goto(`${BASE}/admin?tab=bookings&id=${R1}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2200);
  const ov = await page.locator("body").innerText();
  ok(await page.locator('[data-testid="booking-incidents"]').count() === 1, "the rental's incidents are listed");
  ok(/Rear-ended|CLM-9/.test(ov), "  with what happened");
  ok(await page.locator('[data-testid="booking-maintenance"]').count() === 1, "and its service records");
  ok(/Oil change/.test(ov), "  with the work done");
  await page.locator('[data-testid="open-maintenance"]').click();
  await page.waitForTimeout(1800);
  ok(new URL(page.url()).searchParams.get("tab") === "maintenance",
    "Open Maintenance hands off to the existing panel rather than duplicating it");

  // ---------------------------------------------- the two links
  await page.goto(`${BASE}/admin?tab=bookings&id=${R1}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2200);
  await page.locator('[data-booking-tab="overview"]').click();
  await page.waitForTimeout(900);
  await page.locator('[data-testid="open-vehicle"]').click();
  await page.waitForTimeout(1800);
  let q = new URL(page.url()).searchParams;
  ok(q.get("tab") === "vehicles" && q.get("id") === V1, `the vehicle link opens that vehicle (id=${q.get("id")?.slice(0, 8)})`);

  await page.goto(`${BASE}/admin?tab=bookings&id=${R1}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2200);
  await page.locator('[data-testid="open-driver"]').click();
  await page.waitForTimeout(1800);
  q = new URL(page.url()).searchParams;
  ok(q.get("tab") === "drivers", "the driver link opens the Drivers tab");
  ok(q.get("id") === A1, "  carrying applications.id — the person's record");
  ok(q.get("id") !== U1, "  and NOT rentals.driver_id, which is a portal login");

  // ---------------------------------------------- it only read
  ok(!calls.some((c) => /^(end|activate|create|update|delete|save|apply)/i.test(c)),
    `nothing on this screen called a writer (${[...new Set(calls)].length} distinct reads)`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(overflow <= 1, `no horizontal overflow (${overflow}px)`);
  ok(errors.length === 0, errors.length ? `no page errors — saw ${errors[0]}` : "no page errors");
  await ctx.close();
}

async function runCoordinator(label, viewport) {
  console.log(`\n================ ${label} (${viewport.width}x${viewport.height}) — COORDINATOR`);
  const { ctx, page, errors } = await open(viewport, "coordinator");

  ok(await page.locator('[data-testid="booking-phases"]').count() === 1,
    "a Coordinator reaches Bookings — the operational record is theirs");
  ok(await shown(page) === 3, "  and sees every rental");
  const headers = await page.locator("thead th").allInnerTexts().catch(() => []);
  if (headers.length) {
    ok(!headers.some((h) => /Weekly|Outstanding/i.test(h)),
      `the money columns are ABSENT from the table, not blank (${headers.filter(Boolean).join(", ")})`);
  } else {
    ok(true, "no table at this width; the cards are asserted below");
  }
  const listText = await page.locator("body").innerText();
  ok(!/\$350|\$400|due\b/i.test(listText), "no rate or balance is rendered anywhere in the list");
  ok(/Dana Rivers/.test(listText) && /RR-001/.test(listText),
    "  control: the operational detail IS rendered, so the absence above is the boundary");

  await openBooking(page, R1);
  const tabKeys = await page.locator("[data-booking-tab]").evaluateAll((els) => els.map((e) => e.dataset.bookingTab));
  ok(JSON.stringify(tabKeys) === JSON.stringify(["overview", "inspections", "agreements"]),
    `the Payments and Activity tabs are not offered (${tabKeys.join(", ")})`);
  const drawer = await page.locator("body").innerText();
  ok(!/Weekly Rate|Deposit|\$350|\$300/.test(drawer), "and no money reaches the drawer under any label");
  ok(/41,000 mi/.test(drawer), "  control: the mileage and paperwork are still theirs to see");
  ok(await page.locator('[data-testid="booking-payments"]').count() === 0, "the payments table does not exist for them");

  // The signed contract carries the renter's identity and card details, so the
  // PDF is Manager-and-above on the server (Codex's hotfix) and the button is
  // offered on the same terms. The STATUS stays — that is the operational
  // question a Coordinator has: is this booking papered?
  await page.locator('[data-booking-tab="agreements"]').click();
  await page.waitForTimeout(1200);
  const agText = await page.locator("body").innerText();
  ok(/Rental Agreement/.test(agText), "a Coordinator sees the agreement");
  ok(/Signed:/.test(agText), "  and whether it is signed");
  ok(await page.locator('[data-testid="open-agreement-pdf"]').count() === 0,
    "but the Open Signed PDF button is not offered to them");
  ok(await page.locator('[data-testid="agreement-pdf-withheld"]').count() === 1,
    "  and they are told why instead of hunting for a missing control");
  ok(!calls.some((c) => /getAgreementPdf/.test(c)),
    "and nothing on their path calls getAgreementPdf at all");
  await page.locator('[data-booking-tab="overview"]').click();
  await page.waitForTimeout(900);

  // R1: a Coordinator gets the operational record and none of the Manager
  // actions. The handoff buttons are Manager+ too, because isStaff() in
  // inspections.functions.ts is admin/team only — the button matches the
  // server rather than offering a call that would be refused.
  ok(await page.locator('[data-testid="booking-actions"]').count() === 1, "the Actions card still renders");
  for (const a of ["end-rental", "settle-deposit", "charges", "incidents"]) {
    ok(await page.locator(`[data-testid="action-${a}"]`).count() === 0,
      `  ${a} is not offered to a Coordinator`);
  }
  // The handoff IS theirs now: canInspect() admits a Coordinator to recording
  // one. Destroying a condition photo still asks isStaff(), unchanged.
  for (const a of ["checkout", "checkin", "message", "maintenance"]) {
    ok(await page.locator(`[data-testid="action-${a}"]`).count() === 1,
      `  ${a} IS offered to a Coordinator, so the absences above are the boundary`);
  }

  // And it works end to end at this width, not merely renders.
  inputs.length = 0;
  await page.locator('[data-testid="action-checkin"]').click();
  await page.waitForTimeout(1200);
  ok(await page.locator('[data-testid="handoff-dialog"]').count() === 1,
    "a Coordinator can open the handoff dialog");
  await page.locator('[data-testid="handoff-start"]').click();
  await page.waitForTimeout(1800);
  const crdStart = inputs.find((i) => /startInspection/.test(i.name));
  ok(!!crdStart, "and start the inspection");
  ok(crdStart?.input?.rentalId === R1 && crdStart?.input?.vehicleId === V1,
    "  carrying this rental and this vehicle");
  ok(await page.locator('[data-testid="handoff-runner"]').count() === 1,
    "  landing in the same runner a Manager uses");
  ok(!calls.some((c) => /deleteConditionMedia/.test(c)),
    "and nothing on their path reaches the delete");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);
  await page.goto(`${BASE}/admin?tab=bookings&id=${R1}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2200);
  ok(await page.locator('[data-testid="booking-incidents"]').count() === 1,
    "they can see the car was in an accident — they may be arranging the tow");
  const crdOv = await page.locator("body").innerText();
  ok(/Rear-ended/.test(crdOv), "  with what happened");
  ok(!/2,650|2650|\$2,400|89\.50/.test(crdOv), "and never what it cost");
  ok(await page.locator('[data-testid="booking-maintenance"]').count() === 1, "service records too");
  ok(/Oil change/.test(crdOv), "  with the work");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(overflow <= 1, `no horizontal overflow (${overflow}px)`);
  ok(errors.length === 0, errors.length ? `no page errors — saw ${errors[0]}` : "no page errors");
  await ctx.close();
}

/**
 * The driver's own history, in their own portal. The card lives on the
 * Dashboard — the one tab they always have — because the tabs that depend on
 * a live rental disappear the moment a rental ends, which is exactly when the
 * history matters most.
 */
async function runDriver(label, viewport) {
  console.log(`\n================ ${label} (${viewport.width}x${viewport.height}) — DRIVER PORTAL`);
  const { ctx, page, errors } = await open(viewport, "driver", `${BASE}/portal`);

  const card = page.locator('[data-testid="my-rentals"]');
  ok(await card.count() === 1, "the My Rentals card renders on the Dashboard");
  ok(/My Rentals/.test(await card.innerText()), "  under its own heading");
  const ids = await page.locator("[data-rental]").evaluateAll((els) => els.map((e) => e.dataset.rental));
  ok(ids.length === 2, `both of this driver's rentals are listed (${ids.length})`);
  const text = await card.innerText();
  ok(/2013 Ford Fusion/.test(text), "the car they are driving is named");
  ok(/2015 Nissan Altima/.test(text),
    "and so is the one they GAVE BACK — the rental that used to disappear");
  ok(/Completed/.test(text), "  shown as Completed");
  ok(/Open-ended/.test(text), "the live rental says Open-ended, not a missing end date");
  ok(/2026-04-05/.test(text), "the finished rental reports the date it ended");
  ok(/Agreement signed/.test(text), "and their own signed agreement is acknowledged");
  ok(!/1HGCM82633A004352|RR-001|GPS/.test(text),
    "no VIN, unit number or GPS identifier reaches the driver");

  ok(!calls.some((c) => /^(end|activate|create|update|delete|save|apply)/i.test(c)),
    "nothing on the driver's dashboard called a writer");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(overflow <= 1, `no horizontal overflow (${overflow}px)`);
  ok(errors.length === 0, errors.length ? `no page errors — saw ${errors[0]}` : "no page errors");
  await ctx.close();
}

await run("DESKTOP", { width: 1440, height: 900 });
await runCoordinator("DESKTOP", { width: 1440, height: 900 });
await run("MOBILE", { width: 390, height: 844 });
await runCoordinator("MOBILE", { width: 390, height: 844 });
await runDriver("DESKTOP", { width: 1440, height: 900 });
await runDriver("MOBILE", { width: 390, height: 844 });

await browser.close();
console.log(fail ? `\n${fail} FAILURE(S)` : "\nall clear");
process.exit(fail ? 1 : 0);
