import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { railEntries, resolveAdminTab, TABS, visibleTabs } from "../src/components/admin/nav-config";
import { RENEWAL_CANDIDATES_ENABLED } from "../src/lib/renewal-candidates-flag";
import {
  BAD_PAYMENT_STATUSES,
  RENEWAL_CANDIDATE_DAYS,
  buildRenewalCandidates,
  easternCalendarDate,
  endsWithinCandidateWindow,
  hasGoodPaymentHistory,
  type CandidateRental,
} from "../src/lib/renewal-candidates";
import { loadRenewalCandidates } from "../src/lib/renewal-candidates.server";

const flag = readFileSync("src/lib/renewal-candidates-flag.ts", "utf8");
const lib = readFileSync("src/lib/renewal-candidates.ts", "utf8");
const server = readFileSync("src/lib/renewal-candidates.server.ts", "utf8");
const fn = readFileSync("src/lib/renewal-candidates.functions.ts", "utf8");
const panel = readFileSync("src/components/admin/RenewalCandidates.tsx", "utf8");
const nav = readFileSync("src/components/admin/nav-config.ts", "utf8");
const admin = readFileSync("src/routes/admin.tsx", "utf8");
const due = readFileSync("src/components/admin/RenewalsDue.tsx", "utf8");

function rental(partial: Partial<CandidateRental> & Pick<CandidateRental, "id" | "endDate">): CandidateRental {
  return { status: "active", applicationId: "app-1", vehicleId: "veh-1", ...partial };
}

describe("renewal candidates flag", () => {
  it("is a hard false, declared once, and refuses before any read", async () => {
    assert.equal(RENEWAL_CANDIDATES_ENABLED, false);
    assert.equal((flag.match(/const RENEWAL_CANDIDATES_ENABLED/g) ?? []).length, 1);
    assert.match(flag, /export const RENEWAL_CANDIDATES_ENABLED: boolean = false as boolean/);
    assert.doesNotMatch(flag, /process\.env/);
    for (const source of [lib, server, fn, panel, nav, admin]) {
      assert.equal((source.match(/const RENEWAL_CANDIDATES_ENABLED/g) ?? []).length, 0);
    }
    await assert.rejects(() => loadRenewalCandidates(), /Renewal candidates are not enabled/);

    const loader = server.slice(server.indexOf("export async function loadRenewalCandidates"));
    const guard = loader.indexOf("RENEWAL_CANDIDATES_ENABLED !== true");
    const db = loader.indexOf('import("@/integrations/supabase/client.server")');
    assert.ok(guard !== -1 && db !== -1 && guard < db);

    const handler = fn.slice(fn.indexOf(".handler"));
    const thrown = handler.indexOf("RENEWAL_CANDIDATES_ENABLED !== true");
    const role = handler.indexOf("requireManager");
    const read = handler.indexOf('import("@/lib/renewal-candidates.server")');
    assert.ok(thrown !== -1 && role !== -1 && read !== -1 && thrown < role && role < read);
    assert.doesNotMatch(fn, /\.from\(|sendEmail|sendSms|\.insert\(|\.update\(|\.delete\(|\.upsert\(/);
    assert.doesNotMatch(server, /sendEmail|sendSms|\.insert\(|\.update\(|\.delete\(|\.upsert\(/);
    assert.doesNotMatch(server, /next_payment_due|card_last4|stripe_/);
    assert.match(server, /const PAYMENT_CHUNK = 50/);
    assert.match(server, /const READ_CAP = POSTGREST_MAX_ROWS - 1/);
    assert.match(server, /\.limit\(READ_CAP \+ 1\)/);
    assert.match(server, /if \(count > READ_CAP\) throw new Error\("Renewal candidates could not be listed\."\)/);
    assert.match(server, /\.order\("end_date", \{ ascending: true \}\)\s*\.order\("id", \{ ascending: true \}\)/);
    assert.match(server, /const PAGE_CAP = 20/);
    assert.match(server, /\.eq\("status", "active"\)/);
    assert.doesNotMatch(panel, /uppercase|text-transform|sendEmail|sendSms/);
    assert.doesNotMatch(due, /Renewal Candidates|renewal_candidates/);
    assert.doesNotMatch(panel, /Renewal Due|renewals_due|Next Billing|Weekly Rate/);

    assert.equal(TABS.some((tab) => tab.id === "renewal_candidates"), false);
    for (const tier of ["coordinator", "manager", "owner"] as const) {
      assert.equal(visibleTabs(tier).some((tab) => tab.id === "renewal_candidates"), false);
      assert.equal(railEntries(tier).some((tab) => tab.id === "renewal_candidates"), false);
    }
    assert.equal(resolveAdminTab({ urlTab: "renewal_candidates", tier: "manager", navTabs: [] }), "overview");
    assert.match(admin, /RENEWAL_CANDIDATES_ENABLED === true && tab === "renewal_candidates" && <RenewalCandidates \/>/);
    assert.match(nav, /label: "Renewal Candidates"/);
  });
});

describe("renewal candidate rows", () => {
  const today = "2026-10-21";

  it("keeps an active rental ending within 14 Eastern days when every charge is clean and one is paid", () => {
    assert.equal(RENEWAL_CANDIDATE_DAYS, 14);
    assert.equal(endsWithinCandidateWindow("2026-10-21", today), true);
    assert.equal(endsWithinCandidateWindow("2026-11-04", today), true);
    assert.equal(endsWithinCandidateWindow("2026-11-05", today), false);
    assert.equal(endsWithinCandidateWindow("2026-10-20", today), false);
    assert.equal(hasGoodPaymentHistory(["paid", "waived"]), true);
    assert.equal(hasGoodPaymentHistory(["paid", "late"]), false);
    assert.equal(hasGoodPaymentHistory([]), false);
    assert.equal(hasGoodPaymentHistory(["upcoming"]), false);
    assert.equal(hasGoodPaymentHistory(["refunded"]), false);
    for (const status of BAD_PAYMENT_STATUSES) {
      assert.equal(hasGoodPaymentHistory(["paid", status]), false);
    }

    const rows = buildRenewalCandidates({
      today,
      rentals: [
        rental({ id: "soon", endDate: "2026-10-23" }),
        rental({ id: "edge", endDate: "2026-11-04" }),
        rental({ id: "later", endDate: "2026-11-05" }),
        rental({ id: "past", endDate: "2026-10-20" }),
        rental({ id: "late", endDate: "2026-10-25" }),
        rental({ id: "none", endDate: "2026-10-22" }),
        rental({ id: "closed", endDate: "2026-10-22", status: "ended" }),
        rental({ id: "billing-only", endDate: null }),
      ],
      applications: [{ id: "app-1", fullName: "Ada Lopez" }],
      vehicles: [{ id: "veh-1", year: 2020, make: "Toyota", model: "Camry", unitNumber: "12" }],
      payments: [
        { rentalId: "soon", status: "paid" },
        { rentalId: "soon", status: "void" },
        { rentalId: "edge", status: "paid" },
        { rentalId: "later", status: "paid" },
        { rentalId: "past", status: "paid" },
        { rentalId: "late", status: "paid" },
        { rentalId: "late", status: "past_due" },
        { rentalId: "closed", status: "paid" },
      ],
    });
    assert.deepEqual(
      rows.rows.map((row) => row.rentalId),
      ["soon", "edge"],
    );
    assert.equal(rows.rows[0].daysLeft, 2);
    assert.equal(rows.rows[0].paidCharges, 1);
    assert.equal(rows.rows[0].historyLabel, "Good");
    assert.equal(rows.rows[0].driverName, "Ada Lopez");
    assert.equal(rows.rows[0].vehicleLabel, "#12 · 2020 Toyota Camry");
    assert.equal(rows.through, "2026-11-04");
    assert.doesNotMatch(JSON.stringify(rows), /ada@|404|card|stripe/i);
  });

  it("uses the America/New_York calendar date around midnight", () => {
    assert.equal(easternCalendarDate(new Date("2026-01-15T04:59:00.000Z")), "2026-01-14");
    assert.equal(easternCalendarDate(new Date("2026-01-15T05:01:00.000Z")), "2026-01-15");
    assert.equal(easternCalendarDate(new Date("2026-03-08T06:59:00.000Z")), "2026-03-08");
    assert.equal(easternCalendarDate(new Date("2026-11-01T05:30:00.000Z")), "2026-11-01");
    const beforeMidnight = easternCalendarDate(new Date("2026-01-15T04:59:00.000Z"));
    assert.equal(beforeMidnight, "2026-01-14");
    assert.equal(endsWithinCandidateWindow("2026-01-14", beforeMidnight), true);
    assert.equal(endsWithinCandidateWindow("2026-01-28", beforeMidnight), true);
    assert.equal(endsWithinCandidateWindow("2026-01-14", "2026-01-15"), false);
  });
});
