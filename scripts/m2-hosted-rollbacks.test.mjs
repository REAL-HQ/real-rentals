// The hosted rollback variants differ from the approved rollbacks by exactly
// one removed line and one added line, nothing else.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build } from "./m2-hosted-rollbacks.mjs";

for (const v of build()) {
  const original = readFileSync(`proposed/rollback/${v.file}`, "utf8").split("\n");
  const committed = readFileSync(v.path, "utf8");
  assert.equal(committed, v.text, `${v.path} is not the generator output`);
  const body = committed.split("\n").filter((l, i) => !(i < 4 && l.startsWith("--")));
  const removed = original.filter((l) => !body.includes(l));
  const added = body.filter((l) => !original.includes(l));
  assert.deepEqual(removed, [`REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "vault" FROM "${v.role}";`], `${v.file}: removed lines`);
  assert.deepEqual(added, [`GRANT "${v.role}" TO postgres WITH INHERIT TRUE;`], `${v.file}: added lines`);
  const g = body.indexOf(added[0]);
  assert.equal(body[g + 1], `DROP OWNED BY "${v.role}";`, `${v.file}: GRANT must immediately precede DROP OWNED BY`);
  assert.equal(body.length, original.length, `${v.file}: line count`);
}
console.log("m2-hosted-rollbacks: 3 variants, each exactly one line removed and one added");
