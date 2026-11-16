// SOP copy decisions (Nov 16 2026): D2, D7, D8, D9, D10, D12, D13, D14, D20, D23, D30, decision 7.
// Source checks plus the Rental Ended notice switch. Network refused.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
process.env.SUPABASE_URL ??= "http://127.0.0.1:9";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "dummy";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "dummy";
globalThis.fetch = (async (url: any) => { throw new Error(`network refused in test: ${url}`); }) as any;
const cat = await import("@/lib/automation-catalog");
const ren = await import("@/lib/rental-ended-notice.server");
const ty = await import("@/lib/step-one-thank-you");
const ae = await import("@/lib/approval-email");
const rr = await import("@/lib/rent-reminders");
const read = (f: string) => readFileSync(f, "utf8");

describe("copy", () => {
  test("D7 activation says Active, never 'reserved for you'", () => {
    const s = read("src/lib/rentals.functions.ts");
    expect(s).toContain("subject: `Your ${vehicleLabel} Rental Is Active`");
    expect(s).toContain("REAL RENTALS: Hi ${firstName}, your ${vehicleLabel} rental is now active. Check your email to set up your driver portal and see your payment schedule. Reply STOP to opt out.");
    expect(s).not.toMatch(/is reserved for you|Is Reserved For You/);
  });
  test("D8 helper line under Upload Documents", () => {
    expect(ty.STEP_ONE_THANK_YOU.primaryHelper).toBe("5 quick questions, then upload.");
    expect(read("src/components/site/StepOneThankYou.tsx")).toContain("{C.primaryHelper}");
  });
  test("D12 Title Case", () => {
    const e = read("src/lib/email.server.ts");
    for (const t of ["Your REAL RENTALS Application Is Saved", "Your REAL RENTALS Application Is Still Open", "Your Card Ending in", "Your Driver's License Expires"]) expect(e).toContain(t);
    expect(read("src/lib/waitlist.functions.ts")).toContain("You're on the REAL RENTALS Waitlist");
    expect(read("src/lib/charges.functions.ts")).toContain("Tolls & Charges on Your Rental");
    expect(read("src/lib/incidents.functions.ts")).toContain(">Deposit Settled</h1>");
    expect(read("src/lib/step-one-email.server.ts")).toContain("You're In Line. Finish Step 2 Now to Hold Your Spot.");
    expect(read("src/routes/api/public/cron/ops-reminders.ts")).toContain("Your Rental Agreement Is Still Waiting");
  });
  test("D23 the thank-you email names no rideshare app", () => {
    expect(read("src/lib/step-one-email.server.ts")).not.toMatch(/Uber|Lyft/);
  });
  test("D13 portal invite: P36 wording, license spelled the US way", () => {
    const e = read("src/lib/email.server.ts");
    const inv = e.slice(e.indexOf("export async function sendPortalInviteEmail"), e.indexOf("export async function sendAgreementEmail"));
    for (const t of ["Your pickup is booked.", "Before You Come", "Bring your driver's license.", "If you're 30+ minutes late, the car may go to another driver.", "Your insurance card is handed to you at pickup, not before.", "Set up your rideshare account after pickup, once your rental is paid.", "Reservation Fee goes toward your first week's rent.", "Your Pickup Is Booked: "]) expect(inv).toContain(t);
    expect(inv).not.toMatch(/licence/);
  });
  test("D9 24h/72h reminders use the 14-day link; D10 the 3-hour email is dropped", () => {
    const e = read("src/lib/email.server.ts");
    expect(e).toMatch(/sendWizardRecoveryEmail[\s\S]{0,400}applicantRecoveryUrl\(applicationId, \{ followup: true \}\)/);
    expect(read("src/lib/wizard-recovery.server.ts")).toContain("deps.abandonedQuoteEmail === true ? batchAbandoned");
    expect(read("src/routes/api/public/cron/wizard-recovery.ts")).not.toMatch(/abandonedQuoteEmail:\s*true/);
  });
  test("D2/D20 rent reminders: main line (default or the configured line; prod sends from the 888 line), 8 AM-9 PM", () => {
    expect(read("src/lib/rent-reminders.server.ts")).not.toMatch(/\+1\d{10}/);
    expect(rr.withinQuietHoursAllowed(7)).toBe(false);
    expect(rr.withinQuietHoursAllowed(8)).toBe(true);
    expect(rr.withinQuietHoursAllowed(20)).toBe(true);
    expect(rr.withinQuietHoursAllowed(21)).toBe(false);
  });
  test("D30 FLEET approval text skips the approval email only when FLEET says so", () => {
    expect(read("src/lib/fleet-review.server.ts")).toContain("body.approval_text_sent === true ? { skipApprovalEmail: true } : {}");
    expect(read("src/lib/applications.functions.ts")).toContain('args.skipApprovalEmail === true) approvalEmail = "bot_text"');
    expect(ae.approvalEmailMessage("bot_text")).toBe("No Approval Email: FLEET Sent Its Approval Text.");
  });
  test("decision 7: no courtesy rides offered anywhere renter-facing", () => {
    for (const f of ["src/lib/driver-issues.ts", "docs/bot-rules.md"]) expect(read(f)).not.toMatch(/we('|’)ve booked you a ride|courtesy ride (is|was) booked/i);
  });
});

describe("D14 Rental Ended notice", () => {
  type Row = Record<string, any>;
  function fakeDb(seed: Record<string, Row[]>) {
    const state: Record<string, Row[]> = JSON.parse(JSON.stringify(seed));
    return { state, from(table: string) {
      state[table] ??= [];
      let op = "select"; let payload: any = null; let single = false; const f: ((r: Row) => boolean)[] = [];
      const q: any = { select: () => q, insert: (r: Row) => { op = "insert"; payload = r; return q; }, update: (r: Row) => { op = "update"; payload = r; return q; },
        eq: (c: string, v: any) => { f.push((r) => r[c] === v); return q; }, maybeSingle: () => { single = true; return q; },
        then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej) };
      function run() {
        const rows = state[table];
        if (op === "insert") { if (rows.some((r) => r.key === payload.key)) return { data: null, error: { code: "23505", message: "dup" } }; rows.push(payload); return { data: null, error: null }; }
        const m = rows.filter((r) => f.every((x) => x(r)));
        if (op === "update") { m.forEach((r) => Object.assign(r, payload)); return { data: null, error: null }; }
        return { data: single ? m[0] ?? null : m, error: null };
      }
      return q;
    } };
  }
  const seed = { rentals: [{ id: "r1", application_id: "a1", vehicle_id: "v1" }], applications: [{ id: "a1", full_name: "Test Renter", email: "t@example.com", phone: "+15555550100" }], vehicles: [{ id: "v1", year: 2021, make: "Toyota", model: "Camry" }], renter_reminder_sends: [] };
  test("default OFF switch", () => {
    expect(cat.isDefaultOff("rental_ended_notice")).toBe(true);
  });
  test("off: nothing sent", async () => {
    const sent: any[] = [];
    expect((await ren.sendRentalEndedNotice(fakeDb(seed), "r1", { gate: "off", deliver: async (n) => sent.push(n) })).status).toBe("off");
    expect(sent.length).toBe(0);
  });
  test("on: one notice per rental with the built wording", async () => {
    const db = fakeDb(seed); const sent: any[] = [];
    const deliver = async (n: any) => { sent.push(n); return { email: "sent", sms: "sent" }; };
    const noon = new Date("2026-11-16T17:00:00Z"); // 12 PM ET
    expect((await ren.sendRentalEndedNotice(db, "r1", { gate: "send", deliver, now: noon })).status).toBe("sent");
    expect((await ren.sendRentalEndedNotice(db, "r1", { gate: "send", deliver, now: noon })).status).toBe("duplicate");
    expect(sent.length).toBe(1);
    expect(sent[0].smsBody).toBe("REAL RENTALS: Hi Test, your rental has ended. The driver portal has the details. Reply STOP to opt out.");
    expect(sent[0].emailHtml).toContain("2021 Toyota Camry");
    expect(sent[0].phone).toBe("+15555550100");
  });
  test("outside 8 AM–9 PM ET: email only, no text", async () => {
    const db = fakeDb(seed); const sent: any[] = [];
    const deliver = async (n: any) => { sent.push(n); return { email: "sent", sms: "skipped" }; };
    expect((await ren.sendRentalEndedNotice(db, "r1", { gate: "send", deliver, now: new Date("2026-11-17T03:30:00Z") })).status).toBe("sent"); // 10:30 PM ET
    expect(sent[0].phone).toBeNull();
    expect(sent[0].email).toBe("t@example.com");
  });
});
