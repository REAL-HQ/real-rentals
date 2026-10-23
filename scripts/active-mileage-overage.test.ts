// Active mileage overage stays dark, manager-only, and read-only
// (run: bun scripts/active-mileage-overage.test.ts).
import { readFileSync } from "node:fs";
import { ACTIVE_MILEAGE_OVERAGE_ENABLED } from "../src/lib/active-mileage-overage-flag";
import { allowanceTextFromAgreement, easternCalendarDate, estimateMileageOverage, statedAllowance } from "../src/lib/active-mileage-overage";

let fails = 0;
const ok = (c: boolean, m: string) => {
  console.log(`${c ? "  PASS" : "  FAIL"}  ${m}`);
  if (!c) fails++;
};

const flag = readFileSync("src/lib/active-mileage-overage-flag.ts", "utf8");
const rules = readFileSync("src/lib/active-mileage-overage.ts", "utf8");
const server = readFileSync("src/lib/active-mileage-overage.functions.ts", "utf8");
const ui = readFileSync("src/components/admin/BookingsPanel.tsx", "utf8");
const nav = readFileSync("src/components/admin/nav-config.ts", "utf8");
const bookings = readFileSync("src/lib/bookings.functions.ts", "utf8");

ok(ACTIVE_MILEAGE_OVERAGE_ENABLED === false, "ACTIVE_MILEAGE_OVERAGE_ENABLED is false");
ok(flag.split("ACTIVE_MILEAGE_OVERAGE_ENABLED =").length === 2, "the hard-false flag is declared once");
ok(!rules.includes("ACTIVE_MILEAGE_OVERAGE_ENABLED ="), "the estimate does not declare a second flag");
ok(!/process\.env/.test(flag + rules + server), "no environment variable can open the flag");

const thrown = server.indexOf('if (!ACTIVE_MILEAGE_OVERAGE_ENABLED) throw new Error("Mileage Overage is off")');
const middleware = server.indexOf("[refuseMileageOverage, requireSupabaseAuth]");
ok(thrown >= 0 && thrown < middleware, "the flag throws before the auth middleware runs");
const handler = server.slice(server.indexOf(".handler"));
const role = handler.indexOf("requireManager");
const read = handler.indexOf('.from("rentals")');
ok(role >= 0 && role < read, "the role check happens before any read");
ok(server.includes("easternCalendarDate(new Date())") && !handler.includes("toISOString()"), "today is the Eastern calendar day");
ok(!server.slice(0, server.indexOf("export const listActiveMileageOverage")).includes("roles.server"), "the role module is not a static import");
ok(!server.slice(0, server.indexOf("export const listActiveMileageOverage")).includes("client.server"), "the admin client is not a static import");
ok((server.match(/\.limit\(LIMIT \+ 1\)/g) ?? []).length === 4, "rentals, start readings, last odometer, and agreements each use limit plus one");
ok(server.includes("rentalsTruncated") && server.includes("readingsQ.truncated") && server.includes("agreementsQ.truncated"), "a long page sets truncated and is not thrown");
ok(server.includes("ID_BATCH = 80"), "id filters are batched");
ok(!/\.(insert|update|delete|upsert|rpc)\(/.test(server + rules), "the estimate does not write");
ok(!/stripe|token_hash|signer_ip|notes/i.test(server), "the estimate does not read Stripe, tokens, or notes");
ok(server.includes('select("id,mileage,status,vehicle_id")'), "the pickup reading includes its status and vehicle");
ok(server.includes('select("id,rental_id,status,signed_at,agreement_mileage_allowance")'), "the allowance is one field, not the agreement");
ok(!/select\([^)]*body/.test(server), "the estimate does not select the agreement body");
ok(server.includes("current_odometer"), "the last recorded odometer is the vehicle's current reading");
ok(server.includes(".eq(\"status\", \"active\")"), "only active rentals are read");
ok(server.includes("rentalStatus: rental.status"), "a row that is not active is not estimated");
ok(!bookings.includes("ACTIVE_MILEAGE_OVERAGE_ENABLED"), "the live bookings reader does not know this flag");

ok(
  ui.indexOf("if (!ACTIVE_MILEAGE_OVERAGE_ENABLED || !active) return") < ui.indexOf("useServerFn(listActiveMileageOverage)"),
  "the column returns before its server call",
);
ok(ui.includes('ACTIVE_MILEAGE_OVERAGE_ENABLED && overage.status === "error"') && ui.includes("Could Not Load Mileage Overage"), "the load error is behind the flag");
ok(ui.includes("ACTIVE_MILEAGE_OVERAGE_ENABLED && overage.truncated") && ui.includes("Mileage Overage Is Capped"), "the cap notice is behind the flag");
ok(ui.includes('ACTIVE_MILEAGE_OVERAGE_ENABLED && overage.status !== "off"') && ui.includes(">Mileage Overage<"), "the column title is behind the flag");
const line = ui.slice(ui.indexOf("function MileageOverageLine"));
ok(line.indexOf("ACTIVE_MILEAGE_OVERAGE_ENABLED &&") < line.indexOf("Mileage Overage · "), "the mobile line is behind the flag");
const sql = readFileSync("supabase/migrations/20261021120000_agreement_mileage_allowance.sql", "utf8");
ok(sql.includes("agreement_mileage_allowance(agreement public.agreements)") && sql.includes("SET search_path = ''"), "the allowance field is one read-only function");
ok(/REVOKE ALL ON FUNCTION public\.agreement_mileage_allowance\(public\.agreements\) FROM PUBLIC/.test(sql), "the allowance field is not granted to every role");
ok(/REVOKE EXECUTE ON FUNCTION public\.agreement_mileage_allowance\(public\.agreements\) FROM PUBLIC, anon, authenticated/.test(sql), "anonymous and signed-in callers cannot execute the allowance field");
ok(sql.includes("GRANT EXECUTE ON FUNCTION public.agreement_mileage_allowance(public.agreements) TO service_role"), "only the server role can read the allowance field");
ok(!nav.includes("mileage_overage"), "there is no new screen");
ok(easternCalendarDate(new Date("2026-10-21T03:30:00Z")) === "2026-10-20", "03:30 UTC is still the previous Eastern day");
ok(easternCalendarDate(new Date("2026-10-21T04:00:00Z")) === "2026-10-21", "04:00 UTC is Eastern midnight");

const rentalId = "10000000-0000-4000-8000-000000000001";
const vehicleId = "20000000-0000-4000-8000-000000000002";
const today = "2026-10-21";
const base = {
  rentalId,
  rentalStatus: "active",
  vehicleId,
  startMiles: 10000,
  readingStatus: "valid",
  readingVehicleId: vehicleId,
  lastMiles: 12500,
  allowanceText: "2,000 miles per rental",
  startDate: "2026-10-01",
  today,
};

const over = estimateMileageOverage(base);
ok(over.state === "over" && over.label === "500 Miles Over" && over.driven === 2500 && over.allowance === 2000, "driven miles past a per-rental allowance are the overage");

const within = estimateMileageOverage({ ...base, lastMiles: 11000 });
ok(within.state === "within" && within.label === "Within Allowance", "driven miles inside the allowance stay within it");

ok(estimateMileageOverage({ ...base, startMiles: null }).label === "Unknown", "a missing start odometer is Unknown");
ok(estimateMileageOverage({ ...base, lastMiles: null }).label === "Unknown", "a missing last odometer is Unknown");
ok(estimateMileageOverage({ ...base, allowanceText: null }).label === "Unknown", "a missing allowance is Unknown");
ok(estimateMileageOverage({ ...base, lastMiles: 9000 }).label === "Unknown", "a last reading below the start odometer is Unknown");
ok(estimateMileageOverage({ ...base, allowanceText: "Unlimited miles" }).label === "Unlimited", "an unlimited allowance is not an overage");
ok(estimateMileageOverage({ ...base, allowanceText: "unlimited" }).label === "Unknown", "only the exact unlimited phrase is unlimited");
ok(estimateMileageOverage({ ...base, allowanceText: "1,500 miles" }).label === "Unknown", "a bare mile count is not an allowance");
ok(estimateMileageOverage({ ...base, allowanceText: "1,500 km" }).label === "Unknown", "kilometers are not miles");
ok(estimateMileageOverage({ ...base, allowanceText: "500 km per week" }).label === "Unknown", "a non-mile period is Unknown");

const weekly = estimateMileageOverage({
  ...base,
  lastMiles: 15000,
  allowanceText: "1,500 miles per week",
  startDate: "2026-10-01",
  today: "2026-10-21",
});
ok(weekly.allowance === 4500 && weekly.label === "500 Miles Over", "twenty days is three weekly allowances");
ok(
  estimateMileageOverage({ ...base, allowanceText: "1,500 miles per week", startDate: today, today }).allowance === 1500,
  "the start date is one week",
);
ok(
  estimateMileageOverage({ ...base, allowanceText: "1,500 miles per week", startDate: "2026-10-14", today }).allowance === 1500,
  "exactly seven days is still one week",
);
ok(
  estimateMileageOverage({ ...base, allowanceText: "1,500 miles per week", startDate: "2026-10-13", today }).allowance === 3000,
  "the eighth day opens a second week",
);
ok(
  estimateMileageOverage({ ...base, allowanceText: "1,500 miles per week", startDate: null }).label === "Unknown",
  "a weekly allowance without a start date is Unknown",
);

const daily = estimateMileageOverage({ ...base, allowanceText: "100 miles per day", startDate: "2026-10-01", today });
ok(daily.allowance === 2000 && daily.label === "500 Miles Over", "a daily allowance counts the days since the start date");
ok(
  estimateMileageOverage({ ...base, allowanceText: "100 miles per day", startDate: null }).label === "Unknown",
  "a daily allowance without a start date is Unknown",
);

const monthly = estimateMileageOverage({ ...base, allowanceText: "1,000 miles per month", lastMiles: 12500 });
ok(monthly.allowance === 1000 && monthly.label === "1,500 Miles Over", "a date inside the start month is one month");
ok(
  estimateMileageOverage({ ...base, allowanceText: "1,000 miles per month", startDate: "2026-09-21", today }).allowance === 1000,
  "an exact month anniversary is one month",
);
ok(
  estimateMileageOverage({ ...base, allowanceText: "1,000 miles per month", startDate: "2026-09-20", today }).allowance === 2000,
  "the day after a month anniversary opens the next month",
);
ok(
  estimateMileageOverage({ ...base, allowanceText: "1,000 miles per month", startDate: null }).label === "Unknown",
  "a monthly allowance without a start date is Unknown",
);

ok(
  estimateMileageOverage({ ...base, lastMiles: 12001, allowanceText: "2,000 miles per rental", startDate: null }).label === "1 Mile Over",
  "a per-rental allowance is the whole cap, and one mile over stays singular",
);

ok(estimateMileageOverage({ ...base, readingStatus: "superseded" }).label === "Unknown", "a superseded pickup reading is Unknown");
ok(estimateMileageOverage({ ...base, readingStatus: "conflict" }).label === "Unknown", "a conflicting pickup reading is Unknown");
ok(estimateMileageOverage({ ...base, readingStatus: null }).label === "Unknown", "a pickup reading with no status is Unknown");
ok(
  estimateMileageOverage({ ...base, readingVehicleId: "30000000-0000-4000-8000-000000000003" }).label === "Unknown",
  "a pickup reading from another vehicle is Unknown",
);
ok(estimateMileageOverage({ ...base, rentalStatus: "closed" }).label === "Unknown", "a rental that is not active is Unknown");
ok(estimateMileageOverage({ ...base, rentalStatus: null }).label === "Unknown", "a rental with no status is Unknown");

const body = "| Service Area / Mileage Limit | Florida only; 1,500 miles per week |";
ok(allowanceTextFromAgreement(body) === "1,500 miles per week", "the allowance is the text printed on the agreement");
ok(statedAllowance("1,500 miles per week") === "1,500 miles per week", "an already extracted phrase is the allowance");
ok(allowanceTextFromAgreement("mileage_allowance: [[mileage_allowance]]") == null, "an unfilled placeholder is not an allowance");
ok(statedAllowance("[[mileage_allowance]]") == null, "a placeholder field is not an allowance");

console.log(fails ? `\n${fails} FAILURE(S)` : "\nall mileage overage checks pass");
process.exit(fails ? 1 : 0);
