// Effective oil next-due miles and the mileage-photo reminder. Read-time only.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  DEFAULT_OIL_CHANGE_INTERVAL_MILES,
  OIL_CHANGE_REMINDER_WINDOW_MILES,
  autoNextDueTooltip,
  companyOilChangeIntervalMiles,
  effectiveOilNextDue,
  lastCompletedOilServiceMiles,
  oilChangeReminderEligibility,
  oilDueMilesForAlert,
  oilReminderCycleKey,
} from "../src/lib/oil-next-due";
import { DEFAULT_OIL_INTERVAL_MILES, shapeVehicleMaintenance } from "../src/lib/vehicle-maintenance";
import { vehicleReadinessChecks } from "../src/lib/vehicle-readiness";

const ODO = 139224;

describe("effective oil next due", () => {
  test("5,000 lives in one constant", () => {
    expect(DEFAULT_OIL_CHANGE_INTERVAL_MILES).toBe(5000);
    expect(DEFAULT_OIL_INTERVAL_MILES).toBe(DEFAULT_OIL_CHANGE_INTERVAL_MILES);
    expect(OIL_CHANGE_REMINDER_WINDOW_MILES).toBe(500);
  });

  test("explicit miles win over a service record, the odometer, and Settings", () => {
    const due = effectiveOilNextDue({
      explicitNextDueMiles: 140000,
      lastOilServiceMiles: 130000,
      latestOdometerMiles: ODO,
      settingsIntervalMiles: 3000,
    });
    expect(due).toMatchObject({ miles: 140000, source: "explicit", baseMiles: null, baseKind: null });
  });

  test("a completed oil change service record plus the interval beats the odometer", () => {
    const miles = lastCompletedOilServiceMiles([
      { status: "open", item: "Oil Change", performed_on: "2026-11-01", odometer: 200000 },
      { status: "completed", item: "Oil Filter", performed_on: "2026-10-20", odometer: 180000 },
      { status: "completed", item: "Oil Change", performed_on: "2026-01-01", odometer: 100000 },
      { status: "completed", item: "Synthetic Oil Change", performed_on: "2026-10-01", odometer: 130000 },
    ]);
    expect(miles).toBe(130000);
    const due = effectiveOilNextDue({
      explicitNextDueMiles: null,
      lastOilServiceMiles: miles,
      latestOdometerMiles: ODO,
      settingsIntervalMiles: null,
    });
    expect(due).toMatchObject({
      miles: 135000,
      source: "auto",
      baseMiles: 130000,
      baseKind: "service",
      intervalMiles: 5000,
    });
  });

  test("latest odometer plus 5,000 when nothing else is saved", () => {
    const due = effectiveOilNextDue({
      explicitNextDueMiles: null,
      lastOilServiceMiles: null,
      latestOdometerMiles: ODO,
      settingsIntervalMiles: null,
    });
    expect(due).toMatchObject({
      miles: 144224,
      source: "auto",
      baseMiles: ODO,
      baseKind: "odometer",
      intervalMiles: 5000,
    });
    expect(autoNextDueTooltip(ODO, 5000)).toBe("Based On 139,224 Mi + 5,000 Mi. Edit To Override.");
  });

  test("no mileage stays Not Set and does not invent a date", () => {
    const due = effectiveOilNextDue({
      explicitNextDueMiles: null,
      lastOilServiceMiles: null,
      latestOdometerMiles: null,
      settingsIntervalMiles: 4000,
    });
    expect(due.miles).toBeNull();
    expect(due.source).toBe("unset");
    const view = shapeVehicleMaintenance({
      vehicle: { id: "v", license_plate: "SIVZ88", vin: "1HGCM82633A171975", current_odometer: null },
      schedules: [{ id: "s", item: "Oil Change", next_due_miles: null, next_due_on: null, is_active: true }],
      readings: [],
      records: [],
    });
    expect(view.next_service_due.next_due_miles).toBeNull();
    expect(view.next_service_due.effective_next_due_miles).toBeNull();
    expect(view.next_service_due.next_due_source).toBe("unset");
    expect(view.next_service_due.next_due_on).toBeNull();
  });

  test("a Settings oil change interval overrides 5,000", () => {
    expect(
      companyOilChangeIntervalMiles([
        { item: "Oil Filter", category: "oil_change", interval_miles: 15000, is_active: true },
        { item: "Oil Change", interval_miles: 4000, is_active: true },
        { item: "Oil Change", interval_miles: 9000, is_active: false },
      ]),
    ).toBe(4000);
    const due = effectiveOilNextDue({
      explicitNextDueMiles: null,
      lastOilServiceMiles: null,
      latestOdometerMiles: ODO,
      settingsIntervalMiles: 4000,
    });
    expect(due.miles).toBe(143224);
    expect(due.intervalMiles).toBe(4000);
    const view = shapeVehicleMaintenance({
      vehicle: { id: "v", current_odometer: ODO, license_plate: "SIVZ88", vin: "1HGCM82633A171975" },
      schedules: [{ id: "s", item: "Oil Change", next_due_miles: null, next_due_on: null, is_active: true }],
      readings: [{ id: "r", mileage: ODO, observed_on: "2026-11-09", status: "valid" }],
      records: [],
      settingsIntervals: [{ item: "Oil Change", interval_miles: 4000, is_active: true }],
    });
    expect(view.next_service_due.next_due_miles).toBeNull();
    expect(view.next_service_due.effective_next_due_miles).toBe(143224);
    expect(view.next_service_due.next_due_source).toBe("auto");
    expect(view.next_service_due.auto_interval_miles).toBe(4000);
    expect(view.next_service_due.next_due_on).toBeNull();
  });

  test("the service card keeps a saved mileage explicit", () => {
    const view = shapeVehicleMaintenance({
      vehicle: { id: "v", current_odometer: ODO },
      schedules: [{ id: "s", item: "Oil Change", next_due_miles: 140000, next_due_on: "2026-12-01", is_active: true }],
      readings: [],
      records: [],
      oilRecords: [{ status: "completed", item: "Oil Change", performed_on: "2026-10-01", odometer: 130000 }],
    });
    expect(view.next_service_due.next_due_miles).toBe(140000);
    expect(view.next_service_due.effective_next_due_miles).toBe(140000);
    expect(view.next_service_due.next_due_source).toBe("explicit");
    expect(view.next_service_due.auto_base_miles).toBeNull();
    expect(view.next_service_due.next_due_on).toBe("2026-12-01");
  });
});

describe("mileage photo reminder", () => {
  const fresh = {
    vehicleId: "v1",
    hasCurrentRenter: true,
    effectiveDueMiles: ODO + OIL_CHANGE_REMINDER_WINDOW_MILES,
    latestOdometerMiles: ODO,
    latestReadingOn: "2026-11-20",
    today: "2026-11-23",
    pendingCycleKey: null as string | null,
    fullName: "Sam Rivera",
    year: 2019,
    make: "Toyota",
    model: "Camry",
  };

  test("within 500 miles on a fresh reading", () => {
    const decision = oilChangeReminderEligibility(fresh);
    expect(decision.eligible).toBe(true);
    if (!decision.eligible) return;
    expect(decision.reason).toBe("within_window");
    expect(decision.milesRemaining).toBe(500);
    expect(decision.draft).toBe(
      "Hi Sam, it's Rosa with REAL RENTALS. Your 2019 Toyota Camry is coming up on an oil change. Please reply with a clear photo of your dashboard showing the current miles so we can schedule it. Don't worry, we pay for the oil change!",
    );
  });

  test("501 miles remaining is not due", () => {
    const decision = oilChangeReminderEligibility({ ...fresh, effectiveDueMiles: ODO + 501 });
    expect(decision).toMatchObject({ eligible: false, reason: "not_due" });
  });

  test("overdue when the odometer has reached the effective due mileage", () => {
    const decision = oilChangeReminderEligibility({ ...fresh, effectiveDueMiles: ODO });
    expect(decision.eligible).toBe(true);
    if (!decision.eligible) return;
    expect(decision.reason).toBe("overdue");
    expect(decision.milesRemaining).toBe(0);
  });

  test("a reading older than 14 days asks for a photo even when miles remain", () => {
    const decision = oilChangeReminderEligibility({
      ...fresh,
      effectiveDueMiles: 160000,
      latestReadingOn: "2026-10-01",
      today: "2026-11-23",
    });
    expect(decision.eligible).toBe(true);
    if (!decision.eligible) return;
    expect(decision.reason).toBe("stale_reading");
    expect(decision.reasonLabel).toBe("Mileage Reading Older Than 14 Days");
  });

  test("a reading exactly 14 days old is still fresh", () => {
    const decision = oilChangeReminderEligibility({
      ...fresh,
      effectiveDueMiles: 160000,
      latestReadingOn: "2026-11-09",
      today: "2026-11-23",
    });
    expect(decision).toMatchObject({ eligible: false, reason: "not_due" });
  });

  test("no current renter", () => {
    const decision = oilChangeReminderEligibility({ ...fresh, hasCurrentRenter: false, effectiveDueMiles: 1000 });
    expect(decision).toMatchObject({ eligible: false, reason: "no_renter" });
  });

  test("one pending reminder per vehicle per due cycle", () => {
    const cycleKey = oilReminderCycleKey("v1", fresh.effectiveDueMiles);
    const pending = oilChangeReminderEligibility({ ...fresh, pendingCycleKey: cycleKey });
    expect(pending).toMatchObject({ eligible: false, reason: "already_pending", cycleKey });
    const nextCycle = oilChangeReminderEligibility({ ...fresh, pendingCycleKey: oilReminderCycleKey("v1", 100000) });
    expect(nextCycle.eligible).toBe(true);
  });
});

describe("due indicators use the effective miles", () => {
  test("readiness overdue follows explicit ?? computed for oil", () => {
    const miles = oilDueMilesForAlert("Oil Change", null, {
      lastOilServiceMiles: null,
      latestOdometerMiles: ODO,
      settingsIntervalMiles: null,
    });
    expect(miles).toBe(144224);
    expect(oilDueMilesForAlert("Brakes", null, { lastOilServiceMiles: 1, latestOdometerMiles: ODO, settingsIntervalMiles: 4000 })).toBeNull();
    expect(oilDueMilesForAlert("Oil Change", 140000, { lastOilServiceMiles: 130000, latestOdometerMiles: ODO, settingsIntervalMiles: 4000 })).toBe(140000);
    const today = new Date("2026-10-09T12:00:00");
    const facts = {
      lastPreDeliveryPassedAt: "2026-10-01T00:00:00Z",
      schedules: [{ item: "Oil Change", next_due_on: null, next_due_miles: miles }],
      openIssues: [],
      openIncidents: [],
      hasActiveRental: true,
    };
    const vehicle = {
      year: 2020,
      make: "Toyota",
      model: "Camry",
      vin: "4T1B11HK5LU000001",
      weekly_rate: 350,
      license_plate: "ABC",
      plate_expires_on: "2027-01-01",
      registration_expires_on: "2027-06-01",
      insurance_expires_on: "2027-06-01",
      current_odometer: 144224,
    };
    const overdue = vehicleReadinessChecks(vehicle, facts, ["registration", "insurance_card"], today);
    expect(overdue.find((check) => check.key === "maintenance")?.value).toBe("Overdue");
    const ahead = vehicleReadinessChecks({ ...vehicle, current_odometer: ODO }, facts, ["registration", "insurance_card"], today);
    expect(ahead.find((check) => check.key === "maintenance")?.value).toBe("Up to Date");
  });
});

describe("reminder ui does not send", () => {
  test("the draft path has copy text and no sender", () => {
    const notice = readFileSync("src/components/admin/OilChangePhotoNotice.tsx", "utf8");
    const server = readFileSync("src/lib/oil-next-due.server.ts", "utf8");
    const fn = readFileSync("src/lib/oil-change-reminder.functions.ts", "utf8");
    const rules = readFileSync("src/lib/oil-next-due.ts", "utf8");
    for (const source of [notice, server, fn, rules]) {
      expect(source).not.toContain("sendSms");
      expect(source).not.toContain(".insert(");
      expect(source).not.toContain(".update(");
      expect(source).not.toContain(".delete(");
    }
    expect(notice).toContain("Copy Text");
    expect(notice).toContain("Nothing Is Sent From This Draft.");
    expect(notice).not.toContain("Send Text");
  });
});
