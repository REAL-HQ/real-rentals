/**
 * The maintenance company-share flag is one hard-false constant.
 * No environment variable, no second declaration, no migration.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

let fail = 0;
const ok = (condition, label) => {
  if (!condition) fail += 1;
  console.log(`  ${condition ? "PASS" : "BLOCKER"}  ${label}`);
};

const skip = new Set(["node_modules", ".git", ".output", "dist"]);
const files = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (skip.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.(ts|tsx|mjs|js|sql|md)$/.test(name)) files.push(path);
  }
}
for (const root of ["src", "scripts", "proposed", "supabase"]) walk(root);

const declaration = "export const MAINTENANCE_COMPANY_SHARE_ENABLED = false;";
const declaredIn = files.filter((file) => file !== "scripts/flag-single-source.test.mjs" && readFileSync(file, "utf8").includes(declaration));
ok(declaredIn.length === 1 && declaredIn[0] === "src/lib/maintenance-company-share-flag.ts", "company-share flag is declared once");
for (const file of declaredIn) console.log(`       ${file}`);

const flag = readFileSync("src/lib/maintenance-company-share-flag.ts", "utf8");
ok(!flag.includes("process.env"), "the flag file does not read the environment");
ok(!files.some((file) => /MAINTENANCE_COMPANY_SHARE_ENABLED\s*=\s*true/.test(readFileSync(file, "utf8"))), "nothing assigns the flag true");

const migrations = files.filter((file) => file.startsWith("supabase/migrations/") && readFileSync(file, "utf8").includes("WHEN m.company_share = 0 AND m.partner_share = 0 AND m.total_cost > 0 THEN"));
ok(migrations.length === 0, "the unlinked-share rule is not in a migration");

console.log(fail ? `\n${fail} FAILURE(S)` : "\nall assertions passed");
process.exit(fail ? 1 : 0);
