// Renter "What To Do If..." checklists: run with `bun scripts/driver-guides.test.ts`.
import { readFileSync } from "node:fs";
import { DRIVER_GUIDES } from "../src/lib/driver-guides";
import { V114_SOURCE } from "../src/lib/agreement-v114";

let fails = 0;
const ok = (c: boolean, m: string) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) fails++; };
const all = DRIVER_GUIDES.flatMap((g) => [g.title, g.summary, ...g.steps, ...(g.dont ?? [])]).join("\n");

ok(DRIVER_GUIDES.length === 9 && new Set(DRIVER_GUIDES.map((g) => g.id)).size === 9, "nine guides with unique ids");
ok(DRIVER_GUIDES.every((g) => g.steps.length >= 4 && /^Rental Agreement, Section/.test(g.source)), "every guide has steps and names its agreement section");
ok(DRIVER_GUIDES[0].id === "accident" && DRIVER_GUIDES[0].steps[0] === "Call 911 if anyone is hurt.", "accident is first and starts with 911");
ok(DRIVER_GUIDES.every((g) => g.title.split(/\s+/).filter((w) => w !== "&").length <= 2), "titles are one or two words");
ok(!/\$\d/.test(all), "no fee amounts (fees live in the agreement)");
ok(!/[–—]/.test(all), "no em or en dashes");
// Deadlines must match the agreement wording they come from.
ok(/within 2 hours/.test(V114_SOURCE) && DRIVER_GUIDES.filter((g) => g.id === "accident" || g.id === "theft").every((g) => g.steps.some((s) => /within 2 hours/.test(s))), "2-hour notice matches Section 8");
ok(/written, signed statement within 24 hours/.test(V114_SOURCE) && /written, signed statement within 24 hours/.test(all), "24-hour statement matches Section 8");
ok(/not admit fault, accept or offer money, settle, or arrange towing or repairs yourself/.test(V114_SOURCE) && DRIVER_GUIDES[0].dont!.length === 3, "accident Do Not list matches Section 8");
ok(/stop driving, park the Vehicle safely, and tell us at once/.test(V114_SOURCE) && /stop driving, park the car safely, and tell us at once/.test(all), "lapse steps match Section 5.7");
ok(!/may not make.*claim/i.test(all), "nothing tells a renter not to report an injury or accident");

const portal = readFileSync("src/routes/portal.tsx", "utf8");
ok(portal.indexOf("<RoadsideHelpForm") < portal.indexOf("<WhatToDoGuides") && portal.indexOf("<WhatToDoGuides") < portal.indexOf("Report an Issue"), "shown on Report Issue, after the call button and before the report form");
const ui = readFileSync("src/components/portal/WhatToDoGuides.tsx", "utf8");
ok(/from "lucide-react"/.test(ui) && !/\p{Extended_Pictographic}/u.test(ui), "Lucide icons only, no emoji");
ok(!/useServerFn|supabase|fetch\(/.test(ui), "static: no queries and no writes");

if (fails) { console.error(`${fails} failed`); process.exit(1); }
console.log("All driver-guides checks passed");
