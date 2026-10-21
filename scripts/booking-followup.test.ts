import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  BOOKING_FOLLOWUP_ENABLED,
  BOOKING_FOLLOWUP_LIMIT,
  assertBookingFollowupEnabled,
  applicationHasBooking,
  buildBookingFollowups,
  contactMarksFromApplication,
  daysWaiting,
  followupReason,
  isVerifiedApplication,
  reminderText,
  takeUnbooked,
  type FollowupApplication,
} from "../src/lib/booking-followup";
import { loadBookingFollowups } from "../src/lib/booking-followup.server";

const flag = readFileSync("src/lib/booking-followup.ts", "utf8");
const server = readFileSync("src/lib/booking-followup.server.ts", "utf8");
const fn = readFileSync("src/lib/booking-followup.functions.ts", "utf8");
const slot = readFileSync("src/components/admin/BookingFollowupSlot.tsx", "utf8");
const panel = readFileSync("src/components/admin/BookingFollowupPanel.tsx", "utf8");
const overview = readFileSync("src/components/admin/OverviewPanel.tsx", "utf8");

const now = new Date("2026-10-21T15:00:00.000Z");

function app(partial: Partial<FollowupApplication> & Pick<FollowupApplication, "id">): FollowupApplication {
  return {
    fullName: "Ada Lopez",
    email: "ada@example.com",
    phone: "4045550100",
    status: "approved",
    userId: null,
    deletedAt: null,
    contactStatus: "new",
    contactStatusAt: null,
    docRequestSentAt: null,
    recoverySentAt: null,
    recoveryEmailSent24h: null,
    recoveryEmailSent72h: null,
    backgroundCheckStatus: "pending",
    mvrStatus: "pending",
    rideshareHistoryStatus: "pending",
    earningsVerifiedStatus: "pending",
    ...partial,
  };
}

const verifiedChecks = {
  backgroundCheckStatus: "passed",
  mvrStatus: "passed",
  rideshareHistoryStatus: "passed",
  earningsVerifiedStatus: "passed",
};

describe("booking follow-up flag", () => {
  it("is a hard false, declared once, and refuses before any read", async () => {
    assert.equal(BOOKING_FOLLOWUP_ENABLED, false);
    assert.equal((flag.match(/const BOOKING_FOLLOWUP_ENABLED/g) ?? []).length, 1);
    assert.match(flag, /export const BOOKING_FOLLOWUP_ENABLED: boolean = false as boolean/);
    for (const source of [server, fn, slot, panel]) {
      assert.equal((source.match(/const BOOKING_FOLLOWUP_ENABLED/g) ?? []).length, 0);
    }
    assert.throws(() => assertBookingFollowupEnabled(), /Booking follow-up is not enabled/);
    await assert.rejects(() => loadBookingFollowups(), /Booking follow-up is not enabled/);

    const loader = server.slice(server.indexOf("export async function loadBookingFollowups"));
    const guard = loader.indexOf("assertBookingFollowupEnabled()");
    const db = loader.indexOf('import("@/integrations/supabase/client.server")');
    const collect = loader.indexOf("collectUnbooked(");
    assert.ok(guard !== -1 && db !== -1 && collect !== -1 && guard < db && db < collect);
    const collectBody = server.slice(server.indexOf("async function collectUnbooked"));
    const pageRead = collectBody.indexOf(".range(");
    const unbooked = collectBody.indexOf("takeUnbooked(");
    assert.ok(pageRead !== -1 && unbooked !== -1 && pageRead < unbooked);
    assert.match(server, /const POSTGREST_MAX_ROWS = 1000/);
    assert.match(server, /const READ_CAP = POSTGREST_MAX_ROWS - 1/);
    assert.match(server, /\.limit\(READ_CAP \+ 1\)/);
    assert.match(server, /if \(count > READ_CAP\) throw new Error\("Booking follow-up could not be listed\."\)/);
    assert.match(server, /const PAGE_CAP = 20/);
    assert.match(collectBody, /if \(pageIndex >= PAGE_CAP\) throw new Error\("Booking follow-up could not be listed\."\)/);
    assert.match(server, /\.order\("updated_at", \{ ascending: false \}\)\s*\.order\("id", \{ ascending: true \}\)/);
    assert.match(server, /const CONTACT_CHUNK = 50/);
    assert.match(server, /\.in\("application_id", chunk\)/);
    assert.match(
      server,
      /\.order\("sent_at", \{ ascending: false, nullsFirst: false \}\)\s*\.order\("created_at", \{ ascending: false \}\)/,
    );
    assert.match(loader, /isApprovedStatus\(app\.status\)/);
    assert.match(server, /approvedIds\.slice\(index, index \+ CONTACT_CHUNK\)/);
    assert.match(server, /\.in\("entity_id", chunk\)/);
    assert.doesNotMatch(server, /\.in\("entity_id", approvedIds\)/);
    assert.doesNotMatch(server, /\.in\("entity_id", ids\)/);
    assert.match(server, /\.limit\(1\)/);
    assert.match(server, /if \(one\.error\) \{\s*truncated = true;/);
    assert.match(server, /if \(approvalsQuery\.error\) \{\s*truncated = true;/);
    assert.match(server, /if \(message\.error\) \{\s*unchecked\.push\(\.\.\.chunk\);/);
    assert.match(server, /if \(outbound\.error\) \{\s*unchecked\.push\(\.\.\.chunk\);/);
    assert.match(server, /if \(outbound\.error\) return "unchecked"/);
    assert.doesNotMatch(server, /throw new Error\((approvalsQuery|message|outbound)\.error\.message\)/);
    assert.doesNotMatch(server, /one\.error \|\| !one\.data/);
    assert.match(server, /source: "outbound"/);
    assert.match(server, /source: "message"/);
    assert.doesNotMatch(server, /stamps\.push\(\{ applicationId, at, source: "message" \}\)/);
    assert.doesNotMatch(server, /CONTACT_LIMIT|2000/);
    assert.doesNotMatch(server, /sendEmail|sendSms|\.insert\(|\.update\(|\.delete\(|\.upsert\(/);
    assert.doesNotMatch(server, /contacted_at/);

    const middleware = fn.match(/\.middleware\(\[([^\]]+)\]/);
    assert.equal(middleware?.[1].replace(/\s/g, ""), "bookingFollowupGate,requireSupabaseAuth");
    const handler = fn.slice(fn.indexOf(".handler("));
    const handlerGuard = handler.indexOf("assertBookingFollowupEnabled()");
    const role = handler.indexOf('import("@/lib/roles.server")');
    const loaderImport = handler.indexOf('import("@/lib/booking-followup.server")');
    assert.ok(handlerGuard !== -1 && role !== -1 && loaderImport !== -1);
    assert.ok(handlerGuard < role && role < loaderImport);
    assert.doesNotMatch(fn, /\.from\(|sendEmail|sendSms|\.insert\(|\.update\(|\.delete\(|\.upsert\(/);

    const slotFlag = slot.indexOf("BOOKING_FOLLOWUP_ENABLED !== true");
    const slotImport = slot.indexOf('import("@/components/admin/BookingFollowupPanel")');
    assert.ok(slotFlag !== -1 && slotImport !== -1 && slotFlag < slotImport);
    assert.doesNotMatch(slot, /from ["']@\/components\/admin\/BookingFollowupPanel/);
    assert.doesNotMatch(slot, /booking-followup\.(server|functions)/);
    assert.doesNotMatch(overview, /BookingFollowupPanel|booking-followup\.(server|functions)/);
    assert.match(overview, /BookingFollowupSlot/);

    const panelFlag = panel.indexOf("BOOKING_FOLLOWUP_ENABLED !== true");
    const panelLoad = panel.indexOf("load()");
    assert.ok(panelFlag !== -1 && panelLoad !== -1 && panelFlag < panelLoad);
    assert.match(panel, /Copy Reminder/);
    assert.match(panel, /LAST_CONTACT_NOT_CHECKED/);
    assert.match(panel, /Some Last Contact Times Were Not Checked/);
    assert.doesNotMatch(panel, /sendEmail|sendSms|uppercase|text-transform/);
  });
});

describe("booking follow-up rows", () => {
  it("keeps approved or verified applications that have no rental", () => {
    const approved = app({ id: "app-approved" });
    const verified = app({ id: "app-verified", status: "reviewing", ...verifiedChecks });
    const both = app({ id: "app-both", userId: "user-both", ...verifiedChecks });
    const newLead = app({ id: "app-new", status: "new" });
    const declined = app({ id: "app-declined", status: "declined", ...verifiedChecks });
    const partial = app({ id: "app-partial", status: "partial", ...verifiedChecks });
    const active = app({ id: "app-active", status: "active", ...verifiedChecks });
    const deleted = app({ id: "app-deleted", deletedAt: "2026-10-01T00:00:00.000Z" });
    const booked = app({ id: "app-booked", userId: "user-booked" });
    const bookedByUser = app({ id: "app-user", userId: "user-1", status: "reviewing", ...verifiedChecks });

    assert.equal(isVerifiedApplication(verified), true);
    assert.equal(isVerifiedApplication(approved), false);
    assert.equal(followupReason(declined), null);
    assert.equal(followupReason(partial), null);
    assert.equal(followupReason(active), null);
    assert.equal(applicationHasBooking(booked, [{ applicationId: "app-booked", driverId: "other" }]), true);
    assert.equal(applicationHasBooking(booked, [{ applicationId: "else", driverId: "user-booked" }]), true);
    assert.equal(applicationHasBooking(approved, [{ applicationId: "else", driverId: "user-booked" }]), false);

    const rows = buildBookingFollowups({
      applications: [approved, verified, both, newLead, declined, partial, active, deleted, booked, bookedByUser],
      rentals: [
        { applicationId: "app-booked", driverId: "someone" },
        { applicationId: null, driverId: "user-1" },
      ],
      approvals: [
        { applicationId: "app-approved", at: "2026-10-11T15:00:00.000Z" },
        { applicationId: "app-approved", at: "2026-10-18T15:00:00.000Z" },
        { applicationId: "app-both", at: "2026-10-19T15:00:00.000Z" },
      ],
      contacts: [],
      now,
    });

    assert.deepEqual(
      rows.map((row) => row.applicationId),
      ["app-approved", "app-both", "app-verified"],
    );
    const approvedRow = rows[0];
    assert.equal(approvedRow.reason, "approved");
    assert.equal(approvedRow.reasonLabel, "Approved");
    assert.equal(approvedRow.daysWaiting, 10);
    assert.equal(approvedRow.waitingSince, "2026-10-11T15:00:00.000Z");
    assert.equal(rows[1].reason, "approved_and_verified");
    assert.equal(rows[1].daysWaiting, 2);
    assert.equal(rows[2].reason, "verified");
    assert.equal(rows[2].reasonLabel, "Verified");
    assert.equal(rows[2].daysWaiting, null);
    assert.equal(rows[2].waitingSince, null);
  });

  it("uses a recorded contact and does not treat approval's contacted stamp as one", () => {
    const person = app({
      id: "app-contact",
      contactStatus: "contacted",
      contactStatusAt: "2026-10-01T12:00:00.000Z",
      docRequestSentAt: "2026-10-20T12:00:00.000Z",
      recoverySentAt: "not-a-date",
    });
    const marks = contactMarksFromApplication(person);
    assert.equal(marks.some((mark) => mark.source === "contact_status"), true);
    assert.equal(marks.some((mark) => mark.at === "not-a-date"), false);

    const ignored = app({
      id: "app-new-status",
      contactStatus: "new",
      contactStatusAt: "2026-10-20T12:00:00.000Z",
    });
    assert.deepEqual(contactMarksFromApplication(ignored), []);

    const rows = buildBookingFollowups({
      applications: [person],
      rentals: [],
      approvals: [{ applicationId: "app-contact", at: "2026-10-20T15:00:00.000Z" }],
      contacts: [
        { applicationId: "app-contact", at: "2026-10-21T12:00:00.000Z", source: "message" },
        { applicationId: "app-contact", at: "2026-09-01T12:00:00.000Z", source: "message" },
      ],
      now,
    });
    assert.equal(rows[0].lastContactAt, "2026-10-21T12:00:00.000Z");
    assert.equal(rows[0].lastContactLabel, "Message");
    const outbound = buildBookingFollowups({
      applications: [person],
      rentals: [],
      approvals: [{ applicationId: "app-contact", at: "2026-10-20T15:00:00.000Z" }],
      contacts: [{ applicationId: "app-contact", at: "2026-10-21T18:00:00.000Z", source: "outbound" }],
      now,
    });
    assert.equal(outbound[0].lastContactLabel, "Outbound Message");
    const unchecked = buildBookingFollowups({
      applications: [person],
      rentals: [],
      approvals: [],
      contacts: [{ applicationId: "app-contact", at: "2026-10-21T18:00:00.000Z", source: "message" }],
      uncheckedContacts: ["app-contact"],
      now,
    });
    assert.equal(unchecked[0].lastContactAt, null);
    assert.equal(unchecked[0].lastContactLabel, "Last Contact Not Checked");
    assert.equal(rows[0].daysWaiting, 1);
    assert.equal(daysWaiting(null, now), null);
    assert.equal(daysWaiting("nope", now), null);
  });

  it("writes a copyable reminder and does not include contact details", () => {
    const text = reminderText({
      fullName: "Ada Lopez",
      reason: "approved",
      daysWaiting: 1,
    });
    assert.match(text, /Hi Ada,/);
    assert.match(text, /application is approved/);
    assert.match(text, /It has been 1 day\./);
    assert.match(text, /https:\/\/drivereal\.com\/portal/);
    assert.doesNotMatch(text, /ada@example.com|4045550100|claim|deductible|staff note/i);

    const undated = reminderText({ fullName: "", reason: "verified", daysWaiting: null });
    assert.match(undated, /Hi there,/);
    assert.match(undated, /application is verified/);
    assert.doesNotMatch(undated, /It has been/);

    const many = Array.from({ length: BOOKING_FOLLOWUP_LIMIT + 5 }, (_, index) =>
      app({ id: `app-${index}`, fullName: `Person ${String(index).padStart(3, "0")}` }),
    );
    const rows = buildBookingFollowups({
      applications: many,
      rentals: [],
      approvals: many.map((person, index) => ({
        applicationId: person.id,
        at: new Date(Date.parse("2026-10-01T00:00:00.000Z") + index * 86_400_000).toISOString(),
      })),
      contacts: [],
      now,
    });
    assert.equal(rows.length, BOOKING_FOLLOWUP_LIMIT);
    assert.equal(rows[0].applicationId, "app-0");
  });

  it("counts America/New_York calendar days across midnight and DST", () => {
    assert.equal(daysWaiting("2026-01-15T04:59:00.000Z", new Date("2026-01-15T05:01:00.000Z")), 1);
    assert.equal(daysWaiting("2026-03-07T17:00:00.000Z", new Date("2026-03-09T16:00:00.000Z")), 2);
    assert.equal(daysWaiting("2026-11-01T04:30:00.000Z", new Date("2026-11-02T04:30:00.000Z")), 0);
    assert.equal(daysWaiting("2026-06-15T14:00:00.000Z", new Date("2026-06-16T01:00:00.000Z")), 0);
    assert.equal(daysWaiting("2026-10-22T16:00:00.000Z", new Date("2026-10-21T15:00:00.000Z")), 0);
  });

  it("drops booked applicants before the list cap", () => {
    const booked = Array.from({ length: BOOKING_FOLLOWUP_LIMIT }, (_, index) =>
      app({ id: `booked-${index}`, userId: `user-${index}` }),
    );
    const waiting = app({ id: "waiting", fullName: "Waiting Person" });
    const rentals = booked.map((person) => ({ applicationId: person.id, driverId: person.userId }));
    const taken = takeUnbooked([...booked, waiting], rentals, BOOKING_FOLLOWUP_LIMIT);
    assert.deepEqual(
      taken.map((person) => person.id),
      ["waiting"],
    );
    const rows = buildBookingFollowups({
      applications: [...booked, waiting],
      rentals,
      approvals: [{ applicationId: "waiting", at: "2026-10-01T15:00:00.000Z" }],
      contacts: [],
      now,
    });
    assert.deepEqual(
      rows.map((row) => row.applicationId),
      ["waiting"],
    );
  });
});
