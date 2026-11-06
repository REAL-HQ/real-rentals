/**
 * Closeout Summary balance, blockers, and the disabled flag.
 * Run: bun scripts/closeout-summary.test.ts
 */
import { readFileSync } from "node:fs";
import {
  CLOSEOUT_SUMMARY_DISABLED,
  CLOSEOUT_SUMMARY_ENABLED,
  assertCloseoutSummaryEnabled,
  buildCloseoutSummary,
  closeoutApplies,
  depositHeldCents,
  depositIsHeld,
  expectedRentCents,
  rentCollectedCents,
  unpaidCents,
  type CloseoutFacts,
  type CloseoutSummary,
} from "../src/lib/closeout-summary";

let fails = 0;
const ok = (condition: boolean, message: string) => {
  console.log(`${condition ? "  PASS" : "  FAIL"}  ${message}`);
  if (!condition) fails++;
};

const TODAY = "2026-10-21";

function facts(over: Partial<CloseoutFacts> = {}): CloseoutFacts {
  return {
    status: "active",
    startDate: "2026-10-07",
    endDate: null,
    todayEt: TODAY,
    weeklyRate: 350,
    payments: [{ type: "rent", status: "paid", netCollected: 700 }],
    depositHeld: false,
    depositStatus: "none",
    depositAmount: 500,
    registrationExpiresOn: "2027-01-01",
    insuranceExpiresOn: "2027-06-01",
    incidents: [],
    issues: [],
    checklist: { known: true, keysReturned: true, depositDecisionNeeded: false, damageCount: 0 },
    ...over,
  };
}

function summary(over: Partial<CloseoutFacts> = {}): CloseoutSummary {
  const built = buildCloseoutSummary(facts(over));
  if (!built.applies) throw new Error("expected a summary");
  return built;
}

ok(CLOSEOUT_SUMMARY_ENABLED === false, "the flag is off");
let threw = false;
try {
  assertCloseoutSummaryEnabled();
} catch (error) {
  threw = error instanceof Error && error.message === CLOSEOUT_SUMMARY_DISABLED;
}
ok(threw, "assert refuses while the flag is off");

ok(closeoutApplies("active") && closeoutApplies("ended") && closeoutApplies("closed"), "active and ended rentals get a summary");
ok(!closeoutApplies("cancelled") && !closeoutApplies("reserved") && !closeoutApplies("pending"), "cancelled and reserved rentals do not");
ok(!buildCloseoutSummary(facts({ status: "cancelled" })).applies, "a cancelled rental is not summarized");

const clean = summary();
ok(clean.days === 14 && clean.weeks === "2 Weeks", "14 elapsed days are 2 weeks");
ok(clean.expectedCents === 70000 && clean.expected === "$700.00", "expected rent is weekly rate times weeks");
ok(clean.recordedCents === 70000 && clean.paymentsRecorded === "$700.00", "recorded rent is net collected");
ok(clean.unpaidCents === 0 && clean.unpaidBalance === "$0.00", "a paid rental has no unpaid balance");
ok(clean.ready && clean.readyLine === "Ready to close? Yes.", "a clear rental is ready to close");
ok(clean.returnChecklist === "Keys Returned", "a recorded checklist with no damage names the keys");

const partial = summary({ startDate: "2026-10-11", payments: [{ type: "rent", status: "paid", netCollected: 0 }] });
ok(partial.weeks === "1 Week 3 Days", "a partial week stays in days");
ok(expectedRentCents(350, 10) === 50000 && partial.expected === "$500.00", "10 days at $350 is $500");
ok(partial.unpaidCents === 50000, "the unpaid estimate is expected minus recorded");
ok(partial.blockers.includes("The unpaid balance is $500.00."), "a positive balance is a blocker");

ok(expectedRentCents(100, 1) === 1429, "a one-day week rounds to the cent");
ok(expectedRentCents(null, 14) == null && rentCollectedCents([{ type: "rent", status: "paid", netCollected: null }]) == null, "a missing rate or net is Unknown");
ok(unpaidCents(null, 0) == null, "an unknown expected rent leaves the balance Unknown");

const depositInRent = summary({
  payments: [
    { type: "rent", status: "paid", netCollected: 700 },
    { type: "deposit", status: "paid", netCollected: 500 },
    { type: "late_fee", status: "paid", netCollected: 25 },
  ],
});
ok(depositInRent.recordedCents === 70000, "deposit and late fee rows are not rent collected");

const overpaid = summary({ payments: [{ type: "rent", status: "paid", netCollected: 800 }] });
ok(overpaid.unpaidCents === -10000 && overpaid.unpaidBalance === "-$100.00", "extra rent shows as a negative estimate");
ok(!overpaid.blockers.some((line) => line.includes("unpaid")), "an overpayment is not an unpaid blocker");

const missingPay = summary({ payments: [{ type: "rent", status: "paid", netCollected: null }] });
ok(missingPay.paymentsRecorded === "Unknown" && missingPay.blockers.includes("Payments recorded is Unknown."), "a null rent net does not become zero");

ok(depositIsHeld(true, "forfeited") === false, "a forfeited deposit is not held");
ok(depositIsHeld(false, "pending_disposition") === true, "pending disposition is held");
ok(depositIsHeld(true, "held") === true, "an explicit held flag stays held");
ok(depositHeldCents({ depositHeld: true, depositStatus: "held", depositAmount: 999, paidDepositNets: [200, 300] }) === 50000, "paid deposit nets are the held amount");
ok(depositHeldCents({ depositHeld: true, depositStatus: "held", depositAmount: 500, paidDepositNets: [] }) === 50000, "with no paid deposit row, the rental amount is used");
ok(depositHeldCents({ depositHeld: true, depositStatus: "held", depositAmount: 500, paidDepositNets: [null] }) == null, "a null deposit net stays Unknown");

const held = summary({ depositHeld: true, depositStatus: "held" });
ok(held.depositHeld === "$500.00 Held", "the card shows the held amount");
ok(held.blockers.includes("The deposit of $500.00 is still held."), "a held deposit blocks closeout");
const settled = summary({ depositHeld: true, depositStatus: "forfeited" });
ok(settled.depositHeld === "Not Held, Forfeited" && !settled.blockers.some((line) => line.includes("deposit")), "a forfeited deposit is not still held");

const ended = summary({ status: "ended", startDate: "2026-10-01", endDate: "2026-10-15" });
ok(ended.days === 14, "an ended rental stops at its end date");
const futureEnd = summary({ startDate: "2026-10-07", endDate: "2026-11-04" });
ok(futureEnd.days === 14, "an active rental does not count days after today");
const noEnd = summary({ status: "ended", endDate: null });
ok(noEnd.weeks === "Unknown" && noEnd.blockers.includes("Weeks rented is Unknown."), "an ended rental with no end date does not use today");

const incidents = summary({ incidents: [{ status: "in_claim", type: "accident" }, { status: "closed", type: "tow" }] });
ok(incidents.openIncidents === "1 Open Incident: Accident", "a closed incident is not open");
ok(incidents.blockers.includes("There is 1 open incident."), "an open incident blocks closeout");

const issues = summary({
  issues: [
    { status: "open", title: "Flat Tire", kind: "breakdown" },
    { status: "resolved", title: "Old", kind: "other" },
  ],
});
ok(issues.openIssues === "1 Open Issue: Flat Tire", "a resolved issue is not open");
ok(issues.blockers.includes("There is 1 open issue."), "an open issue blocks closeout");

const expired = summary({ registrationExpiresOn: "2026-10-20", insuranceExpiresOn: null });
ok(expired.registration === "Expired" && expired.insurance === "Unknown", "expiry and a missing date stay distinct");
ok(expired.blockers.includes("Registration is expired.") && expired.blockers.includes("Insurance status is Unknown."), "expired and unknown coverage both block");
ok(summary({ registrationExpiresOn: TODAY }).registration === "Current", "coverage that expires today is current");

const unknownList = summary({ checklist: { known: false } });
ok(unknownList.returnChecklist === "Unknown" && unknownList.blockers.includes("The return checklist is Unknown."), "a missing checklist is Unknown");
const keys = summary({ checklist: { known: true, keysReturned: false, depositDecisionNeeded: true, damageCount: 2 } });
ok(keys.returnChecklist === "Keys Not Returned, 2 Damage Notes, Deposit Decision Needed", "checklist facts come from the stored row");
ok(keys.blockers.includes("Keys were not returned."), "missing keys block closeout");
ok(keys.blockers.includes("The return checklist notes damage."), "recorded damage blocks closeout");
ok(keys.blockers.includes("A deposit decision is still needed."), "a deposit decision note blocks closeout");
const damageUnknown = summary({ checklist: { known: true, keysReturned: true, depositDecisionNeeded: false, damageCount: null } });
ok(damageUnknown.blockers.includes("Return damage is Unknown."), "unreadable checklist items stay Unknown");

const fn = readFileSync("src/lib/closeout-summary.functions.ts", "utf8");
const handler = fn.slice(fn.indexOf("export const getCloseoutSummary"), fn.indexOf("function asNumber"));
ok(handler.includes("requireManager") && !handler.includes("requireStaff"), "owners and managers are the gate");
ok(handler.indexOf("requireManager") < handler.indexOf("assertCloseoutSummaryEnabled"), "the role is checked before the flag");
ok(handler.indexOf("assertCloseoutSummaryEnabled") < handler.indexOf(".from("), "the flag is checked before any read");
ok(!/\.(insert|update|delete|upsert)\(/.test(fn), "the server file does not write");
ok(!fn.includes("settleDeposit") && !fn.includes("DepositDialog") && !/from ["']stripe["']/.test(fn), "the summary does not settle a deposit or call Stripe");
ok(fn.includes("return_checklists") && fn.includes("missingRelation"), "a missing checklist table can be Unknown");

const booking = readFileSync("src/components/admin/BookingDetails.tsx", "utf8");
const card = readFileSync("src/components/admin/CloseoutSummary.tsx", "utf8");
ok(booking.includes("CLOSEOUT_SUMMARY_ENABLED && d.canSeeMoney && closeoutApplies"), "the card is mounted only for a manager on an active or ended rental, and only when the flag is on");
ok(card.includes("Closeout Summary") && card.includes("Unpaid Balance Estimate") && card.includes("Return Checklist"), "the card shows the summary fields");
ok(!card.includes("uppercase") && !card.includes("capitalize") && !/text-transform\s*:/.test(card), "labels are Title Case in the strings");
ok(!readFileSync("src/components/admin/DepositDialog.tsx", "utf8").includes("closeout-summary"), "DepositDialog is unchanged by this summary");

console.log(fails ? `\n${fails} FAILURE(S)` : "\nall assertions passed");
process.exit(fails ? 1 : 0);
