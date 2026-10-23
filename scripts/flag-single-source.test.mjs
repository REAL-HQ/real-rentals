// Each *_ENABLED flag has one declaration under src/. A second const, let,
// or var with the same name — in this file or another — fails the check.
// Tests under scripts/ mention these names inside matchers and are not scanned.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return /\.(tsx|ts)$/.test(name) ? [path] : [];
  });

function declarations(source) {
  const found = [];
  let i = 0;
  let line = 1;
  let state = "code";
  let buf = "";
  let bufLine = 1;
  const flush = () => {
    const match = buf.match(/^(?:export\s+)?(?:const|let|var)\s+([A-Z][A-Z0-9_]*_ENABLED)\b/);
    if (match) found.push({ name: match[1], line: bufLine });
    buf = "";
  };
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
      if (c === "'") {
        state = "sq";
        i++;
        continue;
      }
      if (c === '"') {
        state = "dq";
        i++;
        continue;
      }
      if (c === "`") {
        state = "tpl";
        i++;
        continue;
      }
      if (c === "\n") {
        flush();
        line++;
        bufLine = line;
        i++;
        continue;
      }
      if (!buf && /\s/.test(c)) {
        i++;
        continue;
      }
      if (!buf) bufLine = line;
      buf += c;
      i++;
      continue;
    }
    if (state === "line") {
      if (c === "\n") {
        state = "code";
        line++;
      }
      i++;
      continue;
    }
    if (state === "block") {
      if (c === "\n") line++;
      if (c === "*" && n === "/") {
        state = "code";
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (c === "\n") line++;
    if (c === "\\") {
      i += 2;
      continue;
    }
    const end = state === "sq" ? "'" : state === "dq" ? '"' : "`";
    if (c === end) state = "code";
    i++;
  }
  flush();
  return found;
}

const byName = new Map();
for (const file of walk("src")) {
  const source = readFileSync(file, "utf8");
  for (const decl of declarations(source)) {
    const list = byName.get(decl.name) ?? [];
    list.push(`${file}:${decl.line}`);
    byName.set(decl.name, list);
  }
}

const dupes = [...byName.entries()].filter(([, sites]) => sites.length > 1);
if (dupes.length) {
  const lines = dupes.map(([name, sites]) => `  ${name}\n    ${sites.join("\n    ")}`);
  console.error("flag-single-source: a *_ENABLED flag is declared more than once:\n" + lines.join("\n"));
  process.exit(1);
}
console.log(`flag-single-source: OK (${byName.size} flags, one declaration each)`);
