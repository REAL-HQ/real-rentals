import { test, expect } from "vitest";
import { basisOf, accrualNet, cashNet, requiredSensitivity, normalizeReference, type LedgerRow } from "../src/lib/financial-ledger";

test("basis per type", () => {
  expect(basisOf("invoice")).toBe("accrual");
  expect(basisOf("payment")).toBe("cash");
  expect(basisOf("expense")).toBe("both");
});

test("invoice + its payment counted once per view", () => {
  const rows: LedgerRow[] = [
    { txn_type: "invoice", basis: "accrual", direction: "out", status: "posted", amount: 1334.26, recognition_date: "2026-09-10", cash_date: null },
    { txn_type: "payment", basis: "cash", direction: "out", status: "posted", amount: 1334.26, recognition_date: null, cash_date: "2026-09-20" },
  ];
  expect(accrualNet(rows, "2026-09-01", "2026-09-30")).toBe(-1334.26);
  expect(cashNet(rows, "2026-09-01", "2026-09-30")).toBe(-1334.26);
});

test("reversal nets to zero; proposed rows never count", () => {
  const rows: LedgerRow[] = [
    { txn_type: "expense", basis: "both", direction: "out", status: "reversed", amount: 100, recognition_date: "2026-09-01", cash_date: "2026-09-01" },
    { txn_type: "expense", basis: "both", direction: "in", status: "posted", amount: 100, recognition_date: "2026-09-02", cash_date: "2026-09-02" },
    { txn_type: "expense", basis: "both", direction: "out", status: "proposed", amount: 999, recognition_date: "2026-09-02", cash_date: "2026-09-02" },
  ];
  expect(accrualNet(rows, "2026-09-01", "2026-09-30")).toBe(0);
  expect(cashNet(rows, "2026-09-01", "2026-09-30")).toBe(0);
});

test("acquisition and financing are owner-only", () => {
  expect(requiredSensitivity("capital_expenditure", "acquisition")).toBe("owner_only");
  expect(requiredSensitivity("financing_payment", "loan")).toBe("owner_only");
  expect(requiredSensitivity("expense", "maintenance")).toBe("standard");
});

test("reference normalization is a hint", () => {
  expect(normalizeReference("inv-0O1l")).toBe("1NV0011");
  expect(normalizeReference("a")).toBeNull();
});
