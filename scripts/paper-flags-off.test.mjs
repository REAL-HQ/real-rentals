/**
 * Flags off: paper UI and handlers refuse, and the live deletion path is the
 * revenue-publication source. No database connection.
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

let fail = 0;
const ok = (c, l) => {
  if (!c) fail++;
  console.log(`  ${c ? "PASS" : "BLOCKER"}  ${l}`);
};

const release = readFileSync("src/lib/paper-release.ts", "utf8");
ok(
  /visible:\s*false/.test(release) && /registration:\s*false/.test(release),
  "PAPER_RELEASE visible and registration are false",
);

const handlers = readFileSync("src/lib/paper-agreements.functions.ts", "utf8");
ok(
  handlers.includes("if (!PAPER_RELEASE.visible || (write && !PAPER_RELEASE.registration)) throw Error(PAPER_HOLD);"),
  "every paper handler authorizes through the flags before storage or RPC",
);
ok(!handlers.includes("logAudit("), "paper handlers do not write audit rows themselves");

const ui = readFileSync("src/components/admin/PaperAgreements.tsx", "utf8");
ok(ui.includes("if (!PAPER_RELEASE.visible) return null;"), "the panel renders nothing while hidden");

const card = readFileSync("src/components/admin/AgreementsCard.tsx", "utf8");
ok(card.includes("<PaperAgreements applicationId={applicationId} />"), "Agreements mounts the hidden panel");

const purge = readFileSync("src/lib/driver-deletion.functions.ts", "utf8");
ok(purge.includes('run(context, "purge_application"'), "purgeDriver still calls purge_application");
ok(purge.includes("processFileJobs(data.applicationId)"), "purgeDriver still runs file cleanup");
ok(!purge.includes("readPaperRetention"), "purgeDriver does not read paper retention");
ok(!purge.includes("paper-retention"), "driver deletion does not import paper retention");

const jobs = readFileSync("src/lib/driver-deletion.server.ts", "utf8");
ok(jobs.includes('.storage.from(j.bucket).remove([j.path])'), "file cleanup still removes queued objects");
ok(!jobs.includes("Cleanup disabled"), "file cleanup is not replaced by the disabled stub");

const untouched = [
  "src/lib/driver-deletion.functions.ts",
  "src/lib/driver-deletion.server.ts",
  "src/components/admin/DeleteDriverDialog.tsx",
  "src/components/admin/RecentlyDeletedDialog.tsx",
  "src/lib/esign.server.ts",
];
for (const file of untouched) {
  let same = true;
  try {
    execFileSync("git", ["diff", "--exit-code", "origin/codex/revenue-publication", "--", file], { stdio: "ignore" });
  } catch {
    same = false;
  }
  ok(same, `${file} matches revenue-publication`);
}

const sql = readFileSync("proposed/paper-agreements-v1.sql", "utf8");
ok(sql.includes("private.is_manager()"), "proposed SQL gates registration on private.is_manager()");
ok(!/drizzle\/migrations\/.*paper/.test(sql) && sql.startsWith("-- Paper Agreements v1. PROPOSED ONLY."), "SQL is marked proposed and is not a drizzle migration");

console.log(fail ? `\n${fail} FAILURE(S)` : "\nall assertions passed");
process.exit(fail ? 1 : 0);
