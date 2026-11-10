import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  SETTINGS_SECTIONS,
  resolveSettingsSection,
} from "../src/components/admin/nav-config";

const admin = readFileSync("src/routes/admin.tsx", "utf8");
const settings = readFileSync("src/components/admin/SettingsWorkspace.tsx", "utf8");
const pnl = readFileSync("src/components/admin/OwnerPnlPanel.tsx", "utf8");
const studio = readFileSync("src/components/admin/PhotoStudioSettingsCard.tsx", "utf8");
const autofill = readFileSync("src/components/admin/SafeAutofillPanel.tsx", "utf8");
const team = readFileSync("src/components/admin/TeamPanel.tsx", "utf8");
const activity = readFileSync("src/components/admin/ActivityPanel.tsx", "utf8");
const builder = readFileSync("src/components/admin/AgreementBuilder.tsx", "utf8");

describe("Settings page title", () => {
  it("uses a Settings workspace title instead of falling back to Overview", () => {
    assert.match(admin, /tab === "settings"\s*\n\s*\? \{ id: "settings", label: "Settings"/);
    assert.match(admin, /Settings is off the rail/);
    assert.doesNotMatch(
      admin,
      /const workspace = TABS\.find\(\(t\) => t\.id === ownerTab\) \?\? current;/,
    );
  });

  it("shows one Settings title with no Overview subtitle", () => {
    assert.match(admin, /workspace\.description \? \(/);
    assert.match(settings, /<h2[^>]*>\{current\.label\}/);
    assert.doesNotMatch(settings, /<h1\b/);
    assert.doesNotMatch(settings, /Pipeline, Fleet And Revenue At A Glance/);
  });
});

describe("P&L page title", () => {
  it("does not repeat the shell P&L heading", () => {
    assert.doesNotMatch(pnl, /<h2[^>]*>P&L</);
    assert.doesNotMatch(pnl, /<h1\b/);
  });
});

describe("Combined Media settings section", () => {
  it("keeps Photos and Agreements on one Media section", () => {
    const ids = SETTINGS_SECTIONS.map((s) => s.id);
    assert.ok(ids.includes("media"));
    assert.ok(!ids.includes("vehicle_photos"));
    assert.ok(!ids.includes("agreements"));
    assert.equal(SETTINGS_SECTIONS.find((s) => s.id === "media")?.label, "Media");
    assert.equal(resolveSettingsSection("agreements"), "media");
    assert.equal(resolveSettingsSection("vehicle_photos"), "media");
    assert.match(settings, /current\.id === "media"/);
    assert.match(settings, /<PhotoEnhancePanel/);
    assert.match(settings, /<PhotoStudioSettingsCard/);
    assert.match(settings, /<PhotoReadingPanel/);
    assert.match(settings, /SECTION_KEY\.esign/);
    assert.match(settings, /<AgreementTemplatesPanel/);
  });

  it("keeps photo studio captions", () => {
    assert.match(studio, /Images Per Day/);
    assert.match(studio, /Monthly Cap \(\$\)/);
  });
});

describe("One-word settings labels", () => {
  it("uses Autofill and Partners, and no multi-word list or group titles", () => {
    assert.equal(SETTINGS_SECTIONS.find((s) => s.id === "safe_autofill")?.label, "Autofill");
    assert.equal(SETTINGS_SECTIONS.find((s) => s.id === "partners")?.label, "Partners");
    for (const section of SETTINGS_SECTIONS) {
      assert.equal(section.label.includes(" "), false, `${section.id} label is one word`);
      assert.equal(section.group.includes(" "), false, `${section.id} group is one word`);
    }
    assert.match(autofill, /aria-label="Autofill enabled"/);
    assert.match(autofill, /Autofill Is \{s\.enabled/);
  });
});

describe("Team and Activity settings titles", () => {
  it("does not repeat the Settings section heading", () => {
    assert.doesNotMatch(team, /<h2[^>]*>Team</);
    assert.doesNotMatch(activity, /<h2[^>]*>Activity</);
    assert.match(team, /Invite Teammate/);
  });
});

describe("Legacy settings deep links", () => {
  it("sends Countersigner fixes to Media", () => {
    assert.match(builder, /section=media/);
    assert.doesNotMatch(builder, /section=esign/);
    assert.match(builder, /Settings → Company and Media/);
  });
});
