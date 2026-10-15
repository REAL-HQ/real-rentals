import assert from "node:assert/strict";
import {
  currentMileage,
  observationMicros,
  dueStatus,
  milesDriven,
  isOdometerConflict,
} from "../../src/lib/maintenance-rules.ts";
const tests = [];
const check = (test, fn) => {
  fn();
  tests.push({ test, result: "PASS" });
};
const id = (n) => "00000000-0000-0000-0000-" + String(n).padStart(12, "0");
const r = (n, m, t, d = "2026-11-01") => ({
  id: id(n),
  mileage: m,
  observed_at: t,
  observed_on: d,
  status: "valid",
});
const win = (rows) => currentMileage(rows)?.id;
check("Microseconds preserved below one millisecond", () =>
  assert.equal(
    win([r(9, 1200, "2026-11-01T15:00:00.000001Z"), r(1, 1100, "2026-11-01T15:00:00.000002Z")]),
    id(1),
  ),
);
check("Equivalent offset microseconds tie by UUID", () =>
  assert.equal(
    win([
      r(2, 1100, "2026-11-01T15:00:00.123456Z"),
      r(3, 1000, "2026-11-01T10:00:00.123456-05:00"),
    ]),
    id(3),
  ),
);
check("Fraction padding same exact instant", () =>
  assert.equal(
    observationMicros("2026-11-01T15:00:00.1Z"),
    observationMicros("2026-11-01T15:00:00.100000Z"),
  ),
);
check("Input order independent at identical timestamp", () => {
  let a = r(1, 1500, "2026-11-01T15:00:00Z"),
    b = r(2, 1400, "2026-11-01T15:00:00Z");
  assert.equal(win([a, b]), id(2));
  assert.equal(win([b, a]), id(2));
});
check("Missing ID rejected", () =>
  assert.throws(
    () => currentMileage([{ ...r(1, 1, null), id: undefined }]),
    /stable_reading_id_required/,
  ),
);
check("Invalid ID rejected", () =>
  assert.throws(
    () => currentMileage([{ ...r(1, 1, null), id: "not-uuid" }]),
    /stable_reading_id_required/,
  ),
);
check("Duplicate ID rejected", () =>
  assert.throws(() => currentMileage([r(1, 1, null), r(1, 2, null)]), /duplicate_reading_id/),
);
check("Uppercase canonical UUID supported", () =>
  assert.equal(
    currentMileage([{ ...r(1, 1, null), id: "ABCDEFAB-0000-0000-0000-000000000001" }]).mileage,
    1,
  ),
);
check("Date-only cannot displace timed same day", () =>
  assert.equal(win([r(9, 1900, null), r(1, 1100, "2026-11-01T15:00:00Z")]), id(1)),
);
check("Newer date-only observation wins by date", () =>
  assert.equal(win([r(9, 1900, null), r(1, 1100, null, "2026-11-02")]), id(1)),
);
check("Newer lower mileage wins", () =>
  assert.equal(
    win([r(9, 1900, "2026-11-01T15:00:00Z"), r(1, 1800, "2026-11-01T15:00:00.000001Z")]),
    id(1),
  ),
);
check("Conflicting observation date rejected", () =>
  assert.throws(
    () => currentMileage([r(1, 1, "2026-11-02T15:00:00Z")]),
    /observation_date_time_conflict/,
  ),
);
check("New York date rather than UTC date validated", () =>
  assert.equal(win([r(1, 1, "2026-11-02T01:00:00Z")]), id(1)),
);
check("DST repeated hour ordered by absolute instant", () =>
  assert.equal(
    win([r(2, 2, "2026-11-01T01:30:00-04:00"), r(1, 1, "2026-11-01T01:30:00-05:00")]),
    id(1),
  ),
);
check("Impossible date rejected", () =>
  assert.throws(() => currentMileage([r(1, 1, null, "2026-02-30")]), /invalid_observation_date/),
);
check("Missing timezone rejected", () =>
  assert.throws(() => observationMicros("2026-11-01T10:00:00"), /invalid_observation_timestamp/),
);
check("Excess precision rejected rather than rounded", () =>
  assert.throws(
    () => observationMicros("2026-11-01T10:00:00.1234567Z"),
    /invalid_observation_timestamp/,
  ),
);
check("Invalid hour rejected", () =>
  assert.throws(() => observationMicros("2026-11-01T25:00:00Z"), /invalid_observation_timestamp/),
);
check("Pre-epoch fractions remain exact", () =>
  assert.equal(observationMicros("1969-12-31T23:59:59.999999Z"), -1n),
);
check("Conflict records excluded", () =>
  assert.equal(currentMileage([{ ...r(1, 1, null), status: "conflict" }]), null),
);
check("Unpersisted conflict prechecks remain compatible", () =>
  assert.equal(
    isOdometerConflict([{ mileage: 2000, observed_on: "2026-11-01", status: "valid" }], {
      mileage: 100,
      observed_on: "2026-11-02",
    }),
    true,
  ),
);
check("Maintenance threshold unchanged", () =>
  assert.equal(
    dueStatus(
      {
        item: "test",
        interval_miles: 100,
        last_done_miles: 1000,
        interval_days: null,
        last_done_on: null,
      },
      1100,
      "2026-11-01",
    ).state,
    "due",
  ),
);
check("Rental mileage calculation unchanged", () => assert.equal(milesDriven(1000, 1100), 100));
check("Input history untouched", () => {
  const rows = [r(9, 2, null), r(1, 1, null)];
  const before = JSON.stringify(rows);
  currentMileage(rows);
  assert.equal(JSON.stringify(rows), before);
});
console.log("PARITY PASS", tests.length);
