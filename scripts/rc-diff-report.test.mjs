// Fixture repo only. The report reads local git and bundle files.
import { spawnSync } from "node:child_process";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyFlag, extractStrings, isUserVisible, parseFlags, parseServerFns } from "./rc-diff-report.mjs";

const script = fileURLToPath(new URL("./rc-diff-report.mjs", import.meta.url));
let fail = 0;
const ok = (cond, label) => {
  if (!cond) fail++;
  console.log(`  ${cond ? "ok  " : "FAIL"} ${label}`);
};

ok(classifyFlag("false") === "false", "literal false");
ok(classifyFlag("false as boolean") === "false", "false as boolean");
ok(classifyFlag('process.env.FOO_ENABLED === "true"') === "env", "env gate");
ok(classifyFlag("true") === "true", "literal true");
const fnGate = parseFlags(`export function collectionsWatchEnabled(env: { COLLECTIONS_WATCH_ENABLED?: string } = process.env): boolean {
  return env.COLLECTIONS_WATCH_ENABLED === "true";
}`);
ok(fnGate.length === 1 && fnGate[0].value === "env", "function env gate counts as env");
const readGate = parseFlags('if (process.env.DOCUMENT_EXPIRY_NOTICES_ENABLED === "true") return;');
ok(readGate.length === 1 && readGate[0].value === "env", "process.env read counts as env");
const cronGate = parseFlags('if (process.env.DOCUMENT_EXPIRY_NOTICES_ENABLED === "true") {\n  return;\n}\n');
ok(
  cronGate.length === 1 && cronGate[0].expression === 'process.env.DOCUMENT_EXPIRY_NOTICES_ENABLED === "true"',
  "DOCUMENT_EXPIRY comparison stops before ) {",
);
const hard = parseFlags("export const MANUAL_PAYMENTS_LIVE = false;\nexport const METHOD_LABEL = { cash: \"Cash\" };\n");
ok(hard.length === 1 && hard[0].name === "MANUAL_PAYMENTS_LIVE" && hard[0].value === "false", "a hard flag without _ENABLED is kept");
const paper = parseFlags("export const PAPER_RELEASE = { visible: false, registration: false } as const;\n");
ok(paper.length === 1 && paper[0].value === "false", "a boolean object is a hard flag");

const commented = parseFlags('// export const HIDDEN_ENABLED = true;\nexport const FOO_ENABLED = false;\n');
ok(commented.length === 1 && commented[0].name === "FOO_ENABLED", "commented flag is ignored");
ok(parseServerFns("/* export const ghost = createServerFn() */\nexport const oldFn = createServerFn({ method: \"POST\" });\n").join() === "oldFn", "commented server function is ignored");
const mined = extractStrings('const re = /["`]/; const label = "Copy Draft Now"; const q = `Keep ${name} Phrase`;');
ok(mined.includes("Copy Draft Now") && mined.includes("Keep ") && mined.includes(" Phrase"), "a parser reads strings around a regex");
ok(!mined.some((item) => item.includes("RegExp") || item.includes("label")), "a regex is not a string");
ok(isUserVisible("Copy Draft Now"), "a title-case phrase is user-visible");
ok(!isUserVisible("notAPhrase"), "an identifier is not user-visible");
ok(!isUserVisible("https://example.com/x y"), "a URL is not user-visible");
ok(!isUserVisible("mt-3 text-xs text-muted-foreground"), "a class list is not user-visible");
ok(!isUserVisible("Apply") && isUserVisible("Apply", "loose"), "loose mode keeps a single word");
ok(!isUserVisible("save draft") && isUserVisible("save draft", "loose"), "loose mode keeps lowercase text");
ok(!isUserVisible("mt-3 text-xs", "loose"), "loose mode still drops a class list");

const source = readFileSync(script, "utf8");
ok(!source.includes("fetch") && !/\b(?:curl|wget)\b/.test(source), "the report script has no network client");
ok(source.includes("--out accepts any directory path"), "the script documents that --out accepts any path");
ok(source.includes('name that starts with "-"'), "the script documents revisions that start with a hyphen");
ok(!/node:(?:https|http|net|dns)/.test(source), "the report script does not import a network module");

const root = mkdtempSync(join(tmpdir(), "rc-diff-"));
const repo = join(root, "repo");
const baseBundle = join(root, "base");
const headBundle = join(root, "head");
mkdirSync(repo);
const git = (args, env = {}) =>
  execFileSync("git", args, {
    cwd: repo,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...env },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
git(["init", "-b", "main"]);
git(["config", "user.email", "test@example.com"]);
git(["config", "user.name", "Test"]);
mkdirSync(join(repo, "src"));
writeFileSync(
  join(repo, "src", "flags.ts"),
  'export const FOO_ENABLED = process.env.FOO_ENABLED === "true";\nexport const STAY_ENABLED = false;\n// export const HIDDEN_ENABLED = true;\nexport const MANUAL_PAYMENTS_LIVE = false;\n',
);
writeFileSync(join(repo, "src", "api.functions.ts"), 'export const oldFn = createServerFn({ method: "POST" });\n');
git(["add", "."]);
git(["commit", "-m", "base"], { GIT_AUTHOR_DATE: "2020-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2020-01-01T00:00:00Z" });
const base = git(["rev-parse", "HEAD"]).trim();
git(["checkout", "-b", "feature/flags"]);
writeFileSync(
  join(repo, "src", "flags.ts"),
  "export const FOO_ENABLED = false;\nexport const STAY_ENABLED = false;\nexport const NEW_ENABLED = false;\nexport const MANUAL_PAYMENTS_LIVE = false;\nexport const SAMPLE_LIVE = false;\n",
);
writeFileSync(
  join(repo, "src", "api.functions.ts"),
  'export const oldFn = createServerFn({ method: "POST" });\nexport const prepareLeadFollowUp = createServerFn({ method: "POST" });\n// export const ghost = createServerFn();\n',
);
writeFileSync(join(repo, "src", "extra.ts"), "export const note = true;\n");
git(["add", "."]);
git(["commit", "-m", "Turn the sample flag hard-false. #42"], {
  GIT_AUTHOR_DATE: "2020-01-02T00:00:00Z",
  GIT_COMMITTER_DATE: "2020-01-02T00:00:00Z",
});
git(["checkout", "main"]);
git(["cherry-pick", "feature/flags"]);
const head = git(["rev-parse", "HEAD"]).trim();

mkdirSync(baseBundle);
mkdirSync(headBundle);
writeFileSync(join(baseBundle, "app.js"), 'const a = "Welcome Home"; const b = "Keep This Phrase"; const c = "Old Greeting Here";\n');
writeFileSync(
  join(headBundle, "app.js"),
  'const a = "Welcome Home"; const b = "Keep This Phrase"; const c = "Copy Draft Now"; const d = "https://example.com/x y"; const e = "notAPhrase"; const f = "mt-3 text-xs"; const g = "Apply"; const h = "save draft";\n',
);

const out = join(root, "out");
const run = spawnSync(
  process.execPath,
  [
    script,
    "--repo",
    repo,
    "--from",
    base,
    "--to",
    head,
    "--bundle-from",
    baseBundle,
    "--bundle-to",
    headBundle,
    "--out",
    out,
  ],
  { encoding: "utf8" },
);
ok(run.status === 0, `fixture report exits 0 (${run.stderr?.trim() || "no stderr"})`);
const report = JSON.parse(readFileSync(join(out, "rc-diff.json"), "utf8"));
const markdown = readFileSync(join(out, "rc-diff.md"), "utf8");
ok(report.from === base && report.to === head, "report records both revisions");
const flag = report.flags.find((item) => item.name === "FOO_ENABLED");
ok(flag?.from === "env" && flag?.to === "false", "FOO_ENABLED moves from env to false");
ok(!report.flags.some((item) => item.name === "STAY_ENABLED" || item.name === "HIDDEN_ENABLED"), "unchanged and commented flags stay out");
ok(report.flags.some((item) => item.name === "NEW_ENABLED" && item.from === "absent" && item.to === "false"), "a new hard-false flag is listed");
ok(report.serverFunctions.added.some((item) => item.name === "prepareLeadFollowUp" && item.file === "src/api.functions.ts"), "new server function is listed");
ok(!report.serverFunctions.added.some((item) => item.name === "oldFn" || item.name === "ghost"), "existing and commented server functions are not new");
ok(report.serverFunctions.removed.length === 0, "no server function was removed");
ok(report.clientStrings.compared === true && report.clientStrings.added.join("|") === "Copy Draft Now", "only the new phrase is reported");
const extra = report.files.find((item) => item.path === "src/extra.ts");
ok(extra?.status === "A" && extra.commits[0]?.sources.some((source) => source.branches.includes("feature/flags")), "added file is attributed to the source branch");
ok(extra.commits[0].pullRequests.includes("42"), "a pull number in the commit message is kept");
ok(markdown.includes("feature/flags") && markdown.includes("FOO_ENABLED") && markdown.includes("Copy Draft Now"), "markdown has the branch, flag, and string");
ok(markdown.includes("prepareLeadFollowUp"), "markdown names the new server function");
ok(markdown.includes("Single-word JSX text"), "markdown documents the default phrase limitation");
ok(report.flags.some((item) => item.name === "SAMPLE_LIVE" && item.from === "absent" && item.to === "false"), "a new hard flag is a value change");
ok(!report.flags.some((item) => item.name === "MANUAL_PAYMENTS_LIVE"), "an unchanged hard flag is not a change");
ok(!out.startsWith(repo), "--out accepts a path outside the repository");

const allOut = join(root, "all");
const allRun = spawnSync(process.execPath, [script, "--repo", repo, "--from", base, "--to", head, "--all-flags", "--bundle-from", baseBundle, "--bundle-to", headBundle, "--out", allOut], { encoding: "utf8" });
ok(allRun.status === 0, "all-flags report exits 0");
const allReport = JSON.parse(readFileSync(join(allOut, "rc-diff.json"), "utf8"));
const allMd = readFileSync(join(allOut, "rc-diff.md"), "utf8");
ok(allReport.allFlags.envReads.from.includes("FOO_ENABLED"), "env reads at from include FOO_ENABLED");
ok(!allReport.allFlags.envReads.to.includes("FOO_ENABLED"), "env reads at to omit the hard-false flag");
ok(allReport.allFlags.flags.find((item) => item.name === "MANUAL_PAYMENTS_LIVE")?.section === "hard", "MANUAL_PAYMENTS_LIVE is a hard flag");
ok(allMd.indexOf("### Env reads") < allMd.indexOf("### Other *_ENABLED flags"), "env reads are listed first");
ok(allMd.indexOf("### Other *_ENABLED flags") < allMd.indexOf("### Hard flags"), "hard flags follow *_ENABLED flags");

const looseOut = join(root, "loose");
const looseRun = spawnSync(process.execPath, [script, "--repo", repo, "--from", base, "--to", head, "--phrases", "loose", "--bundle-from", baseBundle, "--bundle-to", headBundle, "--out", looseOut], { encoding: "utf8" });
ok(looseRun.status === 0, "loose phrase report exits 0");
const loose = JSON.parse(readFileSync(join(looseOut, "rc-diff.json"), "utf8"));
ok(loose.clientStrings.added.join("|") === "Apply|Copy Draft Now|notAPhrase|save draft", "loose mode adds single-word and lowercase text");

git(["update-ref", "refs/heads/-hyphen-ref", head]);
const hyphenOut = join(root, "hyphen");
const hyphenRun = spawnSync(process.execPath, [script, "--repo", repo, "--from", base, "--to", "-hyphen-ref", "--out", hyphenOut], { encoding: "utf8" });
ok(hyphenRun.status === 0, `a ref that starts with - is accepted (${hyphenRun.stderr?.trim() || "no stderr"})`);
const hyphen = JSON.parse(readFileSync(join(hyphenOut, "rc-diff.json"), "utf8"));
ok(hyphen.to === head, "the hyphen ref resolves to the same commit");

const missing = spawnSync(process.execPath, [script], { encoding: "utf8" });
ok(missing.status === 2, "missing refs exit 2");
const bad = spawnSync(process.execPath, [script, "--repo", repo, "--from", base, "--to", "does-not-exist", "--out", join(root, "bad")], { encoding: "utf8" });
ok(bad.status === 1, "an unknown ref exits 1");

rmSync(root, { recursive: true, force: true });
if (fail) {
  console.log(`rc-diff-report: ${fail} failed`);
  process.exit(1);
}
console.log("rc-diff-report: ok");
