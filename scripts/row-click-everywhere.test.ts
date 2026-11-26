import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { rowNav, rowOpenProps, ROW_OPEN_CLASS } from "../src/lib/row-click.ts";

const read = (p: string) => readFileSync(new URL(`../src/components/admin/${p}`, import.meta.url), "utf8");

describe("rowNav", () => {
  it("opens the record on a plain click and on Enter/Space", () => {
    const calls: unknown[] = [];
    const nav = (o: unknown) => calls.push(o);
    const row = {};
    const p = rowNav(nav, { tab: "drivers", id: "a1" }, "border-t");
    assert.match(p.className, /border-t/);
    assert.ok(p.className.includes(ROW_OPEN_CLASS));
    assert.equal(p.tabIndex, 0);
    p.onClick!({ target: row, currentTarget: row });
    assert.deepEqual(calls, [{ to: "/admin", search: { tab: "drivers", id: "a1" } }]);
    let prevented = false;
    p.onKeyDown!({ key: "Enter", target: row, currentTarget: row, preventDefault: () => (prevented = true) });
    p.onKeyDown!({ key: " ", target: row, currentTarget: row, preventDefault: () => {} });
    assert.equal(prevented, true);
    assert.equal(calls.length, 3);
  });
  it("ignores clicks that start on a button, link, select or menu item", () => {
    const calls: unknown[] = [];
    const row = { contains: () => true };
    const p = rowNav((o: unknown) => calls.push(o), { tab: "vehicles", id: "v1" });
    for (const hit of ["button", "a", "select", "[role=menuitem]"]) {
      const target = { closest: (s: string) => (s.includes(hit.replace(/[\[\]]/g, "")) ? {} : null) };
      p.onClick!({ target, currentTarget: row });
    }
    assert.equal(calls.length, 0);
  });
  it("stays a plain row when there is nowhere to go", () => {
    const p = rowNav(() => {}, null, "border-b");
    assert.deepEqual(p, { className: "border-b" });
  });
  it("Enter on an inner control does not open the row", () => {
    let opened = 0;
    const props = rowOpenProps(() => opened++);
    const self = {};
    props.onKeyDown({ key: "Enter", target: self, currentTarget: self, preventDefault() {} });
    props.onKeyDown({ key: "Enter", target: { inner: 1 }, currentTarget: {}, preventDefault() {} });
    assert.equal(opened, 1);
  });
});

// Every list that has a record to open must use the shared row helpers.
const ROW_FILES: Record<string, number> = {
  "BookingsPanel.tsx": 2, "ReservationsPanel.tsx": 1, "ActiveRentalsPanel.tsx": 1, "PendingSignatures.tsx": 1,
  "DriversPanel.tsx": 2, "VehiclesPanel.tsx": 2, "PaymentsPanel.tsx": 1, "ExpensesPanel.tsx": 2,
  "IncidentsPanel.tsx": 1, "IncidentBoard.tsx": 1, "InspectionsPanel.tsx": 1, "VendorsPanel.tsx": 1,
  "MaintenancePanel.tsx": 5, "MaintenanceDue.tsx": 1, "MaintenanceSchedules.tsx": 1, "VehicleService.tsx": 1,
  "DocumentsExpiring.tsx": 1, "ApprovedNotRenting.tsx": 1, "StalledApplications.tsx": 1,
  "ApplicationResumeReminders.tsx": 1, "ApplicationDocGaps.tsx": 1, "OnboardingChecklist.tsx": 1,
  "FleetAvailability.tsx": 1, "WaitlistPanel.tsx": 1, "OverviewToday.tsx": 1, "LeadPriorities.tsx": 1,
  "RenewalsDue.tsx": 3, "VehicleTurnaround.tsx": 1, "TollsTickets.tsx": 1, "AutomationsPanel.tsx": 1,
  "VehicleDefaultsPanel.tsx": 1, "PaperAgreements.tsx": 1, "ReceivablesAgingPanel.tsx": 1,
  "DepositLedgerPanel.tsx": 1, "DepositsLedgerPanel.tsx": 2, "StripeRiskMonitorPanel.tsx": 1,
  "StripePayoutReconPanel.tsx": 1, "StripeMatchPanel.tsx": 1, "RentReconciliationPanel.tsx": 1,
  "RentAgingPanel.tsx": 1, "BillingHealthPanel.tsx": 1, "VehicleProfitPanel.tsx": 1,
  "RevenueForecastPanel.tsx": 1, "FinanceDepositLedgerPanel.tsx": 1, "FinanceDataQualityPanel.tsx": 1,
  "CollectionsWatchPanel.tsx": 3,
};
describe("whole-row click coverage", () => {
  for (const [file, min] of Object.entries(ROW_FILES)) {
    it(`${file} wires ${min}+ row(s) through row-click`, () => {
      const src = read(file);
      const uses = (src.match(/rowNav\(|rowOpenProps\(/g) ?? []).length;
      assert.ok(uses >= min, `${file}: found ${uses}, expected ${min}`);
      assert.ok(src.includes("@/lib/row-click"));
    });
  }
  it("no row still uses a bare onClick on <tr>/<li> without keyboard access", () => {
    for (const f of ["VehiclesPanel.tsx", "BookingsPanel.tsx"]) {
      assert.doesNotMatch(read(f), /<(tr|div)[^>]*key=\{(v|b)\.id\}[^>]*\sonClick=\{\(\) => setViewing/);
    }
  });
});
