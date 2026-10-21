import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildApprovedNotRenting,
  calendarDay,
  docDateLabel,
  etCalendarDate,
  latestApprovalAt,
  type FunnelApplicant,
  type FunnelContact,
} from "../src/lib/booking-funnel";
import { contactStatusBlockers, contactStatusPatch } from "../src/lib/contact-status";

const TODAY = new Date("2026-10-21T16:00:00.000Z");
const LATE_NIGHT_UTC = new Date("2026-10-21T03:30:00.000Z");

function contact(status = "new"): FunnelContact {
  return {
    contact_status: status,
    contact_status_note: null,
    contact_follow_up_on: null,
    contact_status_at: null,
    contact_status_by: null,
  };
}

function person(over: Partial<FunnelApplicant> & Pick<FunnelApplicant, "id">): FunnelApplicant {
  return {
    fullName: over.fullName ?? over.id,
    status: "approved",
    deletedAt: null,
    licenseExpiration: "2027-01-01",
    insuranceExpiresOn: "2027-01-01",
    contact: contact(),
    ...over,
  };
}

describe("booking funnel calendar", () => {
  it("reads an instant as the Eastern calendar day", () => {
    assert.equal(etCalendarDate(LATE_NIGHT_UTC), "2026-10-20");
    assert.equal(etCalendarDate(TODAY), "2026-10-21");
    assert.equal(calendarDay("2026-10-21", "date"), "2026-10-21");
    assert.equal(calendarDay("2026-10-21T03:30:00.000Z", "instant"), "2026-10-20");
  });

  it("does not shift a date-only license onto the previous Eastern day", () => {
    assert.equal(docDateLabel("2026-10-21", etCalendarDate(LATE_NIGHT_UTC)), "1 Day Left");
    assert.equal(docDateLabel(null, "2026-10-21"), "Unknown");
    assert.equal(docDateLabel("nope", "2026-10-21"), "Unknown");
    assert.equal(docDateLabel("2026-10-20", "2026-10-21"), "1 Day Overdue");
    assert.equal(docDateLabel("2026-10-21", "2026-10-21"), "Expires Today");
    assert.equal(docDateLabel("2026-11-20", "2026-10-21"), "30 Days Left");
    for (const label of ["Unknown", "1 Day Overdue", "Expires Today", "30 Days Left"]) {
      assert.equal(label.includes("OK"), false);
    }
  });
});

describe("approved, not yet renting", () => {
  const applicants: FunnelApplicant[] = [
    person({ id: "ada", fullName: "Ada", licenseExpiration: null, insuranceExpiresOn: "2026-11-20" }),
    person({ id: "bea", fullName: "Bea" }),
    person({ id: "cy", fullName: "Cy", status: "active" }),
    person({ id: "dee", fullName: "Dee", status: "reviewing" }),
    person({ id: "ed", fullName: "Ed", deletedAt: "2026-10-01T00:00:00.000Z" }),
    person({ id: "fay", fullName: "Fay" }),
    person({ id: "gus", fullName: "Gus", contact: null }),
  ];

  const built = buildApprovedNotRenting({
    applicants,
    activeRentalApplicationIds: ["fay"],
    approvedAtById: latestApprovalAt([
      { entityId: "ada", createdAt: "2026-09-11T15:00:00.000Z" },
      { entityId: "ada", createdAt: "2026-09-01T15:00:00.000Z" },
      { entityId: "bea", createdAt: "2026-10-21T18:00:00.000Z" },
      { entityId: "gus", createdAt: "2026-10-21T03:30:00.000Z" },
    ]),
    now: TODAY,
  });

  it("keeps approved drivers who are not on an active rental", () => {
    assert.deepEqual(
      built.rows.map((r) => r.id),
      ["ada", "gus", "bea"],
    );
    assert.equal(built.rows.find((r) => r.id === "cy"), undefined);
    assert.equal(built.rows.find((r) => r.id === "dee"), undefined);
    assert.equal(built.rows.find((r) => r.id === "ed"), undefined);
    assert.equal(built.rows.find((r) => r.id === "fay"), undefined);
  });

  it("counts Eastern days since the latest approval, and Unknown when there is none", () => {
    const ada = built.rows.find((r) => r.id === "ada")!;
    const bea = built.rows.find((r) => r.id === "bea")!;
    const gus = built.rows.find((r) => r.id === "gus")!;
    assert.equal(ada.daysSinceApproval, 40);
    assert.equal(ada.daysSinceLabel, "40 Days");
    assert.equal(bea.daysSinceLabel, "Today");
    assert.equal(gus.daysSinceApproval, 1);
    assert.equal(gus.daysSinceLabel, "1 Day");
    assert.equal(ada.licenseLabel, "Unknown");
    assert.equal(ada.insuranceLabel, "30 Days Left");
    assert.equal(Object.prototype.hasOwnProperty.call(gus.contact, "contact_status"), false);
  });

  it("sorts the longest wait first and Unknown approval dates last", () => {
    const noAudit = buildApprovedNotRenting({
      applicants: [
        person({ id: "zoe", fullName: "Zoe" }),
        person({ id: "ann", fullName: "Ann" }),
        person({ id: "moe", fullName: "Moe" }),
      ],
      activeRentalApplicationIds: [],
      approvedAtById: {
        ann: "2026-10-21T15:00:00.000Z",
        moe: "2026-10-01T15:00:00.000Z",
      },
      now: TODAY,
    });
    assert.deepEqual(
      noAudit.rows.map((r) => r.id),
      ["moe", "ann", "zoe"],
    );
    assert.equal(noAudit.rows[2].daysSinceLabel, "Unknown");
    assert.equal(noAudit.rows[2].daysSinceApproval, null);
  });
});

describe("mark contacted stays on the contact status editor", () => {
  it("keeps the existing note and follow-up when the status is Contacted", () => {
    const draft = {
      status: "contacted" as const,
      note: "Called about the Civic",
      followUpOn: "2026-10-28",
    };
    assert.deepEqual(contactStatusBlockers(draft), []);
    assert.deepEqual(contactStatusPatch(draft), {
      contact_status: "contacted",
      contact_status_note: "Called about the Civic",
      contact_follow_up_on: "2026-10-28",
    });
  });

  it("does not send, and the one-click path is the existing editor", () => {
    const fn = readFileSync(new URL("../src/lib/booking-funnel.functions.ts", import.meta.url), "utf8");
    const pure = readFileSync(new URL("../src/lib/booking-funnel.ts", import.meta.url), "utf8");
    const list = readFileSync(new URL("../src/components/admin/ApprovedNotRenting.tsx", import.meta.url), "utf8");
    const cell = readFileSync(new URL("../src/components/admin/ContactStatusCell.tsx", import.meta.url), "utf8");
    const panel = readFileSync(new URL("../src/components/admin/DriversPanel.tsx", import.meta.url), "utf8");
    for (const src of [fn, pure, list]) {
      assert.equal(/sendEmail\(|sendSms\(/.test(src), false);
    }
    assert.match(fn, /requireManager/);
    assert.equal(fn.includes("document-expiry"), false);
    assert.match(list, /showMarkContacted/);
    assert.match(list, /ContactStatusCell/);
    assert.equal(/setContactStatus/.test(list), false);
    assert.match(cell, /showMarkContacted/);
    assert.match(cell, /status: "contacted"/);
    assert.match(cell, /setContactStatus/);
    assert.match(panel, /approved-not-renting/);
    assert.match(panel, /canManageWaitlist/);
  });
});
