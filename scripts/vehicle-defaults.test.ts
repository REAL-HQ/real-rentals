import { resolveVehicleDefaults } from "../src/lib/vehicle-defaults";
import { visibleSettingsSections } from "../src/components/admin/nav-config";
import { readFileSync } from "node:fs";

let fails = 0;
const ok = (c: boolean, m: string) => { console.log(`${c ? "  PASS" : "  FAIL"}  ${m}`); if (!c) fails++; };
const sedan = { body_type: "sedan", weekly_rate: 350, monthly_rate: 1300, deposit: 250 };
const suv = { body_type: "suv", weekly_rate: 425, monthly_rate: null, deposit: 350 };

let r = resolveVehicleDefaults({}, sedan);
ok(r.weekly_rate === 350 && r.monthly_rate === 1300 && r.deposit === 250 && r.sources.weekly_rate === "company_default", "A. Sedan defaults apply");
r = resolveVehicleDefaults({}, suv);
ok(r.weekly_rate === 425 && r.monthly_rate === null && r.sources.monthly_rate === "not_set", "B. SUV defaults; unconfigured field stays Not Set");
r = resolveVehicleDefaults({}, null);
ok(r.weekly_rate === null && r.deposit === null, "C. type with no defaults → Not Set, never $0");
r = resolveVehicleDefaults({ weekly_rate: 399 }, sedan);
ok(r.weekly_rate === 399 && r.sources.weekly_rate === "explicit" && r.deposit === 250, "D. explicit weekly rate overrides default");
r = resolveVehicleDefaults({ deposit: 0 }, sedan);
ok(r.deposit === 0 && r.sources.deposit === "explicit", "E. explicit $0 deposit overrides default");
r = resolveVehicleDefaults({ weekly_rate: null }, sedan);
ok(r.weekly_rate === null && r.sources.weekly_rate === "not_set", "explicit Not Set is respected");

const fn = readFileSync("src/lib/vehicle-defaults.functions.ts", "utf8");
ok((fn.match(/requireOwner\(context\.userId\)/g) ?? []).length === 2, "J/K. save + delete require Owner server-side");
ok(/requireStaff\(context\.userId\)/.test(fn), "all staff tiers may read defaults");
ok(visibleSettingsSections("coordinator").every((s) => s.id !== "vehicle_defaults"), "Coordinator: no Vehicle Defaults settings page");
const fi = readFileSync("src/lib/fleet-inbox.functions.ts", "utf8");
ok(/weekly_rate: null/.test(fi), "L. Fleet Inbox never derives a price from a document");

console.log(fails ? `\n${fails} FAILURE(S)` : "\nall assertions passed");
process.exit(fails ? 1 : 0);
