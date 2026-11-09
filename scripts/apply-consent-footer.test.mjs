/**
 * The /apply contact step's Continue button must not float over the SMS
 * consent disclosure on a phone. A sticky bar there covered parts of the
 * disclosure until the page was scrolled (measured at Pixel 7 and iPhone SE
 * sizes); in the flow, Continue now sits after the consent, so the consent is
 * read before the button is reached. Static check of the markup.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync("src/routes/apply.tsx", "utf8");
const step = src.slice(src.indexOf("function ContactStep("), src.indexOf("function In("));
assert.ok(step.length > 0, "ContactStep not found");
const consent = step.indexOf("<SmsConsentField");
const footer = step.indexOf('data-testid="contact-continue"');
assert.ok(consent > 0, "the contact step renders the SMS consent field");
assert.ok(footer > consent, "Continue comes after the consent field");
const tag = step.slice(step.lastIndexOf("<div", footer), step.indexOf(">", footer) + 1);
assert.ok(!/\bsticky\b|\bfixed\b/.test(tag), `the Continue container is not sticky or fixed: ${tag}`);
assert.ok(/safe-area-inset-bottom/.test(tag), "the Continue container keeps its safe-area bottom padding");
console.log("PASS the /apply contact step keeps Continue in the flow after the SMS consent (not sticky)");
