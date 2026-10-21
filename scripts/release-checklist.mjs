// CI-free release check. It does not call GitHub. It runs the local gates and
// prints one PASS or STOP line.
//
//   node scripts/release-checklist.mjs --from <ref> --to <ref> [--repo dir] [--diff-out dir]
//
// Steps: guard --rc, tsc, readiness, npm test, a dummy-env production build,
// a supabase.co scan of .output/server, and rc-diff --all-flags.
// A supabase.co string under .output/server/_libs is a vendored library example
// and does not stop the checklist. A hit in any other server file does.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";

export const DUMMY_ENV = {
  NODE_OPTIONS: "--max-old-space-size=4096",
  VITE_SUPABASE_URL: "http://127.0.0.1:9",
  VITE_SUPABASE_PUBLISHABLE_KEY: "dummy",
  VITE_SUPABASE_PROJECT_ID: "dummy",
  SUPABASE_URL: "http://127.0.0.1:9",
  SUPABASE_PUBLISHABLE_KEY: "dummy",
};

export function classifySupabaseHits(paths) {
  const vendor = [];
  const outside = [];
  for (const path of paths) {
    const parts = path.split(/[/\\]/);
    if (parts.includes("_libs")) vendor.push(path);
    else outside.push(path);
  }
  return { vendor, outside, exit: outside.length ? 1 : 0 };
}

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const info = statSync(path);
    if (info.isDirectory()) walk(path, out);
    else if (info.isFile()) out.push(path);
  }
}

export function supabaseHits(serverDir) {
  if (!existsSync(serverDir)) return null;
  const files = [];
  walk(serverDir, files);
  const hits = [];
  for (const file of files) {
    const text = readFileSync(file);
    if (text.includes("supabase.co")) hits.push(relative(serverDir, file).split(sep).join("/"));
  }
  return hits;
}

export function formatSummary(steps) {
  const lines = steps.map((step) => {
    const mark = step.exit === 0 ? "PASS" : "STOP";
    const detail = step.detail ? ` ${step.detail}` : "";
    return `${mark} ${step.name} exit ${step.exit}${detail}`;
  });
  const verdict = steps.every((step) => step.exit === 0) ? "PASS" : "STOP";
  lines.push(verdict);
  return { verdict, steps, text: `${lines.join("\n")}\n` };
}

function statusOf(result) {
  if (!result || typeof result.status !== "number") return 1;
  return result.status;
}

export function runChecklist({ repo, from, to, diffOut, spawn }) {
  const exec = spawn ?? ((cmd, options) => spawnSync(cmd[0], cmd.slice(1), {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  }));
  const commands = [
    ["guard --rc", ["node", "scripts/ci/record-rental/guard.mjs", "--rc"]],
    ["tsc", ["npx", "tsc", "--noEmit"]],
    ["readiness", ["bash", "scripts/readiness-test.sh"]],
    ["npm test", ["npm", "test"]],
    ["build", ["npm", "run", "build"], DUMMY_ENV],
  ];
  const steps = [];
  for (const [name, cmd, extraEnv] of commands) {
    const result = exec(cmd, { cwd: repo, env: extraEnv });
    steps.push({ name, exit: statusOf(result) });
  }
  const serverDir = join(repo, ".output", "server");
  const hits = supabaseHits(serverDir);
  if (hits === null) {
    steps.push({ name: "supabase.co", exit: 1, detail: "missing .output/server" });
  } else {
    const classified = classifySupabaseHits(hits);
    const detail = classified.outside.length
      ? classified.outside.join(", ")
      : `vendor ${classified.vendor.length}`;
    steps.push({ name: "supabase.co", exit: classified.exit, detail });
  }
  const diff = exec(
    ["node", "scripts/rc-diff-report.mjs", "--from", from, "--to", to, "--all-flags", "--repo", repo, "--out", diffOut],
    { cwd: repo },
  );
  steps.push({ name: "rc-diff", exit: statusOf(diff) });
  return formatSummary(steps);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) throw new Error(`Unexpected argument ${token}`);
    const key = token.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for --${key}`);
    args[key] = value;
    i++;
  }
  return args;
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv);
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
  if (!args.from || !args.to) {
    console.error("Usage: node scripts/release-checklist.mjs --from <ref> --to <ref> [--repo dir] [--diff-out dir]");
    process.exit(2);
  }
  const repo = args.repo ?? process.cwd();
  const diffOut = args["diff-out"] ?? join(tmpdir(), "release-checklist-diff");
  mkdirSync(diffOut, { recursive: true });
  const summary = runChecklist({ repo, from: args.from, to: args.to, diffOut });
  process.stdout.write(summary.text);
  process.exit(summary.verdict === "PASS" ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
