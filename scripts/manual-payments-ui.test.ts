import { describe, it, expect } from "vitest";
import { validateRecord, validateVerify, validateReason, validateExtend, sweepExpired, reserved, addHours, type Collection, type Charge } from "../src/lib/manual-payments";

const now = new Date("2026-10-08T20:00:00Z");
const charge: Charge = { id: "c1", amount: 350, balance: 350, status: "current" };
const base = { method: "zelle" as const, amount: 100, receivedOn: "2026-10-08", reference: "ZL-1", hasReceipt: false };
const coll = (o: Partial<Collection> = {}): Collection => ({ id: "p1", chargeId: "c1", method: "zelle", amount: 100, receivedOn: "2026-10-08", reference: "ZL-1", hasReceipt: true, status: "pending", recordedBy: "mgrA", recordedAt: now.toISOString(), expiresAt: addHours(now, 48), audit: [], ...o });

describe("record", () => {
  it("allows staff, refuses driver", () => {
    expect(validateRecord(base, charge, [], "coordinator", now)).toBeNull();
    expect(validateRecord(base, charge, [], "driver", now)).toMatch(/Not allowed/);
  });
  it("method evidence", () => {
    expect(validateRecord({ ...base, reference: "" }, charge, [], "manager", now)).toMatch(/receipt or a transaction/);
    expect(validateRecord({ ...base, method: "check", reference: "" }, charge, [], "manager", now)).toMatch(/check image/);
    expect(validateRecord({ ...base, method: "cash", reference: "" }, charge, [], "manager", now)).toMatch(/Cash needs/);
  });
  it("refuses overpayment incl. live reservations, future dates, duplicates, Stripe in progress", () => {
    expect(validateRecord({ ...base, amount: 400 }, charge, [], "manager", now)).toMatch(/more than/);
    expect(validateRecord({ ...base, amount: 300, reference: "x" }, charge, [coll()], "manager", now)).toMatch(/already pending/);
    expect(validateRecord({ ...base, receivedOn: "2026-10-09" }, charge, [], "manager", now)).toMatch(/future/);
    expect(validateRecord({ ...base, reference: "zl 1" }, charge, [coll()], "manager", now)).toMatch(/already recorded/);
    expect(validateRecord(base, { ...charge, stripeInProgress: true }, [], "manager", now)).toMatch(/card payment/);
  });
});

describe("verify", () => {
  it("separation of duties", () => {
    expect(validateVerify(coll(), charge, [], "manager", "mgrA", true, "bank app", "", now)).toMatch(/Another Manager/);
    expect(validateVerify(coll(), charge, [], "manager", "mgrB", true, "bank app", "", now)).toBeNull();
    expect(validateVerify(coll(), charge, [], "coordinator", "x", true, "n", "", now)).toMatch(/Only a Manager/);
    expect(validateVerify(coll({ recordedBy: "own" }), charge, [], "owner", "own", true, "n", "", now)).toMatch(/exception reason/);
    expect(validateVerify(coll({ recordedBy: "own" }), charge, [], "owner", "own", true, "n", "Only staff on site", now)).toBeNull();
  });
  it("cash needs Owner; proof required; expired blocked; atomic balance recheck", () => {
    expect(validateVerify(coll({ method: "cash" }), charge, [], "manager", "mgrB", true, "n", "", now)).toMatch(/Owner verification/);
    expect(validateVerify(coll(), charge, [], "manager", "mgrB", false, "n", "", now)).toMatch(/screenshot alone/);
    expect(validateVerify(coll({ expiresAt: addHours(now, -1) }), charge, [], "manager", "mgrB", true, "n", "", now)).toMatch(/expired/);
    expect(validateVerify(coll(), { ...charge, balance: 50 }, [], "manager", "mgrB", true, "n", "", now)).toMatch(/more than/);
  });
});

describe("reject / reverse / extend / expiry", () => {
  it("reasons and states", () => {
    expect(validateReason("manager", coll(), "pending", "")).toMatch(/reason/);
    expect(validateReason("manager", coll({ status: "verified" }), "verified", "bounced")).toBeNull();
    expect(validateExtend("manager", coll(), "x", now)).toMatch(/Only the Owner/);
    expect(validateExtend("owner", coll({ status: "expired" }), "driver traveling", now)).toBeNull();
  });
  it("expiry releases reservation and keeps history", () => {
    const all = [coll({ expiresAt: addHours(now, -1) })];
    expect(reserved("c1", all, now)).toBe(0);
    const swept = sweepExpired(all, now);
    expect(swept[0].status).toBe("expired");
    expect(swept[0].audit.at(-1)?.actor).toBe("system");
  });
});

import { validateReconcile } from "../src/lib/manual-payments";
import { readFileSync } from "node:fs";
describe("expired reconciliation, partials, isolation", () => {
  it("expired blocks duplicate re-entry; reconcile rules", () => {
    const exp = coll({ status: "expired" });
    expect(validateRecord({ ...base }, charge, [exp], "manager", now)).toMatch(/already recorded/);
    const cash = coll({ status: "expired", method: "cash", reference: undefined });
    expect(validateRecord({ method: "cash", amount: 100, receivedOn: "2026-10-08", hasReceipt: false, cashRecipient: "A", notes: "n" }, charge, [cash], "manager", now)).toMatch(/reconcile/);
    expect(validateReconcile("coordinator", exp, charge, [exp], "r", now)).toMatch(/Only a Manager/);
    expect(validateReconcile("manager", exp, charge, [exp], "", now)).toMatch(/reason/);
    expect(validateReconcile("manager", exp, charge, [exp], "funds found", now)).toBeNull();
    expect(validateReconcile("manager", exp, { ...charge, balance: 50 }, [exp], "r", now)).toMatch(/more than/);
  });
  it("partial payments allowed up to balance", () => {
    expect(validateRecord({ ...base, amount: 50 }, charge, [], "manager", now)).toBeNull();
    expect(validateRecord({ ...base, amount: 250, reference: "b" }, charge, [coll()], "manager", now)).toBeNull();
  });
  it("practice screen has no database, storage or Stripe access", () => {
    const src = readFileSync("src/components/admin/ManualPaymentsWorkspace.tsx", "utf8");
    expect(src).not.toMatch(/supabase|stripe|createServerFn|\.functions"|fetch\(/i);
    expect(src).toMatch(/MANUAL_PAYMENTS_LIVE/);
  });
});
