// Run: bun scripts/driver-payment-status.test.ts
let fail = 0, pass = 0;
const describe = (_n: string, f: () => void) => f();
const it = (n: string, f: () => void) => { try { f(); pass++; } catch (e) { fail++; console.error("FAIL", n, (e as Error).message); } };
const expect = (a: unknown) => ({
  toBe: (b: unknown) => { if (a !== b) throw new Error(`${String(a)} !== ${String(b)}`); },
  toEqual: (b: unknown) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${JSON.stringify(a)} != ${JSON.stringify(b)}`); },
  not: { toBe: (b: unknown) => { if (a === b) throw new Error(`unexpected ${String(b)}`); } },
});
import { derivePaymentStatus as s, deriveDepositDisplay as d, type PayRental, type PayRow } from "../src/lib/driver-payment-status";

const T = new Date("2026-10-08T12:00:00Z");
const R = (o: Partial<PayRental> = {}): PayRental => ({ id: "r", status: "active", deposit_amount: null, deposit_held: false, deposit_status: null, deposit_refund_amount: null, ...o });
const P = (o: Partial<PayRow> = {}): PayRow => ({ rental_id: "r", type: "rent", amount: 350, balance_due: 350, net_collected: null, refunded_amount: 0, status: "current", due_date: "2026-10-08", ...o });

describe("payment status", () => {
  it("new / waitlisted / approved applicant with nothing → —", () => expect(s([], [], T)).toBe("none"));
  it("no payments is never Current", () => expect(s([R()], [], T)).not.toBe("current"));
  it("assigned/active rental, nothing due yet → Not Due", () => {
    expect(s([R()], [], T)).toBe("not_due");
    expect(s([R()], [P({ due_date: "2026-10-15" })], T)).toBe("not_due");
  });
  it("due today → Due; processing counts as Due", () => {
    expect(s([R()], [P()], T)).toBe("due");
    expect(s([R()], [P({ status: "pending" })], T)).toBe("due");
  });
  it("partial balance → Partial", () => expect(s([R()], [P({ balance_due: 100 })], T)).toBe("partial"));
  it("past due date or late status → Overdue", () => {
    expect(s([R()], [P({ due_date: "2026-10-01" })], T)).toBe("overdue");
    expect(s([R()], [P({ status: "past_due", due_date: "2026-10-20" })], T)).toBe("overdue");
  });
  it("failed wins over overdue and partial", () =>
    expect(s([R()], [P({ due_date: "2026-10-01" }), P({ balance_due: 10 }), P({ status: "failed" })], T)).toBe("failed"));
  it("all paid → Current (active, returned, closed)", () => {
    const paid = [P({ status: "paid", balance_due: 0, due_date: "2026-10-01" })];
    expect(s([R()], paid, T)).toBe("current");
    expect(s([R({ status: "ended" })], paid, T)).toBe("current");
  });
  it("closed rental with no charges → —", () => expect(s([R({ status: "ended" })], [], T)).toBe("none"));
  it("deposit payments and void/waived rows don't drive payment status", () =>
    expect(s([], [P({ type: "deposit", status: "failed" }), P({ status: "void" })], T)).toBe("none"));
});

describe("deposit display", () => {
  it("no obligation → —", () => expect(d([R()], []).text).toBe("—"));
  it("required but unpaid", () => expect(d([R({ deposit_amount: 500 })], [])).toEqual({ text: "$0", detail: "Unpaid · $500 Due" }));
  it("partially paid", () => expect(d([R({ deposit_amount: 500 })], [P({ type: "deposit", status: "paid", amount: 200, net_collected: 200 })]).detail).toBe("Partial Of $500"));
  it("held", () => expect(d([R({ deposit_amount: 500, deposit_held: true })], []).detail).toBe("Held"));
  it("refunded / partly refunded / applied", () => {
    expect(d([R({ deposit_amount: 500, deposit_status: "refunded", deposit_refund_amount: 500 })], [])).toEqual({ text: "$500", detail: "Refunded" });
    expect(d([R({ deposit_amount: 500, deposit_status: "partially_refunded", deposit_refund_amount: 300 })], []).detail).toBe("Partly Refunded");
    expect(d([R({ deposit_amount: 500, deposit_status: "forfeited" })], []).detail).toBe("Applied");
  });
});

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
