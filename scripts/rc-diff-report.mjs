// Local RC diff. Compares two git refs already in this repository and writes
// rc-diff.json and rc-diff.md. Uses git and the filesystem only.
//
//   node scripts/rc-diff-report.mjs --from <ref> --to <ref> [--repo dir]
//     [--bundle-from dir] [--bundle-to dir] [--out dir]
//     [--all-flags] [--phrases default|loose]
//
// --from and --to accept any revision, including a name that starts with "-".
// --out accepts any directory path. The directory is created and does not have
// to live inside the repository.
//
// Bundle dirs are built client trees (.output/public). When they are omitted,
// a worktree checked out at that ref is used if it already has .output/public.
//
// Default phrase mode keeps a string only when it has a space and an uppercase
// letter, so single-word and lowercase JSX text are omitted. --phrases loose
// includes that text.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

export function stripComments(source) {
  let out = "";
  let i = 0;
  let state = "code";
  while (i < source.length) {
    const c = source[i];
    const n = source[i + 1];
    if (state === "code") {
      if (c === "/" && n === "/") {
        state = "line";
        i += 2;
        continue;
      }
      if (c === "/" && n === "*") {
        state = "block";
        i += 2;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") {
        state = c;
        out += c;
        i++;
        continue;
      }
      out += c;
      i++;
      continue;
    }
    if (state === "line") {
      if (c === "\n") {
        state = "code";
        out += "\n";
      }
      i++;
      continue;
    }
    if (state === "block") {
      if (c === "*" && n === "/") {
        state = "code";
        i += 2;
        continue;
      }
      if (c === "\n") out += "\n";
      i++;
      continue;
    }
    out += c;
    if (c === "\\" && i + 1 < source.length) {
      out += source[i + 1];
      i += 2;
      continue;
    }
    if (c === state) state = "code";
    i++;
  }
  return out;
}

export function classifyFlag(expression) {
  const compact = expression.replace(/\s+/g, " ").trim().replace(/;$/, "");
  let bare = compact.replace(/^\(+/, "").replace(/\)+$/, "").trim();
  bare = bare.replace(/\s+as\s+boolean$/, "").trim();
  if (bare === "true") return "true";
  if (bare === "false") return "false";
  if (compact.includes("process.env")) return "env";
  return compact;
}

const ENV_COMPARISON = String.raw`(?:\s*(?:===|!==|==|!=)\s*(?:"[^"]*"|'[^']*'|true|false))?`;

export function hardFlagValue(expression) {
  const classified = classifyFlag(expression);
  if (classified === "true" || classified === "false") return classified;
  const compact = expression.replace(/\s+/g, " ").trim().replace(/\s+as\s+const$/, "");
  if (!compact.startsWith("{") || !compact.endsWith("}")) return null;
  const parts = compact.slice(1, -1).split(",").map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return null;
  const values = [];
  for (const part of parts) {
    const match = part.match(/^(?:[A-Za-z_][\w]*)\s*:\s*(true|false)$/);
    if (!match) return null;
    values.push(match[1]);
  }
  if (values.every((value) => value === "false")) return "false";
  if (values.every((value) => value === "true")) return "true";
  return compact;
}

export function parseFlags(source) {
  const code = stripComments(source);
  const found = [];
  const declared = new Set();
  const remember = (name, expression, value) => {
    if (declared.has(name)) return;
    declared.add(name);
    found.push({ name, expression, value });
  };
  const consts = /(?:export\s+)?(?:const|let|var)\s+([A-Z][A-Z0-9_]+)\b(?:\s*:\s*[^=;]+?)?\s*=\s*([^;]+);/g;
  for (const match of code.matchAll(consts)) {
    const name = match[1];
    const expression = match[2].trim();
    if (name.endsWith("_ENABLED")) {
      found.push({ name, expression, value: classifyFlag(expression) });
      declared.add(name);
      continue;
    }
    const hard = hardFlagValue(expression);
    if (hard === null) continue;
    found.push({ name, expression, value: hard });
    declared.add(name);
  }
  const processEnv = new RegExp(String.raw`process\.env\.([A-Z][A-Z0-9_]*_ENABLED)\b` + ENV_COMPARISON, "g");
  for (const match of code.matchAll(processEnv)) remember(match[1], match[0].trim(), "env");
  if (/=\s*process\.env\b/.test(code)) {
    const envParam = new RegExp(String.raw`(?<!process\.)\benv\.([A-Z][A-Z0-9_]*_ENABLED)\b` + ENV_COMPARISON, "g");
    for (const match of code.matchAll(envParam)) remember(match[1], match[0].trim(), "env");
  }
  return found;
}

export function parseServerFns(source) {
  const code = stripComments(source);
  const found = [];
  const re = /export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*createServerFn\b/g;
  for (const match of code.matchAll(re)) found.push(match[1]);
  return found;
}

function templateText(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) return node.text;
  return "";
}

export function extractStrings(source) {
  const file = ts.createSourceFile("bundle.js", source, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
  const found = [];
  const visit = (node) => {
    const text = templateText(node);
    if (text) found.push(text);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

function isClassList(text) {
  const tokens = text.split(" ");
  if (tokens.length < 2) return false;
  return tokens.every((token) => /^[a-z0-9_:[\]/.#-]+$/.test(token) && (token.includes("-") || token.length <= 3));
}

// Default mode: a phrase needs a space and an uppercase letter. That misses
// single-word JSX text ("Apply") and lowercase text ("save draft").
// Loose mode includes those and still drops URLs, paths, class lists, and hashes.
export function isUserVisible(value, mode = "default") {
  const text = value.replace(/\s+/g, " ").trim();
  if (mode === "loose") return isLooseVisible(text);
  if (text.length < 3 || text.length > 180) return false;
  if (!/[A-Za-z]/.test(text) || !/[A-Z]/.test(text)) return false;
  if (!/\s/.test(text)) return false;
  if (text.includes("://") || text.includes("`") || text.includes("${")) return false;
  const letters = text.match(/[A-Za-z]/g)?.length ?? 0;
  if (letters / text.length < 0.45) return false;
  if ((text.match(/[{};]/g) || []).length > 2) return false;
  if (/\b(function|import|export|const|return)\b/.test(text)) return false;
  return true;
}

function isLooseVisible(text) {
  if (text.length < 2 || text.length > 180) return false;
  if (!/[A-Za-z]/.test(text)) return false;
  if (text.includes("://") || text.includes("`") || text.includes("${") || text.includes("/")) return false;
  const letters = text.match(/[A-Za-z]/g)?.length ?? 0;
  if (letters / text.length < 0.6) return false;
  if (/[{};]/.test(text)) return false;
  if (/\b(function|import|export|const|return)\b/.test(text)) return false;
  if (/^[0-9a-f]{8,}$/i.test(text)) return false;
  if (/\.(?:js|mjs|css|map|png|jpe?g|svg)$/i.test(text)) return false;
  if (isClassList(text)) return false;
  return true;
}

export function visibleStrings(source, mode = "default") {
  const unique = new Set();
  for (const value of extractStrings(source)) {
    const text = value.replace(/\s+/g, " ").trim();
    if (isUserVisible(text, mode)) unique.add(text);
  }
  return unique;
}

function git(repo, args) {
  try {
    return execFileSync("git", ["-C", repo, ...args], {
      encoding: "buffer",
      maxBuffer: 128 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const stderr = error.stderr ? error.stderr.toString("utf8").trim() : error.message;
    const wrapped = new Error(stderr || error.message);
    wrapped.status = error.status ?? 1;
    throw wrapped;
  }
}

function gitText(repo, args) {
  return git(repo, args).toString("utf8");
}

function parseNameStatus(buffer) {
  const parts = buffer.toString("utf8").split("\0");
  if (parts.at(-1) === "") parts.pop();
  const rows = [];
  for (let i = 0; i < parts.length; ) {
    const raw = parts[i++];
    if (!raw) break;
    const kind = raw[0];
    if (kind === "R" || kind === "C") {
      rows.push({ status: kind, previousPath: parts[i++], path: parts[i++] });
    } else {
      rows.push({ status: kind, path: parts[i++] });
    }
  }
  return rows;
}

function revParse(repo, ref) {
  try {
    return gitText(repo, ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`]).trim();
  } catch (error) {
    throw new Error(`Unknown ref ${ref}: ${error.message}`);
  }
}

function grepFiles(repo, sha, pattern) {
  let text = "";
  const patterns = Array.isArray(pattern) ? pattern : [pattern];
  const args = ["grep", "-l", "-I", "-E"];
  for (const item of patterns) args.push("-e", item);
  args.push(sha, "--", "src");
  try {
    text = gitText(repo, args);
  } catch (error) {
    if (error.status === 1) return [];
    throw error;
  }
  const prefix = `${sha}:`;
  return text
    .split("\n")
    .filter((line) => line.startsWith(prefix))
    .map((line) => line.slice(prefix.length))
    .filter((path) => /\.(tsx|ts|mts|cts)$/.test(path))
    .sort();
}

function showFile(repo, sha, path) {
  return gitText(repo, ["show", `${sha}:${path}`]);
}

function flagMap(repo, sha) {
  const byName = new Map();
  for (const path of grepFiles(repo, sha, ["_ENABLED", "export const [A-Z][A-Z0-9_]+"])) {
    let source = "";
    try {
      source = showFile(repo, sha, path);
    } catch {
      continue;
    }
    for (const flag of parseFlags(source)) {
      if (!byName.has(flag.name)) byName.set(flag.name, []);
      byName.get(flag.name).push({ file: path, value: flag.value, expression: flag.expression });
    }
  }
  for (const list of byName.values()) list.sort((a, b) => a.file.localeCompare(b.file) || a.expression.localeCompare(b.expression));
  return byName;
}

function serverFnSet(repo, sha) {
  const found = [];
  for (const path of grepFiles(repo, sha, "createServerFn")) {
    let source = "";
    try {
      source = showFile(repo, sha, path);
    } catch {
      continue;
    }
    for (const name of parseServerFns(source)) found.push({ name, file: path });
  }
  found.sort((a, b) => a.file.localeCompare(b.file) || a.name.localeCompare(b.name));
  return found;
}

function signature(list) {
  return (list ?? []).map((item) => `${item.value}@${item.file}`).join("|");
}

function changedFlags(before, after) {
  const names = [...new Set([...before.keys(), ...after.keys()])].sort();
  const changed = [];
  for (const name of names) {
    const fromDeclarations = before.get(name) ?? [];
    const toDeclarations = after.get(name) ?? [];
    if (signature(fromDeclarations) === signature(toDeclarations)) continue;
    const fromValues = [...new Set(fromDeclarations.map((item) => item.value))];
    const toValues = [...new Set(toDeclarations.map((item) => item.value))];
    changed.push({
      name,
      from: fromValues.length ? fromValues.join(", ") : "absent",
      to: toValues.length ? toValues.join(", ") : "absent",
      fromDeclarations,
      toDeclarations,
    });
  }
  return changed;
}

function pullNumbers(text) {
  const found = new Set();
  if (!text) return [];
  for (const match of text.matchAll(/(?:^|[^A-Za-z0-9])#(\d{1,6})\b/g)) found.add(match[1]);
  for (const match of text.matchAll(/(?:^|\/)pr[-_/]?(\d{1,6})(?=\/|$)/gi)) found.add(match[1]);
  return [...found].sort((a, b) => Number(a) - Number(b));
}

function sourceIndex(repo) {
  const map = new Map();
  const text = gitText(repo, ["log", "--all", "--format=%H%x1f%aI%x1f%s"]);
  for (const line of text.split("\n")) {
    if (!line) continue;
    const [sha, date, subject] = line.split("\x1f");
    if (!sha || !date) continue;
    const key = `${date}\0${subject ?? ""}`;
    if (!map.has(key)) map.set(key, []);
    const list = map.get(key);
    if (!list.includes(sha)) list.push(sha);
  }
  return map;
}

function branchesContaining(repo, sha, cache) {
  if (cache.has(sha)) return cache.get(sha);
  const text = gitText(repo, ["for-each-ref", `--contains=${sha}`, "--format=%(refname)", "refs/heads", "refs/remotes"]);
  const names = new Set();
  for (const refname of text.split("\n")) {
    if (!refname || refname.endsWith("/HEAD")) continue;
    let short = refname;
    if (refname.startsWith("refs/heads/")) short = refname.slice("refs/heads/".length);
    else if (refname.startsWith("refs/remotes/")) short = refname.slice("refs/remotes/".length);
    names.add(short);
  }
  for (const name of [...names]) {
    if (!name.startsWith("origin/") && names.has(`origin/${name}`)) names.delete(name);
  }
  const list = [...names].sort();
  cache.set(sha, list);
  return list;
}

function commitMeta(repo, sha) {
  const text = gitText(repo, ["log", "-1", `--format=%H%x1f%aI%x1f%s%x1f%b`, sha]);
  const parts = text.split("\x1f");
  return {
    sha: parts[0].trim(),
    authorDate: parts[1] ?? "",
    subject: parts[2] ?? "",
    body: parts.slice(3).join("\x1f").replace(/\n$/, ""),
  };
}

function discoverBundle(repo, sha) {
  const text = gitText(repo, ["worktree", "list", "--porcelain"]);
  let path = "";
  let head = "";
  const consider = () => {
    if (head === sha && path) {
      const candidate = join(path, ".output", "public");
      if (existsSync(candidate)) return candidate;
    }
    return null;
  };
  for (const line of text.split("\n")) {
    if (line.startsWith("worktree ")) {
      const found = consider();
      if (found) return found;
      path = line.slice("worktree ".length);
      head = "";
    } else if (line.startsWith("HEAD ")) {
      head = line.slice("HEAD ".length);
    }
  }
  return consider();
}

function walkJs(dir, root, out) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const path = join(dir, name);
    const info = statSync(path);
    if (info.isDirectory()) walkJs(path, root, out);
    else if (info.isFile() && /\.(js|mjs)$/.test(name)) out.push(path);
  }
}

export function bundleStrings(dir, mode = "default") {
  const files = [];
  walkJs(dir, dir, files);
  const unique = new Set();
  for (const file of files.sort()) {
    const source = readFileSync(file, "utf8");
    for (const text of visibleStrings(source, mode)) unique.add(text);
  }
  return unique;
}

function summarized(declarations) {
  const values = [...new Set((declarations ?? []).map((item) => item.value))];
  return values.length ? values.join(", ") : "absent";
}

function envReadNames(map) {
  const names = [];
  for (const [name, declarations] of map) {
    if (declarations.some((item) => item.value === "env")) names.push(name);
  }
  return names.sort();
}

function listFlags(before, after) {
  const order = { env: 0, other: 1, hard: 2 };
  const names = [...new Set([...before.keys(), ...after.keys()])];
  const rows = names.map((name) => {
    const fromDeclarations = before.get(name) ?? [];
    const toDeclarations = after.get(name) ?? [];
    const from = summarized(fromDeclarations);
    const to = summarized(toDeclarations);
    const env = from.split(", ").includes("env") || to.split(", ").includes("env");
    const section = env ? "env" : name.endsWith("_ENABLED") ? "other" : "hard";
    return { name, from, to, fromDeclarations, toDeclarations, section };
  });
  rows.sort((a, b) => order[a.section] - order[b.section] || a.name.localeCompare(b.name));
  return rows;
}

function diffStrings(base, head) {
  const added = [];
  for (const text of head) if (!base.has(text)) added.push(text);
  added.sort((a, b) => a.localeCompare(b));
  return added;
}

export function buildReport({ repo, from, to, bundleFrom, bundleTo, allFlags = false, phrases = "default" }) {
  const fromSha = revParse(repo, from);
  const toSha = revParse(repo, to);
  const net = parseNameStatus(git(repo, ["diff", "--name-status", "-z", "-M", fromSha, toSha]));
  const range = gitText(repo, ["rev-list", "--reverse", `${fromSha}..${toSha}`])
    .split("\n")
    .filter(Boolean);
  const inRange = new Set(range);
  const index = sourceIndex(repo);
  const branchCache = new Map();
  const commits = range.map((sha) => {
    const meta = commitMeta(repo, sha);
    let files = [];
    try {
      files = parseNameStatus(git(repo, ["diff-tree", "--no-commit-id", "--name-status", "-z", "-r", "-M", "--root", sha]));
    } catch {
      files = [];
    }
    const equivalents = index.get(`${meta.authorDate}\0${meta.subject}`) ?? [sha];
    const sources = equivalents.map((sourceSha) => {
      const branches = branchesContaining(repo, sourceSha, branchCache);
      return {
        sha: sourceSha,
        inRange: inRange.has(sourceSha),
        branches,
        pullRequests: pullNumbers([meta.subject, meta.body, ...branches].join("\n")),
      };
    });
    return { ...meta, files, sources };
  });
  const byPath = new Map();
  for (const commit of commits) {
    for (const file of commit.files) {
      const key = file.path;
      if (!byPath.has(key)) byPath.set(key, []);
      byPath.get(key).push(commit);
      if (file.previousPath && !byPath.has(file.previousPath)) byPath.set(file.previousPath, []);
      if (file.previousPath) byPath.get(file.previousPath).push(commit);
    }
  }
  const files = net.map((row) => {
    const touching = [];
    const seen = new Set();
    for (const key of [row.path, row.previousPath].filter(Boolean)) {
      for (const commit of byPath.get(key) ?? []) {
        if (seen.has(commit.sha)) continue;
        seen.add(commit.sha);
        touching.push({
          sha: commit.sha,
          subject: commit.subject,
          authorDate: commit.authorDate,
          sources: commit.sources.filter((source) => !source.inRange),
          pullRequests: commit.sources.flatMap((source) => source.pullRequests),
        });
      }
    }
    return {
      path: row.path,
      status: row.status,
      ...(row.previousPath ? { previousPath: row.previousPath } : {}),
      commits: touching,
    };
  });
  const beforeFlags = flagMap(repo, fromSha);
  const afterFlags = flagMap(repo, toSha);
  const flags = changedFlags(beforeFlags, afterFlags);
  const beforeFns = serverFnSet(repo, fromSha);
  const afterFns = serverFnSet(repo, toSha);
  const fnKey = (item) => `${item.name}\0${item.file}`;
  const beforeKeys = new Set(beforeFns.map(fnKey));
  const afterKeys = new Set(afterFns.map(fnKey));
  const addedFns = afterFns.filter((item) => !beforeKeys.has(fnKey(item)));
  const removedFns = beforeFns.filter((item) => !afterKeys.has(fnKey(item)));
  const fromBundle = bundleFrom || discoverBundle(repo, fromSha);
  const toBundle = bundleTo || discoverBundle(repo, toSha);
  let clientStrings = { compared: false, mode: phrases, bundleFrom: fromBundle, bundleTo: toBundle, added: [] };
  if (fromBundle && toBundle && existsSync(fromBundle) && existsSync(toBundle)) {
    clientStrings = {
      compared: true,
      mode: phrases,
      bundleFrom: fromBundle,
      bundleTo: toBundle,
      added: diffStrings(bundleStrings(fromBundle, phrases), bundleStrings(toBundle, phrases)),
    };
  }
  const report = {
    from: fromSha,
    to: toSha,
    files,
    flags,
    serverFunctions: { added: addedFns, removed: removedFns },
    clientStrings,
  };
  if (allFlags) {
    report.allFlags = {
      envReads: { from: envReadNames(beforeFlags), to: envReadNames(afterFlags) },
      flags: listFlags(beforeFlags, afterFlags),
    };
  }
  return report;
}

function mdCell(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function shortSha(sha) {
  return sha.slice(0, 12);
}

function sourceLabel(commit) {
  const branches = [...new Set(commit.sources.flatMap((source) => source.branches))];
  const prs = [...new Set(commit.pullRequests)].map((id) => `#${id}`);
  const parts = [];
  if (branches.length) parts.push(branches.join(", "));
  if (prs.length) parts.push(prs.join(", "));
  if (!parts.length) parts.push(commit.sources.length ? commit.sources.map((source) => shortSha(source.sha)).join(", ") : shortSha(commit.sha));
  return parts.join("; ");
}

export function renderMarkdown(report) {
  const lines = [];
  lines.push(`# RC diff ${shortSha(report.from)}..${shortSha(report.to)}`);
  lines.push("");
  lines.push(`From \`${report.from}\` to \`${report.to}\`.`);
  lines.push("");
  lines.push("## Files");
  lines.push("");
  lines.push("| Status | Path | Source branches / commits |");
  lines.push("| --- | --- | --- |");
  if (!report.files.length) lines.push("| | No file changes. | |");
  for (const file of report.files) {
    const path = file.previousPath ? `${file.previousPath} → ${file.path}` : file.path;
    const sources = file.commits.length
      ? file.commits.map((commit) => `${shortSha(commit.sha)} ${commit.subject} (${sourceLabel(commit)})`).join("<br>")
      : "";
    lines.push(`| ${mdCell(file.status)} | ${mdCell(path)} | ${mdCell(sources)} |`);
  }
  lines.push("");
  lines.push("## Flags whose value changed");
  lines.push("");
  lines.push("| Flag | From | To | Declarations |");
  lines.push("| --- | --- | --- | --- |");
  if (!report.flags.length) lines.push("| | No flag value changes. | | |");
  for (const flag of report.flags) {
    const decls = [
      ...flag.fromDeclarations.map((item) => `${item.file}: ${item.expression}`),
      ...flag.toDeclarations.map((item) => `${item.file}: ${item.expression}`),
    ].join("<br>");
    lines.push(`| ${mdCell(flag.name)} | ${mdCell(flag.from)} | ${mdCell(flag.to)} | ${mdCell(decls)} |`);
  }
  if (report.allFlags) {
    lines.push("");
    lines.push("## All flags");
    lines.push("");
    lines.push("Env reads are first. A name is an env read at a ref when one of its declarations there reads `process.env`.");
    lines.push("");
    lines.push(`Env reads at from: ${report.allFlags.envReads.from.join(", ") || "none"}.`);
    lines.push(`Env reads at to: ${report.allFlags.envReads.to.join(", ") || "none"}.`);
    lines.push("");
    for (const section of [
      ["env", "Env reads"],
      ["other", "Other *_ENABLED flags"],
      ["hard", "Hard flags"],
    ]) {
      lines.push(`### ${section[1]}`);
      lines.push("");
      if (section[0] === "hard") {
        lines.push("Names that do not end in `_ENABLED`, declared as `true`, `false`, or an object of boolean literals.");
        lines.push("");
      }
      const rows = report.allFlags.flags.filter((flag) => flag.section === section[0]);
      lines.push("| Flag | From | To | Declarations |");
      lines.push("| --- | --- | --- | --- |");
      if (!rows.length) lines.push("| | None. | | |");
      for (const flag of rows) {
        const decls = [
          ...flag.fromDeclarations.map((item) => `${item.file}: ${item.expression}`),
          ...flag.toDeclarations.map((item) => `${item.file}: ${item.expression}`),
        ].join("<br>");
        lines.push(`| ${mdCell(flag.name)} | ${mdCell(flag.from)} | ${mdCell(flag.to)} | ${mdCell(decls)} |`);
      }
      lines.push("");
    }
  }
  lines.push("## Server functions");
  lines.push("");
  lines.push("### Added");
  lines.push("");
  if (!report.serverFunctions.added.length) lines.push("None.");
  for (const fn of report.serverFunctions.added) lines.push(`- \`${fn.name}\` in \`${fn.file}\``);
  lines.push("");
  lines.push("### Removed");
  lines.push("");
  if (!report.serverFunctions.removed.length) lines.push("None.");
  for (const fn of report.serverFunctions.removed) lines.push(`- \`${fn.name}\` in \`${fn.file}\``);
  lines.push("");
  lines.push("## New user-visible strings");
  lines.push("");
  lines.push("Default mode keeps a string only when it has a space and an uppercase letter. Single-word JSX text and lowercase text are omitted. `--phrases loose` includes them.");
  lines.push("");
  if (report.clientStrings.mode === "loose") lines.push("Loose mode is on.");
  lines.push("");
  if (!report.clientStrings.compared) {
    lines.push("Not compared. Pass `--bundle-from` and `--bundle-to`, or check out each ref in a worktree that already contains `.output/public`.");
  } else {
    lines.push(`Base bundle \`${report.clientStrings.bundleFrom}\`.`);
    lines.push(`Head bundle \`${report.clientStrings.bundleTo}\`.`);
    lines.push("");
    if (!report.clientStrings.added.length) lines.push("No new user-visible strings.");
    for (const text of report.clientStrings.added) lines.push(`- ${text}`);
  }
  lines.push("");
  return lines.join("\n");
}

function parseArgs(argv) {
  const args = {};
  const booleans = new Set(["all-flags"]);
  for (let i = 2; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) throw new Error(`Unexpected argument ${token}`);
    const key = token.slice(2);
    if (booleans.has(key)) {
      args[key] = "true";
      continue;
    }
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
    console.error("Usage: node scripts/rc-diff-report.mjs --from <ref> --to <ref> [--repo dir] [--bundle-from dir] [--bundle-to dir] [--out dir] [--all-flags] [--phrases default|loose]");
    console.error("--out accepts any directory path. --from and --to accept revisions that start with '-'.");
    process.exit(2);
  }
  const phrases = args.phrases ?? "default";
  if (phrases !== "default" && phrases !== "loose") {
    console.error("--phrases must be default or loose");
    process.exit(2);
  }
  try {
    const repo = args.repo ?? process.cwd();
    const report = buildReport({
      repo,
      from: args.from,
      to: args.to,
      bundleFrom: args["bundle-from"],
      bundleTo: args["bundle-to"],
      allFlags: args["all-flags"] === "true",
      phrases,
    });
    const markdown = renderMarkdown(report);
    const out = args.out ?? "rc-diff-out";
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "rc-diff.json"), `${JSON.stringify(report, null, 2)}\n`);
    writeFileSync(join(out, "rc-diff.md"), markdown);
    process.stdout.write(markdown);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
