// Staff lead alert copy: the finished-application alert reads "New Applicant".
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const email = readFileSync(new URL("../src/lib/email.server.ts", import.meta.url), "utf8");
const notif = readFileSync(new URL("../src/lib/notifications.functions.ts", import.meta.url), "utf8");
assert.match(email, /`New Applicant: \$\{name\}`/);
assert.match(email, /event === "complete" \? "New Applicant" : "New Driver Lead"/);
assert.ok(!/Wizard Completed/.test(email + notif), "old 'Wizard Completed' copy is gone");
assert.match(notif, /<strong>New Applicant<\/strong>/);
assert.ok(/event === "complete"/.test(email), "event name 'complete' unchanged");
console.log("lead-alert-copy ok");
