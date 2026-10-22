import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { railEntries, visibleTabs } from "../src/components/admin/nav-config";
import { FINANCE_JV_STATEMENT_ENABLED } from "../src/lib/jv-statement-flag";
import {
  OPERATING_EXPENSE_NOTE,
  PARTNER_REVENUE_BASE,
  VEHICLE_PL_DOUBLE_COUNT_NOTE,
  buildJvStatement,
  etYmd,
  periodWindow,
  type JvCharge,
  type JvDirectory,
  type JvExpense,
  type JvMaintenance,
  type JvPayment,
} from "../src/lib/jv-statement";
import { loadJvDirectory, runJvStatement } from "../src/lib/jv-statement.server";
import { readJvCharges, type ReadOnlyStripeGateway } from "../src/lib/jv-statement-read.server";

/**
 * Worked example. October 2026, Eastern Time. Vehicle 2022 Toyota Camry · JV100.
 * Partner North Side JV keeps 60% of net income. The company keeps the rest.
 *
 * Income kept
 *   Stripe charge ch_rent            $400.00  PaymentIntent pi_1, invoice in_1, metadata paymentIds pay-stripe
 *   Cash App pay-cash                 $75.50
 *   Zelle pay-zelle                   $40.00
 *   Venmo pay-venmo                   $25.00
 *   Wire pay-wire                    $100.00  method wire_transfer
 *   Cash pay-cashbill                 $30.00
 *   Income                            $670.50
 * Income excluded, by reference, not by amount
 *   pay-stripe $400.00                same PaymentIntent as ch_rent; the charge is kept
 *   pay-dup $1.00 Cash App            same invoice in_1; the $1.00 is not compared and is not added
 *   pay-dep $500.00 cash deposit      deposits stay off the split
 *   ch_other $999.00                  another vehicle
 *   ch_none $15.00                    no single vehicle; shown apart, not in the split
 * Refunds
 *   re_zelle $20.00 succeeded         paymentIds pay-zelle
 *   pay-zelle.refunded_amount $20.00  the same refund, not counted again
 *   Net income                        $650.50
 *   Partner 60%                       $390.30
 *   Company                           $260.20
 * Expenses, each row once
 *   e-brake linked to m-brake         expense $180.00, company share $100.00, partner share $80.00
 *                                     statement uses $100 and $80
 *                                     live vehicle_pl would also add the $180 expense and the $100 share
 *   e-ins $45.00                      no service link; company cost, partner share $0
 *   m-oil, no expense row             company share $20.00, partner share $10.00, total cost $30.00
 *                                     shares are used once; total cost is not added again
 *   Company expenses                  $165.00
 *   Partner expenses                   $90.00
 *   Expenses                          $255.00
 *   Company net                        $95.20
 *   Partner net                       $300.30
 */

const NOW = new Date("2026-10-21T16:00:00.000Z");
const VEHICLE = "veh-camry";
const OTHER = "veh-other";
const PARTNER = "partner-north";

const vehicle = (id: string, partnerId: string | null) => ({
  id,
  year: 2022,
  make: "Toyota",
  model: id === VEHICLE ? "Camry" : "Corolla",
  licensePlate: id === VEHICLE ? "JV100" : "OTH1",
  partnerId,
});

const pay = (extra: Partial<JvPayment> & { id: string }): JvPayment => ({
  vehicleId: VEHICLE,
  rentalId: null,
  type: "rent",
  status: "paid",
  amount: "0.00",
  paymentMethod: null,
  paidDate: "2026-10-06",
  refundedAmount: null,
  refundedAt: null,
  paymentIntentId: null,
  invoiceId: null,
  subscriptionId: null,
  ...extra,
});

const expense = (extra: Partial<JvExpense> & { id: string }): JvExpense => ({
  vehicleId: VEHICLE,
  category: "repair",
  amount: "0.00",
  incurredOn: "2026-10-04",
  maintenanceRecordId: null,
  ...extra,
});

const service = (extra: Partial<JvMaintenance> & { id: string }): JvMaintenance => ({
  vehicleId: VEHICLE,
  category: "repair",
  companyShare: "0.00",
  partnerShare: "0.00",
  totalCost: "0.00",
  performedOn: "2026-10-04",
  completedAt: null,
  createdAt: "2026-10-04T15:00:00Z",
  ...extra,
});

function worked(): { directory: JvDirectory; charges: JvCharge[] } {
  const window = periodWindow("this_month", NOW);
  if (!window) throw new Error("period");
  const directory: JvDirectory = {
    vehicles: [vehicle(VEHICLE, PARTNER), vehicle(OTHER, null)],
    partners: [{ id: PARTNER, name: "North Side JV", revenueSplitPct: 60 }],
    rentals: [],
    expenses: [
      expense({
        id: "e-brake",
        amount: "180.00",
        maintenanceRecordId: "m-brake",
        incurredOn: "2026-10-04",
      }),
      expense({ id: "e-ins", category: "insurance", amount: "45.00", incurredOn: "2026-10-09" }),
    ],
    maintenance: [
      service({
        id: "m-brake",
        companyShare: "100.00",
        partnerShare: "80.00",
        totalCost: "180.00",
      }),
      service({
        id: "m-oil",
        category: "routine",
        companyShare: "20.00",
        partnerShare: "10.00",
        totalCost: "30.00",
        performedOn: "2026-10-10",
      }),
    ],
    payments: [
      pay({
        id: "pay-stripe",
        amount: "400.00",
        paymentMethod: "stripe",
        paymentIntentId: "pi_1",
        paidDate: "2026-10-05",
      }),
      pay({ id: "pay-cash", amount: "75.50", paymentMethod: "cash_app", paidDate: "2026-10-06" }),
      pay({
        id: "pay-zelle",
        amount: "40.00",
        paymentMethod: "zelle",
        paidDate: "2026-10-07",
        refundedAmount: "20.00",
        refundedAt: "2026-10-08",
      }),
      pay({ id: "pay-venmo", amount: "25.00", paymentMethod: "venmo", paidDate: "2026-10-08" }),
      pay({
        id: "pay-wire",
        amount: "100.00",
        paymentMethod: "wire_transfer",
        paidDate: "2026-10-09",
      }),
      pay({ id: "pay-cashbill", amount: "30.00", paymentMethod: "cash", paidDate: "2026-10-11" }),
      pay({
        id: "pay-dup",
        amount: "1.00",
        paymentMethod: "cash_app",
        invoiceId: "in_1",
        paidDate: "2026-10-12",
      }),
      pay({
        id: "pay-dep",
        amount: "500.00",
        paymentMethod: "cash",
        type: "deposit",
        paidDate: "2026-10-03",
      }),
      pay({
        id: "pay-other",
        vehicleId: OTHER,
        amount: "999.00",
        paymentMethod: "cash",
        paidDate: "2026-10-06",
      }),
    ],
    refunds: [
      {
        id: "re_zelle",
        amount: "20.00",
        status: "succeeded",
        createdAt: "2026-10-08T15:00:00Z",
        paymentIds: ["pay-zelle"],
      },
    ],
  };
  const charges: JvCharge[] = [
    {
      id: "ch_rent",
      customerId: null,
      paymentIntentId: "pi_1",
      invoiceId: "in_1",
      subscriptionId: null,
      amountCents: 40000,
      currency: "usd",
      succeeded: true,
      created: window.gte + 3600,
      paymentIds: ["pay-stripe"],
    },
    {
      id: "ch_none",
      customerId: null,
      paymentIntentId: null,
      invoiceId: null,
      subscriptionId: null,
      amountCents: 1500,
      currency: "usd",
      succeeded: true,
      created: window.gte + 7200,
      paymentIds: [],
    },
    {
      id: "ch_other",
      customerId: null,
      paymentIntentId: "pi_other",
      invoiceId: null,
      subscriptionId: null,
      amountCents: 99900,
      currency: "usd",
      succeeded: true,
      created: window.gte + 7200,
      paymentIds: ["pay-other"],
    },
  ];
  return { directory, charges };
}

describe("partner statement worked example", () => {
  it("splits October income and counts each expense once", () => {
    expect(etYmd(new Date("2026-10-21T03:30:00Z"))).toBe("2026-10-20");
    const window = periodWindow("this_month", NOW);
    expect(window).toMatchObject({ from: "2026-10-01", to: "2026-11-01", through: "2026-10-31" });
    expect(window?.gte).toBe(Date.parse("2026-10-01T04:00:00.000Z") / 1000);

    const { directory, charges } = worked();
    const statement = buildJvStatement({
      ...directory,
      vehicleId: VEHICLE,
      period: "this_month",
      now: NOW,
      charges,
    });
    expect(statement).not.toBeNull();
    if (!statement) return;

    expect(statement.vehicleLabel).toBe("2022 Toyota Camry · JV100");
    expect(statement.partnerName).toBe("North Side JV");
    expect(statement.splitLabel).toBe("60%");
    expect(statement.sources.map((row) => [row.source, row.cents])).toEqual([
      ["stripe", 40000],
      ["cash_app", 7550],
      ["zelle", 4000],
      ["venmo", 2500],
      ["wire", 10000],
      ["cash", 3000],
      ["other", 0],
    ]);
    expect(statement.incomeCents).toBe(67050);
    expect(statement.refundsCents).toBe(2000);
    expect(statement.netIncomeCents).toBe(65050);
    expect(statement.partnerIncomeCents).toBe(39030);
    expect(statement.companyIncomeCents).toBe(26020);
    expect(statement.depositsExcludedCents).toBe(50000);
    expect(statement.unattributedStripeCents).toBe(1500);
    expect(statement.conflictingCharges).toBe(0);
    expect(statement.unmatched).toEqual([]);

    // Live vehicle_pl adds the $180 expense and the $100 company share: $280 for one bill.
    expect(18000 + 10000).toBe(28000);
    expect(statement.companyExpenseCents).toBe(16500);
    expect(statement.partnerExpenseCents).toBe(9000);
    expect(statement.expenseCents).toBe(25500);
    expect(statement.expenseCents).not.toBe(18000 + 4500 + 10000 + 2000);
    expect(statement.companyNetCents).toBe(9520);
    expect(statement.partnerNetCents).toBe(30030);
    expect(statement.coverage).toBe("complete");
    expect(statement.notes).toEqual([VEHICLE_PL_DOUBLE_COUNT_NOTE, OPERATING_EXPENSE_NOTE]);
  });

  it("does not add a linked service again when the shares disagree", () => {
    const { directory, charges } = worked();
    directory.expenses = [
      expense({ id: "e-brake", amount: "50.00", maintenanceRecordId: "m-brake" }),
    ];
    directory.maintenance = [
      service({ id: "m-brake", companyShare: "50.00", partnerShare: "40.00", totalCost: "90.00" }),
    ];
    directory.payments = [];
    const statement = buildJvStatement({
      ...directory,
      vehicleId: VEHICLE,
      period: "this_month",
      now: NOW,
      charges: [],
    });
    expect(statement?.expensesComplete).toBe(false);
    expect(statement?.companyExpenseCents).toBeNull();
    expect(statement?.partnerExpenseCents).toBeNull();
    expect(statement?.expenseCents).toBeNull();
    expect(statement?.notes.join(" ")).toContain("counted once and was not added again");
    expect(statement?.notes.join(" ")).not.toContain("$140.00");
    expect(charges).toHaveLength(3);
  });

  it("counts a linked expense once when both shares are zero", () => {
    const { directory } = worked();
    directory.expenses = [
      expense({ id: "e-brake", amount: "180.00", maintenanceRecordId: "m-brake" }),
    ];
    directory.maintenance = [
      service({ id: "m-brake", companyShare: "0.00", partnerShare: "0.00", totalCost: "180.00" }),
    ];
    directory.payments = [];
    const statement = buildJvStatement({
      ...directory,
      vehicleId: VEHICLE,
      period: "this_month",
      now: NOW,
      charges: [],
    });
    expect(statement?.companyExpenseCents).toBe(18000);
    expect(statement?.partnerExpenseCents).toBe(0);
    expect(statement?.expenseCents).toBe(18000);
    expect(statement?.notes.join(" ")).toContain("counted once");
  });

  it("uses total minus partner share when company share is blank on an unlinked service", () => {
    const { directory } = worked();
    directory.expenses = [];
    directory.maintenance = [
      service({
        id: "m-oil",
        companyShare: null,
        partnerShare: "10.00",
        totalCost: "30.00",
        performedOn: "2026-10-10",
      }),
    ];
    directory.payments = [];
    const statement = buildJvStatement({
      ...directory,
      vehicleId: VEHICLE,
      period: "this_month",
      now: NOW,
      charges: [],
    });
    expect(statement?.expensesComplete).toBe(true);
    expect(statement?.companyExpenseCents).toBe(2000);
    expect(statement?.partnerExpenseCents).toBe(1000);
    expect(statement?.expenseCents).toBe(3000);
    expect(statement?.notes.join(" ")).toContain("Total cost minus partner share was used once");
  });

  it("withholds an unlinked service whose shares do not equal total cost", () => {
    const { directory } = worked();
    directory.expenses = [];
    directory.maintenance = [
      service({
        id: "m-oil",
        companyShare: "20.00",
        partnerShare: "10.00",
        totalCost: "40.00",
        performedOn: "2026-10-10",
      }),
    ];
    directory.payments = [];
    const statement = buildJvStatement({
      ...directory,
      vehicleId: VEHICLE,
      period: "this_month",
      now: NOW,
      charges: [],
    });
    expect(statement?.expensesComplete).toBe(false);
    expect(statement?.coverage).toBe("unavailable");
    expect(statement?.companyExpenseCents).toBeNull();
    expect(statement?.partnerExpenseCents).toBeNull();
    expect(statement?.expenseCents).toBeNull();
    expect(statement?.notes.join(" ")).toContain("The split was withheld");
  });

  it("counts an unlinked service once when both shares are zero", () => {
    const { directory } = worked();
    directory.expenses = [];
    directory.maintenance = [
      service({
        id: "m-oil",
        companyShare: "0.00",
        partnerShare: "0.00",
        totalCost: "30.00",
        performedOn: "2026-10-10",
      }),
    ];
    directory.payments = [];
    const statement = buildJvStatement({
      ...directory,
      vehicleId: VEHICLE,
      period: "this_month",
      now: NOW,
      charges: [],
    });
    expect(statement?.expensesComplete).toBe(true);
    expect(statement?.companyExpenseCents).toBe(3000);
    expect(statement?.partnerExpenseCents).toBe(0);
    expect(statement?.expenseCents).toBe(3000);
    expect(statement?.notes.join(" ")).toContain("counted once");
  });

  it("ignores an unreadable date on another vehicle or outside the window", () => {
    const { directory } = worked();
    directory.expenses = [];
    directory.maintenance = [
      service({
        id: "m-other",
        vehicleId: OTHER,
        performedOn: "not-a-date",
        completedAt: null,
        createdAt: "also-bad",
      }),
      service({
        id: "m-old",
        performedOn: "2026-09-02",
        completedAt: null,
        createdAt: null,
        companyShare: "not-money",
        partnerShare: "not-money",
        totalCost: "not-money",
      }),
    ];
    directory.payments = [];
    directory.refunds = [];
    const statement = buildJvStatement({
      ...directory,
      vehicleId: VEHICLE,
      period: "this_month",
      now: NOW,
      charges: [],
    });
    expect(statement?.expensesComplete).toBe(true);
    expect(statement?.expenseCents).toBe(0);
    expect(statement?.coverage).toBe("complete");
  });

  it("fails closed when this vehicle's service date cannot be placed", () => {
    const { directory } = worked();
    directory.expenses = [];
    directory.maintenance = [
      service({
        id: "m-oil",
        performedOn: "not-a-date",
        completedAt: null,
        createdAt: null,
        companyShare: "20.00",
        partnerShare: "10.00",
        totalCost: "30.00",
      }),
    ];
    directory.payments = [];
    const statement = buildJvStatement({
      ...directory,
      vehicleId: VEHICLE,
      period: "this_month",
      now: NOW,
      charges: [],
    });
    expect(statement?.expensesComplete).toBe(false);
    expect(statement?.coverage).toBe("unavailable");
    expect(statement?.expenseCents).toBeNull();
  });

  it("does not let an out-of-window refund blank the statement", () => {
    const { directory } = worked();
    directory.payments = [];
    directory.expenses = [];
    directory.maintenance = [];
    directory.refunds = [
      {
        id: "re-old",
        amount: "5.00",
        status: "succeeded",
        createdAt: "2026-09-02T15:00:00Z",
        paymentIds: [],
      },
    ];
    const statement = buildJvStatement({
      ...directory,
      vehicleId: VEHICLE,
      period: "this_month",
      now: NOW,
      charges: [],
    });
    expect(statement?.refundsComplete).toBe(true);
    expect(statement?.coverage).toBe("complete");
    expect(statement?.refundsCents).toBe(0);
  });

  it("withholds the statement when an in-window refund has no payment", () => {
    const { directory } = worked();
    directory.payments = [];
    directory.expenses = [];
    directory.maintenance = [];
    directory.refunds = [
      {
        id: "re-now",
        amount: "5.00",
        status: "succeeded",
        createdAt: "2026-10-08T15:00:00Z",
        paymentIds: [],
      },
    ];
    const statement = buildJvStatement({
      ...directory,
      vehicleId: VEHICLE,
      period: "this_month",
      now: NOW,
      charges: [],
    });
    expect(statement?.refundsComplete).toBe(false);
    expect(statement?.coverage).toBe("unavailable");
    expect(statement?.refundsCents).toBeNull();
  });

  it("withholds income when a disputed revenue type is in the window and the base is unset", () => {
    expect(PARTNER_REVENUE_BASE).toBeNull();
    const { directory } = worked();
    directory.expenses = [];
    directory.maintenance = [];
    directory.refunds = [];
    directory.payments = [
      pay({ id: "pay-rent", amount: "100.00", paymentMethod: "cash", paidDate: "2026-10-06" }),
      pay({
        id: "pay-late",
        amount: "15.00",
        type: "late_fee",
        paymentMethod: "cash",
        paidDate: "2026-10-08",
      }),
    ];
    const statement = buildJvStatement({
      ...directory,
      vehicleId: VEHICLE,
      period: "this_month",
      now: NOW,
      charges: [],
    });
    expect(statement?.incomeComplete).toBe(false);
    expect(statement?.coverage).toBe("unavailable");
    expect(statement?.incomeCents).toBeNull();
    expect(statement?.partnerIncomeCents).toBeNull();
    expect(statement?.companyIncomeCents).toBeNull();
    expect(statement?.notes.join(" ")).toContain("Partner revenue base is not chosen");
  });

  it("does not count a linked service again when its expense is in another period", () => {
    const { directory } = worked();
    directory.payments = [];
    directory.refunds = [];
    directory.expenses = [
      expense({
        id: "e-oil",
        amount: "30.00",
        maintenanceRecordId: "m-oil",
        incurredOn: "2026-09-15",
      }),
    ];
    directory.maintenance = [
      service({
        id: "m-oil",
        companyShare: "20.00",
        partnerShare: "10.00",
        totalCost: "30.00",
        performedOn: "2026-10-10",
      }),
    ];
    const october = buildJvStatement({
      ...directory,
      vehicleId: VEHICLE,
      period: "this_month",
      now: NOW,
      charges: [],
    });
    const september = buildJvStatement({
      ...directory,
      vehicleId: VEHICLE,
      period: "last_month",
      now: NOW,
      charges: [],
    });
    expect(october?.expensesComplete).toBe(true);
    expect(october?.expenseCents).toBe(0);
    expect(october?.notes.join(" ")).toContain("September 2026");
    expect(september?.notes.join(" ")).not.toContain("September 2026");
    expect(september?.expensesComplete).toBe(true);
    expect(september?.companyExpenseCents).toBe(2000);
    expect(september?.partnerExpenseCents).toBe(1000);
    expect(september?.expenseCents).toBe(3000);
  });

  it("withholds a service when a linked expense names another vehicle", () => {
    const { directory } = worked();
    directory.payments = [];
    directory.refunds = [];
    directory.expenses = [
      expense({
        id: "e-other",
        vehicleId: OTHER,
        amount: "30.00",
        maintenanceRecordId: "m-cross",
        incurredOn: "2026-10-10",
      }),
    ];
    directory.maintenance = [
      service({
        id: "m-cross",
        companyShare: "20.00",
        partnerShare: "10.00",
        totalCost: "30.00",
        performedOn: "2026-10-10",
      }),
    ];
    const october = buildJvStatement({
      ...directory,
      vehicleId: VEHICLE,
      period: "this_month",
      now: NOW,
      charges: [],
    });
    const other = buildJvStatement({
      ...directory,
      vehicleId: OTHER,
      period: "this_month",
      now: NOW,
      charges: [],
    });
    expect(october?.expensesComplete).toBe(false);
    expect(october?.coverage).toBe("unavailable");
    expect(october?.expenseCents).toBeNull();
    expect(october?.notes.join(" ")).toContain("different vehicles");
    expect(other?.expensesComplete).toBe(false);
    expect(other?.expenseCents).toBeNull();
    expect(other?.notes.join(" ")).toContain("different vehicles");
  });

  it("withholds every period when two linked expenses fall in different periods", () => {
    const { directory } = worked();
    directory.payments = [];
    directory.refunds = [];
    directory.expenses = [
      expense({
        id: "e-oct",
        amount: "30.00",
        maintenanceRecordId: "m-split",
        incurredOn: "2026-10-04",
      }),
      expense({
        id: "e-sep",
        amount: "30.00",
        maintenanceRecordId: "m-split",
        incurredOn: "2026-09-15",
      }),
    ];
    directory.maintenance = [
      service({
        id: "m-split",
        companyShare: "20.00",
        partnerShare: "10.00",
        totalCost: "30.00",
        performedOn: "2026-10-10",
      }),
    ];
    const october = buildJvStatement({
      ...directory,
      vehicleId: VEHICLE,
      period: "this_month",
      now: NOW,
      charges: [],
    });
    const september = buildJvStatement({
      ...directory,
      vehicleId: VEHICLE,
      period: "last_month",
      now: NOW,
      charges: [],
    });
    expect(october?.expensesComplete).toBe(false);
    expect(october?.companyExpenseCents).toBeNull();
    expect(october?.partnerExpenseCents).toBeNull();
    expect(october?.notes.join(" ")).toContain("More than one expense is linked");
    expect(september?.expensesComplete).toBe(false);
    expect(september?.companyExpenseCents).toBeNull();
    expect(september?.partnerExpenseCents).toBeNull();
    expect(september?.notes.join(" ")).toContain("More than one expense is linked");
  });

  it("does not let another vehicle's undated refund or non-USD charge blank the statement", () => {
    const { directory } = worked();
    const window = periodWindow("this_month", NOW);
    if (!window) throw new Error("period");
    directory.expenses = [];
    directory.maintenance = [];
    directory.payments = [
      pay({ id: "pay-rent", amount: "40.00", paymentMethod: "cash", paidDate: "2026-10-06" }),
      pay({ id: "pay-eur", vehicleId: OTHER, amount: "10.00", paymentIntentId: "pi_eur" }),
    ];
    directory.refunds = [
      {
        id: "re-other",
        amount: "5.00",
        status: "succeeded",
        createdAt: null,
        paymentIds: ["pay-eur"],
      },
    ];
    const statement = buildJvStatement({
      ...directory,
      vehicleId: VEHICLE,
      period: "this_month",
      now: NOW,
      charges: [
        {
          id: "ch_eur",
          customerId: null,
          paymentIntentId: "pi_eur",
          invoiceId: null,
          subscriptionId: null,
          amountCents: 1000,
          currency: "eur",
          succeeded: true,
          created: window.gte + 100,
          paymentIds: ["pay-eur"],
        },
      ],
    });
    expect(statement?.incomeComplete).toBe(true);
    expect(statement?.refundsComplete).toBe(true);
    expect(statement?.coverage).toBe("complete");
    expect(statement?.incomeCents).toBe(4000);
  });

  it("withholds a non-USD charge and an undated refund for this vehicle", () => {
    const { directory } = worked();
    const window = periodWindow("this_month", NOW);
    if (!window) throw new Error("period");
    directory.expenses = [];
    directory.maintenance = [];
    directory.payments = [pay({ id: "pay-eur", amount: "10.00", type: "rent" })];
    directory.refunds = [
      {
        id: "re-here",
        amount: "1.00",
        status: "succeeded",
        createdAt: null,
        paymentIds: ["pay-eur"],
      },
    ];
    const statement = buildJvStatement({
      ...directory,
      vehicleId: VEHICLE,
      period: "this_month",
      now: NOW,
      charges: [
        {
          id: "ch_eur",
          customerId: null,
          paymentIntentId: null,
          invoiceId: null,
          subscriptionId: null,
          amountCents: 1000,
          currency: "eur",
          succeeded: true,
          created: window.gte + 100,
          paymentIds: ["pay-eur"],
        },
      ],
    });
    expect(statement?.incomeComplete).toBe(false);
    expect(statement?.refundsComplete).toBe(false);
    expect(statement?.coverage).toBe("unavailable");
  });

  it("withholds a Stripe charge matched only by subscription id while the revenue base is unset", () => {
    expect(PARTNER_REVENUE_BASE).toBeNull();
    const { directory } = worked();
    const window = periodWindow("this_month", NOW);
    if (!window) throw new Error("period");
    directory.expenses = [];
    directory.maintenance = [];
    directory.payments = [];
    directory.refunds = [];
    directory.rentals = [
      { id: "r1", vehicleId: VEHICLE, customerId: "cus_1", subscriptionId: "sub_1" },
    ];
    const statement = buildJvStatement({
      ...directory,
      vehicleId: VEHICLE,
      period: "this_month",
      now: NOW,
      charges: [
        {
          id: "ch_sub",
          customerId: "cus_1",
          paymentIntentId: null,
          invoiceId: null,
          subscriptionId: "sub_1",
          amountCents: 8000,
          currency: "usd",
          succeeded: true,
          created: window.gte + 100,
          paymentIds: [],
        },
      ],
    });
    expect(statement?.incomeComplete).toBe(false);
    expect(statement?.incomeCents).toBeNull();
    expect(statement?.partnerIncomeCents).toBeNull();
    expect(statement?.notes.join(" ")).toContain("matched only by subscription id");
  });

  it("withholds a rent payment matched only by stripe subscription id", () => {
    expect(PARTNER_REVENUE_BASE).toBeNull();
    const { directory } = worked();
    const window = periodWindow("this_month", NOW);
    if (!window) throw new Error("period");
    directory.expenses = [];
    directory.maintenance = [];
    directory.refunds = [];
    directory.payments = [
      pay({
        id: "pay-sub",
        type: "rent",
        amount: "80.00",
        paymentMethod: "stripe",
        subscriptionId: "sub_1",
        paymentIntentId: null,
        invoiceId: null,
        paidDate: "2026-10-06",
      }),
    ];
    const statement = buildJvStatement({
      ...directory,
      vehicleId: VEHICLE,
      period: "this_month",
      now: NOW,
      charges: [
        {
          id: "ch_sub_pay",
          customerId: null,
          paymentIntentId: null,
          invoiceId: null,
          subscriptionId: "sub_1",
          amountCents: 8000,
          currency: "usd",
          succeeded: true,
          created: window.gte + 100,
          paymentIds: [],
        },
      ],
    });
    expect(statement?.incomeComplete).toBe(false);
    expect(statement?.incomeCents).toBeNull();
    expect(statement?.partnerIncomeCents).toBeNull();
    expect(statement?.companyIncomeCents).toBeNull();
    expect(statement?.notes.join(" ")).toContain("matched only by subscription id");
  });

  it("keeps a rent charge matched by payment intent when the subscription id also matches", () => {
    const { directory } = worked();
    const window = periodWindow("this_month", NOW);
    if (!window) throw new Error("period");
    directory.expenses = [];
    directory.maintenance = [];
    directory.refunds = [];
    directory.payments = [
      pay({
        id: "pay-rent",
        type: "rent",
        amount: "80.00",
        paymentMethod: "stripe",
        paymentIntentId: "pi_rent",
        subscriptionId: "sub_1",
        paidDate: "2026-10-06",
      }),
    ];
    const statement = buildJvStatement({
      ...directory,
      vehicleId: VEHICLE,
      period: "this_month",
      now: NOW,
      charges: [
        {
          id: "ch_rent_sub",
          customerId: null,
          paymentIntentId: "pi_rent",
          invoiceId: null,
          subscriptionId: "sub_1",
          amountCents: 8000,
          currency: "usd",
          succeeded: true,
          created: window.gte + 100,
          paymentIds: [],
        },
      ],
    });
    expect(statement?.incomeComplete).toBe(true);
    expect(statement?.incomeCents).toBe(8000);
    expect(statement?.partnerIncomeCents).toBe(4800);
    expect(statement?.notes.join(" ")).not.toContain("matched only by subscription id");
  });

  it("withholds the split when refunds are larger than income", () => {
    const { directory } = worked();
    directory.expenses = [];
    directory.maintenance = [];
    directory.payments = [
      pay({ id: "pay-cash", amount: "40.00", paymentMethod: "cash", paidDate: "2026-10-06" }),
    ];
    directory.refunds = [
      {
        id: "re-over-a",
        amount: "25.00",
        status: "succeeded",
        createdAt: "2026-10-08T15:00:00Z",
        paymentIds: ["pay-cash"],
      },
      {
        id: "re-over-b",
        amount: "25.00",
        status: "succeeded",
        createdAt: "2026-10-09T15:00:00Z",
        paymentIds: ["pay-cash"],
      },
    ];
    const statement = buildJvStatement({
      ...directory,
      vehicleId: VEHICLE,
      period: "this_month",
      now: NOW,
      charges: [],
    });
    expect(statement?.incomeComplete).toBe(true);
    expect(statement?.refundsComplete).toBe(true);
    expect(statement?.incomeCents).toBe(4000);
    expect(statement?.refundsCents).toBe(5000);
    expect(statement?.netIncomeCents).toBe(-1000);
    expect(statement?.partnerIncomeCents).toBeNull();
    expect(statement?.companyIncomeCents).toBeNull();
    expect(statement?.partnerNetCents).toBeNull();
    expect(statement?.companyNetCents).toBeNull();
    expect(statement?.notes.join(" ")).toContain("Refunds are larger than income");
  });

  it("notes a refund dated in another period without blanking this one", () => {
    const { directory } = worked();
    directory.payments = [
      pay({ id: "pay-cash", amount: "40.00", paymentMethod: "cash", paidDate: "2026-10-06" }),
    ];
    directory.expenses = [];
    directory.maintenance = [];
    directory.refunds = [
      {
        id: "re-sep",
        amount: "5.00",
        status: "succeeded",
        createdAt: "2026-09-02T15:00:00Z",
        paymentIds: ["pay-cash"],
      },
    ];
    const statement = buildJvStatement({
      ...directory,
      vehicleId: VEHICLE,
      period: "this_month",
      now: NOW,
      charges: [],
    });
    expect(statement?.refundsComplete).toBe(true);
    expect(statement?.coverage).toBe("complete");
    expect(statement?.refundsCents).toBe(0);
    expect(statement?.incomeCents).toBe(4000);
    expect(statement?.notes.join(" ")).toContain("September 2026");
    expect(statement?.notes.join(" ")).toContain("counted in that period, not this one");
  });

  it("surfaces a pending refund and does not count it as money returned", () => {
    const { directory } = worked();
    directory.expenses = [];
    directory.maintenance = [];
    directory.payments = [
      pay({ id: "pay-cash", amount: "40.00", paymentMethod: "cash", paidDate: "2026-10-06" }),
    ];
    directory.refunds = [
      {
        id: "re-pending",
        amount: "15.00",
        status: "pending",
        createdAt: "2026-10-08T15:00:00Z",
        paymentIds: ["pay-cash"],
      },
    ];
    const statement = buildJvStatement({
      ...directory,
      vehicleId: VEHICLE,
      period: "this_month",
      now: NOW,
      charges: [],
    });
    expect(statement?.refundsComplete).toBe(true);
    expect(statement?.refundsCents).toBe(0);
    expect(statement?.incomeCents).toBe(4000);
    expect(statement?.partnerIncomeCents).toBe(2400);
    expect(statement?.notes.join(" ")).toContain("still pending");
    expect(statement?.notes.join(" ")).toContain("not counted as money returned");
  });

  it("does not subtract a pending refund again through refunded amount", () => {
    const { directory } = worked();
    directory.expenses = [];
    directory.maintenance = [];
    directory.payments = [
      pay({
        id: "pay-cash",
        amount: "40.00",
        paymentMethod: "cash",
        paidDate: "2026-10-06",
        refundedAmount: "15.00",
        refundedAt: "2026-10-08",
      }),
    ];
    directory.refunds = [
      {
        id: "re-pending",
        amount: "15.00",
        status: "pending",
        createdAt: "2026-10-08T15:00:00Z",
        paymentIds: ["pay-cash"],
      },
    ];
    const statement = buildJvStatement({
      ...directory,
      vehicleId: VEHICLE,
      period: "this_month",
      now: NOW,
      charges: [],
    });
    expect(statement?.refundsCents).toBe(0);
    expect(statement?.partnerIncomeCents).toBe(2400);
    expect(statement?.notes.join(" ")).toContain("still pending");
  });

  it("withholds the share when one refund is larger than its payment", () => {
    const { directory } = worked();
    directory.expenses = [];
    directory.maintenance = [];
    directory.payments = [
      pay({ id: "pay-cash", amount: "40.00", paymentMethod: "cash", paidDate: "2026-10-06" }),
    ];
    directory.refunds = [
      {
        id: "re-over",
        amount: "50.00",
        status: "succeeded",
        createdAt: "2026-10-08T15:00:00Z",
        paymentIds: ["pay-cash"],
      },
    ];
    const statement = buildJvStatement({
      ...directory,
      vehicleId: VEHICLE,
      period: "this_month",
      now: NOW,
      charges: [],
    });
    expect(statement?.refundsComplete).toBe(false);
    expect(statement?.refundsCents).toBeNull();
    expect(statement?.partnerIncomeCents).toBeNull();
    expect(statement?.companyIncomeCents).toBeNull();
    expect(statement?.notes.join(" ")).toContain("larger than its payment");
  });

  it("withholds the share when refunded amount is larger than the payment", () => {
    const { directory } = worked();
    directory.expenses = [];
    directory.maintenance = [];
    directory.refunds = [];
    directory.payments = [
      pay({
        id: "pay-cash",
        amount: "40.00",
        paymentMethod: "cash",
        paidDate: "2026-10-06",
        refundedAmount: "40.01",
        refundedAt: "2026-10-08",
      }),
    ];
    const statement = buildJvStatement({
      ...directory,
      vehicleId: VEHICLE,
      period: "this_month",
      now: NOW,
      charges: [],
    });
    expect(statement?.refundsCents).toBeNull();
    expect(statement?.partnerIncomeCents).toBeNull();
    expect(statement?.notes.join(" ")).toContain("larger than its payment");
  });

  it("counts a refunded amount in the month it was refunded", () => {
    const { directory } = worked();
    directory.expenses = [];
    directory.maintenance = [];
    directory.refunds = [];
    directory.payments = [
      pay({
        id: "pay-cash",
        amount: "40.00",
        paymentMethod: "cash",
        paidDate: "2026-09-06",
        refundedAmount: "10.00",
        refundedAt: "2026-10-08",
      }),
    ];
    const october = buildJvStatement({
      ...directory,
      vehicleId: VEHICLE,
      period: "this_month",
      now: NOW,
      charges: [],
    });
    expect(october?.incomeCents).toBe(0);
    expect(october?.refundsCents).toBe(1000);
    expect(october?.notes.join(" ")).toContain("Refunds are larger than income");
    const september = buildJvStatement({
      ...directory,
      vehicleId: VEHICLE,
      period: "last_month",
      now: NOW,
      charges: [],
    });
    expect(september?.incomeCents).toBe(4000);
    expect(september?.refundsCents).toBe(0);
    expect(september?.notes.join(" ")).toContain("October 2026");
  });

  it("withholds a refunded amount that has no refund date", () => {
    const { directory } = worked();
    directory.expenses = [];
    directory.maintenance = [];
    directory.refunds = [];
    directory.payments = [
      pay({
        id: "pay-cash",
        amount: "40.00",
        paymentMethod: "cash",
        paidDate: "2026-10-06",
        refundedAmount: "10.00",
        refundedAt: null,
      }),
    ];
    const statement = buildJvStatement({
      ...directory,
      vehicleId: VEHICLE,
      period: "this_month",
      now: NOW,
      charges: [],
    });
    expect(statement?.refundsCents).toBeNull();
    expect(statement?.partnerIncomeCents).toBeNull();
    expect(statement?.notes.join(" ")).toContain("without the date it was refunded");
  });

  it("notes a partner split that cannot be represented in cents", () => {
    const { directory } = worked();
    directory.partners = [{ id: PARTNER, name: "North Side JV", revenueSplitPct: "33.335" }];
    directory.expenses = [];
    directory.maintenance = [];
    directory.refunds = [];
    directory.payments = [
      pay({ id: "pay-cash", amount: "40.00", paymentMethod: "cash", paidDate: "2026-10-06" }),
    ];
    const statement = buildJvStatement({
      ...directory,
      vehicleId: VEHICLE,
      period: "this_month",
      now: NOW,
      charges: [],
    });
    expect(statement?.split).toBe("not_configured");
    expect(statement?.partnerIncomeCents).toBeNull();
    expect(statement?.companyIncomeCents).toBeNull();
    expect(statement?.notes.join(" ")).toContain("33.335%");
    expect(statement?.notes.join(" ")).toContain("cannot be represented in cents");
  });

  it("withholds a customer-only Stripe charge while the revenue base is unset", () => {
    expect(PARTNER_REVENUE_BASE).toBeNull();
    const { directory } = worked();
    const window = periodWindow("this_month", NOW);
    if (!window) throw new Error("period");
    directory.expenses = [];
    directory.maintenance = [];
    directory.payments = [];
    directory.refunds = [];
    directory.rentals = [
      { id: "r1", vehicleId: VEHICLE, customerId: "cus_1", subscriptionId: null },
    ];
    const statement = buildJvStatement({
      ...directory,
      vehicleId: VEHICLE,
      period: "this_month",
      now: NOW,
      charges: [
        {
          id: "ch_cus",
          customerId: "cus_1",
          paymentIntentId: null,
          invoiceId: null,
          subscriptionId: null,
          amountCents: 5000,
          currency: "usd",
          succeeded: true,
          created: window.gte + 100,
          paymentIds: [],
        },
      ],
    });
    expect(statement?.incomeComplete).toBe(false);
    expect(statement?.incomeCents).toBeNull();
    expect(statement?.partnerIncomeCents).toBeNull();
    expect(statement?.notes.join(" ")).toContain("tied only to the customer");
  });

  it("withholds a non-rent Stripe charge while the revenue base is unset", () => {
    expect(PARTNER_REVENUE_BASE).toBeNull();
    const { directory } = worked();
    const window = periodWindow("this_month", NOW);
    if (!window) throw new Error("period");
    directory.expenses = [];
    directory.maintenance = [];
    directory.refunds = [];
    directory.payments = [
      pay({
        id: "pay-late",
        type: "late_fee",
        amount: "15.00",
        paidDate: "2026-09-02",
      }),
    ];
    const statement = buildJvStatement({
      ...directory,
      vehicleId: VEHICLE,
      period: "this_month",
      now: NOW,
      charges: [
        {
          id: "ch_late",
          customerId: null,
          paymentIntentId: null,
          invoiceId: null,
          subscriptionId: null,
          amountCents: 1500,
          currency: "usd",
          succeeded: true,
          created: window.gte + 100,
          paymentIds: ["pay-late"],
        },
      ],
    });
    expect(statement?.incomeComplete).toBe(false);
    expect(statement?.incomeCents).toBeNull();
    expect(statement?.notes.join(" ")).toContain("Partner revenue base is not chosen");
    expect(statement?.notes.join(" ")).not.toContain("tied only to the customer");
  });

  it("leaves an unmatched Stripe row out and marks the period Partial", () => {
    const { directory } = worked();
    directory.payments = [
      pay({ id: "pay-card", amount: "60.00", paymentMethod: "card", paidDate: "2026-10-06" }),
    ];
    directory.expenses = [];
    directory.maintenance = [];
    directory.refunds = [];
    const statement = buildJvStatement({
      ...directory,
      vehicleId: VEHICLE,
      period: "this_month",
      now: NOW,
      charges: [],
    });
    expect(statement?.incomeCents).toBe(0);
    expect(statement?.coverage).toBe("partial");
    expect(statement?.unmatched).toEqual([
      {
        id: "pay-card",
        method: "card",
        reason: "No Payment Intent, charge, invoice, or payment reference.",
      },
    ]);
  });
});

describe("partner statement access", () => {
  it("stays off and does not read", async () => {
    expect(FINANCE_JV_STATEMENT_ENABLED).toBe(false);
    const flag = readFileSync(new URL("../src/lib/jv-statement-flag.ts", import.meta.url), "utf8");
    expect(flag).toMatch(/export const FINANCE_JV_STATEMENT_ENABLED = false/);
    expect(flag).not.toMatch(/process\.env/);
    const handler = readFileSync(
      new URL("../src/lib/jv-statement.functions.ts", import.meta.url),
      "utf8",
    );
    const gate = handler.indexOf("if (!FINANCE_JV_STATEMENT_ENABLED) return DISABLED");
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(handler.indexOf("requireOwner"));
    expect(gate).toBeLessThan(handler.indexOf("jv-statement.server"));
    expect(gate).toBeLessThan(handler.indexOf("jv-statement-read.server"));
    const admin = readFileSync(new URL("../src/routes/admin.tsx", import.meta.url), "utf8");
    expect(admin).toContain('FINANCE_JV_STATEMENT_ENABLED && tab === "jv" && <JvStatementPanel />');
    expect(visibleTabs("owner").some((tab) => tab.id === "jv")).toBe(false);
    const rail = railEntries("owner")
      .map((entry) => entry.label)
      .join(",");
    expect(rail).toBe(
      "Overview,Drivers,Bookings,Active Rentals,Payments,Vehicles,Fleet Inbox,Service,Incidents,Driver Issues,Expenses,Partners",
    );
    expect(rail).not.toContain("Partner Statement");
    const nav = readFileSync(new URL("../src/components/admin/nav-config.ts", import.meta.url), "utf8");
    const jvTab = nav.slice(nav.indexOf("const JV_TAB"), nav.indexOf("function withJv"));
    expect(jvTab).toContain('label: "JV Partner Statement"');
    expect(jvTab).not.toContain('label: "Partner Statement"');
    expect(nav).toContain('id: "partner_statement"');
    const panel = readFileSync(new URL("../src/components/admin/JvStatementPanel.tsx", import.meta.url), "utf8");
    expect(panel).toContain(">JV Partner Statement<");

    const load = vi.fn();
    const readCharges = vi.fn();
    await expect(
      runJvStatement({
        enabled: false,
        userId: "owner",
        tier: "owner",
        vehicleId: VEHICLE,
        period: "this_month",
        now: NOW,
        load,
        readCharges,
      }),
    ).resolves.toEqual({ status: "disabled", vehicles: [], statement: null });
    expect(load).not.toHaveBeenCalled();
    expect(readCharges).not.toHaveBeenCalled();

    const managerLoad = vi.fn();
    await expect(
      runJvStatement({
        enabled: true,
        userId: "manager",
        tier: "manager",
        vehicleId: null,
        period: "this_month",
        now: NOW,
        load: managerLoad,
        readCharges,
      }),
    ).rejects.toThrow("Forbidden");
    expect(managerLoad).not.toHaveBeenCalled();
  });

  it("does not list Stripe charges until a vehicle is chosen", async () => {
    const { directory } = worked();
    const load = vi.fn(async () => directory);
    const readCharges = vi.fn();
    const result = await runJvStatement({
      enabled: true,
      userId: "owner",
      tier: "owner",
      vehicleId: null,
      period: "this_month",
      now: NOW,
      load,
      readCharges,
    });
    expect(result.status).toBe("ready");
    if (result.status === "ready") expect(result.statement).toBeNull();
    expect(readCharges).not.toHaveBeenCalled();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("selects the directory and does not write", async () => {
    const calls: string[] = [];
    const query = {
      select() {
        calls.push("select");
        return query;
      },
      order() {
        calls.push("order");
        return query;
      },
      limit() {
        calls.push("limit");
        return query;
      },
      gt() {
        calls.push("gt");
        return query;
      },
      abortSignal() {
        calls.push("abortSignal");
        return query;
      },
      insert() {
        calls.push("insert");
        return query;
      },
      update() {
        calls.push("update");
        return query;
      },
      upsert() {
        calls.push("upsert");
        return query;
      },
      delete() {
        calls.push("delete");
        return query;
      },
      rpc() {
        calls.push("rpc");
        return query;
      },
      then(resolve: (value: { data: []; error: null }) => unknown) {
        return Promise.resolve({ data: [], error: null }).then(resolve);
      },
    };
    const supabase = {
      from() {
        calls.push("from");
        return query;
      },
    };
    const directory = await loadJvDirectory(supabase as never);
    expect(directory?.vehicles).toEqual([]);
    expect(calls).toContain("select");
    expect(calls).not.toContain("insert");
    expect(calls).not.toContain("update");
    expect(calls).not.toContain("upsert");
    expect(calls).not.toContain("delete");
    expect(calls).not.toContain("rpc");
    const server = readFileSync(
      new URL("../src/lib/jv-statement.server.ts", import.meta.url),
      "utf8",
    );
    expect(server).not.toMatch(/\.(insert|update|upsert|delete|rpc)\s*\(/);
  });
});

describe("partner statement boundaries", () => {
  it("documents the live vehicle_pl double count and does not replace it", () => {
    const live = readFileSync(
      new URL(
        "../supabase/migrations/20261006020456_cf3a2cce-fa6e-4f72-85b9-c95c5d634bb4.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(live).toContain("COALESCE(sum(e.amount), 0) AS amt FROM public.vehicle_expenses");
    expect(live).toContain(
      "COALESCE(sum(COALESCE(m.company_share, m.total_cost, 0)), 0) AS amt FROM public.maintenance_records",
    );
    const proposed = readFileSync(
      new URL("../proposed/jv-statement-v1.sql", import.meta.url),
      "utf8",
    );
    expect(proposed.startsWith("-- LOCAL PROPOSAL. Not a migration.")).toBe(true);
    expect(proposed).toMatch(
      /counted twice|counted twice|counts a linked service twice|in the net twice/,
    );
    expect(proposed).not.toMatch(/^\s*create\s+/im);
    expect(
      readdirSync(new URL("../supabase/migrations", import.meta.url)).some((name) =>
        name.includes("jv-statement"),
      ),
    ).toBe(false);
  });

  it("lists Stripe charges and does not call a write", async () => {
    const reader = readFileSync(
      new URL("../src/lib/jv-statement-read.server.ts", import.meta.url),
      "utf8",
    );
    expect(reader).toContain("charges.list");
    expect(reader).toContain('createReadOnlyStripe("live", { cache: true })');
    expect(reader).not.toContain("createStripeClient");
    expect(reader).not.toMatch(/\.charges\.(create|update|capture)\s*\(/);
    expect(reader).not.toMatch(/\.refunds\./);
    expect(reader).not.toMatch(/\.paymentIntents\.(create|confirm|capture)\s*\(/);
    const list = vi.fn<ReadOnlyStripeGateway["charges"]["list"]>(async () => ({
      data: [
        {
          id: "ch_1",
          amount_captured: 40000,
          currency: "usd",
          status: "succeeded",
          paid: true,
          captured: true,
          created: 1_759_286_400,
          customer: "cus_1",
          payment_intent: "pi_1",
          invoice: "in_1",
          livemode: true,
          metadata: { paymentIds: "pay-stripe, pay-extra" },
        },
      ],
      has_more: false,
    }));
    const result = await readJvCharges(
      { charges: { list } },
      { gte: 1, lt: 2 },
      { now: () => 0, timeoutMs: 1000 },
    );
    expect(list).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      ok: true,
      charges: [
        {
          id: "ch_1",
          amountCents: 40000,
          paymentIntentId: "pi_1",
          invoiceId: "in_1",
          paymentIds: ["pay-stripe", "pay-extra"],
          succeeded: true,
        },
      ],
    });
  });
});
