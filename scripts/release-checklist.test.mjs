// The checklist's real gates are not run here. These checks stub the commands.
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CHECKLIST_ROOT, RC_DIFF_SCRIPT, classifySupabaseHits, DUMMY_ENV, runChecklist } from "./release-checklist.mjs";

const script = fileURLToPath(new URL("./release-checklist.mjs", import.meta.url));
let fail = 0;
const ok = (cond, label) => {
  if (!cond) fail++;
  console.log(`  ${cond ? "ok  " : "FAIL"} ${label}`);
};

const vendorOnly = classifySupabaseHits(["_libs/supabase__supabase-js.mjs", "index.mjs"]);
ok(vendorOnly.exit === 1 && vendorOnly.outside.join() === "index.mjs", "a hit outside _libs stops");
const libs = classifySupabaseHits(["_libs/supabase__auth-js.mjs"]);
ok(libs.exit === 0 && libs.vendor.length === 1, "a vendored library example does not stop");
ok(classifySupabaseHits([]).exit === 0, "no supabase.co hit does not stop");

const root = mkdtempSync(join(tmpdir(), "release-checklist-"));
const repo = join(root, "repo");
mkdirSync(join(repo, ".output", "server", "_libs"), { recursive: true });
writeFileSync(join(repo, ".output", "server", "_libs", "lib.mjs"), "https://xyzcompany.supabase.co");
writeFileSync(join(repo, ".output", "server", "index.mjs"), "http://127.0.0.1:9");

const calls = [];
const passing = (cmd, options) => {
  calls.push({ cmd, env: options.env, cwd: options.cwd });
  return { status: 0 };
};
const good = runChecklist({ repo, from: "-live", to: "rc", diffOut: join(root, "diff"), spawn: passing });
ok(good.verdict === "PASS", "every zero exit is PASS");
ok(good.text.trim().endsWith("PASS"), "the summary ends with PASS");
ok(good.steps.find((step) => step.name === "supabase.co")?.exit === 0, "vendor-only output passes supabase.co");
const build = calls.find((call) => call.cmd[0] === "npm" && call.cmd[1] === "run");
ok(build?.env?.VITE_SUPABASE_URL === DUMMY_ENV.VITE_SUPABASE_URL, "the build receives the dummy Supabase URL");
ok(build?.env?.NODE_OPTIONS === "--max-old-space-size=4096", "the build raises the Node heap");
const diff = calls.find((call) => call.cmd.includes("--all-flags"));
ok(diff?.cmd.includes("--from") && diff.cmd.includes("-live") && diff.cmd.includes("--to") && diff.cmd.includes("rc"), "rc-diff keeps a ref that starts with -");
ok(diff?.cmd[1] === RC_DIFF_SCRIPT && diff.cmd[1].endsWith(`${join("scripts", "rc-diff-report.mjs")}`), "rc-diff is the script beside the checklist");
ok(diff?.cwd === CHECKLIST_ROOT && diff.cwd !== repo, "rc-diff runs in the checklist checkout");

const stopped = runChecklist({
  repo,
  from: "a",
  to: "b",
  diffOut: join(root, "diff2"),
  spawn: (cmd) => ({ status: cmd[0] === "npx" ? 2 : 0 }),
});
ok(stopped.verdict === "STOP", "a failed gate is STOP");
ok(stopped.steps.find((step) => step.name === "tsc")?.exit === 2, "tsc keeps its exit code");
ok(stopped.text.includes("STOP tsc exit 2"), "the summary names the stopped gate");

writeFileSync(join(repo, ".output", "server", "app.mjs"), "https://project.supabase.co");
const leaked = runChecklist({ repo, from: "a", to: "b", diffOut: join(root, "diff3"), spawn: () => ({ status: 0 }) });
ok(leaked.verdict === "STOP" && leaked.steps.find((step) => step.name === "supabase.co")?.exit === 1, "supabase.co outside _libs stops");

const missing = spawnSync(process.execPath, [script], { encoding: "utf8" });
ok(missing.status === 2, "missing refs exit 2");

rmSync(root, { recursive: true, force: true });
if (fail) {
  console.log(`release-checklist: ${fail} failed`);
  process.exit(1);
}
console.log("release-checklist: ok");
