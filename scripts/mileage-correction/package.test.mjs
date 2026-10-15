import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const sql = readFileSync(new URL("./correction.proposed.sql.review", import.meta.url), "utf8");
const hash = (s) => createHash("sha256").update(s).digest("hex");
assert.equal(hash(sql), "b41e2d2de2f08f9957f2de855ab3b7c6b5488f19ffd3a6476913f8176708a74c");
const read = (p) => readFileSync(new URL("../../" + p, import.meta.url), "utf8");
assert.equal(
  hash(read("src/lib/maintenance-rules.ts")),
  "a80290a6b8b6a9769fd5c3f1a69228ca82bab0784a440d1f37e5554788ec445a",
);
assert.match(read("drizzle.config.ts"), /out: "\.\/drizzle\/migrations"/);
assert.doesNotMatch(read("drizzle/migrations/meta/_journal.json"), /mileage.correction/);
assert.match(
  sql,
  /current_database\(\)<>'rr_scope_prototype_local' OR inet_server_addr\(\) IS NOT NULL/,
);
assert.match(sql, /SECURITY DEFINER SET search_path=''/);
assert.match(sql, /ORDER BY observed_on DESC,observed_at DESC NULLS LAST,id DESC/);
assert.match(sql, /FOR EACH STATEMENT EXECUTE FUNCTION private\.lock_vehicle_release\(\)/);
assert.match(
  read("scripts/safe-vehicle-release/migration.proposed.sql"),
  /pg_advisory_xact_lock\(710026,2\)/,
);
assert.doesNotMatch(sql, /(?:DISABLE ROW LEVEL SECURITY|DISABLE TRIGGER|GRANT|EXECUTE IMMEDIATE)/i);
assert.match(
  sql,
  /REVOKE EXECUTE ON FUNCTION public\.inspection_odometer_to_history\(\),public\.vehicle_sync_current_odometer\(\) FROM PUBLIC,anon,authenticated/,
);
console.log("11 static package/security/dependency checks passed; not a hosted authority proof");
