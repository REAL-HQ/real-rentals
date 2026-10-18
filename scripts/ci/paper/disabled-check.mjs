import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
// Pin the reviewed feature/retention guards; an intentional change requires review.
const expected = {
  "src/lib/paper-release.ts": "26436e31ebe226de18bc886d5242305c46cf69079efba74b9a4fde61c69ca67f",
  "src/lib/driver-deletion.functions.ts": "9ffb4a5eaae54751b8ba7c0a14a00fd72b81c37ca1dfb17a3459c23f98ab3ad2",
  "src/lib/driver-deletion.server.ts": "def0c19c1a9a6613ca033669eaf69657ec66a6200e75c17a0023ff7289240c09",
};
for (const [path, hash] of Object.entries(expected))
  assert.equal(createHash("sha256").update(readFileSync(path)).digest("hex"), hash, path + " disabled guard differs from reviewed source");
console.log("PASS reviewed Paper activation and destructive-cleanup guards unchanged");
