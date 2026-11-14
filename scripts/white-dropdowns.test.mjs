import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const styles = readFileSync("src/styles.css", "utf8");
const select = readFileSync("src/components/ui/select.tsx", "utf8");
const menu = readFileSync("src/components/ui/dropdown-menu.tsx", "utf8");

assert.match(
  styles,
  /select\s*\{[^}]*color-scheme:\s*only light;[^}]*background-color:\s*var\(--popover\) !important;[^}]*color:\s*var\(--popover-foreground\) !important;/s,
  "every native select must explicitly use the light white/dark-text scheme",
);
assert.match(
  styles,
  /select option, select optgroup, \.select-soft option, \.select-soft optgroup\s*\{[^}]*background-color:\s*var\(--popover\) !important;[^}]*color:\s*var\(--popover-foreground\) !important;/s,
  "native dropdown panels, options, and groups must stay white with dark text",
);
const darkTokens = styles.match(/\.dark\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
assert.match(darkTokens, /--popover:\s*oklch\(1 0 0\);/, "dark chrome must not turn popovers dark");
assert.match(darkTokens, /--popover-foreground:\s*oklch\(0\.18 0 0\);/, "popover text must remain dark");

for (const [name, source] of [["select", select], ["dropdown menu", menu]]) {
  assert.doesNotMatch(source, /bg-white|text-foreground/, `${name} must use shared popover colors`);
  assert.match(source, /bg-popover text-popover-foreground/, `${name} panels must use white popover tokens`);
}
assert.match(
  select,
  /border-input bg-popover px-3 py-2 text-sm text-popover-foreground/,
  "shared dropdown buttons must default to white with dark text",
);

console.log("PASS all dropdown buttons and panels use white backgrounds with dark text");
