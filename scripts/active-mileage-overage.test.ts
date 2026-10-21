// Active mileage overage stays dark, manager-only, and read-only
// (run: bun scripts/active-mileage-overage.test.ts).
import { readFileSync } from "node:fs";
import { ACTIVE_MILEAGE_OVERAGE_ENABLED } from "../src/lib/active-mileage-overage-flag";
import { allowanceTextFromAgreement, estimateMileageOverage } from "../src/lib/active-mileage-overage";

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

const handler = server.slice(server.indexOf(".handler"));
const thrown = handler.indexOf('if (!ACTIVE_MILEAGE_OVERAGE_ENABLED) throw new Error("Mileage Overage is off")');
const role = handler.indexOf("requireManager");
const read = handler.indexOf('.from("rentals")');
ok(thrown >= 0 && thrown < role && role < read, "the estimate throws before requireManager and before any read");
ok(thrown < handler.indexOf("import("), "the throw happens before any dynamic import");
ok(!server.slice(0, server.indexOf("export const listActiveMileageOverage")).includes("roles.server"), "the role module is not a static import");
ok(!server.slice(0, server.indexOf("export const listActiveMileageOverage")).includes("client.server"), "the admin client is not a static import");
ok((server.match(/\.limit\(LIMIT \+ 1\)/g) ?? []).length === 4, "rentals, start readings, last odometer, and agreements each use limit plus one");
ok(server.includes("rentalsTruncated") && server.includes("readingsQ.truncated") && server.includes("agreementsQ.truncated"), "a long page sets truncated and is not thrown");
ok(server.includes("ID_BATCH = 80"), "id filters are batched");
ok(!/\.(insert|update|delete|upsert|rpc)\(/.test(server + rules), "the estimate does not write");
ok(!/stripe|token_hash|signer_ip|notes/i.test(server), "the estimate does not read Stripe, tokens, or notes");
ok(server.includes('select("id,mileage")'), "the start odometer is the pickup reading");
ok(server.includes("current_odometer"), "the last recorded odometer is the vehicle's current reading");
ok(server.includes(".eq(\"status\", \"active\")"), "only active rentals are estimated");
ok(!bookings.includes("ACTIVE_MILEAGE_OVERAGE_ENABLED"), "the live bookings reader does not know this flag");

ok(
  ui.indexOf("if (!ACTIVE_MILEAGE_OVERAGE_ENABLED || !active) return") < ui.indexOf("useServerFn(listActiveMileageOverage)"),
  "the column returns before its server call",
);
ok(ui.includes(">Mileage Overage<") && ui.includes("Mileage Overage Is Capped") && ui.includes("Could Not Load Mileage Overage"), "the Active list shows the estimate, the cap, and a distinct load error");
ok(!nav.includes("mileage_overage"), "there is no new screen");

const rentalId = "10000000-0000-4000-8000-000000000001";
const today = "2026-10-21";
const base = {
  rentalId,
  startMiles: 10000,
  lastMiles: 12500,
  allowanceText: "1,500 miles",
  startDate: "2026-10-01",
  today,
};

const over = estimateMileageOverage(base);
ok(over.state === "over" && over.label === "1,000 Miles Over" && over.driven === 2500 && over.allowance === 1500, "driven miles past the allowance are the overage");

const within = estimateMileageOverage({ ...base, lastMiles: 11000 });
ok(within.state === "within" && within.label === "Within Allowance", "driven miles inside the allowance stay within it");

ok(estimateMileageOverage({ ...base, startMiles: null }).label === "Unknown", "a missing start odometer is Unknown");
ok(estimateMileageOverage({ ...base, lastMiles: null }).label === "Unknown", "a missing last odometer is Unknown");
ok(estimateMileageOverage({ ...base, allowanceText: null }).label === "Unknown", "a missing allowance is Unknown");
ok(estimateMileageOverage({ ...base, lastMiles: 9000 }).label === "Unknown", "a last reading below the start odometer is Unknown");
ok(estimateMileageOverage({ ...base, allowanceText: "Unlimited miles" }).label === "Unlimited", "an unlimited allowance is not an overage");

const weekly = estimateMileageOverage({
  ...base,
  lastMiles: 15000,
  allowanceText: "1,500 miles per week",
  startDate: "2026-10-01",
  today: "2026-10-21",
});
ok(weekly.allowance === 4500 && weekly.label === "500 Miles Over", "a weekly allowance counts the weeks since the start date");
ok(
  estimateMileageOverage({ ...base, allowanceText: "1,500 miles per week", startDate: null }).label === "Unknown",
  "a weekly allowance without a start date is Unknown",
);

const body = "| Service Area / Mileage Limit | Florida only; 1,500 miles per week |";
ok(allowanceTextFromAgreement(body) === "1,500 miles per week", "the allowance is the text printed on the agreement");
ok(allowanceTextFromAgreement("mileage_allowance: [[mileage_allowance]]") == null, "an unfilled placeholder is not an allowance");
ok(estimateMileageOverage({ ...base, lastMiles: 12001, allowanceText: "2,000 miles" }).label === "1 Mile Over", "one mile over stays singular");

console.log(fails ? `\n${fails} FAILURE(S)` : "\nall mileage overage checks pass");
process.exit(fails ? 1 : 0);
