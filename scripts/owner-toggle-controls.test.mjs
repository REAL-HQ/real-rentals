/**
 * THE RULE THIS FILE EXISTS FOR:
 *
 *   AN OWNER'S ENABLE / DISABLE CONTROL IS A SWITCH YOU CAN SEE AND A BUTTON
 *   YOU CAN CLICK — NEVER A TINY CHECKBOX YOU HAVE TO FIND.
 *
 * The Owner asked for this twice: first on Photo Reading ("not a button i can
 * click"), then on Photo Enhancement ("does photo enhancement need a toggle
 * and off button also"). Both screens now use the shared switch plus an
 * explicit Turn On / Turn Off button, and the switch's on-state track carries
 * the site's brand red rather than the black primary.
 *
 * Those three things are easy to lose in a refactor: someone swaps the switch
 * back to a native checkbox, drops the button, or repaints the track with
 * bg-primary and the brand color quietly disappears. Nothing else in the
 * project catches any of that, so this file reads the real source and refuses.
 *
 * Run: node scripts/owner-toggle-controls.test.mjs   (wired into npm test)
 */
import { readFileSync } from "node:fs";

let fail = 0;
const ok = (c, l) => { if (!c) fail++; console.log(`  ${c ? "PASS" : "BLOCKER"}  ${l}`); };

const read = (p) => readFileSync(p, "utf8");

const SWITCH = read("src/components/ui/switch.tsx");
const PANELS = [
  { name: "Photo Enhancement", file: "src/components/admin/PhotoEnhancePanel.tsx", label: "Photo Enhancement enabled" },
  { name: "Photo Reading", file: "src/components/admin/PhotoReadingPanel.tsx", label: "Photo Reading enabled" },
];

console.log("the shared switch");
ok(
  !/data-\[state=checked\]:bg-primary/.test(SWITCH),
  "its on-state track is not the black primary",
);
ok(
  /data-\[state=checked\]:bg-brand/.test(SWITCH),
  "its on-state track carries the brand color",
);
ok(
  /data-\[state=unchecked\]:bg-input/.test(SWITCH),
  "its off-state track stays neutral so off still reads as off",
);

console.log("\nother Settings on/off controls");
for (const [file, name] of [
  ["src/components/admin/SafeAutofillPanel.tsx", "Autofill"],
  ["src/components/admin/SettingsPanel.tsx", "Business Settings yes/no fields"],
  ["src/components/admin/WebsitesPanel.tsx", "Websites Homepage column"],
]) {
  const src = read(file);
  ok(/<Switch\b/.test(src) && !/type="checkbox"/.test(src), `${name} uses the shared switch, not a checkbox`);
}
ok(/s\.enabled \? "Turn Off" : "Turn On"/.test(read("src/components/admin/SafeAutofillPanel.tsx")), "Autofill offers Turn On / Turn Off");

for (const p of PANELS) {
  const src = read(p.file);
  console.log(`\n${p.name}`);
  ok(
    /import\s*\{\s*Switch\s*\}\s*from\s*"@\/components\/ui\/switch"/.test(src),
    "uses the shared switch",
  );
  ok(
    !/<input\s+type="checkbox"[^>]*enabled/.test(src),
    "does not fall back to a raw checkbox for the enable control",
  );
  ok(
    src.includes(`aria-label="${p.label}"`),
    `names its switch "${p.label}"`,
  );
  ok(
    /checked=\{data\.enabled\}/.test(src),
    "the switch reflects the saved setting, not a guess",
  );
  ok(
    /disabled=\{busy \|\| !owner\}/.test(src),
    "a non-Owner cannot flip it",
  );
  ok(
    /data\.enabled \? "Turn Off" : "Turn On"/.test(src),
    "offers an explicit Turn On / Turn Off button",
  );
  ok(
    /onClick=\{\(\) => update\(!data\.enabled\)\}/.test(src) ||
      /onClick=\{\(\) => update\(\{ enabled: !data\.enabled \}\)\}/.test(src),
    "that button actually flips the saved setting",
  );
}

console.log(fail ? `\n${fail} BLOCKER(S)` : "\nall clear");
process.exit(fail ? 1 : 0);
