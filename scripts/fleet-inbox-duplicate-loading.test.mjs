// Regression: duplicate-only uploads and failed batch loads must not strand the page on "Loading…".
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const s = readFileSync(new URL("../src/components/admin/FleetInboxPanel.tsx", import.meta.url), "utf8");
assert.match(s, /else if \(dups === ok\.length\) \{/, "all-duplicate upload never opens the empty new import");
assert.match(s, /catch \(e\) \{\s*setLoadError\(/, "batch load failures are caught");
assert.match(s, /if \(!d && loadError\) return \(/, "load error state renders");
const loadingBlocks = s.split("Loading…").length - 1;
assert.ok(/>Back<\/button>[\s\S]{0,200}Loading…/.test(s), "batch Loading state offers Back");
console.log("fleet-inbox-duplicate-loading: PASS (" + loadingBlocks + " loading states)");
