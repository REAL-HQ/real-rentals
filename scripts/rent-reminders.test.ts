// Uniform rent reminders: one schedule for autopay and manual payers.
//
// Pins: the stage owed at each point of the week; one send per rental + week +
// stage + channel (a replay or a second run sends nothing); autopay wording vs
// manual wording; Stripe renters only ever get their own invoice / card link;
// the $50/day late fee and staff waivers; Record Payment stopping reminders;
// texting only 8 AM–9 PM ET; every stage OFF until an Owner turns it on; and
// the Stripe webhook text sharing the same ledger (no duplicate texts).
//
// Run: bun test scripts/rent-reminders.test.ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
process.env.SUPABASE_URL ??= "http://127.0.0.1:9";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "dummy";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "dummy";

import {
  DEFAULT_TEMPLATES,
  RENT_REMINDER_SWITCHES,
  decideStage,
  easternParts,
  lateFeeFor,
  manualOwed,
  mergeTemplates,
  renderReminder,
  templateProblem,
  webhookLedgerStage,
  withinQuietHoursAllowed,
  type RentalBillingState,
} from "../src/lib/rent-reminders";
import { recordManualRentPayment, runRentReminders, waiveRentLateFee, type StripeBillingSnapshot } from "../src/lib/rent-reminders.server";
import { sendFailedPaymentText } from "../src/lib/failed-payment-notice.server";
import { AUTOMATIONS, isAutomationOn } from "../src/lib/automation-catalog";

const INVOICE_URL = "https://invoice.stripe.com/i/acct_1TwBPNGsNNO50lXb/live_abc123?s=ap";
const CARD_URL = "https://billing.stripe.com/p/session/live_card123";
const BUY_LINK = "https://buy.stripe.com/aFaaEXds420K6iaeZ583C00";
const R_STRIPE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const R_MANUAL = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const APP_S = "11111111-1111-4111-8111-111111111111";
const APP_M = "22222222-2222-4222-8222-222222222222";

// EST (UTC-5) after Nov 1, 2026.
const at = (isoDate: string, hourEt: number, min = 0) =>
  new Date(Date.UTC(+isoDate.slice(0, 4), +isoDate.slice(5, 7) - 1, +isoDate.slice(8, 10), hourEt + 5, min));

type Row = Record<string, any>;
const UNIQUE: Record<string, string[]> = {
  rent_reminder_log: ["rental_id", "due_date", "stage", "channel"],
  rent_late_fee_waivers: ["rental_id", "due_date"],
  payments: ["stripe_invoice_id"],
};
function fakeDb(seed: Record<string, Row[]>) {
  const state: Record<string, Row[]> = JSON.parse(JSON.stringify(seed));
  let nextId = 1;
  function from(table: string) {
    state[table] ??= [];
    let op: "select" | "insert" | "upsert" | "update" = "select";
    let patch: Row | null = null;
    let inserted: Row | Row[] | null = null;
    let single = false;
    const filters: ((r: Row) => boolean)[] = [];
    const b: any = {
      select() { return b; },
      insert(r: Row) { op = "insert"; inserted = r; return b; },
      upsert(r: Row) { op = "upsert"; inserted = r; return b; },
      update(p: Row) { op = "update"; patch = p; return b; },
      eq(c: string, v: any) { filters.push((r) => r[c] === v); return b; },
      in(c: string, vs: any[]) { filters.push((r) => vs.includes(r[c])); return b; },
      maybeSingle() { single = true; return b; },
      single() { single = true; return b; },
      limit() { return b; }, order() { return b; },
      then(res: any, rej: any) { return Promise.resolve().then(run).then(res, rej); },
    };
    function same(a: Row, r: Row) {
      const cols = UNIQUE[table];
      return !!cols && cols.every((c) => a[c] != null && a[c] === r[c]);
    }
    function run() {
      const match = () => state[table].filter((r) => filters.every((f) => f(r)));
      if (op === "insert" || op === "upsert") {
        const incoming = Array.isArray(inserted) ? inserted : [inserted!];
        const out: Row[] = [];
        for (const r of incoming) {
          const hit = state[table].find((x) => same(x, r));
          if (hit && op === "insert") return { data: null, error: { code: "23505", message: "duplicate key" } };
          if (hit) { Object.assign(hit, r); out.push(hit); continue; }
          const row = { id: `gen-${nextId++}`, ...r };
          state[table].push(row);
          out.push(row);
        }
        return { data: single ? out[0] : out, error: null };
      }
      if (op === "update") {
        const hit = match();
        for (const r of hit) Object.assign(r, patch);
        return { data: hit, error: null };
      }
      const hit = match();
      return single ? { data: hit[0] ?? null, error: null } : { data: hit, error: null };
    }
    return b;
  }
  return { from, rpc: async () => ({ data: null, error: null }), _state: state };
}

const switches = (on: string[]) => ({
  key: "automation_controls",
  value: { off: {}, on: Object.fromEntries(on.map((k) => [k, { at: "2026-11-09", by: "test" }])) },
});

function seed(opts: { on?: string[]; manualDue?: string; manualPaid?: number } = {}) {
  return {
    app_settings: opts.on ? [switches(opts.on)] : [],
    rentals: [
      { id: R_STRIPE, application_id: APP_S, vehicle_id: "veh-1", status: "active", weekly_rate: 350, next_payment_due: "2026-11-09", stripe_subscription_id: "sub_live", stripe_customer_id: "cus_1" },
      { id: R_MANUAL, application_id: APP_M, vehicle_id: "veh-2", status: "active", weekly_rate: 350, next_payment_due: opts.manualDue ?? "2026-11-16", stripe_subscription_id: null, stripe_customer_id: null },
    ],
    applications: [
      { id: APP_S, full_name: "Regina Littles", phone: "3212870986", email: "regina@example.com" },
      { id: APP_M, full_name: "Marcus Hill", phone: "3215550000", email: "marcus@example.com" },
    ],
    payments: opts.manualPaid ? [{ id: "p0", rental_id: R_MANUAL, due_date: opts.manualDue ?? "2026-11-16", status: "paid", type: "rent", amount: opts.manualPaid }] : [],
    rent_reminder_log: [],
    rent_late_fee_waivers: [],
  };
}

const failedSnap = (createdOn: string, url: string | null = INVOICE_URL): StripeBillingSnapshot => ({
  nextChargeOn: "2026-11-16",
  failedInvoices: [{ id: "in_failed", hostedUrl: url, amountDue: 350, createdOn, createdAt: Math.floor(at(createdOn, 10).getTime() / 1000) }],
});
/** Overdue switch turned on well before the failures in these tests. */
const E = { overdueEnabledAt: "2026-11-01T00:00:00Z" };
const okSnap = (nextChargeOn: string): StripeBillingSnapshot => ({ nextChargeOn, failedInvoices: [] });

function spies() {
  const sms: any[] = [];
  const email: any[] = [];
  return {
    sms, email,
    deps: (now: Date, snap: StripeBillingSnapshot | null) => ({
      now,
      stripeSnapshot: async () => snap,
      sendSms: async (a: any) => { sms.push(a); return { ok: true }; },
      sendEmail: async (a: any) => { email.push(a); return { ok: true }; },
    }),
  };
}

const base = (over: Partial<RentalBillingState> = {}): RentalBillingState => ({
  rentalId: R_STRIPE, applicationId: APP_S, firstName: "Regina Littles", phone: "3212870986", email: "r@example.com",
  weeklyRate: 350, mode: "stripe", dueDate: "2026-11-09", owing: false, rentOwed: 0, ...over,
});

describe("stage schedule", () => {
  test("day before due: due_tomorrow from 10 AM, only when not owing", () => {
    expect(decideStage(base({ dueDate: "2026-11-10" }), at("2026-11-09", 9), new Set())).toMatchObject({ send: false, reason: "too_early" });
    expect(decideStage(base({ dueDate: "2026-11-10" }), at("2026-11-09", 10), new Set())).toMatchObject({ send: true, stage: "due_tomorrow" });
    expect(decideStage(base({ dueDate: "2026-11-10", mode: "manual" }), at("2026-11-09", 15), new Set())).toMatchObject({ send: true, stage: "due_tomorrow" });
    expect(decideStage(base({ dueDate: "2026-11-12" }), at("2026-11-09", 15), new Set())).toMatchObject({ send: false, reason: "not_due_yet" });
  });
  test("due day: manual gets due_today from 8 AM, overdue at 6 PM if still unpaid", () => {
    const m = base({ mode: "manual", owing: true, rentOwed: 350 });
    expect(decideStage(m, at("2026-11-09", 7), new Set())).toMatchObject({ send: false });
    expect(decideStage(m, at("2026-11-09", 8), new Set())).toMatchObject({ send: true, stage: "due_today" });
    expect(decideStage(m, at("2026-11-09", 17, 59), new Set(["due_today"]))).toMatchObject({ send: false, reason: "already_sent" });
    expect(decideStage(m, at("2026-11-09", 18), new Set(["due_today"]), E)).toMatchObject({ send: true, stage: "overdue" });
  });
  test("due day, paid: nothing", () => {
    expect(decideStage(base({ mode: "manual", owing: false }), at("2026-11-09", 12), new Set())).toMatchObject({ send: false, reason: "paid_or_pending" });
    expect(decideStage(base({ owing: false }), at("2026-11-09", 12), new Set())).toMatchObject({ send: false });
  });
  test("autopay failed charge: overdue right away on the due day (no due_today)", () => {
    expect(decideStage(base({ owing: true, rentOwed: 350, invoiceUrl: INVOICE_URL }), at("2026-11-09", 12), new Set(), E)).toMatchObject({ send: true, stage: "overdue" });
  });
  test("after the due day: overdue first (recent catch-up), then one daily notice from 10 AM", () => {
    const s = base({ owing: true, rentOwed: 350, invoiceUrl: INVOICE_URL });
    expect(decideStage(s, at("2026-11-11", 8), new Set(), E)).toMatchObject({ send: true, stage: "overdue" });
    expect(decideStage(s, at("2026-11-11", 9), new Set(["overdue"]))).toMatchObject({ send: false, reason: "too_early" });
    expect(decideStage(s, at("2026-11-11", 10), new Set(["overdue"]))).toMatchObject({ send: true, stage: "daily", ledgerStage: "daily:2026-11-11" });
    expect(decideStage(s, at("2026-11-11", 15), new Set(["overdue", "daily:2026-11-11"]))).toMatchObject({ send: false, reason: "already_sent" });
    expect(decideStage(s, at("2026-11-12", 10), new Set(["overdue", "daily:2026-11-11"]))).toMatchObject({ send: true, ledgerStage: "daily:2026-11-12" });
  });
  test("quiet hours: texts only 8 AM to 9 PM ET", () => {
    expect(withinQuietHoursAllowed(7)).toBe(false);
    expect(withinQuietHoursAllowed(8)).toBe(true);
    expect(withinQuietHoursAllowed(20)).toBe(true);
    expect(withinQuietHoursAllowed(21)).toBe(false);
    expect(easternParts(at("2026-11-09", 23))).toEqual({ date: "2026-11-09", hour: 23 });
  });
});

describe("late fees", () => {
  test("$50 per day from the day after the due date", () => {
    expect(lateFeeFor({ dueDate: "2026-11-09", today: "2026-11-09" }).fee).toBe(0);
    expect(lateFeeFor({ dueDate: "2026-11-09", today: "2026-11-10" }).fee).toBe(50);
    expect(lateFeeFor({ dueDate: "2026-11-09", today: "2026-11-13" })).toMatchObject({ daysLate: 4, fee: 200 });
  });
  test("a whole-week waiver zeroes it; a through-date waiver waives only those days", () => {
    expect(lateFeeFor({ dueDate: "2026-11-09", today: "2026-11-13", waivers: [{ dueDate: "2026-11-09", waivedThrough: null }] })).toMatchObject({ fee: 0, waived: true });
    expect(lateFeeFor({ dueDate: "2026-11-09", today: "2026-11-13", waivers: [{ dueDate: "2026-11-09", waivedThrough: "2026-11-11" }] })).toMatchObject({ feeDays: 2, fee: 100 });
    expect(lateFeeFor({ dueDate: "2026-11-09", today: "2026-11-13", waivers: [{ dueDate: "2026-11-02", waivedThrough: null }] }).fee).toBe(200);
  });
  test("autopay daily: the invoice amount with its link, late fees stated as owed separately (no total the link cannot collect)", () => {
    const r = renderReminder(DEFAULT_TEMPLATES, "daily", base({ owing: true, rentOwed: 350, invoiceUrl: INVOICE_URL }), at("2026-11-12", 10))!;
    expect(r.sms).toContain("3 day(s) late");
    expect(r.sms).toContain("Pay this week's $350 invoice here: " + INVOICE_URL);
    expect(r.sms).toContain("Late fees of $150 ($50/day per your rental agreement) are owed separately and are not part of this invoice.");
    expect(r.sms).not.toContain("$500");
    expect(r.subject).toBe("Rent Past Due: $350 Invoice");
    expect(r.email).toContain("owed separately");
  });
  test("manual daily: the balance includes the late fees", () => {
    const r = renderReminder(DEFAULT_TEMPLATES, "daily", base({ mode: "manual", owing: true, rentOwed: 350 }), at("2026-11-12", 10))!;
    expect(r.sms).toContain("You owe $500.");
    expect(r.sms).toContain("$150 in late fees");
    expect(r.subject).toBe("Past Due Balance: $500");
  });
  test("overdue notices state the $50/day fee from day one", () => {
    for (const mode of ["stripe", "manual"] as const) {
      const r = renderReminder(DEFAULT_TEMPLATES, "overdue", base({ mode, owing: true, rentOwed: 350, invoiceUrl: INVOICE_URL }), at("2026-11-09", 18))!;
      expect(r.sms).toContain("$50/day late fee");
      expect(r.email).toContain("$50/day late fee");
      expect(r.subject).not.toMatch(/late fee/i);
    }
  });
  test("a whole-week waiver removes every late-fee line and amount, in every stage", () => {
    const waivers = [{ dueDate: "2026-11-09", waivedThrough: null }];
    for (const mode of ["stripe", "manual"] as const) {
      for (const [stage, day] of [["overdue", "2026-11-09"], ["daily", "2026-11-12"], ["due_today", "2026-11-09"]] as const) {
        const r = renderReminder(DEFAULT_TEMPLATES, stage, base({ mode, owing: true, rentOwed: 350, invoiceUrl: INVOICE_URL, waivers }), at(day, 18));
        if (!r) continue;
        for (const text of [r.sms, r.subject, r.email]) expect(text).not.toMatch(/late fee/i);
        expect(r.sms).not.toContain("$500");
      }
    }
    const m = renderReminder(DEFAULT_TEMPLATES, "daily", base({ mode: "manual", owing: true, rentOwed: 350, waivers }), at("2026-11-12", 10))!;
    expect(m.sms).toContain("You owe $350.");
    expect(m.subject).toBe("Past Due Balance: $350");
  });
  test("a waiver through a date keeps the line only while a fee is owed", () => {
    const through = [{ dueDate: "2026-11-09", waivedThrough: "2026-11-11" }];
    const early = renderReminder(DEFAULT_TEMPLATES, "daily", base({ owing: true, rentOwed: 350, invoiceUrl: INVOICE_URL, waivers: through }), at("2026-11-11", 10))!;
    expect(early.sms).not.toMatch(/late fee/i);
    const later = renderReminder(DEFAULT_TEMPLATES, "daily", base({ owing: true, rentOwed: 350, invoiceUrl: INVOICE_URL, waivers: through }), at("2026-11-13", 10))!;
    expect(later.sms).toContain("Late fees of $100");
  });
  test("waiver saves who and when, and re-waiving updates the same week", async () => {
    const db = fakeDb(seed());
    await waiveRentLateFee(db, { rentalId: R_STRIPE, dueDate: "2026-11-09", waivedThrough: null, reason: "Per Dolmar", amountWaived: 100 }, { userId: "u1", email: "dolmarcross@gmail.com" });
    await waiveRentLateFee(db, { rentalId: R_STRIPE, dueDate: "2026-11-09", waivedThrough: "2026-11-10", reason: "Changed", amountWaived: 50 }, { userId: "u1", email: "dolmarcross@gmail.com" });
    expect(db._state.rent_late_fee_waivers).toHaveLength(1);
    expect(db._state.rent_late_fee_waivers[0]).toMatchObject({ waived_by: "u1", waived_by_email: "dolmarcross@gmail.com", waived_through: "2026-11-10" });
    await expect(waiveRentLateFee(db, { rentalId: R_STRIPE, dueDate: "2026-11-09", waivedThrough: null, reason: " ", amountWaived: null }, { userId: "u1", email: null })).rejects.toThrow();
  });
});

describe("wording and links", () => {
  test("autopay due-tomorrow: a short heads-up the card on file is charged tomorrow, with no link of any kind", () => {
    const r = renderReminder(DEFAULT_TEMPLATES, "due_tomorrow", base({ dueDate: "2026-11-10", invoiceUrl: INVOICE_URL }), at("2026-11-09", 10))!;
    expect(r.sms).toBe("Hi Regina, this is REAL RENTALS. Heads up: your card on file will be charged $350 tomorrow (Tue, Nov 10) for your weekly rental. Nothing else to do. Reply STOP to opt out.");
    expect(r.link).toBeNull();
    for (const text of [r.sms, r.email, r.subject]) {
      expect(text).not.toContain("http");
      expect(text).not.toMatch(/cash app|venmo|zelle|reply to this message and we will send/i);
    }
  });
  test("autopay overdue uses only the failed invoice's own page; no page = no message", () => {
    const r = renderReminder(DEFAULT_TEMPLATES, "overdue", base({ owing: true, rentOwed: 350, invoiceUrl: INVOICE_URL }), at("2026-11-09", 12))!;
    expect(r.sms).toContain(INVOICE_URL);
    expect(r.sms).toContain("use only this link");
    expect(renderReminder(DEFAULT_TEMPLATES, "overdue", base({ owing: true, invoiceUrl: BUY_LINK }), at("2026-11-09", 12))).toBeNull();
    expect(renderReminder(DEFAULT_TEMPLATES, "overdue", base({ owing: true, invoiceUrl: null }), at("2026-11-09", 12))).toBeNull();
  });
  test("manual payers get amount, due date and their payment instructions, no link", () => {
    const t = mergeTemplates({ manualInstructions: "Cash App $RealRentals or Zelle pay@drivereal.com." });
    const r = renderReminder(t, "due_tomorrow", base({ mode: "manual", dueDate: "2026-11-10" }), at("2026-11-09", 10))!;
    expect(r.sms).toContain("$350 is due tomorrow");
    expect(r.sms).toContain("Cash App $RealRentals");
    expect(r.link).toBeNull();
    const s = renderReminder(t, "due_tomorrow", base({ dueDate: "2026-11-10" }), at("2026-11-09", 10))!;
    expect(s.sms).not.toContain("Cash App");
  });
  test("a Stripe template that offers another way to pay cannot be saved", () => {
    const ok = DEFAULT_TEMPLATES.stripe.overdue;
    expect(templateProblem("stripe", "overdue", ok)).toBeNull();
    expect(templateProblem("stripe", "overdue", { ...ok, sms: ok.sms + " Or Cash App $realrentals" })).not.toBeNull();
    expect(templateProblem("stripe", "overdue", { ...ok, email: ok.email + " Zelle works too." })).not.toBeNull();
    expect(templateProblem("stripe", "overdue", { ...ok, sms: ok.sms + " " + BUY_LINK })).not.toBeNull();
    expect(templateProblem("stripe", "overdue", { ...ok, sms: ok.sms + " {{payment_instructions}}" })).not.toBeNull();
    expect(templateProblem("stripe", "overdue", { ...ok, sms: ok.sms.replace("{{link}}", "") })).not.toBeNull();
    expect(templateProblem("stripe", "overdue", { ...ok, sms: "Pay {{link}}" })).toBe("Text Must Say Reply STOP To Opt Out");
    // Late fees only through {{late_fee_line}} (so a waiver can drop them).
    expect(templateProblem("stripe", "overdue", { ...ok, sms: ok.sms.replace("{{late_fee_line}}", " A $50 late fee applies.") })).toBe("Use {{late_fee_line}} For Late Fees");
    expect(templateProblem("manual", "daily", { ...DEFAULT_TEMPLATES.manual.daily, sms: "You owe {{balance}} plus {{late_fee}}. Reply STOP" })).toBe("Use {{late_fee_line}} For Late Fees");
    // Stripe: no total the invoice link cannot collect, no link on the heads-up, no billing-portal link.
    expect(templateProblem("stripe", "daily", { ...DEFAULT_TEMPLATES.stripe.daily, sms: "You owe {{balance}}: {{link}} Reply STOP" })).not.toBeNull();
    expect(templateProblem("stripe", "due_tomorrow", { ...DEFAULT_TEMPLATES.stripe.due_tomorrow, sms: "Charged tomorrow {{link}} Reply STOP" })).not.toBeNull();
    expect(templateProblem("stripe", "due_tomorrow", { ...DEFAULT_TEMPLATES.stripe.due_tomorrow, sms: "Update card " + CARD_URL + " Reply STOP" })).not.toBeNull();
    for (const mode of ["stripe", "manual"] as const) for (const st of ["due_tomorrow", "due_today", "overdue", "daily"] as const) {
      expect(templateProblem(mode, st, DEFAULT_TEMPLATES[mode][st])).toBeNull();
    }
  });
  test("a stored bad template falls back to the default", () => {
    const t = mergeTemplates({ stripe: { overdue: { sms: "Venmo me {{link}} Reply STOP", subject: "x", email: "y" } } });
    expect(t.stripe.overdue).toEqual(DEFAULT_TEMPLATES.stripe.overdue);
  });
});

describe("switches", () => {
  test("four stages, all OFF by default", () => {
    for (const key of RENT_REMINDER_SWITCHES) {
      const def = AUTOMATIONS.find((a) => a.key === key);
      expect(def).toBeTruthy();
      expect(def!.defaultOn).toBe(false);
      expect(isAutomationOn({ off: {}, on: {} }, key)).toBe(false);
    }
  });
  test("with every stage off the runner reads nothing else and sends nothing", async () => {
    const db = fakeDb(seed());
    const sp = spies();
    let stripeCalls = 0;
    const deps = { ...sp.deps(at("2026-11-09", 12), failedSnap("2026-11-09")), stripeSnapshot: async () => { stripeCalls++; return null; } };
    const run = await runRentReminders(db, deps);
    expect(run).toMatchObject({ ran: false, reason: "all_off" });
    expect(stripeCalls).toBe(0);
    expect(sp.sms.length + sp.email.length).toBe(0);
  });
  test("a stage that is off is skipped while another is on", async () => {
    const db = fakeDb(seed({ on: ["rent_reminder_due_tomorrow"] }));
    const sp = spies();
    const run = await runRentReminders(db, sp.deps(at("2026-11-09", 12), failedSnap("2026-11-09")));
    expect(run.ran).toBe(true);
    expect(sp.sms).toHaveLength(0);
    expect(run.skipped.stage_off).toBeGreaterThan(0);
  });
});

describe("runner", () => {
  const ALL = [...RENT_REMINDER_SWITCHES];
  test("sends one text and one email per stage, and a second run sends nothing", async () => {
    const db = fakeDb(seed({ on: ALL }));
    const sp = spies();
    const now = at("2026-11-09", 12);
    await runRentReminders(db, sp.deps(now, failedSnap("2026-11-09")));
    expect(sp.sms.map((s) => s.kind)).toEqual(["rent_reminder_overdue"]);
    expect(sp.email.map((e) => e.workflow)).toEqual(["rent_reminder_overdue"]);
    expect(sp.sms[0].body).toContain(INVOICE_URL);
    expect(sp.sms[0].requireConsent).toBe(false);
    expect(sp.email[0].link).toBe(INVOICE_URL);
    await runRentReminders(db, sp.deps(at("2026-11-09", 13), failedSnap("2026-11-09")));
    expect(sp.sms).toHaveLength(1);
    expect(sp.email).toHaveLength(1);
    expect(db._state.rent_reminder_log.filter((r: Row) => r.rental_id === R_STRIPE)).toHaveLength(2);
  });
  test("two runs at once still send once (the ledger row is the claim)", async () => {
    const db = fakeDb(seed({ on: ALL }));
    const sp = spies();
    const now = at("2026-11-10", 11);
    await Promise.all([runRentReminders(db, sp.deps(now, failedSnap("2026-11-09"))), runRentReminders(db, sp.deps(now, failedSnap("2026-11-09")))]);
    const stripeSms = sp.sms.filter((s) => s.rentalId === R_STRIPE);
    expect(stripeSms).toHaveLength(1);
  });
  test("overnight: email may go out, the text waits for 8 AM", async () => {
    const db = fakeDb(seed({ on: ALL }));
    const sp = spies();
    await runRentReminders(db, sp.deps(at("2026-11-10", 6), failedSnap("2026-11-09")));
    expect(sp.sms.filter((s) => s.rentalId === R_STRIPE)).toHaveLength(0);
    expect(sp.email.filter((e) => e.to === "regina@example.com")).toHaveLength(1);
    await runRentReminders(db, sp.deps(at("2026-11-10", 8), failedSnap("2026-11-09")));
    expect(sp.sms.filter((s) => s.rentalId === R_STRIPE)).toHaveLength(1);
  });
  test("autopay with no safe invoice link sends nothing for that stage", async () => {
    const db = fakeDb(seed({ on: ALL }));
    const sp = spies();
    const run = await runRentReminders(db, sp.deps(at("2026-11-09", 12), failedSnap("2026-11-09", BUY_LINK)));
    expect(sp.sms.filter((s) => s.rentalId === R_STRIPE)).toHaveLength(0);
    expect(sp.email.filter((e) => e.to === "regina@example.com")).toHaveLength(0);
    expect(run.skipped.no_safe_link).toBeGreaterThan(0);
    expect(db._state.rent_reminder_log.filter((r: Row) => r.rental_id === R_STRIPE)).toHaveLength(0);
  });
  test("autopay day-before heads-up carries no link and makes no Stripe card session", async () => {
    const db = fakeDb(seed({ on: ALL }));
    const sp = spies();
    await runRentReminders(db, sp.deps(at("2026-11-15", 10), okSnap("2026-11-16")));
    const t = sp.sms.find((s) => s.rentalId === R_STRIPE);
    expect(t.kind).toBe("rent_reminder_due_tomorrow");
    expect(t.body).toContain("card on file will be charged $350 tomorrow");
    expect(t.body).not.toContain("http");
    const e = sp.email.find((x) => x.to === "regina@example.com");
    expect(e.link).toBeNull();
    expect(readFileSync(new URL("../src/lib/rent-reminders.server.ts", import.meta.url), "utf8")).not.toContain("billingPortal");
  });
  test("manual payer: due tomorrow, due today, then Record Payment stops the rest", async () => {
    const db = fakeDb(seed({ on: ALL, manualDue: "2026-11-10" }));
    const sp = spies();
    const snap = okSnap("2026-11-16");
    await runRentReminders(db, sp.deps(at("2026-11-09", 10), snap));
    await runRentReminders(db, sp.deps(at("2026-11-10", 8), snap));
    const manualKinds = () => sp.sms.filter((s) => s.rentalId === R_MANUAL).map((s) => s.kind);
    expect(manualKinds()).toEqual(["rent_reminder_due_tomorrow", "rent_reminder_due_today"]);
    const res = await recordManualRentPayment(db, { rentalId: R_MANUAL, amount: 350, method: "Cash App", reference: "abc", paidOn: "2026-11-10" });
    expect(res).toMatchObject({ covered: true, nextDue: "2026-11-17" });
    expect(db._state.rentals.find((r: Row) => r.id === R_MANUAL).next_payment_due).toBe("2026-11-17");
    expect(db._state.payments.find((p: Row) => p.id === res.paymentId)).toMatchObject({ status: "paid", payment_method: "Cash App", notes: "abc", due_date: "2026-11-10", type: "rent" });
    await runRentReminders(db, sp.deps(at("2026-11-10", 18), snap));
    await runRentReminders(db, sp.deps(at("2026-11-11", 10), snap));
    expect(manualKinds()).toEqual(["rent_reminder_due_tomorrow", "rent_reminder_due_today"]);
  });
  test("a partial manual payment keeps the reminders going with what is left", async () => {
    const db = fakeDb(seed({ on: ALL, manualDue: "2026-11-09", manualPaid: 200 }));
    const sp = spies();
    await runRentReminders(db, sp.deps(at("2026-11-09", 18), okSnap("2026-11-16")));
    const t = sp.sms.find((s) => s.rentalId === R_MANUAL);
    expect(t.kind).toBe("rent_reminder_overdue");
    expect(manualOwed({ dueDate: "2026-11-09", today: "2026-11-09", weeklyRate: 350, paidTowardDue: 200 })).toMatchObject({ owing: true, rentOwed: 150 });
  });
  test("Record Payment is refused for Stripe renters", async () => {
    const db = fakeDb(seed());
    await expect(recordManualRentPayment(db, { rentalId: R_STRIPE, amount: 350, method: "Zelle", reference: null, paidOn: "2026-11-09" })).rejects.toThrow(/Stripe/);
    expect(db._state.payments).toHaveLength(0);
  });
});

describe("one schedule with the Stripe failed-payment text", () => {
  const invoice = { id: "in_failed", status: "open", hosted_invoice_url: INVOICE_URL, created: Math.floor(at("2026-11-09", 12).getTime() / 1000) };
  const input = { invoice, amount: 350, rentalId: R_STRIPE, applicationId: APP_S, firstName: "Regina", phone: "3212870986" };
  test("the webhook text claims the overdue slot, so the scheduler does not text again", async () => {
    const db = fakeDb(seed({ on: ["payment_failed_text", ...RENT_REMINDER_SWITCHES] }));
    const calls: any[] = [];
    const send = async (a: any) => { calls.push(a); return { ok: true }; };
    const now = at("2026-11-09", 12, 43);
    expect(await sendFailedPaymentText(db, input, { sendSms: send, now })).toEqual({ sent: true });
    expect(calls[0].body).toContain("$50/day late fee"); // Overdue template is on
    const sp = spies();
    await runRentReminders(db, sp.deps(at("2026-11-09", 13), failedSnap("2026-11-09")));
    expect(sp.sms.filter((s) => s.rentalId === R_STRIPE)).toHaveLength(0);
    // A retry later the same day: nothing more that day (one text a day).
    expect(await sendFailedPaymentText(db, input, { sendSms: send, now: at("2026-11-09", 15) })).toMatchObject({ sent: false, reason: "already_sent" });
    // The next day a retry takes that day's daily slot, then nothing more that day.
    expect(await sendFailedPaymentText(db, input, { sendSms: send, now: at("2026-11-10", 15) })).toEqual({ sent: true });
    expect(await sendFailedPaymentText(db, input, { sendSms: send, now: at("2026-11-10", 16) })).toMatchObject({ sent: false, reason: "already_sent" });
    expect(calls).toHaveLength(2);
  });
  test("with the rent reminders off, the failed text keeps its current wording", async () => {
    const db = fakeDb(seed({ on: ["payment_failed_text"] }));
    const calls: any[] = [];
    await sendFailedPaymentText(db, input, { sendSms: async (a: any) => { calls.push(a); return { ok: true }; }, now: at("2026-11-09", 12) });
    expect(calls).toHaveLength(1);
    expect(calls[0].body).not.toContain("late fee");
    expect(calls[0].body).toContain(INVOICE_URL);
  });
  test("before the ledger exists (migration not applied) the text behaves exactly as before", async () => {
    const db = fakeDb(seed({ on: ["payment_failed_text"] }));
    const from = db.from;
    (db as any).from = (t: string) => (t === "rent_reminder_log"
      ? { select: () => ({ eq: () => ({ eq: () => ({ eq: async () => ({ data: null, error: { code: "42P01", message: "missing" } }) }) }) }) }
      : from(t));
    const calls: any[] = [];
    const r = await sendFailedPaymentText(db, input, { sendSms: async (a: any) => { calls.push(a); return { ok: true }; }, now: at("2026-11-09", 12) });
    expect(r).toEqual({ sent: true });
    expect(calls).toHaveLength(1);
  });
  test("webhookLedgerStage: overdue first, then one daily slot per day, never a second text the same day", () => {
    expect(webhookLedgerStage(new Set(), at("2026-11-09", 12))).toBe("overdue");
    expect(webhookLedgerStage(new Set(["overdue"]), at("2026-11-09", 12))).toBe("daily:2026-11-09");
    expect(webhookLedgerStage(new Set(["overdue", "daily:2026-11-09"]), at("2026-11-09", 12))).toBeNull();
    expect(webhookLedgerStage(new Map([["overdue", "2026-11-09"]]), at("2026-11-09", 19))).toBeNull();
    expect(webhookLedgerStage(new Map([["overdue", "2026-11-08"]]), at("2026-11-09", 19))).toBe("daily:2026-11-09");
    expect(webhookLedgerStage(new Map(), at("2026-11-09", 19), "2026-11-09")).toBeNull();
    // Emails: a genuinely new Stripe attempt the same day still gets its one email.
    expect(webhookLedgerStage(new Map([["overdue", "2026-11-09"]]), at("2026-11-09", 19), null, { onePerDay: false })).toBe("daily:2026-11-09");
    expect(webhookLedgerStage(new Map([["overdue", "2026-11-09"], ["daily:2026-11-09", "2026-11-09"]]), at("2026-11-09", 20), null, { onePerDay: false })).toBeNull();
  });
});

describe("no duplicates and no catch-up blast", () => {
  const ALL = [...RENT_REMINDER_SWITCHES, "payment_failed_text"];
  const seedAt = (enabledAt: string, extra: Record<string, Row[]> = {}) => {
    const sd: any = seed({ on: ALL });
    sd.app_settings[0].value.on.rent_reminder_overdue.at = enabledAt;
    return { ...sd, ...extra };
  };
  const invoiceOf = (createdOn: string, hour = 17) => ({ id: "in_failed", status: "open", hosted_invoice_url: INVOICE_URL, created: Math.floor(at(createdOn, hour, 41).getTime() / 1000) });
  const snapOf = (createdOn: string, hour = 17): StripeBillingSnapshot => ({
    nextChargeOn: "2026-11-16", failedInvoices: [{ id: "in_failed", hostedUrl: INVOICE_URL, amountDue: 350, createdOn, createdAt: Math.floor(at(createdOn, hour, 41).getTime() / 1000) }],
  });
  const stripeTexts = (sp: ReturnType<typeof spies>) => sp.sms.filter((s) => s.rentalId === R_STRIPE);

  test("daily never goes out the same day as the overdue notice", async () => {
    const db = fakeDb(seedAt("2026-11-01T00:00:00Z"));
    const sp = spies();
    for (const h of [11, 12, 15, 20]) await runRentReminders(db, sp.deps(at("2026-11-10", h, 5), snapOf("2026-11-09")));
    expect(stripeTexts(sp).map((s) => s.kind)).toEqual(["rent_reminder_overdue"]);
    for (const h of [9, 10, 14]) await runRentReminders(db, sp.deps(at("2026-11-11", h, 5), snapOf("2026-11-09")));
    expect(stripeTexts(sp).map((s) => s.kind)).toEqual(["rent_reminder_overdue", "rent_reminder_daily"]);
  });
  test("a Payment Failed Text in the evening: no daily that evening, the daily starts the next morning", async () => {
    const db = fakeDb(seedAt("2026-11-09T19:43:52.322Z"));
    const sp = spies();
    const calls: any[] = [];
    // Damon-style: invoice from 11/5, retried and failing at 7:42 PM on 11/9.
    await runRentReminders(db, sp.deps(at("2026-11-09", 16, 5), snapOf("2026-11-05")));
    expect(stripeTexts(sp)).toHaveLength(0); // no catch-up for a failure before the switch went on
    const r = await sendFailedPaymentText(db, { invoice: invoiceOf("2026-11-05"), amount: 350, rentalId: R_STRIPE, applicationId: APP_S, firstName: "Damon", phone: "3212870986" },
      { now: at("2026-11-09", 19, 42), sendSms: async (a: any) => { calls.push(a); return { ok: true }; } });
    expect(r).toEqual({ sent: true });
    for (const h of [20, 21]) await runRentReminders(db, sp.deps(at("2026-11-09", h, 5), snapOf("2026-11-05")));
    expect(stripeTexts(sp)).toHaveLength(0);
    await runRentReminders(db, sp.deps(at("2026-11-10", 10, 5), snapOf("2026-11-05")));
    expect(stripeTexts(sp).map((s) => s.kind)).toEqual(["rent_reminder_daily"]);
    expect(calls).toHaveLength(1);
  });
  test("no catch-up blast: an invoice that failed before Overdue went on gets no overdue notice, only next-day dailies", async () => {
    const db = fakeDb(seedAt("2026-11-09T19:43:52.322Z"));
    const sp = spies();
    for (const h of [15, 16, 18, 20]) await runRentReminders(db, sp.deps(at("2026-11-09", h, 5), snapOf("2026-11-09", 10)));
    expect(stripeTexts(sp)).toHaveLength(0);
    expect(sp.email.filter((e) => e.to === "regina@example.com")).toHaveLength(0);
    await runRentReminders(db, sp.deps(at("2026-11-10", 10, 5), snapOf("2026-11-09", 10)));
    expect(stripeTexts(sp).map((s) => s.kind)).toEqual(["rent_reminder_daily"]);
  });
  test("no catch-up for a failure older than the catch-up window, even after the switch went on", async () => {
    const db = fakeDb(seedAt("2026-11-01T00:00:00Z"));
    const sp = spies();
    await runRentReminders(db, sp.deps(at("2026-11-09", 12, 5), snapOf("2026-11-05")));
    const kinds = stripeTexts(sp).map((s) => s.kind);
    expect(kinds).not.toContain("rent_reminder_overdue");
  });
  test("a staff text with the same invoice link counts as the overdue notice (no re-notify that day)", async () => {
    const db = fakeDb(seedAt("2026-11-01T00:00:00Z", {
      outbound_messages: [{ id: "m1", channel: "sms", rental_id: R_STRIPE, to_address: "+13212870986", status: "sent", kind: "manual",
        body: "Hi Regina, please pay this week's invoice here: " + INVOICE_URL, created_at: at("2026-11-09", 13, 27).toISOString() }],
    }));
    const sp = spies();
    for (const h of [14, 15, 18]) await runRentReminders(db, sp.deps(at("2026-11-09", h, 5), snapOf("2026-11-09", 10)));
    expect(stripeTexts(sp)).toHaveLength(0);
    expect(sp.email.filter((e) => e.to === "regina@example.com")).toHaveLength(0);
    const calls: any[] = [];
    const r = await sendFailedPaymentText(db, { invoice: invoiceOf("2026-11-09", 10), amount: 350, rentalId: R_STRIPE, applicationId: APP_S, firstName: "Regina", phone: "3212870986" },
      { now: at("2026-11-09", 16), sendSms: async (a: any) => { calls.push(a); return { ok: true }; } });
    expect(r).toMatchObject({ sent: false, reason: "already_sent" });
    await runRentReminders(db, sp.deps(at("2026-11-10", 10, 5), snapOf("2026-11-09", 10)));
    expect(stripeTexts(sp).map((s) => s.kind)).toEqual(["rent_reminder_daily"]);
  });
  test("a text about a different invoice (yesterday) does not count as this invoice's notice", async () => {
    const db = fakeDb(seedAt("2026-11-01T00:00:00Z", {
      outbound_messages: [{ id: "m1", channel: "sms", rental_id: R_STRIPE, to_address: "+13212870986", status: "sent", kind: "payment_failed",
        body: "Pay here: https://invoice.stripe.com/i/acct_1TwBPNGsNNO50lXb/live_OTHER?s=ap", created_at: at("2026-11-08", 9).toISOString() }],
    }));
    const sp = spies();
    await runRentReminders(db, sp.deps(at("2026-11-09", 12, 5), snapOf("2026-11-09", 10)));
    expect(stripeTexts(sp).map((s) => s.kind)).toEqual(["rent_reminder_overdue"]);
  });
  test("a waived week: the overdue and daily texts never mention a late fee", async () => {
    const db = fakeDb(seedAt("2026-11-01T00:00:00Z", { rent_late_fee_waivers: [{ id: "w1", rental_id: R_STRIPE, due_date: "2026-11-09", waived_through: null }] }));
    const sp = spies();
    await runRentReminders(db, sp.deps(at("2026-11-09", 12, 5), snapOf("2026-11-09", 10)));
    await runRentReminders(db, sp.deps(at("2026-11-12", 10, 5), snapOf("2026-11-09", 10)));
    expect(stripeTexts(sp).map((s) => s.kind)).toEqual(["rent_reminder_overdue", "rent_reminder_daily"]);
    for (const t of stripeTexts(sp)) expect(t.body).not.toMatch(/late fee/i);
  });
  const twoSnap = (): StripeBillingSnapshot => ({
    nextChargeOn: "2026-11-19",
    failedInvoices: [
      { id: "in_failed", hostedUrl: INVOICE_URL, amountDue: 350, createdOn: "2026-11-05", createdAt: Math.floor(at("2026-11-05", 17, 41).getTime() / 1000) },
      { id: "in_second", hostedUrl: "https://invoice.stripe.com/i/acct_1TwBPNGsNNO50lXb/live_second", amountDue: 350, createdOn: "2026-11-12", createdAt: Math.floor(at("2026-11-12", 17, 41).getTime() / 1000) },
    ],
  });
  const claimedOverdue = (st: any) => {
    for (const channel of ["sms", "email"]) st.rent_reminder_log.push({ rental_id: R_STRIPE, due_date: "2026-11-05", stage: "overdue", channel, created_at: "2026-11-06T15:00:00Z" });
  };
  test("two open invoices: the text states the linked invoice's own amount and lists the other with its own link, never a combined total", async () => {
    const db: any = fakeDb(seedAt("2026-11-01T00:00:00Z"));
    claimedOverdue(db._state);
    const sp = spies();
    await runRentReminders(db, sp.deps(at("2026-11-13", 10, 5), twoSnap()));
    const t = stripeTexts(sp)[0].body as string;
    expect(t).toContain("Pay this week's $350 invoice here: " + INVOICE_URL);
    expect(t).toContain("Your $350 invoice from Thu, Nov 12 is also unpaid: https://invoice.stripe.com/i/acct_1TwBPNGsNNO50lXb/live_second");
    expect(t).not.toContain("$700");
    expect(t).toContain("owed separately");
    const e = sp.email.find((x) => x.workflow === "rent_reminder_daily");
    expect(e.link).toBe(INVOICE_URL);
    expect(e.text).toContain("live_second");
  });
  test("one rent text per renter per day: a newer invoice failing after today's daily waits; a daily after today's failed-payment text waits", async () => {
    const db: any = fakeDb(seedAt("2026-11-01T00:00:00Z"));
    claimedOverdue(db._state);
    db._state.outbound_messages = [{ rental_id: R_STRIPE, to_address: "+13212870986", channel: "sms", kind: "rent_reminder_daily", status: "sent", body: `Pay: ${INVOICE_URL}`, created_at: at("2026-11-12", 10, 5).toISOString() }];
    const calls: any[] = [];
    const second = { id: "in_second", status: "open", hosted_invoice_url: "https://invoice.stripe.com/i/acct_1TwBPNGsNNO50lXb/live_second", created: Math.floor(at("2026-11-12", 17, 41).getTime() / 1000) };
    const r = await sendFailedPaymentText(db, { invoice: second, amount: 350, rentalId: R_STRIPE, applicationId: APP_S, firstName: "Damon", phone: "3212870986" },
      { now: at("2026-11-12", 17, 41), sendSms: async (a: any) => { calls.push(a); return { ok: true }; } });
    expect(r.sent).toBe(false);
    expect(calls).toHaveLength(0);
    // Reverse order: a failed-payment text at 9 AM; the 10 AM daily for the older invoice waits a day.
    const db2: any = fakeDb(seedAt("2026-11-01T00:00:00Z"));
    claimedOverdue(db2._state);
    db2._state.outbound_messages = [{ rental_id: R_STRIPE, to_address: "+13212870986", channel: "sms", kind: "payment_failed", status: "sent", body: "Pay: live_second", created_at: at("2026-11-16", 9, 0).toISOString() }];
    const sp = spies();
    const run = await runRentReminders(db2, sp.deps(at("2026-11-16", 10, 5), twoSnap()));
    expect(stripeTexts(sp)).toHaveLength(0);
    expect(run.skipped.texted_today).toBe(1);
    await runRentReminders(db2, sp.deps(at("2026-11-17", 10, 5), twoSnap()));
    expect(stripeTexts(sp)).toHaveLength(1);
    expect(stripeTexts(sp)[0].body).toContain("live_second");
  });
  test("could not read today's texts: hold the text (fail closed)", async () => {
    const db: any = fakeDb(seedAt("2026-11-01T00:00:00Z"));
    claimedOverdue(db._state);
    const from = db.from;
    db.from = (t: string) => {
      if (t !== "outbound_messages") return from(t);
      const b: any = { select: () => b, eq: () => b, then: (res: any) => Promise.resolve({ data: null, error: { message: "down" } }).then(res) };
      return b;
    };
    const sp = spies();
    await runRentReminders(db, sp.deps(at("2026-11-13", 10, 5), twoSnap()));
    expect(stripeTexts(sp)).toHaveLength(0);
  });
});

describe("wiring", () => {
  const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  test("the older past-due / due-tomorrow emails stand down once any rent reminder stage is on", () => {
    const src = read("src/routes/api/public/cron/ops-reminders.ts");
    expect(src).toContain("RENT_REMINDER_SWITCHES");
    expect(src).toMatch(/LEGACY_RENTER_RENT = new Set\(\["payment_past_due", "payment_due_tomorrow"\]\)/);
  });
  test("the cron route checks its own token", () => {
    const src = read("src/routes/api/public/cron/rent-reminders.ts");
    expect(src).toContain('get_cron_token", { _name: "rent-reminders" }');
    expect(src).toContain('status: 401');
  });
  test("the reminder email never carries a generic payment link", () => {
    const src = read("src/lib/email.server.ts");
    expect(src).toMatch(/sendRentReminderEmail[\s\S]{0,600}isGenericPaymentLink/);
  });
  test("the migration has the one-send-per-stage key and manager-only access", () => {
    const sql = read("supabase/migrations/20261109210000_rent_reminders.sql");
    expect(sql).toMatch(/UNIQUE \(rental_id, due_date, stage, channel\)/i);
    expect(sql).toMatch(/private\.is_manager\(\)/);
    expect(sql).toMatch(/REVOKE ALL ON public\.rent_reminder_log FROM anon/i);
  });
});
