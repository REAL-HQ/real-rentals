// Insurance Authorization on the application: run with `bun scripts/insurance-consent.test.ts`.
import { readFileSync } from "node:fs";
import { INSURANCE_CONSENT_ITEMS, INSURANCE_CONSENT_LABEL, INSURANCE_CONSENT_TEXT, INSURANCE_CONSENT_VERSION } from "../src/lib/insurance-consent";

let fails = 0;
const ok = (c: boolean, m: string) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) fails++; };

ok(INSURANCE_CONSENT_ITEMS.length === 5, "five authorization items");
ok(INSURANCE_CONSENT_ITEMS.map((i) => i.title).join("|") === "Quotes|Policy In My Name|Included In My Rate|Accurate Information|No Obligation", "items in the agreed order");
ok(/^\d{4}-\d{2}-\d{2}\.v\d+$/.test(INSURANCE_CONSENT_VERSION), "versioned");
ok(INSURANCE_CONSENT_TEXT.startsWith(INSURANCE_CONSENT_LABEL) && INSURANCE_CONSENT_ITEMS.every((i) => INSURANCE_CONSENT_TEXT.includes(i.text)), "stored evidence holds the label and every item");
ok(/motor vehicle report/.test(INSURANCE_CONSENT_TEXT) && /household/.test(INSURANCE_CONSENT_TEXT) && /liability coverage only/.test(INSURANCE_CONSENT_TEXT), "covers MVR, household members and liability-only coverage");
ok(!/[–—]/.test(INSURANCE_CONSENT_TEXT), "no em or en dashes");

const fn = readFileSync("src/lib/applications.functions.ts", "utf8");
ok(/insurance_consent: z\.literal\(true\)\.optional\(\)/.test(fn), "the server accepts only an affirmative tick");
ok(/k === "trip_screenshots_keep" \|\| k === "insurance_consent"/.test(fn), "the tick is never written to an applications column");
const block = fn.slice(fn.indexOf("// Insurance Authorization evidence."), fn.indexOf("// Mirror any files the applicant uploaded"));
ok(/fields\.insurance_consent === true/.test(block) && /INSURANCE_CONSENT_TEXT/.test(block) && /INSURANCE_CONSENT_VERSION/.test(block) && /logAudit\(null/.test(block), "evidence is written server-side with the module's wording and version");
ok(fn.indexOf("if (!row) throw new Error(APPLICATION_LOCKED_MESSAGE);") < fn.indexOf("// Insurance Authorization evidence."), "evidence is written only after the application saved");

const ui = readFileSync("src/components/site/ApplicationWizard.tsx", "utf8");
ok(/useState\(false\);\s*\n\s*const canSubmit = !!state\.gig_status && !!state\.drive_type && insuranceConsent;/.test(ui), "unchecked by default and required to submit");
ok(/go\("submitted", \{ \.\.\.fieldsFor\("driving", state\), insurance_consent: true \}\)/.test(ui), "only the submission carries the authorization");
const autosave = ui.slice(ui.indexOf("function fieldsFor"), ui.indexOf("function fieldsFor") + 900);
ok(!/insurance_consent/.test(autosave), "autosave never sends the authorization");

if (fails) { console.error(`${fails} failed`); process.exit(1); }
console.log("All insurance-consent checks passed");
