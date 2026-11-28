// Guard: every dropdown menu on the site is the shared white AppSelect / Select.
// Native <select> menus are drawn by the OS (gray, translucent on macOS) and
// ignore our styles, which is why they kept coming back. Run: node scripts/no-native-select.test.mjs
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = "src";
const APP_SELECT = "src/components/ui/app-select.tsx";

/** Files allowed to contain a native <select>, each with the reason. */
const NATIVE_SELECT_ALLOWLIST = new Map([
  [APP_SELECT, "AppSelect keeps one hidden (display:none) native select as its form and change-event bridge; it is never shown."],
]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(tsx|ts|jsx|js|mjs)$/.test(name)) out.push(path);
  }
  return out;
}

/** Remove comments so prose such as "a <select>" cannot trip the guard. */
function code(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
}

const files = walk(ROOT).map((file) => ({ file: file.split("\\").join("/"), source: readFileSync(file, "utf8") }));
const problems = [];

for (const { file, source } of files) {
  const text = code(source);
  const usesAppSelect = /from\s+["'](?:@\/components\/ui\/app-select|\.{1,2}\/(?:ui\/)?app-select)["']/.test(text) || file === APP_SELECT;

  if (/<select[\s>/]/.test(text) && !NATIVE_SELECT_ALLOWLIST.has(file)) {
    problems.push(`${file}: native <select>. Use AppSelect from "@/components/ui/app-select" (same props, same option children, white menu).`);
  }
  if (/createElement\(\s*["'`]select["'`]/.test(text)) problems.push(`${file}: createElement("select") is a native select.`);
  if (/<(?:option|optgroup)[\s>]/.test(text) && !usesAppSelect) {
    problems.push(`${file}: <option>/<optgroup> outside an AppSelect. Use AppSelect.`);
  }
  if (/<datalist[\s>]/.test(text)) problems.push(`${file}: <datalist> draws a native menu. Use the white Command combobox.`);
  if (/<input\b[^>]*\slist=/.test(text)) problems.push(`${file}: <input list=...> draws a native menu. Use the white Command combobox.`);
  if (/from\s+["']react-select["']/.test(text)) problems.push(`${file}: react-select is not allowed. Use AppSelect.`);
  if (!file.startsWith("src/components/ui/") && /from\s+["']@radix-ui\/react-(?:select|dropdown-menu|context-menu|menubar|popover|hover-card|navigation-menu)["']/.test(text)) {
    problems.push(`${file}: import menu primitives only through src/components/ui/*, which carry the white defaults.`);
  }

  // Menu panels used anywhere must not set a non-white background.
  const panel = /<(SelectContent|DropdownMenuContent|DropdownMenuSubContent|PopoverContent|ContextMenuContent|ContextMenuSubContent|MenubarContent|MenubarSubContent|HoverCardContent|CommandList)\b[^>]*?className=(?:"([^"]*)"|\{`([^`]*)`\}|\{"([^"]*)"\})/g;
  for (const match of text.matchAll(panel)) {
    const classes = match[2] ?? match[3] ?? match[4] ?? "";
    const bad = classes.split(/\s+/).filter((c) => /^(?:[a-z-]+:)*bg-/.test(c) && !/^(?:[a-z-]+:)*bg-(?:white|popover)$/.test(c) && !/^(?:[a-z-]+:)*bg-\[#(?:fff|ffffff)\]$/i.test(c));
    if (bad.length) problems.push(`${file}: <${match[1]}> uses non-white background ${bad.join(", ")}. Menus are white.`);
  }
}

// The shared menu components default to white, so new menus inherit it.
const PANELS = [
  ["src/components/ui/select.tsx", /^(SelectContent)$/],
  ["src/components/ui/dropdown-menu.tsx", /^(DropdownMenuContent|DropdownMenuSubContent)$/],
  ["src/components/ui/popover.tsx", /^(PopoverContent)$/],
  ["src/components/ui/context-menu.tsx", /^(ContextMenuContent|ContextMenuSubContent)$/],
  ["src/components/ui/menubar.tsx", /^(MenubarContent|MenubarSubContent)$/],
  ["src/components/ui/command.tsx", /^(Command)$/],
  ["src/components/ui/navigation-menu.tsx", /^(NavigationMenuViewport)$/],
  ["src/components/ui/hover-card.tsx", /^(HoverCardContent)$/],
];
for (const [file, names] of PANELS) {
  const text = code(readFileSync(file, "utf8"));
  const blocks = text.split(/\nconst (?=\w+\s*=\s*React\.forwardRef)/).slice(1);
  let seen = 0;
  for (const block of blocks) {
    const name = block.match(/^(\w+)/)[1];
    if (!names.test(name)) continue;
    seen += 1;
    const strings = [...block.matchAll(/"([^"\n]*(?:rounded|border)[^"\n]*)"/g)].map((m) => m[1]);
    assert.ok(strings.length, `${file}: cannot find the panel classes of ${name}`);
    const panelClasses = strings.find((s) => /\bshadow|\brounded-md\b/.test(s)) ?? strings[0];
    const bgs = panelClasses.split(/\s+/).filter((c) => /^(?:[a-z-]+:)*bg-/.test(c));
    assert.ok(bgs.some((c) => c === "bg-white" || c === "bg-popover"), `${file}: ${name} must default to bg-white or bg-popover`);
    assert.ok(bgs.every((c) => c === "bg-white" || c === "bg-popover"), `${file}: ${name} has a non-white background: ${bgs.join(", ")}`);
    assert.match(panelClasses, /\bwhite-popup\b/, `${file}: ${name} must carry white-popup so inner tokens stay light`);
    assert.doesNotMatch(panelClasses, /backdrop-blur|\bopacity-\d|bg-(?:white|popover)\/|bg-transparent/, `${file}: ${name} must not be translucent`);
  }
  assert.ok(seen >= 1, `${file}: expected a panel component matching ${names}`);
}

// The closed trigger of every AppSelect / Select defaults to white with dark text.
assert.match(readFileSync(APP_SELECT, "utf8"), /"white-popup inline-flex w-auto bg-white text-\[#111114\]"/, "AppSelect trigger must default to white with dark text");
assert.match(readFileSync("src/components/ui/select.tsx", "utf8"), /border-input bg-popover px-3 py-2 text-sm text-popover-foreground/, "Select trigger must default to white with dark text");

// Root cause guard: the popover token is white in every theme, and menus read it.
const css = readFileSync("src/styles.css", "utf8");
const rootTokens = css.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
const darkTokens = css.match(/\.dark\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
for (const [label, tokens] of [[":root", rootTokens], [".dark", darkTokens]]) {
  assert.match(tokens, /--popover:\s*oklch\(1 0 0\);/, `${label} --popover must be white`);
  assert.match(tokens, /--popover-foreground:\s*oklch\(0\.18 0 0\);/, `${label} --popover-foreground must be dark`);
}
assert.match(css, /--color-popover:\s*var\(--popover\);/, "Tailwind bg-popover must read --popover");
assert.match(css, /\.white-popup\s*\{[^}]*--popover:\s*oklch\(1 0 0\);/s, ".white-popup must pin the popover token to white");

assert.deepEqual(problems, [], `\n${problems.join("\n")}\n\nAll dropdown menus use the shared white Select component; never use native <select>.`);
console.log(`PASS no native selects or non-white menus in ${files.length} source files (${NATIVE_SELECT_ALLOWLIST.size} documented exception)`);
