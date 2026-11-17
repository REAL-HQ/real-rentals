import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { withinTextingHours } from "@/lib/failed-payment-link";
import {
  assignQueuePositions,
  countFleetCapacity,
  etWallTime,
  nextTextingWindowStart,
  parseCarsAvailable,
  positionFor,
  publicScarcityCount,
  publicWaitlistMode,
  vehicleAvailableAlertCopy,
  vehicleAvailablePayload,
  waitlistJoinedEmailHtml,
  waitlistJoinedPlain,
} from "@/lib/fleet-capacity";

describe("parseCarsAvailable", () => {
  test("SQL null and empty stay not set, never 0", () => {
    expect(parseCarsAvailable(null)).toBeNull();
    expect(parseCarsAvailable(undefined)).toBeNull();
    expect(parseCarsAvailable("")).toBeNull();
    expect(Number(null)).toBe(0); // the old footgun, documented
  });
  test("accepts a whole number ≥ 0, including 0", () => {
    expect(parseCarsAvailable(0)).toBe(0);
    expect(parseCarsAvailable(5)).toBe(5);
    expect(parseCarsAvailable("3")).toBe(3);
  });
  test("rejects booleans, fractions, and negatives", () => {
    expect(parseCarsAvailable(true)).toBeNull();
    expect(parseCarsAvailable(false)).toBeNull();
    expect(parseCarsAvailable(1.5)).toBeNull();
    expect(parseCarsAvailable(-1)).toBeNull();
    expect(parseCarsAvailable("nope")).toBeNull();
  });
});

describe("publicWaitlistMode", () => {
  test("override 0 forces waitlist on, even if cars are Available", () => {
    expect(publicWaitlistMode(0, 5)).toBe(true);
  });
  test("override above 0 forces waitlist off, even if the fleet is empty", () => {
    expect(publicWaitlistMode(2, 0)).toBe(false);
  });
  test("when the override is not set, mode follows the real count", () => {
    expect(publicWaitlistMode(null, 0)).toBe(true);
    expect(publicWaitlistMode(null, 5)).toBe(false);
  });
  test("a missing fleet count never counts as zero", () => {
    expect(publicWaitlistMode(null, null)).toBe(false);
  });
});

describe("publicScarcityCount", () => {
  test("hidden in waitlist mode; otherwise prefers the override, then the fleet", () => {
    expect(publicScarcityCount(0, 5)).toBeNull();
    expect(publicScarcityCount(3, 5)).toBe(3);
    expect(publicScarcityCount(null, 5)).toBe(5);
    expect(publicScarcityCount(null, 0)).toBeNull();
  });
});

describe("countFleetCapacity", () => {
  const cars = [
    { id: "a", status: "available", archived_at: null },
    { id: "b", status: "available", archived_at: null },
    { id: "c", status: "rented", archived_at: null },
    { id: "d", status: "available", archived_at: "2026-01-01" },
    { id: "e", status: "maintenance", archived_at: null },
    { id: "f", status: "Available", archived_at: null },
  ];
  test("counts unarchived Available cars that are not on an active rental", () => {
    expect(countFleetCapacity(cars, [])).toBe(3);
    expect(countFleetCapacity(cars, ["b"])).toBe(2);
    expect(countFleetCapacity(cars, new Set(["a", "b", "f"]))).toBe(0);
  });
});

describe("approved waitlist positions", () => {
  const rows = [
    { id: "late", approvedAt: "2026-11-17T15:00:00Z", addedAt: "2026-11-17T15:01:00Z" },
    { id: "first", approvedAt: "2026-11-10T12:00:00Z", addedAt: "2026-11-17T14:00:00Z" },
    { id: "mid", approvedAt: null, addedAt: "2026-11-12T08:00:00Z", createdAt: "2026-11-01T00:00:00Z" },
  ];
  test("FIFO by approved/ready time, then the hold, then a stable id", () => {
    expect(assignQueuePositions(rows)).toEqual([
      { id: "first", position: 1 },
      { id: "mid", position: 2 },
      { id: "late", position: 3 },
    ]);
    expect(positionFor(rows, "first")).toBe(1);
    expect(positionFor(rows, "missing")).toBeNull();
  });
});

describe("joined copy", () => {
  test("uses Dolmar's wording and the spot number", () => {
    const plain = waitlistJoinedPlain(3);
    expect(plain).toBe(
      "No cars are available right now, but you're #3 on our waitlist. You'll be the first contacted when a car comes back or we add one to the fleet.",
    );
    const email = waitlistJoinedEmailHtml({ fullName: "Shi Cala", position: 3, companyPhone: "(888) 000-0000" });
    expect(email.subject).toBe("You're on the REAL RENTALS waitlist");
    expect(email.html).toContain("Hi Shi");
    expect(email.html).toContain("#3");
    expect(email.html).not.toContain("<script>");
  });
});

describe("vehicle available contract", () => {
  test("webhook payload is { vehicle_id, waitlist:[{lead_id, position, name}] }", () => {
    expect(
      vehicleAvailablePayload("veh-1", [
        { lead_id: "app-1", position: 1, name: "Briana Palmer" },
        { lead_id: "app-2", position: 2, name: "  " },
      ]),
    ).toEqual({
      vehicle_id: "veh-1",
      waitlist: [
        { lead_id: "app-1", position: 1, name: "Briana Palmer" },
        { lead_id: "app-2", position: 2, name: "Applicant" },
      ],
    });
  });
  test("staff alert lists the queue in order and never invents a phone number", () => {
    const copy = vehicleAvailableAlertCopy({
      vehicleLabel: "RR-002 — 2013 Ford Fusion",
      count: 2,
      waitlist: [
        { position: 1, name: "Briana Palmer" },
        { position: 2, name: "Xiomara Ramirez" },
      ],
    });
    expect(copy.title).toBe("AVAILABLE: RR-002 — 2013 Ford Fusion - Call The Waitlist");
    expect(copy.lines).toEqual(["#1 Briana Palmer", "#2 Xiomara Ramirez"]);
    expect(JSON.stringify(copy)).not.toMatch(/\d{3}[\s.-]?\d{3}[\s.-]?\d{4}/);
  });
});

describe("quiet hours queue", () => {
  test("8 AM and 8:59 PM ET are inside the window; 7:59 AM and 9:00 PM are not", () => {
    expect(withinTextingHours(etWallTime(2026, 11, 17, 8, 0, 0))).toBe(true);
    expect(withinTextingHours(etWallTime(2026, 11, 17, 20, 59, 0))).toBe(true);
    expect(withinTextingHours(etWallTime(2026, 11, 17, 7, 59, 0))).toBe(false);
    expect(withinTextingHours(etWallTime(2026, 11, 17, 21, 0, 0))).toBe(false);
  });
  test("outside the window, the next send is 8:00 AM ET", () => {
    const evening = nextTextingWindowStart(etWallTime(2026, 11, 17, 21, 15, 0));
    expect(withinTextingHours(evening)).toBe(true);
    const etHour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" }).format(evening));
    expect(etHour).toBe(8);
    const etDay = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "2-digit", day: "2-digit" }).format(evening);
    expect(etDay).toBe("11/18");
    const early = nextTextingWindowStart(etWallTime(2026, 11, 17, 7, 0, 0));
    const earlyDay = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "2-digit", day: "2-digit" }).format(early);
    expect(earlyDay).toBe("11/17");
    const inside = etWallTime(2026, 11, 17, 10, 30, 0);
    expect(nextTextingWindowStart(inside).getTime()).toBe(inside.getTime());
  });
});

describe("proposed SQL", () => {
  test("migration and rollback are paired and additive", () => {
    const sql = readFileSync("proposed/capacity-waitlist-v1.sql", "utf8");
    const rollback = readFileSync("proposed/rollback/capacity-waitlist-v1.sql", "utf8");
    expect(sql).toContain("ALTER TABLE public.applications");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS approved_at");
    expect(sql).toContain("waitlist_notice_jobs");
    expect(sql).toContain("auto_capacity");
    expect(sql).toContain("vehicle_available");
    expect(sql).toContain("reservation_refunded");
    expect(rollback).toContain("reservation_refunded");
    expect(rollback).toContain("DROP TABLE IF EXISTS public.waitlist_notice_jobs");
    expect(rollback).toContain("DROP COLUMN IF EXISTS approved_at");
  });
});

describe("automation switch and team alert kind", () => {
  test("joined notices default OFF and the vehicle_available kind starts off", async () => {
    const catalog = await import("@/lib/automation-catalog");
    const def = catalog.AUTOMATIONS.find((a) => a.key === "waitlist_joined_notice");
    expect(def?.defaultOn).toBe(false);
    expect(def?.channels.sort()).toEqual(["Email", "SMS"]);
    expect(def?.emailWorkflows).toEqual(["application_waitlist_joined"]);
    expect(catalog.isDefaultOff("waitlist_joined_notice")).toBe(true);
    expect(catalog.isAutomationOn({ off: {}, on: {} }, "waitlist_joined_notice")).toBe(false);
    expect(catalog.isAutomationOn({ off: {}, on: { waitlist_joined_notice: { at: "t", by: "o" } } }, "waitlist_joined_notice")).toBe(true);

    const ta = await import("@/lib/team-alerts");
    expect(ta.TEAM_ALERT_KINDS).toContain("vehicle_available");
    expect(ta.readTeamAlertSettings(null).vehicle_available).toBe(false);
    expect(ta.readTeamAlertSettings({ vehicle_available: { enabled: true } }).vehicle_available).toBe(true);

    const wh = await import("@/lib/fleet-webhook.server");
    expect(wh.FLEET_CAPACITY_EVENTS).toEqual(["vehicle_available"]);
  });
});
