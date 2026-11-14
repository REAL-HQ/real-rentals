import { expect, test } from "bun:test";
import { driverLifecycle } from "../src/lib/driver-lifecycle";

/** Presentation rule: a saved interview completion proves we reached them. */
const base = {
  contacted: false,
  screening: false,
  approved: false,
  inspection: false,
  agreement: false,
  rentalActive: false,
};

const stateOf = (l: ReturnType<typeof driverLifecycle>, key: string) =>
  l.stages.find((s) => s.key === key)?.state;

test("a completed interview turns Contacted done with no contacted date", () => {
  const l = driverLifecycle({ ...base, interviewComplete: true });
  expect(stateOf(l, "contacted")).toBe("done");
  expect(l.current.key).toBe("documents");
});

test("no interview and no contact leaves Contacted not done", () => {
  const l = driverLifecycle({ ...base });
  expect(stateOf(l, "contacted")).not.toBe("done");
  expect(l.current.key).toBe("contacted");
});

test("an interview completion completes Contacted only, never later stages", () => {
  const l = driverLifecycle({ ...base, interviewComplete: true });
  for (const key of ["documents", "screening", "approved", "agreement", "reserved", "insurance", "inspection", "pickup", "active"]) {
    expect(stateOf(l, key)).not.toBe("done");
  }
});
