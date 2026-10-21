import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fmtDate, fmtDateTime, fmtDateNumeric } from "../src/lib/date-format";
describe("date-format", () => {
  it("preserves date-only calendar dates", () => {
    assert.equal(fmtDate("2026-10-21"), "Oct 21, 2026");
    assert.equal(fmtDate("2026-01-01"), "Jan 1, 2026");
    assert.equal(fmtDateNumeric("2026-10-21"), "10/21/2026");
  });
  it("renders instants in Eastern time, including the ET label", () => {
    assert.equal(fmtDateTime("2026-10-11T11:30:00.000Z"), "Oct 11, 2026, 7:30 AM ET");
    assert.equal(fmtDateTime("2026-01-11T12:30:00.000Z"), "Jan 11, 2026, 7:30 AM ET");
    assert.equal(fmtDateTime("2026-10-11"), "Oct 11, 2026, 12:00 AM ET");
  });
  it("handles empty and invalid inputs", () => {
    assert.equal(fmtDate(null), ""); assert.equal(fmtDate("nope"), ""); assert.equal(fmtDateNumeric(undefined), "");
  });
});
